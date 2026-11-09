"""Reading frames for analysis (media contract, blueprint 03): every decoded frame gets its display-order `frame_index` and its real
presentation time `pts_us` = microseconds since the video's first frame (from the stream's timestamps — variable frame rate stays exact;
never frame_index / fps). Frames are sampled on a time grid (sample_fps) because detection cannot look at every frame of a match.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import ff

MAX_ANALYSIS_WIDTH = 1920            # 4K sources are analysed at 1080p width: the detector resizes far below that anyway


@dataclass
class SampledFrame:
    frame_index: int
    pts_us: int
    keyframe: bool
    rgb: np.ndarray                  # (H, W, 3) uint8
    width: int                       # decoded (source) frame size the boxes are normalised to
    height: int


def sample_frames(path: str, sample_fps: float, *, start_us: int = 0):
    """Frames on the sampling grid, decoded by the LGPL FFmpeg in its own process (vie_worker.ff)."""
    for f in ff.decode_sampled(path, sample_fps, max_width=MAX_ANALYSIS_WIDTH, start_us=start_us):
        yield SampledFrame(f.frame_index, f.pts_us, f.keyframe, f.rgb, f.width, f.height)


class CutDetector:
    """Hard camera cuts between consecutive samples: a large change of the colour distribution (HSV histogram, Bhattacharyya distance)
    together with a large mean pixel change. A track never continues across a cut (blueprint: no trajectory bridges a cut)."""

    def __init__(self, threshold: float = 0.45, pixel_threshold: float = 30.0):
        self.threshold, self.pixel_threshold = threshold, pixel_threshold
        self.prev_hist: np.ndarray | None = None
        self.prev_small: np.ndarray | None = None

    @staticmethod
    def _features(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        small = rgb[:: max(1, rgb.shape[0] // 72), :: max(1, rgb.shape[1] // 128)].astype(np.float32)
        r, g, b = small[..., 0] / 255, small[..., 1] / 255, small[..., 2] / 255
        mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
        d = mx - mn + 1e-6
        hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
        sat = np.where(mx > 0, d / (mx + 1e-6), 0)
        hist, _, _ = np.histogram2d(hue.ravel(), sat.ravel(), bins=(16, 8), range=((0, 1), (0, 1)))
        hist = hist.ravel() / max(1.0, hist.sum())
        return hist, small.mean(axis=2)

    def is_cut(self, rgb: np.ndarray) -> bool:
        hist, small = self._features(rgb)
        cut = False
        if self.prev_hist is not None and self.prev_small is not None and small.shape == self.prev_small.shape:
            bc = float(np.sum(np.sqrt(hist * self.prev_hist)))
            dist = float(np.sqrt(max(0.0, 1 - bc)))
            pixel = float(np.mean(np.abs(small - self.prev_small)))
            cut = dist > self.threshold and pixel > self.pixel_threshold
        self.prev_hist, self.prev_small = hist, small
        return cut
