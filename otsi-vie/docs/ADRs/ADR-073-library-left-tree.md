# ADR-073: The Library's left tree (v3 Phase A.14)

Status: accepted. The owner said "Yes, start A.14" on 2026-11-06.

## Decision
- **Where.** The Library's left panel gets a **Match / Browse** switch at its top.
  - **Match** is the approved panel (the selected asset's match context) and stays the default.
  - **Browse** shows the Library tree in the same panel.
  - Which view is open is kept per browser (`otsi-vie.library-left`).
- **The tree** (`components/library/LibraryTree.tsx`). The counts come from the same list the table shows, so they follow the organization and project-access rules of the API.
  - **All assets** (count): the whole Library on the All Assets tab.
  - **Folders**: each folder by name with its item count; a click opens it (the same `?folder=` address as before). "+ New" makes a folder for writers; a viewer is told why it isn't available.
  - **Shared With Me** (count): the Shared With Me tab.
  - **Trash** (count of deleted entries, `GET /v1/library/trash`): opens the Trash, where entries are restored. When the count cannot be read, none is shown, never a guess.
  - **Smart Bins**: said to arrive in the next phase (B, saved searches kept as bins), with no control.
- **One set of dialogs.** The Trash and New-folder dialogs are now opened from the page, so the tree and the existing buttons (Trash next to Save Current Search; New Project ▾ › New folder) open the same ones. Their behaviour is unchanged (ADR-052).
- **No API or schema change.**

## Alternatives
- **Replace the match panel with the tree:** rejected. It is part of the approved design.
- **A fifth tab in the left panel:** rejected. The tab row is full at the approved widths, and the tree needs the whole panel height.

## Tests
- **Web `test/libraryTree.test.tsx` (4):**
  - the counts and folder order;
  - each item opens the right thing (whole Library, a folder, Shared With Me, Trash, New folder) and the current one is marked;
  - a viewer is told why there is no New folder;
  - an unreadable Trash shows no count;
  - the loading and failure states.
- The mock API returns a "fail" signal, and the module rejects. Vitest 2.1.8's own tracking of a rejected or never-settling mock result crashed the test worker.
- **Browser check on the live Library:**
  - Browse lists All assets 5, no folders, Shared With Me 0 and Trash 12.
  - Trash opens with 12 entries and closes.
  - Shared With Me selects that tab, and All assets goes back.
  - The panel was put back on Match.
  - Opening a folder was not tried in the browser, because there is no folder and making one would add data to the owner's account. It is covered by the test.
