"""Lightweight soundtrack analysis, beat-aware section selection, and voice-ducked mixing.

No model or paid API is required. FFmpeg decodes the uploaded track to a small mono
energy envelope; NumPy estimates tempo and chooses a musically strong start point.
"""
from __future__ import annotations

import logging
import os
import pathlib
import subprocess
from typing import Any, Dict, Optional

import numpy as np

logger = logging.getLogger(__name__)

SAMPLE_RATE = 11_025
ENVELOPE_HZ = 10
MAX_ANALYSIS_SECONDS = 600


def _probe_duration(path: pathlib.Path) -> float:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=20,
    )
    try:
        duration = float(result.stdout.strip())
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"Could not read soundtrack duration: {path}") from exc
    if not np.isfinite(duration) or duration <= 0:
        raise RuntimeError(f"Soundtrack has invalid duration: {path}")
    return duration


def _energy_envelope(samples: np.ndarray, samples_per_frame: int) -> np.ndarray:
    """Return a normalized RMS envelope with roughly 10 points per second."""
    if samples.size < samples_per_frame:
        return np.array([], dtype=np.float32)
    usable = samples.size - (samples.size % samples_per_frame)
    frames = samples[:usable].astype(np.float32).reshape(-1, samples_per_frame) / 32768.0
    rms = np.sqrt(np.mean(frames * frames, axis=1))
    peak = float(np.max(rms)) if rms.size else 0.0
    if peak > 1e-8:
        rms = rms / peak
    return rms.astype(np.float32)


def _estimate_bpm(envelope: np.ndarray) -> Optional[float]:
    """Estimate a plausible tempo from periodic increases in short-window energy."""
    if envelope.size < 80 or float(np.std(envelope)) < 1e-4:
        return None

    novelty = np.maximum(np.diff(envelope, prepend=envelope[0]), 0.0)
    novelty = novelty - float(np.mean(novelty))
    if float(np.std(novelty)) < 1e-5:
        novelty = envelope - float(np.mean(envelope))

    # At 10 frames/sec, a 0.3–1.5 second beat interval spans about 40–200 BPM.
    correlation = np.correlate(novelty, novelty, mode="full")[novelty.size - 1 :]
    min_lag = max(3, int(round(ENVELOPE_HZ * 60 / 200)))
    max_lag = min(int(round(ENVELOPE_HZ * 60 / 40)), correlation.size - 1)
    if max_lag < min_lag or correlation[0] <= 0:
        return None

    search = correlation[min_lag : max_lag + 1]
    lag = min_lag + int(np.argmax(search))
    confidence = float(correlation[lag] / max(correlation[0], 1e-9))
    if confidence < 0.04:
        return None

    bpm = 60.0 * ENVELOPE_HZ / lag
    # Fold half/double-time estimates into a common pop-music range.
    while bpm < 65:
        bpm *= 2
    while bpm > 180:
        bpm /= 2
    return round(bpm, 1) if 65 <= bpm <= 180 else None


def analyze_soundtrack(path: pathlib.Path | str) -> Dict[str, Any]:
    """Decode a bounded preview and calculate duration, energy, and estimated tempo."""
    soundtrack = pathlib.Path(path).expanduser().resolve()
    if not soundtrack.is_file():
        raise FileNotFoundError(f"Soundtrack not found: {soundtrack}")

    duration = _probe_duration(soundtrack)
    result = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-i", str(soundtrack),
            "-t", str(min(duration, MAX_ANALYSIS_SECONDS)),
            "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE),
            "-f", "s16le", "pipe:1",
        ],
        check=True,
        capture_output=True,
        timeout=120,
    )
    samples = np.frombuffer(result.stdout, dtype=np.int16)
    samples_per_frame = max(1, int(round(SAMPLE_RATE / ENVELOPE_HZ)))
    energy = _energy_envelope(samples, samples_per_frame)
    if energy.size < 10:
        raise RuntimeError("Could not analyse soundtrack audio. Try a different audio file.")

    return {
        "path": str(soundtrack),
        "duration": duration,
        "analysed_duration": float(energy.size / ENVELOPE_HZ),
        "bpm": _estimate_bpm(energy),
        "energy": energy,
        "frame_seconds": 1.0 / ENVELOPE_HZ,
    }


def select_soundtrack_offset(
    profile: Dict[str, Any],
    clip_duration: float,
    clip_rank: int = 1,
) -> float:
    """Choose a high-energy passage; snap candidate starts to estimated beat boundaries."""
    energy = np.asarray(profile.get("energy", []), dtype=np.float32)
    frame_seconds = float(profile.get("frame_seconds", 1.0 / ENVELOPE_HZ))
    clip_duration = max(1.0, float(clip_duration))
    if energy.size == 0 or clip_duration >= energy.size * frame_seconds:
        return 0.0

    max_offset = max(0.0, energy.size * frame_seconds - clip_duration)
    if max_offset <= 0.5:
        return 0.0

    bpm = profile.get("bpm")
    beat_seconds = 60.0 / float(bpm) if bpm else None
    step = 0.5
    candidates = np.arange(0.0, max_offset + 1e-6, step)
    if beat_seconds:
        candidates = np.unique(np.round(np.round(candidates / beat_seconds) * beat_seconds, 3))
    candidates = candidates[(candidates >= 0) & (candidates <= max_offset)]
    if candidates.size == 0:
        return 0.0

    window_frames = max(1, int(round(clip_duration / frame_seconds)))
    opening_frames = max(1, min(window_frames, int(round(min(3.0, clip_duration) / frame_seconds))))
    preferred = ((max(0, int(clip_rank) - 1) * clip_duration) % max_offset) if max_offset else 0.0
    best_offset = 0.0
    best_score = float("-inf")

    for offset in candidates:
        start = int(round(float(offset) / frame_seconds))
        segment = energy[start : start + window_frames]
        if segment.size == 0:
            continue
        opening = float(np.mean(segment[:opening_frames]))
        average = float(np.mean(segment))
        peak = float(np.percentile(segment, 85))
        dynamics = min(float(np.std(segment)) * 2.0, 1.0)
        variety = max(0.0, 1.0 - abs(float(offset) - preferred) / max(max_offset, 1.0))
        score = 0.34 * opening + 0.34 * average + 0.16 * peak + 0.08 * dynamics + 0.08 * variety
        if score > best_score:
            best_score = score
            best_offset = float(offset)

    return round(best_offset, 3)


def mix_soundtrack(
    video_path: pathlib.Path | str,
    soundtrack_path: pathlib.Path | str,
    profile: Dict[str, Any],
    clip_duration: float,
    volume: float = 0.18,
    clip_rank: int = 1,
) -> Dict[str, Any]:
    """Mix a matched soundtrack under the clip's original audio, ducking music under speech."""
    video = pathlib.Path(video_path).resolve()
    soundtrack = pathlib.Path(soundtrack_path).resolve()
    if not video.is_file():
        raise FileNotFoundError(f"Clip video not found for soundtrack mix: {video}")
    if not soundtrack.is_file():
        raise FileNotFoundError(f"Soundtrack file not found: {soundtrack}")

    duration = max(1.0, float(clip_duration))
    volume = min(0.4, max(0.05, float(volume)))
    offset = select_soundtrack_offset(profile, duration, clip_rank)
    fade_duration = min(1.0, duration)
    fade_start = max(0.0, duration - fade_duration)
    temp = video.with_name(f"{video.stem}.soundtrack-tmp{video.suffix}")
    temp.unlink(missing_ok=True)

    filter_graph = (
        f"[1:a]atrim=start={offset:.3f}:duration={duration:.3f},"
        f"asetpts=PTS-STARTPTS,volume={volume:.3f},"
        f"afade=t=out:st={fade_start:.3f}:d={fade_duration:.3f}[music];"
        "[music][0:a]sidechaincompress=threshold=0.035:ratio=8:attack=20:release=320:makeup=1[ducked];"
        "[0:a][ducked]amix=inputs=2:duration=first:dropout_transition=0,"
        "alimiter=limit=0.95[outa]"
    )

    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error", "-i", str(video),
                "-stream_loop", "-1", "-i", str(soundtrack),
                "-filter_complex", filter_graph,
                "-map", "0:v:0", "-map", "[outa]",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                "-t", f"{duration:.3f}", "-movflags", "+faststart", str(temp),
            ],
            check=True,
            capture_output=True,
            timeout=max(180, int(duration * 3)),
        )
        os.replace(temp, video)
    except Exception as exc:
        temp.unlink(missing_ok=True)
        raise RuntimeError(f"Could not mix soundtrack into {video.name}: {exc}") from exc

    return {
        "file": str(soundtrack),
        "name": soundtrack.name,
        "offset_seconds": offset,
        "bpm": profile.get("bpm"),
        "volume": volume,
        "voice_ducking": True,
        "selection": "energy-and-beat-match",
    }
