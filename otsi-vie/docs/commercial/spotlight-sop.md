# Option B Managed Service — Spotlight-on-Demand SOP

- **Status:** Draft — owner approval pending. This is a process document, not a product change. It changes no code, no config, and no UI.
- **Scope:** delivering the Option B Managed Service to a paying client: one match in, a Single Match Spotlight and/or a Scouting Pack out, invoiced by bank transfer.
- **Branch:** `muse/ultra-main` (ultra repo). Base: `a721d36`. Companion document: `unit-cost-worksheet.md` (+ `unit-cost-worksheet.csv`) in this directory.
- **Blueprint:** `otsi-vie/docs/ULTRA_ENHANCEMENT_BLUEPRINT.md` §7 (Option B — Commercial SOP) and §8 P4.

## 0. Principles — read first, they decide every step below

1. **Unknown beats wrong (ADR-124, CLAUDE.md).** A metric the evidence cannot support is delivered as `NOT_MEASURED` with the reason, or not delivered at all. Never ship an unmeasured number, never estimate an accuracy figure for a client, never fill a gap with a plausible-looking value.
2. **Rights and billing are checked twice (ADR-007).** At enqueue AND at delivery. Each check is recorded in `policy_decisions`. A revocation between the two blocks delivery, and `artifact_dependencies` blocks derived renders from the revoked source.
3. **No payment gateway by design (Option B).** Clients pay by bank-transfer invoice. The provider-checkout flow in `blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/06_COMMERCIAL_BILLING_AND_ADMIN.md` (hosted checkout, webhooks, quota metering) is Phase 4 only. Do not build, enable, or promise it during Phases 0–3.
4. **Human verification is the product.** The engine proposes; a person confirms. Rejected events disappear from every deliverable (ADR-118). Roles and identities are only ever `ROLE_CONFIRMED` by a person (ADR-122). Nothing is delivered on engine output alone.
5. **Every step names an owner and leaves evidence.** If a step has no evidence artifact, it did not happen. The evidence column in each table below is mandatory, not decorative.

## 1. Roles

| Role | Who | Does |
|---|---|---|
| **Owner** | Awore (account `Owner`) | Approves prices, approves pilot clients, approves gate flips (G05–G08), sends invoices, owns the Phase 0/Phase 2 sign-offs. |
| **Analyst** | A named analyst account (`ANALYST` role) | Intake, calibration check, human review, delivery preparation, dry-run execution. Every analyst action is attributed to their user id in the audit trail. |
| **Engine** | The VIE worker + API (automated) | Ingest, detection, tracking, ball, appearance, events, rendering. Records model versions, run ids, and pipeline steps. It never approves, confirms, or invoices. |
| **Client** | The paying club / academy | Sends the match video and team sheet, confirms rights, receives the pack, pays the invoice. |

No step in this SOP is performed by a role other than the one named. In particular, the engine never performs a human-review step and the analyst never edits engine output in place — corrections go through the decision tables (`event_decisions`, `formation_decisions`, role confirmation), which are append-only.

## 2. Phase map — where this SOP fits

| Phase | What | Gate to leave it |
|---|---|---|
| **Phase 0 — Gate** | Benchmark accuracy on licensed holdouts (Track G) + measure compute/analyst unit costs (worksheet). | G05–G08 measured against the thresholds in §6, and the worksheet filled with measured numbers. No price is set before this. |
| **Phase 1 — Packs** | Single Match Spotlight + Scouting Pack. Team Tactical held back (see §8). | SOP + worksheet exist and are followed without inventing a step (this document). |
| **Phase 2 — Dry-run** | Run this SOP end to end on a non-paying internal match; fill the worksheet with real timings; fix the SOP where it breaks. Checklist in §11. | Owner signs the dry-run record. |
| **Phase 3 — Paid pilots** | 3–5 paid pilots to clubs / academies, owner-led. | Each pilot delivered by following this SOP alone. |
| **Phase 4 — Scale** | Option A Self-Service (provider checkout, quota metering, billing portal). | Only after pilots. Out of scope for this SOP. |

## 3. Intake — what the client sends, what is confirmed

Owner: **Analyst**. Evidence: the intake record (video id, client, match, rights confirmation) and the `policy_decisions` row for the enqueue check (§4).

| # | Step | Evidence |
|---|---|---|
| 3.1 | Client sends: (a) the match video file or a link (YouTube / Hudl / Wyscout — see ADR-023/ADR-027 for link import), (b) the team sheet (both teams, squad numbers, and the featured player if the Spotlight is for one player), (c) the match identity (competition, date, home/away). | Intake record on the video: source, competition, date, teams. |
| 3.2 | Confirm with the client, in writing, that they hold the rights to have this match analysed and to receive reels/reports from it. Record who confirmed, when, and what rights were confirmed (produce + export/delivery are separate rights — ADR-007). | Rights confirmation note on the intake record. **No confirmation → stop. Do not enqueue.** |
| 3.3 | Confirm the deliverable: Single Match Spotlight, Scouting Pack, or both (§8). Confirm the featured player for a Spotlight, and the players in scope for a Scouting Pack. | Intake record: pack(s) ordered, players in scope. |
| 3.4 | Confirm the price basis: the price is set from the worksheet (§10) after Phase 0 — it is not negotiated per match from an unmeasured cost. If Phase 0 is not complete, the match is a dry-run or a pilot at an owner-approved price, and the client is told so. | Owner approval note (price basis) on the intake record. |
| 3.5 | Check the video is technically ingestible before promising a date: container/codec the engine accepts (bad codecs are rejected at ingest — G02), file size within the upload limit, and a playable duration. A link import is verified by fetching it, not by trusting the URL. | Ingest pre-check result. |

**Open inputs for the owner:** upload size limit for a client match; the intake channel (email / form / direct upload); invoice terms (due days, currency) — see §9.

## 4. Rights and billing gate #1 — at enqueue (ADR-007)

Owner: **Engine** (enforces) + **Analyst** (supplies the rights confirmation from §3.2). Evidence: `policy_decisions` row.

1. The analyst creates the job only after §3.2 is recorded.
2. The engine checks produce rights and billing entitlement at job creation and records the decision in `policy_decisions`.
3. **If the check fails:** the job is not created, no compute is spent, the analyst tells the client what is missing, and the intake record notes the block. Do not work around it.
4. **If rights are revoked after enqueue but before delivery:** the delivery gate (§8.5) catches it. The work already done is not delivered and derived renders are blocked via `artifact_dependencies`.

## 5. Ingestion and processing — what runs, in what order

Owner: **Engine** (runs) + **Analyst** (watches, intervenes only on failure). Evidence: the run record (`pipeline_steps`, run id, model versions) and the job metrics.

Processing order is the engine's pipeline; the analyst does not reorder it:

| # | Step | What happens | Evidence |
|---|---|---|---|
| 5.1 | **Ingest** | Upload / link import, checksum validation, codec check, presentation timestamps. Bad codec or corrupt file → job fails here, client is told, no further cost is incurred. | Ingest job record; checksum. |
| 5.2 | **SHOTS** | Shot segmentation and kickoff scan (`scan_for_kickoff`). | `pipeline_steps` SHOTS SUCCEEDED. |
| 5.3 | **DETECT** | Player / ball detection (RT-DETR, registry model; model version recorded with the run). | `pipeline_steps` DETECT SUCCEEDED; model version id. |
| 5.4 | **TRACK** | Multi-object tracking (Kalman + Hungarian; Track U hardening U.1–U.4 where enabled). | `pipeline_steps` TRACK SUCCEEDED. |
| 5.5 | **IDENTIFY** | Appearance / Re-ID and jersey-number reading (Track U U.2/U.5/U.6 where enabled). Identities are **provisional** until a person confirms them (§7). | `pipeline_steps` IDENTIFY SUCCEEDED or CANCELLED (if appearance is off). |
| 5.6 | **Ball** | Ball tracking (`ball_job`): flight (U.9), bounce/rolling handover (U.10), identity rule and veto (U.11/U.12) where enabled. | Ball job metrics (`ball_flight`, `ball_handover`, `ball_identity`, `ball_veto` flags as configured). |
| 5.7 | **Pitch calibration** | Automatic pitch calibration (ADR-036) where the shot allows it. If calibration fails or is not possible, tactical metrics are `NOT_MEASURED` (ADR-124) — the match still proceeds for Spotlight/Scouting Pack, which do not need a calibrated pitch. | Calibration record per shot; uncalibrated shots listed. |
| 5.8 | **Events** | Passes, possession changes, shots, pressures, set pieces, goals detected from tracks (ADR-119/ADR-121). | Event candidates in the analysis workspace, all undecided. |

**Run configuration is part of the record.** Every Track U feature (U.1–U.12) is off by default behind a config flag in this branch. Which flags are on for a paid match is an **owner decision**, recorded in the run config and the run metrics — not an analyst improvisation per match. The run config, model versions, and detection/tracking settings are stored with the run so a delivered pack can be reproduced and audited.

**If a step fails:** the run records the step as FAILED with an error code (`_fail` in `analyze.py` cancels the remaining queued steps). The analyst tells the client what failed and whether a re-run is possible; a failed run is never delivered as if it had succeeded, and its partial outputs are never handed to the client.

## 6. Quality gates — what must pass before anything is delivered

Owner: **Analyst** (checks) + **Owner** (flips a gate). Evidence: the Track G benchmark bundle in `release-evidence/<build_sha>/` and the release-gates record (`GET /v1/admin/release-gates`).

The gates that govern a paid delivery are G05–G08. Their thresholds are the provisional thresholds frozen in `apps/api/src/modules/admin/admin.ts` (ADR-117) — they change only by a signed ADR plus data review, never by editing a number to clear a failure.

| Gate | What it measures | Threshold (frozen) | Evidence required |
|---|---|---|---|
| **G05 — Detection Accuracy** | Player, referee, ball bounding boxes across lighting | Recall ≥ 82%, Precision ≥ 88% on 5 licensed holdout matches | Benchmark bundle from `tools/eval/sukhum_benchmark.py` on licensed holdouts |
| **G06 — Tracking Continuity** | Identity preservation across cuts, occlusions, scrums | HOTA ≥ 55%, IDF1 ≥ 68%, ID switches ≤ 0.8 per match minute | Same bundle; MOTA/IDF1/HOTA from `vie_worker.evaluation.evaluate()` |
| **G07 — Autonomous Player Identity** | Jersey OCR, embeddings, multi-track association | False association rate ≤ 2.0% (strict "unknown beats wrong") | Same bundle; no forced or incorrect identity confirmed autonomously |
| **G08 — Tactical & Pitch Calibration** | Homography calibration, team shape, defensive line | Calibration error meets threshold; otherwise metrics are `NOT_MEASURED` | Calibration error distribution; Team Tactical held back until it passes |

**What happens when a gate fails or is unmeasured:**

- **G05/G06/G07 not passed:** the match may still be processed and human-reviewed, but **no accuracy claim is made to the client**. The pack is delivered as analyst-verified content only, with the accuracy banner ("Accuracy not yet measured") left in place and explained to the client. The analyst's review (§7) is what the client is paying for, not a measured accuracy number.
- **G08 not passed:** Team Tactical is **held back entirely** — no formation, pressing, or tactical pack is delivered, and no tactical metric is shown as measured. Metrics that cannot be supported are labelled `NOT_MEASURED` with the reason (ADR-124). This is the standing Option B scope decision, not a per-match judgement.
- **A gate flips to PASSED** only when the benchmark bundle meets the threshold and the flip is recorded in `blueprint/CHANGELOG.md` (Ultra Blueprint §6). The analyst never flips a gate.

**Per-match check (separate from the gates above):** before delivery the analyst confirms the run itself is clean — all pipeline steps SUCCEEDED, no step FAILED, and the review inbox shows no failed job. A match with a failed step is not delivered.

## 7. Human review — the analyst's work

Owner: **Analyst**. Evidence: `event_decisions` (append-only), `formation_decisions` where applicable, role-confirmation records, `audit_events`.

### 7.1 Event accept / reject (ADR-118)

1. The analyst opens the analysis workspace and works through the event candidates in the review inbox.
2. Each event gets one decision: `CONFIRM` (valid), `REJECT` (false positive), `EDIT` (fix boundaries or type), or `NEEDS_REVIEW` (second pair of eyes). A reason is recorded.
3. Rejected events immediately disappear from reels, match summaries, player reports, heat/action maps, and tactical statistics — without mutating or deleting the raw engine detections. The decision is append-only; a later change is a new decision, not an edit of the old one.
4. **Nothing is delivered while events in scope are undecided.** `NEEDS_REVIEW` events are resolved by the owner or a second analyst before delivery.

### 7.2 Identity confirmation (ADR-122, ADR-016, ADR-033)

1. Every player identity in a delivered pack must be `ROLE_CONFIRMED` by a person, with `role_confirmed_by` and `role_confirmed_at` recorded. Provisional roles (`ROLE_PROVISIONAL`) never appear in a delivered pack as if confirmed.
2. Jersey numbers are confirmed against the team sheet from intake (§3.1), not against the OCR reading alone. Where OCR and the team sheet disagree, the team sheet wins and the discrepancy is noted.
3. Substitutes, referees, and similar-number players are checked explicitly (G07). If an identity cannot be confirmed, the player is delivered as **unknown**, never as a guess.

### 7.3 Evidence rules — what may not be shown (ADR-124)

The following are delivered only when their evidence validator passes; otherwise they are `NOT_MEASURED` with the reason:

- Tackles, interceptions, progressive passes, PPDA, off-ball runs, offside line, chances created, carries — each needs its stated sensor/tracking evidence (duel contact, ball flight, calibrated pitch, sample size, and so on).
- **xG / xA are always `NOT_MEASURED`.** VIE does not fabricate expected goals without a calibrated high-density event dataset. No exception for a paying client.
- Any metric that depends on a calibrated pitch is `NOT_MEASURED` on uncalibrated shots.

The analyst checks the evidence audit (`GET /v1/videos/:id/evidence-audit`) before delivery and removes or relabels anything that fails its validator.

## 8. Delivery — what the client gets

Owner: **Analyst** (prepares) + **Engine** (renders). Evidence: the delivered artifact ids, the `.otsi-archive.zip` manifest, and the delivery-gate `policy_decisions` row.

### 8.1 Single Match Spotlight — in / out

| In | Out |
|---|---|
| Highlight reel of the featured player's confirmed moments (rejected events excluded, ADR-118) | Any moment from a rejected event |
| Player measures from measured positions: speed, distance, passes, key passes (each with its evidence state; unmeasured shown as `NOT_MEASURED`) | xG / xA (always `NOT_MEASURED`, ADR-124) |
| `.otsi-reel` manifest + `.otio` timeline for the reel (ADR-103) | Tactical analysis (see §8.3) |
| Portable `.otsi-archive.zip` (`otsi-archive/v1` + `audit-extract.json`, ADR-104) so the client can verify what was delivered | Any player identity that is not `ROLE_CONFIRMED` |

### 8.2 Scouting Pack — in / out

| In | Out |
|---|---|
| Everything in the Spotlight, for each player in scope | Everything excluded from the Spotlight |
| Player Report per player in scope: confirmed events, measures, heat/action maps (rejected events excluded) | Unconfirmed metrics, labelled `NOT_MEASURED` with reasons |
| Cross-match smart search context where the player appears in other analysed matches (ADR-120), if the client is entitled to it | Any other club's players or data outside the client's entitlement |
| Role/cohort lines using person-confirmed roles only (ADR-122) | Provisional roles presented as confirmed |

### 8.3 Team Tactical — held back, and why

Team Tactical (formations by name, formation stability, defensive line, pressing metrics, PPDA, team shape) is **not delivered** under Option B Phase 1–3. Reasons, all recorded: G08 is `MEASURING` (calibration error threshold unmet — `admin.ts`); ADR-124 validators for pressing/PPDA/offside require calibrated pitch coverage and sample sizes that are not yet demonstrated on licensed holdouts; the Blueprint (§7) and the release-gates record both state the hold-back explicitly. It is released only when G08 passes and the owner approves the release. The client is told this at intake (§3.3), not at delivery.

### 8.4 Rendering

Renders use the headless `vie-render` path with a low-resolution proxy preview of the Spotlight effect before the full render, so the preview is not a different effect (Ultra Blueprint §1). The render is recorded with its model and render versions; a re-render after a review decision produces a new artifact, it does not overwrite the old one (ADR-003 immutable media artifacts).

### 8.5 Rights and billing gate #2 — at delivery (ADR-007)

1. Before the pack leaves the tenant, the engine re-checks produce + export/delivery rights and billing entitlement, and records the decision in `policy_decisions`.
2. **If the check fails** (e.g. rights revoked since enqueue): delivery is blocked, the client is told, and derived renders are blocked via `artifact_dependencies`. The analyst does not send the files by another channel.
3. Delivery itself is a recorded handoff: artifact ids, archive hash, recipient, date. The client receives the `.otsi-archive.zip` and the reel/report files; the engine keeps the run record.

## 9. Invoicing — bank transfer, no gateway

Owner: **Owner** (sends) + **Analyst** (confirms delivery happened). Evidence: the invoice record and the delivery record it references.

1. **Trigger:** the invoice is raised only after delivery (§8) is recorded. No invoice before delivery, no invoice for a failed or blocked delivery.
2. **Who:** the owner sends the invoice to the client. The analyst does not invoice.
3. **How:** bank-transfer invoice. No checkout link, no card payment, no Stripe/Paystack/Flutterwave — there is no gateway code in the product and none is to be improvised for a pilot (assessment 2026-11-10: grep for `stripe|paystack|flutterwave|checkout` across `apps/` and `packages/` returns no hits).
4. **What the invoice references:** client, match, pack(s) delivered, delivery date, archive id/hash, and the price basis from §3.4 / the worksheet (§10).
5. **Payment tracking:** payment is recorded against the invoice when the transfer arrives. Past-due handling, refunds, and cancellations are owner decisions, recorded on the invoice — there is no automated dunning or refund flow in Option B.

**Open inputs for the owner:** invoice numbering scheme; payment terms (due days); currency; tax treatment; late-payment handling. None of these exist in the repo and none are invented here.

## 10. Unit costs — the worksheet

The per-match unit cost is established in `unit-cost-worksheet.md` / `unit-cost-worksheet.csv` (same directory). The SOP's rule is simple: **no price is set from an unmeasured cost.** The worksheet has input cells for everything not yet measurable (host cost per GPU-hour, minutes per pipeline step, analyst minutes per review step) and the totals follow from the inputs. Phase 0 is complete when the worksheet is filled with measured numbers from real runs, not before. The dry-run (§11) is the first source of measured numbers.

## 11. Phase 2 dry-run checklist

Owner: **Analyst** (runs) + **Owner** (signs off). Evidence: the dry-run record, the filled worksheet, and the SOP fixes it produces.

- [ ] Pick an internal (non-paying) match with a team sheet. Record intake per §3.
- [ ] Run §4–§5 end to end. Record wall-clock minutes per pipeline step for the worksheet.
- [ ] Run the Track G harness (`tools/eval/sukhum_benchmark.py`) against the match's ground truth if labelled; if unlabelled, record `NOT MEASURED` and do not claim a number.
- [ ] Complete human review per §7. Record analyst minutes per review step for the worksheet.
- [ ] Attempt delivery per §8, including the delivery rights check. Record anything the SOP did not cover.
- [ ] Raise a test invoice (marked TEST, never sent) per §9 to prove the workflow.
- [ ] Apply retention defaults per §12 and verify the trash/erasure paths.
- [ ] Owner reviews the dry-run record, the filled worksheet, and the SOP fixes, and signs off Phase 2. Only then do paid pilots start.

## 12. Retention and GDPR erasure (ADR-112)

Owner: **Owner / Admin** (policy) + **Analyst** (executes erasure requests). Evidence: `org_retention_policies`, `subject_erasure_requests`, `audit_events`.

- Retention is tenant-level and configurable: Trash `trash_days` (default 30), `raw_footage_days`, `rendered_reels_days`, `audit_log_days` (default 365, minimum 30). Defaults apply unless the owner sets otherwise for the client; the policy in force for a delivered match is recorded with the delivery.
- Deleted items sit in Trash with a visible expiry countdown (`expires_at`, `days_remaining`); purge is manual (`POST /v1/admin/retention/trash/purge`) or automatic only if `auto_purge_enabled` is set. Nothing is purged silently.
- **Subject erasure (GDPR Art. 17):** a player or user erasure request is recorded in `subject_erasure_requests`, executed by pseudonymising the subject and clearing references, and summarised in the request record. Tracking continuity and the append-only audit history are not corrupted by an erasure; audit events are retained per `audit_log_days` and legal-hold checks apply before any deletion.
- A client asking for their match footage to be deleted gets the erasure path, not a manual file delete: the request, the execution, and the summary are all recorded.

## 13. What this SOP does not cover

- **Phase 4 (Option A Self-Service):** provider checkout, subscriptions, quota metering, billing portal — see `06_COMMERCIAL_BILLING_AND_ADMIN.md`. Out of scope until after pilots.
- **Standalone pilot-pack scope sheets** (`pilot-packs.md`): the in/out tables in §8 are the scope; a standalone sheet per pack is follow-up work if the owner wants client-facing sheets.
- **Prices, rates, and runtimes:** none are stated in this SOP. They live in the worksheet as inputs, filled from measurement.
- **Model or threshold changes:** G05–G08 thresholds change only by signed ADR + data review (ADR-117 / `09_RELEASE_AND_TEST_MATRIX.md`).

## 14. Open decisions for the owner

1. Upload size limit and intake channel for a client match (§3.5).
2. Invoice numbering, payment terms, currency, tax treatment (§9).
3. Which Track U flags are on for a paid match, and the run-config default for pilots (§5).
4. Retention policy per client vs the defaults in §12.
5. Approval of this SOP and of ADR-125 (Track G benchmark), ADR-126 (U.9), ADR-127 (U.10), ADR-128 (U.11), ADR-129 (U.12) — all drafts pending owner approval at the time of writing.
6. The Sukhum footage pick that unblocks the first real Track G number and the first measured worksheet (no footage in the repo at the time of writing).
