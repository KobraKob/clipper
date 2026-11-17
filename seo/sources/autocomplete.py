"""YouTube search autocomplete data source."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional
import requests

from ..cache import SEOCache

logger = logging.getLogger(__name__)


def yt_autocomplete(
    q: str,
    hl: str = "en",
    gl: str = "in",
    timeout: float = 8.0,
    cache: Optional[SEOCache] = None,
    cache_hours: float = 12.0,
) -> List[str]:
    """
    Fetch autocomplete query suggestions from YouTube's suggest endpoint.

    Returns:
        List of suggested strings, e.g. ["how to save money", "how to save money fast"]
    """
    q_clean = " ".join(str(q or "").split())
    if not q_clean:
        return []

    if cache is not None:
        cached = cache.get("yt_autocomplete", q_clean, geo=gl)
        if isinstance(cached, list):
            return cached

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    }
    try:
        r = requests.get(
            "https://suggestqueries.google.com/complete/search",
            params={"client": "firefox", "ds": "yt", "q": q_clean, "hl": hl, "gl": gl},
            headers=headers,
            timeout=timeout,
        )
        r.raise_for_status()
        raw = r.json()
        suggestions: List[str] = []
        if isinstance(raw, list) and len(raw) > 1 and isinstance(raw[1], list):
            suggestions = [str(item).strip() for item in raw[1] if str(item).strip()]

        if cache is not None:
            cache.set("yt_autocomplete", q_clean, suggestions, geo=gl, ttl_hours=cache_hours)

        return suggestions
    except Exception as exc:
        logger.debug("[autocomplete] error querying %r: %s", q_clean, exc)
        return []


def collect_autocomplete(
    seed_keywords: List[str],
    hl: str = "en",
    gl: str = "in",
    cache: Optional[SEOCache] = None,
    cache_hours: float = 12.0,
    max_total_calls: int = 10,
) -> List[Dict[str, Any]]:
    """
    Query autocomplete for top seed keywords with controlled a..e expansion.

    Returns:
        List of {"seed": str, "suggestions": List[str]}
    """
    results: List[Dict[str, Any]] = []
    calls_made = 0

    seeds = [s.strip() for s in seed_keywords if s.strip()][:3]
    for seed in seeds:
        if calls_made >= max_total_calls:
            break

        # Base seed query
        suggs = yt_autocomplete(seed, hl=hl, gl=gl, cache=cache, cache_hours=cache_hours)
        calls_made += 1
        results.append({"seed": seed, "suggestions": suggs[:8]})

        # Seed with trailing space
        if calls_made < max_total_calls:
            suggs_space = yt_autocomplete(f"{seed} ", hl=hl, gl=gl, cache=cache, cache_hours=cache_hours)
            calls_made += 1
            if suggs_space:
                results.append({"seed": f"{seed} ", "suggestions": suggs_space[:8]})

        # Expansions 'a' through 'e'
        for ch in ("a", "b", "c", "d", "e"):
            if calls_made >= max_total_calls:
                break
            query = f"{seed} {ch}"
            exp_suggs = yt_autocomplete(query, hl=hl, gl=gl, cache=cache, cache_hours=cache_hours)
            calls_made += 1
            if exp_suggs:
                results.append({"seed": query, "suggestions": exp_suggs[:8]})

    return results
