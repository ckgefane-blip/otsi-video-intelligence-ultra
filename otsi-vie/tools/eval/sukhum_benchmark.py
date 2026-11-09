"""Sukhum benchmark harness (Track G, ADR-125 — draft, owner approval pending).

Scores engine predictions against manually labelled ground truth using the
one metric module the project already trusts:
``vie_worker.evaluation.evaluate()`` (CLEAR-MOT / MOTA, ID switches,
fragmentations, IDF1, HOTA, detection precision / recall / F1 at IoU >= 0.5,
identity rates). This script adds no new metric and no new threshold; it
only loads files, validates them, calls ``evaluate()`` and writes the
result down.

Ground truth is the OTSI JSON format ``evaluation.load_ground_truth``
reads (``{"video", "labeller", "frame_width", "frame_height", "frames":
[{"pts_us", "complete", "boxes": [{"id", "x", "y", "w", "h",
"player_ref", "ignore", "approximate"}]}]}``, boxes normalised 0..1).
MOTChallenge ``gt.txt`` ground truth is also accepted (needs ``--fps``,
``--width`` and ``--height``). Predictions are OTSI JSON in the same
shape; every frame in the file is scored (the ``complete`` flag is only
meaningful for ground truth — a prediction file is the engine's claim
about what it saw).

Honesty rules (CLAUDE.md / ADR-124): if the ground-truth file has no
``complete`` frame, there is nothing to score and this script exits
non-zero with "NOT MEASURED" instead of printing a number. A run whose
predictions are the ground truth itself (``--pred`` pointing at the GT
file) is a harness smoke test only — it proves the harness runs, it is
NOT a benchmark result and must never be quoted as one.

Usage:
  python otsi-vie/tools/eval/sukhum_benchmark.py --gt <gt.json> --pred <pred.json> [--out result.json]
  python otsi-vie/tools/eval/sukhum_benchmark.py --gt <gt.json> --pred <pred.json> --validate-only
  python otsi-vie/tools/eval/sukhum_benchmark.py --help
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# The worker lives next to tools/ in the monorepo: otsi-vie/services/worker.
WORKER = Path(__file__).resolve().parents[2] / "services" / "worker"
sys.path.insert(0, str(WORKER))

from vie_worker.evaluation import Box, Frames, evaluate, load_ground_truth  # noqa: E402

TOOL = "sukhum_benchmark.py (Track G, ADR-125 draft)"


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate_document(data, path: str) -> tuple[list[str], list[str]]:
    """Structural check of an OTSI JSON ground-truth / prediction document.

    Returns (errors, warnings). Errors mean the file cannot be scored;
    warnings mean it can be scored but the result will be limited (for
    example: no frame is marked complete, or no box names a player, so
    identity rates cannot be computed).
    """
    errors, warnings = [], []
    if not isinstance(data, dict):
        return [f"{path}: top level must be a JSON object"], warnings
    for key in ("frame_width", "frame_height", "frames"):
        if key not in data:
            errors.append(f"{path}: missing required key {key!r}")
    if errors:
        return errors, warnings
    if not isinstance(data["frame_width"], int) or data["frame_width"] <= 0:
        errors.append(f"{path}: frame_width must be a positive integer")
    if not isinstance(data["frame_height"], int) or data["frame_height"] <= 0:
        errors.append(f"{path}: frame_height must be a positive integer")
    if not isinstance(data["frames"], list) or not data["frames"]:
        errors.append(f"{path}: frames must be a non-empty list")
        return errors, warnings
    n_complete = 0
    named = 0
    for i, f in enumerate(data["frames"]):
        where = f"{path}: frames[{i}]"
        if not isinstance(f, dict):
            errors.append(f"{where}: must be an object")
            continue
        if "pts_us" not in f or not isinstance(f["pts_us"], (int, float)):
            errors.append(f"{where}: missing numeric pts_us")
        if "boxes" not in f or not isinstance(f["boxes"], list):
            errors.append(f"{where}: missing boxes list")
            continue
        if f.get("complete", False):
            n_complete += 1
        seen: set[str] = set()
        for j, b in enumerate(f["boxes"]):
            bwhere = f"{where}: boxes[{j}]"
            if not isinstance(b, dict):
                errors.append(f"{bwhere}: must be an object")
                continue
            if not b.get("id"):
                errors.append(f"{bwhere}: missing id")
            elif b["id"] in seen:
                errors.append(f"{bwhere}: duplicate box id {b['id']!r} in one frame")
            else:
                seen.add(str(b["id"]))
            for k in ("x", "y", "w", "h"):
                if k not in b or not _is_num(b[k]):
                    errors.append(f"{bwhere}: missing numeric {k}")
                elif k in ("w", "h") and b[k] <= 0:
                    errors.append(f"{bwhere}: {k}={b[k]} must be positive")
                elif not -0.05 <= b[k] <= 1.05:
                    # Grossly outside the frame: cannot be scored.
                    errors.append(f"{bwhere}: {k}={b[k]} outside plausible range [-0.05, 1.05]")
                elif not 0 <= b[k] <= 1:
                    # Edge-truncated boxes legitimately stick out of the
                    # frame by a little (real GT files do this); the scorer
                    # clips IoU, so warn instead of rejecting.
                    warnings.append(f"{bwhere}: {k}={b[k]} slightly outside [0, 1] (edge-truncated box)")
            if b.get("player_ref"):
                named += 1
    if n_complete == 0:
        warnings.append(f"{path}: no frame is marked complete — nothing will be scored")
    if named == 0:
        warnings.append(f"{path}: no box names a player_ref — identity rates will be empty")
    if "template" in str(data.get("video", "")).lower() or "template" in str(data.get("match", "")).lower():
        warnings.append(f"{path}: this looks like a template, not labelled data — do not quote it as a result")
    return errors, warnings


def load_predictions(path: str | Path) -> Frames:
    """Load an OTSI JSON prediction file. Unlike ground truth, every frame
    counts: the ``complete`` flag is ignored for predictions."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    errors, _ = validate_document(data, str(path))
    if errors:
        raise ValueError("; ".join(errors))
    out = Frames(int(data["frame_width"]), int(data["frame_height"]))
    for f in data["frames"]:
        out.by_pts[int(f["pts_us"])] = [
            Box(str(b["id"]), b["x"], b["y"], b["w"], b["h"], b.get("player_ref"),
                bool(b.get("ignore")), bool(b.get("approximate")))
            for b in f["boxes"]
        ]
    return out


def load_json_document(path: str | Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _print_summary(result: dict) -> None:
    d, t, i = result["detection"], result["tracking"], result["identity"]
    print(f"frames scored: {result['frames_scored']}  "
          f"gt boxes: {result['gt_boxes']}  predicted boxes: {result['predicted_boxes']}  "
          f"gt ids: {result['gt_ids']}  predicted ids: {result['predicted_ids']}")
    print(f"detection: precision={d['precision']:.3f} recall={d['recall']:.3f} f1={d['f1']:.3f} "
          f"(tp={d['tp']} fp={d['fp']} fn={d['fn']})")
    print(f"tracking: MOTA={t['mota']:.3f} IDF1={t['idf1']:.3f} HOTA={t['hota']:.3f} "
          f"DetA={t['deta']:.3f} AssA={t['assa']:.3f} "
          f"id_switches={t['id_switches']} fragmentations={t['fragmentations']}")
    wr = i["wrong_identity_rate"]
    print(f"identity: correct={i['correct']} wrong={i['wrong']} unassigned={i['unassigned']} "
          f"switches={i['switches']} wrong_identity_rate="
          f"{wr if wr is None else round(wr, 3)}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="sukhum_benchmark.py",
        description="Score engine predictions against labelled ground truth "
                    "(Track G, ADR-125 draft). Metrics come from "
                    "vie_worker.evaluation.evaluate(); this script only loads, "
                    "validates and reports. No Sukhum number exists until the "
                    "owner selects and labels Sukhum footage.")
    ap.add_argument("--gt", required=True,
                    help="Ground-truth file: OTSI JSON, or MOTChallenge gt.txt "
                         "(with --fps/--width/--height).")
    ap.add_argument("--pred", required=True,
                    help="Prediction file: OTSI JSON in the same shape as the "
                         "ground truth (frames with pts_us and boxes).")
    ap.add_argument("--out", default=None,
                    help="Write the full result (metadata + evaluate() output) "
                         "as JSON to this path.")
    ap.add_argument("--validate-only", action="store_true",
                    help="Only validate the two files structurally; do not score.")
    ap.add_argument("--tol-us", type=int, default=20_000,
                    help="Timestamp tolerance in microseconds when matching a "
                         "prediction frame to a ground-truth frame (default 20000).")
    ap.add_argument("--fps", type=float, default=None,
                    help="Frame rate, required only for MOTChallenge gt.txt ground truth.")
    ap.add_argument("--width", type=int, default=None,
                    help="Frame width in pixels, required only for MOTChallenge gt.txt.")
    ap.add_argument("--height", type=int, default=None,
                    help="Frame height in pixels, required only for MOTChallenge gt.txt.")
    ap.add_argument("--candidates", default=None,
                    help="Optional JSON file: {track_id: [ranked player_refs]} "
                         "for top-k identity accuracy (see evaluation.evaluate).")
    args = ap.parse_args(argv)

    gt_path, pred_path = Path(args.gt), Path(args.pred)
    for p in (gt_path, pred_path):
        if not p.exists():
            print(f"error: file not found: {p}", file=sys.stderr)
            return 2

    # Validate the prediction file structurally (it is always OTSI JSON).
    try:
        pred_doc = load_json_document(pred_path)
    except (OSError, ValueError) as e:
        print(f"error: cannot read predictions {pred_path}: {e}", file=sys.stderr)
        return 2
    errors, warnings = validate_document(pred_doc, str(pred_path))
    for w in warnings:
        print(f"warning: {w}")
    if errors:
        for e in errors:
            print(f"error: {e}", file=sys.stderr)
        return 2

    # Validate the ground-truth file structurally when it is OTSI JSON.
    if gt_path.suffix.lower() == ".json":
        try:
            gt_doc = load_json_document(gt_path)
        except (OSError, ValueError) as e:
            print(f"error: cannot read ground truth {gt_path}: {e}", file=sys.stderr)
            return 2
        g_errors, g_warnings = validate_document(gt_doc, str(gt_path))
        for w in g_warnings:
            print(f"warning: {w}")
        if g_errors:
            for e in g_errors:
                print(f"error: {e}", file=sys.stderr)
            return 2
        if not any(f.get("complete", False) for f in gt_doc["frames"]):
            print("NOT MEASURED: ground truth has no frame marked complete — "
                  "nothing can be scored. Label the footage first (see "
                  "tools/eval/annotations/README.md); do not quote a number.",
                  file=sys.stderr)
            return 2

    if args.validate_only:
        print("validation OK: both files are structurally valid for scoring.")
        return 0

    try:
        gt = load_ground_truth(gt_path, fps=args.fps, width=args.width, height=args.height)
    except (OSError, ValueError) as e:
        print(f"error: cannot load ground truth {gt_path}: {e}", file=sys.stderr)
        return 2
    if not gt.by_pts:
        print("NOT MEASURED: ground truth loaded with zero scored frames.",
              file=sys.stderr)
        return 2
    try:
        pred = load_predictions(pred_path)
    except (OSError, ValueError) as e:
        print(f"error: cannot load predictions {pred_path}: {e}", file=sys.stderr)
        return 2
    candidates = None
    if args.candidates:
        try:
            candidates = json.loads(Path(args.candidates).read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            print(f"error: cannot read candidates {args.candidates}: {e}", file=sys.stderr)
            return 2

    result = evaluate(gt, pred, tol_us=args.tol_us, candidates=candidates)
    _print_summary(result)
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({
            "tool": TOOL,
            "ground_truth": str(gt_path),
            "predictions": str(pred_path),
            "candidates": args.candidates,
            "tol_us": args.tol_us,
            "result": result,
        }, indent=2), encoding="utf-8")
        print(f"full result written to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
