-- 0068 cross-match best-moments reels (OTSI VIE v2, MySQL 8.4): ADR-131, 2026-11-10
-- A reel is one player, one match (source MATCH, video_id set — every reel so far) or one player, ALL his matches
-- (source ALL_MATCHES, video_id NULL, run_id NULL: there is no single video or run; each clip carries its own
-- source_video_id in reel_clips, and targets pin his confirmed tracks in every video). The reel records the length
-- the person chose (90 / 180 / 300 s, 5 minutes the solid cap) and the best-moments rule version it was built with,
-- so a reel is always reproducible and old reels keep the version they were built with.
-- Safe on existing rows: all of them are MATCH with a video_id, so the new columns land NULL / 'MATCH' and the CHECK passes.
-- reel_moment_rejections gains the video the rejected moment came from (NULL for a single-match reel, as today); a
-- cross-match rejection is per video, so rejecting a moment in one match never rejects the same window in another.
-- Known edge (ADR-131): the table's key is still (reel_id, in_pts_us), so two videos of one cross-match reel rejecting a
-- moment at the exact same microsecond share one row — improbable (windows start at an event's second), and the API
-- always filters rejections by video_id where one is recorded.
-- Forward-only: three columns, one nullable column, two CHECKs, one foreign key.
ALTER TABLE `reel_projects`
  MODIFY COLUMN `video_id` CHAR(36) NULL,
  ADD COLUMN `source` ENUM('MATCH','ALL_MATCHES') NOT NULL DEFAULT 'MATCH' AFTER `video_id`,
  ADD COLUMN `cross_match_length_s` INT NULL AFTER `source`,
  ADD COLUMN `best_moments_rule_version` INT NULL AFTER `cross_match_length_s`,
  ADD CONSTRAINT `ck_reel_projects_source` CHECK (
    (`source` = 'MATCH' AND `video_id` IS NOT NULL AND `cross_match_length_s` IS NULL AND `best_moments_rule_version` IS NULL)
    OR (`source` = 'ALL_MATCHES' AND `video_id` IS NULL AND `run_id` IS NULL AND `cross_match_length_s` IN (90, 180, 300)
        AND `best_moments_rule_version` IS NOT NULL));

ALTER TABLE `reel_moment_rejections`
  ADD COLUMN `video_id` CHAR(36) NULL AFTER `reel_id`,
  ADD CONSTRAINT `fk_reel_moment_rejections_video` FOREIGN KEY (`video_id`) REFERENCES `video_sources` (`id`);
