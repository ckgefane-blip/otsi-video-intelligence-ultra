"""Pitch geometry (vie_worker.geometry): fitting a pitch to what a picture shows, and refusing when it does not show enough."""
from __future__ import annotations

import numpy as np
from scipy import ndimage

from vie_worker import geometry as g

W, Hh = 640, 360


def true_h() -> np.ndarray:
    """A camera on the stand side, high up: the pitch rectangle seen as a trapezoid, the near touchline low in the picture."""
    pitch = np.array([[-52.5, -34], [52.5, -34], [52.5, 34], [-52.5, 34]], float)
    image = np.array([[-0.45, 0.10], [1.45, 0.10], [2.4, 1.15], [-1.4, 1.15]], float)
    return g.dlt(pitch, image)


def render_mask(H: np.ndarray, keep=None) -> np.ndarray:
    """The picture's white-line mask for a camera H: every template point drawn as a 2 px dot (what the line detector would return)."""
    m = np.zeros((Hh, W), bool)
    for name, pts in g.template_lines(step=0.15).items():
        if keep and not keep(name):
            continue
        p = g.project(H, pts) * np.array([W, Hh])
        p = p[np.isfinite(p).all(1)]
        ix, iy = np.round(p[:, 0]).astype(int), np.round(p[:, 1]).astype(int)
        ok = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < Hh)
        m[iy[ok], ix[ok]] = True
    return ndimage.binary_dilation(m, iterations=1)


def landmark_error_px(Ha: np.ndarray, Hb: np.ndarray, names=("centre spot", "halfway line, top touchline", "halfway line, bottom touchline", "centre circle, top")) -> float:
    lm = g.landmarks()
    pts = np.array([lm[n] for n in names])
    d = (g.project(Ha, pts) - g.project(Hb, pts)) * np.array([W, Hh])
    return float(np.sqrt((d ** 2).sum(1)).max())


def test_four_clicked_landmarks_give_the_pitch_and_the_error_is_reported():
    H = true_h()
    lm = g.landmarks()
    names = ["centre spot", "left penalty area, top front corner", "left penalty area, bottom front corner", "right penalty area, top front corner", "halfway line, top touchline"]
    pitch = np.array([lm[n] for n in names])
    image = g.project(H, pitch)
    fit = g.fit_from_points(pitch, image, 1280, 720)
    assert not fit.collinear and not fit.mirrored and fit.rms_px < 1e-6 and fit.rms_m < 1e-6
    assert np.allclose(g.project(fit.H, np.array([[10.0, 5.0]])), g.project(H, np.array([[10.0, 5.0]])), atol=1e-9)
    # a click that is a few pixels off shows in the reported error (in pixels and in metres), it is not hidden
    noisy = image + np.array([[3, -2], [0, 0], [-2, 3], [0, 0], [2, 2]]) / np.array([1280, 720])
    fit2 = g.fit_from_points(pitch, noisy, 1280, 720)
    assert 0.3 < fit2.rms_px < 6 and fit2.rms_m > 0.05


def test_points_on_one_line_or_with_mirrored_labels_are_refused_not_guessed():
    H = true_h()
    lm = g.landmarks()
    line = ["halfway line, top touchline", "centre circle, top", "centre spot", "centre circle, bottom", "halfway line, bottom touchline"]
    pitch = np.array([lm[n] for n in line])
    assert g.fit_from_points(pitch, g.project(H, pitch), 1280, 720).collinear            # the halfway line alone does not fix a pitch
    names = ["centre spot", "left penalty area, top front corner", "left penalty area, bottom front corner", "right penalty area, top front corner"]
    pitch = np.array([lm[n] for n in names])
    mirrored = g.project(H, pitch * np.array([1, -1]))                                    # the person swapped top and bottom: a mirror image of the pitch
    assert g.fit_from_points(pitch, mirrored, 1280, 720).mirrored
    assert not g.fit_from_points(pitch, g.project(H, pitch), 1280, 720).mirrored         # a normal view, and the same view turned 180 degrees, are fine
    turned = g.project(H, pitch * np.array([-1, -1]))
    assert not g.fit_from_points(pitch, turned, 1280, 720).mirrored


def test_the_template_snaps_onto_the_white_lines_from_a_rough_start():
    H = true_h()
    mask = render_mask(H)
    dt = g.distance_field(mask)
    # a rough start: the four-click fit with every click ~6 px off
    lm = g.landmarks()
    names = ["centre spot", "halfway line, top touchline", "halfway line, bottom touchline", "left penalty area, top front corner", "right penalty area, bottom front corner"]
    pitch = np.array([lm[n] for n in names])
    rng = np.random.default_rng(3)
    image = g.project(H, pitch) + rng.normal(0, 6, (len(names), 2)) / np.array([W, Hh])
    start = g.fit_from_points(pitch, image, W, Hh).H
    before = landmark_error_px(start, H)
    fit = g.refine(start, dt)
    after = landmark_error_px(fit.H, H)
    assert before > 3 and after < 1.5, (before, after)
    assert fit.well_posed and fit.quality > 0.8 and fit.on_line / fit.visible > 0.8


def test_one_line_alone_is_not_a_calibration_and_an_empty_picture_is_not_either():
    H = true_h()
    only_halfway = render_mask(H, keep=lambda n: n == "halfway line")
    fit = g.score(H, g.distance_field(only_halfway))
    assert not fit.well_posed and fit.quality < 0.5                                       # its lines do not point in two directions
    empty = g.score(H, g.distance_field(np.zeros((Hh, W), bool)))
    assert empty.quality == 0.0 and empty.on_line == 0
    off = g.score(np.eye(3) * np.array([[1], [1], [1]]), g.distance_field(render_mask(H)))   # a nonsense H sees nothing of the pitch
    assert off.quality < 0.2


def test_a_picture_position_is_placed_on_the_pitch_in_metres_and_unplaceable_points_are_none():
    H = true_h()
    x, y = g.pitch_position(H, *g.project(H, np.array([[20.0, -10.0]]))[0])
    assert abs(x - 20.0) < 1e-6 and abs(y + 10.0) < 1e-6
    behind = np.array([[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, -1.0]])
    assert g.pitch_position(behind, 0.5, 0.5) is None


def test_the_line_detector_finds_thin_white_paint_on_grass_and_not_a_white_shirt():
    img = np.zeros((360, 640, 3), np.uint8)
    img[:] = (60, 110, 45)                                                                # grass
    img[:, 300:303] = (235, 235, 235)                                                     # a painted line, 3 px wide
    img[100:160, 450:490] = (240, 240, 240)                                               # a white shirt: a big bright blob
    m = g.line_mask(img)
    assert m[:, 300:303].mean() > 0.9 and m[:, 100:200].mean() < 0.05                     # the line is found, bare grass is not
    assert m[110:150, 460:480].mean() < 0.1                                               # the blob is not a line


def test_a_fit_that_draws_a_painted_line_across_empty_grass_is_marked_inconsistent():
    H = true_h()
    mask_all = render_mask(H)
    good = g.score(H, g.distance_field(mask_all), mask=mask_all)
    assert good.consistent and good.quality > 0.5
    # the halfway line of the PICTURE is where H says, but the candidate H turns the template about the centre spot: circle and touchlines still fit, the halfway line does not
    from scipy.spatial.transform import Rotation
    th = np.radians(25)
    spin = np.array([[np.cos(th), -np.sin(th), 0], [np.sin(th), np.cos(th), 0], [0, 0, 1.0]])           # turn the pitch 25 degrees about the centre spot (metres)
    wrong = H @ spin
    # keep only what a turned template can still match: the circle (rotation-symmetric) and nothing else, plus the real halfway line
    only = render_mask(H, keep=lambda n: n in ("centre circle", "halfway line", "touchline bottom"))
    bad = g.score(wrong, g.distance_field(only), mask=only)
    assert not bad.consistent and bad.quality == 0.0 and bad.orphan > 0.30


# ------------------------------------------------------------------ following the camera through a shot (vie_worker.pitch_job)
def synthetic_shot(n: int = 14, pan_per_frame: float = 0.012):
    """A panning camera over a pitch: grass with the white pitch lines, one frame per sample, and the true H of each frame."""
    from vie_worker import pitch_job  # noqa: F401
    base = true_h()
    frames, Hs = [], []
    for i in range(n):
        Hi = g.shift_matrix(-pan_per_frame * i, 0.0) @ base
        m = render_mask(Hi)
        rgb = np.zeros((Hh, W, 3), np.uint8)
        rgb[:] = (62, 112, 48)
        rgb[ndimage.binary_dilation(m, iterations=1)] = (238, 238, 238)
        frames.append((i * 333_333, rgb)); Hs.append(Hi)
    return frames, Hs


def clicks_for(H: np.ndarray, noise_px: float = 2.0, seed: int = 5):
    lm = g.landmarks()
    names = ["centre spot", "left penalty area, top front corner", "left penalty area, bottom front corner", "right penalty area, top front corner",
             "right penalty area, bottom front corner", "halfway line, bottom touchline"]
    pitch = np.array([lm[k] for k in names])
    img = g.project(H, pitch) + np.random.default_rng(seed).normal(0, noise_px, (len(names), 2)) / np.array([W, Hh])
    return pitch, img


def test_a_calibration_is_followed_through_a_pan_both_ways_and_stops_at_a_cut():
    from vie_worker import pitch_job
    frames, Hs = synthetic_shot(n=14)
    a = 6
    pitch, img = clicks_for(Hs[a])
    res = pitch_job.calibrate(frames, frames[a][0], pitch, img, 105.0, 68.0)
    measured = [s for s in res["samples"] if s.measured]
    assert res["click_px"] < 6 and res["anchor"].quality > 0.3
    assert len(measured) >= 10                                              # the pan is followed on both sides of the anchor
    truth = {f[0]: H for f, H in zip(frames, Hs)}
    worst = max(landmark_error_px(s.fit.H, truth[s.pts_us]) for s in measured)
    assert worst < 6.0, worst                                               # every measured sample is placed on the pitch to within a few px of the truth (640 px wide)
    # a camera cut: the frames after it are another view; the calibration does not cross it
    cut_frames = frames[:9] + [(t, np.full((Hh, W, 3), (245, 245, 250), np.uint8)) for t, _ in frames[9:]]
    res2 = pitch_job.calibrate(cut_frames, cut_frames[a][0], pitch, img, 105.0, 68.0)
    assert max(s.pts_us for s in res2["samples"]) < cut_frames[9][0]


def test_clicks_that_cannot_be_right_are_refused_with_a_plain_reason():
    import pytest
    from vie_worker import pitch_job
    from vie_worker.jobs import JobError
    frames, Hs = synthetic_shot(n=6)
    pitch, img = clicks_for(Hs[3], noise_px=0.0)
    with pytest.raises(JobError) as e:
        pitch_job.calibrate(frames, frames[3][0], pitch[:1].repeat(4, 0) + np.arange(4)[:, None] * [1.0, 0.0], img[:4] * 0 + [0.5, 0.5] + np.arange(4)[:, None] * [0.1, 0.0], 105.0, 68.0)
    assert e.value.code == "POINTS_ON_ONE_LINE"
    scrambled = img.copy()[[1, 0, 3, 2, 5, 4]]                               # the landmark names no longer match the places clicked
    with pytest.raises(JobError) as e2:
        pitch_job.calibrate(frames, frames[3][0], pitch, scrambled, 105.0, 68.0)
    assert e2.value.code in ("POINTS_INCONSISTENT", "POINTS_MIRRORED", "LINES_DO_NOT_MATCH")


def parity_case() -> dict:
    """What the TypeScript implementation (packages/contracts/src/pitch.ts) must reproduce: landmarks, line sampling, a fit from points, a position."""
    import json  # noqa: F401
    out = {"landmarks": {}, "lines": {}, "fit": {}}
    for L, Wd in ((105.0, 68.0), (100.0, 64.0)):
        out["landmarks"][f"{L:g}x{Wd:g}"] = {k: [round(v[0], 6), round(v[1], 6)] for k, v in g.landmarks(L, Wd).items()}
        lines = g.template_lines(L, Wd, step=1.0)
        out["lines"][f"{L:g}x{Wd:g}"] = {k: {"n": int(len(p)), "first": [round(float(p[0, 0]), 6), round(float(p[0, 1]), 6)], "last": [round(float(p[-1, 0]), 6), round(float(p[-1, 1]), 6)]} for k, p in lines.items()}
    H = true_h()
    lm = g.landmarks()
    names = ["centre spot", "left penalty area, top front corner", "left penalty area, bottom front corner", "right penalty area, top front corner", "right penalty area, bottom front corner", "halfway line, bottom touchline"]
    pitch = np.array([lm[n] for n in names])
    image = g.project(H, pitch) + np.array([[0.002, -0.001], [0, 0], [-0.001, 0.002], [0, 0], [0.001, 0.001], [0, 0]])
    f = g.fit_from_points(pitch, image, 1280, 720)
    probe = np.array([[10.0, 5.0], [-30.0, -12.0], [45.0, 30.0]])
    out["fit"] = {"names": names, "image": [[round(float(x), 9), round(float(y), 9)] for x, y in image], "H": [[round(float(v), 9) for v in row] for row in f.H],
                  "rms_px": round(f.rms_px, 6), "rms_m": round(f.rms_m, 6), "mirrored": bool(f.mirrored), "collinear": bool(f.collinear),
                  "probe": probe.tolist(), "probe_image": [[round(float(x), 9), round(float(y), 9)] for x, y in g.project(f.H, probe)],
                  "back": [[round(float(x), 6), round(float(y), 6)] for x, y in g.unproject(f.H, g.project(f.H, probe))]}
    return out


def test_the_typescript_pitch_maths_has_the_same_numbers_as_this_one():
    """`fixtures/pitch_parity.json` is what apps/api/test/pitch.api.test.ts checks packages/contracts/src/pitch.ts against. Regenerate with OTSI_WRITE_FIXTURES=1."""
    import json
    import os
    from pathlib import Path
    path = Path(__file__).resolve().parents[3] / "fixtures" / "pitch_parity.json"
    now = parity_case()
    if os.environ.get("OTSI_WRITE_FIXTURES") == "1":
        path.write_text(json.dumps(now, indent=1), encoding="utf-8")
    assert path.exists(), "run once with OTSI_WRITE_FIXTURES=1"
    assert json.loads(path.read_text(encoding="utf-8")) == now, "the Python pitch maths changed: regenerate fixtures/pitch_parity.json (OTSI_WRITE_FIXTURES=1) and make the TypeScript match"


def test_a_fit_squeezed_into_a_band_is_not_a_calibration_because_it_does_not_cover_the_grass():
    """Owner's match 30:07: a fit squeezed along the far touchline passed every line check while covering a fraction of the grass (2026-10-31)."""
    H = true_h()
    rgb = np.zeros((Hh, W, 3), np.uint8)
    rgb[:] = (150, 150, 155)                                                    # stands and sky
    ys, xs = np.mgrid[0:Hh, 0:W]
    q = g.unproject(H, np.c_[(xs.ravel() + 0.5) / W, (ys.ravel() + 0.5) / Hh])
    on = (np.abs(q[:, 0]) <= 54) & (np.abs(q[:, 1]) <= 35) & (ys.ravel() > 0.1 * Hh)    # the turf the camera sees (pitch + a run-off)
    rgb.reshape(-1, 3)[on] = (60, 120, 50)
    assert g.covers_grass(H, rgb)
    squeezed = g.dlt(np.array([[-52.5, -34], [52.5, -34], [52.5, 34], [-52.5, 34]], float), np.array([[-0.2, 0.09], [1.2, 0.09], [1.1, 0.13], [-0.1, 0.13]], float))
    cov, pure = g.grass_coverage(squeezed, rgb)
    assert cov < 0.3 and not g.covers_grass(squeezed, rgb)


def test_the_snap_never_overrides_the_persons_clicks(monkeypatch):
    """Owner's match 29:22 and 30:17: the snap moved correct clicks by 16-55 px (shirts, shadow edges read as lines). The person's clicks win (2026-10-31)."""
    from vie_worker import pitch_job
    frames, Hs = synthetic_shot(n=14)
    a = 6
    pitch, img = clicks_for(Hs[a])
    res = pitch_job.calibrate(frames, frames[a][0], pitch, img, 105.0, 68.0)
    assert res["snap_moved_px"] <= pitch_job.MAX_SNAP_MOVE_PX and len(res["samples"]) >= 10        # clear lines: the snap refines and the camera is followed
    real = g.refine_pyramid

    def pulled(H0, mask, length=105.0, width=68.0):                        # lines that "pull" the pitch 30 px sideways (what shirts and shadows did)
        f = real(H0, mask, length, width)
        f.H = g.shift_matrix(30 / W, 0.0) @ f.H
        return f
    monkeypatch.setattr(g, "refine_pyramid", pulled)
    res = pitch_job.calibrate(frames, frames[a][0], pitch, img, 105.0, 68.0)
    assert res["snap_moved_px"] > pitch_job.MAX_SNAP_MOVE_PX
    own = g.fit_from_points(pitch, img, W, Hh).H
    assert np.allclose(g.project(res["anchor"].H, pitch), g.project(own, pitch), atol=0.1 / W)   # the saved pitch IS the person's clicks fitted, not the snap
    assert res["samples"] == []                                                       # and the camera is not followed from it


def test_six_agreeing_clicks_stand_when_the_lines_are_too_faint_and_four_are_not_enough():
    """Owner's match 28:45: 8 correct clicks agreeing to 1.8 px were refused because the line detector saw too few lines (quality 0.21) (2026-10-31)."""
    import pytest
    from vie_worker import pitch_job
    from vie_worker.jobs import JobError
    frames, Hs = synthetic_shot(n=6)
    a = 3
    grass = [(t, np.full_like(rgb, (60, 120, 50))) for t, rgb in frames]         # the same views with the paint too faint to see
    pitch, img = clicks_for(Hs[a], noise_px=0.5)
    res = pitch_job.calibrate(grass, grass[a][0], pitch, img, 105.0, 68.0)
    assert res["snap_moved_px"] > pitch_job.MAX_SNAP_MOVE_PX and res["samples"] == []    # the person's pitch, not followed
    assert np.allclose(g.project(res["anchor"].H, pitch), g.project(g.fit_from_points(pitch, img, W, Hh).H, pitch), atol=0.1 / W)
    with pytest.raises(JobError, match="6 or more places"):
        pitch_job.calibrate(grass, grass[a][0], pitch[1:5], img[1:5], 105.0, 68.0)          # four places always agree: not enough to stand alone
