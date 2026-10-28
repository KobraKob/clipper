"""Public, best-effort Google Trends RSS reader for current-topic metadata.

Trend data is advisory, not a substitute for clip relevance. SEO generation must filter
these candidates against the exact transcript before attaching any trending hashtag.
"""
from __future__ import annotations

import logging
import re
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Tuple

logger = logging.getLogger(__name__)
_CACHE_TTL_SECONDS = 60 * 60
_CACHE: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}


def fetch_trending_topics(region: str = "IN", timeout: float = 2.5) -> List[Dict[str, Any]]:
    """Read current trending search phrases from the public Google Trends RSS feed."""
    geo = (region or "IN").strip().upper()
    if not re.fullmatch(r"[A-Z]{2}", geo):
        geo = "IN"

    cached = _CACHE.get(geo)
    now = time.monotonic()
    if cached and now - cached[0] < _CACHE_TTL_SECONDS:
        return [dict(item) for item in cached[1]]

    url = f"https://trends.google.com/trending/rss?geo={geo}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "ClipperSEO/1.0 (+https://trends.google.com/)"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read(1_500_000)
        root = ET.fromstring(payload)
        topics: List[Dict[str, Any]] = []
        for item in root.findall(".//item"):
            title = " ".join((item.findtext("title") or "").split())
            if not title:
                continue
            topics.append({
                "title": title,
                "published": (item.findtext("pubDate") or "").strip(),
                "source": "Google Trends",
            })
            if len(topics) >= 30:
                break
        _CACHE[geo] = (now, topics)
        return [dict(item) for item in topics]
    except (OSError, TimeoutError, urllib.error.URLError, ET.ParseError, ValueError) as exc:
        logger.info("[trends] Could not fetch live trends for %s: %s", geo, exc)
        # Do not replace a recent cached response with an empty result after a transient outage.
        if cached:
            return [dict(item) for item in cached[1]]
        _CACHE[geo] = (now, [])
        return []
