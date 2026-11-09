"""Render validation (F45): a rendered file is accepted only if it is exactly what was asked for and decodes completely.

Checks: container and codec, profile and pixel format (yuv420p/nv12 output decodes as yuv420p), size, frame count (exact, by decoding),
duration, audio presence, MP4 'faststart' (moov before mdat, for progressive playback), and a full decode with errors treated as fatal.
QC checks (v3 C.6, ADR-106): integrated LUFS loudness compliance, true peak headroom, and unintended black frame segment detection.
Returns a report; `ok` is False with the reasons when any check fails. A failed render never reaches delivery.
"""
from __future__ import annotations

import os
import re
import struct

from .. import ff


def _top_level_atoms(path: str, limit: int = 64) -> list[str]:
    out = []
    with open(path, "rb") as f:
        size_total = os.path.getsize(path)
        pos = 0
        while pos < size_total and len(out) < limit:
            f.seek(pos)
            hdr = f.read(8)
            if len(hdr) < 8:
                break
            size, kind = struct.unpack(">I4s", hdr)
            if size == 1:
                size = struct.unpack(">Q", f.read(8))[0]
            elif size == 0:
                size = size_total - pos
            out.append(kind.decode("latin-1"))
            if size < 8:
                break
            pos += size
    return out


def detect_black_frames(path: str, *, min_duration_s: float = 0.2, pic_th: float = 0.98) -> list[dict]:
    """QC check (C.6, ADR-106): detect spans of black frames using FFmpeg's blackdetect filter.
    Returns list of {'start_s': float, 'end_s': float, 'duration_s': float}."""
    vf = f"blackdetect=d={min_duration_s:.2f}:pix_th=0.10:pic_th={pic_th:.2f}"
    r = ff.run(["-v", "info", "-nostdin", "-i", path, "-vf", vf, "-f", "null", "-"], timeout=1800)
    out = []
    text = (r.stderr or b"").decode("utf-8", "replace")
    pat = re.compile(r"black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)")
    for m in pat.finditer(text):
        st, en, du = float(m.group(1)), float(m.group(2)), float(m.group(3))
        out.append({"start_s": round(st, 3), "end_s": round(en, 3), "duration_s": round(du, 3)})
    return out


def measure_loudness_qc(path: str) -> dict:
    """QC check (C.6, ADR-106): measure integrated LUFS and true peak dBTP using FFmpeg's ebur128 filter."""
    r = ff.run(["-v", "info", "-nostdin", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], timeout=1800)
    text = (r.stderr or b"").decode("utf-8", "replace")
    i_match = re.search(r"Integrated loudness:\s+I:\s+([-\d.]+)\s+LUFS", text)
    p_match = re.search(r"True peak:\s+Peak:\s+([-\d.]+)\s+dBFS", text)
    lufs = float(i_match.group(1)) if i_match else None
    peak = float(p_match.group(1)) if p_match else None
    return {"measured_lufs": lufs, "true_peak_db": peak}


def validate(path: str, *, codec: str, width: int, height: int, frames: int | None = None, fps: float | None = None,
             audio: bool | None = None, profiles: tuple[str, ...] | None = None,
             target_lufs: float | None = None, max_black_s: float = 1.5) -> dict:
    fails: list[str] = []
    info = ff.ffprobe_json(path, "-show_format", "-show_streams", "-count_frames")
    vs = [s for s in info.get("streams", []) if s.get("codec_type") == "video"]
    if len(vs) != 1:
        return {"ok": False, "failures": [f"expected one video stream, found {len(vs)}"], "path": path}
    v = vs[0]
    fmt = (info.get("format") or {}).get("format_name", "")
    if v.get("codec_name") != codec:
        fails.append(f"codec {v.get('codec_name')} != {codec}")
    if (v.get("width"), v.get("height")) != (width, height):
        fails.append(f"size {v.get('width')}x{v.get('height')} != {width}x{height}")
    if v.get("pix_fmt") not in ("yuv420p", "nv12", "yuvj420p"):
        fails.append(f"pixel format {v.get('pix_fmt')} is not 4:2:0 8-bit (not universally playable)")
    if profiles and v.get("profile") not in profiles:
        fails.append(f"profile {v.get('profile')} not in {profiles}")
    counted = int(v["nb_read_frames"]) if str(v.get("nb_read_frames", "")).isdigit() else None
    if frames is not None and counted != frames:
        fails.append(f"decoded frames {counted} != {frames}")
    dur = float(v.get("duration") or (info.get("format") or {}).get("duration") or 0)
    if frames and fps and abs(dur - frames / fps) > 2.0 / fps:
        fails.append(f"duration {dur:.3f}s != {frames / fps:.3f}s")
    has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
    if audio is not None and has_audio != audio:
        fails.append(f"audio present: {has_audio}, expected {audio}")
    a_dur = next((float(s["duration"]) for s in info.get("streams", []) if s.get("codec_type") == "audio" and s.get("duration")), None)
    if frames and fps and a_dur is not None and abs(a_dur - frames / fps) > 0.1:     # 2026-11-07: sound and picture end together
        fails.append(f"sound {a_dur:.3f}s != picture {frames / fps:.3f}s")
    faststart = None
    if "mp4" in fmt or "mov" in fmt:
        atoms = _top_level_atoms(path)
        faststart = "moov" in atoms and "mdat" in atoms and atoms.index("moov") < atoms.index("mdat")
        if not faststart:
            fails.append(f"not faststart (top-level atoms {atoms[:6]})")
    r = ff.run(["-v", "error", "-xerror", "-nostdin", "-i", path, "-f", "null", "-"], timeout=3600)
    if r.returncode != 0 or r.stderr.strip():
        fails.append("full decode reported errors: " + r.stderr.decode("utf-8", "replace").strip()[-200:])

    # QC checks (C.6, ADR-106)
    qc: dict = {
        "loudness": {"measured_lufs": None, "true_peak_db": None, "target_lufs": target_lufs, "compliant": True},
        "black_frames": {"detected_count": 0, "spans": [], "unintended_black": False},
    }
    if has_audio:
        loud_qc = measure_loudness_qc(path)
        compliant = True
        if target_lufs is not None and loud_qc["measured_lufs"] is not None:
            # Broadcast / online standard tolerance is +-2.5 LUFS
            if abs(loud_qc["measured_lufs"] - target_lufs) > 2.5:
                compliant = False
                fails.append(f"QC loudness {loud_qc['measured_lufs']:.1f} LUFS exceeds target {target_lufs:.1f} LUFS tolerance")
        if loud_qc["true_peak_db"] is not None and loud_qc["true_peak_db"] > 0.1:
            fails.append(f"QC true peak {loud_qc['true_peak_db']:.1f} dBTP clips above 0 dBTP")
        qc["loudness"] = {**loud_qc, "target_lufs": target_lufs, "compliant": compliant}

    black_spans = detect_black_frames(path)
    # Exclude intentional head/tail black frames (e.g. within first 0.8s or last 0.8s)
    unintended = [s for s in black_spans if s["duration_s"] > max_black_s and s["start_s"] > 0.8 and (dur - s["end_s"]) > 0.8]
    qc["black_frames"] = {
        "detected_count": len(black_spans),
        "spans": black_spans,
        "unintended_black": len(unintended) > 0,
    }
    if unintended:
        fails.append(f"QC black frames: detected {len(unintended)} unintended black segment(s) > {max_black_s}s")

    return {"ok": not fails, "failures": fails, "path": path, "container": fmt, "codec": v.get("codec_name"), "profile": v.get("profile"),
            "level": v.get("level"), "pix_fmt": v.get("pix_fmt"), "width": v.get("width"), "height": v.get("height"), "frames": counted,
            "duration_s": round(dur, 3), "audio": has_audio, "faststart": faststart, "bytes": os.path.getsize(path), "qc": qc}
