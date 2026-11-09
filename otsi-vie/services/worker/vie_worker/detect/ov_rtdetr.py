"""The same RT-DETR / RT-DETRv2 weights run with Intel OpenVINO (Apache-2.0) on the Intel CPU, the integrated Arc GPU or the NPU.

No new model and no new licence: the verified safetensors weights are converted once to OpenVINO IR (cached next to the weights, keyed by the
weights' SHA-256, so a different file can never reuse a stale conversion). Pre-processing (resize to 640x640, scale to 0-1) and the RT-DETR
post-processing (sigmoid scores, top-300 over queries x classes, centre boxes -> corners) are the same as the transformers path; tiling and
fragment filtering are inherited unchanged. Parity with PyTorch is checked by tools/models/benchmark_devices.py.

Device: "GPU" (Arc iGPU, FP16 inference precision), "NPU" (static batch of 1), "CPU". AUTO is not used: the device is an explicit,
measured choice, with the CPU path as fallback when the GPU cannot be opened.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import openvino as ov

from .hf_rtdetr import HfRtDetr

log = logging.getLogger("vie_worker.detect")
TOP_K = 300


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


class OvRtDetr(HfRtDetr):
    def __init__(self, entry: dict, model_dir, weights_sha256: str, *, device: str, threads: int | None, tiles: int, score_floor: float, grids: list[int] | None = None,
                 cross_scale: bool = False):
        super().__init__(entry, model_dir, weights_sha256, threads=threads, tiles=tiles, score_floor=score_floor, grids=grids, cross_scale=cross_scale)
        self.device = device
        xml = self._convert(Path(model_dir), weights_sha256)
        core = ov.Core()
        model = core.read_model(xml)
        config: dict = {"PERFORMANCE_HINT": "LATENCY"}
        if device in ("GPU", "GPU-FP16"):
            # FP32 by default: measured on RT-DETRv2-R18, FP16 on the Arc iGPU changed detections (9 people -> 2 on one frame)
            config["INFERENCE_PRECISION_HINT"] = "f16" if device == "GPU-FP16" else "f32"
        if device == "NPU":
            model.reshape([1, 3, 640, 640])                           # the NPU compiles static shapes
        if device == "CPU" and threads:
            config["INFERENCE_NUM_THREADS"] = threads
        self.compiled = core.compile_model(model, "GPU" if device == "GPU-FP16" else device, config)
        self.static_batch = device == "NPU"
        self.num_classes = len(self.model.config.id2label)
        self._parity_check()
        del self.model                                                 # the PyTorch copy is no longer needed

    def _parity_check(self) -> None:
        """Refuse the device if it does not compute what PyTorch computes (driver/plugin regressions happen: OpenVINO 2025.0 on this Arc
        iGPU lost detections in batches). Fixed seeded input, batch of 2; top scores and their boxes must agree closely."""
        import torch
        x = np.random.default_rng(20261027).random((2, 3, 640, 640), dtype=np.float32)
        with torch.inference_mode():
            ref = self.model(pixel_values=torch.from_numpy(x))
        r_scores, r_boxes = _sigmoid(ref.logits.numpy()), ref.pred_boxes.numpy()
        logits, boxes = self._infer(x)
        d_scores = _sigmoid(logits)
        top = np.argsort(-r_scores.reshape(2, -1), axis=1)[:, :50]
        for b in range(2):
            ds = np.abs(r_scores.reshape(2, -1)[b, top[b]] - d_scores.reshape(2, -1)[b, top[b]]).max()
            q = top[b] // self.num_classes
            db = np.abs(r_boxes[b, q] - boxes[b, q]).max()
            if ds > 0.02 or db > 0.01:
                raise RuntimeError(f"parity check failed on {self.device}: score diff {ds:.4f}, box diff {db:.4f} (not used)")

    def _convert(self, model_dir: Path, sha: str) -> Path:
        out = model_dir / "openvino" / sha[:16]
        xml = out / "model.xml"
        if xml.exists():
            return xml
        import torch

        class Wrapper(torch.nn.Module):
            def __init__(self, m):
                super().__init__()
                self.m = m

            def forward(self, pixel_values):
                o = self.m(pixel_values=pixel_values)
                return o.logits, o.pred_boxes

        log.info("converting %s to OpenVINO IR (once)", self.key)
        ovm = ov.convert_model(Wrapper(self.model.eval()), example_input=torch.zeros(1, 3, 640, 640), input=[(-1, 3, 640, 640)])
        out.mkdir(parents=True, exist_ok=True)
        ov.save_model(ovm, xml, compress_to_fp16=False)
        return xml

    def _infer(self, pixel_values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        if not self.static_batch:
            r = self.compiled(pixel_values)
            return r[0], r[1]
        logits, boxes = [], []
        for i in range(pixel_values.shape[0]):
            r = self.compiled(pixel_values[i:i + 1])
            logits.append(r[0]); boxes.append(r[1])
        return np.concatenate(logits), np.concatenate(boxes)

    def _run(self, images: list[np.ndarray]) -> list[list[tuple[int, float, list[float]]]]:
        pixel_values = self.processor(images=images, return_tensors="np")["pixel_values"].astype(np.float32)
        logits, boxes = self._infer(pixel_values)
        out = []
        for img, lg, bx in zip(images, logits, boxes):
            h, w = img.shape[:2]
            scores = _sigmoid(lg).reshape(-1)
            top = np.argpartition(-scores, TOP_K)[:TOP_K] if scores.size > TOP_K else np.arange(scores.size)
            top = top[np.argsort(-scores[top])]
            found = []
            for idx in top:
                s = float(scores[idx])
                if s < self.score_floor:
                    break
                q, label = divmod(int(idx), self.num_classes)
                cx, cy, bw, bh = bx[q]
                found.append((label, s, [float((cx - bw / 2) * w), float((cy - bh / 2) * h), float((cx + bw / 2) * w), float((cy + bh / 2) * h)]))
            out.append(found)
        return out
