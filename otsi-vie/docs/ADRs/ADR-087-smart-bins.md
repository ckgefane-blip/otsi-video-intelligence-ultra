# ADR-087: Smart Bins (v3 Phase B.11)

Status: accepted. The owner said "Proceed with implementation nonstop until you finish the very last thing in our planned work" on 2026-11-07.

## Problem
The Library tree said Smart Bins would arrive in Phase B. The plan asks for saved queries kept as bins in the Library and in Clip
Studio's Media Bin.

## Decision
- **A Smart Bin is a person's saved Smart Search (ADR-086) that fills itself.** Only the query is stored; what the bin holds is whatever
  the search finds now, with the search's access checks. No migration: a bin is a `saved_searches` row whose query is
  `{ "smart": "<query>" }`.
- **API** (`modules/search/bins.ts`):
  - `GET /v1/smart-bins`: the caller's bins, each with its count now (up to 200 of each kind; `more` when a kind reached it);
  - `POST /v1/smart-bins {name, q}`: any member (a personal view); the same name again replaces its query;
  - `GET /v1/smart-bins/:id/items[?video=]`: what it holds now, optionally only one video's matches, moments and markers;
  - `DELETE /v1/smart-bins/:id`.
  - Refused: a search with no word and no filter, or with a filter not understood (422 `BAD_BIN_QUERY`, naming it).
- **Kept apart from the Library's saved searches:** `GET /v1/saved-searches` no longer lists bins, its DELETE cannot delete one, it
  refuses a `smart` query, and a name already used by the other kind is refused (409 `NAME_TAKEN`), never overwritten.
- **Library tree:** the Smart Bins section lists the bins with their counts and `+ New` (name and search, with the filter hint). A bin
  opens a list of what it holds, grouped like the search palette; each item opens where the palette would open it. Delete is there.
- **Clip Studio Media Bin:** when the person has bins, the folder path's last step becomes a chooser: the reel player's suggested
  moments, or "Smart Bin: name (n)". A bin keeps only the suggested moments that hold one of its moments or markers on this reel's video
  (`binMoments()` in contracts). The design is otherwise unchanged; with no bins the path reads as before.

## Tests
- `apps/api/test/smartBins.api.test.ts` (real API and MySQL): refused queries; a bin's count; a new goal is in it at once; `?video=`;
  same name replaces; apart from Library saved searches both ways (`NAME_TAKEN`, 422, not listed, not deleted through them); a
  colleague and another organization cannot list, read or delete it.
- `apps/web/test/libraryTree.test.tsx` (bins with counts, + New), `apps/web/test/smartSearch.test.ts` (`binMoments`).
- Suites: API 239, web 163 passed; both type checks clean.
