"""
End-to-end pipeline orchestrator for clipping, scoring, reframing, and captioning.
"""

from __future__ import annotations

import hashlib
import json
import logging
import pathlib
import re
from typing import Any, Dict, List, Optional

from .candidates import build_candidates, detect_scene_cuts, prefilter
from .captions import build_ass, burn_captions
from .config import Settings, settings as default_settings
from .cut import cut
from .ingest import download, extract_audio, is_url
from .providers import get_llm, get_transcriber
from .providers.base import LLM, Transcriber
from .reframe import render_vertical

logger = logging.getLogger(__name__)


def slugify(text: str, max_len: int = 50) -> str:
    """Generate safe filesystem slug from a string."""
    clean = re.sub(r"[^\w\s-]", "", text).strip().lower()
    clean = re.sub(r"[-\s]+", "_", clean)
    return clean[:max_len] if clean else "clip"


def get_job_id(source: str) -> str:
    """Generate deterministic job directory identifier based on input source."""
    if is_url(source):
        hasher = hashlib.sha256(source.encode("utf-8")).hexdigest()[:12]
        return f"job_{hasher}"
    p = pathlib.Path(source)
    name_slug = slugify(p.stem, max_len=20)
    hasher = hashlib.sha256(str(p.resolve()).encode("utf-8")).hexdigest()[:8]
    return f"{name_slug}_{hasher}"


def get_transcript(
    wav: pathlib.Path,
    job_dir: pathlib.Path,
    transcriber: Optional[Transcriber] = None,
    s: Settings = default_settings,
) -> Dict[str, Any]:
    """
    Retrieve cached transcript if available, otherwise transcribe and cache.
    Prevents repeated expensive transcription calls during prompt iterations.
    """
    transcript_file = job_dir / "transcript.json"
    if transcript_file.exists():
        logger.info("[pipeline] Using cached transcript from %s", transcript_file)
        try:
            return json.loads(transcript_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            logger.warning("[pipeline] Cached transcript was corrupt; re-transcribing.")

    tr_service = transcriber or get_transcriber(s)
    logger.info("[pipeline] Starting transcription on %s...", wav.name)
    transcript_data = tr_service.transcribe(wav, job_dir)

    transcript_file.write_text(json.dumps(transcript_data, indent=2), encoding="utf-8")
    logger.info("[pipeline] Saved transcript to %s", transcript_file)
    return transcript_data


def run_pipeline(
    source: str,
    n_clips: int = 5,
    vertical: bool = True,
    captions: bool = True,
    work_dir: Optional[pathlib.Path] = None,
    output_dir: Optional[pathlib.Path] = None,
    app_settings: Optional[Settings] = None,
    transcriber: Optional[Transcriber] = None,
    llm: Optional[LLM] = None,
) -> Dict[str, Any]:
    """
    Execute full automated video clipping pipeline.
    """
    s = app_settings or default_settings
    base_work_dir = pathlib.Path(work_dir or "workdir")
    base_out_dir = pathlib.Path(output_dir or "outputs")

    job_id = get_job_id(source)
    job_dir = base_work_dir / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    base_out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Ingestion
    logger.info("[pipeline] Ingesting source: %s", source)
    if is_url(source):
        video_path = download(source, job_dir)
    else:
        video_path = pathlib.Path(source)
        if not video_path.exists():
            raise FileNotFoundError(f"Source video file not found: {video_path}")

    # 2. Extract audio (16 kHz mono WAV)
    wav_path = job_dir / "audio.wav"
    if not wav_path.exists():
        logger.info("[pipeline] Extracting 16 kHz mono audio...")
        extract_audio(video_path, wav_path)

    # 3. Transcribe or read cache
    tr_data = get_transcript(wav_path, job_dir, transcriber=transcriber, s=s)
    segments = tr_data.get("segments", [])
    if not segments:
        raise RuntimeError("Transcription produced zero segments.")

    # 4. Detect visual scene cuts for snap reframing
    logger.info("[pipeline] Analyzing visual scene cuts...")
    scene_cuts = detect_scene_cuts(video_path)

    # 5. Build and pre-filter candidates
    candidates_cache = job_dir / "candidates.json"
    if candidates_cache.exists():
        logger.info("[pipeline] Loading pre-filtered candidates from cache...")
        cands = json.loads(candidates_cache.read_text(encoding="utf-8"))
    else:
        logger.info("[pipeline] Generating sentence-snapped candidate windows...")
        raw_cands = build_candidates(
            segments,
            min_len=float(s.min_clip_duration),
            max_len=float(s.max_clip_duration),
        )
        cands = prefilter(
            raw_cands,
            top_k=max(s.shortlist * 3, 30),
            scene_cuts=scene_cuts,
        )
        candidates_cache.write_text(json.dumps(cands, indent=2), encoding="utf-8")

    if not cands:
        raise RuntimeError("No suitable candidate windows found matching duration criteria.")

    # 6. Two-Stage LLM Scoring
    llm_service = llm or get_llm(s)
    logger.info("[pipeline] Scoring candidates using %s tier LLM...", s.llm_provider)
    from .scoring import rank

    ranked_clips = rank(cands, llm_service, n=n_clips, shortlist_size=s.shortlist)

    tokens_used = getattr(llm_service, "tokens_used", 0)
    if tokens_used:
        logger.info("[pipeline] LLM tokens consumed: %d", tokens_used)

    # 7. Render clips (Cut -> Reframe -> Captions)
    exported_clips: List[Dict[str, Any]] = []

    for idx, clip in enumerate(ranked_clips, start=1):
        clip_title = clip.get("title", f"Clip {idx}")
        slug = slugify(clip_title)
        logger.info("[pipeline] Processing [%d/%d]: '%s' (Score: %d)", idx, len(ranked_clips), clip_title, clip.get("score", 0))

        start_time = float(clip["start"])
        end_time = float(clip["end"])

        # Frame-accurate cut
        raw_clip = job_dir / f"clip_{idx}_raw.mp4"
        cut(video_path, start_time, end_time, raw_clip, pad=0.15)
        current_video = raw_clip

        # Vertical 9:16 reframing
        if vertical:
            vertical_clip = job_dir / f"clip_{idx}_vertical.mp4"
            logger.info("  -> Reframing to 9:16 with face tracking...")
            # Shift scene cuts to clip relative time
            rel_cuts = [c - start_time for c in scene_cuts if start_time <= c <= end_time]
            render_vertical(current_video, vertical_clip, scene_cuts=rel_cuts)
            current_video = vertical_clip

        # Burn word-level animated captions
        final_clip_name = f"{idx:02d}_{slug}.mp4"
        final_clip_path = base_out_dir / final_clip_name

        if captions:
            logger.info("  -> Generating animated ASS captions...")
            # Extract word timestamps within this time window
            pad_offset = 0.15
            clip_words: List[Dict[str, Any]] = []
            for seg in segments:
                for w in seg.get("words", []):
                    w_s = float(w["start"])
                    if (start_time - pad_offset) <= w_s <= (end_time + pad_offset):
                        clip_words.append(w)

            ass_file = job_dir / f"clip_{idx}.ass"
            ass_content = build_ass(clip_words, clip_start=max(0.0, start_time - pad_offset))
            ass_file.write_text(ass_content, encoding="utf-8")

            burn_captions(current_video, ass_file, final_clip_path)
        else:
            # Copy uncaptioned video to final location
            import shutil
            shutil.copy(current_video, final_clip_path)

        clip_record = {
            "rank": idx,
            "title": clip_title,
            "score": clip.get("score", 0),
            "hook": clip.get("hook", ""),
            "reason": clip.get("reason", ""),
            "start": start_time,
            "end": end_time,
            "duration": round(end_time - start_time, 2),
            "file": str(final_clip_path.resolve()),
        }
        exported_clips.append(clip_record)

    # 8. Export metadata manifest
    metadata_path = base_out_dir / "metadata.json"
    metadata_manifest = {
        "job_id": job_id,
        "source": str(source),
        "clips_exported": len(exported_clips),
        "tokens_used": tokens_used,
        "clips": exported_clips,
    }
    metadata_path.write_text(json.dumps(metadata_manifest, indent=2), encoding="utf-8")
    logger.info("[pipeline] Exported %d clips to %s", len(exported_clips), base_out_dir)

    return metadata_manifest
