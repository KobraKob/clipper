"""
Unit tests for Cover Frame extraction, Title A/B variants, Posting Queue, and Analytics loop.
"""

import json
import pathlib
import subprocess
import tempfile
import unittest
import numpy as np

from clipper.cover import calculate_frame_sharpness, generate_thumbnail_options
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

    def test_generate_thumbnail_options_creates_three_distinct_safe_thumbnails(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = pathlib.Path(tmp_dir)
            video_path = tmp_path / "sample.mp4"
            cover_path = tmp_path / "01_sample_cover.jpg"

            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc=duration=4:size=360x640:rate=15",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    str(video_path),
                ],
                capture_output=True,
                check=True,
            )

            bundle = generate_thumbnail_options(
                video_path,
                cover_path,
                title="Why Inflation Eats Your Savings",
                hook="Never leave all your cash in one account",
                text="Never keep all your savings in one account because inflation quietly eats savings every year.",
                keywords=["savings", "inflation", "checking account"],
            )

            self.assertEqual(bundle["selected_option"], "option_a")
            self.assertTrue(cover_path.exists())
            self.assertGreater(cover_path.stat().st_size, 100)
            options = bundle["options"]
            self.assertEqual(len(options), 3)
            self.assertEqual([o["id"] for o in options], ["option_a", "option_b", "option_c"])
            self.assertEqual(
                [o["concept"] for o in options],
                ["emotion_result", "contrast_stakes", "clean_focal_proof"],
            )
            for opt in options:
                opt_file = pathlib.Path(opt["file"])
                self.assertTrue(opt_file.exists())
                self.assertGreater(opt_file.stat().st_size, 100)
                self.assertLessEqual(len(opt["hook_text"].split()), 4)
                self.assertNotIn(opt["hook_text"].lower(), "why inflation eats your savings")
                self.assertTrue(opt["safe_zones"]["bottom_right_clear"])
                self.assertTrue(opt["safe_zones"]["center_safe_crop"])

    def test_generate_thumbnail_options_landscape_stays_center_safe(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = pathlib.Path(tmp_dir)
            video_path = tmp_path / "landscape.mp4"
            cover_path = tmp_path / "01_land_cover.jpg"

            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc=duration=3:size=640x360:rate=15",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    str(video_path),
                ],
                capture_output=True,
                check=True,
            )

            bundle = generate_thumbnail_options(
                video_path,
                cover_path,
                title="Why Inflation Eats Your Savings",
                hook="Never leave all your cash in one account",
                text="Inflation quietly eats savings every year.",
                keywords=["savings", "inflation"],
            )
            self.assertEqual(len(bundle["options"]), 3)
            for opt in bundle["options"]:
                self.assertTrue(opt["safe_zones"]["center_safe_crop"])
                self.assertTrue(pathlib.Path(opt["file"]).exists())


if __name__ == "__main__":
    unittest.main()
