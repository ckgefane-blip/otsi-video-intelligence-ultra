-- 0056 reel moment rejections (OTSI VIE v2, MySQL 8.4): v3 Phase B.15 (ADR-091), 2026-11-07
-- A person says a suggested moment is not wanted in this reel ("Not this one"). The moment stays listed (dimmed, at the end) and can be
-- restored; "Add all" and the draft builder leave it out. Keyed by the reel and the moment's window as suggested; a moment is treated as
-- rejected while at least half of it lies in a rejected window (the suggestions can shift slightly when the analysis is refreshed).
-- Forward-only; per reel; nothing else depends on it.
CREATE TABLE `reel_moment_rejections` (
  `reel_id` CHAR(36) NOT NULL,
  `in_pts_us` BIGINT NOT NULL,
  `out_pts_us` BIGINT NOT NULL,
  `rejected_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`reel_id`, `in_pts_us`),
  CONSTRAINT `ck_reel_moment_rejection_window` CHECK (`out_pts_us` > `in_pts_us` AND `in_pts_us` >= 0),
  CONSTRAINT `fk_reel_moment_rejections_reel` FOREIGN KEY (`reel_id`) REFERENCES `reel_projects` (`id`),
  CONSTRAINT `fk_reel_moment_rejections_user` FOREIGN KEY (`rejected_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
