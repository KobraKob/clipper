"""Cut-specific SEO metadata for YouTube Shorts and Instagram Reels.

The generator uses the transcript as its evidence source, validates LLM suggestions against
that source, adds a deterministic keyword/phrase fallback, and optionally uses current Google
Trends topics only when they overlap the clip. Trend terms are never fabricated.
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

logger = logging.getLogger(__name__)

YT_TITLE_MAX = 100
YT_DESC_MAX = 5000
YT_TAGS_CHARS_MAX = 450
IG_CAPTION_MAX = 2200
IG_HASHTAGS_MAX = 5

# These are broad distribution / format tags, deliberately separate from topical tags.
GLOBAL_HASHTAGS = [
    "Shorts", "YouTubeShorts", "Reels", "ShortFormVideo", "ViralVideo",
    "TrendingNow", "MustWatch", "DailyContent", "CreatorCommunity", "Discover",
    "ForYou", "FYP", "ExplorePage", "WatchNow", "VideoOfTheDay",
    "ContentCreator", "NewVideo", "ShareThis", "Entertainment", "LearnSomething",
]

SEO_PROMPT = """You are a meticulous short-form video SEO editor. Generate metadata for THIS exact clip.
Treat the transcript as the source of truth. Do not introduce a person, claim, topic, statistic,
event, product, or promise that is not supported by the clip. Ignore generic channel-level context.

Rules:
- youtube_title: 35–70 characters when practical, front-load the most important phrase people
  would search for, make the payoff clear, and create curiosity without exaggerating. No hashtags.
- title_variants: create 3 genuinely distinct, transcript-grounded titles (direct, curiosity, question).
  Each option must describe this clip, not merely sound viral.
- youtube_description: 2–3 useful, specific sentences. Naturally repeat the primary search phrase.
  State what viewers will learn/see, invite a relevant comment, and do not invent credentials or results.
- keywords: 8–15 plausible search phrases based on concepts actually present in this transcript.
- hashtags: provide up to 30 topical hashtag candidates derived from names, concepts, entities,
  subtopics, and phrases that appear in or are directly implied by the clip. No generic filler.
- instagram_caption: use the hook and the exact topic. Do not write hashtags into the caption.
- Do not claim a keyword or hashtag is trending. Live trend candidates are handled and validated separately.
- language: {language}

Return ONLY valid JSON:
{{"youtube_title":"...","title_variants":[{{"id":"direct","title":"...","angle":"Direct Impact"}},{{"id":"curiosity","title":"...","angle":"Curiosity Gap"}},{{"id":"question","title":"...","angle":"Specific Question"}}],"youtube_description":"...","keywords":["..."],"hashtags":["..."],"instagram_caption":"..."}}

Clip title: {title}
Clip hook: {hook}
Transcript:
\"\"\"{text}\"\"\"
"""

_STOP = set(
    """a an the and or but if so to of in on at for with from by as is are was were be been being
    it its this that these those i you he she we they me him her us them my your his our their
    not no yes do does did done have has had will would can could should just like really very
    about into than then there here what when where who whom why how all any some more most other
    out up down over under again also get got going gonna thing things know think say said says
    yeah okay right well one two three four much many make made use using used get gets got
    video videos clip clips shorts short reel reels watch follow comment subscribe today now
    best top amazing crazy truth revealed reveal ultimate full explained explain""".split()
)


def _truncate(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    prefix = text[: max(1, limit - 1)].rsplit(" ", 1)[0].rstrip(",;:-– ")
    return (prefix or text[: limit - 1]) + "…"


def _tokens(value: str) -> List[str]:
    # Split camel case before tokenization so "PersonalFinanceTips" is searchable.
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", value or "")
    return [
        word.lower()
        for word in re.findall(r"[A-Za-z][A-Za-z']{2,}", text)
        if word.lower() not in _STOP
    ]


def _expanded_tokens(value: str) -> set[str]:
    result: set[str] = set()
    for word in _tokens(value):
        result.add(word)
        if len(word) > 4 and word.endswith("ies"):
            result.add(word[:-3] + "y")
        if len(word) > 5 and word.endswith(("ing", "ers")):
            result.add(word[:-3])
        if len(word) > 4 and word.endswith("ed"):
            result.add(word[:-2])
        if len(word) > 4 and word.endswith("s") and not word.endswith("ss"):
            result.add(word[:-1])
    return result


def _is_relevant(candidate: str, reference: str) -> bool:
    candidate_tokens = _expanded_tokens(candidate)
    reference_tokens = _expanded_tokens(reference)
    return bool(candidate_tokens and candidate_tokens.intersection(reference_tokens))


def _slug_tag(value: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", re.sub(r"([a-z])([A-Z])", r"\1 \2", value or ""))
    return "".join(word[:1].upper() + word[1:] for word in words)


def _top_keywords(text: str, n: int = 20) -> List[str]:
    words = _tokens(text)
    counts = Counter(words)
    # Preserve first occurrence as a stable tie-break instead of arbitrary set order.
    first = {word: words.index(word) for word in counts}
    return sorted(counts, key=lambda word: (-counts[word], first[word]))[:n]


def _topic_phrases(text: str, n: int = 100) -> List[str]:
    """Create ranked, transcript-derived unigrams, bigrams, and trigrams."""
    result: List[str] = []
    for source in re.split(r"[.!?;\n]+", text or ""):
        raw_words = re.findall(r"[A-Za-z][A-Za-z']{2,}", source)
        for size in (3, 2):
            for start in range(0, max(0, len(raw_words) - size + 1)):
                phrase_words = raw_words[start : start + size]
                meaningful = [word for word in phrase_words if word.lower() not in _STOP]
                if len(meaningful) >= 2:
                    result.append(" ".join(meaningful))
    result.extend(_top_keywords(text, n=50))
    seen: set[str] = set()
    unique: List[str] = []
    for phrase in result:
        key = re.sub(r"[^a-z0-9]", "", phrase.lower())
        if key and key not in seen:
            seen.add(key)
            unique.append(phrase)
        if len(unique) >= n:
            break
    return unique


def _clean_candidate_tags(raw: Any) -> List[str]:
    if not isinstance(raw, list):
        return []
    tags: List[str] = []
    seen: set[str] = set()
    for value in raw:
        tag = _slug_tag(str(value).replace("#", "").strip())
        key = tag.casefold()
        if tag and not tag.isdigit() and key not in seen:
            seen.add(key)
            tags.append(tag)
    return tags


def _unique_tags(values: Iterable[str], reference: str, limit: int) -> List[str]:
    result: List[str] = []
    seen: set[str] = set()
    for value in values:
        tag = _slug_tag(value)
        key = tag.casefold()
        if not tag or tag.isdigit() or key in seen or not _is_relevant(tag, reference):
            continue
        seen.add(key)
        result.append(tag)
        if len(result) >= limit:
            break
    return result


def _relevant_hashtags(
    raw_tags: Any,
    keywords: Sequence[str],
    clip: Dict[str, Any],
    text: str,
    limit: int = 20,
) -> List[str]:
    reference = " ".join(
        [str(clip.get("title", "")), str(clip.get("hook", "")), text, " ".join(keywords)]
    )
    candidates: List[str] = []
    candidates.extend(_clean_candidate_tags(raw_tags))
    candidates.extend(str(item) for item in keywords)
    candidates.extend(_topic_phrases(" ".join([str(clip.get("title", "")), str(clip.get("hook", "")), text])))
    candidates.extend(_top_keywords(text, 50))
    # When a short transcript yields too few distinct phrases, derive honest topical long-tail tags
    # from the same keyword set instead of padding with unrelated trends or generic spam.
    for keyword in list(keywords) + _top_keywords(text, 30):
        if len(_tokens(str(keyword))) == 0:
            continue
        for suffix in ("Tips", "Explained", "Guide", "Insights", "Basics", "Strategies"):
            candidates.append(f"{keyword} {suffix}")

    return _unique_tags(candidates, reference, limit)


def _trending_hashtags(
    trending_topics: Optional[Sequence[Any]],
    reference: str,
    excluded: Iterable[str],
    limit: int = 10,
) -> List[str]:
    """Return only current feed terms that overlap the clip; never pad with unrelated trends."""
    excluded_keys = {item.casefold() for item in excluded}
    candidates: List[str] = []
    reference_tokens = _tokens(reference)
    for item in trending_topics or []:
        title = str(item.get("title", "")) if isinstance(item, dict) else str(item)
        tag = _slug_tag(title)
        overlap = _tokens(title).intersection(reference_tokens)
        # A shared long-tail term can be meaningful on its own; common one-word overlaps are weak.
        strong_overlap = len(overlap) >= 2 or any(len(word) >= 9 for word in overlap)
        if tag and strong_overlap and tag.casefold() not in excluded_keys:
            candidates.append(tag)
    return _unique_tags(candidates, reference, limit)


def _fallback_title(clip: Dict[str, Any], text: str, keywords: Sequence[str]) -> str:
    title = str(clip.get("title") or "").strip()
    hook = str(clip.get("hook") or "").strip().rstrip(".! ")
    reference = f"{title} {hook} {text}"
    if title and _is_relevant(title, f"{hook} {text}"):
        return _truncate(title, 70)
    if hook and _is_relevant(hook, text):
        return _truncate(hook, 70)
    main = next(iter(keywords), None)
    if main:
        return _truncate(f"{main.title()}: the key point", 70)
    meaningful = _top_keywords(text, 3)
    if meaningful:
        return _truncate(" ".join(word.title() for word in meaningful[:3]), 70)
    return "Key Takeaway"


def fallback_metadata(clip: Dict[str, Any], text: str) -> Dict[str, Any]:
    """Deterministic, clip-specific metadata used when the LLM is unavailable."""
    keywords = _top_keywords(text, 15)
    main_title = _fallback_title(clip, text, keywords)
    hook = str(clip.get("hook") or main_title).strip()
    variants = [
        {"id": "direct", "title": _truncate(main_title, 70), "angle": "Direct Impact"},
        {"id": "curiosity", "title": _truncate(f"What {main_title.rstrip('?!.')} Means", 70), "angle": "Curiosity Gap"},
        {"id": "question", "title": _truncate(f"Why {main_title.rstrip('?!.')} Matters", 70), "angle": "Bold Question"},
    ]
    reference = " ".join([str(clip.get("title", "")), hook, text])
    relevant = _relevant_hashtags([], keywords, clip, text, limit=20)
    return {
        "youtube_title": main_title,
        "title_variants": variants,
        "selected_title_variant": "direct",
        "youtube_description": (
            f"{_truncate(hook, 220)}\n\n"
            f"This clip covers {', '.join(keywords[:3]) or 'the key idea'} in context. "
            "Share your take in the comments."
        ),
        "keywords": keywords,
        "hashtags": relevant,
        "instagram_caption": f"{_truncate(hook, 180)}\n\nWhat is your take?",
    }


def generate_metadata(
    clip: Dict[str, Any],
    transcript_text: str,
    llm: Any = None,
    language: str = "English",
    source_url: Optional[str] = None,
    credit_source: bool = True,
    trending_topics: Optional[Sequence[Any]] = None,
    trend_region: str = "IN",
) -> Dict[str, Any]:
    """Create SEO metadata, validating generated language against the clip transcript."""
    text = " ".join(str(transcript_text or "").split())[:6000]
    reference = " ".join([str(clip.get("title", "")), str(clip.get("hook", "")), text])
    raw: Dict[str, Any] = {}
    if llm is not None and text:
        prompt = SEO_PROMPT.format(
            language=language,
            title=str(clip.get("title", "")),
            hook=str(clip.get("hook", "")),
            text=text,
        )
        try:
            raw = llm.complete_json(prompt, tier="strong") or {}
            if not isinstance(raw, dict):
                raw = {}
        except Exception as exc:
            logger.warning("[seo] LLM metadata failed (%s); using deterministic fallback.", exc)
            raw = {}

    fallback = fallback_metadata(clip, text)

    def candidate_list(key: str) -> List[str]:
        value = raw.get(key)
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()]

    keywords: List[str] = []
    seen_keywords: set[str] = set()
    for value in candidate_list("keywords") + [str(item) for item in fallback["keywords"]] + _top_keywords(text, 20):
        keyword = " ".join(str(value).replace("#", "").split()).lower().strip()
        key = keyword.casefold()
        if not keyword or key in seen_keywords or not _is_relevant(keyword, reference):
            continue
        seen_keywords.add(key)
        keywords.append(keyword)
        if len(keywords) >= 15:
            break

    candidate_title = str(raw.get("youtube_title") or "")
    if candidate_title and _is_relevant(candidate_title, reference):
        title = _truncate(candidate_title, 70)
    else:
        title = _truncate(fallback["youtube_title"], 70)

    raw_variants = raw.get("title_variants")
    variants: List[Dict[str, str]] = []
    if isinstance(raw_variants, list):
        for index, value in enumerate(raw_variants):
            if not isinstance(value, dict):
                continue
            variant_title = str(value.get("title") or "").strip()
            if not variant_title or not _is_relevant(variant_title, reference):
                continue
            variants.append({
                "id": str(value.get("id") or f"variant_{index}"),
                "title": _truncate(variant_title, 70),
                "angle": str(value.get("angle") or "Specific angle")[:60],
            })
            if len(variants) == 3:
                break
    if len(variants) < 2:
        variants = fallback["title_variants"]
    if not any(item["title"].casefold() == title.casefold() for item in variants):
        variants.insert(0, {"id": "direct", "title": title, "angle": "Direct Impact"})
    variants = variants[:3]

    description = str(raw.get("youtube_description") or "")
    if not description or not _is_relevant(description, reference):
        description = str(fallback["youtube_description"])
    # Avoid repetitive, keyword-stuffed descriptions while preserving the core topic.
    description = description.strip()
    if credit_source and source_url and source_url.startswith("http"):
        description += f"\n\nFull video: {source_url}"

    relevant_tags = _relevant_hashtags(
        candidate_list("hashtags"),
        keywords,
        clip,
        text,
        limit=20,
    )
    global_tags: List[str] = []
    seen = {tag.casefold() for tag in relevant_tags}
    for tag in GLOBAL_HASHTAGS:
        if tag.casefold() not in seen:
            global_tags.append(tag)
            seen.add(tag.casefold())
        if len(global_tags) >= 10:
            break
    trend_tags = _trending_hashtags(
        trending_topics,
        reference,
        seen,
        limit=10,
    )
    hashtags = relevant_tags + global_tags + trend_tags

    # Use a clear, truthful note in metadata when live trends are missing or irrelevant.
    trend_status = "unavailable" if trending_topics is None else (
        "empty-feed" if len(trending_topics) == 0 else (
            "matched" if len(trend_tags) >= 10 else (
                "partial" if trend_tags else "no-relevant-current-trends"
            )
        )
    )
    trend_checked_at = datetime.now(timezone.utc).isoformat() if trending_topics is not None else None

    # Keep the platform-specific bank. YouTube ignores hashtags after 60 and warns against
    # over-tagging; we cap at 40 and use only 5 for Instagram's current post/Reel limit.
    hashtag_line = " ".join("#" + tag for tag in hashtags[:40])
    description += "\n\n" + hashtag_line
    description = description[:YT_DESC_MAX]

    youtube_tags: List[str] = []
    used_chars = 0
    for value in list(keywords) + [tag.lower() for tag in hashtags]:
        clean = " ".join(value.lower().split()).strip()
        if not clean or clean in youtube_tags:
            continue
        projected = used_chars + len(clean) + (1 if youtube_tags else 0)
        if projected > YT_TAGS_CHARS_MAX:
            continue
        youtube_tags.append(clean)
        used_chars = projected

    # Instagram's five-tag limit means it gets its strongest topical tags, not the whole bank.
    instagram_tags: List[str] = []
    for tag in relevant_tags + [tag for tag in global_tags if tag.casefold() == "reels"]:
        if tag.casefold() not in {value.casefold() for value in instagram_tags}:
            instagram_tags.append(tag)
        if len(instagram_tags) >= IG_HASHTAGS_MAX:
            break
    instagram_caption = str(raw.get("instagram_caption") or "")
    if not instagram_caption or not _is_relevant(instagram_caption, reference):
        instagram_caption = str(fallback["instagram_caption"])
    instagram_caption = _truncate(instagram_caption, IG_CAPTION_MAX - 120)
    instagram_caption += "\n\n" + " ".join("#" + tag for tag in instagram_tags)

    return {
        "youtube": {
            "title": title,
            "title_variants": variants,
            "selected_variant": variants[0]["id"] if variants else "direct",
            "description": description,
            "tags": youtube_tags,
        },
        "instagram": {"caption": instagram_caption[:IG_CAPTION_MAX]},
        "title_variants": variants,
        "selected_title_variant": variants[0]["id"] if variants else "direct",
        "hashtags": hashtags,
        "hashtag_groups": {
            "relevant": relevant_tags,
            "global": global_tags,
            "trending": trend_tags,
        },
        "trend_source": "Google Trends RSS" if trending_topics is not None else None,
        "trend_region": trend_region.upper(),
        "trend_checked_at": trend_checked_at,
        "trend_status": trend_status,
        "keywords": keywords,
        "generated_by": "llm" if raw else "heuristic",
    }
