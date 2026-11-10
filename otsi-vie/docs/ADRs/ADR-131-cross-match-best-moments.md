# ADR-131: Cross-match best moments — one reel from all of a player's matches (DRAFT, owner approval pending)

- **Status:** Draft. This ADR records the cross-match best-moments build on `muse/ultra-main` (Build A: contracts selection, API,
  migration 0068); it needs owner approval before it is presented as accepted. It changes no accepted ADR; it builds on ADR-016
  (canonical OTSI Player ID), ADR-032 (reel builder and render), ADR-040–043 (events and suggested moments), ADR-044 (match
  time), ADR-049 (possible scorer), ADR-091 (moment rejection), ADR-124 (evidence rules: unknown beats wrong) and ADR-130
  (Player Profile Intro — the same PIN identifies the player in every match, and the intro opens the reel).
- **Date:** 2026-11-10 (Muse, `muse/ultra-main`, base `0429d5e`)
- **Decides:** the rule that picks a player's best moments across all his matches, the reel that holds them, and what the engine
  cannot measure (dropped, never faked).

## Context

Reels today are one player, one match. The owner asked (2026-11-10) for an OPTIONAL cross-match highlight: one reel of a player's
best moments from ALL uploaded videos/matches — instead of 10 reels from 10 games, ONE reel of the best moments from all 10 —
for professional use (to be sent to clubs, academies, scouts), so it needs breadth across matches (consistency, not one big game)
and a proper showcase length, not a 90-second social clip. All reels are for professional use: best moments are top quality,
professionally selected. The agreed rule (owner, 2026-11-10 13:29) is implemented exactly as stated; where the engine cannot
measure part of it, that part is dropped and recorded below — never approximated, never filled from a guess (ADR-124).

## Decision

### 1. The rule: fixed tiers, filled top-down, no weights, no judgement

A moment's tier is its best event's tier. The reel fills Tier S, then A, then B, then C; inside a tier, moments go in
chronological order, oldest match first (by kickoff date, then match minute, then media time; a match or minute not known sorts
after the known ones). A goal always beats a key pass; a key pass always beats a dribble. The selection is the pure contracts
function `selectCrossMatchMoments` (packages/contracts/src/cross-match.ts), shared by the API, the web builder and their tests —
one rule, one implementation.

| Tier | The owner's rule | What the engine measures (the implemented tier) |
|---|---|---|
| S | Goal, Assist | GOAL, FREE_KICK_GOAL, PENALTY_GOAL — the scoreboard changed and he was last on the ball (ADR-049, "possible scorer"); a free kick / penalty he took just before it makes it that kind of goal. Assist is dropped (see §2). |
| A | Shot on target, Key pass (chance created), Penalty won, Goal-saving tackle or block, Save (goalkeeper) | SHOT, KEY_PASS — a PASS whose receiver shoots from the same spell (actions key_pass). The "on target" qualifier is an open gap (see §2). Penalty won, goal-saving tackle/block and Save are dropped. |
| B | Successful dribble past an opponent, Through ball, Tackle won, Interception that starts an attack, Sprint at 85% or more of the player's own measured top speed in that match | TACKLE (possible), INTERCEPTION (possible), SPRINT — a measured Run whose top_kmh is >= 85% of the player's measured top speed in that match (Movement.top_speed_kmh for that video: the fastest pace held for 2 s). Dribble and through ball are dropped; "starts an attack" is not verified (see §2). |
| C | Completed long pass / switch of play, Duel won, Clearance under pressure, Recovery | BALL_WON and PRESSURE_REGAIN (shown as "Recovery"), PASS with length_m >= 25 m (the long-pass threshold, §3). Duel won and clearance under pressure are dropped. |

Not in any tier, never selected: set pieces as taker moments (FREE_KICK, CORNER, THROW_IN, GOAL_KICK, KICK_OFF, SET_PIECE,
PENALTY), a plain PASS (under 25 m, or length not measured), PASS_RECEIVED, PRESSURE, and VISIBLE stretches (cross-match
selection uses EVENT moments only, never VISIBLE — a stretch where he is on camera and did nothing is not a best moment).

### 2. Everything dropped, with its reason (nothing faked)

- **Assist (Tier S):** there is no ASSIST event type anywhere in the engine, and no pass-to-goal link (ADR-130 already records
  assists as not measured). A goal he scored is Tier S; a pass that led to one is not credited as an assist.
- **Shot on target (Tier A qualifier):** the engine records shots without an on-target flag (actions shot_from counts off-target
  shots too). The implemented tier is "Shot". Adding an on-target flag is a worker measurement change, not a selection change.
- **Penalty won:** the PENALTY moment is the set-piece taker's, not the player who won it — the engine does not record who was
  fouled. Dropped.
- **Goal-saving tackle / block:** the engine does not judge whether a tackle or block saved a goal (no goal-probability model).
  A tackle is Tier B as a tackle (possible); no goal-saving credit is given. Dropped.
- **Save (goalkeeper):** there is no goalkeeper-save event type. Dropped.
- **Dribble past an opponent:** there is no dribble event type (a dribble is not a detected action). Dropped.
- **Through ball:** there is no through-ball event type (a through ball is a pass with a receiver running behind the defence —
  the engine does not classify it). A long through ball counts as a long pass when its length is >= 25 m. Dropped as its own kind.
- **Duel won, Clearance under pressure:** there is no duel or clearance event type. Dropped.
- **"Interception that starts an attack":** the engine records INTERCEPTION only as a "possible" kind on a possession change
  (~50% by eye on wide footage, labelled "interception (possible)"), and does not verify that an attack followed. The implemented
  tier is "Interception (possible)" with no attack check.
- **TACKLE / INTERCEPTION "possible":** both are the engine's possible kinds (ADR-041), shown with "(possible)" in the reason and
  the clip label, as single-match moments already do.

### 3. The long pass and the sprint, operationalised

- **Long pass / switch of play: length_m >= 25 m.** The owner said "long pass / switch of play" without a number; 25 m is the
  fixed operationalisation (a switch across the pitch is well over it; a 25 m ball is a long pass in any league). A pass whose
  length was not measured (length_m null, e.g. the pitch was not calibrated) is never a long pass.
- **Sprint: a Run with top_kmh >= 85% of the player's measured top speed in that match.** Runs and top speed come from his
  measured pitch positions (positionsOf + movementOf, only where the pitch is calibrated): a Run is consecutive one-second steps
  at high speed, top_kmh its fastest step; the match top speed is Movement.top_speed_kmh (fastest pace held for 2 s, so one
  glitch cannot set it). The sprint candidate's window is the run padded like an event moment (4 s before, 5 s after, capped at
  the video). A sprint with no measured top speed for the match is not selected ("top speed not measured").

### 4. Length, caps, order, and the fill

- **Lengths:** the person chooses 90 seconds, 3 minutes (default) or 5 minutes. **5 minutes is a solid cap, never exceeded** —
  the fill only takes a candidate that fits entirely within the remaining length, and a selection at length_s=300 never exceeds
  300 s.
- **Moments caps:** about 12 / 20 / 30 moments for 90 s / 3 min / 5 min (CROSS_MATCH_MOMENT_CAPS). **At most 4 moments from any
  single match**, however good it was — breadth across matches is the point.
- **The fill ends deterministically:** the first candidate that does not fit entirely within the remaining length ends the fill;
  later candidates are listed as not selected with reason "length cap reached", even a shorter one that would have fitted. A
  candidate beyond the per-match cap is listed as "per-match cap reached" and does NOT end the fill. Reaching the moments cap
  lists the rest as "moments cap reached".
- **Fewer than 3 eligible moments:** build with what's there — no filler, no padding. (A reel with no moments at all is created
  empty, like a single-match reel before moments exist; rendering still refuses an empty reel.)
- **Order in the reel:** the Player Profile Intro first (ADR-130, settings default profile_intro true), then the selected clips
  in tier order (S, then A, B, C), chronological within a tier. Every clip is labelled with match, minute and reason
  ("Goal — 67' vs Ercakhu").
- **The minute is never invented:** the match minute is used only when the video's match halves are CONFIRMED (ADR-044),
  computed from the confirmed half windows and clamped to 45 / 90 like a broadcast clock (stoppage time is not modelled: a
  moment in first-half stoppage reads 45'). Otherwise the label uses media time ("Goal — 12:34 vs Ercakhu"). The opponent is
  the club that is not the player's in that match's team sheet; where it is not known the label falls back to the video title.

### 5. Evidence (ADR-124): only measured moments count

- A moment belongs to a player only through confirmed tracks (v_track_current_identity state='CONFIRMED'), per video. A video
  where he has no confirmed track, or no SUCCEEDED ball track, contributes nothing — the same rule as single-match moments.
- The player must be REGISTERED (his permanent OTSI Player ID issued; RETIRED counts) and have >= 1 confirmed track, else 409
  (PLAYER_NOT_REGISTERED / NO_CONFIRMED_TRACKS). A provisional player has no PIN that could identify him across matches, so no
  cross-match reel can follow him.
- **Dedupe:** the same moment twice (one video, overlapping window, same best event) is kept once ("duplicate moment"); a sprint
  candidate overlapping an already-selected event moment in the same video is dropped ("overlaps a selected moment") — a sprint
  that is the run-up to a goal is that goal's moment, not a second clip. (Edge, recorded: an event moment selected after a sprint
  it overlaps is kept as well — the rule only drops the sprint. Overlapping clips are legal in a reel.)
- **Manual override stays:** the person can pin a moment in (add a clip) or take one out (reject a moment per video, or remove a
  clip), but the rule is the default and never changes under them. A rejected moment is listed last as "rejected for this reel"
  (as single-match moments list rejected ones), and "add all moments" adds the selected ones not yet in the reel, in tier order,
  never past the length cap (a moment that does not fit is skipped, as single-match add-moments does).

### 6. Versioning

- The rule is version 1 (`BEST_MOMENTS_RULE_VERSION = 1`). The version is written into the reel at creation
  (`best_moments_rule_version`) and into the render snapshot (`selection: { rule: "best-moments", version: 1, length_s }`).
  Old reels keep the version they were built with, so a reel is always reproducible; the rule never changes under a reel. The
  worker stamps the version into the render manifest and the .otsi-reel in Build B (see §9).

### 7. Schema and API design

- **Migration 0068:** `reel_projects` gains `source ENUM('MATCH','ALL_MATCHES') NOT NULL DEFAULT 'MATCH'`,
  `cross_match_length_s INT NULL`, `best_moments_rule_version INT NULL`, and `video_id` becomes NULLABLE, with a CHECK that a
  MATCH reel keeps a video and no cross-match columns, and an ALL_MATCHES reel has no video and no single run, a length of
  90/180/300 and a rule version. All existing rows are MATCH with a video_id, so the migration is safe on them.
  `reel_moment_rejections` gains `video_id CHAR(36) NULL` so a rejection is per video. Known edge: the table's key is still
  (reel_id, in_pts_us), so two videos of one cross-match reel rejecting a moment at the exact same microsecond share one row —
  improbable (windows start at an event's second), and the API always filters rejections by video_id where one is recorded.
- **A cross-match reel pins targets across ALL the player's videos** (reel_targets rows for every confirmed track, every video)
  and stores the selection's chosen clips, each with its real source_video_id, in tier order (sequence_index in that order),
  origin SUGGESTED, label match + minute + reason. It lives in the project of his most recent analysed video (project_id has to
  be one project; the latest video's is the most current). `run_id` is NULL: there is no single run.
- **`GET /v1/players/:id/cross-match-moments?length_s=180`** (only 90/180/300): gathers his EVENT moments across all his
  analysed videos (confirmed tracks per video; latest SUCCEEDED ball track per video) plus sprint moments per video, applies the
  selection, and returns it with match labels and per-match counts. No reel is needed to see the selection.
- **`POST /v1/reels`** accepts `source: "ALL_MATCHES"` + `length_s` (default 180) with NO video_id (`video_id` stays required
  for source MATCH). Name defaults to "{display name} — best moments (all matches)".
- **`GET /v1/reels/:id`** returns `source`, `video_id` (null for cross-match), `cross_match_length_s` and
  `best_moments_rule_version` (null for single-match); clips include `source_video_id`. For a cross-match reel `match` is null
  (no single match — the match card cannot represent 10 matches) and `player_roster` is null, falling back to the player's latest
  team exactly as the web already does (PreviewPanel: player_roster ?? profile.latest_team). Nothing else in the single-match
  response changes.
- **`GET /v1/reels/:id/moments`** for a cross-match reel returns the selection for the reel's stored length (selected +
  not selected with reasons, in_reel marked from the reel's clips). Single-match reels return ReelMoment[], as today.
- **`POST /v1/reels/:id/clips`** accepts `source_video_id` (required for a cross-match reel, defaulting to the reel's video for
  a single-match reel); the clip is validated against THAT video's duration, the player must have confirmed tracks in it (for a
  cross-match reel), and adding it must not take the reel past its length cap (cross-match: the reel's length_s; single-match:
  10 minutes as today). Trims, swaps and speed effects use the same per-clip video and cap.
- **`POST /v1/reels/:id/clips/add-moments`** for a cross-match reel adds every SELECTED moment not yet in the reel, in tier
  order, stopping at the length cap. **`POST /v1/reels/:id/moments/reject|restore`** accept `video_id` so a cross-match moment
  is rejected per video.
- **`startRender()`:** the snapshot gains `selection: { rule: "best-moments", version: 1, length_s }` for cross-match reels, and
  every snapshot clip gains `source_video_id` (single-match clips get the reel's video id, as today). The overlay's match facts
  are null for a cross-match reel; club, shirt number and position fall back to his latest team. The intro opens it exactly as
  a single-match reel.
- **`duplicate()`** copies source, length_s, rule version and per-clip source_video_id. **`refreshTargets()`** re-pins targets
  across all his videos. **`path()`** cannot return one video's path for a cross-match reel: it returns an empty path with
  stale=false (Build B fetches paths per clip video another way).
- **Single-match ranking is untouched:** EVENT_SCORE still ranks single-match suggestions, and `moments()` (both modes) honours
  rejections. The tier rule is the selection standard for reels generally — a future step could rank single-match suggestions
  by tier too, but this build does not change them. The per-video event builder moved to cross-match.ts with its ranking
  intact; the reel-based wrapper over it is unchanged in behaviour (verified by the existing reels tests plus a single-match
  regression test in crossMatch.api.test.ts).

### 8. What stays single-video (deliberately not in this build)

- **Blocks** (blocks.ts, BLOCK_OTHER_VIDEO unchanged): a saved block holds clips of one video, so cross-match clips cannot be
  saved as blocks yet, and a block cannot be inserted into a cross-match reel (named 409).
- **Draft reels and templates** (candidates / assemble / replaceClips): they fill one match's clips, so they refuse cross-match
  reels with a named 409. **Boundary suggestions** are likewise one video's events (named 409).
- **The .otsi-reel export manifest** stays single-video for now; a cross-match export manifest (one manifest, many source
  videos) is follow-up work, not in this build. The worker multi-source render is Build B.

## Consequences

- A cross-match reel is a first-class reel: it renders, duplicates, refreshes and is listed like any reel, but its video is
  null everywhere a single video was assumed — every use of reel.video_id in the reels module branches on source, and the
  single-match paths are byte-identical in behaviour.
- The selection is reproducible from the rule version and the length stamped on the reel; the snapshot carries both, so the
  worker (Build B) needs nothing else to render the same reel.
- The tier rule's gaps are visible, not hidden: SHOT has no on-target flag, TACKLE/INTERCEPTION are "possible", and eight of
  the owner's kinds are not measured at all. Any of those becoming measured is a worker measurement change; the tier map then
  gains a row and the rule version goes to 2.

## Build B still to do

- **Worker multi-source render:** read the snapshot's `selection` and per-clip `source_video_id`, render clips from their own
  videos (spotlight per clip video), skip or adapt the match card (its facts are null), stamp the rule version and length into
  the render manifest and the .otsi-reel, and count the intro's lead like today.
- **Reel Builder UI:** the Player Profile step (already the intro's preview), the cross-match selection view (selected + not
  selected with reasons, swap one in by hand), per-clip source video and preview/path per clip video, the length picker
  (90 s / 3 min / 5 min, default 3 min), and the cross-match creation flow (no video picker).
- **Web fallout from this build:** `Reel.video_id` is now nullable and `ReelClip` carries `source_video_id`, so the Reel
  Builder, PreviewPanel, Export preflight and Clip Studio components that read `reel.video_id` need their null handling
  (Build B owns those; the API and contracts are done).
- **Follow-up (not Build B):** a cross-match .otsi-reel export manifest; an on-target flag for shots; a per-match rating model
  for Recent Form (ADR-130); measuring dribbles, through balls, duels, clearances, saves and assists.

## Verification

- Contracts build clean (`pnpm build` in `packages/contracts`); web contracts tests 14/14 pass
  (`apps/web/test/crossMatch.test.ts`: every tier, the 25 m / 85% boundaries, fill order, chronological-within-tier,
  per-match cap 4, moments caps 12/20/30, the 5-minute solid cap, first-non-fitting ends the fill, dedupe, fewer than 3,
  excluded kinds, labels).
- API typecheck clean apart from 4 pre-existing errors in files this change does not touch (`pressing.ts` sliceFor,
  `exports.ts:211`, `test/events.api.test.ts`, `test/load.api.test.ts`).
- API tests for the cross-match endpoints live in `apps/api/test/crossMatch.api.test.ts` (run on the owner's host: they need
  MySQL) — selection across two matches, labels, sprint from measured positions, reel creation, reject/restore per video,
  add-moments, add-clip per video, render snapshot, duplicate, and the single-match regression.
- Not verified here: a live render of a cross-match reel (no GPU/OpenVINO/weights/footage in this workspace) or a click-through
  of the builder (no running engine here) — visual confirmation on the owner's host is the honest last step, as with every UI pass.
