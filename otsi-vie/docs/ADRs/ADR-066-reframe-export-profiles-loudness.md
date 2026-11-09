# ADR-066 Player-following reframe, export profiles, loudness and ducking (editor stage E3)

**Date:** 2026-11-06. **Status:** accepted (owner: "Approve editor stages E1–E5", "Yes, start E3"). **Migration:** none (settings and render config are JSON).
Source: docs/research/filmora/11-lessons-and-roadmap-for-otsi.md, stage E3 "One edit, every format".

## Decision
**Reframe (9:16 and 1:1)** follows the reel's confirmed player like a calm camera operator. One rule per language: `render/reel.py`
`crop_target` / `crop_alpha` and `apps/web/src/components/studio/spotlight.ts` `cropTarget` / `cropAlpha` (the live preview shades
what the file leaves out).
- Aim: 60 % where he is, 40 % where he will be 0.4 s later (look-ahead from his recorded path).
- Dead zone: the frame holds still while the aim stays within 12 % of the frame's width from its centre; outside, it moves only far
  enough to bring him back to the zone's edge.
- Where he was not seen, the frame holds where it was (unknown beats wrong; no guessed movement).
- Follow speed (`settings.reframe_speed`, 0 calm … 1 quick, default 0.5): per-frame smoothing 0.04 … 0.2; 0.5 is the earlier 0.12.
- No zoom punch-in yet.

**Export profiles**: several files from one edit (`CreateRenderRequest.profile`, `EXPORT_PROFILES` in contracts).
| Profile | Frame | Loudness | Bitrate |
|---|---|---|---|
| REEL | the reel's own | −16 LUFS | as chosen |
| SCOUT | 16:9 | −16 LUFS | as chosen |
| SOCIAL | 9:16 | −14 LUFS | as chosen |
| ARCHIVE | 16:9 | −23 LUFS (EBU R128 broadcast) | 20 Mbps |
- The render snapshot records `profile`, the profile's `aspect`, and `audio {lufs, true_peak_db −1.5, duck_music}`.
- One open render per profile, so the scout and social cuts queue together; a second render of the same profile is refused (409).
- `Reel.formats`: the newest finished file of each profile and frame. The Export page lists them to download under Output Preset.
- Output Preset on the Export page is real: "Highlights Reel", "Scout + Social cuts" (two renders), "Archive master".
- The rendered state of the editor ignores the frame of a non-REEL file, and compares settings with today's defaults filled in, so a
  render made before E3 is not marked changed by new settings keys.

**Loudness**: the whole reel sound (clips, music, intro / outro) is set to the profile's integrated loudness with ffmpeg `loudnorm`
in two passes (measure, then a linear gain where the range allows), true peak −1.5 dBTP, 48 kHz. Silence is left as it is. The
measured loudness after is recorded in the render result (`loudness_lufs`) and the manifest (`audio_rules`). The preview plays the sound as recorded.

**Ducking** (`settings.duck_music`, default on): with music, the music passes a `sidechaincompress` keyed by the match sound as
recorded (threshold 0.02, ratio 6, attack 40 ms, release 700 ms), so it dips under crowd, whistle and commentary (measured: about 8 to 13 dB under loud match sound).

**Editor**: the Adjustments tab gets "Reframe" (frame 16:9 / 9:16 / 1:1, undoable; follow speed) and "Sound" (music and match
levels, ducking, the loudness of each export). "Zoom" is replaced by "Reframe"; the punch-in is said to be not built.

## Alternatives
- Saliency / automatic reframe models (paid or heavy): rejected; we follow the confirmed player's own recorded path, which is free and explainable.
- One-pass `loudnorm` (dynamic): less faithful to the mix; two passes are used. A plain gain to a peak level: does not match platform loudness.

## Not covered
- No zoom punch-in; no vertical reframe (the crop is horizontal only, as the reel frames are full height).
- No 4:5 frame. No per-platform resolution choice (the source resolution is kept).
- The preview does not apply ducking or loudness.

## Tests
- API: `reels.api.test.ts` "export profiles": snapshot per profile, one open per profile, 422 for an unknown profile, archive bitrate, `formats`, settings into the render.
- Web: `test/reframe.test.ts` (crop parity, follow speed, rendered state with profiles and older renders).
- Worker: `test_render_reel.py`:
  - `test_reframe_crop_rules_match_the_editor_preview` (the same cases as the web test);
  - `test_music_dips_under_loud_match_sound_and_the_loudness_is_set_to_the_target` (ducking, −14 / −23 within 1 LU, silence);
  - `test_a_social_9_16_cut_follows_the_player_with_ducked_music_at_its_loudness` (real footage: 9:16 file, −14 LUFS measured from the MP4 within 1.5 LU, manifest).
