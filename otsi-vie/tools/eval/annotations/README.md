# Evaluation ground truth (ADR-034 stage 2)

**What it is:** manually annotated frames of the three evaluation clips in `.local/eval-footage` (Wikimedia Commons, licences in
`SOURCES.json`). `decisions.json` holds the human decisions; `gt/<clip>.json` is built from them (`tools/eval/annotate.py build`) and
is what `tools/eval/benchmark_profiles.py` scores against.

| Clip | Frames | Players | of them placed from the feet mark (no candidate box) | Notes |
|---|---|---|---|---|
| france_germany (stadium phone recording, continuous) | 7 (4 of them a 0.5 s tracking segment, 4.0–5.5 s, with identities) | 142 | 9 | far-side players 25–60 px tall |
| naples_amateur (amateur match, edited) | 4 | 41 | 25 | training/warm-up scenes with very distant players; one close-up action frame |
| ocsc_wide (professional highlights, 4K, edited) | 4 | 20 | 4 | stadium with green seats and spectators at pitch level |

**Protocol (pool-assisted manual annotation, `tools/eval/annotate.py`):**
1. The engine proposes a deliberately over-sensitive candidate pool (full frame + 2x2 + 3x3 + 4x4 tiles, score ≥ 0.1, no tracking) —
   only to save drawing; the pool is never ground truth.
2. A person marks the **feet of every visible footballer** (players and goalkeepers) on an enlarged frame with a 1 % coordinate grid.
   Each mark is snapped to the candidate box standing on it; one box belongs to one person. Where no candidate covers a player,
   the box is placed from the feet mark with the height of nearby players and flagged `approximate` (scored by feet position, not IoU).
3. Referees and assistants, heavily truncated people (only legs, or cut by the frame edge) and people sitting on the pitch are
   **ignore** regions: neither found nor missed, and a prediction on them is not a false positive.
4. Everyone else — spectators, photographers, coaches, staff, ball persons — is a **negative**: a prediction on them is a false positive.
5. In the tracking segment, the same player is linked across frames (`annotate.py link` proposes links from position and kit;
   the person checks them on the rendered frames).

**Limits — read before quoting a number:**
- One annotator (the developer), no second annotator, no agreement measure. Small or blurred players can be missed by the annotator.
- 15 frames, 203 players: the numbers are indicative per clip, not statistically strong; differences of a few boxes are noise.
- Naples' annotated far players are tiny and many are `approximate` (25 of 41); its recall measures distant-player detection mostly.
- No single-camera, full-length grassroots match is included yet; the clips are edited highlights or a phone recording in a stadium.
- The owner's representative grassroots footage, annotated the same way, is the next required evaluation input.
