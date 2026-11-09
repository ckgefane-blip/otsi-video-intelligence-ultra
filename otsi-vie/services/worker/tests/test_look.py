"""E5 (ADR-068): the render's colour look, zoom and drawings give what the editor shows (same formulas as packages/contracts/src/look.ts;
the sample colours are the ones apps/web/test/look.test.ts checks)."""
import subprocess

import numpy as np
import pytest

from vie_worker import ff
from vie_worker.render import look as lk

SAMPLES = [
    ({}, [0.2, 0.5, 0.8], [0.2, 0.5, 0.8]),
    ({"preset": "MONO"}, [0.2, 0.5, 0.8], [0.4537, 0.4537, 0.4537]),
    ({"exposure": 0.5, "contrast": 1.2}, [0.2, 0.5, 0.8], [0.2394, 0.7485, 1]),
    ({"preset": "WARM", "strength": 0.5, "temperature": 0.2}, [0.3, 0.4, 0.5], [0.3228, 0.4056, 0.4739]),
    ({"match": {"r": [1.2, -0.05], "g": [1, 0], "b": [0.8, 0.1], "label": "ref"}}, [0.5, 0.5, 0.5], [0.55, 0.5, 0.5]),
]


@pytest.mark.parametrize("look,rgb,want", SAMPLES)
def test_the_look_formula_matches_the_editor(look, rgb, want):
    assert np.allclose(lk.apply(lk.channels(look), np.array(rgb)), want, atol=1e-3)


def test_neutral_looks_are_left_out():
    assert lk.is_neutral(None) and lk.is_neutral({}) and lk.is_neutral({"preset": "FILM", "strength": 0})
    assert not lk.is_neutral({"saturation": 1.2})


def _frame(vf: str | None) -> np.ndarray:
    chain = "format=rgb24" + (f",{vf},format=rgb24" if vf else "")
    out = subprocess.run([ff.tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25:duration=0.04",
                          "-vf", chain, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], capture_output=True, check=True, creationflags=ff.NO_WINDOW).stdout
    return np.frombuffer(out, np.uint8).reshape(180, 320, 3)


@pytest.mark.parametrize("look", [{"preset": "PUNCHY"}, {"preset": "COOL", "exposure": -0.2}, {"preset": "FILM", "strength": 0.7, "saturation": 1.3}])
def test_the_lut_ffmpeg_applies_gives_the_formulas_colours(tmp_path, look):
    """the .cube through FFmpeg's lut3d (with a Windows path in the filter) against the formula on the same pixels: within 2 levels on average"""
    raw = _frame(None)
    graded = _frame(lk.lut_filter(lk.write_cube(look, tmp_path / "look.cube")))
    want = lk.apply(lk.channels(look), raw.astype(np.float64) / 255) * 255
    assert np.abs(graded.astype(np.float64) - want).mean() < 2.0
    assert np.abs(graded.astype(np.float64) - raw).mean() > 1.0         # and it did change the picture (a saturated test card)


def test_zoom_keys_and_window():
    keys = [{"at_ms": 0, "zoom": 1}, {"at_ms": 1000, "zoom": 2, "ease": "LINEAR"}, {"at_ms": 2000, "zoom": 1.5, "ease": "HOLD"}, {"at_ms": 3000, "zoom": 3}]
    assert lk.zoom_at([], 5) == 1 and abs(lk.zoom_at(keys, 250) - 1.15625) < 1e-9 and lk.zoom_at(keys, 1500) == 1.75
    assert lk.zoom_at(keys, 2500) == 1.5 and lk.zoom_at(keys, 9000) == 3
    assert lk.zoom_window(2, 100, 100, 1920, 1080) == (0, 0, 960, 540)
    img = np.zeros((90, 160, 3), np.uint8)
    img[40:50, 75:85] = 255                                              # a white square in the middle
    z = lk.zoom(img, 2, 80, 45)
    assert z.shape == img.shape and (z > 128).all(axis=2).sum() > 4 * ((img > 128).all(axis=2).sum()) * 0.8   # twice as wide and tall


def test_a_drawing_draws_on_holds_and_fades():
    d = {"kind": "ARROW", "x1": 0.1, "y1": 0.5, "x2": 0.9, "y2": 0.5, "color": "RED", "at_ms": 1000, "draw_ms": 600, "hold_ms": 2000}
    assert lk.drawing_at(d, 999) is None and lk.drawing_at(d, 1300) == (0.5, 1.0) and lk.drawing_at(d, 3601) is None
    img = np.zeros((180, 320, 3), np.uint8)
    to_px = lambda x, y: (x * 320, y * 180)                               # noqa: E731
    red = lambda a: ((a[..., 0] > 200) & (a[..., 1] < 120)).sum(axis=0) > 0   # noqa: E731  columns with red in them
    half, full = lk.draw(img, [d], 1300, to_px), lk.draw(img, [d], 2000, to_px)
    assert red(half)[40:150].all() and not red(half)[200:].any()          # half drawn: from x1 to the middle
    assert red(full)[40:280].all()
    faded = lk.draw(img, [d], 3475, to_px)
    assert 60 < faded[90, 160, 0] < 200                                  # half faded
    assert (lk.draw(img, [d], 500, to_px) == img).all()                  # not yet: untouched
    circle = lk.draw(img, [{**d, "kind": "CIRCLE", "x1": 0.5, "y1": 0.5, "x2": 0.6, "y2": 0.5}], 2000, to_px)
    assert circle[90, 160].sum() == 0 and red(circle)[186:198].any() and red(circle)[122:134].any()   # a ring of radius 32 px, empty inside
