-- 0071 token wallet & credit system (OTSI VIE v2, MySQL 8.4): ADR-140 (ultra-only)
--
-- NUMBERING — read before renumbering anything: ultra is at 0069. Antigravity used 0067, 0068, 0069 AND 0070 in
-- their own repo for different things (their 0067 is billing, ultra's 0067 is Player Profile Intro), and their 0070 is
-- also a wallet. This migration is 0071 precisely because it is the next number free in BOTH series as far as ultra
-- can see — but the two repos must never be merged, so a future collision is still possible if their series reaches
-- 0071 for something else. If that ever happens, the merge is the problem, not this number: never renumber a
-- migration that has run anywhere.
--
-- MODEL (scope: workspace/goals/otsi-video-intelligence-engine/files/token-wallet-scope/token-wallet-scope.md)
--   * 1 token = 1 minute of footage analysed. Reel render, player report and export pack cost 10 tokens each.
--   * The wallet belongs to the ORGANIZATION, not to a person. The balance is DERIVED from wallet_ledger — there is
--     deliberately no balance column anywhere that could drift from the ledger.
--   * Every token movement is one immutable wallet_ledger row (triggers below refuse UPDATE and DELETE; only the
--     retention role's DELETE, which the triggers also refuse, could ever remove one — i.e. nobody can).
--   * Amounts are signed: credits positive, debits negative. A SPEND or EXPIRY row is always negative, a PURCHASE,
--     FREE_GRANT or REFUND row always positive; an ADJUSTMENT may be either sign but never zero.
--   * Expiry: a credit row carries expires_at (12 months after a purchase, 30 days after the free grant). Expired
--     tokens are NOT silently dropped from the balance — an EXPIRY row is written for them (by the admin expiry
--     sweep), so the ledger always explains the balance. The spendable balance (credits not yet expired, oldest
--     expiry spent first) is computed in code, not stored — see packages/contracts/src/wallet.ts.
--   * Bank transfer only: a pack request becomes an invoice the owner issues, the organization pays by bank
--     transfer, the owner confirms receipt in Admin, and only then is a PURCHASE row written with the invoice
--     reference. There is NO payment gateway code in this migration or anywhere in this build; the existing
--     billing tables (billing_customers, subscriptions, invoices, billing_webhook_inbox, plan_versions,
--     entitlement_grants, migration 0001) are untouched.
--   * Free tier: 25 tokens, once per organization, recorded in wallet_free_grants (one row per organization by
--     primary key). There is no email_verified column on users — email verification lives with the identity
--     provider — so the grant records the requesting member's email as the email of record and the one-grant rule
--     is enforced by the table, not by a verification flag this database does not have (ADR-140 §6).
-- Forward-only: three new tables, two triggers. Nothing existing is altered.

CREATE TABLE `wallet_ledger` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `kind` ENUM('PURCHASE','FREE_GRANT','SPEND','REFUND','ADJUSTMENT','EXPIRY') NOT NULL,
  `amount` BIGINT NOT NULL,
  `balance_after` BIGINT NOT NULL CHECK (`balance_after` >= 0),
  `job_type` VARCHAR(64) NULL,
  `job_id` CHAR(36) NULL,
  `idempotency_key` VARCHAR(255) NOT NULL,
  `invoice_ref` VARCHAR(255) NULL,
  `reason` VARCHAR(500) NULL,
  `actor_id` CHAR(36) NULL,
  `expires_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY `uq_wallet_ledger_org_key` (`organization_id`, `idempotency_key`),
  INDEX `idx_wallet_ledger_org_created` (`organization_id`, `created_at`),
  INDEX `idx_wallet_ledger_job` (`organization_id`, `job_id`),
  CHECK (`amount` <> 0),
  CHECK ((`kind` IN ('SPEND','EXPIRY') AND `amount` < 0)
      OR (`kind` IN ('PURCHASE','FREE_GRANT','REFUND') AND `amount` > 0)
      OR `kind` = 'ADJUSTMENT'),
  CHECK ((`kind` = 'SPEND' AND `job_type` IS NOT NULL AND `job_id` IS NOT NULL)
      OR (`kind` <> 'SPEND')),
  CHECK ((`kind` = 'PURCHASE' AND `invoice_ref` IS NOT NULL) OR (`kind` <> 'PURCHASE')),
  CONSTRAINT `fk_wallet_ledger_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `wallet_pack_requests` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `pack_code` ENUM('STARTER','CLUB','ACADEMY','SEASON') NOT NULL,
  `currency` CHAR(3) NOT NULL,
  `amount_minor` BIGINT NOT NULL CHECK (`amount_minor` > 0),
  `tokens` INT NOT NULL CHECK (`tokens` > 0),
  `status` ENUM('REQUESTED','INVOICED','PAID','CANCELLED') NOT NULL DEFAULT 'REQUESTED',
  `invoice_ref` VARCHAR(255) NULL,
  `requested_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX `idx_wallet_pack_requests_org` (`organization_id`, `created_at`),
  CONSTRAINT `fk_wallet_pack_requests_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `wallet_free_grants` (
  `organization_id` CHAR(36) PRIMARY KEY,
  `granted_tokens` INT NOT NULL DEFAULT 25,
  `email` VARCHAR(255) NOT NULL,
  `granted_by` CHAR(36) NOT NULL,
  `granted_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `expires_at` DATETIME(6) NOT NULL,
  CONSTRAINT `fk_wallet_free_grants_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Immutable ledger: no UPDATE and no DELETE, for anyone, including the retention role. A wrong row is corrected
-- by a new ADJUSTMENT or REFUND row that says so in its reason — never by rewriting history.
DELIMITER $$
CREATE TRIGGER `trg_wallet_ledger_no_update` BEFORE UPDATE ON `wallet_ledger`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'wallet_ledger is immutable: correct a row with a new ADJUSTMENT or REFUND row, never by updating it';
END$$
CREATE TRIGGER `trg_wallet_ledger_no_delete` BEFORE DELETE ON `wallet_ledger`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'wallet_ledger is immutable: rows are never deleted';
END$$
DELIMITER ;
