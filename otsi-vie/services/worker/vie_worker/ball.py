"""The ball, followed automatically from the saved detections (ADR-037): no person clicks, no extra model.

The detector proposes several "ball" candidates per analysed frame (boots, socks, heads, pitch marks, the broadcaster's logo dot, and the
ball). One frame cannot tell them apart - the ball often scores no higher than a boot - but over time only the ball moves like a ball. So:

  1  spots out            off the grass (the detector's grass test: boards, stands, graphics); outside the pitch plus PITCH_MARGIN_M where the
                          pitch is calibrated (ADR-036: the stands, the boards, a coach); at the same picture position across many
                          shots (printed on the picture: the logo); at one picture spot for STILL_US within a shot (a still mark)
  2  size and body out    a candidate far wider or far smaller than the players at its depth allow (the people whose feet are level with it
                          in the picture; a ball near the camera is big next to players far away), or on a player's upper body (a crest
                          in a close-up, a head), is not the ball; at a player's feet it may be, but a boot is too: a candidate at the feet
                          earns FEET_PENALTY less, so a free-moving candidate nearby wins
  3  tracklets            the same object reported twice in a frame (two boxes a few pixels apart) kept once, the stronger; then
                          candidates in nearby frames joined by a constant-velocity prediction, within a ball's reach
                          (U.9: when a tracklet is in flight, by its parabolic arc - `ball_flight` - instead, so the ball is not lost
                          to a boot sitting near the tangent when frames are missed or the sample rate is low)
  4  one path per shot    the best chain of tracklets through the shot (dynamic programming): each tracklet earns its scores, each gap
                          costs, a jump must be physically reachable in the gap; after a long gap the path may restart anywhere. Where two
                          tracklets overlap in time (a boot's and the ball's, side by side) the chain may hand over: the later one is used
                          from the first frame after the earlier one ends. Tracklets are cut into PIECE_FRAMES pieces first, so a chain can
                          keep the part of a tracklet that followed the ball and leave where it drifted onto something else
                          (U.9: a piece that continues a flight must lie on the flight's parabola, else the join is a restart, not the
                          same flight; and a piece that is itself a flight earns FLIGHT_BONUS - a gravity-consistent arc is ball evidence)
                          (U.10: a roll piece that starts where a flight landed carries the ball across the bounce - a handover, not a
                          restart, and it earns HANDOVER_BONUS; and a piece from a tracklet glued to one player's feet for its whole
                          life pays GLUE_PENALTY - a boot, which out-scores the ball for the whole shot and stays glued to it, must not
                          win the path search on detector score alone)
  5  output               frames on the path are DETECTED (a real detection); short gaps between two path points of one chain are
                          INFERRED (straight line, at most INFER_MAX_GAP_US); everything else is UNKNOWN - unknown beats wrong

Positions are normalised picture coordinates of the ball's centre. Distances are measured in picture widths (y scaled by height/width).
A person's mark (ball_marks) is the truth where it exists: `merge_marks` puts it over the engine's answer.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field, replace
from typing import Callable

from .ball_flight import FLIGHT_BONUS, FLIGHT_LINK_TOL, Flight, deviation, flight_of, is_roll

STATIC_CELL = 0.004            # picture widths: about 5 px at 1280
STATIC_MIN_FRAMES = 30         # a spot printed on the picture recurs in this many frames ...
STATIC_MIN_SHOTS = 10          # ... over this many shots (or STATIC_SHOT_SHARE of all shots); an ordinary spot recurs in 3-7 shots by chance
STATIC_SHOT_SHARE = 0.02
STILL_US = 4_000_000           # a candidate at one picture spot for this long within one shot is a still mark (pitch mark under a still
                               # camera, a graphic), not a ball in play ...
STILL_KEEP_SCORE = 0.6         # ... unless the detector is this sure: a ball waiting for a free kick in a close-up scores 0.9
BALL_MAX_OF_PERSON = 0.4       # the ball is ~0.12 of a person's height; generous for blur
BALL_MIN_OF_PERSON = 0.04      # far smaller than the players around it: a crest, a sponsor dot, a lace
SAME_SPOT = 0.008              # picture widths (~10 px at 1280): two candidates closer than this in one frame are one object
DEPTH_BAND = 0.15              # people whose feet are within this much picture height of a candidate stand at about its depth
BALL_MAX_PX_720 = 40           # when no person is seen: widest plausible ball at 720 p
BODY_SHARE = 0.7               # a candidate inside a person's box above its lowest 30 % is on the body (crest, head, hand), not the ball;
                               # at the feet it may well be the ball
FEET_PENALTY = 0.08            # ... or a boot: a candidate in a person's lowest 30 % earns this less than one in the open
FEET_MIN_MEAN = 0.35           # a piece seen only at players' feet counts as the ball only when its detections average this score (on the
                               # owner's match the ball at a player's feet scores 0.6-0.9, boots 0.2-0.5)
PITCH_MARGIN_M = 6.0           # the ball's picture point placed on the ground may lie this far outside the lines (a ball in the air lands
                               # further away on the ground plane; farther still, it is in the stands)
TRACK_SPEED = 0.6              # picture widths per second the ball may move from a tracklet's first point (no velocity known yet)
TRACK_ACCEL = 0.2              # after that: picture widths per second the ball may leave its straight-line prediction (a kick breaks the
                               # tracklet; step 4 joins the pieces)
TRACK_SLACK = 0.012            # plus this (detection jitter), picture widths
TRACK_MAX_MISS = 3             # frames a tracklet may skip and continue
JUMP_SPEED = 1.2               # picture widths per second the ball may travel across a gap between tracklets
JUMP_SLACK = 0.03
JUMP_MAX_US = 1_000_000        # a longer gap breaks the chain: the path restarts (anywhere) at a cost
SCORE_FLOOR = 0.12             # a detection earns score - floor
STEP_BONUS = 0.1               # each continuation of a tracklet earns this: consistency is the evidence
SINGLE_MIN_SCORE = 0.45        # a lone detection joins only when confident
GAP_COST = 0.04                # per missed frame inside a chain
RESTART_COST = 0.3
PIECE_FRAMES = 6               # tracklets enter the path search in pieces of this many detections (1 s at 6 fps)
INFER_MAX_GAP_US = 500_000
GLUE_MIN_POINTS = 12         # U.10: a tracklet needs this many points before its foot-offset spread means anything: over fewer,
                             # jitter alone decides it
GLUE_MIN_FEET_SHARE = 0.8    # U.10: ... and this share of its points at a player's feet: a tracklet that only sometimes passes a
                             # player's feet is not glued to one
GLUE_MAX_SPREAD = 0.02       # U.10, picture widths: the farthest two foot offsets of a glued tracklet may lie apart. A boot's offset
                             # from its player's foot is constant up to detection jitter (0.008-0.014 on the synthetic scenes here,
                             # across seeds); a rolling ball separates from the player (0.05 over the shot in scene V). 0.02 sits
                             # between them - it is a tuning constant, to calibrate on labelled Sukhum crossings. A ball trapped at a
                             # player's feet, or dribbled without ever leaving the foot, looks glued too: that is the known ambiguity,
                             # and the penalty only ever costs weight, never invents a position.
GLUE_PENALTY = 1.2           # U.10, path-search penalty per glued piece: about the weight a boot piece gains over a ball piece by
                             # detector score alone (0.45-0.50 vs 0.30 a point, ~1.05 a 6-point piece). Sized to cancel that
                             # advantage and leave a small margin; a tuning constant, to calibrate on labelled Sukhum flights.
HANDOVER_BONUS = 0.5         # U.10, path-search bonus for a roll piece that starts where a flight landed: it carries the ball's
                             # identity across the bounce instead of paying RESTART_COST for it. A tuning constant, to calibrate on
                             # labelled Sukhum flights.


@dataclass(frozen=True)
class Cand:
    pts_us: int
    x: float                   # centre, normalised
    y: float
    w_px: float
    score: float
    on_pitch: bool = True      # the detector's own test: over the grass, or in the air just above it (vie_worker.detect.pitch)
    at_feet: bool = False      # inside a person's box, in its lowest 30 % (set by `plausible`)
    feet_off: tuple[float, float] | None = None   # U.10: offset from the nearest player's foot centre (bottom centre of
                               # the box), in picture widths (dy scaled by 1/aspect, as in `dist`) - set by `plausible`
                               # alongside at_feet, None when not at any player's feet. A boot's offset is (nearly)
                               # constant over a shot; a rolling ball's drifts away from the player.


@dataclass
class Tracklet:
    shot: int
    points: list[Cand] = field(default_factory=list)
    flight: Flight | None = None    # U.9: the fitted parabola of these points, when they are a flight (else None)

    @property
    def start(self) -> int: return self.points[0].pts_us

    @property
    def end(self) -> int: return self.points[-1].pts_us

    def weight(self) -> float:
        return weight(self.points)

    def predict(self, pts_us: int, aspect: float) -> tuple[float, float]:
        """Where the tracklet will be at pts_us: on its parabolic arc when it is in flight (U.9), else the straight-line
        extrapolation of its last two points. A smooth arc is nearly straight between 6 fps samples, so the parabola matters
        when frames are missed or the sample rate is low: there the tangent has drifted far from the arc, and a boot sitting
        near the tangent would win the association instead of the ball."""
        if self.flight is not None:
            return self.flight.predict(pts_us)
        a = self.points[-1]
        if len(self.points) < 2:
            return a.x, a.y
        b = self.points[-2]
        k = (pts_us - a.pts_us) / max(1, a.pts_us - b.pts_us)
        return a.x + (a.x - b.x) * k, a.y + (a.y - b.y) * k


def weight(points: list[Cand]) -> float:
    """What a run of detections earns as the ball: each its score above the floor (less at a player's feet), each continuation a bonus."""
    return sum(p.score - SCORE_FLOOR - (FEET_PENALTY if p.at_feet else 0.0) for p in points) + STEP_BONUS * (len(points) - 1)


def offset_spread(points: list[Cand]) -> float | None:
    """U.10: how far apart (picture widths) the foot offsets of a run of points lie: the farthest two offsets.
    None when fewer than two points carry an offset."""
    offs = [p.feet_off for p in points if p.feet_off is not None]
    if len(offs) < 2:
        return None
    return max(math.hypot(a[0] - b[0], a[1] - b[1]) for a in offs for b in offs)


def is_glued(points: list[Cand]) -> bool:
    """U.10: has this tracklet spent its life glued to one player's feet? Nearly all its points at feet, enough of
    them to judge, and their foot offsets (nearly) unchanging: a boot, rigidly attached to its player's foot. A
    rolling ball separates from the player, so its offsets drift; a ball that only sometimes passes a player's feet,
    or a tracklet too short to judge, is not glued - unknown beats wrong."""
    if len(points) < GLUE_MIN_POINTS:
        return False
    at_feet = [p for p in points if p.at_feet]
    if len(at_feet) < GLUE_MIN_FEET_SHARE * len(points):
        return False
    spread = offset_spread(points)
    return spread is not None and spread <= GLUE_MAX_SPREAD


@dataclass(frozen=True)
class BallPoint:
    pts_us: int
    state: str                 # DETECTED | INFERRED
    x: float
    y: float
    confidence: float


def dist(ax: float, ay: float, bx: float, by: float, aspect: float) -> float:
    """Picture widths between two normalised points (aspect = width / height)."""
    return math.hypot(ax - bx, (ay - by) / aspect)


def _cell(c: Cand) -> tuple[int, int]:
    return int(c.x / STATIC_CELL), int(c.y / STATIC_CELL)


def _dilate(cells: set) -> set:
    return {(i + di, j + dj) for i, j in cells for di in (-1, 0, 1) for dj in (-1, 0, 1)}


def static_cells(frames: dict[int, list[Cand]], shot_of: dict[int, int], step_us: float) -> tuple[set, set]:
    """Picture cells never the ball: (printed on the picture in every shot, {(shot, cell)} still within one shot). Detection jitter is
    absorbed by also covering each found cell's neighbours."""
    hits: dict[tuple[int, int], set[int]] = defaultdict(set)
    for pts, cands in frames.items():
        for c in cands:
            hits[_cell(c)].add(pts)
    shots = len(set(shot_of.values())) or 1
    need = max(STATIC_MIN_SHOTS, STATIC_SHOT_SHARE * shots)
    printed = {k for k, v in hits.items() if len(v) >= STATIC_MIN_FRAMES and len({shot_of.get(p, -1) for p in v}) >= need}
    still_frames = STILL_US / step_us
    per_shot: dict[tuple[int, tuple[int, int]], int] = defaultdict(int)
    for k, v in hits.items():
        for p in v:
            per_shot[(shot_of.get(p, -1), k)] += 1
    still = set()
    for (shot, (i, j)), n in per_shot.items():
        if n + sum(per_shot.get((shot, (i + di, j + dj)), 0) for di in (-1, 0, 1) for dj in (-1, 0, 1) if di or dj) >= still_frames:
            still.add((shot, (i, j)))
    return _dilate(printed), {(sh, c) for sh, k in still for c in _dilate({k})}


Pitch = tuple[list[list[float]], float, float]      # picture -> pitch metres (3x3, normalised picture coordinates), pitch length, width


def on_calibrated_pitch(pitch: Pitch, x: float, y: float) -> bool:
    """The picture point placed on the ground lies on the pitch, or within PITCH_MARGIN_M of its lines."""
    M, length, width = pitch
    w = M[2][0] * x + M[2][1] * y + M[2][2]
    if not w > 1e-9:                                   # above the horizon
        return False
    px, py = (M[0][0] * x + M[0][1] * y + M[0][2]) / w, (M[1][0] * x + M[1][1] * y + M[1][2]) / w
    return abs(px) <= length / 2 + PITCH_MARGIN_M and abs(py) <= width / 2 + PITCH_MARGIN_M


def _foot_offset(c: Cand, boxes: list[tuple[float, float, float, float]], aspect: float) -> tuple[float, float] | None:
    """U.10: the candidate's offset from the nearest player's foot centre (bottom centre of the box), in picture widths
    (dy scaled by 1/aspect, as in `dist`) - or None when the candidate is not at any player's feet (inside a box
    horizontally, within its height plus a little below it: the same test as `at_feet`). Only the nearest foot counts:
    a candidate between two players takes the closer foot, so a handover between players does not read as drift."""
    best: tuple[float, tuple[float, float]] | None = None
    for bx, by, bw, bh in boxes:
        if not (bx < c.x < bx + bw and by < c.y < by + bh * 1.05):
            continue
        off = (c.x - (bx + bw / 2), (c.y - (by + bh)) / aspect)
        d = math.hypot(*off)
        if best is None or d < best[0]:
            best = (d, off)
    return best[1] if best else None


def plausible(frames: dict[int, list[Cand]], persons: dict[int, list[tuple[float, float, float, float]]], shot_of: dict[int, int],
              width_px: int, height_px: int, step_us: float, pitch_at: Callable[[int], Pitch | None] | None = None) -> tuple[dict[int, list[Cand]], dict]:
    """Steps 1-2: drop candidates off the grass or off the calibrated pitch, printed and still spots, implausible sizes and candidates on a
    player's body; flag those at a player's feet. `persons` holds each frame's person boxes (x, y, w, h; normalised, top-left); `pitch_at`
    gives the frame's pitch calibration where there is one. Returns the kept candidates and how many each rule removed."""
    printed, still = static_cells(frames, shot_of, step_us)
    out, why = {}, {"off_pitch": 0, "off_calibrated_pitch": 0, "printed": 0, "still": 0, "size": 0, "on_body": 0, "duplicate": 0, "kept": 0, "at_feet": 0}
    cap_default = BALL_MAX_PX_720 * height_px / 720
    for pts, cands in frames.items():
        boxes = persons.get(pts, [])
        tallest = max((b[3] for b in boxes), default=0.0) * height_px
        pitch = pitch_at(pts) if pitch_at else None
        keep: list[Cand] = []
        for c in sorted(cands, key=lambda q: -q.score):                     # strongest first, so a duplicate defers to it
            if not c.on_pitch:
                why["off_pitch"] += 1
            elif pitch is not None and not on_calibrated_pitch(pitch, c.x, c.y):
                why["off_calibrated_pitch"] += 1
            elif _cell(c) in printed:
                why["printed"] += 1
            elif c.score < STILL_KEEP_SCORE and (shot_of.get(pts, -1), _cell(c)) in still:
                why["still"] += 1
            elif c.w_px > 0 and not _size_ok(c, boxes, tallest, height_px, cap_default):     # w_px 0: a heat-map peak, no box
                why["size"] += 1
            elif any(bx < c.x < bx + bw and by < c.y < by + BODY_SHARE * bh for bx, by, bw, bh in boxes):
                why["on_body"] += 1
            elif any(dist(c.x, c.y, k.x, k.y, width_px / height_px) < SAME_SPOT for k in keep):
                why["duplicate"] += 1
            else:
                off = _foot_offset(c, boxes, width_px / height_px)
                why["at_feet"] += off is not None
                keep.append(replace(c, at_feet=True, feet_off=off) if off is not None else c)
        why["kept"] += len(keep)
        out[pts] = keep
    return out, why


def _size_ok(c: Cand, boxes: list[tuple[float, float, float, float]], tallest_px: float, height_px: int, cap_default: float) -> bool:
    """The candidate's width against the people at its depth (feet level with it in the picture); with nobody there, against the tallest
    person (an upper bound), or a fixed bound when nobody is seen."""
    near = sorted(b[3] * height_px for b in boxes if abs(b[1] + b[3] - c.y) <= DEPTH_BAND)
    if near:
        h = near[len(near) // 2]
        return BALL_MIN_OF_PERSON * h <= c.w_px <= BALL_MAX_OF_PERSON * h
    return c.w_px <= (BALL_MAX_OF_PERSON * tallest_px if tallest_px else cap_default)


def tracklets(frames: dict[int, list[Cand]], shot_of: dict[int, int], step_us: float, aspect: float,
              use_flight: bool = False) -> list[Tracklet]:
    """Step 3: greedy constant-velocity linking inside each shot; every candidate belongs to exactly one tracklet.
    `use_flight` (U.9, off by default): a tracklet that is in flight predicts from its parabola (see Tracklet.predict),
    refitted as it grows; a tracklet whose points stop fitting a flight (a kick, a bounce, a roll) falls back to the
    straight line on its own - the fit fails its own checks, so nothing is forced."""
    done: list[Tracklet] = []
    live: list[Tracklet] = []
    for pts in sorted(frames):
        shot = shot_of.get(pts, -1)
        keep = []
        for t in live:
            if t.shot != shot or pts - t.end > (TRACK_MAX_MISS + 1) * step_us + 1:
                done.append(t)
            else:
                keep.append(t)
        live = keep
        pairs = []
        for ci, c in enumerate(frames[pts]):
            for ti, t in enumerate(live):
                px, py = t.predict(pts, aspect)
                d = dist(c.x, c.y, px, py, aspect)
                if d <= (TRACK_SPEED if len(t.points) < 2 else TRACK_ACCEL) * (pts - t.end) / 1e6 + TRACK_SLACK:
                    pairs.append((d, ci, ti))
        used_c, used_t = set(), set()
        for d, ci, ti in sorted(pairs):
            if ci in used_c or ti in used_t:
                continue
            used_c.add(ci); used_t.add(ti)
            live[ti].points.append(frames[pts][ci])
            if use_flight:
                live[ti].flight = flight_of(live[ti].points, aspect)
        for ci, c in enumerate(frames[pts]):
            if ci not in used_c:
                live.append(Tracklet(shot, [c]))
    return done + live


def best_paths(tracks: list[Tracklet], step_us: float, aspect: float, use_flight: bool = False,
               use_handover: bool = False) -> list[tuple[Tracklet, bool]]:
    """Step 4: per shot, the chain of tracklets with the highest total. Returns the chosen tracklets in time order, each with whether it
    continues the previous one physically (True) or starts after a restart (False).
    `use_flight` (U.9, off by default): a piece that is itself a flight earns FLIGHT_BONUS (a gravity-consistent arc is ball
    evidence - boots and players do not fly), and a join out of a flight piece is a physical continuation only when the new
    piece's first point lies on that flight's parabola; anything else (a kick, a bounce, a boot at the landing spot) is a
    restart, so no INFERRED positions are invented across it.
    `use_handover` (U.10, off by default): a roll piece that starts where a flight landed carries the ball across the bounce -
    a handover, not a restart, earning HANDOVER_BONUS; and a piece from a tracklet glued to one player's feet for its whole
    life pays GLUE_PENALTY, so a boot that out-scores the ball for the whole shot and stays glued to it cannot win the path
    search on detector score alone. The handover uses the flight fit (built when either flag is on); the flight bonus itself
    stays gated on `use_flight`."""
    pieces: list[Tracklet] = []
    parents: dict[int, Tracklet] = {}       # U.10: the tracklet each piece was cut from (the glue verdict is on the
    last_piece: dict[int, bool] = {}       # whole tracklet, not the piece); and whether the piece is its tracklet's
    for t in tracks:                        # last - only a flight's last piece can hand over to a roll at the bounce
        for k in range(0, len(t.points), PIECE_FRAMES):
            p = Tracklet(t.shot, t.points[k:k + PIECE_FRAMES])
            pieces.append(p)
            parents[id(p)] = t
            last_piece[id(p)] = k + PIECE_FRAMES >= len(t.points)
    flights = {id(p): flight_of(p.points, aspect) for p in pieces} if (use_flight or use_handover) else {}
    glued = {id(p): is_glued(parents[id(p)].points) for p in pieces} if use_handover else {}
    useful = [t for t in pieces if (len(t.points) > 1 or t.points[0].score >= SINGLE_MIN_SCORE)
              and not (all(q.at_feet for q in t.points) and sum(q.score for q in t.points) / len(t.points) < FEET_MIN_MEAN)]
    by_shot: dict[int, list[Tracklet]] = defaultdict(list)
    for t in useful:
        by_shot[t.shot].append(t)
    chosen: list[tuple[Tracklet, bool]] = []
    for shot, ts in by_shot.items():
        ts.sort(key=lambda t: (t.start, t.end))
        best = [0.0] * len(ts)
        back: list[tuple[int, bool, int] | None] = [None] * len(ts)              # (previous tracklet, physically linked, first point used here)
        for i, t in enumerate(ts):
            w = t.weight() + (FLIGHT_BONUS if use_flight and flights.get(id(t)) is not None else 0.0) \
                - (GLUE_PENALTY if glued.get(id(t)) else 0.0)
            best[i], back[i] = w, None
            for j in range(i):
                s = ts[j]
                if s.end >= t.end:
                    continue
                cut = 0
                if s.end >= t.start:                                             # overlapping: hand over after s ends
                    while t.points[cut].pts_us <= s.end:
                        cut += 1
                part = t.points[cut:]
                a, b = part[0], s.points[-1]
                gap = a.pts_us - s.end
                wp = w if cut == 0 else weight(part) + (FLIGHT_BONUS if use_flight and flight_of(part, aspect) is not None else 0.0) \
                    - (GLUE_PENALTY if glued.get(id(t)) else 0.0)
                continues_flight = True
                if use_flight:
                    f = flights.get(id(s))
                    if f is not None and deviation(f, a.pts_us, a.x, a.y, aspect) > FLIGHT_LINK_TOL:
                        continues_flight = False   # the new piece is not on the old flight's arc: a kick, a bounce, or
                                                   # another object - a restart, never the same flight
                handover = False
                if use_handover and last_piece.get(id(s)) and flights.get(id(s)) is not None \
                        and is_roll(part, aspect) and gap <= JUMP_MAX_US \
                        and dist(a.x, a.y, b.x, b.y, aspect) <= JUMP_SPEED * gap / 1e6 + JUMP_SLACK:
                    handover = True   # the new piece rolls away from where the last piece of the flight landed: the same
                                      # ball across the bounce, not a restart - and not a boot at the landing spot (that
                                      # piece pays the glue penalty instead, so the two do not both collect the bonus)
                missed = max(0, round(gap / step_us) - 1)
                if handover:
                    v, linked = best[j] + wp + HANDOVER_BONUS - GAP_COST * missed + (STEP_BONUS if missed == 0 else 0.0), True
                elif continues_flight and gap <= JUMP_MAX_US and dist(a.x, a.y, b.x, b.y, aspect) <= JUMP_SPEED * gap / 1e6 + JUMP_SLACK:
                    v, linked = best[j] + wp - GAP_COST * missed + (STEP_BONUS if missed == 0 else 0.0), True
                else:
                    v, linked = best[j] + wp - RESTART_COST, False
                if v > best[i]:
                    best[i], back[i] = v, (j, linked, cut)
        if not ts:
            continue
        i = max(range(len(ts)), key=lambda k: best[k])
        if best[i] <= 0:
            continue
        path: list[tuple[Tracklet, bool]] = []
        while True:
            prev = back[i]
            t = ts[i] if not prev or prev[2] == 0 else Tracklet(ts[i].shot, ts[i].points[prev[2]:])
            path.append((t, prev[1] if prev else False))
            if prev is None:
                break
            i = prev[0]
        chosen.extend(reversed(path))
    chosen.sort(key=lambda p: p[0].start)
    return chosen


def follow_ball(frames: dict[int, list[Cand]], shot_of: dict[int, int], step_us: float, aspect: float,
                use_flight: bool = False, use_handover: bool = False) -> list[BallPoint]:
    """Steps 3-5 on already plausible candidates: the ball's DETECTED and INFERRED positions; frames not returned are UNKNOWN.
    `use_flight` (U.9, off by default): parabolic flight prediction in the tracklets and flight-continuity joins plus a flight
    bonus in the path search (see `best_paths`); without it, behaviour is exactly as before.
    `use_handover` (U.10, off by default): bounce/rolling handover in the path search - a roll piece that starts where a
    flight landed carries the ball across the bounce (HANDOVER_BONUS, linked), and a piece from a tracklet glued to one
    player's feet for its whole life pays GLUE_PENALTY; without it, behaviour is exactly as before."""
    out: list[BallPoint] = []
    prev: tuple[Cand, float] | None = None
    for t, linked in best_paths(tracklets(frames, shot_of, step_us, aspect, use_flight), step_us, aspect, use_flight,
                               use_handover=use_handover):
        w = t.weight()
        conf = w / (w + 3.0) if len(t.points) > 1 else min(0.5, t.points[0].score)     # more consistent evidence, closer to 1
        pts = t.points
        if prev is not None and linked:
            pts = [prev[0], *pts]
        for k, c in enumerate(pts):
            if k > 0:
                a = pts[k - 1]
                gap = c.pts_us - a.pts_us
                if gap <= INFER_MAX_GAP_US:
                    n = round(gap / step_us)
                    for m in range(1, n):
                        f = m / n                  # on the analysis frame grid (pts = round(k * step))
                        out.append(BallPoint(int(round(round((a.pts_us + gap * f) / step_us) * step_us)), "INFERRED", a.x + (c.x - a.x) * f, a.y + (c.y - a.y) * f, round(min(conf, 0.5), 3)))
            if not (k == 0 and prev is not None and linked):
                out.append(BallPoint(c.pts_us, "DETECTED", c.x, c.y, round(conf, 3)))
        prev = (t.points[-1], conf)
    out.sort(key=lambda p: p.pts_us)
    return out


def merge_marks(points: list[BallPoint], marks: list[dict], step_us: float) -> list[BallPoint]:
    """A person's mark is the truth at its moment: a visible mark replaces the engine's answer (state MARKED), a 'not visible' mark removes it."""
    tol = step_us / 2
    by = {p.pts_us: p for p in points}
    for m in marks:
        for k in [k for k in by if abs(k - m["pts_us"]) < tol]:
            del by[k]
        if m["visible"]:
            by[int(m["pts_us"])] = BallPoint(int(m["pts_us"]), "MARKED", float(m["x"]), float(m["y"]), 1.0)
    return sorted(by.values(), key=lambda p: p.pts_us)


def evaluate(points: list[BallPoint], marks: list[dict], step_us: float, width_px: int, height_px: int, tol_px: float = 12.0) -> dict:   # tol_px = BALL_RIGHT_PX in the contract
    """The engine's answer against a person's marks, frame by frame: right place, wrong place, said unknown; and on 'not visible' marks,
    whether the engine invented a ball."""
    tol = step_us / 2
    pts = sorted(points, key=lambda p: p.pts_us)
    times = [p.pts_us for p in pts]
    import bisect
    r = {"marked_visible": 0, "right": 0, "wrong": 0, "unknown": 0, "marked_hidden": 0, "invented": 0, "errors_px": []}
    for m in marks:
        i = bisect.bisect_left(times, m["pts_us"] - tol)
        p = pts[i] if i < len(pts) and abs(times[i] - m["pts_us"]) < tol else None
        if m["visible"]:
            r["marked_visible"] += 1
            if p is None:
                r["unknown"] += 1
            else:
                e = math.hypot((p.x - m["x"]) * width_px, (p.y - m["y"]) * height_px)
                r["errors_px"].append(round(e, 1))
                r["right" if e <= tol_px else "wrong"] += 1
        else:
            r["marked_hidden"] += 1
            r["invented"] += p is not None
    said = r["right"] + r["wrong"]
    r["precision"] = round(r["right"] / said, 3) if said else None              # when the engine says where the ball is, how often it is right
    r["recall"] = round(r["right"] / r["marked_visible"], 3) if r["marked_visible"] else None
    return r
