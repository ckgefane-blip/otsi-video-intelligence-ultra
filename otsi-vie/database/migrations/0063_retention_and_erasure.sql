-- 0063 Retention and erasure (OTSI VIE v3 Phase D.4, ADR-112) — 2026-11-09
-- Implements configurable retention policies per organization (Trash auto-purge days, raw footage,
-- rendered reels, audit logs), and subject erasure records (GDPR / right to be forgotten).
-- Forward-only: two new tables, no destructive alters to existing data.

CREATE TABLE `org_retention_policies` (
  `organization_id` CHAR(36) PRIMARY KEY,
  `trash_days` INT NOT NULL DEFAULT 30,
  `raw_footage_days` INT NULL,
  `rendered_reels_days` INT NULL,
  `audit_log_days` INT NOT NULL DEFAULT 365,
  `auto_purge_enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `updated_by` CHAR(36) NULL,
  CONSTRAINT `fk_retention_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_retention_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_retention_trash_days` CHECK (`trash_days` >= 0 AND `trash_days` <= 3650),
  CONSTRAINT `ck_retention_audit_days` CHECK (`audit_log_days` >= 30 AND `audit_log_days` <= 3650)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `subject_erasure_requests` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `subject_kind` VARCHAR(16) NOT NULL,
  `subject_id` CHAR(36) NOT NULL,
  `subject_ref` VARCHAR(128) NULL,
  `requested_by` CHAR(36) NOT NULL,
  `executed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `summary` JSON NOT NULL,
  CONSTRAINT `fk_erasure_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_erasure_user` FOREIGN KEY (`requested_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_erasure_kind` CHECK (`subject_kind` IN ('PLAYER', 'USER')),
  INDEX `idx_erasure_org` (`organization_id`, `executed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
