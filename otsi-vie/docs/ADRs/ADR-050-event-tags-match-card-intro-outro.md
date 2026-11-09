# ADR-050 — Event tags, the match card, and intro / outro videos in a reel

**Date:** 2026-11-02 · **Status:** implemented; worker render test on real footage and API tests pass · **Owner request:** "Hope engine
will identify and be able to differentiate the events and tag them accordingly in the reel. Example, When Godwin score a free kick, the
reel will tag it accordingly and each reel should show the information of the game (date, clubs, venue, stadium). Also, engine should
have options of adding intro/outro" (2026-11-02, with the owner's own 8 s QHD outro as the example file)

## Decision
- **Event tags:** each clip's label (the suggested moment's label the person added, e.g. "Free-kick goal" (ADR-049), "Key pass",
  "Tackle (possible)"; none for a hand-made clip) is drawn in capitals, sliding in above the lower third at the start of the clip and
  fading with it. Setting `event_tags` (default on). The tag says what the engine recorded, with its "(possible)" when it is a reading.
- **Match card:** an opening card of 3 s: the competition, "home v away" (the clubs' full names), the kick-off's date and the venue —
  only what the match record (Matches page) holds; nothing typed into the reel. Needs both clubs. Setting `match_card` (default on).
- **Intro / outro:** a video the organization uploads (`POST /v1/brand-assets/video`, raw MP4 / MOV / WebM recognised by its bytes,
  ≤ 80 MB) with the same rights declaration as logos and music (ADR-044/047): brand asset kind `REEL_VIDEO` (migration 0034), grant
  REEL_OVERLAY + REEL_AUDIO (seen and heard). Settings `intro_id` / `outro_id`; checked like a logo when saved and when rendered (missing,
  retired or rights withdrawn: refused). The renderer plays at most 30 s of each, fitted inside the reel's frame (padded in the reel's
  navy, never cropped or stretched; 9:16 and 1:1 too), at the reel's frame rate, with its own sound.
- **Order:** intro → match card → clips (spotlight, tags, overlays) → end screen → outro. One audio track: the intro's sound, silence
  under the card, the clips' match sound (with the music, ADR-047, under the card, clips and end screen only), the outro's sound
  (silence if it has none). Frame counts are exact; the validator checks the whole file as before. The manifest records the inserts'
  frames and both switches.
- Page 06: one link in the Branding header, "Intro, outro, tags ›" (approved design extended at the owner's request, no section moved),
  opens a dialog with the two switches, the videos (watch, use as intro / outro, none) and the upload form. Save Project / Generate Reel
  keep the choice.
- A render snapshot without the switches (queued before this change) draws neither.

## Tests
`services/worker/tests/test_render_reel.py::test_an_intro_the_match_card_the_event_tag_and_an_outro_render_in_order_with_their_sound`
(real footage: 4:3 intro with sound fitted with navy sides, the card, the tag lower left, the red outro last, exact frames, one audio
track of the full length; an unreadable intro gives no frames → INTRO_UNREADABLE). `apps/api/test/reels.api.test.ts` (upload checks,
grant uses, privacy, video not usable as music, the render fixes both files and each clip's label, a retired video refused; the card's
facts in the snapshot).
