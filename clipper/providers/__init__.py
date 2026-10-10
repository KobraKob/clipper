"""
Provider factory and fallback dispatcher.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from ..config import Settings, settings
from .base import LLM, Transcriber, parse_json

logger = logging.getLogger(__name__)


class FallbackLLM:
    """Wrapper that fails over to a secondary LLM provider if primary fails."""

    def __init__(self, primary: LLM, backup: LLM) -> None:
        self.primary = primary
        self.backup = backup

    def complete_json(self, prompt: str, tier: str = "strong") -> Dict[str, Any]:
        try:
            return self.primary.complete_json(prompt, tier=tier)
        except Exception as exc:
            logger.warning(
                "[llm] Primary LLM failed with %s: %s; falling back to local model.",
                type(exc).__name__,
                exc,
            )
            return self.backup.complete_json(prompt, tier=tier)

    @property
    def tokens_used(self) -> int:
        return getattr(self.primary, "tokens_used", 0)


def get_transcriber(s: Settings = settings) -> Transcriber:
    """Instantiate configured transcriber."""
    provider = s.stt_provider.lower().strip()
    if provider == "groq":
        from .groq_provider import GroqTranscriber
        return GroqTranscriber(s)
    if provider == "local":
        from .local import LocalTranscriber
        return LocalTranscriber(s)
    raise ValueError(f"Unknown STT_PROVIDER: {provider!r}. Supported options: 'local', 'groq'")


def get_llm(s: Settings = settings) -> LLM:
    """Instantiate configured LLM provider, with optional local fallback."""
    provider = s.llm_provider.lower().strip()
    if provider == "groq":
        from .groq_provider import GroqLLM
        primary_llm = GroqLLM(s)
        if s.fallback_to_local:
            from .local import OllamaLLM
            return FallbackLLM(primary=primary_llm, backup=OllamaLLM(s))
        return primary_llm
    if provider == "local":
        from .local import OllamaLLM
        return OllamaLLM(s)
    raise ValueError(f"Unknown LLM_PROVIDER: {provider!r}. Supported options: 'local', 'groq'")


__all__ = [
    "Transcriber",
    "LLM",
    "FallbackLLM",
    "get_transcriber",
    "get_llm",
    "parse_json",
]
