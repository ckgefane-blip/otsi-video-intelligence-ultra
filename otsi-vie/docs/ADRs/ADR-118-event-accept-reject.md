# ADR-118: Event Accept/Reject, Audit Trails, and Downstream Exclusion

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase E.1: Event accept/reject
- **Migration:** None (Leverages append-only `event_decisions` table and `audit_events` from baseline schema)

## Context

In OTSI VIE v2, match events (passes, balls won, tackles, interceptions, shots, pressures, set pieces, goals) are detected by the engine from ball and player track observations. While detection rules provide rapid automated timelines, high-stakes human-verified deliverables (Option B Single Match Spotlights and Scouting Packs) require a human analyst to verify detected event candidates.
1. **Analyst Review Decisions:** Analysts must be able to confirm valid events (`CONFIRM`), reject false positives (`REJECT`), edit event boundaries or types (`EDIT`), or mark events for secondary review (`NEEDS_REVIEW`).
2. **Exclusion from Deliverables:** Rejected events must immediately disappear from reels, match summaries, player reports, heat/action maps, and tactical statistics, without mutating or deleting raw engine detections.
3. **Auditing and Tenancy:** All decisions must be appended to `event_decisions` (which is protected against in-place update and deletion by database triggers), recorded in `audit_events` via `writeAudit`, and strictly scoped to the tenant organization.

## Decision

1. **Contracts (`packages/contracts/src/events.ts`):**
   - Added `EventDecisionType`: `"CONFIRM" | "REJECT" | "EDIT" | "NEEDS_REVIEW"`.
   - Added `RecordEventDecisionRequest`: accepts `decision`, optional `revised_start_us`, `revised_end_us`, `revised_type`, and `reason`.
   - Added `EventDecisionRecord`: returns decision identity, reviewer details, timestamp, and revisions.
   - Updated event shapes (`PassEvent`, `PossessionChange`, `ShotEvent`, `PressureEvent`, `SetPieceEvent`, `GoalEvent`) to include `decision` and `reviewer_id`.
   - Added `rejected_events_count` to `MatchEvents`.

2. **Backend API (`apps/api/src/modules/analysis/events.ts`):**
   - Added `POST /v1/videos/:id/events/:eventId/decision`:
     - Restricted to `@Roles("OWNER", "ADMIN", "ANALYST")`.
     - Inserts append-only record into `event_decisions`.
     - Logs structured audit trail via `writeAudit` (`event.confirm`, `event.reject`, `event.edit`, `event.needs_review`).
   - Added `GET /v1/videos/:id/events/decisions`:
     - Returns decision history for the video, optionally filtered by `event_id`.
   - Updated `MatchEventsService.get()`:
     - Joins `event_decisions` latest state for each event.
     - By default, filters out `REJECT` events from passes, changes, shots, pressures, set pieces, goals, and team possession totals.
     - Supports `?all=1` to inspect all events including rejected ones.
     - Counts excluded items in `rejected_events_count`.

3. **Downstream Exclusion (`heat.ts` & `reels.ts`):**
   - Updated `PlayerMeasuresService.player()` and `playerEvents()` in `heat.ts` to exclude rejected events, ensuring verified player reports and action maps omit false detections.
   - Updated `ReelsService.events()` in `reels.ts` to exclude rejected events, ensuring highlight reels never include rejected moments.

4. **Web UI (`apps/web/src/components/workspace/`):**
   - Updated `TimelinePanel.tsx` (`marksOf`) to propagate `decision` and `reviewer_id` onto timeline marks.
   - Enhanced `PlayersPanel.tsx` (`EventsTab`):
     - Displays status badges for confirmed, edited, and review events.
     - Provides quick-action "Confirm" and "Reject" buttons for analysts.
     - Shows rejected event exclusion counter.

5. **Automated Verification:**
   - Vitest test suite in `apps/api/test/events.api.test.ts` verifying event confirmation, revision edits, rejection exclusion, query override with `?all=1`, decision history, and audit trail generation (5/5 passed).
   - Vitest test suites in `apps/api/test/heat.api.test.ts` (4/4 passed) and `apps/api/test/reels.api.test.ts` (19/19 passed).
   - Frontend test suite across 57 test files in `apps/web` (237/237 passed).
