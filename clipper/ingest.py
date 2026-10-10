"""
Ingestion module: URL downloading via yt-dlp and 16 kHz mono audio extraction via FFmpeg.
Includes anti-bot and 403 bypass strategies for YouTube using player client emulation and Node JS runtime.
"""

from __future__ import annotations

import logging
import pathlib
import shutil
import subprocess
import sys
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


def is_url(source: str) -> bool:
    """Check if the source string represents an HTTP/HTTPS URL."""
    try:
        parsed = urlparse(source.strip())
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


def _get_ytdlp_cmd() -> list[str]:
    """Resolve command to execute yt-dlp safely across environments."""
    which_ytdlp = shutil.which("yt-dlp")
    if which_ytdlp:
        return [which_ytdlp]
    # Fallback to python module execution if yt-dlp.exe is not on system PATH
    return [sys.executable, "-m", "yt_dlp"]


def _get_js_runtime_args() -> list[str]:
    """Detect available JavaScript runtime for yt-dlp YouTube decryption."""
    if shutil.which("node"):
        return ["--js-runtimes", "node"]
    if shutil.which("deno"):
        return ["--js-runtimes", "deno"]
    return []


def download(url: str, out_dir: pathlib.Path) -> pathlib.Path:
    """
    Download a video from a supported URL using yt-dlp.
    Handles YouTube SABR/PO-Token 403 bypasses via multi-client fallbacks (tv, android, web).
    Saves the video as source.mp4 in the specified output directory.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "source.mp4"
    tmpl = str(out_dir / "source.%(ext)s")

    base_cmd = _get_ytdlp_cmd() + _get_js_runtime_args()

    # Pass 1: Primary extraction with TV + Android client emulation
    pass1_cmd = base_cmd + [
        "--extractor-args",
        "youtube:player_client=tv,android,web",
        "-f",
        "bv*[height<=1080]+ba/b[height<=1080]/b",
        "--merge-output-format",
        "mp4",
        "-o",
        tmpl,
        "--no-playlist",
        url,
    ]

    # Pass 2: Fallback extraction with Android + MWeb client emulation
    pass2_cmd = base_cmd + [
        "--extractor-args",
        "youtube:player_client=android,mweb,web",
        "-f",
        "b[height<=1080]/best",
        "--merge-output-format",
        "mp4",
        "-o",
        tmpl,
        "--no-playlist",
        url,
    ]

    last_error: str = ""
    for attempt, cmd in enumerate([pass1_cmd, pass2_cmd], start=1):
        try:
            logger.info("[ingest] Downloading %s (attempt %d)...", url, attempt)
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            break
        except subprocess.CalledProcessError as exc:
            last_error = exc.stderr or exc.stdout or str(exc)
            logger.warning("[ingest] Download attempt %d failed: %s", attempt, last_error)
            if attempt == 2:
                raise RuntimeError(
                    f"yt-dlp failed to download video from {url}: {last_error}"
                ) from exc
        except FileNotFoundError as exc:
            raise RuntimeError("Neither yt-dlp executable nor python -m yt_dlp could be run.") from exc

    if not out_path.exists():
        candidates = list(out_dir.glob("source.*"))
        if candidates:
            return candidates[0]
        raise FileNotFoundError(f"Expected downloaded video at {out_path}, but file was not found.")

    return out_path


def extract_audio(video: pathlib.Path, wav: pathlib.Path) -> pathlib.Path:
    """
    Extract 16 kHz mono WAV audio from a video using FFmpeg.
    This audio format is optimal for Whisper speech recognition models.
    """
    if not video.exists():
        raise FileNotFoundError(f"Input video does not exist: {video}")

    wav.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        str(wav),
    ]

    try:
        subprocess.run(cmd, capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"FFmpeg audio extraction failed: {exc.stderr}") from exc

    if not wav.exists() or wav.stat().st_size == 0:
        raise RuntimeError(f"Audio extraction created empty or missing output file: {wav}")

    return wav
