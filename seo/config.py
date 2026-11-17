"""Configuration management for the SEO Metadata Engine."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import List
from dotenv import load_dotenv

# Ensure .env is loaded
load_dotenv()


def _env(name: str, default: str) -> str:
    val = os.getenv(name)
    return val.strip() if val is not None and val.strip() != "" else default


def _env_bool(name: str, default: bool) -> bool:
    return _env(name, "true" if default else "false").lower() in ("true", "1", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return default


def _env_list(name: str, default: str) -> List[str]:
    raw = _env(name, default)
    items = [item.strip() for item in raw.split(",") if item.strip()]
    return items or [item.strip() for item in default.split(",") if item.strip()]


@dataclass(frozen=True)
class SEOConfig:
    """Config values for SEO metadata engine."""

    # Search provider fallback chain
    search_providers: List[str] = field(
        default_factory=lambda: _env_list("SEARCH_PROVIDERS", "tavily,firecrawl,ddgs")
    )
    tavily_api_key: str = field(default_factory=lambda: _env("TAVILY_API_KEY", "tvly-3H6KT1-btZeBuwMWb3QmaCDYNUdXHUSZtE9Yoz1bauyjZAleW"))
    firecrawl_api_key: str = field(default_factory=lambda: _env("FIRECRAWL_API_KEY", "fc-e12af52cd92348b2a42633edde343a4a"))
    exa_api_key: str = field(default_factory=lambda: _env("EXA_API_KEY", ""))
    serper_api_key: str = field(default_factory=lambda: _env("SERPER_API_KEY", ""))

    # YouTube Data API
    youtube_api_key: str = field(default_factory=lambda: _env("YOUTUBE_API_KEY", ""))
    youtube_search_enabled: bool = field(
        default_factory=lambda: _env_bool("YOUTUBE_SEARCH_ENABLED", True)
    )
    youtube_daily_unit_budget: int = field(
        default_factory=lambda: _env_int("YOUTUBE_DAILY_UNIT_BUDGET", 6000)
    )

    # Behavior & Regional Settings
    geo: str = field(default_factory=lambda: _env("SEO_GEO", "IN"))
    language: str = field(default_factory=lambda: _env("SEO_LANGUAGE", "auto"))
    cache_hours: float = field(default_factory=lambda: _env_float("SEO_CACHE_HOURS", 12.0))
    research_timeout_sec: float = field(
        default_factory=lambda: _env_float("SEO_RESEARCH_TIMEOUT_SEC", 15.0)
    )
    yt_hashtags: int = field(default_factory=lambda: min(15, max(1, _env_int("YT_HASHTAGS", 5))))
    ig_hashtags: int = field(default_factory=lambda: min(30, max(1, _env_int("IG_HASHTAGS", 5))))
    max_retries: int = field(default_factory=lambda: max(0, _env_int("SEO_MAX_RETRIES", 2)))

    # LLM Provider switch
    llm_provider: str = field(default_factory=lambda: _env("SEO_LLM_PROVIDER", _env("LLM_PROVIDER", "groq")))

    # Cache storage
    cache_db_path: str = field(default_factory=lambda: _env("SEO_CACHE_DB_PATH", "workdir/seo_cache.db"))


def get_seo_config() -> SEOConfig:
    return SEOConfig()
