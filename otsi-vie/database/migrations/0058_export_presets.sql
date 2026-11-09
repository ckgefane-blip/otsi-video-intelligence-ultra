-- 0058 export presets (OTSI VIE v2, MySQL 8.4): v3 Phase B.22 (ADR-097), 2026-11-07
-- A named export recipe: which files one edit makes (export profile and frame for each), the file format, quality and the loudness the
-- sound is set to. ORGANIZATION presets are shared by every member (an owner or admin saves and deletes them); PERSONAL presets belong to
-- the member who saved them (owner_user_id). The three built-in presets live in code (contracts export-presets.ts), not here.
-- Forward-only; per organization; nothing else depends on it.
CREATE TABLE `export_presets` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `owner_user_id` CHAR(36) NULL,
  `name` VARCHAR(80) NOT NULL,
  `note` VARCHAR(200) NOT NULL DEFAULT '',
  `spec` JSON NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `ix_export_presets_org` (`organization_id`, `owner_user_id`, `created_at`),
  CONSTRAINT `ck_export_presets_spec` CHECK (JSON_TYPE(`spec`) = 'OBJECT'),
  CONSTRAINT `fk_export_presets_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_export_presets_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_export_presets_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
