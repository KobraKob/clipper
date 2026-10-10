"""
Unit tests for candidate window generation, IoU, hook heuristics, and prefiltering.
"""

import unittest
from clipper.candidates import (
    build_candidates,
    calculate_iou,
    compute_heuristic_score,
    prefilter,
    score_hook,
)


class TestCandidates(unittest.TestCase):
    def setUp(self):
        # 10 segments of 5 seconds each (total 50s)
        self.segments = [
            {"start": i * 5.0, "end": (i + 1) * 5.0, "text": f"Sentence number {i} discussing ideas.", "words": []}
            for i in range(10)
        ]

    def test_build_candidates_duration_bounds(self):
        cands = build_candidates(self.segments, min_len=20.0, max_len=35.0)
        self.assertGreater(len(cands), 0)
        for c in cands:
            self.assertGreaterEqual(c["duration"], 20.0)
            self.assertLessEqual(c["duration"], 35.0)
            self.assertEqual(c["start"] % 5.0, 0.0)
            self.assertEqual(c["end"] % 5.0, 0.0)

    def test_calculate_iou_scenarios(self):
        # Disjoint
        w1 = {"start": 0.0, "end": 10.0}
        w2 = {"start": 10.0, "end": 20.0}
        self.assertEqual(calculate_iou(w1, w2), 0.0)

        # Identical
        w3 = {"start": 0.0, "end": 10.0}
        self.assertEqual(calculate_iou(w1, w3), 1.0)

        # 50% overlap: w1 is [0, 10], w4 is [5, 15]. Intersection = 5, Union = 15. IoU = 5/15 = 0.333...
        w4 = {"start": 5.0, "end": 15.0}
        self.assertAlmostEqual(calculate_iou(w1, w4), 5.0 / 15.0, places=3)

    def test_score_hook_variations(self):
        strong_hook = "Why does nobody talk about this hidden secret?"
        number_hook = "3 reasons you are doing this wrong every single day."
        weak_hook = "Um, so today we went to the grocery store and bought apples."

        self.assertGreaterEqual(score_hook(strong_hook), 0.8)
        self.assertGreaterEqual(score_hook(number_hook), 0.8)
        self.assertLess(score_hook(weak_hook), 0.4)

    def test_prefilter_deduplication(self):
        raw_cands = [
            {"start": 0.0, "end": 30.0, "duration": 30.0, "text": "Why this is crucial", "first_text": "Why this is crucial"},
            {"start": 1.0, "end": 31.0, "duration": 30.0, "text": "Why this is crucial also", "first_text": "Why this is crucial also"},
            {"start": 50.0, "end": 80.0, "duration": 30.0, "text": "Another separate insight", "first_text": "Another separate insight"},
        ]
        filtered = prefilter(raw_cands, top_k=5, max_overlap=0.4)
        # The first two overlap heavily (IoU ~ 29/31 = 0.93), so one must be dropped
        self.assertEqual(len(filtered), 2)
        self.assertEqual(filtered[0]["start"], 0.0)
        self.assertEqual(filtered[1]["start"], 50.0)


if __name__ == "__main__":
    unittest.main()
