"""
Configuration management for the Video Clipper application.
Reads environment variables with fallback defaults.
"""

from __future__ import annotations

import dataclasses
import os
from dataclasses import dataclass
from typing import Any, Optional
from dotenv import load_dotenv

# Load .env file if available
load_dotenv()


def _env(name: str, default: str) -> str:
    """Retrieve environment variable or fallback default value."""
    val = os.getenv(name)
    return val if val is not None and val != "" else default


def _env_bool(name: str, default: bool) -> bool:
    return _env(name, "true" if default else "false").lower() in ("true", "1", "yes", "on")


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
    groq_fast: str = _env("GROQ_FAST_MODEL", "openai/gpt-oss-20b")
    groq_strong: str = _env("GROQ_STRONG_MODEL", "openai/gpt-oss-120b")
    chunk_seconds: int = int(_env("STT_CHUNK_SECONDS", "600"))

    # Scoring & candidate constraints
    shortlist: int = int(_env("SHORTLIST", "10"))
    min_clip_duration: int = int(_env("MIN_CLIP_DURATION", "20"))
    max_clip_duration: int = int(_env("MAX_CLIP_DURATION", "60"))

    # ---- Source download quality (yt-dlp) ----
    min_source_height: int = int(_env("MIN_SOURCE_HEIGHT", "1080"))
    max_source_height: int = int(_env("MAX_SOURCE_HEIGHT", "2160"))
    ytdlp_cookies_from_browser: str = _env("YTDLP_COOKIES_FROM_BROWSER", "")
    ytdlp_cookies_file: str = _env("YTDLP_COOKIES_FILE", "")

    # ---- Output / render ----
    out_width: int = int(_env("OUT_WIDTH", "1080"))
    out_height: int = int(_env("OUT_HEIGHT", "1920"))
    video_crf: int = int(_env("VIDEO_CRF", "18"))
    video_preset: str = _env("VIDEO_PRESET", "fast")
    layout: str = _env("LAYOUT", "fill")  # fill (face-tracked crop) | fit_blur (blurred backdrop)

    # ---- Hardware & Video Encoding (NVIDIA GPU NVENC / CPU) ----
    video_encoder: str = _env("VIDEO_ENCODER", "auto")  # auto | h264_nvenc | libx264 | h264_qsv
    nvenc_preset: str = _env("NVENC_PRESET", "p4")       # p1 to p7 (default p4)
    nvenc_cq: int = int(_env("NVENC_CQ", "20"))          # constant quality (default 20)
    cpu_preset: str = _env("CPU_PRESET", _env("VIDEO_PRESET", "fast"))
    cpu_crf: int = int(_env("CPU_CRF", _env("VIDEO_CRF", "18")))
    enable_encoder_fallback: bool = _env_bool("ENABLE_ENCODER_FALLBACK", True)

    # ---- Storage directories (Local & Deployed) ----
    outputs_dir: str = _env("OUTPUTS_DIR", "outputs")
    workdir_dir: str = _env("WORKDIR_DIR", "workdir")
    data_dir: str = _env("DATA_DIR", ".data")

    # ---- Captions ----
    caption_style: str = _env("CAPTION_STYLE", "bold_pop")
    caption_position: str = _env("CAPTION_POSITION", "")  # "" = style default | top | middle | bottom

    # ---- Metadata / SEO ----
    seo_enabled: bool = _env_bool("SEO_ENABLED", True)
    seo_language: str = _env("SEO_LANGUAGE", "English")
    seo_credit_source: bool = _env_bool("SEO_CREDIT_SOURCE", True)

    # ---- Publishing ----
    youtube_client_secrets: str = _env("YOUTUBE_CLIENT_SECRETS", "credentials/youtube_client_secret.json")
    youtube_token_file: str = _env("YOUTUBE_TOKEN_FILE", "credentials/youtube_token.json")
    youtube_privacy: str = _env("YOUTUBE_PRIVACY", "public")  # private | unlisted | public
    youtube_category_id: str = _env("YOUTUBE_CATEGORY_ID", "22")
    instagram_access_token: str = _env("INSTAGRAM_ACCESS_TOKEN", "")
    instagram_user_id: str = _env("INSTAGRAM_USER_ID", "")
    instagram_flavor: str = _env("INSTAGRAM_FLAVOR", "facebook")  # facebook (resumable) | instagram (needs public URL)
    instagram_graph_version: str = _env("INSTAGRAM_GRAPH_VERSION", "v23.0")
    instagram_public_base_url: str = _env("INSTAGRAM_PUBLIC_BASE_URL", "")

    @classmethod
    def create_custom(
        cls,
        provider: Optional[str] = None,
        stt_provider: Optional[str] = None,
        llm_provider: Optional[str] = None,
        fallback_to_local: Optional[bool] = None,
        shortlist: Optional[int] = None,
        **overrides: Any,
    ) -> Settings:
        """Create a custom Settings instance with overrides (any Settings field may be passed by name)."""
        p = provider or _env("PROVIDER", "local")
        base = cls(
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
        valid = {f.name for f in dataclasses.fields(cls)}
        unknown = set(overrides) - valid
        if unknown:
            raise TypeError(f"Unknown setting(s): {', '.join(sorted(unknown))}")
        changes = {k: v for k, v in overrides.items() if v is not None}
        return dataclasses.replace(base, **changes) if changes else base


settings = Settings()
