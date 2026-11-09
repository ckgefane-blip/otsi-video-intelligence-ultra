# ADR-108: Dual Timeline Cut Comparison (Pro)

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase C.9
- **Migration:** None (Client-side cut comparison and playhead sync over reel snapshots)

## Context

Editors and analysts refining video reels often need to compare two cuts of the same reel side-by-side or compare an active working cut against an earlier approved edit (Cut A vs. Cut B). Before this change, reviewing differences required exporting both versions or manually noting timestamps.

Key requirements:
1. Compare two cuts side-by-side in Clip Studio without mutating the active reel.
2. Highlight per-clip trim differences (`in`, `out`, `duration`), added clips, and removed clips.
3. Support two playhead synchronization modes:
   - `SOURCE_MATCH`: maps the active playhead in Cut A to the exact source video timestamp in Cut B (essential for evaluating identical camera action across different edits).
   - `RELATIVE`: maps playhead position proportionally across total duration.
4. Allow swapping the active working cut with the snapshot comparison cut.
5. Zero destructive mutation to production database; full contract test coverage.

## Decision

1. **Contracts (`packages/contracts/src/dual-timeline.ts`):**
   - Defined `CutComparisonClip`, `CutComparison`, and `CutDiff` types with Zod schemas.
   - Implemented `cutDurationUs`, `syncPlayhead` (handling both `SOURCE_MATCH` and `RELATIVE` modes), and `computeCutDiff`.
   - `computeCutDiff` matches clips between Cut A and Cut B by ID and source-time overlap, calculating trim deltas (`delta_in_us`, `delta_out_us`, `delta_dur_us`) and classifying differences (`SAME`, `TRIMMED`, `ADDED`, `REMOVED`).
   - Exported through `packages/contracts/src/index.ts`.

2. **Web UI (`apps/web/src/components/studio/DualTimeline.tsx` and `Timeline.tsx`):**
   - Added a dedicated "Dual" toggle button in the Clip Studio timeline controls row (`data-timeline-toggle="dual"`).
   - Designed `DualTimeline` component providing:
     - Side-by-side or stacked visual representation of Cut A (Active) and Cut B (Reference Snapshot).
     - Summary badge reporting match status (`All cuts identical`, trim variance count, duration delta).
     - Per-clip visual diff indicators with trim shift readouts.
     - Playhead sync toggle (`SOURCE_MATCH` vs. `RELATIVE`).
     - "Snapshot Active" to capture the current state as Cut B, and "Swap Cuts" to revert or promote Cut B to active.
   - Positioned timeline control buttons with clear spacing and explicit stacking context (`zIndex: 5`) to prevent coordinate clipping with the reel overview slider.

3. **Testing & Verification:**
   - Unit tests in `apps/web/test/dualTimeline.test.ts` verifying identical cut diffs, trim delta calculations, added/removed clips, and playhead sync algorithms.
   - Full Next.js production build succeeded with clean static generation across all 24 pages.
   - Headless browser automated verification on live owner reel (`01a199aa-08fd-740d-93a3-a27fec2d7a8b`) confirming button toggle, panel opening, diff summary readout, sync mode switching, and clean panel closure.

## Consequences

- Editors can instantaneously review cut divergences and verify pacing adjustments.
- No database migrations or persistent storage changes are introduced.
