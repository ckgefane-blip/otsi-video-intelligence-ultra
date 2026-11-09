-- 0044 Export bundles and client delivery (OTSI VIE v2, MySQL 8.4) - 2026-11-06, ADR-058
-- Page 10 T rows. Output & Reports: the companions of a finished render, each made on its own (a performance PDF, a clip sheet PDF, an
-- event list CSV, a heatmap PNG); one may fail or be "not measured" without touching the others. Each made file is an asset with its size
-- and SHA-256. Download All packs the render and the bundle's files into one ZIP (asset kind BUNDLE) with a manifest of hashes.
-- Deliver to Client: a delivery record per sending (who, to whom, the message, the share link it made, the team members chosen); the
-- message is sent from the person's own mail app (zero cost: no mail service), so the server records "handed to your mail app", never
-- "delivered". Forward-only: new tables, an appended ENUM value, nullable columns.
CREATE TABLE `export_bundles` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `reel_id` CHAR(36) NOT NULL,
  `render_id` CHAR(36) NOT NULL,
  `requested_by` CHAR(36) NOT NULL,
  `items` JSON NOT NULL,
  `zip_asset_id` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `completed_at` DATETIME(6) NULL,
  CONSTRAINT `fk_eb_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_eb_reel` FOREIGN KEY (`reel_id`) REFERENCES `reel_projects` (`id`),
  CONSTRAINT `fk_eb_render` FOREIGN KEY (`render_id`) REFERENCES `render_jobs` (`id`),
  CONSTRAINT `fk_eb_by` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_eb_zip` FOREIGN KEY (`zip_asset_id`) REFERENCES `assets` (`id`),
  INDEX `ix_eb_org_reel` (`organization_id`, `reel_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `export_bundle_items` (
  `bundle_id` CHAR(36) NOT NULL,
  `kind` ENUM('PERFORMANCE_PDF','CLIP_SHEET_PDF','EVENTS_CSV','HEATMAP_PNG') NOT NULL,
  `state` ENUM('SUCCEEDED','FAILED','NOT_MEASURED') NOT NULL,
  `asset_id` CHAR(36) NULL,
  `report_job_id` CHAR(36) NULL,
  `byte_size` BIGINT NULL,
  `sha256` CHAR(64) NULL,
  `failure` VARCHAR(255) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`bundle_id`, `kind`),
  CONSTRAINT `fk_ebi_bundle` FOREIGN KEY (`bundle_id`) REFERENCES `export_bundles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ebi_asset` FOREIGN KEY (`asset_id`) REFERENCES `assets` (`id`),
  CONSTRAINT `fk_ebi_report` FOREIGN KEY (`report_job_id`) REFERENCES `report_jobs` (`id`),
  CONSTRAINT `ck_ebi_file` CHECK ((`state` = 'SUCCEEDED') = (`asset_id` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `assets`
  MODIFY `kind` ENUM('SOURCE','PROXY','THUMBNAIL','TRACKS','EVENTS','REEL','REPORT','HEATMAP','MANIFEST','CAPTIONS','DETECTIONS','EMBEDDINGS','BRAND','BUNDLE') NOT NULL;

ALTER TABLE `deliveries`
  ADD COLUMN `reel_id` CHAR(36) NULL,
  ADD COLUMN `render_id` CHAR(36) NULL,
  ADD COLUMN `share_link_id` CHAR(36) NULL,
  ADD COLUMN `bundle_id` CHAR(36) NULL,
  ADD COLUMN `recipient_name` VARCHAR(255) NULL,
  ADD COLUMN `message` VARCHAR(2000) NULL,
  ADD COLUMN `team_user_ids` JSON NULL,
  ADD COLUMN `channel` ENUM('OWN_MAIL_APP') NULL,
  ADD COLUMN `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  ADD CONSTRAINT `fk_del_reel` FOREIGN KEY (`reel_id`) REFERENCES `reel_projects` (`id`),
  ADD CONSTRAINT `fk_del_render` FOREIGN KEY (`render_id`) REFERENCES `render_jobs` (`id`),
  ADD CONSTRAINT `fk_del_link` FOREIGN KEY (`share_link_id`) REFERENCES `share_links` (`id`),
  ADD CONSTRAINT `fk_del_bundle` FOREIGN KEY (`bundle_id`) REFERENCES `export_bundles` (`id`),
  ADD INDEX `ix_del_org_reel` (`organization_id`, `reel_id`, `created_at`),
  ADD INDEX `ix_del_render_to` (`render_id`, `destination_ref`, `created_at`);
