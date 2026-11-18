"""
Data structures for replay-peak and LLM clip selection.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class ClipPlan(Mapping):
    """A planned short-form clip candidate with full lineage and scoring metadata."""

    clip_id: str
    source_video: str
    start: float
    end: float
    source: str  # "heatmap" | "llm" | "hybrid"
    peak_time: Optional[float] = None
    peak_value: Optional[float] = None
    heatmap_rank: Optional[int] = None
    llm_score: Optional[float] = None
    audio_score: Optional[float] = None
    final_score: float = 0.0
    reason: str = ""
    warnings: List[str] = field(default_factory=list)
    title: str = ""
    hook: str = ""
    text: str = ""

    @property
    def duration(self) -> float:
        return round(self.end - self.start, 2)

    @property
    def score(self) -> int:
        """Normalized 0-100 integer score for downstream pipeline compatibility."""
        return max(0, min(100, int(round(self.final_score * 100))))

    @property
    def score_breakdown(self) -> Dict[str, Any]:
        """Detailed score breakdown for pipeline and analytics."""
        return {
            "final": self.score,
            "heat": self.peak_value,
            "llm": self.llm_score,
            "audio": self.audio_score,
        }

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict matching Section 7 schema, with extra fields preserved."""
        return {
            "clip_id": self.clip_id,
            "source_video": self.source_video,
            "start": round(self.start, 2),
            "end": round(self.end, 2),
            "duration": self.duration,
            "source": self.source,
            "peak_time": round(self.peak_time, 2) if self.peak_time is not None else None,
            "peak_value": round(self.peak_value, 4) if self.peak_value is not None else None,
            "heatmap_rank": self.heatmap_rank,
            "llm_score": round(self.llm_score, 4) if self.llm_score is not None else None,
            "audio_score": round(self.audio_score, 4) if self.audio_score is not None else None,
            "final_score": round(self.final_score, 4),
            "score": self.score,
            "score_breakdown": self.score_breakdown,
            "reason": self.reason,
            "warnings": list(self.warnings),
            "title": self.title,
            "hook": self.hook,
            "text": self.text,
        }

    # Mapping protocol methods for dict-like unpacking and downstream compatibility
    def __getitem__(self, item: str) -> Any:
        return self.to_dict()[item]

    def __iter__(self) -> Iterator[str]:
        return iter(self.to_dict())

    def __len__(self) -> int:
        return len(self.to_dict())

    def get(self, item: str, default: Any = None) -> Any:
        return self.to_dict().get(item, default)

    def __contains__(self, item: object) -> bool:
        return item in self.to_dict()

