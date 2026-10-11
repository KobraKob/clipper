"""
Unit tests for GPU acceleration, NVENC detection, encoder argument construction,
and automatic CPU fallback.
"""

from __future__ import annotations

import pathlib
import subprocess
import unittest
from unittest.mock import MagicMock, patch

from clipper.config import Settings
from clipper.reframe import (
    build_encoder_args,
    build_fill_filter,
    clear_encoder_cache,
    detect_available_encoders,
    is_encoder_available,
    is_nvenc_available,
    render_vertical,
    resolve_encoder,
)


class TestGpuEncoder(unittest.TestCase):
    def setUp(self) -> None:
        clear_encoder_cache()
        self.settings = Settings(
            video_encoder="auto",
            nvenc_preset="p4",
            nvenc_cq=20,
            cpu_preset="fast",
            cpu_crf=18,
            enable_encoder_fallback=True,
        )

    def tearDown(self) -> None:
        clear_encoder_cache()

    def test_detect_available_encoders(self) -> None:
        """Verify detect_available_encoders returns dict with nvenc, qsv, and libx264."""
        with patch("clipper.reframe.is_nvenc_available", return_value=True), \
             patch("clipper.reframe.is_qsv_available", return_value=False):
            detected = detect_available_encoders()
            self.assertTrue(detected["h264_nvenc"])
            self.assertFalse(detected["h264_qsv"])
            self.assertTrue(detected["libx264"])

    def test_is_nvenc_available(self) -> None:
        """Verify is_nvenc_available delegates to is_encoder_available."""
        with patch("clipper.reframe.is_encoder_available") as mock_avail:
            mock_avail.return_value = True
            self.assertTrue(is_nvenc_available())
            mock_avail.assert_called_with("h264_nvenc")

            mock_avail.return_value = False
            self.assertFalse(is_nvenc_available())

    def test_resolve_encoder_auto_with_nvenc(self) -> None:
        """When auto is specified and NVENC is available, resolve to h264_nvenc."""
        with patch("clipper.reframe.is_nvenc_available", return_value=True):
            resolved = resolve_encoder("auto", fallback=True)
            self.assertEqual(resolved, "h264_nvenc")

    def test_resolve_encoder_auto_without_nvenc_or_qsv(self) -> None:
        """When auto is specified and no GPU encoder is available, resolve to libx264."""
        with patch("clipper.reframe.is_nvenc_available", return_value=False), \
             patch("clipper.reframe.is_qsv_available", return_value=False):
            resolved = resolve_encoder("auto", fallback=True)
            self.assertEqual(resolved, "libx264")

    def test_resolve_encoder_nvenc_requested_but_missing_with_fallback(self) -> None:
        """When h264_nvenc is explicitly requested but unavailable, fall back to libx264."""
        with patch("clipper.reframe.is_nvenc_available", return_value=False):
            resolved = resolve_encoder("h264_nvenc", fallback=True)
            self.assertEqual(resolved, "libx264")

    def test_resolve_encoder_nvenc_requested_but_missing_no_fallback_raises(self) -> None:
        """When h264_nvenc is requested but unavailable and fallback=False, raise ValueError."""
        with patch("clipper.reframe.is_nvenc_available", return_value=False):
            with self.assertRaises(ValueError):
                resolve_encoder("h264_nvenc", fallback=False)

    def test_build_encoder_args_nvenc(self) -> None:
        """Verify h264_nvenc command arguments match preset p4 and cq 20."""
        args = build_encoder_args("h264_nvenc", self.settings)
        self.assertIn("-c:v", args)
        self.assertIn("h264_nvenc", args)
        self.assertIn("-preset", args)
        self.assertIn("p4", args)
        self.assertIn("-cq", args)
        self.assertIn("20", args)
        self.assertIn("-pix_fmt", args)
        self.assertIn("yuv420p", args)

    def test_build_encoder_args_cpu(self) -> None:
        """Verify libx264 command arguments match preset fast and crf 18."""
        args = build_encoder_args("libx264", self.settings)
        self.assertIn("-c:v", args)
        self.assertIn("libx264", args)
        self.assertIn("-preset", args)
        self.assertIn("fast", args)
        self.assertIn("-crf", args)
        self.assertIn("18", args)

    def test_build_encoder_args_custom_overrides(self) -> None:
        """Verify preset and quality arguments can be overridden."""
        nvenc_args = build_encoder_args("h264_nvenc", self.settings, preset="p6", quality=24)
        self.assertIn("p6", nvenc_args)
        self.assertIn("24", nvenc_args)

        cpu_args = build_encoder_args("libx264", self.settings, preset="veryslow", quality=22)
        self.assertIn("veryslow", cpu_args)
        self.assertIn("22", cpu_args)

    def test_build_fill_filter_cuda_scale(self) -> None:
        """Verify CUDA scaling graph includes hwupload and scale_cuda when no captions."""
        filter_str = build_fill_filter(
            crop_w=608,
            crop_h=1080,
            crop_y=0,
            x_expr="0",
            out_w=1080,
            out_h=1920,
            ass_filter=None,
            use_cuda_scale=True,
        )
        self.assertIn("hwupload", filter_str)
        self.assertIn("scale_cuda=1080:1920:interp_algo=lanczos", filter_str)

    def test_build_fill_filter_cpu_scale_with_captions(self) -> None:
        """Verify captions filter maintains CPU scaling path to avoid host-device pingpong."""
        filter_str = build_fill_filter(
            crop_w=608,
            crop_h=1080,
            crop_y=0,
            x_expr="0",
            out_w=1080,
            out_h=1920,
            ass_filter="ass='clip.ass'",
            use_cuda_scale=True,  # Even if requested, captions must keep CPU chain
        )
        self.assertNotIn("scale_cuda", filter_str)
        self.assertIn("scale=1080:1920:flags=lanczos", filter_str)
        self.assertIn("ass='clip.ass'", filter_str)

    @patch("clipper.reframe.probe_video")
    @patch("clipper.reframe.compute_crop_geometry")
    @patch("clipper.reframe.track_face_x")
    @patch("subprocess.run")
    def test_render_vertical_gpu_to_cpu_fallback(
        self,
        mock_subprocess: MagicMock,
        mock_track: MagicMock,
        mock_crop: MagicMock,
        mock_probe: MagicMock,
    ) -> None:
        """
        Verify that if the chosen GPU encoder returns a non-zero exit code,
        render_vertical retries with CPU libx264 before reporting success.
        """
        probe_result = MagicMock()
        probe_result.width = 1920
        probe_result.height = 1080
        probe_result.fps = 30.0
        mock_probe.return_value = probe_result

        mock_crop.return_value = (608, 1080)
        mock_track.return_value = ([960.0] * 30, 1920, 1080, 30.0)

        # First call fails (GPU error), second call succeeds (CPU fallback)
        mock_subprocess.side_effect = [
            subprocess.CompletedProcess(
                args=["ffmpeg", "..."],
                returncode=1,
                stdout="",
                stderr="[h264_nvenc @ 0x123] OpenEncodeSessionEx failed: out of memory",
            ),
            subprocess.CompletedProcess(
                args=["ffmpeg", "..."],
                returncode=0,
                stdout="",
                stderr="",
            ),
        ]

        dummy_in = pathlib.Path("tests_workdir/dummy_in.mp4")
        dummy_out = pathlib.Path("tests_workdir/dummy_out.mp4")
        dummy_in.parent.mkdir(parents=True, exist_ok=True)
        dummy_out.parent.mkdir(parents=True, exist_ok=True)
        dummy_in.write_bytes(b"dummy mp4 data")
        dummy_out.write_bytes(b"dummy mp4 data")

        try:
            with patch("clipper.reframe.resolve_encoder", return_value="h264_nvenc"):
                out = render_vertical(
                    video_path=dummy_in,
                    out_path=dummy_out,
                    layout="fill",
                    encoder="h264_nvenc",
                    fallback_to_cpu=True,
                    s=self.settings,
                )
                self.assertEqual(out, dummy_out)
                self.assertEqual(mock_subprocess.call_count, 2)
                second_cmd = mock_subprocess.call_args_list[1][0][0]
                self.assertIn("libx264", second_cmd)
        finally:
            try:
                dummy_in.unlink()
            except OSError:
                pass
            try:
                dummy_out.unlink()
            except OSError:
                pass


if __name__ == "__main__":
    unittest.main()
