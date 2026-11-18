"""
Replay-Peak and LLM Short-Form Clip Selection Package.
"""

from __future__ import annotations

from .fallback import is_ad_or_sponsor, run_fallback_selection
from .llm_check import LLMCheckResult, check_clip_with_llm
from .log import log_clip_plan, record_uploaded_video_id
from .plan import ClipPlan
from .refine import refine_window_with_llm
from .replay_peaks import (
    Peak,
    build_window,
    fetch_heatmap,
    find_peaks,
    fuse_scores,
    pick_non_overlapping,
    snap_to_sentences,
)
from .select import run
from .sentences import build_sentences

__all__ = [
    "Peak",
    "ClipPlan",
    "fetch_heatmap",
    "find_peaks",
    "build_window",
    "snap_to_sentences",
    "fuse_scores",
    "pick_non_overlapping",
    "build_sentences",
    "refine_window_with_llm",
    "check_clip_with_llm",
    "LLMCheckResult",
    "run_fallback_selection",
    "is_ad_or_sponsor",
    "log_clip_plan",
    "record_uploaded_video_id",
    "run",
]
