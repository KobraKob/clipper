"""SearchProvider Protocol and common data models."""

from __future__ import annotations

from typing import Dict, List, Protocol, runtime_checkable


@runtime_checkable
class SearchProvider(Protocol):
    """Protocol for web search providers."""

    name: str

    def search(self, query: str, max_results: int = 5) -> List[Dict[str, str]]:
        """
        Execute search query and return normalized results.

        Returns:
            List of {"title": str, "url": str, "snippet": str}
        """
        ...
