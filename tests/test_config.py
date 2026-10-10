"""
Unit tests for configuration loading and custom settings instantiation.
"""

import unittest
from clipper.config import Settings


class TestConfig(unittest.TestCase):
    def test_default_settings(self):
        s = Settings()
        self.assertIn(s.provider, ["local", "groq"])
        self.assertGreater(s.shortlist, 0)
        self.assertGreater(s.min_clip_duration, 0)
        self.assertGreater(s.max_clip_duration, s.min_clip_duration)

    def test_custom_settings_override(self):
        s = Settings.create_custom(
            provider="groq",
            shortlist=15,
            fallback_to_local=True,
        )
        self.assertEqual(s.provider, "groq")
        self.assertEqual(s.stt_provider, "groq")
        self.assertEqual(s.llm_provider, "groq")
        self.assertEqual(s.shortlist, 15)
        self.assertTrue(s.fallback_to_local)

    def test_stage_specific_overrides(self):
        s = Settings.create_custom(
            provider="local",
            stt_provider="groq",
            llm_provider="local",
        )
        self.assertEqual(s.stt_provider, "groq")
        self.assertEqual(s.llm_provider, "local")


if __name__ == "__main__":
    unittest.main()
