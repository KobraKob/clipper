"""
Local processing providers for transcription (faster-whisper) and LLM scoring (Ollama).
"""

from __future__ import annotations

import pathlib
from typing import Any, Dict, List
import requests

from ..config import Settings
from .base import parse_json


class LocalTranscriber:
    """Offline transcriber using faster-whisper with word-level timestamps."""

    def __init__(self, s: Settings) -> None:
        self.s = s
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise ImportError(
                "faster-whisper is not installed. Run `pip install faster-whisper` "
                "or install with optional dependencies `pip install .[local]`."
            ) from exc

        device = self.s.whisper_device
        compute_type = self.s.whisper_compute
        if device == "auto":
            # Let faster-whisper select device, or fallback to cpu
            device = "cpu"
        if compute_type == "auto":
            compute_type = "float16" if device == "cuda" else "int8"

        self.model = WhisperModel(
            self.s.whisper_model,
            device=device,
            compute_type=compute_type,
        )

    def transcribe(self, wav: pathlib.Path, work_dir: pathlib.Path) -> Dict[str, Any]:
        """Transcribe audio file into word-level timestamped segments."""
        if not wav.exists():
            raise FileNotFoundError(f"Audio file not found: {wav}")

        segments, info = self.model.transcribe(
            str(wav),
            word_timestamps=True,
            vad_filter=True,
            beam_size=5,
        )

        formatted_segments: List[Dict[str, Any]] = []
        for segment in segments:
            words = [
                {
                    "w": word.word.strip(),
                    "start": float(word.start),
                    "end": float(word.end),
                }
                for word in (segment.words or [])
                if word.word.strip()
            ]
            formatted_segments.append(
                {
                    "start": float(segment.start),
                    "end": float(segment.end),
                    "text": segment.text.strip(),
                    "words": words,
                }
            )

        return {
            "language": info.language if hasattr(info, "language") else "en",
            "segments": formatted_segments,
        }


class OllamaLLM:
    """Local LLM completion client using Ollama REST API."""

    def __init__(self, s: Settings) -> None:
        self.s = s

    def complete_json(self, prompt: str, tier: str = "strong") -> Dict[str, Any]:
        """Query local Ollama endpoint requesting JSON-formatted response."""
        model = self.s.ollama_fast if tier == "fast" else self.s.ollama_strong
        payload = {
            "model": model,
            "stream": False,
            "format": "json",
            "messages": [{"role": "user", "content": prompt}],
            "options": {"temperature": 0.2, "num_ctx": 8192},
        }

        try:
            response = requests.post(
                f"{self.s.ollama_url.rstrip('/')}/api/chat",
                json=payload,
                timeout=300,
            )
            response.raise_for_status()
            data = response.json()
            content = data.get("message", {}).get("content", "")
            return parse_json(content)
        except requests.RequestException as exc:
            raise RuntimeError(
                f"Failed to communicate with Ollama at {self.s.ollama_url}: {exc}"
            ) from exc
