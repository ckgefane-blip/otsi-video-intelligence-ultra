-- 0024 pitch calibration requests (OTSI VIE v2, MySQL 8.4) — Page 04 pitch minimap, Blueprint 03_MEDIA_CV_TRACKING step 8 `geometry`, 2026-10-30
-- Where on the pitch (metres) a point of the picture is needs a homography per moment of a shot. A person marks landmarks of the pitch on ONE
-- frame (the request, kept with the clicks); the GEOMETRY worker snaps the pitch lines onto the white lines of the picture and follows the
-- camera through the shot, writing one `pitch_calibrations` row per measured sample (the blueprint table, one matrix per time slice). Frames where
-- the fit is not trustworthy get NO row: "not measured" is the absence of a row, never a guessed matrix.
-- Forward-only: `pitch_calibrations` is empty today; it only gains a nullable `request_id` and an index.
CREATE TABLE `pitch_calibration_requests` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `anchor_pts_us` BIGINT NOT NULL,
  `points` JSON NOT NULL,                              -- [{"landmark": "...", "x": 0..1, "y": 0..1}, ...]: the person's clicks (normalised picture coordinates)
  `pitch_length_m` FLOAT NOT NULL,
  `pitch_width_m` FLOAT NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'QUEUED',
  `metrics` JSON NULL,                                 -- what the worker measured: samples tried / kept, span, click error, quality
  `failure_code` VARCHAR(64) NULL,
  `failure_detail` TEXT NULL,
  `requested_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `finished_at` DATETIME(6) NULL,
  KEY `fk_pcr_org` (`organization_id`),
  KEY `fk_pcr_video` (`video_id`, `organization_id`),
  KEY `fk_pcr_user` (`requested_by`),
  KEY `idx_pcr_video` (`video_id`, `created_at`),
  CONSTRAINT `fk_pcr_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_pcr_video` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`),
  CONSTRAINT `fk_pcr_user` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_pcr_status` CHECK (`status` IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT `ck_pcr_pitch` CHECK (`pitch_length_m` BETWEEN 90 AND 120 AND `pitch_width_m` BETWEEN 45 AND 90 AND `anchor_pts_us` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `pitch_calibrations`
  ADD COLUMN `request_id` CHAR(36) NULL AFTER `video_id`,
  ADD KEY `idx_pitch_cal_video_time` (`video_id`, `start_pts_us`),
  ADD KEY `fk_pitch_cal_request` (`request_id`),
  ADD CONSTRAINT `fk_pitch_cal_request` FOREIGN KEY (`request_id`) REFERENCES `pitch_calibration_requests` (`id`) ON DELETE CASCADE;

-- the CALIBRATE_PITCH worker job (one per request); same pattern as 0017's ASSESS
ALTER TABLE `worker_jobs` DROP CHECK `ck_worker_jobs_kind`;
ALTER TABLE `worker_jobs` ADD CONSTRAINT `ck_worker_jobs_kind` CHECK (`kind` IN ('INGEST_UPLOAD', 'INGEST_URL', 'PROXY', 'ANALYZE', 'RENDER', 'ASSESS', 'CALIBRATE_PITCH'));
