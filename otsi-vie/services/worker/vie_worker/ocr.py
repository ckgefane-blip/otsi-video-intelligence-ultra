"""Shirt-number reading on person crops (Block 07, ADR-033). Plain-weight PaddleOCR models (Apache-2.0) run by OpenVINO — no third-party
model code is executed:

  ppocr_v4_det     text DETECTION (DB): finds where text is printed on the torso (a recogniser needs a tight text crop)
  ppocr_v4_en_rec  text RECOGNITION (CTC, 48 x W): reads each found region

Per crop: torso region -> upscaled so small shirts become legible to the detector -> text regions -> each region read -> reads that are 1-2
digits are number hypotheses (with confidence = mean character probability, and the region's detection score). The best hypothesis and
the alternatives are returned. A read is EVIDENCE, never an identity; "no number" is the honest answer when nothing legible is printed.
"""
from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .detect.base import models_dir, registry

DIGITS = re.compile(r"^\d{1,2}$")
DET_THRESHOLD = 0.3          # DB probability map binarisation (PaddleOCR default)
BOX_THRESHOLD = 0.5          # minimum mean probability inside a text region
DET_SIDE = 256               # detector canvas (torso scaled to fit, padded)


@dataclass
class Read:
    number: str | None                 # best 1-2 digit hypothesis, or None
    confidence: float                  # its character probability (0..1)
    alternatives: list = field(default_factory=list)   # other (number, confidence) hypotheses on the same crop
    texts: list = field(default_factory=list)          # every text the recogniser read on the crop (evidence)
    regions: int = 0                   # text regions found on the torso


def torso(crop: np.ndarray) -> np.ndarray:
    """Where a shirt number is printed (front or back): 10-70 % of the person's height, the full width."""
    h = crop.shape[0]
    return crop[int(0.10 * h):max(int(0.10 * h) + 2, int(0.70 * h))]


def _model_dir(key: str) -> Path:
    entry = next(m for m in registry()["models"] if m["key"] == key)
    d = models_dir() / key
    for name, spec in entry.get("url_files", {}).items():
        p = d / name
        if not p.exists() or hashlib.sha256(p.read_bytes()).hexdigest() != spec["sha256"]:
            raise RuntimeError(f"{key}: {name} missing or not matching its registered SHA-256 (tools/models/fetch_url_models.py)")
    return d


def _compile(core, model, device: str | None):
    want = device or os.environ.get("OTSI_VIE_INFERENCE_DEVICE") or registry().get("default_device", "CPU")
    for dev in dict.fromkeys([want, "CPU"]):
        if dev not in ("GPU", "CPU"):
            continue
        try:
            return core.compile_model(model, dev, {"INFERENCE_PRECISION_HINT": "f32"} if dev == "GPU" else {}), f"openvino-{dev}"
        except Exception:  # noqa: BLE001 - next device
            continue
    raise RuntimeError("no OpenVINO device could compile the OCR model")


class JerseyReader:
    def __init__(self, device: str | None = None):
        import openvino as ov
        core = ov.Core()
        rd, dd = _model_dir("ppocr_v4_en_rec"), _model_dir("ppocr_v4_det")
        self.rec, self.runtime = _compile(core, core.read_model(str(rd / "inference.pdmodel")), device)
        self.det, _ = _compile(core, core.read_model(str(dd / "inference.pdmodel")), device)
        self.alphabet = ["<blank>"] + (rd / "en_dict.txt").read_text(encoding="utf-8").splitlines() + [" "]
        self.model_version = "ppocr_v4_det+ppocr_v4_en_rec"

    # ------------------------------------------------------------------ detection (DB)
    def _regions(self, img: np.ndarray) -> list[tuple[int, int, int, int, float]]:
        """Text regions on the torso. The torso is scaled into a fixed DET_SIDE x DET_SIDE canvas (one compiled shape on the GPU: 12 ms per
        crop instead of a recompilation per crop size; same accuracy as variable sizes on the labelled set, ADR-033)."""
        from PIL import Image
        from scipy import ndimage
        h, w = img.shape[:2]
        s = DET_SIDE / max(h, w)
        nh, nw = max(1, int(round(h * s))), max(1, int(round(w * s)))
        a = np.asarray(Image.fromarray(img).resize((nw, nh), Image.BICUBIC), np.float32)[..., ::-1] / 255.0   # BGR, as PaddleOCR trains
        a = (a - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
        canvas = np.zeros((DET_SIDE, DET_SIDE, 3), np.float32)
        canvas[:nh, :nw] = a
        prob = self.det(canvas.transpose(2, 0, 1)[None])[0][0, 0][:nh, :nw]
        lab, _ = ndimage.label(prob > DET_THRESHOLD)
        out = []
        for i, sl in enumerate(ndimage.find_objects(lab), 1):
            if sl is None:
                continue
            ys, xs = sl
            score = float(prob[sl][lab[sl] == i].mean())
            bh, bw = ys.stop - ys.start, xs.stop - xs.start
            if score < BOX_THRESHOLD or bh < 4 or bw < 3:
                continue
            # DB shrinks text regions during training: grow the box back (unclip ratio ~1.5 of the short side)
            pad = int(round(0.5 * min(bh, bw) * 1.5 / 2 + 2))
            y0, y1 = max(0, ys.start - pad), min(nh, ys.stop + pad)
            x0, x1 = max(0, xs.start - pad), min(nw, xs.stop + pad)
            out.append((int(x0 / nw * w), int(y0 / nh * h), int(np.ceil(x1 / nw * w)), int(np.ceil(y1 / nh * h)), score))
        return out

    # ------------------------------------------------------------------ recognition (CTC)
    def _read_lines(self, lines: list[np.ndarray]) -> list[tuple[str, float]]:
        from PIL import Image
        if not lines:
            return []
        x = np.zeros((len(lines), 3, 48, 320), np.float32)
        for k, im in enumerate(lines):
            w = int(min(320, max(8, round(im.shape[1] * 48 / max(1, im.shape[0])))))
            a = np.asarray(Image.fromarray(im).resize((w, 48), Image.BICUBIC), np.float32)[..., ::-1] / 255.0
            x[k, :, :, :w] = ((a - 0.5) / 0.5).transpose(2, 0, 1)
        out = []
        for p in self.rec(x)[0]:
            best = p.argmax(1)
            text, confs, prev = [], [], -1
            for t, c in enumerate(best):
                if c != prev and c != 0:
                    text.append(self.alphabet[c])
                    confs.append(float(p[t, c]))
                prev = c
            out.append(("".join(text), float(np.mean(confs)) if confs else 0.0))
        return out

    def read(self, crops: list[np.ndarray]) -> list[Read]:
        reads = []
        for crop in crops:
            t = torso(crop)
            regions = self._regions(t) if t.shape[0] >= 8 and t.shape[1] >= 8 else []
            lines = [t[y0:y1, x0:x1] for x0, y0, x1, y1, _ in regions if y1 - y0 >= 3 and x1 - x0 >= 3]
            texts = self._read_lines(lines)
            hyps = []
            for (txt, conf), reg in zip(texts, regions):
                s = txt.replace(" ", "")
                if DIGITS.match(s):
                    hyps.append((s.lstrip("0") or "0", round(conf * reg[4], 4)))
            hyps.sort(key=lambda h: -h[1])
            best = hyps[0] if hyps else (None, 0.0)
            reads.append(Read(best[0], best[1], hyps[1:4], [x for x, _ in texts], len(regions)))
        return reads
