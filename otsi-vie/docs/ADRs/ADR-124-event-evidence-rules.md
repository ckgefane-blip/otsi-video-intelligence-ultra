# ADR-124: Rigorous Event Evidence Rules for Unconfirmed Engine Event Types

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase E.6: Event types shown but unconfirmed in the engine

## Context

In automated football tactical analytics and video intelligence engines, several event types and tactical metrics are frequently shown in marketing previews or speculative designs without rigorous sensor confirmation. These include:
- **Tackles**: Often conflated with general possession changes or aerial interceptions;
- **Interceptions**: Mistakenly recorded when balls are merely lost or miscontrolled at the feet;
- **Progressive Passes**: Forward passes reported without calibrated pitch coordinates or length thresholds;
- **PPDA (Passes Allowed Per Defensive Action)**: Displayed as arbitrary ratios without verifying defensive 60% coordinates or minimum sample sizes;
- **Off-ball Runs**: Highlighted without pitch-plane tracking, velocity thresholds, or possession verification;
- **Offside Line**: Drawn without wide-camera frustum guarantees that confirm all defenders are on-screen;
- **Chances Created / Shot Assists**: Claimed without verifying that the pass directly assisted a confirmed shot;
- **xG / xA**: Fabricated from simple distance heuristics rather than genuine high-density statistical shot models;
- **Carries**: Counted without tracking continuous ball-foot proximity over verified distance thresholds.

OTSI VIE Core Directive:
> **Never fabricate any metric. Unknown or unmeasured beats wrong or fabricated.**
> Where sensor and tracking evidence is insufficient, honestly mark "Not measured" with clear, specific reasons rather than showing misleading or fabricated values.

## Decision

1. **Shared Contracts & Evidence Specifications (`packages/contracts/src/evidence-rules.ts`):**
   - Established `EvidenceVerificationState`: `MEASURED`, `PROVISIONAL`, `NOT_MEASURED`.
   - Defined strict sensor and tracking validators for each event type:
     - **Tackle (`validateTackleEvidence`)**: Requires opposing tracks in physical duel contact (< 1.8m), ball proximity (< 1.5m), ball carrier velocity deceleration (> 1.2 m/s²), and confirmed possession transfer. Uncalibrated pitch yields `PROVISIONAL` ("Possible Tackle"); missing duel flip yields `NOT_MEASURED`.
     - **Interception (`validateInterceptionEvidence`)**: Requires opposing teams, ball in flight trajectory (speed >= 4 m/s), interceptor ball control (< 1.2m), and physical separation from passer (> 2.5m). Close-contact duels (< 2.5m) or uncalibrated tracks are kept `PROVISIONAL` or `NOT_MEASURED`.
     - **Progressive Pass (`validateProgressivePassEvidence`)**: Requires calibrated pitch coordinates and forward progression of >= 30m in defensive third, >= 15m in middle third, or >= 10m into penalty area. Uncalibrated passes or passes with insufficient progress are honestly marked `NOT_MEASURED`.
     - **PPDA (`validatePPDAEvidence`)**: Requires pitch calibration covering the opponent's defensive 60% and a statistically valid sample (>= 10 opponent passes and >= 3 defensive actions). When uncalibrated or sample is too small, strictly marked `NOT_MEASURED`.
     - **Off-ball Run (`validateOffBallRunEvidence`)**: Requires player without ball maintaining sustained velocity >= 18 km/h (5.0 m/s) over >= 1.5s with pitch-plane tracking. Below threshold or uncalibrated yields `NOT_MEASURED`.
     - **Offside Line (`validateOffsideLineEvidence`)**: Requires calibrated pitch homography and camera frustum wide enough to guarantee no deeper defender is off-screen. If off-screen defenders are possible, strictly marked `NOT_MEASURED`.
     - **Chances Created (`validateChanceCreatedEvidence`)**: Strictly defined as a pass directly assisting a confirmed shot. Unconfirmed shots yield `PROVISIONAL` or `NOT_MEASURED`.
     - **xG / xA (`validateXgEvidence`)**: VIE does not fabricate expected goals without an integrated calibrated high-density event dataset. Always strictly reported as `NOT_MEASURED`.
     - **Carries (`validateCarriesEvidence`)**: Requires continuous ball-foot possession >= 5.0m travel distance on a calibrated pitch. Below threshold or uncalibrated yields `NOT_MEASURED`.
   - Defined `VideoEvidenceAudit` schema for comprehensive audit reporting.

2. **Backend API Audit & Service (`apps/api/src/modules/analysis/evidence.ts` & `pressing.ts`):**
   - Implemented `EvidenceAuditService` and `EvidenceAuditController` exposing `GET /v1/videos/:id/evidence-audit`, providing automated audit validation across all 9 sensitive metric types.
   - Enhanced `PressingService` (`pressing.ts`) to calculate PPDA in opponent's defensive 60% using calibrated passes and pressures, returning `ppda`, `ppda_status`, and `ppda_reason` with honest evidence status.
   - Registered `EvidenceAuditController` and `EvidenceAuditService` in `apps/api/src/app.ts`.

3. **Web UI Audit & Explanations (`apps/web/src/components/`):**
   - **Pressing Map (`PressingPanel.tsx`)**: Wired live `PPDA` from `PressingAnalysis.teams`, rendering measured number when available or `—` with honest explanation tooltip (`data-metric="PPDA"`).
   - **Player Inspector (`PlayersPanel.tsx`)**: Replaced generic placeholders with metric-specific honest explanations:
     - `Touches`: "Not measured: requires full-match ball-touch sensor tracking."
     - `Pass Accuracy`: "Not measured: incomplete passes without possession change are not tracked."
     - `Chances Created`: "Not measured: requires calibrated pass events directly assisting verified shots."
     - `Shot Assists`: "Not measured: requires calibrated pass events directly assisting verified shots."
     - `Progressive Passes`: "Not measured: requires calibrated pitch coordinates for pass start and reception (>= 30m in defensive 1/3, >= 15m in middle 1/3, >= 10m into box)."
   - **Tactics Stage (`Panels.tsx`)**: Added specific honest evidence explanations to off-ball runs:
     - `Total Off-Ball Runs`, `Progressive Runs`, `Runs Into Box`, `Avg Run Distance` (`data-offball-metric`).

4. **Automated Verification:**
   - API unit & integration tests in `apps/api/test/evidenceRules.api.test.ts` (6 passed in 282ms) covering tackle, interception, progressive pass, PPDA, off-ball run, xG/xA non-fabrication, and the `/v1/videos/:id/evidence-audit` endpoint.
   - Web component tests in `apps/web/test/evidenceRules.test.tsx` (2 passed in 113ms) verifying PPDA and off-ball runs honest tooltips.
   - Full web test suite: 61 test files, 242 tests passed in 17.40s.
   - Production Next.js build compiled successfully (25/25 static routes).
