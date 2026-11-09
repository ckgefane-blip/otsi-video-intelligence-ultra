-- 0029 lineup cards (OTSI VIE v2, MySQL 8.4) — players named from the broadcast lineup cards (ADR-039), 2026-11-01
-- The READ_LINEUPS worker scans a video for the team sheets broadcasters show (team, shirt number and name of every starter and substitute,
-- the coach) and stores each card it read, with a picture of the frame. A card is EVIDENCE: a person approves it (corrections allowed) and
-- only then does it become the match roster (match_rosters, through the matches module). Forward-only: two new tables and a job kind.
CREATE TABLE `lineup_reads` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'QUEUED',
  `metrics` JSON NULL,                                 -- frames scanned, card-like frames, cards read, seconds
  `failure_code` VARCHAR(64) NULL,
  `failure_detail` TEXT NULL,
  `requested_by` CHAR(36) NULL,                        -- NULL: started by the engine itself when the analysis finished
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `finished_at` DATETIME(6) NULL,
  KEY `fk_lr_org` (`organization_id`),
  KEY `fk_lr_video` (`video_id`, `organization_id`),
  KEY `fk_lr_user` (`requested_by`),
  KEY `idx_lr_video` (`video_id`, `created_at`),
  CONSTRAINT `fk_lr_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_lr_video` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`),
  CONSTRAINT `fk_lr_user` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_lr_status` CHECK (`status` IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `lineup_cards` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `read_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `pts_us` BIGINT NOT NULL,                            -- the frame the card was read from
  `team_name` VARCHAR(255) NULL,
  `coach_name` VARCHAR(255) NULL,
  `entries` JSON NOT NULL,                             -- [{"number": "4", "name": "...", "role": "STARTER"|"SUBSTITUTE", "confidence": 0.98}]
  `frame_asset_id` CHAR(36) NULL,                      -- a JPEG of the card, for the person who approves it
  `state` VARCHAR(10) NOT NULL DEFAULT 'PROPOSED',
  `applied_match_id` CHAR(36) NULL,
  `applied_club_id` CHAR(36) NULL,
  `decided_by` CHAR(36) NULL,
  `decided_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  KEY `fk_lc_org` (`organization_id`),
  KEY `fk_lc_read` (`read_id`),
  KEY `fk_lc_video` (`video_id`, `organization_id`),
  KEY `fk_lc_asset` (`frame_asset_id`),
  KEY `fk_lc_match` (`applied_match_id`),
  KEY `fk_lc_club` (`applied_club_id`),
  KEY `fk_lc_user` (`decided_by`),
  CONSTRAINT `fk_lc_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_lc_read` FOREIGN KEY (`read_id`) REFERENCES `lineup_reads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lc_video` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`),
  CONSTRAINT `fk_lc_asset` FOREIGN KEY (`frame_asset_id`) REFERENCES `assets` (`id`),
  CONSTRAINT `fk_lc_match` FOREIGN KEY (`applied_match_id`) REFERENCES `matches` (`id`),
  CONSTRAINT `fk_lc_club` FOREIGN KEY (`applied_club_id`) REFERENCES `clubs` (`id`),
  CONSTRAINT `fk_lc_user` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_lc_state` CHECK (`state` IN ('PROPOSED', 'APPLIED', 'DISMISSED')),
  CONSTRAINT `ck_lc_applied` CHECK (`state` <> 'APPLIED' OR (`applied_match_id` IS NOT NULL AND `applied_club_id` IS NOT NULL AND `decided_by` IS NOT NULL)),
  CONSTRAINT `ck_lc_pts` CHECK (`pts_us` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `worker_jobs` DROP CHECK `ck_worker_jobs_kind`;
ALTER TABLE `worker_jobs` ADD CONSTRAINT `ck_worker_jobs_kind` CHECK (`kind` IN ('INGEST_UPLOAD', 'INGEST_URL', 'PROXY', 'ANALYZE', 'RENDER', 'ASSESS', 'CALIBRATE_PITCH', 'TRACK_BALL', 'READ_LINEUPS'));
