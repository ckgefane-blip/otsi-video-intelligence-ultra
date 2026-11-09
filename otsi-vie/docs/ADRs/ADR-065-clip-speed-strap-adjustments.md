# ADR-065 Clip speed effects, data-bound strap, Adjustments inspector (editor stage E2)

**Date:** 2026-11-06. **Status:** accepted (owner: "Approve editor stages E1–E5", "Yes, start E2"). **Migration:** 0046_clip_speed_effects.sql.
Source: docs/research/filmora/11-lessons-and-roadmap-for-otsi.md, stage E2 "Highlight grammar".

## Decision
**One speed effect per clip** (columns `effect_kind`, `effect_at_us`, `effect_hold_ms`, and the existing `playback_speed`):
- NONE: plays as recorded.
- SLOW: the whole clip at 0.5x or 0.25x.
- FREEZE: the picture stops at the key moment for 0.5 to 3 s, the spotlight held on the player, then plays on. The match sound is silent while frozen.
- RAMP ("hero ramp"): eases down to 0.5 / 0.35 / 0.25x at the key moment and back up over one second either side, in 8 steps.

The key moment is a source time inside the clip: the playhead when it is inside, else his most important engine event in the clip.
A trim that leaves it outside keeps the effect stored but inactive, so undoing the trim brings it back.

**Rules, one implementation per language:** `packages/contracts/src/retime.ts` (`retimeSegments`, `clipOutputUs`, `srcAt`, `outAt`,
`strapStartUs`) and `render/reel.py` (`retime_segments`, `seg_frames`, `output_plan`, `strap_offset_s`). Tests in both check the same
lengths (4 s clip: SLOW 0.5 = 8 s, FREEZE 1.5 s = 5.5 s, RAMP 0.35 = 5.38 s).

**Renderer:**
- Every reel frame shows the source frame nearest its planned source time: slow motion repeats frames and a freeze holds one.
  There is no optical-flow interpolation (free and exact, but less smooth; `minterpolate` is a later option).
- The sound is cut per stretch to exactly its frames: slowed with `atempo` (pitch kept), silence while frozen.
- Picture and sound stay the same length (real-footage test).
- Music, end screen and inserts use the retimed reel length.
- The manifest records each clip's effect and frames.

**API:**
- `PATCH /v1/reels/:id/clips/:clipId/effect` (`SetClipEffectRequest`, normalised).
- Refused with 422 when a FREEZE or RAMP has no key moment, the moment is outside the clip (`EFFECT_OUTSIDE_CLIP`), or the reel would
  exceed 10 minutes (`REEL_TOO_LONG`).
- `Reel.duration_us` and every clip length on screen count the effect.
- The render snapshot carries each clip's effect.

**Strap and caption (data-bound):**
- The lower third reads: name, `#shirt number` and position from the match team sheet as recorded, the OTSI Player ID and the club.
- Only the reel's confirmed player has a name. With no team-sheet entry there is no number.
- With a FREEZE or RAMP, the strap and the event caption start one second before the key moment; otherwise at the clip's start.

**Adjustments tab** (Clip Studio inspector, `Adjustments.tsx`):
- Driven by the selection: the selected clip, else the clip under the playhead.
- Collapsible sections:
  - Speed: the effect, the hold or slowest speed, and moving the key moment.
  - Strap & caption: on/off and the strap's real text.
  - Spotlight: darkening, size, softness, target lock, Auto Track, name above the head; each slider saves once on release.
  - Zoom and Look: "Not built yet", naming stages E3 and E5.
- The ribbon's Speed button opens this tab.
- The timeline marks a clip with its effect (0.5x / FRZ / RAMP), grey when inactive.
- The preview plays slow stretches at a lower playback rate and holds the picture for a freeze.
- The rendered state counts an effect change.

## Not covered
- No optical flow.
- The ramp is stepped (8 steps), not continuous.
- The ring setting is still not drawn; the beam's pool at the feet is the ring.
- The 10-minute check when adding a clip still counts source lengths. Setting an effect counts reel lengths.

## Tests
- API: `reels.api.test.ts` "speed effects": lengths, key moment, 422 / 404 / role, inactive after trim, render snapshot.
- Web: `test/retime.test.ts`.
- Worker: `test_render_reel.py`:
  - retime parity;
  - a real-footage reel with SLOW, FREEZE and RAMP clips (frames, sound length, the picture still in the freeze).
- Browser: the Adjustments tab on the owner's reel, viewed only (release-evidence/e1-live-spotlight/e2-adjustments.jpg).
