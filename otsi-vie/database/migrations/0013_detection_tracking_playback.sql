-- 0013 detection, tracking and playback (OTSI VIE v2, MySQL 8.4) — ADR-024, ADR-025
-- A detector finds PEOPLE; whether a person is an outfield player, a goalkeeper, a referee, a coach or a spectator is a later, separate
-- decision (team/kit classification, Block 07). Until then a track is honestly a PERSON, never presented as a "player".
ALTER TABLE `tracks` DROP CHECK `tracks_chk_1`;
ALTER TABLE `tracks` ADD CONSTRAINT `ck_tracks_class` CHECK (`class_name` IN ('PERSON', 'PLAYER', 'GOALKEEPER', 'REFEREE', 'BALL', 'OTHER'));

-- shot the track lives in (a track never crosses a camera cut), and the model that produced it
ALTER TABLE `tracks`
  ADD COLUMN `shot_id` CHAR(36) NULL AFTER `video_id`,
  ADD COLUMN `observation_count` INT NOT NULL DEFAULT 0,
  ADD COLUMN `mean_confidence` FLOAT NULL,
  ADD CONSTRAINT `fk_tracks_shot` FOREIGN KEY (`shot_id`) REFERENCES `video_shots` (`id`),
  ADD CONSTRAINT `ck_tracks_counts` CHECK (`observation_count` >= 0 AND (`mean_confidence` IS NULL OR `mean_confidence` BETWEEN 0 AND 1));
CREATE INDEX `idx_tracks_run_time` ON `tracks` (`run_id`, `first_pts_us`, `last_pts_us`);
-- the observation window query of the analysis workspace: one run's boxes between two timestamps
CREATE INDEX `idx_track_obs_time` ON `track_observations` (`video_id`, `pts_us`, `track_id`);

-- raw detector output is kept as an immutable evidence file (Parquet) per batch
ALTER TABLE `assets` MODIFY COLUMN `kind`
  ENUM('SOURCE','PROXY','THUMBNAIL','TRACKS','EVENTS','REEL','REPORT','HEATMAP','MANIFEST','CAPTIONS','DETECTIONS') NOT NULL;

-- shots belong to one processing run (a re-run with another cut detector keeps its own shots); the old unique key backs the video FK,
-- so a plain index takes over that role before it is dropped
CREATE INDEX `idx_video_shots_video` ON `video_shots` (`video_id`);
ALTER TABLE `video_shots`
  ADD COLUMN `run_id` CHAR(36) NULL AFTER `video_id`,
  ADD COLUMN `shot_number` INT NULL AFTER `run_id`,
  DROP INDEX `video_id`,
  ADD CONSTRAINT `uq_video_shots_run_start` UNIQUE (`run_id`, `start_pts_us`),
  ADD CONSTRAINT `fk_video_shots_run` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs` (`id`);

-- the playback proxy and the frame/timestamp index are per video; the worker jobs that build them
ALTER TABLE `video_sources`
  ADD COLUMN `proxy_asset_id` CHAR(36) NULL AFTER `thumbnail_asset_id`,
  ADD CONSTRAINT `fk_t_video_sources_proxy_asset_id` FOREIGN KEY (`proxy_asset_id`, `organization_id`) REFERENCES `assets` (`id`, `organization_id`);

ALTER TABLE `worker_jobs` DROP CHECK `ck_worker_jobs_kind`;
ALTER TABLE `worker_jobs` ADD CONSTRAINT `ck_worker_jobs_kind` CHECK (`kind` IN ('INGEST_UPLOAD', 'INGEST_URL', 'PROXY', 'ANALYZE'));
