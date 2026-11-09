"""Pitch geometry (Blueprint 03_MEDIA_CV_TRACKING step 8, `geometry`): where on the pitch, in metres, a point of the picture is.

A homography H maps pitch metres (origin = centre spot, x along the length, y across the width, both increasing right/down as on a top-down
diagram) to the picture in NORMALISED coordinates (x / frame width, y / frame height), the same coordinates as the boxes. It is fitted from
what the picture really shows:

* a person's clicks: >= 4 named pitch landmarks matched to places in the picture (`fit_from_points`: normalised DLT, with its reprojection
  error in metres and pixels), and
* the white pitch lines themselves (`line_mask`, `refine`): the template of the pitch lines is projected into the picture and the 8 numbers
  of H are moved until the lines lie on the white line pixels (a chamfer / distance-transform fit), so the fit snaps to the real lines and a
  click that was a few pixels off does not matter. The same refinement carries a calibration from one frame to the next as the camera pans.

Honesty rules: a fit is reported with how many template points are really on a white line pixel (`quality`) and whether the lines that
pin it down point in at least two different directions (`well_posed`). A frame with too little line evidence is NOT calibrated: no
positions, no distance, no speed (the caller shows "not measured"), never a guess. No dependency beyond numpy and scipy.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage, optimize

DEFAULT_LENGTH_M, DEFAULT_WIDTH_M = 105.0, 68.0
PENALTY_DEPTH_M, PENALTY_HALF_WIDTH_M = 16.5, 20.16
SIX_YARD_DEPTH_M, SIX_YARD_HALF_WIDTH_M = 5.5, 9.16
PENALTY_SPOT_M, CIRCLE_RADIUS_M = 11.0, 9.15


# ------------------------------------------------------------------ the pitch template
def landmarks(length: float = DEFAULT_LENGTH_M, width: float = DEFAULT_WIDTH_M) -> dict[str, tuple[float, float]]:
    """Named points a person can recognise on the pitch and in the picture (metres). `L`/`R` = the left/right end of the top-down diagram,
    `T`/`B` = its top/bottom side. Which real end is "left" is the person's choice; the pitch is symmetric."""
    hl, hw = length / 2, width / 2
    out = {"centre spot": (0.0, 0.0), "halfway line, top touchline": (0.0, -hw), "halfway line, bottom touchline": (0.0, hw),
           "centre circle, top": (0.0, -CIRCLE_RADIUS_M), "centre circle, bottom": (0.0, CIRCLE_RADIUS_M)}
    for end, s in (("left", -1.0), ("right", 1.0)):
        g = s * hl                                                          # the goal line of this end
        out[f"{end} goal line, top corner"] = (g, -hw)
        out[f"{end} goal line, bottom corner"] = (g, hw)
        out[f"{end} penalty area, top corner on the goal line"] = (g, -PENALTY_HALF_WIDTH_M)
        out[f"{end} penalty area, bottom corner on the goal line"] = (g, PENALTY_HALF_WIDTH_M)
        out[f"{end} penalty area, top front corner"] = (g - s * PENALTY_DEPTH_M, -PENALTY_HALF_WIDTH_M)
        out[f"{end} penalty area, bottom front corner"] = (g - s * PENALTY_DEPTH_M, PENALTY_HALF_WIDTH_M)
        out[f"{end} six-yard box, top corner on the goal line"] = (g, -SIX_YARD_HALF_WIDTH_M)
        out[f"{end} six-yard box, bottom corner on the goal line"] = (g, SIX_YARD_HALF_WIDTH_M)
        out[f"{end} six-yard box, top front corner"] = (g - s * SIX_YARD_DEPTH_M, -SIX_YARD_HALF_WIDTH_M)
        out[f"{end} six-yard box, bottom front corner"] = (g - s * SIX_YARD_DEPTH_M, SIX_YARD_HALF_WIDTH_M)
        out[f"{end} penalty spot"] = (g - s * PENALTY_SPOT_M, 0.0)
    return out


def _segment(p0, p1, step: float) -> np.ndarray:
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    n = max(2, int(np.ceil(np.linalg.norm(p1 - p0) / step)) + 1)
    return p0[None] + (p1 - p0)[None] * np.linspace(0, 1, n)[:, None]


def _arc(cx: float, cy: float, r: float, a0: float, a1: float, step: float) -> np.ndarray:
    n = max(8, int(np.ceil(abs(a1 - a0) * r / step)))
    a = np.linspace(a0, a1, n)
    return np.stack([cx + r * np.cos(a), cy + r * np.sin(a)], axis=1)


def template_lines(length: float = DEFAULT_LENGTH_M, width: float = DEFAULT_WIDTH_M, step: float = 0.4) -> dict[str, np.ndarray]:
    """The painted lines of the pitch as dense point sets (metres), one array per line, for drawing and for fitting."""
    hl, hw = length / 2, width / 2
    lines = {"touchline top": _segment((-hl, -hw), (hl, -hw), step), "touchline bottom": _segment((-hl, hw), (hl, hw), step),
             "left goal line": _segment((-hl, -hw), (-hl, hw), step), "right goal line": _segment((hl, -hw), (hl, hw), step),
             "halfway line": _segment((0, -hw), (0, hw), step), "centre circle": _arc(0, 0, CIRCLE_RADIUS_M, 0, 2 * np.pi, step)}
    for end, s in (("left", -1.0), ("right", 1.0)):
        g = s * hl
        px, sx = g - s * PENALTY_DEPTH_M, g - s * SIX_YARD_DEPTH_M
        lines[f"{end} penalty area front"] = _segment((px, -PENALTY_HALF_WIDTH_M), (px, PENALTY_HALF_WIDTH_M), step)
        lines[f"{end} penalty area top"] = _segment((g, -PENALTY_HALF_WIDTH_M), (px, -PENALTY_HALF_WIDTH_M), step)
        lines[f"{end} penalty area bottom"] = _segment((g, PENALTY_HALF_WIDTH_M), (px, PENALTY_HALF_WIDTH_M), step)
        lines[f"{end} six-yard front"] = _segment((sx, -SIX_YARD_HALF_WIDTH_M), (sx, SIX_YARD_HALF_WIDTH_M), step)
        lines[f"{end} six-yard top"] = _segment((g, -SIX_YARD_HALF_WIDTH_M), (sx, -SIX_YARD_HALF_WIDTH_M), step)
        lines[f"{end} six-yard bottom"] = _segment((g, SIX_YARD_HALF_WIDTH_M), (sx, SIX_YARD_HALF_WIDTH_M), step)
        # the penalty arc: the part of the circle round the penalty spot that lies outside the penalty area
        spot = g - s * PENALTY_SPOT_M
        a = np.arccos(np.clip((PENALTY_DEPTH_M - PENALTY_SPOT_M) / CIRCLE_RADIUS_M, -1, 1))        # half-angle of the arc, measured from the pitch centre direction
        centre_dir = 0.0 if s < 0 else np.pi
        lines[f"{end} penalty arc"] = _arc(spot, 0.0, CIRCLE_RADIUS_M, centre_dir - a, centre_dir + a, step)
    return lines


# ------------------------------------------------------------------ homography maths
def project(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """(n, 2) pitch metres -> (n, 2) picture coordinates under H; NaN where the point is at or behind the camera plane."""
    p = np.c_[np.asarray(pts, float), np.ones(len(pts))] @ H.T
    with np.errstate(divide="ignore", invalid="ignore"):
        out = p[:, :2] / p[:, 2:3]
    out[~(p[:, 2] > 1e-9)] = np.nan
    return out


def unproject(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """(n, 2) picture coordinates -> (n, 2) pitch metres (the ground plane under H)."""
    return project(np.linalg.inv(H), pts)


def _normalise(p: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    c = p.mean(0)
    s = np.sqrt(2) / max(np.sqrt(((p - c) ** 2).sum(1)).mean(), 1e-12)
    T = np.array([[s, 0, -s * c[0]], [0, s, -s * c[1]], [0, 0, 1.0]])
    return (np.c_[p, np.ones(len(p))] @ T.T)[:, :2], T


def dlt(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Normalised direct linear transform: H with dst ~ H src, from >= 4 point pairs (least squares beyond 4)."""
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    if len(src) < 4 or len(src) != len(dst):
        raise ValueError("at least 4 matching points are needed")
    s, Ts = _normalise(src)
    d, Td = _normalise(dst)
    A = []
    for (x, y), (u, v) in zip(s, d):
        A.append([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
        A.append([0, 0, 0, -x, -y, -1, v * x, v * y, v])
    h = np.linalg.svd(np.asarray(A))[2][-1].reshape(3, 3)
    H = np.linalg.inv(Td) @ h @ Ts
    return H / H[2, 2]


@dataclass
class PointFit:
    H: np.ndarray                   # pitch metres -> normalised picture coordinates
    rms_px: float                   # reprojection error of the clicked points, in pixels of the frame
    rms_m: float                    # the same error on the pitch, in metres (clicked picture points mapped back onto the pitch)
    mirrored: bool                  # the labels would mirror the pitch: refused
    collinear: bool                 # the points are (nearly) on one line: the fit is not determined: refused


def _spread(p: np.ndarray) -> float:
    """Smallest / largest standard deviation of a point set: ~0 for points on one line."""
    s = np.linalg.svd(p - p.mean(0), compute_uv=False)
    return float(s[-1] / max(s[0], 1e-12))


def fit_from_points(pitch_pts: np.ndarray, image_pts: np.ndarray, frame_w: int, frame_h: int) -> PointFit:
    """H from named landmarks (pitch metres) matched to places in the picture (normalised x/y). Never returns a fit that is not determined or mirrored."""
    pitch_pts, image_pts = np.asarray(pitch_pts, float), np.asarray(image_pts, float)
    collinear = _spread(pitch_pts) < 0.02 or _spread(image_pts) < 0.02
    if collinear:
        return PointFit(np.eye(3), float("inf"), float("inf"), False, True)
    H = dlt(pitch_pts, image_pts)
    proj = project(H, pitch_pts)
    px = np.array([frame_w, frame_h], float)
    rms_px = float(np.sqrt(np.nanmean((((proj - image_pts) * px) ** 2).sum(1)))) if np.isfinite(proj).all() else float("inf")
    back = unproject(H, image_pts)
    rms_m = float(np.sqrt(np.nanmean(((back - pitch_pts) ** 2).sum(1)))) if np.isfinite(back).all() else float("inf")
    # orientation: the picture of a pitch seen from above-front keeps the handedness of the top-down diagram (a turn by 180 degrees is fine, a mirror is not)
    c = project(H, np.array([[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]))
    det = (c[1, 0] - c[0, 0]) * (c[2, 1] - c[0, 1]) - (c[2, 0] - c[0, 0]) * (c[1, 1] - c[0, 1]) if np.isfinite(c).all() else 0.0
    return PointFit(H, rms_px, rms_m, bool(det <= 0), False)


# ------------------------------------------------------------------ the white lines in a picture
def line_mask(rgb: np.ndarray, work_width: int = 640) -> np.ndarray:
    """Boolean mask (at `work_width` px wide) of thin white paint on grass: bright, low colour, thin (a white top-hat), next to grass, and not part
    of a big bright blob (a shirt, a board). Pitch lines are 1-4 px wide at this size."""
    h, w = rgb.shape[:2]
    f = max(1, int(round(w / work_width)))
    small = rgb[::f, ::f].astype(np.float32) / 255
    mx, mn = small.max(2), small.min(2)
    sat = np.where(mx > 0, (mx - mn) / (mx + 1e-6), 0)
    gray = small @ np.array([0.299, 0.587, 0.114], np.float32)
    hue_green = ((small[..., 1] >= small[..., 0]) & (small[..., 1] >= small[..., 2]) & (sat > 0.08))
    k = max(5, small.shape[1] // 70)
    tophat = gray - ndimage.grey_opening(gray, size=(k, k))
    cand = (tophat > 0.07) & (sat < 0.30) & (gray > 0.28)
    grass_near = ndimage.uniform_filter(hue_green.astype(np.float32), size=2 * k + 1) > 0.18         # lines lie on or beside grass
    density = ndimage.uniform_filter(cand.astype(np.float32), size=2 * k + 1)
    return cand & grass_near & (density < 0.45)


def distance_field(mask: np.ndarray, cap_px: float = 14.0) -> np.ndarray:
    """Distance (px) from every pixel to the nearest line pixel, capped (a line far away pulls nothing)."""
    if not mask.any():
        return np.full(mask.shape, cap_px, np.float32)
    return np.minimum(ndimage.distance_transform_edt(~mask), cap_px).astype(np.float32)


def _long_line_pixels(mask: np.ndarray, min_support: int = 55, tol_px: float = 1.6, max_lines: int = 14) -> np.ndarray:
    """(n, 2) pixel coordinates (x, y) of the mask pixels that lie on a long straight line: a Hough search for lines with at least `min_support`
    collinear pixels (within `tol_px`). Painted lines qualify wherever they touch each other; players, shirts and advertising text do not
    (nothing about them is 55 pixels long and straight), and the curved circle is not a straight line."""
    ys, xs = np.nonzero(mask)
    if len(xs) < min_support:
        return np.zeros((0, 2))
    if len(xs) > 5000:
        pick = np.linspace(0, len(xs) - 1, 5000).astype(int)
        xs, ys = xs[pick], ys[pick]
    pts = np.stack([xs, ys], axis=1).astype(float)
    thetas = np.linspace(0, np.pi, 180, endpoint=False)
    cs, sn = np.cos(thetas), np.sin(thetas)
    alive = np.ones(len(pts), bool)
    found = np.zeros(len(pts), bool)
    diag = int(np.ceil(np.hypot(*mask.shape))) + 2
    for _ in range(max_lines):
        P = pts[alive]
        if len(P) < min_support:
            break
        rho = P[:, 0:1] * cs[None] + P[:, 1:2] * sn[None]                      # (n, 180)
        idx = np.round(rho).astype(int) + diag
        best, bt, br = 0, 0, 0
        for t in range(len(thetas)):
            c = np.bincount(idx[:, t], minlength=2 * diag + 2)
            c = c[:-2] + c[1:-1] + c[2:]                                       # +-1 px of rho
            r = int(np.argmax(c))
            if c[r] > best:
                best, bt, br = int(c[r]), t, r + 1
        if best < min_support:
            break
        d = np.abs(pts[:, 0] * cs[bt] + pts[:, 1] * sn[bt] - (br - diag))
        sel = alive & (d <= tol_px)
        # a painted line is one continuous stretch: its pixels span at least `min_support` px along the line and cover most of that span (gaps of up to
        # 14 px: a player standing on the line). Pieces of different players or trees that merely line up are not a line.
        along = np.sort(-pts[sel, 0] * sn[bt] + pts[sel, 1] * cs[bt])
        span = float(along[-1] - along[0]) if len(along) > 1 else 0.0
        gaps = np.diff(along)
        covered = span - float(np.clip(gaps - 14.0, 0, None).sum()) if len(gaps) else 0.0
        if span >= 45.0 and covered >= 0.6 * span:
            found |= sel
        alive &= ~sel
    return pts[found]


def orphan_fraction(H: np.ndarray, mask: np.ndarray, length: float = DEFAULT_LENGTH_M, width: float = DEFAULT_WIDTH_M, near_px: float = 4.0) -> float:
    """Share of the long thin white pixels that lie INSIDE the projected pitch outline but farther than `near_px` from every projected template line."""
    return _orphan(H, mask, length, width, near_px)


def _orphan(H, mask, length, width, near_px):
    from scipy.spatial import cKDTree
    rows, cols = mask.shape
    px = _long_line_pixels(mask)
    if len(px) < 30:
        return 0.0
    hl, hw = length / 2, width / 2
    outline = np.array([[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]])
    # the pitch outline in the picture, grown by 3 m so a line on the edge still counts as inside; clipped to the picture
    big = np.array([[-hl - 3, -hw - 3], [hl + 3, -hw - 3], [hl + 3, hw + 3], [-hl - 3, hw + 3]])
    poly = project(H, np.concatenate([_segment(big[k], big[(k + 1) % 4], 1.0) for k in range(4)])) * np.array([cols, rows])
    poly = poly[np.isfinite(poly).all(1)]
    if len(poly) < 8:
        return 0.0
    from scipy.spatial import ConvexHull
    try:
        hull = poly[ConvexHull(poly).vertices]
    except Exception:  # noqa: BLE001
        return 0.0
    # point in convex polygon (counter-clockwise from ConvexHull in 2-D)
    a, b = hull, np.roll(hull, -1, axis=0)
    cross = (b[None, :, 0] - a[None, :, 0]) * (px[:, None, 1] - a[None, :, 1]) - (b[None, :, 1] - a[None, :, 1]) * (px[:, None, 0] - a[None, :, 0])
    inside = (cross >= 0).all(1) | (cross <= 0).all(1)
    if inside.sum() < 30:
        return 0.0
    pts, _ = _all_template_points(length, width, 0.3)
    P = project(H, pts) * np.array([cols, rows])
    P = P[np.isfinite(P).all(1)]
    if len(P) < 10:
        return 1.0
    d = cKDTree(P).query(px[inside])[0]
    return float((d > near_px).mean())


# ------------------------------------------------------------------ fitting the template to the lines
@dataclass
class Fit:
    H: np.ndarray                   # pitch metres -> normalised picture coordinates
    quality: float                  # 0..1: share of the visible template points that lie on a line pixel (within `tol_px`), weighted by direction spread
    visible: int                    # template points inside the picture
    on_line: int                    # of those, on a white line pixel
    well_posed: bool                # the lines on the fit point in at least two clearly different directions (one line alone cannot fix a pitch)
    mean_px: float                  # mean distance of the visible template points to the nearest line pixel
    lock: float = 0.0               # 0..1: how much closer the template lies to the white lines than the same template nudged a few pixels away
    consistent: bool = True         # no long thin white line inside the pitch is left unexplained by the template
    unsupported: tuple = ()         # (kept for callers; unused)
    orphan: float = 0.0             # share of the long thin white line pixels inside the pitch that lie farther than 4 px from every template line


def _all_template_points(length: float, width: float, step: float = 0.4) -> tuple[np.ndarray, np.ndarray]:
    pts, ids = [], []
    for i, (_, p) in enumerate(template_lines(length, width, step).items()):
        pts.append(p)
        ids.append(np.full(len(p), i))
    return np.concatenate(pts), np.concatenate(ids)


def score(H: np.ndarray, dt: np.ndarray, length: float = DEFAULT_LENGTH_M, width: float = DEFAULT_WIDTH_M, tol_px: float = 2.5, margin_px: float = 4.0,
          mask: np.ndarray | None = None) -> Fit:
    """How well H explains the white lines of a picture whose distance field is `dt` (shape (rows, cols))."""
    rows, cols = dt.shape
    pts, ids = _all_template_points(length, width)
    P = project(H, pts) * np.array([cols, rows])
    ok = np.isfinite(P).all(1) & (P[:, 0] >= margin_px) & (P[:, 0] <= cols - 1 - margin_px) & (P[:, 1] >= margin_px) & (P[:, 1] <= rows - 1 - margin_px)
    if ok.sum() < 30:
        return Fit(H, 0.0, int(ok.sum()), 0, False, float("inf"), 0.0)
    d = ndimage.map_coordinates(dt, [P[ok, 1], P[ok, 0]], order=1, mode="nearest")
    on = d <= tol_px
    # directions of the lines that are on a white line pixel: a pitch needs at least two clearly different ones
    Pk, idk = P[ok][on], ids[ok][on]
    well = False
    if on.sum() >= 24:
        dirs = []
        for i in np.unique(idk):
            q = Pk[idk == i]
            if len(q) >= 8:
                v = np.linalg.svd(q - q.mean(0), full_matrices=False)[2][0]
                dirs.append(v)
        for a in range(len(dirs)):
            for b in range(a + 1, len(dirs)):
                if abs(float(dirs[a] @ dirs[b])) < 0.9:                  # more than ~25 degrees apart
                    well = True
    # lock: the same template shifted 18 px in four directions must lie clearly farther from the white lines than the fit itself. A fit that
    # is "on the lines" only by chance (a template over scattered clutter) has no such contrast; a fit on real lines has.
    shifted = []
    for sx, sy in ((18, 0), (-18, 0), (0, 18), (0, -18)):
        Q = P[ok] + np.array([sx, sy], float) * np.array([cols / 640.0, rows / 360.0])
        inside = (Q[:, 0] >= 0) & (Q[:, 0] <= cols - 1) & (Q[:, 1] >= 0) & (Q[:, 1] <= rows - 1)
        shifted.append(float(ndimage.map_coordinates(dt, [Q[inside, 1], Q[inside, 0]], order=1, mode="nearest").mean()) if inside.sum() > 20 else float(d.mean()))
    lock = float(np.clip((np.mean(shifted) - float(d.mean())) / 6.0, 0.0, 1.0))
    # consistency: a long, thin white line INSIDE the pitch that no template line explains (a halfway line the fit drew somewhere else: a circle cannot
    # tell a rotation) means the fit is wrong, however well the rest matches. Players, shirts and boards are not long thin lines, and boards lie outside the pitch.
    orphan = orphan_fraction(H, mask, length, width) if mask is not None else 0.0
    consistent = orphan < 0.30
    unsupported = ()
    frac = float(on.mean())
    return Fit(H, lock * (1.0 if well else 0.4) * (1.0 if consistent else 0.0), int(ok.sum()), int(on.sum()), well, float(d.mean()), lock, consistent, unsupported, float(orphan))


def refine(H0: np.ndarray, dt: np.ndarray, length: float = DEFAULT_LENGTH_M, width: float = DEFAULT_WIDTH_M, tol_px: float = 2.5,
           cap_px: float = 14.0, max_nfev: int = 60, mask_pts: np.ndarray | None = None, back_weight: float = 0.5) -> Fit:
    """Move the 8 numbers of H0 so that the template lines lie on the white line pixels of the picture whose distance field is `dt`.
    `mask_pts` ((n, 2) normalised picture coordinates of line pixels): the other direction as well, every white line pixel should lie near a template
    line, so a fit cannot ignore a clearly painted line (a template line may rest on a different painted line only if all of them are explained)."""
    from scipy.spatial import cKDTree
    rows, cols = dt.shape
    pts, _ = _all_template_points(length, width, 0.6)
    scale = np.array([cols, rows], float)
    S = np.diag([1 / 52.5, 1 / 52.5, 1.0])                              # pitch metres -> ~[-1, 1]: conditioning only
    Hs0 = H0 @ np.linalg.inv(S)

    def build(q: np.ndarray) -> np.ndarray:
        M = np.eye(3) + np.append(q, 0.0).reshape(3, 3)
        return Hs0 @ M

    def residuals(q: np.ndarray) -> np.ndarray:
        Hq = build(q)
        P = project(Hq @ S, pts) * scale
        inside = np.isfinite(P).all(1) & (P[:, 0] >= 2) & (P[:, 0] <= cols - 3) & (P[:, 1] >= 2) & (P[:, 1] <= rows - 3)
        r = np.full(len(pts), cap_px, float)
        if inside.sum() >= 12:
            r[inside] = ndimage.map_coordinates(dt, [P[inside, 1], P[inside, 0]], order=1, mode="nearest")
        # points out of the picture say nothing; neutral so they neither pull nor push
        r[~inside] = 0.0
        if mask_pts is not None and len(mask_pts):
            # white line pixels -> nearest projected template point (in the picture), capped
            tp = P[inside] if inside.sum() >= 12 else None
            if tp is not None:
                back = np.minimum(cKDTree(tp).query(mask_pts * scale)[0], cap_px) * back_weight
                return np.concatenate([r, back])
            return np.concatenate([r, np.full(len(mask_pts), cap_px * back_weight)])
        return r

    q0 = np.zeros(8)
    sol = optimize.least_squares(residuals, q0, loss="soft_l1", f_scale=tol_px, max_nfev=max_nfev, x_scale=0.02, diff_step=1e-3)
    H = build(sol.x) @ S
    return score(H / H[2, 2], dt, length, width, tol_px)


def pitch_position(H: np.ndarray, x_norm: float, y_norm: float) -> tuple[float, float] | None:
    """The pitch position (metres, origin = centre spot) of a picture point (normalised), or None if it cannot be placed."""
    try:
        p = unproject(H, np.array([[x_norm, y_norm]]))[0]
    except np.linalg.LinAlgError:                                       # a matrix that cannot be inverted places nothing
        return None
    return None if not np.isfinite(p).all() else (float(p[0]), float(p[1]))


def shift_matrix(dx: float, dy: float) -> np.ndarray:
    """The picture moved by (dx, dy) (normalised units): what a camera pan does to H (left-multiply)."""
    return np.array([[1.0, 0.0, dx], [0.0, 1.0, dy], [0.0, 0.0, 1.0]])


def refine_pyramid(H0: np.ndarray, mask: np.ndarray, length: float = DEFAULT_LENGTH_M, width: float = DEFAULT_WIDTH_M) -> Fit:
    """`refine` from coarse to fine: a wide basin first (the lines may have moved 50 px since the last frame), then the exact lines."""
    full = distance_field(mask, cap_px=48.0)
    H = H0
    for step, cap, tol in ((4, 40.0, 6.0), (2, 24.0, 3.5), (1, 14.0, 2.5)):
        H = refine(H, np.minimum(full[::step, ::step], cap), length, width, tol_px=tol, cap_px=cap, max_nfev=40).H
    return score(H, np.minimum(full, 14.0), length, width, mask=mask)


# ------------------------------------------------------------------ does the fitted pitch cover the grass?
MIN_GRASS_COVERED, MIN_PITCH_GRASS = 0.80, 0.60


def grass_coverage(H: np.ndarray, rgb: np.ndarray, length: float = DEFAULT_LENGTH_M, width: float = DEFAULT_WIDTH_M, margin_m: float = 2.0) -> tuple[float, float]:
    """(covered, pure): the share of the playing surface (the picture's largest grass region, shade included) that lies inside the pitch H draws
    (+ margin_m), and the share of that drawn pitch (inside the picture) that is playing surface. A fit can lie on white lines and still be nonsense:
    on the owner's match a fit squeezed into a thin band along the far touchline (board lettering and the touchline) passed every line check
    (quality 0.56) while covering 2-24 % of the grass; correct fits cover 100 % (2026-10-31)."""
    return coverage_on_surface(H, playing_surface_of(rgb), length, width, margin_m)


def playing_surface_of(rgb: np.ndarray) -> np.ndarray:
    """The picture's playing surface (largest grass region, shade included), small: kept per frame where the pitch is fitted later."""
    from .detect.pitch import grass_mask, playing_surface
    return playing_surface(grass_mask(rgb))


def coverage_on_surface(H: np.ndarray, surf: np.ndarray, length: float = DEFAULT_LENGTH_M, width: float = DEFAULT_WIDTH_M,
                        margin_m: float = 2.0) -> tuple[float, float]:
    """`grass_coverage` on a playing surface computed before (`playing_surface_of`)."""
    rows, cols = surf.shape
    if not surf.any():
        return 0.0, 0.0
    ys, xs = np.mgrid[0:rows, 0:cols]
    P = np.c_[(xs.ravel() + 0.5) / cols, (ys.ravel() + 0.5) / rows]
    try:
        Q = unproject(H, P)
    except np.linalg.LinAlgError:
        return 0.0, 0.0
    back = project(H, Q)                                                    # a picture point beyond the horizon has no pitch position
    good = np.isfinite(Q).all(1) & np.isfinite(back).all(1) & (np.abs(back - P).max(1) < 1e-3)
    inside = good & (np.abs(Q[:, 0]) <= length / 2 + margin_m) & (np.abs(Q[:, 1]) <= width / 2 + margin_m)
    g = surf.ravel()
    return float((inside & g).sum() / g.sum()), float((inside & g).sum() / max(int(inside.sum()), 1))


def covers_grass(H: np.ndarray, rgb: np.ndarray, length: float = DEFAULT_LENGTH_M, width: float = DEFAULT_WIDTH_M) -> bool:
    cov, pure = grass_coverage(H, rgb, length, width)
    return cov >= MIN_GRASS_COVERED and pure >= MIN_PITCH_GRASS


def covers_surface(H: np.ndarray, surf: np.ndarray, length: float = DEFAULT_LENGTH_M, width: float = DEFAULT_WIDTH_M) -> bool:
    cov, pure = coverage_on_surface(H, surf, length, width)
    return cov >= MIN_GRASS_COVERED and pure >= MIN_PITCH_GRASS
