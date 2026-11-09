-- 0031 possession and passes (OTSI VIE v2, MySQL 8.4) — ADR-040, 2026-11-02
-- The TRACK_BALL worker, after following the ball, finds who holds it frame by frame and writes the blueprint's `event_candidates`
-- (0001): POSSESSION (a player's spell on the ball), PASS (to a team-mate), POSSESSION_CHANGE (the other team won it) and TEAM_POSSESSION
-- (a team's phase on the ball). Each set belongs to the ball track it was found from, so following the ball again replaces the answer
-- without touching anything a person decided; readers take the video's latest finished ball track. Teams are kit groups of the run: a
-- person's kit -> club assignment (0016) names them when read, so assigning kits later needs no new run.
-- Forward-only: two nullable columns, a foreign key and an index.
ALTER TABLE `event_candidates`
  ADD COLUMN `ball_track_id` CHAR(36) NULL AFTER `video_id`,
  ADD COLUMN `kit_group` TINYINT NULL AFTER `secondary_track_id`,
  ADD CONSTRAINT `fk_event_candidates_ball` FOREIGN KEY (`ball_track_id`) REFERENCES `ball_tracks` (`id`),
  ADD KEY `idx_events_ball` (`ball_track_id`, `event_type`, `start_pts_us`);
