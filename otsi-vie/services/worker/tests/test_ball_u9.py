"""Track U.9: 3D parabolic ball-flight separation (vie_worker.ball_flight + ball.py).

A ball in flight follows a parabola under gravity; a boot, a rolling ball and
a running player do not. The tests use synthetic arcs only - no footage, no
model - so they prove the flight logic, not a real ball-tracking accuracy.
"""
from __future__ import annotations

import math
import random

from vie_worker import ball
from vie_worker.ball_flight import FLIGHT_BONUS, deviation, fit_flight, flight_of, is_flight

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


def test_fit_recovers_a_synthetic_parabola_and_predicts_it():
    pts = arc_points(12)
    f = fit_flight(pts, ASPECT)
    assert f is not None and is_flight(f)
    assert f.accel_y > 0.1                                  # downward, gravity's direction in the picture
    assert f.rms < 0.004
    # half a second past the last point, the arc is still predicted within a few pixels
    # (a quadratic fit on jittered points cannot be trusted a full second past its span:
    # the t^2 term multiplies the small coefficient errors - that is a limit of the
    # extrapolation, not of the fit, whose own residual is under a pixel)
    px, py = f.predict(pts[-1].pts_us + 500_000)
    t = 11 / 6.0 + 0.5                                     # the last point is k=11, half a second past it
    assert abs(px - (0.30 + 0.10 * t)) < 0.005 and abs(py - (0.70 - 0.38 * t + 0.13 * t * t)) < 0.005


def test_a_rolling_ball_is_not_a_flight():
    pts = [ball.Cand(int(round(k * STEP6)), 0.30 + 0.02 * k, 0.72, 7.0, 0.4) for k in range(12)]
    assert flight_of(pts, ASPECT) is None                  # constant velocity: no downward acceleration


def test_a_jittering_boot_is_not_a_flight():
    rnd = random.Random(7)
    pts = [ball.Cand(int(round(k * STEP6)), 0.48 + rnd.uniform(-0.004, 0.004),
                     0.715 + rnd.uniform(-0.003, 0.003), 6.0, 0.45) for k in range(12)]
    assert flight_of(pts, ASPECT) is None                  # no arc fits the jitter


def test_too_few_points_is_not_a_flight():
    assert fit_flight(arc_points(3), ASPECT) is None


def test_parabolic_prediction_beats_linear_on_a_fast_arc_at_2fps():
    """At 2 fps (the default analysis rate) a fast arc has drifted far from its
    tangent after one step. A boot sitting on the tangent would win the
    association from a linear prediction; the parabola predicts the ball."""
    step = 500_000
    # y(t) = 0.65 - 0.15t + 0.15t^2, x(t) = 0.30 + 0.10t, t in seconds
    pts = [ball.Cand(k * step, 0.30 + 0.10 * (k * step / 1e6), 0.65 - 0.15 * (k * step / 1e6) + 0.15 * (k * step / 1e6) ** 2, 7.0, 0.4)
           for k in range(4)]
    t = ball.Tracklet(0, pts)
    t.flight = flight_of(pts, ASPECT)
    assert t.flight is not None
    nxt = 4 * step
    px, py = t.predict(nxt, ASPECT)
    assert abs(px - 0.50) < 0.005 and abs(py - 0.95) < 0.005
    # the linear prediction from the last two points, for comparison
    a, b = pts[-1], pts[-2]
    lx = a.x + (a.x - b.x) * (nxt - a.pts_us) / (a.pts_us - b.pts_us)
    ly = a.y + (a.y - b.y) * (nxt - a.pts_us) / (a.pts_us - b.pts_us)
    assert math.hypot(lx - 0.50, (ly - 0.95) / ASPECT) > 0.03      # the tangent is 0.042 widths from the ball
    # now the association: at the next frame the boot sits on the tangent, the ball on the arc
    frames = {p.pts_us: [p] for p in pts}
    frames[nxt] = [ball.Cand(nxt, 0.50, 0.95, 7.0, 0.4), ball.Cand(nxt, lx, ly, 6.0, 0.45)]
    tls = ball.tracklets(frames, {p: 0 for p in frames}, step, ASPECT, use_flight=True)
    grown = [t for t in tls if len(t.points) == 5]
    assert len(grown) == 1 and abs(grown[0].points[-1].y - 0.95) < 0.005   # the tracklet took the ball, not the boot
    # (the boot candidate starts its own 1-point tracklet either way: every candidate belongs to exactly one tracklet)
    tls_off = ball.tracklets(frames, {p: 0 for p in frames}, step, ASPECT, use_flight=False)
    grown_off = [t for t in tls_off if len(t.points) == 5]
    assert len(grown_off) == 1 and abs(grown_off[0].points[-1].y - ly) < 0.005  # without the flight it takes the boot


def _scene_m(ball_score=0.40, boot_lo=0.45, boot_hi=0.50, seed=3):
    """A fast ball in a LONG high arc (4 s flight), blurred (low score) for 4
    frames near the apex, reappearing on the same arc for 9+ frames before it
    lands; a boot at a slowly drifting player's feet scores higher. See
    tools/eval/ball_u9_compare.py. The long arc matters: the post-gap piece
    is one whole flight, so it earns the flight bonus (a piece straddling a
    bounce does not - see _scene_m_short)."""
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


def _scene_m_short(ball_score=0.40, boot_lo=0.45, boot_hi=0.50, seed=3):
    """The same shape with a SHORT arc: the ball bounces 0.4 s after it
    reappears, so its post-gap piece straddles the bounce and is not one
    flight. The flight must not make this scene worse (it does not fix it
    either - the bounce is a new motion, and the boot is glued to the ball
    afterwards: a known limit, see ADR-126)."""
    rnd = random.Random(seed)
    frames, persons, truth, hidden = {}, {}, {}, set()
    for k in range(42):
        t = k / 6.0
        pts = int(round(k * STEP6))
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


def _marks(truth, hidden):
    return [{"pts_us": p, "visible": p not in hidden, "x": t[0], "y": t[1]} for p, t in truth.items()]


def test_follow_ball_keeps_the_ball_across_a_mid_flight_gap():
    frames, persons, truth, hidden = _scene_m()
    shot_of = {p: 0 for p in frames}
    kept, _why = ball.plausible(frames, persons, shot_of, W, H, STEP6)
    marks = _marks(truth, hidden)
    off = ball.evaluate(ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=False), marks, STEP6, W, H)
    on = ball.evaluate(ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=True), marks, STEP6, W, H)
    assert off["wrong"] >= 15, off                   # without the flight the boot wins the early spans outright
    assert on["wrong"] <= 6, on                      # with it the arc is followed again after the gap (right 25 -> 39)
    assert on["wrong"] < off["wrong"] and on["right"] > off["right"]
    assert on["invented"] <= 2, on                   # the hidden frames stay unknown instead of taking the boot


def test_flight_does_not_make_the_short_arc_scene_worse():
    frames, persons, truth, hidden = _scene_m_short()
    shot_of = {p: 0 for p in frames}
    kept, _why = ball.plausible(frames, persons, shot_of, W, H, STEP6)
    marks = _marks(truth, hidden)
    off = ball.evaluate(ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=False), marks, STEP6, W, H)
    on = ball.evaluate(ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=True), marks, STEP6, W, H)
    assert on["wrong"] <= off["wrong"] and on["right"] >= off["right"], (off, on)


def test_flight_is_off_by_default():
    frames, persons, truth, hidden = _scene_m()
    shot_of = {p: 0 for p in frames}
    kept, _why = ball.plausible(frames, persons, shot_of, W, H, STEP6)
    default = ball.follow_ball(kept, shot_of, STEP6, ASPECT)
    explicit_off = ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=False)
    assert [(p.pts_us, p.state, round(p.x, 6), round(p.y, 6)) for p in default] == \
           [(p.pts_us, p.state, round(p.x, 6), round(p.y, 6)) for p in explicit_off]


def test_a_bounce_is_a_restart_not_a_link():
    """The ball's flight ends in a bounce at a player's feet; the boot piece
    that starts there is not the same flight, so the join is a restart (no
    INFERRED positions invented across it). Without the flight the same join
    counts as linked."""
    flight_pts = arc_points(12)                                   # the arc, landing at (0.50, 0.70) at t=2.0
    boot_pts = [ball.Cand(int(round((12 + k) * STEP6)), 0.50 + 0.001 * k, 0.715, 6.0, 0.45) for k in range(12)]
    tracks = [ball.Tracklet(0, flight_pts), ball.Tracklet(0, boot_pts)]
    for use_flight, want_linked in ((False, True), (True, False)):
        chosen = ball.best_paths(tracks, STEP6, ASPECT, use_flight=use_flight)
        by_start = {t.start: linked for t, linked in chosen}
        assert by_start[boot_pts[0].pts_us] == want_linked, (use_flight, chosen)
    # and the flight piece itself earns the bonus: its weight in the search exceeds its plain weight
    assert FLIGHT_BONUS == 1.5
    assert flight_of(flight_pts, ASPECT) is not None
    assert deviation(flight_of(flight_pts, ASPECT), boot_pts[0].pts_us, boot_pts[0].x, boot_pts[0].y, ASPECT) > 0.012
