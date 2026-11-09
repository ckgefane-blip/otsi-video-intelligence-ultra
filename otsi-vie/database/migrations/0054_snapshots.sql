-- 0054 snapshots (OTSI VIE v2, MySQL 8.4): v3 Phase B.5 (ADR-083), 2026-11-07
-- A snapshot is one still picture of a video at a time, at the source's full resolution, made by the SNAPSHOT worker job: the frame
-- itself, and only if asked the boxes the latest finished analysis recorded at that frame (names only for confirmed identities), the
-- selected player's highlight and a caption saying what it is. A new asset kind holds the PNG. Forward-only.
ALTER TABLE `assets` MODIFY COLUMN `kind`
  ENUM('SOURCE','PROXY','THUMBNAIL','TRACKS','EVENTS','REEL','REPORT','HEATMAP','MANIFEST','CAPTIONS','DETECTIONS','EMBEDDINGS','BRAND','BUNDLE','SNAPSHOT') NOT NULL;

CREATE TABLE `snapshots` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `pts_us` BIGINT NOT NULL,                            -- the time asked for; the frame drawn is the nearest decoded one (frame_pts_us)
  `frame_pts_us` BIGINT NULL,
  `overlays` JSON NOT NULL,                            -- {"boxes": bool, "labels": bool, "selected_track_id": uuid|null, "caption": bool}
  `status` VARCHAR(12) NOT NULL DEFAULT 'QUEUED',
  `asset_id` CHAR(36) NULL,                            -- the PNG (assets.kind = 'SNAPSHOT')
  `width` INT NULL,
  `height` INT NULL,
  `boxes_drawn` INT NULL,
  `run_id` CHAR(36) NULL,                              -- the analysis whose boxes were drawn
  `failure_code` VARCHAR(64) NULL,
  `failure_detail` TEXT NULL,
  `requested_by` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `finished_at` DATETIME(6) NULL,
  `removed_at` DATETIME(6) NULL,
  KEY `fk_snap_org` (`organization_id`),
  KEY `idx_snap_video` (`video_id`, `organization_id`, `created_at`),
  KEY `fk_snap_asset` (`asset_id`),
  KEY `fk_snap_user` (`requested_by`),
  CONSTRAINT `fk_snap_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_snap_video` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_snap_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`),
  CONSTRAINT `fk_snap_user` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_snap_status` CHECK (`status` IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT `ck_snap_pts` CHECK (`pts_us` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `worker_jobs` DROP CHECK `ck_worker_jobs_kind`;
ALTER TABLE `worker_jobs` ADD CONSTRAINT `ck_worker_jobs_kind` CHECK (`kind` IN ('INGEST_UPLOAD', 'INGEST_URL', 'PROXY', 'ANALYZE', 'RENDER', 'ASSESS', 'CALIBRATE_PITCH', 'TRACK_BALL', 'READ_LINEUPS', 'SNAPSHOT'));
