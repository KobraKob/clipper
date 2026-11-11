"""Cover / thumbnail frame picker and 3-option Test & Compare generator.

Generates 3 distinct, YouTube Test & Compare compatible thumbnail concepts per clip:
- Option A: Emotion / Reaction + Result (expressive face/subject + 2-3 word outcome text)
- Option B: Contrast / Before-After / Stakes Split (dual-frame tension split + 2-4 word hook)
- Option C: Clean Focal Object / Mystery / Proof Highlight (uncluttered hero frame + stakes hook)

Enforces mobile legibility, complementary title-thumbnail synergy (no title duplication),
and safe zones (bottom-right duration-badge corner kept clear of text overlays).
"""

from __future__ import annotations

import logging
import pathlib
import shutil
from typing import Any, Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

from .reframe import _init_detector
from .seo import generate_thumbnail_hooks

logger = logging.getLogger(__name__)

FONTS_DIR = pathlib.Path(__file__).resolve().parent / "fonts"


def calculate_frame_sharpness(gray_frame: np.ndarray) -> float:
    """Calculate the focus measure of a grayscale image using the variance of the Laplacian."""
    return float(cv2.Laplacian(gray_frame, cv2.CV_64F).var())


def _calculate_colorfulness(frame_bgr: np.ndarray) -> float:
    """Hasler-Süsstrunk colorfulness metric for thumbnail visual pop."""
    b, g, r = cv2.split(frame_bgr.astype("float32"))
    rg = np.abs(r - g)
    yb = np.abs(0.5 * (r + g) - b)
    std_root = np.sqrt(np.std(rg) ** 2 + np.std(yb) ** 2)
    mean_root = np.sqrt(np.mean(rg) ** 2 + np.mean(yb) ** 2)
    return float(std_root + 0.3 * mean_root)


def _detect_best_face(
    frame_bgr: np.ndarray, detector_info: Optional[Tuple[str, Any]]
) -> Tuple[float, Optional[Tuple[float, float, float, float]]]:
    """Return (face_multiplier, normalized_bbox_xywh) for the most prominent face."""
    if detector_info is None:
        return 1.0, None

    dtype, detector = detector_info
    h, w = frame_bgr.shape[:2]
    if w <= 0 or h <= 0:
        return 1.0, None

    try:
        if dtype == "yunet":
            detector.setInputSize((w, h))
            _, faces = detector.detect(frame_bgr)
            if faces is not None and len(faces) > 0:
                best = max(faces, key=lambda f: float(f[2] * f[3]))
                fx, fy, fw, fh = float(best[0]), float(best[1]), float(best[2]), float(best[3])
                relative_area = (fw * fh) / float(w * h)
                cx = (fx + fw * 0.5) / float(w)
                cy = (fy + fh * 0.5) / float(h)
                center_bonus = 1.15 if (0.2 <= cx <= 0.8 and 0.15 <= cy <= 0.75) else 1.0
                mult = (2.2 if 0.05 <= relative_area <= 0.40 else 1.6) * center_bonus
                bbox = (
                    max(0.0, fx / float(w)),
                    max(0.0, fy / float(h)),
                    min(1.0, fw / float(w)),
                    min(1.0, fh / float(h)),
                )
                return mult, bbox

        elif dtype == "mediapipe":
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            res = detector.process(rgb)
            if res and res.detections:
                det = res.detections[0]
                rbox = det.location_data.relative_bounding_box
                return 2.0, (
                    max(0.0, float(rbox.xmin)),
                    max(0.0, float(rbox.ymin)),
                    min(1.0, float(rbox.width)),
                    min(1.0, float(rbox.height)),
                )
    except Exception as exc:
        logger.debug("[cover] Face evaluation error: %s", exc)

    return 1.0, None


def evaluate_face_presence(
    frame_bgr: np.ndarray, detector_info: Optional[Tuple[str, Any]]
) -> float:
    """Evaluate face prominence in a frame. Returns a multiplier between 1.0 and ~2.5."""
    mult, _ = _detect_best_face(frame_bgr, detector_info)
    return mult


def analyze_frame(
    frame_bgr: np.ndarray,
    detector_info: Optional[Tuple[str, Any]],
    timestamp: float = 0.0,
) -> Dict[str, Any]:
    """Score a frame on sharpness, face prominence, contrast, exposure, and colorfulness."""
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    sharpness = calculate_frame_sharpness(gray)
    mean_luma = float(np.mean(gray))
    contrast = float(np.std(gray))
    colorfulness = _calculate_colorfulness(frame_bgr)

    # Penalize near-black fade-ins or blown-out white frames
    exposure_mult = 1.0
    if mean_luma < 25.0 or mean_luma > 235.0:
        exposure_mult = 0.25
    elif 55.0 <= mean_luma <= 195.0:
        exposure_mult = 1.15

    h, w = frame_bgr.shape[:2]
    scale = min(1.0, 640.0 / float(w)) if w else 1.0
    dw, dh = max(2, int(round(w * scale))), max(2, int(round(h * scale)))
    small = cv2.resize(frame_bgr, (dw, dh), interpolation=cv2.INTER_AREA) if scale < 1.0 else frame_bgr
    face_mult, face_bbox = _detect_best_face(small, detector_info)

    contrast_factor = max(0.4, min(1.6, contrast / 48.0))
    color_factor = 1.0 + min(0.35, colorfulness / 120.0)
    composite = sharpness * face_mult * exposure_mult * contrast_factor * color_factor

    return {
        "frame": frame_bgr,
        "time": float(timestamp),
        "sharpness": sharpness,
        "face_mult": face_mult,
        "face_bbox": face_bbox,
        "contrast": contrast,
        "colorfulness": colorfulness,
        "mean_luma": mean_luma,
        "score": float(composite),
    }


def _load_font(filename: str, size: int) -> ImageFont.ImageFont:
    font_path = FONTS_DIR / filename
    try:
        if font_path.is_file():
            return ImageFont.truetype(str(font_path), size=max(12, int(size)))
    except Exception:
        pass
    return ImageFont.load_default()


def _bgr_to_pil(frame_bgr: np.ndarray) -> Image.Image:
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    return Image.fromarray(rgb)


def _apply_top_scrim(img: Image.Image, height_ratio: float = 0.34, max_alpha: int = 195) -> Image.Image:
    """Darken only the top safe zone so headline text pops while subject & bottom-right stay clean."""
    base = img.convert("RGBA")
    w, h = base.size
    scrim_h = max(1, int(h * height_ratio))
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for y in range(scrim_h):
        alpha = int(max_alpha * (1.0 - (y / float(scrim_h))) ** 1.35)
        draw.line([(0, y), (w, y)], fill=(8, 10, 14, alpha))
    return Image.alpha_composite(base, overlay).convert("RGB")


def _wrap_hook_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    max_width: int,
    max_lines: int = 2,
) -> List[str]:
    words = " ".join(str(text or "").split()).split()[:4]
    if not words:
        return []
    lines: List[str] = []
    cur = ""
    for word in words:
        cand = f"{cur} {word}".strip()
        bbox = draw.textbbox((0, 0), cand, font=font)
        if cur and (bbox[2] - bbox[0]) > max_width:
            lines.append(cur)
            cur = word
        else:
            cur = cand
    if cur:
        lines.append(cur)
    return lines[:max_lines]


def _draw_safe_hook_banner(
    img: Image.Image,
    hook_text: str,
    accent_color: str = "#FACC15",
    kicker: Optional[str] = None,
) -> Image.Image:
    """Render 2-4 word complementary text in the centered 4:5/9:16-safe upper zone (bottom-right always clear)."""
    w, h = img.size
    is_portrait = h >= w
    out = _apply_top_scrim(img, height_ratio=0.40 if is_portrait else 0.36, max_alpha=205)
    draw = ImageDraw.Draw(out)

    # Center-safe width ensures text remains intact under both 4:5 (feed) and 9:16 (Shorts/Reels) center crops
    if is_portrait:
        max_text_w = max(120, int(w * 0.82))
        y = max(14, int(h * 0.155))
    else:
        inner_9_16_w = int(h * (9.0 / 16.0))
        max_text_w = max(160, min(int(w * 0.82), int(inner_9_16_w * 0.88)))
        y = max(14, int(h * 0.085))

    if kicker:
        k_font = _load_font("Poppins-Bold.ttf", max(12, int(min(w, h) * 0.034)))
        kb = draw.textbbox((0, 0), kicker, font=k_font)
        kw = (kb[2] - kb[0]) + 22
        kh = (kb[3] - kb[1]) + 12
        kx = max(12, (w - kw) // 2)
        draw.rounded_rectangle((kx, y, kx + kw, y + kh), radius=max(6, kh // 4), fill=accent_color)
        draw.text((kx + 11 - kb[0], y + 6 - kb[1]), kicker, font=k_font, fill="#0B0D12")
        y += kh + max(8, int(h * 0.015))

    font_size = max(20, int(min(w, h) * (0.082 if is_portrait else 0.078)))
    font = _load_font("Anton-Regular.ttf", font_size)
    lines = _wrap_hook_lines(draw, hook_text.upper(), font, max_text_w, max_lines=2)
    while font_size > 16 and any((draw.textbbox((0, 0), ln, font=font)[2] - draw.textbbox((0, 0), ln, font=font)[0]) > max_text_w for ln in lines):
        font_size = max(16, int(font_size * 0.88))
        font = _load_font("Anton-Regular.ttf", font_size)
        lines = _wrap_hook_lines(draw, hook_text.upper(), font, max_text_w, max_lines=2)

    stroke_w = max(2, int(font_size * 0.09))
    for idx, line in enumerate(lines):
        lb = draw.textbbox((0, 0), line, font=font)
        lw = lb[2] - lb[0]
        lh = lb[3] - lb[1]
        tx = max(12, (w - lw) // 2)
        fill = accent_color if (idx == 0 and not kicker) else "#FFFFFF"
        draw.text(
            (tx - lb[0], y - lb[1]),
            line,
            font=font,
            fill=fill,
            stroke_width=stroke_w,
            stroke_fill="#080A0F",
        )
        y += lh + max(6, int(font_size * 0.16))

    return out


def _render_option_a(frame_bgr: np.ndarray, hook_text: str) -> Image.Image:
    """Option A: Emotion / Reaction + Result (vibrant hero frame + bold outcome hook)."""
    img = _bgr_to_pil(frame_bgr)
    img = ImageEnhance.Contrast(img).enhance(1.12)
    img = ImageEnhance.Color(img).enhance(1.14)
    return _draw_safe_hook_banner(img, hook_text, accent_color="#FACC15", kicker="KEY RESULT")


def _render_option_b(
    frame_first: np.ndarray,
    frame_second: np.ndarray,
    hook_text: str,
) -> Image.Image:
    """Option B: Contrast / Stakes Split (dual-moment split composition + stakes badge)."""
    img_a = _bgr_to_pil(frame_first)
    img_b = _bgr_to_pil(frame_second)
    w, h = img_a.size
    if img_b.size != (w, h):
        img_b = img_b.resize((w, h), Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", (w, h), "#090B10")
    if h >= w:
        # Portrait split: top/bottom halves with crisp divider
        half_h = h // 2
        top_crop = ImageEnhance.Color(img_a).enhance(0.85).crop((0, h // 6, w, h // 6 + half_h))
        if top_crop.size != (w, half_h):
            top_crop = img_a.resize((w, half_h), Image.Resampling.LANCZOS)
        bot_crop = ImageEnhance.Contrast(img_b).enhance(1.18).crop((0, h // 4, w, h // 4 + (h - half_h)))
        if bot_crop.size != (w, h - half_h):
            bot_crop = img_b.resize((w, h - half_h), Image.Resampling.LANCZOS)
        canvas.paste(top_crop, (0, 0))
        canvas.paste(bot_crop, (0, half_h))
        draw = ImageDraw.Draw(canvas)
        draw.line([(0, half_h), (w, half_h)], fill="#F97316", width=max(4, int(h * 0.005)))
    else:
        # Landscape split: left/right halves
        half_w = w // 2
        left_crop = ImageEnhance.Color(img_a).enhance(0.85).crop((w // 6, 0, w // 6 + half_w, h))
        if left_crop.size != (half_w, h):
            left_crop = img_a.resize((half_w, h), Image.Resampling.LANCZOS)
        right_crop = ImageEnhance.Contrast(img_b).enhance(1.18).crop((w // 4, 0, w // 4 + (w - half_w), h))
        if right_crop.size != (w - half_w, h):
            right_crop = img_b.resize((w - half_w, h), Image.Resampling.LANCZOS)
        canvas.paste(left_crop, (0, 0))
        canvas.paste(right_crop, (half_w, 0))
        draw = ImageDraw.Draw(canvas)
        draw.line([(half_w, 0), (half_w, h)], fill="#F97316", width=max(4, int(w * 0.005)))

    return _draw_safe_hook_banner(canvas, hook_text, accent_color="#FB923C", kicker="COMPARE")


def _render_option_c(
    frame_bgr: np.ndarray,
    hook_text: str,
    face_bbox: Optional[Tuple[float, float, float, float]] = None,
) -> Image.Image:
    """Option C: Clean Focal Object / Mystery / Proof Highlight (tight focal crop + clean stakes hook)."""
    img = _bgr_to_pil(frame_bgr)
    w, h = img.size
    # Subtle 14% punch-in toward focal subject or center
    zoom = 0.86
    cw, ch = int(w * zoom), int(h * zoom)
    if face_bbox is not None:
        cx = int((face_bbox[0] + face_bbox[2] * 0.5) * w)
        cy = int((face_bbox[1] + face_bbox[3] * 0.5) * h)
    else:
        cx, cy = w // 2, h // 2
    x0 = max(0, min(w - cw, cx - cw // 2))
    y0 = max(0, min(h - ch, cy - ch // 2))
    cropped = img.crop((x0, y0, x0 + cw, y0 + ch)).resize((w, h), Image.Resampling.LANCZOS)
    cropped = ImageEnhance.Sharpness(ImageEnhance.Contrast(cropped).enhance(1.10)).enhance(1.20)
    return _draw_safe_hook_banner(cropped, hook_text, accent_color="#38BDF8", kicker="PROOF")


def _sample_video_frames(
    video_path: pathlib.Path,
    start_sec: float = 0.3,
    end_sec: Optional[float] = None,
    sample_count: int = 24,
) -> List[Dict[str, Any]]:
    """Sample and score candidate frames across the clip."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video to extract cover frame: {video_path}")

    try:
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        duration = total_frames / fps if fps > 0 else 0.0

        actual_start = min(start_sec, max(0.0, duration - 0.5))
        target_end = end_sec if end_sec is not None else max(actual_start + 1.0, duration - 0.25)
        actual_end = min(target_end, duration) if duration > 0 else target_end
        if actual_end <= actual_start:
            actual_end = actual_start + 1.0

        sample_times = np.linspace(actual_start, actual_end, max(3, sample_count))
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        scale = min(1.0, 640.0 / float(w)) if w else 1.0
        dw, dh = max(2, int(round(w * scale))), max(2, int(round(h * scale)))
        detector_info = _init_detector(dw, dh)

        scored: List[Dict[str, Any]] = []
        for t in sample_times:
            frame_idx = int(round(t * fps))
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            scored.append(analyze_frame(frame, detector_info, timestamp=float(t)))
        return scored
    finally:
        cap.release()


def _pick_distinct_frames(scored: Sequence[Dict[str, Any]], count: int = 3, min_gap_sec: float = 1.2) -> List[Dict[str, Any]]:
    """Pick up to `count` highest-scoring frames separated by at least `min_gap_sec` when possible."""
    ranked = sorted(scored, key=lambda item: item["score"], reverse=True)
    picked: List[Dict[str, Any]] = []
    picked_ids: set[int] = set()
    for item in ranked:
        if all(abs(item["time"] - p["time"]) >= min_gap_sec for p in picked):
            picked.append(item)
            picked_ids.add(id(item))
            if len(picked) >= count:
                break
    for item in ranked:
        if len(picked) >= count:
            break
        if id(item) not in picked_ids:
            picked.append(item)
            picked_ids.add(id(item))
    return picked


def pick_cover_frame(
    video_path: pathlib.Path,
    out_cover_path: pathlib.Path,
    start_sec: float = 0.5,
    end_sec: float = 4.0,
    sample_count: int = 24,
) -> pathlib.Path:
    """Sample candidate frames within [start_sec, end_sec] and save the optimal raw cover JPEG."""
    video_path = pathlib.Path(video_path)
    out_cover_path = pathlib.Path(out_cover_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    out_cover_path.parent.mkdir(parents=True, exist_ok=True)
    scored = _sample_video_frames(video_path, start_sec=start_sec, end_sec=end_sec, sample_count=sample_count)
    if not scored:
        raise RuntimeError(f"Could not read any valid frames from {video_path} for cover extraction.")

    best = max(scored, key=lambda item: item["score"])
    success = cv2.imwrite(
        str(out_cover_path.resolve()),
        best["frame"],
        [int(cv2.IMWRITE_JPEG_QUALITY), 95],
    )
    if not success or not out_cover_path.exists() or out_cover_path.stat().st_size == 0:
        raise RuntimeError(f"Failed to write cover image to {out_cover_path}")

    logger.info("[cover] Picked optimal cover frame (Score: %.1f) saved to %s", best["score"], out_cover_path.name)
    return out_cover_path


def generate_thumbnail_options(
    video_path: pathlib.Path,
    out_cover_path: pathlib.Path,
    title: str = "",
    hook: str = "",
    text: str = "",
    keywords: Sequence[str] = (),
    llm_hooks: Optional[Dict[str, Any]] = None,
    sample_count: int = 24,
) -> Dict[str, Any]:
    """Generate 3 distinct thumbnail options (A/B/C) and set Option A as the active cover image."""
    video_path = pathlib.Path(video_path)
    out_cover_path = pathlib.Path(out_cover_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    out_cover_path.parent.mkdir(parents=True, exist_ok=True)
    scored = _sample_video_frames(video_path, start_sec=0.3, end_sec=None, sample_count=sample_count)
    if not scored:
        raise RuntimeError(f"Could not read any valid frames from {video_path} for thumbnail generation.")

    distinct = _pick_distinct_frames(scored, count=4, min_gap_sec=1.2)
    face_frames = [item for item in scored if float(item.get("face_mult", 1.0)) > 1.0]
    if face_frames:
        frame_a = max(face_frames, key=lambda item: item["score"])
        others = [item for item in distinct if id(item) != id(frame_a)]
    else:
        frame_a = distinct[0]
        others = distinct[1:]
    frame_b = others[0] if others else frame_a
    frame_c = others[1] if len(others) > 1 else frame_b

    # Ensure split composition uses two meaningfully separated moments when available
    earliest = min(scored, key=lambda item: item["time"])
    latest = max(scored, key=lambda item: item["time"])
    split_first = frame_a if abs(frame_a["time"] - frame_b["time"]) >= 0.8 else earliest
    split_second = frame_b if abs(frame_a["time"] - frame_b["time"]) >= 0.8 else latest

    hooks = generate_thumbnail_hooks(
        title=title,
        hook=hook,
        text=text,
        keywords=keywords,
        llm_hooks=llm_hooks,
    )

    stem = out_cover_path.stem[:-6] if out_cover_path.stem.endswith("_cover") else out_cover_path.stem
    path_a = out_cover_path.with_name(f"{stem}_thumb_a.jpg")
    path_b = out_cover_path.with_name(f"{stem}_thumb_b.jpg")
    path_c = out_cover_path.with_name(f"{stem}_thumb_c.jpg")

    img_a = _render_option_a(frame_a["frame"], hooks["option_a"])
    img_b = _render_option_b(split_first["frame"], split_second["frame"], hooks["option_b"])
    img_c = _render_option_c(frame_c["frame"], hooks["option_c"], face_bbox=frame_c.get("face_bbox"))

    img_a.save(path_a, format="JPEG", quality=95, optimize=True)
    img_b.save(path_b, format="JPEG", quality=95, optimize=True)
    img_c.save(path_c, format="JPEG", quality=95, optimize=True)
    shutil.copyfile(path_a, out_cover_path)

    options = [
        {
            "id": "option_a",
            "concept": "emotion_result",
            "label": "Emotion + Result",
            "hook_text": hooks["option_a"],
            "file": str(path_a.resolve()),
            "frame_time": round(frame_a["time"], 2),
            "score": round(frame_a["score"], 1),
            "safe_zones": {"bottom_right_clear": True, "center_safe_crop": True, "max_words": 4},
            "rationale": "Expressive hero frame paired with a 2-3 word outcome hook complementary to the title.",
        },
        {
            "id": "option_b",
            "concept": "contrast_stakes",
            "label": "Contrast / Stakes Split",
            "hook_text": hooks["option_b"],
            "file": str(path_b.resolve()),
            "frame_time": round(split_second["time"], 2),
            "score": round(max(split_first["score"], split_second["score"]), 1),
            "safe_zones": {"bottom_right_clear": True, "center_safe_crop": True, "max_words": 4},
            "rationale": "Dual-moment split composition highlighting tension, before/after contrast, or stakes.",
        },
        {
            "id": "option_c",
            "concept": "clean_focal_proof",
            "label": "Clean Focal / Proof",
            "hook_text": hooks["option_c"],
            "file": str(path_c.resolve()),
            "frame_time": round(frame_c["time"], 2),
            "score": round(frame_c["score"], 1),
            "safe_zones": {"bottom_right_clear": True, "center_safe_crop": True, "max_words": 4},
            "rationale": "Uncluttered focal zoom around the subject with a concise mystery/proof callout.",
        },
    ]

    logger.info("[cover] Generated 3 thumbnail options (%s, %s, %s).", path_a.name, path_b.name, path_c.name)
    return {
        "selected_option": "option_a",
        "cover_image": str(out_cover_path.resolve()),
        "options": options,
    }
