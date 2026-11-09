"""Analysis-profile study on real footage (ADR-034): what each profile detects and tracks, at what cost, and whether the EXTRA boxes a
more sensitive profile finds are real players.

For each clip and profile: decode the window at the profile's frame rate, detect (the profile's tile grids), apply the pitch filter,
track with the profile's tracker settings and temporal confirmation — the same code paths as the ANALYZE worker. Reported per clip:
on-pitch person boxes per frame by height, confirmed person tracks and their length, candidate tracks rejected by confirmation, seconds
per frame. On the frames common to all profiles (the 2-fps grid), boxes of confirmed tracks that the Standard profile does not have
(IoU < 0.3 with every Standard box) are cut out into numbered contact sheets for a person to label (real player / not a player).
Those labels — not the counts — say whether the extra recall is real.

  python otsi-vie/tools/eval/profile_study.py --out D:/OTSI-Workspace/_tmp/profile-study
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / "services" / "worker"))

from vie_worker import ff  # noqa: E402
from vie_worker.analyze import _confirm  # noqa: E402
from vie_worker.detect.base import load_detector  # noqa: E402
from vie_worker.detect.pitch import classify, classify_surface, grass_mask  # noqa: E402
from vie_worker.frames import CutDetector, MAX_ANALYSIS_WIDTH  # noqa: E402
from vie_worker.quality import phase_shift  # noqa: E402
from vie_worker.tracker import Tracker, torso_colour  # noqa: E402

FOOTAGE = APP.parent / ".local" / "eval-footage"
# the profile settings exactly as packages/contracts/src/analysis.ts writes them into a run's config
PROFILES = {
    "STANDARD": {"sample_fps": 2, "grids": [2], "score_floor": 0.2, "tracker": {"high": 0.5, "low": 0.15, "min_hits": 2, "distance_weight": 0},
                 "confirm": {"min_hits": 2, "min_peak": 0.5}, "pitch": "STRICT", "stabilize": False},
    "HIGH_ACCURACY": {"sample_fps": 6, "grids": [2], "score_floor": 0.2, "tracker": {"high": 0.5, "low": 0.15, "min_hits": 2, "distance_weight": 0.3},
                      "confirm": {"min_hits": 3, "min_peak": 0.5}, "pitch": "STRICT", "stabilize": True},
    "ULTRA_SENSITIVE": {"sample_fps": 6, "grids": [2, 3], "score_floor": 0.1, "tracker": {"high": 0.4, "low": 0.1, "min_hits": 3, "distance_weight": 0.4},
                        "confirm": {"min_hits": 4, "min_peak": 0.4}, "pitch": "TOUCHLINE", "stabilize": True},
}
BINS = [(0, 20), (20, 40), (40, 80), (80, 160), (160, 10_000)]


def _anchored(path: Path, start_us: int, dur_us: int, fps: float, anchors: list[int]):
    """Frames on the profile's sampling grid, laid so that the annotated frames are ON the grid (streamed: per grid point the
    decoded frame nearest to it is kept). Without this a 29.97-fps file sampled at 6 fps misses the annotated frame by up to half a
    sample interval and is scored against boxes of another moment. Benchmark only; the worker samples as before."""
    step = 1e6 / fps
    a = min(anchors, key=lambda t: abs(t - (start_us + dur_us / 2)))
    best = None                                        # (grid index, distance, frame)
    for f in ff.decode_sampled(str(path), None, max_width=MAX_ANALYSIS_WIDTH, start_us=start_us, end_us=start_us + dur_us, seek=start_us > 0):
        k = round((f.pts_us - a) / step)
        dist = abs(f.pts_us - (a + k * step))
        if best is not None and k != best[0]:
            yield best[2]
            best = None
        if best is None or dist < best[1]:
            best = (k, dist, f)
    if best is not None:
        yield best[2]


def run(path: Path, start_us: int, dur_us: int, prof: dict, detector, anchors: list[int] | None = None) -> dict:
    tracker = Tracker(**prof["tracker"])
    cuts, prev = CutDetector(), None
    frames, t_det = [], 0.0
    boxes_by_pts: dict[int, list] = {}
    source = _anchored(path, start_us, dur_us, prof["sample_fps"], anchors) if anchors else         ff.decode_sampled(str(path), prof["sample_fps"], max_width=MAX_ANALYSIS_WIDTH, start_us=start_us, end_us=start_us + dur_us, seek=start_us > 0)
    for f in source:
        if cuts.is_cut(f.rgb):
            tracker.end_all(); prev = None
        t0 = time.monotonic()
        ds = detector.detect([f.rgb])[0]
        t_det += time.monotonic() - t0
        on = classify_surface(ds, grass_mask(f.rgb)) if prof["pitch"] == "SURFACE" else classify(ds, grass_mask(f.rgb), touchline=prof["pitch"] == "TOUCHLINE")
        shift = None
        if prof["stabilize"] and prev is not None:
            dx, dy = phase_shift(prev, f.rgb)
            shift = (dx / f.rgb.shape[1], dy / f.rgb.shape[0])
        prev = f.rgb if prof["stabilize"] else None
        kept = [d for d, ok in zip(ds, on) if ok]
        feats = [torso_colour(f.rgb, d) if d.label == "PERSON" else None for d in kept] if prof["tracker"].get("kit_gate") else None
        tracker.update(f.frame_index, f.pts_us, kept, camera_shift=shift, features=feats)
        on_grid = abs(f.pts_us / 5e5 - round(f.pts_us / 5e5)) < 0.06          # within 30 ms of the 2-fps grid shared by all profiles
        frames.append((f.pts_us, f.rgb if on_grid else None, f.height))
    tracks, rejected = _confirm(tracker.results(), prof["confirm"])
    persons = [t for t in tracks if t.label == "PERSON"]
    for t in persons:
        for o in t.observations:
            boxes_by_pts.setdefault(o.pts_us, []).append((t.number, o))
    H = frames[0][2] if frames else 1080
    heights = [o.h * H for t in persons for o in t.observations]
    hist = {f"{lo}-{hi}" if hi < 10_000 else f">={lo}": int(sum(lo <= h < hi for h in heights)) for lo, hi in BINS}
    return {"frames": len(frames), "seconds_per_frame": t_det / max(1, len(frames)), "passes_per_frame": detector.passes_per_frame(),
            "person_tracks": len(persons), "rejected_candidate_tracks": rejected,
            "median_track_s": float(np.median([(t.observations[-1].pts_us - t.observations[0].pts_us) / 1e6 for t in persons])) if persons else 0,
            "person_boxes_per_frame": len(heights) / max(1, len(frames)), "box_heights_px": hist,
            "_boxes": boxes_by_pts, "_frames": {p: rgb for p, rgb, _ in frames if rgb is not None}}


def iou(a, b):
    ix = max(0, min(a.x + a.w, b.x + b.w) - max(a.x, b.x)); iy = max(0, min(a.y + a.h, b.y + b.h) - max(a.y, b.y))
    u = a.w * a.h + b.w * b.h - ix * iy
    return ix * iy / u if u > 0 else 0


def extras(base: dict, other: dict, tol_us=40_000):
    """Boxes of `other` on the common 2-fps frames that no base box overlaps."""
    out = []
    bkeys = np.array(sorted(base["_boxes"])) if base["_boxes"] else np.array([0])
    for pts, rgb in other["_frames"].items():
        mine = other["_boxes"].get(pts, [])
        i = int(np.argmin(np.abs(bkeys - pts)))
        theirs = base["_boxes"].get(int(bkeys[i]), []) if abs(int(bkeys[i]) - pts) <= tol_us else []
        for n, o in mine:
            if all(iou(o, b) < 0.3 for _, b in theirs):
                out.append((pts, n, o, rgb))
    return out


def sheet(items, path: Path, cols=8, cell=128):
    rows = (len(items) + cols - 1) // cols
    im = Image.new("RGB", (cols * cell, max(1, rows) * (cell + 16)), (20, 20, 20))
    d = ImageDraw.Draw(im)
    for k, (pts, n, o, rgb) in enumerate(items):
        H, W = rgb.shape[:2]
        cx, cy, s = (o.x + o.w / 2) * W, (o.y + o.h / 2) * H, max(o.h * H * 2.2, 48)
        x0, y0 = int(max(0, cx - s / 2)), int(max(0, cy - s / 2))
        crop = Image.fromarray(rgb[y0:int(min(H, cy + s / 2)), x0:int(min(W, cx + s / 2))]).copy()
        cd = ImageDraw.Draw(crop)
        cd.rectangle([o.x * W - x0, o.y * H - y0, (o.x + o.w) * W - x0, (o.y + o.h) * H - y0], outline=(0, 255, 255))
        crop = crop.resize((cell, cell))
        im.paste(crop, ((k % cols) * cell, (k // cols) * (cell + 16)))
        d.text(((k % cols) * cell + 3, (k // cols) * (cell + 16) + cell + 1), f"{k} h{o.h * H:.0f} s{o.score:.2f}", fill=(255, 255, 0))
    im.save(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--sample", type=int, default=48)
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    clips = [("naples_amateur", FOOTAGE / "naples_amateur_pd.webm", 0, 40_000_000),
             ("ocsc_wide", FOOTAGE / "ocsc_vs_oakland_ccby.webm", 120_000_000, 40_000_000),
             ("france_germany", FOOTAGE / "france_germany_ccbysa.ogv", 0, 17_000_000)]
    extra_clip = out / "france_germany_360p_lowbitrate.mp4"
    if (FOOTAGE / "france_germany_ccbysa.ogv").exists():
        if not extra_clip.exists():   # a degraded copy of real footage: stands in for low-resolution grassroots recordings (labelled as such)
            import subprocess
            subprocess.run([ff.tool("ffmpeg"), "-y", "-loglevel", "error", "-i", str(FOOTAGE / "france_germany_ccbysa.ogv"), "-vf", "scale=640:360",
                            "-c:v", "mpeg4", "-b:v", "350k", "-an", str(extra_clip)], check=True)
        clips.append(("france_germany_degraded_360p", extra_clip, 0, 17_000_000))
    report = {}
    dets = {}
    for name, path, start, dur in clips:
        if not path.exists():
            continue
        report[name] = {}
        res = {}
        for pname, prof in PROFILES.items():
            key = (tuple(prof["grids"]), prof["score_floor"])
            if key not in dets:
                dets[key] = load_detector(None, tiles=2, grids=prof["grids"], score_floor=prof["score_floor"])
            r = run(path, start, dur, prof, dets[key])
            res[pname] = r
            report[name][pname] = {k: v for k, v in r.items() if not k.startswith("_")}
            print(name, pname, json.dumps(report[name][pname]), flush=True)
        for pname in ("HIGH_ACCURACY", "ULTRA_SENSITIVE"):
            ex = extras(res["STANDARD"], res[pname])
            rng = np.random.default_rng(7)
            pick = [ex[i] for i in sorted(rng.choice(len(ex), size=min(a.sample, len(ex)), replace=False))] if ex else []
            sheet(pick, out / f"{name}_{pname}_extra.png")
            report[name][pname]["extra_boxes_vs_standard_on_common_frames"] = len(ex)
            report[name][pname]["extra_sample"] = [{"i": k, "pts_us": p, "track": n, "h_px": round(o.h * r0.shape[0]), "score": o.score}
                                                    for k, (p, n, o, r0) in enumerate(pick)]
        lost = extras(res["ULTRA_SENSITIVE"], res["STANDARD"])
        report[name]["STANDARD"]["boxes_not_in_ultra_on_common_frames"] = len(lost)
    (out / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print("written", out / "report.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
