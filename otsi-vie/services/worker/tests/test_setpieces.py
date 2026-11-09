"""Set pieces (ADR-048): a dead ball then its restart; the taker; the kind from where the ball stood. Rolling balls, dead balls never seen
leaving and a tangle of two players are not set pieces or have no taker."""
from vie_worker.ball import BallPoint
from vie_worker.setpieces import kind_at, set_pieces

STEP = 250_000                                              # 4 points a second
H = 0.1
ASPECT = 16 / 9
# picture -> pitch metres: x 0..1 -> -52.5..52.5, y 0..1 -> -34..34 (a plan view; enough for the rules)
PLAN = ([[105.0, 0.0, -52.5], [0.0, 68.0, -34.0], [0.0, 0.0, 1.0]], 105.0, 68.0)


def box(tid, kit, fx, fy, h=H):
    """a person whose feet are at (fx, fy)"""
    return (tid, kit, fx - 0.02, fy - h, 0.04, h)


def dead_then_kick(x, y, still_s=3.0, kick=True, n_after=3):
    pts = [BallPoint(i * STEP, "DETECTED", x + (0.001 if i % 2 else 0), y, 0.8) for i in range(int(still_s * 4) + 1)]
    t = pts[-1].pts_us
    if kick:
        pts += [BallPoint(t + (k + 1) * STEP, "DETECTED", x + 0.05 * (k + 1), y, 0.8) for k in range(n_after)]
    return pts


def people_at(pts, *who):
    return {p.pts_us: list(who) for p in pts}


def test_a_dead_ball_then_a_kick_is_a_set_piece_with_its_taker_and_kind():
    pts = dead_then_kick(0.7, 0.5)
    ev = set_pieces(pts, people_at(pts, box("taker", 1, 0.69, 0.51), box("wall", 0, 0.8, 0.5)), {}, ASPECT, lambda t: PLAN)
    assert len(ev) == 1
    e = ev[0]
    assert (e.kind, e.track_id, e.kit_group, e.start, e.end) == ("SET_PIECE", "taker", 1, 0, 12 * STEP)
    assert e.features["kind"] == "FREE_KICK" and e.features["still_s"] == 3.0 and e.features["x_m"] == 21.0


def test_the_kind_comes_from_where_the_ball_stood():
    def k(x, y, hands=False):
        return kind_at(PLAN, BallPoint(0, "DETECTED", x, y, 1), hands)[0]
    assert k(0.5, 0.5) == "KICK_OFF"
    assert k(0.5 + (52.5 - 11) / 105, 0.5) == "PENALTY"
    assert k(0.995, 0.99) == "CORNER"
    assert k(0.98, 0.52) == "GOAL_KICK"
    assert k(0.6, 0.995) == "THROW_IN"
    assert k(0.3, 0.4) == "FREE_KICK"
    assert kind_at(None, BallPoint(0, "DETECTED", 0.3, 0.4, 1), False)[0] is None              # no calibration: unknown
    assert kind_at(None, BallPoint(0, "DETECTED", 0.3, 0.4, 1), True)[0] == "THROW_IN"         # in his hands: a throw-in anyway


def test_a_throw_in_held_overhead_has_the_thrower_as_taker():
    pts = dead_then_kick(0.4, 0.3)
    ev = set_pieces(pts, people_at(pts, box("thrower", 0, 0.4, 0.38)), {}, ASPECT, None)        # the ball at his chest: in his hands
    assert ev[0].track_id == "thrower" and ev[0].features["hands"] is True and ev[0].features["kind"] == "THROW_IN"


def test_rolling_balls_short_stops_unseen_restarts_and_tangles_are_not_set_pieces_or_have_no_taker():
    rolling = [BallPoint(i * STEP, "DETECTED", 0.2 + 0.03 * i, 0.5, 0.8) for i in range(20)]
    assert set_pieces(rolling, {}, {}, ASPECT, None) == []
    assert set_pieces(dead_then_kick(0.5, 0.5, still_s=1.0), {}, {}, ASPECT, None) == []                      # 1 s: play goes on
    assert set_pieces(dead_then_kick(0.5, 0.5, kick=False), {}, {}, ASPECT, None) == []                        # never seen leaving
    cut = dead_then_kick(0.5, 0.5)
    shots = {p.pts_us: (0 if i <= 12 else 1) for i, p in enumerate(cut)}
    assert set_pieces(cut, {}, shots, ASPECT, None) == []                                                      # it "left" across a cut
    inferred = [BallPoint(p.pts_us, "INFERRED", p.x, p.y, p.confidence) for p in dead_then_kick(0.5, 0.5)]
    assert set_pieces(inferred, {}, {}, ASPECT, None) == []                                                    # still only where seen
    pts = dead_then_kick(0.5, 0.5)
    two = set_pieces(pts, people_at(pts, box("a", 0, 0.503, 0.51), box("b", 1, 0.497, 0.51)), {}, ASPECT, None)
    assert len(two) == 1 and two[0].track_id is None                                                           # two at the ball: unknown


def test_a_ball_lying_behind_the_goal_line_is_not_a_set_piece():
    pts = dead_then_kick(1.04, 0.5)                                            # 4.7 m behind the goal line: in the net after a goal
    assert kind_at(PLAN, pts[0], False)[0] == "OUT"
    assert set_pieces(pts, people_at(pts, box("keeper", 1, 1.03, 0.51)), {}, ASPECT, lambda t: PLAN) == []
