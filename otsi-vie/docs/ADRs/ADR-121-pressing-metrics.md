# ADR-121: Pressing Metrics (High Press Success, Final Third Regains, Avg Press Height)

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase E.7: Pressing metrics
- **Migration:** None (Aggregates detected match events and pitch observations)

## Context

In tactical performance analysis and scouting, pressing metrics quantify how effectively and aggressively a team defends without the ball:
1. **High Press Success:** Measures how often pressing initiated in the opposition's half results in winning possession back within 5 seconds (`regain: true`).
2. **Final Third Regains:** Measures ball recoveries won specifically in the opponent's defensive third (the pressing team's attacking third).
3. **Average Press Height:** Measures where on average along the pitch axis a team applies pressure, measured as a distance (metres) from their own defending goal line and as a percentage of pitch length.
4. **Evidence Rules:**
   - When pitch calibrations cover the moment, player positions are accurately placed on the pitch coordinate system.
   - When pitch calibrations do not cover the moment, pitch heights and final third categorizations are honestly marked unmeasured (`null`), never guessed or fabricated.
   - Any event candidate rejected by an analyst via `event_decisions` (ADR-118) must be completely excluded from pressing metrics, counts, and pitch visualizations.

## Decision

1. **Contracts (`packages/contracts/src/pressing.ts`):**
   - Added `PressingPoint`: records pressure instance coordinates (`pitch_x`, `pitch_y`), height from defending goal (`press_height_m`, `press_height_pct`), boolean flags (`regain`, `is_high_press`, `is_final_third`), and player identities.
   - Added `TeamPressingStats`: team-level aggregates for total pressures, regains, overall success %, high press count and success %, final third regains, and average press height.
   - Added `PressingAnalysis`: match video payload returned by the API.
   - Exported through `packages/contracts/src/index.ts`.

2. **Backend API (`apps/api/src/modules/analysis/pressing.ts`):**
   - Added `GET /v1/videos/:id/pressing` (`@UseGuards(AuthGuard)`):
     - Scoped to caller's organization.
     - Fetches latest completed ball track and detected `PRESSURE` events.
     - Excludes any event marked `REJECT` in `event_decisions` (E.1).
     - Correlates with `match_periods` to track match halves and end changes.
     - Resolves pitch positions via `pitch_calibrations` and `track_observations` bounding boxes.
     - Computes defending direction per kit group, press height, and final third bounds.
     - Registered `PressingController` and `PressingService` in `apps/api/src/app.ts`.

3. **Web UI (`apps/web/src/components/tactics/`):**
   - Built `PressingPanel.tsx` (section `p05-s07`):
     - Renders live metrics: High Press Success (% and N/M count), Final Third Regains count, and Avg Press Height (metres and %).
     - Renders interactive clickable dots on the calibrated `<Pitch />` map (blue `●` for press, green `◆` for regain), with click-to-seek functionality to the pressure timestamp.
     - Gracefully falls back with `NotMeasured` badge when uncalibrated.
     - Connected into `Panels.tsx` and `TacticsStage.tsx`.

4. **Automated Verification:**
   - Integration tests in `apps/api/test/pressing.api.test.ts` verifying uncalibrated graceful degradation, calibration coordinate mapping, metric calculations, ADR-118 event decision rejection filtering, and tenant isolation (1/1 passed).
   - Component unit test in `apps/web/test/pressingPanel.test.tsx` (1/1 passed).
   - Full web test suite: 58 test files, 238 passed in 21.18s.
