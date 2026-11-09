-- 0066 formation decisions: v3 Phase E.3 (ADR-123), 2026-11-09
-- Tactical formations inferred from calibrated pitch positions, confirmed or overridden by a person.
-- An analyst confirms or edits the formation per team and match period.

CREATE TABLE `formation_decisions` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `video_id` CHAR(36) NOT NULL,
  `kit_group` TINYINT NOT NULL,
  `period` VARCHAR(8) NOT NULL DEFAULT 'FULL',
  `formation_name` VARCHAR(16) NOT NULL,
  `state` VARCHAR(16) NOT NULL DEFAULT 'INFERRED',
  `decided_by` CHAR(36) NOT NULL,
  `reason` TEXT NULL,
  `decided_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_formation_decisions_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_formation_decisions_video` FOREIGN KEY (`video_id`) REFERENCES `video_sources` (`id`),
  CONSTRAINT `fk_formation_decisions_user` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_formation_decisions_state` CHECK (`state` IN ('INFERRED', 'CONFIRMED')),
  CONSTRAINT `ck_formation_decisions_period` CHECK (`period` IN ('FULL', 'H1', 'H2'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX `idx_formation_decisions_lookup` ON `formation_decisions` (`video_id`, `kit_group`, `period`, `decided_at`);
