"""Extract person crops large enough to show a shirt number, for the jersey-number OCR evaluation (ADR-033).

From the dense caches of the sampling study (reference tracks on every frame), each track contributes its largest box(es) with a height of at
least MIN_PX pixels; crops are written as PNG plus contact sheets with their ids, so a person can label the visible number (or "none").

  python otsi-vie/tools/models/jersey_crops.py <cache.pkl>::<video> ... --out <dir> [--per-track 2] [--min-px 110]
"""
from __future__ import annotations

import argparse
import json
import pickle
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / "services" / "worker"))
sys.path.insert(0, str(APP / "tools" / "models"))
from PIL import Image, ImageDraw  # noqa: E402

from vie_worker import ff  # noqa: E402
import sampling_study as S  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pairs", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--per-track", type=int, default=2)
    ap.add_argument("--min-px", type=int, default=110)
    a = ap.parse_args()
    out = Path(a.out)
    (out / "crops").mkdir(parents=True, exist_ok=True)
    index = []
    for pair in a.pairs:
        cache, video = pair.split("::")
        data = pickle.load(open(cache, "rb"))
        frames = data["frames"]
        clip = Path(video).stem.split("_")[0]
        ref, _ = S.run_tracker(frames, list(range(len(frames))), cmc=False)
        need = {}
        for t in ref:
            if t.label != "PERSON":
                continue
            big = sorted(t.observations, key=lambda o: -o.h)
            picked = []
            for o in big:
                if o.h * 1080 < a.min_px or len(picked) >= a.per_track:
                    break
                if all(abs(o.pts_us - p.pts_us) > 1_500_000 for p in picked):       # different moments: different poses
                    picked.append(o)
            for k, o in enumerate(picked):
                need.setdefault(o.frame_index, []).append((f"{clip}_{t.number}_{k}", o))
        if not need:
            continue
        last = max(need)
        for f in ff.decode_sampled(video, None, max_width=1920):
            for cid, o in need.pop(f.frame_index, []):
                h, w = f.rgb.shape[:2]
                x0, y0 = max(0, int((o.x - 0.05 * o.w) * w)), max(0, int((o.y - 0.03 * o.h) * h))
                x1, y1 = min(w, int((o.x + 1.05 * o.w) * w)), min(h, int((o.y + 1.03 * o.h) * h))
                Image.fromarray(f.rgb[y0:y1, x0:x1]).save(out / "crops" / f"{cid}.png")
                index.append({"id": cid, "clip": clip, "pts_us": o.pts_us, "height_px": y1 - y0})
            if f.frame_index >= last:
                break
    (out / "crops.json").write_text(json.dumps(index, indent=1), encoding="utf-8")
    # contact sheets of 24 crops with their ids, for labelling
    for s in range(0, len(index), 24):
        sheet = Image.new("RGB", (6 * 170, 4 * 300), (20, 20, 20))
        dr = ImageDraw.Draw(sheet)
        for k, it in enumerate(index[s:s + 24]):
            im = Image.open(out / "crops" / f"{it['id']}.png")
            im.thumbnail((165, 270))
            x, y = (k % 6) * 170, (k // 6) * 300
            sheet.paste(im, (x + 2, y + 2))
            dr.text((x + 4, y + 278), it["id"], fill=(255, 255, 0))
        sheet.save(out / f"sheet_{s // 24:02d}.png")
    print(len(index), "crops")
    return 0


if __name__ == "__main__":
    sys.exit(main())
