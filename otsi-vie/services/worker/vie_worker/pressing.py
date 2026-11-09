"""Pressing (ADR-042), from possession (ADR-040): an opponent closing down the player on the ball. No person clicking, no extra model.

  PRESSURE   during a spell on the ball, a player of the other kit group comes within PRESS_REACH_BH body heights of the holder's feet
             (about 4 m, the usual reach of a pressure) in at least PRESS_MIN_FRAMES frames of the spell, and got nearer while doing it (by
             PRESS_CLOSING of his first distance in the spell, or he was first seen already that near after the spell began), and at
             least once came within PRESS_TIGHT of the reach (about 2.5 m): standing next to someone, or running past him 4 m away, is not
             pressing him. One pressure per presser per spell.
             Distances are measured in the picture, in the two players' own height, so near and far players are treated alike. A vertical
             distance is depth seen at a slant: it is stretched by DEPTH_STRETCH (a main camera tilted about 20 degrees sees a metre of
             depth as about a third of a metre across), so two players one behind the other are not taken as close. The calibrated pitch
             is not used: a few metres' error in it decides whether two players are 2 m or 5 m apart (owner's match: one spell gave six
             "pressures" by players plainly 3-4 body heights away; the picture rule gave none).
  REGAIN     the pressure's team won the ball (a POSSESSION_CHANGE to its kit group) within REGAIN_US of the pressure's end.

Both players need a kit group; whether a kit group is a team (not the officials) is decided where teams are named (the events API).
"""
from __future__ import annotations

import bisect
import math

from .possession import Event, Person, Spell

PRESS_REACH_BH = 2.2           # body heights between the two players' feet (a 1.8 m player: about 4 m)
DEPTH_STRETCH = 3.0
PRESS_MIN_FRAMES = 2
PRESS_TIGHT = 0.6              # share of the reach he must come within at least once (owner's match: 2 of 4 wrong of 12 sampled were 0.88-0.91)
PRESS_CLOSING = 0.8            # he must have come at least this much nearer than where he was first seen in the spell
REGAIN_US = 5_000_000
WIDE_MAX = 0.25                # the near players' height (share of the picture) in the wide view; close-ups are 0.3-0.75


def _feet(p: Person) -> tuple[float, float]:
    return p[2] + p[4] / 2, p[3] + p[5]


def gap(a: Person, b: Person, aspect: float) -> float:
    """Distance between two people's feet, in pressure units: 1.0 is the edge of pressing reach."""
    (ax, ay), (bx, by) = _feet(a), _feet(b)
    h = max(1e-6, (a[5] + b[5]) / 2)
    return math.hypot((ax - bx) * aspect, (ay - by) * DEPTH_STRETCH) / h / PRESS_REACH_BH


def pressures(merged: list[Spell], people: dict[int, list[Person]], aspect: float, changes: list[Event]) -> list[Event]:
    """The pressures on each spell's holder, with whether the pressing team won the ball soon after."""
    frames = sorted(people)
    won = sorted((e.start, e.kit_group) for e in changes if e.kind == "POSSESSION_CHANGE")
    won_at = [w[0] for w in won]
    out: list[Event] = []
    for s in merged:
        if s.kit_group is None or max(s.first_scale, s.last_scale) > WIDE_MAX:
            continue
        first: dict[str, float] = {}
        near: dict[str, list[tuple[int, float]]] = {}
        kit: dict[str, int] = {}
        i = bisect.bisect_left(frames, s.start)
        while i < len(frames) and frames[i] <= s.end:
            f = frames[i]; i += 1
            box = {q[0]: q for q in people[f]}
            h = next((box[t] for t in s.tracks if t in box), None)
            if h is None:
                continue
            for q in people[f]:
                if q[1] is None or q[1] == s.kit_group or q[0] in s.tracks:
                    continue
                d = gap(h, q, aspect)
                first.setdefault(q[0], d)
                kit[q[0]] = q[1]
                if d <= 1.0:
                    near.setdefault(q[0], []).append((f, d))
        for tid, hits in near.items():
            if len(hits) < PRESS_MIN_FRAMES:
                continue
            closest = min(d for _, d in hits)
            arrived = hits[0][0] > s.start and first[tid] == hits[0][1]           # first seen already within reach, after the spell began
            if closest > PRESS_TIGHT or not (arrived or closest <= PRESS_CLOSING * first[tid]):
                continue
            a, b = hits[0][0], hits[-1][0]
            j = bisect.bisect_left(won_at, a)
            regain = any(won[k][1] == kit[tid] for k in range(j, bisect.bisect_right(won_at, max(b, s.end) + REGAIN_US)))
            out.append(Event("PRESSURE", a, b, tid, s.track_id, kit[tid], "DETECTED", round(s.confidence, 3),
                             {"from_kit_group": s.kit_group, "closest": round(closest, 2), "first": round(first[tid], 2), "frames": len(hits),
                              "regain": regain}))
    return sorted(out, key=lambda e: e.start)
