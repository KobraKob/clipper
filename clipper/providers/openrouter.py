"""
OpenRouter API provider implementation for LLM completions.
Optimized for NVIDIA Nemotron 3 Ultra 550B and other hosted models.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

import requests

from ..config import Settings
from .base import parse_json
from .retry import with_retry

logger = logging.getLogger(__name__)


class OpenRouterRetryableError(RuntimeError):
    """Transient OpenRouter error suitable for automatic retry."""


class OpenRouterLLM:
    """LLM client communicating with OpenRouter's OpenAI-compatible completions API."""

    def __init__(self, s: Settings) -> None:
        self.s = s
        api_key = self.s.openrouter_api_key or os.getenv("OPENROUTER_API_KEY", "")
        if not api_key:
            raise ValueError(
                "OPENROUTER_API_KEY environment variable is required when using the OpenRouter provider."
            )
        self.api_key: str = api_key
        self.model: str = self.s.openrouter_model or os.getenv(
            "OPENROUTER_MODEL", "nvidia/nemotron-3-ultra-550b-a55b"
        )
        self.base_url: str = (
            self.s.openrouter_base_url or os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
        ).rstrip("/")
        self.tokens_used: int = 0
        self._retryable_errors = (
            OpenRouterRetryableError,
            requests.exceptions.ConnectionError,
            requests.exceptions.Timeout,
        )

    def complete_json(self, prompt: str, tier: str = "strong") -> Dict[str, Any]:
        """Request JSON completion using OpenRouter model with retry on rate-limit / upstream faults."""
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/project-hire/clipper",
            "X-Title": "Video Clipper",
        }
        payload = {
            "model": self.model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": prompt}],
        }

        def call() -> Dict[str, Any]:
            try:
                resp = requests.post(url, headers=headers, json=payload, timeout=60.0)
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as net_err:
                raise OpenRouterRetryableError(f"Network error contacting OpenRouter: {net_err}") from net_err

            if resp.status_code == 200:
                return resp.json()

            err_text = resp.text
            try:
                err_json = resp.json()
                if "error" in err_json:
                    err_text = str(err_json["error"])
            except Exception:
                pass

            if resp.status_code in (429, 502, 503, 504):
                raise OpenRouterRetryableError(
                    f"OpenRouter transient error ({resp.status_code}): {err_text}"
                )

            raise RuntimeError(f"OpenRouter API failed with status {resp.status_code}: {err_text}")

        data = with_retry(call, retries=5, retry_on=self._retryable_errors)

        usage = data.get("usage")
        if isinstance(usage, dict) and "total_tokens" in usage:
            self.tokens_used += int(usage["total_tokens"])

        choices = data.get("choices", [])
        if not choices:
            raise ValueError(f"OpenRouter response missing 'choices': {data}")

        message = choices[0].get("message", {})
        content = message.get("content", "")
        if not content:
            raise ValueError(f"OpenRouter returned empty message content: {choices[0]}")

        return parse_json(content)
