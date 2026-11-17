"""DuckDuckGo / DDGS search provider implementation."""

from __future__ import annotations

import logging
from typing import Dict, List

logger = logging.getLogger(__name__)


class DDGSSearchProvider:
    name: str = "ddgs"

    def __init__(self, timeout: float = 10.0) -> None:
        self.timeout = timeout

    def search(self, query: str, max_results: int = 5) -> List[Dict[str, str]]:
        try:
            from ddgs import DDGS
        except ImportError:
            try:
                from duckduckgo_search import DDGS
            except ImportError as exc:
                raise RuntimeError("ddgs or duckduckgo_search package is not installed") from exc

        try:
            ddgs = DDGS(timeout=self.timeout)
            raw = list(ddgs.text(query, max_results=max_results))
            results: List[Dict[str, str]] = []
            for item in raw:
                title = str(item.get("title") or "").strip()
                url = str(item.get("href") or item.get("url") or "").strip()
                snippet = str(item.get("body") or item.get("snippet") or "").strip()
                if title or url:
                    results.append({"title": title, "url": url, "snippet": snippet})
            return results
        except Exception as exc:
            logger.debug("[ddgs] search failed for %r: %s", query, exc)
            raise RuntimeError(f"DuckDuckGo search error: {exc}") from exc
