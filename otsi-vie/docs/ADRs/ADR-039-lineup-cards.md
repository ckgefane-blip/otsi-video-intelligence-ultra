# ADR-039: Players named from the broadcast lineup cards

Status: in progress (2026-11-01; owner: "Can the engine identify each player by name and jersey number? By using the data at the beginning of
each game? Lineup ... then user can still follow this existing process for cases where player not identified", then "Ok", and "Yes, install
them" for Paddle's tools).

## Idea
Broadcasters show each team's sheet before kick-off (and often at half-time): team name, shirt number and name of every starter and
substitute, the head coach. Read once, it becomes the match roster; then every shirt number the engine reads on a player during the match
(ADR-033) proposes a name, and through the player registry an OTSI Player ID (ADR-016). People approve; the manual identity tools stay for
everything the cards and numbers cannot settle.

## Decisions so far
- **Reading** (`vie_worker/lineup.py`): PaddleOCR PP-OCRv4 text detection (already in use, OpenVINO) + **PP-OCRv5** recognition, a Cyrillic
  and a Latin reader (Apache-2.0, Hugging Face, revisions and SHA-256 pinned in the model registry). The reader that is more confident over
  the whole card reads it (line by line, a Latin reader confidently misreads Cyrillic capitals). PP-OCRv3 multilingual readers were tried
  first and rejected: about 80 % of letters right on Cyrillic cards (e.g. "муБарауль" for МУЦБА РАУЛЬ).
- **Runtime**: OpenVINO 2025.3 (and the newest release) cannot read PP-OCRv5's PIR format, and paddle2onnx has no build for Python 3.13, so
  the recognisers run in **Paddle Inference on the CPU** (paddlepaddle 3.3.1, Apache-2.0, added to the worker environment; it requires
  safetensors >= 0.6, upgraded 0.5.2 -> 0.8.0; the appearance embedder still passes its GPU parity check).
- **Parsing** is generic: rows of "number name" in one or two columns; the substitutes section after its heading and the coach after his
  heading, both matched against word lists in several languages; the team name is the largest line above the rows; a number the detector
  missed (a thin "1") is read from the space left of a name standing in a numbered column; a frame with fewer than 8 rows is not a card.
  Nothing names a club, broadcaster or match.

## Measured (one match: two Cyrillic cards, 720 p)
- Every row found: ФК "ЕРЦАХУ" 11 starters + 9 substitutes and coach, ФК "ДИНАМО" 11 + 6 and coach; numbers 37/37 right; roles 37/37 right;
  names 36/37 exact (one letter missing: "ЗАРИЯ ГЕОГИЙ"). A normal match frame is correctly not a card. 7-8 s per card on the CPU.
- One broadcaster and one script only: other layouts and languages must be measured before release (synthetic English and Spanish cards are
  covered by tests).

## Built (part 2)
- `READ_LINEUPS` worker job (`vie_worker/lineup_job.py`): one frame every 2 s through the whole video with the GPU text detector only
  (0.1 s a frame); a frame with >= 25 text regions in >= 10 rows is card-like (ordinary frames: < 15); card-like frames within 6 s are one
  showing, read once on its middle frame; the same team read twice keeps the reading with more rows; each card stored with a JPEG of its
  frame (migration 0029: `lineup_reads`, `lineup_cards`). Started by itself once per video when an analysis finishes (`jobs.auto_lineups`),
  or by "Read the lineups" (`jobs.lineups`); runs in the media worker group.
- API (`modules/analysis/lineups.ts`): list, start, card image, dismiss, and **apply**: a person's corrected cards become clubs (found by
  name in the organization or created), the match (or the linked match's sides), players (found in the registry by exact name, else created
  provisional - no OTSI Player ID until registered) and the roster with shirt numbers and roles. A shirt-number clash is reported per row and
  checked before any player is created.
- Page 04: AI Tools -> Lineups (status, Review and approve, Read again) and the approval window (card picture beside editable rows; Home /
  Away / Not used; Not a lineup).

## Still to build
Kit colour groups to teams proposed from the roster; track proposals from shirt number + team with bulk acceptance (today the existing
"Who could this be?" panel already suggests roster players from a read shirt number once the match and kits are set).

## Tests
`services/worker/tests/test_lineup.py` (synthetic English/Spanish cards: two columns, headings, a missed number recovered only with the digit
reader, a non-card frame; the job end to end on a rendered English team sheet video: 14/14 rows), `apps/api/test/lineups.api.test.ts`
(automatic read once per video, request, approval creating clubs/match/players/roster, registry match by name, number clash, linked match,
dismiss, roles, tenancy).
