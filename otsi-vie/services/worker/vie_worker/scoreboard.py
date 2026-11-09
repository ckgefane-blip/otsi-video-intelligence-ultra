"""Goals from the broadcast scoreboard (ADR-049): the score the broadcaster prints on screen, read with the free text readers we already
use (PaddleOCR det/rec on OpenVINO, ADR-033/039). No person clicking, no extra model; a goal is INFERRED from the score changing, never
from the picture of the ball in the net.

  LOCATE   LOCATE_FRAMES frames spread over the video; the top and bottom quarter of each is read in full. The match clock (m:ss / mm:ss,
           read confidently) anchors the score graphic; the score is the 1-2 digit texts on the clock's row, within CLOCK_REACH clock
           heights of it. Positions that recur in at least LOCATE_SHARE of the frames with a clock are the score boxes (two boxes, one per
           team, or one box "1-0"). No clock or no recurring score box: the video has no readable scoreboard, and no goal is claimed.
  READ     every READ_STEP_S seconds, only the score boxes are read (digits, confidence >= READ_CONF). A frame without the graphic (replays,
           close-ups) reads nothing.
  SCORE    a score is settled once read at least SETTLE_READS times within SETTLE_WINDOW_US and more often than any other score there;
           single misreads never settle.
  GOAL     two settled scores in a row where one side went up by exactly one and the other stayed: a goal for that side, scored between
           the last read of the old score and the first read of the new one (the broadcaster updates the graphic after the goal, often
           after the replays). Any other change (down, both sides, +2) is a misread or a correction: no goal is claimed.
The side is the score's position (left = first team printed); which club that is comes from the match record, not from here.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

import numpy as np

CLOCK = re.compile(r"^\d{1,3}[:.]\d{2}$")
ONE = re.compile(r"^\d{1,2}$")
PAIR = re.compile(r"^(\d{1,2})\s*[-:–]\s*(\d{1,2})$")
LOCATE_FRAMES = 40
CLOCK_CONF = 0.9
CLOCK_REACH = 12.0             # clock heights: how far from the clock the score may be printed
ROW_TOL = 0.6                  # clock heights between the clock's and a score digit's centre lines
LOCATE_SHARE = 0.3
BOX_SNAP = 8                   # px: digit boxes this close across frames are one position
READ_STEP_S = 5.0
READ_CONF = 0.7
SETTLE_READS = 3
SETTLE_WINDOW_US = 90_000_000


@dataclass
class Box:
    x0: int
    y0: int
    x1: int
    y1: int


@dataclass
class Goal:
    side: int                  # 0: the first team printed (left), 1: the second
    after_us: int              # last read of the old score
    before_us: int             # first read of the new score
    score: tuple[int, int]     # the score after the goal


def _digits(s: str) -> str:
    return s.replace(" ", "").replace("O", "0").replace("o", "0").replace("О", "0").replace("о", "0")


def score_boxes(frames_lines: list[list]) -> list[Box]:
    """The score positions from the full readings (lists of vie_worker.lineup.Line) of the LOCATE frames; [] when there is no scoreboard."""
    seen: Counter = Counter()
    boxes: dict[tuple[int, int], list] = {}
    with_clock = 0
    for lines in frames_lines:
        clocks = [ln for ln in lines if CLOCK.match(_digits(ln.text)) and ln.conf >= CLOCK_CONF and ln.h > 0]
        if not clocks:
            continue
        with_clock += 1
        here = set()
        for ck in clocks:
            for ln in lines:
                t = _digits(ln.text)
                if ln is ck or not (ONE.match(t) or PAIR.match(t)):
                    continue
                if abs(ln.cy - ck.cy) > ROW_TOL * ck.h or min(abs(ln.x1 - ck.x0), abs(ln.x0 - ck.x1)) > CLOCK_REACH * ck.h:
                    continue
                key = (round(ln.x0 / BOX_SNAP), round(ln.cy / BOX_SNAP))
                here.add(key)
                boxes.setdefault(key, []).append(ln)
        seen.update(here)
    if not with_clock:
        return []
    keep = [k for k, n in seen.items() if n >= LOCATE_SHARE * with_clock]
    out = []
    for k in sorted(keep, key=lambda k: k[0]):
        ls = boxes[k]
        out.append(Box(int(np.median([l.x0 for l in ls])), int(np.median([l.y0 for l in ls])), int(np.median([l.x1 for l in ls])),
                       int(np.median([l.y1 for l in ls]))))
    # neighbouring snaps of one printed digit: keep the one seen most
    merged: list[Box] = []
    for b in out:
        if merged and b.x0 < merged[-1].x1 and b.y0 < merged[-1].y1 and merged[-1].y0 < b.y1:
            continue
        merged.append(b)
    return merged if len(merged) in (1, 2) else []


def crops(rgb: np.ndarray, boxes: list[Box]) -> list[np.ndarray]:
    """Each score box, grown a little (the detector's box is tight; the digit must not be cut)."""
    h, w = rgb.shape[:2]
    out = []
    for b in boxes:
        py, px = max(2, (b.y1 - b.y0) // 6), max(2, (b.y1 - b.y0) // 6)
        out.append(rgb[max(0, b.y0 - py):min(h, b.y1 + py), max(0, b.x0 - px):min(w, b.x1 + px)])
    return out


def parse(reads: list[tuple[str, float]]) -> tuple[int, int] | None:
    """The score from the readings of the score boxes, or None when any box did not read cleanly."""
    if any(c < READ_CONF for _, c in reads):
        return None
    t = [_digits(s.strip()) for s, _ in reads]
    if len(t) == 2 and all(ONE.match(x) for x in t):                    # one box per team
        return int(t[0]), int(t[1])
    if len(t) == 1:
        # one box over both numbers: "1-0", "1 0" or "10" (two single digits printed apart; a separator the reader turned into a letter)
        groups = re.findall(r"\d+", t[0])
        if len(groups) == 2 and all(len(g) <= 2 for g in groups):
            return int(groups[0]), int(groups[1])
        if len(groups) == 1 and len(groups[0]) == 2:
            return int(groups[0][0]), int(groups[0][1])
    return None


def settled(reads: list[tuple[int, tuple[int, int]]]) -> list[tuple[int, int, tuple[int, int]]]:
    """(first, last, score) runs of settled scores, in time order, from (pts_us, score) reads."""
    reads = sorted(reads)
    ok: list[tuple[int, tuple[int, int]]] = []
    for i, (t, s) in enumerate(reads):
        near = Counter(s2 for t2, s2 in reads if abs(t2 - t) <= SETTLE_WINDOW_US / 2)
        top = near.most_common(2)
        if near[s] >= SETTLE_READS and top[0][0] == s and (len(top) == 1 or top[1][1] < near[s]):
            ok.append((t, s))
    runs: list[list] = []
    for t, s in ok:
        if runs and runs[-1][2] == s:
            runs[-1][1] = t
        else:
            runs.append([t, t, s])
    return [(a, b, s) for a, b, s in runs]


def goals(reads: list[tuple[int, tuple[int, int]]]) -> list[Goal]:
    out = []
    runs = settled(reads)
    for (_, last, old), (first, _, new) in zip(runs, runs[1:]):
        d = (new[0] - old[0], new[1] - old[1])
        if d in ((1, 0), (0, 1)):
            out.append(Goal(0 if d == (1, 0) else 1, last, first, new))
    return out


# ---------------------------------------------------------------------------------------------------------------- reading a video
READER_VERSION = "scoreboard-1"


def read_video(path: str, duration_us: int, progress=None) -> dict:
    """LOCATE then READ (see above) over one video: {"version", "boxes", "reads": [[pts_us, a, b], ...]}. Cached by the caller."""
    from . import ff
    from .lineup import Line, PageReader
    from .ocr import JerseyReader
    pr = PageReader()
    found = []
    for k in range(LOCATE_FRAMES):
        t = int(duration_us * (k + 0.5) / LOCATE_FRAMES)
        f = next(ff.decode_sampled(path, 1.0, start_us=t, end_us=t + 900_000, seek=True), None)
        if f is None:
            continue
        h, q = f.rgb.shape[0], f.rgb.shape[0] // 4
        found.append(pr.read(f.rgb[:q]) + [Line(l.text, l.conf, l.x0, l.y0 + h - q, l.x1, l.y1 + h - q) for l in pr.read(f.rgb[h - q:])])
        if progress:
            progress(0.2 * (k + 1) / LOCATE_FRAMES)
    boxes = score_boxes(found)
    reads: list[list[int]] = []
    if boxes:
        jr = JerseyReader()
        for f in ff.decode_sampled(path, 1.0 / READ_STEP_S):
            s = parse(jr._read_lines(crops(f.rgb, boxes)))
            if s:
                reads.append([f.pts_us, s[0], s[1]])
            if progress and duration_us:
                progress(0.2 + 0.8 * min(1.0, f.pts_us / duration_us))
    return {"version": READER_VERSION, "boxes": [[b.x0, b.y0, b.x1, b.y1] for b in boxes], "reads": reads}


# ---------------------------------------------------------------------------------------------------------------- where the goal was
PLAY_POINTS = 4                # ball points seen in a camera shot for it to be live play (not a close-up, the bench or the crowd)
GOAL_LEAD_US = 15_000_000      # the attack before the end of the goal's shot
GOAL_TAIL_US = 4_000_000       # and the first seconds of the celebration after it
SCORER_US = 10_000_000         # the last holder this close to the end of the goal's shot is the possible scorer
SET_PIECE_US = 20_000_000      # a set piece this close before the goal: the goal came from it


def place(goal: Goal, shot_starts: list[int], points: list, events: list, end_us: int):
    """The goal as an INFERRED GOAL event (vie_worker.possession.Event) or None: the last camera shot of live play (ball seen) that began
    before the score changed; the clip is the attack (GOAL_LEAD_US) up to the end of that shot and the first seconds after it. The possible
    scorer is the last holder in that shot; a set piece just before it is recorded (a free-kick goal)."""
    import bisect
    from .possession import Event
    bounds = shot_starts + [end_us]
    k = max(0, bisect.bisect_right(shot_starts, goal.after_us) - 1)
    while k >= 0:
        a, b = bounds[k], bounds[k + 1]
        seen = sum(1 for p in points if a <= p.pts_us < b and p.state == "DETECTED")
        if seen >= PLAY_POINTS:
            break
        k -= 1
    if k < 0:
        return None
    a, b = bounds[k], min(bounds[k + 1], goal.before_us)
    held = [e for e in events if e.kind == "POSSESSION" and a <= e.end <= b and b - e.end <= SCORER_US and e.track_id]
    last = max(held, key=lambda e: e.end) if held else None
    sp = [e for e in events if e.kind == "SET_PIECE" and b - SET_PIECE_US <= e.end <= b and e.features.get("kind") not in ("KICK_OFF", "GOAL_KICK")]
    sp_last = max(sp, key=lambda e: e.end) if sp else None
    return Event("GOAL", max(a, b - GOAL_LEAD_US), min(end_us, b + GOAL_TAIL_US), last.track_id if last else None, None,
                 last.kit_group if last else None, "INFERRED", 0.9,
                 {"from": "scoreboard", "side": goal.side, "score": list(goal.score), "changed_after_us": goal.after_us, "changed_by_us": goal.before_us,
                  "set_piece": (sp_last.features.get("kind") or "SET_PIECE") if sp_last else None,
                  "set_piece_taker": sp_last.track_id if sp_last else None})
