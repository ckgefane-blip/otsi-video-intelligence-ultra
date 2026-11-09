# Sampling study 2026-10-27

See ADR-028 for method and decisions.

| Clip | fps | 90-min match on Arc GPU | persistent switches | tracks per ref. track | coverage | ball tracked / detected | interp. IoU mean (p10) | cuts found / ref |
|---|---|---|---|---|---|---|---|---|
| France–Germany (wide) | 1 | 36 min | 1 | 4.04 | 53% | 16/16 | 0.73 (0.53) | 0/0 |
| France–Germany (wide) | 2 | 71 min | 3 | 3.97 | 73% | 19/26 | 0.80 (0.63) | 0/0 |
| France–Germany (wide) | 3 | 107 min | 7 | 2.77 | 88% | 32/42 | 0.82 (0.67) | 0/0 |
| France–Germany (wide) | 5 | 179 min | 3 | 1.81 | 94% | 48/66 | 0.87 (0.75) | 0/0 |
| France–Germany (wide) | 10 | 357 min | 10 | 1.59 | 97% | 117/130 | 0.91 (0.83) | 0/0 |
| France–Germany (wide) | 15 | 536 min | 6 | 1.60 | 98% | 178/191 | 0.93 (0.85) | 0/0 |
| Naples (amateur, cuts) | 1 | 43 min | 0 | 1.18 | 81% | 22/23 | 0.83 (0.48) | 7/6 |
| Naples (amateur, cuts) | 2 | 86 min | 2 | 1.61 | 85% | 41/45 | 0.90 (0.68) | 6/6 |
| Naples (amateur, cuts) | 3 | 128 min | 0 | 1.74 | 93% | 56/65 | 0.91 (0.71) | 6/6 |
| Naples (amateur, cuts) | 5 | 214 min | 2 | 1.74 | 93% | 106/111 | 0.93 (0.79) | 6/6 |
| Naples (amateur, cuts) | 10 | 428 min | 1 | 1.46 | 97% | 205/220 | 0.95 (0.88) | 6/6 |
| Naples (amateur, cuts) | 15 | 642 min | 1 | 1.70 | 98% | 309/327 | 0.96 (0.92) | 7/6 |
| OCSC highlights (fast) | 1 | 44 min | 0 | 2.07 | 71% | 35/36 | 0.48 (0.09) | 5/0 |
| OCSC highlights (fast) | 2 | 88 min | 2 | 2.66 | 74% | 70/72 | 0.65 (0.32) | 2/0 |
| OCSC highlights (fast) | 3 | 132 min | 4 | 3.43 | 83% | 98/107 | 0.71 (0.42) | 2/0 |
| OCSC highlights (fast) | 5 | 219 min | 3 | 4.26 | 88% | 161/181 | 0.78 (0.52) | 1/0 |
| OCSC highlights (fast) | 10 | 439 min | 5 | 3.57 | 93% | 331/367 | 0.84 (0.62) | 1/0 |
| OCSC highlights (fast) | 15 | 658 min | 9 | 3.88 | 94% | 498/538 | 0.87 (0.64) | 0/0 |

Tracker variants at 2 fps (persistent switches / coverage):

| Clip | IoU (production) | + camera-motion compensation | + centre-distance blending |
|---|---|---|---|
| France–Germany (wide) | 3 / 73% | 5 / 69% | 16 / 92% |
| Naples (amateur, cuts) | 2 / 85% | 1 / 88% | 3 / 93% |
| OCSC highlights (fast) | 2 / 74% | 0 / 73% | 6 / 91% |

Re-linking a lost player by kit colour (same shot, ≤3 s, plausible position), judged against the reference at 2 fps:

- France–Germany (wide): 48 links, 25 confirmed, 23 contradicted, 0 undecidable
- Naples (amateur, cuts): 9 links, 3 confirmed, 4 contradicted, 2 undecidable
- OCSC highlights (fast): 57 links, 13 confirmed, 39 contradicted, 5 undecidable

Adaptive sampling (base rate, burst where the picture changes fast) vs uniform at a similar frame budget:

- France–Germany (wide): adaptive 3→6 (5.8 fps effective): 9 persistent switches, coverage 95%; uniform 5 fps: 3, 94%
- Naples (amateur, cuts): adaptive 3→6 (4.15 fps effective): 2 persistent switches, coverage 90%; uniform 5 fps: 2, 93%
- OCSC highlights (fast): adaptive 3→6 (5.98 fps effective): 6 persistent switches, coverage 89%; uniform 5 fps: 3, 88%
