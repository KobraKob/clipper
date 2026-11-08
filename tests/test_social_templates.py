import pathlib
import shutil
import subprocess
import tempfile
import unittest

from PIL import Image

from clipper.social_templates import (
    SOCIAL_TEMPLATES,
    apply_social_template,
    create_social_template_canvas,
    normalize_profile,
    validate_social_template,
)


class TestSocialTemplateCanvas(unittest.TestCase):
    def test_template_validation_and_profile_normalization(self):
        self.assertEqual(validate_social_template("X"), "x")
        self.assertEqual(validate_social_template(None), "none")
        with self.assertRaises(ValueError):
            validate_social_template("facebook")
        self.assertEqual(
            normalize_profile("  Sample   Creator ", "sample_creator"),
            ("Sample Creator", "@sample_creator"),
        )

    def test_all_templates_create_bounded_video_windows(self):
        with tempfile.TemporaryDirectory() as temp:
            for template in SOCIAL_TEMPLATES:
                if template == "none":
                    continue
                path = pathlib.Path(temp) / f"{template}.png"
                canvas, rect = create_social_template_canvas(
                    path,
                    template,
                    width=540,
                    height=960,
                    title="A useful headline for creators",
                    hook="Why creators should frame the whole story",
                    display_name="Sample Creator",
                    handle="@samplecreator",
                    seo={"hashtags": ["#CreatorTips", "#VideoEditing"]},
                )
                self.assertTrue(canvas.is_file())
                self.assertEqual(Image.open(canvas).size, (540, 960))
                x, y, width, height = rect
                self.assertGreater(x, 0)
                self.assertGreater(y, 0)
                self.assertGreater(width, 0)
                self.assertGreater(height, 0)
                self.assertLessEqual(x + width, 540)
                self.assertLessEqual(y + height, 960)
                image = Image.open(canvas).convert("RGB")
                self.assertEqual(image.getpixel((x + width // 2, y + height // 2)), (5, 6, 7))
                self.assertEqual(image.getpixel((max(0, x - 4), y + height // 2)), (48, 54, 61))

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg is required")
    def test_apply_template_preserves_vertical_video_and_audio(self):
        with tempfile.TemporaryDirectory() as temp:
            source = pathlib.Path(temp) / "source.mp4"
            command = [
                "ffmpeg",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=duration=1.2:size=360x640:rate=15",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1.2",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-c:a",
                "aac",
                str(source),
            ]
            subprocess.run(command, check=True, capture_output=True)
            result = apply_social_template(
                source,
                "headline",
                title="The important detail",
                hook="Why this small detail changes everything",
                encoder="libx264",
            )
            self.assertEqual(result, source)
            self.assertGreater(source.stat().st_size, 1000)
            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "stream=codec_type,width,height",
                    "-of",
                    "default=noprint_wrappers=1",
                    str(source),
                ],
                check=True,
                capture_output=True,
                text=True,
            ).stdout
            self.assertIn("width=360", probe)
            self.assertIn("height=640", probe)
            self.assertIn("codec_type=audio", probe)


if __name__ == "__main__":
    unittest.main()
