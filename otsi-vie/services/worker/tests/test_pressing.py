"""Pressing (ADR-042): an opponent closing down the player on the ball; standing by, running past and close-ups are not pressing."""
from vie_worker.possession import Event, Spell
from vie_worker.pressing import pressures

STEP = 166_667
H = 0.1                                                     # every player a tenth of the picture tall: the wide view


def box(tid, kit, fx, fy, h=H):
    """a person whose feet are at (fx, fy)"""
    return (tid, kit, fx - 0.02, fy - h, 0.04, h)


def spell(n=6, scale=H):
    return Spell("holder", 0, 0, STEP, n * STEP, frames=n, conf=0.8 * n, heights=H * n, first=(0.5, 0.6), last=(0.5, 0.6),
                 first_scale=scale, last_scale=scale, tracks=["holder"])


def frames(path, h=H, n=6):
    """the holder still at (0.5, 0.6); the other player at path(i) in frame i"""
    return {(i + 1) * STEP: [box("holder", 0, 0.5, 0.6, h), box("other", 1, *path(i), h)] for i in range(n)}


ASPECT = 16 / 9


def test_an_opponent_closing_in_is_a_pressure_and_his_team_winning_it_back_a_regain():
    people = frames(lambda i: (0.5 + 0.12 - 0.02 * i, 0.6))                   # from 2.1 to 0.2 body heights (x is stretched by the aspect)
    won = [Event("POSSESSION_CHANGE", 6 * STEP, 7 * STEP, "holder", "other", 1, "DETECTED", 0.8, {"from_kit_group": 0})]
    out = pressures([spell()], people, ASPECT, won)
    assert len(out) == 1
    e = out[0]
    assert (e.kind, e.track_id, e.other_track_id, e.kit_group) == ("PRESSURE", "other", "holder", 1)
    assert e.features["regain"] is True and e.features["from_kit_group"] == 0
    assert pressures([spell()], people, ASPECT, [])[0].features["regain"] is False


def test_standing_by_running_past_far_and_team_mates_are_not_pressing():
    assert pressures([spell()], frames(lambda i: (0.53, 0.6)), ASPECT, []) == []                    # beside him all along: not closing
    assert pressures([spell()], frames(lambda i: (0.5 + 0.11 - 0.002 * i, 0.6)), ASPECT, []) == []  # 4 m away, never within 2.5 m
    # running in a few metres behind him in depth: 0.6 body heights up the picture is about 1.8 on the ground - near, not pressing
    assert pressures([spell()], frames(lambda i: (0.5 + 0.12 - 0.024 * i, 0.6 - 0.06)), ASPECT, []) == []
    mates = {t: [(q[0], 0, *q[2:]) for q in p] for t, p in frames(lambda i: (0.5 + 0.12 - 0.02 * i, 0.6)).items()}
    assert pressures([spell()], mates, ASPECT, []) == []


def test_a_close_up_is_not_read():
    people = frames(lambda i: (0.5 + 0.5 - 0.08 * i, 0.9), h=0.5)
    assert pressures([spell(scale=0.5)], people, ASPECT, []) == []
