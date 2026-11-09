# ADR-045 — Find his other tracks: look-alikes ranked by look and shirt colour, decided Him / Not him

**Date:** 2026-11-02 · **Status:** implemented; API and web tests pass; used by the owner: 0 of 14 reviewed look-alikes were him on
this footage (see "Owner's use") · **Owner request:** "Godwin had way more touches and good uses of the ball in the game." → "Find his other tracks"

## Problem
A reel follows only the tracks a person confirmed as the player. The tracker splits each player into many tracks (21,273 person tracks in
the owner's ~105-minute match), and Godwin was confirmed on 3: his reel and his events cover a few minutes.

## What was measured (owner's match, read-only, 2026-11-02)
- **Appearance alone does not find him.** Ranking all 21,000 tracks of the run by cosine of the DINOv2 embedding to one of his tracks put
  his other confirmed tracks at ranks 288 to 4,933. On wide broadcast footage players are ~50 px tall and the model sees most players of a
  kit as alike (median cosine 0.65–0.73, 99th percentile 0.86–0.91; his own tracks 0.78–0.89 to each other).
- **Continuity in place and time does not either.** His tracks already run from camera cut to camera cut (track 1448: 29:12–29:39, the
  shot 29:12–29:39): they end because the picture changes. Where a track ended inside a shot (825 at 25:35), the nearest track starting
  there was a white-shirt player crossing him, and with a shirt-colour check nobody was left. Rejected as a suggestion source.
- **Shirt numbers:** all six of his tracks are `TOO_SMALL`; 118 of 21,666 tracks in the run have a number read. Not usable for him here.
- **What works best:** the stored look-alike graph (ADR-031/033: each track's 5 most alike tracks never on screen with it), read in both
  directions from all his confirmed tracks and ranked by `cosine × (0.5 + 0.5 × kit similarity)`. From his first 3 tracks it offers 44
  tracks. (A first reading of this measurement counted 3486, 2751 and 2890 as tracks the owner confirmed; they were tracks he marked
  **not him**. Corrected the same day.)

## Owner's use (2026-11-02, 02:37–02:43)
The owner reviewed the list from the Reel Builder link and marked **14 tracks Not him and none Him**; with the 3 earlier rejections, 17 of
the top look-alikes are not him and none is. Re-detect Player kept the reel's 3 tracks. **On this footage the look-alike list does not find
him**: its value here is the recorded "not him" decisions (labels for a future model), not new tracks. Finding him needs a person who
recognises him at a moment, or evidence other than appearance.

## Decision
`GET /v1/tracks/:id/look-alikes` (track-links.ts):
- ranks by look weighted by shirt colour (above), then by how many of his tracks it resembles;
- leaves out a track whose colour group differs from the group most of his tracks are in (another team or an official); a track with no
  colour group (shirt not read clearly) stays in;
- as before: not on screen with him, not decided as anyone, not marked "not him", inside match time;
- returns 24 at a time and `more` (how many follow); `score` and `kit_similarity` are returned with `similarity`.

Page 04 → Name players → 3 "From look-alikes" (NamePlayers.tsx):
- **nothing is pre-ticked.** The old list ticked everything from cosine 0.85, which on this footage is nearly everyone;
- each picture has **Show** (plays that moment inside the list, looping over the track, with its box), **Him** and **Not him**;
- Save records each Him as a CONFIRMED identity decision and each Not him as a REJECTED decision naming the player, so it is never offered
  for him again and the next look-alikes come up. Every decision is a person's (ADR-031: suggestions never decide).

Reel Builder → Player Targeting → **"Find more of him ›"** opens `/analysis?video=…&find=<player>`, which opens that list at once. After
saving, **Re-detect Player** on the Reel Builder takes the new tracks into the reel (the existing stale-reel rule asks for it).

## Alternatives
- Auto-confirming above a threshold: no threshold separates him from his teammates on this footage (above). Unknown beats wrong.
- A better re-identification model (football-trained ReID): the free models evaluated in ADR-031 did not beat DINOv2 + kit on wide footage;
  training our own needs labelled tracks. The Him / Not him decisions recorded here are exactly those labels: a later step.
- Linking fragments by position: measured above; it does not cross camera cuts, which is where his tracks end.

## Tests
- API `test/links.api.test.ts`: the earlier look-alike test unchanged (seeds widen, impossible / rejected / decided left out), and a new one:
  the same shirt shade ranks above a slightly more alike other shade, the other colour group is left out, a track without a group stays,
  24 shown with `more` = 4. Full API suite 148/148.
- Web typecheck; web tests 56/56. In the browser: the link on the Reel Builder; the list opens on Godwin (24 of 37, 3 named tracks);
  Show plays 26:24 inside the list with the box; no decision was made by the developer.
