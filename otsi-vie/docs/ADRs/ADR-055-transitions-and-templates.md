# ADR-055 Clip Studio transitions and templates (page 07 T rows)

**Date:** 2026-11-06. **Status:** accepted (owner: "Continue moving on"). **Migration:** 0041.

## Decisions
1. **Transitions** are stored per cut, as the transition **into** a clip after the first: one `timeline_items` row on the reel's TRANSITION
   timeline track (made on demand), `kind` FADE / DISSOLVE / ZOOM / SPIN, 0.2-1.0 s (default 0.6 s), at most half the clip it leads into.
   `PATCH /v1/reels/:id/transitions {clip_id, kind | null, duration_ms}`; errors FIRST_CLIP, TRANSITION_TOO_LONG. Audited
   (`reel.transition_set` / `reel.transition_removed`); the reel returns to DRAFT. The first clip never shows one, even after a reorder or delete.
2. Migration 0041: the item's clip foreign key cascades on delete (a deleted clip takes its transition), one item per track and clip (UNIQUE), and
   `effect_presets` gains `created_by` and `updated_at`.
3. **The renderer** (`services/worker/vie_worker/render/transitions.py`) draws a transition over the first frames of the clip after the cut: the
   clip before runs on past its out point (real footage, its "handle"; its last picture is held where the video ends) and blends into the next
   clip. The reel's length and sound do not change, so picture and sound stay in step. FADE goes through black; DISSOLVE mixes; ZOOM pushes the
   outgoing picture in to 1.3x while mixing; SPIN turns it a quarter turn and shrinks it away over the next clip.
4. **Duplicate** copies the transitions onto the copy's clips. The render snapshot carries `transitions [{clip_id, kind, duration_us}]`.
5. **Templates** are the organization's saved reel looks: `effect_presets` rows (`schema_version` reel-look/1) holding the aspect and the full
   settings (spotlight, overlays, logos, music, intro / outro). `GET/POST /v1/reel-templates`, `PUT/DELETE /v1/reel-templates/:id`,
   `POST /v1/reels/:id/apply-template {template_id, version}` -> `{reel, left_out[]}`. Names are unique per organization regardless of case
   (NAME_TAKEN). Applying sets the look, not the clips; a logo, music or video that is gone or whose rights are not in force now is left out and
   named. Editors and owners save, apply and delete; viewers see the list; other organizations see nothing (404).
6. The page: the Transitions lane shows "+" on every cut and the transition (kind, length) where one is set; a menu sets None / Fade / Dissolve /
   Zoom / Spin and 0.4 / 0.6 / 1.0 s, with undo. The Media Bin's Templates tab names and saves this reel's look, and applies, updates or deletes a template.

## Tests
- `apps/api/test/templates.api.test.ts`: first clip refused, too long refused, kinds and lengths validated, viewer 403, other organization 404,
  stored on the TRANSITION track, render snapshot in microseconds, copied by Duplicate, removed with the clip, audit; templates saved, NAME_TAKEN,
  listed for viewers, other organization kept out, applied with clips untouched, STALE_VERSION, lapsed logo left out, update, delete.
- `services/worker/tests/test_render_reel.py`: each kind blends two pictures and only a fade shows black; a reel with transitions renders with its
  frame count and sound length unchanged and the fade's middle black.
- API 177, web 58, tests/db 88 (inventory regenerated for 0041), type checks clean.
