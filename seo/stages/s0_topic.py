"""Stage S0: Topic extraction from clip transcript."""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

S0_PROMPT_TEMPLATE = """You analyse a short video clip transcript. Return ONLY JSON:
{{
  "main_topic": "<2-5 words>",
  "one_line_summary": "<max 140 chars, factual>",
  "entities": ["people, brands, shows, places, events named in the clip"],
  "seed_keywords": ["5-8 phrases a viewer would type to find this clip"],
  "category": "<one of: gaming, tech, education, entertainment, news, sports, music, lifestyle, business, other>",
  "audience": "<who this is for, 1 line>",
  "language": "{language}",
  "geo": "{geo}",
  "hook": "<the single most surprising or valuable line in the clip>"
}}
Use only what is in the transcript. Do not guess names that are not spoken.

Clip title: {clip_title}
Clip hook: {clip_hook}
Source video title: {source_title}
Transcript:
\"\"\"{transcript}\"\"\"
"""

VALID_CATEGORIES = {
    "gaming", "tech", "education", "entertainment", "news",
    "sports", "music", "lifestyle", "business", "other",
}


def _heuristic_topic_extraction(
    clip: Dict[str, Any],
    transcript_text: str,
    geo: str = "IN",
    language: str = "en",
) -> Dict[str, Any]:
    """Deterministic fallback topic extractor when LLM is unavailable."""
    clip = clip or {}
    title = str(clip.get("title") or "").strip()
    hook = str(clip.get("hook") or "").strip()
    text = (transcript_text or "").strip()

    # Extract capitalized proper noun sequences as candidate entities
    cap_words = re.findall(r"\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*\b", text)
    entities: List[str] = []
    for ent in cap_words:
        if ent.lower() not in {"the", "this", "that", "there", "they", "here", "when", "what"}:
            if ent not in entities:
                entities.append(ent)
        if len(entities) >= 5:
            break

    # Seed keywords
    words = [w.lower() for w in re.findall(r"[A-Za-z0-9]+", text) if len(w) > 3]
    top_words = list(dict.fromkeys(words))[:8]

    # Main topic
    if title:
        main_topic = " ".join(title.split()[:4])
    elif hook:
        main_topic = " ".join(hook.split()[:4])
    elif top_words:
        main_topic = " ".join(top_words[:3])
    else:
        main_topic = "video insight"

    seed_keywords = [f"{main_topic} {w}" for w in top_words[:5]] if top_words else [main_topic]

    summary = (hook or (text[:130] if text else title) or "Clip summary")[:140]

    return {
        "main_topic": main_topic[:50],
        "one_line_summary": summary,
        "entities": entities,
        "seed_keywords": seed_keywords[:8],
        "category": "lifestyle",
        "audience": "Viewers interested in short-form insights",
        "language": language or "en",
        "geo": geo or "IN",
        "hook": (hook or (text.split(".")[0] if "." in text else text[:80]) or main_topic)[:100],
    }


def extract_topic(
    clip: Dict[str, Any],
    transcript_text: str,
    llm: Any = None,
    geo: str = "IN",
    language: str = "en",
) -> Dict[str, Any]:
    """
    Execute stage S0: Extract structured topic information from transcript.

    Returns:
        Dict matching S0 schema.
    """
    clip = clip or {}
    if llm is None:
        return _heuristic_topic_extraction(clip, transcript_text, geo=geo, language=language)

    clip_title = str(clip.get("title") or "")
    clip_hook = str(clip.get("hook") or "")
    source_title = str(clip.get("source_title") or clip.get("video_title") or "")
    prompt = S0_PROMPT_TEMPLATE.format(
        clip_title=clip_title,
        clip_hook=clip_hook,
        source_title=source_title,
        transcript=transcript_text[:3500],
        language=language or "en",
        geo=geo or "IN",
    )

    try:
        data = llm.complete_json(prompt, tier="strong")
        if not isinstance(data, dict):
            raise ValueError("LLM returned non-dict output")

        main_topic = str(data.get("main_topic") or data.get("primary_keyword") or "").strip()
        if not main_topic:
            raise ValueError("Missing main_topic in LLM response")

        category = str(data.get("category") or "other").lower().strip()
        if category not in VALID_CATEGORIES:
            category = "other"

        summary = str(data.get("one_line_summary") or data.get("above_the_fold") or data.get("youtube_description") or "")[:140]
        entities = [str(e).strip() for e in (data.get("entities") or data.get("alternate_names") or []) if str(e).strip()]
        seeds = [str(s).strip() for s in (data.get("seed_keywords") or data.get("keywords") or []) if str(s).strip()]
        audience = str(data.get("audience") or "Interested viewers")[:120]
        hook = str(data.get("hook") or clip_hook or main_topic)[:120]
        lang = str(data.get("language") or language or "en").strip().lower()

        return {
            "main_topic": main_topic[:60],
            "one_line_summary": summary or clip_hook or main_topic,
            "entities": entities,
            "seed_keywords": seeds or [main_topic],
            "category": category,
            "audience": audience,
            "language": lang,
            "geo": geo,
            "hook": hook,
        }
    except Exception as exc:
        logger.warning("[s0_topic] LLM topic extraction failed (%s); using heuristic.", exc)
        return _heuristic_topic_extraction(clip, transcript_text, geo=geo, language=language)
