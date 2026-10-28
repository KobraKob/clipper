"""
End-to-end pipeline orchestrator for clipping, scoring, reframing, and captioning.
"""

from __future__ import annotations

import hashlib
import json
import logging
import pathlib
import re
import shutil
import time
from typing import Any, Dict, List, Optional

from .candidates import build_candidates, detect_scene_cuts, prefilter
from .captions import FONTS_DIR, build_ass, burn_captions, get_style
from .config import Settings, settings as default_settings
from .cover import pick_cover_frame
from .cut import cut
from .distribution import format_top_hooks_prompt_context
from .ingest import download, extract_audio, is_url, load_source_info
from .providers import get_llm, get_transcriber
from .providers.base import LLM, Transcriber
from .reframe import render_vertical
from .retention import (
    apply_silence_trimming,
    detect_keep_intervals,
    remap_words_after_trim,
)
from .scoring import rank
from .seo import generate_metadata

logger = logging.getLogger(__name__)


def _log_elapsed(stage: str, started_at: float) -> None:
    """Log elapsed wall time for a pipeline stage."""
    logger.info("[timing] %s completed in %.2fs", stage, time.perf_counter() - started_at)



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


def write_progress(
    job_dir: pathlib.Path,
    stage: str,
    percent: int,
    message: str,
    out_dir: Optional[pathlib.Path] = None,
) -> None:
    """Write real progress update to progress.json in workdir and output directory."""
    payload = json.dumps(
        {
            "stage": stage,
            "percent": percent,
            "message": message,
            "updatedAt": int(time.time() * 1000),
        },
        indent=2,
    )
    targets = [job_dir / "progress.json"]
    if job_dir.parent and job_dir.parent.name.startswith("job-"):
        targets.append(job_dir.parent / "progress.json")
    if out_dir is not None:
        targets.append(out_dir / "progress.json")

    for target in targets:
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_suffix(".tmp")
            tmp.write_text(payload, encoding="utf-8")
            tmp.replace(target)
        except Exception as exc:
            logger.debug("[pipeline] Could not write %s: %s", target, exc)


def get_transcript(
    wav: pathlib.Path,
    job_dir: pathlib.Path,
    transcriber: Optional[Transcriber] = None,
    s: Settings = default_settings,
    progress_callback: Optional[Any] = None,
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
    try:
        transcript_data = tr_service.transcribe(wav, job_dir, progress_cb=progress_callback)
    except TypeError:
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
    caption_style: Optional[str] = None,
    layout: Optional[str] = None,
    seo: Optional[bool] = None,
    encoder: Optional[str] = None,
    trim_silence: bool = False,
    hook_overlay: bool = True,
    progress_bar: bool = False,
    loudnorm: bool = True,
    cover_frame: bool = True,
) -> Dict[str, Any]:
    """
    Execute full automated video clipping pipeline with real stage progress tracking,
    retention optimisations (hook overlay, silence trim, loudnorm, progress bar),
    and distribution assets (cover picker, title A/B variants, analytics feedback loop).
    """
    s = app_settings or default_settings
    style = get_style(caption_style or s.caption_style, s.caption_position or None)
    layout = layout or s.layout
    seo_on = s.seo_enabled if seo is None else seo
    base_work_dir = pathlib.Path(work_dir or "workdir")
    base_out_dir = pathlib.Path(output_dir or "outputs")

    job_id = get_job_id(source)
    job_dir = base_work_dir / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    base_out_dir.mkdir(parents=True, exist_ok=True)


    try:
        # 1. Ingestion
        stage_started = time.perf_counter()

        def on_download_progress(pct: float, status_str: str) -> None:
            # Scale yt-dlp download (0-100%) to ingest stage percent (5% - 15%)
            pipe_pct = 5 + int((pct / 100.0) * 10)
            clean_status = status_str
            if "[download]" in clean_status:
                clean_status = clean_status.replace("[download]", "Downloading:").strip()
            write_progress(job_dir, "ingest", pipe_pct, clean_status, base_out_dir)

        write_progress(job_dir, "ingest", 5, f"Ingesting source: {source}", base_out_dir)
        logger.info("[pipeline] Ingesting source: %s", source)
        if is_url(source):
            video_path = download(
                source,
                job_dir,
                min_height=s.min_source_height,
                max_height=s.max_source_height,
                cookies_from_browser=s.ytdlp_cookies_from_browser or None,
                cookies_file=s.ytdlp_cookies_file or None,
                progress_callback=on_download_progress,
                force_ipv4=s.ytdlp_force_ipv4,
                proxy=s.ytdlp_proxy or None,
                socket_timeout=s.ytdlp_socket_timeout,
                retries=s.ytdlp_retries,
            )
        else:
            video_path = pathlib.Path(source)
            if not video_path.exists():
                raise FileNotFoundError(f"Source video file not found: {video_path}")

        _log_elapsed("source download / lookup", stage_started)
        write_progress(job_dir, "ingest", 15, "Source downloaded. Extracting audio...", base_out_dir)

        # 2. Extract audio (16 kHz mono WAV)
        stage_started = time.perf_counter()
        wav_path = job_dir / "audio.wav"
        if not wav_path.exists():
            logger.info("[pipeline] Extracting 16 kHz mono audio...")
            extract_audio(video_path, wav_path)

        _log_elapsed("audio extraction (including cache lookup)", stage_started)

        # 3. Transcribe or read cache
        write_progress(job_dir, "transcribe", 25, "Transcribing speech to text...", base_out_dir)

        def on_transcribe_progress(current_chunk: int, total_chunks: int) -> None:
            pct = 25 + int((current_chunk / max(1, total_chunks)) * 13)
            write_progress(
                job_dir,
                "transcribe",
                pct,
                f"Transcribing audio chunk {current_chunk}/{total_chunks}...",
                base_out_dir,
            )

        stage_started = time.perf_counter()
        tr_data = get_transcript(
            wav_path,
            job_dir,
            transcriber=transcriber,
            s=s,
            progress_callback=on_transcribe_progress,
        )
        _log_elapsed("transcription / transcript cache", stage_started)
        segments = tr_data.get("segments", [])
        if not segments:
            raise RuntimeError("Transcription produced zero segments.")

        write_progress(job_dir, "transcribe", 38, "Transcript ready.", base_out_dir)

        stage_started = time.perf_counter()
        # 4. Detect visual scene cuts (cached in scenes.json to avoid expensive whole-file re-scanning)
        scenes_cache = job_dir / "scenes.json"
        candidates_cache = job_dir / "candidates.json"

        if scenes_cache.exists():
            logger.info("[pipeline] Loading scene cuts from cache: %s", scenes_cache)
            try:
                scene_cuts = json.loads(scenes_cache.read_text(encoding="utf-8"))
            except Exception:
                scene_cuts = None
        else:
            scene_cuts = None

        if scene_cuts is None:
            # Only run expensive whole-file scene detection if not cached
            write_progress(job_dir, "candidates", 42, "Analyzing scene cuts...", base_out_dir)
            logger.info("[pipeline] Analyzing visual scene cuts...")
            scene_cuts = detect_scene_cuts(video_path)
            scenes_cache.write_text(json.dumps(scene_cuts, indent=2), encoding="utf-8")

        _log_elapsed("scene detection / scene cache", stage_started)

        stage_started = time.perf_counter()
        # 5. Build and pre-filter candidates
        write_progress(job_dir, "candidates", 48, "Generating sentence-aligned candidate windows...", base_out_dir)
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

        _log_elapsed("candidate generation / candidate cache", stage_started)

        stage_started = time.perf_counter()
        # 6. Two-Stage LLM Scoring with Channel Analytics Feedback Loop
        write_progress(job_dir, "score", 55, "Scoring viral candidates with LLM...", base_out_dir)
        llm_service = llm or get_llm(s)
        logger.info("[pipeline] Scoring candidates using %s tier LLM...", s.llm_provider)
        history_dir = pathlib.Path(s.outputs_dir) if pathlib.Path(s.outputs_dir).exists() else base_out_dir.parent
        analytics_ctx = format_top_hooks_prompt_context(history_dir)
        ranked_clips = rank(cands, llm_service, n=n_clips, shortlist_size=s.shortlist, analytics_context=analytics_ctx)

        _log_elapsed("LLM candidate scoring", stage_started)
        tokens_used = getattr(llm_service, "tokens_used", 0)
        if tokens_used:
            logger.info("[pipeline] LLM tokens consumed: %d", tokens_used)

        # 7. Render clips (Cut -> [Silence Trim] -> [Reframe + Captions + Hook Overlay] -> Cover -> SEO)
        exported_clips: List[Dict[str, Any]] = []
        pad_offset = 0.15
        source_info = load_source_info(job_dir) if is_url(source) else {}

        for idx, clip in enumerate(ranked_clips, start=1):
            clip_started = time.perf_counter()
            clip_title = clip.get("title", f"Clip {idx}")
            slug = slugify(clip_title)
            current_pct = 60 + int((idx - 1) / max(1, len(ranked_clips)) * 35)
            write_progress(
                job_dir,
                "reframe" if vertical else "cut",
                current_pct,
                f"Rendering clip {idx}/{len(ranked_clips)}: '{clip_title}'",
                base_out_dir,
            )
            logger.info("[pipeline] Processing [%d/%d]: '%s' (Score: %d)", idx, len(ranked_clips), clip_title, clip.get("score", 0))

            start_time = float(clip["start"])
            end_time = float(clip["end"])

            # Frame-accurate cut
            raw_clip = job_dir / f"clip_{idx}_raw.mp4"
            cut(video_path, start_time, end_time, raw_clip, pad=pad_offset)

            final_clip_name = f"{idx:02d}_{slug}.mp4"
            final_clip_path = base_out_dir / final_clip_name

            # Words that fall inside this clip
            padded_start = max(0.0, start_time - pad_offset)
            padded_end = end_time + pad_offset
            effective_clip_start = padded_start
            clip_duration = round(end_time - start_time, 2)
            is_trimmed = False

            clip_words: List[Dict[str, Any]] = []
            for seg in segments:
                for w in seg.get("words", []):
                    w_s = float(w["start"])
                    if padded_start <= w_s <= padded_end:
                        clip_words.append(w)

            # Extract Cover / Thumbnail frame from clean raw clip (BEFORE subtitle / hook text burn-in)
            if cover_frame:
                cover_path = base_out_dir / f"{idx:02d}_{slug}_cover.jpg"
                try:
                    pick_cover_frame(raw_clip, cover_path)
                    clip_record_cover = str(cover_path.resolve())
                except Exception as exc:
                    logger.debug("[pipeline] Could not extract cover frame for clip %d: %s", idx, exc)
                    clip_record_cover = None
            else:
                clip_record_cover = None

            # Optional silence and filler trimming
            if trim_silence and clip_words:
                keep_intervals = detect_keep_intervals(clip_words, clip_start=padded_start, clip_end=padded_end)
                if len(keep_intervals) > 1 or (keep_intervals and keep_intervals[0][1] < (padded_end - padded_start) - 0.3):
                    trimmed_raw = job_dir / f"clip_{idx}_trimmed.mp4"
                    try:
                        apply_silence_trimming(raw_clip, keep_intervals, trimmed_raw)
                        clip_words = remap_words_after_trim(clip_words, keep_intervals, clip_start=padded_start)
                        raw_clip = trimmed_raw
                        is_trimmed = True
                        effective_clip_start = 0.0
                        clip_duration = round(sum(e - s for s, e in keep_intervals), 2)
                        logger.info("  -> Trimmed pauses and filler words (intervals: %d, dur: %.2fs)", len(keep_intervals), clip_duration)
                    except Exception as exc:
                        logger.warning("[pipeline] Silence trimming failed for clip %d: %s; using untrimmed cut.", idx, exc)

            transcript_text = " ".join(str(w["w"]).strip() for w in clip_words) or clip.get("text", "")

            ass_file: Optional[pathlib.Path] = None
            if captions and clip_words:
                logger.info("  -> Building '%s' animated captions (Hook overlay: %s)...", style.key, hook_overlay)
                ass_file = job_dir / f"clip_{idx}.ass"
                ass_file.write_text(
                    build_ass(
                        clip_words,
                        clip_start=effective_clip_start,
                        style=style,
                        play_w=s.out_width,
                        play_h=s.out_height,
                        hook=clip.get("hook") if hook_overlay else None,
                        hook_duration=2.5,
                        enable_keywords=True,
                        enable_emojis=False,
                    ),
                    encoding="utf-8",
                )

            if vertical:
                logger.info("  -> Rendering %dx%d vertical (%s layout, loudnorm: %s, progress: %s)...", s.out_width, s.out_height, layout, loudnorm, progress_bar)
                rel_cuts = [c - padded_start for c in scene_cuts if start_time <= c <= end_time]
                render_vertical(
                    raw_clip,
                    final_clip_path,
                    out_w=s.out_width,
                    out_h=s.out_height,
                    scene_cuts=rel_cuts,
                    ass_path=ass_file,
                    fonts_dir=FONTS_DIR,
                    layout=layout,
                    crf=s.video_crf,
                    preset=s.video_preset,
                    encoder=encoder or s.video_encoder,
                    fallback_to_cpu=s.enable_encoder_fallback,
                    s=s,
                    loudnorm=loudnorm,
                    progress_bar=progress_bar,
                    duration=clip_duration,
                )
            elif ass_file is not None:
                burn_captions(raw_clip, ass_file, final_clip_path)
            else:
                shutil.copy(raw_clip, final_clip_path)

            clip_record: Dict[str, Any] = {
                "rank": idx,
                "title": clip_title,
                "score": clip.get("score", 0),
                "hook": clip.get("hook", ""),
                "reason": clip.get("reason", ""),
                "start": start_time,
                "end": end_time,
                "duration": clip_duration,
                "file": str(final_clip_path.resolve()),
                "captions": captions,
                "caption_style": style.key if captions else None,
                "trim_silence": is_trimmed,
                "layout": layout if vertical else "original",
                "encoder": encoder or s.video_encoder,
                "hook_overlay": hook_overlay,
                "progress_bar": progress_bar,
                "loudnorm": loudnorm,
                "publish": {},
            }
            if clip_record_cover:
                clip_record["cover_image"] = clip_record_cover

            if seo_on:
                logger.info("  -> Generating Title A/B variants & descriptions...")
                clip_record["seo"] = generate_metadata(
                    clip,
                    transcript_text,
                    llm=llm_service,
                    language=s.seo_language,
                    source_url=source if is_url(source) else None,
                    credit_source=s.seo_credit_source,
                )
                clip_record["title_variants"] = clip_record["seo"].get("title_variants", [])
                clip_record["selected_title_variant"] = clip_record["seo"].get("selected_title_variant", "direct")
            _log_elapsed(f"clip {idx} total (cut, reframe, metadata)", clip_started)
            exported_clips.append(clip_record)


        # 8. Export metadata manifest
        write_progress(job_dir, "export", 98, "Writing metadata manifest...", base_out_dir)
        metadata_path = base_out_dir / "metadata.json"
        metadata_manifest = {
            "job_id": job_id,
            "source": str(source),
            "clips_exported": len(exported_clips),
            "tokens_used": tokens_used,
            "source_quality": source_info,
            "clips": exported_clips,
        }
        metadata_path.write_text(json.dumps(metadata_manifest, indent=2), encoding="utf-8")
        logger.info("[pipeline] Exported %d clips to %s", len(exported_clips), base_out_dir)

        write_progress(
            job_dir,
            "done",
            100,
            f"Completed: {len(exported_clips)} vertical clips ready!",
            base_out_dir,
        )
        return metadata_manifest

    except Exception as exc:
        write_progress(job_dir, "error", 0, str(exc), base_out_dir)
        raise


def rerender_clip(
    manifest_path: pathlib.Path,
    rank: int,
    start: float,
    end: float,
    s: Settings = default_settings,
    layout: Optional[str] = None,
    caption_style: Optional[str] = None,
    encoder: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Re-render an edited clip with new start/end timestamps, reusing the cached transcript.
    Updates the clip file and updates the metadata manifest.
    """
    manifest_path = pathlib.Path(manifest_path)
    if not manifest_path.exists():
        raise FileNotFoundError(f"Metadata manifest not found: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    clip = next((c for c in manifest["clips"] if int(c["rank"]) == int(rank)), None)
    if clip is None:
        raise ValueError(f"Clip rank {rank} not found in {manifest_path}")

    job_id = manifest["job_id"]
    source = manifest["source"]
    base_out_dir = manifest_path.parent
    base_work_dir = (
        base_out_dir.parent.parent / "workdir"
        if (base_out_dir.parent.parent / "workdir").exists()
        else pathlib.Path("workdir")
    )
    job_dir = base_work_dir / job_id
    if not job_dir.exists():
        job_dir = base_out_dir

    # Source video file
    if is_url(source):
        video_path = job_dir / "source.mp4"
    else:
        video_path = pathlib.Path(source)
    if not video_path.exists():
        found = list(job_dir.glob("source.*")) + list(job_dir.glob("*.mp4"))
        if found:
            video_path = found[0]
        else:
            raise FileNotFoundError(f"Source video not found for job {job_id}")

    # Load transcript segments
    transcript_file = job_dir / "transcript.json"
    segments: List[Dict[str, Any]] = []
    if transcript_file.exists():
        try:
            tr_data = json.loads(transcript_file.read_text(encoding="utf-8"))
            segments = tr_data.get("segments", [])
        except Exception:
            pass

    # Load cached scene cuts
    scenes_cache = job_dir / "scenes.json"
    scene_cuts: List[float] = []
    if scenes_cache.exists():
        try:
            scene_cuts = json.loads(scenes_cache.read_text(encoding="utf-8"))
        except Exception:
            pass

    pad_offset = 0.15
    start_time = float(start)
    end_time = float(end)
    if end_time <= start_time:
        raise ValueError("End time must be greater than start time.")

    # 1. Re-cut raw clip
    raw_clip = job_dir / f"clip_{rank}_raw.mp4"
    cut(video_path, start_time, end_time, raw_clip, pad=pad_offset)

    # 2. Extract words in new timeframe
    padded_start = max(0.0, start_time - pad_offset)
    padded_end = end_time + pad_offset
    effective_clip_start = padded_start
    clip_duration = round(end_time - start_time, 2)
    is_trimmed = False

    clip_words: List[Dict[str, Any]] = []
    for seg in segments:
        for w in seg.get("words", []):
            w_s = float(w["start"])
            if padded_start <= w_s <= padded_end:
                clip_words.append(w)

    final_clip_path = pathlib.Path(clip["file"])

    # Determine caption presence without forcing defaults on clips that had none
    has_captions = (caption_style is not None) if caption_style is not None else clip.get("captions", clip.get("caption_style") is not None)
    style_key = (caption_style or clip.get("caption_style") or s.caption_style) if has_captions else None
    style = get_style(style_key, s.caption_position or None) if style_key else None
    current_layout = layout or clip.get("layout") or s.layout

    hook_overlay = clip.get("hook_overlay", True)
    progress_bar = clip.get("progress_bar", False)
    loudnorm = clip.get("loudnorm", True)
    trim_silence = clip.get("trim_silence", False)

    # Re-apply silence trimming if the clip was originally trimmed
    if trim_silence and clip_words:
        keep_intervals = detect_keep_intervals(clip_words, clip_start=padded_start, clip_end=padded_end)
        if len(keep_intervals) > 1 or (keep_intervals and keep_intervals[0][1] < (padded_end - padded_start) - 0.3):
            trimmed_raw = job_dir / f"clip_{rank}_trimmed.mp4"
            try:
                apply_silence_trimming(raw_clip, keep_intervals, trimmed_raw)
                clip_words = remap_words_after_trim(clip_words, keep_intervals, clip_start=padded_start)
                raw_clip = trimmed_raw
                is_trimmed = True
                effective_clip_start = 0.0
                clip_duration = round(sum(e - s for s, e in keep_intervals), 2)
            except Exception as exc:
                logger.warning("[pipeline] Silence trimming failed on rerender: %s", exc)

    ass_file: Optional[pathlib.Path] = None
    if clip_words and has_captions and style is not None:
        ass_file = job_dir / f"clip_{rank}.ass"
        ass_file.write_text(
            build_ass(
                clip_words,
                clip_start=effective_clip_start,
                style=style,
                play_w=s.out_width,
                play_h=s.out_height,
                hook=clip.get("hook") if hook_overlay else None,
                hook_duration=2.5,
                enable_keywords=True,
                enable_emojis=False,
            ),
            encoding="utf-8",
        )

    chosen_enc = encoder or clip.get("encoder") or s.video_encoder

    # Extract clean cover frame from raw_clip BEFORE subtitle burning
    cover_file = base_out_dir / f"{int(rank):02d}_{slugify(clip.get('title', 'clip'))}_cover.jpg"
    try:
        pick_cover_frame(raw_clip, cover_file)
        clip["cover_image"] = str(cover_file.resolve())
    except Exception:
        pass

    if current_layout != "original":
        rel_cuts = [c - padded_start for c in scene_cuts if start_time <= c <= end_time]
        render_vertical(
            raw_clip,
            final_clip_path,
            out_w=s.out_width,
            out_h=s.out_height,
            scene_cuts=rel_cuts,
            ass_path=ass_file,
            fonts_dir=FONTS_DIR,
            layout=current_layout,
            crf=s.video_crf,
            preset=s.video_preset,
            encoder=chosen_enc,
            fallback_to_cpu=s.enable_encoder_fallback,
            s=s,
            loudnorm=loudnorm,
            progress_bar=progress_bar,
            duration=clip_duration,
        )
    elif ass_file is not None:
        burn_captions(raw_clip, ass_file, final_clip_path)
    else:
        shutil.copy(raw_clip, final_clip_path)

    # 3. Update metadata
    clip["start"] = start_time
    clip["end"] = end_time
    clip["duration"] = clip_duration
    clip["captions"] = has_captions
    clip["caption_style"] = style_key
    clip["trim_silence"] = is_trimmed
    clip["layout"] = current_layout
    clip["encoder"] = chosen_enc

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return clip
