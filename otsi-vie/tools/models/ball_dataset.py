"""Training crops for the ball model (ADR-038) from ONE analysed video, nobody clicking.

Positives: frames where the engine's ball path (vie_worker.ball, ADR-037) stands on a detection the detector itself is sure of (score >= 0.6):
on the owner's match 18 of 18 checked by eye were the ball, including 4-11 px balls far away. Each sample is three consecutive video frames
(the frame before, the analysed frame, the frame after: a moving ball is easiest to see), cropped to CROP x CROP pixels at full resolution.
Negatives from the same frames: one crop around a decoy candidate (a boot, a sock, a pitch mark, the logo) and one random crop, both without
the ball. A person's marks (ball_marks) are added as positives / negatives where they exist. The last HOLDOUT share of the match is kept
apart for validation.

  python otsi-vie/tools/models/ball_dataset.py --video <id> [--out .local/ball-train]     (the main .venv: worker modules and the dev DB)

Output: <out>/<video>/x.npy (N, CROP, CROP, 9) uint8, y.npy (N, 3) float32 [ball present, x, y in crop pixels], meta.json. Local data of the
owner's footage: never committed (.local/).
"""
from __future__ import annotations

import argparse
import bisect
import json
import os
import random
import sys
import time
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import pymysql

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "otsi-vie" / "services" / "worker"))
sys.path.insert(0, str(ROOT / "otsi-vie" / "tools" / "dev"))

import local_stack  # noqa: E402
from vie_worker import ball, ff  # noqa: E402
from vie_worker.ball_job import load_candidates, pitch_lookup  # noqa: E402

CROP = 128
SURE = 0.6
HOLDOUT = 0.15
SEGMENT_GAP_US = 1_000_000
MARGIN = 12                     # the ball's centre stays this far inside a crop


def connect(env: dict):
    u = urlparse(env["OTSI_VIE_DB_DSN"])
    return pymysql.connect(host=u.hostname, port=u.port, user=u.username, password=u.password, database=u.path[1:], cursorclass=pymysql.cursors.DictCursor)


def crop(frames3: list[np.ndarray], cx: int, cy: int) -> tuple[np.ndarray, int, int]:
    h, w = frames3[0].shape[:2]
    x0, y0 = min(max(0, cx), w - CROP), min(max(0, cy), h - CROP)
    return np.concatenate([f[y0:y0 + CROP, x0:x0 + CROP] for f in frames3], axis=2), x0, y0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", default=str(ROOT / ".local" / "ball-train"))
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    env = local_stack.prepare("owner")
    store = Path(env["OTSI_VIE_STORAGE_DIR"])
    c = connect(env)
    with c.cursor() as cur:
        cur.execute("""SELECT v.width, v.height, v.duration_us, a.object_key FROM video_sources v JOIN assets a ON a.id = v.source_asset_id WHERE v.id = %s""", (a.video,))
        v = cur.fetchone()
        cur.execute("SELECT b.run_id, b.metrics FROM ball_tracks b WHERE b.video_id = %s AND b.status = 'SUCCEEDED' ORDER BY b.created_at DESC LIMIT 1", (a.video,))
        bt = cur.fetchone()
        cur.execute("SELECT r.config FROM pipeline_runs r WHERE r.id = %s", (bt["run_id"],))
        cfg = json.loads(cur.fetchone()["config"])
        cur.execute("SELECT aa.object_key FROM detection_batches d JOIN assets aa ON aa.id = d.payload_asset_id WHERE d.run_id = %s LIMIT 1", (bt["run_id"],))
        det_key = cur.fetchone()["object_key"]
        cur.execute("SELECT start_pts_us FROM video_shots WHERE run_id = %s ORDER BY start_pts_us", (bt["run_id"],))
        starts = [int(r["start_pts_us"]) for r in cur.fetchall()]
        cur.execute("SELECT start_pts_us, end_pts_us, transform_matrix, pitch_length_m, pitch_width_m, quality_score FROM pitch_calibrations WHERE video_id = %s", (a.video,))
        pitch_at = pitch_lookup(cur.fetchall())
        cur.execute("SELECT pts_us, visible, x, y FROM ball_marks WHERE video_id = %s", (a.video,))
        marks = cur.fetchall()
    W, H, dur = int(v["width"]), int(v["height"]), int(v["duration_us"])
    step = 1_000_000 / float(cfg.get("sample_fps") or 2)
    frames, persons = load_candidates(str(store.joinpath(*det_key.split("/"))), W, H)
    shot_of = {p: max(0, bisect.bisect_right(starts, p) - 1) for p in frames}
    kept, _ = ball.plausible(frames, persons, shot_of, W, H, step, pitch_at)
    path = ball.follow_ball(kept, shot_of, step, W / H)
    near = {(c_.pts_us, round(c_.x, 4), round(c_.y, 4)): c_ for vv in kept.values() for c_ in vv}
    samples: dict[int, tuple[bool, float | None, float | None, str]] = {}
    for p in path:
        q = near.get((p.pts_us, round(p.x, 4), round(p.y, 4)))
        if p.state == "DETECTED" and q is not None and q.score >= SURE:
            samples[p.pts_us] = (True, p.x, p.y, "engine")
    for m in marks:                                                        # a person's mark is the truth
        samples[int(m["pts_us"])] = (bool(m["visible"]), m["x"], m["y"], "mark")
    times = sorted(samples)
    print(f"{len(times)} frames ({sum(s[3] == 'mark' for s in samples.values())} marked)", flush=True)

    segs, cur_seg = [], []
    for t in times:
        if cur_seg and t - cur_seg[-1] > SEGMENT_GAP_US:
            segs.append(cur_seg); cur_seg = []
        cur_seg.append(t)
    if cur_seg:
        segs.append(cur_seg)
    out = Path(a.out) / a.video
    out.mkdir(parents=True, exist_ok=True)
    cap = len(times) * 3
    X = np.lib.format.open_memmap(out / "x.npy", mode="w+", dtype=np.uint8, shape=(cap, CROP, CROP, 9))
    Y = np.zeros((cap, 3), np.float32)
    meta = []
    n, t0, src = 0, time.time(), str(store.joinpath(*v["object_key"].split("/")))
    for si, seg in enumerate(segs):
        got = list(ff.decode_sampled(src, None, start_us=max(0, seg[0] - 150_000), end_us=seg[-1] + 150_000, seek=True, width=W, height=H))
        ft = [f.pts_us for f in got]
        for t in seg:
            i = min(range(len(ft)), key=lambda k: abs(ft[k] - t)) if ft else -1
            if i <= 0 or i >= len(got) - 1 or abs(ft[i] - t) > 20_000:
                continue
            f3 = [got[i - 1].rgb, got[i].rgb, got[i + 1].rgb]
            has, bx, by, why = samples[t]
            split = "val" if t > dur * (1 - HOLDOUT) else "train"
            if has:
                px, py = bx * W, by * H
                x, x0, y0 = crop(f3, int(px - rnd.uniform(MARGIN, CROP - MARGIN)), int(py - rnd.uniform(MARGIN, CROP - MARGIN)))
                X[n], Y[n] = x, (1.0, px - x0, py - y0); meta.append([t, split, why, "ball"]); n += 1
                decoys = [d for d in frames.get(t, []) if np.hypot((d.x - bx) * W, (d.y - by) * H) > 40]
                if decoys:
                    d = rnd.choice(decoys)
                    dx, dy = d.x * W, d.y * H
                    x, x0, y0 = crop(f3, int(dx - rnd.uniform(MARGIN, CROP - MARGIN)), int(dy - rnd.uniform(MARGIN, CROP - MARGIN)))
                    if not (x0 <= px < x0 + CROP and y0 <= py < y0 + CROP):
                        X[n], Y[n] = x, (0.0, -1, -1); meta.append([t, split, why, "decoy"]); n += 1
            for _ in range(5):                                             # a random crop without the ball
                x, x0, y0 = crop(f3, rnd.randrange(0, W - CROP), rnd.randrange(0, H - CROP))
                if not has or not (x0 - 8 <= bx * W < x0 + CROP + 8 and y0 - 8 <= by * H < y0 + CROP + 8):
                    X[n], Y[n] = x, (0.0, -1, -1); meta.append([t, split, why, "random"]); n += 1
                    break
        if si % 25 == 0:
            print(f"segment {si + 1}/{len(segs)}: {n} crops, {time.time() - t0:.0f} s", flush=True)
    X.flush()
    np.save(out / "y.npy", Y[:n])
    json.dump({"video": a.video, "n": n, "crop": CROP, "size": [W, H], "step_us": step, "rows": meta}, open(out / "meta.json", "w"))
    print(f"done: {n} crops in {time.time() - t0:.0f} s -> {out}", flush=True)


if __name__ == "__main__":
    main()
