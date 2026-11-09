"""Key actions (ADR-041): a change of possession told apart, a shot found from the ball's flight on a calibrated pitch, a key pass."""
from vie_worker.actions import challenge, key_actions, shot_from
from vie_worker.ball import BallPoint
from vie_worker.possession import Event, Spell

STEP = 166_667


def change(travel, close, gap=300_000):
    return Event("POSSESSION_CHANGE", 0, gap, "loser", "winner", 1, "DETECTED", 0.8, {"from_kit_group": 0, "travel_bh": travel, "close_bh": close, "gap_us": gap})


def test_won_at_the_feet_is_a_tackle_won_in_flight_an_interception_and_the_rest_unknown():
    assert challenge(change(0.5, 0.8)) == "TACKLE"
    assert challenge(change(3.0, None)) == "INTERCEPTION"                   # the winner was not even in the frame: he cut out a pass
    assert challenge(change(3.0, 2.5)) == "INTERCEPTION"
    assert challenge(change(0.5, 0.8, gap=3_000_000)) is None              # too long: what happened was not seen
    assert challenge(change(0.5, 1.8)) is None                             # nobody near, the ball hardly moved: a loose ball
    assert challenge(change(3.0, 1.0)) is None                             # the winner was right next to him: a duel or a pass, unclear


# a calibrated pitch: picture x 0..1 -> -52.5..52.5 m, picture y 0..1 -> -34..34 m (a top-down camera)
PITCH = ([[105.0, 0.0, -52.5], [0.0, 68.0, -34.0], [0.0, 0.0, 1.0]], 105.0, 68.0)
px = lambda m: (m + 52.5) / 105.0
py = lambda m: (m + 34.0) / 68.0


def flight(x0, y0, vx, vy, n=4):
    """the ball from (x0, y0) metres at vx, vy m/s, one point a frame"""
    return [BallPoint(1_000_000 + (i + 1) * STEP, "DETECTED", px(x0 + vx * (i + 1) * STEP / 1e6), py(y0 + vy * (i + 1) * STEP / 1e6), 0.9) for i in range(n)]


def spell(x, y):
    return Spell("striker", 0, 0, 500_000, 1_000_000, frames=4, conf=3.2, heights=0.4, first=(px(x), py(y)), last=(px(x), py(y)), tracks=["striker"])


def test_a_shot_is_a_fast_ball_towards_goal_from_near_it():
    pts = flight(36, 2, 25, 0)
    times = [b.pts_us for b in pts]
    shot_of = {t: 0 for t in times}
    f = shot_from(spell(36, 2), pts, times, shot_of, lambda t: PITCH)
    assert f and f["speed_ms"] >= 24 and f["distance_m"] < 17 and abs(f["aim_m"]) < 3
    slow = flight(36, 2, 8, 0)                                                     # a pass along the ground
    assert shot_from(spell(36, 2), slow, [b.pts_us for b in slow], shot_of | {b.pts_us: 0 for b in slow}, lambda t: PITCH) is None
    far = flight(-10, 0, 30, 0)                                                     # a long ball from the halfway line
    assert shot_from(spell(-10, 0), far, [b.pts_us for b in far], {b.pts_us: 0 for b in far}, lambda t: PITCH) is None
    cross = flight(40, 30, 2, -25)                                                  # a cross along the goal line
    assert shot_from(spell(40, 30), cross, [b.pts_us for b in cross], {b.pts_us: 0 for b in cross}, lambda t: PITCH) is None
    assert shot_from(spell(36, 2), pts, times, shot_of, lambda t: None) is None    # no measured pitch: not told


def test_the_pass_before_a_shot_is_a_key_pass():
    s = spell(36, 2)
    pts = flight(36, 2, 25, 0)
    shot_of = {b.pts_us: 0 for b in pts}
    p = Event("PASS", 300_000, s.start, "passer", "striker", 0, "DETECTED", 0.8, {"length_m": 12.0})
    out = key_actions([p], [s], pts, shot_of, lambda t: PITCH)
    assert [e.kind for e in out] == ["PASS", "SHOT"]
    assert out[0].features["key"] is True and out[1].track_id == "striker"
