"""Horizon-guided multi-scale tiling (Track U.7, Blueprint W5/U.7).

Blind multi-scale tiling already exists (ADR-034): `grids=[2, 3]` cuts the whole
frame into 2x2 AND 3x3 tiles, 1+4+9 = 14 model passes per frame, and re-detects
the big near players in every tile. That wastes passes where players are already
large, and tiles the stands above the pitch as well as the pitch.

This module tiles by the horizon instead, from the shot's pitch homography H
(pitch metres -> normalised picture, as in `geometry.py`):

* The horizon is the image of the pitch line at infinity: l = inv(H).T @ (0,0,1).
  A player standing on the ground plane appears smaller the closer his feet are
  to the horizon (pinhole: apparent height is linear in |feet_y - horizon_y|),
  so the bands split the visible frame by distance from the horizon: the FAR
  band (nearest the horizon, smallest players) gets the finest tiles, the MID
  band coarser tiles, and the NEAR band (largest players) gets no tiles at all
  — the full-frame pass already finds those, and tiling them again only makes
  duplicates. The horizon may sit above the frame (broadcast: far band is the
  top strip) or below it (a steep top-down view: far band is the bottom strip);
  the bands follow the geometry either way, they are never just "the top".
* No calibration (H is None) or a degenerate H (affine: no horizon) means no
  tiles: the full-frame pass runs alone. Never a guess.

Everything here is pure (numpy only, no model, no torch): a caller that knows
the shot H builds a plan with `horizon_tiles` and hands it to
`HfRtDetr.detect(frames, tile_windows=plan)`. With no plan the detector behaves
exactly as before — tiling is off by default and costs nothing unless enabled.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

FAR_GRID = 3          # columns across the frame in the far band (finest tiles)
MID_GRID = 2          # columns across the frame in the mid band
FAR_FRAC = 0.30       # share of the visible depth range in the far band
MID_FRAC = 0.35       # share of the visible depth range in the mid band (near band: the rest, no tiles)
OVERLAP = 0.12        # tile overlap, same as the blind grids in hf_rtdetr.py
MIN_BAND_PX = 32      # a band strip shorter than this is not tiled: the tile would be useless


@dataclass(frozen=True)
class Tile:
    x: int            # top-left corner, pixels of the frame
    y: int
    w: int            # size, pixels of the frame
    h: int
    band: str         # "far" | "mid"
    grid: int         # columns across the frame in this band
    scale: int        # scale index for Detection.scales (far = 2, mid = 1: finer = higher bit, as in ADR-034)


def horizon_line(H: np.ndarray) -> tuple[float, float, float] | None:
    """(a, b, c) of the horizon line a*x + b*y + c = 0 in normalised picture
    coordinates, or None when H gives no horizon: H is not a finite 3x3, is
    singular, or is affine (parallel pitch lines stay parallel, so the horizon
    is at infinity and every row of the picture is equally far from it). The
    line is the image of the pitch line at infinity, l = inv(H).T @ (0,0,1),
    normalised so sqrt(a^2 + b^2) = 1. (U.7.)"""
    try:
        H = np.asarray(H, float)
    except Exception:  # noqa: BLE001 - anything un-array-like has no horizon
        return None
    if H.shape != (3, 3) or not np.isfinite(H).all():
        return None
    try:
        line = np.linalg.inv(H).T @ np.array([0.0, 0.0, 1.0])
    except np.linalg.LinAlgError:
        return None
    n = float(np.hypot(line[0], line[1]))
    if not np.isfinite(line).all() or n < 1e-9:
        return None
    return (float(line[0] / n), float(line[1] / n), float(line[2] / n))


def horizon_y(H: np.ndarray, x_norm: float = 0.5) -> float | None:
    """The normalised y of the horizon at picture column `x_norm`, or None when
    there is no horizon or it is (near-)vertical there, so no single y exists.
    May lie outside [0, 1]: a horizon above the frame is normal for broadcast.
    (U.7.)"""
    line = horizon_line(H)
    if line is None:
        return None
    a, b, c = line
    if abs(b) < 1e-9:
        return None
    y = -(a * float(x_norm) + c) / b
    return float(y) if np.isfinite(y) else None


def _band_strips(frame_h: int, h0: float, far_frac: float = FAR_FRAC, mid_frac: float = MID_FRAC) -> dict[str, list[tuple[int, int]]]:
    """{band: [(y0, y1), ...]} in frame pixels. Bands split the visible range by
    distance d = |y - h0| from the horizon (normalised): far = the smallest
    `far_frac` of the visible depth range, mid = the next `mid_frac`, near = the
    rest (no tiles). When the horizon crosses the frame the far/mid bands are
    two strips, one on each side of it; when it sits outside the frame each
    band is a single strip. (U.7.)"""
    if not (0.0 < far_frac < far_frac + mid_frac < 1.0):
        raise ValueError("need 0 < far_frac < far_frac + mid_frac < 1")
    d_min = 0.0 if 0.0 <= h0 <= 1.0 else min(abs(h0), abs(1.0 - h0))
    d_max = max(abs(h0), abs(1.0 - h0))
    span = d_max - d_min
    if span < 1e-9:
        return {}
    edges = {"far": (d_min, d_min + far_frac * span), "mid": (d_min + far_frac * span, d_min + (far_frac + mid_frac) * span)}
    out: dict[str, list[tuple[int, int]]] = {}
    for band, (lo, hi) in edges.items():
        if h0 < 0.0:
            raw = [(h0 + lo, h0 + hi)]
        elif h0 > 1.0:
            raw = [(h0 - hi, h0 - lo)]
        else:
            raw = [(h0 - hi, h0 - lo), (h0 + lo, h0 + hi)]
        clipped = []
        for y0, y1 in raw:
            y0c, y1c = max(0.0, y0), min(1.0, y1)
            if y1c - y0c > 1e-6:
                clipped.append((int(round(y0c * frame_h)), int(round(y1c * frame_h))))
        if clipped:
            out[band] = clipped
    return out


def horizon_tiles(frame_w: int, frame_h: int, H: np.ndarray | None, *, far_grid: int = FAR_GRID, mid_grid: int = MID_GRID,
                  far_frac: float = FAR_FRAC, mid_frac: float = MID_FRAC, overlap: float = OVERLAP,
                  min_band_px: int = MIN_BAND_PX) -> list[Tile]:
    """The tile plan for one frame: fine tiles over the far band, coarser tiles
    over the mid band, nothing over the near band (the full-frame pass covers
    it). Tiles span the full frame width in `grid` columns with `overlap`, and
    each tile overlaps its band's edges so a player straddling a band boundary
    is whole in at least one tile (NMS merges the duplicates, as with the blind
    grids). Returns [] when there is no usable horizon (H is None, degenerate,
    or affine): the caller runs the full-frame pass alone. (U.7.)"""
    if int(frame_w) <= 0 or int(frame_h) <= 0:
        raise ValueError("frame size must be positive")
    if int(far_grid) < 1 or int(mid_grid) < 1:
        raise ValueError("grids must be >= 1")
    if not (0.0 <= overlap < 0.5):
        raise ValueError("overlap must be in [0, 0.5)")
    if H is None:
        return []
    h0 = horizon_y(H)
    if h0 is None:
        return []
    tiles: list[Tile] = []
    for band, strips in _band_strips(int(frame_h), h0, far_frac, mid_frac).items():
        grid = int(far_grid) if band == "far" else int(mid_grid)
        scale = 2 if band == "far" else 1
        for sy0, sy1 in strips:
            band_h = sy1 - sy0
            if band_h < min_band_px:
                continue
            y0 = max(0, int(sy0 - overlap * band_h / 2))
            y1 = min(int(frame_h), int(np.ceil(sy1 + overlap * band_h / 2)))
            th = y1 - y0
            tw = min(int(frame_w), int(np.ceil(int(frame_w) / grid * (1 + overlap))))
            xs = np.linspace(0, int(frame_w) - tw, grid).astype(int) if grid > 1 else np.array([0])
            for x in xs:
                tiles.append(Tile(int(x), int(y0), int(tw), int(th), band, int(grid), int(scale)))
    return tiles


def windows_from_plan(tiles: list[Tile]) -> list[tuple[tuple[int, int, int, int], int]]:
    """A tile plan as the (window, scale) pairs `HfRtDetr.detect` expects: the
    caller adds the full-frame pass ((0, 0, w, h), 0) in front. (U.7.)"""
    return [((t.x, t.y, t.w, t.h), t.scale) for t in tiles]


def map_tile_box(tile: Tile, bx1: float, by1: float, bx2: float, by2: float, frame_w: int, frame_h: int) -> tuple[float, float, float, float] | None:
    """A detection box in tile pixel coordinates -> normalised frame (x, y, w, h),
    clamped to the frame, or None when it has no area. The same mapping the
    detector loop in hf_rtdetr.py applies to every tile detection. (U.7.)"""
    ax1, ay1 = max(0.0, (float(bx1) + tile.x) / frame_w), max(0.0, (float(by1) + tile.y) / frame_h)
    ax2, ay2 = min(1.0, (float(bx2) + tile.x) / frame_w), min(1.0, (float(by2) + tile.y) / frame_h)
    if ax2 - ax1 <= 0 or ay2 - ay1 <= 0:
        return None
    return (ax1, ay1, ax2 - ax1, ay2 - ay1)


def passes_for(tiles: list[Tile]) -> int:
    """Model passes per frame for a plan: the full-frame pass plus one per tile.
    A broadcast horizon plan is 1 + 5 = 6 passes, against 1 + 4 + 9 = 14 for the
    blind grids=[2, 3]. (U.7.)"""
    return 1 + len(tiles)
