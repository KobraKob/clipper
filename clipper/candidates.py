"""
Candidate window generation and heuristic scoring pre-filter.
Constructs sentence-aligned windows and ranks them with audio, speech, and hook signals.
"""

from __future__ import annotations

import math
import pathlib
import re
from typing import Any, Dict, List, Optional, Set

# Regex patterns for high-retention hooks
HOOK_STARTERS = [
    r"^(why|how|what|when|where|who)\b",
    r"^(did you know|have you ever|can you believe|do you know)\b",
    r"^(the (biggest|most|single|number one|only|worst))\b",
    r"^(this is why|this is how|here is why|here's why|here's how)\b",
    r"^(never|always|stop|do not|don't|avoid)\b",
    r"^(secret|mistake|truth|hack|rule|lesson|myth)\b",
    r"^\d+\s+(reasons|ways|things|tips|mistakes|rules|steps|hacks)\b",
]

HOOK_REGEXES = [re.compile(pattern, re.IGNORECASE) for pattern in HOOK_STARTERS]


def calculate_iou(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    """Calculate temporal Intersection over Union (IoU) between two time ranges."""
    start_a, end_a = float(a["start"]), float(a["end"])
    start_b, end_b = float(b["start"]), float(b["end"])

    inter = max(0.0, min(end_a, end_b) - max(start_a, start_b))
    union = (end_a - start_a) + (end_b - start_b) - inter
    return inter / union if union > 0 else 0.0


def score_hook(text: str) -> float:
    """Evaluate hook strength of opening text (0.0 to 1.0)."""
    cleaned = text.strip().lower()
    score = 0.0

    for reg in HOOK_REGEXES:
        if reg.search(cleaned):
            score = max(score, 0.8)
            break

    if cleaned.endswith("?"):
        score = max(score, 0.6)

    # Word count in first clause check (concise punchy opener)
    first_words = cleaned.split()[:8]
    first_sentence = " ".join(first_words)
    if any(k in first_sentence for k in ["crazy", "insane", "nobody", "shocking", "million", "billion"]):
        score = min(1.0, score + 0.3)

    return score


def detect_scene_cuts(
    video_path: pathlib.Path,
    max_duration: Optional[float] = None,
    frame_skip: int = 4,
) -> List[float]:
    """Detect visual scene cuts using PySceneDetect with frame-skipping and duration safety."""
    try:
        from scenedetect import open_video, SceneManager
        from scenedetect.detectors import ContentDetector

        video = open_video(str(video_path))
        # Cap duration to first 10 minutes (600s) to avoid multi-minute hangs on long podcasts/streams
        duration = max_duration if max_duration is not None else 600.0
        scene_manager = SceneManager()
        scene_manager.add_detector(ContentDetector(threshold=27.0))
        scene_manager.detect_scenes(video=video, duration=duration, frame_skip=frame_skip)
        scene_list = scene_manager.get_scene_list()
        cut_times = [scene[0].get_seconds() for scene in scene_list if scene[0].get_seconds() > 0]
        return cut_times
    except Exception:
        # Gracefully handle if scenedetect is unable to process video file
        return []


def build_candidates(
    segments: List[Dict[str, Any]],
    min_len: float = 20.0,
    max_len: float = 60.0,
    step: int = 1,
) -> List[Dict[str, Any]]:
    """
    Generate sliding candidate windows aligned to sentence segment boundaries.
    Ensures clips never start or end mid-sentence.
    """
    candidates: List[Dict[str, Any]] = []
    n = len(segments)

    for i in range(0, n, step):
        start = float(segments[i]["start"])
        total_text_parts: List[str] = []
        total_words = 0

        for j in range(i, n):
            end = float(segments[j]["end"])
            dur = end - start
            if dur > max_len:
                break

            total_text_parts.append(segments[j]["text"])
            total_words += len(segments[j].get("words", []))

            if dur >= min_len:
                text = " ".join(total_text_parts).strip()
                candidates.append(
                    {
                        "start": start,
                        "end": end,
                        "duration": round(dur, 2),
                        "text": text,
                        "start_idx": i,
                        "end_idx": j,
                        "word_count": total_words,
                        "first_text": segments[i]["text"],
                    }
                )

    return candidates


def compute_heuristic_score(
    cand: Dict[str, Any],
    scene_cuts: Optional[List[float]] = None,
) -> float:
    """
    Combine cheap acoustic, speech-rate, and textual signals into a baseline heuristic score.
    Scale: 0.0 to 100.0.
    """
    duration = float(cand["duration"])
    word_count = int(cand.get("word_count", len(cand["text"].split())))

    # 1. Speech rate (words per second). Optimal speaking rate is 2.2 - 3.8 wps.
    wps = word_count / duration if duration > 0 else 0.0
    if 2.0 <= wps <= 4.0:
        speech_rate_score = 30.0
    elif 1.4 <= wps < 2.0 or 4.0 < wps <= 5.0:
        speech_rate_score = 18.0
    else:
        # Too slow (dead air) or unnaturally fast
        speech_rate_score = 5.0

    # 2. Hook score from the initial segment
    first_text = cand.get("first_text", cand["text"])
    hook_val = score_hook(first_text)
    hook_score = hook_val * 40.0

    # 3. Ideal duration bonus (30-45s is sweet spot for vertical shorts)
    if 28.0 <= duration <= 48.0:
        duration_score = 20.0
    else:
        duration_score = 10.0

    # 4. Scene cut proximity bonus
    scene_score = 0.0
    if scene_cuts:
        cand_start = float(cand["start"])
        # Bonus if clip starts within 1.0 second of a detected visual cut
        if any(abs(cand_start - cut) <= 1.0 for cut in scene_cuts):
            scene_score = 10.0

    total = speech_rate_score + hook_score + duration_score + scene_score
    return round(total, 2)


def prefilter(
    candidates: List[Dict[str, Any]],
    top_k: int = 40,
    max_overlap: float = 0.4,
    scene_cuts: Optional[List[float]] = None,
) -> List[Dict[str, Any]]:
    """
    Score all candidates heuristically, deduplicate overlapping segments,
    and return the top K candidates for LLM scoring.
    """
    if not candidates:
        return []

    # Calculate heuristic score for each candidate
    for cand in candidates:
        cand["heuristic_score"] = compute_heuristic_score(cand, scene_cuts)

    # Sort descending by heuristic score
    sorted_cands = sorted(candidates, key=lambda c: c.get("heuristic_score", 0.0), reverse=True)

    # Greedy deduplication with IoU threshold
    selected: List[Dict[str, Any]] = []
    for candidate in sorted_cands:
        if not any(calculate_iou(candidate, picked) >= max_overlap for picked in selected):
            selected.append(candidate)
            if len(selected) >= top_k:
                break

    return selected
