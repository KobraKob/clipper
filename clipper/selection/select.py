"""
Master clip selection orchestrator: coordinates Replay-Peak (H0-H8) and LLM fallback pipelines.
"""

from __future__ import annotations

import json
import logging
import pathlib
import re
import time
from typing import Any, Dict, List, Optional, Union

from ..config import Settings, settings as default_settings
from ..providers.base import LLM
from .fallback import is_ad_or_sponsor, run_fallback_selection
from .llm_check import check_clip_with_llm
from .log import log_clip_plan
from .plan import ClipPlan
from .refine import refine_window_with_llm
from .replay_peaks import (
    Peak,
    build_window,
    fetch_heatmap,
    find_peaks,
    fuse_scores,
    pick_non_overlapping,
    snap_to_sentences,
)
from .sentences import build_sentences

logger = logging.getLogger(__name__)


def extract_video_id(source: str) -> str:
    """Extract YouTube video ID or safe file stem for deterministic clip_id prefix."""
    yt_match = re.search(r"(?:v=|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})", source)
    if yt_match:
        return yt_match.group(1)
    p = pathlib.Path(source)
    clean = re.sub(r"[^\w-]", "", p.stem)
    return clean[:16] or "video"


def run(
    source: str,
    segments: List[Dict[str, Any]],
    duration: Optional[float] = None,
    llm: Optional[LLM] = None,
    settings: Optional[Settings] = None,
    work_dir: Optional[pathlib.Path] = None,
    audio_score: Optional[float] = None,
    **overrides: Any,
) -> List[ClipPlan]:
    """
    Main entry point for candidate selection.
    Executes stages H0-H8 and falls back gracefully to LLM window selection when heatmap signal is missing.
    Returns: List[ClipPlan]
    """
    s = settings or default_settings

    # Resolve settings / overrides
    mode = str(overrides.get("clip_selection_mode", getattr(s, "clip_selection_mode", "hybrid"))).lower()
    clips_per_video = int(overrides.get("clips_per_video", getattr(s, "clips_per_video", 5)))
    clip_min_sec = float(overrides.get("clip_min_sec", getattr(s, "clip_min_sec", 30.0)))
    clip_max_sec = float(overrides.get("clip_max_sec", getattr(s, "clip_max_sec", 39.0)))
    fill_with_llm = bool(overrides.get("fill_with_llm", getattr(s, "fill_with_llm", False)))
    peak_min_val = float(overrides.get("peak_min_value", getattr(s, "peak_min_value", 0.55)))
    peak_min_contrast = float(overrides.get("peak_min_contrast", getattr(s, "peak_min_contrast", 0.15)))
    edge_ignore_pct = float(overrides.get("peak_edge_ignore_pct", getattr(s, "peak_edge_ignore_pct", 3.0)))
    min_gap_sec = float(overrides.get("peak_min_gap_sec", getattr(s, "peak_min_gap_sec", 45.0)))
    width_fraction = float(overrides.get("peak_width_fraction", getattr(s, "peak_width_fraction", 0.6)))
    setup_share = float(overrides.get("peak_setup_share", getattr(s, "peak_setup_share", 0.65)))
    refine_bucket_sec = float(overrides.get("refine_if_bucket_sec", getattr(s, "refine_if_bucket_sec", 15.0)))
    w_heat = float(overrides.get("w_heat", getattr(s, "w_heat", 0.5)))
    w_llm = float(overrides.get("w_llm", getattr(s, "w_llm", 0.35)))
    w_audio = float(overrides.get("w_audio", getattr(s, "w_audio", 0.15)))
    skip_under_sec = float(overrides.get("skip_videos_under_sec", getattr(s, "skip_videos_under_sec", 90.0)))

    # Build sentences once from segments
    sentences = build_sentences(segments)
    inferred_dur = max((float(s["end"]) for s in sentences), default=0.0) if sentences else 0.0

    # 1. H0: Heatmap Retrieval & Cache
    heatmap: Optional[List[Dict[str, Any]]] = None
    fetched_dur: Optional[float] = None

    cache_file = (work_dir / "heatmap.json") if work_dir else None
    if cache_file and cache_file.exists():
        try:
            cache_payload = json.loads(cache_file.read_text(encoding="utf-8"))
            heatmap = cache_payload.get("heatmap")
            fetched_dur = cache_payload.get("duration")
            logger.info("[selection] Loaded cached heatmap (%s points).", len(heatmap) if heatmap else "no")
        except Exception as exc:
            logger.debug("[selection] Corrupt heatmap cache: %s", exc)

    if heatmap is None and mode != "llm" and (cache_file is None or not cache_file.exists()):
        logger.info("[selection] Fetching replay heatmap via yt-dlp...")
        heatmap, fetched_dur = fetch_heatmap(
            source,
            cookies_from_browser=getattr(s, "ytdlp_cookies_from_browser", None) or None,
            cookies_file=getattr(s, "ytdlp_cookies_file", None) or None,
            proxy=getattr(s, "ytdlp_proxy", None) or None,
            force_ipv4=bool(getattr(s, "ytdlp_force_ipv4", False)),
            socket_timeout=int(getattr(s, "ytdlp_socket_timeout", 15)),
        )
        if cache_file:
            try:
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                cache_file.write_text(
                    json.dumps({"heatmap": heatmap, "duration": fetched_dur, "cached_at": int(time.time())}, indent=2),
                    encoding="utf-8",
                )
            except Exception as exc:
                logger.debug("[selection] Could not write heatmap cache: %s", exc)


    # Determine final video duration
    total_duration = duration or fetched_dur or inferred_dur

    # Section 9: Check skip duration
    if total_duration < skip_under_sec:
        logger.warning(
            "[selection] Video duration %.1fs is shorter than SKIP_VIDEOS_UNDER_SEC (%.1fs); skipping clipping.",
            total_duration, skip_under_sec
        )
        return []

    # 2. H1-H2: Peak Detection or Fallback Trigger
    video_id = extract_video_id(source)
    candidates: List[Dict[str, Any]] = []
    has_heatmap_signal = False
    dropped_sponsor_count = 0

    if mode != "llm" and heatmap and len(heatmap) >= 10:
        bucket_sec = total_duration / len(heatmap)
        peaks = find_peaks(
            heatmap,
            total_duration,
            min_value=peak_min_val,
            edge_ignore_pct=edge_ignore_pct,
            min_gap_sec=min_gap_sec,
            width_fraction=width_fraction,
            max_peaks=clips_per_video * 2,
            min_contrast=peak_min_contrast,
        )

        if peaks:
            has_heatmap_signal = True
            logger.info("[selection] Found %d candidate replay peaks.", len(peaks))

            for rank_idx, peak in enumerate(peaks, start=1):
                peak_warnings: List[str] = []

                # Sponsor / ad read check in hump span
                span_text = " ".join(
                    s["text"]
                    for s in sentences
                    if float(s["end"]) >= peak.span_start and float(s["start"]) <= peak.span_end
                )
                if is_ad_or_sponsor(span_text):
                    logger.info("[selection] Dropped peak at %.1fs due to sponsor/promo read.", peak.time)
                    dropped_sponsor_count += 1
                    continue

                # H3: Initial Window
                win_start, win_end = build_window(
                    peak,
                    total_duration,
                    min_len=clip_min_sec,
                    max_len=clip_max_sec,
                    setup_share=setup_share,
                )

                # H4: Refine if buckets are coarse
                is_refined = False
                if bucket_sec > refine_bucket_sec:
                    ref_s, ref_e, ref_reason, ok = refine_window_with_llm(
                        peak.span_start,
                        peak.span_end,
                        bucket_sec,
                        sentences,
                        llm,
                        peak_time=peak.time,
                        min_len=clip_min_sec,
                        max_len=clip_max_sec,
                    )
                    if ok and ref_s is not None and ref_e is not None:
                        win_start, win_end = ref_s, ref_e
                        peak_warnings.append("refined_by_llm")
                        is_refined = True

                # H5: Sentence Snapping (skip if already refined on sentence boundaries)
                if not is_refined:
                    snap_s, snap_e, snapped = snap_to_sentences(
                        win_start,
                        win_end,
                        sentences,
                        peak.time,
                        min_len=clip_min_sec,
                        max_len=clip_max_sec,
                    )
                    if snapped:
                        win_start, win_end = snap_s, snap_e
                    else:
                        peak_warnings.append("unsnapped")

                # H6: LLM Check
                check_res = check_clip_with_llm(
                    win_start,
                    win_end,
                    peak.time,
                    sentences,
                    llm,
                    min_len=clip_min_sec,
                    max_len=clip_max_sec,
                )
                if not check_res.keep:
                    logger.info("[selection] LLM check dropped peak at %.1fs: %s", peak.time, check_res.reason)
                    continue

                win_start = check_res.start
                win_end = check_res.end
                if check_res.warnings:
                    peak_warnings.extend(check_res.warnings)

                if dropped_sponsor_count > 0:
                    peak_warnings.append("sponsor_dropped")

                # H7: Score Fusion
                final_score = fuse_scores(
                    heat=peak.value,
                    llm=check_res.llm_score,
                    audio=audio_score,
                    w_heat=w_heat,
                    w_llm=w_llm,
                    w_audio=w_audio,
                )

                # Text within clip window
                clip_text = " ".join(
                    s["text"]
                    for s in sentences
                    if float(s["end"]) >= win_start and float(s["start"]) <= win_end
                )

                candidates.append({
                    "start": win_start,
                    "end": win_end,
                    "source": "heatmap",
                    "peak_time": peak.time,
                    "peak_value": peak.value,
                    "heatmap_rank": rank_idx,
                    "llm_score": check_res.llm_score,
                    "audio_score": audio_score,
                    "final_score": final_score,
                    "score": final_score,
                    "reason": check_res.reason or f"Viewer replay peak at {int(peak.time)}s",
                    "warnings": list(dict.fromkeys(peak_warnings)),
                    "text": clip_text,
                })
        else:
            # Heatmap was present but flat or no peak passed PEAK_MIN_VALUE
            logger.info("[selection] Heatmap present but returned zero usable peaks (flat or below threshold).")

    # 3. Fallback Trigger & Hybrid Fill
    needs_fallback = (not candidates) or (mode == "llm")
    needs_hybrid_fill = (
        mode == "hybrid"
        and fill_with_llm
        and len(candidates) < clips_per_video
    )

    if needs_fallback or needs_hybrid_fill:
        fallback_warnings: List[str] = []
        if mode != "llm":
            if heatmap is None:
                fallback_warnings.append("no_heatmap")
            elif not has_heatmap_signal:
                fallback_warnings.append("flat_heatmap")
        if dropped_sponsor_count > 0:
            fallback_warnings.append("sponsor_dropped")

        needed_count = clips_per_video - len(candidates) if needs_hybrid_fill else clips_per_video
        logger.info("[selection] Running fallback candidate generator (requesting %d clips)...", needed_count)
        fallback_cands = run_fallback_selection(
            sentences,
            n_clips=needed_count * 2,
            llm=llm,
            min_len=clip_min_sec,
            max_len=clip_max_sec,
            warnings=fallback_warnings,
        )
        candidates.extend(fallback_cands)

    # 4. Deduplication & Final Shortlist (H7)
    selected_dicts = pick_non_overlapping(candidates, n=clips_per_video, min_gap=0.0)

    # 5. Build ClipPlan Objects & Log
    log_file = overrides.get("log_path") or getattr(s, "clips_log_path", None) or "clips.jsonl"
    final_plans: List[ClipPlan] = []
    for plan_dict in selected_dicts:
        start_t = float(plan_dict["start"])
        end_t = float(plan_dict["end"])
        t_int = int(start_t)
        clip_id = f"{video_id}_t{t_int:04d}"

        # If hybrid mode mixed heatmap and LLM clips, classify source appropriately
        clip_source = plan_dict.get("source", "heatmap")
        if mode == "hybrid" and has_heatmap_signal and clip_source == "llm":
            clip_source = "hybrid"

        plan = ClipPlan(
            clip_id=clip_id,
            source_video=source,
            start=start_t,
            end=end_t,
            source=clip_source,
            peak_time=plan_dict.get("peak_time"),
            peak_value=plan_dict.get("peak_value"),
            heatmap_rank=plan_dict.get("heatmap_rank"),
            llm_score=plan_dict.get("llm_score"),
            audio_score=plan_dict.get("audio_score"),
            final_score=float(plan_dict.get("final_score", 0.0)),
            reason=plan_dict.get("reason", ""),
            warnings=plan_dict.get("warnings", []),
            title=plan_dict.get("title", ""),
            hook=plan_dict.get("hook", ""),
            text=plan_dict.get("text", ""),
        )
        final_plans.append(plan)
        # Section 8: Log every ClipPlan to clips.jsonl
        log_clip_plan(plan, log_path=log_file)

    logger.info("[selection] Selected %d final ClipPlan candidates.", len(final_plans))
    return final_plans
