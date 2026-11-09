"""A playback copy that loses its job must not leave its encoder running (regression: lost jobs left ffmpeg processes writing the same file
while the next attempt encoded it again), and a normal encode must still finish and produce the file."""
from __future__ import annotations

import subprocess

import pytest

from vie_worker.jobs import LeaseLost
from vie_worker.proxy import encode_proxy


def _encoders_for(path: str) -> list[str]:
    out = subprocess.run(["powershell", "-NoProfile", "-Command",
                          f"Get-CimInstance Win32_Process | Where-Object {{ $_.Name -eq 'ffmpeg.exe' -and $_.CommandLine -like '*{path}*' }} | Select-Object -ExpandProperty ProcessId"],
                         capture_output=True, text=True).stdout.split()
    return out


def test_losing_the_lease_stops_the_encoder(media, tmp_path):
    dst = str(tmp_path / "lost.webm.partial")

    def lose(_pct: float) -> None:
        raise LeaseLost()

    with pytest.raises(LeaseLost):
        encode_proxy(str(media["mp4"]), dst, lose)
    assert _encoders_for(dst.replace("\\", "/").split("/")[-1]) == []


def test_a_normal_encode_still_finishes(media, tmp_path):
    dst = tmp_path / "ok.webm"
    seen: list[float] = []
    info = encode_proxy(str(media["mp4"]), str(dst), seen.append)
    assert dst.exists() and dst.stat().st_size > 0
    assert info["frames"] > 0 and (not seen or max(seen) <= 99.0)
