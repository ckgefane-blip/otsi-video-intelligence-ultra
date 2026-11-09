> Adapted architectural reference only. MySQL migration authority is in `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/`. Do not assume a described control is implemented or tested.

# Engine specification B: identity resolution, events, tactical intelligence, measurement validity

## Canonical player identity and roster adapter
Join verified roster, club, jersey number and source metadata to visual track *candidates*. Use jersey OCR (multiple frames), appearance similarity, team kit segmentation, position context, shot continuity and temporal contradictions. Candidate scorer returns calibrated probability or rank, not a confirmation. Example candidate record references track UUID, player UUID, match UUID, score, evidence frames and model version. A multi-frame reviewer can accept/reject; decision is append-only. Never automatically create new canonical OTSI IDs to match a video. Existing website allocator remains authority; synchronize by verified canonical ID and preserve old `otsi_pms_id` read compatibility during migration.

Identity transition rules: UNRESOLVED while no supporting evidence; CANDIDATE for plausible rank; CONFIRMED only when explicit human decision or an *approved, validated* automatic confirmation policy; CONFLICT if simultaneously incompatible high-confidence mappings; REJECTED for disproved association. UI labels use confidence per **task** (detection, track association, identity), never collapse into one '98% tracking identity' number. Restrict export of single-player highlight when target track is not confirmed across selected segment; optional manual review with clear recorded gaps.

## Event candidate generation
Events emitted as typed candidates with `start_pts_us`, `end_pts_us`, primary/secondary track, evidence references, score and model version. Suggested ontology v1: PASS_ATTEMPT, PASS_RECEIVED, SHOT_ATTEMPT, GOAL_CANDIDATE, BALL_RECOVERY, INTERCEPTION, TACKLE_ATTEMPT, DRIBBLE_CARRY, PRESSURE, DUEL, SET_PIECE, POSSESSION_CHANGE, OFFSIDE_CANDIDATE, UNKNOWN. A single image cannot reliably establish full ball control or official assist. Event pipeline uses ball trajectory, player-ball proximity, motion changes, multi-frame contact hypotheses and optional licensed official event-feed confirmation. Preserve contradictory or uncertain evidence and allow review. Event edit creates `event_decisions` record, never alters the candidate itself.

## Tactical outputs and preconditions
- Formation: estimate team shape in segments where enough team players visible and pitch transform quality passes gate. Outside visible cohort, show `NOT_MEASURED` or partial shape. Formation family confidence and phase duration stored as metrics with provenance.
- Pass network: use *confirmed or qualified inferred* pass events and source/target identity; unresolved target should be `UNKNOWN PLAYER`, not a fabricated pass edge.
- Heatmap: player on-screen normalized image heatmap is not pitch occupancy. True pitch heatmap requires high-quality homography and pitch calibration by shot; reject miscalibrated shots.
- Pressing/PPDA: define event ontology and opponent passes/defensive actions consistently; unsupported broadcast view means NOT_MEASURED, not precise decimal values.
- Off-ball runs: derive from tracking trajectories **while on-screen**, independent of possession; use field-plane projection only where calibrated. Distinguish visually observed run vs tactical interpretation.
- Speed/distance: monocular camera tracking without calibrated coordinates and reliable time intervals does NOT give trustworthy meter/second values. Require pitch-calibrated spatial mapping, smoothing, coverage and uncertainty; otherwise provide image-space movement or NOT_MEASURED.
- Comparisons: only compare same definitions, position cohorts, recording coverage, competitions and periods; attach cohort version and sample size.

## Metric registry (minimum initial definitions)
| key | Unit | Source | Measurement gate |
|---|---|---|---|
| visible_duration_s | s | Observed track intervals | DETECTED intervals, no off-camera gap counted |
| tracking_coverage | fraction | Valid frames / eligible visible-frame annotations | Ground truth for evaluation; UI coverage is observed-frame only |
| observed_pass_count | count | event candidates + review | show INFERRED until verified |
| pass_accuracy | % | attempts/completions | need explicit possession/receiver interpretation |
| pitch_distance_m | m | calibrated ground-plane trajectory | NOT_MEASURED if calibration/occlusion insufficient |
| max_speed_mps | m/s | calibrated filtered movement | NOT_MEASURED if sample rate/quality insufficient |
| progressive_carries | count | calibrated carries and attacking direction | contextual algorithm version |
| shot_count | count | candidate + review | support uncertain candidate state |
| xg | expected goals | trained outcome model with dataset card | not present as measured unless model exists and validated |
| xa | expected assists | trained outcome model with documented definition | do not infer from pass count |

## Origin/evidence types
Use `DETECTED` for raw measurable visual observation, `INFERRED` for model-derived analytical conclusion, `CONFIRMED` for independently reviewed/officially matched claim, `NOT_MEASURED` where ground truth missing or method fails. Store evidence link, time range, model version, source frame indices, calibration ID, reviewer ID if confirmed. Frontend badges and report footnotes must expose provenance on demand. No invented values, percentages or 'trusted by UEFA/FIFA' branding from sample images.

## Review workflow
Queue flags: ID switch, multiple candidates, overlapping identity, blurry jersey, kit ambiguity, calibration discontinuity, shot cut, low frame coverage, uncertain ball event, clip target disappearance, false-positive model output. Reviewer plays exact evidence frame window, compares identity candidates, records reason and decision. Every decision generates audit/outbox event and invalidates dependent computed outputs as needed. UI shows review pending without claiming a finished verified result.

## Quality and drift
Dataset split by fixture/stadium/camera to avoid leakage. Track per-league/stadium/lighting/model-release recall and precision, HOTA/IDF1, event precision/recall, xG calibration if enabled. Champion/challenger rollout, shadow inference, human annotation agreement, downgrade on regressions, historical run immutability. No arbitrary identity score threshold in two different source files: central versioned model policy and measured decision curves.
