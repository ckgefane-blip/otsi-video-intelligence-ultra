-- 0057 reel blocks (OTSI VIE v2, MySQL 8.4): v3 Phase B.21 (ADR-096), 2026-11-07
-- A compound clip: a run of consecutive reel clips a person saved under a name (an intro block, a "best passes" run), to put into any
-- other reel of the same video in one step. The clips are copied as they were saved (window, label, speed effect, zoom / drawings, gap,
-- sound level); the block does not follow later changes. Per organization and video; forward-only; nothing else depends on it.
CREATE TABLE `reel_blocks` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `clips` JSON NOT NULL,
  `clip_count` INT NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_reel_blocks_org_video` (`organization_id`, `video_id`, `created_at`),
  CONSTRAINT `ck_reel_blocks_count` CHECK (`clip_count` BETWEEN 1 AND 20),
  CONSTRAINT `ck_reel_blocks_clips` CHECK (JSON_TYPE(`clips`) = 'ARRAY'),
  CONSTRAINT `fk_reel_blocks_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_reel_blocks_video` FOREIGN KEY (`video_id`) REFERENCES `video_sources` (`id`),
  CONSTRAINT `fk_reel_blocks_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
