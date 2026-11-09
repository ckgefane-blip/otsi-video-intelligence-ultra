# ADR-100: Moment boundary suggestions around events, labelled Inferred (v3 Phase B.25)

Date: 2026-11-07. Status: accepted. No migration.

## Decision
- `GET /v1/reels/:id/boundary-suggestions` returns, for each clip, where its ends would hold the engine's events of the reel's player.
  The rule is `suggestBoundary` in contracts:
  - It uses the event moments that overlap the clip: the same windows as the moment cards (B.15), with rejected moments left out.
  - The suggested window runs from the first such moment's start to the last one's end.
- Limits:
  - It never crosses a camera cut the clip does not already cross (shots of the latest run).
  - It never runs into another clip's picture. The first version suggested stretching two overlapping clips (49 and 50 on the
    owner's reel) over each other; the browser check found it.
  - It stays within the video, 60 s at most and 1 s at least.
  - It is offered only when an end moves by 0.5 s or more.
- Every suggestion is `evidence: "INFERRED"`, with a plain why ("start 2.0 s earlier, end 6.0 s later: to hold the engine's 2 events
  of his around this clip"). Nothing moves by itself.
- Clip Studio › Adjustments › **Suggested cuts** lists them with the Inferred badge, old and new times, and Apply. Apply is the normal trim:
  one change in the history, and Undo restores it.
- The Player Report picker fix in the same commit: the search needs 2 characters (422 below that), so on an empty or one-letter search
  the picker lists the organization's players from `/v1/player-list` instead. It is found by the B.24 browser check.

## Tests
- Web `boundarySuggest.test.ts`:
  - widen; shorten;
  - camera cuts; other clips' picture;
  - nothing under 0.5 s or without events;
  - video end and 60 s.
- API `reels.api.test.ts`:
  - the shot moment suggestion with times, events, why and Inferred;
  - a viewer reads it; another organization gets 404;
  - after Apply (PATCH) there is none.
- Web 203 / API 250 green.
- Browser on the owner's reel, view only: one suggestion (clip 1); the overlapping pair now gets none; nothing applied.
  The picker lists 37 players.
- B.24 checked in the browser:
  - coverage lines ("covers 69 % of time seen", "ball followed in 2 of 2 videos");
  - group "Midfielders: 0 players";
  - the designer with 6 sections and a sandboxed live preview; not made.
