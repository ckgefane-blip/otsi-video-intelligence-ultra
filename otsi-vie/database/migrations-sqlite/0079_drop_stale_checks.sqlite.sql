-- 0079: drop the stale CHECKs the old SQLite translator kept.
-- HAND-WRITTEN, not generated: the translator cannot produce this file
-- (its model already reflects the drop from 0013, so a DROP CHECK there
-- raises "names no CHECK"). sqlite_translate.py never overwrites an existing
-- SQLite file, so this file is safe from a re-run. See the MySQL 0079 file
-- for the full story.
-- SQLite rules applied: STRICT tables; dates as INTEGER epoch ms; booleans as
-- INTEGER 0/1; JSON as TEXT with json_valid checks; foreign keys declared in DDL
-- (enforced with PRAGMA foreign_keys=ON by the runner and the API adapter).
-- table rebuild (drop stale unnamed class_name CHECK): SQLite cannot ADD/DROP a constraint or MODIFY a column
PRAGMA legacy_alter_table=ON;
CREATE TABLE `__otsi_new_tracks` (
  `id` TEXT COLLATE NOCASE PRIMARY KEY CONSTRAINT `ck_len_id` CHECK (length(`id`) <= 36),
  `run_id` TEXT COLLATE NOCASE NOT NULL CONSTRAINT `ck_len_run_id` CHECK (length(`run_id`) <= 36),
  `video_id` TEXT COLLATE NOCASE NOT NULL CONSTRAINT `ck_len_video_id` CHECK (length(`video_id`) <= 36),
  `internal_track_number` INTEGER NOT NULL,
  `class_name` TEXT COLLATE NOCASE NOT NULL CONSTRAINT `ck_len_class_name` CHECK (length(`class_name`) <= 255),
  `first_pts_us` INTEGER NOT NULL,
  `last_pts_us` INTEGER NOT NULL,
  `status` TEXT COLLATE NOCASE NOT NULL DEFAULT 'ACTIVE' CHECK (status IN('ACTIVE','OCCLUDED','LEFT_FRAME','ENDED','REVIEW_REQUIRED')) CONSTRAINT `ck_len_status` CHECK (length(`status`) <= 255),
  `identity_state` TEXT COLLATE NOCASE NOT NULL DEFAULT 'UNRESOLVED' CONSTRAINT `ck_enum_identity_state` CHECK (`identity_state` IN ('UNRESOLVED', 'CANDIDATE', 'CONFIRMED', 'REJECTED', 'CONFLICT')),
  `quality_score` REAL CHECK (quality_score BETWEEN 0 AND 1),
  `created_at` INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec')*1000 AS INTEGER)),
  `shot_id` TEXT COLLATE NOCASE CONSTRAINT `ck_len_shot_id` CHECK (length(`shot_id`) <= 36),
  `observation_count` INTEGER NOT NULL DEFAULT 0,
  `mean_confidence` REAL,
  UNIQUE (`run_id`, `internal_track_number`),
  CONSTRAINT `fk_tracks_42` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs` (`id`),
  CONSTRAINT `fk_tracks_43` FOREIGN KEY (`video_id`) REFERENCES `video_sources` (`id`),
  CONSTRAINT `fk_tracks_shot` FOREIGN KEY (`shot_id`) REFERENCES `video_shots` (`id`),
  CHECK (last_pts_us >= first_pts_us),
  CONSTRAINT `ck_tracks_class` CHECK (`class_name` IN ('PERSON', 'PLAYER', 'GOALKEEPER', 'REFEREE', 'BALL', 'OTHER')),
  CONSTRAINT `ck_tracks_counts` CHECK (`observation_count` >= 0 AND (`mean_confidence` IS NULL OR `mean_confidence` BETWEEN 0 AND 1))
) STRICT;
INSERT INTO `__otsi_new_tracks` (`id`, `run_id`, `video_id`, `internal_track_number`, `class_name`, `first_pts_us`, `last_pts_us`, `status`, `identity_state`, `quality_score`, `created_at`, `shot_id`, `observation_count`, `mean_confidence`) SELECT `id`, `run_id`, `video_id`, `internal_track_number`, `class_name`, `first_pts_us`, `last_pts_us`, `status`, `identity_state`, `quality_score`, `created_at`, `shot_id`, `observation_count`, `mean_confidence` FROM `tracks`;
DROP TABLE `tracks`;
ALTER TABLE `__otsi_new_tracks` RENAME TO `tracks`;
PRAGMA legacy_alter_table=OFF;
CREATE INDEX `idx_tracks_run_time` ON `tracks` (`run_id`, `first_pts_us`, `last_pts_us`);
