"""Is a detection on the playing surface? (ADR-024)

A person detector also finds spectators, stewards and benches. Without any knowledge of the stadium, one generic fact separates most of
them: players stand ON THE GRASS. Per frame a grass mask is computed (green hue, enough saturation and brightness, at 1/8 resolution);
a person is `on_pitch` when the ground just below the feet (bottom-centre of the box) is mostly grass. A ball is accepted when it is
inside the horizontal extent of the grass and not above the topmost grass row by more than a margin (a ball in the air over the pitch
stays; a light in the stands does not).

This is a filter for TRACKING, not a decision about who someone is: the raw evidence file keeps every detection with its flag, and
whether an on-pitch person is a player, a goalkeeper or a referee is decided later (kit/role classification, Block 07). Artificial
pitches of other colours, snow and night footage with heavy colour casts can defeat it: such runs report a low on-pitch share.
"""
from __future__ import annotations

import numpy as np

from .base import Detection


def grass_mask(rgb: np.ndarray, step: int = 8, *, shade: bool = True) -> np.ndarray:
    """Grass at 1/step resolution. Vivid grass passes a fixed colour test (green hue, saturation > 0.22). Dull, shaded or washed-out turf
    (broadcast footage in low sun, artificial pitches) fails that test everywhere, which made every player look "off the pitch" (measured
    on a 156-minute match: 7% of person detections kept). So the frame's OWN grass is learned as well: the dominant green in the frame
    (median hue and saturation of its green pixels), and pixels close to it count as grass, however pale. Both masks are combined; a frame
    with almost no green (not a grass pitch) keeps only the fixed test. Turf in a shadow is added (`shaded_turf`)."""
    small = rgb[::step, ::step].astype(np.float32) / 255
    r, g, b = small[..., 0], small[..., 1], small[..., 2]
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    d = mx - mn + 1e-6
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
    sat = np.where(mx > 0, d / (mx + 1e-6), 0)
    fixed = (hue > 0.17) & (hue < 0.47) & (sat > 0.22) & (mx > 0.12)
    green = (hue > 0.18) & (hue < 0.47) & (sat > 0.05) & (mx > 0.08)
    if green.mean() < 0.03:
        return fixed
    own_hue, own_sat = float(np.median(hue[green])), float(np.median(sat[green]))
    grass = fixed | (green & (np.abs(hue - own_hue) < 0.10) & (sat > max(0.07, 0.5 * own_sat)))
    return grass | shaded_turf(small * 255, grass) if shade else grass


def shaded_turf(small: np.ndarray, grass: np.ndarray) -> np.ndarray:
    """The part of the pitch in shadow (a stand's shadow across the turf in low sun). Shaded turf has lost its green: on the owner's match it
    measured RGB about (50, 53, 57) next to sunlit grass of (64, 69, 62), so every player standing in the shade was dropped as "off the
    pitch" (2026-10-31: 7 of 25 players at 30:07, 11 of 15 at 70:00). Colour alone cannot tell it from a grey wall or a stand's railing, so
    two more facts are used: it is a darker, slightly bluer copy of the frame's own sunlit grass (each channel 0.30-0.98 of it, blue up to
    1.25), smooth (no railings, seats or text), and ONE connected region with the sunlit grass. `small` is the frame at mask resolution, 0-255."""
    from scipy import ndimage
    if grass.mean() < 0.02:
        return np.zeros_like(grass)
    ratio = small / (np.median(small[grass], axis=0)[None, None] + 1e-3)
    lum = small.mean(2)
    tex = np.sqrt(np.maximum(ndimage.uniform_filter(lum * lum, 3) - ndimage.uniform_filter(lum, 3) ** 2, 0))     # local spread of brightness, 3x3
    cand = ((ratio[..., 0] > 0.30) & (ratio[..., 0] < 0.98) & (ratio[..., 1] > 0.30) & (ratio[..., 1] < 0.98) & (ratio[..., 2] > 0.35) & (ratio[..., 2] < 1.25)
            & (ratio[..., 1] >= ratio[..., 0] - 0.12) & (tex < 12))
    joined = ndimage.binary_closing(cand | grass, structure=np.ones((3, 3), bool))
    lab, n = ndimage.label(joined)
    if n == 0:
        return np.zeros_like(grass)
    on_grass = ndimage.sum(grass, lab, index=range(1, n + 1))
    return cand & (lab == int(np.argmax(on_grass)) + 1)


def classify(dets: list[Detection], mask: np.ndarray, *, touchline: bool = False) -> list[bool]:
    """`on_pitch` per detection (same order). touchline=True (ADR-034): a person whose feet are just off the grass edge (a player on the
    touchline, a far-side player whose feet merge with the line or a shadow) is kept when grass lies within half a body height below or
    beside the feet; people in the stands are still rejected (no grass near their feet)."""
    mh, mw = mask.shape
    rows = np.where(mask.mean(axis=1) > 0.25)[0]
    cols = np.where(mask.mean(axis=0) > 0.05)[0]
    top = rows.min() / mh if rows.size else 1.0
    left, right = (cols.min() / mw, (cols.max() + 1) / mw) if cols.size else (0.0, 0.0)
    out = []
    for d in dets:
        if d.label == "BALL":
            cx, cy = d.x + d.w / 2, d.y + d.h / 2
            out.append(bool(rows.size) and left <= cx <= right and cy >= top - 0.15)
            continue
        fx, fy = d.x + d.w / 2, d.y + d.h
        x0, x1 = int(max(0, (fx - d.w * 0.35) * mw)), int(min(mw, (fx + d.w * 0.35) * mw) + 1)
        y0, y1 = int(min(mh - 1, max(0, (fy - d.h * 0.05) * mh))), int(min(mh, (fy + max(d.h * 0.08, 0.01)) * mh) + 1)
        patch = mask[y0:max(y1, y0 + 1), x0:max(x1, x0 + 1)]
        ok = bool(patch.size) and float(patch.mean()) >= 0.3
        if not ok and touchline and d.h >= 0.25:
            # a close-up (a player filling a quarter of the picture or more): the patch under his boots is small next to his shadow, the
            # boots and the line he stands on, so look at the turf around his whole lower body. Spectators are never this large on a pitch shot.
            X0, X1 = int(max(0, (fx - d.w * 1.5) * mw)), int(min(mw, (fx + d.w * 1.5) * mw) + 1)
            Y0, Y1 = int(max(0, (fy - d.h * 0.4) * mh)), int(min(mh, (fy + d.h * 0.1) * mh) + 1)
            wide = mask[Y0:max(Y1, Y0 + 1), X0:max(X1, X0 + 1)]
            ok = bool(wide.size) and float(wide.mean()) >= 0.2
        if not ok and touchline:
            m = max(d.h * 0.5, 0.01)
            X0, X1 = int(max(0, (fx - d.w - m) * mw)), int(min(mw, (fx + d.w + m) * mw) + 1)
            Y0, Y1 = int(min(mh - 1, max(0, (fy - d.h * 0.1) * mh))), int(min(mh, (fy + m) * mh) + 1)
            near = mask[Y0:max(Y1, Y0 + 1), X0:max(X1, X0 + 1)]
            ok = bool(near.size) and float(near.mean()) >= 0.3 and fy >= top - 0.02
        out.append(ok)
    return out


def playing_surface(mask: np.ndarray) -> np.ndarray:
    """The playing surface (ADR-034): the LARGEST connected grass region after closing the gaps that lines, players and shadows cut
    into it, then filled. Green seats, a grass bank behind the stands or a green board are separate, smaller regions — colour alone
    accepts them, geometry does not. Returns a mask of the same (1/8) resolution."""
    from scipy import ndimage
    if not mask.any():
        return mask
    closed = ndimage.binary_closing(mask, structure=np.ones((5, 5), bool), iterations=2)
    lab, n = ndimage.label(closed)
    if n == 0:
        return mask
    sizes = ndimage.sum(closed, lab, index=range(1, n + 1))
    surface = lab == (int(np.argmax(sizes)) + 1)
    # players standing on the surface leave holes in the mask: fill those (only holes enclosed by the surface — a region below the
    # near touchline, such as photographers on a carpet, is not enclosed and stays outside)
    return ndimage.binary_fill_holes(surface)


def classify_surface(dets: list[Detection], mask: np.ndarray, *, margin: float = 0.5) -> list[bool]:
    """`on_pitch` from the playing surface: a person counts when the point under the feet lies on the surface, or within `margin`
    body heights of it (touchline). People on separate green regions (stands) and on boards are rejected. The ball: inside the
    surface's horizontal extent and not far above it."""
    surf = playing_surface(mask)
    mh, mw = surf.shape
    cols = np.where(surf.any(axis=0))[0]
    rows = np.where(surf.any(axis=1))[0]
    top = rows.min() / mh if rows.size else 1.0
    out = []
    for d in dets:
        if d.label == "BALL":
            cx, cy = d.x + d.w / 2, d.y + d.h / 2
            out.append(bool(cols.size) and cols.min() / mw <= cx <= (cols.max() + 1) / mw and cy >= top - 0.15)
            continue
        fx, fy = d.x + d.w / 2, d.y + d.h
        # the feet: on the surface, or within `margin` body heights of it sideways or below (a player on the touchline, a far-side
        # player whose feet merge with the line). Surface ABOVE the feet does not count: that is someone below the near touchline.
        m = max(d.h * margin, 0.008)
        y0, y1 = int(max(0, (fy - d.h * 0.12) * mh)), int(min(mh, fy * mh + 1) + 1)
        x0, x1 = int(max(0, (fx - m) * mw)), int(min(mw, (fx + m) * mw) + 1)
        feet_ok = bool(surf[y0:int(min(mh, (fy + m) * mh) + 1), x0:x1].any())
        # grass BESIDE the feet (a person standing on grass has grass to at least one side at foot level; a spectator behind the
        # perimeter wall has wall there, even when the box ends exactly at the grass edge)
        side = max(d.w * 1.2, 0.006)
        y0, y1 = int(max(0, (fy - d.h * 0.18) * mh)), int(max(1, (fy - d.h * 0.03) * mh)) + 1     # shin level, not the foot row itself
        L = mask[y0:y1, int(max(0, (fx - side - d.w / 2) * mw)):int(max(0, (fx - d.w / 2) * mw)) + 1]
        R = mask[y0:y1, int(min(mw - 1, (fx + d.w / 2) * mw)):int(min(mw, (fx + side + d.w / 2) * mw)) + 1]
        beside = max(float(L.mean()) if L.size else 0.0, float(R.mean()) if R.size else 0.0) >= 0.35
        out.append(feet_ok and beside)
    return out
