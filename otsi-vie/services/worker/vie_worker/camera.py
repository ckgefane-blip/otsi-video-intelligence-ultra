"""One camera for the whole match (Blueprint 03 step 8 `geometry`): the pitch calibration that joins a person's clicks from many moments.

The main broadcast camera stands in one place and only turns (pan), tilts and zooms. So a homography of any of its moments is

    H = A K(f) R(pan, tilt, roll) [e1 e2 -C]

with C the camera's place (metres; x along the length, y across, z DOWN, so a camera 15 m up has z = -15), roll the lean of its head (shared),
and per moment only pan, tilt and focal length f (in frame widths; principal point in the middle, square pixels). The shared part is found
from ALL the moments together; after that a moment has 3 unknowns instead of 8. The same shared camera is what automatic calibration of other
moments can start from.

What a few clicks can do (measured 2026-10-31: the camera solved from the owner's clicks, simulated moments across the pitch with his 3 px click
error): the camera's place gets pinned down as moments add up, but each moment's ZOOM comes only from its own clicks. Worst error of a moment's
lines in its frame, 20 moments: 2 clicks ~23 px, 3 clicks 8-15 px, 4 clicks ~7 px (as good as 6 clicks alone). So a moment whose lines are
known to `MAX_LINE_SIGMA_PX` stands on the camera alone; one known only to `MAX_START_SIGMA_PX` gets a starting pitch (`near`) that the
white lines of its frame must confirm (pitch_job); anything looser waits for more clicks.

Clicks ANYWHERE ON A LINE (owner, 2026-10-31, after a centre-circle view whose landmarks all lie on the halfway line): a click on the far
touchline or the centre circle says "this picture point lies on that line" (one equation: its distance to the drawn line) without saying where
along it. A centre view then gets what the halfway line cannot give: the picture's left and right.

Honesty rules (unknown beats wrong):
* the joint fit must explain every click closely (`MAX_RMS_PX`, `MAX_CLICK_PX`), with redundancy left over (`MIN_SPARE`);
* a moment gets a pitch only if its lines are pinned down: the predicted position of every pitch line in its frame is uncertain by at most
  `MAX_LINE_SIGMA_PX` (covariance of the least-squares fit, with a floor for the person's click error), or by `MAX_START_SIGMA_PX` when the
  white lines then confirm it;
* a moment that does not fit the others (another camera, a wrongly named place) is named and left out, never bent into the solution; that
  needs at least two moments agreeing with each other: one moment against one other cannot say which is wrong.
Pixels are of a frame REF_W wide. No dependency beyond numpy and scipy.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import least_squares

from . import geometry as geo

REF_W = 1280.0                    # pixels are counted on a frame this wide
MAX_RMS_PX = 4.5                  # the joint fit explains the clicks to within this (rms). Careful clicks on the owner's 720p match agree to ~3 px
                                  # even with a free homography; clicks of another camera or with a wrongly named place are 6 px and more off
MAX_MOMENT_RMS_PX = 5.5           # nor any one moment's clicks (rms): one loose moment cannot hide among good ones
MAX_CLICK_PX = 10.0               # and no single click is further off than this
MAX_LINE_SIGMA_PX = 6.0           # a moment's pitch lines are known to within this (1 sigma, = 3 px of the worker's 640) everywhere in its frame: it stands
MAX_START_SIGMA_PX = 12.0         # known to within this: a starting pitch the white lines must confirm (the snap corrects up to 24 px of 1280)
SIGMA_FLOOR_PX = 1.5              # the click error assumed at least, however well a small set happens to agree
MIN_SPARE = 4                     # clicks (x and y each) beyond the number of unknowns, so the clicks can check each other
MIN_POINTS_PER_MOMENT = 2
DOES_NOT_FIT = "These clicks do not fit the camera seen in your other moments: another camera, or a place named wrongly."
NEED_MORE = "Not pinned down yet: mark one or two more places in this moment (spread apart), or add moments of other parts of the pitch."
SHARED = 4                        # cx, cy, z, roll
PER = 3                           # pan, tilt, log f


@dataclass
class LineClick:
    name: str                     # a pitch line (geometry.template_lines), e.g. "touchline top", "centre circle"
    metres: np.ndarray            # straight: its two ends; curved: the line densely sampled
    straight: bool
    image: np.ndarray             # (2,) the normalised click


def line_click(name: str, x: float, y: float, length: float = geo.DEFAULT_LENGTH_M, width: float = geo.DEFAULT_WIDTH_M) -> LineClick:
    """A click anywhere on the named pitch line. KeyError for a name that is no pitch line."""
    straight = not any(k in name for k in ("circle", "arc"))
    pts = geo.template_lines(length, width, 0.5 if straight else 0.1)[name]
    return LineClick(name, pts[[0, -1]] if straight else pts, straight, np.array([x, y], float))


@dataclass
class Moment:
    key: str                      # the calibration request id
    pitch: np.ndarray             # (n, 2) landmark metres
    image: np.ndarray             # (n, 2) normalised clicks
    lines: list[LineClick] = field(default_factory=list)

    @property
    def equations(self) -> int:
        return 2 * len(self.pitch) + len(self.lines)

    @property
    def clicks(self) -> int:
        return len(self.pitch) + len(self.lines)


@dataclass
class Solution:
    ok: bool                                  # the camera is known: every moment in `measured` has a trustworthy pitch
    reason: str                               # plain words when not ok (or for left-out moments)
    centre: np.ndarray | None = None          # camera place (x, y, z down) metres
    roll: float = 0.0
    views: dict[str, tuple[float, float, float]] = field(default_factory=dict)        # key -> (pan, tilt, f)
    H: dict[str, np.ndarray] = field(default_factory=dict)                           # key -> homography: measured and near moments
    sigma_px: dict[str, float] = field(default_factory=dict)                          # key -> worst line uncertainty in its frame
    click_px: dict[str, float] = field(default_factory=dict)                          # key -> rms of its own clicks
    measured: list[str] = field(default_factory=list)                                 # stand on the camera alone
    near: list[str] = field(default_factory=list)                                     # a start the white lines must confirm
    left_out: dict[str, str] = field(default_factory=dict)                            # key -> why
    rms_px: float = float("inf")
    spare: int = 0
    points: int = 0


# ------------------------------------------------------------------ the camera model
def rotation(pan: float, tilt: float, roll: float) -> np.ndarray:
    """World -> camera (rows: camera right, down, forward). pan turns about the vertical, tilt looks down, roll leans the head."""
    cp, sp, ct, st = np.cos(pan), np.sin(pan), np.cos(tilt), np.sin(tilt)
    z = np.array([ct * cp, ct * sp, st])
    x = np.array([-sp, cp, 0.0])
    y = np.cross(z, x)
    cr, sr = np.cos(roll), np.sin(roll)
    return np.stack([cr * x + sr * y, -sr * x + cr * y, z])


def homography(centre: np.ndarray, roll: float, pan: float, tilt: float, f: float, aspect: float) -> np.ndarray:
    """Pitch metres -> normalised picture of a frame `aspect` = width / height. Points in front of the camera have w > 0."""
    R = rotation(pan, tilt, roll)
    M = np.column_stack([R[:, 0], R[:, 1], -R @ centre])
    A = np.array([[1.0, 0.0, 0.5], [0.0, aspect, 0.5], [0.0, 0.0, 1.0]])
    H = A @ np.diag([f, f, 1.0]) @ M
    return H / np.linalg.norm(H)


def decompose(H: np.ndarray, aspect: float, pitch_pts: np.ndarray) -> tuple[np.ndarray, float, float, float, float] | None:
    """(centre, roll, pan, tilt, f) of a homography of one moment, or None when it is no real camera (mirrored, below the ground)."""
    Ai = np.linalg.inv(np.array([[1.0, 0.0, 0.5], [0.0, aspect, 0.5], [0.0, 0.0, 1.0]]))
    G = Ai @ H
    h1, h2 = G[:, 0], G[:, 1]
    den = h1[2] * h2[2]
    f2 = -(h1[0] * h2[0] + h1[1] * h2[1]) / den if abs(den) > 1e-12 else -1.0
    if not f2 > 0:
        d = h2[2] ** 2 - h1[2] ** 2
        f2 = ((h1[0] ** 2 + h1[1] ** 2) - (h2[0] ** 2 + h2[1] ** 2)) / d if abs(d) > 1e-12 else -1.0
    if not f2 > 0:
        return None
    f = float(np.sqrt(f2))
    M = np.diag([1 / f, 1 / f, 1.0]) @ G
    lam = 2.0 / (np.linalg.norm(M[:, 0]) + np.linalg.norm(M[:, 1]))
    depth = (M @ np.column_stack([pitch_pts, np.ones(len(pitch_pts))]).T)[2]
    if np.median(depth) < 0:
        lam = -lam
    M = M * lam
    r1, r2 = M[:, 0], M[:, 1]
    U, _, Vt = np.linalg.svd(np.column_stack([r1, r2, np.cross(r1, r2)]))
    R = U @ Vt                                                              # columns: world axes seen by the camera
    if np.linalg.det(R) < 0:
        return None
    C = -R.T @ M[:, 2]
    if C[2] >= -0.5:                                                        # at or below the ground: not a real camera
        return None
    z = R[2]
    tilt = float(np.arcsin(np.clip(z[2], -1, 1)))
    pan = float(np.arctan2(z[1], z[0]))
    x0 = np.array([-np.sin(pan), np.cos(pan), 0.0])
    y0 = np.cross(z, x0)
    roll = float(np.arctan2(R[0] @ y0, R[0] @ x0))
    return C, roll, pan, tilt, f


# ------------------------------------------------------------------ the joint fit
def _unpack(v: np.ndarray, n: int):
    return v[:3], v[3], v[SHARED:].reshape(n, PER)


def _project(centre, roll, view, aspect, pitch):
    pan, tilt, logf = view
    return geo.project(homography(centre, roll, pan, tilt, float(np.exp(logf)), aspect), pitch)


def _line_residual(H: np.ndarray, c: LineClick, aspect: float) -> float:
    """Pixels between a click and the line it is on, as H draws the line (signed for a straight line, so the fit is smooth)."""
    px = np.array([REF_W, REF_W / aspect])
    q = geo.project(H, c.metres)
    q = q[np.isfinite(q).all(1)] * px
    if len(q) < 2:
        return 1000.0                                                       # the line is behind the camera
    p = c.image * px
    if c.straight:
        d = q[1] - q[0]
        return float(((p - q[0]) @ np.array([-d[1], d[0]])) / max(np.hypot(*d), 1e-9))
    a, b = q[:-1], q[1:]
    ab = b - a
    t = np.clip(((p - a) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-12), 0, 1)
    return float(np.min(np.hypot(*(a + ab * t[:, None] - p).T)))


def _residuals(v: np.ndarray, moments: list[Moment], aspect: float) -> np.ndarray:
    centre, roll, views = _unpack(v, len(moments))
    out = []
    for m, view in zip(moments, views):
        pan, tilt, logf = view
        H = homography(centre, roll, pan, tilt, float(np.exp(logf)), aspect)
        p = geo.project(H, m.pitch)
        d = np.where(np.isfinite(p), p - m.image, 10.0)                     # behind the camera: a large, smooth penalty
        out.append((d * np.array([REF_W, REF_W / aspect])).ravel())
        if m.lines:
            out.append(np.array([_line_residual(H, c, aspect) for c in m.lines]))
    return np.concatenate(out)


def _aim(centre: np.ndarray, target: np.ndarray) -> tuple[float, float]:
    d = np.array([target[0], target[1], 0.0]) - centre
    return float(np.arctan2(d[1], d[0])), float(np.arcsin(d[2] / np.linalg.norm(d)))


def _own_camera(m: Moment, aspect: float):
    """The camera a moment implies on its own (4+ clicks), with how well its clicks agree, or None."""
    if len(m.pitch) < 4:
        return None
    pf = geo.fit_from_points(m.pitch, m.image, int(REF_W), int(REF_W / aspect))
    if pf.collinear or pf.mirrored:
        return None
    d = decompose(pf.H, aspect, m.pitch)
    return (d, pf.rms_px) if d is not None else None


def _view0(centre: np.ndarray, roll: float, m: Moment, aspect: float, f: float) -> list[float]:
    """A starting view for a moment under a known camera place: its own camera's view when it has one, else aimed at its clicks."""
    own = _own_camera(m, aspect)
    if own is not None:
        _, _, pan, tilt, f0 = own[0]
        return [pan, tilt, np.log(f0)]
    pan, tilt = _aim(centre, m.pitch.mean(0))
    return [pan, tilt, np.log(f)]


def _grid(moments: list[Moment], length: float, width: float) -> list[np.ndarray]:
    """Starting points when no moment fixes a camera alone: a coarse grid of places around the pitch."""
    hl, hw = length / 2, width / 2
    out = []
    for side in (-1.0, 1.0):
        for back in (15.0, 45.0):
            for x in (-hl / 2, 0.0, hl / 2):
                for h in (10.0, 30.0):
                    C = np.array([x, side * (hw + back), -h])
                    for f in (1.0, 2.5):
                        out.append(np.concatenate([C, [0.0], np.ravel([[*_aim(C, m.pitch.mean(0)), np.log(f)] for m in moments])]))
    return out


def _bounds(n: int):
    lo = [-200.0, -250.0, -120.0, -0.3] + [-np.inf, -0.3, np.log(0.25)] * n
    hi = [200.0, 250.0, -1.0, 0.3] + [np.inf, 1.4, np.log(30.0)] * n
    return np.array(lo), np.array(hi)


def _run(moments: list[Moment], aspect: float, v0: np.ndarray, nfev: int = 500):
    lo, hi = _bounds(len(moments))
    try:
        return least_squares(_residuals, np.clip(v0, lo + 1e-6, hi - 1e-6), bounds=(lo, hi), args=(moments, aspect), x_scale="jac", max_nfev=nfev)
    except (ValueError, np.linalg.LinAlgError):
        return None


def _clicks(r, moments: list[Moment]) -> np.ndarray:
    """How far off each click is (px), moment by moment: a landmark by its distance, a line click by its distance to the line."""
    out, i = [], 0
    for m in moments:
        res = r.fun[i:i + 2 * len(m.pitch)].reshape(-1, 2)
        out.append(np.hypot(res[:, 0], res[:, 1]))
        out.append(np.abs(r.fun[i + 2 * len(m.pitch):i + m.equations]))
        i += m.equations
    return np.concatenate(out)


def _agrees(r, moments: list[Moment]) -> bool:
    """The fit explains the clicks: all of them together, each moment's own, and every single one."""
    c = _clicks(r, moments)
    if not (np.sqrt(np.mean(c ** 2)) <= MAX_RMS_PX and c.max() <= MAX_CLICK_PX):
        return False
    edges = np.cumsum([0] + [m.clicks for m in moments])
    return all(np.sqrt(np.mean(c[a:b] ** 2)) <= MAX_MOMENT_RMS_PX for a, b in zip(edges, edges[1:]))


def _grow(seed: Moment, others: list[Moment], aspect: float):
    """Start from one moment's own camera and take in, one at a time, every other moment that agrees with it. (fit, moments in it)."""
    own = _own_camera(seed, aspect)
    if own is None:
        return None
    (C, roll, pan, tilt, f), _ = own
    inside = [seed]
    r = _run(inside, aspect, np.concatenate([C, [roll], [pan, tilt, np.log(f)]]))
    if r is None or not _agrees(r, inside):
        return None
    rest = sorted(others, key=lambda m: -m.equations)
    changed = True
    while changed:
        changed = False
        for m in list(rest):
            Cc, rr, views = _unpack(r.x, len(inside))
            fm = float(np.exp(np.median(views[:, 2])))
            t = _run(inside + [m], aspect, np.concatenate([r.x, _view0(Cc, rr, m, aspect, fm)]))
            if t is not None and _agrees(t, inside + [m]):
                inside, r, changed = inside + [m], t, True
                rest.remove(m)
    return r, inside


def _line_sigma(v: np.ndarray, cov: np.ndarray, i: int, moments: list[Moment], aspect: float, grid: np.ndarray) -> float:
    """Worst 1-sigma uncertainty (px) of where the pitch lines of moment i lie in its frame."""
    centre, roll, views = _unpack(v, len(moments))
    p0 = _project(centre, roll, views[i], aspect, grid)
    inside = np.isfinite(p0).all(1) & (p0[:, 0] > -0.02) & (p0[:, 0] < 1.02) & (p0[:, 1] > -0.02) & (p0[:, 1] < 1.02)
    if not inside.any():
        return float("inf")
    g = grid[inside]
    idx = list(range(SHARED)) + [SHARED + PER * i + k for k in range(PER)]
    base = _project(centre, roll, views[i], aspect, g)
    J = np.zeros((2 * len(g), len(idx)))
    for col, j in enumerate(idx):
        e = 1e-6 * max(1.0, abs(v[j]))
        w = v.copy(); w[j] += e
        c2, r2, vw2 = _unpack(w, len(moments))
        J[:, col] = ((_project(c2, r2, vw2[i], aspect, g) - base) * np.array([REF_W, REF_W / aspect])).ravel() / e
    S = J @ cov[np.ix_(idx, idx)] @ J.T
    var = np.diag(S).reshape(-1, 2).sum(1)
    return float(np.sqrt(max(0.0, var.max())))


def solve(moments: list[Moment], aspect: float, length: float = geo.DEFAULT_LENGTH_M, width: float = geo.DEFAULT_WIDTH_M) -> Solution:
    """The one camera behind all the moments, and the pitch of every moment it pins down. Moments that do not fit are left out by name."""
    moments = [m for m in moments if len(m.pitch) >= 1 and m.equations >= 2 * MIN_POINTS_PER_MOMENT]
    points = sum(m.clicks for m in moments)
    spare = sum(m.equations for m in moments) - (SHARED + PER * len(moments))
    if not moments:
        return Solution(False, "No moment has two or more places marked yet.", points=0)
    if spare < MIN_SPARE:
        need = (MIN_SPARE - spare + 1) // 2
        return Solution(False, f"Mark about {need} more place{'s' if need > 1 else ''} (in this or another moment) before the camera can be worked out.", spare=spare, points=points)
    # the one camera: grown from the moment whose own clicks agree best, taking in every moment that agrees with it; moments that do not are named
    best = None
    seeds = sorted((m for m in moments if _own_camera(m, aspect) is not None), key=lambda m: (len(m.pitch) < 6, _own_camera(m, aspect)[1]))
    for seed in seeds[:4]:
        g = _grow(seed, [m for m in moments if m is not seed], aspect)
        if g is not None and (best is None or sum(m.equations for m in g[1]) > sum(m.equations for m in best[1])
                              or (sum(m.equations for m in g[1]) == sum(m.equations for m in best[1]) and g[0].cost < best[0].cost)):
            best = g
    if best is None:                                                        # no moment fixes a camera alone: all moments from a grid of camera places
        quick = [q for q in (_run(moments, aspect, v0, 40) for v0 in _grid(moments, length, width)) if q is not None]
        final = [t for t in (_run(moments, aspect, q.x) for q in sorted(quick, key=lambda q: q.cost)[:3]) if t is not None]
        r = min(final, key=lambda t: t.cost) if final else None
        if r is None:
            return Solution(False, "The camera could not be worked out from these clicks.", spare=spare, points=points)
        if not _agrees(r, moments):
            rms = float(np.sqrt(np.mean(_clicks(r, moments) ** 2)))
            return Solution(False, f"The clicks of your moments do not agree with one camera (off by about {rms:.0f} px). Check the names of the places marked, "
                                   "and use the main camera only.", rms_px=rms, spare=spare, points=points)
        best = (r, moments)
    r, inside = best
    outside = [m for m in moments if m not in inside]
    blame = DOES_NOT_FIT if len(inside) >= 2 else "Your moments do not agree with each other yet: add a moment of another part of the pitch, so the engine can tell which is right."
    moments = inside
    points = sum(m.clicks for m in moments)
    spare = sum(m.equations for m in moments) - (SHARED + PER * len(moments))
    if spare < MIN_SPARE:
        need = (MIN_SPARE - spare + 1) // 2
        s = Solution(False, f"Mark about {need} more place{'s' if need > 1 else ''} (in this or another moment) before the camera can be worked out.", spare=spare, points=points)
        s.left_out.update({m.key: blame for m in outside})
        return s
    click = _clicks(r, moments)
    rms = float(np.sqrt(np.mean(click ** 2)))
    dof = max(1, len(r.fun) - len(r.x))
    sigma = max(SIGMA_FLOOR_PX, float(np.sqrt(2 * r.cost / dof)))
    J = r.jac
    try:
        cov = np.linalg.pinv(J.T @ J) * sigma ** 2
    except np.linalg.LinAlgError:
        return Solution(False, "The camera could not be worked out from these clicks.", rms_px=rms, spare=spare, points=points)
    centre, roll, views = _unpack(r.x, len(moments))
    grid = np.concatenate(list(geo.template_lines(length, width, 3.0).values()))
    sol = Solution(True, "", centre=centre.copy(), roll=float(roll), rms_px=rms, spare=spare, points=points)
    sol.left_out.update({m.key: blame for m in outside})
    start = 0
    for i, m in enumerate(moments):
        pan, tilt, logf = views[i]
        sol.views[m.key] = (float(pan), float(tilt), float(np.exp(logf)))
        sol.click_px[m.key] = float(np.sqrt(np.mean(click[start:start + m.clicks] ** 2))); start += m.clicks
        s = _line_sigma(r.x, cov, i, moments, aspect, grid)
        sol.sigma_px[m.key] = s
        if s <= MAX_START_SIGMA_PX:
            sol.H[m.key] = homography(centre, float(roll), float(pan), float(tilt), float(np.exp(logf)), aspect)
            (sol.measured if s <= MAX_LINE_SIGMA_PX else sol.near).append(m.key)
        else:
            sol.left_out[m.key] = NEED_MORE
    return sol
