# ADR-047 — Music under a reel: uploaded by the organization with a rights declaration, mixed by the renderer

**Date:** 2026-11-02 · **Status:** implemented; API, worker and web tests pass; picker seen in the browser; not yet used by the owner ·
**Owner request:** "And no music user can add/upload" (then "Yes, build all")

## Problem
Page 06's Music field was disabled: no music library is connected, and a paid library is excluded (ADR-030, zero cost). A reel had only
the clips' match sound.

## Decision
- The organization uploads its own music, like a logo (ADR-044): a `brand_assets` row of kind **MUSIC** with the uploading person's rights
  declaration (who owns it, why it may be used: own music, licence, **free licence** such as Creative Commons BY, or written permission;
  a confirmation box). The declaration is a `rights_grants` row allowing **REEL_AUDIO**. Migration 0033 widens the two CHECK constraints.
- `POST /v1/brand-assets/music`: raw audio bytes (≤ 25 MB; MP3, WAV, M4A/AAC, OGG, FLAC, recognised from the bytes, not the declared type),
  the name and declaration in header `x-asset-meta` (base64url JSON). `GET /v1/brand-assets/:id/file` plays it (session-checked).
- Reel settings gain `music_id`, `music_volume` (default 80 %) and `match_volume` (the match sound under it, default 30 %). Choosing music
  checks it is this organization's, of kind MUSIC, with its grant in force; queuing a render checks again and fixes `music` (file key and
  loudness) in the render's config.
- The renderer (`render/reel.py: mix_music`) loops the music to the reel's length (end screen included), fades it in (0.5 s) and out (2 s),
  and mixes it over the match sound (FFmpeg `amix`, LGPL build); with no match sound, the music alone. An unreadable file fails the render
  with MUSIC_UNREADABLE. The manifest records the loudness.
- Page 06 → Reel Info → **Music** opens the picker: No music / the organization's music (Listen, Use), the two volume sliders, and Upload
  music. The audio lane of the timeline names the music and both volumes. Save Project / Generate Reel keep the choice.

## Alternatives
- A built-in royalty-free library: none is free for commercial redistribution without terms to review; can be added later as uploads.
- Uploading in chunks like videos: music files are small; one request (proxy and API accept 25 MB).

## Limits
- The declaration is the person's statement, not legal clearance (as for logos). No beat-matching or ducking under commentary.

## Tests
`apps/api/test/reels.api.test.ts` "music (ADR-047)": details and confirmation required, non-audio refused, viewers cannot upload, the grant
is REEL_AUDIO, private to the organization, served as audio/mpeg; a logo slot refuses music; settings saved; the render's config carries
the file and loudness; withdrawn rights refuse the render. `services/worker/tests/test_render_reel.py`
"music is mixed": a 3 s tune looped and cut to a 7.5 s reel over match sound and alone; an unreadable file gives None. Web typecheck. In the
browser: Page 06 → Music opens the picker; a 20 MB request passes the web proxy to the API.
