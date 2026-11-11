# ADR-141: AI Analyst — reasoning AI over measured player data (DRAFT, owner approval pending, ultra-only)

- **Status:** Draft. This ADR records the AI Analyst build on `muse/ultra-main`; it needs owner approval before it is
  presented as accepted. It changes no accepted ADR. **Ultra-only:** the number 141 is the next free number in ultra
  (ultra is at ADR-140 after the Token Wallet). Antigravity's repo is at ADR-138 as far as ultra can see; this build
  is written from the scope document alone — no Antigravity code was read or copied — and the two must never be
  merged (see the migration collision note in §1).
- **Date:** 2026-11-11 (Muse, `muse/ultra-main`)
- **Scope:** `workspace/goals/otsi-video-intelligence-engine/files/ai-analyst-scope/ai-analyst-scope.md`
  (scoped 2026-11-11). Roadmap Phase 4 — Sell it, as a premium Scouting Pack feature, after the Token Wallet.
  This build puts the mechanism in place; it does not change anything in Phases 1–3, and it does not touch the
  CV pipeline, the Best Moment Rule, the Profile Intro, or the reel.

## 1. Numbering: migration 0072

Ultra is at migration 0071 (Token Wallet). Antigravity used 0067, 0068, 0069 **and 0070** in their own repo for
different things. This build uses **0072** because it is the next number free in ultra as far as ultra can see.
The migration file records this, and the warning stands: a future collision is still possible if their series
reaches 0072 for something else. If that ever happens, the merge is the problem, not this number — never renumber
a migration that has run anywhere.

## 2. Decisions

### What it is, and what it is not

- A reasoning AI that reads a player's MEASURED data and writes a structured assessment: strengths, development
  areas, concrete recommendations, tactical fit, and a short scout brief — every claim citing the measured evidence
  it came from (event type, count, match, minute/clip), so the user can check it in the video.
- It is an analyst, not a judge. It suggests; the person decides. Nothing it writes goes to a club until a person
  has seen it and published it.
- It is NOT a replacement for the CV pipeline or the Best Moment Rule (they measure and pick; the Analyst reads what
  they produced). NOT a generic chatbot (fixed schema output, no chat box). NOT the command assistant in
  `packages/contracts/src/assistant.ts` (navigation/search routing only — a different name for a different thing,
  untouched by this build). NOT a replacement for the human `PlayerAssessment` (which stays the human's, beside this
  one, clearly labelled as AI-generated). No overall rating or score, ever.

### The guardrail layer (the most important part)

Enforced in **code**, not by asking the model to be careful (scope §5, "unknown beats wrong", ADR-124):

- **Rule 1 — prompt rules.** The system prompt states, in plain terms: use only the input data; cite evidence for
  every number; write "Not measured" with the reason where the input has nothing; never write a rating or score;
  label every recommendation and tactical suggestion as a suggestion. Versioned (`AI_ANALYST_PROMPT_VERSION =
  "1.0"`) and stored with each assessment.
- **Rule 2 — deterministic post-check** (`postCheckAssessment` in `packages/contracts/src/ai-analyst.ts`). After the
  model returns, code validates the output before anyone sees it: schema first (zod); every number extracted and
  checked against the allowed set (numbers present in the measured input, plus per-match counts, per-90 rates and
  shares of the event total — the only stated arithmetic steps); every claim needs at least one evidence link to a
  **real** measured event (same video, event type and minute; count no larger than measured); every event type named
  must be one the engine measures; naming an unmeasured topic (assist, through ball, dribble, save, duel, clearance,
  shot on target, tackle/interception as a fact, xG/xA, rating, progressive pass, PPDA, off-ball run, carry) rejects
  the claim. A failing claim is **dropped** (recorded, never shown); if nothing verifiable remains, or the scout
  brief introduces a number or clip no surviving claim states, the whole output fails. On failure the assessment is
  regenerated once with a stricter prompt; on a second failure the user sees "Analysis could not be verified — try
  again", the 10 tokens are refunded, and no unverified text is stored or shown.
- **Rule 3 — confidence by code** (`confidenceFor`). HIGH needs 5+ matches analysed and 30+ measured events behind
  the claim; MEDIUM is 2–4 matches or a smaller sample; LOW is 1 match or fewer than 5 events behind the claim;
  NOT_ENOUGH_DATA below the minimum. The model may suggest a confidence; code recomputes and overwrites it.
- **Rule 4 — human publish gate.** The output is a DRAFT until a person publishes it (same draft/published pattern
  as the human assessment, with versioning). A stale draft (new match analysed since generation) cannot be published
  until regenerated. The Scouting Pack export hook (`publishedScoutBriefForPack`) returns the brief only for a
  PUBLISHED assessment; a draft returns null, so the bundle (Piece 4) cannot include it by accident.
- **Rule 5 — audit trail.** Every assessment row stores the exact input snapshot the model saw, the output, the model
  name, the prompt version, the post-check result (including dropped claims and why), and the publish state. The
  general audit log records who requested / generated / published / unpublished what, with ids and counts only.
- **Rule 6 — user-entered data is context, never evidence.** Strengths, summary, club, league and international
  career entered by a person are marked "entered by user" in the input; the Analyst may quote them as such but may
  not use them as evidence for a claim about how the player plays.

### Inputs — exactly what it reads (scope §4)

Profile Intro data (name, number, position, OTSI PIN, club + source, nationality, age/DOB, height, weight, foot,
league, international) + `PlayerMeasures` from confirmed tracks only (games analysed, minutes seen on camera, tracks,
distance, top speed, high-speed/sprint metres and count, mean detector confidence, heat map) + events on confirmed
tracks (passes, key passes, passes received, balls won, pressures, shots, goals — each with match and minute) + a
per-match breakdown (event counts per match). **Per-match minutes seen are not split by match**: the engine measures
time seen on camera for the player overall, not per match, so the snapshot says so rather than splitting it by
guesswork. The event list in the snapshot is capped at 200 (stated in the snapshot; the counts are the complete
totals).

The engine does NOT measure — and so the Analyst must NOT assess — assists, through balls, dribbles / 1v1 take-ons,
saves, duels won, clearances, shot on target, tackles / interceptions as facts (balls won are recorded; whether one
was a tackle or an interception is only a possibility), xG / xA, recent form / ratings, progressive passes, PPDA /
off-ball runs, carries. Where any of these is asked about, the Analyst writes "Not measured" with the reason.

**Minimum-data rule:** no confirmed tracks, fewer than 1 full match analysed, or fewer than 5 measured events → the
Analyst writes nothing except "Not enough data" (stored as a DRAFT with the reason; no provider call, no charge).
**Identity gate:** verified OTSI PIN only (the same verified rule as the Profile Intro: registered, at least one track
confirmed by a person). A provisional player gets 409 `IDENTITY_UNCONFIRMED` — "Not enough data — identity
unconfirmed" — never an assessment, and nothing is charged.

### Technical approach — hosted LLM via API (Option A, recommended by the scope)

- The API builds the input snapshot, sends it to a hosted language-model API, receives the structured output, runs
  the deterministic post-check, and stores the assessment. **No raw video is sent to the provider** — structured
  measured data only, with clip timestamps as references.
- **Pluggable provider interface** (`AiAnalystProvider` in `apps/api/src/modules/aianalyst/aianalyst.ts`): one method,
  structured input in, structured output out. The launch implementation is `HostedLlmProvider`, an OpenAI-compatible
  chat-completions endpoint driven by environment (`OTSI_VIE_AI_ANALYST_API_URL`, `OTSI_VIE_AI_ANALYST_API_KEY`,
  `OTSI_VIE_AI_ANALYST_MODEL`, optional `OTSI_VIE_AI_ANALYST_PROVIDER`). The provider and model are recorded with
  each assessment; the API key is read from the environment only — never hardcoded, never stored, never logged, never
  returned. **No provider or model is named here**: the owner decides at deployment time, on quality and price, and
  must pick a provider that offers a no-training-on-data option (scope §7). The per-call model cost still has to be
  measured against the unit-cost worksheet before the 10-token price is final (§7).
- **Option B (local model) is not built.** It stays a later on-premises option for a club that requires it; it would
  implement the same `AiAnalystProvider` interface and nothing else in this module would change.
- **If no provider is configured**, the feature reports "not configured" (GET status, 503 on generate) and never
  fabricates output. That is the state verified in this build: no provider key is configured in this VM.
- **Privacy / opt-in (scope §7 Option A, mandatory):** off by default (no provider configured = off). Structured data
  leaves the machine only with the organization's explicit opt-in: the generate request must carry
  `consent_acknowledged: true`, the UI shows the privacy note and the checkbox before the first analysis, and the
  generating member and time are recorded on the assessment row (`consent_by` / `consent_at`).
- **Timeout:** 120 s per provider call; a timeout or a non-JSON / non-structured answer is a provider failure (refund
  + 502, no text shown).

### Cost — Token Wallet (Piece 2)

- **10 tokens per AI Analyst assessment** — the same as a player report (scope §8). Regeneration costs another 10
  (a new model call, a new row, a new version). A stale assessment regenerated after a new match is a new charge,
  stated plainly before regenerating (the UI shows the cost note on the regenerate button).
- Wired into the wallet: `WalletJobType` gains `AI_ANALYSIS`; `TOKEN_COSTS.aiAnalysis = 10` and the catalogue's
  `costs.ai_analysis = 10`. Charged at enqueue, in the same database transaction as the assessment row (ADR-140
  pattern), so a job that fails to enqueue charges nothing; idempotent per assessment id (`spend:AI_ANALYSIS:<id>`).
  Auto-refund on failure before producing output — including when the post-check rejects the output twice
  (`refundForJob`, same pattern as the player report). No negative balances (the wallet's own rules).
- The minimum-data draft and the identity refusal charge nothing (no model call happened). The "not configured" refusal
  charges nothing.

### API

`apps/api/src/modules/aianalyst/aianalyst.ts` (new module, registered in `app.ts`):

- `GET /v1/players/:id/ai-analysis/status` — provider configured? provider/model? cost (10)? privacy note.
- `GET /v1/players/:id/ai-analysis` — latest assessment, with staleness recomputed against today's data.
- `POST /v1/players/:id/ai-analysis` — generate (draft). Roles: OWNER / ADMIN / ANALYST / SCOUT (the same
  `ASSESSORS` as the human assessment). Body: `{ language, consent_acknowledged: true, regenerate? }`.
- `POST /v1/players/:id/ai-analysis/:assessmentId/publish` — draft → published (a person has read it). Refuses a
  stale draft (409 `AI_ANALYSIS_STALE`), an unverified or not-enough-data row (409 `AI_ANALYSIS_NOT_READY`), and a
  player whose identity is no longer confirmed (409 `IDENTITY_UNCONFIRMED`, the report gate). Idempotent.
- `POST /v1/players/:id/ai-analysis/:assessmentId/unpublish` — published → draft. Idempotent.
- Audit: `ai_analyst.requested` / `.generated` / `.published` / `.unpublished` / `.not_enough_data` / `.unverified`
  via `recordChange` (ids and counts only; the snapshot lives in the assessments table, not the audit log).

### Storage — migration 0072

One new table, `ai_analyst_assessments`: id, organization, player, status (DRAFT/PUBLISHED), language, input_snapshot
(JSON), output (JSON, null while unverified or not-enough-data), model, prompt_version, post_check (JSON), stale,
not_enough_data_reason, failure, requested_by, consent_by/at, published_by/at, version, timestamps. Nothing existing
is altered. `tools/db/roles.py` builds grants from the live schema, so re-run it after migrating — the table gets the
usual SELECT/INSERT/UPDATE/DELETE for `otsi_app` (publish/unpublish update the row; it is not append-only history).

### Web UI

- Player Report "AI Analyst" panel (`apps/web/src/components/playerreport/AiAnalystPanel.tsx`, rendered by
  `Bottom.tsx` below the reference's sections; `ReportStage` passes `extra={600}` so the stage has room). It shows
  the assessment beside the human assessment, clearly labelled "AI-generated — draft until published": strengths,
  development areas, recommendations (with the action and a "Suggestion, not a fact" label), tactical fit (same
  label), scout brief (summaries, what to watch, key clips), "Not measured" list, evidence links (match + minute,
  opening the clip in Analysis at that minute), confidence badges with a visible warning on Low, the data basis
  (matches, minutes seen on camera, events, model, date), and publish / unpublish / regenerate controls. Generate
  and regenerate need the consent checkbox ticked. A stale draft cannot be published until regenerated.
- Fixed labels come from the i18n dictionaries (`body.aiAnalyst`, EN/RU/ES/DE/FR — translations are Muse's, not
  native-speaker reviewed); the model is asked to write the assessment itself in the user's language. The evidence
  (numbers, match, minute) does not change with language.

### Scouting Pack export hook (Piece 4)

`publishedScoutBriefForPack(assessment)` in the contracts: returns the scout brief only when the assessment is
PUBLISHED, null otherwise (including a published assessment with no brief). The Scouting Pack bundle (Piece 4) calls
this; a draft is never exported. No Pack code is built here.

## 3. What was verified here

- Contracts typecheck clean; API typecheck clean apart from the 4 known pre-existing errors (pressing.ts `sliceFor`,
  exports.ts, test/events.api.test.ts, test/load.api.test.ts); web typecheck clean apart from the 1 known pre-existing
  error (test/formationsPanel.test.tsx `assigned_by`).
- Web vitest: 75 files / 359 tests pass, including the 24 new tests in the two files below (18 guardrail + 6
  panel). New: `apps/web/test/aiAnalyst.test.ts` (18 tests: confidence
  by code, minimum-data rule, post-check accept/drop/reject cases including adversarial assists/ratings/xG/invented
  numbers/fake evidence/brief inventing a claim, export-gate, staleness, prompt rules, cost) and
  `apps/web/test/aiAnalystPanel.test.tsx` (6 tests: claims + evidence links + Low warning, not-configured state,
  consent-gated generate, publish/unpublish, stale publish refusal, not-enough-data). Both run here without MySQL or
  a provider key.
- Web production build: 25/25 pages.
- API build (`tsc -p tsconfig.build.json`) emits `dist/modules/aianalyst/` (the same 2 pre-existing errors as the
  typecheck, in pressing.ts and exports.ts, are the only ones reported).
- **Not verified here:** no live LLM assessment (no provider key is configured in this VM — the feature was verified
  in its "not configured" state plus unit tests, as the task required); no click-through; the API HTTP tests
  (`apps/api/test/aiAnalyst.api.test.ts`: status, identity refusal, consent requirement, not-enough-data draft with no
  charge, publish-404s) need MySQL 8.4 on 127.0.0.1:3507 on the owner's host and were **not run**; migration 0072 has
  not been applied anywhere.

## 4. Known gaps (honest)

1. **No provider is configured or named.** The owner must choose a provider + model (quality and price, with a
   no-training-on-data option) and set the three environment variables; until then the feature answers "not
   configured". The per-call model cost has not been measured, so the 10-token price is a recommendation until it is
   validated against the unit-cost worksheet (scope §8) — if the measured cost is higher than 10 tokens cover, the
   cost is raised (to 15) or the model is changed.
2. **Per-match minutes seen are not in the input** (§2): the engine measures time seen on camera overall, not per
   match. The Analyst can say whether a pattern holds across matches from event counts, not from per-match time.
3. **The post-check's initial `post_check` placeholder** ("verification pending") is written with the row at enqueue
   and overwritten by the real result in the same request, before any read can see it. It exists only because the
   charge and the row share one transaction.
4. **The model is asked for `confidence` in its output, which code then overwrites.** The field is optional in the
   input schema; a model that omits it is fine. The stored assessment never carries a model-chosen confidence.
5. **Translations are Muse's, not native-speaker reviewed** (RU/ES/DE/FR panel labels and the model's output
   language are both unreviewed). The fixed labels fall back to English where a translation is missing.
6. **The panel was not clicked through live** (no host run here) and the assessment has never been generated against
   a real provider — the first real assessment must be inspected by a person for quality before anything is published.
7. **The host runbook for migration 0072**: apply with the real migrator on the owner's host, then re-run
   `tools/db/roles.py` (it builds grants from the live schema), then run `apps/api/test/aiAnalyst.api.test.ts`.

## 5. Open decisions for Awore (from the scope, unchanged)

- Hosted vs local model: hosted is built (Option A); local stays a later on-premises option.
- Which hosted provider / model: not named — decide at deployment time, on quality and price, with a no-training
  option; record it in this ADR when chosen.
- Token cost: 10 recommended; confirm after measuring the per-call model cost (§2, gap 1).
- Languages at launch: all four (RU/ES/DE/FR) from the start, as built; the owner may narrow it.
- Timing: Phase 4 after the pilots (recommended), or earlier if the pilots ask for it.
- Confidence thresholds and the minimum-data rule: the scope's proposed numbers, as built; confirm or change them.
