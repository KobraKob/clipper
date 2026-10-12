"""
Title / description / hashtag generation for each exported clip (YouTube Shorts + Instagram Reels).

Uses the configured LLM (Groq or local) with a strict JSON contract. If the LLM fails or returns junk,
a deterministic heuristic fallback still produces usable metadata, so publishing never blocks on SEO.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

YT_TITLE_MAX = 100
YT_DESC_MAX = 5000
YT_TAGS_CHARS_MAX = 450  # API limit is 500 chars total across tags; keep headroom
IG_CAPTION_MAX = 2200
IG_HASHTAGS_MAX = 5  # Instagram now caps hashtags per post; a few relevant ones outperform a wall of tags

SEO_PROMPT = """You write metadata for short-form vertical videos (YouTube Shorts, Instagram Reels).
Given the clip transcript, produce metadata optimised for search and for click-through.

Rules:
- youtube_title: max 70 characters, curiosity-driven, front-load the main keyword, no clickbait lies,
  no hashtags, no ALL CAPS shouting, no emoji spam (at most one emoji).
- title_variants: array of 3 distinct title options for A/B testing:
  [
    {{"id": "curiosity", "title": "...", "angle": "Curiosity Gap"}},
    {{"id": "direct", "title": "...", "angle": "Direct Impact"}},
    {{"id": "question", "title": "...", "angle": "Bold Question"}}
  ]
- youtube_description: 2-3 short sentences. Line 1 must restate the hook with the main keyword.
  Then one line inviting a comment/follow. Do NOT include hashtags here.
- keywords: 8-12 search keywords/phrases people would actually type (lowercase, no #).
- hashtags: 6-10 hashtags WITHOUT the # symbol: 2-3 broad (e.g. shorts, fyp), 3-5 topic-specific, 1-2 niche.
- instagram_caption: a scroll-stopping first line (the hook), then 1-2 short lines, then a call to action
  (e.g. "Follow for more"). No hashtags in this text.
- language: {language}

Return ONLY valid JSON:
{{"youtube_title": "...", "title_variants": [{{"id": "curiosity", "title": "...", "angle": "Curiosity Gap"}}, {{"id": "direct", "title": "...", "angle": "Direct Impact"}}, {{"id": "question", "title": "...", "angle": "Bold Question"}}], "youtube_description": "...", "keywords": ["..."], "hashtags": ["..."], "instagram_caption": "..."}}

Clip title (internal): {title}
Clip hook: {hook}
Transcript:
\"\"\"{text}\"\"\"
"""

_STOP = set(
    "a an the and or but if so to of in on at for with from by as is are was were be been being it its this that "
    "these those i you he she we they me him her us them my your his our their not no yes do does did done have has "
    "had will would can could should just like really very about into than then there here what when where who whom "
    "why how all any some more most other out up down over under again also get got going gonna thing things know "
    "think say said says yeah okay right well one two".split()
)


def _slug_tag(text: str) -> str:
    return re.sub(r"[^0-9a-zA-Z]", "", text.title().replace(" ", ""))


def _top_keywords(text: str, n: int = 10) -> List[str]:
    words = re.findall(r"[A-Za-z][A-Za-z']{3,}", text.lower())
    counts = Counter(w for w in words if w not in _STOP)
    return [w for w, _ in counts.most_common(n)]


def _clean_hashtags(raw: Any, extra: Optional[List[str]] = None, limit: int = 12) -> List[str]:
    items: List[str] = []
    for src in (raw if isinstance(raw, list) else []), (extra or []):
        for t in src:
            tag = re.sub(r"[^0-9A-Za-z_]", "", str(t).replace("#", "").strip().replace(" ", ""))
            if tag and tag.lower() not in {x.lower() for x in items} and not tag.isdigit():
                items.append(tag)
    return items[:limit]


def _truncate(text: str, limit: int) -> str:
    text = " ".join(str(text).split())
    if len(text) <= limit:
        return text
    cut = text[: limit - 1].rsplit(" ", 1)[0].rstrip(",;:-– ")
    return cut + "…"


def fallback_metadata(clip: Dict[str, Any], text: str) -> Dict[str, Any]:
    title = clip.get("title") or "Must-watch moment"
    hook = clip.get("hook") or title
    kws = _top_keywords(text)
    kw_str = kws[0].title() if kws else "This"
    variants = [
        {"id": "curiosity", "title": _truncate(f"The Secret To {kw_str} Nobody Tells You", 70), "angle": "Curiosity Gap"},
        {"id": "direct", "title": _truncate(title, 70), "angle": "Direct Impact"},
        {"id": "question", "title": _truncate(f"Are You Doing {kw_str} Completely Wrong?", 70), "angle": "Bold Question"},
    ]
    return {
        "youtube_title": _truncate(title, 70),
        "title_variants": variants,
        "selected_title_variant": "direct",
        "youtube_description": f"{_truncate(hook, 200)}\n\nWhat do you think? Tell me in the comments and follow for more.",
        "keywords": kws,
        "hashtags": ["shorts", "fyp", "viral"] + [_slug_tag(k) for k in kws[:4]],
        "instagram_caption": f"{_truncate(hook, 150)}\n\nFollow for more.",
    }


def generate_metadata(
    clip: Dict[str, Any],
    transcript_text: str,
    llm: Any = None,
    language: str = "English",
    source_url: Optional[str] = None,
    credit_source: bool = True,
) -> Dict[str, Any]:
    """Return platform-ready metadata for one clip with Title A/B variants. Never raises."""
    text = " ".join(transcript_text.split())[:3500]
    raw: Dict[str, Any] = {}
    if llm is not None and text:
        prompt = SEO_PROMPT.format(
            language=language, title=clip.get("title", ""), hook=clip.get("hook", ""), text=text
        )
        try:
            raw = llm.complete_json(prompt, tier="strong") or {}
        except Exception as exc:  # network, quota, bad JSON ...
            logger.warning("[seo] LLM metadata failed (%s); using heuristic fallback.", exc)
            raw = {}
    fb = fallback_metadata(clip, text)

    def pick(key: str) -> Any:
        v = raw.get(key)
        return v if v else fb[key]

    title = _truncate(pick("youtube_title"), YT_TITLE_MAX)
    raw_variants = raw.get("title_variants")
    if isinstance(raw_variants, list) and len(raw_variants) >= 2:
        title_variants = [
            {
                "id": str(v.get("id", f"var_{i}")),
                "title": _truncate(str(v.get("title", "")), YT_TITLE_MAX),
                "angle": str(v.get("angle", "Variant")),
            }
            for i, v in enumerate(raw_variants)
            if v.get("title")
        ]
    else:
        title_variants = fb["title_variants"]

    kws = [str(k).strip().lower().lstrip("#") for k in (pick("keywords") or []) if str(k).strip()]
    tags_all = _clean_hashtags(raw.get("hashtags"), fb["hashtags"])
    # Make sure the Shorts discovery tag is present exactly once.
    tags_all = ["Shorts"] + [t for t in tags_all if t.lower() != "shorts"]
    tags_all = tags_all[:12]

    desc = str(pick("youtube_description")).strip()
    if credit_source and source_url and source_url.startswith("http"):
        desc += f"\n\nFull video: {source_url}"
    desc += "\n\n" + " ".join("#" + t for t in tags_all[:5])
    desc = desc[:YT_DESC_MAX]

    # YouTube `tags` field: total length budget.
    yt_tags: List[str] = []
    used = 0
    for k in kws + [t.lower() for t in tags_all]:
        if k in yt_tags:
            continue
        if used + len(k) + 1 > YT_TAGS_CHARS_MAX:
            break
        yt_tags.append(k)
        used += len(k) + 1

    ig_tags = [t for t in tags_all if t.lower() != "shorts"][:IG_HASHTAGS_MAX]
    ig_caption = _truncate(str(pick("instagram_caption")), IG_CAPTION_MAX - 120)
    ig_caption += "\n\n" + " ".join("#" + t for t in ig_tags)

    return {
        "youtube": {
            "title": title,
            "title_variants": title_variants,
            "selected_variant": title_variants[0]["id"] if title_variants else "direct",
            "description": desc,
            "tags": yt_tags,
        },
        "instagram": {"caption": ig_caption[:IG_CAPTION_MAX]},
        "title_variants": title_variants,
        "selected_title_variant": title_variants[0]["id"] if title_variants else "direct",
        "hashtags": tags_all,
        "keywords": kws,
        "generated_by": "llm" if raw else "heuristic",
    }

