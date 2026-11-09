"""Possession and passes (ADR-040), from the engine's ball (ADR-037/038) and the people it follows - no person clicking, no extra model.

  1  the holder        in a frame where the ball is known, the person whose feet it is at: within CONTROL_REACH body heights of the feet
                       (the bottom centre of the box) and below the waist. Distances are in the person's own body height, so the rule is the
                       same for a player near the camera and one far away. When a second person is nearly as close (CLEAR_MARGIN) nobody
                       holds it: a duel, a tangle of legs - unknown beats wrong
  2  spells            consecutive frames held by one track inside one shot, with gaps of at most SPELL_GAP_US (the ball a step ahead in a
                       dribble, a frame where it is hidden); at least MIN_SPELL_FRAMES frames (a ball rolling past someone's feet is not his)
  3  hand-overs        two spells in a row, in one shot, at most PASS_MAX_US apart:
                         same kit group, the ball moved at least PASS_MIN_TRAVEL body heights   -> PASS (completed: a team-mate received it)
                         same kit group, the ball hardly moved                                  -> one spell (the tracker renumbered the player)
                         different kit groups                                                   -> POSSESSION_CHANGE (a tackle or an
                                                                                                   interception: told apart in vie_worker.actions)
                       spells further apart, or across a cut, are not linked: what happened in between was not seen. A cut the shot
                       detector missed (a close-up, then the wide camera) shows as a jump in the people's typical size on screen: spells whose
                       frames differ by more than SCENE_JUMP in the people's height (the 90th percentile: the near players) are not linked either
  4  team phases       spells of one kit group in a row, linked as in 3, are one TEAM_POSSESSION span: the time a team had the ball

A person's tracks may lack a kit group (too few clean crops): his spells count, but never towards a team, a pass or a change. One-touch
passes (the ball at a player's feet for a single frame) are missed on purpose: a single frame cannot tell a touch from the ball rolling by.
Positions are normalised picture coordinates; a pass's length in metres is given where the pitch is calibrated at both ends.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Iterable

from .ball import BallPoint, Pitch

CONTROL_REACH = 0.6            # body heights from the feet (about a metre for a 1.8 m player): the ball is at his feet
WAIST = 0.5                    # the ball must be below this share of the box (a header is not possession)
CLEAR_MARGIN = 1.3             # the nearest person holds the ball only when the next is at least this much farther away
SPELL_GAP_US = 1_000_000       # a spell continues across this much time without a holder (a dribble, a hidden frame)
MIN_SPELL_FRAMES = 2
PASS_MAX_US = 4_000_000        # a hand-over takes at most this long (a long ball across the pitch: 2-3 s)
PASS_MIN_TRAVEL = 1.5          # body heights the ball must travel between release and reception for a pass ...
PASS_MIN_M = 4.0               # ... and metres on the pitch where it is calibrated at both ends (a panning camera moves the picture, not
                               # the ball: one of 10 sampled passes on the owner's match was one player, the camera following him)
SCENE_JUMP = 1.6               # the near players' height changes by more than this factor: another camera or a zoom, not one scene
                               # (owner's match, 2026-11-02: a sampled "pass" ran from the close camera to the wide one, 0.24 -> 0.12;
                               # the median moved only 1.33x, the far players being the same size in both)

Person = tuple[str, "int | None", float, float, float, float]      # track id, kit group, x, y, w, h (normalised, top-left)


@dataclass
class Spell:
    track_id: str
    kit_group: int | None
    shot: int
    start: int
    end: int
    frames: int = 0
    conf: float = 0.0                                      # sum of the ball's confidence over the frames; mean = conf / frames
    heights: float = 0.0                                   # sum of the holder's box height (normalised)
    first: tuple[float, float] = (0.0, 0.0)                # the ball where he got it and where he let it go
    last: tuple[float, float] = (0.0, 0.0)
    first_state: str = "DETECTED"
    last_state: str = "DETECTED"
    first_scale: float = 0.0                               # the near players' height (90th percentile) in the frame he got it / let it go
    last_scale: float = 0.0
    tracks: list[str] = field(default_factory=list)        # every track merged into the spell (a renumbered player)

    @property
    def confidence(self) -> float:
        return self.conf / max(1, self.frames)

    @property
    def height(self) -> float:
        return self.heights / max(1, self.frames)


@dataclass(frozen=True)
class Event:
    kind: str                  # POSSESSION | PASS | POSSESSION_CHANGE | TEAM_POSSESSION; TACKLE | INTERCEPTION | SHOT (actions); PRESSURE (pressing);
                               # SET_PIECE (setpieces)
    start: int
    end: int
    track_id: str | None       # the holder / the passer / who lost it
    other_track_id: str | None  # the receiver / who won it
    kit_group: int | None      # the team in possession (for a change: the team that won it)
    state: str                 # DETECTED | INFERRED
    confidence: float
    features: dict


def holder(ball: BallPoint, people: list[Person], aspect: float) -> Person | None:
    """The person whose feet the ball is at in this frame, or None (nobody near, or two people nearly as near)."""
    near: list[tuple[float, Person]] = []
    for p in people:
        _, _, x, y, w, h = p
        if h <= 0 or ball.y < y + WAIST * h:
            continue
        d = math.hypot((ball.x - (x + w / 2)) * aspect, ball.y - (y + h)) / h
        near.append((d, p))
    if not near:
        return None
    near.sort(key=lambda q: q[0])
    if near[0][0] > CONTROL_REACH or (len(near) > 1 and near[1][0] < near[0][0] * CLEAR_MARGIN):
        return None
    return near[0][1]


def spells(points: Iterable[BallPoint], people: dict[int, list[Person]], shot_of: dict[int, int], aspect: float) -> list[Spell]:
    """Steps 1-2: the frames the ball is held, joined into spells of one track."""
    out: list[Spell] = []
    cur: Spell | None = None
    for b in sorted(points, key=lambda q: q.pts_us):
        h = holder(b, people.get(b.pts_us, []), aspect)
        if h is None:
            continue
        tid, kg, _, _, _, bh = h
        shot = shot_of.get(b.pts_us, -1)
        hs = sorted(q[5] for q in people[b.pts_us])
        scale = float(hs[int(0.9 * (len(hs) - 1))])
        if cur and cur.track_id == tid and cur.shot == shot and b.pts_us - cur.end <= SPELL_GAP_US:
            cur.end, cur.last, cur.last_state, cur.last_scale = b.pts_us, (b.x, b.y), b.state, scale
        else:
            if cur and cur.frames >= MIN_SPELL_FRAMES:
                out.append(cur)
            cur = Spell(tid, kg, shot, b.pts_us, b.pts_us, first=(b.x, b.y), last=(b.x, b.y), first_state=b.state, last_state=b.state,
                        first_scale=scale, last_scale=scale, tracks=[tid])
        cur.frames += 1
        cur.conf += b.confidence
        cur.heights += bh
    if cur and cur.frames >= MIN_SPELL_FRAMES:
        out.append(cur)
    return out


def _metres(pitch_at: Callable[[int], Pitch | None] | None, a: tuple[int, tuple[float, float]], b: tuple[int, tuple[float, float]]) -> float | None:
    if not pitch_at:
        return None
    pts = []
    for t, (x, y) in (a, b):
        pitch = pitch_at(t)
        if pitch is None:
            return None
        M = pitch[0]
        w = M[2][0] * x + M[2][1] * y + M[2][2]
        if not w > 1e-9:
            return None
        pts.append(((M[0][0] * x + M[0][1] * y + M[0][2]) / w, (M[1][0] * x + M[1][1] * y + M[1][2]) / w))
    return round(math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]), 1)


def _linked(a: Spell, b: Spell) -> bool:
    lo, hi = sorted((a.last_scale, b.first_scale))
    return a.shot == b.shot and 0 <= b.start - a.end <= PASS_MAX_US and hi <= SCENE_JUMP * max(lo, 1e-6)


def _feet_apart(people: dict[int, list[Person]] | None, pts: int, a: str, b: str, aspect: float) -> float | None:
    """Body heights between two people's feet in one frame, or None when either is not seen in it."""
    boxes = {q[0]: q for q in (people or {}).get(pts, [])}
    if a not in boxes or b not in boxes:
        return None
    (_, _, ax, ay, aw, ah), (_, _, bx, by, bw, bh) = boxes[a], boxes[b]
    return math.hypot((ax + aw / 2 - bx - bw / 2) * aspect, ay + ah - by - bh) / max(1e-6, (ah + bh) / 2)


def events(spell_list: list[Spell], aspect: float, pitch_at: Callable[[int], Pitch | None] | None = None,
           people: dict[int, list[Person]] | None = None, merged: list[Spell] | None = None) -> list[Event]:
    """Steps 3-4: passes, changes of possession, the spells themselves and the teams' phases. `merged` (when given) receives the spells
    after renumbered players are joined, for the key actions (vie_worker.actions)."""
    merged = [] if merged is None else merged
    out: list[Event] = []
    for s in spell_list:
        p = merged[-1] if merged else None
        if p and _linked(p, s) and p.kit_group is not None and p.kit_group == s.kit_group:
            travel = math.hypot((s.first[0] - p.last[0]) * aspect, s.first[1] - p.last[1]) / max(1e-6, (p.height + s.height) / 2)
            metres = _metres(pitch_at, (p.end, p.last), (s.start, s.first))
            if s.track_id == p.track_id or travel < PASS_MIN_TRAVEL or (metres is not None and metres < PASS_MIN_M):   # the same player
                p.end, p.last, p.last_state, p.last_scale = s.end, s.last, s.last_state, s.last_scale
                p.frames += s.frames; p.conf += s.conf; p.heights += s.heights
                p.tracks += [t for t in s.tracks if t not in p.tracks]
                continue
            seen = p.last_state == "DETECTED" and s.first_state == "DETECTED"
            out.append(Event("PASS", p.end, s.start, p.track_id, s.track_id, s.kit_group, "DETECTED" if seen else "INFERRED",
                             round(min(p.confidence, s.confidence), 3),
                             {"from": [round(v, 4) for v in p.last], "to": [round(v, 4) for v in s.first], "travel_bh": round(travel, 2),
                              "length_m": metres}))
        elif p and _linked(p, s) and p.kit_group is not None and s.kit_group is not None:
            # what the key actions need to tell a tackle from an interception: how far the ball went, how long it took, and how near the
            # winner was to the loser when the loser last had it
            travel = math.hypot((s.first[0] - p.last[0]) * aspect, s.first[1] - p.last[1]) / max(1e-6, (p.height + s.height) / 2)
            close = _feet_apart(people, p.end, p.track_id, s.track_id, aspect)
            out.append(Event("POSSESSION_CHANGE", p.end, s.start, p.track_id, s.track_id, s.kit_group,
                             "DETECTED" if p.last_state == "DETECTED" and s.first_state == "DETECTED" else "INFERRED",
                             round(min(p.confidence, s.confidence), 3), {"from_kit_group": p.kit_group, "at": [round(v, 4) for v in s.first],
                             "travel_bh": round(travel, 2), "gap_us": s.start - p.end, "close_bh": None if close is None else round(close, 2),
                             "length_m": _metres(pitch_at, (p.end, p.last), (s.start, s.first))}))
        merged.append(s)
    phase: list[Spell] = []

    def close() -> None:
        if phase:
            out.append(Event("TEAM_POSSESSION", phase[0].start, phase[-1].end, None, None, phase[0].kit_group, "DETECTED",
                             round(sum(q.confidence for q in phase) / len(phase), 3), {"spells": len(phase)}))
    for s in merged:
        out.append(Event("POSSESSION", s.start, s.end, s.track_id, None, s.kit_group, "DETECTED" if s.first_state == "DETECTED" else "INFERRED",
                         round(s.confidence, 3), {"frames": s.frames, "tracks": s.tracks}))
        if s.kit_group is None:
            close(); phase = []
            continue
        if phase and (phase[-1].kit_group != s.kit_group or not _linked(phase[-1], s)):
            close(); phase = []
        phase.append(s)
    close()
    return sorted(out, key=lambda e: (e.start, e.kind))


def analyse(points: list[BallPoint], people: dict[int, list[Person]], shot_of: dict[int, int], aspect: float,
            pitch_at: Callable[[int], Pitch | None] | None = None) -> tuple[list[Event], dict]:
    """Everything above, the key actions (vie_worker.actions, ADR-041), pressing (vie_worker.pressing, ADR-042) and set pieces
    (vie_worker.setpieces, ADR-048), with counts for the ball track's metrics."""
    from .actions import key_actions
    from .pressing import pressures
    from .setpieces import set_pieces
    sp = spells(points, people, shot_of, aspect)
    merged: list[Spell] = []
    ev = key_actions(events(sp, aspect, pitch_at, people, merged), merged, points, shot_of, pitch_at)
    ev = sorted(ev + pressures(merged, people, aspect, ev) + set_pieces(points, people, shot_of, aspect, pitch_at), key=lambda e: (e.start, e.kind))
    count = lambda k: sum(e.kind == k for e in ev)
    return ev, {"held_frames": sum(s.frames for s in sp), "spells": count("POSSESSION"), "passes": count("PASS"), "changes": count("POSSESSION_CHANGE"),
                "team_phases": count("TEAM_POSSESSION"), "tackles": count("TACKLE"), "interceptions": count("INTERCEPTION"), "shots": count("SHOT"),
                "key_passes": sum(e.kind == "PASS" and bool(e.features.get("key")) for e in ev), "pressures": count("PRESSURE"),
                "set_pieces": count("SET_PIECE")}
