"""Synthetic test videos, encoded by the LGPL FFmpeg build (vie_worker.ff) — for AUTOMATED TESTS ONLY (ADR-020): they are created in
temporary directories during a test run and never enter the owner's workspace. Content is a moving gradient (or noise, for large
incompressible files); nothing in them pretends to be football.

  python otsi-vie/tools/dev/test_media.py <output dir>      writes clip.mp4 (with audio, several MiB) and not-a-video.mp4
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "worker"))
from vie_worker import ff  # noqa: E402


def encode(path: Path, *, width=320, height=240, seconds=3.0, fps=25, codec="mpeg4", container=None, vfr=False, audio=False,
           bit_rate=None, noise=False) -> Path:
    n = int(seconds * fps)
    cmd = [ff.tool("ffmpeg"), "-hide_banner", "-v", "error", "-y",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}", "-framerate", str(fps), "-i", "pipe:0"]
    if audio:
        cmd += ["-f", "lavfi", "-t", str(seconds), "-i", "anullsrc=r=48000:cl=mono"]
    vf = ["format=" + ("yuvj420p" if codec == "mjpeg" else "yuv420p")]
    if vfr:   # frame gaps 55, 30, 30 ms, repeating (variable frame rate)
        vf.insert(0, "settb=1/1000,setpts='floor(N/3)*115+55*gte(mod(N,3),1)+30*gte(mod(N,3),2)'")
    cmd += ["-map", "0:v", "-vf", ",".join(vf), "-c:v", codec, "-fps_mode", "passthrough" if vfr else "cfr"]
    if bit_rate:
        cmd += ["-b:v", str(bit_rate)]
    if audio:
        cmd += ["-map", "1:a", "-c:a", "aac", "-shortest"]
    if vfr and (container == "matroska" or str(path).endswith(".mkv")):
        cmd += ["-enc_time_base", "1/1000"]      # millisecond timestamps, as set by the filter
    if container:
        cmd += ["-f", container]
    cmd.append(str(path))
    rng = np.random.default_rng(7)
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=ff.NO_WINDOW)
    assert proc.stdin is not None
    for i in range(n):
        if noise:
            img = rng.integers(0, 256, (height, width, 3), dtype=np.uint8)
        else:
            img = np.zeros((height, width, 3), dtype=np.uint8)
            img[:, :, 0] = (np.arange(width) + i * 4) % 256
            img[:, :, 1] = (np.arange(height)[:, None] + i * 2) % 256
        try:
            proc.stdin.write(img.tobytes())
        except BrokenPipeError:
            break                                   # ffmpeg stopped: its error is reported below
    try:
        proc.stdin.close()
    except BrokenPipeError:
        pass
    err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    if proc.wait() != 0:
        raise RuntimeError(f"test media encode failed: {err[-400:]}")
    return path


if __name__ == "__main__":
    d = Path(sys.argv[1])
    d.mkdir(parents=True, exist_ok=True)
    encode(d / "clip.mp4", seconds=4, audio=True, bit_rate=8_000_000, noise=True)
    (d / "not-a-video.mp4").write_bytes(os.urandom(300_000))
    print(d)
