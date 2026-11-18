"""
H6 LLM check: validates standalone coherence, payoff inclusion, hook strength, and adjustments.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from ..providers.base import LLM

logger = logging.getLogger(__name__)


@dataclass
class LLMCheckResult:
    keep: bool
    start: float
    end: float
    llm_score: Optional[float]
    reason: str
    warnings: List[str] = field(default_factory=list)


def check_clip_with_llm(
    start: float,
    end: float,
    peak_time: float,
    sentences: List[Dict[str, Any]],
    llm: Optional[LLM],
    *,
    min_len: float = 30.0,
    max_len: float = 39.0,
) -> LLMCheckResult:
    """
    H6. Evaluates proposed clip for standalone retention and payoff inclusion.
    Retries once on JSON/network failure; if still failing, returns keep=True with llm_score=None.
    """
    if llm is None or not sentences:
        return LLMCheckResult(
            keep=True,
            start=start,
            end=end,
            llm_score=None,
            reason="LLM check skipped (no LLM provided).",
        )

    # 1. Identify context before (<= 15s), proposed clip sentences, and context after (<= 15s)
    ctx_before: List[Dict[str, Any]] = []
    clip_sents: List[Dict[str, Any]] = []
    ctx_after: List[Dict[str, Any]] = []

    for s in sentences:
        s_start = float(s["start"])
        s_end = float(s["end"])
        if s_end <= start and s_end >= start - 15.0:
            ctx_before.append(s)
        elif s_start < end and s_end > start:
            clip_sents.append(s)
        elif s_start >= end and s_start <= end + 15.0:
            ctx_after.append(s)

    # Ensure clip_sents is not empty
    if not clip_sents:
        # Fallback to closest sentence
        clip_sents = [min(sentences, key=lambda s: abs(float(s["start"]) - start))]

    all_pool = ctx_before + clip_sents + ctx_after
    idx_map = {id(s): i for i, s in enumerate(all_pool)}

    def format_list(sents: List[Dict[str, Any]]) -> str:
        if not sents:
            return "(none)"
        return "\n".join(f"{idx_map[id(s)]} | {s['start']:.1f}-{s['end']:.1f} | {s['text']}" for s in sents)

    m, sec = divmod(int(peak_time), 60)
    peak_time_mmss = f"{m:02d}:{sec:02d}"

    prompt = (
        f"You are editing a vertical short ({int(min_len)}-{int(max_len)} s) from a longer video.\n"
        f"Viewers replay the moment around {peak_time_mmss} the most in the original, so that moment is the payoff.\n\n"
        f"Proposed clip, as numbered sentences with timestamps:\n{format_list(clip_sents)}\n\n"
        f"Context before (up to 15 s):\n{format_list(ctx_before)}\n\n"
        f"Context after (up to 15 s):\n{format_list(ctx_after)}\n\n"
        f"Return ONLY JSON:\n"
        f"{{\n"
        f'  "self_contained": true,\n'
        f'  "payoff_included": true,\n'
        f'  "hook_score": 7,\n'
        f'  "start_sentence": {idx_map[id(clip_sents[0])]},\n'
        f'  "end_sentence": {idx_map[id(clip_sents[-1])]},\n'
        f'  "drop": false,\n'
        f'  "reason": "<one sentence>"\n'
        f"}}\n"
        f"Rules: stay within {int(min_len)}-{int(max_len)} s; keep the payoff; prefer starting where the setup begins; avoid opening on a\n"
        f"pronoun or reference to unseen context if an earlier sentence fixes it."
    )

    # Retry once on failure
    data: Optional[Dict[str, Any]] = None
    for attempt in range(2):
        try:
            res = llm.complete_json(prompt, tier="strong")
            if isinstance(res, dict):
                data = res
                break
        except Exception as exc:
            logger.debug("[llm_check] Attempt %d failed: %s", attempt + 1, exc)

    if data is None:
        logger.warning("[llm_check] LLM check failed after retry; keeping clip with llm_score=None.")
        return LLMCheckResult(
            keep=True,
            start=start,
            end=end,
            llm_score=None,
            reason="LLM check unconfirmed due to API error.",
        )

    drop = bool(data.get("drop", False))
    payoff_included = bool(data.get("payoff_included", True))
    self_contained = bool(data.get("self_contained", True))
    hook_score = float(data.get("hook_score", 5.0))
    reason = str(data.get("reason", "")).strip()

    if drop or not payoff_included:
        return LLMCheckResult(
            keep=False,
            start=start,
            end=end,
            llm_score=0.0,
            reason=reason or ("Dropped by editor" if drop else "Payoff missing"),
        )

    # Check adjustment indexes (apply once)
    warnings: List[str] = []
    final_start = start
    final_end = end

    try:
        raw_s = data.get("start_sentence")
        raw_e = data.get("end_sentence")
        if raw_s is not None and raw_e is not None:
            import re

            def _parse_idx(v: Any) -> Optional[int]:
                try:
                    return int(v)
                except (ValueError, TypeError):
                    m = re.search(r"\d+", str(v))
                    return int(m.group(0)) if m else None

            s_idx = _parse_idx(raw_s)
            e_idx = _parse_idx(raw_e)

            if s_idx is not None and e_idx is not None:
                orig_s_idx = idx_map.get(id(clip_sents[0]))
                orig_e_idx = idx_map.get(id(clip_sents[-1]))
                is_actual_adjustment = (s_idx != orig_s_idx or e_idx != orig_e_idx)

                if 0 <= s_idx <= e_idx < len(all_pool):
                    cand_s = float(all_pool[s_idx]["start"])
                    cand_e = float(all_pool[e_idx]["end"])
                    cand_dur = cand_e - cand_s
                    # Must be in valid bounds and contain the peak payoff
                    if (min_len - 2.0) <= cand_dur <= (max_len + 3.0) and cand_s <= peak_time and cand_e >= peak_time:
                        final_start = round(cand_s, 2)
                        final_end = round(cand_e, 2)
                    elif is_actual_adjustment:
                        warnings.append("llm_adjustment_ignored")
                elif is_actual_adjustment:
                    warnings.append("llm_adjustment_ignored")
    except Exception as exc:
        logger.debug("[llm_check] Adjustment parse error: %s", exc)


    # Score calculation per spec:
    # llm_score = 0.6 * (hook_score / 10) + 0.4 * (1 if self_contained and payoff_included else 0)
    score_comp = 0.6 * (min(10.0, max(0.0, hook_score)) / 10.0)
    coherence_comp = 0.4 * (1.0 if (self_contained and payoff_included) else 0.0)
    llm_score = round(score_comp + coherence_comp, 4)

    return LLMCheckResult(
        keep=True,
        start=final_start,
        end=final_end,
        llm_score=llm_score,
        reason=reason or f"Hook {hook_score:.1f}/10, self-contained short.",
        warnings=warnings,
    )
