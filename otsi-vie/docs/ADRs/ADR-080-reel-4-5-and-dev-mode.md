# ADR-080: 4:5 reel frame and Dev mode for "not built" notes (v3 Phase 0.13, 0.12)

Status: accepted. The owner approved Phase 0 on 2026-11-06 and said "Yes, go" to these two leftovers on 2026-11-07.

## 4:5 frame (0.13)
- **What it is.** A reel's frame may be 16:9, 9:16, 1:1 or **4:5** (social feed posts). Like 9:16 and 1:1, 4:5 keeps the full source height, crops to its shape and follows the player.
- **Code.**
  - One table of ratios: `ASPECT_RATIO` in the contracts and in `render/reel.py`.
  - `_output_geometry` (render) and `cropWidth` (preview) read the same numbers.
- **Database.** Migration 0051 widens `ck_reel_projects_aspect`. It is forward-only, and existing rows keep their value.
- **Screens.** 4:5 can now be chosen in:
  - Reel Builder (four tiles in the Aspect Ratio panel);
  - Clip Studio › Reframe;
  - Export (the 4:5 tile was there but disabled; now it works);
  - the draft dialog.

## Dev mode (0.12, S09)
- **What it does.** `lib/devMode.ts` sets what each person reads:
  - The app built with `NEXT_PUBLIC_OTSI_DEV_MODE=1` (local development) says "Not built yet: <detail>".
  - The live app says "Not available yet", so no internal note reaches a customer.
- **What stays the same.** Controls behave as before: they explain themselves and do nothing they cannot do.
- **Where it applies.** All hard-coded "not built" texts now go through `notBuilt()` / `NOT_YET`:
  - Export, Library, Processing, Reel Builder, Clip Studio, Tactical, Upload and Analysis.
  - Player Report says "not measured" for a measure that is not built.
- **What is kept.** Upload's "saved · not performed yet" for requested options stays; it is true for customers as well.

## Not changed
- **0.10, Library left-panel controls.** They are kept, because they work (the time range filters the Events tab). Removing them needs the owner's word.

## Tests
- **Web:** `devMode.test.ts` (2), plus a 4:5 crop width in `spotlight.test.ts`. 143 pass.
- **API:** `templates.api.test.ts` stores and returns 4:5. 226 pass.
- **Worker:** `test_each_reel_frame_crops_the_full_height_to_its_shape`.
