-- Migration 005 — AI pipeline (03), workers/resources, models, evidence, detection, tracking, identity resolution
USE `otsi_owner_vie`;

CREATE TABLE model_versions (
  id                ID36 NOT NULL,
  task              ENUM('VIDEO_CLASSIFY','SHOT_DETECT','PLAYER_DETECT','BALL_DETECT','TRACK','REID','JERSEY_OCR','TEAM_CLUSTER',
                         'PITCH_KEYPOINTS','EVENT_DETECT','FORMATION','XG','XA','INSIGHT_LLM','CAPTION_ASR','HIGHLIGHT_RANK') NOT NULL,
  model_name        VARCHAR(100) NOT NULL,
  semantic_version  VARCHAR(40) NOT NULL,
  weights_sha256    CHAR(64) CHARACTER SET ascii NOT NULL,
  license_id        VARCHAR(120) NOT NULL COMMENT 'Commercial licence evidence required (ADR-009)',
  approval_state    ENUM('CANDIDATE','APPROVED','DEPRECATED','REVOKED') NOT NULL DEFAULT 'CANDIDATE',
  approved_by       ID36 NULL,
  approved_at       TS6 NULL,
  config            JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_model_versions (task, model_name, semantic_version),
  KEY ix_model_task_state (task, approval_state),
  CONSTRAINT fk_mv_approver FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT ck_mv_approved CHECK (approval_state <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
) TBL;

ALTER TABLE video_classifications ADD CONSTRAINT fk_vc_model FOREIGN KEY (model_version_id) REFERENCES model_versions(id);

CREATE TABLE model_evaluation_sets (
  id                ID36 NOT NULL,
  name              VARCHAR(150) NOT NULL,
  dataset_sha256    CHAR(64) CHARACTER SET ascii NOT NULL,
  license_note      TEXT NOT NULL,
  manifest_object_key VARCHAR(1024) NOT NULL,
  split_policy      VARCHAR(255) NOT NULL DEFAULT 'by fixture/stadium/camera',
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mes_name (name)
) TBL;

CREATE TABLE model_evaluation_runs (
  id                ID36 NOT NULL,
  model_version_id  ID36 NOT NULL,
  evaluation_set_id ID36 NOT NULL,
  summary_metrics   JSON NOT NULL COMMENT 'mAP, HOTA, IDF1, event P/R, calibration ...',
  acceptance_state  ENUM('PENDING','PASSED','FAILED') NOT NULL DEFAULT 'PENDING',
  reviewed_by       ID36 NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  KEY ix_mer_model (model_version_id, created_at),
  CONSTRAINT fk_mer_model FOREIGN KEY (model_version_id) REFERENCES model_versions(id),
  CONSTRAINT fk_mer_set   FOREIGN KEY (evaluation_set_id) REFERENCES model_evaluation_sets(id),
  CONSTRAINT fk_mer_user  FOREIGN KEY (reviewed_by) REFERENCES users(id)
) TBL;

-- Display definitions of pipeline stages. 02 shows 5 user stages; 03 shows 5 AI stages; engine steps map onto them.
CREATE TABLE pipeline_stage_definitions (
  code              VARCHAR(24) CHARACTER SET ascii NOT NULL,
  engine_step       ENUM('VALIDATE','TRANSCODE','CLASSIFY','SHOTS','DETECT','TRACK','IDENTIFY','EVENTS','TACTICS','INDEX','QUALITY','FINISH') NOT NULL,
  ui_surface        ENUM('UPLOAD_PIPELINE','PROCESSING_PIPELINE','BOTH','INTERNAL') NOT NULL,
  ui_order          TINYINT UNSIGNED NOT NULL,
  label             VARCHAR(40) NOT NULL COMMENT 'e.g. "AI Detection", "Identity Resolution"',
  description       VARCHAR(160) NOT NULL COMMENT 'Stage card two-line description',
  timeline_color_hex CHAR(7) CHARACTER SET ascii NULL COMMENT '03 Processing Timeline legend colour',
  weight            DECIMAL(5,2) NOT NULL DEFAULT 1 COMMENT 'Contribution to overall progress',
  PRIMARY KEY (code),
  UNIQUE KEY uq_psd_step (engine_step)
) TBL;

CREATE TABLE pipeline_runs (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  video_id          ID36 NOT NULL,
  attempt           SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  retry_of_run_id   ID36 NULL,
  pipeline_version  VARCHAR(40) NOT NULL,
  workflow_id       VARCHAR(255) CHARACTER SET ascii NULL COMMENT 'Temporal workflow id',
  status            JOBSTATE NOT NULL DEFAULT 'QUEUED',
  overall_progress  DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT '03 job card bar + percent (single source; never two numbers)',
  eta_seconds       INT UNSIGNED NULL,
  frames_total      BIGINT UNSIGNED NULL,
  frames_processed  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  config            JSON NOT NULL DEFAULT (JSON_OBJECT()) COMMENT 'Snapshot of video_ingest_options + model pins',
  idempotency_key   VARCHAR(128) CHARACTER SET ascii NOT NULL,
  requested_by      ID36 NOT NULL,
  queued_at         TS6 NOT NULL NOWTS,
  started_at        TS6 NULL,
  finished_at       TS6 NULL,
  failure_code      VARCHAR(64) CHARACTER SET ascii NULL,
  failure_detail    TEXT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pipeline_runs_org_id (organization_id, id),
  UNIQUE KEY uq_pipeline_runs_idem (organization_id, idempotency_key),
  UNIQUE KEY uq_pipeline_runs_attempt (video_id, attempt),
  KEY ix_runs_org_status (organization_id, status, queued_at),
  CONSTRAINT fk_runs_video FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id),
  CONSTRAINT fk_runs_retry FOREIGN KEY (organization_id, retry_of_run_id) REFERENCES pipeline_runs(organization_id, id),
  CONSTRAINT fk_runs_user  FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT ck_runs_progress CHECK (overall_progress BETWEEN 0 AND 100),
  CONSTRAINT ck_runs_frames CHECK (frames_total IS NULL OR frames_processed <= frames_total),
  CONSTRAINT ck_runs_succeeded CHECK (status <> 'SUCCEEDED' OR (overall_progress = 100 AND finished_at IS NOT NULL)),
  CONSTRAINT ck_runs_failed CHECK (status <> 'FAILED' OR failure_code IS NOT NULL)
) TBL;

CREATE TABLE pipeline_steps (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  run_id            ID36 NOT NULL,
  stage_code        VARCHAR(24) CHARACTER SET ascii NOT NULL,
  status            JOBSTATE NOT NULL DEFAULT 'QUEUED' COMMENT 'Pills: Completed / Processing / In Queue / Waiting',
  attempt           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  progress          DECIMAL(5,2) NOT NULL DEFAULT 0,
  frame_from        BIGINT UNSIGNED NULL COMMENT 'Processing Timeline segment start',
  frame_to          BIGINT UNSIGNED NULL,
  model_version_id  ID36 NULL,
  output_asset_id   ID36 NULL,
  error_code        VARCHAR(64) CHARACTER SET ascii NULL,
  started_at        TS6 NULL,
  completed_at      TS6 NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_steps_run_stage (run_id, stage_code),
  KEY ix_steps_org (organization_id, run_id),
  CONSTRAINT fk_steps_run   FOREIGN KEY (organization_id, run_id) REFERENCES pipeline_runs(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_steps_stage FOREIGN KEY (stage_code) REFERENCES pipeline_stage_definitions(code),
  CONSTRAINT fk_steps_model FOREIGN KEY (model_version_id) REFERENCES model_versions(id),
  CONSTRAINT fk_steps_asset FOREIGN KEY (output_asset_id) REFERENCES assets(id),
  CONSTRAINT ck_steps_progress CHECK (progress BETWEEN 0 AND 100),
  CONSTRAINT ck_steps_done CHECK (status <> 'SUCCEEDED' OR progress = 100)
) TBL;

-- Frame-level progress segments for the 03 Processing Timeline (two lanes, coloured by stage).
CREATE TABLE pipeline_step_segments (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  step_id           ID36 NOT NULL,
  lane              TINYINT UNSIGNED NOT NULL DEFAULT 1,
  from_pts_us       BIGINT UNSIGNED NOT NULL,
  to_pts_us         BIGINT UNSIGNED NOT NULL,
  state             ENUM('DONE','ACTIVE','PENDING','FAILED') NOT NULL,
  PRIMARY KEY (id),
  KEY ix_pss_step (step_id, lane, from_pts_us),
  CONSTRAINT fk_pss_step FOREIGN KEY (step_id) REFERENCES pipeline_steps(id) ON DELETE CASCADE,
  CONSTRAINT ck_pss_range CHECK (to_pts_us > from_pts_us)
) TBL;

-- 03 Processing Log rows (time, check/pending icon, message). Also feeds SSE with Last-Event-ID = id.
CREATE TABLE job_log_entries (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id   ID36 NOT NULL,
  run_id            ID36 NOT NULL,
  step_id           ID36 NULL,
  level             ENUM('DEBUG','INFO','SUCCESS','WARN','ERROR') NOT NULL DEFAULT 'INFO',
  message_code      VARCHAR(64) CHARACTER SET ascii NOT NULL COMMENT 'Stable code for i18n, e.g. TRACKLETS_GENERATED',
  message           VARCHAR(500) NOT NULL COMMENT 'Rendered text, e.g. "Player tracklets generated (22)"',
  params            JSON NOT NULL DEFAULT (JSON_OBJECT()),
  is_pending        BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Pending rows render dimmed with empty circle',
  user_visible      BOOLEAN NOT NULL DEFAULT TRUE,
  occurred_at       TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  KEY ix_log_run (organization_id, run_id, id),
  CONSTRAINT fk_log_run FOREIGN KEY (organization_id, run_id) REFERENCES pipeline_runs(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_log_step FOREIGN KEY (step_id) REFERENCES pipeline_steps(id)
) TBL;

CREATE TABLE worker_nodes (
  id                ID36 NOT NULL,
  hostname          VARCHAR(255) NOT NULL,
  pool              ENUM('CV_GPU','RENDER_GPU','CPU','ASR') NOT NULL,
  gpu_model         VARCHAR(80) NULL COMMENT 'System Resources GPU caption, e.g. "NVIDIA A100"',
  gpu_count         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  gpu_memory_bytes  BIGINT UNSIGNED NULL,
  cpu_cores         SMALLINT UNSIGNED NOT NULL COMMENT '"32 Cores"',
  memory_bytes      BIGINT UNSIGNED NOT NULL,
  storage_bytes_total BIGINT UNSIGNED NULL,
  status            ENUM('ONLINE','DRAINING','OFFLINE') NOT NULL DEFAULT 'ONLINE',
  last_heartbeat_at TS6 NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_worker_host (hostname)
) TBL COMMENT='Platform-level (not tenant). Exposed to tenants only as aggregated, non-identifying figures';

CREATE TABLE worker_resource_samples (
  worker_id         ID36 NOT NULL,
  sampled_at        TS6 NOT NULL,
  gpu_util_pct      DECIMAL(5,2) NULL,
  cpu_util_pct      DECIMAL(5,2) NULL,
  memory_used_bytes BIGINT UNSIGNED NULL,
  storage_used_bytes BIGINT UNSIGNED NULL,
  PRIMARY KEY (worker_id, sampled_at),
  CONSTRAINT fk_wrs_worker FOREIGN KEY (worker_id) REFERENCES worker_nodes(id) ON DELETE CASCADE
) TBL COMMENT='03 System Resources rings + 14-bar sparklines; retain 24h (retention job)';

CREATE TABLE run_worker_assignments (
  run_id            ID36 NOT NULL,
  worker_id         ID36 NOT NULL,
  stage_code        VARCHAR(24) CHARACTER SET ascii NOT NULL,
  assigned_at       TS6 NOT NULL NOWTS,
  released_at       TS6 NULL,
  PRIMARY KEY (run_id, worker_id, stage_code),
  CONSTRAINT fk_rwa_run    FOREIGN KEY (run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_rwa_worker FOREIGN KEY (worker_id) REFERENCES worker_nodes(id),
  CONSTRAINT fk_rwa_stage  FOREIGN KEY (stage_code) REFERENCES pipeline_stage_definitions(code)
) TBL;

-- Preview tiles: 02 Live Processing Preview (4 sub-stage thumbnails) and 03 four detection tiles.
CREATE TABLE pipeline_preview_frames (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  run_id            ID36 NOT NULL,
  preview_kind      ENUM('PLAYERS','BALL','TEAMS','EVENTS','METADATA','PROCESSING_VIEW') NOT NULL,
  pts_us            BIGINT UNSIGNED NOT NULL,
  frame_asset_id    ID36 NOT NULL,
  overlay           JSON NOT NULL DEFAULT (JSON_ARRAY()) COMMENT '[{trackId,bbox:[x,y,w,h],label,teamSide,confidence}]',
  headline_count    INT UNSIGNED NULL COMMENT '"22 players detected" / "1 ball detected"',
  headline_confidence DECIMAL(5,4) NULL COMMENT '"Ball 0.98"',
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  KEY ix_ppf_run_kind (organization_id, run_id, preview_kind, created_at),
  CONSTRAINT fk_ppf_run   FOREIGN KEY (organization_id, run_id) REFERENCES pipeline_runs(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_ppf_asset FOREIGN KEY (organization_id, frame_asset_id) REFERENCES assets(organization_id, id)
) TBL;

CREATE TABLE evidence_records (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  video_id          ID36 NULL,
  pipeline_run_id   ID36 NULL,
  model_version_id  ID36 NULL,
  state             EVSTATE NOT NULL,
  source_type       ENUM('MODEL','HUMAN_REVIEW','OFFICIAL_FEED','ROSTER','CALIBRATION','DERIVED') NOT NULL,
  source_ref        VARCHAR(255) NOT NULL,
  frame_from        BIGINT UNSIGNED NULL,
  frame_to          BIGINT UNSIGNED NULL,
  confidence        DECIMAL(5,4) NULL,
  reviewer_id       ID36 NULL,
  reviewed_at       TS6 NULL,
  notes             TEXT NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_evidence_org_id (organization_id, id),
  KEY ix_evidence_video (organization_id, video_id),
  CONSTRAINT fk_ev_video FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id),
  CONSTRAINT fk_ev_run   FOREIGN KEY (organization_id, pipeline_run_id) REFERENCES pipeline_runs(organization_id, id),
  CONSTRAINT fk_ev_model FOREIGN KEY (model_version_id) REFERENCES model_versions(id),
  CONSTRAINT fk_ev_user  FOREIGN KEY (reviewer_id) REFERENCES users(id),
  CONSTRAINT ck_ev_confirmed CHECK (state <> 'CONFIRMED' OR (reviewer_id IS NOT NULL OR source_type IN ('OFFICIAL_FEED','ROSTER'))),
  CONSTRAINT ck_ev_conf CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1)
) TBL;

CREATE TABLE detection_batches (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  run_id            ID36 NOT NULL,
  model_version_id  ID36 NOT NULL,
  start_frame       BIGINT UNSIGNED NOT NULL,
  end_frame         BIGINT UNSIGNED NOT NULL,
  payload_asset_id  ID36 NOT NULL COMMENT 'Parquet in S3',
  checksum          CHAR(64) CHARACTER SET ascii NOT NULL,
  detection_count   BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY ix_db_run (organization_id, run_id, start_frame),
  CONSTRAINT fk_db_run   FOREIGN KEY (organization_id, run_id) REFERENCES pipeline_runs(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_db_model FOREIGN KEY (model_version_id) REFERENCES model_versions(id),
  CONSTRAINT fk_db_asset FOREIGN KEY (organization_id, payload_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT ck_db_range CHECK (end_frame >= start_frame)
) TBL;

CREATE TABLE tracks (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  run_id            ID36 NOT NULL,
  video_id          ID36 NOT NULL,
  internal_track_number INT UNSIGNED NOT NULL COMMENT 'Anonymous visual id; NEVER shown as a player id',
  class_name        ENUM('PLAYER','GOALKEEPER','REFEREE','BALL','OTHER') NOT NULL,
  team_side         ENUM('HOME','AWAY','NEUTRAL','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN' COMMENT 'Box colour cyan/amber',
  team_side_confidence DECIMAL(5,4) NULL,
  ocr_jersey_number TINYINT UNSIGNED NULL COMMENT 'Number tag on boxes (OCR evidence only)',
  ocr_jersey_confidence DECIMAL(5,4) NULL,
  first_pts_us      BIGINT UNSIGNED NOT NULL,
  last_pts_us       BIGINT UNSIGNED NOT NULL,
  observed_frames   INT UNSIGNED NOT NULL DEFAULT 0,
  status            ENUM('ACTIVE','OCCLUDED','LEFT_FRAME','ENDED','REVIEW_REQUIRED') NOT NULL DEFAULT 'ACTIVE',
  identity_state    ENUM('UNRESOLVED','CANDIDATE','CONFIRMED','REJECTED','CONFLICT') NOT NULL DEFAULT 'UNRESOLVED',
  current_player_id ID36 NULL COMMENT 'Denormalised from latest CONFIRMED decision (set by trigger/service only)',
  current_decision_id ID36 NULL,
  quality_score     DECIMAL(5,4) NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tracks_org_id (organization_id, id),
  UNIQUE KEY uq_tracks_number (run_id, internal_track_number),
  KEY ix_tracks_video_class (organization_id, video_id, class_name, team_side),
  KEY ix_tracks_player (organization_id, current_player_id),
  CONSTRAINT fk_tracks_run    FOREIGN KEY (organization_id, run_id) REFERENCES pipeline_runs(organization_id, id),
  CONSTRAINT fk_tracks_video  FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id),
  CONSTRAINT fk_tracks_player FOREIGN KEY (current_player_id) REFERENCES players(id),
  CONSTRAINT ck_tracks_range  CHECK (last_pts_us >= first_pts_us),
  CONSTRAINT ck_tracks_identity CHECK ((identity_state = 'CONFIRMED') = (current_player_id IS NOT NULL)),
  CONSTRAINT ck_tracks_ocr CHECK (ocr_jersey_number IS NULL OR ocr_jersey_number <= 99)
) TBL;

-- Per-frame boxes: the highest-volume table. Partitioned by HASH of video for pruning; no FKs (MySQL forbids FKs on
-- partitioned InnoDB tables). Long-term storage is Parquet in S3; MySQL keeps a queryable window for overlays.
CREATE TABLE track_observations (
  video_id          ID36 NOT NULL,
  frame_index       INT UNSIGNED NOT NULL,
  track_id          ID36 NOT NULL,
  pts_us            BIGINT UNSIGNED NOT NULL,
  bbox_x            FLOAT NOT NULL,
  bbox_y            FLOAT NOT NULL,
  bbox_w            FLOAT NOT NULL,
  bbox_h            FLOAT NOT NULL,
  pitch_x_m         FLOAT NULL COMMENT 'Only when a calibration passed the quality gate',
  pitch_y_m         FLOAT NULL,
  detector_confidence FLOAT NULL,
  association_confidence FLOAT NULL,
  observation_state ENUM('DETECTED','PREDICTED','INTERPOLATED','REVIEWED') NOT NULL,
  PRIMARY KEY (video_id, frame_index, track_id),
  KEY ix_obs_track_pts (video_id, track_id, pts_us),
  KEY ix_obs_pts (video_id, pts_us),
  CONSTRAINT ck_obs_bbox CHECK (bbox_x BETWEEN 0 AND 1 AND bbox_y BETWEEN 0 AND 1 AND bbox_w > 0 AND bbox_h > 0
                                AND bbox_x + bbox_w <= 1.00001 AND bbox_y + bbox_h <= 1.00001)
) TBL PARTITION BY KEY (video_id) PARTITIONS 32;

CREATE TABLE track_segments (
  id                ID36 NOT NULL,
  track_id          ID36 NOT NULL,
  shot_id           ID36 NULL,
  start_pts_us      BIGINT UNSIGNED NOT NULL,
  end_pts_us        BIGINT UNSIGNED NOT NULL,
  observation_asset_id ID36 NOT NULL,
  interpolation_policy ENUM('NONE','SHORT_GAP_LINEAR','KALMAN','REVIEWED') NOT NULL DEFAULT 'NONE',
  gap_count         INT UNSIGNED NOT NULL DEFAULT 0,
  quality_score     DECIMAL(5,4) NULL,
  PRIMARY KEY (id),
  KEY ix_ts_track (track_id, start_pts_us),
  CONSTRAINT fk_ts_track FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
  CONSTRAINT fk_ts_shot  FOREIGN KEY (shot_id) REFERENCES video_shots(id),
  CONSTRAINT fk_ts_asset FOREIGN KEY (observation_asset_id) REFERENCES assets(id),
  CONSTRAINT ck_ts_range CHECK (end_pts_us > start_pts_us)
) TBL;

CREATE TABLE track_gaps (
  id                ID36 NOT NULL,
  track_id          ID36 NOT NULL,
  start_pts_us      BIGINT UNSIGNED NOT NULL,
  end_pts_us        BIGINT UNSIGNED NOT NULL,
  gap_reason        ENUM('OCCLUDED','OUT_OF_FRAME','CAMERA_CUT','DETECTION_FAILURE','UNKNOWN') NOT NULL,
  PRIMARY KEY (id),
  KEY ix_tg_track (track_id, start_pts_us),
  CONSTRAINT fk_tg_track FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE,
  CONSTRAINT ck_tg_range CHECK (end_pts_us > start_pts_us)
) TBL;

-- 04 "Tracks & Presence" lanes.
CREATE TABLE presence_intervals (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  video_id          ID36 NOT NULL,
  track_id          ID36 NOT NULL,
  start_pts_us      BIGINT UNSIGNED NOT NULL,
  end_pts_us        BIGINT UNSIGNED NOT NULL,
  observation_count INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY ix_pi_video (organization_id, video_id, start_pts_us),
  KEY ix_pi_track (track_id, start_pts_us),
  CONSTRAINT fk_pi_track FOREIGN KEY (organization_id, track_id) REFERENCES tracks(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_pi_video FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id),
  CONSTRAINT ck_pi_range CHECK (end_pts_us > start_pts_us AND observation_count >= 1)
) TBL;

CREATE TABLE track_identity_candidates (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  track_id          ID36 NOT NULL,
  player_id         ID36 NOT NULL,
  match_id          ID36 NULL,
  score             DECIMAL(5,4) NOT NULL COMMENT '04 "Conf." column (identity task only)',
  rank_no           TINYINT UNSIGNED NOT NULL,
  evidence          JSON NOT NULL DEFAULT (JSON_OBJECT()) COMMENT '{ocrFrames:[], appearanceScore, kitScore, rosterMatch}',
  model_version_id  ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tic (track_id, player_id, model_version_id),
  KEY ix_tic_rank (organization_id, track_id, rank_no),
  CONSTRAINT fk_tic_track  FOREIGN KEY (organization_id, track_id) REFERENCES tracks(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_tic_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_tic_match  FOREIGN KEY (organization_id, match_id) REFERENCES matches(organization_id, id),
  CONSTRAINT fk_tic_model  FOREIGN KEY (model_version_id) REFERENCES model_versions(id),
  CONSTRAINT ck_tic_score  CHECK (score BETWEEN 0 AND 1)
) TBL;

-- Append-only (UPDATE/DELETE blocked by trigger in 011). Latest row per track is the effective decision.
CREATE TABLE track_identity_decisions (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  track_id          ID36 NOT NULL,
  player_id         ID36 NULL,
  state             ENUM('UNRESOLVED','CANDIDATE','CONFIRMED','REJECTED','CONFLICT') NOT NULL,
  basis             ENUM('HUMAN','AUTO_POLICY','REGISTRY') NOT NULL,
  policy_version    VARCHAR(40) NULL COMMENT 'Required for AUTO_POLICY confirmations',
  decided_by        ID36 NULL,
  evidence_id       ID36 NULL,
  supersedes_id     ID36 NULL,
  valid_from_pts_us BIGINT UNSIGNED NULL COMMENT 'Partial-track decisions (ID switch handling)',
  valid_to_pts_us   BIGINT UNSIGNED NULL,
  reason            VARCHAR(500) NULL,
  decided_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tid_org_id (organization_id, id),
  UNIQUE KEY uq_tid_supersedes (supersedes_id),
  KEY ix_tid_track (organization_id, track_id, decided_at),
  CONSTRAINT fk_tid_track  FOREIGN KEY (organization_id, track_id) REFERENCES tracks(organization_id, id),
  CONSTRAINT fk_tid_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_tid_user   FOREIGN KEY (decided_by) REFERENCES users(id),
  CONSTRAINT fk_tid_evid   FOREIGN KEY (organization_id, evidence_id) REFERENCES evidence_records(organization_id, id),
  CONSTRAINT fk_tid_super  FOREIGN KEY (organization_id, supersedes_id) REFERENCES track_identity_decisions(organization_id, id),
  CONSTRAINT ck_tid_player CHECK (state NOT IN ('CONFIRMED','CANDIDATE') OR player_id IS NOT NULL),
  CONSTRAINT ck_tid_human  CHECK (basis <> 'HUMAN' OR decided_by IS NOT NULL),
  CONSTRAINT ck_tid_policy CHECK (basis <> 'AUTO_POLICY' OR policy_version IS NOT NULL),
  CONSTRAINT ck_tid_range  CHECK (valid_to_pts_us IS NULL OR valid_from_pts_us IS NULL OR valid_to_pts_us > valid_from_pts_us)
) TBL;

ALTER TABLE tracks ADD CONSTRAINT fk_tracks_decision FOREIGN KEY (organization_id, current_decision_id) REFERENCES track_identity_decisions(organization_id, id);

CREATE TABLE identity_review_tasks (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  video_id          ID36 NOT NULL,
  track_id          ID36 NOT NULL,
  flag              ENUM('ID_SWITCH','MULTIPLE_CANDIDATES','OVERLAPPING_IDENTITY','BLURRY_JERSEY','KIT_AMBIGUITY','CALIBRATION_DISCONTINUITY',
                         'SHOT_CUT','LOW_COVERAGE','UNCERTAIN_BALL_EVENT','TARGET_DISAPPEARANCE','FALSE_POSITIVE') NOT NULL,
  priority          TINYINT UNSIGNED NOT NULL DEFAULT 50,
  status            ENUM('OPEN','IN_PROGRESS','RESOLVED','DISMISSED') NOT NULL DEFAULT 'OPEN',
  assigned_to       ID36 NULL,
  resolution_decision_id ID36 NULL,
  created_at        TS6 NOT NULL NOWTS,
  resolved_at       TS6 NULL,
  PRIMARY KEY (id),
  KEY ix_irt_queue (organization_id, status, priority, created_at),
  CONSTRAINT fk_irt_track FOREIGN KEY (organization_id, track_id) REFERENCES tracks(organization_id, id),
  CONSTRAINT fk_irt_video FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id),
  CONSTRAINT fk_irt_user  FOREIGN KEY (assigned_to) REFERENCES users(id),
  CONSTRAINT fk_irt_dec   FOREIGN KEY (organization_id, resolution_decision_id) REFERENCES track_identity_decisions(organization_id, id)
) TBL;

CREATE TABLE pitch_calibrations (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  video_id          ID36 NOT NULL,
  shot_id           ID36 NULL,
  start_pts_us      BIGINT UNSIGNED NOT NULL,
  end_pts_us        BIGINT UNSIGNED NOT NULL,
  homography        JSON NOT NULL COMMENT '3x3 row-major',
  pitch_length_m    DECIMAL(5,1) NULL,
  pitch_width_m     DECIMAL(5,1) NULL,
  reprojection_error_px DECIMAL(8,3) NULL,
  quality_score     DECIMAL(5,4) NULL,
  passes_gate       BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Metric in metres allowed only when TRUE',
  evidence_state    EVSTATE NOT NULL DEFAULT 'INFERRED',
  model_version_id  ID36 NULL,
  PRIMARY KEY (id),
  KEY ix_pc_video (organization_id, video_id, start_pts_us),
  CONSTRAINT fk_pc_video FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_pc_shot  FOREIGN KEY (shot_id) REFERENCES video_shots(id),
  CONSTRAINT fk_pc_model FOREIGN KEY (model_version_id) REFERENCES model_versions(id),
  CONSTRAINT ck_pc_range CHECK (end_pts_us > start_pts_us),
  CONSTRAINT ck_pc_h CHECK (JSON_LENGTH(homography) = 9)
) TBL;
