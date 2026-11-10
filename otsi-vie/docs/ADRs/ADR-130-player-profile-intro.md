# ADR-130: Player Profile Intro — the OTSI PIN, manual profile entry, and the 16:9 opening segment (DRAFT, owner approval pending)

- **Status:** Draft. This ADR records the Player Profile Intro build on `muse/ultra-main`; it needs owner approval before it is
  presented as accepted. It changes no accepted ADR; it builds on ADR-016 (canonical OTSI Player ID), ADR-032 (reel builder and
  render), ADR-044/047/050 (brand, music, intro/outro and match card), ADR-056/099 (player report and identity gate) and ADR-124
  (evidence rules: unknown beats wrong).
- **Date:** 2026-11-10 (Muse, `muse/ultra-main`, base `a721d36`)
- **Decides:** what the player's unique ID is, what a person may enter about a player, and how the intro segment opens a reel.

## Context

The owner's core requirement (2026-11-10): player identification and consistent tracking of the same particular player across camera
clips and frames, with a UNIQUE player ID given to each single player; users must be able to manually (optional) enter player profile
data that the Reel Builder uses at the very beginning of the reel. The Player Profile Intro is a professional 16:9 opening segment
automatically placed at the very beginning of the generated highlight reel, before the first football clip, using the selected player's
actual profile — not invented statistics or identity details. The design reference (`Player_Profile_Intro.png`) shows the layout:
TARGET PLAYER photo, name + shirt number, position, OTSI PIN, current club, nationality, age/DOB, height/weight, preferred foot, Key
Performance Stats (games analysed, total minutes, goals, assists), Player Strengths, pitch heatmap + main position, Player Summary,
Recent Form ratings, Club & League, International Career, "Player Identity Verified" badge, "Continue to Reel" action. The pictured
player's details are layout reference only.

Track U (U.1–U.12, ADR-125–129) is the tracking foundation: it keeps one track on one player across occlusions, cuts and crossings.
This ADR is the identity/profile layer on top of it. The intro's identity comes from the same confirmed decisions the spotlight
already pins (ADR-032): a reel follows one player a person confirmed, and its targets pin the exact identity decisions.

## Decision

### 1. The OTSI PIN is the canonical OTSI Player ID — no second identity system

- Every player gets one stable, unique OTSI PIN: the `canonical_otsi_id` of the registry (ADR-016), issued exactly once by the
  allocator `sp_issue_canonical_player_id`, never reused, stable across clips, matches and reels, merge-resolved through
  `v_player_identity`. A reel's clips resolve to the same PIN for the same player because they resolve to the same player through
  the track identity decisions Track U produces.
- **Format note, for the owner to confirm:** the reference image shows `OTSI-P-0000001847`. That is a mock format from a design
  mock. The engine's real, allocator-issued format is `OTSI-CCC-YYYY-NNNNNN` (e.g. `OTSI-FRA-2026-000001`), in place since ADR-016
  with its issuance ledger, uniqueness constraints and merge history. This ADR does NOT create a second allocator or a second ID
  format: a parallel PIN would be a second, competing identity, and every consumer (reels, reports, search, exports) already reads
  the canonical one. The intro displays the canonical ID under the label "OTSI PIN". If the owner wants the `OTSI-P-…` format
  instead, that is a registry change (new allocator namespace, migration of every issued ID), not an intro change — it needs a
  separate decision.
- A PROVISIONAL player has no PIN yet: the intro shows "Unconfirmed — no OTSI Player ID yet", never a made-up number.

### 2. Manual profile entry: user-entered, all optional, provenance kept

- New table `player_profile_details` (migration 0067, one row per player): height_cm (100–250), weight_kg (30–200), photo_asset_id,
  strengths (JSON, at most 6 strings of at most 60 characters), summary (at most 600 characters), club_name, league,
  international_country_code (+ caps, goals, each at least 0). Every column is nullable; a field left empty stays empty.
- The existing profile (birth date, preferred foot, nationality, position — `PATCH /v1/players/:id/profile`) is unchanged. The new
  fields are `PATCH /v1/players/:id/profile-details` (a field left out is unchanged, null clears it), same ownership rule (only the
  organization that created the player), each change audited (`player.profile_details_updated`).
- The photo is `POST /v1/players/:id/photo`: raw PNG/JPEG bytes, at most 512 KB (the brand logo limit), with the rights declaration
  in `x-asset-meta` (base64url JSON: rights_holder, rights_basis, confirm_rights), following the brand music/video uploads. Stored
  as an asset (`assets.kind = 'PLAYER_PHOTO'`) with an EXPORT_ALLOWED grant for REEL_OVERLAY. The render refuses the intro's photo
  while the grant is not in force (409 PHOTO_RIGHTS_MISSING, surfaced in the Export preflight too). An earlier photo's file is left
  in place (files are never deleted); the details row points at the newest one.
- Provenance: every details field is USER_ENTERED. The intro and the preview mark user-entered fields ("Entered by user") and never
  fill one from a guess. The club shown is the match team sheet's first; the entered club_name is used only where no team sheet
  names one, and is then marked as user-entered.

### 3. The intro segment: first in the reel, in the existing renderer

- New setting `SpotlightSettings.profile_intro` (default true): the intro is automatic; a person turns it off in the Reel Builder.
- The API fixes the intro into the render snapshot as `profile_intro` (flat JSON: `ProfileIntroSnapshot` — the key is `profile_intro`
  because `profile` already means the export profile in that snapshot). The worker draws it from that snapshot and nothing else.
- Render order in `vie-render` (the same renderer, no separate one): profile intro (PROFILE_S = 6 s) → intro video → match card →
  clips → end screen → outro video. The intro's frames count in `lead_n`/`lead_s` like the match card's do, and the sound is silent
  under it like under the match card. When the setting is on but an older snapshot carries no `profile_intro`, the render draws no
  intro and records that in the manifest — it never fails for a missing profile.
- Preview: the Reel Builder opens with a "Player Profile" step showing the same data (`GET /v1/players/:id/profile-intro`, optional
  `?reel_id=`), with a "Continue to Reel" action advancing to the reel steps. The preview is the same data the render draws.

### 4. The verified badge: one rule, enforced in code

- "Player Identity Verified" appears ONLY when all three hold: (a) the player is REGISTERED (his permanent OTSI Player ID issued;
  RETIRED counts as registered), (b) a person confirmed at least one track as him in this organization (the same count the report
  gate uses — `confirmedTrackCount`, ADR-099), (c) when the intro opens a reel, that reel's targets are still current (not stale —
  the same rule `ReelsService.get` uses). The API decides it (`introVerified`, contracts) and the worker draws the badge only when
  the snapshot says `verified: true`; the worker never decides identity itself. Anything less: no badge, and the intro says the
  identity is unconfirmed.

### 5. Evidence rules (ADR-124): what the intro may and may not show

- Key Performance Stats come from `PlayerMeasures` (tracks a person confirmed as him, every video of the organization): games
  analysed = videos with a confirmed track; total minutes = minutes seen on camera (labelled so — never "minutes played"); goals =
  GOAL events on his confirmed tracks (null while the ball was followed in none of his videos). Each number names its basis.
- Assists are NOT measured: the engine does not link a pass to a goal (ADR-124: a chance created is a pass directly assisting a
  confirmed shot, which is not measured either). The intro shows "Not measured" with that reason, never a number.
- Recent Form has no engine model behind it (there is no per-match rating model), so it is always "Not measured" with that reason
  until one exists.
- The heat map is his measured positions only (`HeatZones`); where nothing was measured the intro draws the pitch outline with
  "Not measured", never invented heat. The main position is the team sheet's position first, then the recorded usual position.
- No photo entered: a plain "No photo" area, never a stock face. No strengths/summary/club/league/international entered: "Not
  entered". Nothing in the intro is filled from the reference image.

## Consequences

- The intro is part of every render by default; turning it off is a per-reel setting, recorded in the reel's settings and in the
  render manifest (the manifest's `profile_intro` snapshot is the evidence of what was shown).
- The photo adds a rights gate to rendering (like a logo): a reel with an intro photo whose grant lapsed is refused at render time
  with a named error, and the Export preflight shows it as BLOCK.
- The `OTSI-P-…` format question is left open for the owner (see §1): this ADR deliberately does not invent a second ID.

## Verification

- Contracts build clean (`pnpm build` in `packages/contracts`); API typecheck clean apart from 3 pre-existing errors in files this
  change does not touch (`pressing.ts` sliceFor, `test/events.api.test.ts`, `test/load.api.test.ts`).
- API tests for the intro live in `apps/api/test/profileIntro.api.test.ts` (run on the owner's host: they need MySQL).
- Worker tests for the rendered intro and web tests for the preview are in their slices (see the commits).
- Not verified here: a live render of the intro (no GPU/OpenVINO/weights/footage in this workspace) or a click-through of the
  preview (no running engine here) — visual confirmation on the owner's host is the honest last step, as with every UI pass.
