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
                "dimension_scores": {
                    "hook_strength": 9, "standalone_context": 9, "payoff": 9,
                    "emotional_resonance": 8, "specificity": 8, "clarity": 9,
                    "pacing": 8, "originality": 8,
                },
                "hook": "Sample clip text.",
                "title": "Sample Clip Text",
                "reason": "Sample clip text presents a clear useful idea.",
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
        self.assertEqual(scored[0]["fast_model_score"], 92)
        self.assertEqual(scored[1]["fast_model_score"], 40)
        self.assertEqual(scored[2]["fast_model_score"], 85)
        self.assertGreaterEqual(scored[0]["fast_score"], 0)
        self.assertLessEqual(scored[0]["fast_score"], 100)
        self.assertNotEqual(scored[0]["fast_score"], scored[0]["fast_model_score"])

    def test_stage2_detailed_enrichment(self):
        cand = {"start": 0.0, "end": 30.0, "text": "Sample clip text."}
        enriched = stage2(cand, self.mock_llm)
        self.assertGreaterEqual(enriched["score"], 0)
        self.assertLessEqual(enriched["score"], 100)
        self.assertEqual(enriched["hook"], "Sample clip text.")
        self.assertEqual(enriched["title"], "Sample Clip Text")
        self.assertIn("final", enriched["score_breakdown"])
        self.assertIn("clear useful idea", enriched["reason"])

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
    def test_rank_supports_ten_clips_and_caps_larger_requests(self):
        candidates = []
        for index in range(12):
            start = index * 40.0
            text = f"Sample topic {index} includes specific advice and a useful surprising example."
            candidates.append({
                "start": start, "end": start + 25.0, "duration": 25.0,
                "text": text, "first_text": text, "word_count": len(text.split()),
            })
        final = rank(candidates, self.mock_llm, n=99, shortlist_size=20)
        self.assertEqual(len(final), 10)
        self.assertTrue(all(0 <= item["score"] <= 100 for item in final))

    def test_stage1_missing_scores_fall_back_to_heuristics(self):
        class PartialLLM:
            def complete_json(self, prompt: str, tier: str = "strong") -> Dict[str, Any]:
                return {"scores": [{"id": 0, "score": 500}]}

        candidates = [dict(item) for item in self.cands[:2]]
        scored = stage1(candidates, PartialLLM(), batch_size=5)
        self.assertEqual(scored[0]["fast_model_score"], 100)
        self.assertIsNone(scored[1]["fast_model_score"])
        self.assertEqual(scored[1]["fast_score"], scored[1]["heuristic_quality_score"])


if __name__ == "__main__":
    unittest.main()
