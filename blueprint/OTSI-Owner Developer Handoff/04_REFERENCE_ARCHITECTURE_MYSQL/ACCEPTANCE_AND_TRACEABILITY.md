> Adapted architectural reference only. MySQL migration authority is in `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/`. Do not assume a described control is implemented or tested.

# Verification specifications — cannot certify a mock as a production engine

## Test evidence
For every test: ID, requirement, test fixture and rights, setup, expected behavior, actual logs, screenshot/video artifact, build SHA/model hash, pass/fail, reviewer/time. Store signed test report in release audit. No guessed pass counts.

| Test ID | Workflow | Expected verified behavior |
|---|---|---|
| DB-001 | bootstrap fresh staging DB | all four migrations transactionally applied; constraints verified; rollback rehearsed on staging |
| DB-002 | map existing player registry | canonical IDs and source fields preserved, no allocator duplication |
| SEC-001 | cross-org media UUID | API and asset access denied; no metadata leak |
| SEC-002 | revoked export grant | blocked at job creation, renderer cut, new signed link and delayed send |
| SEC-003 | RED clip | cannot render/export/deliver; audit denial |
| ING-001 | valid VFR file | playback PTS and frame lookup match decoded frame timestamps |
| ING-002 | malformed media / URL SSRF | quarantined/rejected with reason; no internal requests |
| CV-001 | 22 players plus referee/ball present | all visible class candidates evaluated, detector ground-truth metrics recorded |
| CV-002 | off-ball runner | runner track persists while visible even without ball proximity |
| MOT-001 | occlusion/re-entry and camera cut | bounded continuity, correct gap state, no offscreen phantom boxes |
| MOT-002 | same kit two players cross | ID switch alerts and review; no incorrect confirmed identity |
| ID-001 | ambiguous jersey OCR | remains CANDIDATE/UNRESOLVED, no misleading player name |
| ID-002 | reviewer corrects player | append-only identity decision, old reference maintained, dependent reels invalidated |
| TAC-001 | uncalibrated footage | meters, speed and xG show NOT_MEASURED unless validated method exists |
| TAC-002 | off-ball movement with possession elsewhere | valid observed run candidates; on-screen-only coverage communicated |
| UI-001 | upload click-path | every upload tab/submit/retry/current processing status is real, not mock |
| UI-002 | analysis seeking/resizing | boxes remain aligned under seek, pause, fullscreen, 16:9 and tablet |
| REEL-001 | select target + assemble clips | ordered trim edits persist after reload, optimistic locking works |
| FX-001 | light-ray rendering across clips | approved visual tolerance, beam on selected target only, fade on gaps |
| FX-002 | aspect ratio conversion | target remains framed or flagged for manual crop when impossible |
| EXP-001 | output MP4 | ffprobe-valid streams, playback and sync, stable duration and checksum |
| EXP-002 | final report | source citations, evidence categories, no invented numeric metrics |
| PERF-001 | concurrent multi-tenant load | measured p95 under documented SLA and queue budget |
| OPS-001 | worker crash/retry | single visible result, no duplicate rows, audit trail and safe resume |
| OPS-002 | restore drill | successful restore from documented backups against RPO/RTO target |

## Evaluation dataset and numerical gates
Create licensed annotated benchmark spanning varied broadcast cameras/teams/lighting/quality/occlusion, with explicit off-ball players and camera cuts. Require separately established acceptance thresholds from baseline and business risk: detector AP/recall per class, ball recall, HOTA/IDF1, ID switches/min, identity precision on confirmed set, event precision/recall, pitch calibration reprojection error and resulting distance uncertainty, preview-to-render spotlight center pixel error, per-step latency. Write baseline/target/version in `QUALITY_GATES.yaml` after actual measurement; do NOT insert fake 98% recognition values from design images.

## Page acceptance walk-through
01 Home: counts correspond to real scoped records and dates; 02 Upload: interrupted multipart resume; 03 Pipeline: step success/failure and truthful progress; 04 Analysis: every player tracked while visible and timeline gaps shown; 05 Tactics: only valid calibrated maps; 06 Reel: target+moments+effects saved; 07 Clip Studio: exact trims, keyframes, captions, audio; 08 Report: source-linked metrics and PDF; 09 Library: search/filter/action permissions; 10 Export: real 4K/1080p output based on tested encoder, revocable links and logged delivery.

## Release stop conditions
Any confirmed wrong-player export, cross-tenant access, unauthorized media acquisition, RED clip exported, inaccurate fabricated metrics, unplayable output, corruption of existing canonical player IDs, no DB rollback strategy, failed backup restore or broken rights revocation blocks release. Resolve with evidence, not visual approval.
