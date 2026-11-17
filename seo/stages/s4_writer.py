"""Stage S4: Title and description writer with multi-candidate angles and judge."""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

WRITER_PROMPT = """Write YouTube Shorts metadata.
Clip summary: {one_line_summary}
Hook line from the clip: {hook}
Primary keyword: {primary_keyword}
Secondary keywords: {secondary_keywords}
Long-tail phrases: {longtail}
Current angles from web research: {web_snippets}
Language: {language}

Return ONLY JSON:
{{
  "title_candidates": [
    "<Curiosity angle: primary keyword in first 3-5 words, 40-60 chars, NO hashtags, NO ALL CAPS>",
    "<Number angle: specific number/statistic, primary keyword in first 3-5 words, 40-60 chars>",
    "<Question angle: direct stakes question, primary keyword in first 3-5 words, 40-60 chars>",
    "<Bold claim angle: verified bold statement, primary keyword in first 3-5 words, 40-60 chars>",
    "<How/Why angle: explanatory payoff, primary keyword in first 3-5 words, 40-60 chars>"
  ],
  "description_body": "<Hook sentence with primary keyword (~100-125 chars).\\n\\n2-3 sentences summarizing the clip with secondary keywords naturally.\\n\\nSubscribe for daily insights on this channel!>",
  "instagram_caption_body": "<Engaging hook and short takeaway for Instagram Reels. NO hashtags in this body.>"
}}
Rules:
- NEVER include any '#' characters in the description body or title candidates.
- Max 100 chars per title candidate (aim for 40-60 chars).
- Primary keyword MUST appear in the first 3-5 words of the title candidates.
"""


def _clean_title_candidate(cand: str, primary_kw: str) -> str:
    """Normalize title: strip hashtags, double punctuation, and shouting caps."""
    cleaned = re.sub(r"#\w+", "", str(cand or "")).strip()
    cleaned = re.sub(r"!{2,}", "", cleaned)
    cleaned = re.sub(r"\?{2,}", "?", cleaned)
    cleaned = " ".join(cleaned.split())

    # Fix shouting all-caps
    words = cleaned.split()
    fixed_words: List[str] = []
    for w in words:
        bare = w.strip(".,!?:;\"'()-")
        if bare.isupper() and len(bare) > 2 and bare not in {"AI", "API", "SEO", "ROI", "ETF", "GDP", "USD"}:
            fixed_words.append(w.capitalize())
        else:
            fixed_words.append(w)
    cleaned = " ".join(fixed_words).strip()

    # Ensure length <= 100
    if len(cleaned) > 100:
        cleaned = cleaned[:99].rsplit(" ", 1)[0]

    # Ensure primary keyword or key tokens are front-loaded if missing
    kw_words = [w.lower() for w in primary_kw.split() if len(w) > 2]
    first_few_words = " ".join(cleaned.split()[:5]).lower()
    has_kw = any(w in first_few_words for w in kw_words)
    if not has_kw and primary_kw:
        prefix = primary_kw.title()
        if len(prefix) + 2 + len(cleaned) <= 100:
            cleaned = f"{prefix}: {cleaned}"
        else:
            cleaned = f"{prefix}: {cleaned[: 96 - len(prefix)]}..."

    return cleaned[:100]


def _judge_titles(candidates: List[str], primary_kw: str) -> Tuple[str, List[str]]:
    """
    Score 5 candidate titles on keyword placement, length (40-60 optimal), and clarity.
    Returns (winner, alternatives).
    """
    kw_words = [w.lower() for w in primary_kw.split() if len(w) > 2]

    scored: List[Tuple[float, str]] = []
    for cand in candidates:
        if not cand:
            continue
        score = 0.0
        cand_len = len(cand)

        # 1. Optimal length (40-60 chars)
        if 40 <= cand_len <= 65:
            score += 3.0
        elif 30 <= cand_len <= 80:
            score += 2.0
        elif cand_len <= 100:
            score += 1.0

        # 2. Keyword front-loading (first 3-5 words)
        first_words = " ".join(cand.split()[:5]).lower()
        overlap = [w for w in kw_words if w in first_words]
        if overlap:
            score += 4.0

        # 3. Curiosity / Hook punctuation
        if any(p in cand for p in ("?", ":", "—", "-")):
            score += 1.5

        # 4. Penalty for emojis or hashtags
        if "#" in cand:
            score -= 10.0
        if len(re.findall(r"[\U00010000-\U0010ffff]", cand)) > 1:
            score -= 2.0

        scored.append((score, cand))

    scored.sort(key=lambda x: x[0], reverse=True)
    winner = scored[0][1] if scored else _clean_title_candidate(primary_kw.title(), primary_kw)
    alts = [item[1] for item in scored[1:5]]
    while len(alts) < 4:
        alts.append(_clean_title_candidate(f"Insight: {winner}", primary_kw))

    return winner, alts[:4]


def _llm_judge_titles(
    candidates: List[str],
    primary_kw: str,
    summary: str,
    llm: Any,
) -> Optional[Tuple[str, List[str]]]:
    """Call second LLM to judge title candidates on keyword placement, clarity, honesty, and length."""
    if not llm or len(candidates) < 2:
        return None

    cands_formatted = "\n".join(f"{idx}. {c}" for idx, c in enumerate(candidates, start=1))
    prompt = (
        "You are an expert YouTube title editor. Rank these title candidates for a short video:\n"
        f"Clip summary: {summary}\n"
        f"Primary keyword: {primary_kw}\n"
        f"Candidates:\n{cands_formatted}\n\n"
        "Judge criteria:\n"
        "- Keyword placement: primary keyword must appear within first 3-5 words\n"
        "- Length: optimal 40-60 characters, hard max 100 characters\n"
        "- Clarity and honesty: accurately delivers on clip content without empty clickbait\n"
        "- Hook strength: curiosity, number, direct question, or bold claim\n\n"
        "Return ONLY JSON: {\"winner_index\": 1, \"ranked_indices\": [1, 2, 3, 4, 5], \"reason\": \"...\"}"
    )

    try:
        data = llm.complete_json(prompt, tier="fast")
        if not isinstance(data, dict):
            return None
        ranked_indices = data.get("ranked_indices")
        if isinstance(ranked_indices, list) and len(ranked_indices) >= 2:
            ordered: List[str] = []
            for idx in ranked_indices:
                try:
                    i = int(idx) - 1
                    if 0 <= i < len(candidates) and candidates[i] not in ordered:
                        ordered.append(candidates[i])
                except (ValueError, TypeError):
                    continue
            for c in candidates:
                if c not in ordered:
                    ordered.append(c)
            if ordered:
                winner = ordered[0]
                alts = ordered[1:5]
                while len(alts) < 4:
                    alts.append(_clean_title_candidate(f"Insight: {winner}", primary_kw))
                return winner, alts[:4]
    except Exception as exc:
        logger.debug("[s4_writer] LLM title judge error: %s", exc)

    return None


def _heuristic_writer(
    topic_data: Dict[str, Any],
    keywords_data: Dict[str, Any],
    source_url: Optional[str] = None,
) -> Dict[str, Any]:
    """Deterministic metadata writer when LLM is unavailable."""
    primary_kw = str(keywords_data.get("primary_keyword") or topic_data.get("main_topic") or "Key insight").title()
    summary = str(topic_data.get("one_line_summary") or "")
    hook = str(topic_data.get("hook") or "")
    secondary = keywords_data.get("secondary_keywords") or []
    sec_str = ", ".join(secondary[:2]) if secondary else "essential principles"

    cands = [
        f"{primary_kw}: The Secret Nobody Tells You",
        f"3 {primary_kw} Rules You Must Know",
        f"Why Does {primary_kw} Matter Today?",
        f"{primary_kw} Changes Everything We Know",
        f"How {primary_kw} Really Works",
    ]

    desc_lines = [
        f"{primary_kw} explained: {hook or summary}",
        "",
        f"In this short breakdown, explore how {sec_str} shape the entire topic.",
        "",
        "Subscribe for more high-impact shorts every day!",
    ]
    if source_url:
        desc_lines.append(f"Full video: {source_url}")

    ig_caption = f"{hook or summary}\n\nKey breakdown on {primary_kw} and {sec_str}."

    winner, alts = _judge_titles(cands, primary_kw)
    return {
        "title": winner,
        "title_alternatives": alts,
        "description_body": "\n".join(desc_lines),
        "instagram_caption_body": ig_caption,
    }


def write_metadata(
    topic_data: Dict[str, Any],
    keywords_data: Dict[str, Any],
    research_data: Dict[str, Any],
    llm: Any = None,
    source_url: Optional[str] = None,
    validation_errors: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Execute stage S4: Generate title candidates, judge winner, and produce description draft.
    """
    primary_kw = str(keywords_data.get("primary_keyword") or topic_data.get("main_topic") or "")

    if llm is None:
        return _heuristic_writer(topic_data, keywords_data, source_url)

    web_snippets: List[str] = []
    for item in research_data.get("web", []):
        for res in item.get("results", [])[:2]:
            sn = res.get("snippet", "")
            if sn:
                web_snippets.append(sn[:120])

    prompt = WRITER_PROMPT.format(
        one_line_summary=topic_data.get("one_line_summary", ""),
        hook=topic_data.get("hook", ""),
        primary_keyword=primary_kw,
        secondary_keywords=", ".join(keywords_data.get("secondary_keywords", [])),
        longtail=", ".join(keywords_data.get("longtail", [])[:3]),
        web_snippets="; ".join(web_snippets[:3]) or "None",
        language=topic_data.get("language", "en"),
    )

    if validation_errors:
        err_block = "\n".join(f"- {e}" for e in validation_errors)
        prompt += (
            "\n\nCRITICAL FIX REQUIRED: Previous attempt failed validation with these errors:\n"
            f"{err_block}\n"
            "You MUST fix these exact issues in this attempt."
        )

    try:
        data = llm.complete_json(prompt, tier="strong")
        if not isinstance(data, dict):
            raise ValueError("LLM returned non-dict")

        raw_candidates = data.get("title_candidates") or []
        if not isinstance(raw_candidates, list) or len(raw_candidates) < 3:
            raise ValueError("Insufficient title candidates")

        cleaned_cands = [_clean_title_candidate(str(c), primary_kw) for c in raw_candidates if str(c).strip()]

        # Judge candidates with 2nd LLM call per Section 4.5, falling back to heuristic
        llm_judged = _llm_judge_titles(cleaned_cands, primary_kw, topic_data.get("one_line_summary", ""), llm)
        if llm_judged:
            winner, alts = llm_judged
        else:
            winner, alts = _judge_titles(cleaned_cands, primary_kw)

        desc_body = str(data.get("description_body") or "").strip()
        # Strictly ensure description body contains no '#' characters
        desc_body = re.sub(r"#\S*", "", desc_body).replace("#", "").strip()
        if source_url and source_url not in desc_body:
            desc_body = f"{desc_body}\n\nFull video: {source_url}"

        ig_body = str(data.get("instagram_caption_body") or desc_body).strip()
        ig_body = re.sub(r"#\S*", "", ig_body).replace("#", "").strip()

        return {
            "title": winner,
            "title_alternatives": alts[:4],
            "description_body": desc_body,
            "instagram_caption_body": ig_body,
        }
    except Exception as exc:
        logger.warning("[s4_writer] LLM writer failed (%s); using deterministic fallback.", exc)
        return _heuristic_writer(topic_data, keywords_data, source_url)
