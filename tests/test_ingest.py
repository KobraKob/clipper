"""
Tests for high-resolution format selection and the download flow (no network, no real yt-dlp).
"""

import json
import pathlib
import tempfile
import unittest
from unittest import mock

from clipper import ingest
from clipper.ingest import VideoInfo, select_formats


def vfmt(fid, w, h, vcodec="avc1.640028", fps=30, tbr=2000, ext="mp4", **extra):
    d = {
        "format_id": str(fid),
        "width": w,
        "height": h,
        "vcodec": vcodec,
        "acodec": "none",
        "fps": fps,
        "tbr": tbr,
        "ext": ext,
        "protocol": "https",
    }
    d.update(extra)
    return d


def afmt(fid, acodec="mp4a.40.2", abr=128, **extra):
    d = {
        "format_id": str(fid),
        "vcodec": "none",
        "acodec": acodec,
        "abr": abr,
        "tbr": abr,
        "ext": "m4a",
        "protocol": "https",
    }
    d.update(extra)
    return d


def muxed(fid, w, h, **extra):
    d = vfmt(fid, w, h, **extra)
    d["acodec"] = "mp4a.40.2"
    return d


LADDER_1080 = [
    afmt(139, abr=48),
    afmt(140, abr=128),
    muxed(18, 640, 360),
    vfmt(134, 640, 360),
    vfmt(135, 854, 480),
    vfmt(136, 1280, 720),
    vfmt(137, 1920, 1080, tbr=4000),
]

LADDER_4K = LADDER_1080 + [
    vfmt(299, 1920, 1080, vcodec="avc1.64002a", fps=60),
    vfmt(271, 2560, 1440, vcodec="vp09.00.40.08", tbr=6000, ext="webm"),
    vfmt(313, 3840, 2160, vcodec="vp09.00.50.08", tbr=14000, ext="webm"),
    vfmt(701, 3840, 2160, vcodec="av01.0.12M.08", tbr=9000),
    afmt(251, acodec="opus", abr=160),
]


class TestSelectFormats(unittest.TestCase):
    def test_picks_1080p_and_best_audio(self):
        plan = select_formats({"formats": LADDER_1080}, min_height=1080, max_height=2160)
        self.assertEqual(plan.height, 1080)
        self.assertFalse(plan.below_target)
        self.assertEqual(plan.attempts[0].expr, "137+140")
        self.assertEqual(plan.attempts[0].merge_format, "mp4")

    def test_prefers_4k_over_1080_when_available(self):
        plan = select_formats({"formats": LADDER_4K}, min_height=1080, max_height=2160)
        self.assertEqual(plan.height, 2160)
        self.assertTrue(plan.attempts[0].expr.startswith("313+"))
        self.assertEqual(plan.attempts[0].merge_format, "mkv")

    def test_attempts_span_distinct_resolutions(self):
        plan = select_formats({"formats": LADDER_4K}, 1080, 2160)
        heights = [a.height for a in plan.attempts]
        self.assertEqual(heights, sorted(set(heights), reverse=True))
        self.assertEqual(heights[:3], [2160, 1440, 1080])

    def test_max_height_cap_is_respected(self):
        plan = select_formats({"formats": LADDER_4K}, min_height=1080, max_height=1080)
        self.assertEqual(plan.height, 1080)
        self.assertNotIn(2160, [a.height for a in plan.attempts])

    def test_only_360p_is_flagged_below_target(self):
        plan = select_formats({"formats": [muxed(18, 640, 360)]}, min_height=1080)
        self.assertEqual(plan.height, 360)
        self.assertTrue(plan.below_target)
        self.assertEqual(plan.attempts[0].expr, "18")
        self.assertIsNone(plan.attempts[0].merge_format)

    def test_hdr_skipped_when_sdr_meets_target(self):
        fmts = LADDER_1080 + [vfmt(337, 3840, 2160, vcodec="vp09.02.50.10.01", dynamic_range="HDR10", ext="webm")]
        plan = select_formats({"formats": fmts}, 1080, 2160)
        self.assertEqual(plan.height, 1080)

    def test_hdr_used_when_it_is_all_there_is(self):
        fmts = [afmt(140), vfmt(337, 3840, 2160, vcodec="vp09.02.50.10.01", dynamic_range="HDR10", ext="webm")]
        plan = select_formats({"formats": fmts}, 1080, 2160)
        self.assertEqual(plan.height, 2160)

    def test_portrait_source_uses_short_side(self):
        fmts = [afmt(140), vfmt(300, 1080, 1920)]
        plan = select_formats({"formats": fmts}, 1080, 2160)
        self.assertEqual(plan.height, 1080)
        self.assertFalse(plan.below_target)

    def test_storyboards_and_empty_input_are_ignored(self):
        sb = vfmt("sb0", 160, 90, ext="mhtml", format_note="storyboard")
        self.assertEqual(select_formats({"formats": [sb]}).attempts, [])
        self.assertEqual(select_formats({}).attempts, [])

    def test_audio_prefers_non_drc_original_aac(self):
        fmts = [
            vfmt(137, 1920, 1080),
            afmt("140-drc", abr=130, format_note="medium, DRC"),
            afmt("251", acodec="opus", abr=160),
            afmt("140", abr=128, format_note="medium"),
        ]
        plan = select_formats({"formats": fmts}, 1080, 2160)
        self.assertEqual(plan.attempts[0].expr, "137+140")

    def test_video_only_without_audio_falls_back_to_muxed(self):
        fmts = [vfmt(137, 1920, 1080), muxed(22, 1280, 720)]
        plan = select_formats({"formats": fmts}, 1080, 2160)
        self.assertEqual(plan.attempts[0].expr, "22")


class TestHelpers(unittest.TestCase):
    def test_is_youtube_url(self):
        self.assertTrue(ingest.is_youtube_url("https://youtu.be/BcQnHzrc24Y?si=abc"))
        self.assertTrue(ingest.is_youtube_url("https://www.youtube.com/watch?v=x"))
        self.assertTrue(ingest.is_youtube_url("https://m.youtube.com/watch?v=x"))
        self.assertFalse(ingest.is_youtube_url("https://vimeo.com/123"))
        self.assertFalse(ingest.is_youtube_url("not a url"))

    def test_generic_selector_mentions_bounds(self):
        sel = ingest.generic_selector(1080, 2160)
        self.assertIn("height>=1080", sel)
        self.assertIn("height<=2160", sel)

    def test_is_url(self):
        self.assertTrue(ingest.is_url("https://example.com/v"))
        self.assertFalse(ingest.is_url("C:\\videos\\a.mp4"))


class FakeDownloads:
    """Patches the subprocess layer used by ingest.download()."""

    def __init__(self, tmp, info, outcomes=None, got=(1920, 1080)):
        self.tmp = pathlib.Path(tmp)
        self.info = info
        self.outcomes = list(outcomes or [0])
        self.commands = []
        self.probe_calls = 0
        self.got = got

    def run_capture(self, cmd, timeout=None):
        self.probe_calls += 1
        return mock.Mock(returncode=0, stdout=json.dumps(self.info), stderr="")

    def run_streaming(self, cmd, *args, **kwargs):
        self.commands.append(cmd)
        code = self.outcomes.pop(0) if self.outcomes else 0
        if code == 0:
            (self.tmp / "source.mp4").write_bytes(b"x" * 100)
        return code, "boom: format not available" if code else "ok"

    def probe_video(self, path):
        return VideoInfo(width=self.got[0], height=self.got[1], fps=30.0, duration=60.0, codec="h264")

    def __enter__(self):
        self._patches = [
            mock.patch.object(ingest, "_run_capture", self.run_capture),
            mock.patch.object(ingest, "_run_streaming", self.run_streaming),
            mock.patch.object(ingest, "probe_video", self.probe_video),
            mock.patch.object(ingest, "_get_ytdlp_cmd", lambda: ["yt-dlp"]),
            mock.patch.object(ingest, "_get_js_runtime_args", lambda: []),
        ]
        for p in self._patches:
            p.start()
        return self

    def __exit__(self, *exc):
        for p in self._patches:
            p.stop()


class TestDownloadFlow(unittest.TestCase):
    def test_downloads_explicit_best_formats_and_records_info(self):
        info = {"title": "T", "channel": "C", "description": "D", "formats": LADDER_1080, "webpage_url": "https://youtu.be/x"}
        with tempfile.TemporaryDirectory() as tmp, FakeDownloads(tmp, info) as fake:
            path = ingest.download("https://youtu.be/x", pathlib.Path(tmp), min_height=1080)
            self.assertTrue(path.exists())
            cmd = fake.commands[0]
            self.assertEqual(cmd[cmd.index("-f") + 1], "137+140")
            self.assertNotIn("youtube:player_client=tv,android,web", " ".join(cmd))
            saved = ingest.load_source_info(pathlib.Path(tmp))
            self.assertEqual(saved["title"], "T")
            self.assertEqual(saved["downloaded"]["height"], 1080)
            self.assertFalse(saved["below_target"])
            self.assertEqual(saved["client_profile"], "yt-dlp defaults")

    def test_falls_back_to_lower_resolution_when_best_fails(self):
        info = {"formats": LADDER_4K}
        with tempfile.TemporaryDirectory() as tmp, FakeDownloads(tmp, info, outcomes=[1, 0]) as fake:
            ingest.download("https://youtu.be/x", pathlib.Path(tmp), min_height=1080)
            exprs = [c[c.index("-f") + 1] for c in fake.commands]
            self.assertTrue(exprs[0].startswith("313+"))
            self.assertTrue(exprs[1].startswith("271+"))

    def test_below_target_is_recorded_not_fatal(self):
        info = {"formats": [muxed(18, 640, 360)]}
        with tempfile.TemporaryDirectory() as tmp, FakeDownloads(tmp, info, got=(640, 360)) as fake:
            ingest.download("https://youtu.be/x", pathlib.Path(tmp), min_height=1080)
            saved = ingest.load_source_info(pathlib.Path(tmp))
            self.assertTrue(saved["below_target"])
            self.assertEqual(saved["downloaded"]["height"], 360)

    def test_cached_hd_source_is_reused_without_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            (pathlib.Path(tmp) / "source.mp4").write_bytes(b"x")
            with mock.patch.object(ingest, "probe_video", lambda p: VideoInfo(1920, 1080, 30.0, 10.0)), mock.patch.object(
                ingest, "_run_capture", side_effect=AssertionError("network must not be touched")
            ):
                path = ingest.download("https://youtu.be/x", pathlib.Path(tmp), min_height=1080)
            self.assertEqual(path.name, "source.mp4")

    def test_cached_360p_source_is_replaced(self):
        info = {"formats": LADDER_1080}
        with tempfile.TemporaryDirectory() as tmp:
            (pathlib.Path(tmp) / "source.mp4").write_bytes(b"old-360p")
            fake = FakeDownloads(tmp, info)
            with fake:
                calls = {"n": 0}

                def probe(path):
                    calls["n"] += 1
                    return VideoInfo(640, 360, 25.0, 10.0) if calls["n"] == 1 else VideoInfo(1920, 1080, 30.0, 10.0)

                with mock.patch.object(ingest, "probe_video", probe):
                    path = ingest.download("https://youtu.be/x", pathlib.Path(tmp), min_height=1080)
            self.assertTrue(fake.commands, "should have re-downloaded")
            self.assertEqual(path.read_bytes(), b"x" * 100)
            self.assertFalse((pathlib.Path(tmp) / "source.mp4.old").exists())

    def test_total_failure_raises_helpful_error(self):
        info = {"formats": LADDER_1080}
        with tempfile.TemporaryDirectory() as tmp, FakeDownloads(tmp, info, outcomes=[1] * 10):
            with self.assertRaises(RuntimeError) as ctx:
                ingest.download("https://youtu.be/x", pathlib.Path(tmp))
            self.assertIn("yt-dlp failed to download", str(ctx.exception))

    def test_youtube_bot_check_gets_cookie_hint(self):
        self.assertIn("YTDLP_COOKIES_FROM_BROWSER", ingest._hint_for_error("Sign in to confirm you're not a bot"))

    def test_real_world_ytdlp_dump_json_parsing(self):
        """Simulate real yt-dlp dump json with complex audio tracks, DASH manifests, and storyboards."""
        real_dump = {
            "id": "sXKnmgmbkoE",
            "title": "Lex Fridman Podcast #400",
            "channel": "Lex Fridman",
            "description": "Conversation with guests.",
            "formats": [
                {
                    "format_id": "sb2",
                    "format_note": "storyboard",
                    "ext": "mhtml",
                    "width": 160,
                    "height": 90,
                    "fps": 0.1,
                    "vcodec": "none",
                    "acodec": "none",
                },
                {
                    "format_id": "139",
                    "format_note": "low",
                    "ext": "m4a",
                    "acodec": "mp4a.40.5",
                    "vcodec": "none",
                    "abr": 48.0,
                    "tbr": 49.0,
                },
                {
                    "format_id": "140",
                    "format_note": "medium",
                    "ext": "m4a",
                    "acodec": "mp4a.40.2",
                    "vcodec": "none",
                    "abr": 128.0,
                    "tbr": 129.0,
                },
                {
                    "format_id": "251",
                    "format_note": "medium",
                    "ext": "webm",
                    "acodec": "opus",
                    "vcodec": "none",
                    "abr": 160.0,
                },
                {
                    "format_id": "136",
                    "format_note": "720p",
                    "ext": "mp4",
                    "width": 1280,
                    "height": 720,
                    "fps": 30,
                    "vcodec": "avc1.4d401f",
                    "acodec": "none",
                    "tbr": 1150.0,
                },
                {
                    "format_id": "137",
                    "format_note": "1080p",
                    "ext": "mp4",
                    "width": 1920,
                    "height": 1080,
                    "fps": 30,
                    "vcodec": "avc1.640028",
                    "acodec": "none",
                    "tbr": 2400.0,
                },
                {
                    "format_id": "248",
                    "format_note": "1080p",
                    "ext": "webm",
                    "width": 1920,
                    "height": 1080,
                    "fps": 30,
                    "vcodec": "vp09.00.40.08",
                    "acodec": "none",
                    "tbr": 1800.0,
                },
            ],
        }

        plan = select_formats(real_dump, min_height=1080, max_height=2160)
        self.assertEqual(plan.height, 1080)
        self.assertFalse(plan.below_target)
        # Prefers H.264 mp4 (137) over VP9 webm (248) and AAC (140) over Opus (251) for MP4 output
        self.assertEqual(plan.attempts[0].expr, "137+140")
        self.assertEqual(plan.attempts[0].merge_format, "mp4")

    def test_forbidden_and_js_runtime_error_diagnosis(self):
        err_msg = (
            "WARNING: No supported JavaScript runtime could be found. Only deno is enabled by default. "
            "ERROR: unable to download video data: HTTP Error 403: Forbidden"
        )
        hint = ingest._hint_for_error(err_msg)
        self.assertTrue(len(hint) > 0)
        self.assertTrue(
            "YTDLP_COOKIES_FROM_BROWSER" in hint or "cookies" in hint.lower() or "runtime" in hint.lower()
        )

    def test_getaddrinfo_error_diagnosis(self):
        err_msg = (
            "ERROR: [youtube] aEUNrQRQnhk: Unable to download API page: "
            "HTTPSConnection(host='www.youtube.com', port=443): Failed to resolve 'www.youtube.com' "
            "([Errno 11001] getaddrinfo failed)"
        )
        hint = ingest._hint_for_error(err_msg)
        self.assertIn("YTDLP_FORCE_IPV4", hint)
        self.assertIn("getaddrinfo", hint.lower())

    def test_download_passes_ipv4_and_proxy_args(self):
        info = {"formats": LADDER_1080}
        with tempfile.TemporaryDirectory() as tmp, FakeDownloads(tmp, info) as fake:
            ingest.download(
                "https://youtu.be/x",
                pathlib.Path(tmp),
                min_height=1080,
                force_ipv4=True,
                proxy="http://127.0.0.1:8080",
                socket_timeout=45,
            )
            cmd = fake.commands[0]
            self.assertIn("--force-ipv4", cmd)
            self.assertIn("--proxy", cmd)
            self.assertEqual(cmd[cmd.index("--proxy") + 1], "http://127.0.0.1:8080")
            self.assertIn("--socket-timeout", cmd)
            self.assertEqual(cmd[cmd.index("--socket-timeout") + 1], "45")

    def test_probe_auto_retries_with_force_ipv4_on_getaddrinfo_failure(self):
        calls = []

        def mock_capture(cmd, timeout=None):
            calls.append(list(cmd))
            if "--force-ipv4" in cmd:
                return mock.Mock(returncode=0, stdout=json.dumps({"formats": []}), stderr="")
            return mock.Mock(
                returncode=1,
                stdout="",
                stderr="Failed to resolve 'www.youtube.com' ([Errno 11001] getaddrinfo failed)",
            )

        with mock.patch.object(ingest, "_run_capture", side_effect=mock_capture), mock.patch.object(
            ingest, "_get_ytdlp_cmd", lambda: ["yt-dlp"]
        ):
            base_args = ["--socket-timeout", "30"]
            res = ingest._probe_url_info("https://youtu.be/x", [], base_args)
            self.assertEqual(res, {"formats": []})
            self.assertEqual(len(calls), 2)
            self.assertNotIn("--force-ipv4", calls[0])
            self.assertIn("--force-ipv4", calls[1])
            self.assertIn("--force-ipv4", base_args)


if __name__ == "__main__":
    unittest.main()
