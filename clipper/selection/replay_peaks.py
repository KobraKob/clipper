"""
Core replay-peak detection, windowing, snapping, score fusion, and overlap deduplication.
Reference implementation for H0-H3, H5, H7.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass
class Peak:
    """A detected viewer replay peak with temporal center, intensity, and hump span."""

    time: float        # seconds, centre of the peak bucket
    value: float       # smoothed 0-1
    span_start: float  # where the hump drops below width_fraction * value (left)
    span_end: float    # same, right


def fetch_heatmap(
    url: str,
    *,
    cookies_from_browser: Optional[str] = None,
    cookies_file: Optional[str] = None,
    proxy: Optional[str] = None,
    force_ipv4: bool = False,
    socket_timeout: int = 15,
) -> Tuple[Optional[List[Dict[str, Any]]], Optional[float]]:
    """
    H0. Fetch YouTube "Most replayed" heatmap and duration.
    Never raises; returns (None, None) on any failure or when no heatmap exists.
    """
    try:
        import yt_dlp

        opts: Dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "socket_timeout": socket_timeout,
        }
        if cookies_from_browser:
            opts["cookiesfrombrowser"] = (cookies_from_browser,)
        if cookies_file:
            opts["cookiefile"] = str(cookies_file)
        if proxy:
            opts["proxy"] = proxy
        if force_ipv4:
            opts["source_address"] = "0.0.0.0"

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)

        if not isinstance(info, dict):
            return None, None

        hm = info.get("heatmap")
        dur = info.get("duration")
        return (hm if hm else None), (float(dur) if dur else None)
    except Exception as exc:
        logger.debug("[replay_peaks] fetch_heatmap failed safely: %s", exc)
        return None, None


def _smooth(vals: List[float], k: int = 1) -> List[float]:
    """Moving average smoothing with window radius k."""
    n = len(vals)
    out: List[float] = []
    for i in range(n):
        lo, hi = max(0, i - k), min(n, i + k + 1)
        out.append(sum(vals[lo:hi]) / (hi - lo))
    return out


def find_peaks(
    heatmap: Optional[List[Dict[str, Any]]],
    duration: Optional[float],
    *,
    min_value: float = 0.55,
    edge_ignore_pct: float = 3.0,
    min_gap_sec: float = 45.0,
    width_fraction: float = 0.6,
    max_peaks: int = 10,
    smooth_k: int = 1,
    min_contrast: float = 0.15,
) -> List[Peak]:
    """
    H1 + H2. Strongest-first list of Peak instances.
    Empty list means 'no usable signal' (too few buckets, flat curve, or below threshold).
    """
    if not heatmap or len(heatmap) < 10 or not duration or duration <= 0:
        return []

    hm = sorted(heatmap, key=lambda b: float(b["start_time"]))
    raw = [float(b["value"]) for b in hm]

    if max(raw) - min(raw) < min_contrast:
        return []  # flat curve: nothing stands out

    vals = _smooth(raw, smooth_k)
    mid = [(float(b["start_time"]) + float(b["end_time"])) / 2.0 for b in hm]
    lo_t = duration * (edge_ignore_pct / 100.0)
    hi_t = duration * (1.0 - edge_ignore_pct / 100.0)

    cands: List[int] = []
    for i, v in enumerate(vals):
        left = vals[i - 1] if i > 0 else float("-inf")
        right = vals[i + 1] if i < len(vals) - 1 else float("-inf")
        if v >= min_value and v >= left and v > right and lo_t <= mid[i] <= hi_t:
            cands.append(i)

    # Non-maximum suppression, strongest first
    cands.sort(key=lambda i: vals[i], reverse=True)
    chosen: List[int] = []
    for i in cands:
        if all(abs(mid[i] - mid[j]) >= min_gap_sec for j in chosen):
            chosen.append(i)
        if len(chosen) >= max_peaks:
            break

    peaks: List[Peak] = []
    for i in chosen:
        thr = vals[i] * width_fraction
        l = i
        while l > 0 and vals[l - 1] >= thr:
            l -= 1
        r = i
        while r < len(vals) - 1 and vals[r + 1] >= thr:
            r += 1
        span_s = float(hm[l]["start_time"])
        span_e = float(hm[r]["end_time"])
        peaks.append(Peak(time=mid[i], value=vals[i], span_start=span_s, span_end=span_e))

    return peaks


def build_window(
    peak: Peak,
    duration: float,
    *,
    min_len: float = 30.0,
    max_len: float = 39.0,
    setup_share: float = 0.65,
) -> Tuple[float, float]:
    """
    H3. A min_len..max_len window containing the peak, with more setup before it than tail after.
    Returns (start_sec, end_sec). If video is shorter than min_len, clamps to (0.0, duration).
    """
    if duration <= 0:
        return 0.0, 0.0
    if duration <= min_len:
        return 0.0, duration

    span = peak.span_end - peak.span_start
    target = min(max(span, min_len), max_len)
    start = peak.time - target * setup_share
    end = start + target

    if start < 0:
        start = 0.0
        end = min(target, duration)
    if end > duration:
        end = duration
        start = max(0.0, duration - target)

    return round(start, 2), round(end, 2)


def snap_to_sentences(
    start: float,
    end: float,
    sentences: List[Dict[str, Any]],
    peak_time: float,
    *,
    min_len: float = 30.0,
    max_len: float = 39.0,
    search: float = 8.0,
    min_setup: float = 3.0,
    min_tail: float = 2.0,
    relax: Tuple[float, ...] = (0.0, 4.0),
) -> Tuple[float, float, bool]:
    """
    H5. Snaps start/end onto sentence boundaries within +-search seconds.
    Ensures length is in range and peak is preserved with at least min_setup before and min_tail after.
    Tries strict length range first, then relaxed.
    Returns (start, end, snapped). If unsnapped, returns (start, end, False).
    """
    if not sentences:
        return start, end, False

    for slack in relax:
        best: Optional[Tuple[float, float, float]] = None
        starts = [float(s["start"]) for s in sentences if abs(float(s["start"]) - start) <= search]
        ends = [float(s["end"]) for s in sentences if abs(float(s["end"]) - end) <= search]

        for a in starts:
            for b in ends:
                length = b - a
                if not (min_len - slack <= length <= max_len + slack):
                    continue
                if not (a <= peak_time - min_setup and b >= peak_time + min_tail):
                    continue
                cost = abs(a - start) + abs(b - end)
                if best is None or cost < best[0]:
                    best = (cost, a, b)

        if best is not None:
            return round(best[1], 2), round(best[2], 2), True

    return start, end, False


def fuse_scores(
    heat: Optional[float],
    llm: Optional[float],
    audio: Optional[float],
    w_heat: float = 0.5,
    w_llm: float = 0.35,
    w_audio: float = 0.15,
) -> float:
    """
    H7. Each input is 0-1 or None. Missing inputs are dropped and weights re-normalized.
    Returns 0.0 if all inputs are None.
    """
    parts = [(heat, w_heat), (llm, w_llm), (audio, w_audio)]
    avail = [(v, w) for v, w in parts if v is not None]
    if not avail:
        return 0.0
    total_w = sum(w for _, w in avail)
    if total_w <= 0:
        return 0.0
    return sum(v * w for v, w in avail) / total_w


def pick_non_overlapping(
    clips: List[Dict[str, Any]],
    n: int,
    min_gap: float = 0.0,
) -> List[Dict[str, Any]]:
    """
    H7. clips: [{"start": float, "end": float, "score": float, ...}].
    Highest score first, no overlaps, chronological time-ordered output.
    """
    out: List[Dict[str, Any]] = []
    # Sort descending by score (or final_score)
    sorted_clips = sorted(
        clips,
        key=lambda c: float(c.get("score") if c.get("score") is not None else c.get("final_score", 0.0)),
        reverse=True,
    )
    for c in sorted_clips:
        c_start = float(c["start"])
        c_end = float(c["end"])
        if all(c_end + min_gap <= float(o["start"]) or c_start >= float(o["end"]) + min_gap for o in out):
            out.append(c)
        if len(out) >= n:
            break

    return sorted(out, key=lambda c: float(c["start"]))
