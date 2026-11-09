"""Automatic pitch calibration (Blueprint 03 step 8 `geometry`, ADR-036): where the pitch is in a frame with nobody clicking.

A keypoint network finds named points of the pitch in the frame (PnLCalib's single-view model, CC BY 4.0, run by OpenVINO; registry key
`pnlcalib_sv_kp`). The decoding and the camera fit here are our own:

* the match camera (`camera.solve`, from the person's moments; table `pitch_cameras`) is known: only its pan, tilt and zoom are fitted to the
  points (3 unknowns), wrong points are dropped as outliers, and the fit's covariance says how well the lines are known in the frame;
* no match camera yet: a homography is fitted to the points (8 unknowns) with outliers dropped, and stricter numbers are required.

Honesty: a frame is calibrated only with enough agreeing points, a small error, lines known to `camera.MAX_LINE_SIGMA_PX` (with a camera) and
a pitch that covers the grass (the caller checks that). Studio, graphics and close-ups give no points and stay "not measured".

Measured on the owner's match (2026-10-31, 40 frames over the whole match): see ADR-036 and the changelog for the numbers.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares

from . import camera as cam, geometry as geo

log = logging.getLogger("vie_worker.pitch_auto")

KEY = "pnlcalib_sv_kp"
IN_W, IN_H = 960, 540                    # the network's input; its heatmaps are half that
MIN_SCORE = 0.34                         # a keypoint counts when its heatmap peak reaches this (the authors' operating point)
OUTLIER_PX = 10.0                        # a point further than this (px of 1280) from the fitted pitch is dropped and the fit repeated
MIN_POINTS = 5                           # agreeing points a frame needs
MAX_RMS_PX = 7.0                         # and how closely they must agree (px of 1280): the network places points to ~4-6 px; the line test (sigma) decides
MAX_RMS_NO_CAMERA_PX = 4.0
MIN_POINTS_NO_CAMERA = 6
SIGMA_REGION_MARGIN = 0.15               # the line test looks at the part of the frame the agreeing points span, plus this share of the frame
                                         # each side: where the evidence (and the play) is. Over the whole frame, the far corners of a wide
                                         # shot with points around the centre circle fail it although the fit is right (owner's match,
                                         # 2026-11-01: 29 % -> 42 % of match frames, 11 of 12 new frames' lines on the markings by eye)

# The network's 57 keypoints in its own pitch frame (x 0..105 along the length, y 0..68 across), from the published geometry of the pitch
# markings: corners and line crossings (1-30), where the penalty arcs meet the box fronts (31-36), the penalty spots, box-front midpoints and
# arc tops, and points of the centre circle (45-57). Not used (None): the four goal-post tops 2.44 m above the ground (12, 15, 16, 19) and the
# eight tangent points of the circles (37-44), which depend on where the camera stands. Keypoint 52 (the circle's far side) is published as
# x = 61.5, 9.0 m from the centre where its mirror 50 is 9.15 m: taken as the circle's true point, 61.65.
_X = [0, 52.5, 105, 0, 16.5, 88.5, 105, 0, 5.5, 99.5, 105, None, 0, 105, None, None, 0, 105, None, 0, 5.5, 99.5, 105, 0, 16.5, 88.5, 105,
      0, 52.5, 105, 16.5, 52.5, 88.5, 16.5, 52.5, 88.5, None, None, None, None, None, None, None, None, 11, 16.5, 20.15, 46.03, 58.97, 43.35,
      52.5, 61.65, 46.03, 58.97, 84.85, 88.5, 94]
_Y = [0, 0, 0, 13.84, 13.84, 13.84, 13.84, 24.84, 24.84, 24.84, 24.84, None, 30.34, 30.34, None, None, 37.66, 37.66, None, 43.16, 43.16,
      43.16, 43.16, 54.16, 54.16, 54.16, 54.16, 68, 68, 68, 26.68, 24.85, 26.68, 41.31, 43.15, 41.31, None, None, None, None, None, None, None,
      None, 34, 34, 34, 27.53, 27.53, 34, 34, 34, 40.47, 40.47, 34, 34, 34]
KEYPOINTS = [None if x is None else (x - 52.5, y - 34.0) for x, y in zip(_X, _Y)]     # metres about the centre spot, as `geometry`
assert len(KEYPOINTS) == 57
_FLIPS = ((1.0, 1.0), (-1.0, 1.0), (1.0, -1.0), (-1.0, -1.0))                         # which end and which side the network called which


@dataclass
class FrameFit:
    H: np.ndarray                         # pitch metres -> normalised picture
    points: int                           # agreeing keypoints
    found: int                            # keypoints the network found
    rms_px: float
    sigma_px: float | None                # how well the lines are known in the frame (with a match camera), px of 1280
    view: tuple[float, float, float] | None
    with_camera: bool


# ------------------------------------------------------------------ the network
class PitchKeypoints:
    """The keypoint network on OpenVINO. `device` GPU (the Arc) with the CPU as fallback; `precision` f16 (fast) or f32 (exact)."""

    def __init__(self, device: str = "GPU", precision: str = "f16"):
        import openvino as ov
        from .detect.base import models_dir, registry
        entry = next(m for m in registry()["models"] if m["key"] == KEY)
        d = models_dir() / KEY
        pin = entry["url_files"]["SV_kp"]["sha256"]
        w = d / "SV_kp"
        if not w.exists() or _sha256(w) != pin:
            raise RuntimeError(f"{w} is missing or not the registered file: run tools/models/fetch_url_models.py {KEY}")
        xml = d / "openvino" / pin[:16] / "model.xml"
        if not xml.exists():
            raise RuntimeError(f"{xml} is missing: run tools/models/convert_pnlcalib.py")
        core = ov.Core()
        for dev in dict.fromkeys([device, "CPU"]):
            try:
                cfg = {"INFERENCE_PRECISION_HINT": precision} if dev == "GPU" else {}
                self._model, self.device = core.compile_model(str(xml), dev, cfg), dev
                break
            except Exception as e:                                          # noqa: BLE001 - a device that cannot be opened: the next one
                log.warning("pitch keypoints: %s not usable (%s)", dev, e)
        else:
            raise RuntimeError("no OpenVINO device could run the pitch keypoint model")

    def __call__(self, rgb: np.ndarray) -> list[tuple[int, float, float, float]]:
        """[(keypoint index 0..56, x, y normalised, score)] of the usable keypoints found in the frame."""
        if rgb.shape[:2] != (IN_H, IN_W):
            from PIL import Image
            rgb = np.asarray(Image.fromarray(rgb).resize((IN_W, IN_H), Image.BILINEAR))
        x = (rgb.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        hm = self._model(x)[0][0]
        return decode(hm)


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while c := f.read(1 << 22):
            h.update(c)
    return h.hexdigest()


def decode(hm: np.ndarray) -> list[tuple[int, float, float, float]]:
    """Each keypoint's heatmap peak (sub-pixel, quadratic), when strong enough and usable."""
    out = []
    _, h, w = hm.shape
    for k in range(57):
        if KEYPOINTS[k] is None:
            continue
        ch = hm[k]
        r, c = np.unravel_index(int(np.argmax(ch)), ch.shape)
        s = float(ch[r, c])
        if s < MIN_SCORE:
            continue
        dc = 0.5 * (ch[r, c + 1] - ch[r, c - 1]) / max(2 * s - ch[r, c + 1] - ch[r, c - 1], 1e-6) if 0 < c < w - 1 else 0.0
        dr = 0.5 * (ch[r + 1, c] - ch[r - 1, c]) / max(2 * s - ch[r + 1, c] - ch[r - 1, c], 1e-6) if 0 < r < h - 1 else 0.0
        out.append((k, (c + float(np.clip(dc, -0.5, 0.5))) / w, (r + float(np.clip(dr, -0.5, 0.5))) / h, s))     # heatmap pixel j is picture pixel 2j
    return out


# ------------------------------------------------------------------ the fit
def _px(aspect: float) -> np.ndarray:
    return np.array([cam.REF_W, cam.REF_W / aspect])


def _fit_camera(P: np.ndarray, I: np.ndarray, C: np.ndarray, roll: float, aspect: float):
    """pan, tilt, zoom of the match camera that best explain the points; outliers dropped. (view, inliers mask, rms, least-squares result)."""
    px = _px(aspect)
    starts = []
    if len(P) >= 4:
        try:
            pf = geo.fit_from_points(P, I, int(cam.REF_W), int(cam.REF_W / aspect))
        except np.linalg.LinAlgError:                    # four points nearly on one line: no homography start, the grid starts remain
            pf = None
        if pf is not None and not pf.collinear:
            d = cam.decompose(pf.H, aspect, P)
            if d is not None:
                starts.append([d[2], d[3], np.log(d[4])])
    pan, tilt = cam._aim(C, P.mean(0))
    starts += [[pan, tilt, np.log(f)] for f in (0.8, 1.4, 2.4)]
    keep = np.ones(len(P), bool)
    best = None
    for x0 in starts:
        keep = np.ones(len(P), bool)
        for _ in range(3):
            def res(v, Pk=P[keep], Ik=I[keep]):
                q = geo.project(cam.homography(C, roll, v[0], v[1], float(np.exp(v[2])), aspect), Pk)
                return (np.where(np.isfinite(q), q - Ik, 10.0) * px).ravel()
            try:
                r = least_squares(res, x0, loss="soft_l1", f_scale=4.0, x_scale="jac", max_nfev=200)
            except (ValueError, np.linalg.LinAlgError):
                break
            q = geo.project(cam.homography(C, roll, r.x[0], r.x[1], float(np.exp(r.x[2])), aspect), P)
            err = np.hypot(*((np.where(np.isfinite(q), q - I, 10.0)) * px).T)
            new = err <= OUTLIER_PX
            x0 = r.x
            if new.sum() < 3 or (new == keep).all():
                keep = new
                break
            keep = new
        if keep.sum() < 3:
            continue
        rms = float(np.sqrt(np.mean(err[keep] ** 2)))
        cand = (int(keep.sum()), -rms, (float(x0[0]), float(x0[1]), float(np.exp(x0[2]))), keep.copy(), rms)
        if best is None or cand[:2] > best[:2]:
            best = cand
    return best


def _sigma(C, roll, view, P, I, keep, aspect, length, width, margin: float | None = SIGMA_REGION_MARGIN) -> float:
    """Worst 1-sigma uncertainty (px of 1280) of the pitch lines in the part of the frame the agreeing points span plus `margin` of the frame
    each side (None: the whole frame), from the 3-number fit's covariance (click floor as in camera.py)."""
    px = _px(aspect)
    v0 = np.array([view[0], view[1], np.log(view[2])])

    def proj(v, pts):
        return geo.project(cam.homography(C, roll, v[0], v[1], float(np.exp(v[2])), aspect), pts) * px
    Pk, Ik = P[keep], I[keep] * px
    J = np.zeros((2 * len(Pk), 3)); base = proj(v0, Pk)
    grid = np.concatenate(list(geo.template_lines(length, width, 3.0).values()))
    g0 = proj(v0, grid)
    lo, hi = np.zeros(2), px.copy()
    if margin is not None:
        lo, hi = np.maximum(lo, Ik.min(0) - margin * px), np.minimum(hi, Ik.max(0) + margin * px)
    inside = np.isfinite(g0).all(1) & (g0[:, 0] > lo[0]) & (g0[:, 0] < hi[0]) & (g0[:, 1] > lo[1]) & (g0[:, 1] < hi[1])
    if not inside.any():
        return float("inf")
    G = np.zeros((2 * int(inside.sum()), 3))
    for j in range(3):
        e = 1e-6; v = v0.copy(); v[j] += e
        J[:, j] = ((proj(v, Pk) - base) / e).ravel()
        G[:, j] = ((proj(v, grid[inside]) - g0[inside]) / e).ravel()
    resid = (base - Ik).ravel()
    dof = max(1, len(resid) - 3)
    s2 = max(cam.SIGMA_FLOOR_PX, float(np.sqrt(resid @ resid / dof))) ** 2
    try:
        cov = np.linalg.inv(J.T @ J) * s2
    except np.linalg.LinAlgError:
        return float("inf")
    var = np.einsum("ij,jk,ik->i", G, cov, G).reshape(-1, 2).sum(1)
    return float(np.sqrt(max(0.0, var.max())))


def fit_frame(found: list[tuple[int, float, float, float]], aspect: float, camera: tuple[np.ndarray, float] | None,
              length: float = geo.DEFAULT_LENGTH_M, width: float = geo.DEFAULT_WIDTH_M) -> FrameFit | None:
    """The pitch of one frame from the keypoints found in it, or None when they do not pin it down honestly."""
    if len(found) < (MIN_POINTS if camera else MIN_POINTS_NO_CAMERA):
        return None
    scale = np.array([length / geo.DEFAULT_LENGTH_M, width / geo.DEFAULT_WIDTH_M])
    P0 = np.array([KEYPOINTS[k] for k, *_ in found]) * scale
    I = np.array([[x, y] for _, x, y, _ in found])
    best = None
    for fx, fy in _FLIPS:
        P = P0 * np.array([fx, fy])
        if camera is not None:
            C, roll = camera
            got = _fit_camera(P, I, C, roll, aspect)
            if got is None:
                continue
            n, _, view, keep, rms = got
            cand = (n, -rms, P, keep, rms, view)
        else:
            keep = np.ones(len(P), bool)
            for _ in range(4):
                pf = geo.fit_from_points(P[keep], I[keep], int(cam.REF_W), int(cam.REF_W / aspect))
                if pf.collinear or pf.mirrored:
                    break
                err = np.hypot(*((geo.project(pf.H, P) - I) * _px(aspect)).T)
                new = err <= OUTLIER_PX
                if new.sum() < 4 or (new == keep).all():
                    keep = new
                    break
                keep = new
            if keep.sum() < 4:
                continue
            pf = geo.fit_from_points(P[keep], I[keep], int(cam.REF_W), int(cam.REF_W / aspect))
            if pf.collinear or pf.mirrored:
                continue
            d = cam.decompose(pf.H, aspect, P[keep])
            if d is None or d[0][1] <= width / 2:                              # the camera on the near side, above the pitch (the landmark convention)
                continue
            cand = (int(keep.sum()), -pf.rms_px, P, keep, pf.rms_px, None, pf.H)
        if best is None or cand[:2] > best[:2]:
            best = cand
    if best is None:
        return None
    n, _, P, keep, rms = best[:5]
    if camera is not None:
        view = best[5]
        if n < MIN_POINTS or rms > MAX_RMS_PX:
            return None
        sigma = _sigma(camera[0], camera[1], view, P, I, keep, aspect, length, width)
        if not sigma <= cam.MAX_LINE_SIGMA_PX:
            return None
        return FrameFit(cam.homography(camera[0], camera[1], *view, aspect), n, len(found), rms, sigma, view, True)
    if n < MIN_POINTS_NO_CAMERA or rms > MAX_RMS_NO_CAMERA_PX:
        return None
    H = best[6]
    return FrameFit(H / H[2, 2], n, len(found), rms, None, None, False)
