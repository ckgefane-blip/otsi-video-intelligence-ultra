"""Possession and passes (ADR-040) on a made-up passing move: who holds the ball, spells, passes, a renumbered player, a lost ball, a cut."""
from vie_worker.ball import BallPoint
from vie_worker.possession import analyse, holder, spells

STEP = 166_667                 # 6 analysed frames a second
A = 16 / 9


def person(tid, kit, fx, fy, h=0.2):
    """a person whose feet are at (fx, fy), h tall (normalised)"""
    return (tid, kit, fx - 0.02, fy - h, 0.04, h)


def at(t, x, y, state="DETECTED"):
    return BallPoint(t, state, x, y, 0.8)


def test_the_ball_at_one_players_feet_is_his_and_a_duel_is_nobodys():
    a, b = person("a", 0, 0.30, 0.60), person("b", 1, 0.60, 0.60)
    assert holder(at(0, 0.31, 0.59), [a, b], A)[0] == "a"
    assert holder(at(0, 0.45, 0.59), [a, b], A) is None                     # in the open
    assert holder(at(0, 0.30, 0.42), [a, b], A) is None                     # at his chest: a header, not possession
    c = person("c", 1, 0.33, 0.60)
    assert holder(at(0, 0.315, 0.59), [a, c], A) is None                    # two players' feet: a duel


def move(frames):
    """frames: list of (ball x, people) -> points and people per frame"""
    pts, people = [], {}
    for i, (bx, ps) in enumerate(frames):
        t = i * STEP
        if bx is not None:
            pts.append(at(t, bx, 0.595))
        people[t] = ps
    return pts, people


def test_a_pass_a_renumbered_player_and_a_lost_ball():
    p1, p2, p3 = (lambda: person("a", 0, 0.20, 0.60)), (lambda: person("b", 0, 0.50, 0.60)), (lambda: person("x", 1, 0.80, 0.60))
    frames = (
        [(0.20, [p1(), p2(), p3()])] * 4                                   # a has it
        + [(0.30, [p1(), p2(), p3()]), (0.40, [p1(), p2(), p3()])]         # in flight
        + [(0.50, [p1(), p2(), p3()])] * 4                                 # b receives: a pass
        + [(0.50, [p1(), person("b2", 0, 0.50, 0.60), p3()])] * 3          # the tracker renumbers b as b2: the same spell
        + [(0.65, [p1(), person("b2", 0, 0.50, 0.60), p3()])]              # loose
        + [(0.80, [p1(), person("b2", 0, 0.50, 0.60), p3()])] * 3          # x of the other team wins it
    )
    pts, people = move(frames)
    shot = {t: 0 for t in people}
    ev, counts = analyse(pts, people, shot, A)
    kinds = [e.kind for e in ev]
    assert kinds.count("PASS") == 1 and kinds.count("POSSESSION_CHANGE") == 1
    p = next(e for e in ev if e.kind == "PASS")
    assert (p.track_id, p.other_track_id, p.kit_group) == ("a", "b", 0)
    c = next(e for e in ev if e.kind == "POSSESSION_CHANGE")
    assert (c.track_id, c.other_track_id, c.kit_group, c.features["from_kit_group"]) == ("b", "x", 1, 0)
    phases = [e for e in ev if e.kind == "TEAM_POSSESSION"]
    assert [e.kit_group for e in phases] == [0, 1]
    assert counts["spells"] == 3                                             # a, b (with b2), x


def test_nothing_is_linked_across_a_cut_or_a_long_gap():
    a, b = person("a", 0, 0.20, 0.60), person("b", 0, 0.50, 0.60)
    frames = [(0.20, [a, b])] * 3 + [(0.50, [a, b])] * 3
    pts, people = move(frames)
    cut = {t: (0 if i < 3 else 1) for i, t in enumerate(sorted(people))}
    ev, _ = analyse(pts, people, cut, A)
    assert not [e for e in ev if e.kind == "PASS"]                           # a replay or another camera: not seen, not a pass
    # a cut the shot detector missed: a close-up (people twice as tall), then the wide camera
    zoom = [(0.20, [person("a", 0, 0.20, 0.60, h=0.4), person("q", 0, 0.70, 0.60, h=0.4)])] * 3 + [(0.50, [a, b])] * 3
    pts, people = move(zoom)
    ev, _ = analyse(pts, people, {t: 0 for t in people}, A)
    assert not [e for e in ev if e.kind == "PASS"]
    # one frame at someone's feet is not a spell: a ball rolling past
    assert spells([at(0, 0.20, 0.595)], {0: [a]}, {0: 0}, A) == []
