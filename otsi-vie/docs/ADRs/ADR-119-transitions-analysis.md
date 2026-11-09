# ADR-119: Transitions Analysis (Ball Won/Lost to Next Action, Labelled Inferred)

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase E.4: Transitions analysis
- **Migration:** None (Aggregates detected match events and turnover sequences)

## Context

Tactical intelligence in professional football analysis heavily depends on transition moments: the immediate aftermath when a team wins or loses possession of the ball.
1. **Attacking Transitions:** When a team wins the ball (via tackle, interception, or recovery), analysts track whether the regain led directly to a shot, a key pass, progression, a foul won, or sustained possession, as well as the duration to that first action.
2. **Defensive Transitions & Counter-Press:** When a team loses the ball, analysts evaluate counter-pressing effectiveness by measuring whether possession was recovered within 5 seconds.
3. **Truth Rule ("Inferred"):** Because linking discrete turnover events (`POSSESSION_CHANGE`) to subsequent actions over a temporal window involves analytical sequencing rather than direct sensor detection of a single moment, transitions must be explicitly labelled `INFERRED`.
4. **Dependence on E.1:** Any event candidate rejected by an analyst via `event_decisions` (ADR-118) must be completely excluded from transition triggers and subsequent action outcomes.

## Decision

1. **Contracts (`packages/contracts/src/transitions.ts`):**
   - Added `TransitionType`: `"ATTACKING" | "DEFENSIVE"`.
   - Added `TransitionTrigger`: `"TACKLE" | "INTERCEPTION" | "BALL_WON" | "BALL_LOST"`.
   - Added `TransitionOutcome`: `"SHOT" | "GOAL" | "KEY_PASS" | "PASS" | "RETAINED" | "DISPOSSESSED" | "STOPPAGE"`.
   - Added `TransitionNextAction`: encapsulates `event_id`, `event_type`, `pts_us`, `duration_s`, and `outcome`.
   - Added `TransitionItem`: links the turnover trigger to the subsequent action with `evidence: "INFERRED"`.
   - Added `TeamTransitionStats`: aggregates attacking transitions, shots from transitions, possession retention, quick losses, avg time to action, and 5s counter-press regains.
   - Added `TransitionsAnalysis`: video-level payload exported via `@otsi-vie/contracts`.

2. **Backend API (`apps/api/src/modules/analysis/transitions.ts`):**
   - Added `GET /v1/videos/:id/transitions`:
     - Restricted by `AuthGuard` and tenant organization scoping.
     - Identifies turnover moments (`POSSESSION_CHANGE` with kit groups).
     - Excludes any event marked `REJECT` in `event_decisions` (E.1).
     - Looks ahead up to 10 seconds to classify the next action (shot/goal within 10s, key pass, completed pass, quick dispossession <5s, or retained >8s).
     - Evaluates defensive transitions for counter-pressing regains within 5s.
     - Registered in `app.ts` as `TransitionsController` and `TransitionsService`.

3. **Web UI (`apps/web/src/components/tactics/`):**
   - Updated `TacticsHeader.tsx`: activated "Transitions" in `PHASES` and added "Transitions" to `TABS`.
   - Implemented `TransitionsPanel.tsx` (section `p05-s10`):
     - Displays clear `Inferred` badge and explanatory metadata.
     - Side-by-side team comparison of turnover regains, shots from regains, retention %, quick losses, counter-press regains (<5s), and avg duration to action.
     - Interactive timeline stream of transition moments allowing click-to-seek video playback.
   - Integrated into `TacticsStage.tsx`.

4. **Automated Verification:**
   - Vitest test suite in `apps/api/test/transitions.api.test.ts` verifying turnover classification, next action tracing, 5s counter-press detection, rejection exclusion, and tenant isolation (3/3 passed).
   - Full vitest web test suite in `apps/web` across 57 test files (237/237 passed).
   - Production Next.js build compiled successfully across all 25 routes.
