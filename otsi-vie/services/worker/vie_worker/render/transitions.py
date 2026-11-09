"""Transitions between reel clips (ADR-055, page 07 Transitions lane).

A transition into clip B is drawn over B's first frames: the picture of the clip before it (A) keeps running past A's out point (its
handle, real footage of the source video) and blends into B. The reel's length and its sound do not change, so picture and sound stay in
step. Where the source has no footage after A's out point (the end of the video) A's last picture is held instead.

  FADE      A goes to black, then B comes up from black (the one transition that shows black, on purpose)
  DISSOLVE  A melts into B
  ZOOM      A pushes in (up to 1.3 x) while it melts into B
  SPIN      A turns a quarter turn and shrinks away over B
"""
from __future__ import annotations

import numpy as np

KINDS = ("FADE", "DISSOLVE", "ZOOM", "SPIN")
MAX_US = 1_000_000


def frame_count(duration_us: int, fps: float, next_clip_frames: int) -> int:
    """How many frames a transition takes: its length on the reel's frame rate, at most half of the clip it leads into, at least 2."""
    n = int(round(min(duration_us, MAX_US) * fps / 1e6))
    return max(0, min(n, next_clip_frames // 2)) if n >= 2 else 0


def _mix(a: np.ndarray, b: np.ndarray, p: float) -> np.ndarray:
    return (a.astype(np.float32) * (1.0 - p) + b.astype(np.float32) * p).astype(np.uint8)


def _zoom(a: np.ndarray, s: float) -> np.ndarray:
    """a scaled by s about its centre, cropped back to its size"""
    if s <= 1.0001:
        return a
    from PIL import Image
    h, w = a.shape[:2]
    cw, ch = max(2, int(round(w / s))), max(2, int(round(h / s)))
    x0, y0 = (w - cw) // 2, (h - ch) // 2
    return np.asarray(Image.fromarray(np.ascontiguousarray(a[y0:y0 + ch, x0:x0 + cw])).resize((w, h), Image.BILINEAR))


def _spin(a: np.ndarray, b: np.ndarray, p: float) -> np.ndarray:
    """a turned by 90 * p degrees and shrunk to (1 - 0.7 p) of its size, laid over b (fading out over the last third)"""
    from PIL import Image
    h, w = a.shape[:2]
    s = max(0.05, 1.0 - 0.7 * p)
    sw, sh = max(2, int(w * s)), max(2, int(h * s))
    im = Image.fromarray(np.ascontiguousarray(a)).resize((sw, sh), Image.BILINEAR).convert("RGBA").rotate(90.0 * p, resample=Image.BILINEAR, expand=True)
    alpha = 1.0 if p < 2 / 3 else max(0.0, 3.0 * (1.0 - p))
    base = Image.fromarray(np.ascontiguousarray(b)).convert("RGBA")
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    layer.paste(im, ((w - im.width) // 2, (h - im.height) // 2), im)
    if alpha < 1.0:
        layer.putalpha(Image.fromarray((np.asarray(layer.getchannel("A"), dtype=np.float32) * alpha).astype(np.uint8)))
    return np.asarray(Image.alpha_composite(base, layer).convert("RGB"))


def blend(kind: str, a: np.ndarray, b: np.ndarray, p: float) -> np.ndarray:
    """One frame of a transition: a = the clip before (its handle), b = the clip it leads into, p in (0, 1) how far it has gone."""
    p = float(min(max(p, 0.0), 1.0))
    if a.shape != b.shape:
        return b
    if kind == "FADE":
        return (a.astype(np.float32) * (1 - 2 * p)).astype(np.uint8) if p < 0.5 else (b.astype(np.float32) * (2 * p - 1)).astype(np.uint8)
    if kind == "ZOOM":
        return _mix(_zoom(a, 1.0 + 0.3 * p), b, p)
    if kind == "SPIN":
        return _spin(a, b, p)
    return _mix(a, b, p)
