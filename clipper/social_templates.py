"""
Platform-aware social post frames for vertical clips.

The generated canvas is rendered behind the video. The original clip is then
scaled into a 9:16 window, preserving its aspect ratio and audio track.
"""

from __future__ import annotations

import logging
import os
import pathlib
import re
import subprocess
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont

from .captions import FONTS_DIR
from .config import Settings, settings as default_settings
from .reframe import build_encoder_args, resolve_encoder

logger = logging.getLogger(__name__)

SOCIAL_TEMPLATES = ("none", "x", "instagram", "headline")
DEFAULT_DISPLAY_NAME = "Your Name"
DEFAULT_HANDLE = "@yourhandle"


def validate_social_template(value: Optional[str]) -> str:
    """Return a normalized supported template name."""
    template = (value or "none").strip().lower()
    if template not in SOCIAL_TEMPLATES:
        raise ValueError(
            f"Unknown social template {value!r}. Choose one of: {', '.join(SOCIAL_TEMPLATES)}."
        )
    return template


def normalize_profile(display_name: Optional[str], handle: Optional[str]) -> Tuple[str, str]:
    """Bound profile text before it is drawn into the rendered frame."""
    name = re.sub(r"\s+", " ", str(display_name or DEFAULT_DISPLAY_NAME)).strip()
    handle_value = re.sub(r"\s+", "", str(handle or DEFAULT_HANDLE)).strip()
    name = name[:40] or DEFAULT_DISPLAY_NAME
    handle_value = handle_value[:32] or DEFAULT_HANDLE
    if not handle_value.startswith("@"):
        handle_value = "@" + handle_value.lstrip("@")
    return name, handle_value


@lru_cache(maxsize=16)
def _font(filename: str, size: int) -> ImageFont.FreeTypeFont:
    path = pathlib.Path(FONTS_DIR) / filename
    return ImageFont.truetype(str(path), size=max(8, int(size)))


def _font_size(height: int, ratio: float) -> int:
    return max(12, int(round(height * ratio)))


def _text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> float:
    box = draw.textbbox((0, 0), text, font=font)
    return float(box[2] - box[0])


def _wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    max_width: int,
    max_lines: int = 2,
) -> List[str]:
    words = re.sub(r"\s+", " ", str(text or "").strip()).split()
    if not words:
        return []
    lines: List[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and _text_width(draw, candidate, font) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)

    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and _text_width(draw, last + "…", font) > max_width:
            last = last[:-1].rstrip()
        lines[-1] = (last + "…") if last else "…"
    return lines


def _draw_wrapped(
    draw: ImageDraw.ImageDraw,
    xy: Tuple[int, int],
    text: str,
    font: ImageFont.ImageFont,
    fill: str,
    max_width: int,
    max_lines: int = 2,
    line_gap: Optional[int] = None,
) -> int:
    x, y = xy
    lines = _wrap_text(draw, text, font, max_width, max_lines)
    gap = line_gap if line_gap is not None else max(2, int(font.size * 0.16))
    for line in lines:
        draw.text((x, y), line, font=font, fill=fill)
        bounds = draw.textbbox((x, y), line, font=font)
        y = bounds[3] + gap
    return y


def _initials(name: str) -> str:
    parts = [part for part in re.split(r"\s+", name.strip()) if part]
    if not parts:
        return "Y"
    return "".join(part[0] for part in parts[:2]).upper()


def _draw_avatar(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    size: int,
    name: str,
    fill: str,
    text_fill: str = "#FFFFFF",
) -> None:
    draw.ellipse((x, y, x + size, y + size), fill=fill)
    font = _font("Poppins-Bold.ttf", int(size * 0.30))
    label = _initials(name)
    bounds = draw.textbbox((0, 0), label, font=font)
    tx = x + (size - (bounds[2] - bounds[0])) / 2
    ty = y + (size - (bounds[3] - bounds[1])) / 2 - bounds[1] - 1
    draw.text((int(tx), int(ty)), label, font=font, fill=text_fill)


def _draw_verified(draw: ImageDraw.ImageDraw, x: int, y: int, size: int) -> None:
    draw.ellipse((x, y, x + size, y + size), fill="#1D9BF0")
    width = max(2, size // 10)
    draw.line(
        [
            (x + int(size * 0.25), y + int(size * 0.52)),
            (x + int(size * 0.43), y + int(size * 0.69)),
            (x + int(size * 0.76), y + int(size * 0.33)),
        ],
        fill="#FFFFFF",
        width=width,
    )


def _hashtags(seo: Optional[Dict[str, Any]], hook: str) -> List[str]:
    supplied = seo.get("hashtags", []) if isinstance(seo, dict) else []
    result: List[str] = []
    if isinstance(supplied, list):
        for value in supplied:
            tag = re.sub(r"[^A-Za-z0-9_]", "", str(value).lstrip("#"))
            if tag and tag.lower() not in {item.lower().lstrip("#") for item in result}:
                result.append("#" + tag)
            if len(result) == 4:
                break

    if result:
        return result

    stop_words = {
        "about", "after", "again", "because", "before", "being", "could", "every",
        "from", "have", "into", "just", "like", "make", "never", "should", "that",
        "their", "there", "these", "this", "those", "they", "them", "then", "there",
        "very", "what", "when", "where", "which", "while", "with", "would", "your",
        "you", "will", "than", "then", "also", "only", "more", "most", "some",
    }
    words = re.findall(r"[A-Za-z][A-Za-z0-9_]{3,}", hook.lower())
    for word in words:
        if word in stop_words or word in {tag.lstrip("#").lower() for tag in result}:
            continue
        result.append("#" + word)
        if len(result) == 4:
            break
    return result or ["#Reels", "#Creator"]


def _draw_heart(draw: ImageDraw.ImageDraw, x: int, y: int, size: int, color: str) -> None:
    r = max(3, size // 4)
    draw.ellipse((x, y, x + r * 2, y + r * 2), fill=color)
    draw.ellipse((x + r, y, x + r * 3, y + r * 2), fill=color)
    draw.polygon(
        [(x, y + r), (x + r * 3, y + r), (x + int(r * 1.5), y + r * 3)],
        fill=color,
    )


def _draw_x_template(
    draw: ImageDraw.ImageDraw,
    width: int,
    height: int,
    header_h: int,
    footer_h: int,
    display_name: str,
    handle: str,
    hook: str,
) -> None:
    draw.rectangle((0, 0, width, height), fill="#000000")
    avatar_size = int(height * 0.045)
    _draw_avatar(draw, int(width * 0.055), int(height * 0.035), avatar_size, display_name, "#1D9BF0")

    name_font = _font("Poppins-Bold.ttf", _font_size(height, 0.020))
    meta_font = _font("Poppins-SemiBold.ttf", _font_size(height, 0.014))
    hook_font = _font("Poppins-SemiBold.ttf", _font_size(height, 0.023))

    name_x = int(width * 0.17)
    name_y = int(height * 0.035)
    draw.text((name_x, name_y), display_name[:25], font=name_font, fill="#F7F9F9")
    name_width = int(_text_width(draw, display_name[:25], name_font))
    badge_size = int(height * 0.018)
    _draw_verified(draw, min(width - badge_size - 35, name_x + name_width + 12), name_y + 4, badge_size)
    draw.text((name_x, int(height * 0.075)), f"{handle}  ·  2h", font=meta_font, fill="#8B98A5")
    x_font = _font("Anton-Regular.ttf", _font_size(height, 0.034))
    draw.text((int(width * 0.90), int(height * 0.032)), "X", font=x_font, fill="#F7F9F9")

    _draw_wrapped(
        draw,
        (int(width * 0.055), int(height * 0.103)),
        hook or "A moment worth sharing.",
        hook_font,
        "#F7F9F9",
        int(width * 0.88),
        max_lines=3,
        line_gap=int(height * 0.004),
    )
    draw.line((0, header_h - 2, width, header_h - 2), fill="#29313A", width=2)

    footer_y = height - footer_h
    draw.line((0, footer_y, width, footer_y), fill="#29313A", width=2)
    label_font = _font("Poppins-SemiBold.ttf", _font_size(height, 0.013))
    value_font = _font("Poppins-Bold.ttf", _font_size(height, 0.016))
    metrics = [("↻", "REPOSTS"), ("♡", "LIKES"), ("▣", "BOOKMARKS"), ("◉", "VIEWS")]
    col_w = width // len(metrics)
    for i, (symbol, label) in enumerate(metrics):
        x = int(i * col_w + col_w * 0.16)
        y = footer_y + int(height * 0.047)
        draw.text((x, y), symbol, font=value_font, fill="#8B98A5")
        draw.text((x + int(width * 0.05), y + 2), "—", font=value_font, fill="#E7E9EA")
        draw.text((x, y + int(height * 0.043)), label, font=label_font, fill="#8B98A5")

    footer_label = _font("Poppins-SemiBold.ttf", _font_size(height, 0.010))
    draw.text(
        (int(width * 0.055), height - int(height * 0.025)),
        "SOCIAL POST PREVIEW  ·  ENGAGEMENT UPDATES AFTER PUBLISHING",
        font=footer_label,
        fill="#536471",
    )


def _draw_instagram_template(
    draw: ImageDraw.ImageDraw,
    width: int,
    height: int,
    header_h: int,
    footer_h: int,
    display_name: str,
    handle: str,
    hook: str,
    seo: Optional[Dict[str, Any]],
) -> None:
    draw.rectangle((0, 0, width, height), fill="#0D0D0F")
    avatar_size = int(height * 0.046)
    avatar_x = int(width * 0.055)
    avatar_y = int(height * 0.027)
    ring = int(height * 0.006)
    colors = ["#FEDA75", "#FA7E1E", "#D62976", "#962FBF", "#4F5BD5"]
    for index, color in enumerate(colors):
        start = index * 72
        draw.arc(
            (
                avatar_x - ring - 4,
                avatar_y - ring - 4,
                avatar_x + avatar_size + ring + 4,
                avatar_y + avatar_size + ring + 4,
            ),
            start=start,
            end=start + 72,
            fill=color,
            width=ring + 2,
        )
    _draw_avatar(draw, avatar_x, avatar_y, avatar_size, display_name, "#3D5A80")

    name_font = _font("Poppins-Bold.ttf", _font_size(height, 0.019))
    meta_font = _font("Poppins-SemiBold.ttf", _font_size(height, 0.013))
    draw.text((int(width * 0.17), int(height * 0.035)), display_name[:26], font=name_font, fill="#F5F5F5")
    draw.text((int(width * 0.17), int(height * 0.075)), "Original audio  ·  Chop Shop", font=meta_font, fill="#BDBDBD")
    menu_x = int(width * 0.91)
    menu_y = int(height * 0.055)
    dot_r = max(2, int(height * 0.0025))
    for offset in (-12, 0, 12):
        draw.ellipse((menu_x + offset - dot_r, menu_y - dot_r, menu_x + offset + dot_r, menu_y + dot_r), fill="#F5F5F5")

    draw.line((0, header_h - 2, width, header_h - 2), fill="#28282B", width=2)
    footer_y = height - footer_h
    icon_y = footer_y + int(height * 0.035)
    icon_size = int(height * 0.022)
    _draw_heart(draw, int(width * 0.055), icon_y, icon_size, "#F4F4F5")
    icon_font = _font("Poppins-SemiBold.ttf", _font_size(height, 0.026))
    draw.text((int(width * 0.17), icon_y - int(height * 0.006)), "○", font=icon_font, fill="#F4F4F5")
    draw.text((int(width * 0.29), icon_y - int(height * 0.006)), "➤", font=icon_font, fill="#F4F4F5")
    draw.text((int(width * 0.88), icon_y - int(height * 0.006)), "▯", font=icon_font, fill="#F4F4F5")

    caption_font = _font("Poppins-SemiBold.ttf", _font_size(height, 0.014))
    caption = hook or "A moment worth sharing."
    _draw_wrapped(
        draw,
        (int(width * 0.055), footer_y + int(height * 0.085)),
        f"{display_name}  {caption}",
        caption_font,
        "#F5F5F5",
        int(width * 0.89),
        max_lines=2,
        line_gap=int(height * 0.003),
    )
    hashtag_font = _font("Poppins-SemiBold.ttf", _font_size(height, 0.013))
    tags = " ".join(_hashtags(seo, hook))
    _draw_wrapped(
        draw,
        (int(width * 0.055), height - int(height * 0.065)),
        tags,
        hashtag_font,
        "#8AB4F8",
        int(width * 0.89),
        max_lines=2,
        line_gap=int(height * 0.002),
    )
    draw.line((0, footer_y, width, footer_y), fill="#28282B", width=2)


def _draw_headline_template(
    draw: ImageDraw.ImageDraw,
    width: int,
    height: int,
    header_h: int,
    footer_h: int,
    title: str,
    hook: str,
) -> None:
    draw.rectangle((0, 0, width, height), fill="#080A0D")
    pad_x = int(width * 0.055)
    banner_top = int(height * 0.035)
    banner_bottom = header_h - int(height * 0.045)
    draw.rounded_rectangle(
        (pad_x, banner_top, width - pad_x, banner_bottom),
        radius=max(12, int(height * 0.016)),
        fill="#F4D35E",
    )
    kicker_font = _font("Poppins-Bold.ttf", _font_size(height, 0.013))
    headline_font = _font("Anton-Regular.ttf", _font_size(height, 0.043))
    draw.text((pad_x + 24, banner_top + 18), "THE MOMENT THAT MATTERS", font=kicker_font, fill="#171717")
    _draw_wrapped(
        draw,
        (pad_x + 22, banner_top + int(height * 0.052)),
        title or hook or "THE IDEA THAT CHANGES EVERYTHING",
        headline_font,
        "#111111",
        width - 2 * pad_x - 44,
        max_lines=2,
        line_gap=int(height * 0.002),
    )
    footer_y = height - footer_h
    draw.line((0, footer_y, width, footer_y), fill="#34383D", width=2)
    quote_font = _font("Poppins-SemiBold.ttf", _font_size(height, 0.020))
    _draw_wrapped(
        draw,
        (pad_x, footer_y + int(height * 0.035)),
        f'“{hook or title or "A moment worth sharing."}”',
        quote_font,
        "#F2F2F2",
        width - 2 * pad_x,
        max_lines=2,
    )
    badge_font = _font("Poppins-Bold.ttf", _font_size(height, 0.012))
    tags = _hashtags(None, hook or title)[:3]
    x = pad_x
    y = height - int(height * 0.045)
    for tag in tags:
        label = tag.upper()
        bbox = draw.textbbox((0, 0), label, font=badge_font)
        badge_w = (bbox[2] - bbox[0]) + 32
        if x + badge_w > width - pad_x:
            break
        draw.rounded_rectangle((x, y - 3, x + badge_w, y + int(height * 0.02)), radius=12, fill="#20252A", outline="#59616A", width=2)
        draw.text((x + 16, y), label, font=badge_font, fill="#F4D35E")
        x += badge_w + 12


def create_social_template_canvas(
    path: pathlib.Path,
    template: str,
    width: int = 1080,
    height: int = 1920,
    title: str = "",
    hook: str = "",
    display_name: Optional[str] = None,
    handle: Optional[str] = None,
    seo: Optional[Dict[str, Any]] = None,
) -> Tuple[pathlib.Path, Tuple[int, int, int, int]]:
    """
    Create a background card and return its video window as (x, y, width, height).
    The input clip is placed into this window by FFmpeg.
    """
    template = validate_social_template(template)
    if template == "none":
        raise ValueError("A social template is required to create a template canvas.")
    if width < 360 or height < 640:
        raise ValueError("Social templates require an output frame of at least 360x640.")

    name, profile_handle = normalize_profile(display_name, handle)
    if template == "x":
        header_h = int(height * 0.185)
        footer_h = int(height * 0.17)
    elif template == "instagram":
        header_h = int(height * 0.13)
        footer_h = int(height * 0.21)
    else:
        header_h = int(height * 0.17)
        footer_h = int(height * 0.145)

    video_h = height - header_h - footer_h
    video_w = int(round(video_h * 9 / 16))
    video_x = (width - video_w) // 2
    video_y = header_h
    video_rect = (video_x, video_y, video_w, video_h)

    image = Image.new("RGB", (width, height), "#080A0D")
    draw = ImageDraw.Draw(image)

    # The center is intentionally left clear. FFmpeg places the rendered clip here.
    draw.rectangle((0, video_y, width, video_y + video_h), fill="#080A0D")
    draw.rounded_rectangle(
        (
            max(0, video_x - 8),
            max(0, video_y - 8),
            min(width - 1, video_x + video_w + 8),
            min(height - 1, video_y + video_h + 8),
        ),
        radius=max(10, int(height * 0.012)),
        fill="#30363D",
    )

    if template == "x":
        _draw_x_template(draw, width, height, header_h, footer_h, name, profile_handle, hook or title)
    elif template == "instagram":
        _draw_instagram_template(draw, width, height, header_h, footer_h, name, profile_handle, hook or title, seo)
    elif template == "headline":
        _draw_headline_template(draw, width, height, header_h, footer_h, title or hook, hook or title)

    # Restore the central mat after the header/footer frame helpers draw separators.
    draw.rectangle((video_x, video_y, video_x + video_w, video_y + video_h), fill="#050607")
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)
    return path, video_rect


def apply_social_template(
    video_path: pathlib.Path,
    template: str,
    title: str = "",
    hook: str = "",
    display_name: Optional[str] = None,
    handle: Optional[str] = None,
    seo: Optional[Dict[str, Any]] = None,
    settings: Settings = default_settings,
    encoder: Optional[str] = None,
) -> pathlib.Path:
    """Compose a social card around a previously rendered vertical video."""
    template = validate_social_template(template)
    video_path = pathlib.Path(video_path)
    if template == "none":
        return video_path
    if not video_path.is_file():
        raise FileNotFoundError(f"Template input video not found: {video_path}")

    try:
        from .utils import probe_video
        info = probe_video(video_path)
        width = int(info.width)
        height = int(info.height)
    except Exception as exc:
        raise RuntimeError(f"Could not inspect template input video: {exc}") from exc

    canvas_path = video_path.with_name(f"{video_path.stem}.{template}.png")
    temporary_output = video_path.with_name(f"{video_path.stem}.{template}.tmp{video_path.suffix}")
    try:
        canvas_path, (x, y, video_w, video_h) = create_social_template_canvas(
            canvas_path,
            template,
            width=width,
            height=height,
            title=title,
            hook=hook,
            display_name=display_name,
            handle=handle,
            seo=seo,
        )
        graph = (
            f"[0:v]scale={video_w}:{video_h}:force_original_aspect_ratio=decrease:flags=lanczos,"
            f"pad={video_w}:{video_h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[clip];"
            f"[1:v][clip]overlay={x}:{y}:shortest=1:format=auto,format=yuv420p[v]"
        )
        chosen_encoder = resolve_encoder(encoder or settings.video_encoder, fallback=True)
        command = [
            "ffmpeg",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(video_path.resolve()),
            "-loop",
            "1",
            "-framerate",
            "30",
            "-i",
            str(canvas_path.resolve()),
            "-filter_complex",
            graph,
            "-map",
            "[v]",
            "-map",
            "0:a?",
            "-shortest",
            *build_encoder_args(chosen_encoder, settings, preset=settings.video_preset, quality=settings.video_crf),
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            str(temporary_output.resolve()),
        ]
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode != 0 and chosen_encoder != "libx264":
            logger.warning(
                "[social-template] %s render failed: %s; retrying with libx264.",
                chosen_encoder,
                result.stderr[-500:],
            )
            command = [
                "ffmpeg",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(video_path.resolve()),
                "-loop",
                "1",
                "-framerate",
                "30",
                "-i",
                str(canvas_path.resolve()),
                "-filter_complex",
                graph,
                "-map",
                "[v]",
                "-map",
                "0:a?",
                "-shortest",
                *build_encoder_args("libx264", settings, preset=settings.cpu_preset, quality=settings.cpu_crf),
                "-c:a",
                "copy",
                "-movflags",
                "+faststart",
                str(temporary_output.resolve()),
            ]
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        if result.returncode != 0:
            raise RuntimeError(f"Social template render failed: {result.stderr[-1500:]}")
        if not temporary_output.is_file() or temporary_output.stat().st_size == 0:
            raise RuntimeError("Social template render produced an empty output.")
        os.replace(temporary_output, video_path)
        logger.info("[social-template] Applied %s frame to %s.", template, video_path.name)
        return video_path
    finally:
        canvas_path.unlink(missing_ok=True)
        temporary_output.unlink(missing_ok=True)
