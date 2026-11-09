"""Per-frame follower for the tracker: where each player's picture actually went between two analysed frames.

The detector looks at sample_fps frames a second (6); between two of them a player can move half his width and two players can cross. The tracker's
constant-velocity prediction then pairs boxes by guess, and players of one team who cross swap track numbers (a spotlight would follow the wrong
man). Between two analysed frames every video frame is read (small, grey) and each live track's picture is followed frame to frame by phase
correlation of the patch around it (a few pixels per frame: unambiguous); the tracker gets that position as its prediction for the next analysed
frame. Nothing here is stored or drawn: the boxes are still the detector's; only who-is-who is better.

Measured on the owner's match (2026-10-31; detector on every frame as reference, three 20 s stretches): jumps of a track between two visible
players 9 -> 2, 6 -> 2, 1 -> 0; missing boxes and box accuracy unchanged or slightly better.
"""
from __future__ import annotations

from typing import Iterator

import numpy as np

FOLLOW_WIDTH = 960              # px: the grey frames the follower reads (half of 1080p: plenty for a patch match, a quarter of the data)
MAX_STEP = 0.6                  # a frame-to-frame move larger than this share of the box is a mismatch (another player, motion blur): ignored


def patch_shift(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """Translation (px) of patch b relative to patch a: phase correlation with a Hann window."""
    h, w = a.shape
    win = np.outer(np.hanning(h), np.hanning(w))
    fa, fb = np.fft.fft2((a - a.mean()) * win), np.fft.fft2((b - b.mean()) * win)
    r = fb * np.conj(fa)
    c = np.abs(np.fft.ifft2(r / np.maximum(np.abs(r), 1e-9)))
    py, px = np.unravel_index(int(np.argmax(c)), c.shape)
    if px > w / 2:
        px -= w
    if py > h / 2:
        py -= h
    return float(px), float(py)


def follow_centre(grays: list[np.ndarray], box: tuple[float, float, float, float]) -> tuple[float, float] | None:
    """The centre (normalised) of the player whose box (normalised x, y, w, h) was measured in grays[0], after following his picture through
    grays[1:]. None when the patch leaves the picture."""
    if len(grays) < 2:
        return None
    H, W = grays[0].shape
    cx, cy = (box[0] + box[2] / 2) * W, (box[1] + box[3] / 2) * H
    bw, bh = box[2] * W, box[3] * H
    pw, ph = int(max(12, bw * 1.8)) // 2 * 2, int(max(16, bh * 1.4)) // 2 * 2         # the player and a little ground around him
    for a, b in zip(grays, grays[1:]):
        x0, y0 = int(round(cx - pw / 2)), int(round(cy - ph / 2))
        if x0 < 0 or y0 < 0 or x0 + pw > W or y0 + ph > H:
            return None
        dx, dy = patch_shift(a[y0:y0 + ph, x0:x0 + pw].astype(np.float32), b[y0:y0 + ph, x0:x0 + pw].astype(np.float32))
        if abs(dx) > MAX_STEP * bw or abs(dy) > MAX_STEP * bh:
            dx, dy = 0.0, 0.0
        cx, cy = cx + dx, cy + dy
    return cx / W, cy / H


class FrameStream:
    """Every frame of the video, grey and small, read alongside the analysed frames. `between(pts)` returns the frames from the previous call's
    frame up to and including the frame at `pts` ([] at the first call, or when the stream cannot reach `pts`)."""

    def __init__(self, frames: Iterator):
        self._it = frames
        self._last = None                       # (pts_us, gray) of the previous analysed frame
        self._pending = None

    def between(self, pts_us: int) -> list[np.ndarray]:
        out = [self._last[1]] if self._last is not None else []
        while True:
            f = self._pending or next(self._it, None)
            self._pending = None
            if f is None:
                self._last = None
                return []
            if f.pts_us < pts_us - 1_000:
                if out:
                    out.append(f.rgb)
                continue
            if f.pts_us > pts_us + 1_000:            # the analysed frame is not in this stream (should not happen): start again from here
                self._pending = f
                self._last = None
                return []
            self._last = (f.pts_us, f.rgb)
            out.append(f.rgb)
            return out if len(out) >= 2 else []

    def close(self) -> None:
        """Stop the reader (its FFmpeg process ends with the generator)."""
        close = getattr(self._it, "close", None)
        if close:
            close()
