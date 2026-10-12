"""
Unit tests for Cover Frame extraction, Title A/B variants, Posting Queue, and Analytics loop.
"""

import json
import pathlib
import tempfile
import unittest
import numpy as np

from clipper.cover import calculate_frame_sharpness
from clipper.distribution import (
    format_top_hooks_prompt_context,
    list_scheduled_queue,
    schedule_clip_post,
)
from clipper.reframe import build_split_screen_graph
from clipper.seo import fallback_metadata, generate_metadata


class TestCoverAndDistribution(unittest.TestCase):
    def test_sharpness_calculation(self):
        # Plain flat image should have near-zero Laplacian variance
        flat = np.zeros((100, 100), dtype=np.uint8)
        flat_sharpness = calculate_frame_sharpness(flat)
        self.assertEqual(flat_sharpness, 0.0)

        # High frequency noise/edges has higher sharpness
        noisy = np.random.randint(0, 255, (100, 100), dtype=np.uint8)
        noisy_sharpness = calculate_frame_sharpness(noisy)
        self.assertGreater(noisy_sharpness, 10.0)

    def test_title_variants_generation(self):
        clip = {"title": "Passive Income", "hook": "Start earning today"}
        meta = fallback_metadata(clip, "investing into index funds gives you passive income")
        self.assertIn("title_variants", meta)
        variants = meta["title_variants"]
        self.assertEqual(len(variants), 3)
        angles = {v["angle"] for v in variants}
        self.assertIn("Curiosity Gap", angles)
        self.assertIn("Direct Impact", angles)
        self.assertIn("Bold Question", angles)

    def test_schedule_clip_post(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            manifest_file = pathlib.Path(tmp_dir) / "metadata.json"
            data = {
                "job_id": "job_test",
                "clips": [{"rank": 1, "title": "Clip 1", "file": "clip_1.mp4"}],
            }
            manifest_file.write_text(json.dumps(data), encoding="utf-8")

            res = schedule_clip_post(
                manifest_file,
                rank=1,
                platform="youtube",
                scheduled_at_iso="2026-10-15T18:00:00Z",
            )
            self.assertEqual(res["schedule"]["status"], "scheduled")

            # Check queue discovery
            queue = list_scheduled_queue(pathlib.Path(tmp_dir))
            self.assertEqual(len(queue), 1)
            self.assertEqual(queue[0]["rank"], 1)

    def test_top_hooks_prompt_formatting(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            manifest_file = pathlib.Path(tmp_dir) / "metadata.json"
            data = {
                "job_id": "job_1",
                "clips": [
                    {
                        "rank": 1,
                        "hook": "Never leave money in checking",
                        "analytics": {"view_count": 50000, "like_count": 2300, "video_id": "abc"},
                    }
                ],
            }
            manifest_file.write_text(json.dumps(data), encoding="utf-8")

            ctx = format_top_hooks_prompt_context(pathlib.Path(tmp_dir))
            self.assertIn("Never leave money in checking", ctx)
            self.assertIn("50,000 views", ctx)

    def test_split_screen_filter_graph(self):
        graph = build_split_screen_graph(
            src_w=1920,
            src_h=1080,
            out_w=1080,
            out_h=1920,
            speaker1_x=450.0,
            speaker2_x=1400.0,
        )
        self.assertIn("vstack=inputs=2", graph)
        self.assertIn("split=2[topsrc][botsrc]", graph)
        self.assertIn("scale=1080:960", graph)


if __name__ == "__main__":
    unittest.main()
