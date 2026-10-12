"""
Animated caption generation (ASS / libass) with selectable, social-media-style presets.

How the animation works
-----------------------
The old implementation emitted one static line per 4 words with a ``\\k`` tag, which most players
render as plain text. Here every *word* gets its own timed ``Dialogue`` event. The full caption line is
shown for the whole group, and the word being spoken is re-styled (colour, scale, glow/box) and "pops"
in with a short ``\\t`` transform. That is the look used by Submagic / CapCut / OpusClip.

Styles are plain data (``CaptionStyle``), so adding a new look means adding one dict entry.
"""

from __future__ import annotations

import pathlib
import re
import subprocess
from dataclasses import dataclass, replace
from typing import Any, Dict, List, Optional

FONTS_DIR = pathlib.Path(__file__).resolve().parent / "fonts"


# --------------------------------------------------------------------------------------
# Colour helpers (ASS uses &HBBGGRR&)
# --------------------------------------------------------------------------------------
def ass_color(hex_rgb: str, alpha: int = 0) -> str:
    h = hex_rgb.lstrip("#")
    if len(h) != 6:
        raise ValueError(f"Colour must be RRGGBB, got {hex_rgb!r}")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def _tag_color(hex_rgb: str) -> str:
    """Colour literal for inline override tags: &HBBGGRR&."""
    h = hex_rgb.lstrip("#")
    return f"&H{h[4:6]}{h[2:4]}{h[0:2]}&".upper()


# --------------------------------------------------------------------------------------
# Style presets
# --------------------------------------------------------------------------------------
@dataclass(frozen=True)
class CaptionStyle:
    key: str
    label: str
    description: str
    font: str
    font_size: int
    bold: bool = True
    uppercase: bool = True
    text_color: str = "FFFFFF"
    active_color: str = "FFE600"  # colour of the word being spoken
    outline_color: str = "000000"
    outline: float = 6.0
    shadow: float = 3.0
    words_per_line: int = 3
    max_chars: int = 22
    mode: str = "highlight"  # highlight | single | karaoke | plain
    pop: bool = True  # scale "pop" on the active word
    active_scale: int = 112  # percent
    active_box: Optional[str] = None  # hex colour: draw a rounded-ish box behind the active word
    glow: Optional[str] = None  # hex colour: neon glow on the active word
    position: str = "bottom"  # bottom | middle | top
    spacing: float = 0.0


CAPTION_STYLES: Dict[str, CaptionStyle] = {
    s.key: s
    for s in [
        CaptionStyle(
            key="bold_pop",
            label="Bold Pop",
            description="Big uppercase white words, the spoken word turns yellow and pops. The classic viral look.",
            font="Poppins ExtraBold",
            font_size=84,
            bold=False,
            active_color="FFE600",
            words_per_line=3,
        ),
        CaptionStyle(
            key="beast",
            label="Beast Impact",
            description="Chunky comic-impact font, thick outline, one punchy word colour flash (MrBeast-style).",
            font="Bangers",
            font_size=104,
            bold=False,
            text_color="FFFFFF",
            active_color="39FF14",
            outline=8.0,
            shadow=4.0,
            words_per_line=3,
            max_chars=18,
            active_scale=118,
            spacing=1.5,
        ),
        CaptionStyle(
            key="one_word",
            label="One Word",
            description="One huge word at a time in the middle of the screen. Maximum retention, zero reading effort.",
            font="Anton",
            font_size=150,
            bold=False,
            active_color="FFFFFF",
            outline=9.0,
            shadow=4.0,
            words_per_line=1,
            mode="single",
            position="middle",
            active_scale=108,
        ),
        CaptionStyle(
            key="highlight_box",
            label="Highlight Box",
            description="The spoken word sits on a solid colour block (Hormozi / Submagic boxed look).",
            font="Poppins ExtraBold",
            font_size=78,
            bold=False,
            text_color="FFFFFF",
            active_color="000000",
            active_box="FFE600",
            outline=4.0,
            shadow=0.0,
            words_per_line=3,
            active_scale=106,
        ),
        CaptionStyle(
            key="neon",
            label="Neon Glow",
            description="Tall condensed type with a glowing cyan-pink word. Great for gaming, tech and night-vibe content.",
            font="Bebas Neue",
            font_size=118,
            bold=False,
            text_color="FFFFFF",
            active_color="FF2BD6",
            glow="00E5FF",
            outline=3.0,
            shadow=0.0,
            words_per_line=3,
            max_chars=20,
            spacing=2.0,
        ),
        CaptionStyle(
            key="karaoke",
            label="Karaoke Fill",
            description="Each word fills with colour as it is spoken, like a lyric video.",
            font="Poppins ExtraBold",
            font_size=80,
            bold=False,
            text_color="FFFFFF",
            active_color="00C2FF",
            words_per_line=4,
            max_chars=26,
            mode="karaoke",
            pop=False,
        ),
        CaptionStyle(
            key="clean",
            label="Clean Minimal",
            description="Sentence-case semi-bold white subtitles with a soft shadow. Calm, premium, podcast-friendly.",
            font="Poppins SemiBold",
            font_size=62,
            bold=False,
            uppercase=False,
            text_color="FFFFFF",
            active_color="FFFFFF",
            outline=3.0,
            shadow=2.0,
            words_per_line=6,
            max_chars=34,
            mode="plain",
            pop=False,
        ),
    ]
}

FONT_SCALE = 1.35  # libass sizes the line box, not the cap height; this makes presets read at phone distance
DEFAULT_STYLE = "bold_pop"
POSITIONS = ("bottom", "middle", "top")


def list_styles() -> List[Dict[str, str]]:
    return [{"key": s.key, "label": s.label, "description": s.description} for s in CAPTION_STYLES.values()]


def get_style(name: Optional[str], position: Optional[str] = None) -> CaptionStyle:
    key = (name or DEFAULT_STYLE).strip().lower().replace("-", "_").replace(" ", "_")
    if key not in CAPTION_STYLES:
        raise ValueError(f"Unknown caption style {name!r}. Choose one of: {', '.join(CAPTION_STYLES)}")
    style = CAPTION_STYLES[key]
    if position:
        if position not in POSITIONS:
            raise ValueError(f"Unknown caption position {position!r}. Choose one of: {', '.join(POSITIONS)}")
        style = replace(style, position=position)
    return style


# --------------------------------------------------------------------------------------
# ASS building
# --------------------------------------------------------------------------------------
def format_ass_time(seconds: float) -> str:
    """Format floating point seconds into ASS timestamp standard: H:MM:SS.cc"""
    safe_sec = max(0.0, seconds)
    total_cs = int(round(safe_sec * 100))
    h, rem = divmod(total_cs, 360000)
    m, rem = divmod(rem, 6000)
    s, cs = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def escape_ffmpeg_filter_path(path: pathlib.Path) -> str:
    """Format Windows or POSIX paths safely for FFmpeg filter arguments."""
    normalized = str(path.resolve()).replace("\\", "/")
    return normalized.replace(":", r"\:")


def _ass_header(style: CaptionStyle, play_w: int, play_h: int) -> str:
    # Alignment (numpad): 2 bottom-centre, 5 middle-centre, 8 top-centre.
    align = {"bottom": 2, "middle": 5, "top": 8}[style.position]
    # Keep text inside platform UI safe zones (Shorts/Reels/TikTok overlay buttons + description).
    if style.position == "bottom":
        margin_v = int(play_h * 0.25)
    elif style.position == "top":
        margin_v = int(play_h * 0.13)
    else:
        margin_v = 0
    margin_lr = int(play_w * 0.09)
    scale = play_h / 1920.0
    fs = max(10, int(round(style.font_size * scale * FONT_SCALE)))
    outline = round(style.outline * scale, 2)
    shadow = round(style.shadow * scale, 2)
    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {play_w}\n"
        f"PlayResY: {play_h}\n"
        "WrapStyle: 2\n"
        "ScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{style.font},{fs},{ass_color(style.text_color)},{ass_color(style.active_color)},"
        f"{ass_color(style.outline_color)},&H80000000,{-1 if style.bold else 0},0,0,0,100,100,{style.spacing},0,1,"
        f"{outline},{shadow},{align},{margin_lr},{margin_lr},{margin_v},1\n"
        f"Style: Hook,Poppins ExtraBold,{max(12, int(round(90 * scale * FONT_SCALE)))},&H00FFFFFF,&H00FFE600,"
        f"&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,"
        f"{round(7.0 * scale, 2)},{round(3.5 * scale, 2)},8,{margin_lr},{margin_lr},{int(play_h * 0.14)},1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def _clean_word(raw: Any, style: CaptionStyle) -> str:
    text = str(raw).strip()
    text = text.replace("{", "(").replace("}", ")").replace("\\", "")
    text = re.sub(r"\s+", " ", text)
    return text.upper() if style.uppercase else text


def _group_words(words: List[Dict[str, Any]], style: CaptionStyle) -> List[List[Dict[str, Any]]]:
    """Split words into display lines honouring words_per_line / max_chars and sentence pauses."""
    groups: List[List[Dict[str, Any]]] = []
    cur: List[Dict[str, Any]] = []
    cur_chars = 0
    for w in words:
        text = w["_t"]
        gap = 0.0
        if cur:
            gap = float(w["start"]) - float(cur[-1]["end"])
        too_long = cur and (cur_chars + 1 + len(text) > style.max_chars)
        full = len(cur) >= style.words_per_line
        pause = cur and gap > 0.7
        if cur and (too_long or full or pause):
            groups.append(cur)
            cur, cur_chars = [], 0
        cur.append(w)
        cur_chars += len(text) + (1 if cur_chars else 0)
        if text.endswith((".", "?", "!")) and len(cur) >= 2:
            groups.append(cur)
            cur, cur_chars = [], 0
    if cur:
        groups.append(cur)
    return groups


KEYWORD_CATEGORIES: Dict[str, Dict[str, Any]] = {
    "money": {
        "words": {
            "money", "cash", "rich", "wealth", "revenue", "profit", "dollar", "dollars",
            "cost", "invest", "investment", "paid", "crypto", "bitcoin", "million", "millions",
            "billion", "billions", "save", "savings", "bank", "price", "expensive", "free", "financial",
        },
        "color": "39FF14",  # Neon Green
        "emoji": "💰",
    },
    "energy": {
        "words": {
            "crazy", "insane", "destroy", "destroyed", "danger", "dangerous", "warning",
            "huge", "exploding", "viral", "secret", "mistake", "never", "stop", "worst", "shocking",
        },
        "color": "FF3333",  # Punch Red
        "emoji": "🔥",
    },
    "growth": {
        "words": {
            "percent", "growth", "double", "doubled", "triple", "fast", "scale", "result",
            "results", "success", "win", "winner", "record", "10x", "100%",
        },
        "color": "00E5FF",  # Electric Cyan
        "emoji": "📈",
    },
    "mindset": {
        "words": {
            "think", "idea", "mindset", "brain", "lesson", "learn", "strategy", "smart",
            "genius", "truth",
        },
        "color": "FF2BD6",  # Neon Magenta
        "emoji": "💡",
    },
}


def get_keyword_emphasis(word: str) -> Optional[Tuple[str, str]]:
    """Return (color_hex, emoji) if word matches an emphasis category, or None."""
    cleaned = re.sub(r"[^\w%]", "", word).strip().lower()
    for cat in KEYWORD_CATEGORIES.values():
        if cleaned in cat["words"]:
            return str(cat["color"]), str(cat["emoji"])
    return None


def _active_tags(style: CaptionStyle, custom_color: Optional[str] = None) -> str:
    color = custom_color or style.active_color
    tags = f"\\c{_tag_color(color)}"
    if style.active_box:
        tags += f"\\3c{_tag_color(style.active_box)}\\bord{int(style.outline * 3 + 8)}\\shad0"
    if style.glow:
        tags += f"\\3c{_tag_color(style.glow)}\\bord{style.outline + 3:g}\\blur6"
    if style.pop:
        s = style.active_scale
        tags += f"\\fscx{int(s * 0.78)}\\fscy{int(s * 0.78)}\\t(0,90,\\fscx{s}\\fscy{s})\\t(90,170,\\fscx100\\fscy100)"
    return "{" + tags + "}"


def _reset_tags(style: CaptionStyle) -> str:
    base = (
        f"\\c{_tag_color(style.text_color)}\\3c{_tag_color(style.outline_color)}"
        f"\\bord{style.outline:g}\\shad{style.shadow:g}\\blur0\\fscx100\\fscy100"
    )
    return "{" + base + "}"


def build_ass(
    words: List[Dict[str, Any]],
    clip_start: float,
    style: Any = None,
    position: Optional[str] = None,
    play_w: int = 1080,
    play_h: int = 1920,
    group_size: Optional[int] = None,
    hook: Optional[str] = None,
    hook_duration: float = 2.5,
    enable_keywords: bool = True,
    enable_emojis: bool = False,
) -> str:
    """
    Generate an ASS document with per-word animated captions, optional hook headline overlay,
    and contextual keyword coloring with emojis.
    """
    st = style if isinstance(style, CaptionStyle) else get_style(style, position)
    if isinstance(style, CaptionStyle) and position:
        st = replace(st, position=position)
    if group_size:
        st = replace(st, words_per_line=int(group_size))
    header = _ass_header(st, play_w, play_h)

    events: List[str] = []

    # 1. Opening hook headline overlay (Layer 1, top center with fade-in and fade-out)
    if hook:
        hook_clean = str(hook).strip().replace("{", "(").replace("}", ")").replace("\\", "")
        if st.uppercase:
            hook_clean = hook_clean.upper()
        h_words = hook_clean.split()
        if len(h_words) > 5:
            mid = len(h_words) // 2
            hook_text = " ".join(h_words[:mid]) + r"\N" + " ".join(h_words[mid:])
        else:
            hook_text = hook_clean

        events.append(
            f"Dialogue: 1,0:00:00.00,{format_ass_time(hook_duration)},Hook,,0,0,0,,"
            f"{{\\fad(120,400)\\b1}}{hook_text}\n"
        )

    if not words:
        return header + "".join(events)

    prepared: List[Dict[str, Any]] = []
    for w in words:
        text = _clean_word(w.get("w", ""), st)
        if not text:
            continue
        start = max(0.0, float(w["start"]) - clip_start)
        end = max(start + 0.05, float(w["end"]) - clip_start)

        emphasis = get_keyword_emphasis(text) if enable_keywords else None
        custom_col = emphasis[0] if emphasis else None
        emoji = (emphasis[1] if (emphasis and enable_emojis) else None)

        prepared.append({
            "_t": text,
            "start": start,
            "end": end,
            "custom_color": custom_col,
            "emoji": emoji,
        })
    if not prepared:
        return header + "".join(events)

    # Make word windows contiguous so the highlight never flickers off between words.
    for i in range(len(prepared) - 1):
        nxt = prepared[i + 1]["start"]
        if nxt - prepared[i]["end"] < 0.35:
            prepared[i]["end"] = max(prepared[i]["end"], nxt)
        else:
            prepared[i]["end"] = min(max(prepared[i]["end"], prepared[i]["start"] + 0.2), nxt)

    def add(start: float, end: float, text: str) -> None:
        if end <= start:
            end = start + 0.05
        events.append(f"Dialogue: 0,{format_ass_time(start)},{format_ass_time(end)},Default,,0,0,0,,{text}\n")

    for group in _group_words(prepared, st):
        g_start = group[0]["start"]
        g_end = group[-1]["end"]
        if st.mode == "plain":
            add(g_start, g_end, " ".join(w["_t"] for w in group))
        elif st.mode == "karaoke":
            parts = []
            for w in group:
                cs = max(1, int(round((w["end"] - w["start"]) * 100)))
                display_t = f"{w['_t']} {w['emoji']}" if w.get("emoji") else w["_t"]
                parts.append(f"{{\\kf{cs}}}{display_t}")
            add(g_start, g_end, " ".join(parts))
        elif st.mode == "single":
            for w in group:
                active_t = _active_tags(st, custom_color=w.get("custom_color"))
                display_t = f"{w['_t']} {w['emoji']}" if w.get("emoji") else w["_t"]
                add(w["start"], w["end"], active_t + display_t)
        else:  # highlight
            for i, active in enumerate(group):
                pieces = []
                for j, w in enumerate(group):
                    if j == i:
                        active_t = _active_tags(st, custom_color=active.get("custom_color"))
                        display_t = f"{active['_t']} {active['emoji']}" if active.get("emoji") else active["_t"]
                        pieces.append(active_t + display_t + _reset_tags(st))
                    else:
                        pieces.append(w["_t"])
                add(active["start"], active["end"], " ".join(pieces))
    return header + "".join(events)


def write_ass(
    words: List[Dict[str, Any]],
    clip_start: float,
    path: pathlib.Path,
    style: Any = None,
    position: Optional[str] = None,
    play_w: int = 1080,
    play_h: int = 1920,
    hook: Optional[str] = None,
    hook_duration: float = 2.5,
    enable_keywords: bool = True,
    enable_emojis: bool = False,
) -> pathlib.Path:
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        build_ass(
            words,
            clip_start,
            style=style,
            position=position,
            play_w=play_w,
            play_h=play_h,
            hook=hook,
            hook_duration=hook_duration,
            enable_keywords=enable_keywords,
            enable_emojis=enable_emojis,
        ),
        encoding="utf-8",
    )
    return path



def burn_captions(
    video_path: pathlib.Path,
    ass_path: pathlib.Path,
    out_path: pathlib.Path,
    fonts_dir: Optional[pathlib.Path] = FONTS_DIR,
) -> pathlib.Path:
    """
    Burn ASS subtitles into an already-rendered video (used when the video is NOT vertically reframed;
    the vertical path burns captions in the same encode, see ``reframe.render_vertical``).
    """
    video_path, ass_path, out_path = pathlib.Path(video_path), pathlib.Path(ass_path), pathlib.Path(out_path)
    if not video_path.exists():
        raise FileNotFoundError(f"Input video for caption burning not found: {video_path}")
    if not ass_path.exists():
        raise FileNotFoundError(f"Subtitle file not found: {ass_path}")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Run inside the ass directory with relative names: avoids every drive-letter / quote escaping problem.
    from .reframe import _ass_filter  # local import: reframe imports cv2

    ass_filter, cwd = _ass_filter(ass_path, pathlib.Path(fonts_dir) if fonts_dir else None)
    cmd = [
        "ffmpeg", "-loglevel", "error", "-y", "-i", str(video_path.resolve()),
        "-vf", f"{ass_filter},format=yuv420p",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-c:a", "copy", str(out_path.resolve()),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=str(cwd))
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg caption burn failed: {proc.stderr[-1500:]}")
    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError(f"Burned caption video output missing or empty: {out_path}")
    return out_path
