"""Stage S6: Platform packaging for YouTube Shorts and Instagram Reels."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple

from ..config import SEOConfig

logger = logging.getLogger(__name__)


def package_metadata(
    title: str,
    title_alternatives: List[str],
    description_body: str,
    instagram_caption_body: str,
    hashtag_pool: Dict[str, List[Dict[str, str]]],
    keywords_data: Dict[str, Any],
    trending_confidence: str,
    config: SEOConfig,
    is_short: bool = True,
) -> Tuple[Dict[str, Any], List[str], str]:
    """
    Execute stage S6: Package metadata for YouTube Shorts and Instagram Reels.

    Returns:
        (platform_output, hidden_tags_list, final_youtube_description)
    """
    topic_tags = [it["tag"] for it in hashtag_pool.get("topic", [])]
    trending_tags = [it["tag"] for it in hashtag_pool.get("trending", [])]
    adjacent_tags = [it["tag"] for it in hashtag_pool.get("adjacent", [])]

    # 1. YouTube Shorts Packaging
    # Visibility rule: The first 3 tags found in description are shown above the title.
    # Order: Best topic tag, second topic tag, trending (or adjacent if low confidence).
    yt_selected: List[str] = []
    if topic_tags:
        yt_selected.append(topic_tags[0])
    if len(topic_tags) > 1:
        yt_selected.append(topic_tags[1])

    # 3rd visible tag: trending if confident, else adjacent or additional topic tag
    if trending_confidence == "high" and trending_tags:
        yt_selected.append(trending_tags[0])
    elif adjacent_tags:
        yt_selected.append(adjacent_tags[0])
    elif len(topic_tags) > 2:
        yt_selected.append(topic_tags[2])

    # 4th and 5th tags: mix
    for a in adjacent_tags:
        if a not in yt_selected and len(yt_selected) < config.yt_hashtags:
            yt_selected.append(a)

    # Reserved hashtag for Shorts (Shorts only!)
    if is_short and "#Shorts" not in yt_selected and len(yt_selected) < config.yt_hashtags:
        yt_selected.append("#Shorts")

    # Enforce config.yt_hashtags (hard max 15)
    yt_selected = yt_selected[: min(config.yt_hashtags, 15)]

    # YouTube description final: body + empty line + hashtag line
    hashtag_line = " ".join(yt_selected)
    description_final = f"{description_body.rstrip()}\n\n{hashtag_line}".strip()

    # 2. YouTube Hidden Tags
    # Unselected pool tags + 3-6 longtail phrases, stripped of '#', max 450 chars
    hidden_tags: List[str] = []
    used_chars = 0

    all_pool_tags = topic_tags + trending_tags + adjacent_tags
    unselected = [t.lstrip("#") for t in all_pool_tags if t not in yt_selected]

    longtail = keywords_data.get("longtail", [])
    primary_kw = keywords_data.get("primary_keyword", "")

    candidates_for_hidden: List[str] = []
    if primary_kw:
        candidates_for_hidden.append(primary_kw)
    candidates_for_hidden.extend(unselected)
    candidates_for_hidden.extend(longtail[:5])

    for raw in candidates_for_hidden:
        plain = " ".join(str(raw).replace("#", "").replace(",", " ").split()).strip()
        if not plain or plain.lower() in [h.lower() for h in hidden_tags]:
            continue
        projected = used_chars + len(plain) + (2 if hidden_tags else 0)
        if projected > 450:
            break
        hidden_tags.append(plain)
        used_chars = projected

    tags_field = ", ".join(hidden_tags)

    # 3. Instagram Reels Packaging
    # Mix: 2 topic, 1 trending (if high confidence, else adjacent/topic), 2 adjacent
    ig_selected: List[str] = []
    for t in topic_tags[:2]:
        if t not in ig_selected:
            ig_selected.append(t)

    # Trending slot: if trending_confidence is high, use trending; if low, swap for adjacent or topic
    if trending_confidence == "high" and trending_tags and trending_tags[0] not in ig_selected:
        ig_selected.append(trending_tags[0])
    elif adjacent_tags and adjacent_tags[0] not in ig_selected:
        ig_selected.append(adjacent_tags[0])
    elif len(topic_tags) > 2 and topic_tags[2] not in ig_selected:
        ig_selected.append(topic_tags[2])

    for a in adjacent_tags:
        if a not in ig_selected and len(ig_selected) < config.ig_hashtags:
            ig_selected.append(a)

    ig_selected = ig_selected[: config.ig_hashtags]
    ig_tag_line = " ".join(ig_selected)
    caption_final = f"{instagram_caption_body.rstrip()}\n\n{ig_tag_line}".strip()[:2200]

    platform_output = {
        "youtube_shorts": {
            "hashtags": yt_selected,
            "description_final": description_final,
            "tags_field": tags_field,
        },
        "instagram_reels": {
            "hashtags": ig_selected,
            "caption_final": caption_final,
        },
    }

    return platform_output, hidden_tags, description_final
