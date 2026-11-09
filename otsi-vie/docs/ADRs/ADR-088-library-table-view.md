# ADR-088: Library table view, lock icon and bulk actions (v3 Phase B.12)

Status: accepted. The owner said "Proceed with implementation nonstop until you finish the very last thing in our planned work" on 2026-11-07.

## Problem
The plan asks the Library for Rights, Evidence, Profile and Device columns, a lock icon, bulk actions and a card/table toggle. The
approved Library composition has fixed columns (Thumbnail / Title, Type, Players Featured, Collaborators, Updated, Status) with no room
for four more.

## Decision
- **Card / table toggle** (two small buttons right of "Save Current Search"; remembered in this browser). Cards are the approved rows,
  unchanged and the default. Table is a dense list of the same page of rows with the extra columns. The approved design is not changed.
- **Facts endpoint** `GET /v1/library/facts` (`modules/library/facts.ts`): per visible video, its current rights grant (state, allowed
  uses, why nothing new may be made or analysed now, with the same rules as analysis and snapshots), whether a finished analysis exists,
  its tracks and person-confirmed tracks (latest finished run), and its profile (the latest run's, else the upload's choice).
- **Columns** (`LibraryTable.tsx`, rules in `contracts/library-facts.ts`):
  - **🔒**: a restricted project (only its people see it), or rights that block making anything new now (the reason on hover);
  - **Rights**: a reel, export or match takes its video's grant; "Not recorded" when the video has none; "—" when not covered;
  - **Evidence**: "Not analysed" or "4,453 tracks · 3 confirmed";
  - **Profile**: analysis profile (video, match), "Frame 9:16" (reel), export profile such as "Scout cut 16:9" (export);
  - **Device**: the screen an output is made for (TV / desktop, Phone, Social feed, Square). The camera that recorded a source video is
    not recorded, so a video says "Camera not recorded" rather than guessing.
  - While the facts load a column shows "…", never a guess.
- **Bulk actions** (both views share the checkboxes): Move to folder… (one folder for all the movable items), Download list (CSV of the
  selected rows with the same columns, made in the browser), Clear. **Delete stays one item at a time**, because each deletion shows
  what it would remove first (ADR-074 removal preview); a bulk delete would hide that.

## Tests
- `apps/api/test/libraryFacts.api.test.ts` (real API and MySQL): rights with uses and the locked reason, evidence counts, profile from the
  latest run, another organization sees nothing.
- `apps/web/test/libraryTable.test.tsx`: every column from the facts (video, match, reel, export, restricted project, not covered,
  no rights recorded, loading), selection, row click and the CSV (quotes escaped).
- Suites: API 240, web 165 passed; both type checks clean.
