"""
H4 coarse-bucket window refinement using LLM.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from ..providers.base import LLM

logger = logging.getLogger(__name__)


def _parse_int(val: Any) -> Optional[int]:
    """Extract first integer from a value or string."""
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        match = re.search(r"\d+", str(val))
        return int(match.group(0)) if match else None


def refine_window_with_llm(
    span_start: float,
    span_end: float,
    bucket_sec: float,
    sentences: List[Dict[str, Any]],
    llm: Optional[LLM],
    *,
    peak_time: Optional[float] = None,
    min_len: float = 30.0,
    max_len: float = 39.0,
) -> Tuple[Optional[float], Optional[float], Optional[str], bool]:
    """
    H4. Refine coarse hump window into a tight 30-39s short.
    Uses sentences within [span_start - bucket_sec, span_end + bucket_sec].
    Ensures candidate range is focused and the chosen window includes the peak payoff.
    Returns (start_sec, end_sec, reason, refined).
    If LLM is None or produces an invalid window, returns (None, None, None, False).
    """
    if llm is None or not sentences:
        return None, None, None, False

    window_s = max(0.0, span_start - bucket_sec)
    window_e = span_end + bucket_sec

    # Prevent unbounded transcript explosions on broad humps: focus around peak_time
    if peak_time is not None and (window_e - window_s) > 120.0:
        window_s = max(0.0, max(window_s, peak_time - 70.0))
        window_e = min(window_e, peak_time + 45.0)

    # Filter candidate sentences in range
    candidates = [
        s for s in sentences
        if float(s["end"]) >= window_s and float(s["start"]) <= window_e
    ]
    if len(candidates) < 2:
        return None, None, None, False

    numbered_lines = [
        f"{idx} | {s['start']:.1f}-{s['end']:.1f} | {s['text']}"
        for idx, s in enumerate(candidates)
    ]
    numbered_text = "\n".join(numbered_lines)

    prompt = (
        f"This span of a long video is where viewers replay the most. Pick the best {int(min_len)}-{int(max_len)} second window\n"
        f"for a standalone vertical short.\n"
        f"Sentences (index | start-end seconds | text):\n"
        f"{numbered_text}\n\n"
        f'Return ONLY JSON: {{"start_sentence": <int>, "end_sentence": <int>, "reason": "<one sentence>"}}\n'
        f"Rules: the window is {int(min_len)}-{int(max_len)} s (sum of the chosen sentences' time range); start at the sentence where\n"
        f'the setup begins; include the payoff; do not start with a reference to something unseen ("that", "he said").'
    )

    try:
        data = llm.complete_json(prompt, tier="fast")
        if not isinstance(data, dict):
            return None, None, None, False

        start_idx = _parse_int(data.get("start_sentence"))
        end_idx = _parse_int(data.get("end_sentence"))
        reason = str(data.get("reason", "")).strip()

        if start_idx is not None and end_idx is not None and 0 <= start_idx <= end_idx < len(candidates):
            c_start = float(candidates[start_idx]["start"])
            c_end = float(candidates[end_idx]["end"])
            dur = c_end - c_start

            # Must satisfy duration bounds
            if not ((min_len - 3.0) <= dur <= (max_len + 3.0)):
                logger.debug(
                    "[refine] LLM proposed window %.1f-%.1fs (%.1fs) outside bounds %s-%s.",
                    c_start, c_end, dur, min_len, max_len
                )
                return None, None, None, False

            # Must contain peak payoff if peak_time is known
            if peak_time is not None:
                if not (c_start <= peak_time + 1.0 and c_end >= peak_time - 1.0):
                    logger.debug(
                        "[refine] LLM proposed window %.1f-%.1fs missed peak payoff at %.1fs.",
                        c_start, c_end, peak_time
                    )
                    return None, None, None, False

            return round(c_start, 2), round(c_end, 2), reason, True
    except Exception as exc:
        logger.debug("[refine] LLM window refinement failed: %s", exc)

    return None, None, None, False

