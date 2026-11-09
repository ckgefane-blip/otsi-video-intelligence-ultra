# ADR-125: Track G — Sukhum benchmark harness (DRAFT, owner approval pending)

- **Status:** Draft. This ADR proposes the harness; it does not claim any
  benchmark result. No Sukhum ground truth exists yet, so no Sukhum number
  exists yet.
- **Date:** 2026-11-10 (Muse, `muse/ultra-main`, base `a721d36`)
- **Decides:** how Track G (evaluation gates G01–G15, ADR-117) is measured
  for Sukhum / Abkhazia Premier League footage.
- **Context:** gates G05–G08 are `MEASURING` in
  `otsi-vie/apps/api/src/modules/admin/admin.ts` with the release rule
  "Display 'accuracy not yet measured' until ground-truth benchmark passes".
  Detector benchmarks in `otsi-vie/release-evidence/model-benchmarks/`
  record accuracy as "not measured: no labelled ground truth". The three
  existing ground-truth files (`france_germany`, `naples_amateur`,
  `ocsc_wide` in `otsi-vie/tools/eval/annotations/gt/`, 15 frames, 203
  players, one annotator) are indicative per clip, not a Sukhum benchmark.

## Decision

1. **One harness, one metric module.** `otsi-vie/tools/eval/sukhum_benchmark.py`
   loads ground truth and predictions, validates them, and calls the
   existing `vie_worker/evaluation.py:evaluate()` — CLEAR-MOT (MOTA, ID
   switches, fragmentations), IDF1, HOTA (DetA × AssA), detection precision
   / recall / F1 at IoU ≥ 0.5, and identity rates. No new metric and no new
   threshold is introduced by the harness.
2. **One file format.** Ground truth and predictions are OTSI JSON, the
   format `evaluation.load_ground_truth` already reads: `frame_width`,
   `frame_height`, `frames` with `pts_us`, `complete`, and boxes with
   normalised `x/y/w/h`, `id`, `player_ref` (null until a person confirms
   the player, ADR-122), `ignore`, `approximate`. Extra fields are
   tolerated and ignored by the scorer: top-level `match`, `competition`,
   `half`, `camera`, and per-box `kind` (`person` / `ball`).
   MOTChallenge `gt.txt` ground truth is also accepted by the harness
   (with `--fps` / `--width` / `--height`).
3. **A template, not data.** `otsi-vie/tools/eval/annotations/sukhum_template.json`
   is a two-frame, `complete: false` example showing the required fields
   (match, half, camera, per-frame person and ball boxes). It must never be
   scored or quoted: the harness refuses to score ground truth with no
   `complete` frame and exits non-zero with "NOT MEASURED".
4. **Honesty is enforced by the tool, not by convention.** If there is
   nothing labelled, the harness prints NOT MEASURED and produces no score.
   A run whose predictions are the ground truth itself is a harness smoke
   test only and must never be quoted as a benchmark result.
5. **Annotation follows the existing protocol** in
   `otsi-vie/tools/eval/annotations/README.md` (pool-assisted manual
   annotation, `tools/eval/annotate.py`; feet marks; `ignore` regions for
   referees / truncated people; everyone else a negative). The same limits
   apply: one annotator, no agreement measure, small samples are noise.

## Consequences

- When the owner selects Sukhum files, labelling can start the same day:
  copy the template, fill it with `annotate.py`, run the harness.
- A benchmark bundle is a dated directory with the GT file, the prediction
  file, the harness `--out` JSON, and the labeller/method recorded. Only a
  bundle meeting the ADR-117 thresholds flips G05–G08 from `MEASURING` to
  `PASSED`, and that flip is recorded in `blueprint/CHANGELOG.md`.
- The harness is validated against the three existing GT files (structural
  validation; a GT-as-prediction smoke test proves the harness runs).
  Those three clips are not Sukhum and their numbers — if ever quoted —
  must be quoted per clip, with the README limits attached.
- No worker source code is changed by this ADR. No cost is introduced
  (ADR-030, zero-cost): the harness uses only the Python standard library
  plus the numpy/scipy the worker already depends on.

## Alternatives considered

- **A new metric implementation:** rejected — `evaluation.py` is the
  project's agreed metric module (ADR-034); duplicating it would let two
  definitions of MOTA/HOTA drift apart.
- **Scoring the engine's own tracks as ground truth:** rejected — the
  engine's output is never ground truth (see `evaluation.py` docstring).
- **Waiting for Sukhum footage before building the harness:** rejected —
  the harness is footage-independent and is the critical-path item; building
  it now means measurement starts the day footage is selected, not weeks
  later.
