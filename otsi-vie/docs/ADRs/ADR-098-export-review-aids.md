# ADR-098: Export review aids: hide no-action chapters, report preview, inline rights capture (v3 Phase B.23)

Date: 2026-11-07. Status: accepted. No migration.

## Decision
- **Hide no-action chapters** (Export, Highlight Chapters):
  - A chapter (clip) has action when an event of the reel's player that the engine recorded starts inside it, in video time. This is
    the same rule the Clip Sheet uses (`actionClips` in contracts).
  - If none of his events is recorded in the video, it is not known which chapters have action. `actionClips` returns null and the
    switch is off, with the reason shown (unknown beats wrong).
  - The filter only changes what the page shows. Chapter numbers and seek times stay those of the full reel; the heading reads
    "15 of 58".
- **Report preview:** `GET /v1/reels/:id/bundles/preview/:kind` returns `{kind, html, generated_at}`.
  - `kind` is PERFORMANCE_PDF or CLIP_SHEET_PDF.
  - The page is built by the same rule-built HTML the PDF prints. `PlayerReportService.reportHtmlOf` was split out of `makeReport`.
  - It needs no render and saves nothing: no asset, no report job. Every project reader may preview it.
  - The web shows it in a sandboxed iframe (`sandbox=""`, no scripts). Output & Reports offers "Preview" on a PDF not yet made.
- **Inline rights capture:** the preflight adds the source video's rights line (`shareCheck`). Rendering never needs it; sharing and
  delivery do.
  - No grant: a writer gets "Record the rights" in the dialog itself. This is A.11's four questions (`DeclareRightsDialog`), saved on the
    video.
  - A grant that does not allow sharing points to Sharing & rights (Owner or Admin).
  - `rightsAllowShare` is now the one web-side rule. Share.tsx uses it too.

## Tests
- `apps/api/test/exports.api.test.ts`:
  - preview of both reports before any render, as a viewer too;
  - 422 for another kind; 404 for another organization;
  - asset and report-job counts unchanged.
- `apps/web/test/exportReview.test.ts`:
  - actionClips: ends included, other videos ignored, null when unknown;
  - shareCheck wording and levels;
  - expiry and guardian consent.
- Web 194 / API 248 green.
- Browser on the owner's reel, view only:
  - the filter shows 15 of 58 and then all again;
  - the Clip Sheet preview opens sandboxed with its rows;
  - the preflight shows the rights line with "Record the rights" (not pressed).
