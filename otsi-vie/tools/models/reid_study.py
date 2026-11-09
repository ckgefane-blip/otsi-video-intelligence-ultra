"""Appearance re-identification study on real football footage (ADR-031): which FREE model can tell whether two track pieces show the
same person — the basis for proposing links across occlusions and camera cuts (always reviewed by a person).

Data: the dense caches of the sampling study (tools/models/sampling_study.py dense ...): every frame's detections + kit-colour histogram.
Reference tracks = the production tracker on every frame (not ground truth, ADR-028). Protocol per clip:
  * each reference PERSON track lasting >= 3 s is cut into a QUERY (first 40 % of its time), a dropped gap (20 %) and a GALLERY piece
    (last 40 %);
  * a query is ranked against the gallery pieces of every reference track that was visible AT THE SAME TIME as the query's track —
    people on screen together are certainly different persons (teammates in the same kit included: the hard case);
  * rank-1 accuracy, mean reciprocal rank, and the same/different score separation (AUC) are reported per method.
Methods: kit-colour histogram (no model), DINOv2-small / DINOv2-base / SigLIP-base image embeddings (Apache-2.0, pinned in the registry),
and embedding + kit colour combined. Crops: up to 8 detections per piece, box enlarged by 10 %.

  python otsi-vie/tools/models/reid_study.py .local/eval-cache/france.pkl::.local/eval-footage/france_germany_ccbysa.ogv ... --out <dir>
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pickle
import sys
import time
from pathlib import Path

import numpy as np
import torch

APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / "services" / "worker"))
sys.path.insert(0, str(APP / "tools" / "models"))
from vie_worker import ff  # noqa: E402
from vie_worker.detect.base import verified_model_dir  # noqa: E402
import sampling_study as S  # noqa: E402  (reference tracking on the cached detections)

CROPS_PER_PIECE = 8
MODELS = ("dinov2_small", "dinov2_base", "siglip_base_224")


def load_embedder(key: str):
    from transformers import AutoImageProcessor, AutoModel, SiglipVisionModel
    entry, d, _ = verified_model_dir(key)
    proc = AutoImageProcessor.from_pretrained(d)
    model = (SiglipVisionModel if entry["family"] == "SigLIP" else AutoModel).from_pretrained(d).eval()

    @torch.inference_mode()
    def embed(crops: list[np.ndarray]) -> np.ndarray:
        out = []
        for i in range(0, len(crops), 32):
            x = proc(images=crops[i:i + 32], return_tensors="pt")
            o = model(pixel_values=x["pixel_values"])
            v = o.pooler_output if getattr(o, "pooler_output", None) is not None else o.last_hidden_state[:, 0]
            out.append(torch.nn.functional.normalize(v, dim=-1).numpy())
        return np.concatenate(out)
    return embed


def pieces(ref_tracks):
    out = []
    for t in ref_tracks:
        if t.label != "PERSON":
            continue
        a, b = t.observations[0].pts_us, t.observations[-1].pts_us
        if b - a < 3_000_000:
            continue
        q = [o for o in t.observations if o.pts_us <= a + 0.4 * (b - a)]
        g = [o for o in t.observations if o.pts_us >= a + 0.6 * (b - a)]
        if len(q) >= 3 and len(g) >= 3:
            out.append({"track": t.number, "span": (a, b), "q": q, "g": g})
    return out


def pick(obs, n=CROPS_PER_PIECE):
    idx = np.linspace(0, len(obs) - 1, min(n, len(obs))).round().astype(int)
    return [obs[i] for i in sorted(set(idx))]


def crop(rgb, o, pad=0.10):
    h, w = rgb.shape[:2]
    x0, y0 = max(0, int((o.x - pad * o.w) * w)), max(0, int((o.y - pad * o.h) * h))
    x1, y1 = min(w, int((o.x + o.w * (1 + pad)) * w)), min(h, int((o.y + o.h * (1 + pad)) * h))
    return rgb[y0:max(y0 + 2, y1), x0:max(x0 + 2, x1)]


def evaluate(ps, sim):
    """sim(i, j): similarity of query i with gallery j. Gallery of i = pieces whose tracks overlap i's track in time (+ itself)."""
    r1, rr, pos, neg, sizes = 0, [], [], [], []
    n_eval = 0
    for i, p in enumerate(ps):
        gal = [j for j, g in enumerate(ps) if j == i or (g["span"][0] <= p["span"][1] and p["span"][0] <= g["span"][1])]
        if len(gal) < 2:
            continue
        n_eval += 1
        sizes.append(len(gal))
        scores = {j: sim(i, j) for j in gal}
        order = sorted(gal, key=lambda j: -scores[j])
        rank = order.index(i) + 1
        r1 += rank == 1
        rr.append(1 / rank)
        pos.append(scores[i])
        neg += [scores[j] for j in gal if j != i]
    pos, neg = np.array(pos), np.array(neg)
    auc = float((pos[:, None] > neg[None, :]).mean() + 0.5 * (pos[:, None] == neg[None, :]).mean()) if len(pos) and len(neg) else None
    return {"queries": n_eval, "rank1": round(r1 / n_eval, 3) if n_eval else None, "mrr": round(float(np.mean(rr)), 3) if rr else None,
            "auc_same_vs_different": round(auc, 3) if auc is not None else None, "mean_gallery_size": round(float(np.mean(sizes)), 1) if sizes else None}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pairs", nargs="+", help="<cache.pkl>::<video>")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    report = {"generated": dt.datetime.now().isoformat(timespec="seconds"), "protocol": __doc__.split("Methods:")[0].strip(), "clips": []}
    embedders = {k: load_embedder(k) for k in MODELS}
    for pair in a.pairs:
        cache, video = pair.split("::")
        with open(cache, "rb") as fh:
            data = pickle.load(fh)
        meta, frames = data["meta"], data["frames"]
        ref, _ = S.run_tracker(frames, list(range(len(frames))), cmc=False)
        ps = pieces(ref)
        app = {}
        for f in frames:
            for (l, s, x, y, w, h, ok), hist in zip(f["dets"], f["app"]):
                app[(f["frame_index"], round(x, 6), round(y, 6))] = hist
        need = {}
        for k, p in enumerate(ps):
            for part in ("q", "g"):
                p[part + "_crops"] = pick(p[part])
                for o in p[part + "_crops"]:
                    need.setdefault(o.frame_index, []).append((k, part, o))
        crops = {(k, part): [] for k, p in enumerate(ps) for part in ("q", "g")}
        heights = []
        last = max(need) if need else -1
        for f in ff.decode_sampled(video, None, max_width=1920):
            if f.frame_index > last + 1_000_000 or not need:
                break
            # the cache's frame_index counts from the start of the file, like decode_sampled
            for k, part, o in need.pop(f.frame_index, []):
                c = crop(f.rgb, o)
                crops[(k, part)].append(c)
                heights.append(c.shape[0])
            if f.frame_index >= last:
                break
        kit = {(k, part): np.mean([app[S.key(o)] for o in p[part + "_crops"] if S.key(o) in app] or [np.zeros(24)], axis=0)
               for k, p in enumerate(ps) for part in ("q", "g")}
        clip = {"video": meta["video"], "reference_person_tracks": sum(t.label == "PERSON" for t in ref), "pieces": len(ps),
                "crop_height_px": {"median": int(np.median(heights)) if heights else None, "p10": int(np.percentile(heights, 10)) if heights else None},
                "methods": {}}
        bc = lambda u, v: float(np.sum(np.sqrt(np.clip(u, 0, None) * np.clip(v, 0, None))))
        clip["methods"]["kit_colour"] = evaluate(ps, lambda i, j: bc(kit[(i, "q")], kit[(j, "g")]))
        for key, emb in embedders.items():
            t0 = time.perf_counter()
            vec = {}
            for kk, cs in crops.items():
                if cs:
                    e = emb(cs).mean(axis=0)
                    vec[kk] = e / (np.linalg.norm(e) + 1e-9)
            secs = time.perf_counter() - t0
            cos = lambda i, j: float(vec[(i, "q")] @ vec[(j, "g")]) if (i, "q") in vec and (j, "g") in vec else -1.0
            clip["methods"][key] = {**evaluate(ps, cos), "seconds_cpu": round(secs, 1), "crops": sum(len(c) for c in crops.values())}
            clip["methods"][key + "+kit"] = evaluate(ps, lambda i, j: cos(i, j) + 0.5 * bc(kit[(i, "q")], kit[(j, "g")]))
        report["clips"].append(clip)
        print(json.dumps(clip, indent=1))
    (out / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print("written", out / "report.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
