"""Draw ground truth and a profile's predictions on the annotated frames: matched (cyan), false positive (red), missed player (green),
ignore region (orange). Used to find out WHY a setting gains or loses precision, before it is changed.

  python otsi-vie/tools/eval/show_errors.py --bench D:/OTSI-Workspace/_tmp/bench/diag --clip france_germany --profile ULTRA_SENSITIVE
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw
from scipy.optimize import linear_sum_assignment

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / "services" / "worker"))
from vie_worker.evaluation import Box, _drop_ignored, load_ground_truth, similarity  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bench", required=True)
    ap.add_argument("--clip", required=True)
    ap.add_argument("--profile", required=True)
    ap.add_argument("--frames", default="D:/OTSI-Workspace/_tmp/annot/frames")
    ap.add_argument("--out", default="D:/OTSI-Workspace/_tmp/annot/errors")
    a = ap.parse_args()
    gt = load_ground_truth(Path(__file__).parent / "annotations" / "gt" / f"{a.clip}.json")
    raw = json.loads(Path(f"{a.bench}.preds.json").read_text())[a.clip][a.profile]
    preds = {int(t): [Box(i, x, y, w, h) for i, x, y, w, h in bs] for t, bs in raw.items()}
    meta = json.loads((Path(__file__).parent / "annotations" / "gt" / f"{a.clip}.json").read_text())
    Path(a.out).mkdir(parents=True, exist_ok=True)
    fp_heights = []
    for f in meta["frames"]:
        t = int(f["pts_us"])
        p = next((v for k, v in preds.items() if abs(k - t) <= 40_000), [])
        g_all = gt.by_pts[t]
        g, p2 = _drop_ignored(g_all, p)
        S = similarity(g, p2)
        rows, cols = linear_sum_assignment(-S) if S.size else ([], [])
        mg = {r for r, c in zip(rows, cols) if S[r, c] >= 0.5}
        mp = {c for r, c in zip(rows, cols) if S[r, c] >= 0.5}
        img = Image.open(Path(a.frames) / f"{a.clip}@{f['t']:07.2f}.png").convert("RGB")
        W, H = img.size
        d = ImageDraw.Draw(img)
        box = lambda b, col, wd=2: d.rectangle([b.x * W, b.y * H, (b.x + b.w) * W, (b.y + b.h) * H], outline=col, width=wd)  # noqa: E731
        for b in g_all:
            if b.ignore:
                box(b, (255, 140, 0))
        for r, b in enumerate(g):
            box(b, (0, 255, 0) if r not in mg else (0, 120, 0), 3 if r not in mg else 1)
        for c, b in enumerate(p2):
            box(b, (0, 255, 255) if c in mp else (255, 0, 0))
            if c not in mp:
                fp_heights.append(round(b.h * H))
        img.save(Path(a.out) / f"{a.clip}_{a.profile}_{f['t']:05.1f}.png")
        print(f"{f['t']:5.1f}s gt {len(g)} pred {len(p2)} matched {len(mg)} fp {len(p2) - len(mp)} missed {len(g) - len(mg)}")
    print("fp heights px:", sorted(fp_heights))
    return 0


if __name__ == "__main__":
    sys.exit(main())
