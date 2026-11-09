"""RT-DETR / RT-DETRv2 through Hugging Face transformers (Apache-2.0), CPU or GPU, from verified local files only (no downloads).

Tiling: broadcast footage shows distant players only 15-40 px tall; the model sees frames resized to 640x640, where they shrink further.
With tiles=2 the frame is also cut into 2x2 overlapping tiles, each detected at full model resolution, and the results merged by NMS
(4+1 model passes per frame: slower, more recall on small players). Multi-scale (ADR-034): `grids=[2, 3]` adds 2x2 AND 3x3 tiles; a 3x3
tile of a 1080p frame is enlarged to the model input, so a 25-px player is seen at about 40 px (1+4+9 passes). The choice is a run
setting, measured by the benchmark.
"""
from __future__ import annotations

from dataclasses import replace

import numpy as np
import torch
from transformers import RTDetrImageProcessor, RTDetrV2ForObjectDetection

from .base import Detection, iou, nms

OVERLAP = 0.12
EDGE = 3            # px: a tile detection this close to an inner tile edge is a cut-off fragment
LARGE = 0.45        # a tile detection taller than this share of the tile is left to the full-frame pass


class HfRtDetr:
    def __init__(self, entry: dict, model_dir, weights_sha256: str, *, threads: int | None, tiles: int, score_floor: float, grids: list[int] | None = None,
                 cross_scale: bool = False):
        self.key, self.entry, self.weights_sha256 = entry["key"], entry, weights_sha256
        self.cross_scale = cross_scale
        self.grids = sorted({int(g) for g in grids if int(g) > 1}) if grids is not None else ([tiles] if tiles > 1 else [])
        self.tiles, self.score_floor = max(self.grids, default=1), score_floor
        if threads:
            torch.set_num_threads(threads)
        self.processor = RTDetrImageProcessor.from_pretrained(model_dir, local_files_only=True)
        self.model = RTDetrV2ForObjectDetection.from_pretrained(model_dir, local_files_only=True, use_safetensors=True).eval()
        id2label = self.model.config.id2label
        wanted = entry["classes_used"]
        self.class_map = {int(i): wanted[name] for i, name in id2label.items() if name in wanted}
        if set(self.class_map.values()) != set(wanted.values()):
            raise RuntimeError(f"model {self.key} lacks classes {set(wanted) - set(id2label.values())}")

    def _run(self, images: list[np.ndarray]) -> list[list[tuple[int, float, list[float]]]]:
        inputs = self.processor(images=images, return_tensors="pt")
        with torch.inference_mode():
            out = self.model(**inputs)
        sizes = torch.tensor([[im.shape[0], im.shape[1]] for im in images])
        res = self.processor.post_process_object_detection(out, target_sizes=sizes, threshold=self.score_floor)
        return [[(int(l), float(s), [float(v) for v in b]) for s, l, b in zip(r["scores"], r["labels"], r["boxes"])] for r in res]

    def passes_per_frame(self) -> int:
        return 1 + sum(g * g for g in self.grids)

    def _windows(self, h: int, w: int) -> list[tuple[int, int, int, int]]:
        return [win for win, _ in self._scaled_windows(h, w)]

    def _scaled_windows(self, h: int, w: int) -> list[tuple[tuple[int, int, int, int], int]]:
        """windows with their scale index (0 = full frame, k = k-th grid)"""
        out = [((0, 0, w, h), 0)]
        for k, g in enumerate(self.grids, 1):
            tw, th = int(w / g * (1 + OVERLAP)), int(h / g * (1 + OVERLAP))
            xs = np.linspace(0, w - tw, g).astype(int)
            ys = np.linspace(0, h - th, g).astype(int)
            out += [((x, y, tw, th), k) for y in ys for x in xs]
        return out

    def detect(self, frames: list[np.ndarray]) -> list[list[Detection]]:
        results: list[list[Detection]] = []
        for frame in frames:
            h, w = frame.shape[:2]
            scaled = self._scaled_windows(h, w)
            wins = [win for win, _ in scaled]
            crops = [np.ascontiguousarray(frame[y:y + ch, x:x + cw]) for (x, y, cw, ch) in wins]
            dets: list[Detection] = []
            for k, ((x0, y0, cw, ch), found) in enumerate(zip(wins, self._run(crops))):
                for label, score, (bx1, by1, bx2, by2) in found:
                    if label not in self.class_map:
                        continue
                    if k > 0:
                        # a tile only adds SMALL, WHOLE objects: a box touching an inner tile edge is a fragment of something the
                        # tile cut in two, and large objects are found by the full-frame pass (k == 0)
                        cut = (bx1 <= EDGE and x0 > 0) or (by1 <= EDGE and y0 > 0) or (bx2 >= cw - EDGE and x0 + cw < w) or (by2 >= ch - EDGE and y0 + ch < h)
                        if cut or (by2 - by1) > LARGE * ch:
                            continue
                    ax1, ay1 = max(0.0, (bx1 + x0) / w), max(0.0, (by1 + y0) / h)
                    ax2, ay2 = min(1.0, (bx2 + x0) / w), min(1.0, (by2 + y0) / h)
                    if ax2 - ax1 <= 0 or ay2 - ay1 <= 0:
                        continue
                    dets.append(Detection(self.class_map[label], round(score, 4), ax1, ay1, ax2 - ax1, ay2 - ay1, 1 << scaled[k][1]))
            if len(wins) == 1:
                results.append(dets)
                continue
            kept = []
            for d in nms(dets):                # every scale that found (an overlapping box of) the same object
                sc = d.scales
                for r in dets:
                    if r.label == d.label and iou(r, d) >= 0.3:
                        sc |= r.scales
                kept.append(replace(d, scales=sc))
            kept = suppress_fragments(kept)
            if self.cross_scale:
                kept = cross_scale_filter(kept, finest=1 << len(self.grids))
            results.append(kept)
        return results


CROSS_SCALE_SCORE = 0.5


def cross_scale_filter(dets: list[Detection], finest: int) -> list[Detection]:
    """Cross-scale validation (ADR-034): a weak detection (< 0.5) seen ONLY by the finest tiles is dropped. The finest tiles enlarge
    board lettering, seat rows and pitch-side clutter into person-like shapes; a real small player is usually also seen, at least
    weakly, by the next coarser scale. Confident detections and anything seen at two scales are kept; the ball is not filtered."""
    return [d for d in dets if d.label != "PERSON" or d.score >= CROSS_SCALE_SCORE or d.scales != finest]


def suppress_fragments(dets: list[Detection]) -> list[Detection]:
    """Multi-scale passes often add a second box on PART of a player (torso, legs) that NMS keeps because the IoU with the whole-body
    box is small. A person box lying >= 85 % inside a higher-scoring person box whose area it has between 25 % and 75 % of is such a
    fragment and is dropped. A distant player overlapping a near player's box is far smaller (< 25 %) and is kept."""
    people = sorted((d for d in dets if d.label == "PERSON"), key=lambda d: d.score, reverse=True)
    kept: list[Detection] = []
    for d in people:
        a = d.w * d.h
        frag = False
        for k in kept:
            ix = max(0.0, min(d.x + d.w, k.x + k.w) - max(d.x, k.x))
            iy = max(0.0, min(d.y + d.h, k.y + k.h) - max(d.y, k.y))
            if a > 0 and ix * iy / a >= 0.85 and 0.25 <= a / max(k.w * k.h, 1e-9) <= 0.75:
                frag = True
                break
        if not frag:
            kept.append(d)
    return kept + [d for d in dets if d.label != "PERSON"]
