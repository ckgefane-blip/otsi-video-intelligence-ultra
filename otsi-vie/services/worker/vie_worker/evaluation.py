"""Evaluation of detection, tracking and identity against MANUALLY LABELLED ground truth (ADR-034).

Accuracy claims about the engine are made only from this module run against ground truth that people labelled. The engine's own tracks
are never used as ground truth. Ground truth comes in either of two forms:

  * OTSI JSON  {"video": .., "labeller": .., "frame_width": W, "frame_height": H, "frames": [{"pts_us": t, "complete": true,
               "boxes": [{"id": "g7", "x": .., "y": .., "w": .., "h": .., "player_ref": "OTSI-NGA-2026-000123" | null}]}]}
               boxes normalised to the frame (0..1); only frames marked complete (every visible player boxed) are scored;
  * MOTChallenge gt.txt  (`frame,id,x,y,w,h,conf,class,visibility`, pixels, 1-based frames; e.g. exported by CVAT) with the frame rate.

Predictions are per analysed frame: (pts_us, track id, box, optional confirmed player ref). A prediction frame is compared with the
ground-truth frame at the same timestamp (within half a frame).

Metrics
  detection  precision / recall / F1 at IoU >= 0.5 (Hungarian matching per frame), recall by ground-truth box height in pixels and
             precision by predicted box height (tiny players are the grassroots problem);
  tracking   CLEAR-MOT (MOTA, ID switches, fragmentations), IDF1 (global bipartite id matching), HOTA (TrackEval definition: alignment-
             weighted matching, alpha 0.05..0.95, DetA x AssA);
  identity   over matched boxes whose ground truth names a player: correct / wrong / not assigned, the wrong-identity rate among assigned
             boxes (the number that must stay near zero), identity switches, and top-k accuracy of ranked candidates per track.
"""
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

HEIGHT_BINS = [(0, 20), (20, 40), (40, 80), (80, 160), (160, 100_000)]       # box height in pixels
IOU = 0.5
ALPHAS = np.arange(0.05, 0.96, 0.05)
EPS = 1e-9


@dataclass
class Box:
    id: str
    x: float
    y: float
    w: float
    h: float
    player_ref: str | None = None
    ignore: bool = False          # ground truth: an official or a truncated person — neither found nor missed; predictions on it are not FPs
    approximate: bool = False     # ground truth placed from the feet mark (no candidate box): matched by feet position, not IoU


@dataclass
class Frames:
    """Boxes per timestamp (normalised coordinates) and the frame size in pixels."""
    width: int
    height: int
    by_pts: dict[int, list[Box]] = field(default_factory=dict)


def load_ground_truth(path: str | Path, *, fps: float | None = None, width: int | None = None, height: int | None = None) -> Frames:
    p = Path(path)
    if p.suffix.lower() == ".json":
        j = json.loads(p.read_text(encoding="utf-8"))
        g = Frames(int(j["frame_width"]), int(j["frame_height"]))
        for f in j["frames"]:
            if f.get("complete", False):
                g.by_pts[int(f["pts_us"])] = [Box(str(b["id"]), b["x"], b["y"], b["w"], b["h"], b.get("player_ref"), bool(b.get("ignore")), bool(b.get("approximate")))
                                              for b in f["boxes"]]
        return g
    if not (fps and width and height):
        raise ValueError("MOTChallenge ground truth needs fps, width and height")
    g = Frames(width, height)
    for line in p.read_text(encoding="utf-8").splitlines():
        v = line.strip().split(",")
        if len(v) < 6 or (len(v) >= 7 and float(v[6]) == 0):            # conf 0 = ignore region
            continue
        if len(v) >= 8 and int(float(v[7])) not in (1, 2, 7):            # pedestrian / person on vehicle / static person
            continue
        pts = round((int(v[0]) - 1) / fps * 1e6)
        g.by_pts.setdefault(pts, []).append(Box(v[1], float(v[2]) / width, float(v[3]) / height, float(v[4]) / width, float(v[5]) / height))
    return g


def iou_matrix(a: list[Box], b: list[Box]) -> np.ndarray:
    if not a or not b:
        return np.zeros((len(a), len(b)))
    A = np.array([[x.x, x.y, x.x + x.w, x.y + x.h] for x in a])
    B = np.array([[x.x, x.y, x.x + x.w, x.y + x.h] for x in b])
    ix = np.clip(np.minimum(A[:, None, 2], B[None, :, 2]) - np.maximum(A[:, None, 0], B[None, :, 0]), 0, None)
    iy = np.clip(np.minimum(A[:, None, 3], B[None, :, 3]) - np.maximum(A[:, None, 1], B[None, :, 1]), 0, None)
    inter = ix * iy
    area = lambda M: (M[:, 2] - M[:, 0]) * (M[:, 3] - M[:, 1])            # noqa: E731
    return inter / np.maximum(area(A)[:, None] + area(B)[None, :] - inter, EPS)


def similarity(g: list[Box], p: list[Box]) -> np.ndarray:
    """IoU; for an approximately placed ground-truth player, 0.6 when a prediction's feet are at the marked feet (else 0)."""
    S = iou_matrix(g, p)
    for r, b in enumerate(g):
        if b.approximate:
            fx, fy = b.x + b.w / 2, b.y + b.h
            for c, q in enumerate(p):
                qx, qy = q.x + q.w / 2, q.y + q.h
                S[r, c] = 0.6 if abs(qx - fx) <= max(0.6 * q.w, 0.006) and abs(qy - fy) <= max(0.3 * q.h, 0.012) else 0.0
    return S


def _drop_ignored(g: list[Box], p: list[Box]) -> tuple[list[Box], list[Box]]:
    """Ignore regions: removed from the ground truth, and predictions overlapping them (IoU >= 0.3) are removed too."""
    ign = [b for b in g if b.ignore]
    if not ign:
        return g, p
    S = iou_matrix(ign, p)
    keep = [q for c, q in enumerate(p) if not (S[:, c] >= 0.3).any()]
    return [b for b in g if not b.ignore], keep


def _pairs(gt: Frames, pred: Frames, tol_us: int) -> list[tuple[list[Box], list[Box]]]:
    """Ground-truth frames with the prediction frame at the same time (an unmatched gt frame counts with no predictions)."""
    keys = np.array(sorted(pred.by_pts))
    out = []
    for t in sorted(gt.by_pts):
        p: list[Box] = []
        if keys.size:
            i = int(np.argmin(np.abs(keys - t)))
            if abs(int(keys[i]) - t) <= tol_us:
                p = pred.by_pts[int(keys[i])]
        out.append(_drop_ignored(gt.by_pts[t], p))
    return out


def _bin(px: float) -> str:
    for lo, hi in HEIGHT_BINS:
        if lo <= px < hi:
            return f"{lo}-{hi}" if hi < 100_000 else f">={lo}"
    return "?"


def evaluate(gt: Frames, pred: Frames, *, tol_us: int = 20_000, candidates: dict[str, list[str]] | None = None) -> dict:
    H = gt.height
    pairs = _pairs(gt, pred, tol_us)
    det = {"tp": 0, "fp": 0, "fn": 0}
    rec_bins: dict[str, list[int]] = defaultdict(lambda: [0, 0])       # bin -> [tp, gt]
    prec_bins: dict[str, list[int]] = defaultdict(lambda: [0, 0])      # bin -> [tp, pred]
    last_match: dict[str, str] = {}                                     # gt id -> pred id at its last match
    was_tracked: dict[str, bool] = {}
    idsw = frag = 0
    idents = {"correct": 0, "wrong": 0, "unassigned": 0, "switches": 0}
    last_ident: dict[str, str] = {}
    track_votes: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))   # pred track -> gt player_ref -> frames
    # id-level counts for IDF1 and HOTA
    gt_ids = sorted({b.id for g, _ in pairs for b in g})
    pr_ids = sorted({b.id for _, p in pairs for b in p})
    gi, pi = {k: i for i, k in enumerate(gt_ids)}, {k: i for i, k in enumerate(pr_ids)}
    overlap = np.zeros((len(gt_ids), len(pr_ids)))                      # frames each (gt, pred) pair overlaps at IoU >= 0.5
    gt_count, pr_count = np.zeros(len(gt_ids)), np.zeros(len(pr_ids))
    potential = np.zeros((len(gt_ids), len(pr_ids)))
    sims: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []

    for g, p in pairs:
        S = similarity(g, p)
        gix, pix = np.array([gi[b.id] for b in g], dtype=int), np.array([pi[b.id] for b in p], dtype=int)
        gt_count[gix] += 1
        pr_count[pix] += 1
        if S.size:
            overlap[np.ix_(gix, pix)] += S >= IOU
            denom = S.sum(0)[None, :] + S.sum(1)[:, None] - S
            potential[np.ix_(gix, pix)] += np.where(denom > EPS, S / np.maximum(denom, EPS), 0)
        sims.append((S, gix, pix))
        rows, cols = linear_sum_assignment(-S) if S.size else (np.array([], int), np.array([], int))
        matched = [(r, c) for r, c in zip(rows, cols) if S[r, c] >= IOU]
        det["tp"] += len(matched)
        det["fn"] += len(g) - len(matched)
        det["fp"] += len(p) - len(matched)
        mg, mp = {r for r, _ in matched}, {c for _, c in matched}
        for r, b in enumerate(g):
            k = _bin(b.h * H)
            rec_bins[k][1] += 1
            rec_bins[k][0] += r in mg
        for c, b in enumerate(p):
            k = _bin(b.h * H)
            prec_bins[k][1] += 1
            prec_bins[k][0] += c in mp
        seen = set()
        for r, c in matched:
            gid, pid = g[r].id, p[c].id
            seen.add(gid)
            if gid in last_match and last_match[gid] != pid:
                idsw += 1
            if gid in was_tracked and not was_tracked[gid]:
                frag += 1
            last_match[gid] = pid
            was_tracked[gid] = True
            ref = g[r].player_ref
            if ref:
                track_votes[pid][ref] += 1
                assigned = p[c].player_ref
                if assigned is None:
                    idents["unassigned"] += 1
                else:
                    idents["correct" if assigned == ref else "wrong"] += 1
                    if ref in last_ident and last_ident[ref] != assigned:
                        idents["switches"] += 1
                    last_ident[ref] = assigned
        for b in g:
            if b.id not in seen and b.id in was_tracked:
                was_tracked[b.id] = False

    n_gt, n_pr = int(gt_count.sum()), int(pr_count.sum())
    # IDF1: one-to-one gt id <-> pred id assignment maximising frames matched
    if overlap.size:
        r, c = linear_sum_assignment(-overlap)
        idtp = float(overlap[r, c].sum())
    else:
        idtp = 0.0
    idf1 = 2 * idtp / max(EPS, n_gt + n_pr)
    # HOTA (TrackEval): alignment score first, then per-frame matching weighted by it, for every alpha
    align = potential / np.maximum(gt_count[:, None] + pr_count[None, :] - potential, EPS) if potential.size else potential
    tp_a = np.zeros(len(ALPHAS))
    match_counts = [np.zeros((len(gt_ids), len(pr_ids))) for _ in ALPHAS]
    for S, gix, pix in sims:
        if not S.size:
            continue
        rows, cols = linear_sum_assignment(-(align[np.ix_(gix, pix)] * S))
        for a, alpha in enumerate(ALPHAS):
            ok = S[rows, cols] >= alpha - EPS
            tp_a[a] += ok.sum()
            np.add.at(match_counts[a], (gix[rows[ok]], pix[cols[ok]]), 1)
    hota, deta, assa = [], [], []
    for a in range(len(ALPHAS)):
        tp, fn, fp = tp_a[a], n_gt - tp_a[a], n_pr - tp_a[a]
        d = tp / max(EPS, tp + fn + fp) if (n_gt or n_pr) else 1.0
        m = match_counts[a]
        ass = m / np.maximum(gt_count[:, None] + pr_count[None, :] - m, EPS) if m.size else m
        aa = float((m * ass).sum() / max(1.0, tp))
        deta.append(d); assa.append(aa); hota.append(float(np.sqrt(d * aa)))

    tp, fp, fn = det["tp"], det["fp"], det["fn"]
    prec = tp / max(1, tp + fp)
    rec = tp / max(1, tp + fn)
    assigned = idents["correct"] + idents["wrong"]
    named = assigned + idents["unassigned"]
    out = {
        "frames_scored": len(pairs), "gt_boxes": n_gt, "predicted_boxes": n_pr, "gt_ids": len(gt_ids), "predicted_ids": len(pr_ids),
        "detection": {"tp": tp, "fp": fp, "fn": fn, "precision": prec, "recall": rec, "f1": 2 * prec * rec / max(EPS, prec + rec),
                      "recall_by_height_px": {k: {"recall": v[0] / v[1], "gt": v[1]} for k, v in _ordered(rec_bins)},
                      "precision_by_height_px": {k: {"precision": v[0] / v[1], "predicted": v[1]} for k, v in _ordered(prec_bins)}},
        "tracking": {"mota": 1 - (fn + fp + idsw) / max(1, n_gt), "id_switches": idsw, "fragmentations": frag, "idf1": idf1,
                     "hota": float(np.mean(hota)), "deta": float(np.mean(deta)), "assa": float(np.mean(assa))},
        "identity": {**idents, "named_matched_boxes": named,
                     "wrong_identity_rate": idents["wrong"] / assigned if assigned else None,
                     "correct_identity_rate": idents["correct"] / named if named else None},
    }
    if candidates is not None:
        truth = {pid: max(v.items(), key=lambda kv: kv[1])[0] for pid, v in track_votes.items() if v}
        topk = {}
        for k in (1, 3, 5):
            hits = [truth[t] in candidates.get(t, [])[:k] for t in truth]
            topk[f"top{k}"] = sum(hits) / len(hits) if hits else None
        out["identity"]["candidates"] = {"tracks_with_truth": len(truth), **topk}
    return out


def _ordered(bins: dict[str, list[int]]):
    order = [(f"{lo}-{hi}" if hi < 100_000 else f">={lo}") for lo, hi in HEIGHT_BINS]
    return [(k, bins[k]) for k in order if k in bins and bins[k][1]]
