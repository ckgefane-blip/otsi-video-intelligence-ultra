-- 0010 local sign-in (OTSI VIE v2, MySQL 8.4) — ADR-021
-- The blueprint's `auth-adapter` for installations without an external OIDC provider: the platform itself verifies a password and issues
-- the same RS256 access tokens the API already verifies (ADR-017). An external OIDC provider can replace it later without API changes,
-- because the API only ever trusts a verified token plus an ACTIVE membership.

-- one password credential per user; the hash is self-describing ("scrypt$N$r$p$<salt b64>$<hash b64>"), never the password
CREATE TABLE `local_credentials` (
  `user_id` CHAR(36) NOT NULL PRIMARY KEY,
  `email_normalized` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `failed_attempts` INT NOT NULL DEFAULT 0,
  `locked_until` DATETIME(6) NULL,
  `password_changed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `uq_local_credentials_email` UNIQUE (`email_normalized`),
  CONSTRAINT `fk_local_credentials_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_local_credentials_hash` CHECK (`password_hash` LIKE 'scrypt$%'),
  CONSTRAINT `ck_local_credentials_email` CHECK (`email_normalized` = LOWER(`email_normalized`) AND `email_normalized` LIKE '%_@_%'),
  CONSTRAINT `ck_local_credentials_attempts` CHECK (`failed_attempts` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Refresh sessions. The browser holds an opaque refresh token in an HttpOnly cookie; only its SHA-256 is stored. Every refresh rotates
-- it (the old row is marked rotated); presenting a rotated token again means it was stolen, so the whole family is revoked.
CREATE TABLE `auth_sessions` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `family_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `refresh_hash` CHAR(64) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `expires_at` DATETIME(6) NOT NULL,
  `rotated_at` DATETIME(6) NULL,
  `revoked_at` DATETIME(6) NULL,
  `revoke_reason` VARCHAR(32) NULL,
  `user_agent` VARCHAR(255) NULL,
  `ip` VARCHAR(64) NULL,
  CONSTRAINT `uq_auth_sessions_refresh` UNIQUE (`refresh_hash`),
  CONSTRAINT `fk_auth_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_auth_sessions_expiry` CHECK (`expires_at` > `created_at`),
  CONSTRAINT `ck_auth_sessions_reason` CHECK (`revoke_reason` IS NULL OR `revoke_reason` IN ('LOGOUT', 'REUSE_DETECTED', 'PASSWORD_CHANGED', 'ADMIN')),
  CONSTRAINT `ck_auth_sessions_revoked_has_reason` CHECK ((`revoked_at` IS NULL) = (`revoke_reason` IS NULL)),
  INDEX `idx_auth_sessions_family` (`family_id`),
  INDEX `idx_auth_sessions_user` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
