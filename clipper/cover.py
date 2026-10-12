"""
Cover / thumbnail frame picker for short-form vertical videos.

Extracts the sharpest, most flattering frame in the opening seconds (typically 0.5s - 4.0s)
before subtitle/text clutter occurs, scoring frames by Laplacian sharpness and face presence.
"""

from __future__ import annotations

import logging
import pathlib
from typing import Optional, Tuple

import cv2
import numpy as np

from .reframe import _init_detector

logger = logging.getLogger(__name__)


def calculate_frame_sharpness(gray_frame: np.ndarray) -> float:
    """Calculate the focus measure of a grayscale image using the variance of the Laplacian."""
    return float(cv2.Laplacian(gray_frame, cv2.CV_64F).var())


def evaluate_face_presence(
    frame_bgr: np.ndarray, detector_info: Optional[Tuple[str, any]]
) -> float:
    """
    Evaluate face prominence in a frame. Returns a multiplier between 1.0 (no face) and 2.5 (great face).
    """
    if detector_info is None:
        return 1.0

    dtype, detector = detector_info
    h, w = frame_bgr.shape[:2]

    try:
        if dtype == "yunet":
            detector.setInputSize((w, h))
            _, faces = detector.detect(frame_bgr)
            if faces is not None and len(faces) > 0:
                best_area = max(float(f[2] * f[3]) for f in faces)
                relative_area = best_area / float(w * h)
                # Boost if face is well-framed (5% to 35% of total frame area)
                if 0.05 <= relative_area <= 0.40:
                    return 2.2
                return 1.6

        elif dtype == "mediapipe":
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            res = detector.process(rgb)
            if res and res.detections:
                return 2.0
    except Exception as exc:
        logger.debug("[cover] Face evaluation error: %s", exc)

    return 1.0


def pick_cover_frame(
    video_path: pathlib.Path,
    out_cover_path: pathlib.Path,
    start_sec: float = 0.5,
    end_sec: float = 4.0,
    sample_count: int = 24,
) -> pathlib.Path:
    """
    Sample candidate frames within [start_sec, end_sec], score them on sharpness and face prominence,
    and save the optimal cover frame to out_cover_path.

    Args:
        video_path: Path to the input video.
        out_cover_path: Destination path for the chosen JPEG cover image.
        start_sec: Timestamp to start sampling from (avoids black opening frames).
        end_sec: Timestamp to stop sampling.
        sample_count: Number of frames to evaluate across the window.

    Returns:
        Path to the saved cover image file.
    """
    video_path = pathlib.Path(video_path)
    out_cover_path = pathlib.Path(out_cover_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    out_cover_path.parent.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video to extract cover frame: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    duration = total_frames / fps if fps > 0 else 0.0

    actual_start = min(start_sec, max(0.0, duration - 0.5))
    actual_end = min(end_sec, duration) if duration > 0 else end_sec
    if actual_end <= actual_start:
        actual_end = actual_start + 1.0

    sample_times = np.linspace(actual_start, actual_end, max(2, sample_count))

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scale = min(1.0, 640.0 / float(w)) if w else 1.0
    dw, dh = max(2, int(round(w * scale))), max(2, int(round(h * scale)))

    detector_info = _init_detector(dw, dh)

    best_score = -1.0
    best_frame: Optional[np.ndarray] = None

    for t in sample_times:
        frame_idx = int(round(t * fps))
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue

        # Convert to grayscale for sharpness analysis
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        sharpness = calculate_frame_sharpness(gray)

        # Downscale for face analysis
        small = cv2.resize(frame, (dw, dh), interpolation=cv2.INTER_AREA) if scale < 1.0 else frame
        face_mult = evaluate_face_presence(small, detector_info)

        # Compute composite score
        score = sharpness * face_mult
        if score > best_score:
            best_score = score
            best_frame = frame

    cap.release()

    if best_frame is None:
        raise RuntimeError(f"Could not read any valid frames from {video_path} for cover extraction.")

    # Save as high-quality JPEG
    success = cv2.imwrite(
        str(out_cover_path.resolve()),
        best_frame,
        [int(cv2.IMWRITE_JPEG_QUALITY), 95],
    )

    if not success or not out_cover_path.exists() or out_cover_path.stat().st_size == 0:
        raise RuntimeError(f"Failed to write cover image to {out_cover_path}")

    logger.info("[cover] Picked optimal cover frame (Score: %.1f) saved to %s", best_score, out_cover_path.name)
    return out_cover_path
