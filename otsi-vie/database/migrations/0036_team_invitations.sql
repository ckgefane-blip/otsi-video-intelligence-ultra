-- 0036 team invitations (OTSI VIE v2, MySQL 8.4) — 2026-11-05, roadmap Step 1 (F01: invite a user, choose their role, remove them)
-- An owner or admin invites a person by e-mail address with a role. The invitation is a one-time link: only the SHA-256 of its random
-- token is stored, so a database copy cannot be used to join. It expires after 7 days, can be withdrawn, and is used at most once.
-- At most one open invitation per organization and address (a generated column holds the address only while the invitation is open;
-- NULLs never collide in a UNIQUE index). Forward-only: one new table, no change to existing rows.
CREATE TABLE `organization_invitations` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `email_normalized` VARCHAR(255) NOT NULL,
  `role` VARCHAR(16) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `invited_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `expires_at` DATETIME(6) NOT NULL,
  `accepted_at` DATETIME(6) NULL,
  `accepted_by` CHAR(36) NULL,
  `revoked_at` DATETIME(6) NULL,
  `open_email` VARCHAR(255) GENERATED ALWAYS AS (IF(`accepted_at` IS NULL AND `revoked_at` IS NULL, `email_normalized`, NULL)) STORED,
  CONSTRAINT `uq_invitations_token` UNIQUE (`token_hash`),
  CONSTRAINT `uq_invitations_open` UNIQUE (`organization_id`, `open_email`),
  CONSTRAINT `fk_invitations_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_invitations_inviter` FOREIGN KEY (`invited_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_invitations_acceptor` FOREIGN KEY (`accepted_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_invitations_role` CHECK (`role` IN ('OWNER', 'ADMIN', 'ANALYST', 'EDITOR', 'SCOUT', 'VIEWER')),
  CONSTRAINT `ck_invitations_email` CHECK (`email_normalized` = LOWER(`email_normalized`) AND `email_normalized` LIKE '%_@_%'),
  CONSTRAINT `ck_invitations_expiry` CHECK (`expires_at` > `created_at`),
  CONSTRAINT `ck_invitations_used_once` CHECK (`accepted_at` IS NULL OR `revoked_at` IS NULL),
  CONSTRAINT `ck_invitations_acceptor` CHECK ((`accepted_at` IS NULL) = (`accepted_by` IS NULL)),
  INDEX `idx_invitations_org` (`organization_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
