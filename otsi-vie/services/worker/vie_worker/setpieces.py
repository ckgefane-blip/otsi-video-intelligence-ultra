"""Set pieces (ADR-048), from the engine's ball (ADR-037/038) and the people it follows: a dead ball, then the restart. No person clicking,
no extra model; each rule says only what the ball and the people show, and leaves the rest unknown.

  DEAD BALL    inside one camera shot, the ball is seen (DETECTED, not inferred) at one spot for at least STILL_MIN_US: every point within
               STILL_BH body heights of the first (the near players' height in that frame, as in possession), with no gap longer than
               STILL_GAP_US. In open play the ball rarely stands still that long; waiting for a free kick, a corner or a throw-in it does.
  RESTART      the next points of the same shot, within KICK_WINDOW_US of the last still one, take the ball at least KICK_BH body heights
               from the spot: it was kicked or thrown. A dead ball that is never seen leaving (a cut to a replay) is not a set piece.
  TAKER        the person at the ball when it leaves: its feet within TAKER_BH body heights, or the ball inside the person's box above the
               waist (held in the hands); two people nearly as near (CLEAR_MARGIN) - nobody (unknown beats wrong).
  KIND         where the pitch is calibrated at the spot (metres, centre spot at (0, 0), x along the length); the margins allow for the
               calibration's error of a few metres (owner's match: a kick-off placed 3.7 m from the centre spot):
                 KICK_OFF   within SPOT_M of the centre spot
                 PENALTY    on the penalty spot (11 m from the goal line, within 2 m)
                 CORNER     within 4 m of a corner flag
                 GOAL_KICK  inside a goal area (the 5.5 m box, with a 1.5 m margin)
                 THROW_IN   within 3 m of a touchline or beyond it, or the ball held in the taker's hands
                 FREE_KICK  anywhere else
               a ball still more than BEYOND_M behind the goal line is out of play (owner's match: the ball lying in the net after the goal,
               picked out 3 s later) - not a set piece.
               not calibrated: THROW_IN when held in the hands, else unknown (null): "a set piece".

Picture positions are normalised; distances in the picture use the near players' height, so near and far camera views are treated alike.
"""
from __future__ import annotations

import math
from typing import Callable

from .ball import BallPoint, Pitch
from .possession import CLEAR_MARGIN, WAIST, Event, Person

STILL_MIN_US = 2_000_000
STILL_BH = 0.25                # body heights the ball may wander (detection jitter, a slight pan) and still be one spot
STILL_GAP_US = 1_000_000
KICK_WINDOW_US = 1_500_000
KICK_BH = 1.0
TAKER_BH = 0.8
FALLBACK_SCALE = 0.08          # picture heights: the near players' height when no person is seen in the frame
SPOT_M = 4.5
BEYOND_M = 1.5                 # metres behind the goal line: the ball is out of play there (in the net after a goal), not at a restart
KINDS = ("KICK_OFF", "PENALTY", "CORNER", "GOAL_KICK", "THROW_IN", "FREE_KICK")


def _scale(people: list[Person]) -> float:
    hs = sorted(p[5] for p in people if p[5] > 0)
    return float(hs[int(0.9 * (len(hs) - 1))]) if hs else FALLBACK_SCALE


def _apart(a: BallPoint, b: BallPoint, aspect: float, scale: float) -> float:
    """body heights between two ball points (x stretched by the aspect, as possession measures)"""
    return math.hypot((a.x - b.x) * aspect, a.y - b.y) / scale


def taker(ball: BallPoint, people: list[Person], aspect: float) -> tuple[Person | None, bool]:
    """The person taking the restart and whether the ball is in his hands; (None, False) when nobody is clearly at it."""
    near: list[tuple[float, Person, bool]] = []
    for p in people:
        _, _, x, y, w, h = p
        if h <= 0:
            continue
        hands = x <= ball.x <= x + w and y <= ball.y < y + WAIST * h
        d = 0.0 if hands else math.hypot((ball.x - (x + w / 2)) * aspect, ball.y - (y + h)) / h
        near.append((d, p, hands))
    if not near:
        return None, False
    near.sort(key=lambda q: q[0])
    d, p, hands = near[0]
    if d > TAKER_BH or (len(near) > 1 and not hands and near[1][0] < max(d, 1e-6) * CLEAR_MARGIN):
        return None, False
    return p, hands


def on_pitch(pitch: Pitch, x: float, y: float) -> tuple[float, float] | None:
    M = pitch[0]
    w = M[2][0] * x + M[2][1] * y + M[2][2]
    if not w > 1e-9:
        return None
    return (M[0][0] * x + M[0][1] * y + M[0][2]) / w, (M[1][0] * x + M[1][1] * y + M[1][2]) / w


def kind_at(pitch: Pitch | None, b: BallPoint, hands: bool) -> tuple[str | None, tuple[float, float] | None]:
    """The kind of restart from where the ball stood (see KIND above), and that spot in pitch metres when known."""
    spot = on_pitch(pitch, b.x, b.y) if pitch else None
    if spot is None:
        return ("THROW_IN" if hands else None), None
    _, length, width = pitch                             # type: ignore[misc]
    px, py = abs(spot[0]), abs(spot[1])
    if px > length / 2 + BEYOND_M:
        k = "OUT"                                        # behind the goal line: out of play, or lying in the net after a goal
    elif math.hypot(px, py) <= SPOT_M:
        k = "KICK_OFF"
    elif abs(length / 2 - 11.0 - px) <= 2.0 and py <= 2.0:
        k = "PENALTY"
    elif px >= length / 2 - 4.0 and py >= width / 2 - 4.0:
        k = "CORNER"
    elif px >= length / 2 - 7.0 and py <= 9.16 + 1.5:
        k = "GOAL_KICK"
    elif hands or py >= width / 2 - 3.0:
        k = "THROW_IN"
    else:
        k = "FREE_KICK"
    return k, (round(spot[0], 1), round(spot[1], 1))


def set_pieces(points: list[BallPoint], people: dict[int, list[Person]], shot_of: dict[int, int], aspect: float,
               pitch_at: Callable[[int], Pitch | None] | None = None) -> list[Event]:
    """SET_PIECE events: start = the ball first seen dead, end = the restart; the taker as track_id, his kit group as the team."""
    seen = sorted((p for p in points if p.state == "DETECTED"), key=lambda p: p.pts_us)
    out: list[Event] = []
    i = 0
    while i < len(seen):
        a = seen[i]
        shot = shot_of.get(a.pts_us, -1)
        scale = _scale(people.get(a.pts_us, []))
        j = i
        while (j + 1 < len(seen) and shot_of.get(seen[j + 1].pts_us, -1) == shot and seen[j + 1].pts_us - seen[j].pts_us <= STILL_GAP_US
               and _apart(seen[j + 1], a, aspect, scale) <= STILL_BH):
            j += 1
        last = seen[j]
        if last.pts_us - a.pts_us < STILL_MIN_US:
            i += 1
            continue
        after = [p for p in seen[j + 1:] if p.pts_us - last.pts_us <= KICK_WINDOW_US and shot_of.get(p.pts_us, -1) == shot]
        if not any(_apart(p, last, aspect, scale) >= KICK_BH for p in after):
            i = j + 1                                     # dead, but never seen leaving: not counted
            continue
        who, hands = taker(last, people.get(last.pts_us, []), aspect)
        kind, spot = kind_at(pitch_at(last.pts_us) if pitch_at else None, last, hands)
        if kind == "OUT":                                 # the ball picked out of the net is not a restart
            i = j + 1
            continue
        span = seen[i:j + 1]
        out.append(Event("SET_PIECE", a.pts_us, last.pts_us, who[0] if who else None, None, who[1] if who else None, "DETECTED",
                         round(sum(p.confidence for p in span) / len(span), 3),
                         {"kind": kind, "still_s": round((last.pts_us - a.pts_us) / 1e6, 1), "hands": hands, "x_m": spot[0] if spot else None,
                          "y_m": spot[1] if spot else None}))
        i = j + 1
    return out
