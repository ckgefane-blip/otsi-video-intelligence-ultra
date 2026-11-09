# ADR-123: Tactical Formations by Name from Calibrated Positions

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase E.3: Formations by name
- **Migration:** `database/migrations/0066_formation_decisions.sql`

## Context

In tactical intelligence and match analysis, coaches and analysts evaluate team structures through recognizable canonical formations (e.g. 4-3-3, 4-2-3-1, 4-4-2, 3-5-2, 3-4-3, 5-3-2, 5-4-1).
Previously:
1. Formation was reported as unmeasured (`—`) because determining lines required calibrated 2D pitch coordinates, defending direction, and player clustering.
2. Even when automated algorithms infer a formation, analysts require transparency and accountability: an algorithmically derived formation must be clearly designated `INFERRED`, while allowing analysts to inspect, confirm, or override it (`CONFIRMED`).
3. Metrics including Formation Stability (% of moments adhering to primary formation) and Defensive Line Height (metres and % from defending goal line), as well as tactical phase shapes (Build-up in possession vs Defensive out of possession), must be derived honestly from calibrated observations without guesswork.

## Decision

1. **Database Schema (`0066_formation_decisions.sql`):**
   - Created table `formation_decisions` (`id`, `organization_id`, `video_id`, `kit_group`, `period`, `formation_name`, `state`, `decided_by`, `reason`, `decided_at`).
   - Check constraints enforce `state IN ('INFERRED', 'CONFIRMED')` and `period IN ('FULL', 'H1', 'H2')`.
   - Added to `APPEND_ONLY` tables in `tools/db/roles.py` with `GRANT SELECT, INSERT` privileges for runtime role `otsi_app`.

2. **Contracts (`packages/contracts/src/formations.ts`):**
   - Defined `FormationName`: `4-3-3`, `4-2-3-1`, `4-4-2`, `3-5-2`, `3-4-3`, `5-3-2`, `5-4-1`, `4-1-4-1`, `4-5-1`, `3-4-2-1`, `CUSTOM`.
   - Defined `TeamFormation`: carries formation, state (`INFERRED` vs `CONFIRMED`), confidence, stability %, defensive line height (m and %), buildup shape, defensive shape, evaluated moments, line counts (defenders, midfielders, forwards), audit metadata, and graceful uncalibrated degradation.
   - Defined `ConfirmFormationRequest` and `FormationsAnalysis`.
   - Exported through `packages/contracts/src/index.ts`.

3. **Backend API (`apps/api/src/modules/analysis/formations.ts`):**
   - Implemented `FormationsService` and `FormationsController` registered in `app.ts`:
     - `GET /v1/videos/:id/formations`: fetches pitch calibrations and match periods, samples observations across timestamp buckets, normalizes player positions from defending goal line (0) to attacking goal line (1), excludes goalkeeper (norm_x < 0.15), clusters outfielders into defensive, midfield, and forward lines, maps to canonical formations, calculates stability % and average defensive line height, and respects person confirmation overrides.
     - `POST /v1/videos/:id/formations/confirm`: records human analyst confirmation in `formation_decisions` and logs audit event in `audit_events`.

4. **Web UI (`apps/web/src/components/tactics/Panels.tsx`):**
   - Updated `ShapePanels` (sections `p05-s02` and `p05-s03`):
     - Displays formation name (e.g. `4-3-3`) with interactive `Inferred (Confirm?)` button or `✓ Confirmed` badge.
     - Supports match period selection (`Full match`, `1st half`, `2nd half`).
     - Shows live `Def. Line Height` (e.g. `41.5 m` / `40 %`).
     - Shows live `Formation Stability` % with dynamic progress bar.
     - Displays `Build-up Shape` (e.g. `3-2-4-1`) and `Defensive Shape` (e.g. `4-5-1`).
     - Retains honest `Not measured` indicators when uncalibrated or player count < 7.

5. **Automated Verification:**
   - Integration test in `apps/api/test/formations.api.test.ts` (1 passed in 432ms) verifying uncalibrated graceful degradation, 4-3-3 inference on calibrated pitch, formation confirmation workflow, and tenant isolation.
   - Component unit test in `apps/web/test/formationsPanel.test.tsx` (1 passed in 199ms) verifying badge rendering, live metric display, and confirmation trigger.
   - Full web test suite: 60 test files, 240 passed in 32.96s.
   - Production Next.js build compiled and verified (25/25 routes).
