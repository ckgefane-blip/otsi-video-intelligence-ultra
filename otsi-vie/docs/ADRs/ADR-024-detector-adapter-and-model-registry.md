# ADR-024: Replaceable detector behind an adapter; pinned model registry; CPU-first evaluation

Status: accepted (2026-10-26; owner decision: Apache-licensed RT-DETR path, no purchases, no AGPL)

## Decision
1. **Boundary.** Downstream code sees only `Detection(label ∈ {PERSON, BALL}, score, x, y, w, h)` normalised to the decoded frame, from a `Detector` (`vie_worker/detect/base.py`). A detector is created from a registry entry; replacing or upgrading a model = a new registry entry (+ an adapter only for a new family). No application rebuild.
2. **Registry** (`vie_worker/models/registry.json`): source URL, pinned revision, SHA-256 of every weight file, code and weights licences, training data, obligations, status. `tools/models/fetch_models.py` downloads into `.local/models` (D:) and verifies; the worker re-verifies on load and refuses mismatches; `HF_HUB_OFFLINE=1` in the stack, so nothing is downloaded at run time. Safetensors only (no pickle code execution).
3. **First model: RT-DETRv2-R18** (`rtdetr_v2_r18vd`, Apache-2.0 weights, COCO-trained) via transformers 4.49.0 on CPU. COCO classes used: person → PERSON, sports ball → BALL. A PERSON is not a player: role (player / goalkeeper / referee / other) and team are later decisions (Block 07); tracks are stored with class PERSON until then (migration 0013).
4. **Tiling** (2×2 overlapping tiles + full frame, class-wise NMS; tile boxes touching an inner tile edge or taller than 45 % of the tile are discarded as fragments). **Default ON**: on wide footage filmed from the stands it raised on-pitch people from 10.1 to 17.8 per frame and found the ball in 12/12 instead of 1/12 sampled frames; on close broadcast shots it adds little. Fast mode (tiles=1) is a per-run choice.
5. **On-pitch filter** (`detect/pitch.py`): a grass mask per frame; a person is tracked only if the ground under the feet is grass, a ball only within the grass extent. Every detection is still kept, flagged, in the evidence file. Generic (no stadium knowledge); fails on non-green surfaces (then the on-pitch share is visibly low).
6. **Measured on this machine** (22 logical cores, no GPU; `release-evidence/model-benchmarks/20261026-rtdetr-v2-cpu/`): R18 ≈ 0.30 s per frame untiled, ≈ 1.1-1.2 s tiled (4K and 1080p sources); R50 is ~2× slower and not better on our footage. Full 90-minute match at 2 analysed frames/s: ≈ 1 h untiled, ≈ 3.5 h tiled. Proxy encoding ≈ 8× real time.
7. **Accuracy is NOT measured** and the model is NOT production-ready: no labelled football ground truth exists yet. `benchmark_detector.py --labels` computes precision/recall at IoU 0.5 once labelled frames exist (owner footage + labelling = sign-off `measured_tracking_accuracy`).

## Alternatives
Ultralytics YOLO (AGPL: blocked by the owner); RT-DETR `_o365` checkpoints (Objects365 terms unclear: not used); training our own detector (needs labelled rights-cleared footage: the path if counsel objects to COCO-trained weights).

## Evidence
`services/worker/tests/test_analyze.py` on real CC BY-SA match footage (ingest → proxy → analysis; people found and tracked, evidence file hashed, model version recorded, nothing invented on a video without people). Benchmark reports and annotated frames (CC BY 3.0 / public-domain sources) in release-evidence.
