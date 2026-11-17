"""Stage S2: Candidate keyword aggregation and 0-10 multi-factor scoring."""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

logger = logging.getLogger(__name__)

STOP_WORDS = {
    "a", "an", "the", "and", "or", "but", "if", "so", "to", "of", "in", "on", "at",
    "for", "with", "from", "by", "as", "is", "are", "was", "were", "be", "been", "being",
    "it", "its", "this", "that", "these", "those", "i", "you", "he", "she", "we", "they",
    "me", "him", "her", "us", "them", "my", "your", "his", "our", "their", "not", "no",
    "yes", "do", "does", "did", "have", "has", "had", "will", "would", "can", "could",
    "should", "just", "like", "really", "very", "about", "what", "when", "where", "who",
    "how", "all", "any", "some", "more", "most", "other", "out", "up", "down", "video",
    "videos", "clip", "clips", "shorts", "short", "reel", "reels", "watch",
}


def _clean_phrase(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9\s]", " ", text or "")
    return " ".join(cleaned.lower().split())


def _calc_relevance_heuristic(candidate: str, transcript_tokens: Set[str], topic_tokens: Set[str]) -> float:
    cand_tokens = {w for w in candidate.split() if w not in STOP_WORDS}
    if not cand_tokens:
        return 0.0

    # Strong direct match if in topic tokens
    topic_overlap = cand_tokens.intersection(topic_tokens)
    if topic_overlap and len(topic_overlap) == len(cand_tokens):
        return 1.0

    # Transcripts token overlap
    overlap = cand_tokens.intersection(transcript_tokens)
    if not overlap:
        return 0.0

    overlap_ratio = len(overlap) / len(cand_tokens)
    if overlap_ratio >= 0.8:
        return 1.0
    if overlap_ratio >= 0.4:
        return 0.6
    return 0.4


def score_keywords(
    topic_data: Dict[str, Any],
    research_data: Dict[str, Any],
    clip_transcript: str,
    llm: Any = None,
) -> Dict[str, Any]:
    """
    Score keyword candidates using formula:
    score = 4*relevance + 2*demand + 2*freshness + 1*specificity + 1*competition_gap
    Drops candidates with relevance < 0.5.

    Returns:
        {
            "primary_keyword": str,
            "secondary_keywords": List[str],
            "longtail": List[str],
            "top_candidates": List[Dict[str, Any]]
        }
    """
    main_topic = str(topic_data.get("main_topic") or "").lower()
    seed_keywords = [str(k).lower() for k in topic_data.get("seed_keywords", [])]
    entities = [str(e).lower() for e in topic_data.get("entities", [])]

    # Collect raw candidates and track source information
    raw_candidates: Set[str] = set()

    for s in seed_keywords:
        c = _clean_phrase(s)
        if c:
            raw_candidates.add(c)

    for e in entities:
        c = _clean_phrase(e)
        if c:
            raw_candidates.add(c)

    # Autocomplete demand lookup: candidate -> rank (1..8)
    autocomplete_ranks: Dict[str, int] = {}
    for block in research_data.get("autocomplete", []):
        suggestions = block.get("suggestions", [])
        for rank_idx, sugg in enumerate(suggestions, start=1):
            sugg_clean = _clean_phrase(sugg)
            if sugg_clean:
                raw_candidates.add(sugg_clean)
                if sugg_clean not in autocomplete_ranks or rank_idx < autocomplete_ranks[sugg_clean]:
                    autocomplete_ranks[sugg_clean] = rank_idx

    # Top recent videos titles and tags
    top_videos = research_data.get("top_recent_videos", [])
    video_tag_frequency: Dict[str, int] = {}
    video_tag_views: Dict[str, int] = {}
    for vid in top_videos:
        title = vid.get("title", "")
        clean_title = _clean_phrase(title)
        if clean_title:
            raw_candidates.add(clean_title)

        views = int(vid.get("views", 0))
        for tag in vid.get("tags", []):
            tag_clean = _clean_phrase(tag)
            if tag_clean:
                raw_candidates.add(tag_clean)
                video_tag_frequency[tag_clean] = video_tag_frequency.get(tag_clean, 0) + 1
                video_tag_views[tag_clean] = video_tag_views.get(tag_clean, 0) + views

    # Trending Now queries
    trending_queries = {
        _clean_phrase(item.get("query", ""))
        for item in research_data.get("trending_now", [])
        if _clean_phrase(item.get("query", ""))
    }
    for tq in trending_queries:
        raw_candidates.add(tq)

    # Reference tokens for relevance scoring
    transcript_clean = _clean_phrase(clip_transcript)
    transcript_tokens = {w for w in transcript_clean.split() if w not in STOP_WORDS}
    topic_tokens = {w for w in _clean_phrase(main_topic).split() if w not in STOP_WORDS}

    scored_list: List[Dict[str, Any]] = []

    for cand in raw_candidates:
        words = cand.split()
        if not words or len(cand) > 60:
            continue

        # 1. Relevance (0-1)
        rel = _calc_relevance_heuristic(cand, transcript_tokens, topic_tokens)
        if rel < 0.5:
            continue  # Hard filter: dropped whatever the other scores

        # 2. Demand (0-1)
        # 1.0 if rank<=3, 0.6 if rank<=8, else 0
        rank = autocomplete_ranks.get(cand)
        if rank is not None and rank <= 3:
            demand = 1.0
        elif rank is not None and rank <= 8:
            demand = 0.6
        else:
            demand = 0.0

        # 3. Freshness (0-1)
        # appears in trending_now or appears in >= 2 of last 14 days' top videos
        is_spiking = any(cand in tq or tq in cand for tq in trending_queries)
        freq_in_recent = video_tag_frequency.get(cand, 0)
        if is_spiking or freq_in_recent >= 2:
            freshness = 1.0
        elif freq_in_recent == 1:
            freshness = 0.5
        else:
            freshness = 0.0

        # 4. Specificity (0-1)
        # 2-4 word phrases score 1.0, single generic words score 0.3, > 4 words score 0.7
        n_words = len(words)
        if 2 <= n_words <= 4:
            specificity = 1.0
        elif n_words == 1:
            specificity = 0.3
        else:
            specificity = 0.7

        # 5. Competition gap (0-1)
        # 1 if top videos have few views (< 100k) or are old, 0.5 unknown
        views_for_cand = video_tag_views.get(cand)
        if views_for_cand is not None and views_for_cand < 100000:
            competition_gap = 1.0
        else:
            competition_gap = 0.5

        # Final score 0-10
        total_score = round(
            (4.0 * rel) + (2.0 * demand) + (2.0 * freshness) + (1.0 * specificity) + (1.0 * competition_gap),
            2,
        )

        scored_list.append(
            {
                "keyword": cand,
                "score": total_score,
                "relevance": rel,
                "demand": demand,
                "freshness": freshness,
                "specificity": specificity,
                "competition_gap": competition_gap,
                "words_count": n_words,
            }
        )

    # Sort descending by score
    scored_list.sort(key=lambda x: (x["score"], x["relevance"], x["demand"]), reverse=True)
    top_25 = scored_list[:25]

    # Select primary_keyword: highest score that is 2-4 words
    primary_kw = ""
    for item in top_25:
        if 2 <= item["words_count"] <= 4:
            primary_kw = item["keyword"]
            break
    if not primary_kw and top_25:
        primary_kw = top_25[0]["keyword"]
    if not primary_kw:
        primary_kw = _clean_phrase(main_topic) or "video highlight"

    # Secondary keywords: next 3 keywords
    secondary_kws: List[str] = []
    for item in top_25:
        kw = item["keyword"]
        if kw != primary_kw and kw not in secondary_kws:
            secondary_kws.append(kw)
        if len(secondary_kws) >= 3:
            break

    # Longtail: autocomplete phrases of 4+ words
    longtail: List[str] = []
    for cand in autocomplete_ranks:
        if len(cand.split()) >= 4 and cand not in longtail:
            # Must have at least moderate relevance
            if _calc_relevance_heuristic(cand, transcript_tokens, topic_tokens) >= 0.5:
                longtail.append(cand)
        if len(longtail) >= 6:
            break

    # Fallback for longtail if none from autocomplete
    if not longtail:
        longtail = [f"{primary_kw} complete explained guide", f"{primary_kw} key tips shorts"]

    return {
        "primary_keyword": primary_kw,
        "secondary_keywords": secondary_kws,
        "longtail": longtail,
        "top_candidates": top_25,
    }
