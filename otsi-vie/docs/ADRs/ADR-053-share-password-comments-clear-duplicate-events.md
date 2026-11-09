# ADR-053 Share-link password and comments, Clear All, Duplicate, the player's events

**Date:** 2026-11-05. **Status:** accepted (owner: "Yes, next block": the A rows of `docs/WIRING_PAGES_07-10.md`). **Migration:** 0040.

## Decisions
1. **Share-link password** (page 10).
   - The person making the link may set a password of 8-128 characters. Only a scrypt hash is stored (`core/passwords.ts`).
   - The person opening the link types it. It is sent in the request body (`POST /v1/public/share/:token/open`), never in the address.
   - Each wrong try is logged (`share_link_access`, action PASSWORD). 10 wrong tries within 15 minutes lock the link for that time.
2. **Comments through a link** (page 10 "Allow Comments").
   - When the link allows it, a person opening it leaves a comment with their name, optionally pinned to a moment of the video. They pass the same checks as opening, plus the password.
   - At most 30 comments per link per hour.
   - Migration 0040: `comments.author_id` is now nullable, and the new `share_link_id` and `guest_name` columns hold guest comments. A CHECK keeps exactly one author: a team member or a named guest of one link.
   - Team notes (`/v1/reels/:id/notes`) never include guest comments.
   - The team reads a link's comments under Sharing & rights (`GET /v1/share-links/:id/comments`).
3. **Clear All** (page 10).
   - `POST /v1/renders/clear-finished` sets `render_jobs.cleared_at` / `cleared_by` on the organization's finished renders. This is audited.
   - The queue hides them. The render, its file and its links stay, and nothing goes to the Trash.
4. **Duplicate** (page 09).
   - `POST /v1/reels/:id/duplicate` copies a reel's player, pinned identity decisions, look and clips into a new DRAFT reel "… (copy)".
   - Renders, share links and notes are not copied. The audit (`reel.duplicated`) keeps the reel it came from.
5. **The player's events** (page 08). `GET /v1/players/:id/events[?half=]` returns the events that `measures` counts, plus set pieces and goals, on his confirmed tracks.
   - Pass ends are stored as normalised picture points. They are placed on the pitch with the best calibration covering that moment, and only then drawn.
   - The page says how many passes could not be placed.
6. **Clip Studio** (page 07). Event Type and AI Insights read the source video's events inside the clip (`GET /v1/videos/:id/events`).
   - The reel player's events come first, ranked goal > shot > key pass > pass > ball won > pressure > set piece.
   - Each is marked Detected or Inferred: engine readings, not reviewed.
7. The analysis page opens at `?t=<seconds>`, so a timeline event plays where it happened.

## Not changed
Shots stay "not detected" (the engine finds none). Library preview overlays (player trails, pass arrows and heat on the video) are the next block.

## Tests
- `apps/api/test/heat.api.test.ts`: the event list, its order, half validation, a pass placed on the pitch in metres, other organization 404.
- `apps/api/test/sharing.api.test.ts`:
  - password required, wrong, right and locked; only a hash is stored;
  - comments need the password and a name; links without comments refuse them; team notes stay separate; the team reads link comments; organizations kept apart;
  - Duplicate: roles, organizations, copied clips and targets, and the audit's lineage;
  - Clear All: roles, the render stays playable, a second clear finds nothing, other organizations untouched.
- `tests/db`: the regenerated inventory differs only by 0040. `factory.py` never fills a guest author on a minimal comment.
