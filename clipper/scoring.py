"""Robust two-stage short-form scoring with a deterministic quality rubric.

LLM scores are treated as evidence, not ground truth: invalid/missing scores fall back to
local signals, results are blended with heuristic evidence, and final choices are de-duplicated
by timeline overlap.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from .candidates import calculate_iou
from .config import settings
from .providers.base import LLM

logger = logging.getLogger(__name__)

WEIGHTS = {
    "hook_strength": 0.18,
    "standalone_context": 0.14,
    "payoff": 0.15,
    "emotional_resonance": 0.12,
    "specificity": 0.12,
    "clarity": 0.12,
    "pacing": 0.09,
    "originality": 0.08,
}
_STOP = set(
    """a an the and or but if so to of in on at for with from by as is are was were be been being
    it its this that these those i you he she we they me him her us them my your his our their
    not no yes do does did done have has had will would can could should just like really very
    about into than then there here what when where who whom why how all any some more most other
    out up down over under again also get got going gonna thing things know think say said says
    yeah okay right well one two about then they them""".split()
)
_HOOK_CUES = (
    "why", "how", "stop", "never", "secret", "mistake", "truth", "because", "but", "until",
    "instead", "imagine", "what if", "the problem", "the reason", "most people", "nobody",
    "the biggest", "here is", "here's", "watch", "listen", "remember", "surprising",
)
_EMOTION_CUES = (
    "surprising", "shocking", "funny", "fear", "love", "hate", "fail", "win", "secret",
    "danger", "risk", "mistake", "believe", "incredible", "important", "regret", "change",
    "money", "easy", "hard", "never", "always", "success", "why",
)
_BAD_ENDINGS = ("and", "but", "because", "with", "to", "for", "or", "of", "that", "which")


FAST_PROMPT = """You are a strict short-form video editor screening candidate excerpts for standalone watchability.
Score each excerpt from 0 to 100. Use the full range. Most ordinary excerpts should score below 60.
Evaluate: opening hook, self-contained context, concrete insight/story, payoff, clarity, emotional
response, pacing, and whether the ending feels complete. Penalize unfinished setup, vague claims,
repetition, long throat-clearing, missing context, and cut-off sentences. Do not reward buzzwords
or invent context. Judge only the supplied excerpt.

Return ONLY JSON: {"scores":[{"id":0,"score":48},{"id":1,"score":76}]}

Candidate excerpts:
"""

DETAIL_PROMPT = """You are a senior editor selecting short-form clips that work on their own.
Score only what is evidenced in the supplied transcript. Do not mistake sensational language for
a strong hook. Penalize a missing payoff, unclear pronouns/context, repetition, a dead opening,
a cut-off ending, unsupported claims, and content requiring the full source to make sense.

Score each dimension 0-10:
- hook_strength: immediate attention in the opening
- standalone_context: understandable without the long video
- payoff: satisfying answer, story turn, or useful conclusion
- emotional_resonance: meaningful surprise, humor, empathy, tension, or insight
- specificity: concrete names, examples, actions, numbers, or details
- clarity: easy to follow and one coherent idea
- pacing: useful content density without rushed or dead sections
- originality: non-obvious angle or distinctive explanation

Return ONLY valid JSON:
{
 "score": 0-100,
 "dimension_scores": {
  "hook_strength": 0-10, "standalone_context": 0-10, "payoff": 0-10,
  "emotional_resonance": 0-10, "specificity": 0-10, "clarity": 0-10,
  "pacing": 0-10, "originality": 0-10
 },
 "hook": "a hook grounded in the first lines",
 "title": "a specific, relevant title of 3-8 words",
 "reason": "one evidence-based sentence explaining the score"
}

Candidate title (may be empty): {title}
Opening sentence: {first_text}
Duration: {duration:.1f} seconds | Word count: {word_count}
Transcript:
\"\"\"{text}\"\"\"
"""


def _clamp_score(value: Any, default: int = 0) -> int:
    try:
        score = int(round(float(value)))
    except (TypeError, ValueError, OverflowError):
        return max(0, min(100, int(default)))
    return max(0, min(100, score))


def _tokens(text: str) -> set[str]:
    return {
        word.lower()
        for word in re.findall(r"[A-Za-z][A-Za-z']{2,}", text or "")
        if word.lower() not in _STOP
    }


def _relevant(candidate: str, reference: str) -> bool:
    return bool(_tokens(candidate).intersection(_tokens(reference)))


def heuristic_quality_score(cand: Dict[str, Any]) -> tuple[int, Dict[str, int]]:
    """Score observable quality signals without an LLM; returns 0–100 and breakdown."""
    text = " ".join(str(cand.get("text") or "").split())
    first = " ".join(str(cand.get("first_text") or text).split())
    words = re.findall(r"\b[\w']+\b", text)
    duration = float(cand.get("duration") or max(0.0, float(cand.get("end", 0)) - float(cand.get("start", 0))))
    duration = max(duration, 0.1)
    wps = len(words) / duration
    lower = text.lower()
    opening = first.lower()[:220]

    hook = 42
    if any(cue in opening for cue in _HOOK_CUES):
        hook += 22
    if "?" in first[:180] or "!" in first[:180]:
        hook += 8
    if re.search(r"\b\d+(?:\.\d+)?%?\b", first):
        hook += 9
    if len(first.split()) <= 18:
        hook += 7
    if len(first.split()) > 35:
        hook -= 12
    hook = max(0, min(100, hook))

    standalone = 72
    if re.match(r"^(and|but|so|because|which|this|that|it|they|he|she)\b", lower):
        standalone -= 22
    if len(words) < 25:
        standalone -= 15
    if len(words) >= 40 and text.rstrip().endswith((".", "?", "!", '"', "'")):
        standalone += 8
    if text.rstrip().lower().endswith(_BAD_ENDINGS):
        standalone -= 28
    standalone = max(0, min(100, standalone))

    payoff = 48
    if re.search(r"\b(because|therefore|so that|which means|the result|in the end|that is why|the lesson|here is how)\b", lower):
        payoff += 20
    if re.search(r"\b(but|however|instead|until|turns out|the answer|finally)\b", lower):
        payoff += 10
    if text.rstrip().endswith((".", "?", "!")):
        payoff += 7
    if text.rstrip().lower().endswith(_BAD_ENDINGS):
        payoff -= 20
    payoff = max(0, min(100, payoff))

    emotion = 38 + min(36, sum(1 for cue in _EMOTION_CUES if cue in lower) * 9)
    if "?" in text or "!" in text:
        emotion += 5
    emotion = max(0, min(100, emotion))

    specificity = 42
    specificity += min(28, len(re.findall(r"\b\d+(?:\.\d+)?%?\b", text)) * 8)
    specificity += min(24, len(_tokens(text)) * 1.2)
    specificity = max(0, min(100, int(specificity)))

    clarity = 72
    if len(words) > 0:
        unique_ratio = len(_tokens(text)) / max(1, len(words))
        clarity += int((unique_ratio - 0.35) * 35)
    if text.count("(") > text.count(")") or text.count("[") > text.count("]"):
        clarity -= 12
    clarity = max(0, min(100, clarity))

    if 1.8 <= wps <= 3.8:
        pacing = 88
    elif 1.4 <= wps < 1.8 or 3.8 < wps <= 4.8:
        pacing = 70
    elif wps < 1.4:
        pacing = 48
    else:
        pacing = 42
    if duration < 15 or duration > 65:
        pacing -= 12
    pacing = max(0, min(100, pacing))

    originality = 48 + min(28, len(set(_tokens(text))) * 1.2)
    if re.search(r"\b(for example|imagine|here is a trick|counterintuitive|most people|the mistake)\b", lower):
        originality += 12
    originality = max(0, min(100, int(originality)))

    components = {
        "hook_strength": hook,
        "standalone_context": standalone,
        "payoff": payoff,
        "emotional_resonance": emotion,
        "specificity": specificity,
        "clarity": clarity,
        "pacing": pacing,
        "originality": originality,
    }
    score = round(sum(components[key] * weight for key, weight in WEIGHTS.items()))
    return max(0, min(100, score)), components


def stage1(
    cands: List[Dict[str, Any]],
    llm: LLM,
    batch_size: int = 5,
) -> List[Dict[str, Any]]:
    """Screen candidates in bounded batches; incomplete model output falls back to local scoring."""
    if not cands:
        return []

    batch_size = max(1, int(batch_size))
    for cand in cands:
        local_score, local_components = heuristic_quality_score(cand)
        cand["heuristic_quality_score"] = local_score
        cand["heuristic_components"] = local_components

    for batch_start in range(0, len(cands), batch_size):
        group = cands[batch_start : batch_start + batch_size]
        body = "\n\n".join(
            f"[{index}] duration={float(cand.get('duration', 0)):.1f}s "
            f"opening={str(cand.get('first_text') or '')[:220]!r}\n"
            f"excerpt={str(cand.get('text') or '')[:1400]}"
            for index, cand in enumerate(group)
        )
        try:
            output = llm.complete_json(FAST_PROMPT + body, tier="fast")
            items = output.get("scores", []) if isinstance(output, dict) else []
            assigned: Dict[int, int] = {}
            for item in items if isinstance(items, list) else []:
                if not isinstance(item, dict):
                    continue
                index = item.get("id")
                if isinstance(index, int) and 0 <= index < len(group):
                    assigned[index] = _clamp_score(item.get("score"), group[index]["heuristic_quality_score"])
            for index, cand in enumerate(group):
                local = int(cand["heuristic_quality_score"])
                if index in assigned:
                    cand["fast_model_score"] = assigned[index]
                    cand["fast_score"] = round(0.78 * assigned[index] + 0.22 * local)
                else:
                    cand["fast_model_score"] = None
                    cand["fast_score"] = local
        except Exception as exc:
            logger.warning("[scoring] Stage 1 batch %d failed: %s; using deterministic scores.", batch_start, exc)
            for cand in group:
                cand["fast_model_score"] = None
                cand["fast_score"] = int(cand["heuristic_quality_score"])

    return cands


def stage2(
    cand: Dict[str, Any],
    llm: LLM,
    analytics_context: Optional[str] = None,
) -> Dict[str, Any]:
    """Deep-rank one candidate using a rubric and reject titles/hooks unrelated to its text."""
    text = " ".join(str(cand.get("text") or "").split())
    first_text = str(cand.get("first_text") or text).strip()
    duration = float(cand.get("duration") or max(0.0, float(cand.get("end", 0)) - float(cand.get("start", 0)))
    word_count = int(cand.get("word_count") or len(text.split()))
    local_score, local_components = heuristic_quality_score(cand)
    fast_score = _clamp_score(cand.get("fast_score"), local_score)

    prompt = DETAIL_PROMPT.format(
        title=str(cand.get("title") or ""),
        first_text=first_text[:260],
        duration=duration,
        word_count=word_count,
        text=text[:4500],
    )
    if analytics_context:
        prompt = f"Historical channel analytics (use as weak guidance, never as evidence about this clip):\n{analytics_context}\n\n{prompt}"

    try:
        output = llm.complete_json(prompt, tier="strong")
        if not isinstance(output, dict):
            raise ValueError("Stage 2 returned a non-object payload.")

        model_score = _clamp_score(output.get("score"), fast_score)
        raw_dimensions = output.get("dimension_scores")
        rubric: Dict[str, int] = {}
        if isinstance(raw_dimensions, dict):
            for key in WEIGHTS:
                if key in raw_dimensions:
                    try:
                        numeric = float(raw_dimensions[key])
                        # Prompts request 0–10; tolerate a model that uses 0–100.
                        if numeric <= 10:
                            numeric *= 10
                        rubric[key] = _clamp_score(numeric)
                    except (TypeError, ValueError, OverflowError):
                        continue

        if len(rubric) >= 4:
            rubric_score = round(
                sum(rubric.get(key, local_components[key]) * weight for key, weight in WEIGHTS.items())
            )
            detail_evidence = round(0.70 * model_score + 0.30 * rubric_score)
        else:
            rubric_score = None
            detail_evidence = model_score

        final_score = round(0.72 * detail_evidence + 0.18 * fast_score + 0.10 * local_score)
        cand["detail_model_score"] = model_score
        cand["rubric_score"] = rubric_score
        cand["score"] = max(0, min(100, final_score))
        cand["score_breakdown"] = {
            **local_components,
            "heuristic": local_score,
            "fast_model": cand.get("fast_model_score"),
            "fast_blended": fast_score,
            "detail_model": model_score,
            "rubric": rubric_score,
            "final": cand["score"],
        }

        raw_hook = str(output.get("hook") or "").strip()
        cand["hook"] = raw_hook if raw_hook and _relevant(raw_hook, f"{first_text} {text}") else (
            first_text.split(".")[0].strip() or text[:100]
        )

        raw_title = str(output.get("title") or "").strip()
        if raw_title and _relevant(raw_title, f"{cand['hook']} {text}"):
            cand["title"] = raw_title[:100]
        else:
            topical_words = list(_tokens(first_text or text))
            if topical_words:
                cand["title"] = " ".join(word.title() for word in topical_words[:5])
            else:
                cand["title"] = _truncate_text(first_text or text, 60)

        raw_reason = str(output.get("reason") or "").strip()
        cand["reason"] = raw_reason[:320] if raw_reason and _relevant(raw_reason, text) else (
            f"Selected from transcript evidence: {cand['hook'][:150]}"
        )
    except Exception as exc:
        logger.warning("[scoring] Stage 2 failed: %s; using blended local scores.", exc)
        cand["score"] = round(0.65 * fast_score + 0.35 * local_score)
        cand["hook"] = first_text.split(".")[0].strip() or text[:100]
        topical_words = list(_tokens(first_text or text))
        cand["title"] = " ".join(word.title() for word in topical_words[:5]) or _truncate_text(text, 60) or "Clip Highlight"
        cand["reason"] = f"Ranked by hook, context, payoff, clarity, pacing and specificity signals."
        cand["score_breakdown"] = {
            **local_components,
            "heuristic": local_score,
            "fast_model": cand.get("fast_model_score"),
            "fast_blended": fast_score,
            "detail_model": None,
            "rubric": None,
            "final": cand["score"],
        }

    return cand


def _truncate_text(value: str, limit: int) -> str:
    cleaned = " ".join((value or "").split())
    return cleaned if len(cleaned) <= limit else cleaned[: limit - 1].rstrip() + "…"


def select_top(
    items: List[Dict[str, Any]],
    n: int,
    key: str = "score",
    max_overlap: float = 0.3,
) -> List[Dict[str, Any]]:
    """Greedy, deterministic selection using score plus temporal IoU de-duplication."""
    if not items:
        return []
    target = max(1, min(10, int(n)))
    threshold = max(0.0, min(1.0, float(max_overlap)))
    sorted_items = sorted(
        items,
        key=lambda item: (
            _clamp_score(item.get(key), 0),
            float(item.get("heuristic_quality_score", item.get("heuristic_score", 0))),
            -float(item.get("start", 0)),
        ),
        reverse=True,
    )

    picked: List[Dict[str, Any]] = []
    for candidate in sorted_items:
        start = float(candidate.get("start", 0))
        end = float(candidate.get("end", start))
        if end <= start:
            continue
        if all(calculate_iou(candidate, existing) < threshold for existing in picked):
            picked.append(candidate)
        if len(picked) >= target:
            break
    return picked


def rank(
    candidates: List[Dict[str, Any]],
    llm: LLM,
    n: int = 5,
    shortlist_size: Optional[int] = None,
    analytics_context: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Two-stage ranker with missing-score resilience and final non-overlap selection."""
    if not candidates:
        return []

    target_count = max(1, min(10, int(n)))
    target_shortlist = max(
        target_count,
        min(len(candidates), int(shortlist_size if shortlist_size is not None else settings.shortlist)),
    )

    stage1(candidates, llm)
    shortlist = select_top(
        candidates,
        target_shortlist,
        key="fast_score",
        max_overlap=0.35,
    )

    for candidate in shortlist:
        stage2(candidate, llm, analytics_context=analytics_context)

    return select_top(shortlist, target_count, key="score", max_overlap=0.3)
