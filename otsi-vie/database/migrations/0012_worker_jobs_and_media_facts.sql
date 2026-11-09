-- 0012 durable worker jobs and real media facts (OTSI VIE v2, MySQL 8.4) — ADR-022
-- worker_jobs: the queue background workers (Python ingest/CV/render workers) claim from. Same safety pattern as the outbox (ADR-018):
-- claim with FOR UPDATE SKIP LOCKED, a claim token for fencing, a lease the worker renews by heartbeat, bounded attempts, an explicit
-- terminal state and error. Jobs are created by outbox subscribers (exactly once per subject through `dedupe_key`), never by the browser.
CREATE TABLE `worker_jobs` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `kind` VARCHAR(40) NOT NULL,
  `subject_type` VARCHAR(40) NOT NULL,
  `subject_id` CHAR(36) NOT NULL,
  `dedupe_key` VARCHAR(191) NOT NULL,
  `payload` JSON NOT NULL,
  `state` VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
  `attempts` INT NOT NULL DEFAULT 0,
  `max_attempts` INT NOT NULL DEFAULT 3,
  `available_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `claim_token` CHAR(36) NULL,
  `lease_expires_at` DATETIME(6) NULL,
  `heartbeat_at` DATETIME(6) NULL,
  `worker_id` VARCHAR(100) NULL,
  `progress` DECIMAL(5,2) NOT NULL DEFAULT 0,
  `stage_message` VARCHAR(255) NULL,
  `error_code` VARCHAR(64) NULL,
  `error_detail` VARCHAR(1000) NULL,
  `result` JSON NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `started_at` DATETIME(6) NULL,
  `finished_at` DATETIME(6) NULL,
  CONSTRAINT `uq_worker_jobs_dedupe` UNIQUE (`dedupe_key`),
  CONSTRAINT `fk_worker_jobs_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `ck_worker_jobs_kind` CHECK (`kind` IN ('INGEST_UPLOAD', 'INGEST_URL')),
  CONSTRAINT `ck_worker_jobs_state` CHECK (`state` IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  CONSTRAINT `ck_worker_jobs_attempts` CHECK (`attempts` >= 0 AND `max_attempts` >= 1),
  CONSTRAINT `ck_worker_jobs_progress` CHECK (`progress` BETWEEN 0 AND 100),
  CONSTRAINT `ck_worker_jobs_claim_has_lease` CHECK ((`claim_token` IS NULL) = (`lease_expires_at` IS NULL)),
  CONSTRAINT `ck_worker_jobs_running_is_claimed` CHECK ((`state` = 'RUNNING') = (`claim_token` IS NOT NULL)),
  CONSTRAINT `ck_worker_jobs_failed_has_error` CHECK (`state` <> 'FAILED' OR `error_code` IS NOT NULL),
  INDEX `idx_worker_jobs_claim` (`state`, `available_at`, `created_at`),
  INDEX `idx_worker_jobs_subject` (`organization_id`, `subject_type`, `subject_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- What the media probe actually found (never guessed), and why a video was refused.
ALTER TABLE `video_sources`
  ADD COLUMN `original_filename` VARCHAR(255) NULL AFTER `title`,
  ADD COLUMN `byte_size` BIGINT NULL AFTER `original_filename`,
  ADD COLUMN `container_format` VARCHAR(64) NULL,
  ADD COLUMN `video_codec` VARCHAR(64) NULL,
  ADD COLUMN `audio_codec` VARCHAR(64) NULL,
  ADD COLUMN `is_variable_frame_rate` BOOLEAN NULL,
  ADD COLUMN `frame_count` BIGINT NULL,
  ADD COLUMN `rotation_degrees` SMALLINT NULL,
  ADD COLUMN `thumbnail_asset_id` CHAR(36) NULL,
  ADD COLUMN `failure_code` VARCHAR(64) NULL,
  ADD COLUMN `failure_detail` VARCHAR(1000) NULL,
  ADD COLUMN `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  ADD CONSTRAINT `ck_video_sources_byte_size` CHECK (`byte_size` IS NULL OR `byte_size` > 0),
  ADD CONSTRAINT `ck_video_sources_rotation` CHECK (`rotation_degrees` IS NULL OR `rotation_degrees` IN (0, 90, 180, 270)),
  ADD CONSTRAINT `ck_video_sources_failure_explained` CHECK (`state` NOT IN ('FAILED', 'QUARANTINED') OR `failure_code` IS NOT NULL),
  ADD CONSTRAINT `fk_t_video_sources_thumbnail_asset_id` FOREIGN KEY (`thumbnail_asset_id`, `organization_id`) REFERENCES `assets` (`id`, `organization_id`);

CREATE INDEX `idx_video_sources_project_time` ON `video_sources` (`organization_id`, `project_id`, `created_at`);

-- upload sessions remember the client's file name and part size so an interrupted upload can be resumed from another tab
ALTER TABLE `upload_sessions`
  ADD COLUMN `original_filename` VARCHAR(255) NULL AFTER `idempotency_key`,
  ADD COLUMN `part_bytes` INT NULL AFTER `expected_sha256`,
  ADD CONSTRAINT `ck_upload_sessions_part_bytes` CHECK (`part_bytes` IS NULL OR `part_bytes` >= 1048576);
