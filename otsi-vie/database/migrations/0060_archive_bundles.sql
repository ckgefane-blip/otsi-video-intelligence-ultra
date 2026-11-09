-- 0060 archive bundles (OTSI VIE v2, MySQL 8.4): v3 Phase C.4 (ADR-104), 2026-11-09
-- Portable archive bundles (`otsi-archive/v1`) for a reel, a video, or a match: manifest (`manifest.json`), scoped audit extract
-- (`audit-extract.json`), and for a reel its interchange files (`reel.otsi-reel`, `timeline.otio`) and newest finished render if on disk.
-- Rights (`archive-v1`) are checked at pack time and re-checked against live `rights_grants`, `video_sources`, and `reel_targets`
-- every time an archive is opened or downloaded (`policy_decisions`).
CREATE TABLE `archive_bundles` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `project_id` CHAR(36) NULL,
  `subject_kind` VARCHAR(16) NOT NULL,
  `subject_id` CHAR(36) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `video_ids` JSON NOT NULL,
  `zip_asset_id` CHAR(36) NOT NULL,
  `manifest` JSON NOT NULL,
  `audit_extract` JSON NOT NULL,
  `audit_count` INT NOT NULL,
  `byte_size` BIGINT NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_archive_bundles_subject` (`organization_id`, `subject_kind`, `subject_id`, `created_at`),
  CONSTRAINT `ck_archive_bundles_kind` CHECK (`subject_kind` IN ('REEL', 'VIDEO', 'MATCH')),
  CONSTRAINT `ck_archive_bundles_videos` CHECK (JSON_TYPE(`video_ids`) = 'ARRAY'),
  CONSTRAINT `ck_archive_bundles_manifest` CHECK (JSON_TYPE(`manifest`) = 'OBJECT'),
  CONSTRAINT `ck_archive_bundles_audit` CHECK (JSON_TYPE(`audit_extract`) = 'ARRAY'),
  CONSTRAINT `fk_archive_bundles_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_archive_bundles_asset` FOREIGN KEY (`zip_asset_id`) REFERENCES `assets` (`id`),
  CONSTRAINT `fk_archive_bundles_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
