"""Calibrate the appearance thresholds of vie_worker.appearance on real footage (ADR-031), with the production embedder (DINOv2-small, FP16 on
the Arc GPU) and the production link score (0.75 * cosine + 0.25 * kit similarity).

Same protocol as reid_study.py (dense reference tracks; query = first 40 %, gallery = last 40 %): the SAME-person pairs are a track's
two pieces, the DIFFERENT-person pairs are pieces of tracks visible at the same time. Reported per clip and pooled:
  * percentiles of the same-person cosine of a track's two halves -> the identity-switch warning threshold (flag only clear outliers)
  * link score distributions -> MIN_SCORE, with the precision a threshold would have among the candidates (same vs different)
  * how crop count affects the half-vs-half cosine (few crops = noisy) -> minimum crops for the drift check

  python otsi-vie/tools/models/appearance_calibration.py <cache.pkl>::<video> ... --out <dir>
"""
from __future__ import annotations

import argparse
import json
import pickle
import sys
from pathlib import Path

import numpy as np

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / "services" / "worker"))
sys.path.insert(0, str(APP / "tools" / "models"))
from vie_worker import ff  # noqa: E402
from vie_worker.appearance import _hellinger, kit_histogram  # noqa: E402
from vie_worker.embed import Embedder  # noqa: E402
import reid_study as R  # noqa: E402
import sampling_study as S  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pairs", nargs="+")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    emb = Embedder("dinov2_small")
    pooled = {"same_cos": [], "same_score": [], "diff_score": [], "drift_by_crops": {}}
    report = {"embedder": emb.runtime, "clips": []}
    for pair in a.pairs:
        cache, video = pair.split("::")
        data = pickle.load(open(cache, "rb"))
        frames = data["frames"]
        ref, _ = S.run_tracker(frames, list(range(len(frames))), cmc=False)
        ps = R.pieces(ref)
        need = {}
        for k, p in enumerate(ps):
            for part in ("q", "g"):
                p[part + "_crops"] = R.pick(p[part], 8)
                for o in p[part + "_crops"]:
                    need.setdefault(o.frame_index, []).append((k, part, o))
        crops = {(k, part): [] for k in range(len(ps)) for part in ("q", "g")}
        last = max(need)
        for f in ff.decode_sampled(video, None, max_width=1920):
            for k, part, o in need.pop(f.frame_index, []):
                crops[(k, part)].append(R.crop(f.rgb, o))
            if f.frame_index >= last:
                break
        vec, kit = {}, {}
        for kk, cs in crops.items():
            if cs:
                v = emb(cs)
                m = v.mean(0)
                vec[kk] = m / np.linalg.norm(m)
                kit[kk] = np.mean([kit_histogram(c) for c in cs], axis=0)
                # half-vs-half cosine with n crops per half: how many crops make the drift check stable
                for n in (1, 2, 3, 4):
                    if len(v) >= 2 * n:
                        x, y = v[:n].mean(0), v[-n:].mean(0)
                        pooled["drift_by_crops"].setdefault(n, []).append(float(x @ y / np.linalg.norm(x) / np.linalg.norm(y)))
        score = lambda i, j: 0.75 * max(0.0, float(vec[(i, "q")] @ vec[(j, "g")])) + 0.25 * (1 - _hellinger(kit[(i, "q")], kit[(j, "g")]))
        same_cos, same, diff = [], [], []
        for i, p in enumerate(ps):
            if (i, "q") not in vec or (i, "g") not in vec:
                continue
            same_cos.append(float(vec[(i, "q")] @ vec[(i, "g")]))
            same.append(score(i, i))
            for j, g in enumerate(ps):
                if j != i and (j, "g") in vec and g["span"][0] <= p["span"][1] and p["span"][0] <= g["span"][1]:
                    diff.append(score(i, j))
        pooled["same_cos"] += same_cos
        pooled["same_score"] += same
        pooled["diff_score"] += diff
        pc = lambda v, q: round(float(np.percentile(v, q)), 3) if v else None
        report["clips"].append({"video": data["meta"]["video"], "pairs_same": len(same), "pairs_different": len(diff),
                                "same_cosine_p5_p25_p50": [pc(same_cos, 5), pc(same_cos, 25), pc(same_cos, 50)],
                                "same_score_p10_p50": [pc(same, 10), pc(same, 50)], "different_score_p50_p90_p99": [pc(diff, 50), pc(diff, 90), pc(diff, 99)]})
    s, d = np.array(pooled["same_score"]), np.array(pooled["diff_score"])
    thresholds = {}
    for t in (0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8):
        tp, fp = int((s >= t).sum()), int((d >= t).sum())
        thresholds[str(t)] = {"same_kept": round(tp / len(s), 3), "different_kept": round(fp / len(d), 3),
                              "precision_if_one_same_per_query": round(tp / (tp + fp), 3) if tp + fp else None}
    report["pooled"] = {"same_cosine_percentiles": {q: round(float(np.percentile(pooled["same_cos"], q)), 3) for q in (1, 5, 10, 25, 50)},
                        "drift_half_vs_half_by_crops_per_half": {n: {"p5": round(float(np.percentile(v, 5)), 3), "p50": round(float(np.percentile(v, 50)), 3), "n": len(v)}
                                                                 for n, v in sorted(pooled["drift_by_crops"].items())},
                        "link_score_thresholds": thresholds}
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "calibration.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
