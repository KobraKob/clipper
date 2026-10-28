"""
Ingestion: high-resolution downloads via yt-dlp, source probing via ffprobe,
and 16 kHz mono audio extraction via FFmpeg.

Why this module probes before it downloads
------------------------------------------
The previous version forced ``youtube:player_client=tv,android,web`` and used a format
selector that ended in ``/b`` ("best single file"). When the forced clients only exposed
the 360p muxed stream, the selector silently fell through to it and the whole pipeline
ran on a 360p source. Here we:

1. let yt-dlp use its own (maintained) default clients first, then fall back to others,
2. list the formats that are *actually downloadable* (``yt-dlp -J``),
3. pick the best video at or above ``min_height`` (up to ``max_height``) and the best audio,
4. download those exact format ids,
5. verify the downloaded file with ffprobe and record what we really got in
   ``source_info.json`` so the rest of the pipeline (and the UI) can warn honestly.
"""

from __future__ import annotations

import json
import logging
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

VIDEO_EXTS = (".mp4", ".mkv", ".webm", ".mov", ".m4v")
SOURCE_INFO_NAME = "source_info.json"

# Player-client profiles tried in order. The first entry is "let yt-dlp decide", which is what
# yt-dlp maintainers keep working as YouTube changes. Others are fallbacks for videos where the
# defaults only expose low-quality or no formats.
CLIENT_PROFILES: List[Tuple[str, List[str]]] = [
    ("yt-dlp defaults", []),
    ("default+web_safari", ["--extractor-args", "youtube:player_client=default,web_safari"]),
    ("default+tv_downgraded", ["--extractor-args", "youtube:player_client=default,tv_downgraded"]),
    ("default+mweb+android_vr", ["--extractor-args", "youtube:player_client=default,mweb,android_vr"]),
]


# --------------------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------------------


def is_url(source: str) -> bool:
    """Check if the source string represents an HTTP/HTTPS URL."""
    try:
        parsed = urlparse(source.strip())
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


def is_youtube_url(url: str) -> bool:
    try:
        host = (urlparse(url.strip()).hostname or "").lower()
    except Exception:
        return False
    return host == "youtu.be" or host.endswith("youtube.com") or host.endswith("youtube-nocookie.com")


def _get_ytdlp_cmd() -> List[str]:
    """Resolve command to execute yt-dlp safely across environments."""
    which_ytdlp = shutil.which("yt-dlp")
    if which_ytdlp:
        return [which_ytdlp]
    # Fallback to python module execution if yt-dlp.exe is not on system PATH
    return [sys.executable, "-m", "yt_dlp"]


def _get_js_runtime_args() -> List[str]:
    """Detect available JavaScript runtime for yt-dlp YouTube signature/n-challenge solving."""
    if shutil.which("deno"):
        return ["--js-runtimes", "deno"]
    if shutil.which("node"):
        return ["--js-runtimes", "node"]
    return []


def _auth_args(cookies_from_browser: Optional[str], cookies_file: Optional[str]) -> List[str]:
    if cookies_file:
        return ["--cookies", cookies_file]
    if cookies_from_browser:
        return ["--cookies-from-browser", cookies_from_browser]
    return []


def _run_capture(cmd: List[str], timeout: Optional[float] = None) -> subprocess.CompletedProcess:
    """Run a command, capturing text output (UTF-8 safe on Windows)."""
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


_PCT_RE = re.compile(r"\[download\]\s+(\d+(?:\.\d+)?)%")


def _run_streaming(
    cmd: List[str],
    on_progress: Optional[Callable[[float, str], None]] = None,
) -> Tuple[int, str]:
    """
    Run a command and stream its output into the log (throttled to ~5% steps for downloads),
    so long downloads show visible progress in clipper.log / the web studio.
    Returns (returncode, tail_of_output).
    """
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    tail: List[str] = []
    last_bucket = -1
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        tail.append(line)
        if len(tail) > 40:
            tail.pop(0)
        m = _PCT_RE.search(line)
        if m:
            pct = float(m.group(1))
            bucket = int(pct // 5)
            if bucket != last_bucket:
                last_bucket = bucket
                logger.info("[ingest] %s", line)
                if on_progress:
                    try:
                        on_progress(pct, line)
                    except Exception:
                        pass
        elif not line.startswith("[download]"):
            logger.debug("[ingest] %s", line)
    proc.wait()
    return proc.returncode, "\n".join(tail)


# --------------------------------------------------------------------------------------
# Probing local files
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class VideoInfo:
    width: int
    height: int
    fps: float
    duration: float
    codec: str = ""
    pix_fmt: str = ""

    @property
    def short_side(self) -> int:
        return min(self.width, self.height)


def _parse_fps(rate: str) -> float:
    try:
        if "/" in rate:
            num, den = rate.split("/", 1)
            den_f = float(den)
            return float(num) / den_f if den_f else 0.0
        return float(rate)
    except (ValueError, ZeroDivisionError):
        return 0.0


def probe_video(path: pathlib.Path) -> VideoInfo:
    """Read basic stream facts from a video file using ffprobe."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,avg_frame_rate,r_frame_rate,codec_name,pix_fmt:format=duration",
        "-of",
        "json",
        str(path),
    ]
    try:
        res = _run_capture(cmd, timeout=60)
    except FileNotFoundError as exc:
        raise RuntimeError("ffprobe was not found. Install FFmpeg (it ships ffprobe).") from exc
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {res.stderr.strip()}")
    data = json.loads(res.stdout or "{}")
    streams = data.get("streams") or []
    if not streams:
        raise RuntimeError(f"No video stream found in {path}")
    st = streams[0]
    fps = _parse_fps(st.get("avg_frame_rate") or "") or _parse_fps(st.get("r_frame_rate") or "") or 30.0
    try:
        duration = float((data.get("format") or {}).get("duration") or 0.0)
    except (TypeError, ValueError):
        duration = 0.0
    return VideoInfo(
        width=int(st.get("width") or 0),
        height=int(st.get("height") or 0),
        fps=fps,
        duration=duration,
        codec=str(st.get("codec_name") or ""),
        pix_fmt=str(st.get("pix_fmt") or ""),
    )


# --------------------------------------------------------------------------------------
# Format selection (pure logic, unit-tested with fixture format lists)
# --------------------------------------------------------------------------------------


@dataclass
class Attempt:
    expr: str
    height: int
    label: str
    merge_format: Optional[str] = None  # "mp4" | "mkv" | None (single file)


@dataclass
class DownloadPlan:
    attempts: List[Attempt] = field(default_factory=list)
    height: int = 0
    below_target: bool = True
    available_heights: List[int] = field(default_factory=list)


def _short_side(f: Dict[str, Any]) -> int:
    w, h = f.get("width"), f.get("height")
    if isinstance(w, int) and isinstance(h, int) and w > 0 and h > 0:
        return min(w, h)
    return int(h) if isinstance(h, int) and h > 0 else 0


def _has_video(f: Dict[str, Any]) -> bool:
    vcodec = f.get("vcodec")
    if vcodec in (None, "none"):
        return False
    if f.get("ext") == "mhtml" or f.get("protocol") == "mhtml":
        return False
    if "storyboard" in str(f.get("format_note") or "").lower():
        return False
    return _short_side(f) > 0


def _has_audio(f: Dict[str, Any]) -> bool:
    return f.get("acodec") not in (None, "none")


def _is_video_only(f: Dict[str, Any]) -> bool:
    return _has_video(f) and not _has_audio(f)


def _is_sdr(f: Dict[str, Any]) -> bool:
    return str(f.get("dynamic_range") or "SDR").upper() == "SDR"


def _codec_family(vcodec: str) -> str:
    v = (vcodec or "").lower()
    if v.startswith(("avc", "h264")):
        return "avc1"
    if v.startswith(("vp9", "vp09")):
        return "vp9"
    if v.startswith(("av01", "av1")):
        return "av01"
    return v.split(".")[0] or "other"


# H.264 decodes everywhere; VP9 is decoded natively by FFmpeg; AV1 depends on the FFmpeg build.
_CODEC_RANK = {"avc1": 0, "vp9": 1, "av01": 2}


def _video_key(f: Dict[str, Any]) -> Tuple[Any, ...]:
    fps = f.get("fps") or 0
    return (
        -_short_side(f),
        _CODEC_RANK.get(_codec_family(str(f.get("vcodec") or "")), 3),
        -min(float(fps), 60.0),
        -float(f.get("tbr") or f.get("vbr") or 0.0),
        0 if _is_video_only(f) else 1,
    )


def _audio_key(f: Dict[str, Any]) -> Tuple[Any, ...]:
    note = str(f.get("format_note") or "").lower()
    fid = str(f.get("format_id") or "")
    drc = "drc" in note or fid.endswith("-drc")
    return (
        1 if drc else 0,
        -int(f.get("language_preference") or 0),
        0 if "default" in note or "original" in note else 1,
        0 if str(f.get("acodec") or "").lower().startswith("mp4a") else 1,
        -float(f.get("abr") or f.get("tbr") or 0.0),
    )


def _merge_format_for(video: Dict[str, Any], audio: Optional[Dict[str, Any]]) -> str:
    v_ok = _codec_family(str(video.get("vcodec") or "")) == "avc1"
    a_ok = audio is not None and str(audio.get("acodec") or "").lower().startswith(("mp4a", "aac"))
    return "mp4" if v_ok and a_ok else "mkv"


def select_formats(info: Dict[str, Any], min_height: int = 1080, max_height: int = 2160) -> DownloadPlan:
    """
    Choose which formats to download from a yt-dlp info dict.

    Returns attempts ordered best-first. ``height`` is the short side of the best attempt
    (1080 for 1920x1080) and ``below_target`` is True when even the best format is under
    ``min_height``.
    """
    formats: List[Dict[str, Any]] = [f for f in (info.get("formats") or []) if isinstance(f, dict)]
    vids = [f for f in formats if _has_video(f)]
    plan = DownloadPlan(available_heights=sorted({_short_side(f) for f in vids}))
    if not vids:
        return plan

    # Prefer SDR: HDR sources look washed out after a plain SDR re-encode.
    pool = vids
    if any(_is_sdr(f) and _short_side(f) >= min_height for f in vids):
        pool = [f for f in vids if _is_sdr(f)]

    in_range = [f for f in pool if _short_side(f) <= max_height] or pool
    in_range.sort(key=_video_key)

    audios = sorted((f for f in formats if _has_audio(f) and not _has_video(f)), key=_audio_key)
    best_audio = audios[0] if audios else None

    attempts: List[Attempt] = []
    seen_expr: set = set()
    seen_combo: set = set()
    for f in in_range:
        # One attempt per resolution (best codec first). If a 4K format fails to download,
        # the fallback should be a *lower resolution*, not a sibling codec of the same stream.
        combo = _short_side(f)
        if combo in seen_combo:
            continue
        seen_combo.add(combo)
        fid = str(f.get("format_id"))
        if _is_video_only(f):
            if best_audio is None:
                continue  # silent video is useless for transcription
            expr = f"{fid}+{best_audio.get('format_id')}"
            merge = _merge_format_for(f, best_audio)
            label = f"{_short_side(f)}p {_codec_family(str(f.get('vcodec') or ''))} + audio"
        else:
            expr, merge = fid, None
            label = f"{_short_side(f)}p muxed {_codec_family(str(f.get('vcodec') or ''))}"
        if expr in seen_expr:
            continue
        seen_expr.add(expr)
        attempts.append(Attempt(expr=expr, height=_short_side(f), label=label, merge_format=merge))
        if len(attempts) >= 4:
            break

    if attempts:
        plan.height = attempts[0].height
        plan.below_target = plan.height < min_height
    plan.attempts = attempts
    return plan


def generic_selector(min_height: int, max_height: int) -> str:
    """A yt-dlp -f expression used as the very last resort (lets yt-dlp resolve ids itself)."""
    return (
        f"bv*[height>={min_height}][height<={max_height}]+ba"
        f"/bv*[height<={max_height}]+ba"
        f"/b[height<={max_height}]/b"
    )


# --------------------------------------------------------------------------------------
# Downloading
# --------------------------------------------------------------------------------------


def _find_source_file(out_dir: pathlib.Path) -> Optional[pathlib.Path]:
    cands = [
        p
        for p in out_dir.glob("source.*")
        if p.suffix.lower() in VIDEO_EXTS and not p.name.endswith((".part", ".ytdl"))
    ]
    if not cands:
        return None
    return max(cands, key=lambda p: p.stat().st_mtime)


def _is_dns_or_connection_error(text: str) -> bool:
    low = text.lower()
    return any(
        err in low
        for err in (
            "getaddrinfo failed",
            "errno 11001",
            "failed to resolve",
            "name or service not known",
            "temporary failure in name resolution",
            "connection refused",
            "network is unreachable",
            "timed out",
        )
    )


def _probe_url_info(
    url: str,
    profile_args: List[str],
    base_args: List[str],
    retries: int = 3,
    socket_timeout: int = 30,
) -> Dict[str, Any]:
    net_args = [
        "--retries",
        str(retries),
        "--extractor-retries",
        str(retries),
        "--socket-timeout",
        str(socket_timeout),
    ]
    cmd = _get_ytdlp_cmd() + base_args + net_args + profile_args + ["-J", "--no-playlist", "--no-warnings", url]
    res = _run_capture(cmd, timeout=180)
    if res.returncode != 0:
        err_text = (res.stderr or res.stdout or "yt-dlp probe failed").strip()
        # Auto-retry with forced IPv4 if getaddrinfo / DNS resolution failed and -4 wasn't already passed
        if "--force-ipv4" not in cmd and "-4" not in cmd and _is_dns_or_connection_error(err_text):
            logger.info("[ingest] Probe hit network/DNS resolution issue; retrying with IPv4 forced (--force-ipv4)...")
            ipv4_cmd = _get_ytdlp_cmd() + base_args + ["--force-ipv4"] + net_args + profile_args + ["-J", "--no-playlist", "--no-warnings", url]
            res_retry = _run_capture(ipv4_cmd, timeout=180)
            if res_retry.returncode == 0:
                if "--force-ipv4" not in base_args and "-4" not in base_args:
                    base_args.append("--force-ipv4")
                return json.loads(res_retry.stdout)
            err_text = (res_retry.stderr or res_retry.stdout or err_text).strip()
        raise RuntimeError(err_text[-800:])
    return json.loads(res.stdout)


def _hint_for_error(text: str) -> str:
    low = text.lower()
    if "getaddrinfo failed" in low or "errno 11001" in low or "failed to resolve" in low or "temporary failure in name resolution" in low:
        return (
            " Hint: DNS / network resolution failed ([Errno 11001] getaddrinfo failed). Check your internet connection "
            "and DNS settings. If your network/ISP has IPv6 routing issues, enable IPv4 mode by setting "
            "YTDLP_FORCE_IPV4=true in .env or passing --force-ipv4."
        )
    if "connection refused" in low or "network is unreachable" in low or "proxy" in low:
        return (
            " Hint: Network connection failed. If you require a proxy to access YouTube, configure "
            "YTDLP_PROXY=http://your-proxy:port in .env."
        )
    if "sign in to confirm" in low or "not a bot" in low or "cookies" in low:
        return (
            " Hint: YouTube is asking for a signed-in session. Set YTDLP_COOKIES_FROM_BROWSER=chrome "
            "(or edge/firefox) in .env, or export cookies to a file and set YTDLP_COOKIES_FILE."
        )
    if "n challenge" in low or "javascript runtime" in low or "ejs" in low:
        return (
            " Hint: yt-dlp needs a JavaScript runtime (Deno or Node.js) and the yt-dlp-ejs solver. "
            'Install Node.js or Deno and run `pip install -U "yt-dlp[default]"`.'
        )
    if "ffmpeg" in low and "not found" in low:
        return " Hint: FFmpeg must be installed and on PATH to merge video and audio."
    return ""


def _write_source_info(out_dir: pathlib.Path, payload: Dict[str, Any]) -> None:
    try:
        (out_dir / SOURCE_INFO_NAME).write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    except OSError as exc:  # non-fatal
        logger.warning("[ingest] Could not write %s: %s", SOURCE_INFO_NAME, exc)


def load_source_info(out_dir: pathlib.Path) -> Dict[str, Any]:
    """Return the saved source metadata for a job directory ({} if none)."""
    p = pathlib.Path(out_dir) / SOURCE_INFO_NAME
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _summarise_info(info: Dict[str, Any]) -> Dict[str, Any]:
    chapters = [
        {"start": c.get("start_time"), "end": c.get("end_time"), "title": c.get("title")}
        for c in (info.get("chapters") or [])
        if isinstance(c, dict)
    ]
    return {
        "title": info.get("title"),
        "channel": info.get("channel") or info.get("uploader"),
        "description": (info.get("description") or "")[:1500],
        "tags": (info.get("tags") or [])[:30],
        "categories": info.get("categories") or [],
        "duration": info.get("duration"),
        "upload_date": info.get("upload_date"),
        "webpage_url": info.get("webpage_url"),
        "language": info.get("language"),
        "chapters": chapters,
    }


def download(
    url: str,
    out_dir: pathlib.Path,
    min_height: int = 1080,
    max_height: int = 2160,
    cookies_from_browser: Optional[str] = None,
    cookies_file: Optional[str] = None,
    allow_remote_components: Optional[bool] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    force_ipv4: Optional[bool] = None,
    proxy: Optional[str] = None,
    socket_timeout: Optional[int] = None,
    retries: Optional[int] = None,
) -> pathlib.Path:
    """
    Download ``url`` into ``out_dir`` as ``source.<ext>`` at the best available quality.

    Targets at least ``min_height`` (short side, e.g. 1080 for 1920x1080) and up to ``max_height``.
    If the video simply does not offer that much, the best available is used and the shortfall
    is recorded in ``source_info.json`` (``below_target: true``) instead of failing.
    """
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    cookies_from_browser = cookies_from_browser or os.getenv("YTDLP_COOKIES_FROM_BROWSER") or None
    cookies_file = cookies_file or os.getenv("YTDLP_COOKIES_FILE") or None
    if allow_remote_components is None:
        allow_remote_components = os.getenv("YTDLP_ALLOW_REMOTE_COMPONENTS", "").lower() in ("1", "true", "yes")

    if force_ipv4 is None:
        force_ipv4 = os.getenv("YTDLP_FORCE_IPV4", "").lower() in ("1", "true", "yes", "on")
    if proxy is None:
        proxy = os.getenv("YTDLP_PROXY", "").strip() or None
    if socket_timeout is None:
        try:
            socket_timeout = int(os.getenv("YTDLP_SOCKET_TIMEOUT", "30"))
        except (ValueError, TypeError):
            socket_timeout = 30
    if retries is None:
        try:
            retries = int(os.getenv("YTDLP_RETRIES", "5"))
        except (ValueError, TypeError):
            retries = 5

    # ---- Reuse a cached download only if it already meets the quality target ----
    existing = _find_source_file(out_dir)
    stale_backup: Optional[pathlib.Path] = None
    if existing is not None:
        try:
            have = probe_video(existing)
        except Exception:
            have = None
        if have is not None and have.short_side >= min_height:
            logger.info("[ingest] Reusing cached source %s (%dx%d).", existing.name, have.width, have.height)
            return existing
        logger.info(
            "[ingest] Cached source is %s; re-downloading to reach >= %dp.",
            f"{have.width}x{have.height}" if have else "unreadable",
            min_height,
        )
        stale_backup = existing.with_name(existing.name + ".old")
        try:
            existing.replace(stale_backup)
        except OSError:
            stale_backup = None

    base_args = _get_js_runtime_args() + _auth_args(cookies_from_browser, cookies_file)
    if allow_remote_components:
        base_args += ["--remote-components", "ejs:github"]
    if force_ipv4:
        base_args += ["--force-ipv4"]
    if proxy:
        base_args += ["--proxy", proxy]
    base_args += ["--socket-timeout", str(socket_timeout)]

    profiles = CLIENT_PROFILES if is_youtube_url(url) else CLIENT_PROFILES[:1]
    plans: List[Tuple[str, List[str], DownloadPlan, Dict[str, Any]]] = []
    probe_errors: List[str] = []

    for label, profile_args in profiles:
        try:
            if progress_callback:
                try:
                    progress_callback(0.0, f"Probing available formats ({label})...")
                except Exception:
                    pass
            logger.info("[ingest] Probing available formats (%s)...", label)
            info = _probe_url_info(url, profile_args, base_args, retries=retries, socket_timeout=socket_timeout)
        except Exception as exc:
            err_msg = str(exc)
            probe_errors.append(f"{label}: {err_msg}")
            logger.warning("[ingest] Probe via %s failed: %s", label, err_msg[:300])
            if _is_dns_or_connection_error(err_msg):
                time.sleep(1.0)
            continue
        plan = select_formats(info, min_height=min_height, max_height=max_height)
        logger.info(
            "[ingest] %s offers heights %s -> best %sp",
            label,
            plan.available_heights or "none",
            plan.height or "n/a",
        )
        if plan.attempts:
            plans.append((label, profile_args, plan, info))
            if not plan.below_target:
                break

    # Best plan first (highest resolution wins; earlier profile wins ties)
    plans.sort(key=lambda item: -item[2].height)

    last_error = ""
    chosen: Optional[Tuple[str, Attempt, Dict[str, Any], DownloadPlan]] = None
    tmpl = str(out_dir / "source.%(ext)s")
    common = [
        "--no-playlist",
        "--no-warnings",
        "--newline",
        "--no-mtime",
        "--retries",
        str(retries),
        "--fragment-retries",
        "10",
        "-N",
        "4",
        "-o",
        tmpl,
    ]

    def _try(label: str, profile_args: List[str], attempt: Attempt) -> bool:
        nonlocal last_error
        if progress_callback:
            try:
                progress_callback(1.0, f"Starting download: {attempt.label}...")
            except Exception:
                pass
        cmd = _get_ytdlp_cmd() + base_args + profile_args + ["-f", attempt.expr]
        if attempt.merge_format:
            cmd += ["--merge-output-format", attempt.merge_format]
        cmd += common + [url]
        logger.info("[ingest] Downloading %s via %s ...", attempt.label, label)
        try:
            if progress_callback is not None:
                try:
                    code, tail = _run_streaming(cmd, on_progress=progress_callback)
                except TypeError:
                    code, tail = _run_streaming(cmd)
            else:
                code, tail = _run_streaming(cmd)
        except FileNotFoundError as exc:
            raise RuntimeError("Neither the yt-dlp executable nor `python -m yt_dlp` could be run.") from exc
        if code == 0 and _find_source_file(out_dir) is not None:
            return True
        last_error = tail or f"yt-dlp exited with code {code}"
        logger.warning("[ingest] Download attempt (%s) failed: %s", attempt.label, last_error[-300:])
        # Remove partial/incorrect leftovers so the next attempt starts clean
        for p in out_dir.glob("source.*"):
            if p.suffix.lower() in VIDEO_EXTS or p.name.endswith((".part", ".ytdl")):
                try:
                    p.unlink()
                except OSError:
                    pass
        return False

    for label, profile_args, plan, info in plans:
        for attempt in plan.attempts:
            if _try(label, profile_args, attempt):
                chosen = (label, attempt, info, plan)
                break
        if chosen:
            break

    if chosen is None:
        # Last resort: let yt-dlp resolve ids by itself with the default clients.
        fallback = Attempt(expr=generic_selector(min_height, max_height), height=0, label="generic selector", merge_format="mkv")
        if _try("yt-dlp defaults", [], fallback):
            chosen = ("yt-dlp defaults", fallback, plans[0][3] if plans else {}, plans[0][2] if plans else DownloadPlan())

    if chosen is None:
        if stale_backup is not None and stale_backup.exists():
            try:
                stale_backup.replace(stale_backup.with_name(stale_backup.name[: -len(".old")]))
            except OSError:
                pass
        detail = last_error or "; ".join(probe_errors) or "unknown error"
        raise RuntimeError(f"yt-dlp failed to download video from {url}: {detail[-900:]}{_hint_for_error(detail)}")

    label, attempt, info, plan = chosen
    out_path = _find_source_file(out_dir)
    assert out_path is not None

    if stale_backup is not None:
        try:
            stale_backup.unlink()
        except OSError:
            pass

    # ---- Verify what we really got ----
    got: Optional[VideoInfo] = None
    try:
        got = probe_video(out_path)
    except Exception as exc:
        logger.warning("[ingest] Could not probe downloaded file: %s", exc)

    below = bool(got and got.short_side < min_height)
    if got:
        logger.info("[ingest] Downloaded %s: %dx%d @ %.2f fps (%s)", out_path.name, got.width, got.height, got.fps, got.codec)
        if below:
            logger.warning(
                "[ingest] Source is only %dp (target was >= %dp). The vertical clip will look soft; "
                "the video may simply not offer a higher resolution.",
                got.short_side,
                min_height,
            )

    payload = _summarise_info(info)
    payload.update(
        {
            "url": url,
            "client_profile": label,
            "format": attempt.expr,
            "available_heights": plan.available_heights,
            "target_min_height": min_height,
            "below_target": below,
            "downloaded": (
                {"width": got.width, "height": got.height, "fps": got.fps, "codec": got.codec} if got else None
            ),
        }
    )
    _write_source_info(out_dir, payload)
    return out_path


# --------------------------------------------------------------------------------------
# Audio extraction
# --------------------------------------------------------------------------------------


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
