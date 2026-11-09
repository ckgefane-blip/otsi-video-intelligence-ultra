# ADR-031: Track appearance and same-person link suggestions (automatic association, human-confirmed)

Status: accepted (2026-10-27; owner priority: automatic player identity association and cross-camera-cut tracking; zero-cost policy ADR-030).

## Principle
Automatic association produces **evidence and suggestions only**. It never creates, changes or confirms a player identity and never feeds
a reel or spotlight by itself. A person confirms that two tracks are the same person (a link), and a person applies an identity — one
identity decision per track, with a reason when it corrects an earlier one. Unknown stays unknown.

## What the analysis now records (pipeline step IDENTIFY)
| Evidence | How | Stored |
|---|---|---|
| Crops | while tracking, each track keeps up to 8 evenly spread crops of its own detections (no second decode pass) | memory only |
| Kit group | torso colour histogram; 2 colour clusters (k-means++, Hellinger); far-off colours (referee, goalkeepers, staff) get none. A colour, not a team name | `track_appearance.kit_group`, `kit_rgb` |
| Appearance embedding | **DINOv2-small** (Apache-2.0, pinned + hash-verified) on the Arc GPU, OpenVINO FP16 (7 ms/crop; FP16 = FP32 within cosine 0.9999; parity-checked against PyTorch, CPU fallback) | Parquet evidence asset `EMBEDDINGS` |
| Drift (possible identity switch inside a track) | cosine of first-half vs last-half embeddings, only with ≥ 6 crops; warning below 0.60 | `track_appearance.drift_score` |
| Thumbnail | the track's largest crop, JPEG | `THUMBNAIL` asset |
| Same-person link suggestion | non-overlapping pairs (earlier → later), same kit group or none, gap ≤ 120 s; score = 0.75·cosine + 0.25·kit similarity; kept only as **mutual best** match and score ≥ 0.70; marked when it crosses a camera cut | `track_links` (migration 0014) |
Human decisions on links: `track_link_decisions`, append-only (triggers), a correction supersedes the current decision and needs a reason;
current state view `v_track_link_current`. Person group = tracks joined by CONFIRMED links (`GET /v1/tracks/:id/person-group`); if a group
contains different confirmed players the API reports all of them and the UI shows a conflict.

## Measurements (`release-evidence/appearance-study/20261027/`)
Protocol: dense reference tracks (production tracker on every frame, ADR-028 — not ground truth); each track ≥ 3 s split into a query (first
40 %) and gallery piece (last 40 %); ranked against the pieces of every track visible at the same time (certainly different people,
teammates included).

| Method (free, Apache-2.0) | France–Germany (wide, crops ~49 px) rank-1 / AUC | Naples (medium, ~337 px) | OCSC highlights (fast) |
|---|---|---|---|
| kit colour only | 0.44 / 0.91 | 0.91 / 0.97 | 0.27 / 0.70 |
| DINOv2-small | 0.47 / 0.87 | 0.77 / 0.97 | 0.32 / 0.67 |
| DINOv2-small + kit | 0.50 / 0.90 | 0.82 / 0.98 | 0.32 / 0.70 |
| DINOv2-base + kit | 0.44 / 0.90 | 0.86 / 0.97 | 0.30 / 0.68 |
| SigLIP-base + kit | 0.53 / 0.93 | 0.91 / 0.99 | 0.32 / 0.72 |
(mean gallery 30.5 / 18.4 / 10.0 simultaneous people.) SigLIP is slightly better but 3.4× slower (23.5 vs 7 ms/crop); DINOv2-small is the
default, SigLIP selectable per run (`appearance_model`). CLIP was not evaluated: no declared licence on its model card.

Calibration (production embedder and score): same-person halves with 3 crops each have a 5th-percentile cosine of 0.70 (1 crop: 0.35 → the
drift check needs ≥ 6 crops); an absolute link threshold alone is weak (at 0.70: 93 % of same-person pairs kept but also 50 % of
different-person pairs in similar kits) → suggestions use mutual-best ranking.

Findings: on fast highlight footage the dense reference itself swaps identities (evidence image `ocsc_reference_identity_switch.png`: one
reference track starts on a white-kit player and ends on orange #7) — the OCSC numbers are therefore a lower bound, and the drift warning
exists for exactly this case. The pitch filter lets some sideline staff/spectators through (they get tracks; usually no kit group).

## Limits (documented, not hidden)
- Accuracy against labelled ground truth is not measured (no labelled football footage; owner input A2).
- Wide broadcast footage: appearance alone picks the right person first only ~50 % of the time → suggestions there need careful review;
  jersey-number OCR (free OCR models) and roster constraints are the next evidence sources (Block 07 continuation).
- Links are suggested only between non-overlapping tracks of one run; cross-match identity uses the permanent OTSI Player ID registry.
