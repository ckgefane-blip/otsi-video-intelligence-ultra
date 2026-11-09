"""Compare Tracker association configs on the existing labelled ground truth (Track U.2 measurement).

Feeds the ground-truth boxes themselves as detections (score 0.9, PERSON) so detection is perfect and
only association differs between configs, then scores the resulting tracks with the one metric module
the project already trusts: ``vie_worker.evaluation.evaluate()`` (MOTA, ID switches, fragmentations,
IDF1, HOTA, detection precision / recall / F1 at IoU >= 0.5).

Configs:
  baseline     U.1-only: plain IoU (eiou_expand=0.0), no appearance gate
  eiou         U.2 Deep-EIoU only: eiou_expand=0.2, no appearance gate
  eiou+dino-sim  U.2 with the appearance gate, driven by a SIMULATED provider (see below)

Two experiment settings, both documented because they differ from production:
  * max_lost_s=30: the labelled frames are 0.5-28 s apart (sparse labelling), so the production
    1.0 s limit would end every track between frames and measure nothing. This isolates
    association; it does not measure the track lifecycle.
  * min_hits=1: every track counts, so a track that only appears once is still scored.

SIMULATED provider (eiou+dino-sim only): the provider is the ground-truth identity itself — cosine
0.95 when the detection's GT id equals the track's GT id as of the previous frame, 0.05 otherwise,
None for a track with no identity yet. That is an UPPER BOUND on what a perfect appearance signal
could do, and it is NOT a DINOv2 result: no model, no crop and no video was involved. The DINOv2
gate's effect on real footage is unmeasured until Sukhum video + real embeddings exist.

Honesty limits of this experiment (read before quoting any number):
  * naples_amateur and ocsc_wide have NO ground-truth id in more than one frame, so no tracker
    can show an identity switch or an IDF1 difference there — association is unmeasurable on
    those two files, whatever the numbers say.
  * france_germany has 21 ids in more than one frame, all inside the 4.0-5.5 s cluster (4 frames
    0.5 s apart); only that cluster can show an association difference.
  * No GT box names a player_ref, so identity rates are always empty.

Usage:
  python otsi-vie/tools/eval/tracker_u2_compare.py [--out-dir /tmp/u2_compare]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

WORKER = Path(__file__).resolve().parents[2] / "services" / "worker"
sys.path.insert(0, str(WORKER))

from vie_worker.detect.base import Detection  # noqa: E402
from vie_worker.evaluation import Box, Frames, evaluate, load_ground_truth  # noqa: E402
from vie_worker.tracker import Tracker  # noqa: E402

GT_DIR = Path(__file__).resolve().parent / "annotations" / "gt"
GT_FILES = ["france_germany.json", "naples_amateur.json", "ocsc_wide.json"]


def run_config(gt: Frames, cfg: dict, sim: bool = False) -> tuple[dict, dict, dict]:
    """Run the tracker over the GT boxes as detections.

    Returns (evaluate() result, dino_stats, prediction frames {pts_us: [Box]})."""
    tr = Tracker(min_hits=1, max_lost_s=30, **cfg)
    det_gt: dict[int, str] = {}        # id(detection object) -> GT id
    track_gt: dict[int, str] = {}      # id(track object) -> GT id as of the previous frame
    for pts in sorted(gt.by_pts):
        dets = []
        for b in gt.by_pts[pts]:
            d = Detection("PERSON", 0.9, b.x, b.y, b.w, b.h)
            det_gt[id(d)] = b.id
            dets.append(d)
        if sim:
            # the provider sees the track's identity as of the PREVIOUS frame (a snapshot copy per frame):
            # that is what a real provider would know — a track's reference embedding from its history.
            def provider(track, det, _m=dict(track_gt), _d=dict(det_gt)):
                want = _m.get(id(track))
                if want is None:
                    return None
                return 0.95 if _d.get(id(det)) == want else 0.05
            tr.update(0, pts, dets, appearance_fn=provider)
        else:
            tr.update(0, pts, dets)
        # learn each live track's GT id from its latest observation (exact box match to this frame's detections)
        by_box = {(d.x, d.y, d.w, d.h): det_gt[id(d)] for d in dets}
        for t in tr.active:
            o = t.observations[-1]
            gid = by_box.get((o.x, o.y, o.w, o.h))
            if gid is not None:
                track_gt[id(t)] = gid
    pred = Frames(gt.width, gt.height)
    pred_frames: dict[int, list[Box]] = {}
    for t in tr.results():
        for o in t.observations:
            b = Box(str(t.number), o.x, o.y, o.w, o.h)
            pred.by_pts.setdefault(o.pts_us, []).append(b)
            pred_frames.setdefault(o.pts_us, []).append(b)
    return evaluate(gt, pred), dict(tr.dino_stats), pred_frames


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="tracker_u2_compare.py",
                                 description="Compare Tracker association configs on the existing GT files (see module docstring for limits).")
    ap.add_argument("--out-dir", default="/tmp/u2_compare", help="Write prediction JSON files here (default /tmp/u2_compare).")
    args = ap.parse_args(argv)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    configs = [
        ("baseline", {"eiou_expand": 0.0, "dino_gate": None}, False),
        ("eiou", {"eiou_expand": 0.2, "dino_gate": None}, False),
        ("eiou+dino-sim", {"eiou_expand": 0.2, "dino_gate": 0.35}, True),
    ]
    for name in GT_FILES:
        gt = load_ground_truth(GT_DIR / name)
        scored = [b for boxes in gt.by_pts.values() for b in boxes if not b.ignore]
        print(f"\n== {name}: {len(gt.by_pts)} frames, {len(scored)} scored boxes "
              f"({sum(len(v) for v in gt.by_pts.values())} raw, {sum(len(v) for v in gt.by_pts.values()) - len(scored)} ignore=True), "
              f"{len({b.id for b in scored})} scored GT ids ==")
        for label, cfg, sim in configs:
            result, stats, pred_frames = run_config(gt, cfg, sim)
            d, t = result["detection"], result["tracking"]
            print(f"  {label:14s} MOTA={t['mota']:.3f} IDF1={t['idf1']:.3f} HOTA={t['hota']:.3f} "
                  f"DetA={t['deta']:.3f} AssA={t['assa']:.3f} id_switches={t['id_switches']} "
                  f"frag={t['fragmentations']} P={d['precision']:.3f} R={d['recall']:.3f} "
                  f"pred_ids={result['predicted_ids']} dino={stats if sim else '-'}")
            pred_doc = {"video": f"tracker-u2-compare:{name}:{label}", "frame_width": gt.width, "frame_height": gt.height,
                        "frames": [{"pts_us": pts, "complete": True,
                                    "boxes": [{"id": b.id, "x": b.x, "y": b.y, "w": b.w, "h": b.h} for b in boxes]}
                                   for pts, boxes in sorted(pred_frames.items())]}
            (out_dir / f"{Path(name).stem}_{label}.json").write_text(json.dumps(pred_doc, indent=2), encoding="utf-8")
    print("\nNOTE: eiou+dino-sim uses the GT identity as its appearance signal (SIMULATED upper bound, not a DINOv2 result).")
    print("naples_amateur / ocsc_wide have no repeated GT id, so association is unmeasurable there.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
