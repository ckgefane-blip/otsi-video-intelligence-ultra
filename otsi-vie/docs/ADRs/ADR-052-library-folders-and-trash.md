# ADR-052 Library folders group items; every delete goes to a Trash

**Date:** 2026-11-05. **Status:** accepted (owner: "Yes, rebuild it"). **Migration:** 0039. **Supersedes:** the Library parts of migration 0038 and the per-type delete routes.

## Why
The owner tried to delete a Library folder and a video. Each fix made the next problem:
1. Delete did nothing visible. Refusals were silent.
2. Delete then took everything with it.
3. "Move to folder" relabelled about 85,000 files and took 20 seconds.
4. The new folder got the video's name, so the two rows looked the same.

The owner: "STOP ... PATCH EVERYTHING ... LONG TERM FIXES."

The cause was one design fault. The Library showed the `projects` table as its folders. A project **owns** its videos and reels, because uploads go into a project. So "deleting a folder" deleted its contents, and "moving" meant changing the owner of every file. The approved spec (page 09) keeps folders separate, as a grouping (`otsi_folder_items`).

## Decision
1. **Folders only group items** (`library_folders`, `library_folder_items`).
   - An item is in at most one folder.
   - Moving an item changes one row.
   - Deleting a folder never deletes what is in it.
   - Folders appear under the Folders tab. A folder row opens the folder (`/library?folder=<id>`), and the header shows "All assets › Folder: name".
2. **Projects stay what they are**: the owner of uploaded videos and what is made from them. They are listed as kind **Project**, with their own badge and icon, never as folders.
3. **One delete implementation for every page**: `GET /v1/library/:kind/:id/removal` and `DELETE /v1/library/:kind/:id`.
   - What goes with what: a project takes its videos and reels; a match takes its videos; a video takes its reels; a reel takes its rendered files; a folder takes nothing.
   - The dialog lists it all before the person confirms. A running render blocks the delete.
   - Removed: the old routes `DELETE /v1/reels/:id`, `/v1/renders/:id`, `/v1/projects/:id`, `/v1/matches/:id`, `/v1/videos/:id` and `POST /v1/videos/:id/restore`.
   - Upload › Remove now uses the Library delete and shows what goes with it. Upload › Undo uses `POST /v1/library/video/:id/restore`.
4. **Trash** (`library_deletions`, `library_deletion_items`).
   - Each delete is one entry. It lists every row it removed, with the row's prior state.
   - `POST /v1/library/trash/:id/restore` brings them all back.
   - Restore waits for what an entry needs. Example: a reel whose video is in another Trash entry says "Restore that first."
   - Nothing is erased.
   - Revoked share links stay off after a restore.
   - Analyses the delete stopped stay stopped.
   - An upload cancelled before it finished cannot come back.
   - The Trash is opened from the button beside Save Current Search. The owner approved adding it.
5. **Reels get `removed_at` / `removed_by`** like every other item. Deleting a reel used to overwrite its status with ARCHIVED; reels deleted that way get their status back from the audit.
6. **Items already deleted are carried into the Trash**, one entry each. This includes the folder "TEST 1" and four earlier removed videos.

## Alternatives rejected
- **Keep projects as folders and patch the dialogs.** This was tried, and it caused the failures above.
- **Nested folders.** Not in the approved spec. They can be added later with a `parent_id`.
- **Permanent delete from the Trash.** Not built. Erasing data stays an owner-only decision.

## Tests
- `apps/api/test/library.api.test.ts`:
  - folders: make, rename, file, move, take out, delete keeps items, restore the folder;
  - Trash: a match delete takes its video, reel and file; blocked while rendering; restore brings all back; links stay off;
  - restore waits for its video; project delete and restore; Upload › Undo; old routes give 404.
  - Roles and organizations are kept apart in each case.
- `tests/db`: the regenerated inventory has only additions (67 objects).
