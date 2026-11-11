-- 0074 webauthn credentials + challenges (OTSI VIE v2, MySQL 8.4): ADR-143 (ultra-only)
--
-- NUMBERING — read before renumbering anything: ultra is at 0073 (Scouting Pack). Antigravity used 0067, 0068, 0069
-- AND 0070 in their own repo for different things, and their series may reach 0071/0072/0073/0074 for something else.
-- This migration is 0074 because it is the next number free in ULTRA as far as ultra can see — but the two repos
-- must never be merged, so a future collision is still possible. If that ever happens, the merge is the problem,
-- not this number: never renumber a migration that has run anywhere.
--
-- MODEL (Roadmap Phase 4, Option B: passkey sign-in)
--   * One row per passkey. A passkey is a WebAuthn credential created with Windows Hello (fingerprint, face or
--     PIN) on the owner's machine; it signs the person in without typing email + password. Password sign-in
--     stays as the fallback and recovery path — there is no self-service forgot-password flow.
--   * The server stores ONLY the public half: the credential ID, the COSE public key (base64url), and the
--     signature counter. A private key is never stored, sent, or logged — it never leaves the authenticator.
--   * The counter is the clone detector: on every login the authenticator's counter must be HIGHER than the
--     stored one. A counter that goes backwards (or stays the same while the stored one is non-zero) means the
--     credential may have been cloned, so the login is rejected and the stored counter is left untouched.
--   * Challenges are stored server-side, single-use, and expire after ~5 minutes. A challenge is consumed
--     (deleted) before the signature is checked, so a failed attempt cannot be replayed with the same challenge.
--     Registration challenges are tied to the signed-in user; login challenges are tied to the email the
--     sign-in started with.
--   * A passkey login only succeeds for a verified (non-provisional) user — the same bar password sign-in sets:
--     the user must have completed account setup (a row in local_credentials). An invited-only user has none,
--     so a passkey cannot sign them in.
--   * A passkey is possession + a biometric/PIN (userVerification required), which is at least as strong as
--     password + authenticator code, so a passkey login does not ask for a two-step code.
--
-- RP (relying party): the desktop app runs on http://127.0.0.1:4311, a loopback origin, which is a secure
-- context for WebAuthn. The RP ID is configurable (OTSI_VIE_WEBAUTHN_RP_ID, default "127.0.0.1") and the RP
-- name is "OTSI VIE" (OTSI_VIE_WEBAUTHN_RP_NAME). The RP ID is the loopback host, never a public domain, so a
-- passkey created here cannot be used to sign in to any other site.

CREATE TABLE `webauthn_credentials` (
  `id` CHAR(36) PRIMARY KEY,
  `user_id` CHAR(36) NOT NULL,
  `credential_id` VARCHAR(255) NOT NULL UNIQUE,
  `public_key` TEXT NOT NULL,
  `counter` BIGINT NOT NULL DEFAULT 0,
  `transports` JSON NULL,
  `device_name` VARCHAR(80) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `last_used_at` DATETIME(6) NULL,
  CONSTRAINT `fk_webauthn_credentials_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX `idx_webauthn_credentials_user` ON `webauthn_credentials` (`user_id`, `created_at`);

CREATE TABLE `webauthn_challenges` (
  `id` CHAR(36) PRIMARY KEY,
  `purpose` ENUM('register', 'login') NOT NULL,
  `user_id` CHAR(36) NULL,
  `email` VARCHAR(255) NULL,
  `challenge` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME(6) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX `idx_webauthn_challenges_challenge` ON `webauthn_challenges` (`purpose`, `challenge`);
CREATE INDEX `idx_webauthn_challenges_expires` ON `webauthn_challenges` (`expires_at`);
