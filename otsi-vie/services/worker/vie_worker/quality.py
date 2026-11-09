"""Footage-quality assessment before analysis (ADR-034).

Measures what decides how hard the footage is for detection, tracking and shirt numbers, and recommends an analysis profile the user
can override. Nothing here changes the footage or decides anything about a player; every number is a measurement on sampled frames
of THIS video, reported with how it was measured.

  resolution, frame rate, bitrate and bits per pixel  from the probe
  sharpness      variance of the Laplacian of the luma, at 960 px width (higher = sharper)
  blockiness     mean luma step across 8-px block edges relative to inside blocks (> 1.3: visible compression blocks)
  brightness     mean luma 0..1 and contrast (luma standard deviation)
  camera motion  global translation between consecutive frames by phase correlation: speed (pans) and jitter (shake)
  pitch share    share of the picture that is grass (the on-pitch filter depends on it)
  player size    person boxes found by the detector on sampled frames (full frame and 2x2 tiles), on the grass: median and 10th
                 percentile height in source pixels, share under 40 px, people per frame
  cost           measured seconds per detector pass on this footage, for the time estimates of each profile
"""
from __future__ import annotations

import time

import numpy as np

from . import ff
from .detect.pitch import classify, grass_mask

POSITIONS = 8                # sample windows spread over the video
SMALL_PX = 40                # a person shorter than this (source pixels) is "small" for the detector


def _luma(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def _resize_luma(rgb: np.ndarray, width: int = 960) -> np.ndarray:
    step = max(1, rgb.shape[1] // width)
    return _luma(rgb[::step, ::step].astype(np.float32))


def sharpness(rgb: np.ndarray) -> float:
    y = _resize_luma(rgb)
    lap = -4 * y[1:-1, 1:-1] + y[:-2, 1:-1] + y[2:, 1:-1] + y[1:-1, :-2] + y[1:-1, 2:]
    return float(lap.var())


def blockiness(rgb: np.ndarray) -> float:
    y = _luma(rgb.astype(np.float32))
    dx = np.abs(np.diff(y, axis=1))
    edge = dx[:, 7::8].mean() if dx.shape[1] > 8 else 0.0
    inner = np.delete(dx, np.s_[7::8], axis=1).mean() if dx.shape[1] > 8 else 1.0
    return float(edge / max(inner, 1e-3))


def phase_shift(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """Global translation (pixels of the 960-px luma) of b relative to a."""
    ya, yb = _resize_luma(a, 480), _resize_luma(b, 480)
    h, w = min(ya.shape[0], yb.shape[0]), min(ya.shape[1], yb.shape[1])
    ya, yb = ya[:h, :w], yb[:h, :w]
    win = np.outer(np.hanning(h), np.hanning(w))
    fa, fb = np.fft.fft2((ya - ya.mean()) * win), np.fft.fft2((yb - yb.mean()) * win)
    r = fb * np.conj(fa)
    c = np.abs(np.fft.ifft2(r / np.maximum(np.abs(r), 1e-9)))
    py, px = np.unravel_index(int(np.argmax(c)), c.shape)
    if py > h // 2:
        py -= h
    if px > w // 2:
        px -= w
    scale = a.shape[1] / w
    return float(px * scale), float(py * scale)


def assess(path: str, *, width: int, height: int, duration_us: int, fps: float | None, byte_size: int | None, detector=None) -> dict:
    t_start = time.monotonic()
    windows = [int(duration_us * (i + 0.5) / POSITIONS) for i in range(POSITIONS)]
    frames: list[np.ndarray] = []
    motion, jitter = [], []
    for start in windows:
        burst = []
        for f in ff.decode_sampled(path, None, start_us=start, end_us=start + 200_000, seek=True, width=width, height=height):
            burst.append((f.pts_us, f.rgb))
            if len(burst) == 3:
                break
        if not burst:
            continue
        frames.append(burst[0][1])
        if len(burst) >= 3:
            s1, s2 = phase_shift(burst[0][1], burst[1][1]), phase_shift(burst[1][1], burst[2][1])
            dt = max(1e-3, (burst[1][0] - burst[0][0]) / 1e6)
            motion.append(np.hypot(*s1) / width / dt)                       # frame widths per second
            jitter.append(np.hypot(s2[0] - s1[0], s2[1] - s1[1]) / width)   # change of motion between frames, frame widths
    if not frames:
        raise ValueError("no frame could be decoded for the assessment")

    sharp = [sharpness(f) for f in frames]
    block = [blockiness(f) for f in frames]
    lum = [float(_luma(f[::4, ::4].astype(np.float32)).mean() / 255) for f in frames]
    contrast = [float(_luma(f[::4, ::4].astype(np.float32)).std() / 255) for f in frames]
    grass = [float(grass_mask(f).mean()) for f in frames]

    people: dict = {"measured": False}
    cost: dict = {}
    if detector is not None:
        heights, counts, off_pitch = [], [], 0
        t0 = time.monotonic()
        found = detector.detect(frames)
        per_frame = (time.monotonic() - t0) / len(frames)
        for f, ds in zip(frames, found):
            on = classify(ds, grass_mask(f))
            persons = [d for d, ok in zip(ds, on) if ok and d.label == "PERSON" and d.score >= 0.3]
            off_pitch += sum(1 for d, ok in zip(ds, on) if not ok and d.label == "PERSON" and d.score >= 0.3)
            counts.append(len(persons))
            heights += [d.h * height for d in persons]
        h = np.array(heights) if heights else np.array([0.0])
        people = {"measured": True, "people_per_frame": float(np.mean(counts)), "median_height_px": float(np.median(h)),
                  "p10_height_px": float(np.percentile(h, 10)), "share_under_40px": float((h < SMALL_PX).mean()) if heights else None,
                  "off_pitch_per_frame": off_pitch / len(frames)}
        passes = detector.passes_per_frame() if hasattr(detector, "passes_per_frame") else 1
        cost = {"seconds_per_frame_measured": per_frame, "passes_per_frame_measured": passes, "seconds_per_pass": per_frame / passes,
                "runtime": getattr(detector, "runtime", "?")}

    bitrate = (byte_size * 8 / (duration_us / 1e6)) if byte_size and duration_us else None
    bpp = bitrate / (width * height * fps) if bitrate and fps else None
    m = {
        "resolution": {"width": width, "height": height}, "fps": fps, "bitrate_bps": bitrate, "bits_per_pixel": bpp,
        "sharpness": float(np.median(sharp)), "blockiness": float(np.median(block)), "brightness": float(np.median(lum)),
        "contrast": float(np.median(contrast)), "camera_speed_widths_per_s": float(np.median(motion)) if motion else None,
        "camera_jitter_widths": float(np.median(jitter)) if jitter else None, "pitch_share": float(np.median(grass)),
        "people": people, "cost": cost, "frames_examined": len(frames), "assessment_seconds": time.monotonic() - t_start,
    }
    m["issues"] = issues(m)
    m["recommended_profile"] = recommend(m)
    return m


def issues(m: dict) -> list[dict]:
    """Plain findings with the measured value; thresholds are stated with each (heuristics, ADR-034)."""
    out = []
    def add(code, text):                       # noqa: E306
        out.append({"code": code, "text": text})
    h = m["resolution"]["height"]
    if h < 720:
        add("LOW_RESOLUTION", f"{h} px high (below 720): distant players are only a few pixels tall")
    if m["bits_per_pixel"] is not None and m["bits_per_pixel"] < 0.04:
        add("LOW_BITRATE", f"{m['bits_per_pixel']:.3f} bits per pixel (below 0.04): strong compression, shirts and numbers smear")
    if m["blockiness"] > 1.3:
        add("COMPRESSION_BLOCKS", f"block edges {m['blockiness']:.2f}× stronger than block insides (above 1.3)")
    if m["sharpness"] < 60:
        add("BLURRY", f"sharpness {m['sharpness']:.0f} (below 60 at 960 px)")
    if m["brightness"] < 0.25:
        add("DARK", f"mean brightness {m['brightness']:.2f} (below 0.25)")
    if m["camera_jitter_widths"] is not None and m["camera_jitter_widths"] > 0.006:
        add("SHAKY", f"camera jitter {m['camera_jitter_widths'] * 100:.1f} % of the width between frames (above 0.6 %)")
    if m["pitch_share"] < 0.25:
        add("LITTLE_GRASS", f"{m['pitch_share'] * 100:.0f} % of the picture is grass: the on-pitch filter may drop or keep the wrong people")
    p = m["people"]
    if p.get("measured"):
        if p["median_height_px"] < 60 or (p["share_under_40px"] or 0) > 0.3:
            add("SMALL_PLAYERS", f"players {p['median_height_px']:.0f} px tall on median, {100 * (p['share_under_40px'] or 0):.0f} % under 40 px")
        if p["median_height_px"] < 100:
            add("NUMBERS_UNREADABLE", "players are rarely 100 px tall or more: shirt numbers will mostly be too small to read")
    if m["fps"] and m["fps"] < 20:
        add("LOW_FRAME_RATE", f"{m['fps']:.0f} frames per second: fast movement jumps between frames")
    return out


# Ultra-sensitive is not recommended until it passes calibration on labelled grassroots footage (ADR-034 study: its extra boxes were
# 35-63 % footballers; High accuracy's 77-92 % on match footage). It stays selectable by the user.
ULTRA_CALIBRATED = False


def recommend(m: dict) -> str:
    codes = {i["code"] for i in m["issues"]}
    small = "SMALL_PLAYERS" in codes or ("LOW_RESOLUTION" in codes and m["people"].get("median_height_px", 999) < 90)
    if small and ULTRA_CALIBRATED:
        return "ULTRA_SENSITIVE"
    if small or codes & {"LOW_RESOLUTION", "LOW_BITRATE", "COMPRESSION_BLOCKS", "BLURRY", "DARK", "SHAKY", "LOW_FRAME_RATE"}:
        return "HIGH_ACCURACY"
    return "STANDARD"
