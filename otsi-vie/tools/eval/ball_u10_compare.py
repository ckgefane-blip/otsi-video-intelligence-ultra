"""Track U.10: bounce/rolling ball handover, flight/handover off vs on, on synthetic scenes.

Reuses the scenes from ball_u9_compare.py:

Scene V (bounce + occlusion, the U.9 known limit): the ball lands at a running
player's feet, is hidden behind him for 4 frames, then rolls away just ahead
of him while his boot out-scores the ball for the whole shot. U.9 improved it
(precision 0.023 -> 0.279) but could not settle it - after a bounce the ball's
motion is new, so the flight model cannot vouch for the pieces that follow,
and the boot glued to the ball wins the path search on weight. U.10 settles it
two ways: a roll piece that starts where a flight landed carries the ball
across the bounce (a handover, not a restart, HANDOVER_BONUS), and a piece
from a tracklet glued to one player's feet for its whole life pays
GLUE_PENALTY, so the boot cannot win on detector score alone.

Scene M (long-arc blur gap) and M-short: no-regression checks - the handover
must not make the U.9 wins worse.

Guardrail: the linear-ball scene from tests/test_ball.py (no gravity), inlined
here as in ball_u9_compare.py so the handover can be run on it too: the flight
must not fire and the glue penalty must not touch the ball, so handover on
must give the same answer as off.

All scenes are synthetic (no footage, no model): they measure the handover
logic, not a real ball-tracking accuracy. A real number needs labelled
Sukhum ball-flight segments.

Usage: python3 otsi-vie/tools/eval/ball_u10_compare.py [--seed N] [--seeds A B ...]
"""
from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "worker"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from vie_worker import ball

import ball_u9_compare as cmp9

STEP = 1_000_000 / 6
W, H = 1280, 720
ASPECT = W / H

COMBOS = ((False, False), (True, False), (True, True), (False, True))


def run_scene(build, seed):
    frames, persons, truth, hidden = build(seed=seed)
    shot_of = {p: 0 for p in frames}
    kept, _why = ball.plausible(frames, persons, shot_of, W, H, STEP)
    marks = [{"pts_us": p, "visible": p not in hidden, "x": t[0], "y": t[1]} for p, t in truth.items()]
    return {(uf, uh): ball.evaluate(
        ball.follow_ball(kept, shot_of, STEP, ASPECT, use_flight=uf, use_handover=uh), marks, STEP, W, H)
        for uf, uh in COMBOS}


def run_linear(seed):
    """The linear-ball guardrail scene (tests/test_ball.py's scene, inlined as in
    ball_u9_compare.py): the ball moves linearly (no gravity) among boots, a logo
    dot, a crest and stands."""
    rnd = random.Random(seed)
    frames, persons, truth = {}, {}, {}
    bx, by, vx, vy = 0.2, 0.5, 0.12, 0.02
    players = [[rnd.uniform(0.1, 0.9), rnd.uniform(0.3, 0.8)] for _ in range(6)]
    for k in range(int(30 * 6)):
        pts = int(round(k * STEP))
        if k % 30 == 0:
            vx, vy = rnd.uniform(-0.25, 0.25), rnd.uniform(-0.1, 0.1)
        bx, by = min(0.95, max(0.05, bx + vx / 6)), min(0.9, max(0.1, by + vy / 6))
        if bx in (0.05, 0.95):
            vx = -vx
        if by in (0.1, 0.9):
            vy = -vy
        hidden = 60 <= k < 70
        truth[pts] = None if hidden else (bx, by)
        cands = []
        if not hidden and k % 7 != 3:
            cands.append(ball.Cand(pts, bx + rnd.gauss(0, 0.001), by + rnd.gauss(0, 0.001), 7.0, rnd.uniform(0.22, 0.5)))
        boxes = []
        for p in players:
            p[0] = min(0.95, max(0.05, p[0] + rnd.gauss(0, 0.004)))
            p[1] = min(0.9, max(0.2, p[1] + rnd.gauss(0, 0.004)))
            boxes.append((p[0] - 0.01, p[1] - 0.09, 0.02, 0.09))
            if rnd.random() < 0.6:
                cands.append(ball.Cand(pts, p[0] + rnd.uniform(-0.01, 0.01), p[1] - 0.004, 6.0, rnd.uniform(0.2, 0.4)))
        cands.append(ball.Cand(pts, 0.956, 0.048, 9.0, 0.3, on_pitch=True))
        if rnd.random() < 0.5:
            b = boxes[0]
            cands.append(ball.Cand(pts, b[0] + b[2] / 2, b[1] + 0.25 * b[3], 6.0, 0.45))
        if rnd.random() < 0.3:
            cands.append(ball.Cand(pts, rnd.random(), 0.05, 6.0, 0.35, on_pitch=False))
        frames[pts], persons[pts] = cands, boxes
    shot_of = {p: int(p // (10 * 1_000_000)) for p in frames}
    kept, _why = ball.plausible(frames, persons, shot_of, W, H, STEP)
    marks = [{"pts_us": p, "visible": t is not None, "x": t[0] if t else None, "y": t[1] if t else None}
             for p, t in truth.items()]
    return {(uf, uh): ball.evaluate(
        ball.follow_ball(kept, shot_of, STEP, ASPECT, use_flight=uf, use_handover=uh), marks, STEP, W, H)
        for uf, uh in COMBOS}


def show(name, results):
    print(f"  {name}:")
    for (uf, uh), q in results.items():
        print(f"    flight={'on ' if uf else 'off'} handover={'on ' if uh else 'off'}: "
              f"precision={q['precision']} recall={q['recall']} right={q['right']} wrong={q['wrong']} "
              f"unknown={q['unknown']} invented={q['invented']}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--seeds", type=int, nargs="*", default=None)
    args = ap.parse_args()
    seeds = args.seeds if args.seeds is not None else [args.seed]
    for seed in seeds:
        print(f"seed={seed}:")
        show("V bounce + occlusion (U.9 known limit)", run_scene(cmp9.scene_v, seed))
        show("M long-arc blur gap", run_scene(cmp9.scene_m, seed))
        show("M-short (no-regression)", run_scene(cmp9.scene_m_short, seed))
        show("Guardrail (linear ball, tests/test_ball.py scene)", run_linear(seed))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
