"""Firecrawl search provider implementation."""

from __future__ import annotations

import logging
from typing import Dict, List
import requests

logger = logging.getLogger(__name__)


class FirecrawlSearchProvider:
    name: str = "firecrawl"

    def __init__(self, api_key: str = "", timeout: float = 12.0) -> None:
        self.api_key = api_key.strip()
        self.timeout = timeout

    def search(self, query: str, max_results: int = 5) -> List[Dict[str, str]]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        resp = requests.post(
            "https://api.firecrawl.dev/v1/search",
            headers=headers,
            json={"query": query, "limit": max_results},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        items = data.get("data") or data.get("results") or []
        results: List[Dict[str, str]] = []
        for item in items:
            title = str(item.get("title") or item.get("metadata", {}).get("title") or "").strip()
            url = str(item.get("url") or item.get("link") or "").strip()
            snippet = str(
                item.get("description")
                or item.get("snippet")
                or item.get("markdown", "")[:300]
                or ""
            ).strip()
            results.append({"title": title, "url": url, "snippet": snippet})
        return results
