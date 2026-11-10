"""Track U.11: tracklet-level identity rule at crossings (vie_worker.ball).

The open problem from U.10 (ADR-127): in scene V the two tracklets swap
identities once at the crossing - the boot-born tracklet takes the ball for
the rest of the shot and the ball-born tracklet takes the boot - and only the
path search sorts it out afterwards. U.11 decides the identity at the
association level: after the greedy pairing of a frame, the pairing is
re-done by each tracklet's own identity (its motion model - flight parabola
or straight line - plus its score pattern) when the re-pairing clearly wins,
and the greedy pairing stands when it does not.

The tests use synthetic scenes only - no footage, no model - so they prove
the identity logic, not a real ball-tracking accuracy.
"""
from __future__ import annotations

import random

from vie_worker import ball
from vie_worker.ball import IDENTITY_MARGIN, IDENTITY_SCORE_CAP, IDENTITY_SCORE_WIDTH

STEP6 = 1_000_000 / 6
W, H = 1280, 720
ASPECT = W / H


def _scene_v(ball_score=0.30, boot_lo=0.45, boot_hi=0.50, seed=3):
    """Bounce at a running player's feet, 4-frame occlusion, ball rolls away
    glued to the boot. See tools/eval/ball_u9_compare.py. The U.10 known
    limit: the two tracklets swap identities once at the crossing."""
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


def _kept(build, seed):
    frames, persons, truth, hidden = build(seed=seed)
    shot_of = {p: 0 for p in frames}
    kept, _why = ball.plausible(frames, persons, shot_of, W, H, STEP6)
    return kept, shot_of, truth, hidden


def _purity(tracks, ball_score):
    """(mixed tracklets, mixed points), as in tools/eval/ball_u11_compare.py."""
    mid = (ball_score + 0.475) / 2
    mixed_tracks, mixed_points = 0, 0
    for t in tracks:
        lo = sum(1 for p in t.points if p.score < mid)
        hi = len(t.points) - lo
        if lo and hi:
            mixed_tracks += 1
            mixed_points += min(lo, hi)
    return mixed_tracks, mixed_points


def test_identity_rule_keeps_identities_through_the_bounce_crossing():
    """Scene V, seed 3, flight on: without the rule the boot-born tracklet
    takes the ball for the rest of the shot and the ball-born tracklet takes
    the boot (2 mixed tracklets, 19 mixed points); with it, no tracklet
    mixes at all - the identities survive the crossing at the association
    level, and the path search no longer has to sort it out."""
    kept, shot_of, _truth, _hidden = _kept(_scene_v, 3)
    off = ball.tracklets(kept, shot_of, STEP6, ASPECT, use_flight=True)
    assert _purity(off, 0.30) == (2, 19), _purity(off, 0.30)
    on = ball.tracklets(kept, shot_of, STEP6, ASPECT, use_flight=True, use_identity=True)
    assert _purity(on, 0.30) == (0, 0), _purity(on, 0.30)


def test_identity_rule_settles_the_crossing_without_the_flight():
    """The rule does not depend on U.9: with the flight off, the swap still
    happens (3 mixed tracklets, 19 mixed points on seed 3), and the rule
    still settles it to a single mixed point - and the final answer goes
    from precision 0.698 to 0.952 on the handover alone."""
    kept, shot_of, truth, hidden = _kept(_scene_v, 3)
    off = ball.tracklets(kept, shot_of, STEP6, ASPECT)
    assert _purity(off, 0.30) == (3, 19), _purity(off, 0.30)
    on = ball.tracklets(kept, shot_of, STEP6, ASPECT, use_identity=True)
    assert _purity(on, 0.30) == (1, 1), _purity(on, 0.30)
    q = ball.evaluate(ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_handover=True, use_identity=True),
                      _marks(truth, hidden), STEP6, W, H)
    assert q["precision"] >= 0.95 and q["wrong"] <= 2, q


def test_identity_rule_fires_when_motion_models_disagree():
    """Two tracklets and two candidates at a crossing, handed to
    `_resolve_identities` as the crossed greedy pairing: the ball tracklet
    (scores 0.30, moving at y=0.70) has been given the boot candidate and
    the boot tracklet (scores 0.48, y=0.715) the ball candidate. Each
    tracklet's own motion model plus its score pattern prefers the straight
    pairing by more than IDENTITY_MARGIN, so the rule re-pairs them."""
    pts = 6 * STEP6
    a_hist = [ball.Cand(int(round(k * STEP6)), 0.55 + 0.01 * k, 0.70, 7.0, 0.30) for k in range(6)]
    b_hist = [ball.Cand(int(round(k * STEP6)), 0.55 + 0.01 * k, 0.715, 6.0, 0.48) for k in range(6)]
    live = [ball.Tracklet(0, a_hist), ball.Tracklet(0, b_hist)]
    cands = [ball.Cand(int(round(pts)), 0.609, 0.7095, 7.0, 0.30),   # the ball, on A's line
             ball.Cand(int(round(pts)), 0.611, 0.7055, 6.0, 0.48)]  # the boot, on B's line
    crossed = [(0, 1), (1, 0)]
    assert ball._resolve_identities(crossed, live, cands, int(round(pts)), ASPECT, STEP6) == [(0, 0), (1, 1)]


def test_identity_rule_declines_when_the_evidence_is_ambiguous():
    """The same crossing, but the two objects are indistinguishable: identical
    scores (0.40) and both candidates equidistant from both predictions, so
    the two pairings cost exactly the same. The rule declines - the crossed
    pairing stands, unknown beats wrong, and the path search still has its
    say."""
    pts = 6 * STEP6
    a_hist = [ball.Cand(int(round(k * STEP6)), 0.55 + 0.01 * k, 0.70, 7.0, 0.40) for k in range(6)]
    b_hist = [ball.Cand(int(round(k * STEP6)), 0.55 + 0.01 * k, 0.715, 6.0, 0.40) for k in range(6)]
    live = [ball.Tracklet(0, a_hist), ball.Tracklet(0, b_hist)]
    cands = [ball.Cand(int(round(pts)), 0.609, 0.7075, 7.0, 0.40),
             ball.Cand(int(round(pts)), 0.611, 0.7075, 6.0, 0.40)]
    crossed = [(0, 1), (1, 0)]
    assert ball._resolve_identities(crossed, live, cands, int(round(pts)), ASPECT, STEP6) == crossed


def test_a_single_point_tracklet_has_no_motion_evidence():
    """A tracklet with one point has no velocity to extrapolate, so its
    motion term is 0 whatever the candidate - only its score pattern speaks.
    (Scene V, seed 1: the ball's tracklet is born at k=17, its k=18
    candidate is dropped as a duplicate of the boot beside it, and at k=19
    the ball is 0.022 from that single point while the boot tracklet's
    prediction sits 0.006 from it. Charging the raw distance would acquit
    the swap.)"""
    t = ball.Tracklet(0, [ball.Cand(0, 0.589, 0.719, 7.0, 0.30)])
    near = ball.Cand(int(round(2 * STEP6)), 0.598, 0.714, 6.0, 0.48)
    far = ball.Cand(int(round(2 * STEP6)), 0.611, 0.720, 7.0, 0.30)
    assert ball.identity_cost(t, near, ASPECT) > ball.identity_cost(t, far, ASPECT)
    assert ball.identity_cost(t, far, ASPECT) == 0.0


def test_identity_rule_does_not_break_the_long_arc_scene():
    """Scene M, seed 3: the U.9 win stands with the rule on - the final
    answer is identical with the rule off and on (precision 1.0, 44 right,
    0 wrong), and no tracklet mixes in either case."""
    kept, shot_of, truth, hidden = _kept(_scene_m, 3)
    for ui in (False, True):
        assert _purity(ball.tracklets(kept, shot_of, STEP6, ASPECT, use_flight=True, use_identity=ui), 0.40) == (0, 0)
        q = ball.evaluate(ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=True,
                                           use_handover=True, use_identity=ui),
                          _marks(truth, hidden), STEP6, W, H)
        assert (q["precision"], q["right"], q["wrong"]) == (1.0, 44, 0), q


def test_identity_rule_is_off_by_default():
    kept, shot_of, truth, hidden = _kept(_scene_v, 3)
    default = ball.follow_ball(kept, shot_of, STEP6, ASPECT)
    explicit_off = ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=False, use_handover=False,
                                    use_identity=False)
    assert [(p.pts_us, p.state, round(p.x, 6), round(p.y, 6)) for p in default] == \
           [(p.pts_us, p.state, round(p.x, 6), round(p.y, 6)) for p in explicit_off]


def test_identity_constants_are_the_documented_tuning_values():
    assert IDENTITY_MARGIN == 0.002 and IDENTITY_SCORE_WIDTH == 0.02 and IDENTITY_SCORE_CAP == 0.005
