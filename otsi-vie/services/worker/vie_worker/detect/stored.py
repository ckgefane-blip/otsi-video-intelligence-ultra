"""Re-track: the detections of an earlier finished run of the SAME video, replayed instead of running the detector again.

Detecting is the slow part of an analysis (hours); everything after it (pitch filter, tracking, confirmation, kit colours, shirt numbers,
saving) is quick. When the tracking or the pitch/kit logic improves, the saved raw detections (the immutable evidence file of the earlier
run, every detection with its score) can be tracked again at once. Nothing is invented: a frame gets exactly the detections the detector
found in it, matched by presentation time, and a frame the earlier run did not sample gets none.
"""
from __future__ import annotations

import numpy as np
import pyarrow.parquet as pq

from .base import Detection


class StoredDetector:
    runtime = "stored-detections"

    def __init__(self, path: str, source_run_id: str, model_name: str):
        t = pq.read_table(path, columns=["pts_us", "label", "score", "x", "y", "w", "h"]).to_pydict()
        order = np.argsort(np.asarray(t["pts_us"], dtype=np.int64), kind="stable")           # the file is already in time order; be sure
        self._pts = np.asarray(t["pts_us"], dtype=np.int64)[order]
        self._label = np.asarray(t["label"], dtype=object)[order]
        self._score, self._x, self._y, self._w, self._h = (np.asarray(t[k], dtype=np.float64)[order] for k in ("score", "x", "y", "w", "h"))
        self.entry = {"key": model_name, "source_run": source_run_id}
        self.weights_sha256 = None

    def detect_frames(self, frames) -> list[list[Detection]]:
        out = []
        for f in frames:
            lo, hi = np.searchsorted(self._pts, f.pts_us, "left"), np.searchsorted(self._pts, f.pts_us, "right")
            out.append([Detection(label=str(self._label[i]), score=float(self._score[i]), x=float(self._x[i]), y=float(self._y[i]),
                                  w=float(self._w[i]), h=float(self._h[i])) for i in range(lo, hi)])
        return out

    def detect(self, rgbs):                                   # the normal entry point is detect_frames (needs the frame times)
        raise RuntimeError("StoredDetector replays saved detections by frame time: use detect_frames")
