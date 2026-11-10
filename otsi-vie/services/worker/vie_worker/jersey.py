"""Shirt-number evidence per track, from several frames (Block 07, ADR-033). Never an identity.

  candidates  while tracking, each person track keeps its CLEAREST crops: only boxes at least OCR_MIN_PX tall (smaller shirts cannot show a
              legible number), ranked by height x sharpness (variance of the Laplacian), at least MIN_GAP_US apart, at most MAX_FRAMES per
              track, under a global memory budget
  reads       vie_worker.ocr.JerseyReader on every candidate (text detection + recognition; 1-2 digit reads only)
  verdict     RECOGNIZED  one number read in >= 2 frames at least MIN_GAP_US apart, carrying >= 75 % of all read confidence, none other
                          read twice — agreement over time, not one lucky frame
              UNCERTAIN   a number was read, but not that consistently (one frame, or competing numbers) — alternatives are kept
              UNREADABLE  large-enough crops existed but nothing legible was read
              TOO_SMALL   the player was never large enough in the picture for a number to be legible
  side        BACK when a name (3+ letters) was read on the same shirt, otherwise UNKNOWN (front numbers are often absent or small)
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import geometry as geo
from .ocr import NullReader, torso as _ocr_torso

OCR_MIN_PX = 100             # person box height in analysed pixels below which no shirt number is legible (labelled set: none below ~150)
MAX_FRAMES = 6
MIN_GAP_US = 400_000
MAX_CROP_PX = 480
MEMORY_BUDGET_BYTES = 1_200_000_000
MIN_READ_CONF = 0.6


def sharpness(gray: np.ndarray) -> float:
    g = gray.astype(np.float32)
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return float(lap.var()) if lap.size else 0.0


class OcrBudget:
    def __init__(self, limit: int = MEMORY_BUDGET_BYTES):
        self.used, self.limit = 0, limit


@dataclass
class OcrCandidates:
    frames: list = field(default_factory=list)      # (score, pts_us, crop)

    def offer(self, pts_us: int, rgb: np.ndarray, box: tuple[float, float, float, float], budget: OcrBudget) -> None:
        h, w = rgb.shape[:2]
        x, y, bw, bh = box
        if bh * h < OCR_MIN_PX:
            return
        x0, y0 = max(0, int((x - 0.05 * bw) * w)), max(0, int((y - 0.03 * bh) * h))
        x1, y1 = min(w, int((x + 1.05 * bw) * w)), min(h, int((y + 1.03 * bh) * h))
        crop = rgb[y0:y1, x0:x1]
        if crop.shape[0] < 16 or crop.shape[1] < 8:
            return
        score = crop.shape[0] * (1.0 + np.log1p(sharpness(crop.mean(axis=2)[:: max(1, crop.shape[0] // 160), :: max(1, crop.shape[0] // 160)])))
        near = [i for i, f in enumerate(self.frames) if abs(f[1] - pts_us) < MIN_GAP_US]
        if near:
            i = near[0]
            if score <= self.frames[i][0]:
                return
            budget.used -= self.frames[i][2].nbytes
            self.frames.pop(i)
        elif len(self.frames) >= MAX_FRAMES:
            worst = min(range(len(self.frames)), key=lambda i: self.frames[i][0])
            if score <= self.frames[worst][0]:
                return
            budget.used -= self.frames[worst][2].nbytes
            self.frames.pop(worst)
        if crop.shape[0] > MAX_CROP_PX:
            from PIL import Image
            f = MAX_CROP_PX / crop.shape[0]
            crop = np.asarray(Image.fromarray(crop).resize((max(8, int(crop.shape[1] * f)), MAX_CROP_PX), Image.BILINEAR))
        if budget.used + crop.nbytes > budget.limit:
            return
        self.frames.append((score, pts_us, crop.copy()))
        budget.used += crop.nbytes


@dataclass
class JerseyEvidence:
    state: str
    number: str | None
    confidence: float | None
    side: str
    candidate_frames: int
    reads: list
    alternatives: list


def aggregate(frame_reads: list[dict], candidate_frames: int) -> JerseyEvidence:
    """frame_reads: [{pts_us, number, confidence, texts, alternatives}] for one track's candidate frames."""
    if candidate_frames == 0:
        return JerseyEvidence("TOO_SMALL", None, None, "UNKNOWN", 0, [], [])
    good = [r for r in frame_reads if r["number"] and r["confidence"] >= MIN_READ_CONF]
    side = "BACK" if any(any(sum(ch.isalpha() for ch in t) >= 3 for t in r["texts"]) and r["number"] for r in frame_reads) else "UNKNOWN"
    if not good:
        return JerseyEvidence("UNREADABLE", None, None, "UNKNOWN", candidate_frames, frame_reads, [])
    by: dict[str, list[dict]] = {}
    for r in good:
        by.setdefault(r["number"], []).append(r)
    total = sum(r["confidence"] for r in good)
    ranked = sorted(by.items(), key=lambda kv: -sum(r["confidence"] for r in kv[1]))
    best, best_reads = ranked[0]
    share = sum(r["confidence"] for r in best_reads) / total
    times = sorted(r["pts_us"] for r in best_reads)
    spread = len(times) >= 2 and times[-1] - times[0] >= MIN_GAP_US
    rivals = [n for n, rs in ranked[1:] if len(rs) >= 2]
    alts = [{"number": n, "frames": len(rs), "confidence": round(max(r["confidence"] for r in rs), 4)} for n, rs in ranked[1:4]]
    conf = round(float(np.mean([r["confidence"] for r in best_reads])), 4)
    state = "RECOGNIZED" if spread and share >= 0.75 and not rivals else "UNCERTAIN"
    return JerseyEvidence(state, best, conf, side, candidate_frames, frame_reads, alts)


@dataclass
class RectifySpec:
    """Perspective rectification of the torso band before OCR (U.6): `taper` / `shear` describe the quad the band was
    photographed as (see geometry.torso_band_quad); out_w/out_h are the rectified size, or None to keep the band's own
    size. No taper is estimated from a box anywhere — the caller supplies one when it knows the camera tilt, otherwise
    the rectification stays off (rectify=None)."""
    taper: float = 0.0
    shear: float = 0.0
    out_w: int | None = None
    out_h: int | None = None


def rectified_torso(crop: np.ndarray, spec: RectifySpec | None = None) -> np.ndarray:
    """The number region of a person crop: the torso band (ocr.torso, 10–70 % of the height), perspective-rectified to
    spec.out_w x spec.out_h when spec is given. spec=None returns the plain band. A degenerate quad falls back to the
    plain band — rectification must never lose a crop — and a band too small to warp is returned unchanged."""
    band = _ocr_torso(crop)
    if spec is None or band.shape[0] < 2 or band.shape[1] < 2:
        return band
    try:
        quad = geo.torso_band_quad(band.shape[1], band.shape[0], spec.taper, spec.shear)
        return geo.warp_quad(band, quad, spec.out_w or band.shape[1], spec.out_h or band.shape[0])
    except ValueError:
        return band


def read_number(reader, crop: np.ndarray, rectify: RectifySpec | None = None):
    """One crop through the U.6 path: rectify the torso band when `rectify` is given, then read it. reader=None means no
    provider is available: no number, confidence 0, never a guess. A reader without read_torso falls back to the
    unrectified read() — a rectified image must never be cut into a torso band a second time."""
    if reader is None:
        reader = NullReader()
    if rectify is None:
        return reader.read([crop])[0]
    image = rectified_torso(crop, rectify)
    if hasattr(reader, "read_torso"):
        return reader.read_torso([image])[0]
    return reader.read([crop])[0]


def read_tracks(candidates: dict[int, OcrCandidates], reader, rectify: RectifySpec | None = None) -> dict[int, JerseyEvidence]:
    """candidates: track number -> its candidate frames. Returns track number -> evidence (only for tracks offered at all).
    rectify=None (default) is the existing behaviour: raw crops through reader.read. With a RectifySpec, each candidate's
    torso band is rectified first and read through reader.read_torso; reader=None is the NullReader (no number, no crash)."""
    if reader is None:
        reader = NullReader()
    items = [(n, pts, crop) for n, c in candidates.items() for _, pts, crop in sorted(c.frames, key=lambda f: f[1])]
    if rectify is None or not hasattr(reader, "read_torso"):
        reads = reader.read([crop for _, _, crop in items]) if items else []
    else:
        reads = reader.read_torso([rectified_torso(crop, rectify) for _, _, crop in items]) if items else []
    per: dict[int, list[dict]] = {}
    for (n, pts, _), r in zip(items, reads):
        per.setdefault(n, []).append({"pts_us": int(pts), "number": r.number, "confidence": float(r.confidence), "texts": r.texts[:6],
                                      "alternatives": [list(a) for a in r.alternatives]})
    return {n: aggregate(per.get(n, []), len(c.frames)) for n, c in candidates.items()}
