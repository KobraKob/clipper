"""YouTube Data API v3 integration for top recent shorts and trending chart."""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
import requests

from ..cache import SEOCache
from ..quota import (
    COST_MOST_POPULAR,
    COST_SEARCH_LIST,
    COST_VIDEOS_LIST,
    YouTubeQuotaTracker,
)

logger = logging.getLogger(__name__)


def yt_top_recent(
    api_key: str,
    q: str,
    region: str = "IN",
    lang: str = "en",
    days: int = 14,
    n: int = 25,
    timeout: float = 15.0,
    quota_tracker: Optional[YouTubeQuotaTracker] = None,
    daily_budget: int = 6000,
    cache: Optional[SEOCache] = None,
    cache_hours: float = 12.0,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Search top recent short videos for topic and extract real titles, tags, and hashtags.

    Returns:
        (videos, warning_or_none)
    """
    if not api_key:
        return [], "youtube_api_key_missing"

    cache_key = f"{q}_{region}_{lang}_{days}_{n}"
    if cache is not None:
        cached = cache.get("yt_top_recent", cache_key, geo=region)
        if isinstance(cached, list):
            return cached, None

    # Quota check for search.list (100) + videos.list (1) = 101 units
    total_cost = COST_SEARCH_LIST + COST_VIDEOS_LIST
    if quota_tracker is not None and not quota_tracker.can_consume(total_cost, daily_budget):
        logger.warning("[youtube_api] Quota budget reached (%d units). Skipping search.", daily_budget)
        return [], "youtube_quota_exhausted"

    after = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        s_resp = requests.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={
                "key": api_key,
                "part": "snippet",
                "type": "video",
                "q": q,
                "videoDuration": "short",
                "order": "viewCount",
                "publishedAfter": after,
                "regionCode": region,
                "relevanceLanguage": lang,
                "maxResults": min(n, 50),
            },
            timeout=timeout,
        )
        if s_resp.status_code == 403 and "quotaExceeded" in s_resp.text:
            return [], "youtube_quota_exhausted"
        s_resp.raise_for_status()
        s_data = s_resp.json()

        if quota_tracker is not None:
            quota_tracker.consume(COST_SEARCH_LIST, daily_budget)

        items = s_data.get("items", [])
        ids = [i["id"]["videoId"] for i in items if i.get("id", {}).get("videoId")]
        if not ids:
            return [], None

        v_resp = requests.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={
                "key": api_key,
                "part": "snippet,statistics",
                "id": ",".join(ids),
            },
            timeout=timeout,
        )
        if v_resp.status_code == 403 and "quotaExceeded" in v_resp.text:
            return [], "youtube_quota_exhausted"
        v_resp.raise_for_status()
        v_data = v_resp.json()

        if quota_tracker is not None:
            quota_tracker.consume(COST_VIDEOS_LIST, daily_budget)

        out: List[Dict[str, Any]] = []
        for it in v_data.get("items", []):
            sn = it.get("snippet", {})
            stats = it.get("statistics", {})
            title = sn.get("title", "")
            description = sn.get("description", "")
            text = f"{title} {description}"
            hashtags = [h.lower() for h in re.findall(r"#\w+", text)]
            tags = sn.get("tags") or []
            try:
                views = int(stats.get("viewCount", 0))
            except (ValueError, TypeError):
                views = 0

            out.append(
                {
                    "title": title,
                    "tags": tags,
                    "hashtags": hashtags,
                    "views": views,
                    "published": sn.get("publishedAt", ""),
                }
            )

        if cache is not None:
            cache.set("yt_top_recent", cache_key, out, geo=region, ttl_hours=cache_hours)

        return out, None
    except Exception as exc:
        logger.debug("[youtube_api] yt_top_recent error: %s", exc)
        return [], f"youtube_search_failed:{exc}"


def yt_most_popular(
    api_key: str,
    region: str = "IN",
    category_id: Optional[str] = None,
    timeout: float = 10.0,
    quota_tracker: Optional[YouTubeQuotaTracker] = None,
    daily_budget: int = 6000,
    cache: Optional[SEOCache] = None,
    cache_hours: float = 12.0,
) -> Tuple[List[str], Optional[str]]:
    """
    Fetch trending video titles via chart=mostPopular (1 unit).

    Returns:
        (titles, warning_or_none)
    """
    if not api_key:
        return [], "youtube_api_key_missing"

    cache_key = f"most_popular_{region}_{category_id}"
    if cache is not None:
        cached = cache.get("yt_most_popular", cache_key, geo=region)
        if isinstance(cached, list):
            return cached, None

    if quota_tracker is not None and not quota_tracker.can_consume(COST_MOST_POPULAR, daily_budget):
        return [], "youtube_quota_exhausted"

    params: Dict[str, Any] = {
        "key": api_key,
        "part": "snippet",
        "chart": "mostPopular",
        "regionCode": region,
        "maxResults": 25,
    }
    if category_id:
        params["videoCategoryId"] = str(category_id)

    try:
        r = requests.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params=params,
            timeout=timeout,
        )
        if r.status_code == 400 and "videoChartNotFound" in r.text:
            return [], None  # Expected for some region/category combinations
        if r.status_code == 403 and "quotaExceeded" in r.text:
            return [], "youtube_quota_exhausted"
        r.raise_for_status()

        if quota_tracker is not None:
            quota_tracker.consume(COST_MOST_POPULAR, daily_budget)

        data = r.json()
        titles = [
            str(it.get("snippet", {}).get("title") or "").strip()
            for it in data.get("items", [])
            if str(it.get("snippet", {}).get("title") or "").strip()
        ]

        if cache is not None:
            cache.set("yt_most_popular", cache_key, titles, geo=region, ttl_hours=cache_hours)

        return titles, None
    except Exception as exc:
        logger.debug("[youtube_api] yt_most_popular error: %s", exc)
        return [], f"youtube_chart_failed:{exc}"
