"""Track U.11: tracklet-level identity rule at crossings, identity off vs on,
on synthetic scenes.

The open problem from U.10 (ADR-127): in scene V the two tracklets swap
identities once at the crossing - the boot-born tracklet takes the ball for
the rest of the shot and the ball-born tracklet takes the boot - and only the
path search sorts it out afterwards. U.11 decides the identity at the
association level: when two tracklets cross, each tracklet's own motion model
(flight parabola / straight line) plus its score pattern re-pairs that
frame's assignments when the re-pairing clearly wins, and declines otherwise.

Scenes reused from ball_u9_compare.py (V bounce + occlusion, M long-arc blur
gap, M-short) and ball_u10_compare.py (linear-ball guardrail). The measure
here is tracklet purity, not just the final answer: a tracklet is mixed when
its points fall on both sides of the midpoint between the ball's score and
the boots' (V: ball 0.30, boots 0.45-0.50; M/M-short: ball 0.40, boots
0.45-0.50). Mixed points are the points on the minority side of a mixed
tracklet. The final answer (follow_ball precision) is reported alongside,
as a no-regression check: the path search already settled scene V in U.10,
so U.11's win is at the tracklet level, and the final answer must not get
worse.

All scenes are synthetic (no footage, no model): they measure the identity
logic, not a real ball-tracking accuracy. A real number needs labelled
Sukhum ball-flight segments.

Usage: python3 otsi-vie/tools/eval/ball_u11_compare.py [--seed N] [--seeds A B ...]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "worker"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from vie_worker import ball

import ball_u9_compare as cmp9
import ball_u10_compare as cmp10

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
        for ui in (False, True):
            tracks = ball.tracklets(kept, shot_of, STEP, ASPECT, use_flight=uf, use_identity=ui)
            q = ball.evaluate(ball.follow_ball(kept, shot_of, STEP, ASPECT, use_flight=uf,
                                               use_handover=True, use_identity=ui), marks, STEP, W, H)
            out[(uf, ui)] = (purity(tracks, ball_score), q)
    return out


def show(name, results):
    print(f"  {name}:")
    for (uf, ui), ((mt, mp), q) in results.items():
        print(f"    flight={'on ' if uf else 'off'} identity={'on ' if ui else 'off'}: "
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
        show("V bounce + occlusion (U.10's swap scene)", run_scene(cmp9.scene_v, seed, 0.30))
        show("M long-arc blur gap", run_scene(cmp9.scene_m, seed, 0.40))
        show("M-short (no-regression)", run_scene(cmp9.scene_m_short, seed, 0.40))
        # Guardrail: scores overlap (ball 0.22-0.50, boots 0.20-0.40), so purity
        # cannot be scored by score there, and run_linear takes no identity flag
        # - the guardrail with identity on is covered by the test suite instead.
        # The off numbers below are the baseline it must not regress from.
        print("  Guardrail (linear ball, tests/test_ball.py scene, identity off):")
        for (uf, uh), q in cmp10.run_linear(seed).items():
            print(f"    flight={'on ' if uf else 'off'} handover={'on ' if uh else 'off'}: "
                  f"precision={q['precision']} right={q['right']} wrong={q['wrong']} unknown={q['unknown']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
