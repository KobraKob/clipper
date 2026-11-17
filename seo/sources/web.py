"""Web search runner with multi-provider fallback chain."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from ..cache import SEOCache
from ..config import SEOConfig
from ..providers.base import SearchProvider
from ..providers.ddgs_provider import DDGSSearchProvider
from ..providers.exa import ExaSearchProvider
from ..providers.firecrawl import FirecrawlSearchProvider
from ..providers.serper import SerperSearchProvider
from ..providers.tavily import TavilySearchProvider

logger = logging.getLogger(__name__)


def build_search_provider(name: str, config: SEOConfig) -> Optional[SearchProvider]:
    name_low = name.lower().strip()
    if name_low == "tavily":
        return TavilySearchProvider(api_key=config.tavily_api_key)
    if name_low == "firecrawl":
        return FirecrawlSearchProvider(api_key=config.firecrawl_api_key)
    if name_low == "ddgs":
        return DDGSSearchProvider()
    if name_low == "exa":
        return ExaSearchProvider(api_key=config.exa_api_key)
    if name_low == "serper":
        return SerperSearchProvider(api_key=config.serper_api_key)
    return None


class WebSearchManager:
    """Manages web search queries across configured providers with automatic fallback."""

    def __init__(self, config: SEOConfig, cache: Optional[SEOCache] = None) -> None:
        self.config = config
        self.cache = cache
        self.providers: List[SearchProvider] = []
        for p_name in config.search_providers:
            prov = build_search_provider(p_name, config)
            if prov is not None:
                self.providers.append(prov)

    def execute_search_query(
        self, query: str, max_results: int = 5
    ) -> Tuple[List[Dict[str, str]], str, Optional[str]]:
        """
        Execute a search query trying providers in order until one succeeds.

        Returns:
            (results, winning_provider_name, warning_if_any)
        """
        if not query.strip():
            return [], "none", None

        if self.cache is not None:
            cached = self.cache.get("web_search", query)
            if isinstance(cached, list):
                return cached, "cache", None

        last_warning: Optional[str] = None
        for provider in self.providers:
            try:
                results = provider.search(query, max_results=max_results)
                if self.cache is not None:
                    self.cache.set("web_search", query, results, ttl_hours=self.config.cache_hours)
                return results, provider.name, last_warning
            except Exception as exc:
                logger.debug("[web_search] provider %s failed for %r: %s", provider.name, query, exc)
                last_warning = f"{provider.name}_failed"

        return [], "none", (last_warning or "all_search_providers_failed")

    def run_clip_research(
        self,
        main_topic: str,
        entities: List[str],
        max_searches: int = 5,
    ) -> Tuple[List[Dict[str, Any]], List[str], List[str]]:
        """
        Build and execute up to max_searches queries for the clip topic.

        Returns:
            (web_results_list, providers_used_list, warnings_list)
        """
        now = datetime.now(timezone.utc)
        month_str = now.strftime("%B")
        year_str = str(now.year)

        queries: List[str] = []
        if main_topic:
            queries.append(f'"{main_topic}" news this week')

        for ent in entities[:2]:
            ent_clean = ent.strip()
            if ent_clean and ent_clean.lower() != (main_topic or "").lower():
                queries.append(f'"{ent_clean}" latest')

        if main_topic:
            queries.append(f"{main_topic} trending hashtags {month_str} {year_str}")
            queries.append(f"{main_topic} youtube shorts ideas")

        # Deduplicate and limit to max_searches
        seen_q: set[str] = set()
        chosen_queries: List[str] = []
        for q in queries:
            q_norm = " ".join(q.lower().split())
            if q_norm not in seen_q:
                seen_q.add(q_norm)
                chosen_queries.append(q)
            if len(chosen_queries) >= max_searches:
                break

        web_items: List[Dict[str, Any]] = []
        providers_used: set[str] = set()
        warnings: List[str] = []

        for q in chosen_queries:
            results, prov_name, warn = self.execute_search_query(q, max_results=4)
            if prov_name and prov_name != "none":
                providers_used.add(prov_name)
            if warn and warn not in warnings:
                warnings.append(warn)
            web_items.append({"query": q, "results": results})

        return web_items, sorted(list(providers_used)), warnings
