"""CALIBRATE_PITCH (Blueprint 03 step 8 `geometry`): where on the pitch (metres) the picture is, for one stretch of one shot.

A person marks named landmarks of the pitch on one frame (the request). This job fits the pitch to those clicks (`geometry.fit_from_points`),
snaps the pitch lines onto the white lines of that frame (`geometry.refine_pyramid`), then follows the camera through the shot, in both
directions, frame by frame: each frame starts from the previous fit moved by the picture's global motion and is snapped to its own white lines.

A sample is MEASURED only when the fit passes every honesty check: the lines are really there (`quality`), they point in two directions
(`well_posed`), and no clearly painted line is left unexplained (`consistent`). Unmeasured frames get no `pitch_calibrations` row at all
(Blueprint: "if inaccurate or occluded, no distance or speed metrics"). The follow stops at a camera cut and after a run of unmeasured
frames: a calibration never crosses a cut, and a lost fit is not carried on hopefully.

Moments with 2-5 clicks (owner, 2026-10-31: "calibrate 2-3 points in one shot, then another 2-3 in another shot ... ONE complete pitch
calibration"): the main camera stands in one place, so its place is worked out from the clicks of all the video's moments together
(`camera.solve`). A moment it pins down gets its pitch from that camera and is then checked and followed like any other; a moment it cannot
pin down yet WAITS (no positions) and is settled when later moments add enough clicks; a moment that does not fit the camera fails, by name.

Automatic (mode AUTO, ADR-036): nobody clicks. A keypoint network finds pitch points in a frame every AUTO_STEP_S over the whole video
(`pitch_auto`); the match camera is refined from the frames with the most points together with the person's moments; every frame is then
fitted to that camera and kept only when it passes the same honesty checks (agreeing points, lines known to a few pixels, covers the grass).
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass

import numpy as np

from . import camera as cam, ff, geometry as geo, pitch_auto
from .db import tx
from .frames import CutDetector
from .jobs import Job, JobError, JobRunner
from .quality import phase_shift
from .storage import LocalStore

log = logging.getLogger("vie_worker.pitch")

SAMPLE_FPS = 3.0                  # a camera pans a few degrees in a third of a second; positions between samples are interpolated by the reader
WORK_WIDTH = 640                  # frames are decoded at this width: the line detector works at 640 px anyway
SPAN_US = 150_000_000             # at most 150 s each way from the anchor
CHUNK_US = 20_000_000             # the video is read and followed in chunks of 20 s, so a cut or a lost fit stops the reading early
MIN_QUALITY = 0.30                # measured samples: quality (lock x well-posed x consistent) at least this
MAX_LOST = 6                      # stop following after this many unmeasured samples in a row (2 s)
MIN_ANCHOR_QUALITY = 0.25         # the anchor itself must fit the lines at least this well, else the person is asked to check the clicks
MAX_ANCHOR_CLICK_PX = 14.0        # the clicked points must be explained by the pitch to within this many pixels (of 640)
MIN_TRUSTED_CLICKS = 6            # with this many places (and they agree to MAX_TRUSTED_CLICK_PX) the person's pitch stands without the white lines' confirmation
MAX_TRUSTED_CLICK_PX = 4.0        # (of 640) four places always agree exactly; six or more that agree this closely cannot hide a wrongly named landmark
AUTO_STEP_S = 1.0                 # automatic calibration looks at one frame a second (0.3 s each on the Arc GPU); only inside the halves when
                                  # match time is known (migration 0030): ~32 min for 105 min of play, the programme skipped
AUTO_SOLVE_FRAMES = 20            # frames with the most pitch points that refine the match camera (with the person's moments)
AUTO_WIDTH = 960                  # the keypoint network's input width
AUTO_FRAME_US = 166_667           # between two calibrated frames of one shot the camera is interpolated for every analysed frame (6 per second)
AUTO_BRIDGE_US = 3_000_000        # two calibrated frames of one shot at most this far apart: the camera is interpolated between them
AUTO_ISOLATED_US = 250_000        # a calibrated frame with no calibrated neighbour stands for a quarter second each side only (the camera moves)
MAX_SNAP_MOVE_PX = 12.0           # the snap may correct a clicked place by at most this much (of 640: ordinary click error); further, the person's clicks win


@dataclass
class Sample:
    pts_us: int
    fit: geo.Fit
    measured: bool


class Follower:
    """Follows one calibration from the anchor frame in one direction, one frame at a time: each frame starts from the previous fit moved by the picture's
    global motion and is snapped to its own white lines. `feed` returns the Sample for the frame, or None once the shot ended (a camera cut) or too many
    samples in a row could not be measured: from then on `done` is True and nothing more is fed."""

    def __init__(self, H0: np.ndarray, rgb0: np.ndarray, length: float, width: float, *, min_quality: float = MIN_QUALITY, max_lost: int = MAX_LOST):
        self.H, self.prev, self.length, self.width = H0, rgb0, length, width
        self.min_quality, self.max_lost, self.lost, self.done = min_quality, max_lost, 0, False
        self.cuts = CutDetector()
        self.cuts.is_cut(rgb0)                                              # primes it: the anchor frame is its first picture

    def feed(self, pts: int, rgb: np.ndarray) -> Sample | None:
        if self.done:
            return None
        if self.cuts.is_cut(rgb):                                           # another camera: nothing of this calibration carries over
            self.done = True
            return None
        dx, dy = phase_shift(self.prev, rgb)                                # the picture moved by (dx, dy) px of its own width since the previous frame
        init = geo.shift_matrix(dx / rgb.shape[1], dy / rgb.shape[0]) @ self.H
        fit = geo.refine_pyramid(init, geo.line_mask(rgb, WORK_WIDTH), self.length, self.width)
        ok = fit.quality >= self.min_quality and fit.well_posed and fit.consistent and geo.covers_grass(fit.H, rgb, self.length, self.width)
        self.H, self.prev = fit.H, rgb
        self.lost = 0 if ok else self.lost + 1
        if self.lost > self.max_lost:
            self.done = True
        return Sample(pts, fit, ok)


def _point_fit(H: np.ndarray, pitch_pts: np.ndarray, image_pts: np.ndarray, w: int, h: int) -> geo.PointFit:
    """How closely a pitch from elsewhere (the match camera) explains a moment's own clicks."""
    px = np.array([w, h], float)
    proj, back = geo.project(H, pitch_pts), geo.unproject(H, image_pts)
    rms_px = float(np.sqrt(np.mean((((proj - image_pts) * px) ** 2).sum(1)))) if np.isfinite(proj).all() else float("inf")
    rms_m = float(np.sqrt(np.mean(((back - pitch_pts) ** 2).sum(1)))) if np.isfinite(back).all() else float("inf")
    return geo.PointFit(H, rms_px, rms_m, False, False)


def fit_anchor(frames: list[tuple[int, np.ndarray]], anchor_pts: int, pitch_pts: np.ndarray, image_pts: np.ndarray, length: float, width: float,
               H0: np.ndarray | None = None, need_lines: bool = False) -> tuple[int, np.ndarray, geo.Fit, geo.PointFit, float]:
    """The anchor: the person's clicks fitted to the pitch, then snapped onto the white lines of the nearest frame. Raises JobError with a plain reason if
    the clicks cannot be right or the lines drawn from them do not lie on the white lines.
    The snap may refine the clicks by at most MAX_SNAP_MOVE_PX. On the owner's match it moved correct clicks by 16-55 px (white shirts and the edge of a
    shadow read as lines, 2026-10-31): then the person's clicks are kept as they are (their pitch, checked against the grass) and the last value returned,
    how far the snap would have moved them, is > MAX_SNAP_MOVE_PX; the caller does not follow the camera from such an anchor (the follower snaps too).
    H0: the moment's pitch from the match camera (`camera.solve`, which already checked it against the clicks of all moments); it replaces the
    moment's own fit, and stands without the white lines like six agreeing clicks do, unless `need_lines` (the camera knows it only roughly:
    the white lines must confirm it)."""
    if not frames:
        raise JobError("NO_FRAMES", "The video around that moment could not be read.")
    a = min(range(len(frames)), key=lambda i: abs(frames[i][0] - anchor_pts))
    rgb0 = frames[a][1]
    h0, w0 = rgb0.shape[:2]
    if H0 is not None:
        pf = _point_fit(H0, pitch_pts, image_pts, w0, h0)
    else:
        pf = geo.fit_from_points(pitch_pts, image_pts, w0, h0)
        if pf.collinear:
            raise JobError("POINTS_ON_ONE_LINE", "The points you marked lie on one line, which cannot fix the pitch. Mark points that are spread across the picture.")
        if pf.mirrored:
            raise JobError("POINTS_MIRRORED", "The points look mirrored: the pitch would be seen back to front. Check which landmark each click is.")
    if pf.rms_px > MAX_ANCHOR_CLICK_PX * w0 / WORK_WIDTH:
        raise JobError("POINTS_INCONSISTENT", f"The marked points do not agree with each other (they are off by about {pf.rms_px:.0f} px). Check the landmark names and click again.")
    mask = geo.line_mask(rgb0, WORK_WIDTH)
    anchor = geo.refine_pyramid(pf.H, mask, length, width)
    moved = float(np.max(np.hypot(*((geo.project(anchor.H, pitch_pts) - image_pts) * np.array([w0, h0])).T)))
    lines_confirm = (moved <= MAX_SNAP_MOVE_PX * w0 / WORK_WIDTH and anchor.quality >= MIN_ANCHOR_QUALITY and anchor.well_posed and anchor.consistent
                     and geo.covers_grass(anchor.H, rgb0, length, width))
    if lines_confirm:
        return frames[a][0], rgb0, anchor, pf, moved
    # The white lines do not confirm the clicks (on the owner's compressed 720p footage the line detector misses most lines: correct clicks scored
    # quality 0.21, 2026-10-31). The person's clicks stand when they can check themselves: enough places that agree closely, and a pitch that
    # covers the grass. The caller does not follow the camera from such an anchor (the follower relies on the lines).
    if need_lines:
        raise JobError("LINES_DO_NOT_MATCH", "The white lines in this frame did not confirm the pitch the match camera gives this moment. "
                                             "Mark one or two more places in this moment, spread apart.")
    if H0 is None and (len(pitch_pts) < MIN_TRUSTED_CLICKS or pf.rms_px > MAX_TRUSTED_CLICK_PX * w0 / WORK_WIDTH):
        raise JobError("LINES_DO_NOT_MATCH", f"The white lines in this frame are too faint for the engine to check your points. Mark {MIN_TRUSTED_CLICKS} or more places "
                                             "spread across the picture (the corners of both boxes and the penalty spot), each exactly on the line corners.")
    if not geo.covers_grass(pf.H, rgb0, length, width):
        raise JobError("LINES_DO_NOT_MATCH", "The pitch drawn from your points does not cover the grass of that frame. Check which landmark each click is.")
    kept = geo.score(pf.H, geo.distance_field(mask), length, width, mask=mask)
    return frames[a][0], rgb0, kept, pf, max(moved, MAX_SNAP_MOVE_PX * w0 / WORK_WIDTH + 1e-6)


def calibrate(frames: list[tuple[int, np.ndarray]], anchor_pts: int, pitch_pts: np.ndarray, image_pts: np.ndarray, length: float, width: float, progress=None,
              H0: np.ndarray | None = None, need_lines: bool = False) -> dict:
    """The whole calibration of one stretch from frames already in memory (tests and short clips): anchor, then follow both ways until a cut or a lost fit."""
    pts0, rgb0, anchor, pf, moved = fit_anchor(frames, anchor_pts, pitch_pts, image_pts, length, width, H0, need_lines)
    a = next(i for i, f in enumerate(frames) if f[0] == pts0)
    samples: list[Sample] = []
    for step in ((+1, -1) if moved <= MAX_SNAP_MOVE_PX * rgb0.shape[1] / WORK_WIDTH else ()):
        fol = Follower(anchor.H, rgb0, length, width)
        i = a + step
        while 0 <= i < len(frames) and not fol.done:
            smp = fol.feed(*frames[i])
            if smp is not None:
                samples.append(smp)
            i += step
        if progress:
            progress(55 if step == +1 else 95)
    return {"anchor": anchor, "anchor_pts": pts0, "click_px": pf.rms_px, "click_m": pf.rms_m, "snap_moved_px": moved, "samples": sorted(samples, key=lambda s: s.pts_us)}


def calibrate_stream(decode, anchor_pts: int, pitch_pts: np.ndarray, image_pts: np.ndarray, length: float, width: float, progress=None,
                     H0: np.ndarray | None = None, need_lines: bool = False) -> dict:
    """The calibration of one stretch from a video, read in chunks (`decode(lo_us, hi_us)` -> [(pts_us, rgb)]). The anchor is the frame the person marked: it is
    read from exactly that moment (a frame a fraction of a second away has already moved, and the clicks would no longer sit on the lines), checked on its own
    first, and only then is the camera followed, forward and backward, chunk by chunk, until a cut, a lost fit, or SPAN_US."""
    pts0, rgb0, anchor, pf, moved = fit_anchor(decode(anchor_pts, anchor_pts + 600_000), anchor_pts, pitch_pts, image_pts, length, width, H0, need_lines)
    samples: list[Sample] = []
    follow = moved <= MAX_SNAP_MOVE_PX * rgb0.shape[1] / WORK_WIDTH        # the person's own pitch (the snap disagreed) is not followed
    for step, label, base in (((+1, "Following the camera forward", 20), (-1, "Following the camera backward", 55)) if follow else ()):
        fol, edge = Follower(anchor.H, rgb0, length, width), pts0
        while not fol.done and abs(edge - pts0) < SPAN_US:
            lo, hi = (edge, edge + CHUNK_US) if step > 0 else (edge - CHUNK_US, edge)
            chunk = [f for f in decode(lo, hi) if (f[0] > edge if step > 0 else f[0] < edge)]
            if not chunk:
                break
            for pts, rgb in (chunk if step > 0 else chunk[::-1]):
                smp = fol.feed(pts, rgb)
                if smp is not None:
                    samples.append(smp)
                if fol.done:
                    break
            edge = chunk[-1][0] if step > 0 else chunk[0][0]
            if progress:
                progress(base + 30 * min(1.0, abs(edge - pts0) / SPAN_US), label)
    return {"anchor": anchor, "anchor_pts": pts0, "click_px": pf.rms_px, "click_m": pf.rms_m, "snap_moved_px": moved, "samples": sorted(samples, key=lambda s: s.pts_us)}


def _rows(request_id: str, video_id: str, anchor_pts: int, anchor: geo.Fit, samples: list[Sample], length: float, width: float, interval_us: int) -> list[tuple]:
    out = []
    items = [(anchor_pts, anchor, True, "CONFIRMED")] + [(s.pts_us, s.fit, s.measured, "INFERRED") for s in samples]
    half = interval_us // 2
    for pts, fit, measured, state in sorted(items, key=lambda z: z[0]):
        if not measured:
            continue
        out.append((str(uuid.uuid4()), video_id, request_id, max(0, pts - half), pts + half, json.dumps(fit.H.tolist()), length, width, float(fit.mean_px), state, float(fit.quality)))
    return out


def _points(row) -> list[dict]:
    return json.loads(row["points"]) if isinstance(row["points"], (str, bytes)) else row["points"]


def _landmarks(points: list[dict]) -> list[dict]:
    """The clicks on named landmarks; the others are clicks anywhere on a line ({"line": ...}, used through the match camera only)."""
    return [p for p in points if "landmark" in p]


def _arrays(points: list[dict], length: float, width: float) -> tuple[np.ndarray, np.ndarray]:
    lm, pts = geo.landmarks(length, width), _landmarks(points)
    return np.array([lm[p["landmark"]] for p in pts], float).reshape(-1, 2), np.array([[p["x"], p["y"]] for p in pts], float).reshape(-1, 2)


def _line_clicks(points: list[dict], length: float, width: float) -> list[cam.LineClick]:
    return [cam.line_click(p["line"], p["x"], p["y"], length, width) for p in points if "line" in p]


def _settle(runner: JobRunner, rid: str, video_id: str, decode, anchor_pts: int, pitch_pts: np.ndarray, image_pts: np.ndarray, length: float, width: float,
            progress=None, H0: np.ndarray | None = None, need_lines: bool = False, extra: dict | None = None) -> dict:
    """Calibrate one moment and store it (SUCCEEDED, with its measured samples). Raises JobError with a plain reason."""
    res = calibrate_stream(decode, anchor_pts, pitch_pts, image_pts, length, width, progress=progress, H0=H0, need_lines=need_lines)
    rows = _rows(rid, video_id, res["anchor_pts"], res["anchor"], res["samples"], length, width, int(1e6 / SAMPLE_FPS))
    measured = [s for s in res["samples"] if s.measured]
    metrics = {"anchor_pts_us": res["anchor_pts"], "click_error_px": round(res["click_px"], 2), "click_error_m": round(res["click_m"], 2),
               "anchor_quality": round(res["anchor"].quality, 3), "samples_tried": len(res["samples"]), "samples_measured": len(measured) + 1,
               "snap_moved_px": round(res["snap_moved_px"], 1), "kept_person_points": res["snap_moved_px"] > MAX_SNAP_MOVE_PX,
               "first_pts_us": rows[0][3] if rows else None, "last_pts_us": rows[-1][4] if rows else None, **(extra or {})}
    with tx(runner.conn) as cur:
        cur.execute("DELETE FROM pitch_calibrations WHERE request_id = %s", (rid,))
        cur.executemany("""INSERT INTO pitch_calibrations (id, video_id, request_id, start_pts_us, end_pts_us, transform_matrix, pitch_length_m, pitch_width_m,
                                                           reprojection_error_px, evidence_state, quality_score) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", rows)
        cur.execute("""UPDATE pitch_calibration_requests SET status = 'SUCCEEDED', metrics = %s, failure_code = NULL, failure_detail = NULL,
                       finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s""", (json.dumps(metrics), rid))
    return metrics


def join_moments(runner: JobRunner, job: Job, org: str, video_id: str, aspect: float, length: float, width: float, decode) -> dict:
    """The match camera from the clicks of every settled or waiting moment of the video (same pitch size). Every waiting moment it pins down is
    calibrated from it, every waiting moment that does not fit it fails by name, the rest keep waiting, with the reason in their metrics."""
    with runner.conn.cursor() as cur:
        cur.execute("""SELECT id, status, anchor_pts_us, points FROM pitch_calibration_requests WHERE video_id = %s AND organization_id = %s
                         AND status IN ('SUCCEEDED', 'WAITING', 'RUNNING') AND mode = 'CLICKS' AND pitch_length_m = %s AND pitch_width_m = %s
                       ORDER BY created_at, id""",
                    (video_id, org, length, width))
        rows = cur.fetchall()
    moments = []
    for r in rows:
        pitch_pts, image_pts = _arrays(_points(r), length, width)
        moments.append(cam.Moment(r["id"], pitch_pts, image_pts, _line_clicks(_points(r), length, width)))
    sol = cam.solve(moments, aspect, length, width)
    camera_id = None
    if sol.ok:
        camera_id = str(uuid.uuid4())
        used = list(sol.click_px)
        with tx(runner.conn) as cur:
            cur.execute("""INSERT INTO pitch_cameras (id, organization_id, video_id, centre_x_m, centre_y_m, height_m, roll_deg, pitch_length_m, pitch_width_m,
                                                      moments, points, click_rms_px) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (camera_id, org, video_id, float(sol.centre[0]), float(sol.centre[1]), float(-sol.centre[2]), float(np.degrees(sol.roll)), length, width,
                         json.dumps(used), int(sum(m.clicks for m in moments if m.key in used)), round(sol.rms_px, 2)))
    waiting = [r for r in rows if r["status"] in ("WAITING", "RUNNING") and len(_landmarks(_points(r))) < MIN_TRUSTED_CLICKS]
    settled = failed = 0
    for i, r in enumerate(waiting):
        rid = r["id"]
        pitch_pts, image_pts = _arrays(_points(r), length, width)
        if rid in sol.H:
            extra = {"from_camera": camera_id, "camera_line_sigma_px": round(sol.sigma_px[rid], 1), "camera_click_px": round(sol.click_px[rid], 1)}
            runner.progress(job, 10 + 85 * i / max(1, len(waiting)), "Calibrating a moment from the match camera")
            near = rid in sol.near
            try:
                _settle(runner, rid, video_id, decode, int(r["anchor_pts_us"]), pitch_pts, image_pts, length, width, H0=sol.H[rid], need_lines=near, extra=extra)
                settled += 1
                continue
            except JobError as e:
                if not (near and e.code == "LINES_DO_NOT_MATCH"):
                    _fail(runner, rid, e.code, str(e))
                    failed += 1
                    continue
                why = str(e)                                                # roughly known and the lines did not confirm: it waits for more clicks
            _wait(runner, rid, why, sol)
        elif sol.left_out.get(rid) == cam.DOES_NOT_FIT:
            _fail(runner, rid, "DOES_NOT_FIT_CAMERA", cam.DOES_NOT_FIT)
            failed += 1
        else:
            _wait(runner, rid, sol.left_out.get(rid) or sol.reason or "Waiting for more moments.", sol)
    return {"camera": camera_id, "settled": settled, "failed": failed, "waiting": len(waiting) - settled - failed}


def _wait(runner: JobRunner, rid: str, why: str, sol: cam.Solution) -> None:
    """The moment keeps no positions and waits, with the reason (shown to the person) and how well the camera knows it."""
    sigma = sol.sigma_px.get(rid)
    metrics = {"waiting": why, "camera_line_sigma_px": None if sigma is None or not np.isfinite(sigma) else round(sigma, 1), "camera_points": sol.points}
    with tx(runner.conn) as cur:
        cur.execute("UPDATE pitch_calibration_requests SET status = 'WAITING', metrics = %s, failure_code = NULL, failure_detail = NULL WHERE id = %s",
                    (json.dumps(metrics), rid))


def auto_calibrate(frames, detect, aspect: float, length: float, width: float, moments: list[cam.Moment],
                   known: tuple[np.ndarray, float] | None, progress=None) -> dict:
    """The automatic calibration of a video from its frames [(pts_us, rgb at AUTO_WIDTH)] (a stream: only the found points and a small
    playing-surface mask are kept per frame). `detect(rgb)` -> keypoints (pitch_auto.PitchKeypoints). `moments`: the person's clicks;
    `known`: the match camera so far. Returns the measured samples [(pts_us, FrameFit)], the camera used and what was tried."""
    seen = []                                                               # (pts_us, keypoints, playing surface)
    for pts, rgb in frames:
        found = detect(rgb)
        seen.append((pts, found, geo.playing_surface_of(rgb) if len(found) >= pitch_auto.MIN_POINTS else None))
        if progress:
            progress(pts, len(seen))
    # the match camera: refined from the frames with the most pitch points (spread over the video) and the person's moments
    rich = sorted((x for x in seen if len(x[1]) >= 6), key=lambda x: -len(x[1]))[:4 * AUTO_SOLVE_FRAMES]
    rich = sorted(rich, key=lambda x: x[0])[:: max(1, len(rich) // AUTO_SOLVE_FRAMES)][:AUTO_SOLVE_FRAMES]
    auto_moments = [cam.Moment(f"auto:{pts}", np.array([pitch_auto.KEYPOINTS[k] for k, *_ in found]) * [length / geo.DEFAULT_LENGTH_M, width / geo.DEFAULT_WIDTH_M],
                               np.array([[x, y] for _, x, y, _ in found])) for pts, found, _ in rich]
    sol = cam.solve(moments + auto_moments, aspect, length, width) if auto_moments else None
    camera = (sol.centre, sol.roll) if sol is not None and sol.ok else known
    samples = []
    for pts, found, surf in seen:
        if surf is None:
            continue
        fit = pitch_auto.fit_frame(found, aspect, camera, length, width)
        if fit is not None and geo.covers_surface(fit.H, surf, length, width):
            samples.append((pts, fit))
    return {"samples": samples, "solution": sol if sol is not None and sol.ok else None, "camera": camera, "frames": len(seen),
            "frames_with_points": sum(1 for x in seen if len(x[1]) >= pitch_auto.MIN_POINTS)}


def auto_rows(samples: list[tuple[int, "pitch_auto.FrameFit"]], camera: tuple[np.ndarray, float] | None, aspect: float, cuts: list[int]) -> list[tuple[int, int, np.ndarray, float, float]]:
    """The stored pitch slices [(start, end, H, rms px, quality)] of an automatic calibration. One pitch per 2 s was wrong for moving
    players: the camera turns during those 2 s, so a player's position drifted inside a slice and jumped at the next (owner's match, track
    1259: every one-second step across a boundary read 12-27 km/h, inside a slice 1-10 km/h; 2026-11-01). Between two calibrated frames of one
    shot (no cut between, at most AUTO_BRIDGE_US apart) the camera's pan, tilt and zoom are interpolated for every analysed frame; a frame
    without a calibrated neighbour covers only AUTO_ISOLATED_US each side."""
    q = lambda f: float(max(0.0, 1.0 - f.sigma_px / (2 * cam.MAX_LINE_SIGMA_PX))) if f.sigma_px is not None else 0.5
    samples = sorted(samples, key=lambda x: x[0])
    pair = [False] * len(samples)                                           # pair[i]: sample i and i+1 are interpolated
    for i in range(len(samples) - 1):
        (ta, fa), (tb, fb) = samples[i], samples[i + 1]
        pair[i] = (camera is not None and fa.view is not None and fb.view is not None and 0 < tb - ta <= AUTO_BRIDGE_US
                   and not any(ta < c <= tb for c in cuts))
    out = []
    half = AUTO_FRAME_US // 2
    for i, (ta, fa) in enumerate(samples):
        if pair[i]:
            tb, fb = samples[i + 1]
            pa, ta_, la = fa.view[0], fa.view[1], np.log(fa.view[2])
            dp = (fb.view[0] - pa + np.pi) % (2 * np.pi) - np.pi              # the short way round
            dt_, dl = fb.view[1] - ta_, np.log(fb.view[2]) - la
            n = max(1, int(round((tb - ta) / AUTO_FRAME_US)))
            for k in range(n):
                u = k / n
                H = cam.homography(camera[0], camera[1], pa + u * dp, ta_ + u * dt_, float(np.exp(la + u * dl)), aspect)
                t = ta + int(round(u * (tb - ta)))
                out.append((max(0, t - half), t + half, H / H[2, 2], max(fa.rms_px, fb.rms_px), min(q(fa), q(fb))))
        elif i > 0 and pair[i - 1]:
            out.append((max(0, ta - half), ta + half, fa.H, fa.rms_px, q(fa)))   # the end of an interpolated stretch
        else:
            out.append((max(0, ta - AUTO_ISOLATED_US), ta + AUTO_ISOLATED_US, fa.H, fa.rms_px, q(fa)))
    return out


def _auto(runner: JobRunner, job: Job, rid: str, org: str, video_id: str, path: str, duration: int | None, aspect: float, length: float, width: float) -> dict:
    try:
        net = pitch_auto.PitchKeypoints(os.environ.get("OTSI_VIE_INFERENCE_DEVICE", "GPU"), "f16")
    except RuntimeError as e:
        return _fail(runner, rid, "MODEL_MISSING", f"The pitch model is not installed on this machine: {e}")
    with runner.conn.cursor() as cur:
        cur.execute("""SELECT id, points FROM pitch_calibration_requests WHERE video_id = %s AND organization_id = %s AND mode = 'CLICKS'
                         AND status IN ('SUCCEEDED', 'WAITING') AND pitch_length_m = %s AND pitch_width_m = %s ORDER BY created_at, id""", (video_id, org, length, width))
        mine = cur.fetchall()
        cur.execute("SELECT centre_x_m, centre_y_m, height_m, roll_deg FROM pitch_cameras WHERE video_id = %s AND organization_id = %s ORDER BY created_at DESC, id DESC LIMIT 1",
                    (video_id, org))
        c = cur.fetchone()
    moments = [cam.Moment(r["id"], *_arrays(_points(r), length, width), _line_clicks(_points(r), length, width)) for r in mine]
    known = (np.array([c["centre_x_m"], c["centre_y_m"], -c["height_m"]], float), float(np.radians(c["roll_deg"]))) if c else None
    with runner.conn.cursor() as cur:
        cur.execute("SELECT first_start_us, first_end_us, second_start_us, second_end_us FROM match_periods WHERE video_id = %s", (video_id,))
        mp = cur.fetchone()
    windows = [(0, None)] if not mp else [(int(mp["first_start_us"]), int(mp["first_end_us"]))] + (
        [(int(mp["second_start_us"]), int(mp["second_end_us"]))] if mp["second_start_us"] is not None else [])
    frames = ((f.pts_us, f.rgb) for a, b in windows
              for f in ff.decode_sampled(path, 1.0 / AUTO_STEP_S, max_width=AUTO_WIDTH, start_us=a, end_us=b, seek=a > 0))
    total = duration or 1

    def progress(pts, n):
        if n % 25 == 0:
            runner.progress(job, 5 + 85 * min(1.0, pts / total), f"Finding the pitch automatically ({n} frames)")
    res = auto_calibrate(frames, net, aspect, length, width, moments, known, progress)
    runner.progress(job, 95, "Saving the pitch positions")
    with runner.conn.cursor() as cur:                                     # camera cuts found by the latest analysis: never interpolated across
        cur.execute("""SELECT s.start_pts_us FROM video_shots s WHERE s.video_id = %s AND s.run_id = (SELECT r.id FROM pipeline_runs r WHERE r.video_id = %s
                         ORDER BY r.created_at DESC LIMIT 1)""", (video_id, video_id))
        cuts = [int(r["start_pts_us"]) for r in cur.fetchall()]
    rows = [(str(uuid.uuid4()), video_id, rid, s0, s1, json.dumps(H.tolist()), length, width, float(rms), "INFERRED", float(qq))
            for s0, s1, H, rms, qq in auto_rows(res["samples"], res["camera"], aspect, cuts)]
    camera_id = None
    sol = res["solution"]
    with tx(runner.conn) as cur:
        if sol is not None:
            camera_id = str(uuid.uuid4())
            used = [k for k in sol.click_px if not k.startswith("auto:")] + [rid]
            cur.execute("""INSERT INTO pitch_cameras (id, organization_id, video_id, centre_x_m, centre_y_m, height_m, roll_deg, pitch_length_m, pitch_width_m,
                                                      moments, points, click_rms_px) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (camera_id, org, video_id, float(sol.centre[0]), float(sol.centre[1]), float(-sol.centre[2]), float(np.degrees(sol.roll)), length, width,
                         json.dumps(used), int(sol.points), round(sol.rms_px, 2)))
        cur.executemany("""INSERT INTO pitch_calibrations (id, video_id, request_id, start_pts_us, end_pts_us, transform_matrix, pitch_length_m, pitch_width_m,
                                                           reprojection_error_px, evidence_state, quality_score) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""", rows)
        metrics = {"mode": "AUTO", "frames_tried": res["frames"], "frames_with_pitch_points": res["frames_with_points"], "samples_measured": len(res["samples"]),
                   "slices_stored": len(rows),
                   "step_s": AUTO_STEP_S, "match_time": mp is not None, "camera_refined": camera_id, "camera_known_before": known is not None, "model": pitch_auto.KEY, "device": net.device,
                   "first_pts_us": rows[0][3] if rows else None, "last_pts_us": rows[-1][4] if rows else None}
        cur.execute("UPDATE pitch_calibration_requests SET status = 'SUCCEEDED', metrics = %s, finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s", (json.dumps(metrics), rid))
    return {"request_id": rid, **{k: v for k, v in metrics.items() if k in ("frames_tried", "samples_measured")}}


def handle_calibrate_pitch(runner: JobRunner, job: Job) -> dict:
    store = LocalStore(os.environ["OTSI_VIE_STORAGE_DIR"])
    org, rid = job.organization_id, job.payload["request_id"]
    with runner.conn.cursor() as cur:
        cur.execute("""SELECT r.id, r.status, r.mode, r.video_id, r.anchor_pts_us, r.points, r.pitch_length_m, r.pitch_width_m, v.state, v.duration_us, v.width, v.height,
                              a.object_key
                         FROM pitch_calibration_requests r JOIN video_sources v ON v.id = r.video_id AND v.organization_id = r.organization_id
                         LEFT JOIN assets a ON a.id = v.source_asset_id WHERE r.id = %s AND r.organization_id = %s""", (rid, org))
        row = cur.fetchone()
    if not row:
        raise JobError("NOT_FOUND", "The calibration request no longer exists.")
    if row["status"] in ("SUCCEEDED", "FAILED", "WAITING"):
        return {"request_id": rid, "status": row["status"], "note": "already settled"}
    if row["state"] != "INGESTED" or not row["object_key"]:
        return _fail(runner, rid, "VIDEO_NOT_READY", "The video has not been verified, so it cannot be calibrated.")
    with tx(runner.conn) as cur:
        cur.execute("UPDATE pitch_calibration_requests SET status = 'RUNNING' WHERE id = %s", (rid,))
        cur.execute("DELETE FROM pitch_calibrations WHERE request_id = %s", (rid,))      # a retry starts clean
    length, width = float(row["pitch_length_m"]), float(row["pitch_width_m"])
    if row["mode"] == "AUTO":
        aspect = float(row["width"]) / float(row["height"]) if row["width"] and row["height"] else 16 / 9
        runner.progress(job, 3, "Loading the pitch model")
        return _auto(runner, job, rid, org, str(row["video_id"]), str(store.path(row["object_key"])), int(row["duration_us"]) if row["duration_us"] else None,
                     aspect, length, width)
    points = _points(row)
    unknown = [p["landmark"] for p in _landmarks(points) if p["landmark"] not in geo.landmarks(length, width)]
    if unknown:
        return _fail(runner, rid, "UNKNOWN_LANDMARK", f"Not a pitch landmark: {unknown[0]}")
    bad = [p["line"] for p in points if "line" in p and p["line"] not in geo.template_lines(length, width, 1.0)]
    if bad:
        return _fail(runner, rid, "UNKNOWN_LINE", f"Not a pitch line: {bad[0]}")
    landmarks = len(_landmarks(points))
    pitch_pts, image_pts = _arrays(points, length, width)
    anchor_pts, video_id = int(row["anchor_pts_us"]), str(row["video_id"])
    duration = int(row["duration_us"]) if row["duration_us"] else None
    aspect = float(row["width"]) / float(row["height"]) if row["width"] and row["height"] else 16 / 9
    path = str(store.path(row["object_key"]))

    def decode(lo: int, hi: int) -> list[tuple[int, np.ndarray]]:
        return [(f.pts_us, f.rgb) for f in ff.decode_sampled(path, SAMPLE_FPS, max_width=WORK_WIDTH, start_us=max(0, lo), end_us=hi if duration is None else min(hi, duration), seek=True)]

    runner.progress(job, 5, "Checking the marked frame")
    if landmarks >= 4:                                                      # 4+ landmarks may fix the moment alone (6+ always can, when they agree)
        try:
            metrics = _settle(runner, rid, video_id, decode, anchor_pts, pitch_pts, image_pts, length, width, progress=lambda p, m: runner.progress(job, p, m))
        except JobError as e:                                               # a wrong anchor fails in seconds, not after the minutes of the whole stretch
            if landmarks >= MIN_TRUSTED_CLICKS:                            # fewer: the match camera decides (on one line, unconfirmed, or off: it judges)
                return _fail(runner, rid, e.code, str(e))
        else:
            joined = join_moments(runner, job, org, video_id, aspect, length, width, decode)    # its clicks may settle moments that were waiting
            return {"request_id": rid, **{k: v for k, v in metrics.items() if k.startswith("samples")}, **joined}
    # 2-5 clicks that could not fix the moment alone (the lines did not confirm them, or they lie on one line): the match camera decides, now or
    # once later moments add enough clicks
    runner.progress(job, 8, "Working out the match camera from all your moments")
    joined = join_moments(runner, job, org, video_id, aspect, length, width, decode)
    with runner.conn.cursor() as cur:
        cur.execute("SELECT status FROM pitch_calibration_requests WHERE id = %s", (rid,))
        status = cur.fetchone()["status"]
    return {"request_id": rid, "status": status, **joined}


def _fail(runner: JobRunner, rid: str, code: str, detail: str) -> dict:
    with tx(runner.conn) as cur:
        cur.execute("UPDATE pitch_calibration_requests SET status = 'FAILED', failure_code = %s, failure_detail = %s, finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s", (code, detail[:2000], rid))
    return {"request_id": rid, "status": "FAILED", "failure_code": code}
