"""Comprehensive acceptance and unit tests for the SEO Metadata Engine.

Covers Section 9 of SEO_METADATA_LOGIC.md:
1. Unit: each source function with mocked HTTP; validator with deliberately bad inputs.
2. Offline end-to-end: pipeline schema validation; exactly 30 unique tags (10/10/10).
3. Live/mock smoke test across 5 niches (gaming, tech, education, news, lifestyle).
4. Degradation test: disable search keys & YouTube key -> valid metadata with warnings.
5. Quota test: simulate quota consumption -> unit counter stops YouTube search at budget.
6. Edge cases: empty inputs, unicode hashtags, cache hit/expiry, spam tag filtering.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from seo.cache import SEOCache
from seo.config import SEOConfig
from seo.pipeline import SEOPipeline, run_seo_pipeline
from seo.providers.ddgs_provider import DDGSSearchProvider
from seo.providers.exa import ExaSearchProvider
from seo.providers.firecrawl import FirecrawlSearchProvider
from seo.providers.serper import SerperSearchProvider
from seo.providers.tavily import TavilySearchProvider
from seo.quota import (
    COST_SEARCH_LIST,
    COST_VIDEOS_LIST,
    YouTubeQuotaTracker,
)
from seo.sources.autocomplete import collect_autocomplete, yt_autocomplete
from seo.sources.trends_rss import trending_now
from seo.sources.web import WebSearchManager
from seo.sources.youtube_api import yt_most_popular, yt_top_recent
from seo.stages.s3_hashtags import build_hashtag_pool, normalize_tag
from seo.stages.s5_validate import repair_and_sanitize, validate_draft


class FakeResponse:
    def __init__(self, data, status_code=200, text=""):
        self._data = data
        self.status_code = status_code
        self.text = text or (json.dumps(data) if isinstance(data, (dict, list)) else str(data))

    def json(self):
        if isinstance(self._data, Exception):
            raise self._data
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests
            raise requests.HTTPError(f"HTTP {self.status_code}: {self.text}")


class FakeLLM:
    def __init__(self, payload=None, fail=False):
        self.payload = payload or {}
        self.fail = fail

    def complete_json(self, prompt: str, tier: str = "strong"):
        if self.fail:
            raise RuntimeError("LLM unavailable")
        return self.payload


class TestSEOSources(unittest.TestCase):
    """1. Unit tests for each data source with mocked HTTP."""

    @patch("requests.get")
    def test_yt_autocomplete_success(self, mock_get):
        mock_get.return_value = FakeResponse(["query", ["saving money fast", "saving money tips"]])
        suggs = yt_autocomplete("saving money")
        self.assertEqual(len(suggs), 2)
        self.assertEqual(suggs[0], "saving money fast")

    @patch("requests.get")
    def test_yt_autocomplete_error_handling(self, mock_get):
        mock_get.side_effect = RuntimeError("network down")
        suggs = yt_autocomplete("saving money")
        self.assertEqual(suggs, [])

    @patch("requests.get")
    def test_collect_autocomplete_call_budget(self, mock_get):
        mock_get.return_value = FakeResponse(["q", ["suggestion 1", "suggestion 2"]])
        results = collect_autocomplete(["money", "investing"], max_total_calls=5)
        # Should make at most 5 calls
        self.assertLessEqual(len(results), 5)
        self.assertTrue(all("suggestions" in r for r in results))

    @patch("requests.get")
    def test_trends_rss_parsing(self, mock_get):
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0" xmlns:ht="https://trends.google.com/trends/trendingsearches/daily">
            <channel>
                <item>
                    <title>Stock Market Surge</title>
                    <ht:approx_traffic>500K+</ht:approx_traffic>
                </item>
                <item>
                    <title>AI Breakthrough</title>
                    <ht:approx_traffic>200K+</ht:approx_traffic>
                </item>
            </channel>
        </rss>
        """
        mock_get.return_value = FakeResponse(None, status_code=200, text=xml_content)
        items = trending_now(geo="IN")
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["query"], "Stock Market Surge")
        self.assertEqual(items[0]["traffic"], "500K+")

    @patch("requests.get")
    def test_youtube_top_recent_and_quota_consumption(self, mock_get):
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
            db_path = tf.name

        try:
            quota = YouTubeQuotaTracker(db_path=db_path)
            # Mock search response then videos response
            search_data = {
                "items": [{"id": {"videoId": "v1"}}, {"id": {"videoId": "v2"}}]
            }
            videos_data = {
                "items": [
                    {
                        "snippet": {"title": "Best tips #Money #Finance", "tags": ["money", "cash"], "publishedAt": "2026-11-01T00:00:00Z"},
                        "statistics": {"viewCount": "120000"},
                    }
                ]
            }
            mock_get.side_effect = [FakeResponse(search_data), FakeResponse(videos_data)]

            videos, warn = yt_top_recent(
                api_key="valid_key",
                q="money tips",
                quota_tracker=quota,
                daily_budget=1000,
            )
            self.assertIsNone(warn)
            self.assertEqual(len(videos), 1)
            self.assertEqual(videos[0]["views"], 120000)
            self.assertIn("#money", videos[0]["hashtags"])
            # Verified quota consumed: 100 for search + 1 for videos = 101 units
            self.assertEqual(quota.get_used(), COST_SEARCH_LIST + COST_VIDEOS_LIST)
        finally:
            if os.path.exists(db_path):
                os.remove(db_path)

    @patch("requests.get")
    def test_youtube_most_popular_video_chart_not_found(self, mock_get):
        # 400 videoChartNotFound should be gracefully skipped without failing
        mock_get.return_value = FakeResponse(None, status_code=400, text="videoChartNotFound for this category")
        titles, warn = yt_most_popular(api_key="valid_key", region="IN", category_id="9999")
        self.assertEqual(titles, [])
        self.assertIsNone(warn)

    @patch("requests.post")
    def test_tavily_provider(self, mock_post):
        mock_post.return_value = FakeResponse({
            "results": [{"title": "News Title", "url": "https://example.com/1", "content": "Sample content snippet"}]
        })
        p = TavilySearchProvider(api_key="tvly_test")
        res = p.search("query")
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["title"], "News Title")
        self.assertEqual(res[0]["snippet"], "Sample content snippet")

    @patch("requests.post")
    def test_firecrawl_provider(self, mock_post):
        mock_post.return_value = FakeResponse({
            "data": [{"title": "FC Title", "url": "https://fc.example/1", "description": "FC snippet"}]
        })
        p = FirecrawlSearchProvider(api_key="fc_test")
        res = p.search("query")
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["title"], "FC Title")

    @patch("requests.post")
    def test_exa_provider(self, mock_post):
        mock_post.return_value = FakeResponse({
            "results": [{"title": "Exa Title", "url": "https://exa.ai/1", "text": "Exa snippet"}]
        })
        p = ExaSearchProvider(api_key="exa_test")
        res = p.search("query")
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["title"], "Exa Title")

    @patch("requests.post")
    def test_serper_provider(self, mock_post):
        mock_post.return_value = FakeResponse({
            "organic": [{"title": "Serper Title", "link": "https://google.com/1", "snippet": "Serper snippet"}]
        })
        p = SerperSearchProvider(api_key="serper_test")
        res = p.search("query")
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["title"], "Serper Title")


class TestValidatorDeliberateFailures(unittest.TestCase):
    """1b. Validator with deliberately bad inputs."""

    def setUp(self):
        self.valid_pool = {
            "topic": [{"tag": f"#topic_{i}"} for i in range(1, 11)],
            "trending": [{"tag": f"#trend_{i}"} for i in range(1, 11)],
            "adjacent": [{"tag": f"#adj_{i}"} for i in range(1, 11)],
        }
        self.valid_yt = ["#topic_1", "#topic_2", "#trend_1"]
        self.valid_hidden = ["topic", "trend", "money", "tips"]

    def test_sixteen_youtube_hashtags_fails(self):
        bad_yt_tags = [f"#tag_{i}" for i in range(16)]
        errors = validate_draft(
            draft_title="Valid Title With Keyword Savings",
            draft_description_body="Savings insight summary here.",
            hashtag_pool=self.valid_pool,
            primary_keyword="savings",
            selected_yt_hashtags=bad_yt_tags,
            hidden_tags=self.valid_hidden,
        )
        self.assertTrue(any("exceeds hard limit of 15" in err for err in errors))

    def test_one_hundred_and_one_char_title_fails(self):
        bad_title = "A" * 101
        errors = validate_draft(
            draft_title=bad_title,
            draft_description_body="Savings insight summary here.",
            hashtag_pool=self.valid_pool,
            primary_keyword="savings",
            selected_yt_hashtags=self.valid_yt,
            hidden_tags=self.valid_hidden,
        )
        self.assertTrue(any("outside [1, 100]" in err for err in errors))

    def test_hash_inside_description_body_fails(self):
        bad_desc = "Why you should never #spend all cash at once."
        errors = validate_draft(
            draft_title="Savings: Why You Need A Plan",
            draft_description_body=bad_desc,
            hashtag_pool=self.valid_pool,
            primary_keyword="savings",
            selected_yt_hashtags=self.valid_yt,
            hidden_tags=self.valid_hidden,
        )
        self.assertTrue(any("forbidden '#'" in err for err in errors))

    def test_hidden_tags_over_450_chars_fails(self):
        long_hidden = ["a" * 50 for _ in range(10)]  # > 500 chars
        errors = validate_draft(
            draft_title="Savings: Why You Need A Plan",
            draft_description_body="Savings insight summary here.",
            hashtag_pool=self.valid_pool,
            primary_keyword="savings",
            selected_yt_hashtags=self.valid_yt,
            hidden_tags=long_hidden,
        )
        self.assertTrue(any("exceeds 450 chars" in err for err in errors))

    def test_repair_and_sanitize_fixes_deliberate_errors(self):
        bad_title = "A" * 105
        bad_desc = "Why #money matters so much in savings."
        bad_yt = [f"#tag_{i}" for i in range(20)]
        bad_hidden = ["#tag1", "#tag2", "b" * 460]

        title, desc, yt, hidden = repair_and_sanitize(
            bad_title, bad_desc, self.valid_pool, "savings", bad_yt, bad_hidden
        )
        self.assertLessEqual(len(title), 100)
        self.assertNotIn("#", desc)
        self.assertLessEqual(len(yt), 15)
        self.assertGreaterEqual(len(yt), 3)
        self.assertLessEqual(len(", ".join(hidden)), 450)
        self.assertFalse(any("#" in h for h in hidden))


class TestOfflineEndToEnd(unittest.TestCase):
    """2. Offline end-to-end: pipeline with mocked providers; matches Section 5 schema."""

    def test_full_offline_pipeline(self):
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
            db_path = tf.name

        try:
            config = SEOConfig(
                search_providers=["ddgs"],
                youtube_search_enabled=False,
                cache_db_path=db_path,
                yt_hashtags=5,
                ig_hashtags=5,
            )
            clip = {
                "title": "Avoid High Interest Debt",
                "hook": "Credit card interest is compounding against you every single month.",
                "duration": 42.0,
            }
            text = "Never carry a credit card balance because 24 percent APR compounding quietly destroys your wealth."

            result = run_seo_pipeline(clip=clip, transcript_text=text, config=config, llm=None)

            # Section 5 Official Output Schema assertions
            required_keys = [
                "title", "title_alternatives", "description", "hidden_tags",
                "hashtag_pool", "platform_output", "research_summary",
                "trending_confidence", "warnings",
            ]
            for key in required_keys:
                self.assertIn(key, result, f"Missing required Section 5 key: {key}")

            # Verify title rules
            self.assertLessEqual(len(result["title"]), 100)
            self.assertNotIn("#", result["title"])
            self.assertEqual(len(result["title_alternatives"]), 4)

            # Verify description rules
            self.assertLessEqual(len(result["description"]), 5000)

            # Verify hashtag pool: exactly 30 unique, 10 per group
            pool = result["hashtag_pool"]
            self.assertEqual(len(pool["topic"]), 10)
            self.assertEqual(len(pool["trending"]), 10)
            self.assertEqual(len(pool["adjacent"]), 10)

            all_tags = [it["tag"] for it in pool["topic"] + pool["trending"] + pool["adjacent"]]
            self.assertEqual(len(all_tags), 30)
            self.assertEqual(len(set(all_tags)), 30)

            # Verify platform packaging
            yt_output = result["platform_output"]["youtube_shorts"]
            ig_output = result["platform_output"]["instagram_reels"]
            self.assertLessEqual(len(yt_output["hashtags"]), 5)
            self.assertGreaterEqual(len(yt_output["hashtags"]), 3)
            self.assertLessEqual(len(ig_output["hashtags"]), 5)

            # Verify hidden tags length <= 450 chars
            self.assertLessEqual(len(yt_output["tags_field"]), 450)
            self.assertFalse(any("#" in tag for tag in result["hidden_tags"]))

            # Verify backward compatibility fields
            self.assertIn("youtube", result)
            self.assertIn("instagram", result)
            self.assertIn("thumbnail_hooks", result)
            self.assertIn("seo_audit", result)
        finally:
            if os.path.exists(db_path):
                os.remove(db_path)


class TestNichesSmoke(unittest.TestCase):
    """3. Smoke test across 5 clip domains (gaming, tech, education, news, lifestyle)."""

    def test_five_niches(self):
        niches = [
            ("gaming", "Elden Ring Boss Strategy", "Roll into the attack to dodge the hitbox and punish immediately."),
            ("tech", "Quantum Computing Breakthrough", "Superconducting qubits reached 99.9 percent gate fidelity today."),
            ("education", "How To Remember Everything", "Active recall and spaced repetition strengthen synaptic connections."),
            ("news", "Global Trade Summit Results", "Delegates signed the carbon border tariff agreement this morning."),
            ("lifestyle", "Morning Routine For Focus", "Cold shower and 20 minutes of morning sunlight reset circadian rhythm."),
        ]

        for category, title, text in niches:
            clip = {"title": title, "hook": text.split(".")[0], "duration": 35.0}
            res = run_seo_pipeline(clip=clip, transcript_text=text, llm=None)
            self.assertTrue(res["title"])
            self.assertNotIn("#", res["title"])
            pool = res["hashtag_pool"]
            self.assertEqual(len(pool["topic"]), 10, f"Topic pool failure in {category}")
            self.assertEqual(len(pool["trending"]), 10, f"Trending pool failure in {category}")
            self.assertEqual(len(pool["adjacent"]), 10, f"Adjacent pool failure in {category}")


class TestGracefulDegradation(unittest.TestCase):
    """4. Degradation test: disable search keys & YouTube key; returns valid metadata with warnings."""

    def test_degraded_pipeline(self):
        config = SEOConfig(
            search_providers=["non_existent_provider"],
            youtube_search_enabled=False,
            tavily_api_key="",
            youtube_api_key="",
        )
        clip = {"title": "Degraded Mode Test", "hook": "Works completely offline."}
        res = run_seo_pipeline(clip=clip, transcript_text="Works without any external APIs.", config=config, llm=None)
        self.assertTrue(res["title"])
        self.assertEqual(len(res["hashtag_pool"]["topic"]), 10)
        self.assertEqual(len(res["hashtag_pool"]["trending"]), 10)
        self.assertEqual(len(res["hashtag_pool"]["adjacent"]), 10)
        self.assertTrue(isinstance(res["warnings"], list))


class TestDailyQuotaLimit(unittest.TestCase):
    """5. Quota test: unit counter stops YouTube search at budget."""

    def test_quota_tracker_budget_cutoff(self):
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
            db_path = tf.name

        try:
            tracker = YouTubeQuotaTracker(db_path=db_path)
            budget = 205
            # Can consume 2 searches of 100
            self.assertTrue(tracker.consume(100, budget))
            self.assertTrue(tracker.consume(100, budget))
            self.assertEqual(tracker.get_used(), 200)

            # Third search of 100 exceeds budget (200 + 100 = 300 > 205) -> must return False
            self.assertFalse(tracker.can_consume(100, budget))
            self.assertFalse(tracker.consume(100, budget))
            self.assertEqual(tracker.get_used(), 200)

            # But smaller call of 1 unit fits (200 + 1 <= 205)
            self.assertTrue(tracker.can_consume(1, budget))
            self.assertTrue(tracker.consume(1, budget))
            self.assertEqual(tracker.get_used(), 201)
        finally:
            if os.path.exists(db_path):
                os.remove(db_path)


class TestEdgeCases(unittest.TestCase):
    """6. Edge cases: tag normalization, unicode, empty inputs, cache."""

    def test_tag_normalization(self):
        self.assertEqual(normalize_tag("Personal Finance!"), "#personalfinance")
        self.assertEqual(normalize_tag("#AI_Coding"), "#ai_coding")
        # Unicode combining marks / matras (e.g. Hindi बचत टिप्स)
        self.assertEqual(normalize_tag("बचत टिप्स"), "#बचतटिप्स")
        # Accented Spanish letters
        self.assertEqual(normalize_tag("Economía"), "#economía")
        # Reject pure numbers
        self.assertIsNone(normalize_tag("123456"))
        # Reject pure underscores
        self.assertIsNone(normalize_tag("___"))
        # Reject generic spam
        self.assertIsNone(normalize_tag("viral"))
        self.assertIsNone(normalize_tag("foryoupage"))

    def test_s3_llm_hashtag_selection_and_ranking(self):
        """Verify S3 calls LLM when provided and post-processes strictly 10/10/10 pool."""
        fake_llm_response = {
            "topic": [{"tag": f"#topic_{i}", "reason": f"Topic reason {i}"} for i in range(1, 11)],
            "trending": [{"tag": f"#trend_{i}", "reason": f"Trending reason {i}"} for i in range(1, 6)],  # shortfall of 5
            "adjacent": [{"tag": f"#adj_{i}", "reason": f"Adjacent reason {i}"} for i in range(1, 11)],
        }
        mock_llm = MagicMock()
        mock_llm.complete_json.return_value = fake_llm_response

        topic_data = {"main_topic": "Personal Finance", "category": "business", "entities": []}
        research_data = {"autocomplete": [], "top_recent_videos": [], "trending_now": [], "web": []}
        keywords_data = {"primary_keyword": "personal finance", "secondary_keywords": ["investing", "saving"], "longtail": []}

        pool, conf, warns = build_hashtag_pool(topic_data, research_data, keywords_data, llm=mock_llm)
        # LLM must have been called
        self.assertTrue(mock_llm.complete_json.called)
        # Trending shortfall must be flagged and confidence marked low
        self.assertEqual(conf, "low")
        self.assertTrue(any("trending_shortfall" in w for w in warns))
        # Total pool must be strictly 30 unique (10/10/10)
        self.assertEqual(len(pool["topic"]), 10)
        self.assertEqual(len(pool["trending"]), 10)
        self.assertEqual(len(pool["adjacent"]), 10)
        all_tags = [t["tag"] for t in pool["topic"] + pool["trending"] + pool["adjacent"]]
        self.assertEqual(len(set(all_tags)), 30)

    def test_s4_llm_title_judge(self):
        """Verify S4 uses second LLM call to judge candidates."""
        mock_llm = MagicMock()
        # 1st call for writer, 2nd call for judge
        mock_llm.complete_json.side_effect = [
            {
                "title_candidates": [
                    "Budgeting: The Hidden Strategy",
                    "3 Budgeting Rules You Need",
                    "Why Budgeting Fails For Most People?",
                    "Budgeting Beats Willpower Every Time",
                    "How Budgeting Creates Wealth",
                ],
                "description_body": "Budgeting breakdown of key rules.",
                "instagram_caption_body": "Budgeting takeaway line.",
            },
            {
                "winner_index": 3,
                "ranked_indices": [3, 1, 2, 4, 5],
                "reason": "Clear curiosity hook with stakes question",
            },
        ]

        from seo.stages.s4_writer import write_metadata
        res = write_metadata(
            topic_data={"main_topic": "budgeting", "one_line_summary": "Budgeting tips"},
            keywords_data={"primary_keyword": "budgeting", "secondary_keywords": []},
            research_data={"web": []},
            llm=mock_llm,
        )
        self.assertEqual(mock_llm.complete_json.call_count, 2)
        # Winner must be candidate index 3 (0-indexed 2)
        self.assertEqual(res["title"], "Why Budgeting Fails For Most People?")
        self.assertEqual(len(res["title_alternatives"]), 4)

    def test_long_form_video_packaging_omits_shorts_tag(self):
        """Verify packaging for is_short=False omits #Shorts."""
        from seo.stages.s6_package import package_metadata
        pool = {
            "topic": [{"tag": f"#topic_{i}"} for i in range(1, 11)],
            "trending": [{"tag": f"#trend_{i}"} for i in range(1, 11)],
            "adjacent": [{"tag": f"#adj_{i}"} for i in range(1, 11)],
        }
        config = SEOConfig(yt_hashtags=5, ig_hashtags=5)
        platform_output, hidden, desc = package_metadata(
            title="Long Form Deep Dive",
            title_alternatives=["Alt 1", "Alt 2", "Alt 3", "Alt 4"],
            description_body="Comprehensive analysis of macroeconomic trends.",
            instagram_caption_body="Analysis caption.",
            hashtag_pool=pool,
            keywords_data={"primary_keyword": "macroeconomics", "longtail": []},
            trending_confidence="high",
            config=config,
            is_short=False,
        )
        yt_tags = platform_output["youtube_shorts"]["hashtags"]
        self.assertNotIn("#Shorts", yt_tags)
        self.assertNotIn("#shorts", desc.lower())

    def test_low_confidence_trending_swaps_instagram_slot(self):
        """Verify low-confidence trending slot is swapped on Instagram."""
        from seo.stages.s6_package import package_metadata
        pool = {
            "topic": [{"tag": f"#topic_{i}"} for i in range(1, 11)],
            "trending": [{"tag": f"#trend_{i}"} for i in range(1, 11)],
            "adjacent": [{"tag": f"#adj_{i}"} for i in range(1, 11)],
        }
        config = SEOConfig(yt_hashtags=5, ig_hashtags=5)
        platform_output, _, _ = package_metadata(
            title="Title With Keyword",
            title_alternatives=["Alt 1", "Alt 2", "Alt 3", "Alt 4"],
            description_body="Body text.",
            instagram_caption_body="IG Body.",
            hashtag_pool=pool,
            keywords_data={"primary_keyword": "keyword"},
            trending_confidence="low",
            config=config,
        )
        ig_tags = platform_output["instagram_reels"]["hashtags"]
        # Trending tag #trend_1 should have been swapped for adjacent/topic tag
        self.assertNotIn("#trend_1", ig_tags)

    def test_generate_metadata_delegates_to_engine(self):
        """Verify generate_metadata(..., use_engine=True) delegates cleanly to SEOPipeline."""
        from clipper.seo import generate_metadata
        clip = {"title": "Compound Interest Explainer", "hook": "Why you should start early", "duration": 40.0}
        text = "Compound interest multiplies your savings exponentially over decades."
        meta = generate_metadata(clip, text, llm=None, use_engine=True)
        self.assertIn("title", meta)
        self.assertIn("hashtag_pool", meta)
        self.assertEqual(len(meta["hashtag_pool"]["topic"]), 10)
        self.assertIn("youtube", meta)
        self.assertIn("instagram", meta)

    def test_cache_ttl_and_storage(self):
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
            db_path = tf.name

        try:
            cache = SEOCache(db_path=db_path)
            cache.set("provider_a", "test query", {"key": "val"}, geo="IN", ttl_hours=1.0)
            cached = cache.get("provider_a", "test query", geo="IN")
            self.assertEqual(cached, {"key": "val"})

            # Expired item returns None
            cache.set("provider_a", "expired query", {"key": "old"}, geo="IN", ttl_hours=-0.1)
            self.assertIsNone(cache.get("provider_a", "expired query", geo="IN"))
        finally:
            if os.path.exists(db_path):
                os.remove(db_path)


if __name__ == "__main__":
    unittest.main()
