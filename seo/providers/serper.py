"""Serper Google Search provider implementation."""

from __future__ import annotations

import logging
from typing import Dict, List
import requests

logger = logging.getLogger(__name__)


class SerperSearchProvider:
    name: str = "serper"

    def __init__(self, api_key: str, timeout: float = 12.0) -> None:
        self.api_key = api_key.strip()
        self.timeout = timeout

    def search(self, query: str, max_results: int = 5) -> List[Dict[str, str]]:
        if not self.api_key:
            raise ValueError("Serper API key not configured")

        headers = {
            "X-API-KEY": self.api_key,
            "Content-Type": "application/json",
        }
        resp = requests.post(
            "https://google.serper.dev/search",
            headers=headers,
            json={"q": query, "num": max_results},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        results: List[Dict[str, str]] = []
        for item in data.get("organic", []):
            results.append(
                {
                    "title": str(item.get("title") or "").strip(),
                    "url": str(item.get("link") or "").strip(),
                    "snippet": str(item.get("snippet") or "").strip(),
                }
            )
        return results
