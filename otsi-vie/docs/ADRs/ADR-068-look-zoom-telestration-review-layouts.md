# ADR-068: Clip Studio E5 "Pro polish": colour look, keyframed zoom, telestration, review comments, task layouts, shortcut map

Status: accepted (owner approved editor stages E1–E5; "Yes, start E5", 2026-11-06)

## Decision
- **Colour look (per reel, `settings.look`).** One formula in two languages (`packages/contracts/src/look.ts`, `services/worker/vie_worker/render/look.py`):
  per channel `clamp(slope·v + intercept) ^ exponent`, then saturation around Rec. 709 luma. Seven presets (None, Broadcast, Warm sun,
  Cool night, Punchy, Film, Black & white) at a strength, plus exposure, contrast, saturation and warmth.
  - Preview: an SVG filter on the video (`feComponentTransfer` linear, then gamma, then `feColorMatrix saturate`, in sRGB).
  - Render: the same formula baked into a 33-point `.cube`, applied by FFmpeg `lut3d` in the clip decode, before the spotlight.
  - **Match to reference:** the editor takes a small copy of a frame ("Use this frame as the reference", kept for the browser tab, from
    any reel), then fits per-channel slope/offset so the current frame gets the reference's mean and spread. Slope is limited to 0.5–2 and offset to ±0.3,
    so a flat or dark frame is not blown out. Stored as `look.match` with its label.
- **Keyframed zoom (per clip, `reel_clips.clip_fx`, migration 0047).** Up to 16 keys (1–3x) in milliseconds of the clip as it plays in the reel,
  eased (smoothstep), linear or held. The window centres on the confirmed player's box (smoothed), held where he was last seen. Order in the
  render: after the spotlight and the drawings, before the strap and graphics.
- **Telestration (per clip, same column).** Up to 12 arrows, lines or circles in source-normalised points, in four colours. Each is drawn on
  over `draw_ms`, held for `hold_ms`, and fades over 250 ms. The editor draws it on a canvas; the render draws it with PIL. A drawing stays on the spot of the picture where it was drawn;
  it is not attached to a player (no fabricated tracking).
- **API.** `PATCH /v1/reels/:id/clips/:clipId/fx` (writers only, 422 `FX_OUTSIDE_CLIP` for a time past the clip's length, NULL when empty,
  audited, copied by Duplicate, in the render snapshot). The look is validated by the `SpotlightSettings` schema.
- **Review comments.** `GET /v1/reels/:id/review-comments`: guest comments left through share links of this reel's rendered files.
  - A render now records `result.lead_s` (intro + match card seconds).
  - A comment is placed on the timeline at `at_s − lead_s` only when it was left on the reel's last good render and the edit still matches that file.
  - Otherwise it is listed with the reason. Unknown beats wrong.
- **Rendered state** also compares each clip's zoom and drawings. Saved configs are compared key-order-independently (`stable()`), because
  MySQL JSON reorders keys.
- **Task layouts.** The header has Edit · Colour · Review. Each sets the inspector tab, the open Adjustments sections and the Media Bin tab. The choice is kept in
  localStorage. The ribbon's Color and Transform buttons, which were "not built", now open Look and Zoom/Draw.
- **Shortcut map.** One table (`studio/shortcuts.ts`) is shown by "?" and the header button. New keys: Space, ← / → (one frame), Shift + ← / → (one second),
  Home / End, Ctrl + Z / Ctrl + Shift + Z / Ctrl + Y, A / L / R (draw tools), Escape.

## Alternatives
- **A per-clip look:** rejected for now. One reel, one grade is what highlight reels need, and the LUT is built once per render.
- **CSS `filter` functions (brightness, contrast…) instead of an SVG filter:** rejected. They cannot express per-channel transfer, so the preview would
  not match the LUT.
- **Drawings attached to a tracked player:** deferred. It needs per-frame identity at drawing time, and a wrong attachment would mislabel play.

## Limits (recorded)
- The preview zoom is applied to the full display frame. With a 9:16 or 1:1 reel the render zooms inside the crop, so the framing differs slightly (labelled
  approximate, like the spotlight preview).
- Match to reference uses the frames' raw source colours, not a graded reference.

## Tests
- Web: `apps/web/test/look.test.ts` (8): formula samples shared with the worker, match, zoom, drawings, review placement, key-order compare, shortcut table.
- Worker: `tests/test_look.py` (11): the same samples; the LUT through FFmpeg against the formula (within 2 levels); zoom; drawing draw-on and fade.
  `test_render_reel.py::test_a_colour_look_a_zoom_and_a_drawing_render_into_the_file` (real footage: grey picture, red arrow while shown, manifest, `lead_s`).
- API: `reels.api.test.ts` "pro polish (E5)": validation, FX_OUTSIDE_CLIP, roles, tenant 404, slow motion length, snapshot, duplicate, look, review comments.
