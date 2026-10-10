"""
Unit tests for ASS subtitle formatting, karaoke tags, and FFmpeg filter path escaping.
"""

import pathlib
import unittest
from clipper.captions import (
    build_ass,
    escape_ffmpeg_filter_path,
    format_ass_time,
)


class TestCaptions(unittest.TestCase):
    def test_format_ass_time_boundaries(self):
        self.assertEqual(format_ass_time(0.0), "0:00:00.00")
        self.assertEqual(format_ass_time(5.5), "0:00:05.50")
        self.assertEqual(format_ass_time(65.25), "0:01:05.25")
        self.assertEqual(format_ass_time(3665.99), "1:01:05.99")

    def test_build_ass_empty(self):
        content = build_ass([], clip_start=0.0)
        self.assertIn("[Script Info]", content)
        self.assertIn("[V4+ Styles]", content)
        self.assertIn("[Events]", content)

    def test_build_ass_karaoke_events(self):
        words = [
            {"w": "Never", "start": 10.0, "end": 10.4},
            {"w": "make", "start": 10.4, "end": 10.7},
            {"w": "this", "start": 10.7, "end": 11.0},
            {"w": "mistake", "start": 11.0, "end": 11.6},
        ]
        # Shifted by clip_start=10.0
        ass_str = build_ass(words, clip_start=10.0, group_size=4)
        self.assertIn("Dialogue: 0,0:00:00.00,0:00:01.60", ass_str)
        self.assertIn(r"{\k40}NEVER", ass_str)
        self.assertIn(r"{\k30}MAKE", ass_str)
        self.assertIn(r"{\k30}THIS", ass_str)
        self.assertIn(r"{\k60}MISTAKE", ass_str)

    def test_escape_ffmpeg_filter_path(self):
        p = pathlib.Path("C:/Users/test/clip.ass")
        escaped = escape_ffmpeg_filter_path(p)
        # Should have colon escaped and forward slashes for path separators
        self.assertIn(r"\:", escaped)
        # Verify no unescaped backslashes outside the colon escape
        cleaned_no_colon_escape = escaped.replace(r"\:", "")
        self.assertNotIn("\\", cleaned_no_colon_escape)


if __name__ == "__main__":
    unittest.main()
