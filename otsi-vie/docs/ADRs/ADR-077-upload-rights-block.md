# ADR-077: Upload's rights block; analysis needs rights (v3 Phase A.11)

Status: accepted. The owner said "Yes, start A.11" on 2026-11-07.

## Decision
- **Four questions and a confirmation** in a dialog, "Rights for your uploads":
  1. May the engine analyse this video?
  2. May reels and reports made from it be shared outside the organization?
  3. May people with a link download the file? Only with sharing.
  4. Are minors in it? The answers are: none; guardian consent on file; or consent asked for but not given yet.
  - The person also confirms they are entitled to declare these rights.
- **Where.** A line in the middle of the drop zone, "Rights: … · Set/Change", opens the dialog. The approved panels are unchanged.
  - The answers are page state only, never kept in the browser's storage.
  - They go with each upload (`CreateUploadRequest.rights`) and each link import (`CreateImportRequest.rights`).
  - With Send to Analysis on, the dialog opens before the first upload starts. Dropped files upload as soon as it is answered. A link import asks the person to answer first.
- **The record.** The server writes an ordinary `rights_grants` row in the same transaction as the upload, audited as `video.rights_declared`.
  - It is the same record that Export's Sharing & rights uses; no new table and no migration.
  - Uses: VIEW, plus ANALYZE and PRODUCE (analyse), plus EXPORT, SHARE and DELIVER (share), plus DOWNLOAD.
  - State: EXPORT_ALLOWED with sharing, else INTERNAL.
  - Guardian consent is stored as asked.
- **Analysis needs rights.** `insertRun`, the single path that creates every run, refuses with 409 `RIGHTS_REQUIRED` and the reason. The reasons are:
  - no rights recorded;
  - analysis not allowed;
  - not valid now;
  - guardian consent pending or revoked.
  - The automatic analysis records the reason as SKIPPED.
  - A Trash restore brings a video back without a run when its rights do not allow one.
  - `GET /v1/videos/:id/rights` gains `analysis_blocked`.
- **Videos without rights** (every video uploaded before this ADR, the owner's match included):
  - On Upload › AI Tools, the selected video shows "No rights recorded … Record rights".
  - That button opens the same questions and saves them through the new `POST /v1/videos/:id/rights/declaration` (writers, only when the video has no grant; otherwise 409 `RIGHTS_ALREADY_RECORDED`).
  - Changing a recorded grant stays with an Owner or Admin in Export.

## Alternatives
- **Remember the answers in the browser:** rejected. Rights belong to each video, and an answer left over from yesterday must not declare today's video.
- **Grandfather existing videos as analysable:** rejected. Rights are never assumed.

## Tests
- **API (`ingestOptions.api.test.ts`, +3):**
  - the grant and its audit; malformed answers give 422;
  - without rights there is no run, a SKIPPED reason, 409 on a manual start, and the declaration works once (then 409) for this organization only, after which the start succeeds;
  - "No" to analysis, and pending consent, both block with their reason.
- **Existing analysis tests** now seed a grant (`seedRights`).
- **Web (`test/rightsDialog.test.tsx`, 4):**
  - the completeness rule and the summary;
  - saving only when everything is answered;
  - the "not analysed" warning;
  - declaring on a video, and a refusal shown.
- API 223 and web 136 pass.
- **Browser (live, view only):**
  - the drop zone line reads "Rights: needed before analysis · Set";
  - the dialog renders all four questions;
  - the owner's video shows "No rights recorded … Record rights". Nothing was recorded on it.
