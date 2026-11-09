-- 0061 music beat grids (OTSI VIE v2, MySQL 8.4): v3 Phase C.5 (ADR-105), 2026-11-09
-- The beat grid of a music brand asset (ADR-047), made by the BEAT_GRID worker job on this computer: the tempo with the strongest
-- periodicity and the detected beat times (microseconds from the music's start). Clip Studio's Snap uses them so a dragged clip end
-- lands on a beat of the music as the render loops it. The beats are Detected; their accuracy is not measured. Forward-only.
CREATE TABLE `music_beat_grids` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `brand_asset_id` CHAR(36) NOT NULL,                  -- the music (brand_assets.kind = 'MUSIC')
  `status` VARCHAR(12) NOT NULL DEFAULT 'QUEUED',
  `method` VARCHAR(40) NOT NULL,                       -- the analysis version, e.g. otsi-beat-v1
  `tempo_bpm` DECIMAL(6,2) NULL,                       -- null: no steady beat found
  `beats` JSON NULL,                                   -- [us, ...] increasing
  `beat_count` INT NULL,
  `duration_us` BIGINT NULL,                           -- the music's decoded length (the render's loop period)
  `periodicity` DECIMAL(5,4) NULL,                     -- 0..1 autocorrelation peak at the tempo (steadiness, not accuracy)
  `failure_code` VARCHAR(64) NULL,
  `failure_detail` TEXT NULL,
  `requested_by` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `finished_at` DATETIME(6) NULL,
  KEY `fk_mbg_org` (`organization_id`),
  KEY `idx_mbg_music` (`brand_asset_id`, `organization_id`, `created_at`),
  KEY `fk_mbg_user` (`requested_by`),
  CONSTRAINT `fk_mbg_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_mbg_music` FOREIGN KEY (`brand_asset_id`) REFERENCES `brand_assets` (`id`),
  CONSTRAINT `fk_mbg_user` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_mbg_status` CHECK (`status` IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `worker_jobs` DROP CHECK `ck_worker_jobs_kind`;
ALTER TABLE `worker_jobs` ADD CONSTRAINT `ck_worker_jobs_kind` CHECK (`kind` IN ('INGEST_UPLOAD', 'INGEST_URL', 'PROXY', 'ANALYZE', 'RENDER', 'ASSESS', 'CALIBRATE_PITCH', 'TRACK_BALL', 'READ_LINEUPS', 'SNAPSHOT', 'BEAT_GRID'));
