"""Measured accuracy of the analysis profiles against the manually annotated ground truth (ADR-034).

For every annotated clip the profile runs the worker's own detection + tracking + temporal-confirmation code over a window around the
annotated frames; the boxes of its confirmed person tracks at each annotated time are scored by vie_worker.evaluation (precision,
recall, recall by player height, MOTA, ID switches, IDF1, HOTA). Results per clip and profile; nothing is pooled across clips.

  python otsi-vie/tools/eval/benchmark_profiles.py --out D:/OTSI-Workspace/_tmp/bench [--profiles STANDARD,HIGH_ACCURACY,ULTRA_SENSITIVE]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / "services" / "worker"))
sys.path.insert(0, str(Path(__file__).parent))

from profile_study import FOOTAGE, PROFILES, run  # noqa: E402

# candidate settings measured against the ground truth (ADR-034 stage 2); a variant becomes a profile only if it measures better
VARIANTS = {
    "ULTRA_SURFACE": {**PROFILES["ULTRA_SENSITIVE"], "pitch": "SURFACE"},
    "ULTRA_SURFACE_XS": {**PROFILES["ULTRA_SENSITIVE"], "pitch": "SURFACE", "cross_scale": True},
    "ULTRA_V2": {**PROFILES["ULTRA_SENSITIVE"], "pitch": "SURFACE", "cross_scale": True,
                 "tracker": {**PROFILES["ULTRA_SENSITIVE"]["tracker"], "max_lost_s": 1.5},
                 "confirm": {**PROFILES["ULTRA_SENSITIVE"]["confirm"], "strong_peak": 0.6, "strong_hits": 2}},
    "HIGH_SURFACE": {**PROFILES["HIGH_ACCURACY"], "pitch": "SURFACE"},
    "HIGH_SURFACE_KIT": {**PROFILES["HIGH_ACCURACY"], "pitch": "SURFACE", "tracker": {**PROFILES["HIGH_ACCURACY"]["tracker"], "kit_gate": 0.7}},
    "STANDARD_SURFACE_KIT": {**PROFILES["STANDARD"], "pitch": "SURFACE", "tracker": {**PROFILES["STANDARD"]["tracker"], "kit_gate": 0.7}},
    "STANDARD_SURFACE": {**PROFILES["STANDARD"], "pitch": "SURFACE"},
}
VARIANTS["ULTRA_V3"] = {**VARIANTS["ULTRA_V2"], "tracker": {**VARIANTS["ULTRA_V2"]["tracker"], "kit_gate": 0.7}}
ALL = {**PROFILES, **VARIANTS}
from vie_worker.detect.base import load_detector  # noqa: E402
from vie_worker.evaluation import Box, Frames, evaluate, load_ground_truth  # noqa: E402

GT = Path(__file__).parent / "annotations" / "gt"
FILES = {"naples_amateur": "naples_amateur_pd.webm", "ocsc_wide": "ocsc_vs_oakland_ccby.webm", "france_germany": "france_germany_ccbysa.ogv"}
CONTINUOUS = {"france_germany"}            # one run over the whole clip (tracking metrics); edited clips: a window per annotated frame


def windows(clip: str, times: list[float]) -> list[tuple[float, float]]:
    if clip in CONTINUOUS:
        return [(0.0, max(times) + 1.5)]
    return [(max(0.0, t - 3.0), t + 1.5) for t in times]


def predict(clip: str, gt: Frames, prof: dict, det) -> tuple[Frames, float, int]:
    pred = Frames(gt.width, gt.height)
    times = sorted(t / 1e6 for t in gt.by_pts)
    secs, frames = 0.0, 0
    for a, b in windows(clip, times):
        t0 = time.monotonic()
        r = run(FOOTAGE / FILES[clip], int(a * 1e6), int((b - a) * 1e6), prof, det, anchors=sorted(gt.by_pts))
        secs += time.monotonic() - t0
        frames += r["frames"]
        for pts, boxes in r["_boxes"].items():
            if any(abs(pts - g) <= 20_000 for g in gt.by_pts) and pts not in pred.by_pts:
                pred.by_pts[pts] = [Box(f"{a:.1f}#{n}", o.x, o.y, o.w, o.h) for n, o in boxes]
    return pred, secs, frames


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--profiles", default=",".join(PROFILES))
    ap.add_argument("--label", default="baseline")
    ap.add_argument("--clips", default=",".join(FILES))
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    report: dict = {}
    dets: dict = {}
    preds: dict = {}
    for clip in a.clips.split(","):
        gt = load_ground_truth(GT / f"{clip}.json")
        report[clip] = {}
        for pname in a.profiles.split(","):
            prof = ALL[pname]
            key = (tuple(prof["grids"]), prof["score_floor"], bool(prof.get("cross_scale")))
            if key not in dets:
                dets[key] = load_detector(None, tiles=2, grids=prof["grids"], score_floor=prof["score_floor"], cross_scale=bool(prof.get("cross_scale")))
            pred, secs, n = predict(clip, gt, prof, dets[key])
            m = evaluate(gt, pred, tol_us=20_000)
            m["seconds_per_frame"] = secs / max(1, n)
            report[clip][pname] = m
            preds.setdefault(clip, {})[pname] = {str(t): [[b.id, b.x, b.y, b.w, b.h] for b in bs] for t, bs in pred.by_pts.items()}
            d, t = m["detection"], m["tracking"]
            print(f"{clip:16s} {pname:16s} P {d['precision']:.3f} R {d['recall']:.3f} F1 {d['f1']:.3f} tp {d['tp']} fp {d['fp']} fn {d['fn']} "
                  f"idsw {t['id_switches']} idf1 {t['idf1']:.3f} hota {t['hota']:.3f} {m['seconds_per_frame']:.2f}s/f", flush=True)
    (out / f"{a.label}.json").write_text(json.dumps(report, indent=1))
    (out / f"{a.label}.preds.json").write_text(json.dumps(preds))
    return 0


if __name__ == "__main__":
    sys.exit(main())
