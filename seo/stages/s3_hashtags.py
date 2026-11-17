"""Stage S3: Hashtag pool builder (10 topic / 10 trending / 10 adjacent)."""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

GENERIC_SPAM_TAGS = {
    "viral", "video", "videos", "trending", "trendingnow", "viralvideo", "explore",
    "explorepage", "love", "foryou", "fyp", "foryoupage", "mustwatch", "dailycontent",
    "creatorcommunity", "discover", "watchnow", "videooftheday", "contentcreator",
    "newvideo", "sharethis", "entertainment", "learnsomething", "shortformvideo",
    "youtube", "youtubeshorts", "instagram", "reels", "tiktok", "shorts", "reel",
    "clip", "clips", "amazing", "crazy", "subscribe", "follow", "like", "comment",
}


CATEGORY_HIGH_RANKING_TAGS: Dict[str, List[str]] = {
    "business": [
        "business", "entrepreneur", "startup", "investing", "wealth", "fintech",
        "passiveincome", "businessstrategy", "finance", "moneytips", "economics",
        "marketanalysis", "leadership", "sidehustle", "venturecapital", "scaling",
        "financialfreedom", "businesstips", "corporate", "success",
    ],
    "tech": [
        "tech", "technology", "software", "coding", "programming", "artificialintelligence",
        "machinelearning", "futuretech", "developer", "datascience", "cybersecurity",
        "webdevelopment", "cloudcomputing", "innovation", "computerscience", "hardware",
        "techreview", "automation", "gadgets", "digitaltransformation",
    ],
    "education": [
        "education", "learning", "studywithme", "knowledge", "science", "mindset",
        "selfimprovement", "productivity", "studytips", "lifehacks", "history",
        "skills", "psychology", "personaldevelopment", "criticalthinking", "tutorial",
        "deepdive", "explained", "learnsomethingnew", "research",
    ],
    "lifestyle": [
        "lifestyle", "wellness", "habits", "dailytips", "inspiration", "mindfulness",
        "routine", "selfcare", "healthyhabits", "mindset", "focus", "dailyroutine",
        "motivation", "wellbeing", "worklifebalance", "healthyliving", "positivity",
        "growthmindset", "fitness", "nutrition",
    ],
    "gaming": [
        "gaming", "gameplay", "gamers", "gamingcommunity", "twitch", "esports",
        "pcgaming", "playstation", "xbox", "nintendo", "videogames", "gamer",
        "gamingclips", "streamer", "walkthrough", "gaminglife", "indiegames",
        "rpg", "multiplayer", "speedrun",
    ],
    "news": [
        "news", "currentaffairs", "worldnews", "breakingnews", "analysis", "insight",
        "geopolitics", "journalism", "globalnews", "politics", "reporting",
        "dailybriefing", "press", "headlines", "economy", "factcheck",
        "investigative", "opinion", "interview", "commentary",
    ],
    "entertainment": [
        "entertainment", "cinema", "movies", "film", "series", "popculture",
        "behindthescenes", "storytelling", "actor", "hollywood", "filmmaking",
        "reviews", "trailer", "streaming", "acting", "culture",
    ],
    "sports": [
        "sports", "athlete", "training", "workout", "fitness", "championship",
        "coaching", "competition", "highlights", "athletics", "matchday",
        "sportsnews", "gameon", "exercise", "strength", "cardio",
    ],
    "music": [
        "music", "musician", "songwriter", "production", "beats", "guitar",
        "piano", "soundtrack", "melody", "vocals", "audio", "liveperformance",
        "composer", "recording", "artist", "instrumental",
    ],
    "other": [
        "insight", "knowledge", "strategy", "breakthrough", "perspectives",
        "essentialguide", "quicktips", "analysis", "framework", "concepts",
        "overview", "deepdive", "essentials", "smartstrategy", "guidelines",
    ],
}


def normalize_tag(value: str) -> Optional[str]:
    """
    Format tag: lowercase, letters/digits/_/unicode combining marks only, prefix '#', max 30 chars.
    Reject pure numbers, pure underscores, or generic spam tags.
    """
    raw = str(value or "").strip().lstrip("#")
    if not raw:
        return None

    chars: List[str] = []
    has_letter = False
    for ch in raw:
        cat = unicodedata.category(ch)
        if cat.startswith("L"):
            has_letter = True
            chars.append(ch.lower())
        elif cat.startswith(("N", "M")) or ch == "_":
            chars.append(ch.lower())
        elif ch in (" ", "-", ".", "/"):
            continue

    cleaned = "".join(chars).strip("_")
    if not cleaned or not has_letter:
        return None

    # Reject pure numbers
    if cleaned.isdigit():
        return None

    # Reject generic spam
    if cleaned in GENERIC_SPAM_TAGS:
        return None

    tag = f"#{cleaned[:29]}"
    # Verify length and that it starts with #
    if len(tag) > 30 or len(tag) < 2:
        return None

    return tag


def _build_candidates(
    topic_data: Dict[str, Any],
    research_data: Dict[str, Any],
    keywords_data: Dict[str, Any],
) -> Tuple[List[Dict[str, str]], List[Dict[str, str]], List[Dict[str, str]]]:
    """
    Assemble raw candidates partitioned into Topic, Trending, Adjacent.
    """
    main_topic = str(topic_data.get("main_topic") or "")
    entities = topic_data.get("entities") or []
    primary_kw = str(keywords_data.get("primary_keyword") or "")
    secondary_kws = keywords_data.get("secondary_keywords") or []
    category = str(topic_data.get("category") or "lifestyle")

    # 1. Topic candidates (relevance 1.0)
    topic_cands: List[Dict[str, str]] = []
    if primary_kw:
        t = normalize_tag(primary_kw)
        if t:
            topic_cands.append({"tag": t, "source": "primary_keyword", "reason": f"Direct core focus on {primary_kw}"})
    for sk in secondary_kws:
        t = normalize_tag(sk)
        if t:
            topic_cands.append({"tag": t, "source": "secondary_keyword", "reason": f"Core sub-topic covering {sk}"})
    if main_topic:
        t = normalize_tag(main_topic)
        if t:
            topic_cands.append({"tag": t, "source": "main_topic", "reason": f"Exact subject matter of {main_topic}"})
    for ent in entities:
        t = normalize_tag(ent)
        if t:
            topic_cands.append({"tag": t, "source": "entity", "reason": f"Named subject explicitly featured: {ent}"})

    # Add autocomplete suggestions related to topic
    for blk in research_data.get("autocomplete", [])[:3]:
        for sugg in blk.get("suggestions", [])[:5]:
            t = normalize_tag(sugg)
            if t:
                topic_cands.append({"tag": t, "source": "autocomplete", "reason": f"Real viewer search query on {sugg}"})

    # Add tags from top recent videos matching topic
    for vid in research_data.get("top_recent_videos", [])[:8]:
        for tag in vid.get("hashtags", []):
            t = normalize_tag(tag)
            if t:
                topic_cands.append({"tag": t, "source": "top_videos", "reason": f"Proven performer on matching topic {tag}"})

    # 2. Trending candidates
    trending_cands: List[Dict[str, str]] = []
    # Source A: Google Trending Now with relevance gate
    topic_tokens = set(re.findall(r"\w+", f"{main_topic} {primary_kw}".lower()))
    for item in research_data.get("trending_now", []):
        q = item.get("query", "")
        q_tokens = set(re.findall(r"\w+", q.lower()))
        # Relevance gate: must overlap with clip topic or entities
        is_relevant = bool(q_tokens.intersection(topic_tokens)) or any(
            e.lower() in q.lower() for e in entities
        )
        if is_relevant:
            t = normalize_tag(q)
            if t:
                traffic = item.get("traffic") or "high"
                trending_cands.append(
                    {
                        "tag": t,
                        "source": "trending_now",
                        "reason": f"Real-time Google search spike with traffic {traffic}",
                    }
                )

    # Source B: Niche-trending: hashtags in >= 3 top recent videos (last 14 days), ranked by views
    tag_counts: Dict[str, int] = {}
    tag_views: Dict[str, int] = {}
    for vid in research_data.get("top_recent_videos", []):
        views = int(vid.get("views", 0))
        for tag in vid.get("hashtags", []):
            t = normalize_tag(tag)
            if t:
                tag_counts[t] = tag_counts.get(t, 0) + 1
                tag_views[t] = tag_views.get(t, 0) + views

    niche_trending_sorted = sorted(
        [t for t, count in tag_counts.items() if count >= 2],
        key=lambda x: tag_views.get(x, 0),
        reverse=True,
    )
    for t in niche_trending_sorted:
        trending_cands.append(
            {
                "tag": t,
                "source": "niche_trending",
                "reason": f"Consistently viral in niche with {tag_views.get(t, 0):,} views",
            }
        )

    # Source C: Web news search terms
    for w_item in research_data.get("web", []):
        for r_res in w_item.get("results", [])[:3]:
            title = r_res.get("title", "")
            title_words = [w for w in re.findall(r"[A-Za-z0-9]+", title) if len(w) > 4]
            for w in title_words[:2]:
                t = normalize_tag(w)
                if t and t not in [c["tag"] for c in trending_cands]:
                    trending_cands.append(
                        {
                            "tag": t,
                            "source": "news",
                            "reason": f"Active current headline term from weekly news",
                        }
                    )

    # 3. Adjacent candidates
    adjacent_cands: List[Dict[str, str]] = []
    # Broader category tags
    cat_tag = normalize_tag(category)
    if cat_tag:
        adjacent_cands.append(
            {
                "tag": cat_tag,
                "source": "category",
                "reason": f"Primary content category context for {category}",
            }
        )

    # Related audience interests / genre terms
    genre_map = {
        "business": ["entrepreneurship", "startup", "investing", "wealth", "fintech", "passiveincome"],
        "tech": ["futuretech", "software", "artificialintelligence", "coding", "machinelearning", "devcommunity"],
        "education": ["learning", "lifehacks", "selfimprovement", "mindset", "productivity", "studywithme"],
        "lifestyle": ["habits", "wellness", "dailytips", "inspiration", "mindfulness", "routine"],
        "gaming": ["gameplay", "gamers", "gamingcommunity", "twitch", "esports", "pcgaming"],
        "news": ["currentaffairs", "worldnews", "analysis", "insight", "breakingnews", "geopolitics"],
    }
    for sub in genre_map.get(category.lower(), ["insights", "growth", "knowledge", "strategy", "breakthrough"]):
        t = normalize_tag(sub)
        if t:
            adjacent_cands.append(
                {
                    "tag": t,
                    "source": "category_adjacent",
                    "reason": f"High affinity viewer interest in {sub}",
                }
            )

    # Category autocomplete phrases
    for blk in research_data.get("autocomplete", [])[2:]:
        for sugg in blk.get("suggestions", [])[:4]:
            t = normalize_tag(sugg)
            if t:
                adjacent_cands.append(
                    {
                        "tag": t,
                        "source": "related_autocomplete",
                        "reason": f"Common adjacent search query: {sugg}",
                    }
                )

    return topic_cands, trending_cands, adjacent_cands


def _call_llm_hashtag_selection(
    topic_data: Dict[str, Any],
    transcript_text: str,
    raw_topic: List[Dict[str, str]],
    raw_trending: List[Dict[str, str]],
    raw_adjacent: List[Dict[str, str]],
    llm: Any,
) -> Optional[Dict[str, List[Dict[str, str]]]]:
    """Call LLM to rank and trim hashtag candidates into 10/10/10 pool."""
    if llm is None:
        return None

    summary = topic_data.get("one_line_summary", "")
    candidates_json = json.dumps({
        "topic": raw_topic[:15],
        "trending": raw_trending[:15],
        "adjacent": raw_adjacent[:15],
    })

    prompt = (
        "You are choosing hashtags for a short video.\n"
        f"Clip summary: {summary}\n"
        f"Transcript excerpt: {transcript_text[:1200]}\n"
        f"Candidates by group, with source and relevance: {candidates_json}\n\n"
        "Return ONLY JSON with exactly 10 tags in each of \"topic\", \"trending\", \"adjacent\".\n"
        "Rules:\n"
        "- Pick only from the candidates, unless a tag is clearly justified by the transcript.\n"
        "- \"trending\" tags must come from the trending candidates AND be connected to this clip. If you cannot find 10, return fewer and say so in \"notes\".\n"
        "- No duplicates across groups. No misleading tags.\n"
        "- For each tag give a 6-12 word reason.\n"
        "Format: {\"topic\": [{\"tag\": \"#...\", \"reason\": \"...\"}], \"trending\": [...], \"adjacent\": [...]}"
    )

    try:
        data = llm.complete_json(prompt, tier="strong")
        if not isinstance(data, dict):
            return None
        if "topic" in data and "trending" in data and "adjacent" in data:
            return data
    except Exception as exc:
        logger.debug("[s3_hashtags] LLM hashtag selection error: %s", exc)

    return None


def build_hashtag_pool(
    topic_data: Dict[str, Any],
    research_data: Dict[str, Any],
    keywords_data: Dict[str, Any],
    transcript_text: str = "",
    llm: Any = None,
) -> Tuple[Dict[str, List[Dict[str, str]]], str, List[str]]:
    """
    Construct exactly 30 hashtags: 10 Topic, 10 Trending, 10 Adjacent.
    Strictly enforces platform safety, deduplication, and backfill rules.

    Returns:
        (hashtag_pool_dict, trending_confidence, warnings)
    """
    raw_topic, raw_trending, raw_adjacent = _build_candidates(
        topic_data, research_data, keywords_data
    )

    warnings: List[str] = []
    trending_confidence = "high"
    seen_tags: Set[str] = set()

    # Try LLM selection if available
    llm_selection = _call_llm_hashtag_selection(
        topic_data, transcript_text, raw_topic, raw_trending, raw_adjacent, llm
    )

    def _dedupe_and_clean(items: List[Dict[str, Any]], default_source: str) -> List[Dict[str, str]]:
        out: List[Dict[str, str]] = []
        for it in items:
            raw_tag = it.get("tag") or ""
            t = normalize_tag(raw_tag)
            if not t or t in seen_tags:
                continue
            seen_tags.add(t)
            out.append({
                "tag": t,
                "source": it.get("source") or default_source,
                "reason": it.get("reason") or "Directly relevant to video content",
            })
        return out

    if llm_selection:
        final_topic = _dedupe_and_clean(llm_selection.get("topic", []), "topic_llm")
        final_trending = _dedupe_and_clean(llm_selection.get("trending", []), "trending_llm")
        final_adjacent = _dedupe_and_clean(llm_selection.get("adjacent", []), "adjacent_llm")
    else:
        final_topic = _dedupe_and_clean(raw_topic, "topic")
        final_trending = _dedupe_and_clean(raw_trending, "trending")
        final_adjacent = _dedupe_and_clean(raw_adjacent, "adjacent")

    # Check trending shortfall
    category = str(topic_data.get("category") or "lifestyle").lower()
    cat_fallback_tags = CATEGORY_HIGH_RANKING_TAGS.get(category, CATEGORY_HIGH_RANKING_TAGS["other"])

    if len(final_trending) < 10:
        shortfall = 10 - len(final_trending)
        trending_confidence = "low"
        warnings.append(f"trending_shortfall:{shortfall}")

        # Backfill priority 1: from raw_trending, raw_topic and raw_adjacent (without duplicating)
        backfill_candidates = [
            item for item in (raw_trending + raw_topic + raw_adjacent)
            if normalize_tag(item.get("tag", "")) and normalize_tag(item.get("tag", "")) not in seen_tags
        ]
        for item in backfill_candidates:
            if len(final_trending) >= 10:
                break
            t = normalize_tag(item["tag"])
            if t and t not in seen_tags:
                seen_tags.add(t)
                final_trending.append(
                    {
                        "tag": t,
                        "source": "trending_backfill",
                        "reason": f"High-relevance contextual tag backfill: {item.get('reason', '')}",
                    }
                )

        # Backfill priority 2: from high-ranking category tags (Section 4.4)
        for cat_word in cat_fallback_tags:
            if len(final_trending) >= 10:
                break
            t = normalize_tag(cat_word)
            if t and t not in seen_tags:
                seen_tags.add(t)
                final_trending.append(
                    {
                        "tag": t,
                        "source": "category_trending_backfill",
                        "reason": f"High-ranking category trend backfill for {category}",
                    }
                )

    # Ensure topic has at least 10 items
    if len(final_topic) < 10:
        for item in raw_topic:
            t = normalize_tag(item.get("tag", ""))
            if t and t not in seen_tags:
                seen_tags.add(t)
                final_topic.append(item)
            if len(final_topic) >= 10:
                break

    if len(final_topic) < 10:
        main_topic_words = re.findall(r"\w+", str(topic_data.get("main_topic") or "").lower())
        for w in main_topic_words:
            t = normalize_tag(w)
            if t and t not in seen_tags:
                seen_tags.add(t)
                final_topic.append({"tag": t, "source": "topic_stem", "reason": f"Direct topic root component {w}"})
            if len(final_topic) >= 10:
                break

    # Ensure adjacent has at least 10 items
    if len(final_adjacent) < 10:
        for item in raw_adjacent:
            t = normalize_tag(item.get("tag", ""))
            if t and t not in seen_tags:
                seen_tags.add(t)
                final_adjacent.append(item)
            if len(final_adjacent) >= 10:
                break

    category = str(topic_data.get("category") or "lifestyle").lower()
    common_adjacent_fallbacks = [
        "besttips", "quickguide", "protips", "keyinsights", "knowledgebase",
        "deepdive", "mustknow", "smartstrategy", "coreconcepts", "breakthrough",
        "essentialguide", "expertadvice", "mindsetshift", "practicalskills",
    ]
    for fallback in common_adjacent_fallbacks:
        if len(final_adjacent) >= 10:
            break
        t = normalize_tag(f"{category}{fallback}") or normalize_tag(fallback)
        if t and t not in seen_tags:
            seen_tags.add(t)
            final_adjacent.append(
                {
                    "tag": t,
                    "source": "category_adjacent_fallback",
                    "reason": f"Standard category insight pillar for {category}",
                }
            )

    # If any group still short, backfill from keywords and entities
    def _fill_from_keywords(group: List[Dict[str, str]], grp_name: str) -> None:
        all_kws = (
            [keywords_data.get("primary_keyword", "")]
            + (keywords_data.get("secondary_keywords") or [])
            + (keywords_data.get("longtail") or [])
            + (topic_data.get("entities") or [])
            + (topic_data.get("seed_keywords") or [])
        )
        for kw in all_kws:
            if len(group) >= 10:
                break
            for word in re.findall(r"\w+", str(kw)):
                t = normalize_tag(word)
                if t and t not in seen_tags:
                    seen_tags.add(t)
                    group.append({
                        "tag": t,
                        "source": f"{grp_name}_kw_backfill",
                        "reason": f"Grounded keyword candidate from clip: {word}",
                    })
                if len(group) >= 10:
                    break

    _fill_from_keywords(final_topic, "topic")
    _fill_from_keywords(final_trending, "trending")
    _fill_from_keywords(final_adjacent, "adjacent")

    # Final guarantee: backfill any remaining slots from category tags
    for grp, name in [(final_topic, "topic"), (final_trending, "trending"), (final_adjacent, "adjacent")]:
        for cat_word in cat_fallback_tags:
            if len(grp) >= 10:
                break
            t = normalize_tag(cat_word)
            if t and t not in seen_tags:
                seen_tags.add(t)
                grp.append({
                    "tag": t,
                    "source": f"category_{name}_backfill",
                    "reason": f"Contextual category pillar for {category}",
                })

    # Trim strictly to 10
    final_topic = final_topic[:10]
    final_trending = final_trending[:10]
    final_adjacent = final_adjacent[:10]

    pool = {
        "topic": final_topic,
        "trending": final_trending,
        "adjacent": final_adjacent,
    }

    return pool, trending_confidence, warnings
