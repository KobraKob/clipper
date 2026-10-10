"""
Video cutting module using FFmpeg with frame-accurate re-encoding.
"""

from __future__ import annotations

import pathlib
import subprocess


def cut(
    src: pathlib.Path,
    start: float,
    end: float,
    out: pathlib.Path,
    pad: float = 0.15,
) -> pathlib.Path:
    """
    Cut an exact time segment from a video using FFmpeg re-encoding.
    Pads start and end by `pad` seconds to avoid cutting off initial consonants or final vowels.
    """
    if not src.exists():
        raise FileNotFoundError(f"Source video file not found: {src}")

    out.parent.mkdir(parents=True, exist_ok=True)

    actual_start = max(0.0, start - pad)
    actual_end = end + pad

    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{actual_start:.3f}",
        "-to",
        f"{actual_end:.3f}",
        "-i",
        str(src),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        str(out),
    ]

    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"FFmpeg cut failed for [{start:.2f}s -> {end:.2f}s]: {exc.stderr}") from exc

    if not out.exists() or out.stat().st_size == 0:
        raise RuntimeError(f"Output cut clip was not created or is empty: {out}")

    return out
