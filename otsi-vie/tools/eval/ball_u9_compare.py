"""Track U.9: ball-flight separation, flight off vs on, on synthetic scenes.

Scene M (mid-flight blur gap): a fast ball in a LONG high arc (4 s flight)
is undetected for 4 frames near the apex (motion blur) and reappears still
on the same arc for 9+ frames before it lands, while a boot at a slowly
drifting player's feet scores higher than the blurred ball. Without the
flight the path takes the boot across the gap and the early spans; with it,
the arc is followed again after the gap.

Scene M-short: the same shape with a short arc - the ball bounces 0.4 s
after it reappears, so its post-gap piece straddles the bounce and is not
one flight. Reported as a no-regression check, not a win.

Scene V (bounce + occlusion, the hard case): the ball lands at a running
player's feet, is hidden behind him for 4 frames, then rolls away just ahead
of him while his boot out-scores the ball for the whole shot. The flight
improves it but cannot settle it on its own - the bounce starts a new
motion, and the boot is glued to the ball afterwards - so this scene is
reported as the known limit, not as a win: a follow-up has to weigh flight
evidence against the path-search scores there.

Guardrail: the linear-ball scene from tests/test_ball.py (no gravity): the
flight must not fire there, so flight on must give the same answer as off.

All scenes are synthetic (no footage, no model): they measure the flight
logic, not a real ball-tracking accuracy. A real number needs labelled
Sukhum ball-flight segments.

Usage: python3 otsi-vie/tools/eval/ball_u9_compare.py [--seed N]
"""
from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "worker"))

from vie_worker import ball

STEP = 1_000_000 / 6
W, H = 1280, 720
ASPECT = W / H


def scene_m(ball_score=0.40, boot_lo=0.45, boot_hi=0.50, seed=3):
    """Long high arc, 4-frame blur gap near the apex, ball back on the same arc."""
    rnd = random.Random(seed)
    frames, persons, truth, hidden = {}, {}, {}, set()
    for k in range(48):
        t = k / 6.0
        pts = int(round(k * STEP))
        if t < 4.0:
            bx, by = 0.15 + 0.08 * t, 0.70 - 0.50 * t + 0.125 * t * t
        elif t < 5.6:
            u = t - 4.0
            bx, by = 0.15 + 0.08 * t, 0.70 - 0.20 * u + 0.125 * u * u
        else:
            bx, by = 0.15 + 0.08 * t, 0.70
        truth[pts] = (bx, by)
        xp = 0.42 + 0.01 * t
        is_hidden = 1.83 <= t < 2.50
        if is_hidden:
            hidden.add(pts)
        cands = []
        if not is_hidden:
            cands.append(ball.Cand(pts, bx + rnd.gauss(0, 0.001), by + rnd.gauss(0, 0.001), 7.0, ball_score))
        cands.append(ball.Cand(pts, xp + rnd.uniform(-0.004, 0.004),
                               0.715 + rnd.uniform(-0.003, 0.003), 6.0, rnd.uniform(boot_lo, boot_hi)))
        frames[pts] = cands
        persons[pts] = [(xp - 0.01, 0.63, 0.02, 0.09)]
    return frames, persons, truth, hidden


def scene_m_short(ball_score=0.40, boot_lo=0.45, boot_hi=0.50, seed=3):
    """Short arc: the ball bounces 0.4 s after it reappears from the blur gap."""
    rnd = random.Random(seed)
    frames, persons, truth, hidden = {}, {}, {}, set()
    for k in range(42):
        t = k / 6.0
        pts = int(round(k * STEP))
        if t < 2.92:
            bx, by = 0.20 + 0.10 * t, 0.70 - 0.38 * t + 0.13 * t * t
        elif t < 4.46:
            u = t - 2.92
            bx, by = 0.20 + 0.10 * t, 0.70 - 0.20 * u + 0.13 * u * u
        else:
            bx, by = 0.20 + 0.10 * t, 0.70
        truth[pts] = (bx, by)
        xp = 0.40 + 0.01 * t
        is_hidden = 1.83 <= t < 2.50
        if is_hidden:
            hidden.add(pts)
        cands = []
        if not is_hidden:
            cands.append(ball.Cand(pts, bx + rnd.gauss(0, 0.001), by + rnd.gauss(0, 0.001), 7.0, ball_score))
        cands.append(ball.Cand(pts, xp + rnd.uniform(-0.004, 0.004),
                               0.715 + rnd.uniform(-0.003, 0.003), 6.0, rnd.uniform(boot_lo, boot_hi)))
        frames[pts] = cands
        persons[pts] = [(xp - 0.01, 0.63, 0.02, 0.09)]
    return frames, persons, truth, hidden


def scene_v(ball_score=0.30, boot_lo=0.45, boot_hi=0.50, seed=3):
    """Bounce at a running player's feet, 4-frame occlusion, ball rolls away glued to the boot."""
    rnd = random.Random(seed)
    frames, persons, truth, hidden = {}, {}, {}, set()
    for k in range(48):
        t = k / 6.0
        pts = int(round(k * STEP))
        xp = 0.44 + 0.05 * t
        is_hidden = 2.0 <= t < 2.67
        if t < 2.0:
            bx, by = 0.30 + 0.12 * t, 0.72 - 0.30 * t + 0.15 * t * t
        else:
            bx, by = 0.54 + 0.06 * (t - 2.0), 0.72
        truth[pts] = (bx, by)
        if is_hidden:
            hidden.add(pts)
        cands = []
        if not is_hidden:
            cands.append(ball.Cand(pts, bx + rnd.gauss(0, 0.001), by + rnd.gauss(0, 0.001), 7.0, ball_score))
        cands.append(ball.Cand(pts, xp + rnd.uniform(-0.004, 0.004),
                               0.715 + rnd.uniform(-0.003, 0.003), 6.0, rnd.uniform(boot_lo, boot_hi)))
        frames[pts] = cands
        persons[pts] = [(xp - 0.01, 0.63, 0.02, 0.09)]
    return frames, persons, truth, hidden


def run_scene(build, seed):
    frames, persons, truth, hidden = build(seed=seed)
    shot_of = {p: 0 for p in frames}
    kept, _why = ball.plausible(frames, persons, shot_of, W, H, STEP)
    marks = [{"pts_us": p, "visible": p not in hidden, "x": t[0], "y": t[1]} for p, t in truth.items()]
    out = {}
    for use_flight in (False, True):
        out[use_flight] = ball.evaluate(ball.follow_ball(kept, shot_of, STEP, ASPECT, use_flight=use_flight),
                                        marks, STEP, W, H)
    return out


def guardrail_linear_scene(seed=3):
    """tests/test_ball.py's scene, inlined (that file imports pyarrow, which is
    not installed here): the ball moves linearly (no gravity) among boots, a
    logo dot, a crest and stands. The flight must not fire, so on must equal off."""
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
    out = {}
    for use_flight in (False, True):
        out[use_flight] = ball.evaluate(ball.follow_ball(kept, shot_of, STEP, ASPECT, use_flight=use_flight),
                                        marks, STEP, W, H)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=3)
    args = ap.parse_args()
    for name, build in (("M long-arc blur gap", scene_m), ("M-short (no-regression)", scene_m_short),
                        ("V bounce + occlusion (known limit)", scene_v)):
        r = run_scene(build, args.seed)
        print(f"{name}:")
        for use_flight in (False, True):
            q = r[use_flight]
            print(f"  flight={'on ' if use_flight else 'off'}: precision={q['precision']} recall={q['recall']} "
                  f"right={q['right']} wrong={q['wrong']} unknown={q['unknown']} invented={q['invented']}")
    g = guardrail_linear_scene(args.seed)
    print("Guardrail (linear ball, tests/test_ball.py scene):")
    for use_flight in (False, True):
        q = g[use_flight]
        print(f"  flight={'on ' if use_flight else 'off'}: precision={q['precision']} recall={q['recall']} "
              f"right={q['right']} wrong={q['wrong']} unknown={q['unknown']} invented={q['invented']}")
    print("M sensitivity (ball score / boot score -> wrong off -> wrong on):")
    for bs, (lo, hi) in ((0.35, (0.45, 0.50)), (0.40, (0.40, 0.45)), (0.45, (0.45, 0.50))):
        frames, persons, truth, hidden = scene_m(ball_score=bs, boot_lo=lo, boot_hi=hi, seed=args.seed)
        shot_of = {p: 0 for p in frames}
        kept, _why = ball.plausible(frames, persons, shot_of, W, H, STEP)
        marks = [{"pts_us": p, "visible": p not in hidden, "x": t[0], "y": t[1]} for p, t in truth.items()]
        w = {u: ball.evaluate(ball.follow_ball(kept, shot_of, STEP, ASPECT, use_flight=u), marks, STEP, W, H)["wrong"]
             for u in (False, True)}
        print(f"  ball={bs} boot={lo}-{hi}: wrong {w[False]} -> {w[True]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
