# ADR-056 Player Report: notes, assessment, dossiers, comparison, insights, PDF and its share link (page 08 T rows)

**Date:** 2026-11-06. **Status:** accepted (owner: "Yes, next page"). **Migration:** 0042.

## Decisions
1. **Notes & Tags** (rail): a note is a `comments` row with `player_id` (a member is its author; a CHECK keeps share-link guests out);
   bodies widen to 2000 characters for every comment. Tags are `player_tags` per organization. Members except viewers write; the author or an
   Owner / Admin deletes a note. Notes and tags never go into the PDF (a report may be shared).
2. **Assessment** (hero Role & Summary, Scouting Report): `player_assessments` per organization and player, with `draft` and `published`
   JSON (role, summary, traits, rating 0-10 in half points, up to 8 criteria 1-10, notes). Owner, Admin, Analyst and Scout write it. The report
   shows only the published version, marked "Analyst opinion" with who published it and when. Saves carry the version read (409
   STALE_VERSION). "Take off the report" withdraws the published version and keeps the draft. Every step is audited.
3. **Scouting dossiers**: `scouting_dossiers` + `scouting_dossier_players`, named lists of the organization's players.
4. **Comparison**: computed live (cached 10 minutes per player) from each player's measures on tracks a person confirmed. Groups: all players
   of the organization, and his line (GK / DEF / MID / FWD) when his position is recorded (team sheet first, then the Players list). Rates are
   per 90 minutes **seen on camera**, not minutes played, and say so; distance per 90 measured minutes; top speed as measured. Only players seen
   for at least 15 minutes form the group; the group size is shown. `metric_cohorts` stays unused: a stored cohort would go stale.
   **Changed labels (approved UI):** the reference rows Progressive Passes, xA, Shot Creating Actions and Progressive Carries are not measured
   by the engine (E rows); the five rows show what is measured: Passes, Key Passes, Balls Won (p90), Distance per 90 measured, Top Speed.
5. **Generated Insights**: up to four sentences built by fixed rules from measured values (top speed and its rank in the organization,
   passes and key passes, central or wide share of measured heat (the same either way the teams attack), work rate, balls won and pressures).
   Each names its source. No text model is used, so the badge reads "Engine data" instead of the reference's "AI Analysis".
6. **Export PDF**: `POST /v1/players/:id/reports` prints one HTML page to PDF in Playwright's headless Chromium on this server (free,
   Apache-2.0 / BSD; ADR-030). The page loads nothing from outside (every request is blocked) and every text is escaped. One PDF at a time per
   server. The file is an asset of kind REPORT; `report_jobs` records the state, when it finished, why it failed and the videos used.
   `project_id` becomes optional for player reports. Download through the signed media URL (now serving REPORT assets, inline or as a file).
   The browser lives in `.local/browsers` (copied from the local Playwright install); the stack passes `PLAYWRIGHT_BROWSERS_PATH`.
7. **Share Link**: `POST /v1/reports/:id/share-links` makes a private link to that PDF only when every video his numbers came from allows
   sharing (the reel rule, per video: rights in force, SHARE allowed, DOWNLOAD when the link offers it, guardian consent). A report built from
   no video is not shared. The rule runs again at every opening (`decideReport`); the shared page shows the PDF in a frame (signed media may be
   framed by this app's own pages only). Report links take no comments.

## Tests
- `apps/api/test/playerreport.api.test.ts`: the comparison and sentence rules (pure), notes and tags with roles and organizations, the
  assessment (draft, viewer sees nothing until published, stale version, bad rating, publish, withdraw, audit), dossiers, the comparison
  and insight routes, and the PDF: printed by the real Chromium, a Cyrillic name, notes left out, downloaded through the signed URL, sharing
  refused without rights and with download not allowed, the public view, inline PDF, comments off, the link stops when rights change, revoke,
  policy decisions recorded.
- API 182, web 58, tests/db 88 (inventory regenerated for 0042), type checks clean.
