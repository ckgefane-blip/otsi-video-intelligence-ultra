# OTSI Video Intelligence Engine — Ultra Enhancement Blueprint (Muse)

- **Status:** Draft for owner approval. No code in this document is a claim about
  what has been built; every item names the real files it touches.
- **Base:** `muse/ultra-main` at `a721d36` (handoff branch
  `handoff/muse-assessment-2026-11-10`), forked from
  `awore-otsi/otsi-video-intelligence`. The original repo is untouched by
  this work.
- **Baseline (verified 2026-11-10, see `~/workspace/otsi-assessment/ASSESSMENT.md`):**
  VIE v3 Phases A–E are present in code (ADR-118–ADR-124); ~107,317 lines of
  code across 648 files; 66 migrations (`0001`–`0066`); 114 ADR files
  (ADR-011–ADR-124; ADR-001–ADR-010 not found in `otsi-vie/docs/ADRs/`);
  62 web test files, 65 API test files, 35 worker pytest files. No
  post-Phase-E CI evidence exists in the repo (latest bundle 2026-10-26) and
  accuracy is unmeasured (gates G05–G08 `MEASURING`, no Sukhum ground truth).
  Track U.1 was not present in the handoff snapshot; it is built in this
  branch (see §5, U.1). U.2–U.12 were not present as specified. No payment
  gateway code exists (Option B, bank-transfer invoice).
- **Rules that bind this plan:** zero-cost development only (ADR-030);
  never fabricate a metric — "unknown beats wrong", unmeasured metrics
  display `—` / "Not measured" with a reason; mock data only in labelled
  dev/test; preserve existing line endings (CRLF for Python, migrations,
  `blueprint/CHANGELOG.md` and certain frontend files; LF for web/API);
  isolated MySQL on ports 3508 (dev) / 3507 (test), never 3306; every
  material change recorded in `blueprint/CHANGELOG.md` or an ADR.
- **How to read the phases:** P0 is the measurement foundation. P1–P3 are
  the ultra-enhancement builds, in dependency order. P4 is commercial
  readiness. An item is done only when its acceptance criterion is met with
  evidence (test command + result, or a benchmark run against labelled
  ground truth), not when the UI for it exists.

## 1. Performance

### 1.1 Worker (`otsi-vie/services/worker/vie_worker/`)
| # | Item | Files to touch | Acceptance |
|---|---|---|---|
| W1 | U.1 occlusion freeze (done in this branch) | `follow.py`, `analyze.py`, `tests/test_follow.py` | Synthetic crossing test passes; existing 3 `test_follow.py` tests still pass |
| W2 | Profile the worker end-to-end on a labelled clip before optimising anything (detector ms/frame, tracker ms, embed ms, render ms) | `tools/eval/benchmark_profiles.py`, `release-evidence/model-benchmarks/` (new dated bundle) | A dated profile bundle exists; no optimisation is claimed without a before/after number from it |
| W3 | Batch / cache appearance embeddings: do not re-embed the same crop twice in a run | `appearance.py`, `embed.py`, `analyze.py` | Same clip, same config: embed calls fall measurably; MOTA/IDF1 unchanged on the labelled clip |
| W4 | Extend OpenVINO AsyncInferQueue beyond the ball model (`ball_net.py:79` is the only queue today) to the person-detection path | `detect/`, `ball_net.py`, `analyze.py` | Detector ms/frame falls on the profiled clip; no accuracy regression on the labelled clip |
| W5 | Horizon-guided multi-scale tiling for far-side / tiny players (U.7) | `detect/pitch.py`, `geometry.py`, `detect/` | Recall by height bin (see `evaluation.py` `recall_by_height_px`) improves for the 0–20 px and 20–40 px bins on labelled footage; no new false positives above the measured baseline |
| W6 | Reduce re-detection: reuse `follow.py` predictions between analysed samples instead of re-running the detector at full rate where the config allows | `analyze.py`, `follow.py` | Frames/second rises on the profiled clip; identity switches do not rise on the labelled clip |

### 1.2 API (`otsi-vie/apps/api/src/`, `otsi-vie/packages/contracts/src/`)
| # | Item | Files to touch | Acceptance |
|---|---|---|---|
| A1 | Index and query audit for the hottest reads (timeline observations, search, pressing, formations) | `apps/api/src/modules/analysis/`, `apps/api/src/modules/search/`, `database/migrations/` (new, forward-only) | p95 of the audited queries falls on the load-test data in `tools/load/load_test.py`; no migration breaks `tests/db` |
| A2 | Cache search / formation / pressing responses per video with invalidation on new `event_decisions` | `apps/api/src/modules/search/`, `apps/api/src/modules/analysis/`, `packages/contracts/src/` | Second identical read is served from cache; a new accept/reject decision invalidates it (test covers this) |
| A3 | Paginate / stream large timeline and observation payloads instead of returning whole matches at once | `apps/api/src/modules/analysis/`, `apps/web/src/components/workspace/` | A 90-minute match timeline loads in pages; the web timeline renders the first page without waiting for the whole match |

### 1.3 Web (`otsi-vie/apps/web/src/`)
| # | Item | Files to touch | Acceptance |
|---|---|---|---|
| F1 | Virtualise long lists and timelines (players, events, library) so 90-minute matches do not lag | `apps/web/src/components/workspace/`, `apps/web/src/components/players/`, `apps/web/src/components/library/` | Scrolling a full-match timeline stays smooth in the Playwright E2E run; no blank rows |
| F2 | Code-split heavy routes (Clip Studio, Tactics, Admin) so the first paint does not load them | `apps/web/src/app/`, `apps/web/src/components/studio/`, `apps/web/src/components/tactics/` | Initial bundle for the landing/analysis route shrinks; `next build` still passes |
| F3 | Memoise pitch visualisers and scope canvases (Waveform / Histogram / Vectorscope / LUFS in `components/studio/Scopes.tsx`) | `apps/web/src/components/studio/` | Scopes update without re-rendering the whole Clip Studio panel (verified by a component test) |

## 2. Features, per page

Routes live in `otsi-vie/apps/web/src/app/`; components in
`otsi-vie/apps/web/src/components/`. Only pages that exist in the tree are
listed. Nothing here invents a new route.

### 2.1 Analysis workspace (`app/analysis`, `components/workspace/`, `components/analysis/`)
- Bulk event accept/reject (E.1 today is one event at a time:
  `apps/api/src/modules/analysis/events.ts`, `components/workspace/TimelinePanel.tsx`).
  Acceptance: an analyst can accept/reject a filtered set in one action; each
  decision still lands in `event_decisions` with its audit row.
- Keyboard shortcuts for accept / reject / next event / seek.
  Acceptance: shortcuts work with focus in the timeline; they are listed in
  the workspace help and do not clash with browser shortcuts.
- Filters that persist per video (player, event type, period, confirmed-only).
  Acceptance: reloading the video restores the filter set.

### 2.2 Timeline (workspace `TimelinePanel.tsx`, `components/stage/`)
- Zoomable beat-grid timeline with snap-to-beat (beat grid exists in
  `vie_worker/beat_job.py`; the timeline does not yet snap to it).
  Acceptance: dragging a cut snaps to the nearest beat when snapping is on.
- Multi-track observation density lane (detections per second) alongside events.
  Acceptance: the lane renders from the existing frame-index rows, no new
  detection pass.

### 2.3 Clip Studio (`app/` studio routes, `components/studio/`, `components/reelstage/`)
- Dual-timeline comparison (Cut A vs Cut B) already exists
  (`components/studio/DualTimeline.tsx`); add snapshot-and-swap keyboard
  control and a diff summary line (which cut is longer, how many cuts differ).
  Acceptance: the summary is computed from the two manifests, never typed by hand.
- Scopes (Waveform, Histogram, Vectorscope, LUFS in `Scopes.tsx`) that update
  live during playback without freezing it (see F3).
- Render queue visibility: show `vie-render` headless jobs
  (`tools/dev/vie_render.py`) in the studio instead of only in Admin.
  Acceptance: a render started from the studio appears in the queue with
  progress and a downloadable result.

### 2.4 Reel Builder (`components/reels/`, `components/reelstage/`, API `modules/reels/`)
- Batch reels for a whole squad (today: one player at a time).
  Acceptance: a batch job produces one reel per selected player, each with
  its own evidence manifest; a failed player does not fail the batch.
- Preview before render: a low-resolution proxy preview of the spotlight
  effect (`components/studio/spotlight.ts`, `render/reel.py`) before the
  full MP4 is rendered. Acceptance: preview and final render use the same
  spotlight parameters, so the preview is not a different effect.

### 2.5 Player Reports (`components/playerreport/`, API `modules/playerreport/`)
- Cohort comparison against person-confirmed roles only (ADR-122 already
  restricts search/list/report cohorts to confirmed roles; extend the same
  rule to every cohort line in the report, with a visible "provisional"
  marker where a role is not confirmed).
  Acceptance: a report never presents a provisional role as confirmed.
- Export the report's evidence audit (`GET /v1/videos/:id/evidence-audit`)
  as an appendix. Acceptance: the appendix lists the same validators as the
  API response, with reasons.

### 2.6 Tactics (`components/tactics/`, API `modules/analysis/formations.ts`, `transitions.ts`, `pressing.ts`)
- Animated transition maps: scrub through a transition (ball won → next
  action) instead of a static picture. Acceptance: the scrub position matches
  the event timestamps from the API.
- Formation stability over time (Formation Stability % exists per period;
  show it as a timeline, with the defensive line height in metres alongside).
  Acceptance: values come from `formation_decisions` (migration 0066), not
  recomputed in the browser.
- Counter-press within 5 s: filter the transitions list to counter-press
  regains only. Acceptance: the filter uses the existing `counter_press_regains`
  field.

### 2.7 Search (`components/shell/CommandPalette.tsx`, API `modules/search/`, `modules/overview/search.ts`)
- Saved searches per analyst (player + period + event filters).
  Acceptance: a saved search re-runs and returns the same result set for the
  same data.
- Search result explanations: why a clip matched (which player / event /
  period). Acceptance: the explanation cites the indexed fields, not a
  generated sentence.

### 2.8 Library / Matches (`components/library/`, `components/matches/`, API `modules/library/`, `modules/matches/`)
- Bulk ingest status: one view for all uploads / jobs with per-file progress
  (today split between upload, jobs and monitoring).
  Acceptance: the view reads the existing jobs API; no new job store.
- Retention countdowns visible in the library (retention policies exist in
  `modules/retention/`; surface the trash-expiry countdown per item).
  Acceptance: the countdown matches the policy dates from the API.

### 2.9 Admin / Monitoring (`components/admin/`, API `modules/admin/`, `modules/monitoring/`)
- Release gates G01–G15 (`admin.ts`, `ReleaseGatesView.tsx`) fed by real
  benchmark runs (Track G, §6) instead of static `PASSED` / `MEASURING`.
  Acceptance: G05–G08 change only when a benchmark bundle lands with
  numbers; until then they stay `MEASURING` with "accuracy not yet measured".
- Model registry: weights verification already exists; add a "last verified"
  timestamp and the verification command that produced it.
  Acceptance: the timestamp is written by the verification run, not by hand.

## 3. Smoothness (every function)
- Optimistic UI for accept/reject, confirm-role and formation-confirm actions:
  the row updates immediately, rolls back on API error, and the audit row is
  still the source of truth. Files: `components/workspace/`,
  `components/players/`, `components/tactics/`.
- Skeletons instead of blank loading for timeline, player list and library.
  Acceptance: no page shows a blank content area for more than its skeleton.
- Autosave for reel / report drafts; undo for the last decision (a new
  superseding decision in `event_decisions`, never a rewrite of history —
  audit is append-only, ADR-013/ADR-118).
- Job progress everywhere a job runs (upload, analysis, render): progress,
  current step, and a real error message on failure, from the existing jobs
  API (`modules/jobs/`). No silent failures.
- Every long operation is cancellable where the backend supports it, and
  says so when it does not.

## 4. UI/UX system
- **Design system pass:** one set of tokens (spacing, type, colour, radius)
  applied to `components/shell/`, `components/workspace/`,
  `components/studio/`, `components/tactics/` and `components/admin/`
  instead of per-page values. Acceptance: a visual-fidelity check
  (`release-evidence/visual-fidelity/`) shows no unintended layout change
  on the 10 approved screens; the 10 approved UI images remain the visual
  source of truth (CLAUDE.md §1).
- **Guided vs Pro (ADR-072):** Guided mode hides technical controls
  (already the intent); Pro mode exposes every control. Make the distinction
  real per page: each page lists which controls are Guided-hidden, and Pro
  adds keyboard shortcuts and the evidence tooltips from ADR-124.
  Acceptance: toggling Guided/Pro on a page changes only the listed controls.
- **Accessibility:** keyboard navigation for timeline, player list and
  command palette; visible focus; sufficient contrast; every scope and pitch
  visualiser has a text alternative (the numbers behind the picture).
- **Responsive:** the analysis workspace, tactics stage and Clip Studio must
  be usable on a laptop and a tablet, not only a desktop. Acceptance:
  Playwright E2E at the two widths passes; no horizontal scroll on the
  timeline at tablet width.
- **Empty, error and "not measured" states:** every metric without evidence
  shows `—` with its reason (the ADR-124 rule), every empty list explains
  what to do next, every error names the failed step and the retry action.
- **Onboarding:** a first-run checklist for a new analyst (upload → calibrate
  → review events → confirm roles → export), linking to the real pages.
  Acceptance: completing the checklist is possible end-to-end on the local
  stack; it never claims a step is done that was not.

## 5. Track U — Player Auto-Tracking (U.1–U.12)
Base state (verified): `tracker.py` is a constant-velocity Kalman +
two-stage Hungarian tracker with a kit-colour gate; `follow.py` follows
patches by FFT phase correlation between analysed frames; `appearance.py`
already splits tracks on shirt-colour change (`split_on_shirt_change`);
DINOv2 lives in `embed.py` (appearance description, not association);
`geometry.py` has pitch projection (`project(H, Q)`) not wired into the
tracker; the only OpenVINO `AsyncInferQueue` is in `ball_net.py:79`.

| Item | What | Files | Acceptance |
|---|---|---|---|
| U.1 | **Done in this branch:** freeze FFT template updates during mutual overlap (see `follow.py` docstring and `tests/test_follow.py`) | `vie_worker/follow.py`, `vie_worker/analyze.py`, `tests/test_follow.py` | Synthetic crossing test passes; existing 3 tests pass; `follow_stats` reports frozen frames |
| U.2 | Deep-EIoU + on-demand DINOv2 association gate in the tracker for same-team crossings | `vie_worker/tracker.py`, `vie_worker/embed.py` | ID switches fall on the labelled crossing segment vs the U.1-only baseline; the gate fires only on crossings, not on every association (measured) |
| U.3 | Intra-track identity-swap splitter — test the existing `split_on_shirt_change` first, extend to Re-ID embeddings only if it fails on Sukhum crossings | `vie_worker/appearance.py`, `tests/test_appearance.py` | Splitter is tested on a labelled crossing before any rewrite; a rewrite happens only with a failing test to justify it |
| U.4 | Pitch-plane (2D world-coordinate) Kalman with biomechanical velocity gates | `vie_worker/tracker.py`, `vie_worker/geometry.py` | Track velocity in pitch metres/second stays within the gate on labelled footage; no track jumps across the pitch in one sample |
| U.5 | Part-based Re-ID (head / torso / legs separately, grass-masked) | `vie_worker/appearance.py`, `vie_worker/embed.py` | Re-ID accuracy on labelled crossings improves vs whole-crop embeddings; grass pixels are excluded (measured, not asserted) |
| U.6 | Perspective-rectified jersey OCR | `vie_worker/jersey.py`, `vie_worker/ocr.py`, `vie_worker/geometry.py` | OCR accuracy on rectified crops beats unrectified crops on the same labelled set |
| U.7 | Horizon-guided multi-scale tiling (see W5) | `vie_worker/detect/`, `vie_worker/detect/pitch.py`, `vie_worker/geometry.py` | Recall by height bin improves for 0–40 px players (see §6) |
| U.8 | OpenVINO AsyncInferQueue across the tracking path (see W4) | `vie_worker/detect/`, `vie_worker/ball_net.py`, `vie_worker/analyze.py` | Detector throughput rises with no accuracy regression |
| U.9–U.12 | 3D parabolic ball-flight separation and remaining tracking hardening (per the owner's Track U list) | `vie_worker/ball.py`, `vie_worker/ball_net.py`, `vie_worker/tracker.py` | Ball track separates from player tracks on labelled ball-flight segments; each item lands with its own test and ADR note |

## 6. Track G — Evaluation Gates G01–G15 (benchmark)
- **G01–G04, G09–G15** are `PASSED` in `apps/api/src/modules/admin/admin.ts`
  and shown in `components/admin/ReleaseGatesView.tsx`. Do not re-litigate
  them; keep their evidence citations current.
- **G05–G08 are `MEASURING`** and must stay that way until a benchmark
  bundle lands. The harness is `otsi-vie/tools/eval/sukhum_benchmark.py`
  (built in this branch), reusing `vie_worker/evaluation.py:evaluate()`
  (MOTA, ID switches, fragmentations, IDF1, HOTA, detection precision /
  recall / F1 at IoU ≥ 0.5, identity rates). Ground truth format is the
  OTSI JSON in `evaluation.py:load_ground_truth` (frames with `pts_us`,
  `complete`, boxes with normalised `x/y/w/h`, `player_ref`, `ignore`,
  `approximate`).
- **Critical-path dependency (not code):** the owner selects Sukhum /
  Abkhazia Premier League files from
  `D:\Videos-Full Matches\Abkhazia Premier League`. Until then, no Sukhum
  number exists and none may be invented. The harness is validated against
  the three existing GT files (`france_germany`, `naples_amateur`,
  `ocsc_wide`) — see `ADR-125`.
- **Acceptance for Track G:** a dated benchmark bundle under
  `otsi-vie/release-evidence/` (or the harness `--out` directory) with GT
  file, prediction file, full `evaluate()` output, and the annotator /
  method recorded; G05–G08 flip to `PASSED` only when the bundle meets the
  thresholds already recorded in ADR-117, and the flip is itself recorded
  in `blueprint/CHANGELOG.md`.

## 7. Option B — Commercial SOP (Managed Service)
No payment gateway is built (deliberate, until Phase 4). The commercial
work is documentation and process, in `otsi-vie/docs/commercial/` (new):
- **Spotlight-on-demand SOP:** ingest → calibrate → analyse → human
  verification (E.1/E.8) → reel/report → invoice. One checklist per match,
  with the role that does each step and the evidence that proves it.
  Acceptance: the SOP can be followed for a real pilot match without
  inventing a step.
  **Done (this branch):** `otsi-vie/docs/commercial/spotlight-sop.md` —
  intake, both ADR-007 rights/billing gates, processing order, G05–G08
  quality gates with failure handling, human review (ADR-118/122/124),
  Spotlight + Scouting Pack in/out, Team Tactical held back, bank-transfer
  invoicing, retention/GDPR (ADR-112), Phase 2 dry-run checklist.
- **Unit-cost worksheet:** compute minutes + analyst minutes per match,
  with fields left blank for the owner's measured numbers. No price is
  stated until the measured cost exists. Acceptance: the worksheet has no
  invented numbers in it.
  **Done (this branch):** `otsi-vie/docs/commercial/unit-cost-worksheet.md`
  + `unit-cost-worksheet.csv` (same tables with formulas) — all numbers
  are explicit `[input]` cells; totals follow from the inputs.
- **Pilot packs:** Single Match Spotlight and Scouting Pack scope sheets;
  Team Tactical is explicitly held back until verified. Acceptance: each
  pack lists what is in, what is out, and what evidence the client gets.
- **Invoice workflow:** bank-transfer invoice steps (no gateway, no quota
  metering until Phase 4). Acceptance: the workflow names who sends the
  invoice, when, and what triggers it.

## 8. Phased plan
- **P0 — Measure (first):** Track G harness (this branch) + fresh
  post-Phase-E evidence bundle. Acceptance: the harness runs on the three
  existing GT files; the evidence bundle is dated and honest about what
  was not run here (MySQL-dependent steps need the owner's host).
- **P1 — Harden tracking:** U.1 (this branch) → U.2 → U.3 (test first).
  Acceptance per item in §5; each lands with tests, no silent regressions
  on the labelled crossing segment.
- **P2 — Performance:** W2–W6, A1–A3, F1–F3. Acceptance per item in §1;
  every claim has a before/after number.
- **P3 — Features & UX:** §2 per page + §3 smoothness + §4 UI/UX system,
  one page at a time (Analysis first, then Tactics, then Clip Studio).
  Acceptance: each page ships with its component/API tests passing and a
  Playwright check where one exists.
- **P4 — Commercial:** §7 SOP + worksheet + pilot packs; then 3–5 paid
  pilots (owner-led); Phase 4 self-service billing only after pilots.
  Acceptance: a pilot can be delivered by following the SOP alone.

## 9. What this plan deliberately does NOT do
- No edit to the original `awore-otsi` repo; all Muse work lives in
  `ckgefane-blip/otsi-video-intelligence-ultra` on `muse/ultra-main`.
- No push to any remote without the owner's explicit authorisation and a
  write token (CLAUDE.md §8 as it stands).
- No fabricated metric, benchmark number, or accuracy claim. "Not measured"
  is a valid, recorded outcome.
- No paid service, model, licence or cloud GPU (ADR-030, zero-cost).
- No change to the 10 approved screens' visual direction without owner
  approval (CLAUDE.md §1); the UI/UX work in §4 is consistency,
  accessibility and responsiveness within that direction.
