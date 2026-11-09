-- 0025 one camera for the whole match (OTSI VIE v2, MySQL 8.4) — pitch calibration joined from many moments, 2026-10-31 (owner request)
-- The main broadcast camera stands in one place and only turns, tilts and zooms. The GEOMETRY worker works out that camera (where it stands,
-- the lean of its head) from the clicks of ALL a video's moments together (`vie_worker.camera`); a moment then needs only 2-3 clicks.
-- A moment with too few clicks for the camera to pin it down yet WAITS for more moments: no positions, no guess.
-- Forward-only: one new status value and one new table (append-only history: the newest row of a video is its current camera).
ALTER TABLE `pitch_calibration_requests` DROP CHECK `ck_pcr_status`;
ALTER TABLE `pitch_calibration_requests` ADD CONSTRAINT `ck_pcr_status` CHECK (`status` IN ('QUEUED', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED'));

CREATE TABLE `pitch_cameras` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `centre_x_m` FLOAT NOT NULL,                         -- where the camera stands: pitch metres (origin at the centre spot, x along the length, y across)
  `centre_y_m` FLOAT NOT NULL,
  `height_m` FLOAT NOT NULL,                           -- above the pitch
  `roll_deg` FLOAT NOT NULL,                           -- the lean of the camera head
  `pitch_length_m` FLOAT NOT NULL,
  `pitch_width_m` FLOAT NOT NULL,
  `moments` JSON NOT NULL,                             -- ["<request id>", ...]: the moments whose clicks agree on this camera
  `points` INT NOT NULL,                               -- clicks used
  `click_rms_px` FLOAT NOT NULL,                       -- how closely the camera explains them (px of a 1280 px wide frame)
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY `fk_pcam_org` (`organization_id`),
  KEY `fk_pcam_video` (`video_id`, `organization_id`),
  KEY `idx_pcam_video` (`video_id`, `created_at`),
  CONSTRAINT `fk_pcam_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_pcam_video` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`),
  CONSTRAINT `ck_pcam_values` CHECK (`height_m` > 0 AND `points` >= 2 AND `click_rms_px` >= 0 AND `pitch_length_m` BETWEEN 90 AND 120 AND `pitch_width_m` BETWEEN 45 AND 90)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
