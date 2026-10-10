"""
Unit tests for two-stage scoring, prompt formatting, and top selection.
"""

import unittest
from typing import Any, Dict
from clipper.scoring import rank, select_top, stage1, stage2


class MockScoringLLM:
    def __init__(self):
        self.call_count = 0

    def complete_json(self, prompt: str, tier: str = "strong") -> Dict[str, Any]:
        self.call_count += 1
        if tier == "fast":
            # Return canned scores for up to 10 batch items
            return {
                "scores": [
                    {"id": 0, "score": 92},
                    {"id": 1, "score": 40},
                    {"id": 2, "score": 85},
                    {"id": 3, "score": 55},
                    {"id": 4, "score": 78},
                ]
            }
        else:
            return {
                "score": 94,
                "hook": "Stop doing this immediately!",
                "title": "Major Mistake Revealed",
                "reason": "Clear problem-solution structure with high retention.",
            }


class TestScoring(unittest.TestCase):
    def setUp(self):
        self.mock_llm = MockScoringLLM()
        self.cands = [
            {"start": 0.0, "end": 25.0, "duration": 25.0, "text": "Clip one text content."},
            {"start": 26.0, "end": 50.0, "duration": 24.0, "text": "Clip two text content."},
            {"start": 51.0, "end": 75.0, "duration": 24.0, "text": "Clip three text content."},
            {"start": 76.0, "end": 100.0, "duration": 24.0, "text": "Clip four text content."},
            {"start": 101.0, "end": 125.0, "duration": 24.0, "text": "Clip five text content."},
        ]

    def test_stage1_batch_assignment(self):
        scored = stage1(self.cands, self.mock_llm, batch_size=5)
        self.assertEqual(len(scored), 5)
        self.assertEqual(scored[0]["fast_score"], 92)
        self.assertEqual(scored[1]["fast_score"], 40)
        self.assertEqual(scored[2]["fast_score"], 85)

    def test_stage2_detailed_enrichment(self):
        cand = {"start": 0.0, "end": 30.0, "text": "Sample clip text."}
        enriched = stage2(cand, self.mock_llm)
        self.assertEqual(enriched["score"], 94)
        self.assertEqual(enriched["hook"], "Stop doing this immediately!")
        self.assertEqual(enriched["title"], "Major Mistake Revealed")
        self.assertIn("retention", enriched["reason"])

    def test_select_top_deduplication(self):
        items = [
            {"start": 0.0, "end": 30.0, "score": 90},
            {"start": 2.0, "end": 32.0, "score": 88},  # Overlaps item 1
            {"start": 40.0, "end": 70.0, "score": 85},
            {"start": 80.0, "end": 110.0, "score": 80},
        ]
        top = select_top(items, n=2, key="score", max_overlap=0.3)
        self.assertEqual(len(top), 2)
        self.assertEqual(top[0]["start"], 0.0)
        self.assertEqual(top[1]["start"], 40.0)

    def test_rank_end_to_end(self):
        final = rank(self.cands, self.mock_llm, n=3, shortlist_size=3)
        self.assertLessEqual(len(final), 3)
        for item in final:
            self.assertIn("score", item)
            self.assertIn("title", item)
            self.assertIn("hook", item)


if __name__ == "__main__":
    unittest.main()
