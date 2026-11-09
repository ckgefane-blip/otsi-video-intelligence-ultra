# ADR-057 Project access: a project can be locked to the people chosen for it (page 09 Collaborators / Manage Access)

**Date:** 2026-11-06. **Status:** accepted (owner: "Yes, lock it (Recommended)"). **Migration:** 0043.

## Decisions
1. **Two modes per project** (`projects.access`): `ORGANIZATION` (default; every existing project keeps working as before) and
   `RESTRICTED`. In a restricted project only Owners, Admins and the people listed in `project_acl` see it and everything in it: its videos,
   analysis runs, tracks, calibrations, ball marks, team sheets, reels, renders, share links, Library items and the player reports built
   from its videos. A new project may start restricted; its creator is then its Manager.
2. **One permission per person** (`project_acl`, baseline table; the API writes one row per person): READ Viewer, REVIEW Reviewer
   (identity decisions, jersey / link decisions, kit-group assignments, notes and comments), EDIT Editor, ADMIN Manager (also chooses who is
   on it). A permission **only narrows** the organization role: a Viewer made Editor still only views; the access list says what each
   person can really do. In an ORGANIZATION project the list is the project's team (shown on the Library), and does not change access.
3. **One central check** (`apps/api/src/core/access.ts`, called by AuthGuard on every member request):
   - one indexed query loads the organization's restricted projects and this user's permission in each;
   - every id named by the route (by the segment before it: `videos/:id`, `analysis-runs/:runId`, `tracks/:trackId`, `reels/:reelId`,
     `renders/:id`, `matches/:matchId`, `projects/:projectId`, `pitch-calibrations/:id`, `ball-marks/:id`, `lineup-cards/:id`,
     `track-links/:id`, `uploads/:id`, `share-links/:id`, `reports/:id`, Library `:kind/:id`, Trash entries) and every id in the body
     (`video_id`, `source_video_id`, `reel_id`, `project_id`, `track_id`, `run_id`, `render_id`) is resolved to its project;
   - a project he may not see answers **404, the same as an id that does not exist**, before any role check (a refusal never confirms it
     exists); a change in a restricted project without Editor / Manager answers 403 `PROJECT_READ_ONLY` (Reviewer routes excepted);
   - a match is hidden only when it has videos and all of them are hidden (a match is shared metadata); a report is hidden when any video
     its numbers came from is hidden.
   New routes are covered automatically when they use these names; a route naming a new kind of id must add it to the table.
4. **Lists and totals** leave hidden projects out in SQL (`notHidden`, `videoNotHidden`, `reelNotHidden`, `reportNotHidden`,
   `matchNotHidden`, `libraryItemNotHidden`): projects, videos, reels (and their renders / exports), matches and their video ids, Library
   folder counts and memberships, Trash, Overview (totals, weekly, latest player, hero moment, recent matches), a player's measures and
   events, comparison groups, insights, his report list, and the videos a new PDF report is built from. The comparison cache key includes
   what the user can see. The audit log is Owner / Admin only (they see everything).
5. **Takes effect at once**: access is read on every request, so removing someone or locking a project applies from his next click.
   Signed media URLs already handed out stay valid until they expire (minutes); external share links are a separate decision (rights and
   revocation on page 10) and are not revoked by locking.
6. **Manage Access** (`GET/PUT /v1/projects/:id/access`, `PUT/DELETE /v1/projects/:id/access/people/:userId`): Owner, Admin or the
   project's Manager (who must hold a writer role). A Manager cannot lower or remove himself (an Owner / Admin can). Only active members can
   be added; new people join the organization through Team invitations (pending invitations and their expiry are shown there). Every change
   is audited: `project.access_changed`, `project.member_added`, `project.member_changed`, `project.member_removed`.
7. **UI**: Library table column Collaborators (initials, lock), Shared With Me tab (items of someone else's project you are on), Selected
   Item Collaborators with the Manage Access dialog. Matches and folders belong to no project and say so.

## Tests
- `apps/api/test/access.api.test.ts`: route-id parsing and effective permission (pure); locking and membership with roles and audit; 404 on
  12 routes plus changes for a member not on the project (the Owner still sees them); lists and totals (projects, videos, reels, matches,
  Overview, recent matches, player measures and events, folder counts and memberships, Shared With Me); Reviewer may decide identities
  but not rename; a project Editor with the Viewer role is still refused; Manager edits and manages, cannot remove himself; removal takes
  effect on the next request; a new restricted project; opening it again.
- API 188, web 58, tests/db 88 (inventory regenerated for 0043), type checks clean.
