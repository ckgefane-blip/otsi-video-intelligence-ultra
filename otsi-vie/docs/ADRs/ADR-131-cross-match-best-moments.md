# ADR-131: Cross-match best moments — one reel from all of a player's matches (DRAFT, owner approval pending)

- **Status:** Draft. This ADR records the cross-match best-moments build on `muse/ultra-main` (Build A: contracts selection, API,
  migration 0068, rule v1.0; rework: rule v2.1 FINAL, contracts + API + migration 0069 + tests); it needs owner approval before
  it is presented as accepted. It changes no accepted ADR; it builds on ADR-016 (canonical OTSI Player ID), ADR-032 (reel
  builder and render), ADR-040–043 (events and suggested moments), ADR-044 (match time), ADR-049 (possible scorer), ADR-091
  (moment rejection), ADR-124 (evidence rules: unknown beats wrong) and ADR-130 (Player Profile Intro — the same PIN identifies
  the player in every match, and the intro opens the reel).
- **Date:** 2026-11-10 (Muse, `muse/ultra-main`, base `6790009` — Build A HEAD)
- **Decides:** the rule that picks a player's best moments across all his matches, the reel that holds them, and what the engine
  cannot measure (dropped, never faked). The rule is v2.1 FINAL, agreed by the owner 2026-11-10 (see §10 for the v1.0 → v2.1
  delta, §11 for what was rejected and why).

## Context

Reels today are one player, one match. The owner asked (2026-11-10) for an OPTIONAL cross-match highlight: one reel of a player's
best moments from ALL uploaded videos/matches — instead of 10 reels from 10 games, ONE reel of the best moments from all 10 —
for professional use (to be sent to clubs, academies, scouts), so it needs breadth across matches (consistency, not one big game)
and a proper showcase length, not a 90-second social clip. All reels are for professional use: best moments are top quality,
professionally selected. The agreed rule (owner, 2026-11-10 13:29, finalised as v2.1) is implemented exactly as stated; where the
engine cannot measure part of it, that part is dropped and recorded below — never approximated, never filled from a guess (ADR-124).

## Decision

### 1. The rule: fixed tiers, filled top-down, no weights, no judgement

A moment's tier is its best event's tier, AFTER the position promotion (§5). The reel fills Tier S, then A, then B, then C; inside
a tier, chains first, then round-robin across matches, then chronological inside a match (§4). A goal always beats a key pass; a
key pass always beats a dribble. The selection is the pure contracts function `selectCrossMatchMoments`
(packages/contracts/src/cross-match.ts), shared by the API, the web builder and their tests — one rule, one implementation.

| Tier | The owner's rule | What the engine measures (the implemented tier) |
|---|---|---|
| S | Goal, Assist | GOAL, FREE_KICK_GOAL, PENALTY_GOAL — the scoreboard changed and he was last on the ball (ADR-049, "possible scorer"); a free kick / penalty he took just before it makes it that kind of goal. Assist is dropped (see §2). |
| A | Shot on target, Key pass (chance created), Penalty won, Goal-saving tackle or block, Save (goalkeeper) | SHOT, KEY_PASS — a PASS whose receiver shoots from the same spell (actions key_pass). The "on target" qualifier is an open gap (see §2). Penalty won, goal-saving tackle/block and Save are dropped. A defender's tackle / interception is promoted here (§5). |
| B | Successful dribble past an opponent, Through ball, Tackle won, Interception that starts an attack, Sprint at 85% or more of the player's own measured top speed in that match | TACKLE (possible), INTERCEPTION (possible), SPRINT — a measured Run whose top_kmh is >= 85% of the player's measured top speed in that match (Movement.top_speed_kmh for that video: the fastest pace held for 2 s). Dribble and through ball are dropped; "starts an attack" is not verified (see §2). |
| C | Completed long pass / switch of play, Duel won, Clearance under pressure, Recovery | BALL_WON and PRESSURE_REGAIN (shown as "Recovery"), PASS with length_m >= 25 m (the long-pass threshold, §3). Duel won and clearance under pressure are dropped. |

Not in any tier, never selected: set pieces as taker moments (FREE_KICK, CORNER, THROW_IN, GOAL_KICK, KICK_OFF, SET_PIECE,
PENALTY), a plain PASS (under 25 m, or length not measured), PASS_RECEIVED, PRESSURE, and VISIBLE stretches (cross-match
selection uses EVENT moments only, never VISIBLE — a stretch where he is on camera and did nothing is not a best moment).

### 2. Everything dropped, with its reason (nothing faked)

- **Assist (Tier S):** there is no ASSIST event type anywhere in the engine, and no pass-to-goal link (ADR-130 already records
  assists as not measured). A goal he scored is Tier S; a pass that led to one is not credited as an assist. Assists stay
  PROVISIONAL / INACTIVE in v2.1: no key-pass-then-goal heuristic is implemented — a heuristic would credit assists the engine
  did not measure, and the owner agreed assists wait for a real pass-to-goal linkage (a later version, not this one).
- **Recent Form:** stays "Not measured" — the engine has no per-match rating model, so no form ratings are ever shown (already
  the case in the intro; no code change, recorded here so nobody invents one).
- **Shot on target (Tier A qualifier):** the engine records shots without an on-target flag (actions shot_from counts off-target
  shots too). The implemented tier is "Shot". Adding an on-target flag is a worker measurement change, not a selection change.
- **Penalty won:** the PENALTY moment is the set-piece taker's, not the player who won it — the engine does not record who was
  fouled. Dropped.
- **Goal-saving tackle / block:** the engine does not judge whether a tackle or block saved a goal (no goal-probability model).
  A tackle is Tier B as a tackle (possible); no goal-saving credit is given. Dropped.
- **Save (goalkeeper):** there is no goalkeeper-save event type. Dropped (and the goalkeeper promotion in §5 is dormant for the
  same reason).
- **Dribble past an opponent:** there is no dribble event type (a dribble is not a detected action). Dropped (and the winger
  promotion in §5 is dormant for the same reason).
- **Through ball:** there is no through-ball event type (a through ball is a pass with a receiver running behind the defence —
  the engine does not classify it). A long through ball counts as a long pass when its length is >= 25 m. Dropped as its own kind
  (and the midfielder promotion in §5 is dormant for the same reason).
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
  glitch cannot set it). The sprint candidate's window is 3.0 s before the run to 2.5 s after it, clamped 4–12 s like an event
  moment (§4). A sprint with no measured top speed for the match is not selected ("top speed not measured").

### 4. Length, caps, order, and the fill

- **Lengths:** the person chooses 90 seconds, 3 minutes (default) or 5 minutes. **5 minutes is a solid cap, never exceeded** —
  the fill only takes a candidate that fits entirely within the remaining length, and a selection at length_s=300 never exceeds
  300 s.
- **Moments caps:** about 12 / 20 / 30 moments for 90 s / 3 min / 5 min (CROSS_MATCH_MOMENT_CAPS). **Per-match cap, v2.1:** at
  most 3 / 4 / 5 NON-Tier-S moments from any single match, for 90 s / 3 min / 5 min (CROSS_MATCH_PER_MATCH_CAPS) — breadth
  across matches is the point, and a longer reel may take more from one match. **Tier S is IMMUNE: a hat-trick all makes the
  reel, never discarded by a cap** — S moments never count toward the cap and are never blocked by it.
- **Clip timing (v2.1, fixed and deterministic):** in-point 3.0 s before the decisive touch, out-point 2.5 s after the
  action/outcome; clips clamped to 4 s minimum / 12 s maximum. Precisely: in = first event's start − 3.0 s, out = last event's
  end + 2.5 s (for a sprint: the run's start / end); if out − in > 12 s, in = out − 12 s (keep the decisive end); if out − in
  < 4 s, out = in + 4 s; then in ≥ 0 and out ≤ video duration (if out hits the duration cap, in shifts earlier where possible
  to keep the 4 s minimum). The windows are built from each event's own span (start/end from its row), never from the
  single-match moment's `a`/`b` — those carry the old 4 s / 5 s buffers plus the possession-spell extension, which is
  ball-following timing and must not affect cross-match windows. No ball-clock / "until reception" out-point: fixed buffers only.
- **The fill, inside a tier (v2.1):** (a) chains first, then (b) round-robin across matches — one moment from each match before
  a second from any match — then (c) chronological (oldest match first, then minute). Round-robin: matches sorted by kickoff
  date, oldest first (ties → video_id for determinism); round 1 takes the earliest chronological candidate of each match, round
  2 the next earliest of each, and so on; inside a match, candidates are chronological (minute, then media time). Pure
  chronological within a tier (v1.0) was WRONG: it let one early match fill the reel before a late-season match got in. This
  guarantees late-season matches get in.
- **The fill ends deterministically:** the first candidate that does not fit entirely within the remaining length ends the fill;
  later candidates are listed as not selected with reason "length cap reached", even a shorter one that would have fitted. A
  candidate beyond the per-match cap is listed as "per-match cap reached" and does NOT end the fill. Reaching the moments cap
  lists the rest as "moments cap reached".
- **Fewer than 3 eligible moments:** build with what's there — no filler, no padding. (A reel with no moments at all is created
  empty, like a single-match reel before moments exist; rendering still refuses an empty reel.)
- **Order in the reel:** the Player Profile Intro first (ADR-130, settings default profile_intro true), then the selected clips
  in tier order (S, then A, B, C), chains first inside a tier, round-robin across matches. Every clip is labelled broadcast
  lower-third style: "[Tier S] Goal · 67' vs Ercakhu" (§4, labels).
- **Labels (v2.1):** `[Tier {S|A|B|C}] {reason} · {minute}' vs {opponent}`; for a chain the reason is the sequence label:
  "[Tier B] Tackle (possible) → Key pass · 67' vs Ercakhu", where the tier is the chain's tier (best action, after promotion).
- **The minute is never invented:** the match minute is used only when the video's match halves are CONFIRMED (ADR-044),
  computed from the confirmed half windows and clamped to 45 / 90 like a broadcast clock (stoppage time is not modelled: a
  moment in first-half stoppage reads 45'). Otherwise the label uses media time ("[Tier S] Goal · 12:34 vs Ercakhu"). The
  opponent is the club that is not the player's in that match's team sheet; where it is not known the label falls back to the
  video title.

### 5. Position promotion (v2.1): one lift per line, applied before the best-tier is computed

The player's line comes from the existing POSITION_LINES map (packages/contracts/src/playerreport.ts): the API supplies it the
same way playerreport.ts does (latest team position first, then the recorded usual position); unknown / null position → no
promotion. The promotion lifts ONE action per line to Tier A, applied to an event's tier BEFORE the moment's best-tier is
computed — so a defender's tackle in a chain with a key pass still leaves the chain Tier A, and a defender's lone tackle is
Tier A on its own.

| Line | Promotion | Live or dormant |
|---|---|---|
| Defender (DEF) | Tackle won and interception move up to Tier A | **LIVE** — TACKLE and INTERCEPTION are both measured (as "possible"). |
| Midfielder (MID) | Through ball moves up to Tier A | **DORMANT** — there is no through-ball event type (§2). The promotion exists in the table so it works the day the worker measures through balls; today it has nothing to promote. |
| Winger / Forward (FWD) | Successful 1v1 take-on moves up to Tier A | **DORMANT** — there is no dribble / take-on event type (§2). Same: in the table, nothing to promote until the worker measures take-ons. |
| Goalkeeper (GK) | Save stays Tier A | **DORMANT** — there is no save event type (§2). A save would be Tier A anyway; the row records the intent, not a working promotion. |

A promotion never demotes: it only wins when it is a better tier than the event's base tier. It does not apply to sprints.

### 6. Chains (v2.1): one sequence, one clip

Actions by the same player linked in one sequence merge into ONE clip when consecutive touches are within 3 seconds of each other
(same passage of play). The existing moment builder (eventMomentsForVideo) already merges events ≤ 3 s apart into one moment
(EVENT_JOIN_US) — those merged groups ARE the chains. A chain is a candidate with ≥ 2 events; a single action has 1 event. A
chain ranks by its best action's tier (after promotion), and inside a tier a chain outranks a single action. The candidate
carries its events in TIME order (the per-event spans) so the chain label is built from time order: the label is the distinct
event kinds in time order joined with " → ", using the existing reason words — e.g. "Tackle (possible) → Key pass" (ADR-124
honesty beats style: "(possible)" stays). The selection exposes, per selected candidate, `is_chain` and `sequence_label`, so the
API and the UI can show the sequence. A chain's clip window is the chain's own: 3.0 s before its first event's start to 2.5 s
after its last event's end, clamped 4–12 s (§4).

### 7. Evidence (ADR-124): only measured moments count

- A moment belongs to a player only through confirmed tracks (v_track_current_identity state='CONFIRMED'), per video. A video
  where he has no confirmed track, or no SUCCEEDED ball track, contributes nothing — the same rule as single-match moments.
- The player must be REGISTERED (his permanent OTSI Player ID issued; RETIRED counts) and have >= 1 confirmed track, else 409
  (PLAYER_NOT_REGISTERED / NO_CONFIRMED_TRACKS). A provisional player has no PIN that could identify him across matches, so no
  cross-match reel can follow him.
- **Dedupe:** the same moment twice (one video, overlapping window, same best event) is kept once ("duplicate moment"); a sprint
  candidate overlapping an already-selected event moment in the same video is dropped ("overlaps a selected moment") — a sprint
  that is the run-up to a goal is that goal's moment, not a second clip. (Edge, recorded: an event moment selected after a sprint
  it overlaps is kept as well — the rule only drops the sprint. Overlapping clips are legal in a reel.)
- **Manual override stays, with eligibility enforced (v2.1):** the person can pin a moment in (add a clip) or take one out
  (reject a moment per video, or remove a clip), but the rule is the default and never changes under them. A rejected moment is
  listed last as "rejected for this reel" (as single-match moments list rejected ones), and "add all moments" adds the selected
  ones not yet in the reel, in tier order, never past the length cap (a moment that does not fit is skipped, as single-match
  add-moments does). **A manual pin must be a best moment:** POST /v1/reels/:id/clips on a cross-match reel refuses a window
  that matches no eligible candidate — i.e. the window holds no tier-assigned candidate's decisive touch (key_at_us) — with a
  named 409 INELIGIBLE_MOMENT. A VISIBLE stretch, a set piece, a plain short pass or any other ineligible moment cannot be
  pinned. **The per-match cap is enforced on a manual pin too** (Tier S immune, as in the selection; 409 PER_MATCH_CAP_REACHED),
  and the length cap is enforced as before (422 REEL_TOO_LONG). Caps still apply on a manual pin; ineligible moments still
  cannot be pinned. Single-match addClip behaviour is unchanged.

### 8. Versioning

- The rule is version "2.1" (`BEST_MOMENTS_RULE_VERSION = "2.1"`, a string — rule versions are dotted releases now). The version
  is written into the reel at creation (`best_moments_rule_version`, VARCHAR(16) since migration 0069 — migration 0068 made it
  INT; 0069 converts it, backfilling defensively: existing NULL stays NULL, any integer becomes its string form; no cross-match
  reels exist yet) and into the render snapshot (`selection: { rule: "best-moments", version: "2.1", length_s }`). Old reels
  keep the version they were built with, so a reel is always reproducible; the rule never changes under a reel. The worker stamps
  the version into the render manifest and the .otsi-reel in Build B (see §13).

### 9. Schema and API design

- **Migration 0068:** `reel_projects` gains `source ENUM('MATCH','ALL_MATCHES') NOT NULL DEFAULT 'MATCH'`,
  `cross_match_length_s INT NULL`, `best_moments_rule_version INT NULL`, and `video_id` becomes NULLABLE, with a CHECK that a
  MATCH reel keeps a video and no cross-match columns, and an ALL_MATCHES reel has no video and no single run, a length of
  90/180/300 and a rule version. All existing rows are MATCH with a video_id, so the migration is safe on them.
  `reel_moment_rejections` gains `video_id CHAR(36) NULL` so a rejection is per video. Known edge: the table's key is still
  (reel_id, in_pts_us), so two videos of one cross-match reel rejecting a moment at the exact same microsecond share one row —
  improbable (windows start at an event's second), and the API always filters rejections by video_id where one is recorded.
- **Migration 0069 (v2.1):** `reel_projects.best_moments_rule_version` INT → VARCHAR(16), with a defensive backfill (NULL stays
  NULL; any integer becomes its string form). The 0068 CHECK is untouched (it only requires the version to be NOT NULL on an
  ALL_MATCHES reel).
- **A cross-match reel pins targets across ALL the player's videos** (reel_targets rows for every confirmed track, every video)
  and stores the selection's chosen clips, each with its real source_video_id, in tier order (sequence_index in that order),
  origin SUGGESTED, label match + minute + reason (v2.1 label format). It lives in the project of his most recent analysed video
  (project_id has to be one project; the latest video's is the most current). `run_id` is NULL: there is no single run.
- **`GET /v1/players/:id/cross-match-moments?length_s=180`** (only 90/180/300): gathers his EVENT moments across all his
  analysed videos (confirmed tracks per video; latest SUCCEEDED ball track per video) plus sprint moments per video, applies the
  selection (with his position group, for the promotion), and returns it with match labels and per-match counts. No reel is
  needed to see the selection. Selected moments carry `is_chain` and `sequence_label`.
- **`POST /v1/reels`** accepts `source: "ALL_MATCHES"` + `length_s` (default 180) with NO video_id (`video_id` stays required
  for source MATCH). Name defaults to "{display name} — best moments (all matches)".
- **`GET /v1/reels/:id`** returns `source`, `video_id` (null for cross-match), `cross_match_length_s` and
  `best_moments_rule_version` (a string, "2.1"; null for single-match); clips include `source_video_id`. For a cross-match reel
  `match` is null (no single match — the match card cannot represent 10 matches) and `player_roster` is null, falling back to
  the player's latest team exactly as the web already does (PreviewPanel: player_roster ?? profile.latest_team). Nothing else in
  the single-match response changes.
- **`GET /v1/reels/:id/moments`** for a cross-match reel returns the selection for the reel's stored length (selected +
  not selected with reasons, in_reel marked from the reel's clips). Single-match reels return ReelMoment[], as today.
- **`POST /v1/reels/:id/clips`** accepts `source_video_id` (required for a cross-match reel, defaulting to the reel's video for
  a single-match reel); the clip is validated against THAT video's duration, the player must have confirmed tracks in it (for a
  cross-match reel), and adding it must not take the reel past its length cap (cross-match: the reel's length_s; single-match:
  10 minutes as today). For a cross-match reel the clip must also be an eligible best moment (409 INELIGIBLE_MOMENT) and must
  not break the per-match cap (409 PER_MATCH_CAP_REACHED, Tier S immune). Trims, swaps and speed effects use the same per-clip
  video and cap.
- **`POST /v1/reels/:id/clips/add-moments`** for a cross-match reel adds every SELECTED moment not yet in the reel, in tier
  order, stopping at the length cap. **`POST /v1/reels/:id/moments/reject|restore`** accept `video_id` so a cross-match moment
  is rejected per video.
- **`startRender()`:** the snapshot gains `selection: { rule: "best-moments", version: "2.1", length_s }` for cross-match reels,
  and every snapshot clip gains `source_video_id` (single-match clips get the reel's video id, as today). The overlay's match
  facts are null for a cross-match reel; club, shirt number and position fall back to his latest team. The intro opens it exactly
  as a single-match reel.
- **`duplicate()`** copies source, length_s, rule version and per-clip source_video_id. **`refreshTargets()`** re-pins targets
  across all his videos. **`path()`** cannot return one video's path for a cross-match reel: it returns an empty path with
  stale=false (Build B fetches paths per clip video another way).
- **Single-match ranking is untouched:** EVENT_SCORE still ranks single-match suggestions, and `moments()` (both modes) honours
  rejections. The tier rule is the selection standard for reels generally — a future step could rank single-match suggestions
  by tier too, but this build does not change them. The per-video event builder moved to cross-match.ts with its ranking
  intact (v2.1 adds the per-event spans it now carries; single-match windows still use `a`/`b`); the reel-based wrapper over
  it is unchanged in behaviour (verified by the existing reels tests plus a single-match regression test in
  crossMatch.api.test.ts).

### 10. v1.0 → v2.1 delta (what the rework changed)

| Area | v1.0 (Build A) | v2.1 FINAL |
|---|---|---|
| Chains | Merged groups existed but were not named or ranked: a chain was treated like any moment | Chains are named (`is_chain`, `sequence_label` from time-ordered spans), rank by their best action's tier, and outrank a single action inside a tier |
| Clip timing | Single-match timing reused: 4 s before / 5 s after, plus the possession-spell extension | Fixed, deterministic: 3.0 s in / 2.5 s out from the events' own spans, clamped 4–12 s; spell extension never affects cross-match windows; same for sprints |
| Per-match cap | Fixed 4, every tier counted | 3 / 4 / 5 by length (90 s / 3 min / 5 min); Tier S immune, never counts toward it |
| Intra-tier order | Pure chronological (oldest match first) | Chains first, then round-robin across matches, then chronological inside a match |
| Position promotion | None | One lift to Tier A per line (DEF live; MID / FWD / GK dormant — §5) |
| Labels | "Goal — 67' vs Ercakhu" | Broadcast lower-third: "[Tier S] Goal · 67' vs Ercakhu"; chains show the sequence |
| Manual pin | Any window in a confirmed video (length cap only) | Must be a tier-assigned moment (409 INELIGIBLE_MOMENT) and respect the per-match cap (409 PER_MATCH_CAP_REACHED) |
| Version | Number `1` (INT column) | String `"2.1"` (VARCHAR(16), migration 0069) |
| Assists / Recent Form | Dropped / not measured (recorded in v1.0) | Unchanged, restated explicitly: assists stay provisional/inactive (no heuristic), Recent Form stays "Not measured" |

Everything else from v1.0 stands unchanged: tiers S/A/B/C with the v1.0 measured tier map, the 25 m long pass, the 85% sprint,
eligibility (measured only, verified identity only, dedupe, rights valid), lengths 90 s / 3 min (default) / 5 min with the solid
5-minute cap, moments caps ~12 / ~20 / ~30, no filler under 3 moments, Profile Intro first, best-first order, manual pin/remove
override, first-non-fitting-ends-fill, and the add-moments skip-vs-stop edge (add-moments skips a moment that does not fit,
mirroring single-match behaviour).

### 11. Rejected in v2.1, with reasons (not deferred — decided against)

- **Numeric point scores:** invented precision. The tiers deliberately have no points — a goal beats a key pass by tier, not by
  10 points to 4. Scores would let a pile of small moments outrank a goal, which is not the owner's rule.
- **The 10-minute reel option:** breaks the 5-minute solid cap the owner set (5 minutes maximum, never exceeded). Lengths stay
  90 s / 3 min / 5 min.
- **Ball-clock out-point timing / "until reception":** implementation risk — an out-point that follows the ball until the next
  reception depends on tracking the ball through the outcome, which is the least reliable part of the pipeline on wide footage.
  Fixed 3.0 s / 2.5 s buffers instead: deterministic, reproducible, and the same for every clip.
- **"Quality" sub-ranking inside a tier:** under-specified — nobody could say what makes one goal better than another without
  inventing a judgement the owner did not ask for. Round-robin across matches replaces it: inside a tier, breadth across
  matches is the order, not a quality guess.

### 12. What stays single-video (deliberately not in this build)

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
- The tier rule's gaps are visible, not hidden: SHOT has no on-target flag, TACKLE/INTERCEPTION are "possible", three of the four
  position promotions are dormant, assists are provisional and Recent Form is not measured, and eight of the owner's kinds are
  not measured at all. Any of those becoming measured is a worker measurement change; the tier map then gains a row and the rule
  version moves on from "2.1".
- A manual pin can no longer smuggle an ineligible moment into a cross-match reel: eligibility and the per-match cap are
  enforced in the API, not left to the UI.

## Build B (built 2026-11-10, local on muse/ultra-main, not pushed)

### Worker multi-source render

- `handle_render` reads the snapshot's per-clip `source_video_id`; each clip's source file is resolved from its video
  (`video_sources` → `source_asset_id` → `assets` object_key), per distinct video. The reel's `video_id` is NULL for
  cross-match reels and is never read as a source.
- Output geometry/fps: the FIRST clip's video is the anchor — its width/height/fps set ow/oh/fps/frame_us; every clip is
  decoded from its own source at anchor geometry (the existing crop/resize path normalises frames to ow/oh). If videos differ
  in fps, frame timing follows the anchor fps and the existing per-clip plan mechanism. Mixed-aspect sources are scaled to the
  anchor frame; all match footage is 16:9, so this is a recorded limitation, not a handled case.
- Spotlight path per clip: observations are queried per clip video (targets grouped by video via tracks → run → video).
  Dense re-analysis (`target_path`) runs per clip against that clip's source file; detector config comes from that clip's
  video's latest SUCCEEDED pipeline run — EXCEPT the reel's own video, which keeps the run the reel was built on
  (single-match behaviour identical). A video with no run falls back to the existing defaults and never fails a render.
- Match card: skipped for cross-match reels (`card_n = 0`) — a cross-match reel has no single match. The Profile Intro
  (first, ADR-130) and the per-clip event tags (ADR-050, written on screen as each clip starts) carry the identity and the
  match+minute+reason.
- Audio: `_audio_for_clips` — one ffmpeg input per distinct source, per-clip `t_v0`; `_audio` delegates to it (headless
  unchanged; the single-source graph is identical). Silence under the profile intro as today.
- Manifest: `source: "ALL_MATCHES"`, `best_moments_rule: {version: "2.1", length_s}`, `video_ids` (distinct source videos, in
  clip order), per-clip `source_video_id` + `detector` ("run"/"defaults"), `rules.best_moments_rule_version`; the single
  `video_id` is null for cross-match reels. The single-match manifest shape is unchanged apart from the additive fields.
- Failure: a clip whose source video/asset/file is missing fails with the named code `CLIP_SOURCE_MISSING` and a plain
  message, never a silent wrong render.
- The pure planning helpers live in `services/worker/vie_worker/render/cross_match.py` (anchor, grouping, source plan,
  match-card skip, manifest fields, detector fallback); 11 unit tests in `services/worker/tests/test_cross_match_render.py`
  pass via the direct runner `~/workspace/cross-match-render-runner/run_cross_match_render_tests.py` (pytest cannot run here
  — conftest needs `.local/mysql-lint.env` + MySQL 3507 on the owner's host).
- `GET /v1/reels/:id/path` gains an optional `?video_id=` (a small API addition inside this build): a cross-match reel
  without it returns the empty path as before; with it, that video's clip-window path; a video holding none of the reel's
  clips → 404 NOT_FOUND, never another video's positions. API test added in `apps/api/test/crossMatch.api.test.ts` (runs on
  the owner's host).

### Reel Builder UI

- Provider (`ReelBuilder.tsx`): `load()` reads the reel first, then branches — cross-match reels fetch the selection into
  `crossMatch` (`moments` stays null); single-match reels fetch the ranked suggestions as today. `ReelSteps` links "All
  matches" instead of a source video; `ReelPreview` follows the selected clip's own video.
- Entry point: `ReelSourceChoice` — "This match" (current, default) vs "All matches" + length picker (90 s / 3 min / 5 min,
  default 3 min, fixed options only) + "Create all-matches reel" → POST `/v1/reels {source: "ALL_MATCHES", length_s,
  player_id}`, then opens the new reel; the original reel is untouched. A compact variant (one select + Create) lives in the
  left column's Reel Info section as the "Matches" row — the only free slot in the fixed 2560×1440 composition (the Moments
  header row, the left column sections and the Inspector sections are all full); the Description box is shorter to make room,
  and the row ends inside the panel. For a cross-match reel the row is a read-only summary ("All matches · 5 min · best
  moments rule v2.1").
- Moments (`MomentsTimeline.tsx`): for a cross-match reel the section shows the selection — tier badge ("Tier S" etc.),
  label, match (home vs away + competition), minute (or media time when halves aren't CONFIRMED), reason; a chain's reason
  IS its sequence label ("Tackle (possible) → Key pass → Goal"). Selected moments vs left-out ones with their reason
  ("per-match cap reached", "length cap reached", "rejected for this reel"); pin = addClip (the API guards eligibility and
  the per-match cap), remove = clip delete, reject/restore per video, swap/move as for single-match. Add-all counts only
  selected moments not yet in the reel. "Build a draft" and "Is this him?" are hidden for cross-match reels (drafts refuse
  cross-match reels; WhoQueue is single-match only). Undo/redo/history unchanged. Cross-match cards are not draggable into
  the timeline (click actions cover pin/remove/swap) — drag for cross-match cards is follow-up, not half-built.
- Preview (`PreviewPanel.tsx`): playback, video, match and spotlight path follow the selected clip's video
  (`clip.source_video_id ?? reel.video_id`); stepping clips steps videos. Scoreboard: source mode shows the current clip's
  match; render mode shows a plain "All matches" note (the rendered reel carries per-clip event tags; there is no single
  match). `useReelPath(reel, videoId?)` fetches `/path?video_id=` per clip; if the spotlight cannot be shown for a clip, the
  clip plays without a spotlight rather than failing the preview.
- Inspector: "Find more of him" is hidden for cross-match reels (no single video to look in); the scoreboard reason names
  "no single match" for them.
- Profile Intro: verified by inspection + test — it takes player id + reel id only (`GET /v1/players/:id/profile-intro?reel_id=`),
  no video, so it opens for cross-match reels exactly as for single-match reels; no change was needed.
- The 6 web type errors Build A left (nullable `reel.video_id`): `Centre.tsx:227`, `ExportPreflight.tsx:73`,
  `useLibrary.ts:48` (null = "no single video", the single-video path is skipped, never a video invented),
  `test/interchange.test.ts:72,82,92` (clip literals gain `source_video_id`). Fixing the clip literals surfaced a 7th error —
  the base reel literal needed `source: "MATCH"`. Web typecheck is clean apart from the 1 pre-existing
  `formationsPanel.test.tsx` error; `next build` is green again (25/25 pages).

### What stays single-video (unchanged from §12)

- The cross-match .otsi-reel export manifest stays single-video; blocks/templates/draft reels stay single-video.

### Follow-up (not Build B)

- A cross-match .otsi-reel export manifest; drag-and-drop of cross-match cards into the timeline; an on-target flag for
  shots; a per-match rating model for Recent Form (ADR-130); measuring dribbles, through balls, duels, clearances, saves and
  assists (which would wake the dormant promotions in §5 and move the rule version on from "2.1").

## Verification

- Contracts build clean (`./node_modules/.bin/tsc -p tsconfig.json` in `packages/contracts` — pnpm is not on PATH here, so the
  repo's local binaries are used); web contracts tests 24/24 pass (`apps/web/test/crossMatch.test.ts`: every tier, the 25 m /
  85% boundaries, fill order, round-robin within a tier, chains (outranking + labels), timing (3.0 s / 2.5 s buffers, 4 s / 12 s
  clamps), per-match caps 3/4/5, Tier S immunity (a hat-trick and one more at 90 s), moments caps 12/20/30, the 5-minute solid
  cap, first-non-fitting ends the fill, dedupe, fewer than 3, excluded kinds, the Defender promotion, the dormant promotions,
  labels, version "2.1").
- API typecheck clean apart from the same 4 pre-existing errors in files this change does not touch (`pressing.ts` sliceFor,
  `exports.ts:211`, `test/events.api.test.ts`, `test/load.api.test.ts`).
- API tests for the cross-match endpoints live in `apps/api/test/crossMatch.api.test.ts` (run on the owner's host: they need
  MySQL) — selection across two matches (chain, labels, sprint from measured positions, v2.1 windows), reel creation, reject/
  restore per video, add-moments, add-clip per video (eligible pin, INELIGIBLE_MOMENT, PER_MATCH_CAP_REACHED), render snapshot
  (version "2.1"), duplicate, and the single-match regression.
- Build B verification: web vitest 70 files / 314 tests pass (10 new in `apps/web/test/crossMatchBuilder.test.tsx`: source
  choice + length picker, moments view with tiers/chains/reasons, pin by hand with its source video, no single-video reads,
  per-clip preview + path, render-mode "All matches" note, Profile Intro dialog for a cross-match reel); web typecheck clean
  apart from the 1 pre-existing `formationsPanel.test.tsx` error; `next build` succeeds 25/25 pages; worker direct-runner
  tests 11/11 pass; API typecheck shows only the same 4 pre-existing errors; the `?video_id=` path test is added to
  `crossMatch.api.test.ts` (runs on the owner's host).
- Not verified here: a live render of a cross-match reel (no GPU/OpenVINO/weights/footage in this workspace), the API tests
  themselves (no MySQL here — they run on the owner's host), or a click-through of the builder (no running engine here) —
  visual confirmation on the owner's host is the honest last step, as with every UI pass.
