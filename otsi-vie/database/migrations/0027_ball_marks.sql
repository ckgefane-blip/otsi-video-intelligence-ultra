-- 0027 ball marks (OTSI VIE v2, MySQL 8.4) — the ball answer key, 2026-11-01 (owner: "let's start the ball")
-- A person steps through a stretch of video one analysed frame at a time and marks where the ball is, or that it cannot be seen. These marks
-- are the ground truth a ball tracker is measured against (detected ball candidates are mostly boots, socks, a fixed pitch mark and the
-- broadcaster's logo dot on the owner's match). One mark per video moment; marking a moment again replaces it (the person's correction).
-- Forward-only: one new table.
CREATE TABLE `ball_marks` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `pts_us` BIGINT NOT NULL,
  `visible` BOOLEAN NOT NULL,
  `x` FLOAT NULL,                                      -- normalised picture position of the ball's centre; NULL when not visible
  `y` FLOAT NULL,
  `marked_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY `uq_ball_marks_moment` (`video_id`, `pts_us`),
  KEY `fk_bm_org` (`organization_id`),
  KEY `fk_bm_video` (`video_id`, `organization_id`),
  KEY `fk_bm_user` (`marked_by`),
  CONSTRAINT `fk_bm_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_bm_video` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`),
  CONSTRAINT `fk_bm_user` FOREIGN KEY (`marked_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_bm_position` CHECK ((`visible` AND `x` BETWEEN 0 AND 1 AND `y` BETWEEN 0 AND 1) OR (NOT `visible` AND `x` IS NULL AND `y` IS NULL)),
  CONSTRAINT `ck_bm_time` CHECK (`pts_us` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
