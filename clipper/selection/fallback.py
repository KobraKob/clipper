"""
LLM-only fallback candidate generator when replay heatmap is unavailable or flat.
Section 6 implementation.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from ..candidates import score_hook
from ..providers.base import LLM
from .replay_peaks import pick_non_overlapping

logger = logging.getLogger(__name__)

AD_READ_PATTERNS = [
    re.compile(
        r"\b(sponsor(ed|s|ship)?|promo\s+code|coupon\s+code|discount\s+code|use\s+(my\s+)?code|"
        r"link\s+in\s+(the\s+)?description|link\s+down\s+below|brought\s+to\s+you\s+by|patreon|"
        r"affiliate\s+link|check\s+out\s+(the\s+)?link|patrocinad[oa]|código\s+de\s+descuento)\b",
        re.IGNORECASE,
    ),
    re.compile(r"(प्रायोजक|छूट\s+कोड)"),
]


def is_ad_or_sponsor(text: str) -> bool:
    """Detect sponsor / ad pitch in text."""
    return any(p.search(text) for p in AD_READ_PATTERNS)


def build_sentence_windows(
    sentences: List[Dict[str, Any]],
    min_len: float = 30.0,
    max_len: float = 39.0,
    step_sec: float = 10.0,
) -> List[Dict[str, Any]]:
    """
    Generate overlapping 30-39s candidate windows aligned strictly to sentence boundaries.
    Advances by approximately step_sec (default 10s).
    """
    if not sentences:
        return []

    windows: List[Dict[str, Any]] = []
    n = len(sentences)
    last_start_time = -step_sec

    for i in range(n):
        s_start = float(sentences[i]["start"])
        if s_start - last_start_time < (step_sec - 1.0):
            continue

        accum_text: List[str] = []
        for j in range(i, n):
            s_end = float(sentences[j]["end"])
            dur = s_end - s_start
            accum_text.append(str(sentences[j]["text"]))

            if dur > max_len:
                break
            if dur >= min_len:
                full_text = " ".join(accum_text).strip()
                windows.append({
                    "start": round(s_start, 2),
                    "end": round(s_end, 2),
                    "duration": round(dur, 2),
                    "text": full_text,
                    "first_text": sentences[i]["text"],
                    "start_idx": i,
                    "end_idx": j,
                })
                last_start_time = s_start
                break

    return windows


def score_windows_with_llm(
    windows: List[Dict[str, Any]],
    llm: Optional[LLM],
    batch_size: int = 6,
) -> List[Dict[str, Any]]:
    """
    Score surviving candidate windows with LLM in batches on hook, self-containedness, and value.
    Falls back to heuristic scoring if LLM is unavailable or encounters errors.
    """
    if not windows:
        return []

    scored: List[Dict[str, Any]] = []

    # If no LLM, use cheap acoustic/heuristic fallback
    if llm is None:
        for w in windows:
            h_score = score_hook(w.get("first_text", w["text"]))
            words = w["text"].split()
            wps = len(words) / max(1.0, w["duration"])
            speech_factor = 1.0 if 2.0 <= wps <= 4.0 else 0.7
            final_h = round(min(1.0, max(0.1, (0.7 * h_score + 0.3 * speech_factor))), 4)
            scored.append({
                **w,
                "llm_score": final_h,
                "score": final_h,
                "reason": "Heuristic fallback score.",
            })
        return scored

    # Batch LLM scoring
    for b_idx in range(0, len(windows), batch_size):
        batch = windows[b_idx : b_idx + batch_size]
        items_text = []
        for local_id, cand in enumerate(batch):
            items_text.append(f"[{local_id}] ({cand['duration']}s): {cand['text']}")

        prompt = (
            "You are an expert short-form video editor evaluating candidate excerpts (30-39s) for YouTube Shorts.\n"
            "Score each excerpt from 0.0 to 1.0 based on:\n"
            "- Hook strength in the first 3 seconds\n"
            "- Self-contained clarity (understandable without full context)\n"
            "- Viewer payoff and emotional/insight value\n\n"
            "Candidate excerpts:\n"
            + "\n\n".join(items_text)
            + "\n\nReturn ONLY JSON:\n"
            '{"scores": [{"id": 0, "score": 0.85, "hook": "<opening hook>", "reason": "<one sentence>"}]}'
        )

        batch_scores: Dict[int, Dict[str, Any]] = {}
        try:
            res = llm.complete_json(prompt, tier="fast")
            if isinstance(res, dict) and "scores" in res and isinstance(res["scores"], list):
                for item in res["scores"]:
                    if isinstance(item, dict) and "id" in item:
                        batch_scores[int(item["id"])] = item
        except Exception as exc:
            logger.debug("[fallback] Batch LLM scoring error: %s", exc)

        for local_id, cand in enumerate(batch):
            item_data = batch_scores.get(local_id)
            if item_data and "score" in item_data:
                try:
                    raw_score = float(item_data["score"])
                    if raw_score > 1.0:
                        raw_score = raw_score / 100.0
                    s_val = round(max(0.0, min(1.0, raw_score)), 4)
                except (ValueError, TypeError):
                    s_val = 0.5
                reason = str(item_data.get("reason", "Selected by LLM fallback")).strip()
                hook = str(item_data.get("hook", "")).strip()
                title = str(item_data.get("title", "")).strip()
                if not title:
                    first_words = [w.strip(".,!?") for w in cand.get("first_text", cand["text"]).split()[:6] if w.strip(".,!?")]
                    title = " ".join(first_words).title() if first_words else ""
            else:
                # Heuristic fallback for missed item
                h_score = score_hook(cand.get("first_text", cand["text"]))
                s_val = round(max(0.2, min(0.9, h_score)), 4)
                reason = "Heuristic hook fallback."
                hook = cand.get("first_text", "")
                first_words = [w.strip(".,!?") for w in cand.get("first_text", cand["text"]).split()[:6] if w.strip(".,!?")]
                title = " ".join(first_words).title() if first_words else ""

            scored.append({
                **cand,
                "llm_score": s_val,
                "score": s_val,
                "reason": reason,
                "hook": hook,
                "title": title,
            })

    return scored


def run_fallback_selection(
    sentences: List[Dict[str, Any]],
    n_clips: int,
    llm: Optional[LLM] = None,
    min_len: float = 30.0,
    max_len: float = 39.0,
    warnings: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Generate clips when heatmap signal is absent or flat.
    Filters cheap noise/ads, scores with LLM, and picks top non-overlapping clips.
    """
    raw_windows = build_sentence_windows(sentences, min_len=min_len, max_len=max_len, step_sec=10.0)
    if not raw_windows:
        return []

    # Pre-filter cheaply: drop mostly silence/music or ad/sponsor reads
    surviving: List[Dict[str, Any]] = []
    base_warnings = list(warnings or [])

    for w in raw_windows:
        text = w["text"]
        words = text.split()
        dur = w["duration"]
        wps = len(words) / max(0.5, dur)

        # Drop dead air / music only (less than 1.0 word per second)
        if wps < 1.0 or len(words) < 15:
            continue

        # Drop ad reads
        if is_ad_or_sponsor(text):
            continue

        surviving.append(w)

    if not surviving:
        # Fall back to raw windows if strict prefilter dropped everything
        surviving = raw_windows[:15]

    scored = score_windows_with_llm(surviving, llm)
    picked = pick_non_overlapping(scored, n=n_clips, min_gap=0.0)

    results: List[Dict[str, Any]] = []
    for c in picked:
        item = dict(c)
        item["source"] = "llm"
        item["warnings"] = list(dict.fromkeys(base_warnings))
        item["final_score"] = item.get("llm_score", 0.5)
        results.append(item)

    return results
