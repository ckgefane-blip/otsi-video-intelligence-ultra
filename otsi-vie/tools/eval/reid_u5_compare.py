"""Track U.5 measurement: part-based Re-ID vs whole-crop appearance, on synthetic same-kit players.

The failing case (reproduced first, before any fix): two players in the SAME kit — identical white
torsos, different hair and socks. The pre-U.5 whole-crop signals (kit histogram, torso Lab) cannot tell
them apart at all. Part-based comparison (head / torso / legs, grass-masked, torso down-weighted) can.

What is measured here (synthetic crops only — no model, no video):
  whole-crop  kit-histogram cosine + torso Lab distance, same player vs different player, same kit
  part-based  part_similarity() over grass-masked part colour vectors, same comparison
  grass       recolouring the grass alone must not move a part vector; speckling grass over the socks
              keeps it close (the pixel mix moves the median a little)
  links       propose_links() on synthetic TrackAppearance objects: whole-crop ranks the wrong later
              track first, part similarity ranks the right one first (use_parts=True only)

Honesty limits (read before quoting any number):
  * No DINOv2 model runs here (torch is not installed in this workspace), so the numbers below are for
    the model-free part colour vectors. The per-part DINOv2 path (embed_parts) is wired and stub-tested
    in tests/test_appearance.py, but its accuracy on real footage is UNMEASURED.
  * The 3 existing ground-truth files (annotations/gt/*.json) contain BOXES only — no crops, no video —
    so part-based Re-ID cannot be scored on them at all. A real U.5 number needs Sukhum footage with
    labelled crossings, the same blocker as U.2/U.3.

Usage:
  python otsi-vie/tools/eval/reid_u5_compare.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "worker"))
from vie_worker import appearance as ap  # noqa: E402
from vie_worker.evaluation import load_ground_truth  # noqa: E402

GRASS = (70, 110, 50)
WHITE = (235, 235, 230)
GT_DIR = Path(__file__).resolve().parent / "annotations" / "gt"


def person(head, torso, shorts, socks, h=120, w=60, noise=0, seed=0):
    rng = np.random.default_rng(seed)
    im = np.zeros((h, w, 3), np.uint8)
    im[:] = GRASS
    im[0:int(0.15 * h), :] = head
    im[int(0.15 * h):int(0.55 * h), int(0.2 * w):int(0.8 * w)] = torso
    im[int(0.55 * h):int(0.78 * h), int(0.2 * w):int(0.8 * w)] = shorts
    im[int(0.78 * h):, int(0.2 * w):int(0.8 * w)] = socks
    if noise:
        im = np.clip(im.astype(int) + rng.integers(-noise, noise + 1, im.shape), 0, 255).astype(np.uint8)
    return im


def whole_cos(x, y):
    a, b = ap.kit_histogram(x).astype(float), ap.kit_histogram(y).astype(float)
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def main() -> int:
    # Two same-kit players, several crops each (noise = another frame of the same player).
    a_crops = [person((60, 40, 25), WHITE, (20, 20, 25), (230, 230, 230), noise=6, seed=s) for s in range(5)]
    b_crops = [person((210, 180, 90), WHITE, (20, 20, 25), (180, 40, 40), noise=6, seed=100 + s) for s in range(5)]
    a_parts = [ap.part_colour_vectors(c) for c in a_crops]
    b_parts = [ap.part_colour_vectors(c) for c in b_crops]
    whole_same = [whole_cos(a_crops[0], c) for c in a_crops[1:]]
    whole_diff = [whole_cos(a_crops[0], c) for c in b_crops]
    part_same = [ap.part_similarity(a_parts[0], p) for p in a_parts[1:]]
    part_diff = [ap.part_similarity(a_parts[0], p) for p in b_parts]
    print("same-kit players, identical white torsos, different hair + socks (5 crops each):")
    print(f"  whole-crop kit cosine  same person {np.mean(whole_same):.3f}  different person {np.mean(whole_diff):.3f}  margin {np.mean(whole_same) - np.mean(whole_diff):+.3f}")
    print(f"  part-based similarity  same person {np.mean(part_same):.3f}  different person {np.mean(part_diff):.3f}  margin {np.mean(part_same) - np.mean(part_diff):+.3f}")
    print(f"  torso Lab distance A vs B: {float(np.linalg.norm(ap.jersey_lab(a_crops[0]) - ap.jersey_lab(b_crops[0]))):.2f} (0 = identical shirts)")
    clean = a_crops[0]
    recol = clean.copy()
    recol[66:120][ap._grass_mask(recol[66:120])] = (40, 90, 40)
    speck = clean.copy()
    speck[93:120:2, ::2] = GRASS
    print("  grass: recolour-only legs cosine "
          f"{float(ap.part_colour_vectors(clean)['legs'] @ ap.part_colour_vectors(recol)['legs']):.4f}, "
          f"speckled-over-socks {float(ap.part_colour_vectors(clean)['legs'] @ ap.part_colour_vectors(speck)['legs']):.3f}")
    e = lambda v: np.array(v, np.float32) / np.linalg.norm(v)
    hist = np.zeros(24, np.float32)
    hist[2] = 1.0
    mk = lambda n, t0, t1, emb, parts: ap.TrackAppearance(n, 0, t0, t1, 6, hist, np.zeros(3), e(emb), 0.9, group=0, part_colours=parts)
    a = mk(1, 0, 1_000_000, [1, 0, 0], a_parts[0])
    b = mk(2, 3_000_000, 4_000_000, [0.98, 0.2, 0], b_parts[0])
    c = mk(3, 3_500_000, 5_000_000, [0.7, 0.7, 0], a_parts[1])
    plain = {(x["a"], x["b"]) for x in ap.propose_links([a, b, c])}
    parted = {(x["a"], x["b"]) for x in ap.propose_links([a, b, c], use_parts=True)}
    print(f"  propose_links: whole-crop -> {sorted(plain)} (wrong player), part-based -> {sorted(parted)} (right player)")
    print("ground-truth files (no crops, no video — Re-ID unmeasurable on them):")
    for f in sorted(GT_DIR.glob("*.json")):
        gt = load_ground_truth(f)
        boxes = [b for v in gt.by_pts.values() for b in v]
        ids = {b.player_ref for b in boxes if b.player_ref}
        print(f"  {f.name}: {len(gt.by_pts)} frames, {len(boxes)} boxes, {len(ids)} named ids, 0 crops")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
