"""BEAT_GRID worker job (v3 C.5, ADR-105): unit tests for onset detection, tempo estimation,
beat tracking, and flat/silent signal handling.
"""
from __future__ import annotations

import numpy as np

from vie_worker.beat_job import SR, analyse, estimate_tempo, onset_envelope, track_beats


def make_synthetic_click_track(duration_s: float = 6.0, bpm: float = 120.0) -> np.ndarray:
    """Generate a clean synthetic beat track (a kick burst every 60/bpm seconds)"""
    n_samples = int(duration_s * SR)
    y = np.zeros(n_samples, dtype=np.float32)
    interval = int(round(SR * (60.0 / bpm)))
    decay = np.exp(-np.linspace(0, 10, int(0.05 * SR)))
    kick = (np.sin(2 * np.pi * 100 * np.linspace(0, 0.05, len(decay))) * decay).astype(np.float32)

    for i in range(0, n_samples - len(kick), interval):
        y[i : i + len(kick)] += kick
    return y


def test_onset_envelope_empty_and_flat():
    empty = np.zeros(0, dtype=np.float32)
    assert len(onset_envelope(empty)) == 0

    silent = np.zeros(SR * 2, dtype=np.float32)
    env = onset_envelope(silent)
    assert len(env) > 0
    assert not env.any()


def test_tempo_estimation_and_beat_tracking():
    # 6 seconds at 120 BPM = 12 beats, interval = 0.5s = 500,000 us
    y = make_synthetic_click_track(duration_s=6.0, bpm=120.0)
    res = analyse(y)

    assert res["tempo_bpm"] is not None
    assert 115.0 <= res["tempo_bpm"] <= 125.0
    assert res["periodicity"] >= 0.5
    assert len(res["beats_us"]) >= 8

    # Check that adjacent detected beats are spaced approximately 0.5s apart (+- 0.05s)
    diffs = np.diff(res["beats_us"]) / 1e6
    assert np.all(np.abs(diffs - 0.5) < 0.06)


def test_analyse_silent_audio_returns_no_steady_beat():
    # 5 seconds of silence
    y = np.zeros(SR * 5, dtype=np.float32)
    res = analyse(y)

    assert res["tempo_bpm"] is None
    assert res["beats_us"] == []
    assert res["periodicity"] == 0.0
    assert res["duration_us"] == 5_000_000
