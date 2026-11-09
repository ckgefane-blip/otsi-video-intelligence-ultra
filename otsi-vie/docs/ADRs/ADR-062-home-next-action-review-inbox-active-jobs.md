# ADR-062 Home: state-aware next action, Review inbox, Active jobs (v3 Phase A.13)

**Date:** 2026-11-06. **Status:** accepted (owner: "Yes, do A.13"). **Migration:** none. Builds on ADR-060.
Source: OTSI_VIE_v3_Complete_Phase_Plan.md A.13; Screen-Level Upgrade Blueprint, Page 01 (Primary action strip, Review inbox, Active jobs, "Platform Capabilities, How It Works: show only when the org has no completed match").

## Decision
`GET /v1/overview/inbox` (module `overview/inbox.ts`) is read from recorded rows only. Hidden projects and items in Trash are left out.

**Review inbox rows.** Each row opens the exact page:
- **Identity suggestions.** Tracks whose current identity is a CANDIDATE (proposed, not confirmed), counted per video. The row opens Analysis; nothing is confirmed from Home.
- **Team sheets to approve.** Lineup cards still PROPOSED, per video. The row opens Analysis.
- **Out-of-date reels.** Reels whose followed identity changed; they cannot render until refreshed. The row opens that reel.
- **Failed jobs.** Engine jobs that failed in the last 24 hours and have not been run again since. The row opens Processing.

**Next action.** The first that applies is used:
1. Watch a running analysis.
2. The first inbox row.
3. Continue a reel that has clips but no render.
4. Open the report of the last rendered reel's player.
5. Pick a player on the newest finished analysis.

When none applies, there is no button.

**Web placement:**
- The next action is a slim button under Upload Video and Paste Link, at y 552–594 inside the hero.
- Until the organization has a finished analysis, Platform Capabilities and How It Works stay exactly as approved (first-run guidance).
- After that, their two places show the **Review inbox** (up to 5 rows) and **Active jobs** (up to 4 cards: what runs or waits, else the last day's jobs; the same list as the top-bar tray, read every 5 s).

## Not done
- **Share comments** in the inbox: guests' share-link comments are stored (ADR-053), but no page shows them yet, so an inbox row would open nowhere. It will be added together with a comments view.
- **Quick tiles** (Open last match, Build a reel, Print a report): left for the Home rework in a later phase. The next action covers the most likely one.

## Tests
API `test/inbox.api.test.ts` (3):
- a new organization gets no action and no rows;
- the next action follows the real state (running → watch; finished → pick a player; candidate → review);
- organizations are isolated;
- a failed job is listed until it is run again;
- a proposed team sheet is listed.

Totals: API 204, web 66.
