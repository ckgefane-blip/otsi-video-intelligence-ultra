-- 0062 org templates (OTSI VIE v2, MySQL 8.4): v3 Phase C.10 (ADR-109), 2026-11-09
-- Organization templates for Spotlight, Style and Branding (Page 07 Clip Studio, Page 09 Library):
-- modular templates (`SPOTLIGHT`, `STYLE`, `BRANDING`, `FULL`) saved and shared across the organization.
-- A template can be applied selectively (e.g. spotlight settings only without overwriting logos/music,
-- style overlays only, or branding assets only). Forward-only.
CREATE TABLE `org_templates` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `description` VARCHAR(255) NOT NULL DEFAULT '',
  `kind` VARCHAR(20) NOT NULL,
  `spec` JSON NOT NULL,
  `is_shared` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_org_templates_name` (`organization_id`, `name`),
  KEY `ix_org_templates_org_kind` (`organization_id`, `kind`, `created_at`),
  CONSTRAINT `ck_org_templates_kind` CHECK (`kind` IN ('SPOTLIGHT', 'STYLE', 'BRANDING', 'FULL')),
  CONSTRAINT `ck_org_templates_spec` CHECK (JSON_TYPE(`spec`) = 'OBJECT'),
  CONSTRAINT `fk_org_templates_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_org_templates_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
