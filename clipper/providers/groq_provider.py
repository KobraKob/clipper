"""
Groq API provider implementation for hosted Whisper STT and LLM scoring.
"""

from __future__ import annotations

import os
import pathlib
import subprocess
from typing import Any, Dict, List, Optional

from ..config import Settings
from .base import parse_json
from .retry import with_retry


class GroqTranscriber:
    """Chunked audio transcription using Groq hosted Whisper."""

    def __init__(self, s: Settings) -> None:
        self.s = s
        api_key = self.s.groq_api_key or os.getenv("GROQ_API_KEY", "")
        if not api_key:
            raise ValueError(
                "GROQ_API_KEY environment variable is required when using the Groq provider."
            )

        try:
            from groq import Groq
            import groq

            self.client = Groq(api_key=api_key)
            self._retryable_errors = (
                groq.RateLimitError,
                groq.APIConnectionError,
                groq.InternalServerError,
            )
        except ImportError as exc:
            raise ImportError(
                "groq package is not installed. Install via `pip install groq`."
            ) from exc

    def _split(self, wav: pathlib.Path, out_dir: pathlib.Path) -> List[pathlib.Path]:
        """Split WAV file into chunks smaller than STT_CHUNK_SECONDS using ffmpeg."""
        out_dir.mkdir(parents=True, exist_ok=True)
        for old in out_dir.glob("chunk_*.wav"):
            try:
                old.unlink()
            except OSError:
                pass

        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(wav),
            "-f",
            "segment",
            "-segment_time",
            str(self.s.chunk_seconds),
            "-c",
            "copy",
            str(out_dir / "chunk_%03d.wav"),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg audio splitting failed: {result.stderr}")

        chunks = sorted(out_dir.glob("chunk_*.wav"))
        if not chunks:
            # If segmentation didn't produce chunks (e.g. very short audio), use source wav
            chunks = [wav]
        return chunks

    def _transcribe_chunk(self, path: pathlib.Path) -> Dict[str, Any]:
        """Transcribe an individual audio chunk file via Groq."""
        def call():
            with open(path, "rb") as f:
                return self.client.audio.transcriptions.create(
                    file=(path.name, f.read()),
                    model=self.s.groq_stt_model,
                    response_format="verbose_json",
                    timestamp_granularities=["word", "segment"],
                    temperature=0.0,
                )

        res = with_retry(call, retries=5, retry_on=self._retryable_errors)
        if hasattr(res, "model_dump"):
            return res.model_dump()
        if isinstance(res, dict):
            return res
        return dict(res)

    def transcribe(self, wav: pathlib.Path, work_dir: pathlib.Path) -> Dict[str, Any]:
        """Transcribe full audio file with chunk-offset correction."""
        chunks = self._split(wav, pathlib.Path(work_dir) / "chunks")
        all_segments: List[Dict[str, Any]] = []
        detected_language: Optional[str] = None

        for idx, chunk in enumerate(chunks):
            offset = idx * self.s.chunk_seconds
            data = self._transcribe_chunk(chunk)
            if not detected_language and data.get("language"):
                detected_language = data.get("language")

            chunk_words: List[Dict[str, Any]] = []
            for w in data.get("words") or []:
                chunk_words.append(
                    {
                        "w": w.get("word", "").strip(),
                        "start": float(w.get("start", 0.0)) + offset,
                        "end": float(w.get("end", 0.0)) + offset,
                    }
                )

            for seg in data.get("segments") or []:
                s0 = float(seg.get("start", 0.0)) + offset
                s1 = float(seg.get("end", 0.0)) + offset
                seg_words = [
                    w
                    for w in chunk_words
                    if s0 - 0.05 <= (w["start"] + w["end"]) / 2.0 < s1 + 0.05
                ]
                all_segments.append(
                    {
                        "start": s0,
                        "end": s1,
                        "text": seg.get("text", "").strip(),
                        "words": seg_words,
                    }
                )

        return {
            "language": detected_language or "en",
            "segments": all_segments,
        }


class GroqLLM:
    """LLM client powered by Groq API."""

    def __init__(self, s: Settings) -> None:
        self.s = s
        api_key = self.s.groq_api_key or os.getenv("GROQ_API_KEY", "")
        if not api_key:
            raise ValueError(
                "GROQ_API_KEY environment variable is required when using the Groq provider."
            )

        try:
            from groq import Groq
            import groq

            self.client = Groq(api_key=api_key)
            self._retryable_errors = (
                groq.RateLimitError,
                groq.APIConnectionError,
                groq.InternalServerError,
            )
        except ImportError as exc:
            raise ImportError(
                "groq package is not installed. Install via `pip install groq`."
            ) from exc

        self.tokens_used: int = 0

    def complete_json(self, prompt: str, tier: str = "strong") -> Dict[str, Any]:
        """Request JSON completion using fast or strong tier model."""
        model = self.s.groq_fast if tier == "fast" else self.s.groq_strong

        def call():
            return self.client.chat.completions.create(
                model=model,
                temperature=0.2,
                response_format={"type": "json_object"},
                messages=[{"role": "user", "content": prompt}],
            )

        resp = with_retry(call, retries=5, retry_on=self._retryable_errors)
        if getattr(resp, "usage", None) and hasattr(resp.usage, "total_tokens"):
            self.tokens_used += int(resp.usage.total_tokens)

        content = resp.choices[0].message.content
        return parse_json(content)
