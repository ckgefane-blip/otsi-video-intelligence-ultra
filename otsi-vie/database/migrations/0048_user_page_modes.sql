-- 0048 Guided / Pro per user and per page (OTSI VIE v2, MySQL 8.4) - 2026-11-06, ADR-072 (v3 Phase A.7, S05)
-- One row per person and page they switched; no row means the page's default, Pro (the approved design with every control).
-- A preference of the person, not of an organization: it follows them across organizations and devices. Removed with the account row.
-- Forward-only: a new table.
CREATE TABLE `user_page_modes` (
  `user_id` CHAR(36) NOT NULL,
  `page` VARCHAR(16) NOT NULL,
  `mode` VARCHAR(8) NOT NULL,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`, `page`),
  CONSTRAINT `fk_page_mode_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_page_mode_mode` CHECK (`mode` IN ('GUIDED', 'PRO')),
  CONSTRAINT `ck_page_mode_page` CHECK (`page` IN ('home', 'upload', 'processing', 'analysis', 'tactical', 'reels', 'studio', 'reports', 'library', 'export'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
