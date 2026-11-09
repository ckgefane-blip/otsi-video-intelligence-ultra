-- 0015 Reel Builder and rendering (OTSI VIE v2, MySQL 8.4) — ADR-032
-- A reel follows ONE player, chosen by a person: its targets (reel_targets) pin the exact CONFIRMED identity decisions it was built on
-- (0008). If any of those decisions is superseded, the reel is stale and cannot render until a person refreshes its targets.
ALTER TABLE `reel_projects`
  ADD COLUMN `player_id` CHAR(36) NULL AFTER `video_id`,
  ADD COLUMN `run_id` CHAR(36) NULL AFTER `player_id`,
  ADD COLUMN `aspect` VARCHAR(8) NOT NULL DEFAULT '16:9',
  ADD COLUMN `settings` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  ADD CONSTRAINT `fk_reel_projects_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`),
  ADD CONSTRAINT `fk_reel_projects_run` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs` (`id`),
  ADD CONSTRAINT `ck_reel_projects_aspect` CHECK (`aspect` IN ('16:9', '9:16', '1:1'));
CREATE INDEX `idx_reel_projects_video` ON `reel_projects` (`organization_id`, `video_id`, `updated_at`);

-- where a clip came from: a suggestion the user accepted, or the user's own in/out points
ALTER TABLE `reel_clips`
  ADD COLUMN `origin` VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN `label` VARCHAR(255) NULL,
  ADD CONSTRAINT `ck_reel_clips_origin` CHECK (`origin` IN ('SUGGESTED', 'MANUAL'));

-- render outcome details: the reason of a failure, and the measured result (frames, spotlight coverage, encoder, validation)
ALTER TABLE `render_jobs`
  ADD COLUMN `failure_detail` TEXT NULL,
  ADD COLUMN `result` JSON NULL;

-- the RENDER worker job (one per render job)
ALTER TABLE `worker_jobs` DROP CHECK `ck_worker_jobs_kind`;
ALTER TABLE `worker_jobs` ADD CONSTRAINT `ck_worker_jobs_kind` CHECK (`kind` IN ('INGEST_UPLOAD', 'INGEST_URL', 'PROXY', 'ANALYZE', 'RENDER'));
