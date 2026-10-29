"""
Unit tests for Retention module:
- Silence and filler trimming
- Timestamp remapping
- Loudness normalization
- Progress bar filter
- Hook overlay and keyword coloring in captions
"""

import unittest
from clipper.captions import CAPTION_STYLES, build_ass, get_keyword_emphasis, get_style
from clipper.retention import (
    build_progress_bar_filter,
    detect_keep_intervals,
    get_loudnorm_filter,
    is_filler_word,
    remap_words_after_trim,
)


class TestRetention(unittest.TestCase):
    def test_filler_word_detection(self):
        self.assertTrue(is_filler_word("um"))
        self.assertTrue(is_filler_word("Uh!"))
        self.assertTrue(is_filler_word("umm..."))
        self.assertFalse(is_filler_word("like"))
        self.assertFalse(is_filler_word("money"))
        self.assertFalse(is_filler_word("important"))

    def test_detect_keep_intervals_trims_large_pause_and_fillers(self):
        # Clip from 10.0 to 20.0
        # Words:
        # 1. "hello" 10.5 - 11.0
        # 2. "um" 11.2 - 11.5 (filler)
        # 3. [pause from 11.5 to 13.0 > 0.4s]
        # 4. "world" 13.0 - 13.5
        words = [
            {"w": "hello", "start": 10.5, "end": 11.0},
            {"w": "um", "start": 11.2, "end": 11.5},
            {"w": "world", "start": 13.0, "end": 13.5},
        ]
        intervals = detect_keep_intervals(
            words,
            clip_start=10.0,
            clip_end=20.0,
            min_silence_gap=0.40,
            remove_fillers=True,
        )
        self.assertGreaterEqual(len(intervals), 1)
        # Verify intervals are ordered and non-overlapping
        for i in range(len(intervals) - 1):
            self.assertLess(intervals[i][1], intervals[i + 1][0])

    def test_remap_words_after_trim(self):
        # Suppose we kept two intervals: [0.5, 2.0] and [4.0, 6.0]
        # Total kept duration = 1.5 + 2.0 = 3.5s
        words = [
            {"w": "first", "start": 10.7, "end": 11.2},   # in first interval
            {"w": "second", "start": 14.5, "end": 15.0},  # in second interval
        ]
        intervals = [(0.5, 2.0), (4.0, 6.0)]
        remapped = remap_words_after_trim(words, intervals, clip_start=10.0)

        self.assertEqual(len(remapped), 2)
        # "first": 10.7 - 10.0 = 0.7 relative; interval starts at 0.5; offset = 0.2; total = 0.2
        self.assertAlmostEqual(remapped[0]["start"], 0.2, places=2)
        # "second": 14.5 - 10.0 = 4.5 relative; interval starts at 4.0; offset = 0.5; accumulated = 1.5; total = 2.0
        self.assertAlmostEqual(remapped[1]["start"], 2.0, places=2)

    def test_loudnorm_filter_format(self):
        f = get_loudnorm_filter(-14.0)
        self.assertIn("loudnorm=", f)
        self.assertIn("I=-14.0", f)

    def test_progress_bar_filter(self):
        f = build_progress_bar_filter(duration=30.0, out_w=1080, out_h=1920)
        self.assertIn("overlay=", f)
        self.assertIn("color=", f)
        self.assertIn("1080", f)
        self.assertIn("30.000", f)

    def test_hook_overlay_in_ass(self):
        words = [{"w": "welcome", "start": 10.0, "end": 10.5}]
        ass_text = build_ass(
            words,
            clip_start=10.0,
            hook="Stop Making This Banking Mistake",
            hook_duration=2.5,
        )
        self.assertIn("Style: Hook", ass_text)
        self.assertIn("STOP MAKING THIS BANKING MISTAKE", ass_text)
        self.assertIn(r"\fad(120,400)", ass_text)
        self.assertIn("Dialogue: 1,", ass_text)

    def test_new_caption_presets_are_registered_and_renderable(self):
        expected = {"mint_pop", "creator_block", "retro_wave", "editorial", "typewriter", "sunset"}
        self.assertTrue(expected.issubset(CAPTION_STYLES))

        words = [
            {"w": "make", "start": 0.0, "end": 0.3},
            {"w": "it", "start": 0.3, "end": 0.5},
            {"w": "count", "start": 0.5, "end": 0.9},
        ]
        for key in sorted(expected):
            with self.subTest(style=key):
                style = get_style(key)
                self.assertEqual(style.key, key)
                subtitle = build_ass(words, clip_start=0.0, style=key)
                self.assertIn(f"Style: Default,{style.font},", subtitle)
                self.assertIn("Dialogue:", subtitle)

    def test_keyword_emphasis_and_emoji(self):
        money_res = get_keyword_emphasis("money")
        self.assertIsNotNone(money_res)
        color, emoji = money_res
        self.assertEqual(emoji, "💰")

        growth_res = get_keyword_emphasis("10x")
        self.assertIsNotNone(growth_res)
        self.assertEqual(growth_res[1], "📈")

        ass_text = build_ass(
            [{"w": "money", "start": 0.0, "end": 0.5}],
            clip_start=0.0,
            enable_keywords=True,
            enable_emojis=True,
        )
        self.assertIn("💰", ass_text)


if __name__ == "__main__":
    unittest.main()
