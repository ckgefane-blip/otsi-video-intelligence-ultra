"""Frame-sampling and tracking-quality study on real football footage (ADR-028).

Phase `dense`: decode a window of a video at (up to) its native frame rate, run the production detector on EVERY frame (same weights,
tiling, pitch filter and device as a real run) and cache, per frame: the detections, an appearance descriptor per person box (kit
colour histogram), and the cut-detector / motion features. Detection is the expensive part, so it runs once per clip.

Phase `evaluate`: from that cache, simulate analysis at several sampling rates (and adaptive schemes) WITHOUT re-running the detector —
each simulated run sees exactly the detections a real run at that rate would see — and compare with the dense reference:

  * reference = the tracker run on every frame. It is NOT ground truth (no labelled footage exists yet); it is the best evidence the
    same detector can give, because at full frame rate consecutive boxes overlap almost completely and association is easy.
  * identity switches: a sampled track whose observations belong to more than one reference track (each change = one switch)
  * fragmentation: sampled tracks per reference track (1.0 = never broken), coverage of reference observations by confirmed tracks
  * cuts: hard cuts found at the sampled rate vs at full rate
  * motion: centre displacement between samples / box height (why association gets harder at low rates)
  * interpolation error: a straight line between two sampled boxes compared with the real dense detections in between (IoU) —
    what a spotlight rendered at playback rate would show between samples if positions were interpolated
  * cost: measured detector time per frame x frames per match

  python otsi-vie/tools/models/sampling_study.py dense <video> --start 0 --seconds 30 [--max-fps 30] --out .local/eval-cache/<name>.npz
  python otsi-vie/tools/models/sampling_study.py evaluate .local/eval-cache/*.npz --out release-evidence/sampling-study/<date>
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pickle
import sys
import time
from pathlib import Path

import av
import numpy as np

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / "services" / "worker"))
from vie_worker.detect.base import Detection, load_detector  # noqa: E402
from vie_worker.detect.pitch import classify, grass_mask  # noqa: E402
from vie_worker.frames import MAX_ANALYSIS_WIDTH, CutDetector  # noqa: E402
from vie_worker import tracker as trk  # noqa: E402

BATCH = 8
# tracker variants compared at every rate: production (IoU), + camera-motion compensation, + centre-distance blending
VARIANTS = (("iou", False, None), ("iou+cmc", True, None), ("distance", False, {"distance_weight": 0.5}))


def appearance(rgb: np.ndarray, d: Detection) -> np.ndarray:
    """Kit colour: hue/saturation histogram of the torso (upper-middle of the box), L1-normalised, 24 bins."""
    h, w = rgb.shape[:2]
    x0, x1 = int((d.x + 0.2 * d.w) * w), int((d.x + 0.8 * d.w) * w)
    y0, y1 = int((d.y + 0.15 * d.h) * h), int((d.y + 0.55 * d.h) * h)
    crop = rgb[max(0, y0):max(y0 + 1, y1), max(0, x0):max(x0 + 1, x1)].astype(np.float32) / 255
    if crop.size == 0:
        return np.zeros(24, np.float32)
    r, g, b = crop[..., 0], crop[..., 1], crop[..., 2]
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    dd = mx - mn + 1e-6
    hue = np.where(mx == r, ((g - b) / dd) % 6, np.where(mx == g, (b - r) / dd + 2, (r - g) / dd + 4)) / 6
    sat = np.where(mx > 0, dd / (mx + 1e-6), 0)
    val = mx
    # dark / white kits have no reliable hue: separate bins for low saturation by brightness
    chroma = sat > 0.25
    hist = np.zeros(24, np.float32)
    hb = np.minimum((hue[chroma] * 16).astype(int), 15)
    np.add.at(hist, hb, 1)
    vb = np.minimum((val[~chroma] * 8).astype(int), 7)
    np.add.at(hist, 16 + vb, 1)
    return hist / max(1.0, hist.sum())


def dense(args) -> None:
    det = load_detector(None, tiles=args.tiles, score_floor=0.2, device=args.device)
    frames = []
    cut = CutDetector()
    t_det = 0.0
    with av.open(args.video, metadata_errors="ignore") as c:
        v = c.streams.video[0]
        v.thread_type = "AUTO"
        tb, first, index, last_t = v.time_base, None, -1, -1e18
        start_us, end_us = int(args.start * 1e6), int((args.start + args.seconds) * 1e6)
        min_step = 1e6 / args.max_fps - 500
        pending = []

        def flush():
            nonlocal t_det
            t0 = time.perf_counter()
            found = det.detect([p["rgb"] for p in pending])
            t_det += time.perf_counter() - t0
            for p, ds in zip(pending, found):
                on = classify(ds, grass_mask(p["rgb"]))
                p["dets"] = [(d.label, d.score, d.x, d.y, d.w, d.h, bool(ok)) for d, ok in zip(ds, on)]
                p["app"] = [appearance(p["rgb"], d) for d in ds]
                hist, small = cut._features(p["rgb"])
                p["hist"], p["small"] = hist.astype(np.float32), small.astype(np.float16)
                del p["rgb"]
                frames.append(p)
            pending.clear()

        for frame in c.decode(v):
            index += 1
            if frame.pts is None:
                continue
            if first is None:
                first = frame.pts
            t = int((frame.pts - first) * tb * 1_000_000)
            if t < start_us:
                continue
            if t >= end_us:
                break
            if t - last_t < min_step:
                continue
            last_t = t
            if frame.width > MAX_ANALYSIS_WIDTH:
                th = int(round(frame.height * MAX_ANALYSIS_WIDTH / frame.width / 2)) * 2
                rgb = frame.to_ndarray(width=MAX_ANALYSIS_WIDTH, height=th, format="rgb24")
            else:
                rgb = frame.to_ndarray(format="rgb24")
            pending.append({"frame_index": index, "pts_us": t, "rgb": rgb})
            if len(pending) >= BATCH:
                flush()
                print(f"\r{len(frames)} frames, {t / 1e6:.1f}s", end="", flush=True)
        if pending:
            flush()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    meta = {"video": Path(args.video).name, "start": args.start, "seconds": args.seconds, "max_fps": args.max_fps, "tiles": args.tiles,
            "runtime": det.runtime, "model": det.entry["key"], "ms_per_frame": round(1000 * t_det / max(1, len(frames)), 1), "frames": len(frames)}
    with open(out, "wb") as f:
        pickle.dump({"meta": meta, "frames": frames}, f)
    print("\n", json.dumps(meta))


# ---------------------------------------------------------------------------------------------------------------------- evaluation
def sample_grid(frames, fps: float):
    """The same time-grid rule as vie_worker.frames.sample_frames."""
    out, next_t, step = [], frames[0]["pts_us"], 1e6 / fps
    for i, f in enumerate(frames):
        t = f["pts_us"]
        if t + 1 < next_t:
            continue
        next_t = max(next_t + step, t + step / 2)
        out.append(i)
    return out


def motion_of(frames, i, j) -> float:
    a, b = frames[i]["small"].astype(np.float32), frames[j]["small"].astype(np.float32)
    return float(np.mean(np.abs(a - b))) if a.shape == b.shape else 255.0


def sample_adaptive(frames, base: float, burst: float, threshold: float):
    """Base rate; where the picture changes fast between two base samples (camera pan, counter-attack), add samples at the burst
    rate in that interval. The decision uses only the cheap motion feature, never the detector."""
    grid = sample_grid(frames, base)
    out = []
    step = 1e6 / burst
    for a, b in zip(grid, grid[1:] + [len(frames) - 1]):
        out.append(a)
        if b > a and motion_of(frames, a, b) > threshold:
            nt = frames[a]["pts_us"] + step
            for k in range(a + 1, b):
                if frames[k]["pts_us"] + 1 >= nt:
                    out.append(k)
                    nt += step
    return sorted(set(out))


def global_shift(frames, i, j) -> tuple[float, float]:
    """Camera motion between two frames as a normalised (dx, dy) translation: phase correlation of the small grey images."""
    a, b = frames[i]["small"].astype(np.float32), frames[j]["small"].astype(np.float32)
    if a.shape != b.shape:
        return 0.0, 0.0
    a, b = a - a.mean(), b - b.mean()
    win = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    fa, fb = np.fft.fft2(a * win), np.fft.fft2(b * win)
    r = fb * np.conj(fa)
    r /= np.abs(r) + 1e-9
    corr = np.fft.ifft2(r).real
    py, px = np.unravel_index(int(np.argmax(corr)), corr.shape)
    H, W = corr.shape

    def sub(c_m, c_0, c_p):                                   # parabolic sub-pixel peak
        den = c_m - 2 * c_0 + c_p
        return 0.0 if abs(den) < 1e-12 else 0.5 * (c_m - c_p) / den
    fy = py + sub(corr[(py - 1) % H, px], corr[py, px], corr[(py + 1) % H, px])
    fx = px + sub(corr[py, (px - 1) % W], corr[py, px], corr[py, (px + 1) % W])
    if fy > H / 2:
        fy -= H
    if fx > W / 2:
        fx -= W
    return fx / W, fy / H


def run_tracker(frames, idx, *, cmc: bool, tracker_kwargs=None):
    """Tracking exactly as the ANALYZE handler does it (on-pitch detections, cut detector between samples)."""
    t = trk.Tracker(**(tracker_kwargs or {}))
    cut = CutDetector()
    cuts = []
    prev = None
    for i in idx:
        f = frames[i]
        is_cut = False
        if cut.prev_hist is not None and cut.prev_small is not None and f["small"].shape == cut.prev_small.shape:
            bc = float(np.sum(np.sqrt(f["hist"] * cut.prev_hist)))
            dist = float(np.sqrt(max(0.0, 1 - bc)))
            pixel = float(np.mean(np.abs(f["small"].astype(np.float32) - cut.prev_small)))
            is_cut = dist > cut.threshold and pixel > cut.pixel_threshold
        cut.prev_hist, cut.prev_small = f["hist"], f["small"].astype(np.float32)
        if is_cut:
            t.end_all()
            cuts.append(f["pts_us"])
        dets = [Detection(l, s, x, y, w, h) for (l, s, x, y, w, h, ok) in f["dets"] if ok]
        shift = global_shift(frames, prev, i) if (cmc and prev is not None and not is_cut) else None
        if shift is not None:
            t.update(f["frame_index"], f["pts_us"], dets, camera_shift=shift)
        else:
            t.update(f["frame_index"], f["pts_us"], dets)
        prev = i
    return t.results(), cuts


def key(o) -> tuple:
    return (o.frame_index, round(o.x, 6), round(o.y, 6))


def evaluate_one(frames, ref_tracks, idx, *, cmc=False, label="PERSON", tracker_kwargs=None):
    """A change of reference track inside one sampled track is a CONFIRMED switch when the two reference tracks exist at the same time
    (two different people); when one ended before the other began the reference itself broke there and the change is undecidable."""
    tracks, cuts = run_tracker(frames, idx, cmc=cmc, tracker_kwargs=tracker_kwargs)
    span = {r.number: (r.observations[0].pts_us, r.observations[-1].pts_us) for r in ref_tracks if r.label == label}
    bridged = persistent = 0
    ref_of = {}
    for r in ref_tracks:
        if r.label == label:
            for o in r.observations:
                ref_of[key(o)] = r.number
    sampled = set(frames[i]["frame_index"] for i in idx)
    switches, impure, matched_obs, n_tracks = 0, 0, 0, 0
    covering: dict[int, set[int]] = {}
    for t in tracks:
        if t.label != label:
            continue
        n_tracks += 1
        seq = [ref_of.get(key(o)) for o in t.observations]
        seq = [s for s in seq if s is not None]
        matched_obs += len(seq)
        confirmed = 0
        for a, b in zip(seq, seq[1:]):
            if a != b:
                if span[a][0] <= span[b][1] and span[b][0] <= span[a][1]:
                    confirmed += 1
                else:
                    bridged += 1
        switches += confirmed
        impure += confirmed > 0
        # persistent switch: after the change the track stays on the other (simultaneously existing) person for >= 1 s
        runs = []
        for o in t.observations:
            r = ref_of.get(key(o))
            if r is None:
                continue
            if runs and runs[-1][0] == r:
                runs[-1][2] = o.pts_us
            else:
                runs.append([r, o.pts_us, o.pts_us])
        stable = [x for x in runs if x[2] - x[1] >= 1_000_000]
        for a, b in zip(stable, stable[1:]):
            if a[0] != b[0] and span[a[0]][0] <= span[b[0]][1] and span[b[0]][0] <= span[a[0]][1]:
                persistent += 1
        for s in set(seq):
            covering.setdefault(s, set()).add(t.number)
    # reference tracks that last at least 2 s and are visible at this rate
    min_len = 2_000_000 if label == "PERSON" else 0
    long_refs = [r for r in ref_tracks if r.label == label and r.observations[-1].pts_us - r.observations[0].pts_us >= min_len]
    frag = [len(covering.get(r.number, ())) for r in long_refs]
    ref_obs_at_rate = sum(1 for r in long_refs for o in r.observations if o.frame_index in sampled)
    covered = 0
    tracked_keys = {key(o) for t in tracks if t.label == label for o in t.observations}
    for r in long_refs:
        covered += sum(1 for o in r.observations if o.frame_index in sampled and key(o) in tracked_keys)
    detected_at_rate = sum(1 for i in idx if any(l == label and ok and (label == "PERSON" or s >= 0.3)
                                                 for (l, s, *_r, ok) in frames[i]["dets"]))
    return {"tracks": n_tracks, "persistent_switches": persistent, "frames_with_detection": detected_at_rate, "switches": switches, "bridged_reference_breaks": bridged, "impure_tracks": impure, "cuts": cuts,
            "fragments_per_ref_track": round(float(np.mean([f for f in frag if f > 0])) if any(frag) else 0.0, 3),
            "ref_tracks_never_tracked": sum(1 for f in frag if f == 0), "long_ref_tracks": len(long_refs),
            "coverage": round(covered / ref_obs_at_rate, 4) if ref_obs_at_rate else None, "tracks_obj": tracks}


def motion_stats(ref_tracks, fps):
    """Median and 95th percentile of the centre displacement between samples 1/fps apart, in box heights (reference person tracks)."""
    gap = 1e6 / fps
    vals = []
    for r in ref_tracks:
        if r.label != "PERSON":
            continue
        obs = r.observations
        j = 0
        for i, o in enumerate(obs):
            while j < len(obs) and obs[j].pts_us < o.pts_us + gap - 1000:
                j += 1
            if j >= len(obs):
                break
            p = obs[j]
            if abs(p.pts_us - o.pts_us - gap) > gap * 0.25:
                continue
            d = np.hypot((p.x + p.w / 2) - (o.x + o.w / 2), (p.y + p.h / 2) - (o.y + o.h / 2)) / max(o.h, 1e-4)
            vals.append(d)
    if not vals:
        return None
    return {"median": round(float(np.median(vals)), 3), "p95": round(float(np.percentile(vals, 95)), 3), "n": len(vals)}


def _box_iou(a, b):
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    u = a[2] * a[3] + b[2] * b[3] - inter
    return inter / u if u > 0 else 0.0


def interpolation_error(ref_tracks, fps, label="PERSON"):
    """Linear interpolation between two observations 1/fps apart vs the real dense detection in between (IoU)."""
    gap = 1e6 / fps
    ious = []
    for r in ref_tracks:
        if r.label != label:
            continue
        obs = r.observations
        k = 0
        while k < len(obs):
            a = obs[k]
            j = k
            while j < len(obs) and obs[j].pts_us < a.pts_us + gap - 1000:
                j += 1
            if j >= len(obs):
                break
            b = obs[j]
            if b.pts_us - a.pts_us > gap * 1.25:
                k = j
                continue
            for m in obs[k + 1:j]:
                f = (m.pts_us - a.pts_us) / max(1, b.pts_us - a.pts_us)
                box = tuple(av_ * (1 - f) + bv * f for av_, bv in zip((a.x, a.y, a.w, a.h), (b.x, b.y, b.w, b.h)))
                ious.append(_box_iou(box, (m.x, m.y, m.w, m.h)))
            k = j
    if not ious:
        return None
    ious = np.array(ious)
    return {"mean_iou": round(float(ious.mean()), 3), "p10_iou": round(float(np.percentile(ious, 10)), 3),
            "share_below_0.5": round(float((ious < 0.5).mean()), 3), "n": int(len(ious))}


def reid_links(frames, tracks, *, max_gap_s=3.0, min_sim=0.75, max_jump=2.5):
    """Candidate within-shot re-links of a track that ended to one that started shortly after: similar kit colour and a plausible
    position. Returned as (ended_track, new_track, similarity) — evaluated against the reference, not applied to production data."""
    app = {}
    for f in frames:
        for (l, s, x, y, w, h, ok), a in zip(f["dets"], f["app"]):
            app[(f["frame_index"], round(x, 6), round(y, 6))] = a
    def desc(t):
        v = [app.get(key(o)) for o in t.observations]
        v = [x for x in v if x is not None]
        return np.mean(v, axis=0) if v else None
    persons = [t for t in tracks if t.label == "PERSON"]
    d = {t.number: desc(t) for t in persons}
    links = []
    for a in persons:
        ea = a.observations[-1]
        best = None
        for b in persons:
            sb = b.observations[0]
            if b.shot_number != a.shot_number or not 0 < sb.pts_us - ea.pts_us <= max_gap_s * 1e6:
                continue
            jump = np.hypot((sb.x + sb.w / 2) - (ea.x + ea.w / 2), (sb.y + sb.h / 2) - (ea.y + ea.h / 2)) / max(ea.h, 1e-4)
            if jump > max_jump * max(1.0, (sb.pts_us - ea.pts_us) / 1e6):
                continue
            if d[a.number] is None or d[b.number] is None:
                continue
            sim = float(np.sum(np.sqrt(d[a.number] * d[b.number])))      # Bhattacharyya coefficient
            if sim >= min_sim and (best is None or sim > best[2]):
                best = (a, b, sim)
        if best:
            links.append(best)
    return links


def evaluate(args) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report = {"generated": dt.datetime.now().isoformat(timespec="seconds"), "clips": []}
    rates = [1, 2, 3, 5, 10, 15]
    for path in args.caches:
        with open(path, "rb") as fh:
            data = pickle.load(fh)
        meta, frames = data["meta"], data["frames"]
        full = list(range(len(frames)))
        ref, ref_cuts = run_tracker(frames, full, cmc=False)
        native = len(frames) / max(1e-6, (frames[-1]["pts_us"] - frames[0]["pts_us"]) / 1e6)
        clip = {"meta": meta, "native_fps": round(native, 2), "reference": {
            "person_tracks": sum(t.label == "PERSON" for t in ref), "ball_tracks": sum(t.label == "BALL" for t in ref),
            "cuts_s": [round(c / 1e6, 2) for c in ref_cuts]}, "rates": [], "adaptive": [], "reid": []}
        print(f"\n{meta['video']} ({meta['frames']} frames @ {native:.1f} fps): reference {clip['reference']}")
        for r in [x for x in rates if x < native - 0.5]:
            idx = sample_grid(frames, r)
            for variant, cmc, kw in VARIANTS:
                e = evaluate_one(frames, ref, idx, cmc=cmc, tracker_kwargs=kw)
                ball = evaluate_one(frames, ref, idx, cmc=cmc, label="BALL", tracker_kwargs=kw)
                row = {"fps": r, "variant": variant, "camera_motion_compensation": cmc, "frames": len(idx),
                       **{k: v for k, v in e.items() if k not in ("tracks_obj", "cuts")},
                       "cuts_found": len(e["cuts"]), "cuts_matching_reference": sum(1 for c in e["cuts"] if any(abs(c - rc) <= 1e6 / r + 1e5 for rc in ref_cuts)),
                       "ball_coverage": ball["coverage"], "ball_switches": ball["switches"], "ball_frames_detected": ball["frames_with_detection"],
                       "ball_frames_tracked": sum(len(t.observations) for t in ball["tracks_obj"] if t.label == "BALL"),
                       "motion_between_samples": motion_stats(ref, r), "interpolation": interpolation_error(ref, r),
                       "ball_interpolation": interpolation_error(ref, r, "BALL"),
                       "match_minutes_90": round(90 * 60 * r * meta["ms_per_frame"] / 1000 / 60, 1)}
                if variant == "iou":
                    links = reid_links(frames, e["tracks_obj"])
                    ref_of = {}
                    for t in ref:
                        for o in t.observations:
                            ref_of[key(o)] = t.number
                    def refs(t):
                        return {ref_of.get(key(o)) for o in t.observations} - {None}
                    good = bad = unknown = 0
                    for a, b, _ in links:
                        ra, rb = refs(a), refs(b)
                        if ra & rb:
                            good += 1
                        elif ra and rb:
                            spans = {t.number: (t.observations[0].pts_us, t.observations[-1].pts_us) for t in ref}
                            overl = any(spans[x][0] <= spans[y][1] and spans[y][0] <= spans[x][1] for x in ra for y in rb)
                            bad += overl
                            unknown += not overl
                        else:
                            unknown += 1
                    clip["reid"].append({"fps": r, "candidate_links": len(links), "confirmed_by_reference": good,
                                         "contradicted_by_reference": bad, "undecidable": unknown})
                clip["rates"].append(row)
                print(f"  {r:>4} fps {variant:>8}: tracks {row['tracks']:>4} switches {row['switches']:>3}/{row['persistent_switches']:>2}p ball {row['ball_frames_tracked']}/{row['ball_frames_detected']} frag {row['fragments_per_ref_track']:.2f} "
                      f"cov {row['coverage']} ball {row['ball_coverage']} cuts {row['cuts_found']}/{len(ref_cuts)} "
                      f"interp {row['interpolation'] and row['interpolation']['mean_iou']} 90min {row['match_minutes_90']}")
        for base, burst, thr in ((2, 5, 12.0), (2, 5, 8.0), (2, 10, 12.0), (3, 6, 10.0)):
            idx = sample_adaptive(frames, base, burst, thr)
            if len(idx) >= len(frames):
                continue
            e = evaluate_one(frames, ref, idx)
            ball = evaluate_one(frames, ref, idx, label="BALL")
            eff = len(idx) / max(1e-6, (frames[-1]["pts_us"] - frames[0]["pts_us"]) / 1e6)
            row = {"base_fps": base, "burst_fps": burst, "motion_threshold": thr, "frames": len(idx), "effective_fps": round(eff, 2),
                   **{k: v for k, v in e.items() if k not in ("tracks_obj", "cuts")}, "cuts_found": len(e["cuts"]),
                   "ball_coverage": ball["coverage"], "match_minutes_90": round(90 * 60 * eff * meta["ms_per_frame"] / 1000 / 60, 1)}
            clip["adaptive"].append(row)
            print(f"  adaptive {base}->{burst} thr {thr}: eff {eff:.2f} fps, switches {row['switches']}/{row['persistent_switches']}p frag {row['fragments_per_ref_track']:.2f} cov {row['coverage']} ball {row['ball_coverage']}")
        report["clips"].append(clip)
    (out / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print("\nwritten", out / "report.json")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("dense")
    d.add_argument("video")
    d.add_argument("--start", type=float, default=0)
    d.add_argument("--seconds", type=float, default=30)
    d.add_argument("--max-fps", type=float, default=30)
    d.add_argument("--tiles", type=int, default=2)
    d.add_argument("--device", default=None)
    d.add_argument("--out", required=True)
    e = sub.add_parser("evaluate")
    e.add_argument("caches", nargs="+")
    e.add_argument("--out", required=True)
    a = ap.parse_args()
    dense(a) if a.cmd == "dense" else evaluate(a)


if __name__ == "__main__":
    main()
