"""Track U.7: horizon-guided multi-scale tiling (vie_worker.detect.tiling).

No model and no torch here: every test runs on the pure tiling maths (numpy
only), on synthetic broadcast geometry. The detector wiring itself
(`HfRtDetr.detect(..., tile_windows=...)`) cannot be instantiated in this
workspace (no torch, no weights); it is verified by py_compile and by testing
the pure functions it calls (`windows_from_plan`, `map_tile_box`).
"""
import numpy as np

from vie_worker.detect.tiling import (
    horizon_line,
    horizon_tiles,
    horizon_y,
    map_tile_box,
    passes_for,
    windows_from_plan,
)
from vie_worker.geometry import dlt

W, H = 1920, 1080


def broadcast_h():
    """Strong broadcast perspective: far touchline 0.15 wide at y=0.05, near
    touchline 0.95 wide at y=0.95. Horizon sits just above the frame."""
    pitch = np.array([[-52.5, -34], [52.5, -34], [-52.5, 34], [52.5, 34]], float)
    image = np.array([[0.425, 0.05], [0.575, 0.05], [0.025, 0.95], [0.975, 0.95]], float)
    return dlt(pitch, image)


def inverted_h():
    """The U.4 test trapezoid: wide end at the top, so the horizon sits below
    the frame and the small players are at the bottom, not the top."""
    pitch = np.array([[-52.5, -34], [52.5, -34], [-52.5, 34], [52.5, 34]], float)
    image = np.array([[0.05, 0.15], [0.95, 0.15], [0.25, 0.90], [0.75, 0.90]], float)
    return dlt(pitch, image)


def height_at(feet_y_px, h0_norm, bottom_px=112.0):
    """Pinhole player height: linear in |feet_y - horizon_y|, calibrated so a
    player at the bottom of the frame is `bottom_px` tall."""
    c = bottom_px / abs(H - h0_norm * H)
    return c * abs(feet_y_px - h0_norm * H)


# ------------------------------------------------------------------ the horizon itself
def test_horizon_line_passes_through_both_vanishing_points():
    Hm = broadcast_h()
    line = horizon_line(Hm)
    assert line is not None
    a, b, c = line
    assert abs(a * a + b * b - 1.0) < 1e-9
    for d in ((1, 0), (0, 1)):
        p = Hm @ np.array([d[0], d[1], 0.0])
        if abs(p[2]) > 1e-9:
            v = p[:2] / p[2]
            assert abs(a * v[0] + b * v[1] + c) < 1e-6
        else:
            # vanishing point at infinity: its direction must run along the line
            assert abs(a * p[0] + b * p[1]) < 1e-6


def test_horizon_y_sits_just_above_a_broadcast_frame():
    hy = horizon_y(broadcast_h())
    assert hy is not None
    assert -0.20 < hy < 0.0, hy


def test_no_horizon_without_perspective():
    assert horizon_line(np.eye(3)) is None
    assert horizon_y(np.eye(3)) is None
    affine = np.array([[2.0, 0.0, 0.1], [0.0, 2.0, 0.2], [0.0, 0.0, 1.0]])
    assert horizon_line(affine) is None
    assert horizon_tiles(W, H, np.eye(3)) == []
    assert horizon_tiles(W, H, None) == []
    assert horizon_tiles(W, H, np.array([[1.0, 0.0], [0.0, 1.0]])) == []


def test_horizon_y_is_none_for_a_vertical_horizon():
    # Hv's horizon is the vertical line x = 1 (l = (-1, 0, 1)): no single y exists
    Hv = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0, 1.0]])
    assert horizon_line(Hv) == (-1.0, 0.0, 1.0)
    assert horizon_y(Hv) is None


# ------------------------------------------------------------------ the plan
def test_broadcast_plan_is_five_tiles_far_fine_mid_coarse_near_none():
    tiles = horizon_tiles(W, H, broadcast_h())
    assert len(tiles) == 5, [(t.band, t.grid) for t in tiles]
    far = [t for t in tiles if t.band == "far"]
    mid = [t for t in tiles if t.band == "mid"]
    assert len(far) == 3 and all(t.grid == 3 and t.scale == 2 for t in far)
    assert len(mid) == 2 and all(t.grid == 2 and t.scale == 1 for t in mid)
    assert passes_for(tiles) == 6  # full frame + 5 tiles, against 14 for blind grids=[2, 3]
    for t in tiles:
        assert 0 <= t.x and 0 <= t.y and t.x + t.w <= W and t.y + t.h <= H


def test_far_band_is_the_top_strip_on_broadcast_and_covers_it():
    tiles = horizon_tiles(W, H, broadcast_h())
    far = [t for t in tiles if t.band == "far"]
    assert far and max(t.y + t.h for t in far) <= int(0.45 * H)
    # every sampled point of the far strip is inside at least one far tile
    for y in range(0, int(0.30 * H), 20):
        for x in range(0, W, 97):
            assert any(t.x <= x < t.x + t.w and t.y <= y < t.y + t.h for t in far), (x, y)
    mid = [t for t in tiles if t.band == "mid"]
    for y in range(int(0.35 * H), int(0.60 * H), 20):
        for x in range(0, W, 97):
            assert any(t.x <= x < t.x + t.w and t.y <= y < t.y + t.h for t in mid), (x, y)
    # the near band (bottom third) has no tiles at all: no tile starts there,
    # and no tile ends below 0.75 of the frame — the full-frame pass covers it
    assert all(t.y < int(0.65 * H) for t in tiles)
    assert all(t.y + t.h <= int(0.75 * H) for t in tiles)


def test_far_band_follows_the_horizon_not_the_top_of_frame():
    tiles = horizon_tiles(W, H, inverted_h())
    far = [t for t in tiles if t.band == "far"]
    assert far, "the inverted view still has small players, at the bottom"
    assert min(t.y for t in far) > H // 2, [(t.y, t.h) for t in far]
    assert passes_for(tiles) == 6


def test_tiny_frame_still_tiles_safely():
    tiles = horizon_tiles(320, 180, broadcast_h())
    assert tiles
    for t in tiles:
        assert 0 <= t.x and 0 <= t.y and t.x + t.w <= 320 and t.y + t.h <= 180


# ------------------------------------------------------------------ mapping / windows
def test_map_tile_box_round_trip_and_degenerate():
    from vie_worker.detect.tiling import Tile
    tile = Tile(100, 50, 400, 300, "far", 3, 2)
    got = map_tile_box(tile, 10, 20, 50, 80, W, H)
    assert got is not None
    assert np.allclose(got, (110 / W, 70 / H, 40 / W, 60 / H), atol=1e-12)
    assert map_tile_box(tile, 0, 0, 0, 50, W, H) is None
    assert map_tile_box(tile, 10, 20, 10, 80, W, H) is None


def test_windows_from_plan_preserves_scales():
    tiles = horizon_tiles(W, H, broadcast_h())
    wins = windows_from_plan(tiles)
    assert len(wins) == 5
    assert sorted(s for _, s in wins) == [1, 1, 2, 2, 2]
    assert windows_from_plan([]) == []


# ------------------------------------------------------------------ the detector model (synthetic)
def _found(height_px, window_h_px, min_input_px=20.0, model_input=640):
    """A player is found iff it is at least `min_input_px` tall in the 640
    model input — the stated detector model for the synthetic measurement."""
    return height_px * model_input / window_h_px >= min_input_px


def test_small_distant_player_missed_full_frame_found_tiled():
    Hm = broadcast_h()
    hy = horizon_y(Hm)
    assert hy is not None
    tiles = horizon_tiles(W, H, Hm)
    far_h = max(t.h for t in tiles if t.band == "far")
    for feet_y in (90, 120, 200):
        h = height_at(feet_y, hy)
        assert 0 < h < 34, (feet_y, h)  # the 0-20 px bin in the model input
        assert not _found(h, H), "full-frame must miss this one"
        assert _found(h, far_h), "the far tile must find it"
    for feet_y in (800, 1070):
        h = height_at(feet_y, hy)
        assert _found(h, H), "near players are found either way"


def test_horizon_plan_costs_fewer_passes_than_blind_grids():
    tiles = horizon_tiles(W, H, broadcast_h())
    assert passes_for(tiles) == 6
    assert passes_for(tiles) < 1 + 2 * 2 + 3 * 3  # blind grids=[2, 3]: 14 passes
