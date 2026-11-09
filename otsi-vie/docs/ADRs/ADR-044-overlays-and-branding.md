# ADR-044 — Reel Builder overlays and branding: every right-column control is real

**Date:** 2026-11-02 · **Status:** implemented; API, worker and real-footage render tests pass; seen in the browser (switches live, logo
window); not yet rendered from the app by the owner (the render worker runs the new code after the dev stack restarts) · **Owner
request:** "I noticed almost all the toggle switch in the right column are dead." → "Yes, build them"

## Decision
Page 06's right column (Spotlight Controls, Player Targeting, Overlays, Branding) had eight controls drawn but disabled because the
renderer could not do them. All are built. Each is part of the reel's saved look (`SpotlightSettings`, contracts `reels.ts`) and takes
effect in the next render.

| Control | What the render does | Source of what is drawn |
|---|---|---|
| Vignette Strength (0–1) | darkens the picture's corners | — |
| Target Lock Sensitivity (0–1) | how readily the spotlight bridges a moment where he was not found: gap 0.3–0.9 s, re-analysis points within 0.4–0.8 body heights of his path; 0.5 = the ADR-032 rules. It never follows anyone else | — |
| Auto Track Player | on: the player is re-found 10×/s in every clip (smooth, slower). Off: the analysis's own positions only (faster); gaps up to 0.6 s are always bridged | — |
| Match Score & Time | team names and the match clock, top-centre | the video's match (short club names); the clock **only from halves a person confirmed**; **no score** (not measured) |
| Competition Logo | top-right | a brand asset with a rights declaration |
| Animated Lower Third | name, OTSI Player ID and club slide in at the start of each clip (0.3–3.8 s) | player identity; club from the match roster |
| Use OTSI VIE Watermark | small "OTSI VIE" bottom-right; "Made with OTSI VIE" on the end screen | — |
| Custom Logo | bottom-right, above the watermark | a brand asset with a rights declaration |
| End Screen | a 3-second closing card after the last clip (name, ID, club, reel title, logos), with silence under it | as above |

Everything an overlay draws is fixed in the render's snapshot (`render_jobs.config.overlay`) when the render is requested; the worker
reads nothing else for it, and the manifest records what was drawn (`overlays`) and the target-lock rules used (`rules`).

**Logos and rights (Page 06: "branding asset provenance and licensed usage enforced; render disabled when required image rights
lacking"; "no unauthorized competition insignia").** Migration `0032_brand_assets.sql`: `brand_assets` (kind, name, rights holder,
basis: own brand / licensed / written permission, uploader) and a `rights_grants` row per logo file (EXPORT_ALLOWED, allowed use
REEL_OVERLAY). The upload (`POST /v1/brand-assets`, PNG or JPEG up to 512 KB, real format checked) requires the person to tick "I confirm
we have the right to show this logo in our reels"; the statement is recorded with who made it. A reel can choose a logo only of its own
organization and kind; saving and rendering are refused (`BRAND_RIGHTS_MISSING`) when the grant is not in force. Logos are retired, not
deleted. The declaration is the user's statement, not legal clearance (ADR-030); attaching evidence documents to the grant is not built.

**Text in any script.** Pillow's default font has no Cyrillic (team names in the owner's footage are Cyrillic). The renderer now draws all
text with Inter, the app's own font (SIL Open Font License, copied with its licence into `services/worker/vie_worker/render/fonts`), which
ships split by script: each character uses the subset whose unicode range claims it. Zero cost.

**Placement.** The score / time box is top-centre: broadcasts usually carry their own scoreboard top-left (the owner's footage does).

## Alternatives
- Showing the score from `matches.home_score/away_score`: that is the final score, wrong during the match. Unknown beats wrong: no score
  until goals are measured or entered with their time.
- Showing the clock from the engine's PROPOSED halves: an unchecked guess; the clock appears once a person confirms the halves on Analysis.
- Logos without a declaration: forbidden by the Page 06 spec.

## Tests
- Worker `tests/test_overlays.py` (8): clock from confirmed halves only, lower-third timing, target-lock rules (0.5 = old rules; strict
  rejects a point the default accepts), every switch off leaves the frame untouched, vignette, score box without a score, logo / lower
  third / watermark placement, end screen length and fade.
- Worker `tests/test_render_reel.py`, new real-footage test: every switch on (Cyrillic team name, strict lock, Auto Track off, both logos,
  end screen) → a valid H.264 MP4 of clip + 3 s, audio as long as the video, manifest records the overlays, logos in their corners.
- API `test/reels.api.test.ts` (2 new): upload refused without the declaration, for a non-image, for a viewer; private to the
  organization; wrong-kind logo refused; snapshot carries the overlay facts and logo key; expired rights refuse the render; retiring.
  Team names from the match; clock only after the halves are confirmed; no score in the snapshot. Full API suite 147/147.
- Web typecheck; web tests 56/56. In the browser: all sliders and switches enabled on a reel; the logo window opens, Upload stays disabled
  until file, name, owner, reason and the tick are given; closed without uploading.
