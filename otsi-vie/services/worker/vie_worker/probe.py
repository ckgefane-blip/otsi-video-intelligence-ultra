"""Media probe, run as its OWN process with a time limit (vie_worker.media.probe): it parses untrusted files, so a decoder crash or hang
cannot take the worker down. Prints one JSON object. Everything reported is measured from the file; nothing is guessed.

  python -I -m vie_worker.probe <video file> <thumbnail.jpg>

Checks: container and streams, duration, resolution, frame rate (average and real), variable frame rate (from packet timestamps),
rotation, encryption (DRM), and that frames actually decode. Writes a JPEG thumbnail from a decoded frame when decoding works.
FFmpeg is the LGPL build, run as separate ffprobe/ffmpeg processes (vie_worker.ff, ADR-029).
"""
from __future__ import annotations

import json
import os
import statistics
import sys

from . import ff

MAX_PACKETS_FOR_VFR = 600
FRAMES_TO_DECODE = 12


def _rate(s: str | None) -> dict | None:
    f = ff.rate(s)
    return {"num": f.numerator, "den": f.denominator} if f else None


def _rotation(v: dict) -> int:
    for sd in v.get("side_data_list") or []:
        if "rotation" in sd:
            try:
                return int(round(float(sd["rotation"]))) % 360
            except (TypeError, ValueError):
                return 0
    rot = (v.get("tags") or {}).get("rotate")
    return int(rot) % 360 if rot and rot.lstrip("-").isdigit() else 0


def _encrypted(info: dict, v: dict) -> bool:
    tags = " ".join(f"{k}={val}" for k, val in {**(info.get("format", {}).get("tags") or {}), **(v.get("tags") or {})}.items()).lower()
    tag = (v.get("codec_tag_string") or "").lower()
    return tag in ("encv", "enca", "drmi", "drms") or "encryption" in tags or "cenc" in tags


def _thumbnail(path: str, out_path: str, stream: str, at_s: float | None, width: int) -> bool:
    w = 640 if width >= 640 else width - width % 2
    for seek in ([at_s] if at_s else []) + [None]:          # ~10 % into the video; the first frame when seeking fails
        args = ["-v", "error", "-nostdin", "-noautorotate"] + (["-ss", f"{seek:.3f}"] if seek else []) + \
               ["-i", path, "-map", f"0:{stream}", "-frames:v", "1", "-vf", f"scale={w}:-2", "-c:v", "mjpeg", "-q:v", "3", "-f", "image2", "-y", out_path]
        r = ff.run(args, timeout=120)
        if r.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 0:
            return True
    return False


def probe(path: str, thumbnail_path: str) -> dict:
    out: dict = {"ok": False}
    try:
        info = ff.ffprobe_json(path, "-show_format", "-show_streams")
    except ff.FFmpegError as e:
        msg = str(e).lower()
        if "invalid data" in msg or "could not find codec parameters" in msg or "end of file" in msg:
            return {"ok": False, "error": "NOT_A_VIDEO", "detail": "The file is not a readable video container."}
        return {"ok": False, "error": "UNREADABLE", "detail": "The file could not be opened."}
    fmt = info.get("format") or {}
    if not fmt.get("format_name"):
        return {"ok": False, "error": "NOT_A_VIDEO", "detail": "The file is not a readable video container."}
    out["container_format"] = fmt["format_name"]
    audios = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    out["audio_codec"] = audios[0].get("codec_name") if audios else None
    v = ff.main_video(info)
    if not v:
        return {**out, "ok": False, "error": "NO_VIDEO_STREAM", "detail": "The file has no video track."}
    # ffmpeg's stream specifier counts every video stream, cover art included
    stream = f"v:{[s['index'] for s in info['streams'] if s.get('codec_type') == 'video'].index(v['index'])}"
    tb = ff.rate(v.get("time_base"))
    out.update({
        "video_codec": v.get("codec_name"), "width": v.get("width") or None, "height": v.get("height") or None,
        "time_base": {"num": tb.numerator, "den": tb.denominator} if tb else None,
        "avg_frame_rate": _rate(v.get("avg_frame_rate")), "real_frame_rate": _rate(v.get("r_frame_rate")),
        "frame_count": int(v["nb_frames"]) if str(v.get("nb_frames", "")).isdigit() and int(v["nb_frames"]) > 0 else None,
        "rotation_degrees": _rotation(v),
    })
    dur = None
    for d in (v.get("duration"), fmt.get("duration")):
        try:
            if d not in (None, "N/A") and float(d) > 0:
                dur = int(float(d) * 1_000_000)
                break
        except ValueError:
            continue
    out["duration_us"] = dur
    if _encrypted(info, v):
        return {**out, "ok": False, "error": "DRM_PROTECTED", "detail": "The video is encrypted (DRM). Only unprotected footage you have the rights to can be analysed."}

    # variable frame rate: presentation timestamps of the first packets (demux only), in display order
    try:
        pk = ff.ffprobe_json(path, "-select_streams", stream, "-show_entries", "packet=pts", "-read_intervals", f"%+#{MAX_PACKETS_FOR_VFR}")
        pts = sorted(int(p["pts"]) for p in pk.get("packets", []) if str(p.get("pts", "")).lstrip("-").isdigit())
    except ff.FFmpegError:
        pts = []
    deltas = [b - a for a, b in zip(pts, pts[1:]) if b > a]
    if len(deltas) >= 10:
        mean = statistics.fmean(deltas)
        out["is_variable_frame_rate"] = bool(statistics.pstdev(deltas) / mean > 0.01) if mean > 0 else None
    else:
        out["is_variable_frame_rate"] = None

    # frames must really decode
    r = ff.run(["-v", "error", "-nostdin", "-noautorotate", "-i", path, "-map", f"0:{stream}", "-frames:v", str(FRAMES_TO_DECODE),
                "-f", "framecrc", "-"], timeout=300)
    decoded = sum(1 for line in r.stdout.decode("utf-8", "replace").splitlines() if line and not line.startswith("#"))
    if decoded == 0:
        return {**out, "ok": False, "error": "UNDECODABLE", "detail": "No video frame could be decoded."}
    out["decoded_frames"] = decoded
    if not out["width"] or not out["height"]:                                          # some containers only reveal the size in the frames
        f = ff.ffprobe_json(path, "-select_streams", stream, "-show_entries", "frame=width,height", "-read_intervals", "%+#1").get("frames") or [{}]
        out["width"], out["height"] = out["width"] or f[0].get("width"), out["height"] or f[0].get("height")
    at = min(out["duration_us"] // 10, 30_000_000) / 1e6 if out["duration_us"] and out["duration_us"] > 2_000_000 else None
    out["thumbnail_written"] = _thumbnail(path, thumbnail_path, stream, at, int(out["width"] or 640))
    out["ok"] = True
    return out


if __name__ == "__main__":
    print(json.dumps(probe(sys.argv[1], sys.argv[2])))
