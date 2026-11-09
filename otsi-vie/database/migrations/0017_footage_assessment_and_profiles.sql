-- 0017 footage-quality assessment and analysis profiles (OTSI VIE v2, MySQL 8.4) — ADR-034
-- An assessment measures one video (resolution, compression, blur, motion, light, pitch share, player size, detector cost) and
-- recommends an analysis profile. It is advice the user can override; it never changes the footage or any identity.

CREATE TABLE `video_quality_assessments` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'QUEUED',
  `metrics` JSON NULL,
  `recommended_profile` VARCHAR(24) NULL,
  `failure_code` VARCHAR(64) NULL,
  `failure_detail` TEXT NULL,
  `requested_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `finished_at` DATETIME(6) NULL,
  CONSTRAINT `fk_quality_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_quality_video` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`),
  CONSTRAINT `fk_quality_user` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_quality_status` CHECK (`status` IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')
    AND (`recommended_profile` IS NULL OR `recommended_profile` IN ('STANDARD', 'HIGH_ACCURACY', 'ULTRA_SENSITIVE'))
    AND (`status` <> 'SUCCEEDED' OR (`metrics` IS NOT NULL AND `recommended_profile` IS NOT NULL)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX `idx_quality_video` ON `video_quality_assessments` (`video_id`, `created_at`);

-- the ASSESS worker job (one per assessment)
ALTER TABLE `worker_jobs` DROP CHECK `ck_worker_jobs_kind`;
ALTER TABLE `worker_jobs` ADD CONSTRAINT `ck_worker_jobs_kind` CHECK (`kind` IN ('INGEST_UPLOAD', 'INGEST_URL', 'PROXY', 'ANALYZE', 'RENDER', 'ASSESS'));
