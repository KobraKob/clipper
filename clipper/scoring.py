"""
Two-stage LLM scoring and deduplication for candidate clips.
Stage 1: Fast model batched screening.
Stage 2: Strong model detailed evaluation (score, hook, title, editorial reason).
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .candidates import calculate_iou
from .config import settings
from .providers.base import LLM

logger = logging.getLogger(__name__)

FAST_PROMPT = """You screen excerpts for short-form video clips (TikTok/Reels/Shorts).
Rate EACH excerpt 0-100 on how well it works as a standalone clip: strong hook in the
first 3 seconds, self-contained idea, emotion/surprise/insight/humor, clear payoff, no
outside context needed. Be strict and use the full range; most excerpts should be below 60.
Return ONLY valid JSON: {"scores": [{"id": 0, "score": 45}, {"id": 1, "score": 82}]}

Excerpts:
"""

DETAIL_PROMPT = """You are an editor picking short-form viral clips (TikTok/Reels/Shorts).
Rate the transcript excerpt from 0-100 on how well it works as a standalone vertical clip.
Judge on:
1. Hook strength in the first 3 seconds
2. Self-contained idea that does not cut off awkwardly
3. Emotional resonance, surprise, humour, or deep insight
4. Satisfying payoff before the end

Return ONLY valid JSON with keys:
{
  "score": <integer 0-100>,
  "hook": "<exact or polished first line that grabs attention>",
  "title": "<short punchy 3-6 word title>",
  "reason": "<one sentence explaining why this works as a clip>"
}

Transcript:
\"\"\"{text}\"\"\"
"""


def stage1(
    cands: List[Dict[str, Any]],
    llm: LLM,
    batch_size: int = 5,
) -> List[Dict[str, Any]]:
    """
    Stage 1: Fast model evaluates candidates in batches of 5 to preserve API rate limits and tokens.
    """
    if not cands:
        return []

    for k in range(0, len(cands), batch_size):
        group = cands[k : k + batch_size]
        body = "\n\n".join(f"[{i}] {c['text']}" for i, c in enumerate(group))
        prompt = FAST_PROMPT + body

        try:
            out = llm.complete_json(prompt, tier="fast")
            scores_list = out.get("scores", [])
            for item in scores_list:
                idx = item.get("id")
                if isinstance(idx, int) and 0 <= idx < len(group):
                    try:
                        group[idx]["fast_score"] = int(item.get("score", 0))
                    except (ValueError, TypeError):
                        group[idx]["fast_score"] = 0
        except Exception as exc:
            logger.warning("[scoring] Stage 1 batch %d failed: %s; falling back to heuristic.", k, exc)
            for item in group:
                item.setdefault("fast_score", int(item.get("heuristic_score", 40)))

    for c in cands:
        c.setdefault("fast_score", 0)

    return cands


def stage2(
    cand: Dict[str, Any],
    llm: LLM,
    analytics_context: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Stage 2: Strong model scores a shortlisted candidate in depth, generating titles and hooks,
    optionally guided by channel analytics feedback.
    """
    prompt = DETAIL_PROMPT.replace("{text}", cand["text"])
    if analytics_context:
        prompt = f"{analytics_context}\n\n{prompt}"

    try:
        out = llm.complete_json(prompt, tier="strong")
        cand["score"] = int(out.get("score", cand.get("fast_score", 50)))
        cand["hook"] = str(out.get("hook", cand["text"].split(".")[0]))
        cand["title"] = str(out.get("title", "High-Impact Clip"))
        cand["reason"] = str(out.get("reason", "Selected based on high retention signals."))
    except Exception as exc:
        logger.warning("[scoring] Stage 2 item scoring failed: %s; using defaults.", exc)
        cand["score"] = int(cand.get("fast_score", 50))
        cand["hook"] = cand["text"].split(".")[0]
        cand["title"] = "Featured Clip"
        cand["reason"] = "Candidate selected by Stage 1 screening."

    return cand


def select_top(
    items: List[Dict[str, Any]],
    n: int,
    key: str = "score",
    max_overlap: float = 0.3,
) -> List[Dict[str, Any]]:
    """
    Greedy selection of top items with temporal IoU deduplication.
    Ensures final clips do not overlap significantly in time.
    """
    picked: List[Dict[str, Any]] = []
    sorted_items = sorted(items, key=lambda x: x.get(key, 0), reverse=True)

    for cand in sorted_items:
        if all(calculate_iou(cand, p) < max_overlap for p in picked):
            picked.append(cand)
        if len(picked) == n:
            break

    return picked


def rank(
    candidates: List[Dict[str, Any]],
    llm: LLM,
    n: int = 5,
    shortlist_size: Optional[int] = None,
    analytics_context: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Two-stage ranking pipeline:
    1. Fast model scores all candidates in batches.
    2. Deduplicate and keep top `shortlist_size` items.
    3. Strong model scores the shortlist in detail (optionally guided by analytics feedback).
    4. Deduplicate and return final top N clips.
    """
    if not candidates:
        return []

    target_shortlist = shortlist_size if shortlist_size is not None else settings.shortlist

    # Stage 1: Batch screening
    stage1(candidates, llm)

    # Deduplicate BEFORE paying for expensive Stage 2
    shortlist = select_top(candidates, target_shortlist, key="fast_score", max_overlap=0.3)

    # Stage 2: Deep evaluation on the shortlist
    for cand in shortlist:
        stage2(cand, llm, analytics_context=analytics_context)

    # Final selection: Top N by Stage 2 score
    final_clips = select_top(shortlist, n, key="score", max_overlap=0.3)
    return final_clips

