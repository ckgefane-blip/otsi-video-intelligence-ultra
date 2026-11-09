"""CPU vs Intel GPU (vs NPU) for the SAME detector, weights, frames and settings (ADR-026).

For each runtime (PyTorch CPU = reference, OpenVINO CPU, OpenVINO GPU FP32, OpenVINO GPU FP16, OpenVINO NPU) and tiling setting:
mean/p95 ms per frame, frames per second, estimated 90-minute match time at the analysis rate, process memory, GPU memory reported by
the driver, agreement with the reference (people and ball matched at IoU >= 0.5 and >= 0.9, missing/extra counts), and stability over a
long continuous run (errors, latency drift). Quality here means "same answer as the reference": absolute accuracy needs labelled footage.

  python otsi-vie/tools/models/benchmark_devices.py <video> [<video> ...] --start 80 --frames 60 --fps 2 [--runtimes torch-cpu CPU GPU GPU-FP16 NPU]
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

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / "services" / "worker"))
from vie_worker.detect.base import iou, load_detector  # noqa: E402
from vie_worker.detect.pitch import classify, grass_mask  # noqa: E402
from vie_worker.frames import sample_frames  # noqa: E402

MIN = {"PERSON": 0.5, "BALL": 0.3}


def kept(dets, rgb):
    on = classify(dets, grass_mask(rgb))
    return [d for d, ok in zip(dets, on) if ok and d.score >= MIN[d.label]]


def compare(ref, got, thr):
    used, match = set(), 0
    for r in ref:
        best = max(((iou(r, g), i) for i, g in enumerate(got) if i not in used and g.label == r.label), default=(0, None))
        if best[1] is not None and best[0] >= thr:
            used.add(best[1]); match += 1
    return match, len(ref) - match, len(got) - match


def gpu_memory(det) -> int | None:
    try:
        stats = det.compiled.get_property("GPU_MEMORY_STATISTICS")
        return int(sum(v for k, v in stats.items() if "usm_device" in k or "usm_host" in k or "cl_mem" in k))
    except Exception:  # noqa: BLE001 - not a GPU, or the driver does not report it
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    ap.add_argument("--start", type=float, default=0)
    ap.add_argument("--frames", type=int, default=60)
    ap.add_argument("--fps", type=float, default=2)
    ap.add_argument("--runtimes", nargs="+", default=["torch-cpu", "CPU", "GPU", "GPU-FP16", "NPU"])
    ap.add_argument("--tiles", nargs="+", type=int, default=[1, 2])
    ap.add_argument("--threads", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    ap.add_argument("--out")
    a = ap.parse_args()
    out = Path(a.out or APP / "release-evidence" / "model-benchmarks" / f"{dt.datetime.now(dt.timezone.utc):%Y%m%dT%H%M%SZ}-devices")
    out.mkdir(parents=True, exist_ok=True)
    frames = []
    for v in a.videos:
        n = 0
        for f in sample_frames(v, a.fps, start_us=int(a.start * 1e6)):
            if f.pts_us >= a.start * 1e6:
                frames.append((Path(v).name, f.rgb)); n += 1
            if n >= a.frames:
                break
    import openvino as ov
    machine = {"cpu": "Intel Core Ultra 7 155H", "logical_cores": os.cpu_count(), "ram_gb": round(psutil.virtual_memory().total / 1024 ** 3, 1),
               "openvino_devices": {d: ov.Core().get_property(d, "FULL_DEVICE_NAME") for d in ov.Core().available_devices}, "openvino": ov.__version__,
               "os": platform.platform()}
    proc = psutil.Process()
    results, reference = [], {}
    for tiles in a.tiles:
        for rt in a.runtimes:
            row = {"runtime": rt, "tiles": tiles, "frames": len(frames), "threads": a.threads}
            try:
                t0 = time.perf_counter()
                det = load_detector("rtdetr_v2_r18vd", device=rt, tiles=tiles, threads=a.threads)
                row["load_seconds"] = round(time.perf_counter() - t0, 1)
                row["actual_runtime"] = det.runtime
                if rt != "torch-cpu" and det.runtime == "torch-cpu":
                    row["status"] = "UNAVAILABLE (fell back to the CPU)"; results.append(row); print(json.dumps(row)); continue
                det.detect([frames[0][1]])
                lat, errors, outs, peak = [], 0, [], proc.memory_info().rss
                for name, rgb in frames:
                    t = time.perf_counter()
                    try:
                        d = det.detect([rgb])[0]
                    except Exception:  # noqa: BLE001 - stability: count, keep going
                        errors += 1; d = []
                    lat.append(time.perf_counter() - t)
                    outs.append(kept(d, rgb))
                    peak = max(peak, proc.memory_info().rss)
                half = len(lat) // 2
                row.update({"status": "OK", "errors": errors, "ms_per_frame_mean": round(1000 * statistics.fmean(lat), 1),
                            "ms_per_frame_p95": round(1000 * sorted(lat)[int(0.95 * (len(lat) - 1))], 1),
                            "drift_second_half_vs_first": round(statistics.fmean(lat[half:]) / statistics.fmean(lat[:half]), 3),
                            "process_peak_rss_mb": round(peak / 1024 ** 2), "gpu_memory_mb": (round(m / 1024 ** 2) if (m := gpu_memory(det)) else None),
                            "people_per_frame": round(statistics.fmean(sum(x.label == "PERSON" for x in o) for o in outs), 2),
                            "ball_frames": sum(any(x.label == "BALL" for x in o) for o in outs)})
                for fps in (1, 2, 4):
                    row[f"match_90min_minutes_at_{fps}fps"] = round(90 * 60 * fps * statistics.fmean(lat) / 60)
                if rt == "torch-cpu":
                    reference[tiles] = outs
                elif tiles in reference:
                    for thr in (0.5, 0.9):
                        m = [compare(r, g, thr) for r, g in zip(reference[tiles], outs)]
                        tot = sum(x[0] + x[1] for x in m)
                        row[f"agreement_iou{thr}"] = {"matched": round(sum(x[0] for x in m) / tot, 4) if tot else None,
                                                       "missing": sum(x[1] for x in m), "extra": sum(x[2] for x in m)}
                    bm = [compare([x for x in r if x.label == "BALL"], [x for x in g if x.label == "BALL"], 0.5) for r, g in zip(reference[tiles], outs)]
                    row["ball_agreement"] = {"matched": sum(x[0] for x in bm), "missing": sum(x[1] for x in bm), "extra": sum(x[2] for x in bm)}
                del det
            except Exception as e:  # noqa: BLE001
                row["status"] = f"FAILED: {type(e).__name__}: {str(e)[:200]}"
            results.append(row)
            print(json.dumps(row))
    (out / "report.json").write_text(json.dumps({"machine": machine, "videos": [Path(v).name for v in a.videos], "start_s": a.start, "fps": a.fps,
                                                 "results": results}, indent=1), encoding="utf-8")
    md = [f"# Detector runtime benchmark (RT-DETRv2-R18) — {', '.join(Path(v).name for v in a.videos)}", "", f"Machine: {machine}", "",
          f"{len(frames)} frames ({a.frames} per video from {a.start:.0f}s at {a.fps} fps), on-pitch people (score >= 0.5) and ball (>= 0.3). "
          "Agreement = same detections as the PyTorch CPU reference.", "",
          "| Runtime | Tiles | Status | ms/frame mean / p95 | Drift | People/frame | Ball frames | Agreement IoU0.5 (miss/extra) | Agreement IoU0.9 | Ball agreement (miss/extra) | RSS MB | GPU MB | 90-min match at 2 fps (min) |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    def agreement(a) -> str:
        return f"{a['matched']} ({a['missing']}/{a['extra']})" if a else ""

    for r in results:
        ag5, ag9 = r.get("agreement_iou0.5"), r.get("agreement_iou0.9")
        md.append(f"| {r['runtime']} | {r['tiles']} | {r['status']} | {r.get('ms_per_frame_mean', '')} / {r.get('ms_per_frame_p95', '')} | "
                  f"{r.get('drift_second_half_vs_first', '')} | {r.get('people_per_frame', '')} | {r.get('ball_frames', '')} | "
                  f"{agreement(ag5) if ag5 else ('reference' if r['runtime'] == 'torch-cpu' else '')} | {ag9['matched'] if ag9 else ''} | "
                  f"{agreement(r.get('ball_agreement'))} | {r.get('process_peak_rss_mb', '')} | {r.get('gpu_memory_mb') or ''} | {r.get('match_90min_minutes_at_2fps', '')} |")
    (out / "report.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
