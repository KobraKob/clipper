"""
Unit tests for OpenRouter provider integration, retries, and chained fallback.
"""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch
from typing import Any, Dict

from clipper.config import Settings
from clipper.providers import ChainedFallbackLLM, FallbackLLM, get_llm, get_transcriber
from clipper.providers.openrouter import OpenRouterLLM, OpenRouterRetryableError


class TestOpenRouter(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = Settings(
            openrouter_api_key="test-key-12345",
            openrouter_model="nvidia/nemotron-3-ultra-550b-a55b",
            openrouter_base_url="https://openrouter.ai/api/v1",
        )

    def test_missing_api_key_raises(self) -> None:
        empty_settings = Settings(openrouter_api_key="")
        with patch.dict("os.environ", {"OPENROUTER_API_KEY": ""}, clear=False):
            with self.assertRaises(ValueError):
                OpenRouterLLM(empty_settings)

    @patch("requests.post")
    def test_complete_json_success(self, mock_post: MagicMock) -> None:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "id": "gen-test-1",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": '{"score": 95, "hook": "Check this hook", "title": "Top Clip"}',
                    }
                }
            ],
            "usage": {"prompt_tokens": 15, "completion_tokens": 25, "total_tokens": 40},
        }
        mock_post.return_value = mock_resp

        llm = OpenRouterLLM(self.settings)
        result = llm.complete_json("Evaluate clip transcript")

        self.assertEqual(result["score"], 95)
        self.assertEqual(result["hook"], "Check this hook")
        self.assertEqual(result["title"], "Top Clip")
        self.assertEqual(llm.tokens_used, 40)

        # Verify call arguments
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(args[0], "https://openrouter.ai/api/v1/chat/completions")
        self.assertIn("Authorization", kwargs["headers"])
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer test-key-12345")
        self.assertEqual(kwargs["json"]["model"], "nvidia/nemotron-3-ultra-550b-a55b")
        self.assertEqual(kwargs["json"]["response_format"], {"type": "json_object"})

    @patch("requests.post")
    def test_retry_on_transient_error(self, mock_post: MagicMock) -> None:
        mock_err_resp = MagicMock()
        mock_err_resp.status_code = 429
        mock_err_resp.text = "Rate limit exceeded"
        mock_err_resp.json.return_value = {"error": {"code": 429, "message": "Rate limit exceeded"}}

        mock_ok_resp = MagicMock()
        mock_ok_resp.status_code = 200
        mock_ok_resp.json.return_value = {
            "choices": [{"message": {"content": '{"status": "recovered"}'}}],
            "usage": {"total_tokens": 10},
        }

        mock_post.side_effect = [mock_err_resp, mock_ok_resp]

        llm = OpenRouterLLM(self.settings)
        with patch("time.sleep"):  # Avoid delay in test
            res = llm.complete_json("Retry prompt")

        self.assertEqual(res["status"], "recovered")
        self.assertEqual(mock_post.call_count, 2)

    @patch("requests.post")
    def test_fatal_http_error_does_not_retry_endlessly(self, mock_post: MagicMock) -> None:
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.text = "Unauthorized"
        mock_resp.json.return_value = {"error": {"message": "Invalid API Key"}}
        mock_post.return_value = mock_resp

        llm = OpenRouterLLM(self.settings)
        with self.assertRaises(RuntimeError) as ctx:
            llm.complete_json("Test prompt")

        self.assertIn("401", str(ctx.exception))
        # Non-retryable error should fail immediately on attempt 1
        self.assertEqual(mock_post.call_count, 1)

    def test_chained_fallback_groq_to_openrouter(self) -> None:
        class FailingLLM:
            def complete_json(self, prompt: str, tier: str = "strong") -> Dict[str, Any]:
                raise RuntimeError("Groq quota exceeded (429)")

        class SuccessLLM:
            def __init__(self) -> None:
                self.tokens_used = 25
            def complete_json(self, prompt: str, tier: str = "strong") -> Dict[str, Any]:
                return {"score": 88, "provider": "openrouter"}

        chain = ChainedFallbackLLM([
            ("groq", FailingLLM()),
            ("openrouter", SuccessLLM()),
        ])

        result = chain.complete_json("Evaluate candidates")
        self.assertEqual(result["score"], 88)
        self.assertEqual(result["provider"], "openrouter")
        self.assertEqual(chain.tokens_used, 25)

    def test_chained_fallback_all_fail_raises(self) -> None:
        class FailingLLM:
            def complete_json(self, prompt: str, tier: str = "strong") -> Dict[str, Any]:
                raise ConnectionError("Service unreachable")

        chain = ChainedFallbackLLM([
            ("groq", FailingLLM()),
            ("openrouter", FailingLLM()),
        ])

        with self.assertRaises(ConnectionError):
            chain.complete_json("Evaluate")

    @patch("clipper.providers.openrouter.OpenRouterLLM")
    @patch("clipper.providers.groq_provider.GroqLLM")
    def test_get_llm_factory_groq_with_openrouter_fallback(
        self, mock_groq_cls: MagicMock, mock_or_cls: MagicMock
    ) -> None:
        mock_groq = MagicMock()
        mock_or = MagicMock()
        mock_groq_cls.return_value = mock_groq
        mock_or_cls.return_value = mock_or

        s = Settings(
            llm_provider="groq",
            groq_api_key="mock-groq-key",
            openrouter_api_key="mock-openrouter-key",
            fallback_to_local=False,
        )

        llm = get_llm(s)
        self.assertIsInstance(llm, ChainedFallbackLLM)
        names = [name for name, _ in llm.chain]
        self.assertEqual(names, ["groq", "openrouter"])

    @patch("clipper.providers.openrouter.OpenRouterLLM")
    @patch("clipper.providers.groq_provider.GroqLLM")
    def test_get_llm_factory_openrouter_primary(
        self, mock_groq_cls: MagicMock, mock_or_cls: MagicMock
    ) -> None:
        mock_groq = MagicMock()
        mock_or = MagicMock()
        mock_groq_cls.return_value = mock_groq
        mock_or_cls.return_value = mock_or

        s = Settings(
            llm_provider="openrouter",
            openrouter_api_key="mock-openrouter-key",
            groq_api_key="mock-groq-key",
            fallback_to_local=False,
        )

        llm = get_llm(s)
        self.assertIsInstance(llm, ChainedFallbackLLM)
        names = [name for name, _ in llm.chain]
        self.assertEqual(names, ["openrouter", "groq"])

    @patch("clipper.providers.groq_provider.GroqTranscriber")
    def test_get_transcriber_openrouter_delegates_to_groq_when_key_present(
        self, mock_groq_stt: MagicMock
    ) -> None:
        mock_instance = MagicMock()
        mock_groq_stt.return_value = mock_instance

        s = Settings(
            stt_provider="openrouter",
            groq_api_key="valid-groq-key",
            fallback_to_local=False,
        )
        t = get_transcriber(s)
        self.assertEqual(t, mock_instance)


if __name__ == "__main__":
    unittest.main()
