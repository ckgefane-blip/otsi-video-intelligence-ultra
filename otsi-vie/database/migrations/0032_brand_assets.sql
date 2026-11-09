-- 0032 brand assets (OTSI VIE v2, MySQL 8.4) — ADR-044, 2026-11-02 (owner: "Yes, build them", the Reel Builder's overlay and branding
-- switches)
-- A competition logo or a custom logo an organization uploads for its reels. Page 06 requires "branding asset provenance and licensed
-- usage enforced; render disabled when required image rights lacking" and "no unauthorized competition insignia in published reels": every
-- logo carries the rights declaration the uploading person made, as a `rights_grants` row (0001) for its file, and a render that uses a
-- logo is refused when that grant is not EXPORT_ALLOWED for REEL_OVERLAY or has expired. Retiring a logo keeps the row (reels rendered with
-- it stay traceable).
-- Forward-only: one enum value added to `assets.kind`, one new table.
ALTER TABLE `assets` MODIFY COLUMN `kind`
  ENUM('SOURCE','PROXY','THUMBNAIL','TRACKS','EVENTS','REEL','REPORT','HEATMAP','MANIFEST','CAPTIONS','DETECTIONS','EMBEDDINGS','BRAND') NOT NULL;

CREATE TABLE `brand_assets` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `kind` VARCHAR(20) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `asset_id` CHAR(36) NOT NULL,                        -- the image file (assets.kind = 'BRAND')
  `rights_grant_id` CHAR(36) NOT NULL,                 -- the declaration made when uploading
  `rights_holder` VARCHAR(255) NOT NULL,
  `rights_basis` VARCHAR(20) NOT NULL,
  `uploaded_by` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `retired_at` DATETIME(6) NULL,
  KEY `fk_ba_org` (`organization_id`),
  KEY `fk_ba_asset` (`asset_id`, `organization_id`),
  KEY `fk_ba_grant` (`rights_grant_id`),
  KEY `fk_ba_user` (`uploaded_by`),
  KEY `idx_ba_kind` (`organization_id`, `kind`, `retired_at`),
  CONSTRAINT `fk_ba_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_ba_asset` FOREIGN KEY (`asset_id`, `organization_id`) REFERENCES `assets` (`id`, `organization_id`),
  CONSTRAINT `fk_ba_grant` FOREIGN KEY (`rights_grant_id`) REFERENCES `rights_grants` (`id`),
  CONSTRAINT `fk_ba_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_ba_kind` CHECK (`kind` IN ('COMPETITION_LOGO', 'CUSTOM_LOGO')),
  CONSTRAINT `ck_ba_basis` CHECK (`rights_basis` IN ('OWN_BRAND', 'LICENSED', 'PERMISSION'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
