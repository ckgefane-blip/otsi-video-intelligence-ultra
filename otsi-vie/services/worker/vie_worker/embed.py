"""Appearance embeddings of person crops (ADR-031): DINOv2-small by default (SigLIP-base optional; both Apache-2.0, pinned and hash-verified
in the registry). Measured on the Arc iGPU: DINOv2-small FP16 7 ms/crop, SigLIP-base FP16 23.5 ms/crop; FP16 reproduces FP32 embeddings
(cosine >= 0.9999). Re-identification quality (study): SigLIP slightly better (AUC 0.929 vs 0.903 on wide footage), DINOv2 3x cheaper.

Runs with OpenVINO on the Arc iGPU (FP16, converted once from the verified safetensors and cached next to them, keyed by the weights'
SHA-256), with the same parity rule as the detector: the device must reproduce PyTorch's embeddings (cosine >= 0.999) or it is not used;
fallbacks are OpenVINO on the CPU, then PyTorch. An embedding is evidence for a SUGGESTION only, never an identity.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np

from .detect.base import registry, verified_model_dir

log = logging.getLogger("vie_worker.embed")
DEFAULT_KEY = "dinov2_small"
SIZE = 224


class Embedder:
    def __init__(self, key: str = DEFAULT_KEY, device: str | None = None, async_requests: int | None = None):
        import torch
        from transformers import AutoModel, SiglipVisionModel
        self.entry, d, self.weights_sha256 = verified_model_dir(key)
        self.key = key
        cls = SiglipVisionModel if self.entry["family"] == "SigLIP" else AutoModel
        self.torch_model = cls.from_pretrained(d).eval()
        cfg = __import__("json").loads((Path(d) / "preprocessor_config.json").read_text(encoding="utf-8"))
        self.mean = np.array(cfg.get("image_mean", [0.5, 0.5, 0.5]), np.float32).reshape(1, 3, 1, 1)
        self.std = np.array(cfg.get("image_std", [0.5, 0.5, 0.5]), np.float32).reshape(1, 3, 1, 1)
        self.runtime = "torch-cpu"
        self.compiled = None
        self._infer_queue = None
        self.infer_stats = {"async": False, "submitted": 0, "completed": 0, "num_requests": 0}
        want = device or os.environ.get("OTSI_VIE_INFERENCE_DEVICE") or registry().get("default_device", "CPU")
        for dev in dict.fromkeys([want, "CPU"]):
            if dev not in ("GPU", "CPU"):
                continue
            try:
                self.compiled = self._compile(Path(d), dev)
                self._parity_check(torch)
                self.runtime = f"openvino-{dev}"
                break
            except Exception as e:  # noqa: BLE001 - keep working on the next runtime, and say so
                log.warning("embedding on OpenVINO %s unavailable (%s: %s)", dev, type(e).__name__, e)
                self.compiled = None
        # U.8: several crops in flight at once when asked (same InferQueue as the detector); None keeps the
        # synchronous call, and a queue that cannot be built falls back to it.
        if self.compiled is not None and async_requests is not None:
            from .infer_queue import InferQueue
            self._infer_queue = InferQueue.from_compiled(self.compiled, num_requests=int(async_requests))
            self.infer_stats = dict(self._infer_queue.stats)

    def _compile(self, model_dir: Path, device: str):
        import openvino as ov
        import torch
        out = model_dir / "openvino" / self.weights_sha256[:16]
        xml = out / "model.xml"
        if not xml.exists():
            m = self.torch_model

            class Wrapper(torch.nn.Module):
                def __init__(self):
                    super().__init__()
                    self.m = m

                def forward(self, pixel_values):
                    o = self.m(pixel_values=pixel_values)
                    return o.pooler_output if getattr(o, "pooler_output", None) is not None else o.last_hidden_state[:, 0]
            ovm = ov.convert_model(Wrapper().eval(), example_input=torch.zeros(2, 3, SIZE, SIZE),
                                   input=[ov.PartialShape([-1, 3, SIZE, SIZE])])
            out.mkdir(parents=True, exist_ok=True)
            ov.save_model(ovm, str(xml), compress_to_fp16=False)
        core = ov.Core()
        cfg = {"PERFORMANCE_HINT": "THROUGHPUT"}
        if device == "GPU":
            cfg["INFERENCE_PRECISION_HINT"] = "f16"           # embeddings: FP16 measured equal to FP32 (cosine >= 0.9999)
        return core.compile_model(core.read_model(xml), device, cfg)

    def _parity_check(self, torch) -> None:
        x = np.random.default_rng(31).random((2, 3, SIZE, SIZE), dtype=np.float32)
        with torch.inference_mode():
            o = self.torch_model(pixel_values=torch.from_numpy(x))
            ref = (o.pooler_output if getattr(o, "pooler_output", None) is not None else o.last_hidden_state[:, 0]).numpy()
        got = self.compiled(x)[0]
        cos = (ref * got).sum(1) / (np.linalg.norm(ref, axis=1) * np.linalg.norm(got, axis=1))
        if cos.min() < 0.999:
            raise RuntimeError(f"parity check failed: cosine {cos.min():.4f}")

    def _prep(self, crops: list[np.ndarray]) -> np.ndarray:
        from PIL import Image
        arr = np.stack([np.asarray(Image.fromarray(c).resize((SIZE, SIZE), Image.BICUBIC), np.float32) / 255.0 for c in crops])
        return ((arr.transpose(0, 3, 1, 2) - self.mean) / self.std).astype(np.float32)

    def __call__(self, crops: list[np.ndarray]) -> np.ndarray:
        """RGB crops (any size) -> L2-normalised embeddings (n, d)."""
        out = []
        for i in range(0, len(crops), 32):
            x = self._prep(crops[i:i + 32])
            if self._infer_queue is not None:
                v = np.concatenate(self._infer_queue.run_batch([x[j:j + 1] for j in range(x.shape[0])]))
                self.infer_stats = dict(self._infer_queue.stats)
            elif self.compiled is not None:
                v = self.compiled(x)[0]
            else:
                import torch
                with torch.inference_mode():
                    o = self.torch_model(pixel_values=torch.from_numpy(x))
                    v = (o.pooler_output if getattr(o, "pooler_output", None) is not None else o.last_hidden_state[:, 0]).numpy()
            out.append(v / (np.linalg.norm(v, axis=1, keepdims=True) + 1e-9))
        return np.concatenate(out) if out else np.zeros((0, 768), np.float32)
