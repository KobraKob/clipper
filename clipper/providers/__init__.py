"""
Provider factory and fallback dispatcher.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Tuple

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
                "[llm] Primary LLM failed with %s: %s; falling back to secondary model.",
                type(exc).__name__,
                exc,
            )
            return self.backup.complete_json(prompt, tier=tier)

    @property
    def tokens_used(self) -> int:
        return getattr(self.primary, "tokens_used", 0) + getattr(self.backup, "tokens_used", 0)


class ChainedFallbackLLM:
    """Wrapper that attempts a chain of LLM providers in sequence until one succeeds."""

    def __init__(self, chain: List[Tuple[str, LLM]]) -> None:
        if not chain:
            raise ValueError("At least one LLM provider is required in the fallback chain.")
        self.chain = chain

    def complete_json(self, prompt: str, tier: str = "strong") -> Dict[str, Any]:
        last_exc: Exception | None = None
        for i, (name, llm) in enumerate(self.chain):
            try:
                return llm.complete_json(prompt, tier=tier)
            except Exception as exc:
                last_exc = exc
                is_last = (i == len(self.chain) - 1)
                next_name = self.chain[i + 1][0] if not is_last else "None"
                logger.warning(
                    "[llm] Provider %s failed with %s: %s; %s",
                    name,
                    type(exc).__name__,
                    exc,
                    f"falling back to {next_name}." if not is_last else "no further fallbacks.",
                )
        if last_exc:
            raise last_exc
        raise RuntimeError("All LLM providers in fallback chain failed.")

    @property
    def tokens_used(self) -> int:
        return sum(getattr(llm, "tokens_used", 0) for _, llm in self.chain)


class FallbackTranscriber:
    """Wrapper that fails over to a secondary transcriber if primary fails."""

    def __init__(self, primary: Transcriber, backup: Transcriber) -> None:
        self.primary = primary
        self.backup = backup

    def transcribe(self, wav: Any, work_dir: Any, **kwargs: Any) -> Dict[str, Any]:
        try:
            return self.primary.transcribe(wav, work_dir, **kwargs)
        except Exception as exc:
            logger.warning(
                "[transcriber] Primary STT failed with %s: %s; falling back to local Whisper.",
                type(exc).__name__,
                exc,
            )
            return self.backup.transcribe(wav, work_dir, **kwargs)


def get_transcriber(s: Settings = settings) -> Transcriber:
    """Instantiate configured transcriber with automatic local fallback."""
    provider = s.stt_provider.lower().strip()
    if provider in ("groq", "openrouter"):
        has_groq_key = bool(s.groq_api_key or os.getenv("GROQ_API_KEY", ""))
        if provider == "openrouter" and not has_groq_key:
            # OpenRouter is an LLM aggregator without audio STT; route directly to local Whisper
            from .local import LocalTranscriber
            return LocalTranscriber(s)

        from .groq_provider import GroqTranscriber
        primary = GroqTranscriber(s)
        if s.fallback_to_local:
            try:
                from .local import LocalTranscriber
                return FallbackTranscriber(primary=primary, backup=LocalTranscriber(s))
            except Exception as exc:
                logger.debug("[providers] Local backup transcriber unavailable: %s", exc)
        return primary
    if provider == "local":
        from .local import LocalTranscriber
        return LocalTranscriber(s)
    raise ValueError(f"Unknown STT_PROVIDER: {provider!r}. Supported options: 'local', 'groq', 'openrouter'")


def get_llm(s: Settings = settings) -> LLM:
    """Instantiate configured LLM provider with multi-stage fallback chain."""
    provider = s.llm_provider.lower().strip()

    if provider == "groq":
        from .groq_provider import GroqLLM
        chain: List[Tuple[str, LLM]] = [("groq", GroqLLM(s))]

        # Rollback candidate 1: OpenRouter (NVIDIA Nemotron 3 Ultra 550B)
        has_openrouter_key = bool(s.openrouter_api_key or os.getenv("OPENROUTER_API_KEY", ""))
        if has_openrouter_key:
            try:
                from .openrouter import OpenRouterLLM
                chain.append(("openrouter", OpenRouterLLM(s)))
            except Exception as exc:
                logger.debug("[providers] OpenRouter fallback unavailable: %s", exc)

        # Rollback candidate 2: Local Ollama
        if s.fallback_to_local:
            try:
                from .local import OllamaLLM
                chain.append(("local", OllamaLLM(s)))
            except Exception as exc:
                logger.debug("[providers] Local Ollama fallback unavailable: %s", exc)

        return ChainedFallbackLLM(chain) if len(chain) > 1 else chain[0][1]

    if provider == "openrouter":
        from .openrouter import OpenRouterLLM
        chain: List[Tuple[str, LLM]] = [("openrouter", OpenRouterLLM(s))]

        # Rollback candidate 1: Groq
        has_groq_key = bool(s.groq_api_key or os.getenv("GROQ_API_KEY", ""))
        if has_groq_key:
            try:
                from .groq_provider import GroqLLM
                chain.append(("groq", GroqLLM(s)))
            except Exception as exc:
                logger.debug("[providers] Groq fallback unavailable: %s", exc)

        # Rollback candidate 2: Local Ollama
        if s.fallback_to_local:
            try:
                from .local import OllamaLLM
                chain.append(("local", OllamaLLM(s)))
            except Exception as exc:
                logger.debug("[providers] Local Ollama fallback unavailable: %s", exc)

        return ChainedFallbackLLM(chain) if len(chain) > 1 else chain[0][1]

    if provider == "local":
        from .local import OllamaLLM
        return OllamaLLM(s)

    raise ValueError(f"Unknown LLM_PROVIDER: {provider!r}. Supported options: 'local', 'groq', 'openrouter'")


__all__ = [
    "Transcriber",
    "LLM",
    "FallbackLLM",
    "ChainedFallbackLLM",
    "FallbackTranscriber",
    "get_transcriber",
    "get_llm",
    "parse_json",
]
