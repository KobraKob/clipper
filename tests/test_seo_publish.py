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
    def test_llm_metadata_limits_and_sanitization(self):
        llm = FakeLLM({
            "primary_keyword": "savings inflation",
            "youtube_title": "INSANE SAVINGS INFLATION SECRET YOU MUST SEE!!! #viral",
            "youtube_description": "Desc line about savings and inflation.",
            "above_the_fold": "Why inflation quietly drains your savings account every year.",
            "detailed_overview": "Learn how inflation erodes idle cash and what savings strategy protects purchasing power.",
            "keywords": ["savings inflation", "inflation savings", "bank account"],
            "hashtags": ["#Finance", "#SavingsTips", "#viral", "#fyp", "#trending", "#video"],
            "alternate_names": ["cash inflation", "savings erosion"],
            "misspellings": ["saveings inflaton", "unrelatedspam"],
            "thumbnail_hooks": {
                "option_a": "SAVINGS INFLATION SECRET",  # duplicates title -> must be replaced!
                "option_b": "1 ACCOUNT VS 3",
                "option_c": "HIDDEN COST",
            },
            "instagram_caption": "Hook about savings and inflation\n\n#viral #fyp #SavingsTips",
        })
        m = generate_metadata(CLIP, TEXT, llm=llm, source_url="https://youtu.be/abc", is_short=True)
        title = m["youtube"]["title"]
        self.assertLessEqual(len(title), 100)
        self.assertNotIn("INSANE", title)
        self.assertNotIn("!!!", title)
        self.assertNotIn("#", title)
        self.assertIn("Full video: https://youtu.be/abc", m["youtube"]["description"])
        self.assertIn("0:00 - ", m["youtube"]["description"])
        self.assertIn("#Shorts", m["youtube"]["description"])
        self.assertLessEqual(len(m["hashtags"]), 3)
        self.assertNotIn("Viral", m["hashtags"])
        self.assertNotIn("Fyp", m["hashtags"])
        self.assertNotIn("Trending", m["hashtags"])
        self.assertLessEqual(m["instagram"]["caption"].count("#"), 5)
        self.assertNotIn("#viral", m["instagram"]["caption"].lower())
        self.assertNotIn("#fyp", m["instagram"]["caption"].lower())
        self.assertTrue(m["seo_audit"]["title_thumbnail_distinct"])
        self.assertTrue(m["seo_audit"]["starts_at_zero"])
        self.assertLessEqual(sum(len(t) for t in m["youtube"]["tags"]) + len(m["youtube"]["tags"]), 460)
        self.assertNotIn("unrelatedspam", m["youtube"]["tags"])
        self.assertEqual(m["generated_by"], "llm")

    def test_fallback_when_llm_fails(self):
        m = generate_metadata(CLIP, TEXT, llm=FakeLLM(fail=True))
        self.assertEqual(m["generated_by"], "heuristic")
        self.assertTrue(m["youtube"]["title"])
        self.assertTrue(any("savings" in kw for kw in m["keywords"]))
        self.assertIn("0:00 - ", m["youtube"]["description"])
        # Includes deterministic misspellings / phonetic variants for search tags
        self.assertTrue(any(t in m["youtube"]["tags"] for t in ("saveings", "inflaton", "infaltion", "saving")))

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

    def test_metadata_has_niche_hashtags_and_overlapping_trends_without_spam(self):
        trends = [
            {"title": "Savings and inflation analysis"},
            {"title": "Football championship final"},
        ]
        meta = generate_metadata(CLIP, TEXT, llm=None, trending_topics=trends, trend_region="IN", is_short=False)
        groups = meta["hashtag_groups"]
        self.assertGreaterEqual(len(groups["niche"]), 2)
        self.assertLessEqual(len(groups["niche"]), 3)
        self.assertEqual(groups["format"], [])
        self.assertIn("SavingsAndInflationAnalysis", groups["trending"])
        self.assertNotIn("FootballChampionshipFinal", groups["trending"])
        self.assertNotIn("#Shorts", meta["youtube"]["description"])
        self.assertLessEqual(len(meta["hashtags"]), 3)
        self.assertEqual(len(meta["hashtags"]), len(set(tag.casefold() for tag in meta["hashtags"])))
        self.assertLessEqual(meta["instagram"]["caption"].count("#"), 5)

    def test_empty_transcript_fallback_is_safe(self):
        meta = generate_metadata({"title": "Himalayas Travel Guide", "hook": "What nobody tells you"}, "", llm=None)
        self.assertTrue(meta["youtube"]["title"])
        self.assertIn("0:00 - ", meta["youtube"]["description"])
        self.assertEqual(len(meta["thumbnail_hooks"]), 3)

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

    def test_long_form_publish_body_does_not_force_shorts_tag(self):
        meta = generate_metadata(
            {"title": "Trip to the Mountains", "hook": "What nobody tells you before visiting the Himalayas", "duration": 42.0},
            "Most travelers underestimate altitude sickness above 3500 meters in Leh and Ladakh.",
            llm=None,
            is_short=False,
        )
        body = build_youtube_body(meta, Settings.create_custom(youtube_privacy="private"))
        self.assertNotIn("#shorts", body["snippet"]["description"].lower())

    def test_front_loading_quoted_caps_variants_and_chapters_edge_cases(self):
        llm = FakeLLM({
            "primary_keyword": "altitude sickness",
            "youtube_title": 'What Nobody Tells You Before Visiting "HIMALAYAS" For Altitude Sickness',
            "title_variants": [
                {"id": "direct", "title": "How Altitude Sickness Hits In Ladakh", "angle": "Direct Value"},
                {"id": "curiosity", "title": "The Ladakh Mistake Most Trekkers Make", "angle": "Curiosity Gap"},
                {"id": "question", "title": "Why Does Altitude Sickness Start Above 3500m?", "angle": "Stakes Question"},
            ],
            "chapters": [
                {"time": "0:00", "label": ""},  # invalid empty label at idx 0
                {"time": "0:12", "label": "Acclimatize for two days above"},
                {"time": "0:28", "label": "Drink electrolytes before climbing"},
            ],
        })
        clip = {"title": "Himalayas", "hook": "Avoid rushing up steep passes on day one", "duration": 45.0}
        text = "Most travelers underestimate altitude sickness above 3500 meters in Leh and Ladakh. Acclimatize for two days above base camp, drink electrolytes, and avoid rushing up steep passes on day one."
        meta = generate_metadata(clip, text, llm=llm, is_short=True)
        self.assertTrue(meta["seo_audit"]["mobile_front_loaded"])
        self.assertNotIn("HIMALAYAS", meta["youtube"]["title"])
        self.assertEqual(len(meta["title_variants"]), 3)
        self.assertEqual([v["id"] for v in meta["title_variants"]], ["direct", "curiosity", "question"])
        self.assertEqual(meta["youtube"]["chapters"][0]["time"], "0:00")
        self.assertFalse(meta["youtube"]["chapters"][0]["label"].lower().endswith("above"))
        # "day one" must not falsely trigger "1 VS MANY"
        self.assertNotEqual(meta["thumbnail_hooks"]["option_b"], "1 VS MANY")

        # Fallback must not produce "What Why ... Really Means"
        fb = generate_metadata(
            {"title": "Why Inflation Hurts Savings", "hook": "Why inflation hurts savings", "duration": 35.0},
            "Inflation silently reduces purchasing power on idle savings accounts every year.",
            llm=None,
        )
        for v in fb["title_variants"]:
            self.assertFalse(v["title"].startswith("What Why "))


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
        self.assertEqual(caption, "My caption #One\n\n#TwoTag #Three")

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
