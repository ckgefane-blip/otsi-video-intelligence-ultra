"""Automatic pitch calibration (vie_worker.pitch_auto, pitch_job.auto_calibrate / AUTO requests): ADR-036, owner 2026-10-31 "Can't we have the
engine auto calibrate pitch in videos?". The keypoint network itself is measured on the owner's real match (ADR-036); here its output is
synthesised from known cameras, so every rule around it is tested exactly: decoding, the camera fit, outliers, refusals, the job."""
from __future__ import annotations

import json
import uuid

import numpy as np
import pytest

from vie_worker import camera as cam, geometry as g, pitch_auto as PA
from test_camera import AS, CAMERA, ROLL, Runner, line_error_px, picture, view

USABLE = [k for k, p in enumerate(PA.KEYPOINTS) if p is not None]


def keypoints_seen(H: np.ndarray, noise_px: float = 0.0, seed: int = 0) -> list[tuple[int, float, float, float]]:
    """What a perfect network would report for a frame drawn by H: every usable keypoint inside the picture, with optional click-like noise."""
    rng = np.random.default_rng(seed)
    out = []
    for k in USABLE:
        q = g.project(H, np.array([PA.KEYPOINTS[k]]))[0]
        if np.isfinite(q).all() and 0.02 < q[0] < 0.98 and 0.04 < q[1] < 0.96:
            q = q + rng.normal(0, noise_px, 2) / np.array([1280, 720])
            out.append((k, float(q[0]), float(q[1]), 0.9))
    return out


def test_the_keypoint_table_is_the_pitch_geometry():
    lm = g.landmarks()
    # corners, penalty spots and the centre spot of the network's table are the pitch's own landmarks
    assert PA.KEYPOINTS[0] == lm["left goal line, top corner"] and PA.KEYPOINTS[29] == lm["right goal line, bottom corner"]
    assert PA.KEYPOINTS[44] == lm["left penalty spot"] and PA.KEYPOINTS[50] == lm["centre spot"]
    assert np.allclose(PA.KEYPOINTS[54], (32.35, 0.0)) and np.allclose(PA.KEYPOINTS[56], lm["right penalty spot"])
    for k in (11, 14, 15, 18) + tuple(range(36, 44)):                      # goal-post tops and camera-dependent tangent points are never used
        assert PA.KEYPOINTS[k] is None
    for k in (47, 48, 49, 51, 52, 53):                                      # the centre-circle points lie on the circle
        assert abs(np.hypot(*PA.KEYPOINTS[k]) - g.CIRCLE_RADIUS_M) < 0.02


def test_heatmap_peaks_are_decoded_sub_pixel_and_weak_or_unused_channels_are_skipped():
    hm = np.zeros((58, 270, 480), np.float32)
    ys, xs = np.mgrid[0:270, 0:480]
    hm[0] = np.exp(-((xs - 100.3) ** 2 + (ys - 50.0) ** 2) / 4.0)           # a strong peak between pixels
    hm[1] = 0.2 * np.exp(-((xs - 200) ** 2 + (ys - 80) ** 2) / 4.0)          # too weak
    hm[11] = np.exp(-((xs - 300) ** 2 + (ys - 90) ** 2) / 4.0)               # a goal-post top: not used
    got = PA.decode(hm)
    assert [k for k, *_ in got] == [0]
    k, x, y, s = got[0]
    assert abs(x * 480 - 100.3) < 0.15 and abs(y * 270 - 50.0) < 0.15 and s > 0.9


def test_under_the_match_camera_a_frame_is_fitted_from_its_keypoints_and_a_wrong_point_is_dropped():
    H = view((-20.0, -5.0), 1.2)
    seen = keypoints_seen(H, noise_px=3.0, seed=1)
    k, x, y, s = seen[2]
    seen[2] = (k, x + 0.06, y - 0.04, s)                                    # one point badly placed (~90 px)
    fit = PA.fit_frame(seen, AS, (CAMERA, ROLL))
    assert fit is not None and fit.with_camera and len(seen) - 3 <= fit.points <= len(seen) - 1             # the bad point is dropped (and at most two edge points)
    assert line_error_px(fit.H, H) < 10 and fit.sigma_px <= cam.MAX_LINE_SIGMA_PX


def test_a_centre_view_is_found_too():
    H = view((0.0, 0.0), 0.75)
    fit = PA.fit_frame(keypoints_seen(H, 3.0, 2), AS, (CAMERA, ROLL))
    assert fit is not None and line_error_px(fit.H, H) < 10


def test_too_few_or_disagreeing_points_are_not_measured():
    H = view((-20.0, -5.0), 1.2)
    seen = keypoints_seen(H)
    assert PA.fit_frame(seen[:PA.MIN_POINTS - 1], AS, (CAMERA, ROLL)) is None              # too few
    rng = np.random.default_rng(3)
    scattered = [(k, float(rng.uniform(0.1, 0.9)), float(rng.uniform(0.1, 0.9)), 0.9) for k, *_ in seen]
    assert PA.fit_frame(scattered, AS, (CAMERA, ROLL)) is None                             # nonsense: no camera explains it


def test_without_a_match_camera_a_homography_is_fitted_with_stricter_numbers():
    H = view((-20.0, -5.0), 1.2)
    seen = keypoints_seen(H, 1.5, 4)
    fit = PA.fit_frame(seen, AS, None)
    assert fit is not None and not fit.with_camera and line_error_px(fit.H, H) < 12
    assert PA.fit_frame(seen[:PA.MIN_POINTS_NO_CAMERA - 1], AS, None) is None


def test_auto_calibrate_refines_the_camera_from_the_match_and_skips_frames_without_a_pitch():
    rng = np.random.default_rng(5)
    frames, truth = [], {}
    for i in range(24):
        if i % 4 == 3:                                                       # a studio shot / graphics: no pitch, no points
            frames.append((i * 2_000_000, np.full((360, 640, 3), (30, 30, 40), np.uint8)))
            continue
        H = view((float(rng.uniform(-45, 45)), float(rng.uniform(-15, 15))), float(rng.uniform(0.8, 1.6)))
        truth[i * 2_000_000] = H
        frames.append((i * 2_000_000, picture(H)))

    def detect(rgb):
        pts = next((t for t, f in frames if f is rgb), None)
        return keypoints_seen(truth[pts], 3.0, int(pts // 1_000_000)) if pts in truth else []
    rough = (CAMERA + np.array([2.5, -3.0, 1.5]), ROLL + 0.01)               # the camera known so far is a few metres off
    res = PA_job().auto_calibrate(iter(frames), detect, AS, 105.0, 68.0, [], rough)
    assert res["frames"] == 24 and res["solution"] is not None
    assert np.linalg.norm(res["camera"][0] - CAMERA) < np.linalg.norm(rough[0] - CAMERA)       # refined towards the true camera
    got = dict(res["samples"])
    assert len(got) >= 14 and all(p in truth for p in got)                   # most pitch frames measured, never a studio frame
    assert np.median([line_error_px(f.H, truth[p]) for p, f in got.items()]) < 8


def PA_job():
    from vie_worker import pitch_job
    return pitch_job


# ------------------------------------------------------------------ the AUTO request through the database
class FakeNet:
    device = "TEST"

    def __init__(self, truth):
        self.truth = truth

    def __call__(self, rgb):
        return keypoints_seen(self.truth[int(rgb[0, 0, 0])], 2.0, int(rgb[0, 0, 0])) if int(rgb[0, 0, 0]) in self.truth else []


def test_an_auto_request_stores_measured_samples_and_the_refined_camera(stack, root, seed, monkeypatch):
    from vie_worker import ff, pitch_job
    org, user, project = seed.org()
    video, rid = str(uuid.uuid4()), str(uuid.uuid4())
    with root.cursor() as cur:
        cur.execute("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, title, original_filename, byte_size, state, created_by, width, height, duration_us) "
                    "VALUES (%s, %s, %s, 'UPLOAD', 'T', 'm.mp4', 1, 'VALIDATING', %s, 1280, 720, 40000000)", (video, org, project, user))
        cur.execute("INSERT INTO pitch_calibration_requests (id, organization_id, video_id, mode, anchor_pts_us, points, pitch_length_m, pitch_width_m, status, requested_by) "
                    "VALUES (%s, %s, %s, 'AUTO', 0, '[]', 105, 68, 'RUNNING', %s)", (rid, org, video, user))
    rng = np.random.default_rng(9)
    truth, frames = {}, []
    for i in range(20):
        H = view((float(rng.uniform(-45, 45)), float(rng.uniform(-15, 15))), float(rng.uniform(0.8, 1.6)))
        img = picture(H)
        img[0, 0, 0] = i + 1                                                 # the fake network knows each frame by this pixel
        truth[i + 1] = H
        frames.append(type("F", (), {"pts_us": i * 2_000_000, "rgb": img})())
    monkeypatch.setattr(pitch_job.pitch_auto, "PitchKeypoints", lambda *a, **k: FakeNet(truth))
    monkeypatch.setattr(ff, "decode_sampled", lambda *a, **k: iter(frames))

    class R(Runner):
        def progress(self, job, pct, msg=None):
            pass
    out = pitch_job._auto(R(root), None, rid, org, video, "unused.mp4", 40_000_000, 1280 / 720, 105.0, 68.0)
    assert out["frames_tried"] == 20 and out["samples_measured"] >= 14
    with root.cursor() as cur:
        cur.execute("SELECT status, metrics FROM pitch_calibration_requests WHERE id = %s", (rid,))
        r = cur.fetchone()
        cur.execute("SELECT start_pts_us, end_pts_us, evidence_state, quality_score FROM pitch_calibrations WHERE request_id = %s ORDER BY start_pts_us", (rid,))
        rows = cur.fetchall()
        cur.execute("SELECT moments FROM pitch_cameras WHERE video_id = %s", (video,))
        cams = cur.fetchall()
    m = json.loads(r["metrics"])
    assert r["status"] == "SUCCEEDED" and m["mode"] == "AUTO" and m["samples_measured"] == out["samples_measured"] and m["slices_stored"] == len(rows) and m["camera_refined"]
    assert all(x["evidence_state"] == "INFERRED" and 0 < x["quality_score"] <= 1 for x in rows)
    assert all(x["end_pts_us"] - x["start_pts_us"] <= 2 * pitch_job.AUTO_ISOLATED_US for x in rows)     # never one pitch for 2 s: interpolated frames or short windows
    assert len(cams) == 1 and rid in json.loads(cams[0]["moments"])          # removing the automatic run removes the camera it made


def test_an_auto_request_without_the_model_fails_with_a_plain_reason(stack, root, seed, monkeypatch):
    from vie_worker import pitch_job
    org, user, project = seed.org()
    video, rid = str(uuid.uuid4()), str(uuid.uuid4())
    with root.cursor() as cur:
        cur.execute("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, title, original_filename, byte_size, state, created_by) "
                    "VALUES (%s, %s, %s, 'UPLOAD', 'T', 'm.mp4', 1, 'VALIDATING', %s)", (video, org, project, user))
        cur.execute("INSERT INTO pitch_calibration_requests (id, organization_id, video_id, mode, anchor_pts_us, points, pitch_length_m, pitch_width_m, status, requested_by) "
                    "VALUES (%s, %s, %s, 'AUTO', 0, '[]', 105, 68, 'RUNNING', %s)", (rid, org, video, user))

    def missing(*a, **k):
        raise RuntimeError("model.xml is missing: run tools/models/convert_pnlcalib.py")
    monkeypatch.setattr(pitch_job.pitch_auto, "PitchKeypoints", missing)
    out = pitch_job._auto(Runner(root), None, rid, org, video, "unused.mp4", None, 16 / 9, 105.0, 68.0)
    assert out["failure_code"] == "MODEL_MISSING"


def test_between_two_calibrated_frames_of_a_shot_the_camera_is_interpolated_never_across_a_cut():
    """One pitch per 2 s made moving players jump at every slice (owner's match: 12-27 km/h across boundaries, 2026-11-01)."""
    from vie_worker import pitch_job
    pan0, tilt0 = cam._aim(CAMERA, np.array([-20.0, 0.0]))
    views = [(pan0 + k * 0.02, tilt0 + k * 0.004, 1.2 * np.exp(0.03 * k)) for k in range(3)]       # a smooth pan, tilt and zoom: frames at 0, 2, 4 s
    fits = [PA.FrameFit(cam.homography(CAMERA, ROLL, *v, AS), 9, 9, 3.0, 3.0, v, True) for v in views]
    rows = pitch_job.auto_rows([(0, fits[0]), (2_000_000, fits[1]), (4_000_000, fits[2]), (9_000_000, fits[0])], (CAMERA, ROLL), AS, cuts=[])
    mid = next(r for r in rows if r[0] <= 1_000_000 < r[1])                 # 1 s: halfway between the first two calibrated frames
    true_mid = cam.homography(CAMERA, ROLL, pan0 + 0.01, tilt0 + 0.002, 1.2 * np.exp(0.015), AS)
    assert line_error_px(mid[2], true_mid) < 0.5
    assert len([r for r in rows if r[1] <= 4_100_000]) >= 24                 # every analysed frame (6 a second) of the 4 s
    lone = [r for r in rows if r[0] <= 9_000_000 < r[1]]
    assert len(lone) == 1 and lone[0][1] - lone[0][0] == 2 * pitch_job.AUTO_ISOLATED_US          # a frame without a neighbour: a quarter second each side
    cut = pitch_job.auto_rows([(10_000_000, fits[0]), (12_000_000, fits[1])], (CAMERA, ROLL), AS, cuts=[11_000_000])
    assert len(cut) == 2 and all(r[1] - r[0] == 2 * pitch_job.AUTO_ISOLATED_US for r in cut)      # a cut between them: no interpolation


def test_the_line_test_looks_where_the_points_are():
    """Points around the centre circle of a wide shot: the far corners of the frame are uncertain, the play near the points is not; the
    line test measures the part of the frame the points span (plus a margin), never more than over the whole frame."""
    from vie_worker import geometry as geo
    pan, tilt = cam._aim(CAMERA, np.array([0.0, 0.0]))
    view = (pan, tilt, 1.4)
    H = cam.homography(CAMERA, ROLL, *view, AS)
    P = np.array([[0.0, 9.15], [0.0, -9.15], [9.15, 0.0], [-9.15, 0.0], [0.0, 0.0], [0.0, 34.0]])        # centre circle, spot, halfway line
    rng = np.random.default_rng(1)
    I = geo.project(H, P) + rng.normal(0, 2.0 / 1280, (len(P), 2))
    keep = np.ones(len(P), bool)
    whole = PA._sigma(CAMERA, ROLL, view, P, I, keep, AS, 105, 68, margin=None)
    near = PA._sigma(CAMERA, ROLL, view, P, I, keep, AS, 105, 68)
    assert near <= whole
    assert np.isfinite(near)
