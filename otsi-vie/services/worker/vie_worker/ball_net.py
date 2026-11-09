"""The ball model on whole frames (ADR-038): three consecutive video frames in, a heat map of the ball's centre out, on OpenVINO (the Arc GPU,
CPU fallback). Our own network (tools/models/ball_train.py), trained on the owner's footage; the file is pinned by SHA-256 in the model
registry (key `ball_net`) and lives in .local/models/ball_net/<sha16>/model.onnx.

`candidates(path, times)` decodes the video once, front to back, keeps a sliding window of three frames and, for each analysed moment, runs the
network on (previous, this, next) frame; the heat map's local maxima above PEAK_MIN become ball candidates (vie_worker.ball.Cand) for the same
path search as before. Candidates are cached next to the run's detections (Parquet), so following the ball again does not re-run the model.
"""
from __future__ import annotations

import hashlib
import logging
from collections import deque
from pathlib import Path
from typing import Callable

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from . import ff
from .ball import Cand

log = logging.getLogger(__name__)
KEY = "ball_net"
PEAK_MIN = 0.3         # heat-map peaks this strong are candidates (the path search decides; the model's own "sure" is 0.5)
MAX_PEAKS = 6          # per frame
PEAK_APART_PX = 8


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while c := f.read(1 << 22):
            h.update(c)
    return h.hexdigest()


def registered() -> dict | None:
    from .detect.base import registry
    return next((m for m in registry()["models"] if m["key"] == KEY), None)


class BallModel:
    def __init__(self, device: str = "GPU", precision: str = "f16"):
        import openvino as ov
        from .detect.base import models_dir
        entry = registered()
        if not entry:
            raise RuntimeError("no ball model is registered")
        pin = entry["sha256"]
        d = models_dir() / KEY / pin[:16]
        w = d / "weights.pt"
        if not w.exists() or _sha256(w) != pin:
            raise RuntimeError(f"{w} is missing or not the registered file: train it with tools/models/ball_train.py")
        core = ov.Core()
        model = core.read_model(str(d / "model.onnx"))
        for dev in dict.fromkeys([device, "CPU"]):
            try:
                cfg = {"INFERENCE_PRECISION_HINT": precision, "PERFORMANCE_HINT": "THROUGHPUT"} if dev == "GPU" else {"PERFORMANCE_HINT": "THROUGHPUT"}
                self._model, self.device = core.compile_model(model, dev, cfg), dev
                break
            except Exception as e:                                          # noqa: BLE001 - a device that cannot be opened: the next one
                log.warning("ball model: %s not usable (%s)", dev, e)
        else:
            raise RuntimeError("no OpenVINO device could run the ball model")
        self.sha16 = pin[:16]

    @staticmethod
    def tensor(f3: list[np.ndarray]) -> np.ndarray:
        return (np.concatenate(f3, axis=2).astype(np.float32) / 255.0).transpose(2, 0, 1)[None]

    def heat(self, f3: list[np.ndarray]) -> np.ndarray:
        return sigmoid(self._model(self.tensor(f3))[0][0])

    def queue(self):
        """Several frames in flight on the device at once (OpenVINO throughput mode: 0.077 s a frame on the Arc instead of 0.12)."""
        import openvino as ov
        return ov.AsyncInferQueue(self._model)


def sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


def peaks(p: np.ndarray, floor: float = PEAK_MIN, k: int = MAX_PEAKS, apart: int = PEAK_APART_PX) -> list[tuple[int, int, float]]:
    """The k strongest local maxima above `floor`, at least `apart` px from each other: [(x, y, probability)]."""
    ys, xs = np.nonzero(p >= floor)
    order = np.argsort(-p[ys, xs])
    out: list[tuple[int, int, float]] = []
    for i in order:
        x, y = int(xs[i]), int(ys[i])
        if all((x - a) ** 2 + (y - b) ** 2 >= apart ** 2 for a, b, _ in out):
            out.append((x, y, float(p[y, x])))
            if len(out) == k:
                break
    return out


def candidates(path: str, times: list[int], width: int, height: int, model: BallModel,
               progress: Callable[[float], None] | None = None) -> dict[int, list[Cand]]:
    """Ball candidates at each analysed moment in `times` (sorted pts_us), from (previous, this, next) video frames."""
    want = sorted(times)
    out: dict[int, list[Cand]] = {t: [] for t in want}
    win: deque = deque(maxlen=3)
    i = 0
    q = model.queue()
    done = [0]

    def finished(req, t: int) -> None:
        out[t] = [Cand(t, x / width, y / height, 0.0, s) for x, y, s in peaks(sigmoid(req.get_output_tensor(0).data[0]))]
        done[0] += 1
        if progress and done[0] % 500 == 0:
            progress(done[0] / len(want))
    q.set_callback(finished)
    lo = max(0, want[0] - 200_000) if want else 0
    for f in ff.decode_sampled(path, None, width=width, height=height, start_us=lo, end_us=(want[-1] + 200_000) if want else None, seek=lo > 0):
        win.append(f)
        if len(win) < 3:
            continue
        mid = win[1]
        while i < len(want) and want[i] < mid.pts_us - 20_000:
            i += 1
        if i < len(want) and abs(want[i] - mid.pts_us) <= 20_000:
            q.start_async({0: model.tensor([win[0].rgb, win[1].rgb, win[2].rgb])}, want[i])
            i += 1
        if i >= len(want):
            break
    q.wait_all()
    return out


def cache_path(det_path: str, sha16: str) -> Path:
    return Path(det_path).with_name(f"ball_candidates_{sha16}.parquet")


def save(p: Path, cands: dict[int, list[Cand]]) -> None:
    rows = [(t, c.x, c.y, c.score) for t, cs in cands.items() for c in cs]
    pq.write_table(pa.table({"pts_us": [r[0] for r in rows], "x": [r[1] for r in rows], "y": [r[2] for r in rows], "score": [r[3] for r in rows]}), p)


def load(p: Path, times: list[int]) -> dict[int, list[Cand]]:
    t = pq.read_table(p).to_pydict()
    out: dict[int, list[Cand]] = {k: [] for k in times}
    for k, x, y, s in zip(t["pts_us"], t["x"], t["y"], t["score"]):
        out.setdefault(int(k), []).append(Cand(int(k), float(x), float(y), 0.0, float(s)))
    return out
