"""Google Trending Now RSS feed data source."""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional
import requests

from ..cache import SEOCache

logger = logging.getLogger(__name__)


def trending_now(
    geo: str = "IN",
    timeout: float = 10.0,
    cache: Optional[SEOCache] = None,
    cache_hours: float = 6.0,
) -> List[Dict[str, str]]:
    """
    Fetch current Google trending search queries for a country via RSS.

    Returns:
        List of {"query": str, "traffic": str}
    """
    geo_code = (geo or "IN").upper().strip()

    if cache is not None:
        cached = cache.get("google_trends_rss", geo_code, geo=geo_code)
        if isinstance(cached, list):
            return cached

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    }
    url = f"https://trends.google.com/trending/rss?geo={geo_code}"
    try:
        r = requests.get(url, headers=headers, timeout=timeout)
        r.raise_for_status()
        root = ET.fromstring(r.text)

        items: List[Dict[str, str]] = []
        for it in root.iter("item"):
            title = it.findtext("title") or ""
            # Search for approx_traffic with any XML namespace
            traffic = it.findtext("{*}approx_traffic") or ""
            if not traffic:
                for child in it:
                    if child.tag.endswith("approx_traffic") and child.text:
                        traffic = child.text.strip()
                        break

            q_clean = " ".join(title.split()).strip()
            if q_clean:
                items.append({"query": q_clean, "traffic": traffic.strip()})

        if cache is not None:
            cache.set("google_trends_rss", geo_code, items, geo=geo_code, ttl_hours=cache_hours)

        return items
    except Exception as exc:
        logger.debug("[trends_rss] error fetching trends for %r: %s", geo_code, exc)
        return []
