"""Replaceable video encoders for rendered output (Block 11; ADR-029, owner decision E2 2026-10-27).

The compositor hands RGB frames to `encode()`; WHICH encoder turns them into a file is a registry entry with its licence and
verification status, recorded in every render's manifest. Nothing outside this module knows encoder names or options.

Every backend runs inside an LGPL FFmpeg build as a separate process. Preference for H.264: Intel hardware (oneVPL/QSV, then Media
Foundation), then OpenH264 — only with Cisco's own binary. VP9 and AV1 are royalty-free alternatives.

Status vocabulary (kept separate on purpose): `tested` = benchmarked and validated on this machine (release-evidence), `legal` =
reviewed by counsel, `commercial` = owner-approved for paid export. A backend is offered for production only when all three are true;
today none is (E3 legal review pending), so renders are development/testing output only.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from dataclasses import dataclass, field
from fractions import Fraction
from functools import lru_cache
from pathlib import Path
from typing import Iterable

import numpy as np

from .. import ff

CISCO_OPENH264 = "openh264-2.5.0-win64.dll"


@dataclass(frozen=True)
class Backend:
    key: str
    family: str                       # h264 | vp9 | av1
    ffmpeg_encoder: str
    tree: str                         # which LGPL FFmpeg tree runs it: "main" or "openh264"
    container: str                    # mp4 | webm
    pix_fmt: str
    hardware: str | None              # e.g. "Intel Quick Sync (oneVPL)"; None = software
    licence_note: str
    quality_args: tuple[str, ...]     # rate control for a quality level 1 (low) .. 100 (high), filled by args()

    def args(self, quality: int, gop: int, profile: str | None, bitrate: int | None = None) -> list[str]:
        if bitrate:   # a target bitrate (bits/s) instead of a quality level: same rate for every encoder, for fair comparisons and presets
            br, mx, buf = str(bitrate), str(int(bitrate * 1.5)), str(bitrate * 2)
            a = {"intel-qsv-h264": ["-preset", "medium", "-b:v", br, "-maxrate", mx, "-bufsize", buf],
                 "intel-qsv-av1": ["-preset", "medium", "-b:v", br, "-maxrate", mx, "-bufsize", buf],
                 "mf-h264": ["-hw_encoding", "1", "-rate_control", "u_vbr", "-b:v", br],
                 "openh264": ["-rc_mode", "bitrate", "-b:v", br, "-maxrate", mx, "-allow_skip_frames", "0"],
                 "svt-av1": ["-preset", "8", "-b:v", br],
                 "libvpx-vp9": ["-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-b:v", br, "-maxrate", mx, "-bufsize", buf]}[self.key]
        else:
            q = max(1, min(100, quality))
            a = [x.format(q=q, cq=int(round(51 - q * 0.33)), crf=int(round(63 - q * 0.45)), mfq=q) for x in self.quality_args]
        a += ["-g", str(gop)]
        if profile and self.family == "h264" and self.key != "openh264":
            # h264_mf takes the numeric H.264 profile_idc (High = 100, Main = 77); h264_qsv takes the name
            a += ["-profile:v", {"high": "100", "main": "77"}.get(profile, profile) if self.key == "mf-h264" else profile]
        return a


BACKENDS: tuple[Backend, ...] = (
    Backend("intel-qsv-h264", "h264", "h264_qsv", "main", "mp4", "nv12", "Intel Quick Sync (oneVPL)",
            "LGPL FFmpeg + MIT oneVPL; encoder in the Intel graphics driver (driver licence); H.264 patents: counsel (E3)",
            ("-preset", "medium", "-global_quality", "{cq}", "-look_ahead", "0")),
    Backend("mf-h264", "h264", "h264_mf", "main", "mp4", "nv12", "Windows Media Foundation (Intel MFT when present)",
            "LGPL FFmpeg; encoder from Windows / Intel driver (their terms); H.264 patents: counsel (E3)",
            ("-hw_encoding", "1", "-rate_control", "quality", "-quality", "{mfq}")),
    Backend("openh264", "h264", "libopenh264", "openh264", "mp4", "yuv420p", None,
            "LGPL FFmpeg (separate minimal tree) + Cisco's OpenH264 binary, whose H.264 royalties Cisco covers; a self-built OpenH264 is not covered",
            ("-rc_mode", "quality", "-b:v", "0", "-allow_skip_frames", "0")),
    Backend("intel-qsv-av1", "av1", "av1_qsv", "main", "mp4", "nv12", "Intel Quick Sync (oneVPL)",
            "LGPL FFmpeg + MIT oneVPL; AV1 royalty-free (AOMedia licence); third-party pool claims: counsel (E3)",
            ("-preset", "medium", "-global_quality", "{cq}")),
    Backend("svt-av1", "av1", "libsvtav1", "main", "mp4", "yuv420p", None,
            "LGPL FFmpeg + SVT-AV1 (BSD-3-Clause-Clear + AOMedia patent licence)",
            ("-preset", "8", "-crf", "{crf}")),
    Backend("libvpx-vp9", "vp9", "libvpx-vp9", "main", "webm", "yuv420p", None,
            "LGPL FFmpeg + libvpx (BSD-3 + WebM patent grant)",
            ("-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-crf", "{crf}", "-b:v", "0")),
)
BY_KEY = {b.key: b for b in BACKENDS}


def openh264_runtime() -> Path | None:
    """Cisco's DLL next to the OpenH264 tree, verified against the SHA-256 recorded when it was obtained (cisco_openh264.json)."""
    try:
        d = ff.bin_dir("openh264")
    except ff.FFmpegError:
        return None
    rec = d / "cisco_openh264.json"
    if not rec.exists():
        return None
    meta = json.loads(rec.read_text(encoding="utf-8"))
    dll = d / meta["installed_as"]
    if not dll.exists() or hashlib.sha256(dll.read_bytes()).hexdigest() != meta["sha256"]:
        return None
    return dll


@lru_cache(maxsize=None)
def available(key: str) -> tuple[bool, str]:
    """Can this backend encode on this machine? A real 16-frame test encode (hardware and drivers are only proven by using them)."""
    b = BY_KEY[key]
    if b.key == "openh264" and openh264_runtime() is None:
        return False, "Cisco's OpenH264 binary is not installed (see tools/ffmpeg/README.md)"
    try:
        exe = ff.tool("ffmpeg", b.tree)
    except ff.FFmpegError as e:
        return False, str(e)
    if b.tree == "main":
        r = subprocess.run([exe, "-hide_banner", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-frames:v", "16",
                            "-pix_fmt", b.pix_fmt, "-c:v", b.ffmpeg_encoder, *b.args(70, 30, "high" if b.family == "h264" else None), "-f", "null", "-"],
                           capture_output=True, timeout=120, creationflags=ff.NO_WINDOW)
    else:   # the minimal OpenH264 tree has only raw input and the MP4 muxer: encode 16 grey frames into a temporary file
        import os
        import tempfile
        fd, tmp = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)
        try:
            r = subprocess.run([exe, "-hide_banner", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", "640x360", "-r", "30",
                                "-i", "pipe:0", "-frames:v", "16", "-c:v", b.ffmpeg_encoder, *b.args(70, 30, None), "-f", "mp4", tmp],
                               input=bytes([128]) * (640 * 360 * 3 // 2 * 16), capture_output=True, timeout=120, creationflags=ff.NO_WINDOW)
        finally:
            os.remove(tmp)
    return (r.returncode == 0, "ok" if r.returncode == 0 else r.stderr.decode("utf-8", "replace").strip()[-300:])


def choose(family: str = "h264", prefer: str | None = None) -> Backend:
    order = ([BY_KEY[prefer]] if prefer else []) + [b for b in BACKENDS if b.family == family and b.key != prefer]
    reasons = []
    for b in order:
        ok, why = available(b.key)
        if ok:
            return b
        reasons.append(f"{b.key}: {why}")
    raise ff.FFmpegError(f"no {family} encoder is available here — " + "; ".join(reasons))


@dataclass
class EncodeResult:
    path: str
    backend: str
    frames: int
    seconds: float
    cpu_seconds: float | None = None          # CPU time of the encoder process (user + system), sampled until it exits
    command: list[str] = field(default_factory=list)


def encode(frames: Iterable[np.ndarray], out_path: str, *, width: int, height: int, fps: Fraction | float, backend: Backend,
           quality: int = 70, audio_from: str | None = None, profile: str = "high", bitrate: int | None = None,
           duration_s: float | None = None) -> EncodeResult:
    """Encode RGB frames (H, W, 3 uint8, constant frame rate) to `out_path`. Optional audio is copied from another file and
    re-encoded (AAC in MP4, Opus in WebM). MP4 output is 'faststart' (moov first) so it plays while downloading."""
    import time
    fps = Fraction(fps).limit_denominator(1001)
    gop = max(1, int(round(float(fps)))) * 2
    exe = ff.tool("ffmpeg", backend.tree)
    cmd = [exe, "-hide_banner", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{width}x{height}",
           "-framerate", f"{fps.numerator}/{fps.denominator}", "-i", "pipe:0"]
    if audio_from:
        # the picture sets the length: sound a few samples short is padded with silence, never the picture cut (owner 2026-11-02, RENDER_INVALID)
        # 2026-11-07: with the reel's planned length the sound is padded and cut to exactly that length. "-shortest" against an endless
        # pad stopped late (the muxer's queue): the sound ran ~0.2 s past the last picture under the end screen.
        af = f"apad=whole_dur={duration_s:.6f},atrim=end={duration_s:.6f}" if duration_s else "apad"
        cmd += ["-i", audio_from, "-map", "0:v", "-map", "1:a?", "-af", af] + ([] if duration_s else ["-shortest"])
        cmd += ["-c:a", "aac", "-b:a", "160k"] if backend.container == "mp4" else ["-c:a", "libopus", "-b:a", "128k"]
    # RGB -> YUV with the BT.709 matrix, limited range: the same colour standard the stream is tagged with (HD video)
    cmd += ["-vf", f"scale=out_color_matrix=bt709:out_range=tv,format={backend.pix_fmt}", "-c:v", backend.ffmpeg_encoder, *backend.args(quality, gop, profile, bitrate),
            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]
    if backend.container == "mp4":
        cmd += ["-movflags", "+faststart", "-f", "mp4"]
    else:
        cmd += ["-f", "webm"]
    cmd.append(out_path)
    t = time.perf_counter()
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=ff.NO_WINDOW)
    cpu = _CpuSampler(proc.pid)
    n = 0
    assert proc.stdin is not None
    try:
        for f in frames:
            if f.shape != (height, width, 3):
                raise ValueError(f"frame {n} is {f.shape}, expected {(height, width, 3)}")
            proc.stdin.write(np.ascontiguousarray(f, dtype=np.uint8).tobytes())
            n += 1
    finally:
        proc.stdin.close()
    err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    code = proc.wait()
    cpu.stop()
    if code != 0:
        raise ff.FFmpegError(f"{backend.key} failed: {err.strip()[-400:]}")
    return EncodeResult(out_path, backend.key, n, time.perf_counter() - t, cpu.seconds, cmd[1:])


class _CpuSampler:
    """CPU time of a child process: psutil cannot read a process after it exits, so the last sample before exit is kept."""

    def __init__(self, pid: int):
        import threading
        self.seconds: float | None = None
        self._stop = threading.Event()
        try:
            import psutil
            self._p = psutil.Process(pid)
        except Exception:  # noqa: BLE001 - measurement is optional
            self._p = None
            return
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                c = self._p.cpu_times()
                self.seconds = c.user + c.system
            except Exception:  # noqa: BLE001 - the process ended
                return
            self._stop.wait(0.1)

    def stop(self) -> None:
        self._stop.set()
        if self._p is not None:
            self._t.join(timeout=2)
