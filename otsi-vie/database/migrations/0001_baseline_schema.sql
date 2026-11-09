-- 0001 baseline schema (OTSI VIE v2, MySQL 8.4 LTS)
-- Source: owner handoff 01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/001_full_schema_mysql84.sql (kept unchanged in blueprint/).
-- Corrections C-SQL-01..04 are listed in blueprint/CHANGELOG.md. Applied only by otsi-vie/tools/db/db_check.py and the API migrator.
-- OTSI Owner Developer Handoff — MySQL 8.4 LTS GREENFIELD REFERENCE SCHEMA
-- DO NOT RUN ON A DATABASE WITH EXISTING DATA. Review schema, permissions and backup first.
-- UUIDs are CHAR(36) and MUST be supplied by application UUIDv7 factory; do not rely on default UUID.
-- Requires MySQL 8.4 LTS, InnoDB, utf8mb4; this SQL has NOT been executed against a live server.
CREATE TABLE `organizations` (
  `id` CHAR(36) PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `slug` VARCHAR(255) NOT NULL UNIQUE,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `users` (
  `id` CHAR(36) PRIMARY KEY,
  `external_subject` VARCHAR(255) NOT NULL UNIQUE,
  `email` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `memberships` (
  `organization_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `role` VARCHAR(255) NOT NULL CHECK(role IN ('OWNER','ADMIN','ANALYST','EDITOR','SCOUT','VIEWER')),
  `status` VARCHAR(255) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('INVITED','ACTIVE','SUSPENDED')),
  PRIMARY KEY(organization_id,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `projects` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `description` TEXT,
  `status` VARCHAR(255) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','ARCHIVED')),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `version` bigint NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `clubs` (
  `id` CHAR(36) PRIMARY KEY,
  `canonical_name` VARCHAR(255) NOT NULL,
  `country_code` char(2),
  `external_ids` JSON NOT NULL DEFAULT (JSON_OBJECT())
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `players` (
  `id` CHAR(36) PRIMARY KEY,
  `canonical_otsi_id` varchar(32) UNIQUE,
  `canonical_state` VARCHAR(255) NOT NULL DEFAULT 'PENDING' CHECK(canonical_state IN('PENDING','VERIFIED','RETIRED')),
  `display_name` VARCHAR(255) NOT NULL,
  `birth_date` date,
  `preferred_foot` VARCHAR(255) CHECK(preferred_foot IN ('LEFT','RIGHT','BOTH','UNKNOWN')),
  `external_ids` JSON NOT NULL DEFAULT (JSON_OBJECT())
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `matches` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `competition` VARCHAR(255),
  `season` VARCHAR(255),
  `kickoff_at` DATETIME(6),
  `venue` VARCHAR(255),
  `home_club_id` CHAR(36),
  `away_club_id` CHAR(36),
  `home_score` integer CHECK(home_score >= 0),
  `away_score` integer CHECK(away_score >= 0),
  `metadata_state` ENUM('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') NOT NULL DEFAULT 'INFERRED',
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `match_rosters` (
  `match_id` CHAR(36) NOT NULL,
  `player_id` CHAR(36) NOT NULL,
  `club_id` CHAR(36) NOT NULL,
  `jersey_number` integer CHECK(jersey_number BETWEEN 0 AND 99),
  `roster_verified` BOOLEAN NOT NULL DEFAULT false,
  `source_uri` TEXT,
  PRIMARY KEY(match_id,player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `assets` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `project_id` CHAR(36),
  `kind` ENUM('SOURCE','PROXY','THUMBNAIL','TRACKS','EVENTS','REEL','REPORT','HEATMAP','MANIFEST','CAPTIONS') NOT NULL,
  `object_key` VARCHAR(255) NOT NULL,
  `storage_bucket` VARCHAR(255) NOT NULL,
  `byte_size` bigint CHECK(byte_size >= 0),
  `sha256` char(64),
  `mime_type` VARCHAR(255),
  `source_asset_id` CHAR(36),
  `created_by` CHAR(36),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `retention_until` DATETIME(6),
  `metadata` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  UNIQUE(storage_bucket,object_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `video_sources` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `match_id` CHAR(36),
  `source_asset_id` CHAR(36),
  `ingest_mode` VARCHAR(255) NOT NULL CHECK(ingest_mode IN ('UPLOAD','DIRECT_URL','AUTHORIZED_PROVIDER')),
  `source_uri` TEXT,
  `title` VARCHAR(255),
  `state` VARCHAR(255) NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','VALIDATING','INGESTED','FAILED','QUARANTINED')),
  `duration_us` bigint CHECK(duration_us > 0),
  `width` integer CHECK(width > 0),
  `height` integer CHECK(height > 0),
  `timebase_num` integer CHECK(timebase_num > 0),
  `timebase_den` integer CHECK(timebase_den > 0),
  `avg_frame_rate_num` integer CHECK(avg_frame_rate_num > 0),
  `avg_frame_rate_den` integer CHECK(avg_frame_rate_den > 0),
  `video_sha256` char(64),
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `video_shots` (
  `id` CHAR(36) PRIMARY KEY,
  `video_id` CHAR(36) NOT NULL,
  `start_pts_us` bigint NOT NULL CHECK(start_pts_us >= 0),
  `end_pts_us` bigint NOT NULL,
  `camera_class` VARCHAR(255),
  `confidence` FLOAT CHECK(confidence BETWEEN 0 AND 1),
  CHECK(end_pts_us > start_pts_us),
  UNIQUE(video_id,start_pts_us)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `model_versions` (
  `id` CHAR(36) PRIMARY KEY,
  `task` VARCHAR(255) NOT NULL,
  `model_name` VARCHAR(255) NOT NULL,
  `semantic_version` VARCHAR(255) NOT NULL,
  `weights_sha256` char(64),
  `license_id` VARCHAR(255),
  `config` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `evaluation_id` CHAR(36),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(task,model_name,semantic_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `pipeline_runs` (
  `id` CHAR(36) PRIMARY KEY,
  `video_id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `pipeline_version` VARCHAR(255) NOT NULL,
  `status` ENUM('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') NOT NULL DEFAULT 'QUEUED',
  `config` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `started_at` DATETIME(6),
  `finished_at` DATETIME(6),
  `failure_code` VARCHAR(255),
  `failure_detail` TEXT,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `pipeline_steps` (
  `id` CHAR(36) PRIMARY KEY,
  `run_id` CHAR(36) NOT NULL,
  `step_name` VARCHAR(255) NOT NULL CHECK(step_name IN ('VALIDATE','TRANSCODE','SHOTS','DETECT','TRACK','IDENTIFY','EVENTS','TACTICS','INDEX','QUALITY','FINISH')),
  `status` ENUM('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') NOT NULL DEFAULT 'QUEUED',
  `attempt` integer NOT NULL DEFAULT 0 CHECK(attempt >= 0),
  `progress` numeric(5,2) NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  `output_asset_id` CHAR(36),
  `model_version_id` CHAR(36),
  `error_code` VARCHAR(255),
  `started_at` DATETIME(6),
  `completed_at` DATETIME(6),
  UNIQUE(run_id,step_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `job_events` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `run_id` CHAR(36) NOT NULL,
  `step_id` CHAR(36),
  `event_type` VARCHAR(255) NOT NULL,
  `payload` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `evidence_records` (
  `id` CHAR(36) PRIMARY KEY,
  `video_id` CHAR(36),
  `pipeline_run_id` CHAR(36),
  `model_version_id` CHAR(36),
  `state` ENUM('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') NOT NULL,
  `source_type` VARCHAR(255) NOT NULL,
  `source_ref` VARCHAR(255) NOT NULL,
  `confidence` FLOAT CHECK(confidence BETWEEN 0 AND 1),
  `reviewer_id` CHAR(36),
  `reviewed_at` DATETIME(6),
  `notes` TEXT,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CHECK(state <> 'CONFIRMED' OR reviewer_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `rights_grants` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `asset_id` CHAR(36),
  `video_id` CHAR(36),
  `rights_state` ENUM('UNKNOWN','ANALYSIS_ONLY','INTERNAL','EXPORT_ALLOWED','PUBLIC','EXPIRED') NOT NULL DEFAULT 'UNKNOWN',
  `allowed_uses` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  `territory_codes` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  `valid_from` DATETIME(6),
  `valid_until` DATETIME(6),
  `guardian_consent_state` VARCHAR(255) NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK(guardian_consent_state IN('NOT_APPLICABLE','PENDING','VERIFIED','REVOKED')),
  `evidence_asset_id` CHAR(36),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CHECK(valid_until IS NULL OR valid_from IS NULL OR valid_until>valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `audit_events` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `actor_id` CHAR(36),
  `action` VARCHAR(255) NOT NULL,
  `entity_type` VARCHAR(255) NOT NULL,
  `entity_id` CHAR(36),
  `request_id` VARCHAR(255),
  `before_state` JSON,
  `after_state` JSON,
  `occurred_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `video_frame_index` (
  `video_id` CHAR(36) NOT NULL,
  `frame_index` bigint NOT NULL CHECK(frame_index>=0),
  `pts_us` bigint NOT NULL CHECK(pts_us>=0),
  `shot_id` CHAR(36),
  `keyframe` BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY(video_id,frame_index),
  UNIQUE(video_id,pts_us)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `detection_batches` (
  `id` CHAR(36) PRIMARY KEY,
  `run_id` CHAR(36) NOT NULL,
  `model_version_id` CHAR(36) NOT NULL,
  `start_frame` bigint NOT NULL,
  `end_frame` bigint NOT NULL,
  `payload_asset_id` CHAR(36) NOT NULL,
  `checksum` char(64) NOT NULL,
  `detection_count` bigint NOT NULL CHECK(detection_count>=0),
  CHECK(end_frame>=start_frame)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tracks` (
  `id` CHAR(36) PRIMARY KEY,
  `run_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `internal_track_number` bigint NOT NULL,
  `class_name` VARCHAR(255) NOT NULL CHECK(class_name IN ('PLAYER','GOALKEEPER','REFEREE','BALL','OTHER')),
  `first_pts_us` bigint NOT NULL,
  `last_pts_us` bigint NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','OCCLUDED','LEFT_FRAME','ENDED','REVIEW_REQUIRED')),
  `identity_state` ENUM('UNRESOLVED','CANDIDATE','CONFIRMED','REJECTED','CONFLICT') NOT NULL DEFAULT 'UNRESOLVED',
  `quality_score` FLOAT CHECK(quality_score BETWEEN 0 AND 1),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CHECK(last_pts_us >= first_pts_us),
  UNIQUE(run_id,internal_track_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `track_segments` (
  `id` CHAR(36) PRIMARY KEY,
  `track_id` CHAR(36) NOT NULL,
  `shot_id` CHAR(36),
  `start_pts_us` bigint NOT NULL,
  `end_pts_us` bigint NOT NULL,
  `observation_asset_id` CHAR(36) NOT NULL,
  `interpolation_policy` VARCHAR(255) NOT NULL DEFAULT 'NONE' CHECK(interpolation_policy IN('NONE','SHORT_GAP_LINEAR','KALMAN','REVIEWED')),
  `gap_count` integer NOT NULL DEFAULT 0 CHECK(gap_count >= 0),
  `quality_score` FLOAT CHECK(quality_score BETWEEN 0 AND 1),
  CHECK(end_pts_us>start_pts_us)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `track_observations` (
  `video_id` CHAR(36) NOT NULL,
  `frame_index` bigint NOT NULL,
  `track_id` CHAR(36) NOT NULL,
  `pts_us` bigint NOT NULL,
  `bbox_x` FLOAT NOT NULL CHECK(bbox_x BETWEEN 0 AND 1),
  `bbox_y` FLOAT NOT NULL CHECK(bbox_y BETWEEN 0 AND 1),
  `bbox_w` FLOAT NOT NULL CHECK(bbox_w>0 AND bbox_w<=1),
  `bbox_h` FLOAT NOT NULL CHECK(bbox_h>0 AND bbox_h<=1),
  `detector_confidence` FLOAT CHECK(detector_confidence BETWEEN 0 AND 1),
  `association_confidence` FLOAT CHECK(association_confidence BETWEEN 0 AND 1),
  `observation_state` VARCHAR(255) NOT NULL CHECK(observation_state IN ('DETECTED','PREDICTED','INTERPOLATED','REVIEWED')),
  `model_version_id` CHAR(36),
  PRIMARY KEY(video_id,frame_index,track_id),
  CHECK(bbox_x+bbox_w<=1.00001),
  CHECK(bbox_y+bbox_h<=1.00001)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `track_identity_candidates` (
  `id` CHAR(36) PRIMARY KEY,
  `track_id` CHAR(36) NOT NULL,
  `player_id` CHAR(36) NOT NULL,
  `match_id` CHAR(36),
  `score` FLOAT NOT NULL CHECK(score BETWEEN 0 AND 1),
  `evidence` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `model_version_id` CHAR(36),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(track_id,player_id,model_version_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `track_identity_decisions` (
  `id` CHAR(36) PRIMARY KEY,
  `track_id` CHAR(36) NOT NULL,
  `player_id` CHAR(36),
  `state` ENUM('UNRESOLVED','CANDIDATE','CONFIRMED','REJECTED','CONFLICT') NOT NULL,
  `decided_by` CHAR(36),
  `basis` VARCHAR(255) NOT NULL CHECK(basis IN('HUMAN','AUTO_POLICY','REGISTRY')),
  `evidence_id` CHAR(36),
  `decided_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `supersedes_id` CHAR(36),
  CHECK(state <> 'CONFIRMED' OR player_id IS NOT NULL),
  CHECK(basis <> 'HUMAN' OR decided_by IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `pitch_calibrations` (
  `id` CHAR(36) PRIMARY KEY,
  `video_id` CHAR(36) NOT NULL,
  `shot_id` CHAR(36),
  `start_pts_us` bigint NOT NULL,
  `end_pts_us` bigint NOT NULL,
  `transform_matrix` JSON NOT NULL,
  `pitch_length_m` FLOAT,
  `pitch_width_m` FLOAT,
  `reprojection_error_px` FLOAT,
  `evidence_state` ENUM('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') NOT NULL DEFAULT 'INFERRED',
  `quality_score` FLOAT CHECK(quality_score BETWEEN 0 AND 1),
  `model_version_id` CHAR(36),
  CHECK(end_pts_us>start_pts_us)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `event_candidates` (
  `id` CHAR(36) PRIMARY KEY,
  `run_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `event_type` VARCHAR(255) NOT NULL,
  `start_pts_us` bigint NOT NULL,
  `end_pts_us` bigint NOT NULL,
  `primary_track_id` CHAR(36),
  `secondary_track_id` CHAR(36),
  `confidence` FLOAT CHECK(confidence BETWEEN 0 AND 1),
  `evidence_state` ENUM('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') NOT NULL DEFAULT 'DETECTED',
  `model_version_id` CHAR(36),
  `evidence_id` CHAR(36),
  `features` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  CHECK(end_pts_us>=start_pts_us)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `event_decisions` (
  `id` CHAR(36) PRIMARY KEY,
  `event_id` CHAR(36) NOT NULL,
  `decision` VARCHAR(255) NOT NULL CHECK(decision IN('CONFIRM','REJECT','EDIT','NEEDS_REVIEW')),
  `reviewer_id` CHAR(36) NOT NULL,
  `revised_start_pts_us` bigint,
  `revised_end_pts_us` bigint,
  `revised_type` VARCHAR(255),
  `reason` TEXT,
  `decided_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `metric_definitions` (
  `key` VARCHAR(255) PRIMARY KEY,
  `unit` VARCHAR(255) NOT NULL,
  `formula_version` VARCHAR(255) NOT NULL,
  `minimum_quality` FLOAT NOT NULL DEFAULT 0 CHECK(minimum_quality BETWEEN 0 AND 1),
  `measurement_class` VARCHAR(255) NOT NULL CHECK(measurement_class IN('PIXEL','PITCH_CALIBRATED','OBSERVED_EVENT','MODEL_ESTIMATE','HUMAN_REVIEW'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `metric_values` (
  `id` CHAR(36) PRIMARY KEY,
  `video_id` CHAR(36) NOT NULL,
  `player_id` CHAR(36),
  `track_id` CHAR(36),
  `metric_key` VARCHAR(255) NOT NULL,
  `value_numeric` DOUBLE,
  `evidence_state` ENUM('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') NOT NULL,
  `evidence_id` CHAR(36),
  `quality_score` FLOAT CHECK(quality_score BETWEEN 0 AND 1),
  `start_pts_us` bigint NOT NULL,
  `end_pts_us` bigint NOT NULL,
  `computed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `model_version_id` CHAR(36),
  CHECK(end_pts_us>=start_pts_us),
  CHECK(evidence_state <> 'NOT_MEASURED' OR value_numeric IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `reel_projects` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `status` VARCHAR(255) NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','READY','RENDERING','PUBLISHED','BLOCKED','ARCHIVED')),
  `version` bigint NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `reel_targets` (
  `reel_id` CHAR(36) NOT NULL,
  `track_id` CHAR(36) NOT NULL,
  `player_id` CHAR(36),
  `identity_decision_id` CHAR(36),
  PRIMARY KEY(reel_id,track_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `reel_clips` (
  `id` CHAR(36) PRIMARY KEY,
  `reel_id` CHAR(36) NOT NULL,
  `source_video_id` CHAR(36) NOT NULL,
  `in_pts_us` bigint NOT NULL CHECK(in_pts_us>=0),
  `out_pts_us` bigint NOT NULL,
  `sequence_index` integer NOT NULL CHECK(sequence_index>=0),
  `output_duration_us` bigint,
  `playback_speed` numeric(6,3) NOT NULL DEFAULT 1 CHECK(playback_speed>0),
  `source_event_id` CHAR(36),
  `review_state` VARCHAR(255) NOT NULL DEFAULT 'PENDING' CHECK(review_state IN('PENDING','APPROVED','REJECTED','RED')),
  CHECK(out_pts_us>in_pts_us),
  UNIQUE(reel_id,sequence_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `effect_presets` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36),
  `name` VARCHAR(255) NOT NULL,
  `version` VARCHAR(255) NOT NULL,
  `schema_version` VARCHAR(255) NOT NULL,
  `config` JSON NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(organization_id,name,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `timeline_tracks` (
  `id` CHAR(36) PRIMARY KEY,
  `reel_id` CHAR(36) NOT NULL,
  `track_type` VARCHAR(255) NOT NULL CHECK(track_type IN('VIDEO','SPOTLIGHT','GRAPHICS','CAPTIONS','STATISTICS','AUDIO','TRANSITION')),
  `layer` integer NOT NULL,
  `muted` BOOLEAN NOT NULL DEFAULT false,
  `locked` BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(reel_id,track_type,layer)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `timeline_items` (
  `id` CHAR(36) PRIMARY KEY,
  `timeline_track_id` CHAR(36) NOT NULL,
  `reel_clip_id` CHAR(36),
  `start_us` bigint NOT NULL CHECK(start_us>=0),
  `duration_us` bigint NOT NULL CHECK(duration_us>0),
  `effect_preset_id` CHAR(36),
  `parameters` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `asset_id` CHAR(36)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `effect_keyframes` (
  `id` CHAR(36) PRIMARY KEY,
  `timeline_item_id` CHAR(36) NOT NULL,
  `time_offset_us` bigint NOT NULL CHECK(time_offset_us>=0),
  `property_name` VARCHAR(255) NOT NULL,
  `value` JSON NOT NULL,
  `interpolation` VARCHAR(255) NOT NULL DEFAULT 'LINEAR' CHECK(interpolation IN('HOLD','LINEAR','EASE_IN_OUT')),
  UNIQUE(timeline_item_id,time_offset_us,property_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `render_jobs` (
  `id` CHAR(36) PRIMARY KEY,
  `reel_id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `requested_by` CHAR(36) NOT NULL,
  `state` ENUM('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') NOT NULL DEFAULT 'QUEUED',
  `config` JSON NOT NULL,
  `manifest_asset_id` CHAR(36),
  `output_asset_id` CHAR(36),
  `idempotency_key` VARCHAR(255) NOT NULL,
  `attempt_count` integer NOT NULL DEFAULT 0,
  `failure_code` VARCHAR(255),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `started_at` DATETIME(6),
  `completed_at` DATETIME(6),
  UNIQUE(organization_id,idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `report_jobs` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36),
  `player_id` CHAR(36),
  `requested_by` CHAR(36) NOT NULL,
  `state` ENUM('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') NOT NULL DEFAULT 'QUEUED',
  `report_type` VARCHAR(255) NOT NULL,
  `config` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `output_asset_id` CHAR(36),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `share_links` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `asset_id` CHAR(36) NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `token_hash` char(64) NOT NULL UNIQUE,
  `expires_at` DATETIME(6),
  `can_download` BOOLEAN NOT NULL DEFAULT false,
  `can_comment` BOOLEAN NOT NULL DEFAULT false,
  `revoked_at` DATETIME(6),
  `password_hash` VARCHAR(255),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `deliveries` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `asset_id` CHAR(36) NOT NULL,
  `requested_by` CHAR(36) NOT NULL,
  `destination_type` VARCHAR(255) NOT NULL CHECK(destination_type IN('SIGNED_URL','EMAIL_INVITE','INTERNAL')),
  `destination_ref` VARCHAR(255),
  `state` ENUM('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') NOT NULL DEFAULT 'QUEUED',
  `rights_checked_at` DATETIME(6),
  `delivered_at` DATETIME(6),
  `failure_code` VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `comments` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `project_id` CHAR(36),
  `reel_id` CHAR(36),
  `author_id` CHAR(36) NOT NULL,
  `body` VARCHAR(255) NOT NULL,
  `at_pts_us` bigint,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `outbox_events` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `aggregate_type` VARCHAR(255) NOT NULL,
  `aggregate_id` CHAR(36) NOT NULL,
  `event_type` VARCHAR(255) NOT NULL,
  `event_payload` JSON NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `claimed_at` DATETIME(6),
  `delivered_at` DATETIME(6),
  `attempt_count` integer NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `upload_sessions` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `idempotency_key` VARCHAR(255) NOT NULL,
  `multipart_upload_id` VARCHAR(255),
  `expected_bytes` bigint NOT NULL CHECK(expected_bytes>0),
  `expected_sha256` char(64),
  `transferred_bytes` bigint NOT NULL DEFAULT 0 CHECK(transferred_bytes>=0),
  `status` VARCHAR(255) NOT NULL DEFAULT 'INITIALIZED' CHECK(status IN('INITIALIZED','UPLOADING','VERIFYING','COMPLETED','ABORTED','EXPIRED','FAILED')),
  `expires_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(organization_id,idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `upload_parts` (
  `session_id` CHAR(36) NOT NULL,
  `part_number` integer NOT NULL CHECK(part_number>0),
  `byte_size` bigint NOT NULL CHECK(byte_size>0),
  `remote_etag` VARCHAR(255) NOT NULL,
  `checked_at` DATETIME(6),
  PRIMARY KEY(session_id,part_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `project_acl` (
  `project_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `permission` VARCHAR(255) NOT NULL CHECK(permission IN ('READ','EDIT','REVIEW','ADMIN')),
  `granted_by` CHAR(36) NOT NULL,
  `granted_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(project_id,user_id,permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `metric_cohorts` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36),
  `name` VARCHAR(255) NOT NULL,
  `version` VARCHAR(255) NOT NULL,
  `definition` JSON NOT NULL,
  `sample_count` integer CHECK(sample_count>=0),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `saved_searches` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `query` JSON NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(organization_id,user_id,name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `clip_reviews` (
  `id` CHAR(36) PRIMARY KEY,
  `reel_clip_id` CHAR(36) NOT NULL,
  `reviewer_id` CHAR(36) NOT NULL,
  `decision` VARCHAR(255) NOT NULL CHECK(decision IN('APPROVED','REJECTED','RED','NEEDS_REVIEW')),
  `evidence_id` CHAR(36),
  `reason` TEXT,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `policy_decisions` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `action` VARCHAR(255) NOT NULL CHECK(action IN('ANALYZE','PRODUCE','EXPORT','VIEW','DOWNLOAD','SHARE','DELIVER')),
  `resource_type` VARCHAR(255) NOT NULL,
  `resource_id` CHAR(36) NOT NULL,
  `actor_id` CHAR(36),
  `decision` VARCHAR(255) NOT NULL CHECK(decision IN('ALLOW','DENY','REVIEW')),
  `rule_version` VARCHAR(255) NOT NULL,
  `grant_ids` JSON NOT NULL DEFAULT (JSON_ARRAY()),  -- C-SQL-02: was a PostgreSQL CHAR(36) array
  `dependency_asset_ids` JSON NOT NULL DEFAULT (JSON_ARRAY()),  -- C-SQL-02: was a PostgreSQL CHAR(36) array
  `reason_codes` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  `checked_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `artifact_dependencies` (
  `artifact_asset_id` CHAR(36) NOT NULL,
  `depends_on_asset_id` CHAR(36) NOT NULL,
  `dependency_type` VARCHAR(255) NOT NULL CHECK(dependency_type IN('SOURCE_VIDEO','AUDIO','FONT','LOGO','TRACKS','MODEL','METADATA','OTHER')),
  PRIMARY KEY(artifact_asset_id,depends_on_asset_id,dependency_type),
  CHECK(artifact_asset_id<>depends_on_asset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `share_link_access` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `share_link_id` CHAR(36) NOT NULL,
  `actor_id` CHAR(36),
  `action` VARCHAR(255) NOT NULL,
  `decision` VARCHAR(255) NOT NULL CHECK(decision IN('ALLOW','DENY')),
  `accessed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `ip_hash` char(64)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `model_evaluations` (
  `id` CHAR(36) PRIMARY KEY,
  `model_version_id` CHAR(36) NOT NULL,
  `dataset_name` VARCHAR(255) NOT NULL,
  `dataset_sha256` char(64) NOT NULL,
  `annotation_version` VARCHAR(255) NOT NULL,
  `metrics` JSON NOT NULL,
  `signed_off_by` CHAR(36),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `plans` (
  `id` CHAR(36) PRIMARY KEY,
  `code` VARCHAR(255) NOT NULL UNIQUE,
  `name` VARCHAR(255) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `plan_versions` (
  `id` CHAR(36) PRIMARY KEY,
  `plan_id` CHAR(36) NOT NULL,
  `version` integer NOT NULL CHECK(version>0),
  `effective_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `feature_limits` JSON NOT NULL,
  `currency` VARCHAR(255),
  `is_published` BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(plan_id,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `plan_prices` (
  `id` CHAR(36) PRIMARY KEY,
  `plan_version_id` CHAR(36) NOT NULL,
  `provider` VARCHAR(255) NOT NULL,
  `external_price_id` VARCHAR(255) NOT NULL UNIQUE,
  `billing_period` VARCHAR(255) NOT NULL CHECK(billing_period IN('MONTHLY','YEARLY','CUSTOM')),
  `currency` char(3) NOT NULL,
  `unit_amount_minor` bigint NOT NULL CHECK(unit_amount_minor>=0),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `billing_customers` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL UNIQUE,
  `provider` VARCHAR(255) NOT NULL,
  `provider_customer_id` VARCHAR(255) NOT NULL UNIQUE,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `subscriptions` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `plan_version_id` CHAR(36) NOT NULL,
  `provider_subscription_id` VARCHAR(255) UNIQUE,
  `state` ENUM('TRIALING','ACTIVE','PAST_DUE','CANCELED','UNPAID','INCOMPLETE') NOT NULL,
  `period_start` DATETIME(6),
  `period_end` DATETIME(6),
  `trial_end` DATETIME(6),
  `cancel_at_period_end` BOOLEAN NOT NULL DEFAULT false,
  `version` bigint NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CHECK(period_end IS NULL OR period_start IS NULL OR period_end>period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `billing_webhook_inbox` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `provider` VARCHAR(255) NOT NULL,
  `external_event_id` VARCHAR(255) NOT NULL,
  `signature_verified` BOOLEAN NOT NULL DEFAULT false,
  `event_kind` VARCHAR(255) NOT NULL,
  `payload_sha256` char(64) NOT NULL,
  `received_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `processed_at` DATETIME(6),
  `error_code` VARCHAR(255),
  UNIQUE(provider,external_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `invoices` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `provider_invoice_id` VARCHAR(255) UNIQUE,
  `subscription_id` CHAR(36),
  `amount_due_minor` bigint NOT NULL CHECK(amount_due_minor>=0),
  `currency` char(3) NOT NULL,
  `invoice_state` VARCHAR(255) NOT NULL,
  `occurred_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `entitlement_grants` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `source_subscription_id` CHAR(36),
  `feature_key` VARCHAR(255) NOT NULL,
  `limit_value` bigint,
  `valid_from` DATETIME(6) NOT NULL,
  `valid_until` DATETIME(6),
  CHECK(valid_until IS NULL OR valid_until>valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `quota_counters` (
  `organization_id` CHAR(36) NOT NULL,
  `feature_key` VARCHAR(255) NOT NULL,
  `window_start` DATETIME(6) NOT NULL,
  `used_amount` bigint NOT NULL DEFAULT 0 CHECK(used_amount>=0),
  `reserved_amount` bigint NOT NULL DEFAULT 0 CHECK(reserved_amount>=0),
  PRIMARY KEY(organization_id,feature_key,window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `quota_reservations` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `feature_key` VARCHAR(255) NOT NULL,
  `window_start` DATETIME(6) NOT NULL,
  `quantity` bigint NOT NULL CHECK(quantity>0),
  `status` VARCHAR(255) NOT NULL CHECK(status IN('RESERVED','COMMITTED','RELEASED')),
  `idempotency_key` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(organization_id,feature_key,idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `usage_events` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `reservation_id` CHAR(36),
  `event_key` VARCHAR(255) NOT NULL UNIQUE,
  `quantity` bigint NOT NULL CHECK(quantity>=0),
  `unit` VARCHAR(255) NOT NULL,
  `occurred_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `security_events` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `organization_id` CHAR(36),
  `actor_id` CHAR(36),
  `ip_hash` char(64),
  `event_kind` VARCHAR(255) NOT NULL,
  `outcome` VARCHAR(255) NOT NULL,
  `occurred_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `admin_actions` (
  `id` CHAR(36) PRIMARY KEY,
  `actor_id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36),
  `action` VARCHAR(255) NOT NULL,
  `justification` TEXT NOT NULL,
  `approved_by` CHAR(36),
  `resulting_audit_event_id` BIGINT UNSIGNED,  -- C-SQL-03: was signed bigint
  `occurred_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `model_evaluation_sets` (
  `id` CHAR(36) PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL UNIQUE,
  `dataset_sha256` char(64) NOT NULL,
  `license_note` TEXT NOT NULL,
  `manifest_object_key` VARCHAR(255) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `model_evaluation_runs` (
  `id` CHAR(36) PRIMARY KEY,
  `model_version_id` CHAR(36) NOT NULL,
  `evaluation_set_id` CHAR(36) NOT NULL,
  `summary_metrics` JSON NOT NULL,
  `acceptance_state` VARCHAR(255) NOT NULL CHECK(acceptance_state IN('PENDING','PASSED','FAILED')),
  `reviewed_by` CHAR(36),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `release_signoffs` (
  `id` CHAR(36) PRIMARY KEY,
  `build_sha` char(40) NOT NULL,
  `gate_code` VARCHAR(255) NOT NULL,
  `state` VARCHAR(255) NOT NULL CHECK(state IN('PENDING','PASS','FAIL','WAIVED')),
  `signed_by` CHAR(36),
  `evidence_object_key` VARCHAR(255),
  `signed_at` DATETIME(6),
  UNIQUE(build_sha,gate_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `camera_transforms` (
  `id` CHAR(36) PRIMARY KEY,
  `video_id` CHAR(36) NOT NULL,
  `shot_id` CHAR(36) NOT NULL,
  `from_pts_us` bigint NOT NULL,
  `to_pts_us` bigint NOT NULL,
  `transform` JSON NOT NULL,
  `reprojection_error_px` numeric(12,4),
  CHECK(to_pts_us>from_pts_us)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `track_gaps` (
  `id` CHAR(36) PRIMARY KEY,
  `video_id` CHAR(36) NOT NULL,
  `track_id` CHAR(36) NOT NULL,
  `start_pts_us` bigint NOT NULL,
  `end_pts_us` bigint NOT NULL,
  `gap_reason` VARCHAR(255) NOT NULL CHECK(gap_reason IN('OCCLUDED','OUT_OF_FRAME','CAMERA_CUT','DETECTION_FAILURE','UNKNOWN')),
  CHECK(end_pts_us>start_pts_us)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `presence_intervals` (
  `id` CHAR(36) PRIMARY KEY,
  `video_id` CHAR(36) NOT NULL,
  `track_id` CHAR(36) NOT NULL,
  `start_pts_us` bigint NOT NULL,
  `end_pts_us` bigint NOT NULL,
  `observation_count` integer NOT NULL CHECK(observation_count>=1),
  CHECK(end_pts_us>start_pts_us)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `possession_episodes` (
  `id` CHAR(36) PRIMARY KEY,
  `video_id` CHAR(36) NOT NULL,
  `run_id` CHAR(36) NOT NULL,
  `player_id` CHAR(36),
  `start_pts_us` bigint NOT NULL,
  `end_pts_us` bigint NOT NULL,
  `confidence` numeric(5,4) CHECK(confidence BETWEEN 0 AND 1),
  `evidence_id` CHAR(36),
  CHECK(end_pts_us>start_pts_us)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tactical_windows` (
  `id` CHAR(36) PRIMARY KEY,
  `video_id` CHAR(36) NOT NULL,
  `run_id` CHAR(36) NOT NULL,
  `from_pts_us` bigint NOT NULL,
  `to_pts_us` bigint NOT NULL,
  `kind` VARCHAR(255) NOT NULL,
  `coverage_ratio` numeric(5,4) NOT NULL CHECK(coverage_ratio BETWEEN 0 AND 1),
  `metrics` JSON NOT NULL,
  `evidence_state` ENUM('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') NOT NULL,
  `evidence_id` CHAR(36),
  CHECK(to_pts_us>from_pts_us)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `movement_segments` (
  `id` CHAR(36) PRIMARY KEY,
  `video_id` CHAR(36) NOT NULL,
  `track_id` CHAR(36) NOT NULL,
  `player_id` CHAR(36),
  `start_pts_us` bigint NOT NULL,
  `end_pts_us` bigint NOT NULL,
  `movement_kind` VARCHAR(255) NOT NULL,
  `geometry_object_key` VARCHAR(255),
  `confidence` numeric(5,4) CHECK(confidence BETWEEN 0 AND 1),
  `evidence_state` ENUM('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') NOT NULL,
  CHECK(end_pts_us>start_pts_us)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `identity_review_history` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `track_id` CHAR(36) NOT NULL,
  `previous_decision_id` CHAR(36),
  `new_decision_id` CHAR(36),
  `reviewer_id` CHAR(36) NOT NULL,
  `decision` VARCHAR(255) NOT NULL CHECK(decision IN('CONFIRM','REJECT','SPLIT','MERGE','UNRESOLVE')),
  `notes` TEXT,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `artifact_checks` (
  `id` CHAR(36) PRIMARY KEY,
  `artifact_id` CHAR(36) NOT NULL,
  `check_kind` VARCHAR(255) NOT NULL,
  `passed` BOOLEAN NOT NULL,
  `measurements` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `checked_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `reel_manifest_versions` (
  `id` CHAR(36) PRIMARY KEY,
  `reel_project_id` CHAR(36) NOT NULL,
  `version` bigint NOT NULL CHECK(version>0),
  `manifest` JSON NOT NULL,
  `manifest_sha256` char(64) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(reel_project_id,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `processing_dead_letters` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `workflow_id` VARCHAR(255) NOT NULL,
  `job_kind` VARCHAR(255) NOT NULL,
  `error_code` VARCHAR(255) NOT NULL,
  `attempt_count` integer NOT NULL,
  `payload_object_key` TEXT NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `resolved_at` DATETIME(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `retention_jobs` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `subject_type` VARCHAR(255) NOT NULL,
  `subject_id` CHAR(36) NOT NULL,
  `requested_by` CHAR(36),
  `legal_hold` BOOLEAN NOT NULL DEFAULT false,
  `status` VARCHAR(255) NOT NULL CHECK(status IN('QUEUED','RUNNING','DONE','BLOCKED','FAILED')),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `finished_at` DATETIME(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- DEFERRED FOREIGN KEYS
ALTER TABLE `memberships` ADD CONSTRAINT `fk_memberships_0` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `memberships` ADD CONSTRAINT `fk_memberships_1` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `projects` ADD CONSTRAINT `fk_projects_2` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `projects` ADD CONSTRAINT `fk_projects_3` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `matches` ADD CONSTRAINT `fk_matches_4` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `matches` ADD CONSTRAINT `fk_matches_5` FOREIGN KEY (`home_club_id`) REFERENCES `clubs`(`id`);
ALTER TABLE `matches` ADD CONSTRAINT `fk_matches_6` FOREIGN KEY (`away_club_id`) REFERENCES `clubs`(`id`);
ALTER TABLE `match_rosters` ADD CONSTRAINT `fk_match_rosters_7` FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON DELETE CASCADE;
ALTER TABLE `match_rosters` ADD CONSTRAINT `fk_match_rosters_8` FOREIGN KEY (`player_id`) REFERENCES `players`(`id`);
ALTER TABLE `match_rosters` ADD CONSTRAINT `fk_match_rosters_9` FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`);
ALTER TABLE `assets` ADD CONSTRAINT `fk_assets_10` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `assets` ADD CONSTRAINT `fk_assets_11` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`);
ALTER TABLE `assets` ADD CONSTRAINT `fk_assets_12` FOREIGN KEY (`source_asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `assets` ADD CONSTRAINT `fk_assets_13` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `video_sources` ADD CONSTRAINT `fk_video_sources_14` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `video_sources` ADD CONSTRAINT `fk_video_sources_15` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`);
ALTER TABLE `video_sources` ADD CONSTRAINT `fk_video_sources_16` FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`);
ALTER TABLE `video_sources` ADD CONSTRAINT `fk_video_sources_17` FOREIGN KEY (`source_asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `video_sources` ADD CONSTRAINT `fk_video_sources_18` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `video_shots` ADD CONSTRAINT `fk_video_shots_19` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`) ON DELETE CASCADE;
ALTER TABLE `pipeline_runs` ADD CONSTRAINT `fk_pipeline_runs_20` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `pipeline_runs` ADD CONSTRAINT `fk_pipeline_runs_21` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `pipeline_steps` ADD CONSTRAINT `fk_pipeline_steps_22` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON DELETE CASCADE;
ALTER TABLE `pipeline_steps` ADD CONSTRAINT `fk_pipeline_steps_23` FOREIGN KEY (`output_asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `pipeline_steps` ADD CONSTRAINT `fk_pipeline_steps_24` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`);
ALTER TABLE `job_events` ADD CONSTRAINT `fk_job_events_25` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON DELETE CASCADE;
ALTER TABLE `job_events` ADD CONSTRAINT `fk_job_events_26` FOREIGN KEY (`step_id`) REFERENCES `pipeline_steps`(`id`);
ALTER TABLE `evidence_records` ADD CONSTRAINT `fk_evidence_records_27` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `evidence_records` ADD CONSTRAINT `fk_evidence_records_28` FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`);
ALTER TABLE `evidence_records` ADD CONSTRAINT `fk_evidence_records_29` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`);
ALTER TABLE `evidence_records` ADD CONSTRAINT `fk_evidence_records_30` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`);
ALTER TABLE `rights_grants` ADD CONSTRAINT `fk_rights_grants_31` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `rights_grants` ADD CONSTRAINT `fk_rights_grants_32` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `rights_grants` ADD CONSTRAINT `fk_rights_grants_33` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `rights_grants` ADD CONSTRAINT `fk_rights_grants_34` FOREIGN KEY (`evidence_asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `audit_events` ADD CONSTRAINT `fk_audit_events_35` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `audit_events` ADD CONSTRAINT `fk_audit_events_36` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`);
ALTER TABLE `video_frame_index` ADD CONSTRAINT `fk_video_frame_index_37` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`) ON DELETE CASCADE;
ALTER TABLE `video_frame_index` ADD CONSTRAINT `fk_video_frame_index_38` FOREIGN KEY (`shot_id`) REFERENCES `video_shots`(`id`);
ALTER TABLE `detection_batches` ADD CONSTRAINT `fk_detection_batches_39` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`);
ALTER TABLE `detection_batches` ADD CONSTRAINT `fk_detection_batches_40` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`);
ALTER TABLE `detection_batches` ADD CONSTRAINT `fk_detection_batches_41` FOREIGN KEY (`payload_asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `tracks` ADD CONSTRAINT `fk_tracks_42` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`);
ALTER TABLE `tracks` ADD CONSTRAINT `fk_tracks_43` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `track_segments` ADD CONSTRAINT `fk_track_segments_44` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE;
ALTER TABLE `track_segments` ADD CONSTRAINT `fk_track_segments_45` FOREIGN KEY (`shot_id`) REFERENCES `video_shots`(`id`);
ALTER TABLE `track_segments` ADD CONSTRAINT `fk_track_segments_46` FOREIGN KEY (`observation_asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `track_observations` ADD CONSTRAINT `fk_track_observations_47` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `track_observations` ADD CONSTRAINT `fk_track_observations_48` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE;
ALTER TABLE `track_observations` ADD CONSTRAINT `fk_track_observations_49` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`);
ALTER TABLE `track_observations` ADD CONSTRAINT `fk_track_observations_50` FOREIGN KEY(video_id,frame_index) REFERENCES video_frame_index(video_id,frame_index);
ALTER TABLE `track_identity_candidates` ADD CONSTRAINT `fk_track_identity_candidates_51` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON DELETE CASCADE;
ALTER TABLE `track_identity_candidates` ADD CONSTRAINT `fk_track_identity_candidates_52` FOREIGN KEY (`player_id`) REFERENCES `players`(`id`);
ALTER TABLE `track_identity_candidates` ADD CONSTRAINT `fk_track_identity_candidates_53` FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`);
ALTER TABLE `track_identity_candidates` ADD CONSTRAINT `fk_track_identity_candidates_54` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`);
ALTER TABLE `track_identity_decisions` ADD CONSTRAINT `fk_track_identity_decisions_55` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`);
ALTER TABLE `track_identity_decisions` ADD CONSTRAINT `fk_track_identity_decisions_56` FOREIGN KEY (`player_id`) REFERENCES `players`(`id`);
ALTER TABLE `track_identity_decisions` ADD CONSTRAINT `fk_track_identity_decisions_57` FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`);
ALTER TABLE `track_identity_decisions` ADD CONSTRAINT `fk_track_identity_decisions_58` FOREIGN KEY (`evidence_id`) REFERENCES `evidence_records`(`id`);
ALTER TABLE `track_identity_decisions` ADD CONSTRAINT `fk_track_identity_decisions_59` FOREIGN KEY (`supersedes_id`) REFERENCES `track_identity_decisions`(`id`);
ALTER TABLE `pitch_calibrations` ADD CONSTRAINT `fk_pitch_calibrations_60` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `pitch_calibrations` ADD CONSTRAINT `fk_pitch_calibrations_61` FOREIGN KEY (`shot_id`) REFERENCES `video_shots`(`id`);
ALTER TABLE `pitch_calibrations` ADD CONSTRAINT `fk_pitch_calibrations_62` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`);
ALTER TABLE `event_candidates` ADD CONSTRAINT `fk_event_candidates_63` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`);
ALTER TABLE `event_candidates` ADD CONSTRAINT `fk_event_candidates_64` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `event_candidates` ADD CONSTRAINT `fk_event_candidates_65` FOREIGN KEY (`primary_track_id`) REFERENCES `tracks`(`id`);
ALTER TABLE `event_candidates` ADD CONSTRAINT `fk_event_candidates_66` FOREIGN KEY (`secondary_track_id`) REFERENCES `tracks`(`id`);
ALTER TABLE `event_candidates` ADD CONSTRAINT `fk_event_candidates_67` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`);
ALTER TABLE `event_candidates` ADD CONSTRAINT `fk_event_candidates_68` FOREIGN KEY (`evidence_id`) REFERENCES `evidence_records`(`id`);
ALTER TABLE `event_decisions` ADD CONSTRAINT `fk_event_decisions_69` FOREIGN KEY (`event_id`) REFERENCES `event_candidates`(`id`);
ALTER TABLE `event_decisions` ADD CONSTRAINT `fk_event_decisions_70` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`);
ALTER TABLE `metric_values` ADD CONSTRAINT `fk_metric_values_71` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `metric_values` ADD CONSTRAINT `fk_metric_values_72` FOREIGN KEY (`player_id`) REFERENCES `players`(`id`);
ALTER TABLE `metric_values` ADD CONSTRAINT `fk_metric_values_73` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`);
ALTER TABLE `metric_values` ADD CONSTRAINT `fk_metric_values_74` FOREIGN KEY (`metric_key`) REFERENCES `metric_definitions`(`key`);
ALTER TABLE `metric_values` ADD CONSTRAINT `fk_metric_values_75` FOREIGN KEY (`evidence_id`) REFERENCES `evidence_records`(`id`);
ALTER TABLE `metric_values` ADD CONSTRAINT `fk_metric_values_76` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`);
ALTER TABLE `reel_projects` ADD CONSTRAINT `fk_reel_projects_77` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `reel_projects` ADD CONSTRAINT `fk_reel_projects_78` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`);
ALTER TABLE `reel_projects` ADD CONSTRAINT `fk_reel_projects_79` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `reel_projects` ADD CONSTRAINT `fk_reel_projects_80` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `reel_targets` ADD CONSTRAINT `fk_reel_targets_81` FOREIGN KEY (`reel_id`) REFERENCES `reel_projects`(`id`) ON DELETE CASCADE;
ALTER TABLE `reel_targets` ADD CONSTRAINT `fk_reel_targets_82` FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`);
ALTER TABLE `reel_targets` ADD CONSTRAINT `fk_reel_targets_83` FOREIGN KEY (`player_id`) REFERENCES `players`(`id`);
ALTER TABLE `reel_targets` ADD CONSTRAINT `fk_reel_targets_84` FOREIGN KEY (`identity_decision_id`) REFERENCES `track_identity_decisions`(`id`);
ALTER TABLE `reel_clips` ADD CONSTRAINT `fk_reel_clips_85` FOREIGN KEY (`reel_id`) REFERENCES `reel_projects`(`id`) ON DELETE CASCADE;
ALTER TABLE `reel_clips` ADD CONSTRAINT `fk_reel_clips_86` FOREIGN KEY (`source_video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `reel_clips` ADD CONSTRAINT `fk_reel_clips_87` FOREIGN KEY (`source_event_id`) REFERENCES `event_candidates`(`id`);
ALTER TABLE `effect_presets` ADD CONSTRAINT `fk_effect_presets_88` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `timeline_tracks` ADD CONSTRAINT `fk_timeline_tracks_89` FOREIGN KEY (`reel_id`) REFERENCES `reel_projects`(`id`) ON DELETE CASCADE;
ALTER TABLE `timeline_items` ADD CONSTRAINT `fk_timeline_items_90` FOREIGN KEY (`timeline_track_id`) REFERENCES `timeline_tracks`(`id`) ON DELETE CASCADE;
ALTER TABLE `timeline_items` ADD CONSTRAINT `fk_timeline_items_91` FOREIGN KEY (`reel_clip_id`) REFERENCES `reel_clips`(`id`);
ALTER TABLE `timeline_items` ADD CONSTRAINT `fk_timeline_items_92` FOREIGN KEY (`effect_preset_id`) REFERENCES `effect_presets`(`id`);
ALTER TABLE `timeline_items` ADD CONSTRAINT `fk_timeline_items_93` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `effect_keyframes` ADD CONSTRAINT `fk_effect_keyframes_94` FOREIGN KEY (`timeline_item_id`) REFERENCES `timeline_items`(`id`) ON DELETE CASCADE;
ALTER TABLE `render_jobs` ADD CONSTRAINT `fk_render_jobs_95` FOREIGN KEY (`reel_id`) REFERENCES `reel_projects`(`id`);
ALTER TABLE `render_jobs` ADD CONSTRAINT `fk_render_jobs_96` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `render_jobs` ADD CONSTRAINT `fk_render_jobs_97` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`);
ALTER TABLE `render_jobs` ADD CONSTRAINT `fk_render_jobs_98` FOREIGN KEY (`manifest_asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `render_jobs` ADD CONSTRAINT `fk_render_jobs_99` FOREIGN KEY (`output_asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `report_jobs` ADD CONSTRAINT `fk_report_jobs_100` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `report_jobs` ADD CONSTRAINT `fk_report_jobs_101` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`);
ALTER TABLE `report_jobs` ADD CONSTRAINT `fk_report_jobs_102` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `report_jobs` ADD CONSTRAINT `fk_report_jobs_103` FOREIGN KEY (`player_id`) REFERENCES `players`(`id`);
ALTER TABLE `report_jobs` ADD CONSTRAINT `fk_report_jobs_104` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`);
ALTER TABLE `report_jobs` ADD CONSTRAINT `fk_report_jobs_105` FOREIGN KEY (`output_asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `share_links` ADD CONSTRAINT `fk_share_links_106` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `share_links` ADD CONSTRAINT `fk_share_links_107` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `share_links` ADD CONSTRAINT `fk_share_links_108` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `deliveries` ADD CONSTRAINT `fk_deliveries_109` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `deliveries` ADD CONSTRAINT `fk_deliveries_110` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `deliveries` ADD CONSTRAINT `fk_deliveries_111` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`);
ALTER TABLE `comments` ADD CONSTRAINT `fk_comments_112` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `comments` ADD CONSTRAINT `fk_comments_113` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`);
ALTER TABLE `comments` ADD CONSTRAINT `fk_comments_114` FOREIGN KEY (`reel_id`) REFERENCES `reel_projects`(`id`);
ALTER TABLE `comments` ADD CONSTRAINT `fk_comments_115` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`);
ALTER TABLE `upload_sessions` ADD CONSTRAINT `fk_upload_sessions_116` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `upload_sessions` ADD CONSTRAINT `fk_upload_sessions_117` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `upload_sessions` ADD CONSTRAINT `fk_upload_sessions_118` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`);
ALTER TABLE `upload_parts` ADD CONSTRAINT `fk_upload_parts_119` FOREIGN KEY (`session_id`) REFERENCES `upload_sessions`(`id`) ON DELETE CASCADE;
ALTER TABLE `project_acl` ADD CONSTRAINT `fk_project_acl_120` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`);
ALTER TABLE `project_acl` ADD CONSTRAINT `fk_project_acl_121` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `project_acl` ADD CONSTRAINT `fk_project_acl_122` FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`);
ALTER TABLE `metric_cohorts` ADD CONSTRAINT `fk_metric_cohorts_123` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `saved_searches` ADD CONSTRAINT `fk_saved_searches_124` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `saved_searches` ADD CONSTRAINT `fk_saved_searches_125` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`);
ALTER TABLE `clip_reviews` ADD CONSTRAINT `fk_clip_reviews_126` FOREIGN KEY (`reel_clip_id`) REFERENCES `reel_clips`(`id`);
ALTER TABLE `clip_reviews` ADD CONSTRAINT `fk_clip_reviews_127` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`);
ALTER TABLE `clip_reviews` ADD CONSTRAINT `fk_clip_reviews_128` FOREIGN KEY (`evidence_id`) REFERENCES `evidence_records`(`id`);
ALTER TABLE `policy_decisions` ADD CONSTRAINT `fk_policy_decisions_129` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `policy_decisions` ADD CONSTRAINT `fk_policy_decisions_130` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`);
ALTER TABLE `artifact_dependencies` ADD CONSTRAINT `fk_artifact_dependencies_131` FOREIGN KEY (`artifact_asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `artifact_dependencies` ADD CONSTRAINT `fk_artifact_dependencies_132` FOREIGN KEY (`depends_on_asset_id`) REFERENCES `assets`(`id`);
ALTER TABLE `share_link_access` ADD CONSTRAINT `fk_share_link_access_133` FOREIGN KEY (`share_link_id`) REFERENCES `share_links`(`id`);
ALTER TABLE `share_link_access` ADD CONSTRAINT `fk_share_link_access_134` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`);
ALTER TABLE `model_evaluations` ADD CONSTRAINT `fk_model_evaluations_135` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`);
ALTER TABLE `model_evaluations` ADD CONSTRAINT `fk_model_evaluations_136` FOREIGN KEY (`signed_off_by`) REFERENCES `users`(`id`);
ALTER TABLE `plan_versions` ADD CONSTRAINT `fk_plan_versions_137` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`);
ALTER TABLE `plan_prices` ADD CONSTRAINT `fk_plan_prices_138` FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions`(`id`);
ALTER TABLE `billing_customers` ADD CONSTRAINT `fk_billing_customers_139` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `subscriptions` ADD CONSTRAINT `fk_subscriptions_140` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `subscriptions` ADD CONSTRAINT `fk_subscriptions_141` FOREIGN KEY (`plan_version_id`) REFERENCES `plan_versions`(`id`);
ALTER TABLE `invoices` ADD CONSTRAINT `fk_invoices_142` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `invoices` ADD CONSTRAINT `fk_invoices_143` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`);
ALTER TABLE `entitlement_grants` ADD CONSTRAINT `fk_entitlement_grants_144` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `entitlement_grants` ADD CONSTRAINT `fk_entitlement_grants_145` FOREIGN KEY (`source_subscription_id`) REFERENCES `subscriptions`(`id`);
ALTER TABLE `quota_counters` ADD CONSTRAINT `fk_quota_counters_146` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `quota_reservations` ADD CONSTRAINT `fk_quota_reservations_147` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `quota_reservations` ADD CONSTRAINT `fk_quota_reservations_148` FOREIGN KEY (organization_id,feature_key,window_start) REFERENCES quota_counters(organization_id,feature_key,window_start);
ALTER TABLE `usage_events` ADD CONSTRAINT `fk_usage_events_149` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `usage_events` ADD CONSTRAINT `fk_usage_events_150` FOREIGN KEY (`reservation_id`) REFERENCES `quota_reservations`(`id`);
ALTER TABLE `security_events` ADD CONSTRAINT `fk_security_events_151` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `security_events` ADD CONSTRAINT `fk_security_events_152` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`);
ALTER TABLE `admin_actions` ADD CONSTRAINT `fk_admin_actions_153` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`);
ALTER TABLE `admin_actions` ADD CONSTRAINT `fk_admin_actions_154` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `admin_actions` ADD CONSTRAINT `fk_admin_actions_155` FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`);
ALTER TABLE `admin_actions` ADD CONSTRAINT `fk_admin_actions_156` FOREIGN KEY (`resulting_audit_event_id`) REFERENCES `audit_events`(`id`);
ALTER TABLE `model_evaluation_runs` ADD CONSTRAINT `fk_model_evaluation_runs_157` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`);
ALTER TABLE `model_evaluation_runs` ADD CONSTRAINT `fk_model_evaluation_runs_158` FOREIGN KEY (`evaluation_set_id`) REFERENCES `model_evaluation_sets`(`id`);
ALTER TABLE `model_evaluation_runs` ADD CONSTRAINT `fk_model_evaluation_runs_159` FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`);
ALTER TABLE `release_signoffs` ADD CONSTRAINT `fk_release_signoffs_160` FOREIGN KEY (`signed_by`) REFERENCES `users`(`id`);
ALTER TABLE `camera_transforms` ADD CONSTRAINT `fk_camera_transforms_161` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `camera_transforms` ADD CONSTRAINT `fk_camera_transforms_162` FOREIGN KEY (`shot_id`) REFERENCES `video_shots`(`id`);
ALTER TABLE `track_gaps` ADD CONSTRAINT `fk_track_gaps_163` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `presence_intervals` ADD CONSTRAINT `fk_presence_intervals_164` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `possession_episodes` ADD CONSTRAINT `fk_possession_episodes_165` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `possession_episodes` ADD CONSTRAINT `fk_possession_episodes_166` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`);
ALTER TABLE `possession_episodes` ADD CONSTRAINT `fk_possession_episodes_167` FOREIGN KEY (`player_id`) REFERENCES `players`(`id`);
ALTER TABLE `possession_episodes` ADD CONSTRAINT `fk_possession_episodes_168` FOREIGN KEY (`evidence_id`) REFERENCES `evidence_records`(`id`);
ALTER TABLE `tactical_windows` ADD CONSTRAINT `fk_tactical_windows_169` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `tactical_windows` ADD CONSTRAINT `fk_tactical_windows_170` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`);
ALTER TABLE `tactical_windows` ADD CONSTRAINT `fk_tactical_windows_171` FOREIGN KEY (`evidence_id`) REFERENCES `evidence_records`(`id`);
ALTER TABLE `movement_segments` ADD CONSTRAINT `fk_movement_segments_172` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `movement_segments` ADD CONSTRAINT `fk_movement_segments_173` FOREIGN KEY (`player_id`) REFERENCES `players`(`id`);
ALTER TABLE `identity_review_history` ADD CONSTRAINT `fk_identity_review_history_174` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `identity_review_history` ADD CONSTRAINT `fk_identity_review_history_175` FOREIGN KEY (`video_id`) REFERENCES `video_sources`(`id`);
ALTER TABLE `identity_review_history` ADD CONSTRAINT `fk_identity_review_history_176` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`);
ALTER TABLE `artifact_checks` ADD CONSTRAINT `fk_artifact_checks_177` FOREIGN KEY (`artifact_id`) REFERENCES `assets`(`id`);
ALTER TABLE `processing_dead_letters` ADD CONSTRAINT `fk_processing_dead_letters_178` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `retention_jobs` ADD CONSTRAINT `fk_retention_jobs_179` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`);
ALTER TABLE `retention_jobs` ADD CONSTRAINT `fk_retention_jobs_180` FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`);

-- SECONDARY INDEXES
CREATE INDEX `idx_assets_org_project` ON `assets`(organization_id,project_id,created_at DESC);
CREATE INDEX `idx_videos_org_project` ON `video_sources`(organization_id,project_id,created_at DESC);
CREATE INDEX `idx_pipeline_video_created` ON `pipeline_runs`(video_id,created_at DESC);
CREATE INDEX `idx_job_events_run_id` ON `job_events`(run_id,id);
CREATE INDEX `idx_audit_org_time` ON `audit_events`(organization_id,occurred_at DESC);
CREATE INDEX `idx_track_obs_track_time` ON `track_observations`(track_id,pts_us);
CREATE INDEX `idx_id_decisions_track_recent` ON `track_identity_decisions`(track_id,decided_at DESC);
CREATE INDEX `idx_events_video_t` ON `event_candidates`(video_id,start_pts_us);
CREATE INDEX `idx_metrics_player_video` ON `metric_values`(player_id,video_id,metric_key);
CREATE INDEX `idx_reel_clips_order` ON `reel_clips`(reel_id,sequence_index);
CREATE INDEX `idx_render_state` ON `render_jobs`(state,created_at);
CREATE INDEX `idx_policy_resource_recent` ON `policy_decisions`(resource_type,resource_id,checked_at DESC);
CREATE INDEX `idx_asset_dependencies_source` ON `artifact_dependencies`(depends_on_asset_id);
CREATE INDEX `idx_share_link_access_recent` ON `share_link_access`(share_link_id,accessed_at DESC);
CREATE INDEX `idx_subscriptions_org_status` ON `subscriptions`(organization_id,state);
CREATE INDEX `idx_entitlement_org_feature` ON `entitlement_grants`(organization_id,feature_key,valid_until);

-- C-SQL-04: pending outbox rows are found by delivered_at IS NULL, oldest first
CREATE INDEX `idx_outbox_pending` ON `outbox_events`(delivered_at, claimed_at, id);

-- Preserved state-dependent integrity checks
ALTER TABLE `players` ADD CONSTRAINT `ck_players_verified_id` CHECK (`canonical_state` <> 'VERIFIED' OR `canonical_otsi_id` IS NOT NULL);
ALTER TABLE `video_sources` ADD CONSTRAINT `ck_ingested_source_asset` CHECK (`state` <> 'INGESTED' OR `source_asset_id` IS NOT NULL);
