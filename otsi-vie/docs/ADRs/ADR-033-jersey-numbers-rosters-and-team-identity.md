# ADR-033: Shirt-number evidence, match rosters and team identity

Status: accepted for development and local testing (2026-10-27; owner directive "continue with jersey OCR, match rosters and team identity",
free models only, ADR-030). Builds on ADR-016 (canonical OTSI Player ID), ADR-031 (appearance and same-person links), ADR-032 (reels).

## Rules
- **None of these is an identity.** A shirt number is clothing; a kit colour is a colour; a look-alike track is appearance. The canonical
  OTSI Player ID comes only from the player registry and a person's CONFIRMED identity decision (ADR-016). Everything here is evidence that
  ranks *suggestions* for that person.
- **A missed identification is better than a wrong one.** Unknown states are first-class (`UNREADABLE`, `TOO_SMALL`, "not decided",
  "not a team"); a suggestion with a conflict is shown with the conflict and cannot be chosen until the conflict is resolved.
- **History is append-only.** Roster changes, team assignments and shirt-number verdicts are never edited; a correction supersedes the
  current decision (optimistic concurrency: 409 on a stale one) and needs a reason (database triggers). Audit + outbox in the same transaction.

## Shirt-number reading (worker `vie_worker/ocr.py`, `vie_worker/jersey.py`)
- Models: **PaddleOCR PP-OCRv4** text detector (DB) and English recogniser (CTC), Apache-2.0, plain weights (no remote code), read with
  OpenVINO on the Intel GPU; files SHA-256-pinned in `models/registry.json`, fetched by `tools/models/fetch_url_models.py`.
- Candidate frames per track: only crops ≥ 100 px tall; up to 6 frames, at least 0.4 s apart, chosen by height × log(sharpness); torso
  region (10–70 % of the box); fixed 256 px detector canvas (12 ms per crop on the Arc GPU; dynamic shapes cost 1.3 s per crop).
- Aggregation over frames: **RECOGNIZED** needs ≥ 2 agreeing frames ≥ 0.4 s apart and ≥ 75 % of the reads; otherwise **UNCERTAIN** (a
  number with alternatives), **UNREADABLE** (large enough, nothing legible), **TOO_SMALL** (never large enough). Side = BACK when a name is
  read with the number. Every frame read (time, text, confidence) and the model version are stored (`track_jersey_evidence`, migration 0016).
- Rejected: Florence-2 (needs `trust_remote_code`; running downloaded model code is not allowed in this project); Open Model Zoo
  text-recognition-0014 (wrong decoding and weak on shirts: 0 of 11).

### Measured (developer-labelled crops, NOT final ground truth)
120 player crops from the evaluation footage, labelled by the developer: 11 with a legible number, 10 visibly unreadable, the rest too
small. Per crop, PP-OCRv4 det + rec read **5 of 11 legible numbers correctly, 0 wrong, 0 invented** on unreadable or small crops; whole-torso
recognition without the detector read 0 of 11. Legible numbers occurred only on crops ≥ ~150 px tall: on wide broadcast or grassroots
footage most tracks are honestly `TOO_SMALL`. Track-level recall and precision on manually labelled tracks are **not measured yet**; they
belong to the evaluation framework of the grassroots stage (ADR-034) and no accuracy claim is made before that.

## Match rosters (API `modules/matches/matches.ts`)
- Clubs belong to the organization that created them (shared registry clubs are visible to all); matches have two different clubs
  (CHECK) and link videos (`video_sources.match_id`).
- Roster entry: player (registry), club (home or away of the match), shirt number (unique per team per match), STARTER / SUBSTITUTE,
  position, captain. Changing or removing an entry of a verified roster needs a reason; every change is in `match_roster_changes`.
- **Verification** (OWNER / ADMIN / ANALYST) records the player's club and shirt number from the match date in `player_club_memberships` /
  `player_jersey_numbers`, closing the previous open entry when they changed. Verifying an older match never rewrites later history.
  The player's canonical ID is untouched by any of this (tested: a transfer between two matches keeps `canonical_otsi_id` and state).

## Team identity (API `modules/tracks/identity-evidence.ts`)
- A run's kit colour groups (ADR-031) become teams only by a person's assignment to one of the linked match's two clubs, or to
  **"not a team"** (referees, staff, mixed groups). One group per team; without a linked match only "not a team" is possible.
  The UI says why: similar kits, goalkeepers, referees and lighting mix colours.

## Combined identity candidates (`GET /v1/tracks/:id/candidates`)
Sources and weights (ranking heuristics, **not calibrated probabilities**; calibration needs labelled ground truth, ADR-034):

| Signal | Weight |
|---|---|
| shirt number in the match roster: confirmed by a person / RECOGNIZED / UNCERTAIN | 0.60 / 0.45 / 0.20 (× 0.5 if the roster is not verified) |
| track's kit group assigned to the candidate's team | 0.15 |
| CONFIRMED same-person link to a track confirmed as the candidate | 0.80 |
| PROPOSED link (0.35 × score) or look-alike neighbour (0.20 × cosine) to such a track | strongest one only (both are appearance: correlated, not added) |

Independent sources combine as 1 − ∏(1 − w). **Conflicts** multiply the strength by 0.25 and are listed: the track's team differs from the
candidate's roster team; the candidate is already confirmed on a track on screen at the same time. Candidates never change any state.

## Data (migration 0016)
`clubs` (+organization, short name), `matches` (+created_by, version, two-teams CHECK), `match_rosters` (+role, position, captain,
verification, unique number per team), `match_roster_changes`, `run_team_assignments` (+`v_run_team_current`), `track_jersey_evidence`,
`jersey_number_decisions` (+`v_track_jersey_current`), `track_neighbours` (top-5 non-overlapping look-alikes per person track).

## UI
> Owner visual-fidelity lock (2026-10-27): these panels are functional wiring inside the current (not yet faithful) frontend. Their final
> placement follows the approved images and the owner's decision recorded in docs/visual-fidelity/VISUAL_FIDELITY_GAP_REPORT.md.

Upload section 2 and Workspace section 1: link the video to a match or create it (clubs created on the spot). Workspace section 6: tabs
Tracks / Roster (both teams, add from the registry or as a new provisional player, edit, remove, verify, history) / Teams (kit group →
team). Section 7: shirt-number evidence with the frames read (click to seek) and the person's verdict; "Who could this be?" with
evidence, conflicts and "This is …" (the identity decision). Reel Builder: workflow steps as compact rows, preview capped at about half
the screen height (portrait reels stay narrow), aligned clip rows, wider side columns.

## Tests
`apps/api/test/matches.api.test.ts` (6: clubs/matches, roster history and verification, transfer history with unchanged canonical ID,
team assignment rules, shirt-number verdicts append-only, candidate ranking, correlation and conflicts, tenant isolation, roles);
`services/worker/tests/test_analyze.py` (one evidence row per person track, RECOGNIZED only with ≥ 2 agreeing reads, neighbours stored);
`tests/db` (migration 0016, append-only triggers, roles); `apps/web/e2e/workspace.spec.ts` (match → rosters → verify → teams →
shirt number → suggestions → reel, on real footage).

## Open
Track-level OCR recall/precision and the identity-switch rate on manually labelled footage (ADR-034 evaluation framework); weight
calibration; front/back detection beyond "a name was read"; roster import from team sheets (needs an owner-approved source).
