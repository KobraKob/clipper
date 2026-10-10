"""
Configuration management for the Video Clipper application.
Reads environment variables with fallback defaults.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional
from dotenv import load_dotenv

# Load .env file if available
load_dotenv()


def _env(name: str, default: str) -> str:
    """Retrieve environment variable or fallback default value."""
    val = os.getenv(name)
    return val if val is not None and val != "" else default


@dataclass(frozen=True)
class Settings:
    """Application settings and runtime switches."""

    # Provider routing
    provider: str = _env("PROVIDER", "local")
    stt_provider: str = _env("STT_PROVIDER", _env("PROVIDER", "local"))
    llm_provider: str = _env("LLM_PROVIDER", _env("PROVIDER", "local"))
    fallback_to_local: bool = _env("FALLBACK_TO_LOCAL", "false").lower() in ("true", "1", "yes")

    # Local Whisper & Ollama
    whisper_model: str = _env("WHISPER_MODEL", "small")
    whisper_device: str = _env("WHISPER_DEVICE", "auto")
    whisper_compute: str = _env("WHISPER_COMPUTE", "auto")
    ollama_url: str = _env("OLLAMA_URL", "http://localhost:11434")
    ollama_fast: str = _env("OLLAMA_FAST_MODEL", "qwen2.5:3b-instruct")
    ollama_strong: str = _env("OLLAMA_STRONG_MODEL", "qwen2.5:7b-instruct")

    # Groq API
    groq_api_key: str = _env("GROQ_API_KEY", "")
    groq_stt_model: str = _env("GROQ_STT_MODEL", "whisper-large-v3-turbo")
    groq_fast: str = _env("GROQ_FAST_MODEL", "llama-3.1-8b-instant")
    groq_strong: str = _env("GROQ_STRONG_MODEL", "llama-3.3-70b-versatile")
    chunk_seconds: int = int(_env("STT_CHUNK_SECONDS", "600"))

    # Scoring & candidate constraints
    shortlist: int = int(_env("SHORTLIST", "10"))
    min_clip_duration: int = int(_env("MIN_CLIP_DURATION", "20"))
    max_clip_duration: int = int(_env("MAX_CLIP_DURATION", "60"))

    @classmethod
    def create_custom(
        cls,
        provider: Optional[str] = None,
        stt_provider: Optional[str] = None,
        llm_provider: Optional[str] = None,
        fallback_to_local: Optional[bool] = None,
        shortlist: Optional[int] = None,
    ) -> Settings:
        """Create a custom Settings instance with overrides."""
        p = provider or _env("PROVIDER", "local")
        return cls(
            provider=p,
            stt_provider=stt_provider or (p if provider else _env("STT_PROVIDER", p)),
            llm_provider=llm_provider or (p if provider else _env("LLM_PROVIDER", p)),
            fallback_to_local=(
                fallback_to_local
                if fallback_to_local is not None
                else (_env("FALLBACK_TO_LOCAL", "false").lower() in ("true", "1", "yes"))
            ),
            shortlist=shortlist if shortlist is not None else int(_env("SHORTLIST", "10")),
        )


settings = Settings()
