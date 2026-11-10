"""Track U.12: identity veto at crossings, veto off vs on, on synthetic scenes.

The open problem from U.11 (ADR-128): one mixed point remains on seeds 1,
2, 4 and 5 - a lone-candidate steal, a different mechanism from the swap.
At k=12 the ball is hidden and only the boot exists, so the ball's tracklet
takes the boot; at k=18 the ball's candidate is dropped as a duplicate of
the boot beside it, so again only the boot exists and the ball-born tracklet
takes it. There is no second assignment to re-pair, so U.11 cannot help.
U.12 refuses the assignment when another live tracklet that got no
candidate fits it clearly better by identity cost (by at least VETO_MARGIN),
and hands the candidate to that tracklet - and declines whenever the
evidence is not clear. Two guards keep it narrow: the challenger must have
a motion model of its own (at least two points - a one-point tracklet's
motion term is 0 by the U.11 rule, so it would win every veto by default),
and its prediction must lie within TRACK_SLACK of the candidate (it must
actually fit, not merely fit less badly).

Scenes reused from ball_u9_compare.py (V bounce + occlusion, M long-arc
blur gap, M-short) and the linear-ball guardrail from tests/test_ball.py.
The measure here is tracklet purity, not just the final answer: a tracklet
is mixed when its points fall on both sides of the midpoint between the
ball's score and the boots' (V: ball 0.30, boots 0.45-0.50; M/M-short:
ball 0.40, boots 0.45-0.50). Mixed points are the points on the minority
side of a mixed tracklet. The final answer (follow_ball precision) is
reported alongside, as a no-regression check: the path search already
settled scene V in U.10, so the veto's win is at the tracklet level, and
the final answer must not get worse.

All scenes are synthetic (no footage, no model): they measure the veto
logic, not a real ball-tracking accuracy. A real number needs labelled
Sukhum ball-flight segments.

Usage: python3 otsi-vie/tools/eval/ball_u12_compare.py [--seed N] [--seeds A B ...]
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


def purity(tracks, ball_score: float) -> tuple[int, int]:
    """(mixed tracklets, mixed points): a tracklet is mixed when its scores
    fall on both sides of the midpoint between the ball's score and the boots'
    mean (0.475); mixed points are the points on its minority side."""
    mid = (ball_score + 0.475) / 2
    mixed_tracks, mixed_points = 0, 0
    for t in tracks:
        lo = sum(1 for p in t.points if p.score < mid)
        hi = len(t.points) - lo
        if lo and hi:
            mixed_tracks += 1
            mixed_points += min(lo, hi)
    return mixed_tracks, mixed_points


def run_scene(build, seed, ball_score):
    frames, persons, truth, hidden = build(seed=seed)
    shot_of = {p: 0 for p in frames}
    kept, _why = ball.plausible(frames, persons, shot_of, W, H, STEP)
    marks = [{"pts_us": p, "visible": p not in hidden, "x": t[0], "y": t[1]} for p, t in truth.items()]
    out = {}
    for uf in (False, True):
        for uv in (False, True):
            tracks = ball.tracklets(kept, shot_of, STEP, ASPECT, use_flight=uf, use_identity=True, use_veto=uv)
            q = ball.evaluate(ball.follow_ball(kept, shot_of, STEP, ASPECT, use_flight=uf,
                                               use_handover=True, use_identity=True, use_veto=uv),
                              marks, STEP, W, H)
            out[(uf, uv)] = (purity(tracks, ball_score), q)
    return out


def guardrail_frames(seed=3):
    """tests/test_ball.py's linear-ball scene, inlined (that file imports
    pyarrow, which is not installed here): the ball moves linearly (no
    gravity) among wandering players whose boots score 0.2-0.4, overlapping
    the ball's 0.22-0.5, plus a logo dot, a crest and stands."""
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
            cands.append(ball.Cand(pts, bx + rnd.gauss(0, 0.001), by + rnd.gauss(0, 0.001), 7.0,
                                   rnd.uniform(0.22, 0.5)))
        boxes = []
        for p in players:
            p[0] = min(0.95, max(0.05, p[0] + rnd.gauss(0, 0.004)))
            p[1] = min(0.9, max(0.2, p[1] + rnd.gauss(0, 0.004)))
            boxes.append((p[0] - 0.01, p[1] - 0.09, 0.02, 0.09))
            if rnd.random() < 0.6:
                cands.append(ball.Cand(pts, p[0] + rnd.uniform(-0.01, 0.01), p[1] - 0.004, 6.0,
                                       rnd.uniform(0.2, 0.4)))
        cands.append(ball.Cand(pts, 0.956, 0.048, 9.0, 0.3, on_pitch=True))
        if rnd.random() < 0.5:
            b = boxes[0]
            cands.append(ball.Cand(pts, b[0] + b[2] / 2, b[1] + 0.25 * b[3], 6.0, 0.45))
        if rnd.random() < 0.3:
            cands.append(ball.Cand(pts, rnd.random(), 0.05, 6.0, 0.35, on_pitch=False))
        frames[pts], persons[pts] = cands, boxes
    return frames, persons, truth


def run_guardrail(seed):
    frames, persons, truth = guardrail_frames(seed)
    shot_of = {p: int(p // (10 * 1_000_000)) for p in frames}
    kept, _why = ball.plausible(frames, persons, shot_of, W, H, STEP)
    marks = [{"pts_us": p, "visible": t is not None, "x": t[0] if t else None, "y": t[1] if t else None}
             for p, t in truth.items()]
    out = {}
    for uv in (False, True):
        out[uv] = ball.evaluate(ball.follow_ball(kept, shot_of, STEP, ASPECT, use_flight=True,
                                                 use_handover=True, use_identity=True, use_veto=uv),
                                marks, STEP, W, H)
    return out


def show(name, results):
    print(f"  {name}:")
    for (uf, uv), ((mt, mp), q) in results.items():
        print(f"    flight={'on ' if uf else 'off'} veto={'on ' if uv else 'off'}: "
              f"mixed tracklets={mt} mixed points={mp} | "
              f"follow_ball precision={q['precision']} right={q['right']} wrong={q['wrong']} unknown={q['unknown']}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--seeds", type=int, nargs="*", default=None)
    args = ap.parse_args()
    seeds = args.seeds if args.seeds is not None else [args.seed]
    for seed in seeds:
        print(f"seed={seed}:")
        show("V bounce + occlusion (U.11's remaining mixed point)", run_scene(cmp9.scene_v, seed, 0.30))
        show("M long-arc blur gap", run_scene(cmp9.scene_m, seed, 0.40))
        show("M-short (no-regression)", run_scene(cmp9.scene_m_short, seed, 0.40))
        print("  Guardrail (linear ball, veto off vs on - must be identical):")
        for uv, q in run_guardrail(seed).items():
            print(f"    veto={'on ' if uv else 'off'}: precision={q['precision']} right={q['right']} "
                  f"wrong={q['wrong']} unknown={q['unknown']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
