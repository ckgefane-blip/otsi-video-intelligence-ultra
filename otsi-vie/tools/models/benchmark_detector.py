"""Detector benchmark on real football footage (ADR-024): speed, CPU/memory use and detection counts per configuration, plus annotated
frames for visual review. ACCURACY needs labelled ground truth: with a MOT-style CSV (`frame_pts_us,label,x,y,w,h` normalised) given by
--labels, precision/recall at IoU 0.5 are computed; without labels the report says "accuracy: not measured" — counts are not accuracy.

  python otsi-vie/tools/models/benchmark_detector.py <video> [--models rtdetr_v2_r18vd rtdetr_v2_r50vd] [--tiles 1 2] [--fps 0.5]
         [--start 0] [--frames 12] [--threads N] [--out DIR] [--labels gt.csv]

Results go to release-evidence/model-benchmarks/<timestamp>/ (report.json, report.md, annotated PNGs).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import statistics
import sys
import time
from pathlib import Path

import psutil
from PIL import Image, ImageDraw

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / "services" / "worker"))
from vie_worker.detect.base import Detection, iou, load_detector  # noqa: E402
from vie_worker.detect.pitch import classify, grass_mask  # noqa: E402
from vie_worker.frames import sample_frames  # noqa: E402

COLORS = {"PERSON": (23, 209, 248), "BALL": (241, 168, 36)}


def annotate(rgb, dets: list[Detection], on: list[bool], path: Path, title: str, min_person: float, min_ball: float) -> None:
    im = Image.fromarray(rgb)
    d = ImageDraw.Draw(im)
    w, h = im.size
    for x, ok in zip(dets, on):
        if x.score < (min_person if x.label == "PERSON" else min_ball):
            continue
        box = [x.x * w, x.y * h, (x.x + x.w) * w, (x.y + x.h) * h]
        colour = COLORS[x.label] if ok else (120, 130, 140)                 # grey: off the pitch, kept as evidence, not tracked
        d.rectangle(box, outline=colour, width=2 if ok else 1)
        d.text((box[0], max(0, box[1] - 11)), f"{x.score:.2f}", fill=colour)
    d.rectangle([0, 0, w, 22], fill=(6, 17, 31))
    d.text((6, 5), title, fill=(244, 248, 255))
    im.save(path)


def load_labels(path: str | None) -> dict[int, list[Detection]]:
    if not path:
        return {}
    gt: dict[int, list[Detection]] = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines()[1:]:
        t, label, x, y, w, h = line.split(",")
        gt.setdefault(int(t), []).append(Detection(label, 1.0, float(x), float(y), float(w), float(h)))
    return gt


def match(pred: list[Detection], gt: list[Detection], thr: float = 0.5) -> tuple[int, int, int]:
    used, tp = set(), 0
    for p in sorted(pred, key=lambda d: d.score, reverse=True):
        best, bi = 0.0, None
        for i, g in enumerate(gt):
            if i not in used and g.label == p.label and (o := iou(p, g)) > best:
                best, bi = o, i
        if bi is not None and best >= thr:
            used.add(bi); tp += 1
    return tp, len(pred) - tp, len(gt) - tp


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--models", nargs="+", default=["rtdetr_v2_r18vd"])
    ap.add_argument("--tiles", nargs="+", type=int, default=[1, 2])
    ap.add_argument("--fps", type=float, default=0.5)
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--frames", type=int, default=12)
    ap.add_argument("--threads", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    ap.add_argument("--min-person", type=float, default=0.5)
    ap.add_argument("--min-ball", type=float, default=0.3)
    ap.add_argument("--labels")
    ap.add_argument("--out")
    a = ap.parse_args()
    out = Path(a.out or APP / "release-evidence" / "model-benchmarks" / dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    out.mkdir(parents=True, exist_ok=True)
    frames = []
    for f in sample_frames(a.video, a.fps, start_us=int(a.start * 1e6)):
        if f.pts_us >= a.start * 1e6:
            frames.append(f)
        if len(frames) >= a.frames:
            break
    gt = load_labels(a.labels)
    proc = psutil.Process()
    results = []
    for key in a.models:
        rss0 = proc.memory_info().rss
        t = time.perf_counter()
        det = load_detector(key, threads=a.threads)
        load_s = time.perf_counter() - t
        for tiles in a.tiles:
            det.tiles = tiles
            det.detect([frames[0].rgb])                                     # warm-up, not timed
            lat, persons, balls, peak = [], [], [], proc.memory_info().rss
            cpu0, w0 = proc.cpu_times(), time.perf_counter()
            tp = fp = fn = 0
            for i, f in enumerate(frames):
                t = time.perf_counter()
                dets = det.detect([f.rgb])[0]
                lat.append(time.perf_counter() - t)
                peak = max(peak, proc.memory_info().rss)
                on = classify(dets, grass_mask(f.rgb))
                kept = [d for d, ok in zip(dets, on) if ok and d.score >= (a.min_person if d.label == "PERSON" else a.min_ball)]
                persons.append(sum(d.label == "PERSON" for d in kept))
                balls.append(sum(d.label == "BALL" for d in kept))
                if gt.get(f.pts_us) is not None:
                    x, y, z = match(kept, gt[f.pts_us]); tp, fp, fn = tp + x, fp + y, fn + z
                if i < 4:
                    annotate(f.rgb, dets, on, out / f"{Path(a.video).stem}-{key}-tiles{tiles}-{f.pts_us // 1000}ms.png",
                             f"{key} tiles={tiles} t={f.pts_us / 1e6:.1f}s on-pitch persons={persons[-1]} ball={balls[-1]} ({lat[-1] * 1000:.0f} ms)", a.min_person, a.min_ball)
            cpu1, wall = proc.cpu_times(), time.perf_counter() - w0
            r = {
                "video": Path(a.video).name, "frame_size": f"{frames[0].width}x{frames[0].height}", "model": key, "tiles": tiles, "threads": a.threads,
                "frames": len(frames), "load_seconds": round(load_s, 1),
                "ms_per_frame_mean": round(1000 * statistics.fmean(lat), 1), "ms_per_frame_p95": round(1000 * sorted(lat)[int(0.95 * (len(lat) - 1))], 1),
                "frames_per_second": round(len(lat) / sum(lat), 2),
                "cpu_utilisation_cores": round(((cpu1.user + cpu1.system) - (cpu0.user + cpu0.system)) / wall, 1),
                "peak_rss_mb": round(max(peak, rss0) / 1024 ** 2), "on_pitch_persons_per_frame_mean": round(statistics.fmean(persons), 1),
                "ball_found_in_frames": f"{sum(b > 0 for b in balls)}/{len(balls)}",
                "accuracy": ({"precision": round(tp / (tp + fp), 3) if tp + fp else None, "recall": round(tp / (tp + fn), 3) if tp + fn else None, "iou": 0.5}
                             if gt else "not measured: no labelled ground truth for this footage"),
            }
            # what a full match would take at this speed (90 minutes)
            for fps in (1, 2, 5):
                r[f"full_match_minutes_at_{fps}fps"] = round(90 * 60 * fps * statistics.fmean(lat) / 60, 0)
            results.append(r)
            print(json.dumps(r))
        del det
    machine = {"cpu": platform.processor(), "logical_cores": os.cpu_count(), "ram_gb": round(psutil.virtual_memory().total / 1024 ** 3), "gpu": "none (CPU only)",
               "os": platform.platform(), "python": platform.python_version()}
    (out / "report.json").write_text(json.dumps({"machine": machine, "results": results}, indent=1), encoding="utf-8")
    md = [f"# Detector benchmark — {Path(a.video).name}", "", f"Machine: {machine}", "", f"Sampled {len(frames)} frames from {a.start:.0f}s at {a.fps} fps. "
          f"Thresholds for counting: person {a.min_person}, ball {a.min_ball}.", "",
          "| Model | Tiles | ms/frame (mean / p95) | frames/s | CPU cores used | Peak RAM MB | On-pitch persons/frame | Ball found (on pitch) | 90-min match at 2 fps (min) | Accuracy |",
          "|---|---|---|---|---|---|---|---|---|---|"]
    md += [f"| {r['model']} | {r['tiles']} | {r['ms_per_frame_mean']} / {r['ms_per_frame_p95']} | {r['frames_per_second']} | {r['cpu_utilisation_cores']} | {r['peak_rss_mb']} | "
           f"{r['on_pitch_persons_per_frame_mean']} | {r['ball_found_in_frames']} | {r['full_match_minutes_at_2fps']:.0f} | {r['accuracy'] if isinstance(r['accuracy'], str) else r['accuracy']} |" for r in results]
    (out / "report.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
