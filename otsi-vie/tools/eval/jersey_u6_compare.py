"""Compare shirt-number reading on skewed vs perspective-rectified torso crops (Track U.6 measurement).

Synthetic only: digits rendered with DejaVuSans-Bold, skewed with PIL's perspective transform (independent of the
worker's warp), read by a tiny template matcher (normalised MSE against front-on templates). The worker's
``vie_worker.geometry.warp_quad`` rectifies each skewed crop with the TRUE quad, and ``vie_worker.jersey``
supplies the torso band. Three configs per skew level: front-on (baseline), skewed (the failing case), rectified.

Honesty limits of this experiment (read before quoting any number):
  * The template matcher is NOT PaddleOCR: no DB detection, no CTC recognition, no model was involved. These numbers
    measure how much rectification restores glyph shape, not OCR accuracy on real shirts.
  * No footage and no labelled set exist here, so no real OCR accuracy is claimed and none can be: a real U.6 number
    needs labelled Sukhum crops with a live JerseyReader (PaddleOCR via OpenVINO, absent in this workspace).
  * The rectification uses the TRUE quad (the skew that was applied). In production the quad must be supplied by the
    caller (see jersey.RectifySpec); nothing here estimates taper/shear from a box, and a wrong quad helps nothing.

Usage:
  python otsi-vie/tools/eval/jersey_u6_compare.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

WORKER = Path(__file__).resolve().parents[2] / "services" / "worker"
sys.path.insert(0, str(WORKER))

from vie_worker import geometry as g  # noqa: E402

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def digit_img(d, size=(60, 80)):
    im = Image.new("L", size, 255)
    f = ImageFont.truetype(FONT, 64)
    ImageDraw.Draw(im).text((size[0] / 2, size[1] / 2), d, font=f, fill=0, anchor="mm")
    return np.asarray(im, float) / 255.0


def templates():
    return {str(d): digit_img(str(d)) for d in range(10)}


def match(img, tmpls):
    a = np.asarray(Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((60, 80)), float) / 255.0
    scores = sorted(((float(np.mean((a - t) ** 2)), d) for d, t in tmpls.items()))
    return scores[0][1], scores[1][0] - scores[0][0]


def _persp_coeffs(out_size, quad):
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


def skew(img, taper, shear):
    """A front-on image photographed as a torso: top edge compressed (taper) and shifted (shear)."""
    h, w = img.shape
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    quad = [(taper * w / 2 + shear * w, 0), (w - taper * w / 2 + shear * w, 0), (w, h), (0, h)]
    return np.asarray(im.transform((w, h), Image.PERSPECTIVE, _persp_coeffs((w, h), quad), Image.BICUBIC), float) / 255.0


def rectified(img, taper, shear):
    h, w = img.shape
    quad = g.torso_band_quad(w, h, taper, shear)
    return g.warp_quad((np.clip(img, 0, 1) * 255).astype(np.uint8), quad, w, h).astype(float) / 255.0


def two_digit(number):
    im = Image.new("L", (200, 160), 235)
    f = ImageFont.truetype(FONT, 110)
    ImageDraw.Draw(im).text((100, 80), number, font=f, fill=20, anchor="mm")
    return np.asarray(im, float) / 255.0


def main():
    if not Path(FONT).exists():
        print("DejaVuSans-Bold not found; cannot render synthetic digits")
        return 2
    tmpls = templates()
    print(f"{'skew (taper, shear)':<22}{'front-on':>10}{'skewed':>10}{'rectified':>11}{'mean margin skew->rect':>24}")
    for taper, shear in [(0.25, 0.15), (0.4, 0.25)]:
        front = sum(match(digit_img(str(d)), tmpls)[0] == str(d) for d in range(10))
        sk_ok, rec_ok, m0, m1 = 0, 0, [], []
        for d in range(10):
            sk = skew(digit_img(str(d)), taper, shear)
            p, m = match(sk, tmpls)
            sk_ok += p == str(d)
            m0.append(m)
            p, m = match(rectified(sk, taper, shear), tmpls)
            rec_ok += p == str(d)
            m1.append(m)
        print(f"({taper}, {shear})".ljust(22) + f"{front}/10".rjust(10) + f"{sk_ok}/10".rjust(10) + f"{rec_ok}/10".rjust(11)
              + f"{np.mean(m0):.4f} -> {np.mean(m1):.4f}".rjust(24))
    img = two_digit("23")
    sk = skew(img, 0.25, 0.15)
    cells = lambda im: [im[:, 20:90], im[:, 110:180]]
    print("number '23': front-on reads as", "".join(match(c, tmpls)[0] for c in cells(img)),
          "| skewed reads as", "".join(match(c, tmpls)[0] for c in cells(sk)),
          "| rectified reads as", "".join(match(c, tmpls)[0] for c in cells(rectified(sk, 0.25, 0.15))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
