-- 0028 the engine's ball (OTSI VIE v2, MySQL 8.4) — automatic ball tracking (ADR-037), 2026-11-01
-- The TRACK_BALL worker follows the ball from an analysis run's saved detections (vie_worker.ball) with nobody clicking. It starts by itself
-- when an analysis finishes; a person may start it again for an earlier run. One `ball_tracks` row per attempt; `ball_positions` holds the
-- frames where the engine knows where the ball is: DETECTED (a real detection on the chosen path) or INFERRED (a straight line across a short
-- gap). A frame with no row is UNKNOWN: unknown beats wrong. A person's mark (0027 `ball_marks`) overrides the engine where it exists.
-- Forward-only: two new tables and a worker job kind.
CREATE TABLE `ball_tracks` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `run_id` CHAR(36) NOT NULL,                          -- the analysis run whose detections were followed
  `status` VARCHAR(12) NOT NULL DEFAULT 'QUEUED',
  `metrics` JSON NULL,                                 -- candidates removed by each rule, frames detected / inferred, comparison with the marks
  `failure_code` VARCHAR(64) NULL,
  `failure_detail` TEXT NULL,
  `requested_by` CHAR(36) NULL,                        -- NULL: started by the engine itself when the analysis finished
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `finished_at` DATETIME(6) NULL,
  KEY `fk_bt_org` (`organization_id`),
  KEY `fk_bt_video` (`video_id`, `organization_id`),
  KEY `fk_bt_run` (`run_id`),
  KEY `fk_bt_user` (`requested_by`),
  KEY `idx_bt_video` (`video_id`, `created_at`),
  CONSTRAINT `fk_bt_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_bt_video` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`),
  CONSTRAINT `fk_bt_run` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs` (`id`),
  CONSTRAINT `fk_bt_user` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_bt_status` CHECK (`status` IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `ball_positions` (
  `ball_track_id` CHAR(36) NOT NULL,
  `pts_us` BIGINT NOT NULL,
  `state` VARCHAR(10) NOT NULL,
  `x` FLOAT NOT NULL,                                  -- normalised picture position of the ball's centre
  `y` FLOAT NOT NULL,
  `confidence` FLOAT NOT NULL,
  PRIMARY KEY (`ball_track_id`, `pts_us`),
  CONSTRAINT `fk_bp_track` FOREIGN KEY (`ball_track_id`) REFERENCES `ball_tracks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_bp_state` CHECK (`state` IN ('DETECTED', 'INFERRED')),
  CONSTRAINT `ck_bp_values` CHECK (`pts_us` >= 0 AND `x` BETWEEN 0 AND 1 AND `y` BETWEEN 0 AND 1 AND `confidence` BETWEEN 0 AND 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `worker_jobs` DROP CHECK `ck_worker_jobs_kind`;
ALTER TABLE `worker_jobs` ADD CONSTRAINT `ck_worker_jobs_kind` CHECK (`kind` IN ('INGEST_UPLOAD', 'INGEST_URL', 'PROXY', 'ANALYZE', 'RENDER', 'ASSESS', 'CALIBRATE_PITCH', 'TRACK_BALL'));
