"""
Integration test for the complete pipeline execution using synthetic video fixtures.
"""

import json
import pathlib
import shutil
import subprocess
import unittest
from typing import Any, Dict

from clipper.config import Settings
from clipper.pipeline import run_pipeline


class MockPipelineTranscriber:
    def transcribe(self, wav: pathlib.Path, work_dir: pathlib.Path) -> Dict[str, Any]:
        # Return 2 segments of 3 seconds each (total 6 seconds)
        return {
            "language": "en",
            "segments": [
                {
                    "start": 0.0,
                    "end": 3.0,
                    "text": "Why you should never ignore this crucial strategy.",
                    "words": [
                        {"w": "Why", "start": 0.0, "end": 0.3},
                        {"w": "you", "start": 0.3, "end": 0.6},
                        {"w": "should", "start": 0.6, "end": 0.9},
                        {"w": "never", "start": 0.9, "end": 1.4},
                        {"w": "ignore", "start": 1.4, "end": 2.0},
                        {"w": "this", "start": 2.0, "end": 2.3},
                        {"w": "crucial", "start": 2.3, "end": 2.7},
                        {"w": "strategy", "start": 2.7, "end": 3.0},
                    ],
                },
                {
                    "start": 3.0,
                    "end": 6.0,
                    "text": "Because it doubles your overall reach completely.",
                    "words": [
                        {"w": "Because", "start": 3.0, "end": 3.5},
                        {"w": "it", "start": 3.5, "end": 3.8},
                        {"w": "doubles", "start": 3.8, "end": 4.3},
                        {"w": "your", "start": 4.3, "end": 4.6},
                        {"w": "overall", "start": 4.6, "end": 5.1},
                        {"w": "reach", "start": 5.1, "end": 5.5},
                        {"w": "completely", "start": 5.5, "end": 6.0},
                    ],
                },
            ],
        }


class MockPipelineLLM:
    def __init__(self):
        self.tokens_used = 120

    def complete_json(self, prompt: str, tier: str = "strong") -> Dict[str, Any]:
        if tier == "fast":
            return {"scores": [{"id": 0, "score": 95}]}
        return {
            "score": 96,
            "hook": "Why you should never ignore this strategy",
            "title": "Double Your Reach",
            "reason": "Compelling hook with concrete actionable promise.",
        }


class TestPipelineIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_dir = pathlib.Path("tests_workdir")
        cls.test_dir.mkdir(parents=True, exist_ok=True)
        cls.test_video = cls.test_dir / "synthetic_fixture.mp4"

        # Generate a 6-second synthetic 640x360 test video with audio
        cmd = [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=6:size=640x360:rate=15",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=6",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-c:a",
            "aac",
            str(cls.test_video),
        ]
        subprocess.run(cmd, capture_output=True, check=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.test_dir, ignore_errors=True)
        shutil.rmtree("tests_outputs", ignore_errors=True)

    def test_run_pipeline_end_to_end(self):
        work_dir = self.test_dir / "work"
        out_dir = pathlib.Path("tests_outputs")

        # Custom settings matching the 6-second fixture window
        test_settings = Settings(
            min_clip_duration=3,
            max_clip_duration=6,
            shortlist=3,
        )

        manifest = run_pipeline(
            source=str(self.test_video),
            n_clips=1,
            vertical=True,
            captions=True,
            work_dir=work_dir,
            output_dir=out_dir,
            app_settings=test_settings,
            transcriber=MockPipelineTranscriber(),
            llm=MockPipelineLLM(),
        )

        self.assertEqual(manifest["clips_exported"], 1)
        clips = manifest["clips"]
        self.assertEqual(len(clips), 1)
        clip_info = clips[0]

        self.assertGreaterEqual(clip_info["score"], 0)
        self.assertLessEqual(clip_info["score"], 100)
        self.assertIn("score_breakdown", clip_info)
        self.assertEqual(clip_info["score_breakdown"]["final"], clip_info["score"])
        title = clip_info["title"].lower()
        self.assertTrue(title)
        self.assertTrue(any(term in title for term in ("never", "ignore", "strategy", "reach")))
        final_file = pathlib.Path(clip_info["file"])

        self.assertTrue(final_file.exists())
        self.assertGreater(final_file.stat().st_size, 1000)

        # Check metadata.json existence
        meta_json = out_dir / "metadata.json"
        self.assertTrue(meta_json.exists())
        loaded_meta = json.loads(meta_json.read_text(encoding="utf-8"))
        self.assertEqual(loaded_meta["job_id"], manifest["job_id"])


if __name__ == "__main__":
    unittest.main()
