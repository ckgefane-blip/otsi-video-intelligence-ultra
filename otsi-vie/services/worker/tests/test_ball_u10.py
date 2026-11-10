"""Track U.10: bounce/rolling ball handover (vie_worker.ball + ball_flight).

After a bounce the ball's motion is new, so U.9's flight model cannot vouch
for the pieces that follow it - and a boot that out-scores the ball for the
whole shot and stays glued to it wins the path search on weight (scene V:
precision 0.279 with the flight on). U.10 hands the ball over cleanly: a roll
piece that starts where a flight landed carries the ball across the bounce
(a handover, not a restart), and a piece from a tracklet glued to one
player's feet for its whole life pays a penalty, so the boot cannot win on
detector score alone.

The tests use synthetic scenes only - no footage, no model - so they prove the
handover logic, not a real ball-tracking accuracy.
"""
from __future__ import annotations

import random

from vie_worker import ball
from vie_worker.ball import GLUE_PENALTY, HANDOVER_BONUS
from vie_worker.ball_flight import FLIGHT_BONUS, flight_of, is_flight, is_roll

STEP6 = 1_000_000 / 6
W, H = 1280, 720
ASPECT = W / H


def arc_points(n, x0=0.30, y0=0.70, vx=0.10, vy0=-0.38, ay=0.26, step_us=STEP6, seed=3, jitter=0.001):
    """Cand points on a parabola y(t) = y0 + vy0*t + ay/2*t^2 (y grows downward), x linear."""
    rnd = random.Random(seed)
    pts = []
    for k in range(n):
        t = k * step_us / 1_000_000
        pts.append(ball.Cand(int(round(k * step_us)),
                             x0 + vx * t + rnd.gauss(0, jitter),
                             y0 + vy0 * t + ay / 2 * t * t + rnd.gauss(0, jitter), 7.0, 0.4))
    return pts


def roll_points(n, x0=0.50, y0=0.70, vx=0.06, start_us=0, step_us=STEP6, seed=3, jitter=0.001, score=0.4):
    """Cand points rolling on the ground at constant velocity (y constant)."""
    rnd = random.Random(seed)
    return [ball.Cand(int(round(start_us + k * step_us)),
                      x0 + vx * (k * step_us / 1_000_000) + rnd.gauss(0, jitter),
                      y0 + rnd.gauss(0, jitter), 7.0, score) for k in range(n)]


def test_a_rolling_ball_is_a_roll_and_a_flight_is_not():
    roll = roll_points(12)
    assert is_roll(roll, ASPECT) and not is_flight(flight_of(roll, ASPECT))
    arc = arc_points(12)
    assert is_flight(flight_of(arc, ASPECT)) and not is_roll(arc, ASPECT)


def test_a_jittering_boot_is_roll_shaped():
    """A boot's points are a roll shape too (constant velocity on the ground) - the
    roll test alone cannot tell a boot from a rolling ball; only the glue test can."""
    rnd = random.Random(7)
    boot = [ball.Cand(int(round(k * STEP6)), 0.48 + rnd.uniform(-0.004, 0.004),
                      0.715 + rnd.uniform(-0.003, 0.003), 6.0, 0.45) for k in range(12)]
    assert is_roll(boot, ASPECT)


def _feet_cands(n, offsets, score=0.45, start_us=0):
    """Cands at a player's feet whose foot offsets are `offsets` (one per point)."""
    return [ball.Cand(int(round(start_us + k * STEP6)), 0.50 + 0.005 * k, 0.715, 6.0, score,
                      at_feet=True, feet_off=off) for k, off in enumerate(offsets)]


def test_foot_offset_spread_separates_a_boot_from_a_rolling_ball():
    boot = _feet_cands(18, [(0.0, -0.003)] * 18)                       # offset constant up to jitter: a boot
    assert ball.offset_spread(boot) is not None and ball.offset_spread(boot) < 0.001
    assert ball.is_glued(boot)
    rolling = _feet_cands(18, [(0.006 * k, -0.003) for k in range(18)])  # offset drifts away: a rolling ball
    assert ball.offset_spread(rolling) > 0.05
    assert not ball.is_glued(rolling)


def test_a_mixed_tracklet_is_not_glued():
    """A tracklet that only sometimes passes a player's feet is not glued to one -
    it spent part of its life as the ball in the air."""
    pts = arc_points(12) + _feet_cands(12, [(0.0, -0.003)] * 12, start_us=12 * STEP6)
    assert not ball.is_glued(pts)


def test_a_short_tracklet_is_not_glued():
    """Six points at a player's feet with a constant offset look glued, but six
    points are not enough to judge - unknown beats wrong."""
    assert not ball.is_glued(_feet_cands(6, [(0.0, -0.003)] * 6))


def test_a_dribbling_ball_is_not_glued():
    """A ball dribbled at a player's feet keeps coming back to the foot, but its
    offset oscillates as it is kicked ahead and caught up again - the spread is
    wide, so it is not glued. This is the guardrail for the glue test: a real
    dribble must not pay the boot penalty."""
    pts = _feet_cands(18, [(0.015 if k % 2 else -0.015, -0.003) for k in range(18)], score=0.35)
    assert ball.offset_spread(pts) > 0.02
    assert not ball.is_glued(pts)


def _landing_flight():
    """A flight that lands on the ground inside its own points: y(t) = 0.70 -
    0.55t + 0.30t^2, back at y=0.70 at t=1.83, x moving at 0.10 widths/s."""
    rnd = random.Random(3)
    pts = []
    for k in range(12):
        t = k / 6.0
        pts.append(ball.Cand(int(round(k * STEP6)), 0.30 + 0.10 * t + rnd.gauss(0, 0.001),
                             0.70 - 0.55 * t + 0.30 * t * t + rnd.gauss(0, 0.001), 7.0, 0.4))
    return pts


def test_a_roll_after_a_flight_is_a_handover_not_a_restart():
    """The flight lands at (0.48, 0.70); after a 4-frame occlusion the ball rolls
    away from the landing spot. Without the handover the join is a restart (the
    roll's first point is far off the parabola, which has continued below the
    ground); with it, the same join is linked - the ball's identity carries
    across the bounce."""
    flight_pts = _landing_flight()
    assert is_flight(flight_of(flight_pts, ASPECT))
    roll_pts = roll_points(12, x0=0.513, y0=0.70, vx=0.06, start_us=int(round(14 * STEP6)), score=0.30)
    assert is_roll(roll_pts, ASPECT)
    tracks = [ball.Tracklet(0, flight_pts), ball.Tracklet(0, roll_pts)]
    off = ball.best_paths(tracks, STEP6, ASPECT, use_flight=True)
    by_start = {t.start: linked for t, linked in off}
    assert by_start[roll_pts[0].pts_us] is False, off      # a restart: the bounce breaks the flight
    on = ball.best_paths(tracks, STEP6, ASPECT, use_flight=True, use_handover=True)
    by_start = {t.start: linked for t, linked in on}
    assert by_start[roll_pts[0].pts_us] is True, on        # a handover: the same ball, across the bounce


def test_a_glued_boot_loses_to_a_rolling_ball_in_the_path_search():
    """A boot (0.45-0.50, glued to one foot for the whole shot) against a rolling
    ball (0.30, separating from the player) at the same place and time: without
    the handover the boot wins the path on detector score; with it the ball does."""
    rnd = random.Random(5)
    boot = [ball.Cand(int(round(k * STEP6)), 0.50 + 0.005 * k + rnd.uniform(-0.004, 0.004),
                      0.715 + rnd.uniform(-0.003, 0.003), 6.0, rnd.uniform(0.45, 0.50),
                      at_feet=True, feet_off=(0.0, -0.003)) for k in range(18)]
    # the ball rolls beside the player (not inside his box, so its pieces survive
    # the all-at-feet score filter); the separating case is covered by the scene
    # test below, where the ball starts at the player's feet and leaves the box
    rolling = [ball.Cand(int(round(k * STEP6)), 0.50 + 0.006 * k + rnd.gauss(0, 0.001),
                         0.72 + rnd.gauss(0, 0.001), 7.0, 0.30) for k in range(18)]
    assert ball.is_glued(boot) and not ball.is_glued(rolling)
    tracks = [ball.Tracklet(0, boot), ball.Tracklet(0, rolling)]
    for use_handover, want_ball in ((False, False), (True, True)):
        chosen = ball.best_paths(tracks, STEP6, ASPECT, use_handover=use_handover)
        pts = [p for t, _ in chosen for p in t.points]
        n_boot = sum(1 for p in pts if abs(p.score - 0.30) > 0.05)
        n_ball = len(pts) - n_boot
        assert (n_ball > n_boot) == want_ball, (use_handover, n_ball, n_boot, chosen)


def _scene_v(ball_score=0.30, boot_lo=0.45, boot_hi=0.50, seed=3):
    """Bounce at a running player's feet, 4-frame occlusion, ball rolls away glued
    to the boot. See tools/eval/ball_u9_compare.py. The U.9 known limit: the flight
    improves it (0.023 -> 0.279) but cannot settle it."""
    rnd = random.Random(seed)
    frames, persons, truth, hidden = {}, {}, {}, set()
    for k in range(48):
        t = k / 6.0
        pts = int(round(k * STEP6))
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


def _scene_m(ball_score=0.40, boot_lo=0.45, boot_hi=0.50, seed=3):
    """A fast ball in a LONG high arc (4 s flight), blurred (low score) for 4
    frames near the apex, reappearing on the same arc; a boot at a slowly
    drifting player's feet scores higher. See tools/eval/ball_u9_compare.py."""
    rnd = random.Random(seed)
    frames, persons, truth, hidden = {}, {}, {}, set()
    for k in range(48):
        t = k / 6.0
        pts = int(round(k * STEP6))
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


def _marks(truth, hidden):
    return [{"pts_us": p, "visible": p not in hidden, "x": t[0], "y": t[1]} for p, t in truth.items()]


def _run(frames, persons, truth, hidden, **kw):
    shot_of = {p: 0 for p in frames}
    kept, _why = ball.plausible(frames, persons, shot_of, W, H, STEP6)
    return ball.evaluate(ball.follow_ball(kept, shot_of, STEP6, ASPECT, **kw), _marks(truth, hidden), STEP6, W, H)


def test_follow_ball_keeps_the_ball_after_a_bounce_and_occlusion():
    frames, persons, truth, hidden = _scene_v()
    flight_only = _run(frames, persons, truth, hidden, use_flight=True)
    assert flight_only["wrong"] >= 29, flight_only          # U.9's known limit: the boot still wins
    both = _run(frames, persons, truth, hidden, use_flight=True, use_handover=True)
    assert both["wrong"] <= 1 and both["right"] >= 42, both  # the handover settles it
    assert both["wrong"] < flight_only["wrong"] and both["right"] > flight_only["right"]


def test_handover_alone_also_settles_the_bounce_scene():
    """The glue penalty does the work even without the flight: a boot glued to one
    foot for the whole shot cannot win on score alone."""
    frames, persons, truth, hidden = _scene_v()
    off = _run(frames, persons, truth, hidden)
    assert off["wrong"] >= 40, off
    on = _run(frames, persons, truth, hidden, use_handover=True)
    assert on["wrong"] <= 13 and on["right"] >= 30, on


def test_handover_does_not_break_the_long_arc_scene():
    frames, persons, truth, hidden = _scene_m()
    flight_only = _run(frames, persons, truth, hidden, use_flight=True)
    assert flight_only["wrong"] <= 5, flight_only           # U.9's win stands
    both = _run(frames, persons, truth, hidden, use_flight=True, use_handover=True)
    assert both["wrong"] <= flight_only["wrong"] and both["right"] >= flight_only["right"], (flight_only, both)


def test_handover_is_off_by_default():
    frames, persons, truth, hidden = _scene_v()
    shot_of = {p: 0 for p in frames}
    kept, _why = ball.plausible(frames, persons, shot_of, W, H, STEP6)
    default = ball.follow_ball(kept, shot_of, STEP6, ASPECT)
    explicit_off = ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=False, use_handover=False)
    assert [(p.pts_us, p.state, round(p.x, 6), round(p.y, 6)) for p in default] == \
           [(p.pts_us, p.state, round(p.x, 6), round(p.y, 6)) for p in explicit_off]


def test_handover_constants_are_the_documented_tuning_values():
    assert FLIGHT_BONUS == 1.5 and HANDOVER_BONUS == 0.5 and GLUE_PENALTY == 1.2
