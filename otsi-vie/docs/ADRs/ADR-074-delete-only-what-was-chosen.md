# ADR-074: Library delete removes only what was chosen

Status: accepted. The owner reported on 2026-11-06 "deleting one item, auto deletes all" and chose "Only that item".

## Problem
The delete of ADR-052 cascaded: a project took its videos and reels, a match its videos, a video its reels, a reel its rendered files.
In a Library where everything hangs off one match, deleting the match took the video, the reel and five rendered files.

## Decision
Delete removes only what the person chose. Nothing goes without being chosen.
- **Rendered file:** only that file (unchanged).
- **Reel:** the reel and its own rendered files; their share links stop. Refused while a render of it runs (unchanged).
- **Match:** only the match. Its videos stay in the Library and leave the match (`video_sources.match_id` set to null). The Trash
  entry keeps which videos were unlinked (`library_deletion_items.prior.unlinked_videos`); Restore links them again, unless a video
  was linked to another match since.
- **Video:** refused while reels are made from it (`409 IN_USE`); the dialog names the reels to delete first.
- **Project:** refused while it holds videos or reels (`409 IN_USE`); the dialog names them.
- **Folder:** unchanged (its items stay).
- `RemovalPreview` gains `unlinked` (a match's videos) and `in_use` (what to delete first). `videos` and `reels` stay in the contract
  and are now always empty. No migration. Older Trash entries still restore as they were made.
- Library's Delete dialog says what stays ("Its video stays in the Library, just no longer in this match") and the button reads
  "Move it and its rendered files to the Trash" only for a reel with renders. Upload's remove uses the same rule.

## Alternatives
- **Keep the cascade with a louder warning:** rejected by the owner.
- **Delete a video's reels with it on a second confirm:** rejected; the owner's rule is that nothing goes without being chosen.

## Tests
- API `library.api.test.ts` (3): a match goes alone (video, reel, render and playback stay; the video is unlinked; a running render of
  a reel does not block it; Restore re-links; Trash entry counts 0/0/0; roles and organizations kept apart; audit); a video and a project
  in use are refused with the names; a reel takes its render and revokes its link; restore waits for project → video → reel; a render
  alone; old routes gone. API 214, web 125 pass.
- Browser (live, view only, both dialogs cancelled): the owner's match says its video stays and nothing else goes; the owner's video
  is refused and names the reel "Chinazom Godwin — highlights", with the button disabled.
