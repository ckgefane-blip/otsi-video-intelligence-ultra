"""E5 (ADR-068): the reel's colour look and each clip's keyframed zoom and telestration, as the editor shows them.

The same formulas as packages/contracts/src/look.ts (lookChannels, applyLook, zoomAt, zoomWindow, drawingAt); the tests of both check the
same values. The look is baked into a 33-point 3D LUT (.cube) that FFmpeg's lut3d applies to the decoded clip frames (before the spotlight,
which then lights the graded picture); zoom and drawings are drawn per output frame."""
from __future__ import annotations

from pathlib import Path

import numpy as np

PRESETS: dict[str, dict] = {
    "NONE": {"exposure": 0, "contrast": 1, "saturation": 1, "temperature": 0, "exponent": (1, 1, 1)},
    "BROADCAST": {"exposure": 0.05, "contrast": 1.08, "saturation": 1.12, "temperature": 0.1, "exponent": (1, 1, 1)},
    "WARM": {"exposure": 0.05, "contrast": 1.04, "saturation": 1.08, "temperature": 0.6, "exponent": (0.97, 1, 1.04)},
    "COOL": {"exposure": -0.05, "contrast": 1.06, "saturation": 0.95, "temperature": -0.6, "exponent": (1.04, 1, 0.97)},
    "PUNCHY": {"exposure": 0, "contrast": 1.2, "saturation": 1.3, "temperature": 0, "exponent": (1, 1, 1)},
    "FILM": {"exposure": 0, "contrast": 0.92, "saturation": 0.88, "temperature": 0.25, "exponent": (1.06, 1.04, 1.08)},
    "MONO": {"exposure": 0, "contrast": 1.1, "saturation": 0, "temperature": 0, "exponent": (1, 1, 1)},
}
LUT_SIZE = 33


def channels(look: dict | None) -> dict:
    """lookChannels: per channel slope, intercept and exponent, and the saturation"""
    lk = {"exposure": 0, "contrast": 1, "saturation": 1, "temperature": 0, "preset": "NONE", "strength": 1, "match": None, **(look or {})}
    p, k = PRESETS.get(lk["preset"], PRESETS["NONE"]), float(lk["strength"])

    def mix(base, preset, neutral):
        return float(base) + (preset - neutral) * k
    exposure, contrast = mix(lk["exposure"], p["exposure"], 0), mix(lk["contrast"], p["contrast"], 1)
    temp = max(-1.0, min(1.0, mix(lk["temperature"], p["temperature"], 0)))
    gain = 2 ** exposure
    wb = (1 + 0.12 * temp, 1.0, 1 - 0.12 * temp)
    m = lk["match"]
    pairs = [m["r"], m["g"], m["b"]] if m else [(1, 0)] * 3
    slope = [pairs[c][0] * gain * wb[c] * contrast for c in range(3)]
    intercept = [pairs[c][1] * gain * wb[c] * contrast + 0.5 * (1 - contrast) for c in range(3)]
    exponent = [1 + (p["exponent"][c] - 1) * k for c in range(3)]
    return {"slope": slope, "intercept": intercept, "exponent": exponent, "saturation": max(0.0, mix(lk["saturation"], p["saturation"], 1))}


def is_neutral(look: dict | None) -> bool:
    c = channels(look)
    return (all(abs(s - 1) < 1e-6 for s in c["slope"]) and all(abs(s) < 1e-6 for s in c["intercept"])
            and all(abs(s - 1) < 1e-6 for s in c["exponent"]) and abs(c["saturation"] - 1) < 1e-6)


def apply(c: dict, rgb: np.ndarray) -> np.ndarray:
    """applyLook on an (..., 3) array of colours in 0..1"""
    v = np.empty_like(rgb, dtype=np.float64)
    for i in range(3):
        v[..., i] = np.clip(np.clip(c["slope"][i] * rgb[..., i] + c["intercept"][i], 0, 1) ** c["exponent"][i], 0, 1)
    s, R, G, B = c["saturation"], 0.2126, 0.7152, 0.0722
    m = np.array([[R + (1 - R) * s, G - G * s, B - B * s], [R - R * s, G + (1 - G) * s, B - B * s], [R - R * s, G - G * s, B + (1 - B) * s]])
    return np.clip(v @ m.T, 0, 1)


def write_cube(look: dict | None, path: Path) -> Path:
    """the look as a .cube 3D LUT (red changes fastest, as the format says)"""
    g = np.linspace(0, 1, LUT_SIZE)
    b, gg, r = np.meshgrid(g, g, g, indexing="ij")
    out = apply(channels(look), np.stack([r, gg, b], axis=-1).reshape(-1, 3))
    lines = ["TITLE \"OTSI VIE look\"", f"LUT_3D_SIZE {LUT_SIZE}", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"]
    lines += [f"{x:.6f} {y:.6f} {z:.6f}" for x, y, z in out]
    path.write_text("\n".join(lines) + "\n", encoding="ascii")
    return path


def lut_filter(path: Path) -> str:
    """the lut3d filter for a .cube file, its path escaped for an FFmpeg filter graph (Windows drive colon and backslashes)"""
    p = str(path).replace("\\", "/").replace(":", "\\\\:")
    return f"lut3d=file={p}:interp=trilinear"


# ---------------------------------------------------------------- zoom and drawings

def _smooth(f: float) -> float:
    return f * f * (3 - 2 * f)


def zoom_at(keys: list[dict], t_ms: float) -> float:
    if not keys:
        return 1.0
    k = sorted(keys, key=lambda x: x["at_ms"])
    if t_ms <= k[0]["at_ms"]:
        return float(k[0]["zoom"])
    for a, b in zip(k, k[1:]):
        if t_ms < b["at_ms"]:
            f = (t_ms - a["at_ms"]) / max(1, b["at_ms"] - a["at_ms"])
            e = a.get("ease", "EASE")
            return float(a["zoom"] + (b["zoom"] - a["zoom"]) * (0 if e == "HOLD" else _smooth(f) if e == "EASE" else f))
    return float(k[-1]["zoom"])


def zoom_window(zoom: float, cx: float, cy: float, w: float, h: float) -> tuple[float, float, float, float]:
    zw, zh = w / zoom, h / zoom
    return min(max(0.0, cx - zw / 2), w - zw), min(max(0.0, cy - zh / 2), h - zh), zw, zh


def drawing_at(d: dict, t_ms: float) -> tuple[float, float] | None:
    end = d["at_ms"] + d.get("draw_ms", 600) + d.get("hold_ms", 2000)
    if t_ms < d["at_ms"] or t_ms > end:
        return None
    return min(1.0, (t_ms - d["at_ms"]) / d.get("draw_ms", 600)), min(1.0, max(0.0, (end - t_ms) / 250))


RGB = {"YELLOW": (255, 212, 0), "WHITE": (255, 255, 255), "CYAN": (25, 211, 255), "RED": (255, 74, 74)}


def draw(rgb: np.ndarray, drawings: list[dict], t_ms: float, to_px) -> np.ndarray:
    """the clip's drawings shown at t_ms, drawn on as the editor draws them: a line or arrow grows from its start, a circle's arc goes
    round; the last 250 ms fade out. to_px maps a source-normalised point to this frame's pixels."""
    live = [(d, s) for d in drawings if (s := drawing_at(d, t_ms))]
    if not live:
        return rgb
    from PIL import Image, ImageDraw
    h = rgb.shape[0]
    base = Image.fromarray(np.ascontiguousarray(rgb))
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    g = ImageDraw.Draw(layer)
    width = max(3, int(round(h * 0.007)))
    for d, (p, alpha) in live:
        col = (*RGB.get(d.get("color", "YELLOW"), RGB["YELLOW"]), int(255 * alpha))
        (x1, y1), (x2, y2) = to_px(d["x1"], d["y1"]), to_px(d["x2"], d["y2"])
        if d["kind"] == "CIRCLE":
            r = max(2.0, float(np.hypot(x2 - x1, y2 - y1)))
            g.arc([x1 - r, y1 - r, x1 + r, y1 + r], -90, -90 + 360 * p, fill=col, width=width)
            continue
        tx, ty = x1 + (x2 - x1) * p, y1 + (y2 - y1) * p
        g.line([(x1, y1), (tx, ty)], fill=col, width=width)
        if d["kind"] == "ARROW" and p > 0.05:
            ang, L = float(np.arctan2(ty - y1, tx - x1)), width * 4.5
            g.polygon([(tx, ty), (tx - L * np.cos(ang - 0.45), ty - L * np.sin(ang - 0.45)), (tx - L * np.cos(ang + 0.45), ty - L * np.sin(ang + 0.45))], fill=col)
    return np.asarray(Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB"))


def zoom(rgb: np.ndarray, z: float, cx: float, cy: float) -> np.ndarray:
    """the part of the frame at zoom z around (cx, cy), scaled back to the frame's size"""
    if z <= 1.0001:
        return rgb
    from PIL import Image
    h, w = rgb.shape[:2]
    x0, y0, zw, zh = zoom_window(z, cx, cy, w, h)
    return np.asarray(Image.fromarray(np.ascontiguousarray(rgb)).resize((w, h), Image.BILINEAR, box=(x0, y0, x0 + zw, y0 + zh)))
