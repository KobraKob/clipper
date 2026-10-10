"""
Animated subtitle generation and burning using Advanced SubStation Alpha (ASS) format.
Features word-by-word active highlighting with karaoke timing effects.
"""

from __future__ import annotations

import pathlib
import subprocess
from typing import Any, Dict, List

ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,80,80,480,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def format_ass_time(seconds: float) -> str:
    """Format floating point seconds into ASS timestamp standard: H:MM:SS.cc"""
    safe_sec = max(0.0, seconds)
    h = int(safe_sec // 3600)
    m = int((safe_sec % 3600) // 60)
    s = int(safe_sec % 60)
    centiseconds = int(round((safe_sec - int(safe_sec)) * 100))
    if centiseconds >= 100:
        centiseconds = 99
    return f"{h}:{m:02d}:{s:02d}.{centiseconds:02d}"


def escape_ffmpeg_filter_path(path: pathlib.Path) -> str:
    """
    Format Windows or POSIX paths safely for FFmpeg filter arguments.
    Backslashes are converted to forward slashes and drive colons are escaped.
    Example on Windows: C:/path/file.ass -> C\\:/path/file.ass
    """
    normalized = str(path.resolve()).replace("\\", "/")
    # Escape colon for ffmpeg filter parsing
    return normalized.replace(":", r"\:")


def build_ass(
    words: List[Dict[str, Any]],
    clip_start: float,
    group_size: int = 4,
) -> str:
    """
    Generate ASS formatted string with karaoke word-highlighting.
    `words`: list of dicts with {"w": str, "start": float, "end": float} in source video time.
    `clip_start`: absolute start time of the cut clip (including any padding).
    """
    if not words:
        return ASS_HEADER

    events: List[str] = []

    for i in range(0, len(words), group_size):
        chunk = words[i : i + group_size]
        if not chunk:
            continue

        chunk_start = max(0.0, float(chunk[0]["start"]) - clip_start)
        chunk_end = max(chunk_start + 0.1, float(chunk[-1]["end"]) - clip_start)

        # Build karaoke tag string: \k<duration_in_centiseconds>WORD
        karaoke_words: List[str] = []
        for word in chunk:
            w_start = float(word["start"]) - clip_start
            w_end = float(word["end"]) - clip_start
            w_text = str(word["w"]).strip().upper()
            duration_cs = max(1, int(round((w_end - w_start) * 100)))
            karaoke_words.append(f"{{\\k{duration_cs}}}{w_text}")

        line_text = " ".join(karaoke_words)
        event_line = (
            f"Dialogue: 0,{format_ass_time(chunk_start)},{format_ass_time(chunk_end)},"
            f"Default,,0,0,0,,{line_text}\n"
        )
        events.append(event_line)

    return ASS_HEADER + "".join(events)


def burn_captions(
    video_path: pathlib.Path,
    ass_path: pathlib.Path,
    out_path: pathlib.Path,
) -> pathlib.Path:
    """
    Burn ASS subtitles directly into video frames using FFmpeg's `ass` video filter.
    """
    if not video_path.exists():
        raise FileNotFoundError(f"Input video for caption burning not found: {video_path}")
    if not ass_path.exists():
        raise FileNotFoundError(f"Subtitle file not found: {ass_path}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    filter_arg = f"ass='{escape_ffmpeg_filter_path(ass_path)}'"

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-vf",
        filter_arg,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "copy",
        str(out_path),
    ]

    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"FFmpeg caption burn failed: {exc.stderr}") from exc

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError(f"Burned caption video output missing or empty: {out_path}")

    return out_path
