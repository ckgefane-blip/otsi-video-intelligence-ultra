-- 0077 licensing circle: job tickets (central), offline spends and central links (linked desktop). OTSI VIE v2, MySQL 8.4
-- (also run on MariaDB 11.4 through tools/db/mariadb_compat.py). ADR-146.
--
-- NUMBERING: ultra is at 0076 (grassroots price list). Never renumber a migration that has run anywhere.
--
-- MODEL (ADR-146: the central server is the bank)
--   * `job_tickets` — CENTRAL. One row per paid job a linked desktop runs. Online: the desktop asks for a ticket before
--     the job starts; central charges its wallet ledger (idempotency key `spend:<type>:<id>`, WalletService.charge) and
--     records the ticket CHARGED with the ledger row. Offline: the desktop ran the job inside its offline allowance and
--     settles it later; central charges it then, or — when the balance is short — records it OWED. The ledger can never go
--     below zero (wallet_ledger.balance_after >= 0, migration 0071), so a debt is an OWED ticket, not a negative balance:
--     central refuses new tickets while any are OWED and collects them, oldest first, as soon as the balance covers them.
--     A refund (job cancelled before start, or failed) refunds a CHARGED ticket through the ledger (`refund:<type>:<id>`)
--     and simply clears an OWED one. One row per (organization, job type, job id): asking twice returns the first.
--   * `offline_spends` — LINKED DESKTOP. A paid job started while central could not be reached, inside the licence's
--     offline allowance; settled with central later (PENDING -> SETTLED), or REFUNDED when the job failed before settling.
--   * `central_links` — LINKED DESKTOP. The central session a person signed in with on this computer: the central
--     refresh token SEALED with the engine's credential key (never stored in clear), and the last signed licence token.
--     The central user and organization ids are mirrored into the local users / organizations tables with the same ids.
-- GRANTS: tools/db/roles.py builds grants from the live schema; re-run it after migrating. These rows change state, so
-- otsi_app gets the usual SELECT, INSERT, UPDATE, DELETE. Forward-only: three new tables. Nothing existing is altered.

CREATE TABLE `job_tickets` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `job_type` ENUM('ANALYSIS','REEL_RENDER','PLAYER_REPORT','EXPORT_PACK','AI_ANALYSIS') NOT NULL,
  `job_id` CHAR(36) NOT NULL,
  `amount` INT NOT NULL CHECK (`amount` > 0),
  `source` ENUM('ONLINE','OFFLINE') NOT NULL DEFAULT 'ONLINE',
  `state` ENUM('CHARGED','OWED','REFUNDED') NOT NULL,
  `ledger_id` CHAR(36) NULL,
  `requested_by` CHAR(36) NULL,
  `spent_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY `uq_job_tickets_job` (`organization_id`, `job_type`, `job_id`),
  INDEX `idx_job_tickets_org_state` (`organization_id`, `state`, `created_at`),
  CHECK ((`state` = 'CHARGED' AND `ledger_id` IS NOT NULL) OR (`state` <> 'CHARGED')),
  CHECK ((`source` = 'OFFLINE' AND `spent_at` IS NOT NULL) OR (`source` = 'ONLINE')),
  CONSTRAINT `fk_job_tickets_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `offline_spends` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `job_type` ENUM('ANALYSIS','REEL_RENDER','PLAYER_REPORT','EXPORT_PACK','AI_ANALYSIS') NOT NULL,
  `job_id` CHAR(36) NOT NULL,
  `amount` INT NOT NULL CHECK (`amount` > 0),
  `state` ENUM('PENDING','SETTLED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  `actor_id` CHAR(36) NULL,
  `spent_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `settled_at` DATETIME(6) NULL,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY `uq_offline_spends_job` (`organization_id`, `job_type`, `job_id`),
  INDEX `idx_offline_spends_org_state` (`organization_id`, `state`),
  CONSTRAINT `fk_offline_spends_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `central_links` (
  `user_id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `central_url` VARCHAR(255) NOT NULL,
  `refresh_sealed` TEXT NOT NULL,
  `licence_token` TEXT NULL,
  `licence_expires_at` DATETIME(6) NULL,
  `linked_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`user_id`, `organization_id`),
  INDEX `idx_central_links_org` (`organization_id`),
  CONSTRAINT `fk_central_links_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_central_links_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
