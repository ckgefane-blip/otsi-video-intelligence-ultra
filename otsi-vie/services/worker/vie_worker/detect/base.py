"""The detector boundary (ADR-024). Everything downstream (tracking, overlays, reels) sees only `Detection`s from a `Detector`; which model
produced them is a registry entry, so a model is upgraded or replaced by adding a registry entry and, at most, an adapter — never by
changing the application.

A detection is a PERSON or the BALL in one frame. It is not a player, not a team member and not an identity: those come later from
tracking, kit classification and human-confirmed identity decisions (ADR-016). Boxes are normalised to the decoded frame
(x, y = top-left, w, h; all in [0, 1]) as the media contract requires.
"""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

REGISTRY = Path(__file__).resolve().parents[1] / "models" / "registry.json"
LABELS = ("PERSON", "BALL")


@dataclass(frozen=True)
class Detection:
    label: str
    score: float
    x: float
    y: float
    w: float
    h: float
    # multi-scale detection (ADR-034): which scales found this object (bit 0 = full frame, bit k = the k-th tile grid)
    scales: int = 1


class Detector(Protocol):
    key: str
    entry: dict
    weights_sha256: str
    runtime: str                     # "torch-cpu" or "openvino-<device>": recorded with every run

    def detect(self, frames: list[np.ndarray]) -> list[list[Detection]]:
        """RGB uint8 frames (H, W, 3) -> detections per frame."""
        ...


def models_dir() -> Path:
    return Path(os.environ.get("OTSI_VIE_MODELS_DIR", str(Path(__file__).resolve().parents[5] / ".local" / "models")))


def registry() -> dict:
    return json.loads(REGISTRY.read_text(encoding="utf-8"))


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def verified_model_dir(key: str) -> tuple[dict, Path, str]:
    """The registry entry and local directory of a model whose weight files all match their pinned SHA-256; raises otherwise."""
    entries = {m["key"]: m for m in registry()["models"]}
    if key not in entries:
        raise RuntimeError(f"model '{key}' is not in the registry")
    entry, d = entries[key], models_dir() / key
    weights_sha = ""
    for name, expected in entry["files"].items():
        p = d / name
        if not p.exists():
            raise RuntimeError(f"model file {p} is missing: run tools/models/fetch_models.py {key}")
        if expected:
            actual = _sha256(p)
            if actual != expected:
                raise RuntimeError(f"model file {p} does not match its registered SHA-256; refusing to load it")
            weights_sha = actual
    return entry, d, weights_sha


def load_detector(key: str | None = None, *, threads: int | None = None, tiles: int = 1, score_floor: float = 0.2, device: str | None = None,
                  grids: list[int] | None = None, cross_scale: bool = False, async_requests: int | None = None) -> Detector:
    """`device`: "torch-cpu" (PyTorch), or an OpenVINO device "CPU" / "GPU" / "NPU". Default: OTSI_VIE_INFERENCE_DEVICE, else the
    registry's measured choice. If an OpenVINO device cannot be opened the detector falls back to PyTorch on the CPU (logged).
    `async_requests`: U.8 — when set, the OpenVINO detector runs crops through an InferQueue with that many requests in flight
    (0 = the device's default); None (the default) keeps the synchronous call. The PyTorch path ignores it."""
    key = key or registry()["default"]
    entry, d, sha = verified_model_dir(key)
    device = device or os.environ.get("OTSI_VIE_INFERENCE_DEVICE") or registry().get("default_device", "torch-cpu")
    if entry["adapter"] == "hf_rtdetr":
        from .hf_rtdetr import HfRtDetr
        if device in ("CPU", "GPU", "GPU-FP16", "NPU"):
            import logging
            # requested device first, then OpenVINO on the CPU (same results, faster than PyTorch), then PyTorch
            for dev in dict.fromkeys([device, "CPU"]):
                try:
                    from .ov_rtdetr import OvRtDetr
                    det = OvRtDetr(entry, d, sha, device=dev, threads=threads, tiles=tiles, score_floor=score_floor, grids=grids, cross_scale=cross_scale,
                                 async_requests=async_requests)
                    det.runtime = f"openvino-{dev}"
                    return det
                except Exception as e:  # noqa: BLE001 - any device/driver failure: keep working, and say so
                    logging.getLogger("vie_worker.detect").warning("OpenVINO %s unavailable (%s: %s); trying the next runtime", dev, type(e).__name__, e)
        det = HfRtDetr(entry, d, sha, threads=threads, tiles=tiles, score_floor=score_floor, grids=grids, cross_scale=cross_scale)
        det.runtime = "torch-cpu"
        return det
    raise RuntimeError(f"no adapter '{entry['adapter']}' for model {key}")


def nms(dets: list[Detection], iou_threshold: float = 0.55) -> list[Detection]:
    """Class-wise non-maximum suppression (merging tiled detections)."""
    out: list[Detection] = []
    for label in LABELS:
        cand = sorted((d for d in dets if d.label == label), key=lambda d: d.score, reverse=True)
        while cand:
            best = cand.pop(0)
            out.append(best)
            cand = [d for d in cand if iou(best, d) < iou_threshold]
    return out


def iou(a: Detection, b: Detection) -> float:
    ix = max(0.0, min(a.x + a.w, b.x + b.w) - max(a.x, b.x))
    iy = max(0.0, min(a.y + a.h, b.y + b.h) - max(a.y, b.y))
    inter = ix * iy
    union = a.w * a.h + b.w * b.h - inter
    return inter / union if union > 0 else 0.0
