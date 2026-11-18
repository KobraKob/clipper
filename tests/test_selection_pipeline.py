"""
Comprehensive tests for replay-peak selection pipeline, sentences, refinement,
LLM checks, fallback generation, and A/B logging.
"""

from __future__ import annotations

import json
import pathlib
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from clipper.config import Settings
from clipper.selection import (
    ClipPlan,
    build_sentences,
    check_clip_with_llm,
    is_ad_or_sponsor,
    log_clip_plan,
    record_uploaded_video_id,
    refine_window_with_llm,
    run as run_selection,
    run_fallback_selection,
)


class MockLLM:
    """Configurable mock LLM for testing JSON completions."""

    def __init__(self, responses: dict | list | None = None) -> None:
        self.responses = responses or {}
        self.call_count = 0
        self.last_prompt = ""

    def complete_json(self, prompt: str, tier: str = "strong"):
        self.call_count += 1
        self.last_prompt = prompt
        if isinstance(self.responses, list):
            idx = min(self.call_count - 1, len(self.responses) - 1)
            resp = self.responses[idx]
        else:
            resp = self.responses
        if isinstance(resp, Exception):
            raise resp
        return resp


class TestSelectionComponents(unittest.TestCase):
    def test_build_sentences_from_words_with_punctuation(self):
        segments = [
            {
                "start": 0.0,
                "end": 8.0,
                "text": "Hello world. This is great!",
                "words": [
                    {"w": "Hello", "start": 0.0, "end": 0.8},
                    {"w": "world.", "start": 0.9, "end": 1.5},
                    {"w": "This", "start": 2.0, "end": 2.5},
                    {"w": "is", "start": 2.6, "end": 2.8},
                    {"w": "great!", "start": 2.9, "end": 3.5},
                ],
            }
        ]
        sentences = build_sentences(segments)
        self.assertEqual(len(sentences), 2)
        self.assertEqual(sentences[0]["text"], "Hello world.")
        self.assertEqual(sentences[0]["start"], 0.0)
        self.assertEqual(sentences[0]["end"], 1.5)
        self.assertEqual(sentences[1]["text"], "This is great!")
        self.assertEqual(sentences[1]["start"], 2.0)
        self.assertEqual(sentences[1]["end"], 3.5)

    def test_build_sentences_fallback_on_unpunctuated(self):
        # Words without any punctuation fallback to segments
        segments = [
            {
                "start": 10.0,
                "end": 15.0,
                "text": "first segment here",
                "words": [
                    {"w": "first", "start": 10.0, "end": 11.0},
                    {"w": "segment", "start": 11.1, "end": 13.0},
                    {"w": "here", "start": 13.1, "end": 14.5},
                ],
            },
            {
                "start": 16.0,
                "end": 22.0,
                "text": "second segment here",
                "words": [
                    {"w": "second", "start": 16.0, "end": 18.0},
                    {"w": "segment", "start": 18.1, "end": 20.0},
                    {"w": "here", "start": 20.1, "end": 21.5},
                ],
            },
        ]
        sentences = build_sentences(segments)
        self.assertEqual(len(sentences), 2)
        self.assertEqual(sentences[0]["text"], "first segment here")
        self.assertEqual(sentences[1]["text"], "second segment here")

    def test_refine_window_with_llm(self):
        sentences = [
            {"start": float(i * 5), "end": float((i + 1) * 5), "text": f"Point {i} explained."}
            for i in range(20)  # 0 to 100s
        ]
        # Coarse hump span 40 to 70 with bucket_sec = 20
        # Matching window [20, 90] -> sentences 4 to 17
        mock_llm = MockLLM({"start_sentence": 2, "end_sentence": 8, "reason": "Clear setup and payoff."})
        s, e, reason, ok = refine_window_with_llm(
            span_start=40.0,
            span_end=70.0,
            bucket_sec=20.0,
            sentences=sentences,
            llm=mock_llm,
            min_len=30.0,
            max_len=39.0,
        )
        self.assertTrue(ok)
        self.assertIsNotNone(s)
        self.assertIsNotNone(e)
        self.assertAlmostEqual(e - s, 35.0, places=1)
        self.assertIn("setup", reason)

    def test_llm_check_drop_or_missing_payoff(self):
        sentences = [
            {"start": float(i * 5), "end": float((i + 1) * 5), "text": f"Sentence {i}."}
            for i in range(10)
        ]
        # Drop requested by LLM
        drop_llm = MockLLM({"drop": True, "reason": "Needs context from prior hour."})
        res = check_clip_with_llm(10.0, 45.0, 25.0, sentences, drop_llm)
        self.assertFalse(res.keep)

        # Payoff missing requested by LLM
        payoff_missing_llm = MockLLM({"drop": False, "payoff_included": False, "reason": "Cut before punchline."})
        res2 = check_clip_with_llm(10.0, 45.0, 25.0, sentences, payoff_missing_llm)
        self.assertFalse(res2.keep)

    def test_llm_check_adjustment_applied_and_ignored(self):
        sentences = [
            {"start": float(i * 4), "end": float((i + 1) * 4), "text": f"Sentence {i}."}
            for i in range(20)  # 0 to 80s
        ]
        # Valid adjustment within bounds keeping peak inside
        mock_llm = MockLLM({
            "self_contained": True,
            "payoff_included": True,
            "hook_score": 9,
            "start_sentence": 1,  # starts at 4.0
            "end_sentence": 9,    # ends at 40.0 (dur 36.0s)
            "drop": False,
            "reason": "Stronger hook opener.",
        })
        res = check_clip_with_llm(8.0, 44.0, 24.0, sentences, mock_llm)
        self.assertTrue(res.keep)
        self.assertEqual(res.start, 4.0)
        self.assertEqual(res.end, 40.0)
        self.assertEqual(res.warnings, [])

        # Invalid adjustment (too long: 60s) -> should ignore adjustment and add warning
        bad_adj_llm = MockLLM({
            "self_contained": True,
            "payoff_included": True,
            "hook_score": 8,
            "start_sentence": 0,
            "end_sentence": 15,  # 64s!
            "drop": False,
            "reason": "Too long.",
        })
        res2 = check_clip_with_llm(8.0, 44.0, 24.0, sentences, bad_adj_llm)
        self.assertTrue(res2.keep)
        self.assertEqual(res2.start, 8.0)  # original kept
        self.assertEqual(res2.end, 44.0)
        self.assertIn("llm_adjustment_ignored", res2.warnings)

    def test_is_ad_or_sponsor(self):
        self.assertTrue(is_ad_or_sponsor("Check out our sponsor NordVPN with the link in the description."))
        self.assertTrue(is_ad_or_sponsor("Use promo code CLIPPER for 20% off today."))
        self.assertFalse(is_ad_or_sponsor("In 1997, researchers made a revolutionary discovery about neural nets."))

    def test_ab_logging_and_recording(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            log_file = pathlib.Path(tmpdir) / "test_clips.jsonl"
            plan = ClipPlan(
                clip_id="abc123_t0045",
                source_video="https://www.youtube.com/watch?v=abc12345678",
                start=45.0,
                end=80.0,
                source="heatmap",
                peak_time=60.0,
                peak_value=0.88,
                heatmap_rank=1,
                llm_score=0.82,
                final_score=0.85,
                reason="Top punchline moment.",
                warnings=["refined_by_llm"],
            )

            log_clip_plan(plan, log_path=log_file)
            self.assertTrue(log_file.exists())

            lines = log_file.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 1)
            entry = json.loads(lines[0])
            self.assertEqual(entry["clip_id"], "abc123_t0045")
            self.assertEqual(entry["source"], "heatmap")

            # Link YouTube upload ID
            updated = record_uploaded_video_id("abc123_t0045", "yt_short_999", log_path=log_file)
            self.assertTrue(updated)

            lines_after = log_file.read_text(encoding="utf-8").splitlines()
            entry_after = json.loads(lines_after[0])
            self.assertEqual(entry_after["youtube_video_id"], "yt_short_999")
            self.assertIn("uploaded_at", entry_after)

    def test_build_sentences_multilingual_punctuation(self):
        """Devanagari danda, CJK full stop, and Arabic question mark trigger sentence splitting."""
        segments = [
            {
                "start": 0.0,
                "end": 6.0,
                "text": "नमस्ते। धन्यवाद।",
                "words": [
                    {"w": "नमस्ते।", "start": 0.0, "end": 2.5},
                    {"w": "धन्यवाद।", "start": 2.8, "end": 5.5},
                ],
            },
            {
                "start": 10.0,
                "end": 16.0,
                "text": "こんにちは。ありがとう。",
                "words": [
                    {"w": "こんにちは。", "start": 10.0, "end": 12.5},
                    {"w": "ありがとう。", "start": 12.8, "end": 15.5},
                ],
            },
        ]
        sentences = build_sentences(segments)
        self.assertEqual(len(sentences), 4)
        self.assertEqual(sentences[0]["text"], "नमस्ते।")
        self.assertEqual(sentences[1]["text"], "धन्यवाद।")
        self.assertEqual(sentences[2]["text"], "こんにちは。")
        self.assertEqual(sentences[3]["text"], "ありがとう。")

    def test_clip_plan_mapping_protocol(self):
        """ClipPlan conforms to collections.abc.Mapping and unpacks into dict seamlessly."""
        plan = ClipPlan(
            clip_id="test_t0010",
            source_video="https://example.com/video",
            start=10.0,
            end=44.0,
            source="heatmap",
            peak_time=25.0,
            peak_value=0.85,
            final_score=0.82,
        )
        as_dict = dict(plan)
        self.assertEqual(as_dict["clip_id"], "test_t0010")
        self.assertEqual(as_dict["duration"], 34.0)

        unpacked = {**plan, "extra_field": "injected"}
        self.assertEqual(unpacked["extra_field"], "injected")
        self.assertEqual(unpacked["clip_id"], "test_t0010")
        self.assertIn("start", plan)
        self.assertEqual(len(plan), len(plan.to_dict()))

    def test_refine_window_requires_peak_payoff(self):
        """H4 refinement rejects proposed windows that miss the peak payoff."""
        sentences = [
            {"start": float(i * 5), "end": float((i + 1) * 5), "text": f"Topic sentence {i}."}
            for i in range(25)  # 0 to 125s
        ]
        peak_time = 85.0
        # LLM proposes sentences 1 to 7 (5.0s to 40.0s) which completely misses peak_time 85.0s
        bad_llm = MockLLM({"start_sentence": 1, "end_sentence": 7, "reason": "Misses peak"})
        s, e, reason, ok = refine_window_with_llm(
            span_start=60.0,
            span_end=110.0,
            bucket_sec=20.0,
            sentences=sentences,
            llm=bad_llm,
            peak_time=peak_time,
            min_len=30.0,
            max_len=39.0,
        )
        self.assertFalse(ok)
        self.assertIsNone(s)

    def test_llm_check_no_false_ignored_adjustment_on_null(self):
        """When LLM check provides null or no start_sentence adjustment, llm_adjustment_ignored is not added."""
        sentences = [
            {"start": float(i * 4), "end": float((i + 1) * 4), "text": f"Sentence {i}."}
            for i in range(15)
        ]
        null_adj_llm = MockLLM({
            "self_contained": True,
            "payoff_included": True,
            "hook_score": 8,
            "start_sentence": None,
            "end_sentence": None,
            "drop": False,
            "reason": "Perfect as-is.",
        })
        res = check_clip_with_llm(8.0, 44.0, 24.0, sentences, null_adj_llm)
        self.assertTrue(res.keep)
        self.assertNotIn("llm_adjustment_ignored", res.warnings)



class TestFullSelectionPipeline(unittest.TestCase):
    def setUp(self):
        # 30 sentences covering 150s (5s per sentence)
        self.segments = [
            {
                "start": float(i * 5),
                "end": float((i + 1) * 5),
                "text": f"Sentence number {i} discussing ideas.",
                "words": [],
            }
            for i in range(30)
        ]

    def test_skip_videos_under_sec(self):
        """Videos shorter than SKIP_VIDEOS_UNDER_SEC return empty list."""
        short_segments = [
            {"start": 0.0, "end": 40.0, "text": "Too short video.", "words": []}
        ]
        plans = run_selection(
            "short_clip.mp4",
            short_segments,
            duration=40.0,
            skip_videos_under_sec=90.0,
        )
        self.assertEqual(plans, [])

    @patch("clipper.selection.select.fetch_heatmap")
    def test_fallback_on_no_heatmap(self, mock_fetch):
        """Acceptance test 9: Low-view video with no heatmap yields source='llm' and warning 'no_heatmap'."""
        mock_fetch.return_value = (None, None)
        with tempfile.TemporaryDirectory() as tmpdir:
            work_dir = pathlib.Path(tmpdir)
            plans = run_selection(
                "https://www.youtube.com/watch?v=lowview1234",
                self.segments,
                duration=150.0,
                work_dir=work_dir,
                clips_per_video=2,
            )

            self.assertGreaterEqual(len(plans), 1)
            for p in plans:
                self.assertEqual(p.source, "llm")
                self.assertIn("no_heatmap", p.warnings)
                self.assertGreaterEqual(p.duration, 30.0)
                self.assertLessEqual(p.duration, 39.0)

    @patch("clipper.selection.select.fetch_heatmap")
    def test_fallback_on_flat_heatmap(self, mock_fetch):
        """Flat heatmap produces warning 'flat_heatmap' and falls back to LLM selection."""
        flat_hm = [{"start_time": i * 3.0, "end_time": (i + 1) * 3.0, "value": 0.50} for i in range(50)]
        mock_fetch.return_value = (flat_hm, 150.0)

        with tempfile.TemporaryDirectory() as tmpdir:
            plans = run_selection(
                "https://www.youtube.com/watch?v=flatvideo12",
                self.segments,
                duration=150.0,
                work_dir=pathlib.Path(tmpdir),
                clips_per_video=2,
            )

            self.assertGreaterEqual(len(plans), 1)
            for p in plans:
                self.assertEqual(p.source, "llm")
                self.assertIn("flat_heatmap", p.warnings)

    @patch("clipper.selection.select.fetch_heatmap")
    def test_successful_heatmap_peak_selection(self, mock_fetch):
        """Active heatmap with clear peaks generates source='heatmap' ClipPlans."""
        hm = [{"start_time": i * 1.5, "end_time": (i + 1) * 1.5, "value": 0.2} for i in range(100)]
        # Peak around index 50 (t = 75s)
        hm[49]["value"] = 0.6
        hm[50]["value"] = 0.92
        hm[51]["value"] = 0.6
        mock_fetch.return_value = (hm, 150.0)

        with tempfile.TemporaryDirectory() as tmpdir:
            plans = run_selection(
                "https://www.youtube.com/watch?v=peakvideo12",
                self.segments,
                duration=150.0,
                work_dir=pathlib.Path(tmpdir),
                clips_per_video=1,
            )

            self.assertEqual(len(plans), 1)
            plan = plans[0]
            self.assertEqual(plan.source, "heatmap")
            self.assertAlmostEqual(plan.peak_time, 75.75, delta=3.0)
            self.assertGreaterEqual(plan.duration, 30.0)
            self.assertLessEqual(plan.duration, 39.0)
            self.assertTrue(plan.start <= plan.peak_time <= plan.end)

    @patch("clipper.selection.select.fetch_heatmap")
    def test_sponsor_dropped_warning_propagated(self, mock_fetch):
        """When a replay peak falls on a sponsor read, it is dropped and sponsor_dropped warning is added."""
        hm = [{"start_time": i * 1.5, "end_time": (i + 1) * 1.5, "value": 0.2} for i in range(100)]
        # Peak 1 at 45s (sponsor), Peak 2 at 105s (clean)
        hm[29]["value"] = 0.65
        hm[30]["value"] = 0.95
        hm[31]["value"] = 0.65

        hm[69]["value"] = 0.60
        hm[70]["value"] = 0.88
        hm[71]["value"] = 0.60
        mock_fetch.return_value = (hm, 150.0)

        # Inject sponsor phrase into the span of Peak 1 (around 45s, sentence index 9)
        sponsor_segments = [dict(s) for s in self.segments]
        sponsor_segments[9]["text"] = "This video is brought to you by our sponsor NordVPN use code CLIPPER."

        with tempfile.TemporaryDirectory() as tmpdir:
            plans = run_selection(
                "https://www.youtube.com/watch?v=sponsorvideo1",
                sponsor_segments,
                duration=150.0,
                work_dir=pathlib.Path(tmpdir),
                clips_per_video=1,
            )

            self.assertEqual(len(plans), 1)
            # The selected clip must be from Peak 2 (~105s), NOT the sponsor peak (~45s)
            self.assertAlmostEqual(plans[0].peak_time, 105.75, delta=3.0)
            self.assertIn("sponsor_dropped", plans[0].warnings)

    def test_concurrent_record_uploaded_video_id(self):
        """Concurrent updates to clips.jsonl do not crash or corrupt file content."""
        import concurrent.futures

        with tempfile.TemporaryDirectory() as tmpdir:
            log_file = pathlib.Path(tmpdir) / "concurrent_clips.jsonl"
            for i in range(20):
                plan = ClipPlan(
                    clip_id=f"clip_{i:02d}",
                    source_video="https://example.com/video",
                    start=float(i * 10),
                    end=float(i * 10 + 35),
                    source="heatmap",
                )
                log_clip_plan(plan, log_path=log_file)

            def update_one(idx: int) -> bool:
                return record_uploaded_video_id(f"clip_{idx:02d}", f"yt_{idx:02d}", log_path=log_file)

            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                results = list(executor.map(update_one, range(20)))

            self.assertTrue(all(results))
            lines = log_file.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 20)
            for idx, line in enumerate(lines):
                entry = json.loads(line)
                self.assertIn("youtube_video_id", entry)



if __name__ == "__main__":
    unittest.main()
