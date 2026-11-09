"""Goals from the broadcast scoreboard (ADR-049): where the score is printed, reading it, settling it over time, a goal only for a +1
change, and the goal placed on the last live play before the change (the possible scorer, a free kick just before)."""
from vie_worker.ball import BallPoint
from vie_worker.lineup import Line
from vie_worker.possession import Event
from vie_worker.scoreboard import Box, goals, parse, place, score_boxes, settled

S = 1_000_000


def bug(home: str, away: str, clock: str = "31:24") -> list[Line]:
    """a broadcast score graphic: TEAM [h] [a] TEAM clock, all on one row"""
    return [Line("ERC", 0.9, 97, 77, 162, 107), Line(home, 0.9, 179, 70, 214, 96), Line(away, 0.9, 217, 70, 254, 96),
            Line("DIN", 0.9, 275, 77, 347, 107), Line(clock, 0.99, 347, 80, 406, 103), Line("12", 0.9, 900, 600, 930, 630)]


def test_the_score_boxes_are_the_digits_on_the_clocks_row_seen_in_most_frames():
    boxes = score_boxes([bug("0", "0"), bug("0", "1"), [Line("HELLO", 0.9, 10, 10, 90, 30)], bug("O", "1")])
    assert [(b.x0, b.x1) for b in boxes] == [(179, 214), (217, 254)]          # the "12" far below the clock is not the score
    assert score_boxes([[Line("0", 0.9, 10, 10, 20, 30)]]) == []               # no clock: no scoreboard, no goals


def test_reading_one_box_per_team_or_one_box_for_both():
    assert parse([("0", 0.9), ("1", 0.95)]) == (0, 1)
    assert parse([("O", 0.9), ("2", 0.95)]) == (0, 2)
    assert parse([("01", 0.8)]) == (0, 1)                                       # two numbers printed apart, read as one text
    assert parse([("0j1", 0.8)]) == (0, 1)                                      # the gap read as a letter
    assert parse([("2-1", 0.8)]) == (2, 1)
    assert parse([("10", 0.9), ("1", 0.5)]) is None                             # not confident
    assert parse([("101", 0.9)]) is None                                        # ambiguous
    assert parse([("RA", 0.9)]) is None


def test_a_goal_is_a_settled_plus_one_and_single_misreads_never_count():
    reads = [(t * 5 * S, (0, 0)) for t in range(20)] + [(102 * S, (1, 0))]      # one misread 1-0
    reads += [(t * 5 * S, (0, 1)) for t in range(21, 40)] + [(205 * S, (0, 7))]
    assert [s for _, _, s in settled(reads)] == [(0, 0), (0, 1)]
    (g,) = goals(reads)
    assert (g.side, g.score, g.after_us, g.before_us) == (1, (0, 1), 95 * S, 105 * S)
    down = [(t * 5 * S, (1, 0)) for t in range(10)] + [(t * 5 * S, (0, 0)) for t in range(10, 20)]
    two = [(t * 5 * S, (0, 0)) for t in range(10)] + [(t * 5 * S, (2, 0)) for t in range(10, 20)]
    assert goals(down) == [] and goals(two) == []                              # a correction or a jump of two: no goal claimed


def test_the_goal_is_the_last_live_play_before_the_score_changed_with_the_possible_scorer_and_the_free_kick():
    from vie_worker.scoreboard import Goal
    starts = [0, 60 * S, 100 * S, 104 * S]                                     # play, play (the goal), celebration close-up, bench
    pts = [BallPoint(t * S // 2, "DETECTED", 0.5, 0.5, 0.9) for t in range(0, 200)]   # ball seen 0-100 s
    ev = [Event("SET_PIECE", 80 * S, 88 * S, "fk", None, 1, "DETECTED", 0.8, {"kind": "FREE_KICK"}),
          Event("POSSESSION", 88 * S, 92 * S, "fk", None, 1, "DETECTED", 0.8, {}),
          Event("SET_PIECE", 97 * S, 99 * S, None, None, None, "DETECTED", 0.8, {"kind": "GOAL_KICK"})]
    e = place(Goal(1, 103 * S, 108 * S, (0, 1)), starts, pts, ev, 200 * S)
    assert (e.kind, e.start, e.end, e.track_id, e.kit_group, e.state) == ("GOAL", 85 * S, 104 * S, "fk", 1, "INFERRED")
    assert e.features["set_piece"] == "FREE_KICK" and e.features["set_piece_taker"] == "fk" and e.features["score"] == [0, 1]
    late = place(Goal(1, 103 * S, 108 * S, (0, 1)), starts, pts, ev[:1], 200 * S)
    assert late.track_id is None                                               # nobody on the ball in the last 10 s: scorer unknown
    assert place(Goal(1, 103 * S, 108 * S, (0, 1)), starts, [], ev, 200 * S) is None    # no live play seen: not placed
