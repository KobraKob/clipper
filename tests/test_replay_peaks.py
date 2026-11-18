"""
Acceptance tests for replay-peak detection, windowing, sentence snapping,
score fusion, and non-overlapping selection (Section 10 Acceptance Tests 1-7).
"""

from __future__ import annotations

import unittest
from clipper.selection.replay_peaks import (
    Peak,
    _smooth,
    build_window,
    fetch_heatmap,
    find_peaks,
    fuse_scores,
    pick_non_overlapping,
    snap_to_sentences,
)


class TestReplayPeaksAcceptance(unittest.TestCase):
    """Verifies all 7 algorithmic acceptance criteria from REPLAY_PEAK_CLIP_SELECTION.md."""

    def test_acceptance_1_peaks(self):
        """
        Acceptance test 1:
        Synthetic 1,200s video with 100 buckets, three bumps (strong, medium, weak) plus a high first bucket.
        Expect:
        - First bucket ignored (edge ignore pct).
        - Peaks returned strongest-first.
        - None closer than PEAK_MIN_GAP_SEC (45s).
        - Spans around each bump.
        """
        duration = 1200.0
        n_buckets = 100
        bucket_w = duration / n_buckets  # 12.0s per bucket

        # Baseline flat values around 0.2
        values = [0.2] * n_buckets

        # High first bucket (intro spike) that should be dropped by edge_ignore_pct (3% of 1200 = 36s)
        values[0] = 0.95
        values[1] = 0.90

        # Weak bump around bucket 25 (t = ~300s): reaches 0.45 (below min_value 0.55 -> should NOT be picked)
        values[24] = 0.35
        values[25] = 0.45
        values[26] = 0.35

        # Medium bump around bucket 50 (t = ~600s): peak 0.70
        values[48] = 0.30
        values[49] = 0.55
        values[50] = 0.70
        values[51] = 0.55
        values[52] = 0.30

        # Strong bump around bucket 75 (t = ~900s): peak 0.90
        values[73] = 0.30
        values[74] = 0.65
        values[75] = 0.90
        values[76] = 0.65
        values[77] = 0.30

        heatmap = [
            {"start_time": i * bucket_w, "end_time": (i + 1) * bucket_w, "value": values[i]}
            for i in range(n_buckets)
        ]

        peaks = find_peaks(
            heatmap,
            duration,
            min_value=0.55,
            edge_ignore_pct=3.0,
            min_gap_sec=45.0,
            width_fraction=0.6,
        )

        self.assertGreaterEqual(len(peaks), 2)
        # Strongest first: bucket 75 (~900s) should be first, bucket 50 (~600s) second
        self.assertAlmostEqual(peaks[0].time, 75 * bucket_w + bucket_w / 2, delta=bucket_w)
        self.assertAlmostEqual(peaks[1].time, 50 * bucket_w + bucket_w / 2, delta=bucket_w)
        self.assertGreater(peaks[0].value, peaks[1].value)

        # None closer than 45s
        for i in range(len(peaks)):
            for j in range(i + 1, len(peaks)):
                self.assertGreaterEqual(abs(peaks[i].time - peaks[j].time), 45.0)

        # First bucket ignored
        for p in peaks:
            self.assertGreaterEqual(p.time, duration * 0.03)
            self.assertLessEqual(p.time, duration * 0.97)

        # Spans expand around each bump
        for p in peaks:
            self.assertLess(p.span_start, p.time)
            self.assertGreater(p.span_end, p.time)

    def test_acceptance_2_flat_signal(self):
        """Acceptance test 2: A near-constant heatmap returns no peaks."""
        duration = 600.0
        n_buckets = 50
        bucket_w = duration / n_buckets
        # All values around 0.60 with negligible variance (< 0.15 contrast)
        heatmap = [
            {"start_time": i * bucket_w, "end_time": (i + 1) * bucket_w, "value": 0.60 + (i % 3) * 0.01}
            for i in range(n_buckets)
        ]

        peaks = find_peaks(heatmap, duration, min_contrast=0.15)
        self.assertEqual(peaks, [])

    def test_acceptance_3_window(self):
        """
        Acceptance test 3:
        For peaks at the start, middle and end of a video:
        - Window is 30-39 s (or whole video if shorter).
        - Clamped strictly inside [0, duration].
        - Contains the peak.
        """
        dur = 300.0

        # Peak near start (10s)
        p_start = Peak(time=10.0, value=0.8, span_start=5.0, span_end=15.0)
        s1, e1 = build_window(p_start, dur, min_len=30.0, max_len=39.0)
        self.assertEqual(s1, 0.0)
        self.assertGreaterEqual(e1 - s1, 30.0)
        self.assertLessEqual(e1 - s1, 39.0)
        self.assertTrue(s1 <= p_start.time <= e1)

        # Peak in middle (150s)
        p_mid = Peak(time=150.0, value=0.8, span_start=140.0, span_end=160.0)
        s2, e2 = build_window(p_mid, dur, min_len=30.0, max_len=39.0)
        self.assertGreaterEqual(s2, 0.0)
        self.assertLessEqual(e2, dur)
        self.assertGreaterEqual(e2 - s2, 30.0)
        self.assertLessEqual(e2 - s2, 39.0)
        self.assertTrue(s2 <= p_mid.time <= e2)

        # Peak near end (295s)
        p_end = Peak(time=295.0, value=0.8, span_start=285.0, span_end=300.0)
        s3, e3 = build_window(p_end, dur, min_len=30.0, max_len=39.0)
        self.assertEqual(e3, dur)
        self.assertGreaterEqual(s3, 0.0)
        self.assertGreaterEqual(e3 - s3, 30.0)
        self.assertLessEqual(e3 - s3, 39.0)
        self.assertTrue(s3 <= p_end.time <= e3)

        # Short video test (25s < 30s)
        p_short = Peak(time=12.0, value=0.8, span_start=8.0, span_end=16.0)
        s4, e4 = build_window(p_short, 25.0, min_len=30.0, max_len=39.0)
        self.assertEqual(s4, 0.0)
        self.assertEqual(e4, 25.0)

    def test_acceptance_4_snap_to_sentences(self):
        """
        Acceptance test 4:
        With sentences about every 4s, the snapped clip starts and ends on sentence boundaries,
        stays within the length range (strict, else relaxed), and keeps the peak inside.
        """
        # Sentences every 4 seconds from 0 to 200s
        sentences = [
            {"start": float(i * 4), "end": float((i + 1) * 4), "text": f"Sentence {i}."}
            for i in range(50)
        ]

        peak_time = 120.0
        # H3 window before snapping: e.g. 100.0 to 134.0 (length 34s)
        start, end = 100.0, 134.0
        snapped_s, snapped_e, ok = snap_to_sentences(
            start, end, sentences, peak_time, min_len=30.0, max_len=39.0
        )
        self.assertTrue(ok)
        # Boundary check: multiples of 4
        self.assertEqual(snapped_s % 4.0, 0.0)
        self.assertEqual(snapped_e % 4.0, 0.0)
        # Length check
        dur = snapped_e - snapped_s
        self.assertGreaterEqual(dur, 30.0)
        self.assertLessEqual(dur, 39.0)
        # Peak inside check (with at least min_setup=3s and min_tail=2s)
        self.assertLessEqual(snapped_s, peak_time - 3.0)
        self.assertGreaterEqual(snapped_e, peak_time + 2.0)

    def test_acceptance_5_fusion(self):
        """Acceptance test 5: None inputs are dropped and weights re-normalised; all-None gives 0."""
        # Standard full inputs
        score = fuse_scores(heat=0.8, llm=0.6, audio=0.4, w_heat=0.5, w_llm=0.35, w_audio=0.15)
        expected = (0.8 * 0.5 + 0.6 * 0.35 + 0.4 * 0.15) / 1.0
        self.assertAlmostEqual(score, expected, places=4)

        # Missing audio (audio = None)
        score_no_audio = fuse_scores(heat=0.8, llm=0.6, audio=None, w_heat=0.5, w_llm=0.35, w_audio=0.15)
        expected_no_audio = (0.8 * 0.5 + 0.6 * 0.35) / (0.5 + 0.35)
        self.assertAlmostEqual(score_no_audio, expected_no_audio, places=4)

        # Heatmap only (llm = None, audio = None)
        score_heat_only = fuse_scores(heat=0.75, llm=None, audio=None)
        self.assertAlmostEqual(score_heat_only, 0.75, places=4)

        # All None -> 0.0
        self.assertEqual(fuse_scores(None, None, None), 0.0)

    def test_acceptance_6_overlap(self):
        """Acceptance test 6: Two overlapping candidates keep only the higher score."""
        clips = [
            {"start": 10.0, "end": 42.0, "score": 0.65, "title": "Low Score Overlap"},
            {"start": 20.0, "end": 52.0, "score": 0.88, "title": "High Score Winner"},
            {"start": 100.0, "end": 133.0, "score": 0.75, "title": "Non-overlapping Other"},
        ]

        picked = pick_non_overlapping(clips, n=5, min_gap=0.0)
        self.assertEqual(len(picked), 2)
        titles = [c["title"] for c in picked]
        self.assertIn("High Score Winner", titles)
        self.assertIn("Non-overlapping Other", titles)
        self.assertNotIn("Low Score Overlap", titles)
        # Output must be ordered chronologically by start
        self.assertEqual(picked[0]["start"], 20.0)
        self.assertEqual(picked[1]["start"], 100.0)

    def test_acceptance_7_fetch_safe_failure(self):
        """Acceptance test 7: A bad URL or unreachable host returns (None, None) without raising."""
        hm, dur = fetch_heatmap("https://invalid.example.nonexistent/video_test")
        self.assertIsNone(hm)
        self.assertIsNone(dur)

    def test_acceptance_8_live_heatmap_probe(self):
        """Acceptance test 8: Live probe against 3 popular videos with heatmap verification."""
        import os
        if not os.getenv("RUN_LIVE_TESTS") and not os.getenv("CI"):
            # Optional live probe test gated by env var or CI to prevent unexpected test delays in offline mode
            return

        test_urls = [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/watch?v=UF8uR6Z6KLc",
            "https://www.youtube.com/watch?v=aircAruvnKk",
        ]
        for url in test_urls:
            hm, dur = fetch_heatmap(url, socket_timeout=10)
            if hm is None:
                self.skipTest("Live YouTube watch-page is unreachable or blocked in this environment.")
            self.assertIsNotNone(hm)
            self.assertGreaterEqual(len(hm), 50)
            self.assertIsNotNone(dur)
            self.assertGreater(dur, 60.0)



if __name__ == "__main__":
    unittest.main()
