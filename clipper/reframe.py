"""
Vertical 9:16 reframing with face detection and smoothed tracking.

Pipeline
--------
1. ``track_face_x``   - sample frames with OpenCV (YuNet face detector) to get the speaker's x position.
2. ``smooth_trajectory`` - exponential smoothing + dead-zone so the virtual camera never jitters,
   snapping instantly at scene cuts.
3. ``render_vertical`` - FFmpeg does everything else in ONE pass: a per-frame ``crop`` driven by the
   trajectory, a Lanczos ``scale`` to exactly 1080x1920, optional burned-in ASS captions, and an
   H.264 ``yuv420p`` encode with ``+faststart`` (the format every phone, Instagram and YouTube accept).

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
from typing import Any, List, Optional, Set, Tuple

import cv2
import numpy as np

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
    sample_every: Optional[int] = None,
) -> Tuple[np.ndarray, int, int, float]:
    """
    Extract horizontal center positions (in source pixels) of the primary subject for every frame.

    Only every ``sample_every``-th frame is analysed (default: about 6 samples per second); the
    others are skipped with ``grab()`` which avoids the colour conversion. Detection runs on a
    copy downscaled to ``DETECT_MAX_WIDTH`` and is mapped back to source coordinates.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open video file for reframing: {video_path}")

    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if sample_every is None:
        sample_every = max(2, int(round(fps / 6.0)))

    scale = min(1.0, DETECT_MAX_WIDTH / float(W)) if W else 1.0
    dw, dh = max(2, int(round(W * scale))), max(2, int(round(H * scale)))

    detector_info = _init_detector(dw, dh)
    detector_type, detector = detector_info if detector_info else (None, None)

    xs: List[float] = []
    last_x = W / 2.0
    frame_idx = 0

    while True:
        if not cap.grab():
            break

        if frame_idx % sample_every == 0 and detector is not None:
            ok, frame = cap.retrieve()
            if ok and frame is not None:
                small = cv2.resize(frame, (dw, dh), interpolation=cv2.INTER_AREA) if scale < 1.0 else frame
                best_center_x: Optional[float] = None
                max_area = 0.0

                if detector_type == "yunet":
                    detector.setInputSize((dw, dh))
                    _, faces = detector.detect(small)
                    if faces is not None and len(faces) > 0:
                        for face in faces:
                            fx, fy, fw, fh = face[0:4]
                            area = float(fw * fh)
                            if area > max_area:
                                max_area = area
                                best_center_x = float(fx + fw / 2.0) / scale

                elif detector_type == "mediapipe":
                    rgb_frame = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
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
) -> str:
    chain = [
        f"crop=w={crop_w}:h={crop_h}:x='{x_expr}':y={crop_y}",
        f"scale={out_w}:{out_h}:flags=lanczos",
        "setsar=1",
    ]
    if ass_filter:
        chain.append(ass_filter)
    chain.append("format=yuv420p")
    return ",".join(chain)


def build_fit_blur_graph(out_w: int, out_h: int, ass_filter: Optional[str] = None) -> str:
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
    graph += ",format=yuv420p[v]"
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
    crf: int = 18,
    preset: str = "fast",
    centers_x: Optional[np.ndarray] = None,
) -> pathlib.Path:
    """
    Reframe a clip into ``out_w`` x ``out_h`` (default 1080x1920) in a single FFmpeg pass.

    ``layout="fill"``      face-tracked crop that fills the whole screen (default)
    ``layout="fit_blur"``  whole frame centred on a blurred backdrop (no cropping at all)
    ``ass_path``           burn these captions in the same encode (avoids a second lossy generation)
    ``centers_x``          optional precomputed per-frame subject x (skips face detection)
    """
    video_path = pathlib.Path(video_path)
    out_path = pathlib.Path(out_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")
    if layout not in ("fill", "fit_blur"):
        raise ValueError(f"Unknown layout {layout!r}; use 'fill' or 'fit_blur'.")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    info = probe_video(video_path)
    W, H, fps = info.width, info.height, info.fps

    ass_filter: Optional[str] = None
    run_cwd: Optional[pathlib.Path] = None
    if ass_path is not None:
        ass_filter, run_cwd = _ass_filter(pathlib.Path(ass_path), pathlib.Path(fonts_dir) if fonts_dir else None)

    cmd: List[str] = ["ffmpeg", "-loglevel", "error", "-y", "-i", str(video_path.resolve())]
    script_path = out_path.with_suffix(".filter.txt")

    if layout == "fit_blur":
        script_path.write_text(build_fit_blur_graph(out_w, out_h, ass_filter), encoding="utf-8")
        cmd += ["-filter_complex_script", str(script_path.resolve()), "-map", "[v]", "-map", "0:a?"]
    else:
        crop_w, crop_h = compute_crop_geometry(W, H, out_w, out_h)
        if centers_x is None:
            raw_xs, tw, th, tfps = track_face_x(video_path, sample_every=sample_every)
            if (tw, th) != (W, H):  # trust the decoder's view of the frame
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
        script_path.write_text(
            build_fill_filter(crop_w, crop_h, crop_y, x_expr, out_w, out_h, ass_filter),
            encoding="utf-8",
        )
        cmd += ["-filter_script:v", str(script_path.resolve()), "-map", "0:v:0", "-map", "0:a?"]

    cmd += [
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        str(crf),
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        str(out_path.resolve()),
    ]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(run_cwd) if run_cwd else None,
        )
    finally:
        pass

    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg vertical render failed: {proc.stderr[-1500:]}")

    try:
        script_path.unlink()
    except OSError:
        pass

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError(f"Vertical output file missing or empty: {out_path}")

    return out_path
