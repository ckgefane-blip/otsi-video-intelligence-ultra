-- 0053 Video markers (OTSI VIE v2, MySQL 8.4) - 2026-11-07, ADR-082 (v3 Phase B.3)
-- A note a person pins on a video at a time (Analysis timeline, Markers & notes lane). Writers add them; the author, an owner or an admin
-- removes them (soft: removed_at, so the audit keeps what was there). Removed with the video's organization data.
-- Forward-only: a new table.
CREATE TABLE `video_markers` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `at_pts_us` BIGINT NOT NULL,
  `body` VARCHAR(500) NOT NULL,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `removed_at` DATETIME(6) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_video_markers_video` (`video_id`, `removed_at`, `at_pts_us`),
  CONSTRAINT `fk_video_markers_video` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_video_markers_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_video_markers_author` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_video_markers_at` CHECK (`at_pts_us` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
