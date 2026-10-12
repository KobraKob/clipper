"""
Distribution management: posting queue scheduling and analytics feedback loop.

Features:
1. Posting Queue with Scheduling: Spread clip publications over scheduled times
   instead of posting entire batches at once.
2. Analytics Loop: Pull views/retention back from YouTube Data API v3 and feed top-performing
   hooks into the scoring prompt to compound viral performance over time.
"""

from __future__ import annotations

import datetime
import json
import logging
import pathlib
from typing import Any, Dict, List, Optional

from .config import Settings, settings as default_settings
from .publish import PublishError, _youtube_credentials, upload_youtube

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------------------
# 1. Posting Queue & Scheduling
# --------------------------------------------------------------------------------------


def parse_iso_datetime(dt_str: str) -> datetime.datetime:
    """Safely parse ISO-8601 timestamp string into UTC datetime object."""
    dt_str = dt_str.replace("Z", "+00:00")
    dt = datetime.datetime.fromisoformat(dt_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt


def schedule_clip_post(
    manifest_path: pathlib.Path,
    rank: int,
    platform: str,
    scheduled_at_iso: str,
) -> Dict[str, Any]:
    """
    Assign a scheduled publish time to a clip inside the metadata manifest.

    Args:
        manifest_path: Path to metadata.json for the job.
        rank: Clip rank number (1-based index).
        platform: 'youtube' | 'instagram' | 'both'.
        scheduled_at_iso: Target publication ISO datetime string (e.g. '2026-10-15T18:00:00Z').

    Returns:
        Updated clip dictionary.
    """
    manifest_path = pathlib.Path(manifest_path)
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest file not found: {manifest_path}")

    # Validate ISO timestamp
    scheduled_dt = parse_iso_datetime(scheduled_at_iso)

    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    clips = data.get("clips", [])
    target = None
    for c in clips:
        if c.get("rank") == rank:
            target = c
            break

    if target is None:
        raise ValueError(f"Clip rank {rank} not found in manifest {manifest_path}")

    target["schedule"] = {
        "status": "scheduled",
        "platform": platform,
        "scheduled_at": scheduled_dt.isoformat(),
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }

    manifest_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    logger.info("[distribution] Scheduled clip #%d for %s (%s)", rank, scheduled_at_iso, platform)
    return target


def list_scheduled_queue(outputs_dir: pathlib.Path) -> List[Dict[str, Any]]:
    """
    Scan all manifests in outputs_dir for clips queued for future publishing.
    Returns list of items sorted by scheduled_at ascending.
    """
    outputs_dir = pathlib.Path(outputs_dir)
    queue: List[Dict[str, Any]] = []
    if not outputs_dir.exists():
        return queue

    for manifest in outputs_dir.glob("**/metadata.json"):
        try:
            raw = json.loads(manifest.read_text(encoding="utf-8"))
            job_id = raw.get("job_id", manifest.parent.name)
            for c in raw.get("clips", []):
                sched = c.get("schedule")
                if sched and sched.get("status") == "scheduled":
                    queue.append({
                        "job_id": job_id,
                        "manifest_path": str(manifest.resolve()),
                        "rank": c.get("rank"),
                        "title": c.get("title"),
                        "hook": c.get("hook"),
                        "file": c.get("file"),
                        "platform": sched.get("platform", "youtube"),
                        "scheduled_at": sched.get("scheduled_at"),
                    })
        except Exception as exc:
            logger.debug("[distribution] Error reading manifest %s: %s", manifest, exc)

    queue.sort(key=lambda item: item.get("scheduled_at", ""))
    return queue


def process_posting_queue(
    outputs_dir: pathlib.Path,
    s: Settings = default_settings,
    now_dt: Optional[datetime.datetime] = None,
) -> List[Dict[str, Any]]:
    """
    Inspect the scheduled queue and execute uploads for any clips whose scheduled time has passed.
    """
    current_time = now_dt or datetime.datetime.now(datetime.timezone.utc)
    queue = list_scheduled_queue(outputs_dir)
    published_items: List[Dict[str, Any]] = []

    for item in queue:
        scheduled_str = item.get("scheduled_at")
        if not scheduled_str:
            continue
        try:
            scheduled_dt = parse_iso_datetime(scheduled_str)
        except Exception:
            continue

        if scheduled_dt <= current_time:
            manifest_path = pathlib.Path(item["manifest_path"])
            rank = item["rank"]
            platform = item["platform"]

            logger.info("[distribution] Executing scheduled publish for job %s clip #%d...", item["job_id"], rank)
            try:
                # Update manifest via standard publish routine
                from .publish import update_manifest
                target_platforms = [platform] if platform != "both" else ["youtube", "instagram"]
                result = update_manifest(manifest_path, rank, target_platforms, s)

                # Check if any target platform succeeded or if all failed
                has_success = any(
                    result.get(p, {}).get("status") == "published"
                    for p in target_platforms
                )
                error_messages = [
                    f"{p}: {result.get(p, {}).get('error', 'Unknown upload failure')}"
                    for p in target_platforms
                    if result.get(p, {}).get("status") == "error"
                ]

                # Update schedule entry truthfully
                manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
                for c in manifest_data.get("clips", []):
                    if c.get("rank") == rank and "schedule" in c:
                        if has_success:
                            c["schedule"]["status"] = "published"
                            c["schedule"]["published_at"] = current_time.isoformat()
                            c["schedule"]["result"] = result
                        else:
                            c["schedule"]["status"] = "error"
                            c["schedule"]["error"] = "; ".join(error_messages) or "Upload failed"
                            c["schedule"]["result"] = result
                manifest_path.write_text(json.dumps(manifest_data, indent=2), encoding="utf-8")

                published_items.append({
                    "job_id": item["job_id"],
                    "rank": rank,
                    "platform": platform,
                    "status": "success" if has_success else "error",
                    "result": result,
                    "error": "; ".join(error_messages) if not has_success else None,
                })
            except Exception as exc:
                logger.error("[distribution] Scheduled publish failed for job %s clip #%d: %s", item["job_id"], rank, exc)
                published_items.append({
                    "job_id": item["job_id"],
                    "rank": rank,
                    "platform": platform,
                    "status": "error",
                    "error": str(exc),
                })

    return published_items


# --------------------------------------------------------------------------------------
# 2. Analytics Loop & Feedback Mechanism
# --------------------------------------------------------------------------------------


def fetch_youtube_video_analytics(video_id: str, s: Settings = default_settings) -> Dict[str, Any]:
    """
    Fetch view count, like count, and comment count for an uploaded YouTube Shorts video using YouTube Data API v3.
    """
    creds = _youtube_credentials(s)
    from googleapiclient.discovery import build

    service = build("youtube", "v3", credentials=creds, cache_discovery=False)
    resp = service.videos().list(part="snippet,statistics", id=video_id).execute()

    items = resp.get("items", [])
    if not items:
        raise PublishError(f"No YouTube video found with ID {video_id}")

    stats = items[0].get("statistics", {})
    return {
        "video_id": video_id,
        "view_count": int(stats.get("viewCount", 0)),
        "like_count": int(stats.get("likeCount", 0)),
        "comment_count": int(stats.get("commentCount", 0)),
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


def refresh_manifest_analytics(
    manifest_path: pathlib.Path,
    s: Settings = default_settings,
) -> Dict[str, Any]:
    """
    Fetch and update analytics for all published YouTube clips in a metadata.json manifest.
    """
    manifest_path = pathlib.Path(manifest_path)
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")

    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    updated_count = 0

    for clip in data.get("clips", []):
        publish_info = clip.get("publish", {})
        yt_info = publish_info.get("youtube", {})
        vid = yt_info.get("id")
        if vid and yt_info.get("status") == "published":
            try:
                stats = fetch_youtube_video_analytics(vid, s)
                clip["analytics"] = stats
                updated_count += 1
            except Exception as exc:
                logger.debug("[distribution] Could not fetch analytics for %s: %s", vid, exc)

    if updated_count > 0:
        manifest_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    return data


def get_top_performing_hooks(
    outputs_dir: pathlib.Path,
    top_n: int = 5,
) -> List[Dict[str, Any]]:
    """
    Gather top-performing clips ranked by view count across all manifests in outputs_dir.
    """
    outputs_dir = pathlib.Path(outputs_dir)
    performers: List[Dict[str, Any]] = []
    if not outputs_dir.exists():
        return performers

    for manifest in outputs_dir.glob("**/metadata.json"):
        try:
            raw = json.loads(manifest.read_text(encoding="utf-8"))
            for clip in raw.get("clips", []):
                analytics = clip.get("analytics", {})
                views = analytics.get("view_count", 0)
                if views > 0 and clip.get("hook"):
                    performers.append({
                        "hook": clip.get("hook"),
                        "title": clip.get("title"),
                        "views": views,
                        "likes": analytics.get("like_count", 0),
                        "video_id": analytics.get("video_id"),
                    })
        except Exception:
            pass

    performers.sort(key=lambda p: p["views"], reverse=True)
    return performers[:top_n]


def format_top_hooks_prompt_context(outputs_dir: pathlib.Path) -> str:
    """
    Build context prompt string containing top-performing hooks from previous videos.
    This enables the scoring LLM to compound learning and prioritize winning patterns.
    """
    top_clips = get_top_performing_hooks(outputs_dir, top_n=5)
    if not top_clips:
        return ""

    lines = [
        "\n--- CHANNEL PERFORMANCE FEEDBACK (Winning Viral Hooks on this Channel) ---",
        "Prioritize candidates with structural or thematic patterns similar to these proven top performers:",
    ]
    for idx, c in enumerate(top_clips, 1):
        lines.append(f"{idx}. \"{c['hook']}\" ({c['views']:,} views, {c['likes']:,} likes)")
    lines.append("--------------------------------------------------------------------------\n")
    return "\n".join(lines)
