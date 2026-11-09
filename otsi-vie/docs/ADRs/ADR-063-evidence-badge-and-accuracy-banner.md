# ADR-063 Evidence badge and accuracy banner (v3 Phase A.5, A.6)

**Date:** 2026-11-06. **Status:** accepted (owner: "Yes, do A.5/A.6"). **Migration:** none.
Source: OTSI_VIE_v3_Complete_Phase_Plan.md A.5, A.6; Screen-Level Upgrade Blueprint S06.

## Decision
**Evidence badge** (`components/evidence/Evidence.tsx`): one component for how a value is known.
- Detected: seen in the frames (detections, tracks, events from the followed ball).
- Inferred: worked out from what was seen (distance, speed, sprints from pitch positions).
- Confirmed: a person decided it (identity on a track).
- Not measured: the engine does not measure it; shown as "Not measured", never as 0 or a bare "—".
- While the accuracy gates are open, the tooltip of a detected or inferred value adds "Accuracy not yet measured."
- Compact form (one letter) inside design-stage cards; full label in lists.

**Placed on:** Home hero metrics (Speed, Distance inferred; Passes, Key Passes detected; xA not measured), Home Players Tracked (confirmed), Processing Output Summary (detected), Player Report KPIs (minutes and events detected, movement inferred, xG/xA "Not measured"), Player Report event list (replaces the ad-hoc labels).

**Accuracy gates** (`contracts/src/gates.ts`): G05 detection, G06 tracking, G07 identity from the handoff release matrix, all NOT_STARTED. A status changes only with the owner's written approval and evaluation evidence in an ADR; nothing computes it.

**Accuracy banner** (`components/evidence/AccuracyBanner.tsx`): a slim amber strip under the top bar on every app page while any of the three gates is not passed. "Hide for now" hides it for the browser session only.

## Not done
- Badges on video overlays (boxes, spotlight) and on the Analysis and Tactical pages: added when those pages are reworked in their phases.

## Tests
Web `test/evidence.test.ts` (4): the four levels; the accuracy note only on detected/inferred while gates are open; gates G05–G07 not passed; measured only when all pass. Totals: API 205, web 70.
