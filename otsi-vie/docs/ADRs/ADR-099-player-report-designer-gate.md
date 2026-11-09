# ADR-099: Player Report designer, publish gate, KPI coverage, picker landing (v3 Phase B.24)

Date: 2026-11-07. Status: accepted. No migration.

## Decision
- **Publish gate** (`reportGate`, `apps/api/src/modules/playerreport/gate.ts`): nothing about a player leaves the page while no track is
  confirmed as him by a person in the organization. Tracking is not identity. The API refuses with 409 IDENTITY_UNCONFIRMED for:
  - making a PDF (`POST /v1/players/:id/reports`);
  - creating a report share link (checked again at creation);
  - publishing the assessment.

  A draft may still be saved. A provisional player (no OTSI ID yet) with a confirmed track is allowed, and the report says
  "Provisional player: no ID yet". The registry ID is not the identity check.
- **Designer:** `ReportDesign {sections, title, note}`.
  - Sections: measures, heat, events, comparison, insights, assessment. At least one, each only once.
  - The note is a person's words, marked so on the page.
  - The design is stored in `report_jobs.config.design`. The job list shows the title and "n of 6 sections".
  - An empty body makes the full report, as before.
- **Live preview:** `POST /v1/players/:id/reports/preview {design}` returns `{html, gate, generated_at}`.
  - The page is the same `reportHtml` the PDF prints. It is shown sandboxed.
  - Nothing is saved, and any project reader may call it.
- **KPI tiles:** each tile gets a coverage line from `kpiCoverage`. It is never an accuracy figure.
  - Time: confirmed tracks and videos.
  - Movement: the share of the time seen that was measured.
  - Events: the videos with the ball followed.
  - xG and xA have none.
- **Comparison:** the comparison line names its group, e.g. "Midfielders: 4 players".
- **Landing:** `/reports` with no player opens the picker. The picker also marks retired players.

## Tests
- API `playerreport.api.test.ts`:
  - gate refusals (PDF, publish) while a draft still saves; preview gate; 404 for another organization;
  - design sections, title and note in preview and PDF job; 422 on an empty or repeated section; the preview saves nothing.
- Web `reportDesign.test.ts`: the gate, the design schema and the coverage lines.
- Web 198 / API 250 green.
- Not yet checked in the browser.
