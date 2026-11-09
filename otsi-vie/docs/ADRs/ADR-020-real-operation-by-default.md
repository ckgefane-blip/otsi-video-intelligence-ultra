# ADR-020: Real operation by default; demo data only in isolated test or explicitly activated demo environments

Status: accepted (owner directive, 2026-10-26)

## Context
The owner requires OTSI VIE v2 to start in REAL OPERATION MODE: on a fresh installation the owner opens the app, uploads a football match video (or pastes a supported link) and uses the real engine through the UI. CLAUDE.md §3 already allowed mock data only in clearly labelled development/test environments; the directive makes the default explicit and adds an end-to-end acceptance journey.

## Decision
1. **Clean start.** A fresh installation contains no players, clubs, teams, matches, videos, jobs, statistics, heatmaps, tracking results, events, reports, reels, clips, timelines or export history. Migrations seed only reference data that is fact, not fiction (country codes, 0006). Empty sections show genuine empty states with onboarding actions (Upload Video, Import Match Link, Create Project, Add Player) — an action appears only when it performs the real operation.
2. **No simulated results.** No component, API or worker returns fake metrics, identities, bounding boxes, confidence values or successful jobs. A capability that is not built is labelled as not available (web shell: "Not connected · Block NN"); it is never simulated.
3. **Demo / fixture isolation.** Synthetic fixtures live only in automated tests (scratch databases created and dropped per run) and, if one is ever built, in a demo mode that (a) is off unless explicitly activated by configuration, (b) uses its own database, never the real one, and (c) labels every screen `DEMO`. No demo mode exists today. The API refuses to start a demo mode against the real database (to be enforced when such a mode is introduced).
4. **Identity rules unchanged** (ADR-016): canonical OTSI Player IDs throughout; unidentified stays unidentified; track numbers are never shown as player IDs.
5. **Acceptance journey.** The owner's 13-step journey (IMPLEMENTATION_STATUS.md) is tracked step by step; a step is marked done only when it works for real on the owner's own footage, with evidence.

## Consequences
The build order favours the shortest real path through the journey: sign-in (Block 02) → projects → upload / URL ingest with validation and media probe (Block 03) → proxy and timeline (04) → detection (05) → tracking (06) → identity review (07) → reels (10) → spotlight + MP4 (11). Steps that need licensed model weights or owner decisions are recorded as blocked with the exact dependency (LICENSE_REGISTER.md), never faked.

## Evidence
Web shell: `apps/web/e2e/shell.spec.ts` asserts every approved section renders without values that look like measurements, and `test/pages.test.ts` asserts every section is connected, static product copy, an owner asset, or explicitly not connected.
