"""Track U.7 measurement: horizon-guided tiling vs full-frame vs blind grids.

Synthetic only — no detector model, no weights and no footage exist in this
workspace, so no real detection accuracy is claimed here. The measurement uses
a stated detector model instead: a player is found by a window iff it is at
least MIN_INPUT_PX tall in the 640 model input, whole inside the window, and
not cut by an inner window edge (the EDGE/LARGE fragment rules from
hf_rtdetr.py). Player heights come from the pinhole relation: apparent height
is linear in |feet_y - horizon_y|, calibrated so a player at the bottom of a
1920x1080 frame is 112 px tall. Two scenes are measured: a broadcast view
(far touchline narrow at the top) and the inverted trapezoid from
test_tracker_u4 (horizon below the frame, small players at the bottom) — the
horizon plan must follow the geometry in both.

Configs: full-frame only (1 pass), blind grids=[2, 3] (1+4+9 = 14 passes),
horizon plan (1 + tiles). Recall is reported by ground-truth box height bin,
the same edges as evaluation.py HEIGHT_BINS.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "worker"))

from vie_worker.detect.tiling import horizon_tiles, horizon_y, passes_for  # noqa: E402
from vie_worker.geometry import dlt  # noqa: E402

W, H = 1920, 1080
MODEL_INPUT = 640
MIN_INPUT_PX = 20.0
OVERLAP = 0.12
HEIGHT_BINS = [(0, 20), (20, 40), (40, 80), (80, 160), (160, 100_000)]


def broadcast_h():
    pitch = np.array([[-52.5, -34], [52.5, -34], [-52.5, 34], [52.5, 34]], float)
    image = np.array([[0.425, 0.05], [0.575, 0.05], [0.025, 0.95], [0.975, 0.95]], float)
    return dlt(pitch, image)


def inverted_h():
    pitch = np.array([[-52.5, -34], [52.5, -34], [-52.5, 34], [52.5, 34]], float)
    image = np.array([[0.05, 0.15], [0.95, 0.15], [0.25, 0.90], [0.75, 0.90]], float)
    return dlt(pitch, image)


def players(h0_norm):
    """Synthetic players: feet from the far touchline to the bottom, three
    across the frame, heights from the pinhole relation (bottom = 112 px)."""
    c = 112.0 / abs(H - h0_norm * H)
    out = []
    for feet_y in range(60, H, 20):
        h = c * abs(feet_y - h0_norm * H)
        for cx in (0.2, 0.5, 0.8):
            w = 0.4 * h
            box = (cx * W - w / 2, feet_y - h, w, h)
            # recall is measured on whole on-screen players only: a box whose
            # head is above the frame is not a player the detector could find whole
            if box[0] >= 0 and box[1] >= 0 and box[0] + w <= W and feet_y <= H:
                out.append(box)
    return out


def found_in_window(box, win):
    """The fragment rules from hf_rtdetr.py, applied to the synthetic model:
    the box must lie whole inside the window, not touch an inner window edge,
    and be shorter than LARGE (0.45) of the window height."""
    x, y, w, h = box
    wx, wy, ww, wh = win
    if h > 0.45 * wh:
        return False
    if x < wx or y < wy or x + w > wx + ww or y + h > wy + wh:
        return False
    edge = 3.0
    if (x <= wx + edge and wx > 0) or (y <= wy + edge and wy > 0):
        return False
    if (x + w >= wx + ww - edge and wx + ww < W) or (y + h >= wy + wh - edge and wy + wh < H):
        return False
    return h * MODEL_INPUT / wh >= MIN_INPUT_PX


def blind_windows():
    wins = [(0, 0, W, H)]
    for g in (2, 3):
        tw, th = int(W / g * (1 + OVERLAP)), int(H / g * (1 + OVERLAP))
        xs = np.linspace(0, W - tw, g).astype(int)
        ys = np.linspace(0, H - th, g).astype(int)
        wins += [(int(x), int(y), tw, th) for y in ys for x in xs]
    return wins


def recall_by_bin(players_, wins):
    out = {}
    for lo, hi in HEIGHT_BINS:
        members = [b for b in players_ if lo <= b[3] < hi]
        found = sum(1 for b in members if any(found_in_window(b, w) for w in wins))
        out[f"{lo}-{hi}"] = (found, len(members), found / len(members) if members else None)
    return out


def run_scene(name, Hm):
    h0 = horizon_y(Hm)
    assert h0 is not None
    ps = players(h0)
    plan = horizon_tiles(W, H, Hm)
    configs = {
        "full-frame": [(0, 0, W, H)],
        "blind grids [2,3]": blind_windows(),
        "horizon plan": [(0, 0, W, H)] + [(t.x, t.y, t.w, t.h) for t in plan],
    }
    print(f"\n{name}: horizon_y={h0:.3f} (px {h0 * H:.0f}), {len(ps)} synthetic players, "
          f"horizon tiles={len(plan)} (passes {passes_for(plan)}), blind passes 14")
    print(f"{'height bin':>10} | {'full-frame':>10} | {'blind [2,3]':>11} | {'horizon':>10}")
    for lo, hi in HEIGHT_BINS:
        row = []
        for wins in configs.values():
            f, n, r = recall_by_bin(ps, wins)[f"{lo}-{hi}"]
            row.append(f"{f}/{n}={r:.3f}" if r is not None else "  -  ")
        print(f"{lo}-{hi:>7}px | {row[0]:>10} | {row[1]:>11} | {row[2]:>10}")
    # coverage: every small player (height < 40 px) must lie whole in >= 1 horizon tile
    far = [b for b in ps if b[3] < 40]
    inside = sum(1 for b in far if any(t.x <= b[0] and b[0] + b[2] <= t.x + t.w and t.y <= b[1] and b[1] + b[3] <= t.y + t.h for t in plan))
    print(f"small players (<40 px): {len(far)}, whole inside >=1 horizon tile: {inside}")
    return configs


if __name__ == "__main__":
    run_scene("broadcast", broadcast_h())
    run_scene("inverted trapezoid", inverted_h())
    print("\nDetector model: found iff height in the 640 model input >= 20 px, whole inside a window, "
          "not cut by an inner edge, shorter than 0.45x window height. Synthetic only: no model, "
          "no footage, no real detection accuracy claimed.")
