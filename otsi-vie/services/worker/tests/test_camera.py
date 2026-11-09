"""One camera for the whole match (vie_worker.camera) and moments joined through it (pitch_job.join_moments): owner request 2026-10-31,
"calibrate 2-3 points in one shot, then another 2-3 in another shot ... ONE complete pitch calibration"."""
from __future__ import annotations

import json
import uuid

import numpy as np
import pytest
from scipy import ndimage

from vie_worker import camera as cam, geometry as g

AS = 16 / 9
CAMERA = np.array([2.0, 51.8, -10.8])            # the camera solved from the owner's match clicks: 18 m behind the near touchline, 11 m up
ROLL = np.radians(-0.5)
W, Hh = 640, 360
LM = g.landmarks()


def view(target: tuple[float, float], f: float) -> np.ndarray:
    pan, tilt = cam._aim(CAMERA, np.array(target))
    return cam.homography(CAMERA, ROLL, pan, tilt, f, AS)


def clicks(H: np.ndarray, names: list[str], noise_px: float = 0.0, seed: int = 0) -> cam.Moment:
    P = np.array([LM[n] for n in names])
    img = g.project(H, P) + np.random.default_rng(seed).normal(0, noise_px, (len(names), 2)) / np.array([1280, 720])
    return cam.Moment(f"m{seed}-{len(names)}", P, img)


def visible(H: np.ndarray) -> list[str]:
    """The landmarks in the picture, spread out first (each next one as far as possible from those before), as a person would pick them."""
    q = g.project(H, np.array(list(LM.values())))
    inside = [(n, p) for n, p in zip(LM, q) if np.isfinite(p).all() and 0.05 < p[0] < 0.95 and 0.08 < p[1] < 0.92]
    order = [inside.pop(int(np.argmin([p[0] for _, p in inside])))] if inside else []
    while inside:
        d = [min(np.hypot(*((p - o) * [16, 9])) for _, o in order) for _, p in inside]
        order.append(inside.pop(int(np.argmax(d))))
    return [n for n, _ in order]


def line_error_px(Ha: np.ndarray, Hb: np.ndarray) -> float:
    pts = np.concatenate(list(g.template_lines(105, 68, 2.0).values()))
    a, b = g.project(Ha, pts), g.project(Hb, pts)
    ok = np.isfinite(a).all(1) & np.isfinite(b).all(1) & (a > 0).all(1) & (a < 1).all(1)
    return float(np.max(np.hypot(*((a[ok] - b[ok]) * np.array([1280, 720])).T)))


VIEWS = [((-40.0, 0.0), 1.3), ((-20.0, -5.0), 1.2), ((0.0, 0.0), 1.1), ((20.0, 5.0), 1.25), ((40.0, 0.0), 1.35)]


def test_the_camera_model_is_the_homography_of_a_real_camera():
    H = view((-30.0, 0.0), 1.3)
    d = cam.decompose(H / H[2, 2], AS, np.array(list(LM.values())))
    assert d is not None
    C, roll, pan, tilt, f = d
    assert np.allclose(C, CAMERA, atol=1e-6) and abs(roll - ROLL) < 1e-6 and abs(f - 1.3) < 1e-6
    assert line_error_px(cam.homography(C, roll, pan, tilt, f, AS), H) < 1e-6


def test_moments_of_one_camera_join_into_it_and_three_clicks_place_a_new_moment():
    seed_H = view(*VIEWS[0])
    moments = [clicks(seed_H, visible(seed_H)[:6], seed=1)]                                   # one careful moment (6 places)
    truths = {}
    for i, (t, f) in enumerate(VIEWS[1:], 2):
        H = view(t, f)
        m = clicks(H, visible(H)[:4], seed=i)
        moments.append(m); truths[m.key] = H
    s = cam.solve(moments, AS)
    assert s.ok and np.allclose(s.centre, CAMERA, atol=0.05) and abs(s.roll - ROLL) < 1e-3
    assert set(s.H) == {m.key for m in moments}                                               # exact clicks: every moment placed (alone, or as a start the lines confirm)
    for k, H in truths.items():
        assert line_error_px(s.H[k], H) < 0.5
    # a new moment with only three places, under the known camera
    Hn = view((10.0, 8.0), 1.4)
    new = clicks(Hn, visible(Hn)[:3], seed=9)
    s2 = cam.solve(moments + [new], AS)
    assert new.key in s2.H and line_error_px(s2.H[new.key], Hn) < 0.5


def test_with_real_click_error_a_moment_is_only_trusted_as_far_as_its_lines_are_known():
    """3 px click error (the owner's, measured on his 720p match): 2 places cannot fix a moment's zoom; the engine's own uncertainty says so."""
    moments = []
    for i, (t, f) in enumerate(VIEWS):
        H = view(t, f)
        moments.append(clicks(H, visible(H)[:6], noise_px=3.0, seed=i))
    Hn = view((-30.0, 6.0), 1.5)
    two = clicks(Hn, visible(Hn)[:2], noise_px=3.0, seed=11)
    s = cam.solve(moments + [two], AS)
    assert s.ok and np.linalg.norm(s.centre - CAMERA) < 3.0
    assert two.key not in s.measured                                                          # never stands on two clicks alone
    if two.key in s.H:                                                                       # at most a start the white lines must confirm
        assert two.key in s.near and s.sigma_px[two.key] <= cam.MAX_START_SIGMA_PX
    else:
        assert s.left_out[two.key] == cam.NEED_MORE
    for m in moments:                                                                         # what it trusts is as good as it says
        if m.key in s.measured:
            assert line_error_px(s.H[m.key], view(*VIEWS[int(m.key[1])])) <= 3 * cam.MAX_LINE_SIGMA_PX


def test_a_moment_that_does_not_fit_the_camera_is_named_not_bent_in():
    moments = []
    for i, (t, f) in enumerate(VIEWS[:4]):
        H = view(t, f)
        moments.append(clicks(H, visible(H)[:5], noise_px=1.0, seed=i))
    H = view(*VIEWS[4])
    names = visible(H)[:5]
    wrong = cam.Moment("wrong", np.array([[LM[n][0], -LM[n][1]] for n in names]), g.project(H, np.array([LM[n] for n in names])))   # top and bottom swapped
    s = cam.solve(moments + [wrong], AS)
    assert s.ok and s.left_out.get("wrong") == cam.DOES_NOT_FIT and "wrong" not in s.H
    assert np.linalg.norm(s.centre - CAMERA) < 1.0


def test_two_moments_that_disagree_are_not_blamed_and_too_few_clicks_wait():
    Ha, Hb = view(*VIEWS[0]), view(*VIEWS[3])
    a = clicks(Ha, visible(Ha)[:6], seed=1)
    names = visible(Hb)[:6]
    b = cam.Moment("b", np.array([[LM[n][0], -LM[n][1]] for n in names]), g.project(Hb, np.array([LM[n] for n in names])))
    s = cam.solve([a, b], AS)
    assert s.left_out.get("b", "") != cam.DOES_NOT_FIT and s.left_out.get(a.key, "") != cam.DOES_NOT_FIT
    few = cam.solve([clicks(Ha, visible(Ha)[:2], seed=2)], AS)
    assert not few.ok and "Mark about" in few.reason and not few.H


def test_a_centre_view_with_all_its_places_on_the_halfway_line_joins_with_an_honest_uncertainty():
    """Owner's centre-circle view (45:01): the centre landmarks all lie on the halfway line; alone they fix nothing, under the camera they do,
    and the engine's uncertainty covers the true error (the line says little about the picture's left and right edges)."""
    moments = []
    for i, (t, f) in enumerate(VIEWS):
        H = view(t, f)
        moments.append(clicks(H, visible(H)[:6], noise_px=3.0, seed=i))
    names = ["halfway line, top touchline", "centre circle, top", "centre spot", "centre circle, bottom", "halfway line, bottom touchline"]
    inside = 0
    for trial in range(8):
        rng = np.random.default_rng(100 + trial)
        Ht = view((rng.normal(0, 3), rng.normal(0, 3)), float(rng.uniform(0.55, 0.85)))
        P = np.array([LM[n] for n in names])
        img = g.project(Ht, P) + rng.normal(0, 3.0, (5, 2)) / np.array([1280, 720])
        assert g.fit_from_points(P, img, 1280, 720).collinear                                    # on one line: nothing alone
        s = cam.solve(moments + [cam.Moment("centre", P, img)], AS)
        assert "centre" in s.views and np.isfinite(s.sigma_px["centre"])
        pan, tilt, f = s.views["centre"]
        err = line_error_px(cam.homography(s.centre, s.roll, pan, tilt, f, AS), Ht)
        inside += err <= 2.5 * s.sigma_px["centre"]
        assert ("centre" in s.H) == (s.sigma_px["centre"] <= cam.MAX_START_SIGMA_PX)
    assert inside >= 7                                                                           # its uncertainty is honest


def on_line(H: np.ndarray, name: str, n: int, noise_px: float = 0.0, seed: int = 0) -> list[cam.LineClick]:
    """n clicks spread along the visible part of a pitch line, as a person would click anywhere on it."""
    q = g.project(H, g.template_lines(105, 68, 0.1)[name])
    q = q[np.isfinite(q).all(1) & (q > 0.03).all(1) & (q < 0.97).all(1)]
    pick = q[np.linspace(0, len(q) - 1, n).astype(int)] + np.random.default_rng(seed).normal(0, noise_px, (n, 2)) / np.array([1280, 720])
    return [cam.line_click(name, x, y) for x, y in pick]


def test_a_click_anywhere_on_a_line_is_one_equation_and_places_a_centre_view():
    """Owner's centre view: the halfway places alone leave the picture's left and right open; clicks anywhere on the far touchline and the
    centre circle close them."""
    H = view((0.0, 0.0), 0.7)
    c = on_line(H, "touchline top", 1)[0]
    assert abs(cam._line_residual(H, c, AS)) < 0.05                                          # on the line as drawn: no distance
    assert abs(cam._line_residual(g.shift_matrix(0.0, 0.01) @ H, c, AS)) > 3.0                # the line moved 7 px: the click no longer is on it
    circ = on_line(H, "centre circle", 1)[0]
    assert cam._line_residual(H, circ, AS) < 0.2
    moments = []
    for i, (t, f) in enumerate(VIEWS):
        Hm = view(t, f)
        moments.append(clicks(Hm, visible(Hm)[:6], noise_px=3.0, seed=i))
    names = ["halfway line, top touchline", "centre circle, top", "centre spot", "centre circle, bottom", "halfway line, bottom touchline"]
    P = np.array([LM[n] for n in names])
    img = g.project(H, P) + np.random.default_rng(7).normal(0, 3.0, (5, 2)) / np.array([1280, 720])
    bare = cam.solve(moments + [cam.Moment("centre", P, img)], AS)
    lined = cam.solve(moments + [cam.Moment("centre", P, img, on_line(H, "touchline top", 3, 3.0, 8) + on_line(H, "centre circle", 2, 3.0, 9))], AS)
    assert lined.sigma_px["centre"] < bare.sigma_px["centre"]                                # the lines pin the picture's sides down
    pan, tilt, f = lined.views["centre"]
    assert line_error_px(cam.homography(lined.centre, lined.roll, pan, tilt, f, AS), H) <= 2.5 * lined.sigma_px["centre"]
    assert cam.Moment("x", P[:1], img[:1], on_line(H, "touchline top", 2)).equations == 4


# ------------------------------------------------------------------ the CALIBRATE_PITCH job joining moments in the database
def picture(H: np.ndarray, lines: bool = True) -> np.ndarray:
    rgb = np.zeros((Hh, W, 3), np.uint8)
    rgb[:] = (62, 112, 48)
    ys, xs = np.mgrid[0:Hh, 0:W]
    Q = g.unproject(H, np.c_[(xs.ravel() + 0.5) / W, (ys.ravel() + 0.5) / Hh])
    off = ~(np.isfinite(Q).all(1) & (np.abs(Q[:, 0]) <= 55.5) & (np.abs(Q[:, 1]) <= 37.0))    # beyond the pitch and its run-off: stands, boards, sky
    rgb.reshape(-1, 3)[off] = (128, 124, 120)
    if lines:
        m = np.zeros((Hh, W), bool)
        for pts in g.template_lines(105, 68, 0.2).values():
            p = g.project(H, pts) * np.array([W, Hh])
            p = p[np.isfinite(p).all(1)]
            ok = (p[:, 0] >= 0) & (p[:, 0] < W) & (p[:, 1] >= 0) & (p[:, 1] < Hh)
            m[p[ok, 1].astype(int), p[ok, 0].astype(int)] = True
        rgb[ndimage.binary_dilation(m, iterations=1)] = (238, 238, 238)
    return rgb


class Runner:
    def __init__(self, conn):
        self.conn = conn

    def progress(self, job, pct, msg=None):
        pass


def test_join_settles_waiting_moments_from_the_camera_and_fails_the_one_that_does_not_fit(stack, root, seed):
    from vie_worker import pitch_job
    org, user, project = seed.org()
    video = str(uuid.uuid4())
    with root.cursor() as cur:
        cur.execute("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, title, original_filename, byte_size, state, created_by, width, height) "
                    "VALUES (%s, %s, %s, 'UPLOAD', 'T', 'm.mp4', 1, 'VALIDATING', %s, 1280, 720)", (video, org, project, user))
    plan = [  # (anchor seconds, view, places, status, how the person named them)
        (100, VIEWS[0], 6, "SUCCEEDED", "right"),      # a careful moment calibrated earlier
        (200, VIEWS[1], 4, "WAITING", "right"),
        (300, VIEWS[2], 4, "WAITING", "right"),
        (400, VIEWS[3], 3, "WAITING", "right"),         # three places: the camera starts it, the white lines confirm it
        (500, VIEWS[4], 4, "WAITING", "swapped"),       # top and bottom swapped: does not fit the camera
    ]
    frames, ids = {}, []
    for t, (target, f), n, status, how in plan:
        H = view(target, f)
        names = visible(H)[:n]
        img = g.project(H, np.array([LM[k] for k in names]))
        pts = [{"landmark": k if how == "right" else k.replace("top", "@").replace("bottom", "top").replace("@", "bottom"), "x": float(x), "y": float(y)} for k, (x, y) in zip(names, img)]
        if n == 3:                                                                           # clicks anywhere on a line, stored beside the landmarks
            pts += [{"line": c.name, "x": float(c.image[0]), "y": float(c.image[1])} for c in on_line(H, "touchline top", 2)]
        rid = str(uuid.uuid4()); ids.append(rid)
        with root.cursor() as cur:
            cur.execute("INSERT INTO pitch_calibration_requests (id, organization_id, video_id, anchor_pts_us, points, pitch_length_m, pitch_width_m, status, requested_by) "
                        "VALUES (%s, %s, %s, %s, %s, 105, 68, %s, %s)", (rid, org, video, t * 1_000_000, json.dumps(pts), status, user))
        frames[t * 1_000_000] = picture(H)

    def decode(lo, hi):                                  # each moment is a still frame; nothing before or after it (the shot ends)
        return [(k, v) for k, v in frames.items() if lo <= k < hi]

    out = pitch_job.join_moments(Runner(root), None, org, video, 1280 / 720, 105.0, 68.0, decode)
    assert out["camera"] and out["settled"] == 3 and out["failed"] == 1
    with root.cursor() as cur:
        cur.execute("SELECT id, status, failure_code, metrics FROM pitch_calibration_requests WHERE video_id = %s", (video,))
        rows = {r["id"]: r for r in cur.fetchall()}
        cur.execute("SELECT * FROM pitch_cameras WHERE video_id = %s", (video,))
        camrow = cur.fetchone()
        cur.execute("SELECT request_id, transform_matrix FROM pitch_calibrations WHERE video_id = %s", (video,))
        stored = {r["request_id"]: np.array(json.loads(r["transform_matrix"])) for r in cur.fetchall()}
    for rid in ids[1:4]:
        assert rows[rid]["status"] == "SUCCEEDED" and json.loads(rows[rid]["metrics"])["from_camera"] == camrow["id"]
    assert rows[ids[4]]["status"] == "FAILED" and rows[ids[4]]["failure_code"] == "DOES_NOT_FIT_CAMERA"
    assert abs(camrow["height_m"] - 10.8) < 0.3 and len(json.loads(camrow["moments"])) == 4
    for rid, (t, (target, f), *_rest) in zip(ids[1:4], plan[1:4]):
        assert line_error_px(stored[rid], view(target, f)) < 8.0                                # on the true lines, to the snap's 640 px resolution (4 px there)
    assert ids[0] not in stored                                                               # an earlier moment's own rows are not rewritten


def test_a_roughly_known_moment_whose_lines_do_not_confirm_it_waits(stack, root, seed):
    from vie_worker import pitch_job
    org, user, project = seed.org()
    video = str(uuid.uuid4())
    with root.cursor() as cur:
        cur.execute("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, title, original_filename, byte_size, state, created_by, width, height) "
                    "VALUES (%s, %s, %s, 'UPLOAD', 'T', 'm.mp4', 1, 'VALIDATING', %s, 1280, 720)", (video, org, project, user))
    frames, last = {}, None
    rng = np.random.default_rng(3)
    for i, (target, f) in enumerate(VIEWS):
        H = view(target, f)
        names = visible(H)[:6 if i < 4 else 2]
        img = g.project(H, np.array([LM[k] for k in names])) + rng.normal(0, 3.0, (len(names), 2)) / np.array([1280, 720])
        pts = [{"landmark": k, "x": float(x), "y": float(y)} for k, (x, y) in zip(names, img)]
        last = str(uuid.uuid4())
        with root.cursor() as cur:
            cur.execute("INSERT INTO pitch_calibration_requests (id, organization_id, video_id, anchor_pts_us, points, pitch_length_m, pitch_width_m, status, requested_by) "
                        "VALUES (%s, %s, %s, %s, %s, 105, 68, %s, %s)", (last, org, video, (i + 1) * 100_000_000, json.dumps(pts), "SUCCEEDED" if i < 4 else "WAITING", user))
        frames[(i + 1) * 100_000_000] = picture(H, lines=False)                                    # the paint too faint to see
    pitch_job.join_moments(Runner(root), None, org, video, 1280 / 720, 105.0, 68.0, lambda lo, hi: [(k, v) for k, v in frames.items() if lo <= k < hi])
    with root.cursor() as cur:
        cur.execute("SELECT status, metrics FROM pitch_calibration_requests WHERE id = %s", (last,))
        r = cur.fetchone()
        cur.execute("SELECT COUNT(*) AS n FROM pitch_calibrations WHERE request_id = %s", (last,))
        n = cur.fetchone()["n"]
    assert r["status"] == "WAITING" and n == 0 and json.loads(r["metrics"])["waiting"]           # two clicks, no confirming lines: no positions, a reason
