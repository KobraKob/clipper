"""Tavily search provider implementation."""

from __future__ import annotations

import logging
from typing import Dict, List
import requests

logger = logging.getLogger(__name__)


class TavilySearchProvider:
    name: str = "tavily"

    def __init__(self, api_key: str, timeout: float = 12.0) -> None:
        self.api_key = api_key.strip()
        self.timeout = timeout

    def search(self, query: str, max_results: int = 5) -> List[Dict[str, str]]:
        if not self.api_key:
            raise ValueError("Tavily API key not configured")

        resp = requests.post(
            "https://api.tavily.com/search",
            json={
                "api_key": self.api_key,
                "query": query,
                "search_depth": "basic",
                "max_results": max_results,
                "include_answer": False,
            },
            timeout=self.timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        results: List[Dict[str, str]] = []
        for item in data.get("results", []):
            results.append(
                {
                    "title": str(item.get("title") or "").strip(),
                    "url": str(item.get("url") or "").strip(),
                    "snippet": str(item.get("content") or "").strip(),
                }
            )
        return results
