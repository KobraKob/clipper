"""
Vertical 9:16 reframing with face detection, smoothed tracking, and NVIDIA GPU NVENC acceleration.

Pipeline
--------
1. ``track_face_x``   - sample frames with OpenCV (YuNet face detector) to get the speaker's x position.
   Supports multi-face scenes (podcasts/interviews) with hysteresis and two-person wide framing.
2. ``smooth_trajectory`` - exponential smoothing + dead-zone so the virtual camera never jitters,
   snapping instantly at scene cuts.
3. ``render_vertical`` - FFmpeg reframes and encodes:
   - GPU Mode (NVENC): NVIDIA NVENC hardware-accelerated H.264 encoding (`h264_nvenc -preset p4 -cq 20`).
     When subtitles are omitted, uses CUDA scaling (`scale_cuda`) directly on GPU hardware surfaces.
   - CPU Mode: Software fallback using `libx264 -preset fast -crf 18`.
   - Automatic Fallback: If GPU encoding fails, automatically falls back to CPU encoding without crashing.

Geometry guarantees
-------------------
* The crop window always has the *output* aspect ratio (9:16), whatever the source aspect is, so the
  picture is never stretched. Sources that are wider than 9:16 are cropped horizontally at full
  height; sources narrower than 9:16 are cropped vertically at full width.
* The result fills the whole vertical screen (no letterbox bars) unless ``layout="fit_blur"`` is chosen.
"""

from __future__ import annotations

import logging
import pathlib
import shutil
import subprocess
import urllib.request
from typing import Any, Dict, List, Optional, Set, Tuple

import cv2
import numpy as np

from .config import Settings, settings as default_settings
from .ingest import probe_video

# Suppress noisy OpenCV internal graph engine warnings
try:
    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
except Exception:
    pass

logger = logging.getLogger(__name__)

YUNET_MODEL_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/"
    "face_detection_yunet/face_detection_yunet_2023mar.onnx?download="
)

DETECT_MAX_WIDTH = 960  # faces are found on a downscaled copy; plenty for speaker tracking

# Cache for hardware encoder availability probes
_ENCODER_AVAILABILITY_CACHE: Dict[str, bool] = {}


# --------------------------------------------------------------------------------------
# Hardware Encoder Probing & Resolution
# --------------------------------------------------------------------------------------


def is_encoder_available(encoder: str) -> bool:
    """Test if a video encoder is installed, supported by hardware, and successfully initializable."""
    if encoder in _ENCODER_AVAILABILITY_CACHE:
        return _ENCODER_AVAILABILITY_CACHE[encoder]

    if encoder == "libx264":
        _ENCODER_AVAILABILITY_CACHE[encoder] = True
        return True

    try:
        proc = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=duration=1:size=64x64:rate=1",
                "-c:v",
                encoder,
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            timeout=5,
        )
        available = proc.returncode == 0
    except Exception as exc:
        logger.debug("[reframe] Encoder probe for %s failed: %s", encoder, exc)
        available = False

    _ENCODER_AVAILABILITY_CACHE[encoder] = available
    return available


def clear_encoder_cache() -> None:
    """Clear internal cached encoder availability test results."""
    _ENCODER_AVAILABILITY_CACHE.clear()


def is_nvenc_available() -> bool:
    """Check if NVIDIA NVENC H.264 hardware acceleration is usable."""
    return is_encoder_available("h264_nvenc")


def is_qsv_available() -> bool:
    """Check if Intel QuickSync H.264 hardware acceleration is usable."""
    return is_encoder_available("h264_qsv")


def detect_available_encoders() -> Dict[str, bool]:
    """Return dictionary of supported video encoders on this machine."""
    return {
        "h264_nvenc": is_nvenc_available(),
        "h264_qsv": is_qsv_available(),
        "libx264": True,
    }


def resolve_encoder(requested: str = "auto", fallback: bool = True) -> str:
    """
    Resolve requested encoder string to an available encoder.
    If 'auto' or unavailable and fallback=True, falls back gracefully.
    """
    req = (requested or "auto").lower()

    if req == "auto":
        if is_nvenc_available():
            logger.info("[reframe] Auto-detected NVIDIA GPU NVENC; using h264_nvenc.")
            return "h264_nvenc"
        if is_qsv_available():
            logger.info("[reframe] Auto-detected Intel QSV; using h264_qsv.")
            return "h264_qsv"
        logger.info("[reframe] No hardware GPU encoder available; using CPU libx264.")
        return "libx264"

    if req == "h264_nvenc":
        if is_nvenc_available():
            return "h264_nvenc"
        if fallback:
            logger.warning("[reframe] h264_nvenc requested but not available. Falling back to CPU libx264.")
            return "libx264"
        raise ValueError("Requested encoder 'h264_nvenc' is not available and fallback is disabled.")

    if req == "h264_qsv":
        if is_qsv_available():
            return "h264_qsv"
        if fallback:
            logger.warning("[reframe] h264_qsv requested but not available. Falling back to CPU libx264.")
            return "libx264"
        raise ValueError("Requested encoder 'h264_qsv' is not available and fallback is disabled.")

    return "libx264"


def build_encoder_args(
    encoder: str,
    s: Settings = default_settings,
    preset: Optional[str] = None,
    quality: Optional[int] = None,
) -> List[str]:
    """Build FFmpeg command line options for the given encoder and quality profile."""
    enc = encoder.lower()

    if enc == "h264_nvenc":
        enc_preset = preset or s.nvenc_preset
        enc_cq = quality if quality is not None else s.nvenc_cq
        return [
            "-c:v",
            "h264_nvenc",
            "-preset",
            enc_preset,
            "-cq",
            str(enc_cq),
            "-profile:v",
            "high",
            "-pix_fmt",
            "yuv420p",
        ]

    if enc == "h264_qsv":
        return [
            "-c:v",
            "h264_qsv",
            "-preset",
            preset or "medium",
            "-global_quality",
            str(quality if quality is not None else 20),
            "-profile:v",
            "high",
            "-pix_fmt",
            "nv12",
        ]

    # CPU libx264
    enc_preset = preset or s.cpu_preset
    enc_crf = quality if quality is not None else s.cpu_crf
    return [
        "-c:v",
        "libx264",
        "-preset",
        enc_preset,
        "-crf",
        str(enc_crf),
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
    ]


# --------------------------------------------------------------------------------------
# Face Detection Model Helpers
# --------------------------------------------------------------------------------------


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


# --------------------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------------------


def _even(v: float) -> int:
    n = int(round(v))
    return max(2, n - (n % 2))


def compute_crop_geometry(src_w: int, src_h: int, out_w: int = 1080, out_h: int = 1920) -> Tuple[int, int]:
    """
    Largest crop window with the OUTPUT aspect ratio that fits inside the source frame.

    Returns (crop_w, crop_h), both even. Never stretches: wider-than-target sources are cropped
    horizontally at full height, narrower ones vertically at full width.
    """
    target = out_w / float(out_h)
    if src_w / float(src_h) >= target:
        crop_h = src_h
        crop_w = _even(src_h * target)
    else:
        crop_w = src_w
        crop_h = _even(src_w / target)
    return min(_even(crop_w), src_w - (src_w % 2)), min(_even(crop_h), src_h - (src_h % 2))


def track_face_x(
    video_path: pathlib.Path,
    sample_every: Optional[int] = None,
) -> Tuple[np.ndarray, int, int, float]:
    """
    Extract horizontal center positions (in source pixels) of the primary subject for every frame.

    Only every ``sample_every``-th frame is analysed (default: about 6 samples per second); the
    others are skipped with ``grab()`` which avoids the colour conversion. Detection runs on a
    copy downscaled to ``DETECT_MAX_WIDTH`` and is mapped back to source coordinates.

    Multi-person support:
    - If two speakers fit within the 9:16 crop width, centers between both speakers for a two-shot.
    - If speakers are spaced wider than the 9:16 crop, uses hysteresis (dwell threshold) to lock onto
      the current speaker and prevent rapid whip/jitter between hosts.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open video file for reframing: {video_path}")

    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if sample_every is None:
        sample_every = max(2, int(round(fps / 6.0)))

    crop_w, _ = compute_crop_geometry(W, H)

    scale = min(1.0, DETECT_MAX_WIDTH / float(W)) if W else 1.0
    dw, dh = max(2, int(round(W * scale))), max(2, int(round(H * scale)))

    detector_info = _init_detector(dw, dh)
    detector_type, detector = detector_info if detector_info else (None, None)

    xs: List[float] = []
    last_x = W / 2.0
    frame_idx = 0

    # Multi-face hysteresis state
    switch_candidate_x: Optional[float] = None
    switch_count = 0
    SWITCH_CONFIRM_SAMPLES = 5  # ~0.8s of consistent focus needed to switch across frame

    while True:
        if not cap.grab():
            break

        if frame_idx % sample_every == 0 and detector is not None:
            ok, frame = cap.retrieve()
            if ok and frame is not None:
                small = cv2.resize(frame, (dw, dh), interpolation=cv2.INTER_AREA) if scale < 1.0 else frame
                detected_faces: List[Dict[str, float]] = []

                if detector_type == "yunet":
                    detector.setInputSize((dw, dh))
                    _, faces = detector.detect(small)
                    if faces is not None and len(faces) > 0:
                        for face in faces:
                            fx, fy, fw, fh = face[0:4]
                            area = float(fw * fh)
                            left = float(fx) / scale
                            right = float(fx + fw) / scale
                            center_x = float(fx + fw / 2.0) / scale
                            detected_faces.append({
                                "left": left,
                                "right": right,
                                "center_x": center_x,
                                "area": area,
                            })

                elif detector_type == "mediapipe":
                    rgb_frame = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
                    res = detector.process(rgb_frame)
                    if res and res.detections:
                        for det in res.detections:
                            bb = det.location_data.relative_bounding_box
                            area = float(bb.width * bb.height)
                            left = float(bb.xmin * W)
                            right = float((bb.xmin + bb.width) * W)
                            center_x = float((bb.xmin + bb.width / 2.0) * W)
                            detected_faces.append({
                                "left": left,
                                "right": right,
                                "center_x": center_x,
                                "area": area,
                            })

                if detected_faces:
                    detected_faces.sort(key=lambda f: f["area"], reverse=True)
                    max_area = detected_faces[0]["area"]
                    prominent = [f for f in detected_faces if f["area"] >= 0.25 * max_area]

                    if len(prominent) >= 2:
                        face_a, face_b = prominent[0], prominent[1]
                        leftmost = min(face_a["left"], face_b["left"])
                        rightmost = max(face_a["right"], face_b["right"])
                        span = rightmost - leftmost

                        if span <= float(crop_w) * 0.88:
                            last_x = float(leftmost + rightmost) / 2.0
                            switch_candidate_x = None
                            switch_count = 0
                        else:
                            closest = min(prominent, key=lambda f: abs(f["center_x"] - last_x))
                            if abs(closest["center_x"] - last_x) < 0.20 * W:
                                last_x = closest["center_x"]
                                switch_candidate_x = None
                                switch_count = 0
                            else:
                                cand = prominent[0]["center_x"]
                                if switch_candidate_x is not None and abs(cand - switch_candidate_x) < 0.15 * W:
                                    switch_count += 1
                                    if switch_count >= SWITCH_CONFIRM_SAMPLES:
                                        last_x = cand
                                        switch_candidate_x = None
                                        switch_count = 0
                                else:
                                    switch_candidate_x = cand
                                    switch_count = 1
                    else:
                        cand = prominent[0]["center_x"]
                        if abs(cand - last_x) < 0.25 * W:
                            last_x = cand
                            switch_candidate_x = None
                            switch_count = 0
                        else:
                            if switch_candidate_x is not None and abs(cand - switch_candidate_x) < 0.15 * W:
                                switch_count += 1
                                if switch_count >= SWITCH_CONFIRM_SAMPLES:
                                    last_x = cand
                                    switch_candidate_x = None
                                    switch_count = 0
                            else:
                                switch_candidate_x = cand
                                switch_count = 1

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


def crop_left_positions(centers_x: np.ndarray, src_w: int, crop_w: int) -> np.ndarray:
    """Convert subject centres to crop-window left edges, clamped inside the frame."""
    left = np.asarray(centers_x, dtype=np.float64) - crop_w / 2.0
    return np.clip(left, 0.0, max(0.0, float(src_w - crop_w)))


def simplify_polyline(values: np.ndarray, tolerance: float = 1.5, max_points: int = 320) -> List[Tuple[int, float]]:
    """
    Reduce a per-frame trajectory to a short list of (frame, value) keyframes (Ramer-Douglas-Peucker).
    Scene-cut jumps are preserved because they deviate far more than ``tolerance``.
    """
    n = len(values)
    if n == 0:
        return []
    if n == 1:
        return [(0, float(values[0]))]
    vals = np.asarray(values, dtype=np.float64)
    tol = float(tolerance)
    for _ in range(12):
        keep = np.zeros(n, dtype=bool)
        keep[0] = keep[-1] = True
        stack = [(0, n - 1)]
        while stack:
            a, b = stack.pop()
            if b <= a + 1:
                continue
            idx = np.arange(a + 1, b)
            line = vals[a] + (vals[b] - vals[a]) * (idx - a) / float(b - a)
            dev = np.abs(vals[idx] - line)
            k = int(dev.argmax())
            if dev[k] > tol:
                m = int(idx[k])
                keep[m] = True
                stack.append((a, m))
                stack.append((m, b))
        pts = [(int(i), float(vals[i])) for i in np.nonzero(keep)[0]]
        if len(pts) <= max_points:
            return pts
        tol *= 1.6
    return pts


def build_x_expression(points: List[Tuple[int, float]]) -> str:
    """
    Turn keyframes into an FFmpeg expression of the frame counter ``n``:
    ``x0 + clip((n-i0)/d0,0,1)*dx0 + clip((n-i1)/d1,0,1)*dx1 + ...`` (piecewise-linear interpolation).
    """
    if not points:
        return "0"
    expr = f"{points[0][1]:.1f}"
    for (i0, x0), (i1, x1) in zip(points, points[1:]):
        delta = x1 - x0
        if abs(delta) < 0.05:
            continue
        span = max(1, i1 - i0)
        expr += f"+clip((n-{i0})/{span},0,1)*({delta:.2f})"
    return expr


# --------------------------------------------------------------------------------------
# FFmpeg filter assembly
# --------------------------------------------------------------------------------------


def _ass_filter(ass_path: pathlib.Path, fonts_dir: Optional[pathlib.Path]) -> Tuple[str, pathlib.Path]:
    """
    Build the ``ass=`` filter using *relative* names and return the working directory FFmpeg must
    run in. This sidesteps every Windows drive-letter / backslash / apostrophe escaping problem.
    """
    cwd = ass_path.resolve().parent
    parts = [f"filename={ass_path.name}"]
    if fonts_dir is not None and fonts_dir.exists():
        local = cwd / "_fonts"
        try:
            if not local.exists():
                shutil.copytree(fonts_dir, local)
            parts.append("fontsdir=_fonts")
        except OSError as exc:
            logger.warning("[reframe] Could not stage caption fonts: %s", exc)
    return "ass=" + ":".join(parts), cwd


def build_fill_filter(
    crop_w: int,
    crop_h: int,
    crop_y: int,
    x_expr: str,
    out_w: int,
    out_h: int,
    ass_filter: Optional[str] = None,
    use_cuda_scale: bool = False,
    progress_filter: Optional[str] = None,
) -> str:
    """
    Build vertical fill filter graph.
    If use_cuda_scale is True and no subtitle filter is present, performs GPU-accelerated scaling
    directly on CUDA hardware surfaces, avoiding redundant GPU-CPU-GPU PCIe roundtrips.
    """
    if use_cuda_scale and ass_filter is None and progress_filter is None:
        return (
            f"crop=w={crop_w}:h={crop_h}:x='{x_expr}':y={crop_y},"
            f"setsar=1,format=nv12,hwupload,scale_cuda={out_w}:{out_h}:interp_algo=lanczos"
        )

    chain = [
        f"crop=w={crop_w}:h={crop_h}:x='{x_expr}':y={crop_y}",
        f"scale={out_w}:{out_h}:flags=lanczos",
        "setsar=1",
    ]
    if ass_filter:
        chain.append(ass_filter)
    if progress_filter:
        base_chain = ",".join(chain)
        return f"{base_chain}[pmain];{progress_filter},format=yuv420p"
    chain.append("format=yuv420p")
    return ",".join(chain)


def build_fit_blur_graph(
    out_w: int,
    out_h: int,
    ass_filter: Optional[str] = None,
    progress_filter: Optional[str] = None,
) -> str:
    """Whole 16:9 frame centred over a blurred, zoomed copy of itself (for slides, gameplay, screen-shares)."""
    bw, bh = max(2, out_w // 4), max(2, out_h // 4)
    graph = (
        "[0:v]split=2[bgsrc][fgsrc];"
        f"[bgsrc]scale={bw}:{bh}:force_original_aspect_ratio=increase,crop={bw}:{bh},"
        f"boxblur=luma_radius=8:luma_power=2,scale={out_w}:{out_h},eq=brightness=-0.06[bg];"
        f"[fgsrc]scale={out_w}:-2:flags=lanczos[fg];"
        "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1"
    )
    if ass_filter:
        graph += "," + ass_filter
    if progress_filter:
        graph += f"[pmain];{progress_filter},format=yuv420p[v]"
    else:
        graph += ",format=yuv420p[v]"
    return graph


def detect_two_speaker_positions(video_path: pathlib.Path, src_w: int, src_h: int) -> Tuple[float, float]:
    """Detect horizontal centers of the two primary speakers for two-shot split-screen layout."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return src_w * 0.30, src_w * 0.70

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    sample_indices = np.linspace(0, max(1, total_frames - 1), 12, dtype=int)

    scale = min(1.0, DETECT_MAX_WIDTH / float(src_w)) if src_w else 1.0
    dw, dh = max(2, int(round(src_w * scale))), max(2, int(round(src_h * scale)))
    detector_info = _init_detector(dw, dh)

    left_faces: List[float] = []
    right_faces: List[float] = []
    mid = src_w / 2.0

    for idx in sample_indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok or frame is None or detector_info is None:
            continue
        small = cv2.resize(frame, (dw, dh), interpolation=cv2.INTER_AREA) if scale < 1.0 else frame
        dtype, detector = detector_info
        if dtype == "yunet":
            detector.setInputSize((dw, dh))
            _, faces = detector.detect(small)
            if faces is not None and len(faces) > 0:
                for f in faces:
                    fx, fw = f[0], f[2]
                    cx = (float(fx) + float(fw) / 2.0) / scale
                    if cx < mid:
                        left_faces.append(cx)
                    else:
                        right_faces.append(cx)

    cap.release()
    x1 = float(np.median(left_faces)) if left_faces else src_w * 0.30
    x2 = float(np.median(right_faces)) if right_faces else src_w * 0.70
    return x1, x2


def build_split_screen_graph(
    src_w: int,
    src_h: int,
    out_w: int,
    out_h: int,
    speaker1_x: float,
    speaker2_x: float,
    ass_filter: Optional[str] = None,
    progress_filter: Optional[str] = None,
) -> str:
    """
    Two-speaker vertical split-screen graph:
    Top half (out_w x half_h) frames Speaker 1, Bottom half (out_w x half_h) frames Speaker 2, stacked vertically.
    """
    half_h = out_h // 2
    tile_aspect = out_w / float(half_h)

    if src_w / float(src_h) >= tile_aspect:
        crop_h = src_h
        crop_w = _even(src_h * tile_aspect)
    else:
        crop_w = src_w
        crop_h = _even(src_w / tile_aspect)

    crop_w = min(_even(crop_w), src_w - (src_w % 2))
    crop_h = min(_even(crop_h), src_h - (src_h % 2))

    x1 = max(0, min(src_w - crop_w, int(round(speaker1_x - crop_w / 2.0))))
    x2 = max(0, min(src_w - crop_w, int(round(speaker2_x - crop_w / 2.0))))
    y = max(0, (src_h - crop_h) // 2)

    graph = (
        f"[0:v]split=2[topsrc][botsrc];"
        f"[topsrc]crop=w={crop_w}:h={crop_h}:x={x1}:y={y},scale={out_w}:{half_h}:flags=lanczos[top];"
        f"[botsrc]crop=w={crop_w}:h={crop_h}:x={x2}:y={y},scale={out_w}:{half_h}:flags=lanczos[bot];"
        f"[top][bot]vstack=inputs=2[v_stacked]"
    )
    tail = "[v_stacked]"
    if ass_filter:
        graph += f";{tail}{ass_filter}[v_sub]"
        tail = "[v_sub]"
    if progress_filter:
        graph += f";{tail}null[pmain];{progress_filter},format=yuv420p[v]"
        return graph
    graph += f";{tail}format=yuv420p[v]"
    return graph


def render_vertical(
    video_path: pathlib.Path,
    out_path: pathlib.Path,
    out_w: int = 1080,
    out_h: int = 1920,
    sample_every: Optional[int] = None,
    scene_cuts: Optional[List[float]] = None,
    ass_path: Optional[pathlib.Path] = None,
    fonts_dir: Optional[pathlib.Path] = None,
    layout: str = "fill",
    crf: Optional[int] = None,
    preset: Optional[str] = None,
    centers_x: Optional[np.ndarray] = None,
    encoder: Optional[str] = None,
    fallback_to_cpu: bool = True,
    s: Optional[Settings] = None,
    loudnorm: bool = True,
    progress_bar: bool = False,
    duration: Optional[float] = None,
) -> pathlib.Path:
    """
    Reframe a clip into ``out_w`` x ``out_h`` (default 1080x1920) in a single FFmpeg pass.

    ``layout="fill"``         face-tracked crop that fills the whole screen (default)
    ``layout="fit_blur"``     whole frame centred on a blurred backdrop (no cropping at all)
    ``layout="split_screen"`` two-speaker top/bottom split-screen framing for podcasts/interviews
    ``ass_path``              burn these captions in the same encode (avoids a second lossy generation)
    ``loudnorm``              apply -14 LUFS loudness normalisation for consistent volume
    ``progress_bar``          render animated bottom progress bar
    """
    video_path = pathlib.Path(video_path)
    out_path = pathlib.Path(out_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")
    if layout not in ("fill", "fit_blur", "split_screen"):
        raise ValueError(f"Unknown layout {layout!r}; use 'fill', 'fit_blur', or 'split_screen'.")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    app_settings = s or default_settings
    chosen_encoder = resolve_encoder(encoder or app_settings.video_encoder, fallback=fallback_to_cpu)

    info = probe_video(video_path)
    W, H, fps = info.width, info.height, info.fps

    ass_filter: Optional[str] = None
    run_cwd: Optional[pathlib.Path] = None
    if ass_path is not None:
        ass_filter, run_cwd = _ass_filter(pathlib.Path(ass_path), pathlib.Path(fonts_dir) if fonts_dir else None)

    # Precalculate face tracking geometry if layout is fill
    crop_w, crop_h = compute_crop_geometry(W, H, out_w, out_h)
    x_expr = "0"
    crop_y = 0

    if layout == "fill":
        if centers_x is None:
            raw_xs, tw, th, tfps = track_face_x(video_path, sample_every=sample_every)
            if (tw, th) != (W, H):
                W, H = tw, th
                crop_w, crop_h = compute_crop_geometry(W, H, out_w, out_h)
            fps = tfps or fps
        else:
            raw_xs = np.asarray(centers_x, dtype=np.float32)

        cut_frames: Set[int] = set()
        if scene_cuts:
            cut_frames = {int(round(t * fps)) for t in scene_cuts if t > 0}

        smoothed = smooth_trajectory(
            raw_xs,
            alpha=0.08,
            dead_zone_fraction=0.03,
            frame_width=W,
            cut_frame_indices=cut_frames,
        )
        lefts = crop_left_positions(smoothed, W, crop_w)
        points = simplify_polyline(lefts)
        x_expr = build_x_expression(points)
        crop_y = max(0, (H - crop_h) // 2)

    spk1_x, spk2_x = (W * 0.30, W * 0.70)
    if layout == "split_screen":
        spk1_x, spk2_x = detect_two_speaker_positions(video_path, W, H)

    clip_dur = duration if duration is not None else (float(info.duration) if getattr(info, "duration", None) else 30.0)
    prog_filter: Optional[str] = None
    if progress_bar and clip_dur > 0:
        from .retention import build_progress_bar_filter
        prog_filter = build_progress_bar_filter(clip_dur, out_w=out_w, out_h=out_h)

    script_path = out_path.with_suffix(".filter.txt")

    def _execute_render(current_enc: str) -> subprocess.CompletedProcess:
        use_cuda_scale = (current_enc == "h264_nvenc" and ass_filter is None and prog_filter is None and layout == "fill")
        cmd: List[str] = ["ffmpeg", "-loglevel", "error", "-y"]

        if use_cuda_scale:
            cmd += ["-init_hw_device", "cuda=gpu:0", "-filter_hw_device", "gpu"]

        cmd += ["-i", str(video_path.resolve())]

        if layout == "fit_blur":
            script_path.write_text(build_fit_blur_graph(out_w, out_h, ass_filter, prog_filter), encoding="utf-8")
            cmd += ["-filter_complex_script", str(script_path.resolve()), "-map", "[v]", "-map", "0:a?"]
        elif layout == "split_screen":
            script_path.write_text(build_split_screen_graph(W, H, out_w, out_h, spk1_x, spk2_x, ass_filter, prog_filter), encoding="utf-8")
            cmd += ["-filter_complex_script", str(script_path.resolve()), "-map", "[v]", "-map", "0:a?"]
        else:
            filter_str = build_fill_filter(
                crop_w, crop_h, crop_y, x_expr, out_w, out_h, ass_filter, use_cuda_scale=use_cuda_scale, progress_filter=prog_filter
            )
            script_path.write_text(filter_str, encoding="utf-8")
            cmd += ["-filter_script:v", str(script_path.resolve()), "-map", "0:v:0", "-map", "0:a?"]

        if loudnorm:
            from .retention import get_loudnorm_filter
            cmd += ["-af", get_loudnorm_filter()]

        enc_args = build_encoder_args(current_enc, app_settings, preset=preset, quality=crf)
        cmd += enc_args
        cmd += [
            "-movflags",
            "+faststart",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(out_path.resolve()),
        ]

        logger.info("[reframe] Encoding vertical clip using %s...", current_enc)
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(run_cwd) if run_cwd else None,
        )

    # 1. Attempt render with chosen encoder
    proc = _execute_render(chosen_encoder)

    # 2. If GPU encoding failed and fallback is enabled, retry with CPU libx264
    if proc.returncode != 0 and chosen_encoder != "libx264" and fallback_to_cpu:
        logger.warning(
            "[reframe] %s hardware render failed: %s. Retrying with CPU libx264...",
            chosen_encoder,
            proc.stderr[-400:],
        )
        proc = _execute_render("libx264")

    try:
        script_path.unlink()
    except OSError:
        pass

    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg vertical render failed: {proc.stderr[-1500:]}")

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError(f"Vertical output file missing or empty: {out_path}")

    return out_path
