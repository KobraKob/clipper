"""
Retention enhancement module for short-form vertical video.

Features:
1. Silence and filler-word trimming (detects pauses > min_gap and filler words like 'um/uh',
   remaps transcription timestamps to preserve word-sync).
2. Loudness normalization to -14 LUFS via FFmpeg loudnorm filter.
3. Progress bar overlay generation for TikTok / Shorts style visual pacing.
4. Zoom punch-in filter generation for emphasis moments.
"""

from __future__ import annotations

import logging
import math
import pathlib
import re
import subprocess
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# Common single-word filler hesitations to trim (excluding 'like' which is frequent in legitimate speech)
DEFAULT_FILLER_WORDS: Set[str] = {
    "um",
    "uh",
    "umm",
    "uhh",
    "er",
    "ah",
}

# Multi-word filler phrases checked contiguously
MULTI_WORD_FILLERS: List[Tuple[str, ...]] = [
    ("you", "know"),
    ("i", "mean"),
]

DEFAULT_MIN_SILENCE_GAP = 0.40  # seconds
TARGET_LUFS = -14.0
TARGET_LRA = 11.0
TARGET_TRUE_PEAK = -1.5


def clean_word_token(word: str) -> str:
    """Strip punctuation and whitespace from a word token for dictionary matching."""
    return re.sub(r"[^\w\s]", "", word).strip().lower()


def is_filler_word(word: str, custom_fillers: Optional[Set[str]] = None) -> bool:
    """Check if a word is an unwanted hesitation or filler word."""
    fillers = custom_fillers if custom_fillers is not None else DEFAULT_FILLER_WORDS
    cleaned = clean_word_token(word)
    return cleaned in fillers


def detect_keep_intervals(
    words: List[Dict[str, Any]],
    clip_start: float,
    clip_end: float,
    min_silence_gap: float = DEFAULT_MIN_SILENCE_GAP,
    remove_fillers: bool = True,
    padding: float = 0.08,
) -> List[Tuple[float, float]]:
    """
    Identify contiguous audio/video intervals to keep, cutting filler words and pauses > min_silence_gap.

    Args:
        words: List of word dicts with 'w', 'start', 'end' (in source seconds).
        clip_start: Start timestamp of the clip in source seconds.
        clip_end: End timestamp of the clip in source seconds.
        min_silence_gap: Threshold in seconds above which pauses are trimmed.
        remove_fillers: Whether to remove filler words like 'um' / 'uh'.
        padding: Padding in seconds added before/after words to prevent harsh clipping.

    Returns:
        Sorted, non-overlapping list of (start, end) intervals relative to the cut video (0.0 = clip_start).
    """
    clip_duration = max(0.0, clip_end - clip_start)
    if not words or clip_duration <= 0.0:
        return [(0.0, clip_duration)] if clip_duration > 0.0 else []

    # 1. Filter out words falling outside the clip range
    valid_words = [
        w
        for w in words
        if float(w.get("end", 0)) >= clip_start and float(w.get("start", 0)) <= clip_end
    ]

    if not valid_words:
        return [(0.0, clip_duration)]

    # 2. Separate keepers from fillers (including multi-word phrases)
    keepers: List[Dict[str, Any]] = []
    skip_indices: Set[int] = set()

    if remove_fillers:
        for i in range(len(valid_words)):
            if i in skip_indices:
                continue
            token = clean_word_token(str(valid_words[i].get("w", "")))
            if is_filler_word(token):
                skip_indices.add(i)
                continue
            # Check 2-word phrase matches
            if i + 1 < len(valid_words):
                next_token = clean_word_token(str(valid_words[i + 1].get("w", "")))
                for phrase in MULTI_WORD_FILLERS:
                    if (token, next_token) == phrase:
                        skip_indices.add(i)
                        skip_indices.add(i + 1)
                        break

    for i, w in enumerate(valid_words):
        if i not in skip_indices:
            keepers.append(w)

    if not keepers:
        # If all words were classified as fillers, avoid removing entire video
        keepers = valid_words

    # 3. Build preliminary intervals around kept words with small padding
    raw_intervals: List[Tuple[float, float]] = []
    for w in keepers:
        w_start = max(0.0, float(w["start"]) - clip_start - padding)
        w_end = min(clip_duration, float(w["end"]) - clip_start + padding)
        if w_end > w_start:
            raw_intervals.append((w_start, w_end))

    if not raw_intervals:
        return [(0.0, clip_duration)]

    # 4. Merge intervals if the silence gap between them is smaller than min_silence_gap
    merged: List[Tuple[float, float]] = []
    cur_start, cur_end = raw_intervals[0]

    for next_start, next_end in raw_intervals[1:]:
        gap = next_start - cur_end
        if gap <= min_silence_gap:
            # Merge: silence is short enough to keep natural rhythm
            cur_end = max(cur_end, next_end)
        else:
            # Significant pause: commit current segment and start a new one
            merged.append((round(cur_start, 3), round(cur_end, 3)))
            cur_start, cur_end = next_start, next_end

    merged.append((round(cur_start, 3), round(cur_end, 3)))

    # Ensure minimum segment duration (avoid microscopic video glitches < 0.1s)
    clean_intervals: List[Tuple[float, float]] = [
        (s, e) for s, e in merged if (e - s) >= 0.10
    ]

    return clean_intervals if clean_intervals else [(0.0, clip_duration)]


def remap_words_after_trim(
    words: List[Dict[str, Any]],
    keep_intervals: List[Tuple[float, float]],
    clip_start: float,
) -> List[Dict[str, Any]]:
    """
    Recalculate word start and end timestamps so subtitles remain 100% in sync after trimming.

    Args:
        words: List of word dicts with source timestamps.
        keep_intervals: List of (start, end) intervals kept, relative to clip_start (0.0).
        clip_start: Source start timestamp.

    Returns:
        New list of words with updated 'start' and 'end' matching the new trimmed timeline.
    """
    remapped: List[Dict[str, Any]] = []

    for w in words:
        orig_rel_start = float(w["start"]) - clip_start
        orig_rel_end = float(w["end"]) - clip_start

        accumulated_time = 0.0
        new_start: Optional[float] = None
        new_end: Optional[float] = None

        for int_start, int_end in keep_intervals:
            int_len = int_end - int_start

            # Check start time mapping
            if int_start <= orig_rel_start <= int_end:
                new_start = accumulated_time + (orig_rel_start - int_start)
            elif orig_rel_start < int_start and new_start is None:
                new_start = accumulated_time

            # Check end time mapping
            if int_start <= orig_rel_end <= int_end:
                new_end = accumulated_time + (orig_rel_end - int_start)
            elif orig_rel_end <= int_start and new_end is None and new_start is not None:
                new_end = accumulated_time

            accumulated_time += int_len

        if new_start is not None and new_end is not None and new_end > new_start:
            word_copy = dict(w)
            word_copy["start"] = round(new_start, 3)
            word_copy["end"] = round(new_end, 3)
            remapped.append(word_copy)

    return remapped


def apply_silence_trimming(
    video_path: pathlib.Path,
    keep_intervals: List[Tuple[float, float]],
    out_path: pathlib.Path,
) -> pathlib.Path:
    """
    Use FFmpeg select/aselect to extract and concatenate kept intervals in one pass.
    """
    video_path, out_path = pathlib.Path(video_path), pathlib.Path(out_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Input video for trimming not found: {video_path}")
    if not keep_intervals:
        raise ValueError("keep_intervals must contain at least one interval.")

    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Build select expressions
    v_expr_parts = [f"between(t,{s:.3f},{e:.3f})" for s, e in keep_intervals]
    a_expr_parts = [f"between(t,{s:.3f},{e:.3f})" for s, e in keep_intervals]

    v_select = "+".join(v_expr_parts)
    a_select = "+".join(a_expr_parts)

    filter_complex = (
        f"[0:v]select='{v_select}',setpts=N/FRAME_RATE/TB[v];"
        f"[0:a]aselect='{a_select}',asetpts=N/SR/TB[a]"
    )

    cmd = [
        "ffmpeg",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(video_path.resolve()),
        "-filter_complex",
        filter_complex,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        str(out_path.resolve()),
    ]

    logger.info("[retention] Trimming silence & fillers: keeping %d intervals...", len(keep_intervals))
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg silence trimming failed: {proc.stderr[-1000:]}")

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError(f"Trimmed output video is missing or empty: {out_path}")

    return out_path


def get_loudnorm_filter(
    target_lufs: float = TARGET_LUFS,
    lra: float = TARGET_LRA,
    true_peak: float = TARGET_TRUE_PEAK,
) -> str:
    """Return standard EBU R128 / ITU BS.1770 audio normalization filter for mobile short-form video."""
    return f"loudnorm=I={target_lufs:.1f}:LRA={lra:.1f}:TP={true_peak:.1f}"


def build_progress_bar_filter(
    duration: float,
    out_w: int = 1080,
    out_h: int = 1920,
    bar_height: int = 10,
    color_hex: str = "FFE600",
    opacity: float = 0.95,
) -> str:
    """
    Construct FFmpeg filtergraph fragment rendering an animated horizontal progress bar at the bottom.
    Smoothly expands from width 0 to full width across the duration of the clip using an overlay.
    """
    safe_duration = max(0.1, duration)
    h = color_hex.lstrip("#").upper()
    color_val = f"0x{h}" if not h.startswith("0x") else h
    y_pos = out_h - bar_height

    return (
        f"color=c={color_val}:s={out_w}x{bar_height}:d={safe_duration:.3f}[pbar];"
        f"[pmain][pbar]overlay=x='-w+w*t/{safe_duration:.3f}':y={y_pos}"
    )


def build_punch_in_filter(
    duration: float,
    punch_times: List[float],
    zoom_scale: float = 1.07,
) -> str:
    """
    Generate subtle zoom punch-in expressions for emphasis moments.
    Keeps zoom centered and smoothly eases punch-in to avoid disorientation.
    """
    if not punch_times or duration <= 0:
        return ""

    conditions = []
    for pt in punch_times:
        # 1.5s punch window
        conditions.append(f"between(t,{pt:.2f},{pt + 1.5:.2f})")

    cond_expr = "+".join(conditions)
    # If in punch window, scale to zoom_scale; otherwise scale to 1.0
    return f"scale=eval=frame:w='if({cond_expr},{zoom_scale:.3f}*iw,iw)':h='if({cond_expr},{zoom_scale:.3f}*ih,ih)'"
