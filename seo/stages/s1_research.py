"""Stage S1: Parallel research collector."""

from __future__ import annotations

import concurrent.futures
import logging
from typing import Any, Dict, List, Optional, Tuple

from ..cache import SEOCache
from ..config import SEOConfig
from ..quota import YouTubeQuotaTracker
from ..sources.autocomplete import collect_autocomplete
from ..sources.trends_rss import trending_now
from ..sources.web import WebSearchManager
from ..sources.youtube_api import yt_most_popular, yt_top_recent

logger = logging.getLogger(__name__)


def collect_research(
    topic_data: Dict[str, Any],
    config: SEOConfig,
    cache: Optional[SEOCache] = None,
    quota_tracker: Optional[YouTubeQuotaTracker] = None,
) -> Dict[str, Any]:
    """
    Execute stage S1: Run data collectors in parallel with overall timeout.

    Returns:
        Dict matching research.json schema.
    """
    geo = topic_data.get("geo") or config.geo
    lang = topic_data.get("language") or config.language
    main_topic = topic_data.get("main_topic") or ""
    entities = topic_data.get("entities") or []
    seed_keywords = topic_data.get("seed_keywords") or [main_topic]

    warnings: List[str] = []
    research: Dict[str, Any] = {
        "autocomplete": [],
        "top_recent_videos": [],
        "trending_now": [],
        "most_popular_titles": [],
        "web": [],
        "providers_used": [],
        "warnings": warnings,
    }

    web_manager = WebSearchManager(config, cache=cache)

    def _task_autocomplete() -> List[Dict[str, Any]]:
        return collect_autocomplete(
            seed_keywords,
            hl=lang,
            gl=geo,
            cache=cache,
            cache_hours=config.cache_hours,
        )

    def _task_youtube() -> Tuple[List[Dict[str, Any]], List[str], List[str]]:
        yt_warns: List[str] = []
        if not config.youtube_search_enabled:
            return [], [], yt_warns

        top_vids, w1 = yt_top_recent(
            api_key=config.youtube_api_key,
            q=main_topic,
            region=geo,
            lang=lang,
            quota_tracker=quota_tracker,
            daily_budget=config.youtube_daily_unit_budget,
            cache=cache,
            cache_hours=config.cache_hours,
        )
        if w1:
            yt_warns.append(w1)

        pop_titles, w2 = yt_most_popular(
            api_key=config.youtube_api_key,
            region=geo,
            quota_tracker=quota_tracker,
            daily_budget=config.youtube_daily_unit_budget,
            cache=cache,
            cache_hours=config.cache_hours,
        )
        if w2:
            yt_warns.append(w2)

        return top_vids, pop_titles, yt_warns

    def _task_trends() -> List[Dict[str, str]]:
        return trending_now(
            geo=geo,
            cache=cache,
            cache_hours=min(6.0, config.cache_hours),
        )

    def _task_web() -> Tuple[List[Dict[str, Any]], List[str], List[str]]:
        return web_manager.run_clip_research(
            main_topic=main_topic,
            entities=entities,
            max_searches=4,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        f_auto = executor.submit(_task_autocomplete)
        f_yt = executor.submit(_task_youtube)
        f_trends = executor.submit(_task_trends)
        f_web = executor.submit(_task_web)

        # Enforce Section 4.2 strict 15s overall timeout across all parallel workers
        futures_map = {
            f_auto: "autocomplete",
            f_yt: "youtube",
            f_trends: "trends",
            f_web: "web",
        }
        done, not_done = concurrent.futures.wait(
            futures_map.keys(),
            timeout=config.research_timeout_sec,
        )

        for f in not_done:
            name = futures_map.get(f, "unknown")
            logger.debug("[s1_research] %s worker exceeded %ss overall timeout", name, config.research_timeout_sec)
            warnings.append(f"{name}_timeout")

        # Process completed tasks safely
        if f_auto in done:
            try:
                research["autocomplete"] = f_auto.result()
            except Exception as exc:
                logger.debug("[s1_research] autocomplete worker error: %s", exc)
                warnings.append("autocomplete_failed")

        if f_yt in done:
            try:
                top_vids, pop_titles, yt_w = f_yt.result()
                research["top_recent_videos"] = top_vids
                research["most_popular_titles"] = pop_titles
                for w in yt_w:
                    if w not in warnings:
                        warnings.append(w)
                if top_vids or pop_titles:
                    research["providers_used"].append("youtube_data_api")
            except Exception as exc:
                logger.debug("[s1_research] youtube worker error: %s", exc)
                warnings.append("youtube_failed")

        if f_trends in done:
            try:
                trends = f_trends.result()
                research["trending_now"] = trends
                if trends:
                    research["providers_used"].append("google_trends_rss")
            except Exception as exc:
                logger.debug("[s1_research] trends worker error: %s", exc)
                warnings.append("trends_failed")

        if f_web in done:
            try:
                web_items, provs, web_w = f_web.result()
                research["web"] = web_items
                for p in provs:
                    if p not in research["providers_used"]:
                        research["providers_used"].append(p)
                for w in web_w:
                    if w not in warnings:
                        warnings.append(w)
            except Exception as exc:
                logger.debug("[s1_research] web worker error: %s", exc)
                warnings.append("web_failed")

    return research
