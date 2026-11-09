"""Benchmark and validate every encoder backend on real football footage (ADR-029; owner decision E2: no encoder is treated as
production-ready before it is benchmarked and verified).

The SAME decoded frames (LGPL FFmpeg, every frame of a window of the clip) go to every available backend at the same quality setting.
Measured per backend: encode speed (frames/s, wall clock incl. piping), bitrate, PSNR and SSIM against the source frames (FFmpeg's psnr /
ssim filters), and the render validator's verdict (codec, profile, pixel format, exact frame count, duration, faststart, full decode).

  python otsi-vie/tools/media/benchmark_encoders.py <video> --start 0 --seconds 10 --out release-evidence/encoder-benchmark/<date>
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import re
import sys
import tempfile
from fractions import Fraction
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / "services" / "worker"))
from vie_worker import ff  # noqa: E402
from vie_worker.render import encoders as enc  # noqa: E402
from vie_worker.render.validate import validate  # noqa: E402

PROFILES = {"h264": ("High", "Main", "Constrained Baseline", "Baseline"), "av1": ("Main",), "vp9": ("Profile 0",)}


def quality_vs_source(out: str, ref_raw: str, w: int, h: int, fps: Fraction) -> dict:
    """PSNR (Y) and SSIM of the encoded file against the exact frames it was made from (raw RGB reference, converted with the same
    BT.709 matrix the encoders use). Frames are paired by position: both sides get the same time base and pts = frame number."""
    pair = (f"[0:v]settb=1/{fps.numerator},setpts=N*{fps.denominator},format=yuv420p[a];"
            f"[1:v]settb=1/{fps.numerator},setpts=N*{fps.denominator},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[b];[a][b]")
    res = {}
    for metric, rx in (("psnr", r"PSNR y:([\d.]+|inf)"), ("ssim", r"SSIM .*All:([\d.]+)")):
        r = ff.run(["-hide_banner", "-nostdin", "-i", out, "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}",
                    "-framerate", f"{fps.numerator}/{fps.denominator}", "-i", ref_raw, "-lavfi", pair + metric, "-f", "null", "-"], timeout=3600)
        m = re.search(rx, r.stderr.decode("utf-8", "replace"))
        res[metric] = None if not m or m.group(1) == "inf" else float(m.group(1))
    return {"psnr_y_db": res["psnr"], "ssim_all": res["ssim"]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--start", type=float, default=0)
    ap.add_argument("--seconds", type=float, default=10)
    ap.add_argument("--quality", type=int, default=70)
    ap.add_argument("--bitrate", type=int, default=None, help="target bits/s for every encoder (equal-bitrate comparison)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    info = ff.ffprobe_json(a.video, "-show_streams")
    v = ff.main_video(info)
    fps = ff.rate(v.get("avg_frame_rate")) or Fraction(30)
    frames = []
    for f in ff.decode_sampled(a.video, None):
        if f.pts_us >= (a.start + a.seconds) * 1e6:
            break
        if f.pts_us >= a.start * 1e6:
            frames.append(f.rgb)
    h, w = frames[0].shape[:2]
    work = Path(tempfile.mkdtemp(prefix="encbench-", dir=os.environ.get("TEMP")))
    ref = work / "ref.rgb"
    with open(ref, "wb") as f:
        for fr in frames:
            f.write(fr.tobytes())
    rows = []
    for b in enc.BACKENDS:
        ok, why = enc.available(b.key)
        row = {"backend": b.key, "family": b.family, "encoder": b.ffmpeg_encoder, "hardware": b.hardware, "licence_note": b.licence_note, "available": ok}
        if not ok:
            row["not_available_because"] = why
            rows.append(row)
            print(f"{b.key:16s} not available: {why}")
            continue
        path = str(work / f"{b.key}.{b.container}")
        try:
            res = enc.encode(iter(frames), path, width=w, height=h, fps=fps, backend=b, quality=a.quality, bitrate=a.bitrate)
        except ff.FFmpegError as e:
            row.update(available=True, error=str(e)[-300:])
            rows.append(row)
            print(f"{b.key:16s} FAILED: {e}")
            continue
        val = validate(path, codec={"h264": "h264", "av1": "av1", "vp9": "vp9"}[b.family], width=w, height=h, frames=len(frames), fps=float(fps),
                       audio=False, profiles=PROFILES[b.family])
        q = quality_vs_source(path, str(ref), w, h, fps)
        cores = os.cpu_count() or 1
        row.update({"cpu_seconds": round(res.cpu_seconds, 2) if res.cpu_seconds is not None else None,
                    "cpu_percent_of_machine": round(100 * res.cpu_seconds / res.seconds / cores, 1) if res.cpu_seconds else None,
                    "cpu_cores_busy": round(res.cpu_seconds / res.seconds, 2) if res.cpu_seconds else None})
        keep = out / "files"
        keep.mkdir(exist_ok=True)
        import shutil
        shutil.copy(path, keep / Path(path).name)                 # kept for the browser playback check
        row.update({"frames": res.frames, "encode_fps": round(res.frames / res.seconds, 1), "mbit_s": round(os.path.getsize(path) * 8 / (len(frames) / float(fps)) / 1e6, 2),
                    **q, "validation": {k: val[k] for k in ("ok", "failures", "profile", "level", "pix_fmt", "frames", "faststart")}})
        rows.append(row)
        print(f"{b.key:16s} cpu {row['cpu_cores_busy']} cores {row['encode_fps']:7.1f} fps {row['mbit_s']:6.2f} Mbit/s PSNR {q['psnr_y_db']} SSIM {q['ssim_all']} valid={val['ok']} {val['profile']}")
    manifest = json.loads((ff.bin_dir().parents[1] / "BUILD_MANIFEST.json").read_text(encoding="utf-8"))
    report = {"generated": dt.datetime.now().isoformat(timespec="seconds"), "machine": platform.processor(), "video": Path(a.video).name,
              "window_s": [a.start, a.start + a.seconds], "frames": len(frames), "size": [w, h], "fps": str(fps), "quality_setting": a.quality, "target_bitrate": a.bitrate,
              "ffmpeg_build": manifest["build_id"], "results": rows,
              "status_note": "tested = benchmarked + validated here. Not legally reviewed, not commercially approved (E3 pending)."}
    (out / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    for p in work.iterdir():
        p.unlink()
    work.rmdir()
    print("written", out / "report.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
