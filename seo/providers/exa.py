"""Exa search provider implementation."""

from __future__ import annotations

import logging
from typing import Dict, List
import requests

logger = logging.getLogger(__name__)


class ExaSearchProvider:
    name: str = "exa"

    def __init__(self, api_key: str, timeout: float = 12.0) -> None:
        self.api_key = api_key.strip()
        self.timeout = timeout

    def search(self, query: str, max_results: int = 5) -> List[Dict[str, str]]:
        if not self.api_key:
            raise ValueError("Exa API key not configured")

        headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
        }
        resp = requests.post(
            "https://api.exa.ai/search",
            headers=headers,
            json={
                "query": query,
                "numResults": max_results,
                "contents": {"text": {"maxCharacters": 300}},
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
                    "snippet": str(item.get("text") or item.get("snippet") or "").strip(),
                }
            )
        return results
