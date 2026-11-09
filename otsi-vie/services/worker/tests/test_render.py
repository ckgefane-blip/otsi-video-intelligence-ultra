"""Encoder backends and render validation (ADR-029). Synthetic frames, temporary files only (ADR-020). A backend that this machine cannot
run (no Intel GPU, no Cisco OpenH264 binary) is skipped with the reason — never reported as passing."""
from fractions import Fraction

import numpy as np
import pytest

from vie_worker import ff
from vie_worker.render import encoders as enc
from vie_worker.render.validate import validate

W, H, N, FPS = 640, 360, 48, Fraction(30)
CODEC = {"h264": "h264", "av1": "av1", "vp9": "vp9"}


def frames():
    for i in range(N):
        img = np.zeros((H, W, 3), np.uint8)
        img[:, :, 0] = (np.arange(W) + 6 * i) % 256
        img[:, :, 1] = (np.arange(H)[:, None] + 3 * i) % 256
        img[100:160, 50 + 8 * i:110 + 8 * i, 2] = 255           # a moving block
        yield img


@pytest.mark.parametrize("key", [b.key for b in enc.BACKENDS])
def test_every_available_backend_produces_a_valid_universally_playable_file(key, tmp_path):
    ok, why = enc.available(key)
    if not ok:
        pytest.skip(f"{key} not available here: {why}")
    b = enc.BY_KEY[key]
    out = tmp_path / f"out.{b.container}"
    r = enc.encode(frames(), str(out), width=W, height=H, fps=FPS, backend=b, quality=70)
    assert r.frames == N
    v = validate(str(out), codec=CODEC[b.family], width=W, height=H, frames=N, fps=float(FPS), audio=False)
    assert v["ok"], v["failures"]
    if b.family == "h264" and key != "openh264":
        assert v["profile"] == "High"
    if b.container == "mp4":
        assert v["faststart"] is True


def test_choose_prefers_intel_hardware_for_h264_and_explains_when_nothing_works(monkeypatch):
    b = enc.choose("h264")
    assert b.family == "h264"
    monkeypatch.setattr(enc, "available", lambda key: (False, "simulated: no encoder"))
    with pytest.raises(ff.FFmpegError, match="no h264 encoder is available"):
        enc.choose("h264")


def test_the_validator_catches_a_wrong_frame_count_and_a_missing_faststart(tmp_path):
    out = tmp_path / "v.mp4"
    b = enc.choose("h264")
    enc.encode(frames(), str(out), width=W, height=H, fps=FPS, backend=b)
    assert not validate(str(out), codec="h264", width=W, height=H, frames=N + 1, fps=float(FPS))["ok"]
    slow = tmp_path / "slow.mp4"                                           # remux without faststart: moov at the end
    r = ff.run(["-v", "error", "-y", "-i", str(out), "-c", "copy", "-movflags", "-faststart", str(slow)])
    assert r.returncode == 0
    v = validate(str(slow), codec="h264", width=W, height=H, frames=N, fps=float(FPS))
    assert not v["ok"] and any("faststart" in f for f in v["failures"])


def test_a_damaged_file_fails_validation(tmp_path):
    out = tmp_path / "d.mp4"
    enc.encode(frames(), str(out), width=W, height=H, fps=FPS, backend=enc.choose("h264"))
    data = bytearray(out.read_bytes())
    data[len(data) // 2: len(data) // 2 + 4000] = bytes(4000)             # zero a block in the middle of the media data
    out.write_bytes(bytes(data))
    assert not validate(str(out), codec="h264", width=W, height=H, frames=N, fps=float(FPS))["ok"]
