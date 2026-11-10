"""Pool-assisted manual annotation of evaluation frames (ADR-034 evaluation framework).

Ground truth is decided by a person, never by the engine: the engine only proposes a very sensitive candidate POOL so the person does
not have to draw every box. The person then
  1. judges every numbered candidate: player (footballer or goalkeeper on the pitch), official (referee, assistant: an IGNORE region,
     counted neither as found nor as missed), or not a player (everything else: spectators, staff, boards, fragments, duplicates);
  2. looks at the frame with the accepted boxes drawn on a coordinate grid and ADDS every visible player the pool missed;
  3. for a tracking segment, links the same player across consecutive frames (identity ids).

  python tools/eval/annotate.py pool  --clip france_germany --times 1,3,5 --out D:/OTSI-Workspace/_tmp/annot
  python tools/eval/annotate.py check --out D:/OTSI-Workspace/_tmp/annot --decisions annotations/decisions.json
  python tools/eval/annotate.py build --out D:/OTSI-Workspace/_tmp/annot --decisions annotations/decisions.json --gt annotations/gt

Candidate pool: full frame + 2x2 + 3x3 + 4x4 tiles, score floor 0.05, no pitch filter, class-wise NMS. Images are written at the
analysis resolution (at most 1920 px wide), which is the resolution boxes are normalised to.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / "services" / "worker"))

from vie_worker import ff  # noqa: E402
from vie_worker.frames import MAX_ANALYSIS_WIDTH  # noqa: E402

FOOTAGE = APP.parent / ".local" / "eval-footage"
CLIPS = {"naples_amateur": "naples_amateur_pd.webm", "ocsc_wide": "ocsc_vs_oakland_ccby.webm", "france_germany": "france_germany_ccbysa.ogv", "nart_ercakhu_r20": "nart-v-ercakhu-round-20.mp4"}


def frame_at(path: Path, t: float):
    for f in ff.decode_sampled(str(path), None, max_width=MAX_ANALYSIS_WIDTH, start_us=int(t * 1e6), end_us=int(t * 1e6) + 60_000, seek=t > 0):
        return f
    raise ValueError(f"no frame at {t}s")


def draw(img: Image.Image, boxes, color, label=True, width=1):
    d = ImageDraw.Draw(img)
    W, H = img.size
    for b in boxes:
        x0, y0, x1, y1 = b["x"] * W, b["y"] * H, (b["x"] + b["w"]) * W, (b["y"] + b["h"]) * H
        d.rectangle([x0, y0, x1, y1], outline=color, width=width)
        if label:
            d.text((x0, max(0, y0 - 11)), str(b["n"]), fill=color)


def quadrants(img: Image.Image, scale: float = 1.6, rows: int = 2, cols: int = 2):
    """Overlapping zoomed tiles, so small players and their labels are readable."""
    W, H = img.size
    tw, th = int(W / cols * 1.15), int(H / rows * 1.15)
    out = []
    for r in range(rows):
        for c in range(cols):
            x0 = min(W - tw, int(c * W / cols)); y0 = min(H - th, int(r * H / rows))
            out.append(((x0, y0), img.crop((x0, y0, x0 + tw, y0 + th)).resize((int(tw * scale), int(th * scale)), Image.LANCZOS)))
    return out


def grid(img: Image.Image):
    """5 % coordinate grid with labels (for adding missed players by position)."""
    d = ImageDraw.Draw(img)
    W, H = img.size
    for k in range(1, 20):
        x, y = W * k / 20, H * k / 20
        d.line([(x, 0), (x, H)], fill=(255, 255, 0), width=1)
        d.line([(0, y), (W, y)], fill=(255, 255, 0), width=1)
        d.text((x + 2, 2), f"{k * 5}", fill=(255, 255, 0))
        d.text((2, y + 2), f"{k * 5}", fill=(255, 255, 0))


def cmd_pool(a):
    from vie_worker.detect.base import load_detector, nms
    out = Path(a.out); (out / "frames").mkdir(parents=True, exist_ok=True); (out / "review").mkdir(exist_ok=True)
    det = load_detector(None, grids=[2, 3, 4], score_floor=0.05)
    index = json.loads((out / "index.json").read_text()) if (out / "index.json").exists() else {}
    for t in [float(x) for x in a.times.split(",")]:
        key = f"{a.clip}@{t:07.2f}"
        f = frame_at(FOOTAGE / CLIPS[a.clip], t)
        Image.fromarray(f.rgb).save(out / "frames" / f"{key}.png")
        ds = [d for d in nms(det.detect([f.rgb])[0], 0.5) if d.label == "PERSON"]
        # pool restriction (not ground truth): drop people whose feet are clearly above the playing surface (the stands); a player there
        # is still added by hand in step 2
        from vie_worker.detect.pitch import grass_mask
        m = grass_mask(f.rgb)
        rows = np.where(m.mean(axis=1) > 0.25)[0]
        top = rows.min() / m.shape[0] if rows.size else 0.0
        from vie_worker.detect.pitch import classify
        on = classify(ds, m, touchline=True)
        ds = [d for d, ok in zip(ds, on) if ok and d.y + d.h >= top - 0.03 and d.score >= a.floor]
        pool = [{"n": i, "x": d.x, "y": d.y, "w": d.w, "h": d.h, "score": round(d.score, 3)} for i, d in enumerate(sorted(ds, key=lambda d: (d.x, d.y)))]
        index[key] = {"clip": a.clip, "t": t, "pts_us": f.pts_us, "width": f.rgb.shape[1], "height": f.rgb.shape[0], "pool": pool}
        img = Image.fromarray(f.rgb)
        draw(img, pool, (0, 255, 255))
        for q, ((x0, y0), tile) in enumerate(quadrants(img)):
            tile.save(out / "review" / f"{key}_q{q}.png")
        print(key, len(pool), "candidates", flush=True)
    (out / "index.json").write_text(json.dumps(index, indent=1))


def _gt_boxes(entry, dec):
    out = []
    marks = [(p, False) for p in dec.get("players", [])] + [(p, True) for p in dec.get("officials", [])]
    ids = dec.get("ids") or [None] * len(dec.get("players", []))
    snapped, used = [], set()
    for m, ign in marks:                               # one candidate box belongs to one person: a second mark on it is approximate
        b = snap(entry, m, None)
        if b is not None and b["n"] in used:
            b = None
        if b is not None:
            used.add(b["n"])
        snapped.append((m, ign, b))
    hs = [(b["y"] + b["h"], b["h"]) for _, _, b in snapped if b]
    for i, (m, ign, b) in enumerate(snapped):
        if b:
            box = {k: b[k] for k in "xywh"}; src = f"pool:{b['n']}"
        else:                                          # no candidate: size from annotated players at a similar depth
            near = sorted(hs, key=lambda t: abs(t[0] - m[1] / 100))[:3]
            h = float(np.median([t[1] for t in near])) if near else 0.03
            box = {"x": m[0] / 100 - 0.2 * h, "y": m[1] / 100 - h, "w": 0.4 * h, "h": h}; src = "added"
        pid = ids[i] if (not ign and i < len(ids) and ids[i]) else f"{entry['clip']}@{entry['t']}#{i}"
        out.append({**box, "src": src, "ignore": ign, "id": pid, "approximate": src == "added"})
    return out


def fine_tiles(img: Image.Image, y0: float, y1: float, cols: int = 4, scale: float = 2.4):
    """The playing band [y0, y1] cut into `cols` overlapping tiles, enlarged, with a 1 % grid (labels every 2 %) in FRAME coordinates."""
    W, H = img.size
    band = (int(y0 * H), int(y1 * H))
    out = []
    for c in range(cols):
        x0 = max(0, int((c / cols - 0.02) * W)); x1 = min(W, int(((c + 1) / cols + 0.02) * W))
        tile = img.crop((x0, band[0], x1, band[1])).resize((int((x1 - x0) * scale), int((band[1] - band[0]) * scale)), Image.LANCZOS)
        d = ImageDraw.Draw(tile)
        for k in range(0, 101):
            x = (k / 100 * W - x0) * scale
            if 0 <= x < tile.width:
                d.line([(x, 0), (x, tile.height)], fill=(255, 255, 0) if k % 2 == 0 else (120, 120, 0), width=1)
                if k % 2 == 0:
                    d.text((x + 2, 2), str(k), fill=(255, 255, 0))
            y = (k / 100 * H - band[0]) * scale
            if 0 <= y < tile.height:
                d.line([(0, y), (tile.width, y)], fill=(255, 255, 0) if k % 2 == 0 else (120, 120, 0), width=1)
                if k % 2 == 0:
                    d.text((2, y + 2), str(k), fill=(255, 255, 0))
        out.append(tile)
    return out


def cmd_sheet(a):
    out = Path(a.out); (out / "sheet").mkdir(exist_ok=True)
    for key in a.keys.split(","):
        img = Image.open(out / "frames" / f"{key}.png").convert("RGB")
        for q, tile in enumerate(fine_tiles(img, a.y0, a.y1, a.cols, a.scale)):
            tile.save(out / "sheet" / f"{key}_t{q}.png")


def snap(entry, pt, heights):
    """The pool box a person's feet mark (x %, y %) belongs to: bottom-centre near the mark; the most confident if several.
    None: no candidate covers this player (an approximate box is made from the heights of nearby annotated players)."""
    x, y = pt[0] / 100, pt[1] / 100
    best = None
    for b in entry["pool"]:
        fx, fy = b["x"] + b["w"] / 2, b["y"] + b["h"]
        if abs(fx - x) <= max(b["w"] * 0.6, 0.004) and abs(fy - y) <= max(b["h"] * 0.25, 0.006):
            if best is None or b["score"] > best["score"]:
                best = b
    return best


def cmd_link(a):
    """Propose identities across a tracking segment: same-team marks of consecutive frames matched by distance after removing the
    camera pan (median shift), accepted only within `--max-px` pixels (a player cannot run further in one sample interval).
    Unmatched marks start a new identity. The person verifies the result on the `check` images before it counts."""
    from scipy.optimize import linear_sum_assignment
    dec = json.loads(Path(a.decisions).read_text(encoding="utf-8"))
    index = json.loads((Path(a.out) / "index.json").read_text())
    keys = sorted((k for k, v in dec.items() if not k.startswith("_") and v.get("segment") == a.segment), key=lambda k: index[k]["t"])
    W, H = index[keys[0]]["width"], index[keys[0]]["height"]
    px = lambda m: np.array([m[0] / 100 * W, m[1] / 100 * H])
    nxt = 0
    prev = None
    report = []
    for k in keys:
        marks = dec[k]["players"]
        ids = [None] * len(marks)
        if prev is not None:
            pm, pids = prev
            shift = np.zeros(2)
            for _ in range(3):                               # robust pan estimate: median of nearest same-team displacements
                ds = []
                for m in marks:
                    cand = [px(q) - px(m) for q in pm if q[2] == m[2]]
                    if cand:
                        ds.append(min(cand, key=lambda v: np.linalg.norm(v + shift)))
                shift = -np.median(np.array(ds), axis=0) if ds else np.zeros(2)
            C = np.full((len(pm), len(marks)), 1e6)
            for i, q in enumerate(pm):
                for j, m in enumerate(marks):
                    if q[2] == m[2]:
                        C[i, j] = np.linalg.norm(px(m) - px(q) - shift)
            r, c = linear_sum_assignment(C)
            for i, j in zip(r, c):
                if C[i, j] <= a.max_px:
                    ids[j] = pids[i]
                    report.append((k, pids[i], round(float(C[i, j]), 1)))
        for j in range(len(ids)):
            if ids[j] is None:
                ids[j] = f"{a.segment}:{marks[j][2]}{nxt}"; nxt += 1
        dec[k]["ids"] = ids
        prev = (marks, ids)
    Path(a.decisions).write_text(json.dumps(dec, indent=1), encoding="utf-8")
    moves = sorted(report, key=lambda t: -t[2])
    print("links", len(report), "new identities", nxt, "largest moves (px):", moves[:8])


def cmd_check(a):
    out = Path(a.out); (out / "check").mkdir(exist_ok=True)
    index = json.loads((out / "index.json").read_text())
    for key, dec in json.loads(Path(a.decisions).read_text()).items():
        if key.startswith("_") or key not in index:
            continue
        img = Image.open(out / "frames" / f"{key}.png").convert("RGB")
        boxes = _gt_boxes(index[key], dec)
        draw(img, [{**b, "n": ""} for b in boxes if not b["ignore"] and not b["approximate"]], (0, 255, 0), label=False, width=2)
        draw(img, [{**b, "n": ""} for b in boxes if b["approximate"]], (255, 0, 255), label=False, width=2)
        draw(img, [{**b, "n": "off"} for b in boxes if b["ignore"]], (255, 128, 0), width=2)
        grid(img)
        for q, ((x0, y0), tile) in enumerate(quadrants(img, scale=1.4)):
            tile.save(out / "check" / f"{key}_q{q}.png")
        print(key, sum(not b["ignore"] for b in boxes), "players", sum(b["ignore"] for b in boxes), "officials")


def cmd_build(a):
    out = Path(a.out)
    index = json.loads((out / "index.json").read_text())
    decisions = json.loads(Path(a.decisions).read_text())
    by_clip: dict[str, dict] = {}
    for key, dec in decisions.items():
        if key.startswith("_"):
            continue
        e = index[key]
        g = by_clip.setdefault(e["clip"], {"video": e["clip"], "labeller": decisions.get("_labeller", "unknown"), "method": "pool-assisted manual annotation (tools/eval/annotate.py)",
                                             "frame_width": e["width"], "frame_height": e["height"], "frames": []})
        g["frames"].append({"pts_us": e["pts_us"], "t": e["t"], "complete": True, "segment": dec.get("segment"),
                            "boxes": [{k: b[k] for k in ("id", "x", "y", "w", "h", "ignore", "approximate")} | {"player_ref": None} for b in _gt_boxes(e, dec)]})
    Path(a.gt).mkdir(parents=True, exist_ok=True)
    for clip, g in by_clip.items():
        g["frames"].sort(key=lambda f: f["pts_us"])
        (Path(a.gt) / f"{clip}.json").write_text(json.dumps(g, indent=1))
        print(clip, len(g["frames"]), "frames", sum(len([b for b in f["boxes"] if not b["ignore"]]) for f in g["frames"]), "players")


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pool"); p.add_argument("--clip", required=True, choices=list(CLIPS)); p.add_argument("--times", required=True); p.add_argument("--out", required=True); p.add_argument("--floor", type=float, default=0.1)
    c = sub.add_parser("check"); c.add_argument("--out", required=True); c.add_argument("--decisions", required=True)
    sh = sub.add_parser("sheet"); sh.add_argument("--out", required=True); sh.add_argument("--keys", required=True); sh.add_argument("--y0", type=float, default=0.3); sh.add_argument("--y1", type=float, default=1.0); sh.add_argument("--cols", type=int, default=4); sh.add_argument("--scale", type=float, default=2.4)
    ln = sub.add_parser("link"); ln.add_argument("--out", required=True); ln.add_argument("--decisions", required=True); ln.add_argument("--segment", required=True); ln.add_argument("--max-px", type=float, default=45)
    b = sub.add_parser("build"); b.add_argument("--out", required=True); b.add_argument("--decisions", required=True); b.add_argument("--gt", required=True)
    a = ap.parse_args()
    {"pool": cmd_pool, "sheet": cmd_sheet, "link": cmd_link, "check": cmd_check, "build": cmd_build}[a.cmd](a)
    return 0


if __name__ == "__main__":
    sys.exit(main())
