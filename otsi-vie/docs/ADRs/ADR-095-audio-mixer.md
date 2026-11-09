# ADR-095: Audio mixer, per-clip sound level, reel loudness target (v3 Phase B.20)

Date: 2026-11-07. Status: accepted.

## Decision
- **Per-clip level:** `clip_fx.gain_db`, from −60 to +12 dB (0 = as recorded; −60 or lower = muted).
  - Stored in the existing `clip_fx` JSON, so there is no migration. It is set through the existing fx call and is one undoable edit.
  - Worker `_audio`: applies `volume=…dB` to each stretch of the clip. A muted clip becomes silence of the same length, so picture and
    sound stay equal.
  - Contracts `gainFactor` and worker `clip_gain_db` follow the same rule.
- **Loudness target:** `settings.loudness_lufs`, `null` (Automatic) or −31 to −9.
  - When set, every file of the reel is normalised to it (`render_jobs.config.audio.lufs`).
  - Automatic keeps each export profile's own level: −16 / −14 / −23.
  - The choices are listed in `LOUDNESS_TARGETS`: Automatic, Broadcast −23 (EBU R128), Online −16, Social −14.
  - Normalisation is the existing offline two-pass FFmpeg `loudnorm` (free, local).
- **Mixer:** Adjustments → Sound, top to bottom:
  - this clip's level (Mute, −12, −6, As recorded, +3, +6 dB);
  - music and match sound levels and ducking (existing);
  - the loudness target;
  - the loudness measured on the last good file (`result.loudness_lufs`) against its target.
- **Preview:** the video's volume follows the clip's level. A browser can only lower a video's volume, so a boost is heard only in the
  file; the panel says so.
- "Changed since the last file" notices a changed clip level. A changed loudness target counts as a settings change, as before.

## Tests
- API (`reels.api.test.ts`):
  - the loudness target is stored; −40 is refused; a REEL render then carries −23;
  - clip mute at −60 is stored; +13 dB is refused.
- Worker:
  - `clip_gain_db`;
  - a real render of one window three times (as recorded, −12 dB, muted): −12 dB is about a quarter of the RMS, and muted is silent.
- Web and API suites green (185 / 242).
