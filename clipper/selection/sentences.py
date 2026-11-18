"""
Sentence boundary construction from Whisper word-level timestamps and segments.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

# Sentence terminators: standard Latin (. ? !), ellipsis (… ⋯ ‥), Indic danda (। ॥),
# CJK full stops/marks (。 ！ ？), Arabic (؟ ۔), Armenian (՞ ։), followed by optional closing quotes/brackets.
_SENTENCE_END_PUNCT_RE = re.compile(
    r'[\.\?\!\…\u2026\u22ef\u2025\u0964\u0965\u3002\uff01\uff1f\u061f\u06d4\u055e\u0589\u037e]'
    r'[\"\'\)\]\}\u00bb\u201d\u2019\u203a\u300d\u300f\uff09\u3011\u3009\u300b]?$'
)


def build_sentences(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Build clean, timestamped sentences from Whisper segments and word timestamps.
    Groups words until sentence-ending punctuation (. ? ! … । 。 etc.).
    Falls back to segment boundaries for unpunctuated text or when word timestamps are absent.
    If segments lack fine boundaries, uses word pause gaps (>=1.2s) as natural acoustic breaks.
    Returns: [{"start": float, "end": float, "text": str}]
    """
    if not segments:
        return []

    # 1. Flatten word timestamps if present
    all_words: List[Dict[str, Any]] = []
    has_punctuation = False

    for seg in segments:
        words = seg.get("words") or []
        for w in words:
            word_str = str(w.get("w") or w.get("word") or "").strip()
            if not word_str:
                continue
            try:
                start_t = float(w["start"])
                end_t = float(w["end"])
            except (KeyError, TypeError, ValueError):
                continue

            all_words.append({"w": word_str, "start": start_t, "end": max(end_t, start_t + 0.05)})
            if _SENTENCE_END_PUNCT_RE.search(word_str):
                has_punctuation = True

    # 2. Check fallback segment boundaries
    fallback_segments: List[Dict[str, Any]] = []
    for seg in segments:
        text = str(seg.get("text") or "").strip()
        if not text:
            continue
        try:
            s_start = float(seg.get("start", 0.0))
            s_end = float(seg.get("end", s_start))
        except (TypeError, ValueError):
            continue
        if s_end > s_start:
            fallback_segments.append({
                "start": round(s_start, 2),
                "end": round(s_end, 2),
                "text": text,
            })

    # If no word timestamps, use segment boundaries directly
    if not all_words:
        return fallback_segments

    # If unpunctuated, but segments are granular (<30s each and >=2 segments), use segments
    if not has_punctuation and len(fallback_segments) >= 2:
        if all(float(s["end"]) - float(s["start"]) <= 30.0 for s in fallback_segments):
            return fallback_segments

    # 3. Group words into sentences based on punctuation and natural pause breaks
    sentences: List[Dict[str, Any]] = []
    cur_words: List[Dict[str, Any]] = []

    for idx, w in enumerate(all_words):
        cur_words.append(w)
        is_last = idx == len(all_words) - 1
        has_punct = bool(_SENTENCE_END_PUNCT_RE.search(w["w"]))

        # Check for natural pause between words (>1.2s) or runaway sentence length (>20s)
        has_pause = False
        if not is_last:
            next_start = all_words[idx + 1]["start"]
            if next_start - w["end"] >= 1.2:
                has_pause = True

        sentence_duration = cur_words[-1]["end"] - cur_words[0]["start"]
        is_too_long = sentence_duration >= 20.0 and len(cur_words) >= 25

        if has_punct or is_last or has_pause or is_too_long:
            s_text = " ".join(cw["w"] for cw in cur_words).strip()
            if s_text:
                sentences.append({
                    "start": round(cur_words[0]["start"], 2),
                    "end": round(cur_words[-1]["end"], 2),
                    "text": s_text,
                })
            cur_words = []

    return sentences or fallback_segments

