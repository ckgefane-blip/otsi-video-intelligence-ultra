"""Headless render engine (v3 Phase C.8, ADR-107): vie-render <manifest> for batch and recovery.

Executes video render jobs headlessly from manifest files (render manifests, .otsi-reel interchange,
or simplified headless job specs) without needing an active database connection or web server.

Used for:
- Batch rendering of multiple reel manifests in sequence.
- Disaster recovery and offline re-rendering of failed or corrupted exports.
- Automated pipeline integration and headless export verification.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import time
from fractions import Fraction
from pathlib import Path
from typing import Callable

import numpy as np

from .. import ff
from . import encoders as enc
from . import look as lk
from . import transitions as trn
from .overlays import Overlays
from .reel import (
    ASPECT_RATIO,
    MAX_OUTPUT_HEIGHT,
    _audio,
    _output_geometry,
    clip_frames,
    gap_frames,
    insert_frames,
    join_audio,
    loudness,
    mix_music,
    output_plan,
    seg_frames,
)
from .validate import validate


def resolve_manifest(
    raw: dict,
    base_dir: Path | None = None,
    storage_dir: Path | None = None,
    source_override: str | None = None,
) -> dict:
    """Normalize various manifest formats into a standard headless render specification."""
    base_dir = base_dir or Path.cwd()
    if storage_dir is None:
        storage_env = os.environ.get("OTSI_VIE_STORAGE_DIR")
        storage_dir = Path(storage_env) if storage_env else None

    # 1. Determine Source Video Path
    src: str | None = None
    if source_override:
        src = str(Path(source_override).resolve())
    elif raw.get("source"):
        p = Path(raw["source"])
        src = str(p if p.is_absolute() else (base_dir / p).resolve())
    elif raw.get("source_path"):
        p = Path(raw["source_path"])
        src = str(p if p.is_absolute() else (base_dir / p).resolve())
    elif raw.get("video_path"):
        p = Path(raw["video_path"])
        src = str(p if p.is_absolute() else (base_dir / p).resolve())
    elif raw.get("video") and isinstance(raw["video"], dict) and raw["video"].get("source_path"):
        p = Path(raw["video"]["source_path"])
        src = str(p if p.is_absolute() else (base_dir / p).resolve())
    elif raw.get("video_id") and storage_dir:
        vid = raw["video_id"]
        # Search common storage patterns
        candidates = list(storage_dir.glob(f"org/*/videos/{vid}/*")) + list(storage_dir.glob(f"*{vid}*"))
        for c in candidates:
            if c.is_file() and c.suffix.lower() in (".mp4", ".mov", ".mkv", ".webm", ".ogv"):
                src = str(c.resolve())
                break

    # 2. Extract Clips
    raw_clips = raw.get("clips") or []
    if not raw_clips:
        raise ValueError("Manifest contains no clips to render.")

    clips = []
    for c in raw_clips:
        in_us = c.get("in_pts_us")
        if in_us is None and "in_s" in c:
            in_us = int(float(c["in_s"]) * 1e6)
        if in_us is None:
            in_us = 0

        out_us = c.get("out_pts_us")
        if out_us is None and "out_s" in c:
            out_us = int(float(c["out_s"]) * 1e6)

        gap_us = c.get("gap_us")
        if gap_us is None and "gap_s" in c:
            gap_us = int(float(c["gap_s"]) * 1e6)

        fx = dict(c.get("fx") or {})
        if gap_us:
            fx["gap_ms"] = int(round(gap_us / 1000))

        clips.append({
            "id": c.get("id", f"clip-{len(clips)}"),
            "in_pts_us": int(in_us),
            "out_pts_us": int(out_us) if out_us is not None else None,
            "gap_us": int(gap_us or 0),
            "label": c.get("label"),
            "gain_db": c.get("gain_db"),
            "mute": c.get("mute", False),
            "effect": c.get("effect") or {"kind": "NONE"},
            "fx": fx,
            "transition": c.get("transition"),
        })

    # 3. Output Parameters
    aspect = raw.get("aspect") or (raw.get("output") or {}).get("aspect") or "16:9"
    codec = raw.get("codec") or (raw.get("output") or {}).get("codec") or "h264"
    bitrate_mbps = float(raw.get("bitrate_mbps") or (raw.get("output") or {}).get("bitrate_mbps") or 6.0)
    fps_val = raw.get("fps") or (raw.get("output") or {}).get("fps")

    # 4. Audio Configuration
    aud_cfg = raw.get("audio") or (raw.get("audio_rules") or {})

    # 5. Music Configuration
    music = raw.get("music")
    if music and isinstance(music, dict) and music.get("path"):
        mp = Path(music["path"])
        music["path"] = str(mp if mp.is_absolute() else (base_dir / mp).resolve())

    # 6. Look & Overlay Configuration
    look = raw.get("look") or {}
    overlay = raw.get("overlay") or raw.get("overlays") or {}

    # ADR-130: the Player Profile Intro snapshot and its setting, carried through unchanged (the render reads cfg["profile_intro"]);
    # `profile` is not carried here — in the snapshot it is the export profile (REEL / SCOUT / …), not the intro.
    settings = raw.get("settings") or {}

    return {
        "source": src,
        "clips": clips,
        "aspect": aspect,
        "codec": codec,
        "bitrate_mbps": bitrate_mbps,
        "fps": fps_val,
        "audio": aud_cfg,
        "music": music,
        "look": look,
        "overlay": overlay,
        "settings": settings,
        "profile_intro": raw.get("profile_intro"),
        "raw_manifest": raw,
    }


def render_manifest(
    manifest_path: str | Path,
    *,
    output_path: str | Path | None = None,
    source_override: str | None = None,
    storage_dir: str | Path | None = None,
    dry_run: bool = False,
    validate_only: bool = False,
    progress_cb: Callable[[int, str], None] | None = None,
) -> dict:
    """Execute headless render from a manifest JSON file."""
    t_start = time.monotonic()
    m_path = Path(manifest_path).resolve()
    if not m_path.exists():
        raise FileNotFoundError(f"Manifest file not found: {m_path}")

    raw_manifest = json.loads(m_path.read_text(encoding="utf-8"))
    base_dir = m_path.parent
    plan = resolve_manifest(
        raw_manifest,
        base_dir=base_dir,
        storage_dir=Path(storage_dir) if storage_dir else None,
        source_override=source_override,
    )

    src = plan["source"]
    if not validate_only and (not src or not Path(src).exists()):
        raise FileNotFoundError(f"Source video file not found: {src}. Specify --source <path>.")

    # Determine default output path
    codec = plan["codec"]
    backend = enc.choose(codec)
    if output_path is None:
        out_name = f"{m_path.stem}_rendered.{backend.container}"
        out_path = base_dir / out_name
    else:
        out_path = Path(output_path).resolve()

    # Fast path: Validate existing render file only
    if validate_only:
        if not out_path.exists():
            raise FileNotFoundError(f"Rendered video file not found for validation: {out_path}")
        probe_res = ff.ffprobe_json(str(out_path), "-show_format", "-show_streams")
        vs = next((s for s in probe_res.get("streams", []) if s.get("codec_type") == "video"), None)
        if not vs:
            return {"ok": False, "failures": ["No video stream found in target file"], "path": str(out_path)}
        vw, vh = int(vs["width"]), int(vs["height"])
        target_lufs = float(plan["audio"]["lufs"]) if plan["audio"].get("lufs") is not None else None
        val = validate(str(out_path), codec=codec, width=vw, height=vh, target_lufs=target_lufs)
        return {
            "ok": val["ok"],
            "manifest_path": str(m_path),
            "output_path": str(out_path),
            "validation": val,
        }

    # Probe source video for dimensions and frame rate
    probe_info = ff.ffprobe_json(src, "-show_format", "-show_streams")
    vs = next((s for s in probe_info.get("streams", []) if s.get("codec_type") == "video"), None)
    if not vs:
        raise ValueError(f"No video stream found in source: {src}")
    sw, sh = int(vs["width"]), int(vs["height"])
    fps_raw = plan["fps"] or vs.get("avg_frame_rate") or vs.get("r_frame_rate") or "30/1"
    fps = Fraction(fps_raw) if "/" in str(fps_raw) else Fraction(float(fps_raw)).limit_denominator(1000)

    # Output geometry calculation
    aspect = plan["aspect"]
    ow, oh, cw = _output_geometry(sw, sh, aspect)
    frame_us = int(round(1e6 / float(fps)))

    # Compute planned clips with out_pts if omitted
    clips = plan["clips"]
    total_dur_s = float((probe_info.get("format") or {}).get("duration") or vs.get("duration") or 0.0)
    total_dur_us = int(round(total_dur_s * 1e6))
    for c in clips:
        if c["out_pts_us"] is None:
            c["out_pts_us"] = total_dur_us

    # Total frame calculations
    total_planned_frames = sum(gap_frames(c, fps) + clip_frames(c, fps) for c in clips)
    duration_s = total_planned_frames / float(fps)

    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "manifest_path": str(m_path),
            "output_path": str(out_path),
            "source_path": src,
            "width": ow,
            "height": oh,
            "fps": float(fps),
            "frames": total_planned_frames,
            "duration_s": round(duration_s, 3),
            "codec": codec,
            "aspect": aspect,
        }

    # Ensure parent output directory exists
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Set up temporary scratch work folder
    work_dir = Path(tempfile.mkdtemp(prefix="vie_headless_"))
    try:
        if progress_cb:
            progress_cb(10, "Preparing audio and colour pipeline")

        # Prepare Look filter if specified
        look_cfg = plan["look"]
        look_vf = None
        if look_cfg and not lk.is_neutral(look_cfg):
            lut_path = work_dir / "look.cube"
            lk.generate_cube_lut(look_cfg, lut_path)
            look_vf = f"lut3d=file='{lut_path.as_posix()}':interp=trilinear"

        # Frame Generator
        total_frames = [0]
        def frames():
            for i, c in enumerate(clips):
                gn = gap_frames(c, fps)
                if gn > 0:
                    black = np.zeros((oh, ow, 3), dtype=np.uint8)
                    for _ in range(gn):
                        total_frames[0] += 1
                        yield black

                in_us = c["in_pts_us"]
                out_us = c["out_pts_us"]
                plan = output_plan(c, fps)
                want = clip_frames(c, fps)

                made = 0
                last = None
                dec = iter(ff.decode_sampled(src, None, start_us=in_us, end_us=out_us, seek=True, width=sw, height=sh, vf=look_vf))
                cur = next(dec, None)
                nxt = next(dec, None) if cur is not None else None

                for t_src, _held in plan:
                    if cur is None:
                        break
                    while nxt is not None and nxt.pts_us <= t_src + frame_us / 2:
                        cur, nxt = nxt, next(dec, None)

                    rgb = cur.rgb
                    if cw < sw:
                        # Center crop for headless render
                        x0 = int((sw - cw) // 2)
                        rgb = rgb[:, x0 : x0 + cw]
                    if (ow, oh) != (rgb.shape[1], rgb.shape[0]):
                        # Scale if needed
                        import cv2
                        rgb = cv2.resize(rgb, (ow, oh), interpolation=cv2.INTER_AREA)

                    total_frames[0] += 1
                    last = rgb
                    made += 1
                    yield rgb

                if hasattr(dec, "close"):
                    dec.close()

                # Hold last frame if short
                while made < want and last is not None:
                    total_frames[0] += 1
                    made += 1
                    yield last

        if progress_cb:
            progress_cb(30, "Slicing match audio and mixing tracks")

        # Audio Pipeline
        audio = _audio(src, clips, 0.0, work_dir, 0.0, fps)
        music_cfg = plan["music"]
        if music_cfg and music_cfg.get("path") and Path(music_cfg["path"]).exists():
            vol = float(music_cfg.get("volume", 0.8))
            m_vol = float(music_cfg.get("match_volume", 0.3))
            duck = bool(plan["audio"].get("duck_music", False))
            mixed = mix_music(audio, music_cfg["path"], duration_s, vol, m_vol, work_dir, duck=duck)
            if mixed:
                audio = mixed

        # Loudness Normalization
        loud = None
        target_lufs = plan["audio"].get("lufs")
        if audio and target_lufs is not None:
            if progress_cb:
                progress_cb(60, "Normalizing integrated loudness")
            audio, loud = loudness(audio, float(target_lufs), float(plan["audio"].get("true_peak_db", -1.5)), work_dir)

        if progress_cb:
            progress_cb(70, f"Encoding video with {backend.key}")

        bitrate = int(float(plan["bitrate_mbps"]) * 1e6 * (ow * oh) / (1920 * 1080))
        enc.encode(
            frames(),
            str(out_path),
            width=ow,
            height=oh,
            fps=fps,
            backend=backend,
            bitrate=max(1_000_000, bitrate),
            audio_from=audio,
            duration_s=duration_s,
        )

        if progress_cb:
            progress_cb(90, "Validating render QC")

        val = validate(
            str(out_path),
            codec=codec,
            width=ow,
            height=oh,
            frames=total_frames[0],
            fps=float(fps),
            audio=audio is not None,
            target_lufs=float(target_lufs) if target_lufs is not None else None,
        )

        sha = hashlib.sha256(out_path.read_bytes()).hexdigest()
        elapsed_s = round(time.monotonic() - t_start, 2)

        # Output manifest
        out_manifest = {
            "source": src,
            "output_path": str(out_path),
            "width": ow,
            "height": oh,
            "fps": float(fps),
            "frames": total_frames[0],
            "duration_s": round(total_frames[0] / float(fps), 3),
            "codec": codec,
            "encoder": backend.key,
            "sha256": sha,
            "bytes": out_path.stat().st_size,
            "render_seconds": elapsed_s,
            "validation": val,
        }

        m_out_path = out_path.with_name(f"{out_path.name}.manifest.json")
        m_out_path.write_text(json.dumps(out_manifest, indent=2), encoding="utf-8")

        if progress_cb:
            progress_cb(100, "Render completed successfully")

        return {
            "ok": val["ok"],
            "manifest_path": str(m_path),
            "output_path": str(out_path),
            "output_manifest_path": str(m_out_path),
            "frames": total_frames[0],
            "duration_s": round(total_frames[0] / float(fps), 3),
            "fps": float(fps),
            "width": ow,
            "height": oh,
            "codec": codec,
            "encoder": backend.key,
            "bytes": out_path.stat().st_size,
            "sha256": sha,
            "seconds": elapsed_s,
            "validation": val,
        }
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
