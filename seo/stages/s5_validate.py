"""Stage S5: Deterministic validation and error reporting."""

from __future__ import annotations

import logging
import re
import unicodedata
from typing import Any, Dict, List, Set, Tuple

logger = logging.getLogger(__name__)


def _is_valid_pool_tag(tag: str) -> bool:
    """Validate hashtag format with full unicode and combining marks support."""
    if not isinstance(tag, str) or not tag.startswith("#"):
        return False
    body = tag[1:]
    if not (1 <= len(body) <= 29):
        return False
    # Check ASCII / standard regex first
    if re.match(r"^#[\w]{1,29}$", tag):
        return True
    # Unicode fallback supporting combining marks (matras / diacritics)
    has_letter = False
    for ch in body:
        cat = unicodedata.category(ch)
        if cat.startswith("L"):
            has_letter = True
        elif cat.startswith(("N", "M")) or ch == "_":
            pass
        else:
            return False
    return has_letter


def validate_draft(
    draft_title: str,
    draft_description_body: str,
    hashtag_pool: Dict[str, List[Dict[str, str]]],
    primary_keyword: str,
    selected_yt_hashtags: List[str],
    hidden_tags: List[str],
    language: str = "en",
) -> List[str]:
    """
    Validate all deterministic platform and quality constraints.

    Returns:
        List of error description strings. If empty, validation succeeded.
    """
    errors: List[str] = []

    # 1. Title rules
    t_len = len(draft_title)
    if not (1 <= t_len <= 100):
        errors.append(f"Title length {t_len} outside [1, 100]")
    if "#" in draft_title:
        errors.append("Title contains forbidden '#' character")

    pk_words = [w.lower() for w in re.findall(r"\w+", primary_keyword or "") if len(w) > 2]
    title_words = [w.lower() for w in re.findall(r"\w+", draft_title)]
    if pk_words and not any(w in title_words for w in pk_words):
        errors.append(f"Title does not contain primary keyword tokens from {primary_keyword!r}")

    # 2. Description rules
    d_len = len(draft_description_body)
    if d_len > 5000:
        errors.append(f"Description length {d_len} exceeds 5000 chars")
    if "#" in draft_description_body:
        errors.append("Description body contains forbidden '#' character")

    head_125 = draft_description_body[:125].lower()
    if pk_words and not any(w in head_125 for w in pk_words):
        errors.append("First 125 chars of description must contain primary keyword token")

    # 3. Hashtag pool rules: exactly 30 unique, 10 per group, matching pattern
    seen_pool: Set[str] = set()
    for grp_name in ("topic", "trending", "adjacent"):
        items = hashtag_pool.get(grp_name, [])
        if len(items) != 10:
            errors.append(f"Hashtag pool '{grp_name}' has {len(items)} items, expected 10")
        for it in items:
            tag = it.get("tag", "")
            if not _is_valid_pool_tag(tag):
                errors.append(f"Invalid hashtag format in pool: {tag!r}")
            if tag in seen_pool:
                errors.append(f"Duplicate hashtag in pool: {tag!r}")
            seen_pool.add(tag)

    if len(seen_pool) != 30:
        errors.append(f"Total unique hashtags in pool is {len(seen_pool)}, expected 30")

    # 4. Trending tag relevance check: relevance >= 0.5
    for it in hashtag_pool.get("trending", []):
        rel = it.get("relevance")
        if rel is not None:
            try:
                if float(rel) < 0.5:
                    errors.append(f"Trending tag {it.get('tag')} has relevance {rel} < 0.5")
            except (ValueError, TypeError):
                pass

    # 4. YouTube hashtags selected: 3 <= n <= 5 (hard ceiling 15)
    yt_n = len(selected_yt_hashtags)
    if yt_n > 15:
        errors.append(f"FATAL: YouTube hashtags count {yt_n} exceeds hard limit of 15")
    if yt_n < 3:
        errors.append(f"YouTube hashtags count {yt_n} below recommended minimum 3")

    # 5. Hidden tags: total length <= 450 chars, no '#'
    tags_field = ", ".join(hidden_tags)
    if len(tags_field) > 450:
        errors.append(f"Hidden tags length {len(tags_field)} exceeds 450 chars")
    if any("#" in tag for tag in hidden_tags):
        errors.append("Hidden tags must be plain keywords without '#'")

    return errors


def repair_and_sanitize(
    draft_title: str,
    draft_description_body: str,
    hashtag_pool: Dict[str, List[Dict[str, str]]],
    primary_keyword: str,
    selected_yt_hashtags: List[str],
    hidden_tags: List[str],
) -> Tuple[str, str, List[str], List[str]]:
    """
    Deterministic sanitizer that guarantees valid platform metadata even if validation failed.
    """
    # 1. Clean title
    title = re.sub(r"#\S*", "", draft_title).replace("#", "").strip()
    title = " ".join(title.split())
    if not title:
        title = primary_keyword.title()

    pk_words = [w.lower() for w in re.findall(r"\w+", primary_keyword or "") if len(w) > 2]
    first_words = " ".join(title.split()[:5]).lower()
    if pk_words and not any(w in first_words for w in pk_words):
        title = f"{primary_keyword.title()}: {title}"

    title = title[:100].strip()

    # 2. Clean description body
    desc_body = re.sub(r"#\S*", "", draft_description_body).replace("#", "").strip()
    if pk_words and not any(w in desc_body[:125].lower() for w in pk_words):
        desc_body = f"{primary_keyword.title()} breakdown: {desc_body}"
    desc_body = desc_body[:4900].strip()

    # 3. Sanitize selected YouTube hashtags (hard limit 15, default 5)
    clean_yt = [t for t in selected_yt_hashtags if _is_valid_pool_tag(t)]
    if len(clean_yt) > 15:
        clean_yt = clean_yt[:15]
    if len(clean_yt) < 3:
        for it in hashtag_pool.get("topic", []):
            t = it.get("tag", "")
            if t and t not in clean_yt and _is_valid_pool_tag(t):
                clean_yt.append(t)
            if len(clean_yt) >= 3:
                break

    # 4. Sanitize hidden tags
    clean_hidden: List[str] = []
    used_len = 0
    for h in hidden_tags:
        plain = " ".join(h.replace("#", "").split()).strip()
        if not plain or plain in clean_hidden:
            continue
        projected = used_len + len(plain) + (2 if clean_hidden else 0)
        if projected > 450:
            break
        clean_hidden.append(plain)
        used_len = projected

    return title, desc_body, clean_yt, clean_hidden
