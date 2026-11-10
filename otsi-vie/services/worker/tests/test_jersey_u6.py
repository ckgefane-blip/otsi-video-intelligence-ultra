"""Track U.6: perspective-rectified jersey OCR (vie_worker.geometry, vie_worker.jersey, vie_worker.ocr).

Synthetic only: digits rendered with DejaVuSans-Bold, skewed with PIL's perspective transform (independent of the
worker's warp), read by a tiny template matcher (normalised MSE against front-on templates). No PaddleOCR model, no
footage, no labelled set exists here — the numbers below are rectification benefit on synthetic glyphs, not OCR
accuracy on real shirts. If the DejaVu font is absent the glyph tests return early (skipped, not failed).
"""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from vie_worker import geometry as g
from vie_worker import jersey as jer
from vie_worker.ocr import NullReader, Read

@contextmanager
def raises(exc):
    """The block must raise `exc` (a raises-helper with no test-framework dependency)."""
    try:
        yield
    except exc:
        return
    raise AssertionError(f"expected {exc.__name__}")

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _font(size):
    p = Path(FONT)
    return ImageFont.truetype(str(p), size) if p.exists() else None


def digit_img(d, size=(60, 80)):
    f = _font(64)
    assert f is not None, "DejaVuSans-Bold not found"
    im = Image.new("L", size, 255)
    ImageDraw.Draw(im).text((size[0] / 2, size[1] / 2), d, font=f, fill=0, anchor="mm")
    return np.asarray(im, float) / 255.0


def templates():
    return {str(d): digit_img(str(d)) for d in range(10)}


def match(img, tmpls):
    """(predicted digit, best MSE, margin over second-best) on a grey image, resized to template size."""
    a = np.asarray(Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((60, 80)), float) / 255.0
    scores = sorted(((float(np.mean((a - t) ** 2)), d) for d, t in tmpls.items()))
    return scores[0][1], scores[0][0], scores[1][0] - scores[0][0]


def _persp_coeffs(out_size, quad):
    """PIL PERSPECTIVE coefficients: output pixel p samples the front-on image at F^-1(p), F mapping the front-on
    rectangle onto `quad` — the front-on content squeezed into the trapezoid, as a camera does to a chest."""
    w, h = out_size
    dst = np.array([[0, 0], [w, 0], [w, h], [0, h]], float)
    src = np.asarray(quad, float)
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    sol, *_ = np.linalg.lstsq(np.asarray(A), dst.ravel(), rcond=None)
    H = np.append(sol, 1.0).reshape(3, 3)
    return tuple((H / H[2, 2]).ravel()[:8])


def skew(img, taper=0.25, shear=0.15):
    """A front-on image photographed as a torso: top edge compressed (taper) and shifted (shear)."""
    h, w = img.shape
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    quad = [(taper * w / 2 + shear * w, 0), (w - taper * w / 2 + shear * w, 0), (w, h), (0, h)]
    return np.asarray(im.transform((w, h), Image.PERSPECTIVE, _persp_coeffs((w, h), quad), Image.BICUBIC), float) / 255.0


def two_digit(number):
    f = _font(110)
    assert f is not None, "DejaVuSans-Bold not found"
    im = Image.new("L", (200, 160), 235)
    ImageDraw.Draw(im).text((100, 80), number, font=f, fill=20, anchor="mm")
    return np.asarray(im, float) / 255.0


def rectified(img, taper, shear):
    """The worker's warp with the TRUE quad (what the caller supplies in production)."""
    h, w = img.shape
    quad = g.torso_band_quad(w, h, taper, shear)
    return g.warp_quad((np.clip(img, 0, 1) * 255).astype(np.uint8), quad, w, h).astype(float) / 255.0


class RecordingReader:
    """A fake OCR provider: records which method was called with what, reads nothing."""

    def __init__(self):
        self.read_calls, self.torso_calls = [], []

    def read(self, crops):
        self.read_calls.append([np.asarray(c).shape for c in crops])
        return [Read(None, 0.0) for _ in crops]

    def read_torso(self, torsos):
        self.torso_calls.append([np.asarray(t).shape for t in torsos])
        return [Read(None, 0.0) for _ in torsos]


# ------------------------------------------------------------------ the warp itself
def test_rectify_is_identity_when_the_quad_is_a_rectangle():
    img = (np.random.default_rng(0).random((60, 80)) * 255).astype(np.uint8)
    out = g.warp_quad(img, g.torso_band_quad(80, 60), 80, 60)
    assert out.shape == img.shape and int(np.abs(out.astype(int) - img.astype(int)).max()) == 0
    grey = (np.random.default_rng(1).random((40, 50))).astype(np.float32)
    assert np.allclose(g.warp_quad(grey, g.torso_band_quad(50, 40), 50, 40), grey)


def test_rectify_recovers_a_skewed_number():
    if not Path(FONT).exists():
        return
    tmpls = templates()
    img = two_digit("23")
    sk = skew(img, 0.25, 0.15)
    skewed = "".join(match(c, tmpls)[0] for c in [sk[:, 20:90], sk[:, 110:180]])
    assert skewed != "23"  # the failing case: the number is unreadable skewed
    rec = rectified(sk, 0.25, 0.15)
    assert "".join(match(c, tmpls)[0] for c in [rec[:, 20:90], rec[:, 110:180]]) == "23"


def test_rectify_recovers_all_skewed_digits():
    if not Path(FONT).exists():
        return
    tmpls = templates()
    for taper, shear in [(0.25, 0.15), (0.4, 0.25)]:
        skewed_ok, rect_ok = 0, 0
        for d in range(10):
            sk = skew(digit_img(str(d)), taper, shear)
            skewed_ok += match(sk, tmpls)[0] == str(d)
            rect_ok += match(rectified(sk, taper, shear), tmpls)[0] == str(d)
        assert skewed_ok < rect_ok
        assert rect_ok == 10


def test_degenerate_quad_is_refused():
    img = np.zeros((20, 20), np.uint8)
    for bad in ([[0, 0], [0, 0], [10, 0], [10, 10]], [[0, 0], [10, 0], [20, 0], [30, 0]],
                [[0, 0], [float("nan"), 0], [10, 10], [0, 10]], [[0, 0], [10, 0], [10, 10]]):
        with raises(ValueError):
            g.warp_quad(img, np.array(bad, float), 20, 20)
    with raises(ValueError):
        g.warp_quad(img, g.torso_band_quad(20, 20), 0, 20)
    with raises(ValueError):
        g.torso_band_quad(20, 20, taper=0.9)
    with raises(ValueError):
        g.torso_band_quad(20, 20, shear=0.9)


def test_torso_band_quad_corners():
    q = g.torso_band_quad(100, 60)
    assert np.allclose(q, [[0, 0], [100, 0], [100, 60], [0, 60]])
    q = g.torso_band_quad(100, 60, taper=0.4, shear=0.1)
    assert np.allclose(q, [[30, 0], [90, 0], [100, 60], [0, 60]])  # top inset 20 each side, shifted 10 right


# ------------------------------------------------------------------ the number region + interface
def test_rectified_torso_keeps_size_by_default_and_respects_explicit_size():
    crop = (np.random.default_rng(2).random((200, 100, 3)) * 255).astype(np.uint8)
    band = jer.rectified_torso(crop)
    assert band.shape == (120, 100, 3)  # ocr.torso: 10-70 % of the height
    assert np.array_equal(band, jer.rectified_torso(crop, jer.RectifySpec()))
    out = jer.rectified_torso(crop, jer.RectifySpec(taper=0.25, shear=0.15, out_w=64, out_h=48))
    assert out.shape == (48, 64, 3)


def test_read_number_with_no_provider_reads_nothing_and_never_crashes():
    crop = np.full((200, 100, 3), 200, np.uint8)
    r = jer.read_number(None, crop)
    assert r.number is None and r.confidence == 0.0
    r = jer.read_number(None, crop, rectify=jer.RectifySpec(taper=0.25, shear=0.15))
    assert r.number is None and r.confidence == 0.0
    r = jer.read_number(NullReader(), np.zeros((3, 3, 3), np.uint8))
    assert r.number is None and r.confidence == 0.0


def test_read_tracks_with_no_provider_is_unreadable_not_a_crash():
    rgb = np.full((300, 200, 3), 220, np.uint8)
    cands = jer.OcrCandidates()
    cands.offer(0, rgb, (0.1, 0.1, 0.5, 0.6), jer.OcrBudget())
    assert len(cands.frames) == 1
    ev = jer.read_tracks({7: cands}, None)[7]
    assert ev.state == "UNREADABLE" and ev.number is None
    ev = jer.read_tracks({7: cands}, None, rectify=jer.RectifySpec(taper=0.25))[7]
    assert ev.state == "UNREADABLE" and ev.number is None


def test_read_tracks_routes_rectified_torsos_to_read_torso_only():
    rgb = np.full((300, 200, 3), 220, np.uint8)
    cands = jer.OcrCandidates()
    cands.offer(0, rgb, (0.1, 0.1, 0.5, 0.6), jer.OcrBudget())
    rec = RecordingReader()
    jer.read_tracks({7: cands}, rec)
    assert len(rec.read_calls) == 1 and not rec.torso_calls
    assert rec.read_calls[0][0] == (191, 110, 3)  # the raw candidate crop
    rec = RecordingReader()
    jer.read_tracks({7: cands}, rec, rectify=jer.RectifySpec(taper=0.25, shear=0.15, out_w=64, out_h=48))
    assert not rec.read_calls and len(rec.torso_calls) == 1
    assert rec.torso_calls[0][0] == (48, 64, 3)  # the rectified torso band, not the raw crop, not cut twice
