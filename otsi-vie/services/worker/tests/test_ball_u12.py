"""Track U.12: identity veto at crossings (vie_worker.ball).

The open problem from U.11 (ADR-128): one mixed point remains on seeds 1,
2, 4 and 5 - a lone-candidate steal, a different mechanism from the swap.
At k=12 the ball is hidden and only the boot exists, so the ball's tracklet
takes the boot; at k=18 the ball's candidate is dropped as a duplicate of the
boot beside it, so again only the boot exists and the ball-born tracklet takes
it. There is no second assignment to re-pair, so U.11 cannot help. U.12
refuses the assignment when another live tracklet that got no candidate fits
it clearly better by identity cost, and hands it to that tracklet instead -
and declines whenever the evidence is not clear, unknown beats wrong.

The tests use synthetic scenes only - no footage, no model - so they prove
the veto logic, not a real ball-tracking accuracy.
"""
from __future__ import annotations

import random

from vie_worker import ball
from vie_worker.ball import TRACK_SLACK, VETO_MARGIN

from test_ball_u11 import _kept, _marks, _purity, _scene_m, _scene_v

STEP6 = 1_000_000 / 6
W, H = 1280, 720
ASPECT = W / H


def _guardrail(seed=3):
    """tests/test_ball.py's linear-ball scene, inlined (that file imports
    pyarrow, which is not installed here): the ball moves linearly (no
    gravity) among wandering players whose boots score 0.2-0.4, overlapping
    the ball's 0.22-0.5, plus a logo dot, a crest and stands. The busiest
    scene the veto runs on: a veto that listens to newborn tracklets, or to
    a challenger whose prediction is far from the candidate, misfires here."""
    rnd = random.Random(seed)
    frames, persons, truth = {}, {}, {}
    bx, by, vx, vy = 0.2, 0.5, 0.12, 0.02
    players = [[rnd.uniform(0.1, 0.9), rnd.uniform(0.3, 0.8)] for _ in range(6)]
    for k in range(int(30 * 6)):
        pts = int(round(k * STEP6))
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


def _scene_m_short(ball_score=0.40, boot_lo=0.45, boot_hi=0.50, seed=3):
    """Short arc, as in tools/eval/ball_u9_compare.py: the ball bounces 0.4 s
    after it reappears from the blur gap."""
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


def _guardrail_kept(seed):
    frames, persons, truth = _guardrail(seed)
    shot_of = {p: int(p // (10 * 1_000_000)) for p in frames}
    kept, _why = ball.plausible(frames, persons, shot_of, W, H, STEP6)
    marks = [{"pts_us": p, "visible": t is not None, "x": t[0] if t else None, "y": t[1] if t else None}
             for p, t in truth.items()]
    return kept, shot_of, marks


def test_veto_removes_the_lone_candidate_steal():
    """Scene V, flight on, identity on: without the veto the ball's tracklet
    takes the boot at k=12 while the ball is hidden (1 mixed tracklet, 1
    mixed point on seeds 1 and 4); with it, the boot's tracklet takes its own
    candidate and no tracklet mixes at all. The final answer is unchanged
    (precision 0.977 on seed 1, 1.0 on seed 4) - the win is at the tracklet
    level, and the path search no longer has to sort it out."""
    for seed in (1, 4):
        kept, shot_of, truth, hidden = _kept(_scene_v, seed)
        off = ball.tracklets(kept, shot_of, STEP6, ASPECT, use_flight=True, use_identity=True)
        assert _purity(off, 0.30) == (1, 1), (seed, _purity(off, 0.30))
        on = ball.tracklets(kept, shot_of, STEP6, ASPECT, use_flight=True, use_identity=True, use_veto=True)
        assert _purity(on, 0.30) == (0, 0), (seed, _purity(on, 0.30))
        q_off = ball.evaluate(ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=True,
                                               use_handover=True, use_identity=True),
                              _marks(truth, hidden), STEP6, W, H)
        q_on = ball.evaluate(ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=True,
                                              use_handover=True, use_identity=True, use_veto=True),
                             _marks(truth, hidden), STEP6, W, H)
        assert (q_on["precision"], q_on["right"], q_on["wrong"]) == \
               (q_off["precision"], q_off["right"], q_off["wrong"]), (seed, q_off, q_on)


def test_veto_also_settles_the_steal_without_the_flight():
    """The veto does not depend on U.9: with the flight off, the k=12 steal
    still happens on seeds 1, 3 and 4, and the veto still settles it to no
    mixed tracklet at all. On seed 3 the final answer even improves - the
    purer tracklets cut the pieces better (precision 0.952, 40 right, 2
    wrong, to 0.976, 41 right, 1 wrong)."""
    for seed in (1, 3, 4):
        kept, shot_of, truth, hidden = _kept(_scene_v, seed)
        off = ball.tracklets(kept, shot_of, STEP6, ASPECT, use_identity=True)
        assert _purity(off, 0.30) == (1, 1), (seed, _purity(off, 0.30))
        on = ball.tracklets(kept, shot_of, STEP6, ASPECT, use_identity=True, use_veto=True)
        assert _purity(on, 0.30) == (0, 0), (seed, _purity(on, 0.30))
    kept, shot_of, truth, hidden = _kept(_scene_v, 3)
    q = ball.evaluate(ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_handover=True,
                                       use_identity=True, use_veto=True),
                      _marks(truth, hidden), STEP6, W, H)
    assert (q["precision"], q["right"], q["wrong"]) == (0.976, 41, 1), q


def test_veto_cannot_settle_the_steal_when_the_thief_fits_better():
    """The honest limit, measured not asserted: on seeds 2 and 5 the stealing
    tracklet genuinely fits the candidate better by identity cost, so no
    veto by that cost can fire. Seed 2, k=18: the ball-born tracklet has one
    point, so its motion term is 0 by the U.11 rule and its cost is just its
    score term, 0.0039, against the boot tracklet's 0.0076 (its two-point
    extrapolation carries the boot's detection jitter). Seed 5, k=12: the
    ball tracklet's flight parabola lands on the bounce point, where the boot
    stands, so its cost is 0.0072 against the boot tracklet's 0.0123. The
    mixed point stays (1, 1) on both seeds, and the final answer is
    unchanged - the veto declines rather than guesses. The score pattern
    would separate both cases (the candidate scores like a boot, not like
    the ball), but it is capped as a tiebreaker by U.11's design; using it
    as the verdict is a follow-up, not claimed here."""
    for seed in (2, 5):
        kept, shot_of, truth, hidden = _kept(_scene_v, seed)
        on = ball.tracklets(kept, shot_of, STEP6, ASPECT, use_flight=True, use_identity=True, use_veto=True)
        assert _purity(on, 0.30) == (1, 1), (seed, _purity(on, 0.30))
        q_off = ball.evaluate(ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=True,
                                               use_handover=True, use_identity=True),
                              _marks(truth, hidden), STEP6, W, H)
        q_on = ball.evaluate(ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=True,
                                              use_handover=True, use_identity=True, use_veto=True),
                             _marks(truth, hidden), STEP6, W, H)
        assert (q_on["precision"], q_on["right"], q_on["wrong"]) == \
               (q_off["precision"], q_off["right"], q_off["wrong"]), (seed, q_off, q_on)


def test_veto_hands_a_lone_candidate_to_the_tracklet_that_fits_it_clearly_better():
    """Two live tracklets and one candidate, handed to `_veto_assignment` as
    the greedy pairing that gave the boot candidate to the ball's tracklet:
    the ball tracklet (scores 0.30, its straight-line prediction 0.0217 from
    the candidate) against the boot tracklet (scores 0.48, its prediction on
    the candidate). The boot tracklet fits better by 0.0253, far over
    VETO_MARGIN, and its prediction is on the candidate, so the veto hands
    the candidate to it."""
    pts = 12 * STEP6
    a_hist = [ball.Cand(int(round(k * STEP6)), 0.42 + 0.01 * k, 0.70, 7.0, 0.30) for k in range(12)]
    b_hist = [ball.Cand(int(round(k * STEP6)), 0.42 + k / 120, 0.715, 6.0, 0.48) for k in range(12)]
    live = [ball.Tracklet(0, a_hist), ball.Tracklet(0, b_hist)]
    cands = [ball.Cand(int(round(pts)), 0.52, 0.715, 6.0, 0.48)]
    assert ball._veto_assignment([(0, 0)], live, cands, int(round(pts)), ASPECT, STEP6) == [(1, 0)]


def test_veto_declines_when_the_evidence_is_ambiguous():
    """The same lone candidate, but the two tracklets are indistinguishable:
    identical scores (0.40) and the candidate equidistant from both
    predictions, so the two identity costs are exactly equal. The veto
    declines - the greedy assignment stands, unknown beats wrong."""
    pts = 6 * STEP6
    a_hist = [ball.Cand(int(round(k * STEP6)), 0.55 + 0.01 * k, 0.70, 7.0, 0.40) for k in range(6)]
    b_hist = [ball.Cand(int(round(k * STEP6)), 0.55 + 0.01 * k, 0.715, 6.0, 0.40) for k in range(6)]
    live = [ball.Tracklet(0, a_hist), ball.Tracklet(0, b_hist)]
    cands = [ball.Cand(int(round(pts)), 0.609, 0.7075, 7.0, 0.40)]
    assert ball._veto_assignment([(0, 0)], live, cands, int(round(pts)), ASPECT, STEP6) == [(0, 0)]


def test_veto_does_not_listen_to_a_one_point_challenger():
    """A one-point tracklet has no velocity to extrapolate, so its motion
    term is 0 by the U.11 rule - it would win every veto by default, not by
    evidence. Here the challenger is a single point sitting exactly on the
    candidate with a matching score (cost 0.0) against the established boot
    tracklet's 0.008, an advantage far over VETO_MARGIN - and the veto still
    declines, because the challenger has no history to judge the candidate
    by. (Measured on the guardrail before this guard: 13 of the 14 transfers
    a one-point challenger would make go to a newborn tracklet, and one seed
    loses 5 right frames to unknown.)"""
    pts = 12 * STEP6
    b_hist = [ball.Cand(int(round(k * STEP6)), 0.42 + k / 120, 0.715, 6.0, 0.48) for k in range(12)]
    live = [ball.Tracklet(0, b_hist),
            ball.Tracklet(0, [ball.Cand(int(round(11 * STEP6)), 0.528, 0.715, 6.0, 0.48)])]
    cands = [ball.Cand(int(round(pts)), 0.528, 0.715, 6.0, 0.48)]
    assert ball._veto_assignment([(0, 0)], live, cands, int(round(pts)), ASPECT, STEP6) == [(0, 0)]


def test_veto_declines_when_the_better_fit_is_outside_detection_jitter():
    """The challenger fits better by identity cost (0.05 against the holder's
    0.06) but its prediction is 0.05 from the candidate - far outside
    TRACK_SLACK, both predictions far off, neither tracklet actually fitting
    it. The veto declines: it only fires where the challenger is where the
    candidate is, up to jitter, not where it merely fits less badly. (The
    linear-ball guardrail, before this guard: one transfer a mature
    challenger would still make has it 0.042 away, and taking it costs a
    ball frame to unknown.)"""
    pts = 12 * STEP6
    holder = [ball.Cand(int(round(8 * STEP6)), 0.50, 0.70, 7.0, 0.40),
              ball.Cand(int(round(9 * STEP6)), 0.51, 0.70, 7.0, 0.40)]
    challenger = [ball.Cand(int(round(10 * STEP6)), 0.54, 0.70, 6.0, 0.40),
                  ball.Cand(int(round(11 * STEP6)), 0.545, 0.70, 6.0, 0.40)]
    live = [ball.Tracklet(0, holder), ball.Tracklet(0, challenger)]
    cands = [ball.Cand(int(round(pts)), 0.60, 0.70, 7.0, 0.40)]
    assert ball._veto_assignment([(0, 0)], live, cands, int(round(pts)), ASPECT, STEP6) == [(0, 0)]


def test_veto_does_not_fragment_a_tracklet():
    """Scene V, seed 1, flight on: the veto moves the k=12 boot candidate
    from the ball's tracklet to the boot's, and nothing splits. The shot
    still has exactly 3 tracklets, but their sizes go from [13, 30, 47] to
    [12, 30, 48] - the boot's tracklet is whole, one tracklet with a point
    on every frame, and the ball's tracklet keeps its 12 ball points. The
    veto only ever moves a candidate between two live tracklets; the
    tracklet that loses one simply misses a frame and carries on."""
    kept, shot_of, _truth, _hidden = _kept(_scene_v, 1)
    off = ball.tracklets(kept, shot_of, STEP6, ASPECT, use_flight=True, use_identity=True)
    assert sorted(len(t.points) for t in off) == [13, 30, 47]
    on = ball.tracklets(kept, shot_of, STEP6, ASPECT, use_flight=True, use_identity=True, use_veto=True)
    assert len(on) == 3 and sorted(len(t.points) for t in on) == [12, 30, 48], \
        sorted(len(t.points) for t in on)


def test_veto_works_without_the_identity_rule():
    """The veto is independent of U.11: with the identity rule off, the k=12
    steal still happens, and the veto still settles it on seed 4 (purity
    (0, 0)) and takes one mixed tracklet off seed 1 (3 mixed tracklets to
    2 - the other two are the swap, which only the identity rule settles)."""
    kept, shot_of, _truth, _hidden = _kept(_scene_v, 4)
    on = ball.tracklets(kept, shot_of, STEP6, ASPECT, use_flight=True, use_veto=True)
    assert _purity(on, 0.30) == (0, 0), _purity(on, 0.30)
    kept, shot_of, _truth, _hidden = _kept(_scene_v, 1)
    off = ball.tracklets(kept, shot_of, STEP6, ASPECT, use_flight=True)
    on = ball.tracklets(kept, shot_of, STEP6, ASPECT, use_flight=True, use_veto=True)
    assert _purity(off, 0.30)[0] == 3 and _purity(on, 0.30)[0] == 2, (_purity(off, 0.30), _purity(on, 0.30))


def test_veto_leaves_the_long_arc_and_short_scenes_unchanged():
    """Scenes M and M-short, seeds 1-5: the veto fires nowhere, so the final
    answer is byte-identical with it off and on, and no tracklet mixes in
    either case."""
    for build, ball_score in ((_scene_m, 0.40), (_scene_m_short, 0.40)):
        for seed in (1, 2, 3, 4, 5):
            kept, shot_of, truth, hidden = _kept(build, seed)
            for uf in (False, True):
                off = ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=uf, use_handover=True,
                                       use_identity=True)
                on = ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=uf, use_handover=True,
                                      use_identity=True, use_veto=True)
                assert [(p.pts_us, p.state, round(p.x, 6), round(p.y, 6)) for p in off] == \
                       [(p.pts_us, p.state, round(p.x, 6), round(p.y, 6)) for p in on], (seed, uf)
                assert _purity(ball.tracklets(kept, shot_of, STEP6, ASPECT, use_flight=uf,
                                             use_identity=True, use_veto=True), ball_score) == (0, 0)


def test_veto_leaves_the_linear_ball_guardrail_unchanged():
    """The guardrail, seeds 1-5: the busiest scene, overlapping scores, six
    wandering players. The final answer is byte-identical with the veto off
    and on on every seed - the one-point-challenger and tight-fit guards
    earn their keep here."""
    for seed in (1, 2, 3, 4, 5):
        kept, shot_of, _marks = _guardrail_kept(seed)
        off = ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=True, use_handover=True,
                               use_identity=True)
        on = ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=True, use_handover=True,
                              use_identity=True, use_veto=True)
        assert [(p.pts_us, p.state, round(p.x, 6), round(p.y, 6)) for p in off] == \
               [(p.pts_us, p.state, round(p.x, 6), round(p.y, 6)) for p in on], seed


def test_veto_is_off_by_default():
    kept, shot_of, truth, hidden = _kept(_scene_v, 3)
    default = ball.follow_ball(kept, shot_of, STEP6, ASPECT)
    explicit_off = ball.follow_ball(kept, shot_of, STEP6, ASPECT, use_flight=False, use_handover=False,
                                    use_identity=False, use_veto=False)
    assert [(p.pts_us, p.state, round(p.x, 6), round(p.y, 6)) for p in default] == \
           [(p.pts_us, p.state, round(p.x, 6), round(p.y, 6)) for p in explicit_off]


def test_veto_constant_is_the_documented_tuning_value():
    assert VETO_MARGIN == 0.002 and TRACK_SLACK == 0.012
