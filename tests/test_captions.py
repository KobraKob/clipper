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

    WORDS = [
        {"w": "Never", "start": 10.0, "end": 10.4},
        {"w": "make", "start": 10.4, "end": 10.7},
        {"w": "this", "start": 10.7, "end": 11.0},
        {"w": "mistake", "start": 11.0, "end": 11.6},
    ]

    def test_every_style_builds(self):
        from clipper.captions import CAPTION_STYLES

        for key in CAPTION_STYLES:
            out = build_ass(self.WORDS, clip_start=10.0, style=key)
            self.assertIn("Dialogue:", out, key)

    def test_highlight_emits_one_event_per_word_with_pop(self):
        out = build_ass(self.WORDS, clip_start=10.0, style="bold_pop", group_size=4)
        events = [l for l in out.splitlines() if l.startswith("Dialogue")]
        self.assertEqual(len(events), 4)
        self.assertIn("\\t(", events[0])  # pop transform
        self.assertIn("NEVER", events[0])
        self.assertTrue(events[0].startswith("Dialogue: 0,0:00:00.00,"))

    def test_single_word_mode(self):
        out = build_ass(self.WORDS, clip_start=10.0, style="one_word")
        events = [l for l in out.splitlines() if l.startswith("Dialogue")]
        self.assertEqual(len(events), 4)
        self.assertNotIn("MAKE THIS", events[1])

    def test_karaoke_fill_tags(self):
        out = build_ass(self.WORDS, clip_start=10.0, style="karaoke")
        self.assertIn("\\kf40}NEVER", out)

    def test_unknown_style_and_position(self):
        from clipper.captions import get_style

        with self.assertRaises(ValueError):
            get_style("nope")
        with self.assertRaises(ValueError):
            get_style("bold_pop", "sideways")
        self.assertEqual(get_style("bold_pop", "top").position, "top")

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
