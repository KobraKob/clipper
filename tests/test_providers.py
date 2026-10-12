"""
Unit tests for provider interfaces, JSON parsing, retries, and fallback LLM.
"""

import unittest
from typing import Any, Dict
from clipper.providers.base import parse_json
from clipper.providers.retry import with_retry
from clipper.providers import FallbackLLM, get_llm, get_transcriber
from clipper.config import Settings


class DummyLLM:
    def __init__(self, should_fail: bool = False, response: Dict[str, Any] = None):
        self.should_fail = should_fail
        self.response = response or {"score": 85, "title": "Dummy"}

    def complete_json(self, prompt: str, tier: str = "strong") -> Dict[str, Any]:
        if self.should_fail:
            raise RuntimeError("Primary provider connection failed.")
        return self.response


class TestProviders(unittest.TestCase):
    def test_parse_json_standard(self):
        raw = '{"scores": [{"id": 0, "score": 75}]}'
        res = parse_json(raw)
        self.assertEqual(res["scores"][0]["score"], 75)

    def test_parse_json_markdown_fences(self):
        raw = """```json
        {
            "score": 90,
            "title": "Clean Clip"
        }
        ```"""
        res = parse_json(raw)
        self.assertEqual(res["score"], 90)
        self.assertEqual(res["title"], "Clean Clip")

    def test_parse_json_with_surrounding_chatter(self):
        raw = 'Here is the JSON evaluation you requested:\n{"score": 88, "hook": "Look here"}\nHope this helps!'
        res = parse_json(raw)
        self.assertEqual(res["score"], 88)
        self.assertEqual(res["hook"], "Look here")

    def test_parse_json_invalid(self):
        with self.assertRaises(ValueError):
            parse_json("Not a json at all")

    def test_fallback_llm_primary_success(self):
        primary = DummyLLM(should_fail=False, response={"score": 95, "title": "Primary"})
        backup = DummyLLM(should_fail=False, response={"score": 50, "title": "Backup"})
        fallback = FallbackLLM(primary=primary, backup=backup)
        out = fallback.complete_json("test prompt")
        self.assertEqual(out["title"], "Primary")

    def test_fallback_llm_primary_failure(self):
        primary = DummyLLM(should_fail=True)
        backup = DummyLLM(should_fail=False, response={"score": 77, "title": "Backup"})
        fallback = FallbackLLM(primary=primary, backup=backup)
        out = fallback.complete_json("test prompt")
        self.assertEqual(out["title"], "Backup")

    def test_fallback_transcriber_primary_success(self):
        from clipper.providers import FallbackTranscriber
        import pathlib

        class DummyTranscriber:
            def __init__(self, should_fail=False, label="primary"):
                self.should_fail = should_fail
                self.label = label
            def transcribe(self, wav, work_dir, **kwargs):
                if self.should_fail:
                    raise RuntimeError("STT failed")
                return {"language": "en", "segments": [{"text": self.label, "start": 0, "end": 1, "words": []}]}

        primary = DummyTranscriber(should_fail=False, label="primary")
        backup = DummyTranscriber(should_fail=False, label="backup")
        fallback = FallbackTranscriber(primary=primary, backup=backup)
        res = fallback.transcribe(pathlib.Path("fake.wav"), pathlib.Path("fake_dir"))
        self.assertEqual(res["segments"][0]["text"], "primary")

    def test_fallback_transcriber_primary_failure(self):
        from clipper.providers import FallbackTranscriber
        import pathlib

        class DummyTranscriber:
            def __init__(self, should_fail=False, label="primary"):
                self.should_fail = should_fail
                self.label = label
            def transcribe(self, wav, work_dir, **kwargs):
                if self.should_fail:
                    raise RuntimeError("STT failed")
                return {"language": "en", "segments": [{"text": self.label, "start": 0, "end": 1, "words": []}]}

        primary = DummyTranscriber(should_fail=True)
        backup = DummyTranscriber(should_fail=False, label="backup")
        fallback = FallbackTranscriber(primary=primary, backup=backup)
        res = fallback.transcribe(pathlib.Path("fake.wav"), pathlib.Path("fake_dir"))
        self.assertEqual(res["segments"][0]["text"], "backup")

    def test_retry_success_after_failure(self):
        attempts = 0

        def flaky_call():
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise ConnectionError("Temporary blip")
            return "success"

        res = with_retry(flaky_call, retries=4, base=1.1, retry_on=(ConnectionError,))
        self.assertEqual(res, "success")
        self.assertEqual(attempts, 3)

    def test_unknown_provider_raises(self):
        invalid_settings = Settings.create_custom(provider="non_existent_provider")
        with self.assertRaises(ValueError):
            get_transcriber(invalid_settings)
        with self.assertRaises(ValueError):
            get_llm(invalid_settings)


if __name__ == "__main__":
    unittest.main()
