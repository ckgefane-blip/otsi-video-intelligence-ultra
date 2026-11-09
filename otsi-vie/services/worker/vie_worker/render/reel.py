"""RENDER (Block 11, ADR-032): a reel's clips -> one validated video with the cinematic spotlight on the reel's CONFIRMED player.

  1  check     the reel's targets must still be the current CONFIRMED decisions (a correction makes the reel stale: refuse)
  2  path      per clip, the player's position: the analysis observations of the target tracks (DETECTED anchors) plus a dense
               re-analysis of ONLY the clip window at DENSE_FPS (ADR-028: 2-fps interpolation is not good enough for a spotlight); a dense
               track joins the path only where it overlaps the anchors. Between two path points at most MAX_INTERP_S apart the box is
               interpolated (and counted as INTERPOLATED); anything further is MISSING — no spotlight is drawn where the player was not seen
  3  frames    every source frame of every clip, in order, decoded by the LGPL FFmpeg; spotlight = darken outside a soft ellipse around the
               player + optional ring at the feet + optional name caption, faded in/out at the edges of visibility; aspect crop (9:16, 1:1)
               follows the player smoothly
  4  encode    vie_worker.render.encoders (Intel hardware H.264 preferred), audio of the same clip windows (AAC in MP4, Opus in WebM)
  5  validate  vie_worker.render.validate: codec, size, exact frame count, duration, faststart, full decode — or the render fails
  6  record    REEL asset, MANIFEST asset (every clip's spotlight coverage, the pinned decisions, encoder and FFmpeg build), manifest
               version, render job SUCCEEDED with the measured result

The output is development / testing output: commercial distribution and paid export are not activated (owner decisions E1-E3).
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import time
import uuid
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

import numpy as np

from .. import ff
from ..db import audit, publish, tx
from ..detect.base import load_detector
from ..detect.pitch import classify, grass_mask
from ..frames import CutDetector
from ..jobs import Job, JobError, JobRunner
from ..storage import LocalStore
from ..tracker import Tracker
from . import encoders as enc
from . import look as lk
from . import transitions as trn
from .overlays import CARD_S, END_S, Overlays
from .text import draw_text, text_size
from .validate import validate

SERVICE = "render-worker"
DENSE_FPS = 10.0
MAX_INTERP_S = 0.6
FADE_S = 0.25
MATCH_TOL_US = 70_000
ON_PATH = 0.6                  # a dense point between two confirmed positions must lie within this many body heights of the straight line between them
RUN_SPEED = 3.0                # body heights per second a player can cover (a sprint is ~4.5): bound for points before / after the confirmed ones
MAX_OUTPUT_HEIGHT = 1080
INSERT_MAX_S = 30.0            # ADR-050: at most this much of an intro / outro video is played
INSERT_PAD = "0x06111f"        # the colour around an intro / outro of another shape (the reel's navy)


@dataclass
class PathPoint:
    pts_us: int
    box: tuple[float, float, float, float]       # x, y, w, h normalised to the source frame
    source: str                                   # "analysis" (the confirmed track's own detection) or "dense" (re-analysis)


def _iou(a, b) -> float:
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    u = a[2] * a[3] + b[2] * b[3] - inter
    return inter / u if u > 0 else 0.0


def lock_rules(lock: float, auto_track: bool = True) -> tuple[float, float]:
    """(longest gap bridged in seconds, on-path tolerance in body heights) for Target Lock Sensitivity 0..1 (ADR-044): 0.5 gives the ADR-032
    rules (0.6 s, 0.6). Without Auto Track the path is the analysis's own positions, so gaps between them (about 0.5 s) are always bridged."""
    lock = float(min(1.0, max(0.0, lock)))
    gap = round(0.3 + 0.6 * lock, 3)
    return (gap if auto_track else max(gap, 0.6)), round(0.4 + 0.4 * lock, 3)


def target_path(src: str, in_us: int, out_us: int, anchors: list[PathPoint], det, max_width: int = 1920, max_interp_s: float = MAX_INTERP_S,
                on_path_bh: float = ON_PATH, tick=None) -> tuple[list[PathPoint], dict]:
    """Dense re-analysis of one clip window, joined to the confirmed anchors. Returns the path and how it was built. `tick()` is called
    between batches (the render checks it was not cancelled)."""
    tracker, cuts = Tracker(distance_weight=0.3), CutDetector()        # as the analysis matches: overlap blended with distance (sparse, small players)
    batch = []

    def flush():
        found = det.detect([f.rgb for f in batch])
        for f, ds in zip(batch, found):
            if cuts.is_cut(f.rgb):
                tracker.end_all()
            on = classify(ds, grass_mask(f.rgb), touchline=True)
            tracker.update(f.frame_index, f.pts_us, [d for d, ok in zip(ds, on) if ok])
        batch.clear()

    for f in ff.decode_sampled(src, DENSE_FPS, max_width=max_width, start_us=in_us, end_us=out_us, seek=True):
        batch.append(f)
        if len(batch) >= 8:
            if tick:
                tick()
            flush()
    if batch:
        flush()
    dense = [t for t in tracker.results() if t.label == "PERSON"]
    votes: dict[int, list[int]] = {}
    for a in anchors:
        best = None
        for t in dense:
            for o in t.observations:
                if abs(o.pts_us - a.pts_us) <= MATCH_TOL_US:
                    v = _iou((o.x, o.y, o.w, o.h), a.box)
                    if v >= 0.3 and (best is None or v > best[0]):
                        best = (v, t.number)
        if best:
            votes.setdefault(best[1], []).append(a.pts_us)
    points = list(anchors)
    used = []
    for t in dense:
        vs = votes.get(t.number)
        if not vs:
            continue
        lo, hi = min(vs) - 500_000, max(vs) + 500_000          # a dense track counts only near the anchors that confirmed it
        near = [PathPoint(o.pts_us, (o.x, o.y, o.w, o.h), "dense") for o in t.observations if lo <= o.pts_us <= hi]
        pts = [p for p in near if on_path(p, anchors, max_interp_s, on_path_bh)]
        points += pts
        used.append({"dense_track": t.number, "anchor_votes": len(vs), "points": len(pts), "off_path_rejected": len(near) - len(pts)})
    # one position per instant: prefer the analysis anchor, then the dense track with most votes
    points.sort(key=lambda p: (p.pts_us, p.source != "analysis"))
    merged: list[PathPoint] = []
    for p in points:
        if merged and abs(p.pts_us - merged[-1].pts_us) < 20_000:
            continue
        merged.append(p)
    return merged, {"dense_tracks": len(dense), "dense_tracks_joined": used, "anchors": len(anchors)}


def on_path(p: PathPoint, anchors: list[PathPoint], max_interp_s: float = MAX_INTERP_S, tol_bh: float = ON_PATH) -> bool:
    """Is a point of the dense re-analysis where the confirmed player can be? Between two confirmed positions at most MAX_INTERP_S apart: within
    ON_PATH body heights of the straight line between them. Elsewhere: no further from the nearest confirmed position than RUN_SPEED body heights
    per second (plus half a body). A dense track that slid onto a neighbour fails this, and the spotlight stays on the player (the gap is
    interpolated or left without a spotlight) instead of jumping to the other man (2026-10-31)."""
    if not anchors:
        return False
    c = (p.box[0] + p.box[2] / 2, p.box[1] + p.box[3] / 2)
    before = max((a for a in anchors if a.pts_us <= p.pts_us), key=lambda a: a.pts_us, default=None)
    after = min((a for a in anchors if a.pts_us >= p.pts_us), key=lambda a: a.pts_us, default=None)
    if before and after and after.pts_us - before.pts_us <= max_interp_s * 1e6:
        f = 0.0 if after.pts_us == before.pts_us else (p.pts_us - before.pts_us) / (after.pts_us - before.pts_us)
        b = tuple(x + (y - x) * f for x, y in zip(before.box, after.box))
        return float(np.hypot(c[0] - (b[0] + b[2] / 2), c[1] - (b[1] + b[3] / 2))) <= tol_bh * b[3]
    a = min((x for x in (before, after) if x), key=lambda x: abs(x.pts_us - p.pts_us))
    reach = (RUN_SPEED * abs(p.pts_us - a.pts_us) / 1e6 + 0.5) * a.box[3]
    return float(np.hypot(c[0] - (a.box[0] + a.box[2] / 2), c[1] - (a.box[1] + a.box[3] / 2))) <= reach


def visible_runs(path: list[PathPoint], frame_us: float, max_interp_s: float = MAX_INTERP_S) -> list[tuple[float, float]]:
    """Stretches where the player has a box (points at most max_interp_s apart), as (start, end) in microseconds."""
    runs: list[list[float]] = []
    for p in path:
        if runs and p.pts_us - runs[-1][1] <= max_interp_s * 1e6:
            runs[-1][1] = p.pts_us
        else:
            runs.append([p.pts_us, p.pts_us])
    return [(a - frame_us / 2, b + frame_us / 2) for a, b in runs]


# 2026-11-07 (ADR-079): the beam steady and on the player. The raw path is the detector's box on each sampled frame: its edges move with
# every arm and leg, and straight lines between samples kink at each one, so the beam shook; a trailing average then made it lag a running
# player. Instead the path is smoothed in time on both sides (a local straight-line fit, so a running player is not cut short) and
# resampled every 40 ms; the beam then follows it without a trailing filter. The editor's live preview uses the same rule (spotlight.ts).
SMOOTH_POS_S, SMOOTH_SIZE_S, SMOOTH_STEP_US = 0.15, 0.6, 40_000


def _local(ts: list[float], vs: list[float], t: float, sigma: float, linear: bool) -> float:
    """Gaussian-weighted local fit of vs(ts) at t (a straight line when linear, else the weighted mean). sigma widens to the nearest sample."""
    lo, hi = 0, len(ts)
    while lo < hi:
        mid = (lo + hi) // 2
        if ts[mid] < t:
            lo = mid + 1
        else:
            hi = mid
    near = min(abs(ts[i] - t) for i in (lo - 1, lo) if 0 <= i < len(ts))
    s = max(sigma, near)
    sw = swt = swv = 0.0
    rows = []
    i = lo - 1
    while i >= 0 and t - ts[i] <= 3 * s:
        i -= 1
    i += 1
    while i < len(ts) and ts[i] - t <= 3 * s:
        w = float(np.exp(-0.5 * ((ts[i] - t) / s) ** 2))
        rows.append((w, ts[i], vs[i]))
        sw += w
        swt += w * ts[i]
        swv += w * vs[i]
        i += 1
    if sw <= 1e-12:
        return vs[min(range(len(ts)), key=lambda k: abs(ts[k] - t))]
    tm, vm = swt / sw, swv / sw
    if not linear:
        return vm
    den = sum(w * (x - tm) ** 2 for w, x, _ in rows)
    slope = sum(w * (x - tm) * (v - vm) for w, x, v in rows) / den if den > 1e-12 else 0.0
    return vm + slope * (t - tm)


def smooth_path(path: list[PathPoint], max_interp_s: float = MAX_INTERP_S) -> list[PathPoint]:
    """The player's path, steadied: per run of points (at most max_interp_s apart, broken at a jump of a camera cut), the centre and the feet
    from a local straight-line fit over SMOOTH_POS_S, the box size from a mean over SMOOTH_SIZE_S, every SMOOTH_STEP_US from the run's first to
    its last point. Nothing is added outside the runs: where the player was not seen, the beam stays off."""
    runs: list[list[PathPoint]] = []
    for p in sorted(path, key=lambda q: q.pts_us):
        if runs:
            a = runs[-1][-1]
            cut = abs((p.box[0] + p.box[2] / 2) - (a.box[0] + a.box[2] / 2)) > 4 * max(p.box[2], a.box[2]) or \
                abs((p.box[1] + p.box[3]) - (a.box[1] + a.box[3])) > 1.5 * max(p.box[3], a.box[3])
            if p.pts_us - a.pts_us <= max_interp_s * 1e6 and not cut:
                runs[-1].append(p)
                continue
        runs.append([p])
    out: list[PathPoint] = []
    for run in runs:
        ts = [p.pts_us / 1e6 for p in run]
        cx = [p.box[0] + p.box[2] / 2 for p in run]
        fy = [p.box[1] + p.box[3] for p in run]
        bw = [p.box[2] for p in run]
        bh = [p.box[3] for p in run]
        t, end = run[0].pts_us, run[-1].pts_us
        while True:
            tt = min(t, end)
            s = tt / 1e6
            x, y = _local(ts, cx, s, SMOOTH_POS_S, True), _local(ts, fy, s, SMOOTH_POS_S, True)
            w, h = _local(ts, bw, s, SMOOTH_SIZE_S, False), _local(ts, bh, s, SMOOTH_SIZE_S, False)
            out.append(PathPoint(int(tt), (x - w / 2, y - h, w, h), "smoothed"))
            if tt >= end:
                break
            t += SMOOTH_STEP_US
    return out


RAMP_HALF_US, RAMP_STEPS = 1_000_000, 8


def retime_segments(clip: dict) -> list[tuple[float, float, float, float]]:
    """E2 (ADR-065), the same rules as packages/contracts/src/retime.ts: the clip as stretches (a, b, speed, hold_us) of source time.
    NONE plays a..b at 1; SLOW at its speed; FREEZE holds the picture at the key moment; RAMP eases down to its speed there and back up.
    A FREEZE / RAMP whose key moment a trim left outside the clip does nothing."""
    a, b = float(clip["in_pts_us"]), float(clip["out_pts_us"])
    e = clip.get("effect") or {}
    kind, at = e.get("kind", "NONE"), e.get("at_us")
    speed = float(e.get("speed", 1) or 1)
    if kind == "SLOW" and 0.25 <= speed < 1:
        return [(a, b, speed, 0.0)]
    if kind not in ("FREEZE", "RAMP") or at is None or not (a < float(at) < b):
        return [(a, b, 1.0, 0.0)]
    t = float(at)
    if kind == "FREEZE":
        return [(a, t, 1.0, 0.0), (t, t, 1.0, float(e.get("hold_ms", 0)) * 1000), (t, b, 1.0, 0.0)]
    lo, hi, step = max(a, t - RAMP_HALF_US), min(b, t + RAMP_HALF_US), 2 * RAMP_HALF_US / RAMP_STEPS
    out = [(a, lo, 1.0, 0.0)] if lo > a else []
    for k in range(RAMP_STEPS):
        x0, x1 = max(lo, t - RAMP_HALF_US + k * step), min(hi, t - RAMP_HALF_US + (k + 1) * step)
        if x1 > x0:
            out.append((x0, x1, 1 - (1 - speed) * float(np.sin(np.pi * (k + 0.5) / RAMP_STEPS)) ** 2, 0.0))
    if b > hi:
        out.append((hi, b, 1.0, 0.0))
    return out


def seg_frames(clip: dict, fps) -> list[tuple[tuple[float, float, float, float], int]]:
    """each stretch with its number of reel frames, rounded on the running total so the clip's frames add up to its rounded length"""
    r, done, total, out = float(fps), 0, 0.0, []
    for s in retime_segments(clip):
        total += s[3] if s[3] > 0 else (s[1] - s[0]) / s[2]
        n = int(round(total / 1e6 * r)) - done
        done += n
        out.append((s, n))
    if done < 1 and out:                                       # never a clip of no frames
        out[-1] = (out[-1][0], out[-1][1] + 1 - done)
    return out


def output_plan(clip: dict, fps) -> list[tuple[float, bool]]:
    """the source time every reel frame of the clip shows (start of the frame), and whether the picture is held there (freeze)"""
    plan = []
    for (a, b, speed, hold), n in seg_frames(clip, fps):
        for j in range(n):
            plan.append((a, True) if hold > 0 else (min(b, a + j / float(fps) * 1e6 * speed), False))
    return plan


def strap_offset_s(clip: dict, fps) -> float:
    """E2: the strap (lower third) and event caption start one second before a FREEZE / RAMP key moment (reel seconds into the clip), else 0"""
    e = clip.get("effect") or {}
    if e.get("kind") not in ("FREEZE", "RAMP") or e.get("at_us") is None or not (int(clip["in_pts_us"]) < int(e["at_us"]) < int(clip["out_pts_us"])):
        return 0.0
    for i, (t, _) in enumerate(output_plan(clip, fps)):
        if t >= int(e["at_us"]):
            return max(0.0, i / float(fps) - 1.0)
    return 0.0


def clip_frames(clip: dict, fps) -> int:
    """A clip's length in reel frames (with its speed effect): the same length its sound is cut to."""
    return max(1, sum(n for _, n in seg_frames(clip, fps)))


def gap_frames(clip: dict, fps) -> int:
    """B.19 (ADR-094): the spacer before a clip (black picture, silence), in reel frames; the same as contracts retime.ts gapUs"""
    ms = max(0, int((clip.get("fx") or {}).get("gap_ms") or 0))
    return int(round(ms / 1000 * float(fps)))


def clip_gain_db(clip: dict) -> float | None:
    """B.20 (ADR-095): a clip's own sound level in dB (0 = as recorded); None = muted (contracts look.ts MUTE_DB or lower)"""
    g = float((clip.get("fx") or {}).get("gain_db") or 0)
    return None if g <= -60 else g


def _atempo(speed: float) -> str:
    """ffmpeg atempo steps (each at least 0.5) for a slower speed; empty at 1"""
    if speed >= 0.999:
        return ""
    steps, s = [], speed
    while s < 0.5:
        steps.append("atempo=0.5")
        s /= 0.5
    steps.append(f"atempo={s:.6f}")
    return ",".join(steps) + ","


def strength_at(runs: list[tuple[float, float]], t_us: float) -> float:
    """Spotlight strength 0..1: full inside a visible stretch, ramping over FADE_S at its edges, 0 outside (no spotlight)."""
    for a, b in runs:
        if a <= t_us <= b:
            return float(min(1.0, (t_us - a) / (FADE_S * 1e6) + 0.2, (b - t_us) / (FADE_S * 1e6) + 0.2))
    return 0.0


def box_at(path: list[PathPoint], t_us: int, frame_us: float, max_interp_s: float = MAX_INTERP_S) -> tuple[tuple[float, float, float, float] | None, str]:
    """The player's box at t: DETECTED (a path point within half a frame), INTERPOLATED (between points <= MAX_INTERP_S apart), MISSING."""
    if not path:
        return None, "MISSING"
    lo, hi = 0, len(path)
    while lo < hi:
        mid = (lo + hi) // 2
        if path[mid].pts_us < t_us:
            lo = mid + 1
        else:
            hi = mid
    after = path[lo] if lo < len(path) else None
    before = path[lo - 1] if lo > 0 else None
    for p in (before, after):
        if p and abs(p.pts_us - t_us) <= frame_us / 2:
            return p.box, "DETECTED"
    if before and after and after.pts_us - before.pts_us <= max_interp_s * 1e6:
        f = (t_us - before.pts_us) / (after.pts_us - before.pts_us)
        return tuple(a + (b - a) * f for a, b in zip(before.box, after.box)), "INTERPOLATED"
    return None, "MISSING"


BEAM_RGB = np.array([255, 233, 182], np.float32)                                # the ray's light: warm gold, heavenly


class Spotlight:
    """Per-frame compositor. ADR-110: broadcast pitch tracker on targeted player (ground base disc + glowing cyan ring + floating badge)
    without the vertical sky beam/ray."""

    def __init__(self, w: int, h: int, settings: dict, caption: str | None):
        self.w, self.h = w, h
        self.dim = float(min(0.9, max(0.0, settings.get("dim", 0.55))))
        self.feather = float(min(1.5, max(0.05, settings.get("feather", 0.6))))
        self.size = float(min(3.0, max(0.8, settings.get("size", 1.6))))
        self.ring = bool(settings.get("ring", True))
        c = settings.get("ring_color", "#17D1F8").lstrip("#")
        self.ring_rgb = np.array([int(c[i:i + 2], 16) for i in (0, 2, 4)], np.float32)
        self.caption = caption if settings.get("name_caption", True) else None
        self.font_size = max(12, h // 46)
        self.track: list[float] | None = None
        self.n = 0

    def reset(self) -> None:
        """A new clip, or he was lost: the tracker starts again where he is, without sliding in from the last place."""
        self.track = None

    def _steady(self, x: float, y: float, bw: float, bh: float) -> tuple[float, float, float]:
        """(centre x, feet y, body height), smoothed over frames: the box's width and edges change with every arm and leg movement, which
        made the beam wobble (owner 2026-11-02 "very unstable, bubbling about"). Size follows his height, slowly; a jump of more than a
        body height (a camera cut) starts again."""
        cx, fy = x + bw / 2, y + bh
        s = self.track
        if s is None or abs(cx - s[0]) > max(bh, s[2]) or abs(fy - s[1]) > max(bh, s[2]):
            self.track = [cx, fy, bh]
        else:                                   # ADR-079: the path is already steadied (smooth_path); only a little is left to settle
            s[0] += 0.8 * (cx - s[0])
            s[1] += 0.8 * (fy - s[1])
            s[2] += 0.2 * (bh - s[2])
        return self.track[0], self.track[1], self.track[2]

    def apply(self, rgb: np.ndarray, box_px: tuple[float, float, float, float] | None, strength: float) -> np.ndarray:
        if box_px is None or strength <= 0:
            self.reset()
            return rgb
        x, y, bw, bh = box_px
        cx_px, fy_px, hh_px = self._steady(x, y, bw, bh)
        self.n += 1

        # Ground pitch tracker geometry
        rx = max(16.0, hh_px * 0.38 * self.size, bw * 0.85 * self.size)
        ry = max(6.0, rx * 0.36)  # pitch perspective foreshortening

        # 1. Subtle background dimming outside player if dim > 0
        out_f = rgb.astype(np.float32)
        if self.dim > 0:
            dark_k = (0.10 + 0.22 * self.dim) * strength
            cy_mid = fy_px - hh_px * 0.5
            r_inner = max(rx * 1.2, hh_px * 0.6)
            r_outer = max(self.w, self.h) * 0.7
            yy, xx = np.mgrid[0:self.h:4, 0:self.w:4].astype(np.float32)
            dist = np.sqrt((xx - cx_px) ** 2 + (yy - cy_mid) ** 2)
            factor = np.clip((dist - r_inner) / max(1.0, r_outer - r_inner), 0.0, 1.0) * dark_k
            from PIL import Image
            mask_full = np.asarray(Image.fromarray((factor * 255).astype(np.uint8)).resize((self.w, self.h), Image.BILINEAR), np.float32) / 255.0
            out_f *= (1.0 - mask_full[..., None])

        out = np.clip(out_f, 0, 255).astype(np.uint8)

        # 2. Render ground pitch tracker (dark disc + cyan glowing ring) and floating broadcast badge
        from PIL import Image, ImageDraw

        im = Image.fromarray(out)
        overlay = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        # Ground dark disc
        disc_bbox = [int(round(cx_px - rx)), int(round(fy_px - ry)), int(round(cx_px + rx)), int(round(fy_px + ry))]
        disc_alpha = int(round(135 * strength))
        draw.ellipse(disc_bbox, fill=(12, 18, 26, disc_alpha))

        # Concentric glowing ring on the pitch
        if self.ring:
            ring_rx = rx * 0.72
            ring_ry = ry * 0.72
            rc = (int(self.ring_rgb[0]), int(self.ring_rgb[1]), int(self.ring_rgb[2]))

            # Outer soft glow stroke
            glow_w = max(3, int(round(5 * self.h / 1080)))
            glow_bbox = [
                int(round(cx_px - ring_rx - glow_w / 2)),
                int(round(fy_px - ring_ry - glow_w / 2)),
                int(round(cx_px + ring_rx + glow_w / 2)),
                int(round(fy_px + ring_ry + glow_w / 2)),
            ]
            draw.ellipse(glow_bbox, outline=(*rc, int(round(110 * strength))), width=glow_w)

            # Inner crisp core stroke
            core_w = max(2, int(round(2.5 * self.h / 1080)))
            core_bbox = [
                int(round(cx_px - ring_rx)),
                int(round(fy_px - ring_ry)),
                int(round(cx_px + ring_rx)),
                int(round(fy_px + ring_ry)),
            ]
            draw.ellipse(core_bbox, outline=(*rc, int(round(242 * strength))), width=core_w)

        # 3. Floating broadcast player card above head
        if self.caption and strength > 0.4:
            head_y = fy_px - hh_px
            parts = [p.strip() for p in self.caption.split("·") if p.strip()] if "·" in self.caption else ([p.strip() for p in self.caption.split("\n") if p.strip()] if "\n" in self.caption else [self.caption.strip()])
            title = parts[0].upper() if parts else ""
            sub = "  ·  ".join(parts[1:]) if len(parts) > 1 else ""

            fs = max(12, int(round(15 * self.h / 1080)))
            sub_fs = max(10, int(round(11 * self.h / 1080)))

            tw_title, th_title = text_size(title, fs, bold=True)
            tw_sub, th_sub = text_size(sub, sub_fs, bold=False) if sub else (0, 0)

            pad_x = max(14, int(round(16 * self.h / 1080)))
            card_w = max(tw_title, tw_sub) + pad_x * 2
            card_h = (th_title + th_sub + int(round(14 * self.h / 1080))) if sub else (th_title + int(round(12 * self.h / 1080)))

            tx = int(round(min(max(8, cx_px - card_w / 2), self.w - card_w - 8)))
            tip_y = int(round(head_y - 6 * self.h / 1080))
            pointer_h = max(4, int(round(5 * self.h / 1080)))
            ty = int(round(tip_y - pointer_h - card_h))

            # Rounded card container
            card_alpha = int(round(230 * strength))
            draw.rounded_rectangle(
                [tx, ty, tx + card_w, ty + card_h],
                radius=6,
                fill=(16, 24, 34, card_alpha),
                outline=(255, 255, 255, int(round(38 * strength))),
                width=1,
            )

            # Inverted pointer caret at bottom
            draw.polygon(
                [
                    (int(round(cx_px - 5)), ty + card_h),
                    (int(round(cx_px + 5)), ty + card_h),
                    (int(round(cx_px)), tip_y),
                ],
                fill=(16, 24, 34, card_alpha),
            )

            # Title
            title_y = int(round(ty + (card_h * 0.32 - th_title / 2) if sub else ty + (card_h - th_title) / 2))
            draw_text(draw, (int(round(tx + (card_w - tw_title) / 2)), title_y), title, fs, (255, 255, 255), bold=True)

            # Subtitle
            if sub:
                sub_y = int(round(ty + card_h * 0.72 - th_sub / 2))
                draw_text(draw, (int(round(tx + (card_w - tw_sub) / 2)), sub_y), sub, sub_fs, (203, 213, 225), bold=False)

        im = Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")
        return np.asarray(im)


CROP_DEAD_ZONE = 0.12          # E3: the frame does not move while the player stays within this share of its width from its centre
CROP_LOOKAHEAD_US = 400_000    # E3: where he will be 0.4 s later pulls the frame ahead of him


def crop_target(cx: float | None, box_cx: float | None, ahead_cx: float | None, cw: float) -> float | None:
    """E3 (ADR-066), the same as apps/web/src/components/studio/spotlight.ts cropTarget: where a 9:16 / 1:1 / 4:5 frame's centre should go.
    It aims a little ahead of the player (60 % now, 40 % in 0.4 s), holds still while he is inside the dead zone, and otherwise moves
    only far enough to bring him back to its edge. No player: hold."""
    if box_cx is None:
        return cx
    want = box_cx if ahead_cx is None else 0.6 * box_cx + 0.4 * ahead_cx
    if cx is None:
        return want
    d, lim = want - cx, CROP_DEAD_ZONE * cw
    return cx if abs(d) <= lim else cx + (abs(d) - lim) * (1 if d > 0 else -1)


def crop_alpha(speed: float) -> float:
    """per-frame smoothing of the frame's movement (at 25 fps): 0 = calm (0.04), 0.5 = the earlier 0.12, 1 = quick (0.2)"""
    return 0.04 + 0.16 * min(1.0, max(0.0, float(speed)))


def loudness(path: str, lufs: float, true_peak: float, work: Path) -> tuple[str, float | None]:
    """E3 (ADR-066): the sound set to `lufs` integrated loudness (EBU R128) with peaks under `true_peak` dBTP, in two passes (measure, then
    a linear gain where possible). Returns the file and the loudness measured after; silence or a failure keeps the file as it was."""
    def measure(p: str, extra: str = "") -> dict | None:
        r = ff.run(["-v", "info", "-nostdin", "-i", p, "-af", f"loudnorm=I={lufs}:TP={true_peak}:LRA=11{extra}:print_format=json", "-f", "null", "-"], timeout=900)
        txt = r.stderr.decode("utf-8", "replace")
        i = txt.rfind("{")
        try:
            return json.loads(txt[i:txt.rfind("}") + 1]) if i >= 0 else None
        except ValueError:
            return None
    m = measure(path)
    if not m or not np.isfinite(float(m.get("input_i", "-inf"))) or float(m["input_i"]) < -70:
        return path, None
    out = work / "audio_loud.wav"
    f = (f"loudnorm=I={lufs}:TP={true_peak}:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
         f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,aresample=48000")
    r = ff.run(["-v", "error", "-y", "-nostdin", "-i", path, "-af", f, "-ac", "2", "-c:a", "pcm_s16le", str(out)], timeout=900)
    if r.returncode != 0 or not out.exists():
        return path, None
    after = measure(str(out))
    return str(out), (round(float(after["input_i"]), 2) if after and np.isfinite(float(after.get("input_i", "-inf"))) else None)


# ADR-080: the cropped frames' width / height (16:9 keeps the source picture); the same numbers as the contracts' ASPECT_RATIO
ASPECT_RATIO = {"16:9": None, "9:16": 9 / 16, "1:1": 1.0, "4:5": 4 / 5}


def _output_geometry(w: int, h: int, aspect: str) -> tuple[int, int, int]:
    """(output width, output height, crop width in source pixels); the crop keeps the full source height."""
    scale = min(1.0, MAX_OUTPUT_HEIGHT / h)
    ch = h
    r = ASPECT_RATIO.get(aspect)
    cw = w if r is None else int(round(h * r))
    cw = min(w, cw - cw % 2)
    ow, oh = int(round(cw * scale / 2)) * 2, int(round(ch * scale / 2)) * 2
    return ow, oh, cw


def _audio(src: str, clips: list[dict], t_v0: float, work: Path, tail_s: float = 0.0, fps=Fraction(25)) -> str | None:
    """The clips' match audio, joined; `tail_s` seconds of silence after them (under the end screen). E2 (ADR-065): each stretch of a clip
    is cut to exactly its reel frames: slowed with atempo (the pitch kept), silent while the picture is frozen."""
    info = ff.ffprobe_json(src, "-show_streams")
    if not any(s.get("codec_type") == "audio" for s in info.get("streams", [])):
        return None
    fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    parts, n = [], 0
    for c in clips:
        g = gap_frames(c, fps)
        if g > 0:                                              # B.19: silence under the spacer before the clip
            parts.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={g / float(fps):.6f},{fmt}[a{n}]")
            n += 1
        gain = clip_gain_db(c)
        vol = f"volume={gain:.2f}dB," if gain else ""
        for (a, b, speed, hold), k in seg_frames(c, fps):
            if k <= 0:
                continue
            d = k / float(fps)
            if hold > 0 or gain is None:                       # a freeze, or a clip a person muted (B.20): silence of its length
                parts.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={d:.6f},{fmt}[a{n}]")
            else:
                parts.append(f"[0:a:0]atrim=start={t_v0 + a / 1e6:.6f}:end={t_v0 + b / 1e6:.6f},asetpts=PTS-STARTPTS,aresample=48000,{_atempo(speed)}{vol}{fmt},"
                             f"apad,atrim=duration={d:.6f}[a{n}]")
            n += 1
    if tail_s > 0:
        parts.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={tail_s:.6f},{fmt}[a{n}]")
        n += 1
    graph = ";".join(parts) + ";" + "".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[a]"
    out = work / "audio.wav"
    r = ff.run(["-v", "error", "-y", "-nostdin", "-copyts", "-i", src, "-filter_complex", graph, "-map", "[a]", "-ac", "2", "-c:a", "pcm_s16le", str(out)], timeout=1800)
    return str(out) if r.returncode == 0 and out.exists() else None


def mix_music(match: str | None, music: str, total_s: float, volume: float, match_volume: float, work: Path, duck: bool = False) -> str | None:
    """ADR-047: the music under the whole reel (looped when shorter, cut at the end with a 2 s fade), mixed over the clips' match sound at
    `match_volume` (no match sound: the music alone). None when the music cannot be read. E3 (ADR-066) `duck`: the music dips while the
    match sound is loud (a sidechain compressor keyed by the match sound as recorded)."""
    fmt = "aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    fade = max(0.0, total_s - 2.0)
    m = f"atrim=duration={total_s:.6f},asetpts=PTS-STARTPTS,volume={volume:.3f},afade=t=in:d=0.5,afade=t=out:st={fade:.6f}:d={min(2.0, total_s):.6f}"
    out = work / "audio_music.wav"
    if match:
        args = ["-i", match, "-stream_loop", "-1", "-i", music]
        if duck:
            graph = (f"[0:a]{fmt},asplit=2[a0][key];[a0]volume={match_volume:.3f}[a];[1:a]{fmt},{m}[m0];"
                     f"[m0][key]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=700[m];[a][m]amix=inputs=2:duration=first:normalize=0[o]")
        else:
            graph = f"[0:a]{fmt},volume={match_volume:.3f}[a];[1:a]{fmt},{m}[m];[a][m]amix=inputs=2:duration=first:normalize=0[o]"
    else:
        args = ["-stream_loop", "-1", "-i", music]
        graph = f"[0:a]{fmt},{m}[o]"
    r = ff.run(["-v", "error", "-y", "-nostdin", *args, "-filter_complex", graph, "-map", "[o]", "-ac", "2", "-c:a", "pcm_s16le", str(out)], timeout=900)
    return str(out) if r.returncode == 0 and out.exists() else None


def insert_count(path: str, fps: Fraction, max_s: float = INSERT_MAX_S) -> int:
    """ADR-050: how many reel frames an intro / outro video gives (its duration, at most max_s, on the reel's frame rate); 0 if unreadable."""
    try:
        info = ff.ffprobe_json(path, "-show_format", "-show_streams")
    except ff.FFmpegError:
        return 0
    if not ff.main_video(info):
        return 0
    d = min(max_s, float(info.get("format", {}).get("duration") or 0))
    return int(d * float(fps))


def insert_frames(path: str, n: int, ow: int, oh: int, fps: Fraction):
    """Exactly n RGB frames of an intro / outro video at the reel's size and frame rate: fitted inside the frame (padded with the reel's
    navy, never cropped or stretched), the last frame held if the file is a little short."""
    vf = (f"fps={fps.numerator}/{fps.denominator},scale={ow}:{oh}:force_original_aspect_ratio=decrease:flags=area,"
          f"pad={ow}:{oh}:(ow-iw)/2:(oh-ih)/2:color={INSERT_PAD},tpad=stop_mode=clone:stop_duration=2,format=rgb24")
    cmd = [ff.tool("ffmpeg"), "-hide_banner", "-nostdin", "-v", "error", "-i", path, "-map", "0:v:0", "-vf", vf, "-frames:v", str(n),
           "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=getattr(ff, "NO_WINDOW", 0))
    size = ow * oh * 3
    last = np.zeros((oh, ow, 3), np.uint8)
    try:
        for _ in range(n):
            buf = proc.stdout.read(size) if proc.stdout else b""
            if len(buf) == size:
                last = np.frombuffer(buf, np.uint8).reshape(oh, ow, 3)
            yield last
    finally:
        proc.kill()
        proc.wait()


def join_audio(parts: list[tuple[str | None, float]], work: Path, name: str) -> str | None:
    """One track from pieces of (wav or media file or None = silence, seconds), each cut or padded to its length; None when no piece has
    sound (the reel is then silent, as before)."""
    if not any(p for p, d in parts if d > 0):
        return None
    fmt = "aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    args: list[str] = []
    graph: list[str] = []
    k = 0
    for i, (src, d) in enumerate(parts):
        if d <= 0:
            continue
        has = False
        if src:
            try:
                has = any(s.get("codec_type") == "audio" for s in ff.ffprobe_json(src, "-show_streams").get("streams", []))
            except ff.FFmpegError:
                has = False
        if has:
            args += ["-i", src]
            graph.append(f"[{k}:a:0]{fmt},apad,atrim=duration={d:.6f},asetpts=PTS-STARTPTS[p{i}]")
            k += 1
        else:
            graph.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={d:.6f},{fmt}[p{i}]")
    labels = "".join(f"[p{i}]" for i, (_, d) in enumerate(parts) if d > 0)
    out = work / f"{name}.wav"
    r = ff.run(["-v", "error", "-y", "-nostdin", *args, "-filter_complex", ";".join(graph) + f";{labels}concat=n={labels.count('[')}:v=0:a=1[o]",
                "-map", "[o]", "-ac", "2", "-c:a", "pcm_s16le", str(out)], timeout=900)
    return str(out) if r.returncode == 0 and out.exists() else None


def handle_render(runner: JobRunner, job: Job) -> dict:
    store = LocalStore(os.environ["OTSI_VIE_STORAGE_DIR"])
    org, render_id = job.organization_id, job.payload["render_id"]
    with runner.conn.cursor() as cur:
        cur.execute("""SELECT j.state, j.config, j.reel_id, r.video_id, r.player_id, r.version, r.project_id, a.object_key, v.duration_us,
                              pi.display_name, pi.canonical_otsi_id
                         FROM render_jobs j JOIN reel_projects r ON r.id = j.reel_id AND r.organization_id = j.organization_id
                         JOIN video_sources v ON v.id = r.video_id AND v.organization_id = r.organization_id
                         LEFT JOIN assets a ON a.id = v.source_asset_id
                         LEFT JOIN v_player_identity pi ON pi.player_id = r.player_id
                        WHERE j.id = %s AND j.organization_id = %s""", (render_id, org))
        row = cur.fetchone()
    if not row:
        raise JobError("NOT_FOUND", "The render no longer exists.")
    if row["state"] in ("SUCCEEDED", "CANCELLED"):
        return {"render_id": render_id, "note": f"already {row['state'].lower()}"}
    cfg = json.loads(row["config"]) if isinstance(row["config"], str) else row["config"]
    reel_id, src = row["reel_id"], store.path(row["object_key"])
    with runner.conn.cursor() as cur:
        cur.execute("""SELECT rt.track_id, rt.identity_decision_id, (ci.decision_id = rt.identity_decision_id AND ci.state = 'CONFIRMED' AND ci.player_id = rt.player_id) AS current
                         FROM reel_targets rt LEFT JOIN v_track_current_identity ci ON ci.track_id = rt.track_id WHERE rt.reel_id = %s""", (reel_id,))
        targets = cur.fetchall()
    if not targets or not all(int(t["current"] or 0) for t in targets):
        return _fail(runner, job, render_id, reel_id, "REEL_TARGETS_STALE", "A followed player identity changed after the reel was built; refresh the targets.")
    with tx(runner.conn) as cur:
        if row["state"] == "FAILED":
            cur.execute("UPDATE render_jobs SET state = 'QUEUED' WHERE id = %s", (render_id,))
        if row["state"] in ("QUEUED", "FAILED"):
            cur.execute("UPDATE render_jobs SET state = 'RUNNING', started_at = CURRENT_TIMESTAMP(6), attempt_count = attempt_count + 1 WHERE id = %s", (render_id,))

    t_start = time.monotonic()
    info = ff.ffprobe_json(src, "-show_streams")
    v = ff.main_video(info)
    sw, sh = int(v["width"]), int(v["height"])
    fps = ff.rate(v.get("avg_frame_rate")) or ff.rate(v.get("r_frame_rate")) or Fraction(25)
    frame_us = 1e6 / float(fps)
    t_v0 = ff.first_frame_time(src, "v:0") or 0.0
    clips = cfg["clips"]
    # ADR-055: the transition into each clip after the first; the clip before it runs on past its out point (its handle) for that long
    into = {t["clip_id"]: t for t in (cfg.get("transitions") or []) if t.get("kind") in trn.KINDS}
    trans = [None] + [into.get(c["id"]) for c in clips[1:]]
    # B.19 (ADR-094): no transition into a clip with a spacer before it (it starts from black)
    trans_n = [trn.frame_count(int(t["duration_us"]), float(fps), clip_frames(c, fps)) if t and not gap_frames(c, fps) else 0 for t, c in zip(trans, clips)]
    handle_us = [int(round(trans_n[i + 1] * 1e6 / float(fps))) if i + 1 < len(clips) and trans_n[i + 1] else 0 for i in range(len(clips))]
    ow, oh, cw = _output_geometry(sw, sh, cfg.get("aspect", "16:9"))
    caption = None
    if row["display_name"]:
        caption = row["display_name"] + (f"  ·  {row['canonical_otsi_id']}" if row["canonical_otsi_id"] else "")
    settings = cfg.get("settings") or {}
    auto_track = bool(settings.get("auto_track", True))
    max_interp, tol = lock_rules(float(settings.get("lock", 0.5)), auto_track)

    # 2: the player's path in every clip
    with runner.conn.cursor() as cur:
        cur.execute(f"""SELECT o.pts_us, o.bbox_x, o.bbox_y, o.bbox_w, o.bbox_h FROM track_observations o
                         WHERE o.video_id = %s AND o.track_id IN ({",".join(["%s"] * len(targets))}) ORDER BY o.pts_us""",
                    (row["video_id"], *[t["track_id"] for t in targets]))
        obs = cur.fetchall()
    with runner.conn.cursor() as cur:
        cur.execute("SELECT config FROM pipeline_runs r JOIN reel_projects p ON p.run_id = r.id WHERE p.id = %s", (reel_id,))
        rc = cur.fetchone()
    run_cfg = (json.loads(rc["config"]) if isinstance(rc["config"], str) else rc["config"]) if rc else {}
    det = load_detector(run_cfg.get("detector"), tiles=int(run_cfg.get("tiles", 2)), score_floor=float(run_cfg.get("score_floor", 0.2)))
    paths, clip_meta = [], []
    for i, c in enumerate(clips):
        runner.progress(job, 2 + 50 * i / len(clips), f"Following the player in clip {i + 1} of {len(clips)}")
        out_us = int(c["out_pts_us"]) + handle_us[i]                  # with the handle a transition after this clip shows
        anchors = [PathPoint(int(o["pts_us"]), (float(o["bbox_x"]), float(o["bbox_y"]), float(o["bbox_w"]), float(o["bbox_h"])), "analysis")
                   for o in obs if c["in_pts_us"] - 500_000 <= int(o["pts_us"]) <= out_us + 500_000]
        if auto_track:
            path, how = target_path(src, int(c["in_pts_us"]), out_us, anchors, det, max_interp_s=max_interp, on_path_bh=tol,
                                    tick=lambda: runner.still_mine(job))
        else:                                                  # Auto Track off: the analysis's own positions only (ADR-044)
            path, how = sorted(anchors, key=lambda a: a.pts_us), {"anchors": len(anchors), "auto_track": False}
        paths.append(path)
        clip_meta.append({"clip_id": c["id"], "in_pts_us": c["in_pts_us"], "out_pts_us": c["out_pts_us"], "effect": c.get("effect") or {"kind": "NONE"},
                          "frames": clip_frames(c, fps), **{k: v for k, v in how.items() if v is not None}})

    # 3 + 4: composite every source frame and encode
    work = Path(tempfile.mkdtemp(prefix="render-", dir=store.ensure_dir(f"org/{org}/reels/{reel_id}")))
    spot = Spotlight(ow, oh, settings, caption)
    over = Overlays(ow, oh, settings, cfg.get("overlay") or {}, row["display_name"], row["canonical_otsi_id"], store.path)
    end_n = int(round(END_S * float(fps))) if over.end_screen else 0
    card_n = int(round(CARD_S * float(fps))) if over.match_card else 0
    # ADR-050: the intro / outro videos a person chose (their rights were checked when the render was queued)
    inserts = {}
    for side in ("intro", "outro"):
        x = cfg.get(side)
        if x:
            f = str(store.path(x["key"]))
            n = insert_count(f, fps)
            if n <= 0:
                return _fail(runner, job, render_id, reel_id, f"{side.upper()}_UNREADABLE", f"The chosen {side} video could not be read; choose another.")
            inserts[side] = (f, n)
    counts = [{"DETECTED": 0, "INTERPOLATED": 0, "MISSING": 0} for _ in clips]
    total_frames = [0]
    scale = ow / cw
    # E5 (ADR-068): the reel's colour look, baked into a 3D LUT that the clip decoder applies (the spotlight then lights the graded picture)
    look_cfg = settings.get("look") or None
    look_vf = None if lk.is_neutral(look_cfg) else lk.lut_filter(lk.write_cube(look_cfg, work / "look.cube"))
    lead_n = (inserts["intro"][1] if "intro" in inserts else 0) + card_n

    def frames():
        if "intro" in inserts:
            runner.progress(job, 54, "Adding the intro")
            for fr in insert_frames(inserts["intro"][0], inserts["intro"][1], ow, oh, fps):
                total_frames[0] += 1
                yield fr
        if card_n:
            for fr in over.card_frames(card_n):
                total_frames[0] += 1
                yield fr
        handle: list[np.ndarray] = []                          # ADR-055: the clip before's picture past its out point, for the transition
        for i, c in enumerate(clips):
            runner.progress(job, 55 + 35 * i / len(clips), f"Drawing the spotlight on clip {i + 1} of {len(clips)}")
            path = paths[i]
            runs = visible_runs(path, frame_us, max_interp)
            steady = smooth_path(path, max_interp)             # ADR-079: where the beam goes; the raw path still decides where he was seen
            spot.reset()
            state = {"crop_cx": None, "zc": None}
            alpha = crop_alpha(float(settings.get("reframe_speed", 0.5)))
            fx = c.get("fx") or {}
            zkeys, drawings = fx.get("zoom") or [], fx.get("drawings") or []

            strap0 = strap_offset_s(c, fps)

            def compose(f, count: bool, out_t: float | None = None) -> np.ndarray:
                _, st = box_at(path, f.pts_us, frame_us, max_interp)
                b = box_at(steady, f.pts_us, frame_us, max_interp)[0] if st != "MISSING" else None
                if count:
                    counts[i][st] += 1
                rgb = f.rgb
                if cw < sw:                                    # aspect crop following the player smoothly (exponential smoothing)
                    # E3 (ADR-066): a calm camera on the player: dead zone, a little look-ahead, the person's follow speed
                    cx = state["crop_cx"]
                    ahead, _ = box_at(steady, f.pts_us + CROP_LOOKAHEAD_US, frame_us, max_interp)
                    target = crop_target(cx, (b[0] + b[2] / 2) * sw if b else None, (ahead[0] + ahead[2] / 2) * sw if ahead else None, cw)
                    if target is None:
                        target = sw / 2
                    state["crop_cx"] = cx = target if cx is None else cx + alpha * (target - cx)
                    x0 = int(min(max(0, cx - cw / 2), sw - cw))
                    rgb = rgb[:, x0:x0 + cw]
                else:
                    x0 = 0
                if (ow, oh) != (rgb.shape[1], rgb.shape[0]):
                    from PIL import Image
                    rgb = np.asarray(Image.fromarray(np.ascontiguousarray(rgb)).resize((ow, oh), Image.BILINEAR))
                box_px = ((b[0] * sw - x0) * scale, b[1] * sh * scale, b[2] * sw * scale, b[3] * sh * scale) if b else None
                lit = spot.apply(rgb, box_px, strength_at(runs, f.pts_us) if b else 0.0)
                t_clip = (f.pts_us - int(c["in_pts_us"])) / 1e6 if out_t is None else out_t   # reel seconds into the clip
                if drawings:                                   # E5: telestration, drawn on as in the editor (source points to this frame)
                    lit = lk.draw(lit, drawings, t_clip * 1000, lambda x, y: ((x * sw - x0) * scale, y * sh * scale))
                if zkeys:                                      # E5: keyframed zoom centred on the player (smoothed), else where it was
                    z = lk.zoom_at(zkeys, t_clip * 1000)
                    tgt = (box_px[0] + box_px[2] / 2, box_px[1] + box_px[3] / 2) if box_px else (state["zc"] or (ow / 2, oh / 2))
                    zc = state["zc"]
                    state["zc"] = zc = tgt if zc is None else (zc[0] + 0.15 * (tgt[0] - zc[0]), zc[1] + 0.15 * (tgt[1] - zc[1]))
                    lit = lk.zoom(lit, z, zc[0], zc[1])
                return over.apply(lit, f.pts_us, t_clip - strap0, c.get("label"))

            # exactly the clip's length in frames, as its sound is cut: the decoder may give a frame more (or less) at the edges, which over 59
            # clips put the picture 0.6 s behind the sound and the encoder cut the reel short (owner 2026-11-02, RENDER_INVALID)
            # E2 (ADR-065): every reel frame shows the source frame nearest its planned source time (slow motion repeats frames, a freeze
            # holds one); the frame count is the clip's retimed length, the same its sound is cut to
            plan = output_plan(c, fps)
            want = len(plan)
            gn = gap_frames(c, fps)
            if gn:                                             # B.19: the spacer, black (no overlay: nothing of the match is shown)
                black = np.zeros((oh, ow, 3), dtype=np.uint8)
                for _ in range(gn):
                    runner.still_mine(job)
                    total_frames[0] += 1
                    yield black
            made, last = 0, None
            tn, kind, before = trans_n[i], (trans[i] or {}).get("kind"), handle
            handle = []
            dec = iter(ff.decode_sampled(src, None, start_us=int(c["in_pts_us"]), end_us=int(c["out_pts_us"]), seek=True, width=sw, height=sh, vf=look_vf))
            cur, nxt, shown = next(dec, None), None, None
            nxt = next(dec, None) if cur is not None else None
            for t_src, _held in plan:
                if cur is None:
                    break
                while nxt is not None and nxt.pts_us <= t_src + frame_us / 2:
                    cur, nxt = nxt, next(dec, None)
                runner.still_mine(job)                         # cancelled by the person (or taken over): stop within seconds
                total_frames[0] += 1
                last = compose(cur, cur is not shown, made / float(fps))
                shown = cur
                out = trn.blend(kind, before[made], last, (made + 1) / (tn + 1)) if made < tn and made < len(before) else last
                made += 1
                yield out
            if hasattr(dec, "close"):
                dec.close()                                    # stop the decoder of this clip now, not when it is collected
            while made < want and last is not None:            # a frame or two short at the clip's end: hold its last picture
                total_frames[0] += 1
                made += 1
                yield last
            n_next = trans_n[i + 1] if i + 1 < len(clips) else 0
            if n_next and last is not None:                    # the handle: this clip's picture past its out point, the transition's first half
                for f in ff.decode_sampled(src, None, start_us=int(c["out_pts_us"]) + int(frame_us // 2), end_us=int(c["out_pts_us"]) + handle_us[i] + int(frame_us),
                                           seek=True, width=sw, height=sh, vf=look_vf):
                    if len(handle) >= n_next:
                        break
                    runner.still_mine(job)
                    handle.append(compose(f, False))
                while len(handle) < n_next:                    # no footage after the out point (end of the video): hold its last picture
                    handle.append(handle[-1] if handle else last)
        if end_n:
            runner.progress(job, 90, "Drawing the end screen")
            for fr in over.end_frames(end_n, (cfg.get("overlay") or {}).get("title")):
                total_frames[0] += 1
                yield fr
        if "outro" in inserts:
            runner.progress(job, 90, "Adding the outro")
            for fr in insert_frames(inserts["outro"][0], inserts["outro"][1], ow, oh, fps):
                total_frames[0] += 1
                yield fr

    codec = cfg.get("codec", "h264")
    try:
        backend = enc.choose(codec)
    except ff.FFmpegError as e:
        return _fail(runner, job, render_id, reel_id, "NO_ENCODER", str(e))
    audio = _audio(src, clips, t_v0, work, end_n / float(fps), fps)
    reel_s = sum(gap_frames(c, fps) + clip_frames(c, fps) for c in clips) / float(fps)     # E2: with speed effects; B.19: and spacers
    music = cfg.get("music")
    if music:                                                  # ADR-047: the music a person chose (its rights were checked when queued)
        total_s = reel_s + end_n / float(fps)
        mixed = mix_music(audio, store.path(music["key"]), total_s, float(music.get("volume", 0.8)), float(music.get("match_volume", 0.3)), work,
                          duck=bool((cfg.get("audio") or {}).get("duck_music", False)))
        if not mixed:
            return _fail(runner, job, render_id, reel_id, "MUSIC_UNREADABLE", "The chosen music file could not be read; choose another.")
        audio = mixed
    if card_n or inserts:                                      # ADR-050: silence under the match card; the intro's / outro's own sound
        main_s = reel_s + end_n / float(fps)
        r_ = float(fps)
        parts = [(inserts["intro"][0], inserts["intro"][1] / r_)] if "intro" in inserts else []
        parts += [(None, card_n / r_), (audio, main_s)]
        parts += [(inserts["outro"][0], inserts["outro"][1] / r_)] if "outro" in inserts else []
        audio = join_audio(parts, work, "audio_full") if any(p for p, _ in parts) else None
    loud = None                                                # E3 (ADR-066): the whole sound set to the profile's loudness
    aud_cfg = cfg.get("audio") or {}
    if audio and aud_cfg.get("lufs") is not None:
        runner.progress(job, 91, "Setting the loudness")
        audio, loud = loudness(audio, float(aud_cfg["lufs"]), float(aud_cfg.get("true_peak_db", -1.5)), work)
    out_path = work / f"reel.{backend.container}"
    bitrate = int(float(cfg.get("bitrate_mbps", 8)) * 1e6 * (ow * oh) / (1920 * 1080))
    try:
        planned_n = lead_n + sum(gap_frames(c, fps) + clip_frames(c, fps) for c in clips) + end_n + (inserts["outro"][1] if "outro" in inserts else 0)
        res = enc.encode(frames(), str(out_path), width=ow, height=oh, fps=fps, backend=backend, bitrate=max(1_000_000, bitrate), audio_from=audio,
                         duration_s=planned_n / float(fps))
    except ff.FFmpegError as e:
        return _fail(runner, job, render_id, reel_id, "ENCODE_FAILED", str(e))

    # 5: validate
    runner.progress(job, 92, "Checking the rendered file")
    val = validate(str(out_path), codec=codec, width=ow, height=oh, frames=total_frames[0], fps=float(fps), audio=audio is not None,
                   target_lufs=float(aud_cfg["lufs"]) if aud_cfg.get("lufs") is not None else None)
    if not val["ok"]:
        return _fail(runner, job, render_id, reel_id, "RENDER_INVALID", "; ".join(val["failures"])[:1900])

    # 6: record
    key = f"org/{org}/reels/{reel_id}/{render_id}.{backend.container}"
    os.replace(out_path, store.path(key))
    sha = hashlib.sha256(Path(store.path(key)).read_bytes()).hexdigest()
    build = json.loads((ff.bin_dir().parents[1] / "BUILD_MANIFEST.json").read_text(encoding="utf-8")).get("build_id")
    totals = {k: sum(c[k] for c in counts) for k in ("DETECTED", "INTERPOLATED", "MISSING")}
    manifest = {
        "render_id": render_id, "reel_id": reel_id, "reel_version": cfg.get("reel_version"), "video_id": row["video_id"], "player_id": row["player_id"],
        "pinned_identity_decisions": [t["identity_decision_id"] for t in targets],
        "clips": [{**m, "spotlight_frames": c} for m, c in zip(clip_meta, counts)], "spotlight_frames": totals,
        "rules": {"dense_fps": DENSE_FPS if auto_track else None, "auto_track": auto_track, "target_lock": settings.get("lock", 0.5),
                  "max_interpolation_s": max_interp, "on_path_body_heights": tol, "missing_means": "no spotlight drawn"},
        "overlays": {**over.summary(), "facts": {k: v for k, v in (cfg.get("overlay") or {}).items() if not k.endswith("_key")}},
        "music": {"volume": music.get("volume"), "match_volume": music.get("match_volume")} if music else None,
        "inserts": {k: {"frames": v[1]} for k, v in inserts.items()},
        "profile": cfg.get("profile", "REEL"),
        "look": {"settings": look_cfg, "lut": "33-point 3D LUT, lut3d trilinear, before the spotlight" if look_vf else None},
        "clip_fx": [{"clip_id": c["id"], **(c.get("fx") or {})} for c in clips if (c.get("fx") or {}).get("zoom") or (c.get("fx") or {}).get("drawings")],
        "audio_rules": {"target_lufs": aud_cfg.get("lufs"), "measured_lufs": loud, "true_peak_db": aud_cfg.get("true_peak_db"), "duck_music": aud_cfg.get("duck_music"),
                        "reframe_speed": settings.get("reframe_speed", 0.5)},
        "output": {"width": ow, "height": oh, "fps": f"{fps.numerator}/{fps.denominator}", "aspect": cfg.get("aspect"), "frames": total_frames[0],
                   "encoder": backend.key, "encoder_licence_note": backend.licence_note, "ffmpeg_build": build, "sha256": sha, "validation": val},
        "notice": "Development / testing output. Commercial distribution and paid export are not activated (owner decisions E1-E3, legal review pending).",
    }
    mbytes = json.dumps(manifest, indent=1).encode()
    mkey = f"{key}.manifest.json"
    Path(store.path(mkey)).write_bytes(mbytes)
    result = {"frames": total_frames[0], "duration_s": round(total_frames[0] / float(fps), 2), "width": ow, "height": oh, "encoder": backend.key,
              "spotlight_frames": totals, "seconds": round(time.monotonic() - t_start, 1), "bytes": os.path.getsize(store.path(key)), "audio": audio is not None, "music": bool(music), "loudness_lufs": loud, "profile": cfg.get("profile", "REEL"), "aspect": cfg.get("aspect"),
              "lead_s": round(lead_n / float(fps), 3), "validation_ok": True}
    with tx(runner.conn) as cur:
        cur.execute("SELECT claim_token FROM worker_jobs WHERE id = %s FOR UPDATE", (job.id,))
        if cur.fetchone()["claim_token"] != job.token:
            raise JobError("LEASE_LOST", "Another worker took over this render.")
        out_id, man_id = str(uuid.uuid4()), str(uuid.uuid4())
        mime = "video/mp4" if backend.container == "mp4" else "video/webm"
        cur.execute("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, metadata) "
                    "VALUES (%s, %s, %s, 'REEL', %s, 'local', %s, %s, %s, %s)",
                    (out_id, org, row["project_id"], key, result["bytes"], sha, mime, json.dumps({"render_id": render_id, "encoder": backend.key})))
        cur.execute("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, metadata) "
                    "VALUES (%s, %s, %s, 'MANIFEST', %s, 'local', %s, %s, 'application/json', %s)",
                    (man_id, org, row["project_id"], mkey, len(mbytes), hashlib.sha256(mbytes).hexdigest(), json.dumps({"render_id": render_id})))
        cur.execute("INSERT INTO reel_manifest_versions (id, reel_project_id, version, manifest, manifest_sha256) VALUES (%s, %s, %s, %s, %s)",
                    (str(uuid.uuid4()), reel_id, int(cfg.get("reel_version") or 1), json.dumps(manifest), hashlib.sha256(mbytes).hexdigest()))
        cur.execute("UPDATE render_jobs SET state = 'SUCCEEDED', output_asset_id = %s, manifest_asset_id = %s, result = %s, completed_at = CURRENT_TIMESTAMP(6) WHERE id = %s",
                    (out_id, man_id, json.dumps(result), render_id))
        cur.execute("UPDATE reel_projects SET status = 'READY' WHERE id = %s", (reel_id,))
        audit(cur, org, SERVICE, "reel.rendered", "reel", reel_id, {"render_id": render_id, **result}, f"job:{job.id}")
        publish(cur, org, "reel", reel_id, "reel.rendered", {"reel_id": reel_id, "render_id": render_id}, f"reel-rendered:{render_id}")
    for p in work.iterdir():
        p.unlink()
    work.rmdir()
    return {"render_id": render_id, **result}


def _fail(runner: JobRunner, job: Job, render_id: str, reel_id: str, code: str, detail: str) -> dict:
    with tx(runner.conn) as cur:
        cur.execute("SELECT state FROM render_jobs WHERE id = %s FOR UPDATE", (render_id,))
        st = cur.fetchone()["state"]
        if st == "QUEUED":
            cur.execute("UPDATE render_jobs SET state = 'RUNNING' WHERE id = %s", (render_id,))
        cur.execute("UPDATE render_jobs SET state = 'FAILED', failure_code = %s, failure_detail = %s, completed_at = CURRENT_TIMESTAMP(6) WHERE id = %s",
                    (code[:255], detail[:2000], render_id))
        cur.execute("UPDATE reel_projects SET status = 'DRAFT' WHERE id = %s", (reel_id,))
        audit(cur, job.organization_id, SERVICE, "reel.render_failed", "reel", reel_id, {"render_id": render_id, "code": code, "detail": detail[:500]}, f"job:{job.id}")
    return {"render_id": render_id, "state": "FAILED", "code": code}
