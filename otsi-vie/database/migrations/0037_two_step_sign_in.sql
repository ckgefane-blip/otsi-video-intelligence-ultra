-- 0037 two-step sign-in with an authenticator app (OTSI VIE v2, MySQL 8.4) — 2026-11-05, roadmap Step 1
-- Time-based one-time codes (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), which every free authenticator app reads; no SMS, no
-- paid service. The shared secret is stored encrypted (AES-256-GCM, key derived from the installation's signing key, bound to the
-- user id), never in clear. `last_used_step` refuses a code that was already used once (replay). Recovery codes are stored only as
-- SHA-256 hashes and each works once. Forward-only: two new tables, no change to existing rows.
CREATE TABLE `user_totp` (
  `user_id` CHAR(36) NOT NULL PRIMARY KEY,
  `secret_sealed` VARCHAR(255) NOT NULL,
  `confirmed_at` DATETIME(6) NULL,
  `last_used_step` BIGINT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_user_totp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_user_totp_sealed` CHECK (`secret_sealed` LIKE 'v1.%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `user_recovery_codes` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `user_id` CHAR(36) NOT NULL,
  `code_hash` CHAR(64) NOT NULL,
  `used_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `uq_user_recovery_codes_hash` UNIQUE (`user_id`, `code_hash`),
  CONSTRAINT `fk_user_recovery_codes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
