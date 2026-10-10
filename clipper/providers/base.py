"""
Base interfaces and utilities for transcription and LLM providers.
"""

from __future__ import annotations

import json
import pathlib
import re
from typing import Any, Dict, List, Protocol, TypedDict, runtime_checkable


class WordTimestamp(TypedDict):
    w: str
    start: float
    end: float


class TranscriptSegment(TypedDict):
    start: float
    end: float
    text: str
    words: List[WordTimestamp]


class TranscriptData(TypedDict):
    language: str
    segments: List[TranscriptSegment]


@runtime_checkable
class Transcriber(Protocol):
    """Protocol for audio transcription services."""

    def transcribe(self, wav: pathlib.Path, work_dir: pathlib.Path) -> Dict[str, Any]:
        """
        Transcribe audio to word-level timestamped segments.
        Expected return structure:
        {
            "language": str,
            "segments": [
                {
                    "start": float,
                    "end": float,
                    "text": str,
                    "words": [{"w": str, "start": float, "end": float}]
                }
            ]
        }
        """
        ...


@runtime_checkable
class LLM(Protocol):
    """Protocol for language model completion services."""

    def complete_json(self, prompt: str, tier: str = "strong") -> Dict[str, Any]:
        """
        Generate completion adhering to strict JSON format.
        tier is "fast" (for high-volume batch filtering) or "strong" (for final reasoning/titles).
        """
        ...


def parse_json(text: str) -> Dict[str, Any]:
    """
    Robust JSON parser for model outputs.
    Handles code fences (```json ... ```), extra explanatory text, and trailing commas.
    """
    if not text or not text.strip():
        raise ValueError("Cannot parse JSON from empty or whitespace text.")

    cleaned = text.strip()

    # Strip markdown backticks if present
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    if match:
        cleaned = match.group(1).strip()

    # Try direct parse
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Extract bracketed JSON object
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = cleaned[start : end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            # Clean common trailing commas before closing braces/brackets
            fixed = re.sub(r",\s*([\]}])", r"\1", candidate)
            return json.loads(fixed)

    # Extract bracketed JSON array if top-level array was returned
    arr_start = cleaned.find("[")
    arr_end = cleaned.rfind("]")
    if arr_start != -1 and arr_end != -1 and arr_end > arr_start:
        candidate_arr = cleaned[arr_start : arr_end + 1]
        try:
            parsed_arr = json.loads(candidate_arr)
            return {"items": parsed_arr}
        except json.JSONDecodeError:
            fixed_arr = re.sub(r",\s*([\]}])", r"\1", candidate_arr)
            return {"items": json.loads(fixed_arr)}

    raise ValueError(f"Could not locate valid JSON payload in text: {text[:200]}...")
