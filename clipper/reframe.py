"""
Vertical 9:16 video reframing with face detection and smoothed tracking.
Supports YuNet (OpenCV DNN), MediaPipe, and graceful fallback to center-crop.
"""

from __future__ import annotations

import logging
import os
import pathlib
import subprocess
import urllib.request
from typing import Any, List, Optional, Set, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)

YUNET_MODEL_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx?download="
)


def _ensure_yunet_model() -> Optional[pathlib.Path]:
    """Ensure YuNet ONNX model file is available locally."""
    # Check default internal package directory
    current_dir = pathlib.Path(__file__).resolve().parent
    bundled_path = current_dir / "models" / "face_detection_yunet_2023mar.onnx"
    if bundled_path.exists() and bundled_path.stat().st_size > 10000:
        return bundled_path

    # Check user cache directory
    cache_dir = pathlib.Path.home() / ".cache" / "clipper" / "models"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / "face_detection_yunet_2023mar.onnx"
    if cache_path.exists() and cache_path.stat().st_size > 10000:
        return cache_path

    # Attempt download
    try:
        logger.info("[reframe] Downloading YuNet face detection model...")
        req = urllib.request.Request(YUNET_MODEL_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
            if len(data) > 10000:
                cache_path.write_bytes(data)
                return cache_path
    except Exception as exc:
        logger.warning("[reframe] Could not download YuNet model: %s. Using center crop fallback.", exc)

    return None


def _init_detector(w: int, h: int) -> Optional[Tuple[str, Any]]:
    """Initialize face detector (YuNet or MediaPipe fallback)."""
    # 1. Try OpenCV FaceDetectorYN
    if hasattr(cv2, "FaceDetectorYN"):
        model_path = _ensure_yunet_model()
        if model_path and model_path.exists():
            try:
                detector = cv2.FaceDetectorYN.create(
                    model=str(model_path),
                    config="",
                    input_size=(w, h),
                    score_threshold=0.6,
                    nms_threshold=0.3,
                    top_k=5000,
                )
                return ("yunet", detector)
            except Exception as exc:
                logger.warning("[reframe] Failed to create FaceDetectorYN: %s", exc)

    # 2. Try MediaPipe solutions
    try:
        import mediapipe as mp

        if hasattr(mp, "solutions") and hasattr(mp.solutions, "face_detection"):
            detector = mp.solutions.face_detection.FaceDetection(
                model_selection=1,
                min_detection_confidence=0.5,
            )
            return ("mediapipe", detector)
    except Exception:
        pass

    return None


def track_face_x(
    video_path: pathlib.Path,
    sample_every: int = 5,
) -> Tuple[np.ndarray, int, int, float]:
    """
    Extract horizontal center positions of the primary subject across video frames.
    Samples every `sample_every` frames to optimize throughput.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open video file for reframing: {video_path}")

    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    detector_info = _init_detector(W, H)
    detector_type, detector = detector_info if detector_info else (None, None)

    xs: List[float] = []
    last_x = W / 2.0
    frame_idx = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        if frame_idx % sample_every == 0 and detector is not None:
            best_center_x: Optional[float] = None
            max_area = 0.0

            if detector_type == "yunet":
                detector.setInputSize((W, H))
                _, faces = detector.detect(frame)
                if faces is not None and len(faces) > 0:
                    for face in faces:
                        fx, fy, fw, fh = face[0:4]
                        area = float(fw * fh)
                        if area > max_area:
                            max_area = area
                            best_center_x = float(fx + fw / 2.0)

            elif detector_type == "mediapipe":
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                res = detector.process(rgb_frame)
                if res and res.detections:
                    for det in res.detections:
                        bb = det.location_data.relative_bounding_box
                        area = float(bb.width * bb.height)
                        if area > max_area:
                            max_area = area
                            best_center_x = float((bb.xmin + bb.width / 2.0) * W)

            if best_center_x is not None:
                last_x = best_center_x

        xs.append(last_x)
        frame_idx += 1

    cap.release()

    if not xs:
        xs = [W / 2.0]

    return np.array(xs, dtype=np.float32), W, H, fps


def smooth_trajectory(
    xs: np.ndarray,
    alpha: float = 0.08,
    dead_zone_fraction: float = 0.03,
    frame_width: int = 1920,
    cut_frame_indices: Optional[Set[int]] = None,
) -> np.ndarray:
    """
    Smooth camera movements using exponential moving average with a dead-zone filter.
    Small movements under `dead_zone_fraction` of width are ignored to prevent jitter.
    Snaps instantly without smoothing at scene cuts.
    """
    if len(xs) == 0:
        return xs

    dead_zone_px = frame_width * dead_zone_fraction
    cut_indices = cut_frame_indices or set()
    smoothed: List[float] = []
    cur = float(xs[0])

    for idx, target_x in enumerate(xs):
        if idx in cut_indices:
            cur = float(target_x)
        else:
            diff = float(target_x) - cur
            if abs(diff) > dead_zone_px:
                cur += alpha * (diff - (dead_zone_px if diff > 0 else -dead_zone_px))

        smoothed.append(cur)

    return np.array(smoothed, dtype=np.float32)


def render_vertical(
    video_path: pathlib.Path,
    out_path: pathlib.Path,
    out_w: int = 1080,
    out_h: int = 1920,
    sample_every: int = 5,
    scene_cuts: Optional[List[float]] = None,
) -> pathlib.Path:
    """
    Reframe landscape video into 9:16 vertical video tracking the detected speaker.
    Pipes processed frames directly into FFmpeg while preserving synchronized audio.
    """
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    out_path.parent.mkdir(parents=True, exist_ok=True)

    raw_xs, W, H, fps = track_face_x(video_path, sample_every=sample_every)

    cut_frames: Set[int] = set()
    if scene_cuts:
        cut_frames = {int(round(t * fps)) for t in scene_cuts if t > 0}

    smoothed_xs = smooth_trajectory(
        raw_xs,
        alpha=0.08,
        dead_zone_fraction=0.03,
        frame_width=W,
        cut_frame_indices=cut_frames,
    )

    cap = cv2.VideoCapture(str(video_path))
    crop_w = int(H * 9.0 / 16.0)

    if crop_w > W:
        crop_w = W

    ffmpeg_cmd = [
        "ffmpeg",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgr24",
        "-s",
        f"{out_w}x{out_h}",
        "-r",
        str(fps),
        "-i",
        "-",
        "-i",
        str(video_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a?",
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
        "-shortest",
        str(out_path),
    ]

    err_log_path = out_path.with_suffix(".ffmpeg_err.log")

    with open(err_log_path, "w+b") as err_file:
        proc = subprocess.Popen(
            ffmpeg_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=err_file,
        )

        try:
            frame_idx = 0
            while True:
                ok, frame = cap.read()
                if not ok:
                    break

                x = float(smoothed_xs[min(frame_idx, len(smoothed_xs) - 1)])
                x0 = int(np.clip(round(x - crop_w / 2.0), 0, max(0, W - crop_w)))
                crop = frame[:, x0 : x0 + crop_w]

                resized = cv2.resize(crop, (out_w, out_h), interpolation=cv2.INTER_LINEAR)
                if proc.stdin:
                    proc.stdin.write(resized.tobytes())

                frame_idx += 1

        finally:
            cap.release()
            if proc.stdin:
                try:
                    proc.stdin.close()
                except (BrokenPipeError, OSError):
                    pass
            proc.wait()

        if proc.returncode != 0:
            err_file.seek(0)
            err_output = err_file.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"FFmpeg vertical render failed: {err_output}")

    if err_log_path.exists():
        try:
            err_log_path.unlink()
        except OSError:
            pass

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError(f"Vertical output file missing or empty: {out_path}")

    return out_path
