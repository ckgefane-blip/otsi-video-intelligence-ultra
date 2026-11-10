"""Appearance of tracks and same-person link suggestions (Block 07, ADR-031). Evidence for a person to review, never an identity.

  crops      while tracking, each track keeps up to MAX_CROPS evenly spread crops of its own detections (CropReservoir), so no second
             decoding pass is needed; tentative tracks that never confirm are dropped with their crops
  kit group  the colour of the shirt (CIE Lab of the centre of the torso, grass and skin pixels removed, median over the track's crops)
             learned from this run's own PERSON tracks: group 0 and 1 are the two team colours (0 = the lighter one), group 2 is the vivid
             "officials" colour (referee, linesmen; a goalkeeper in a vivid kit lands here too); tracks far from all three (other footage,
             a third kit, staff) stay NULL = no group. A group is a colour, not a team (the owner assigns the club); unknown beats wrong
  embedding  DINOv2-small (default) on the crops, mean of L2-normalised vectors (vie_worker.embed)
  drift      cosine of the first-half and last-half embeddings of a track (at least DRIFT_MIN_CROPS crops, 3+ per half): low = the tracker
             may have switched people inside it. Calibration (tools/models/appearance_calibration.py, 3 real clips): same-person halves with
             3 crops each have a 5th-percentile cosine of 0.70, with 1 crop 0.35 (too noisy) -> warning below DRIFT_WARNING = 0.60
  links      for every pair (earlier a, later b) that never overlap in time, are in the same kit group (or either has none) and are at most
             MAX_GAP_S apart: score = 0.75 * appearance + 0.25 * kit similarity. Calibration showed an absolute threshold alone is weak (at
             0.70, 93 % of same-person pairs pass but so do 50 % of different-person pairs in similar kits), ranking is what works
             (rank-1 50-91 %, ADR-031): a link is kept only if b is a's BEST later candidate AND a is b's BEST earlier candidate (mutual best)
             and the score is >= MIN_SCORE. At most one suggestion per direction per track. Scores rank; they are not probabilities.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field

import numpy as np

MAX_CROPS = 8
MIN_CROPS = 3
MAX_GAP_S = 120.0
MIN_SCORE = 0.70
DRIFT_MIN_CROPS = 6
DRIFT_WARNING = 0.60


def kit_histogram(crop: np.ndarray) -> np.ndarray:
    """Torso colour (upper-middle of the crop): 16 hue bins for coloured pixels + 8 brightness bins for grey/white/black ones."""
    h, w = crop.shape[:2]
    t = crop[int(0.15 * h):max(int(0.15 * h) + 1, int(0.55 * h)), int(0.2 * w):max(int(0.2 * w) + 1, int(0.8 * w))].astype(np.float32) / 255
    if t.size == 0:
        return np.zeros(24, np.float32)
    r, g, b = t[..., 0], t[..., 1], t[..., 2]
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b)
    d = mx - mn + 1e-6
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
    sat = np.where(mx > 0, d / (mx + 1e-6), 0)
    chroma = sat > 0.25
    hist = np.zeros(24, np.float32)
    np.add.at(hist, np.minimum((hue[chroma] * 16).astype(int), 15), 1)
    np.add.at(hist, 16 + np.minimum((mx[~chroma] * 8).astype(int), 7), 1)
    return hist / max(1.0, hist.sum())


def torso_rgb(crop: np.ndarray) -> np.ndarray:
    h, w = crop.shape[:2]
    t = crop[int(0.15 * h):max(int(0.15 * h) + 1, int(0.55 * h)), int(0.2 * w):max(int(0.2 * w) + 1, int(0.8 * w))]
    return np.median(t.reshape(-1, 3), axis=0) if t.size else np.zeros(3)


@dataclass
class CropReservoir:
    """Evenly spaced crops of one track: keep every `stride`-th observation; when full, drop every other one and double the stride."""
    crops: list = field(default_factory=list)          # (pts_us, crop rgb uint8)
    stride: int = 1
    seen: int = 0
    largest: tuple | None = None                       # (area, crop) for the thumbnail

    def offer(self, pts_us: int, rgb: np.ndarray, box: tuple[float, float, float, float]) -> None:
        h, w = rgb.shape[:2]
        x, y, bw, bh = box
        x0, y0 = max(0, int((x - 0.08 * bw) * w)), max(0, int((y - 0.05 * bh) * h))
        x1, y1 = min(w, int((x + bw * 1.08) * w)), min(h, int((y + bh * 1.05) * h))
        if x1 - x0 < 4 or y1 - y0 < 8:
            return
        area = (x1 - x0) * (y1 - y0)
        if self.largest is None or area > self.largest[0]:
            self.largest = (area, rgb[y0:y1, x0:x1].copy())
        if self.seen % self.stride == 0:
            c = rgb[y0:y1, x0:x1]
            if c.shape[0] > 160:                       # bounded memory: 160 px height is plenty for a 224 px embedding input
                f = 160 / c.shape[0]
                from PIL import Image
                c = np.asarray(Image.fromarray(c).resize((max(4, int(c.shape[1] * f)), 160), Image.BILINEAR))
            self.crops.append((pts_us, c.copy()))
            if len(self.crops) > MAX_CROPS:
                self.crops = self.crops[::2]
                self.stride *= 2
        self.seen += 1


def _hellinger(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(max(0.0, 1 - np.sum(np.sqrt(np.clip(a, 0, None) * np.clip(b, 0, None))))))


def kit_groups(hists: dict[int, np.ndarray], seed: int = 7) -> dict[int, int | None]:
    """Two colour clusters (k-means on sqrt-histograms = Hellinger geometry); tracks far from both clusters get no group."""
    keys = list(hists)
    if len(keys) < 4:
        return {k: None for k in keys}
    x = np.sqrt(np.stack([hists[k] for k in keys]))
    rng = np.random.default_rng(seed)
    best = None
    for _ in range(24):                                 # k-means++ seeding (random, weighted by squared distance), keep the tightest result:
        c = [x[rng.integers(len(x))]]                   # a deterministic farthest-point start would pick a lone referee as a centre
        d = ((x - c[0]) ** 2).sum(1)
        c.append(x[rng.choice(len(x), p=d / d.sum())] if d.sum() > 0 else x[rng.integers(len(x))])
        c = np.stack(c)
        for _ in range(30):
            lab = np.argmin(((x[:, None, :] - c[None]) ** 2).sum(2), axis=1)
            new = np.stack([x[lab == j].mean(0) if np.any(lab == j) else c[j] for j in range(2)])
            if np.allclose(new, c):
                break
            c = new
        inertia = float(((x - c[lab]) ** 2).sum())
        if best is None or inertia < best[0]:
            best = (inertia, lab, c)
    _, lab, c = best
    dist = np.sqrt(((x - c[lab]) ** 2).sum(1))
    out = {}
    for j in range(2):
        dj = dist[lab == j]
        if len(dj) == 0:
            continue
        limit = np.median(dj) + 2.5 * (np.percentile(dj, 75) - np.percentile(dj, 25) + 1e-3)
        for k, dd, ll in zip(keys, dist, lab):
            if ll == j:
                out[k] = int(ll) if dd <= limit else None
    # order groups by size so group 0 is the larger colour cluster (stable display)
    sizes = {g: sum(1 for v in out.values() if v == g) for g in (0, 1)}
    if sizes.get(1, 0) > sizes.get(0, 0):
        out = {k: (None if v is None else 1 - v) for k, v in out.items()}
    return out


def _lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB 0..1 (..., 3) -> CIE Lab, D65."""
    c = np.where(rgb > 0.04045, ((rgb + 0.055) / 1.055) ** 2.4, rgb / 12.92)
    xyz = c @ np.array([[.4124, .2126, .0193], [.3576, .7152, .1192], [.1805, .0722, .9505]]) / np.array([.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def jersey_lab(crop: np.ndarray) -> np.ndarray | None:
    """The colour of the shirt in one crop: median CIE Lab of the centre of the torso, without grass-green and skin-tone pixels.
    None when the crop is too small to read."""
    h, w = crop.shape[:2]
    if h < 20 or w < 8:
        return None
    t = crop[int(0.2 * h):max(int(0.2 * h) + 1, int(0.5 * h)), int(0.3 * w):max(int(0.3 * w) + 1, int(0.7 * w))].reshape(-1, 3).astype(np.float32) / 255
    if len(t) < 12:
        return None
    mx, mn = t.max(1), t.min(1)
    d = mx - mn + 1e-6
    sat = np.where(mx > 0, d / (mx + 1e-6), 0)
    hue = np.where(mx == t[:, 0], ((t[:, 1] - t[:, 2]) / d) % 6, np.where(mx == t[:, 1], (t[:, 2] - t[:, 0]) / d + 2, (t[:, 0] - t[:, 1]) / d + 4)) / 6
    vivid = (mx > 0.7) & (sat > 0.45)                         # a bright lime / yellow shirt is yellow-green too, but grass is never this bright and saturated
    keep = ~((((hue > 0.17) & (hue < 0.47) & (sat > 0.2)) & ~vivid) | ((hue < 0.1) & (sat > 0.2) & (sat < 0.65) & (mx > 0.35)))
    if keep.sum() < 10:
        keep[:] = True
    return np.median(_lab(t[keep]), axis=0)


# The officials (referee, linesmen) are found in every match the same way, whatever they wear (owner directive 2026-10-31: no jersey colour is assumed):
# the people split into colour groups; besides the two teams, a SMALL group of ONE colour, clearly unlike both teams, is the officials.
OFFICIAL_MIN, OFFICIAL_MAX_SHARE = 2, 0.25    # the officials' group: at least 2 readings, at most a quarter of all readable people
OFFICIAL_MAX_SPREAD = 18.0     # one colour: its readings lie this close to their median (goalkeepers in two different kits do not)
OFFICIAL_MIN_APART = 20.0      # and at least this far (and 0.6 x the teams' own separation) from both team colours
OFFICIAL_HUE_TOL = 30.0       # degrees: a washed-out official (far, hazy) keeps the hue the officials were taught in at kickoff


def _kmeans(x: np.ndarray, k: int, seed: int = 5, restarts: int = 24) -> tuple[np.ndarray, np.ndarray]:
    """k-means with k-means++ starts and restarts; returns (assignment, centres)."""
    rng = np.random.default_rng(seed)
    best = None
    for _ in range(restarts):
        c = [x[rng.integers(len(x))]]
        for _ in range(1, k):
            d = ((x[:, None, :] - np.stack(c)[None]) ** 2).sum(2).min(1)
            c.append(x[rng.choice(len(x), p=d / d.sum())] if d.sum() > 0 else x[rng.integers(len(x))])
        c = np.stack(c)
        for _ in range(40):
            asg = np.argmin(((x[:, None, :] - c[None]) ** 2).sum(2), axis=1)
            new = np.stack([x[asg == j].mean(0) if np.any(asg == j) else c[j] for j in range(k)])
            if np.allclose(new, c):
                break
            c = new
        inertia = float(((x - c[asg]) ** 2).sum())
        if best is None or inertia < best[0]:
            best = (inertia, asg, c)
    return best[1], best[2]


def find_officials(x: np.ndarray) -> np.ndarray:
    """Which readings are the officials' (bool mask; all False when none qualify). `x`: shirt colours, already weighted. No colour is assumed:
    1. the two team colours are measured first (two colour groups; a few officials hardly move a team's median);
    2. a reading is a candidate only when it is far from BOTH team colours (OFFICIAL_MIN_APART, and 0.6 x the teams' own separation). A white shirt in shade
       is a darker copy of its team, near it, so the light never makes a team look like a third group (at the owner's 24:45 the shaded white players and the
       darkest black ones were taken for officials by a grouping rule, 2026-10-31);
    3. the officials are the candidates that share ONE colour: the reading with most candidates within OFFICIAL_MAX_SPREAD x 1.5, and those. At least
       OFFICIAL_MIN, at most OFFICIAL_MAX_SHARE of everyone. Two goalkeepers in two different kits share no colour and are not the officials."""
    none = np.zeros(len(x), bool)
    if len(x) < 2 * TEAM_MIN_PLAYERS + OFFICIAL_MIN:
        return none
    asg, _ = _kmeans(x, 2)
    if min((asg == 0).sum(), (asg == 1).sum()) <= max(TEAM_MIN_PLAYERS - 1, OFFICIAL_MAX_SHARE * len(x)):
        # one of the two groups is too small to be a team: very distinct officials split off first. Three groups; the two largest are the teams
        asg, _ = _kmeans(x, 3)
        big = sorted(range(3), key=lambda j: -int((asg == j).sum()))[:2]
        asg = np.where(asg == big[0], 0, np.where(asg == big[1], 1, -1))
    if min((asg == 0).sum(), (asg == 1).sum()) < TEAM_MIN_PLAYERS:
        return none
    teams = np.stack([np.median(x[asg == t], axis=0) for t in range(2)])
    need = max(OFFICIAL_MIN_APART, 0.6 * float(np.linalg.norm(teams[0] - teams[1])))
    far = np.sqrt(((x[:, None, :] - teams[None]) ** 2).sum(2)).min(1) >= need
    idx = np.where(far)[0]
    if len(idx) < OFFICIAL_MIN:
        return none
    xo = x[idx]
    near = np.sqrt(((xo[:, None, :] - xo[None]) ** 2).sum(2)) <= 1.5 * OFFICIAL_MAX_SPREAD
    core = int(np.argmax(near.sum(1)))
    group = idx[near[core]]
    if not (OFFICIAL_MIN <= len(group) <= OFFICIAL_MAX_SHARE * len(x)):
        return none
    out = none.copy()
    out[group] = True
    return out


def team_groups(jerseys: dict[int, np.ndarray], seed: int = 5) -> dict[int, int | None]:
    """Group per track from its shirt colour. 2 = officials (find_officials: a small group of one colour unlike both teams, whatever it is); of the rest,
    k-means (2 clusters, k-means++ restarts) gives the two team colours, 0 = the lighter; a track far from its cluster (other footage, a third kit) gets None."""
    keys = list(jerseys)
    out: dict[int, int | None] = {k: None for k in keys}
    if len(keys) < 6:
        return out
    lab = np.stack([jerseys[k] for k in keys])
    official = find_officials(lab * np.array([1.0, 1.3, 1.3]))
    for k, o in zip(keys, official):
        if o:
            out[k] = 2
    idx = np.where(~official)[0]
    if len(idx) < 6:
        return out
    x = lab[idx] * np.array([1.0, 1.3, 1.3])        # colour counts a little more than lightness (sun and shadow move lightness)
    rng = np.random.default_rng(seed)
    best = None
    for _ in range(24):
        c = [x[rng.integers(len(x))]]
        d = ((x - c[0]) ** 2).sum(1)
        c.append(x[rng.choice(len(x), p=d / d.sum())] if d.sum() > 0 else x[rng.integers(len(x))])
        c = np.stack(c)
        for _ in range(40):
            asg = np.argmin(((x[:, None, :] - c[None]) ** 2).sum(2), axis=1)
            new = np.stack([x[asg == j].mean(0) if np.any(asg == j) else c[j] for j in range(2)])
            if np.allclose(new, c):
                break
            c = new
        inertia = float(((x - c[asg]) ** 2).sum())
        if best is None or inertia < best[0]:
            best = (inertia, asg, c)
    _, asg, c = best
    dist = np.sqrt(((x - c[asg]) ** 2).sum(1))
    light_first = 0 if c[0, 0] >= c[1, 0] else 1      # the cluster with the higher lightness is group 0
    for j in range(2):
        m = asg == j
        if not m.any():
            continue
        lim = np.percentile(dist[m], 75) + 3.0 * (np.percentile(dist[m], 75) - np.percentile(dist[m], 25) + 1e-3)
        for i, dd, a in zip(idx[m], dist[m], [j] * int(m.sum())):
            if dd <= lim:
                out[keys[i]] = 0 if j == light_first else 1
    return out


@dataclass
class TrackAppearance:
    number: int
    shot: int
    first_us: int
    last_us: int
    crop_count: int
    kit: np.ndarray
    rgb: np.ndarray
    embedding: np.ndarray | None
    drift: float | None
    group: int | None = None
    jersey: np.ndarray | None = None
    thumbnail_jpeg: bytes | None = None


def describe(tracks, reservoirs: dict, embedder) -> list[TrackAppearance]:
    """tracks: the run's confirmed tracks (vie_worker.tracker.Track); reservoirs: id(track) -> CropReservoir."""
    from PIL import Image
    out: list[TrackAppearance] = []
    batch, owners = [], []
    for t in tracks:
        if t.label != "PERSON":
            continue
        res = reservoirs.get(id(t))
        crops = [c for _, c in res.crops] if res else []
        if len(crops) < MIN_CROPS:
            continue
        kit = np.mean([kit_histogram(c) for c in crops], axis=0)
        rgb = np.median([torso_rgb(c) for c in crops], axis=0)
        js = [j for j in (jersey_lab(c) for c in crops) if j is not None]
        jersey = np.median(js, axis=0) if js else None
        thumb = None
        if res.largest is not None:
            im = Image.fromarray(res.largest[1])
            im.thumbnail((160, 240))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=85)
            thumb = buf.getvalue()
        out.append(TrackAppearance(t.number, t.shot_number, t.observations[0].pts_us, t.observations[-1].pts_us, len(crops), kit, rgb, None, None,
                                   thumbnail_jpeg=thumb, jersey=jersey))
        batch.extend(crops)
        owners.append((len(out) - 1, len(crops)))
    if embedder is not None and batch:
        vecs = embedder(batch)
        i = 0
        for k, n in owners:
            v = vecs[i:i + n]
            i += n
            m = v.mean(0)
            out[k].embedding = (m / (np.linalg.norm(m) + 1e-9)).astype(np.float32)
            if n >= DRIFT_MIN_CROPS:
                half = min(4, n // 2)
                a, b = v[:half].mean(0), v[-half:].mean(0)
                out[k].drift = float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
    groups = team_groups({a.number: a.jersey for a in out if a.jersey is not None})
    for a in out:
        a.group = groups.get(a.number)
    return out


def propose_links(apps: list[TrackAppearance]) -> list[dict]:
    """Same-person suggestions between non-overlapping tracks (see module doc)."""
    import bisect
    cand = []
    if not any(a.embedding is not None for a in apps):                      # no person seen (or none with a picture): nothing to link
        return cand
    by_time = sorted(apps, key=lambda a: a.first_us)
    starts = [a.first_us for a in by_time]
    has = np.array([a.embedding is not None for a in by_time])
    dim = next((len(a.embedding) for a in by_time if a.embedding is not None), 1)
    E = np.stack([a.embedding if a.embedding is not None else np.zeros(dim, np.float32) for a in by_time]).astype(np.float64)
    R = np.sqrt(np.clip(np.stack([a.kit for a in by_time]).astype(np.float64), 0, None))
    for a, ea, ra in zip(by_time, E, R):
        if a.embedding is None:
            continue
        # only the tracks that start after this one ends, within MAX_GAP_S (the list is in start order: a slice, not every track), all at once
        lo, hi = bisect.bisect_right(starts, a.last_us), bisect.bisect_right(starts, a.last_us + MAX_GAP_S * 1e6)
        if lo >= hi:
            continue
        idx = np.arange(lo, hi)[has[lo:hi]]
        if a.group is not None:
            idx = np.array([j for j in idx if by_time[j].group is None or by_time[j].group == a.group], dtype=int)
        if not len(idx):
            continue
        app_sim = E[idx] @ ea
        kit_sim = 1 - np.sqrt(np.clip(1 - R[idx] @ ra, 0, None))
        score = 0.75 * np.maximum(0.0, app_sim) + 0.25 * kit_sim
        for j, sc, ap_, ks in zip(idx, score, app_sim, kit_sim):
            if sc < MIN_SCORE:
                continue
            b = by_time[j]
            cand.append({"a": a.number, "b": b.number, "score": round(min(1.0, float(sc)), 4), "gap_us": int(b.first_us - a.last_us), "crosses_cut": a.shot != b.shot,
                         "evidence": {"appearance_cosine": round(float(ap_), 4), "kit_similarity": round(float(ks), 4), "kit_group_a": a.group,
                                      "kit_group_b": b.group}})
    best_after: dict[int, tuple[float, int]] = {}      # a -> its best later candidate
    best_before: dict[int, tuple[float, int]] = {}     # b -> its best earlier candidate
    for c in cand:
        if c["score"] > best_after.get(c["a"], (-1, 0))[0]:
            best_after[c["a"]] = (c["score"], c["b"])
        if c["score"] > best_before.get(c["b"], (-1, 0))[0]:
            best_before[c["b"]] = (c["score"], c["a"])
    return [c for c in cand if best_after[c["a"]][1] == c["b"] and best_before[c["b"]][1] == c["a"]]


def neighbours(apps: list[TrackAppearance], k: int = 5, block: int = 1024) -> list[dict]:
    """For every person track with an embedding: its k most similar tracks among those that NEVER overlap it in time (two tracks seen at the
    same moment are different people). The look-alike graph behind identity suggestions; similarity is evidence, not proof.
    Computed a block of tracks at a time as matrix products: pair by pair in Python it grew with the square of the tracks and took over an
    hour on a full match after the shadow fix kept more players (2026-10-31); same result."""
    emb = [a for a in apps if a.embedding is not None]
    if len(emb) < 2:
        return []
    E = np.stack([a.embedding for a in emb]).astype(np.float64)
    R = np.sqrt(np.clip(np.stack([a.kit for a in emb]).astype(np.float64), 0, None))        # Hellinger: 1 - BC, BC = sum sqrt(p q)
    first, last = np.array([a.first_us for a in emb]), np.array([a.last_us for a in emb])
    nums = np.array([a.number for a in emb])
    out = []
    for lo in range(0, len(emb), block):
        hi = min(len(emb), lo + block)
        cos = E[lo:hi] @ E.T
        kit = 1 - np.sqrt(np.clip(1 - R[lo:hi] @ R.T, 0, None))
        overlap = (first[None, :] <= last[lo:hi, None]) & (first[lo:hi, None] <= last[None, :])
        overlap[np.arange(hi - lo), np.arange(lo, hi)] = True                    # not itself
        key = np.where(overlap, -np.inf, cos)
        for r in range(hi - lo):
            ok = np.flatnonzero(~overlap[r])
            if not len(ok):
                continue
            top = ok[np.lexsort((-nums[ok], -kit[r, ok], -key[r, ok]))[:k]]         # as sorted((cos, kit, number), reverse=True)
            for rank, c in enumerate(top, 1):
                out.append({"a": emb[lo + r].number, "b": int(nums[c]), "cosine": round(max(-1.0, min(1.0, float(cos[r, c]))), 4),
                            "kit_similarity": round(max(0.0, min(1.0, float(kit[r, c]))), 4), "rank": rank})
    return out


SPLIT_DISTANCE = 30.0          # Lab distance between the two halves of a track's shirt colour that means two different people


def _split_point(pts: list[int], labs: list[np.ndarray]) -> int | None:
    """Index k (crops [:k] vs [k:]) where a track's shirt colour first changes from one steady colour to another, else None. Only the
    colour before the change and the next two crops after it must each be steady and far apart: the rest of the track may change again
    (white -> dark -> white), and the caller re-checks each piece, so a track swapped twice is cut twice instead of never. A single odd
    crop (shadow, a teammate passing in front) never splits a track: with only one odd crop the next two crops are mixed, so neither
    side is steady."""
    n = len(labs)
    best = None
    for k in range(2, n - 1):
        a, b = np.median(labs[:k], axis=0), np.median(labs[k:k + 2], axis=0)
        gap = float(np.linalg.norm(a - b))
        if gap < SPLIT_DISTANCE:
            continue
        spread = max(float(np.max([np.linalg.norm(x - a) for x in labs[:k]])),
                     float(np.max([np.linalg.norm(x - b) for x in labs[k:k + 2]])))
        if spread < gap * 0.6 and (best is None or gap > best[0]):
            best = (gap, k)
    return best[1] if best else None


def split_on_shirt_change(tracks, reservoirs: dict, new_number) -> list:
    """The tracker sometimes follows one person and then, after a crossing, a person in a different shirt under the same number. A track whose
    shirt colour clearly changes from one steady colour to another is cut where it changes, into one track per steady-colour run (each with
    its own crops), so a track is one shirt and a box keeps one team colour — including a track that changes and then changes back. A
    same-kit swap (white to white) cannot be split by shirt colour at all; that is a U.5 job, not this one. `new_number()` gives the next
    free track number. Returns the new list of tracks."""
    from .tracker import Track
    out, queue = [], list(tracks)
    while queue:
        t = queue.pop(0)
        res = reservoirs.get(id(t)) if t.label == "PERSON" else None
        if res is None or len(res.crops) < 5:
            out.append(t)
            continue
        scored = [(p, jersey_lab(c)) for p, c in res.crops]
        scored = [(p, j) for p, j in scored if j is not None]
        k = _split_point([p for p, _ in scored], [j for _, j in scored]) if len(scored) >= 5 else None
        if k is None:
            out.append(t)
            continue
        cut = (scored[k - 1][0] + scored[k][0]) // 2
        first = [o for o in t.observations if o.pts_us < cut]
        second = [o for o in t.observations if o.pts_us >= cut]
        if len(first) < 2 or len(second) < 2:
            out.append(t)
            continue
        keep_pts = {p for p, _ in scored}
        crops_a = [(p, c) for p, c in res.crops if p < cut]
        crops_b = [(p, c) for p, c in res.crops if p >= cut]
        if len(crops_a) < 2 or len(crops_b) < 2 or not keep_pts:
            out.append(t)
            continue
        t.observations = first
        t.hits, t.last_pts_us = len(first), first[-1].pts_us
        u = Track(number=new_number(), label=t.label, shot_number=t.shot_number, observations=second, hits=len(second), misses=0,
                  last_pts_us=second[-1].pts_us, confirmed=t.confirmed, feat=t.feat)
        for part, crops in ((t, crops_a), (u, crops_b)):
            r = CropReservoir(crops=crops, stride=res.stride, seen=len(crops))
            r.largest = max(((c.shape[0] * c.shape[1], c) for _, c in crops), key=lambda z: z[0])
            reservoirs[id(part)] = r
        queue.extend([t, u])               # a track can have been swapped more than once
    return out


# ------------------------------------------------------------------ teams taught from the kickoff
TEAM_MAX_ASPECT = 0.48           # an upright player's box is 0.30-0.45 wide for its height; wider than this he is bent over, diving or lying
TEAM_MIN_PX = 28                 # a person's shirt is read only when his box is at least this tall in the analysed frame: a smaller one is mostly grass
TEAM_MIN_PLAYERS = 4             # each team needs at least this many readable players at the moment taught
TEAM_MIN_SEPARATION = 25.0       # the two team colours must be at least this far apart in Lab
TEAM_MIN_SIDE_GAP = 0.10         # and the two teams' mean horizontal positions at least this far apart (fraction of the frame): separate halves


def _ground_at_torso(rgb: np.ndarray, d, boxes, ty0: int, ty1: int) -> np.ndarray | None:
    """The ground colour (RGB pixels) at the height of this player's shirt: the same rows, up to 3 box widths to each side, with every person's box left out
    (`boxes`: (x, y, w, h) normalised, all the people in the frame). The ground at his feet can be in shadow while his shirt is in sun, so the shirt is compared with
    the ground beside it, not below it."""
    h, w = rgb.shape[:2]
    bw = d.w * w
    lo, hi = max(0, int(d.x * w - 3 * bw)), min(w, int((d.x + d.w) * w + 3 * bw))
    if hi - lo < 8 or ty1 <= ty0:
        return None
    keep = np.ones(hi - lo, bool)
    for (bx, by, bwid, bh) in boxes or []:
        if by * h > ty1 or (by + bh) * h < ty0:
            continue
        a, b = int(bx * w - 0.25 * bwid * w) - lo, int((bx + bwid) * w + 0.25 * bwid * w) - lo
        keep[max(0, a):max(0, b)] = False
    keep[max(0, int(d.x * w - 0.25 * bw) - lo):max(0, int((d.x + d.w) * w + 0.25 * bw) - lo)] = False        # and himself
    if keep.sum() < 6:
        return None
    band = rgb[max(0, ty0):min(h, ty1), lo:hi][:, keep]
    return band.reshape(-1, 3) if band.size >= 24 else None


def detection_pixels(rgb: np.ndarray, d, boxes=None) -> np.ndarray | None:
    """The shirt pixels of one detected person in one frame, each as (L', a, b, L): the fourth is the shirt's own lightness. Neither lightness is enough alone: the
    relative one (below) is robust to sun and shade but a white shirt on sunlit grass is hardly brighter than the grass; the absolute one separates that case but
    not a white shirt in shade from a black one in sun. Together they separate both.
    The first three are (L', a, b): CIE Lab with the lightness taken RELATIVE TO THE GROUND at his feet (L' = L of the
    shirt - L of the ground + 50). A white shirt in deep shade is as dark as a black shirt in the sun, but it is always brighter than the grass beside it and a black
    shirt always darker: sun and shade move the shirt and the ground together, so the difference is what stays. None when it cannot be read: the box is too small,
    or after taking away skin and every pixel that looks like the ground there is too little shirt left. (The ground is measured just below his feet, where no one
    stands, and beside him.)"""
    h, w = rgb.shape[:2]
    if d.h * h < TEAM_MIN_PX or d.w * w > TEAM_MAX_ASPECT * d.h * h:
        return None                                   # too small, or not upright (bent over, diving, on the ground): the "shirt" area would be head, arms and back
    x0, bw = d.x * w, d.w * w
    ty0, ty1 = int((d.y + 0.22 * d.h) * h), int((d.y + 0.50 * d.h) * h) + 1
    tx0, tx1 = int((d.x + 0.20 * d.w) * w), int((d.x + 0.80 * d.w) * w) + 1
    ty0, tx0 = max(0, ty0), max(0, tx0)
    torso = rgb[ty0:min(h, ty1), tx0:min(w, tx1)]
    if torso.shape[0] < 4 or torso.shape[1] < 3:
        return None
    feet = int((d.y + d.h) * h)
    below = rgb[min(h - 1, feet + 2):min(h, feet + 2 + max(4, int(0.12 * d.h * h))), max(0, int(x0 - 0.3 * bw)):min(w, int(x0 + 1.3 * bw))]
    m = max(3, int(0.6 * bw))
    sides = [rgb[ty0:min(h, ty1), max(0, int(x0) - m - 2):max(0, int(x0) - 2)], rgb[ty0:min(h, ty1), min(w, int(x0 + bw) + 2):min(w, int(x0 + bw) + 2 + m)]]
    ground = _ground_at_torso(rgb, d, boxes, ty0, min(h, ty1))
    if ground is None:
        ground = below.reshape(-1, 3) if below.size >= 24 else (np.concatenate([q.reshape(-1, 3) for q in sides if q.size]) if any(q.size for q in sides) else np.zeros((0, 3), np.uint8))
    t = torso.reshape(-1, 3).astype(np.float32) / 255
    mx, mn = t.max(1), t.min(1)
    dd = mx - mn + 1e-6
    sat = np.where(mx > 0, dd / (mx + 1e-6), 0)
    hue = np.where(mx == t[:, 0], ((t[:, 1] - t[:, 2]) / dd) % 6, np.where(mx == t[:, 1], (t[:, 2] - t[:, 0]) / dd + 2, (t[:, 0] - t[:, 1]) / dd + 4)) / 6
    skin = (hue < 0.1) & (sat > 0.2) & (sat < 0.65) & (mx > 0.35)
    lab = _lab(t)
    if len(ground) >= 8:
        g_lab = np.median(_lab(ground.astype(np.float32) / 255), axis=0)
        keep = ~skin & (np.sqrt(((lab - g_lab[None]) ** 2).sum(1)) >= 10.0)          # whatever looks like the ground there is not shirt (a lime shirt in shade is kept)
    else:                                                                                # no ground to compare with: the fixed rules
        g_lab = None
        vivid = (mx > 0.7) & (sat > 0.45)
        keep = ~((((hue > 0.17) & (hue < 0.47) & (sat > 0.2)) & ~vivid) | skin)
    if keep.sum() < 8:
        return None
    pix = np.concatenate([lab[keep], lab[keep][:, :1]], axis=1)          # columns: L' (relative to the ground), a, b, and the shirt's own L
    if g_lab is not None:
        pix[:, 0] = np.clip(pix[:, 0] - g_lab[0] + 50.0, 0.0, 100.0)
    return pix


def detection_lab(rgb: np.ndarray, d, boxes=None) -> np.ndarray | None:
    """One colour for the shirt: the median of its pixels (see `detection_pixels`)."""
    pix = detection_pixels(rgb, d, boxes)
    return None if pix is None else np.median(pix, axis=0)


@dataclass
class TeamReference:
    """The two team shirt colours (Lab; team 0 = the lighter), taught from one moment where the teams stand on separate halves."""
    labs: np.ndarray                       # (2, 3)
    official: np.ndarray | None = None     # the officials' shirt colour as seen at the kickoff (referee and linesmen wear one colour), or None

    def classify_detection(self, rgb: np.ndarray, d, boxes=None) -> int | None:
        """The call for one detection from ALL its shirt pixels, not their average: each pixel goes to the nearest team colour (or the officials' colour), and the
        shirt is whichever has most of the pixels that could be told. A black shirt with a white stripe is mostly black pixels; a white shirt with dark trim mostly white."""
        pix = detection_pixels(rgb, d, boxes)
        if pix is None:
            return None
        med = np.median(pix, axis=0)
        k = self.labs.shape[1]
        pix = pix[:, :k]
        d2 = np.sqrt(((pix[:, None, :] - self.labs[None]) ** 2).sum(2))              # (n, 2)
        sep = float(np.linalg.norm(self.labs[0] - self.labs[1]))
        if self.official is not None:
            chroma = np.hypot(pix[:, 1], pix[:, 2])
            d_off = np.linalg.norm(pix[:, :3] - self.official[None, :3], axis=1)
            d_team = np.sqrt(((pix[:, None, :3] - self.labs[None, :, :3]) ** 2).sum(2)).min(1)
            off = (d_off <= 28.0) & (d_off < d_team)                                         # nearest of the three colours: the officials' (any colour, black too)
            # or the officials' HUE: distance and haze wash a shirt out but keep its hue. Taught at 23:20 the officials were a strong lime (chroma 42);
            # the far linesman at 24:55 read as pale lime (chroma 17-20, colour distance 31-34) and fell to the white team, whose slight tint points
            # the other way (blue). A pixel counts when its hue is within OFFICIAL_HUE_TOL of the officials' and clearly nearer it than any coloured
            # team's hue (a team kit of nearly the officials' hue never matches this way)
            hue = np.degrees(np.arctan2(pix[:, 2], pix[:, 1]))
            dh_off = np.abs((hue - np.degrees(np.arctan2(self.official[2], self.official[1])) + 180) % 360 - 180)
            dh_team = np.full(len(pix), 180.0)
            for t in self.labs:
                if np.hypot(t[1], t[2]) >= 12.0:                                                 # a coloured kit; a white or black kit has no hue to compare
                    dh_team = np.minimum(dh_team, np.abs((hue - np.degrees(np.arctan2(t[2], t[1])) + 180) % 360 - 180))
            off |= (chroma >= 15.0) & (dh_off <= OFFICIAL_HUE_TOL) & (dh_off + 20.0 < dh_team)
            if off.mean() >= 0.5 or (off.mean() >= 0.3 and np.hypot(med[1], med[2]) >= 12.0):       # a plain (black, white, grey) official needs most of his pixels
                return 2
        near = d2.argmin(1)
        margin = np.abs(d2[:, 0] - d2[:, 1])
        sure = (margin >= 0.15 * sep) & (d2.min(1) <= 1.2 * sep)
        if sure.sum() < 6:
            return None
        share = np.array([(near[sure] == 0).mean(), (near[sure] == 1).mean()])
        k = int(np.argmax(share))
        return k if share[k] >= 0.58 else None

    def classify(self, lab: np.ndarray | None) -> int | None:
        """0 / 1 = a team, 2 = officials, None = not sure. Not sure unless the colour is clearly nearer one team than the other AND close to it."""
        if lab is None:
            return None
        d = np.sqrt(((self.labs - lab[None]) ** 2).sum(1))
        sep = float(np.linalg.norm(self.labs[0] - self.labs[1]))
        if self.official is not None and float(np.linalg.norm(lab - self.official)) <= 28.0 and float(np.linalg.norm(lab - self.official)) < float(d.min()) and float(d.min()) >= 0.5 * sep:
            return 2                                           # the colour the officials were seen in at kickoff, however pale the sun made it in this frame
        near, far = int(np.argmin(d)), int(np.argmax(d))
        if d[near] <= 1.0 * sep and d[far] - d[near] >= 0.25 * sep:
            return near
        return None


def build_team_reference(people: list[tuple[np.ndarray, float]]) -> tuple[TeamReference | None, dict]:
    """The two team colours from the people on screen at the moment taught: [(shirt Lab, horizontal centre 0..1)]. Needs two colour clusters that are far
    apart in colour AND stand apart on the pitch (each team on its own half), each with several readable players; else (None, why)."""
    seen = [(l, cx) for l, cx in people if l is not None]
    w = np.array([1.0, 1.3, 1.3, 1.0])[:len(seen[0][0])] if seen else None
    off = find_officials(np.stack([l for l, _ in seen]) * w) if seen else np.zeros(0, bool)
    labs = [p for p, o in zip(seen, off) if not o]
    offs = [l for (l, _), o in zip(seen, off) if o]
    info: dict = {"readable_people": len(labs), "officials": len(offs)}
    if len(labs) < 2 * TEAM_MIN_PLAYERS:
        return None, {**info, "ok": False, "reason": "Too few players with a readable shirt at that moment: choose a frame where the players are closer to the camera."}
    x = np.stack([l for l, _ in labs]) * np.array([1.0, 1.3, 1.3, 1.0])[:len(labs[0][0])]
    cx = np.array([c for _, c in labs])
    best = None
    rng = np.random.default_rng(5)
    for _ in range(24):
        c = np.stack([x[rng.integers(len(x))], x[rng.integers(len(x))]])
        for _ in range(40):
            asg = np.argmin(((x[:, None, :] - c[None]) ** 2).sum(2), axis=1)
            new = np.stack([x[asg == j].mean(0) if np.any(asg == j) else c[j] for j in range(2)])
            if np.allclose(new, c):
                break
            c = new
        inertia = float(((x - c[asg]) ** 2).sum())
        if best is None or inertia < best[0]:
            best = (inertia, asg, c)
    _, asg, _ = best
    n = [int((asg == j).sum()) for j in range(2)]
    if min(n) < TEAM_MIN_PLAYERS:
        return None, {**info, "ok": False, "players": n, "reason": "Only one team's shirt could be read at that moment."}
    med = np.stack([np.median(np.stack([l for (l, _), a in zip(labs, asg) if a == j]), axis=0) for j in range(2)])
    sep = float(np.linalg.norm(med[0] - med[1]))
    gap = float(abs(cx[asg == 0].mean() - cx[asg == 1].mean()))
    mid = float((cx[asg == 0].mean() + cx[asg == 1].mean()) / 2)
    left_team = 0 if cx[asg == 0].mean() < cx[asg == 1].mean() else 1
    wrong = int(((cx < mid) & (asg != left_team)).sum() + ((cx >= mid) & (asg == left_team)).sum())          # players standing on the other team's side of the middle
    info.update({"players": n, "separation": round(sep, 1), "side_gap": round(gap, 3), "mixing": round(wrong / len(cx), 3)})
    if sep < TEAM_MIN_SEPARATION:
        return None, {**info, "ok": False, "reason": "The two teams' shirts look too much alike at that moment."}
    if gap < TEAM_MIN_SIDE_GAP:
        return None, {**info, "ok": False, "reason": "The two teams are not standing on separate halves at that moment: choose the kickoff."}
    order = [0, 1] if med[0, 0] >= med[1, 0] else [1, 0]              # team 0 = the lighter shirt (as in the legend)
    ref = TeamReference(labs=med[order], official=np.median(np.stack(offs), axis=0) if len(offs) >= 2 else None)
    left = 0 if cx[asg == order[0]].mean() < cx[asg == order[1]].mean() else 1
    info["official_colour_lab"] = None if ref.official is None else [round(float(v), 1) for v in ref.official]
    info.update({"ok": True, "team_colours_lab": [[round(float(v), 1) for v in r] for r in ref.labs], "team0_side": "left" if left == 0 else "right"})
    return ref, info


def group_from_votes(teams: list, min_votes: int = 3, min_share: float = 0.6, min_coverage: float = 0.5, plenty: int = 40) -> int | None:
    """A track's team from the per-frame calls of its own detections: the majority, if it has enough votes, a clear majority, and the shirt could be read in at least
    half of the track's frames (or in `plenty` of them); a player readable only in a few odd frames (bent over, half hidden) stays unknown rather than guessed.
    Agreement alone is not enough: on real footage a bent-over player read the wrong colour in 14 of 30 frames, all the same way (2026-10-31)."""
    votes = [t for t in teams if t is not None]
    if len(votes) < min_votes or (len(votes) < min_coverage * len(teams) and len(votes) < plenty):
        return None
    counts = np.bincount(votes, minlength=3)
    k = int(np.argmax(counts))
    return k if counts[k] / len(votes) >= min_share else None


AUTO_MIN_SIDE_GAP, AUTO_MAX_MIXING = 0.18, 0.15   # looking without being told, the teams must be clearly apart: averages 0.18 of the width apart, at most 15 % of players on the other side of the middle
AUTO_MIN_PLAYERS = 6             # an automatic kickoff needs this many readable players in EACH team: staff and substitutes in two coats are never eleven
AUTO_GOOD_PLAYERS, AUTO_GOOD_SIDE_GAP, AUTO_GOOD_SEPARATION = 7, 0.25, 28.0       # a formation this clear is accepted at once: the search stops


def find_kickoff(times, people_of, *, min_players: int = AUTO_MIN_PLAYERS) -> tuple[int | None, dict]:
    """The moment, among `times`, where the two teams stand on separate halves, found without anyone pointing at it (the kickoff, or the line-up before it).
    `people_of(t)` gives the readable people on the pitch at time t as [(shirt Lab, horizontal centre)] or None when nothing could be read there. Returns
    (time, what was seen there) for the best moment, stopping early at the first clear one; (None, why) when no moment qualifies.
    A moment where the officials' colour can be learned too (two officials readable) beats one where it cannot, and only such a moment ends the search early:
    on real footage the coin toss (teams in two groups, the officials overlapping in the middle) taught the teams but not the officials, and every referee was
    then called a player of one team (2026-10-31)."""
    best: tuple[tuple[bool, float], int, dict] | None = None
    tried = 0
    for t in times:
        people = people_of(t)
        if not people:
            continue
        tried += 1
        ref, info = build_team_reference(people)
        if ref is None or min(info["players"]) < min_players or info["side_gap"] < AUTO_MIN_SIDE_GAP or info["mixing"] > AUTO_MAX_MIXING:
            continue
        officials = ref.official is not None
        score = (officials, info["side_gap"] * info["separation"] * min(min(info["players"]), 10))
        if best is None or score > best[0]:
            best = (score, t, {**info, "frames_looked_at": tried})
        if officials and min(info["players"]) >= AUTO_GOOD_PLAYERS and info["side_gap"] >= AUTO_GOOD_SIDE_GAP and info["separation"] >= AUTO_GOOD_SEPARATION:
            break
    if best is None:
        return None, {"ok": False, "auto": True, "frames_looked_at": tried,
                      "reason": "No moment was found where both teams stand on their own halves (the kickoff). Pause on the kickoff and press the button."}
    return best[1], best[2]
