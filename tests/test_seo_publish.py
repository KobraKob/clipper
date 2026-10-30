import json
import pathlib
import tempfile
import unittest

from clipper.config import Settings
from clipper.publish import PublishError, _append_hashtags, build_youtube_body, publish_clip, upload_instagram
from clipper.seo import generate_metadata


class FakeLLM:
    def __init__(self, payload=None, fail=False):
        self.payload, self.fail = payload, fail

    def complete_json(self, prompt, tier="strong"):
        if self.fail:
            raise RuntimeError("quota")
        return self.payload


CLIP = {"title": "Money mistake", "hook": "Never do this with your savings"}
TEXT = "never keep all your savings in one account because inflation quietly eats savings every year"


class TestSeo(unittest.TestCase):
    def test_llm_metadata_limits(self):
        llm = FakeLLM({
            "youtube_title": "x" * 300, "youtube_description": "Desc line.",
            "keywords": ["savings", "inflation"], "hashtags": ["#Finance", "money tips", "a", "b", "c", "d", "e"],
            "instagram_caption": "Hook\n\nFollow",
        })
        m = generate_metadata(CLIP, TEXT, llm=llm, source_url="https://youtu.be/abc")
        self.assertLessEqual(len(m["youtube"]["title"]), 100)
        self.assertIn("Full video: https://youtu.be/abc", m["youtube"]["description"])
        self.assertIn("Shorts", m["hashtags"])
        self.assertLessEqual(m["instagram"]["caption"].count("#"), 5)
        self.assertEqual(m["generated_by"], "llm")

    def test_fallback_when_llm_fails(self):
        m = generate_metadata(CLIP, TEXT, llm=FakeLLM(fail=True))
        self.assertEqual(m["generated_by"], "heuristic")
        self.assertTrue(m["youtube"]["title"])
        self.assertIn("savings", m["keywords"])
    def test_title_variant_ids_stay_unique_when_direct_title_is_inserted(self):
        llm = FakeLLM({
            "youtube_title": "Inflation Drains Savings Faster Than You Think",
            "title_variants": [
                {"id": "direct", "title": "Why Inflation Hurts Your Savings Account", "angle": "Direct"},
                {"id": "curiosity", "title": "The Savings Habit Inflation Quietly Punishes", "angle": "Curiosity"},
                {"id": "question", "title": "How Inflation Shrinks Savings Over Time", "angle": "Question"},
            ],
        })

        metadata = generate_metadata(CLIP, TEXT, llm=llm)
        variants = metadata["title_variants"]
        ids = [variant["id"] for variant in variants]

        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(ids[0], "direct")
        self.assertEqual(metadata["selected_title_variant"], ids[0])

    def test_metadata_has_structured_relevant_global_and_trend_groups(self):
        trends = [
            {"title": "Savings and inflation analysis"},
            {"title": "Football championship final"},
        ]
        meta = generate_metadata(CLIP, TEXT, llm=None, trending_topics=trends, trend_region="IN")
        groups = meta["hashtag_groups"]
        self.assertEqual(len(groups["relevant"]), 20)
        self.assertEqual(len(groups["global"]), 10)
        self.assertIn("SavingsAndInflationAnalysis", groups["trending"])
        self.assertNotIn("FootballChampionshipFinal", groups["trending"])
        self.assertLessEqual(len(meta["hashtags"]), 40)
        self.assertEqual(len(meta["hashtags"]), len(set(tag.casefold() for tag in meta["hashtags"])))
        self.assertLessEqual(meta["instagram"]["caption"].count("#"), 5)

    def test_missing_live_trends_are_reported_as_unavailable(self):
        meta = generate_metadata(CLIP, TEXT, llm=None)
        self.assertEqual(meta["trend_status"], "unavailable")
        self.assertIsNone(meta["trend_source"])
        self.assertEqual(meta["hashtag_groups"]["trending"], [])

    def test_unrelated_llm_seo_suggestions_are_rejected(self):
        llm = FakeLLM({
            "youtube_title": "Football Final: Incredible Goal",
            "youtube_description": "The football final has an incredible result.",
            "keywords": ["football", "soccer", "savings", "inflation"],
            "hashtags": ["FootballFinal", "Soccer", "SavingsTips", "Inflation"],
            "instagram_caption": "What a football match. Follow for more.",
        })
        meta = generate_metadata(CLIP, TEXT, llm=llm)
        self.assertNotIn("FootballFinal", meta["hashtags"])
        self.assertNotIn("Soccer", meta["hashtags"])
        self.assertTrue(any("Savings" in item or "Inflation" in item for item in meta["hashtags"]))
        self.assertNotIn("Football", meta["youtube"]["title"])
        self.assertIn("savings", meta["keywords"])


class FakeResp:
    def __init__(self, data, status=200):
        self._d, self.status_code, self.text = data, status, json.dumps(data)

    def json(self):
        return self._d


class FakeHttp:
    def __init__(self):
        self.calls = []

    def post(self, url, **kw):
        self.calls.append(("POST", url))
        if url.endswith("/media"):
            return FakeResp({"id": "C1", "uri": "https://rupload.example/C1"})
        if url.endswith("/media_publish"):
            return FakeResp({"id": "M1"})
        return FakeResp({"success": True})

    def get(self, url, **kw):
        self.calls.append(("GET", url))
        if url.endswith("/M1"):
            return FakeResp({"permalink": "https://instagram.com/reel/M1"})
        return FakeResp({"status_code": "FINISHED"})


class TestPublish(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.video = pathlib.Path(self.tmp.name) / "c.mp4"
        self.video.write_bytes(b"x" * 10)
        self.meta = generate_metadata(CLIP, TEXT, llm=None)

    def tearDown(self):
        self.tmp.cleanup()

    def test_youtube_body(self):
        body = build_youtube_body(self.meta, Settings(), privacy="unlisted")
        self.assertEqual(body["status"]["privacyStatus"], "unlisted")
        self.assertIn("#shorts", body["snippet"]["description"].lower())

    def test_custom_hashtags_are_appended_without_duplicates(self):
        caption = _append_hashtags("My caption #One", ["#one", "Two Tag", "#Three"], 2200)
        self.assertEqual(caption, "My caption #One\\n\\n#TwoTag #Three")

    def test_youtube_body_default_privacy_is_private(self):
        # Private is the safest default for publishing generated content.
        body = build_youtube_body(self.meta, Settings())
        self.assertEqual(body["status"]["privacyStatus"], "private")

    def test_instagram_flow(self):
        s = Settings.create_custom(instagram_access_token="t", instagram_user_id="42")
        http = FakeHttp()
        out = upload_instagram(self.video, self.meta, s, poll_seconds=0, http=http)
        self.assertEqual(out["id"], "M1")
        self.assertEqual(out["url"], "https://instagram.com/reel/M1")
        self.assertEqual([c[0] for c in http.calls][:2], ["POST", "POST"])

    def test_instagram_requires_credentials(self):
        with self.assertRaises(PublishError):
            upload_instagram(self.video, self.meta, Settings.create_custom(instagram_access_token="", instagram_user_id=""))

    def test_publish_clip_records_errors_and_skips_published(self):
        clip = {"file": str(self.video), "seo": self.meta, "publish": {"youtube": {"status": "published"}}}
        s = Settings.create_custom(instagram_access_token="", instagram_user_id="")
        res = publish_clip(clip, ["youtube", "instagram"], s)
        self.assertEqual(res["youtube"]["status"], "published")
        self.assertEqual(res["instagram"]["status"], "error")


if __name__ == "__main__":
    unittest.main()
