"""Key actions (ADR-041), from possession (ADR-040): tackles, interceptions, shots and the passes before a shot. No person clicking, no
extra model; each rule says only what the ball and the people show, and leaves the rest unknown.

  TACKLE        the ball changed team at the loser's feet: when the loser last had it the winner was within TACKLE_REACH body heights of
                him, the ball hardly moved (under PASS_MIN_TRAVEL body heights) and the winner had it within TACKLE_MAX_US
  INTERCEPTION  the ball changed team in flight: it travelled at least PASS_MIN_TRAVEL body heights from the loser (a pass or a clearance)
                and the winner was not near the loser (INTERCEPT_FAR body heights or not in the frame) - he cut it out
                Anything between (a loose ball, a long gap, a winner half-near) stays a plain change of possession.
  SHOT          where the pitch is calibrated: the ball leaves a player within SHOT_MAX_M of a goal, moves at SHOT_MIN_SPEED or faster
                over the next frames of the shot (at least SHOT_MIN_POINTS ball positions within SHOT_WINDOW_US), towards that goal
                and on a line that crosses the goal line within SHOT_AIM_M of the goal's centre (the posts plus a margin: shots off target
                count, crosses along the line do not). Speeds are measured on the ground plane, so a lofted ball reads a little fast
  KEY_PASS      a pass whose receiver shoots from that same spell on the ball

Picture positions are normalised; pitch metres have the centre spot at (0, 0) and x along the length.
"""
from __future__ import annotations

import bisect
import math
from dataclasses import replace
from typing import Callable

from .ball import BallPoint, Pitch
from .possession import PASS_MIN_TRAVEL, Event, Spell

TACKLE_REACH = 1.2             # body heights between the two players' feet when the loser last had the ball
TACKLE_MAX_US = 1_500_000
INTERCEPT_FAR = 2.0            # body heights: the winner was this far from the loser, or not in the frame
SHOT_MAX_M = 32.0              # metres from the goal's centre at the release (outside: a long ball, not a shot)
SHOT_MIN_SPEED = 14.0          # metres a second (50 km/h); a firm pass is 10-15, a shot 20-30
SHOT_WINDOW_US = 1_000_000
SHOT_MIN_POINTS = 2
SHOT_AIM_M = 3.66 + 3.0        # half the goal's width plus 3 m either side

Kinds = ("TACKLE", "INTERCEPTION", "SHOT")


def _on_pitch(pitch: Pitch, x: float, y: float) -> tuple[float, float] | None:
    M = pitch[0]
    w = M[2][0] * x + M[2][1] * y + M[2][2]
    if not w > 1e-9:
        return None
    return (M[0][0] * x + M[0][1] * y + M[0][2]) / w, (M[1][0] * x + M[1][1] * y + M[1][2]) / w


def challenge(change: Event) -> str | None:
    """A change of possession told apart: TACKLE, INTERCEPTION or None (not clear from what was seen)."""
    f = change.features
    travel, close, gap = f.get("travel_bh"), f.get("close_bh"), f.get("gap_us")
    if travel is None or gap is None:
        return None
    if close is not None and close <= TACKLE_REACH and travel < PASS_MIN_TRAVEL and gap <= TACKLE_MAX_US:
        return "TACKLE"
    if travel >= PASS_MIN_TRAVEL and (close is None or close >= INTERCEPT_FAR):
        return "INTERCEPTION"
    return None


def shot_from(s: Spell, points: list[BallPoint], times: list[int], shot_of: dict[int, int], pitch_at: Callable[[int], Pitch | None]) -> dict | None:
    """The ball's flight after the spell `s` ends, if it was a shot: where from, how fast, how far from goal, where it was aimed."""
    pitch = pitch_at(s.end)
    if pitch is None:
        return None
    _, length, width = pitch
    r = _on_pitch(pitch, *s.last)
    if r is None or abs(r[0]) > length / 2 + 1 or abs(r[1]) > width / 2 + 1:
        return None
    after = []
    for i in range(bisect.bisect_right(times, s.end), len(times)):
        b = points[i]
        if b.pts_us - s.end > SHOT_WINDOW_US or shot_of.get(b.pts_us, -1) != s.shot:
            break
        q_pitch = pitch_at(b.pts_us)
        q = _on_pitch(q_pitch, b.x, b.y) if q_pitch is not None and b.state == "DETECTED" else None
        if q is not None:
            after.append((b.pts_us, q))
    if len(after) < SHOT_MIN_POINTS:
        return None
    t, q = after[-1]
    dx, dy = q[0] - r[0], q[1] - r[1]
    speed = math.hypot(dx, dy) / ((t - s.end) / 1e6)
    if speed < SHOT_MIN_SPEED or abs(dx) < 1e-6:
        return None
    gx = math.copysign(length / 2, dx)                                       # the goal it is heading for
    dist = math.hypot(gx - r[0], r[1])
    aim = r[1] + (gx - r[0]) * dy / dx                                        # where the line crosses the goal line
    if dist > SHOT_MAX_M or abs(aim) > SHOT_AIM_M:
        return None
    return {"from_m": [round(r[0], 1), round(r[1], 1)], "speed_ms": round(speed, 1), "distance_m": round(dist, 1), "aim_m": round(aim, 1),
            "points": len(after)}


def key_actions(evs: list[Event], merged: list[Spell], points: list[BallPoint], shot_of: dict[int, int],
                pitch_at: Callable[[int], Pitch | None] | None) -> list[Event]:
    """The possession events with the key actions added: TACKLE / INTERCEPTION next to their change of possession, SHOT, and a PASS whose
    receiver shot marked `key` (features.key = true)."""
    out = list(evs)
    for e in evs:
        if e.kind == "POSSESSION_CHANGE" and (how := challenge(e)):
            out.append(Event(how, e.start, e.end, e.other_track_id, e.track_id, e.kit_group, e.state, e.confidence,
                             {k: e.features.get(k) for k in ("from_kit_group", "travel_bh", "close_bh", "gap_us", "length_m")}))
    shooters: set[tuple[str, int]] = set()
    if pitch_at:
        pts = sorted(points, key=lambda b: b.pts_us)
        times = [b.pts_us for b in pts]
        for s in merged:
            f = shot_from(s, pts, times, shot_of, pitch_at)
            if f:
                out.append(Event("SHOT", s.end, s.end + SHOT_WINDOW_US, s.track_id, None, s.kit_group, "DETECTED", round(s.confidence, 3), f))
                shooters.add((s.track_id, s.start))
    if shooters:
        starts = {(s.track_id, s.start) for s in merged}
        out = [replace(e, features={**e.features, "key": True}) if e.kind == "PASS" and (e.other_track_id, e.end) in shooters and (e.other_track_id, e.end) in starts
               else e for e in out]
    return sorted(out, key=lambda e: (e.start, e.kind))
