# ADR-070: Global search and command palette (v3 Phase A.8, S03)

Status: accepted. The owner said "Yes, start A.8" on 2026-11-06.

## Decision
- **Where.** A search button sits in the header between the last tab (Export) and the divider. It opens the palette, and so does Ctrl/Cmd + K.
  - The spec asks for a field. At the approved tab widths the gap is only 50 design px (x 2062–2112), so the button opens the field over the page. The approved tabs and right-side controls are unchanged.
- **One field, four groups, in order:**
  - **Commands.** Only what the person's organization role may do (`lib/commands.ts`): Upload and Team need roles the API also requires (Upload: Owner/Admin/Analyst/Editor; Team: Owner/Admin). When a reel or match is open in the context bar (ADR-069), "Edit the open reel in Clip Studio" and "Continue on the open match" come first.
  - **Pages.** The ten pages, by name, then by description.
  - **What the organization recorded.** `GET /v1/search?q=` (2–80 characters, any member) returns matches (video title, file name, clubs, competition), players (name, OTSI Player ID), reels and projects. At most 8 of each; a name that starts with the words comes first.
  - **Library.** "Search the Library for …" passes the words to the Library's own search and filters.
- **Who sees what.** The caller's organization only, with project access applied, so nothing from a hidden project is found. A player is found only if the organization created him or confirmed him on a video it can see. Merged and removed records are left out. LIKE wildcards are escaped, so `%` and `_` are matched literally.
- **Behaviour.** The search runs 200 ms after the last key, and the newest answer wins. Arrow keys move, Enter opens, Escape closes. The footer says what happened: fewer than 2 letters, searching, nothing found, N found, or that the search could not be reached (pages and commands still work).
- A player hit opens his report by OTSI Player ID, or by internal id while he is provisional. A match opens Analysis, a reel opens its page, and a project opens the Library on its name.

## Not in this block
- **Moments, events and clips.** They stay in Clip Studio's Media Bin search (ADR-067), where they can be used.
- **Saved searches, recent items and a search index** (full-text). These come later if the LIKE scan becomes slow; the indexed columns are small per organization.

## Alternatives
- **A field squeezed into the header:** rejected. It would mean narrowing the approved tabs.
- **Searching on the client from page lists:** rejected. It would leak nothing, but it would miss most of what is recorded and would repeat the API's access rules.

## Tests
- API `access.api.test.ts` "global search": the Owner finds the locked project, its match (by title and by competition) and its reel. Someone not on the locked project finds none of it but does find the open project's match, player and project. Another organization finds nothing. `%%` and `O_en` find nothing. 1 character, no query, or 81 characters give 422. Not signed in gives 401.
- Web `test/commands.test.ts` (4): commands by role, open reel and match first, word matching, where each hit opens. `test/shell.test.tsx` (3): Ctrl+K with a Viewer's commands and the pages, Enter navigates, the API is asked from 2 letters and a hit opens its report, and an unreachable search is stated.
- Browser check on the owner's reel: the header button opens the palette. "re" lists commands, pages and a project. "Chin" finds the player (provisional) and his reel.
