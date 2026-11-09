"""The worker's only way to FFmpeg (ADR-029): the LGPL build in .local/ffmpeg-lgpl, run as SEPARATE PROCESSES (ffprobe / ffmpeg).

Nothing in the product links FFmpeg into Python any more (PyAV's wheels bundle a GPL build with libx264/libx265). Before first use the
binaries' own licence report is checked: a GPL or nonfree build is refused unless OTSI_VIE_ALLOW_GPL_FFMPEG=1 (developer machines only).

  binaries   OTSI_VIE_FFMPEG_DIR = directory with ffmpeg(.exe) and ffprobe(.exe); default: <repo>/.local/ffmpeg-lgpl/<current.txt>/main/bin
  time       every timestamp handed out is microseconds since the video's first decoded frame (pts_us), exactly as before
"""
from __future__ import annotations

import json
import os
import queue
import re
import subprocess
import threading
from dataclasses import dataclass
from fractions import Fraction
from functools import lru_cache
from pathlib import Path
from typing import Iterator

import numpy as np

ROOT = Path(__file__).resolve().parents[4]
EXE = ".exe" if os.name == "nt" else ""
NO_WINDOW = 0x08000000 if os.name == "nt" else 0          # CREATE_NO_WINDOW: no console flashes from worker subprocesses


class FFmpegError(RuntimeError):
    pass


def bin_dir(tree: str = "main") -> Path:
    env = os.environ.get("OTSI_VIE_FFMPEG_DIR") if tree == "main" else None
    if env:
        return Path(env)
    base = ROOT / ".local" / "ffmpeg-lgpl"
    cur = base / "current.txt"
    if not cur.exists():
        raise FFmpegError("The LGPL FFmpeg build is not installed: run otsi-vie/tools/ffmpeg/build_ffmpeg.py")
    return base / cur.read_text(encoding="utf-8").strip() / tree / "bin"


def tool(name: str, tree: str = "main") -> str:
    p = bin_dir(tree) / f"{name}{EXE}"
    if not p.exists():
        raise FFmpegError(f"{p} is missing")
    _check_licence(str(p))
    return str(p)


@lru_cache(maxsize=None)
def _check_licence(exe: str) -> None:
    lic = " ".join(subprocess.run([exe, "-hide_banner", "-L"], capture_output=True, text=True, creationflags=NO_WINDOW).stdout.split())   # the text wraps
    conf = subprocess.run([exe, "-hide_banner", "-buildconf"], capture_output=True, text=True, creationflags=NO_WINDOW).stdout
    gpl = "GNU General Public License" in lic or re.search(r"--enable-(gpl|nonfree)\b", conf)
    if gpl and os.environ.get("OTSI_VIE_ALLOW_GPL_FFMPEG") != "1":
        raise FFmpegError(f"{exe} is a GPL or nonfree FFmpeg build; the product uses only the LGPL build (ADR-029)")


def run(args: list[str], *, timeout: float | None = None, tree: str = "main", binary: str = "ffmpeg") -> subprocess.CompletedProcess:
    return subprocess.run([tool(binary, tree), *args], capture_output=True, timeout=timeout, creationflags=NO_WINDOW)


def ffprobe_json(path: str, *args: str, timeout: float | None = 120) -> dict:
    r = run(["-v", "error", "-print_format", "json", *args, path], timeout=timeout, binary="ffprobe")
    if r.returncode != 0:
        raise FFmpegError(r.stderr.decode("utf-8", "replace").strip()[-500:] or f"ffprobe exited {r.returncode}")
    return json.loads(r.stdout or b"{}")


def rate(s: str | None) -> Fraction | None:
    if not s or s in ("0/0", "0"):
        return None
    try:
        f = Fraction(s)
    except (ValueError, ZeroDivisionError):
        return None
    return f if f > 0 else None


def video_streams(info: dict) -> list[dict]:
    """Real video streams: cover art (attached pictures) is not the match video."""
    return [s for s in info.get("streams", []) if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")]


def main_video(info: dict) -> dict | None:
    vs = video_streams(info)
    return max(vs, key=lambda s: (s.get("width") or 0) * (s.get("height") or 0)) if vs else None


def first_frame_time(path: str, selector: str) -> float | None:
    """Presentation time (s) of the first DECODED frame of a stream (`v:0`, `a:0`), in FFmpeg's normalised timeline."""
    info = ffprobe_json(path, "-select_streams", selector, "-show_entries", "frame=pts_time,best_effort_timestamp_time", "-read_intervals", "%+#1")
    for f in info.get("frames", []):
        t = f.get("pts_time") or f.get("best_effort_timestamp_time")
        if t not in (None, "N/A"):
            return float(t)
    return None


# ------------------------------------------------------------------------------------------------------------- sampled decoding
@dataclass
class DecodedFrame:
    frame_index: int          # display-order index of the frame among all decoded frames of the stream
    pts_us: int               # microseconds since the first decoded frame
    keyframe: bool
    rgb: np.ndarray           # (H, W, 3) uint8, possibly downscaled for analysis
    width: int                # decoded (source) frame size the boxes are normalised to
    height: int


_SHOWINFO = re.compile(r"\[Parsed_showinfo_(\d+)[^\]]*\]\s+n:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:(-?[\d.]+).*?iskey:(\d)")


def decode_sampled(path: str, sample_fps: float | None, *, max_width: int | None = None, start_us: int = 0, end_us: int | None = None,
                   seek: bool = False, stream: str = "v:0", width: int | None = None, height: int | None = None, gray: bool = False,
                   vf: str | None = None) -> Iterator[DecodedFrame]:
    """Decode a video stream and yield frames on a time grid of `sample_fps` (None: every frame).

    Filter chain `showinfo, select, showinfo`: the first showinfo (Parsed_showinfo_0) reports every decoded frame (display index, pts),
    the second (Parsed_showinfo_2) every selected one; pairing them by pts gives each yielded frame its exact source frame index and
    presentation time, also for variable frame rates. Times are relative to the first decoded frame. The picture is never rotated
    (boxes are normalised to the stored frame, as the probe measured it).

    end_us: stop after this time. seek: jump near start_us first (fast, for a window late in a long video); frame_index then counts from
    the seek point, so only pts_us identifies a frame (renderer windows); without seek frame_index is the source display index.
    gray: one luma channel per frame ((H, W) uint8) instead of RGB, a third of the data (the per-frame follower, vie_worker.follow).
    vf: one more filter on the RGB frames (the renderer's colour look, lut3d; ADR-068)."""
    if width is None or height is None:
        v = main_video(ffprobe_json(path, "-show_streams"))
        if not v:
            raise FFmpegError("no video stream")
        width, height = int(v["width"]), int(v["height"])
    t0 = first_frame_time(path, stream) or 0.0
    ow, oh = width, height
    if max_width and width > max_width:
        ow, oh = max_width, int(round(height * max_width / width / 2)) * 2
    chain = ["showinfo=checksum=0"]
    window = f"gte(t,{t0 + start_us / 1e6 - 0.0005:.6f})" + (f"*lt(t,{t0 + end_us / 1e6:.6f})" if end_us is not None else "")
    if not sample_fps and (start_us or end_us is not None):
        chain += [f"select='{window}'", "showinfo=checksum=0"]
    elif sample_fps:
        step = 1.0 / sample_fps
        # the first frame at/after start, then each frame at least one step (minus 0.5 ms) after the previously selected one
        chain += [f"select='{window}*(isnan(prev_selected_t)+gte(t-prev_selected_t,{step - 0.0005:.6f}))'",
                  "showinfo=checksum=0"]
    if (ow, oh) != (width, height):
        chain.append(f"scale={ow}:{oh}:flags=area")
    chain.append("format=gray" if gray else "format=rgb24")
    if vf and not gray:
        chain += [vf, "format=rgb24"]
    seek_s = max(0.0, t0 + start_us / 1e6 - 3.0) if seek and start_us > 3_000_000 else None
    pre = ["-ss", f"{seek_s:.3f}"] if seek_s is not None else []      # land on a keyframe before the window
    if end_us is not None:
        # stop reading just after the window: `select` only drops frames, so without this FFmpeg decodes (and discards) the rest of the file,
        # minutes for a short window early in a full match
        pre += ["-t", f"{t0 + end_us / 1e6 - (seek_s or 0.0) + 1.0:.3f}"]
    cmd = [tool("ffmpeg"), "-hide_banner", "-nostdin", "-nostats", "-loglevel", "info", "-noautorotate", "-copyts", *pre, "-i", path,
           "-map", f"0:{stream}", "-vf", ",".join(chain), "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "gray" if gray else "rgb24", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=NO_WINDOW)
    selected: "queue.Queue[tuple[int, float, bool] | None]" = queue.Queue()
    tail: list[str] = []
    out_filter = "2" if len([c for c in chain if c.startswith("showinfo")]) > 1 else "0"

    def read_log() -> None:
        index_of: dict[str, tuple[int, bool]] = {}
        assert proc.stderr is not None
        for raw in proc.stderr:
            line = raw.decode("utf-8", "replace")
            m = _SHOWINFO.search(line)
            if not m:
                tail.append(line)
                del tail[:-20]
                continue
            fid, n, pts, t, key = m.group(1), int(m.group(2)), m.group(3), float(m.group(4)), m.group(5) == "1"
            if fid == out_filter:
                src_n, k = index_of.pop(pts, (n, key)) if out_filter == "2" else (n, key)
                selected.put((src_n, t, k))
            else:
                index_of[pts] = (n, key)
                if len(index_of) > 4096:                      # a selected frame is always among the latest ones
                    for old in list(index_of)[:2048]:
                        index_of.pop(old)
        selected.put(None)

    reader = threading.Thread(target=read_log, daemon=True)
    reader.start()
    size = ow * oh * (1 if gray else 3)
    yielded = 0
    try:
        assert proc.stdout is not None
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            meta = selected.get(timeout=120)
            if meta is None:
                break
            n, t, key = meta
            yielded += 1
            yield DecodedFrame(n, int(round((t - t0) * 1_000_000)), key, np.frombuffer(buf, np.uint8).reshape((oh, ow) if gray else (oh, ow, 3)), width, height)
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
        reader.join(timeout=5)
    if yielded == 0 and proc.returncode not in (0, None):
        raise FFmpegError("".join(tail)[-500:] or f"ffmpeg exited {proc.returncode}")
