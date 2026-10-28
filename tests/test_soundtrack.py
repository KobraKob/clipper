import unittest

import numpy as np

from clipper.soundtrack import _energy_envelope, _estimate_bpm, select_soundtrack_offset


class TestSoundtrackAnalysis(unittest.TestCase):
    def test_energy_envelope_is_bounded_and_normalized(self):
        samples = np.tile(np.array([0, 8000, -8000, 0], dtype=np.int16), 3000)
        envelope = _energy_envelope(samples, samples_per_frame=300)
        self.assertGreater(len(envelope), 0)
        self.assertGreater(float(np.max(envelope)), 0.95)
        self.assertLessEqual(float(np.max(envelope)), 1.0)

    def test_tempo_estimator_returns_a_plausible_music_bpm(self):
        # Synthetic energy pulses every half second represent a 120 BPM beat.
        envelope = np.zeros(500, dtype=np.float32)
        for start in range(0, len(envelope), 5):
            envelope[start : min(len(envelope), start + 2)] = [1.0, 0.45][: min(2, len(envelope) - start)]
        bpm = _estimate_bpm(envelope)
        self.assertIsNotNone(bpm)
        self.assertGreaterEqual(float(bpm), 65.0)
        self.assertLessEqual(float(bpm), 180.0)

    def test_section_picker_prefers_high_energy_and_snaps_to_beat(self):
        envelope = np.zeros(300, dtype=np.float32)
        envelope[80:145] = 0.85
        envelope[90:105] = 1.0
        profile = {"energy": envelope, "frame_seconds": 0.1, "bpm": 120.0}
        offset = select_soundtrack_offset(profile, clip_duration=2.0, clip_rank=1)
        self.assertGreaterEqual(offset, 7.0)
        self.assertLessEqual(offset, 12.0)
        # At 120 BPM the chosen start should be close to a half-second beat.
        self.assertAlmostEqual(offset * 2, round(offset * 2), places=2)

    def test_longer_clip_can_start_at_zero_when_track_is_short(self):
        profile = {
            "energy": np.ones(20, dtype=np.float32),
            "frame_seconds": 0.1,
            "bpm": None,
        }
        self.assertEqual(select_soundtrack_offset(profile, clip_duration=10.0), 0.0)
    def test_music_section_selection_matches_clip_energy_target(self):
        envelope = np.full(300, 0.25, dtype=np.float32)
        envelope[30:90] = 0.15
        envelope[150:210] = 0.95
        profile = {"energy": envelope, "frame_seconds": 0.1, "bpm": None}
        calm_offset = select_soundtrack_offset(profile, clip_duration=2.0, target_energy=0.15)
        energetic_offset = select_soundtrack_offset(profile, clip_duration=2.0, target_energy=0.95)
        self.assertGreaterEqual(calm_offset, 2.5)
        self.assertLessEqual(calm_offset, 9.0)
        self.assertGreaterEqual(energetic_offset, 14.5)
        self.assertLessEqual(energetic_offset, 21.0)
        self.assertGreater(energetic_offset, calm_offset + 5)


if __name__ == "__main__":
    unittest.main()
