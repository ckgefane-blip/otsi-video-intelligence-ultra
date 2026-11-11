-- 0075 bank-transfer billing: bank accounts, plan orders with a per-year reference, receipts (OTSI VIE v2, MySQL 8.4):
-- ADR-144 §1.7 (ultra-only), plan step 7 of otsi-vie/docs/ULTRA_DISTRIBUTION_PLAN.md §5a.
--
-- NUMBERING — read before renumbering anything: ultra is at 0074 (WebAuthn). Antigravity used 0067, 0068, 0069
-- AND 0070 in their own repo for different things, and their series may reach 0071/0072/0073/0074/0075 for
-- something else. This migration is 0075 because it is the next number free in ULTRA as far as ultra can see —
-- but the two repos must never be merged, so a future collision is still possible. If that ever happens, the
-- merge is the problem, not this number: never renumber a migration that has run anywhere.
--
-- MODEL (ADR-144 §1.7, on top of the token wallet, ADR-140 / migration 0071)
--   * Bank transfer is the MAIN payment method; there is no payment gateway code anywhere in this build.
--     Online card payment stays a disabled "Coming soon" button in the UI (plan §5b) and is not built here.
--   * `bank_accounts` — the owner's bank details, entered in the admin console, one row per currency (NGN for
--     local payers, USD for foreign payers). Bank details are NEVER hard-coded and never in the repo; the
--     table is the only place they live. There is no organization_id on the table: the accounts are the
--     deployment owner's accounts, not per-organization data (ADR-140 §8 known limit: Admin is own-org only
--     and there is no platform-wide owner role yet — in the current single-tenant deployment the org OWNER is
--     the engine owner, so this is the same scoping as the wallet Admin).
--   * `bank_transfer_orders` — one plan order per purchase. The server generates the reference
--     OTSI-INV-<year>-<zero-padded per-year sequence> (e.g. OTSI-INV-2026-000123): the sequence lives in
--     `bank_transfer_reference_seq` (one row per year) and is taken under SELECT ... FOR UPDATE inside the
--     order transaction, so a reference is never issued twice and never reused. The reference is UNIQUE.
--   * Status: ORDERED -> AWAITING_CONFIRMATION -> CONFIRMED | REJECTED, plus PARTIAL (part paid, not active)
--     and REFUNDED (money refunded after confirmation). Nothing activates before confirmation: only the admin
--     confirm step writes the subscription row (the existing `subscriptions` table, migration 0001), the
--     entitlement grants (the existing `entitlement_grants` table) and the wallet PURCHASE credit (via
--     WalletService.credit with idempotency key `purchase:<orderId>` and the invoice reference = the order
--     reference). A rejection carries a reason; a partial payment never activates; a refund claws the granted
--     tokens back as a negative ADJUSTMENT. Every step is an audit row (recordChange, `billing.*`).
--   * Proof is optional: the user may upload a transfer receipt (PDF or image, stored under the configured
--     storage dir — filename, size, sha256 and storage key on the order row) or just mark "I have paid" with
--     no file. Either way the order becomes AWAITING_CONFIRMATION.
--   * Renewals: a renewal order (new reference, `renews_subscription_id` set) is created for an ACTIVE
--     subscription expiring within 7 days. After expiry plus a 14-day grace period the subscription drops to
--     the free tier (state CANCELED, free plan version, grants capped). Projects are kept and never deleted.
--   * The plan catalogue itself (plan codes, monthly prices, tokens per month) is data in
--     packages/contracts/src/bank-transfer.ts, like TOKEN_PACKS in wallet.ts — NOT in this migration — and the
--     confirm step creates the `plans` / `plan_versions` rows the existing `subscriptions` table needs
--     (insert-if-absent, inside the confirm transaction). No existing table is altered.
-- Forward-only: three new tables. Nothing existing is altered.

CREATE TABLE `bank_accounts` (
  `id` CHAR(36) PRIMARY KEY,
  `currency` CHAR(3) NOT NULL,
  `account_name` VARCHAR(255) NOT NULL,
  `bank_name` VARCHAR(255) NOT NULL,
  `account_number` VARCHAR(64) NOT NULL,
  `swift_iban` VARCHAR(64) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY `uq_bank_accounts_currency` (`currency`),
  CHECK (`currency` IN ('NGN','USD'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `bank_transfer_orders` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `plan_code` VARCHAR(32) NOT NULL,
  `period_months` INT NOT NULL,
  `amount_minor` BIGINT NOT NULL CHECK (`amount_minor` > 0),
  `currency` CHAR(3) NOT NULL,
  `reference` VARCHAR(32) NOT NULL,
  `bank_account_id` CHAR(36) NOT NULL,
  `status` ENUM('ORDERED','AWAITING_CONFIRMATION','CONFIRMED','REJECTED','PARTIAL','REFUNDED') NOT NULL DEFAULT 'ORDERED',
  `amount_received_minor` BIGINT NOT NULL DEFAULT 0 CHECK (`amount_received_minor` >= 0),
  `amount_refunded_minor` BIGINT NULL CHECK (`amount_refunded_minor` IS NULL OR `amount_refunded_minor` >= 0),
  `tokens_granted` INT NOT NULL CHECK (`tokens_granted` > 0),
  `subscription_id` CHAR(36) NULL,
  `renews_subscription_id` CHAR(36) NULL,
  `expires_at` DATETIME(6) NOT NULL,
  `proof_storage_key` VARCHAR(512) NULL,
  `proof_filename` VARCHAR(255) NULL,
  `proof_content_type` VARCHAR(128) NULL,
  `proof_size_bytes` BIGINT NULL CHECK (`proof_size_bytes` IS NULL OR `proof_size_bytes` > 0),
  `proof_sha256` CHAR(64) NULL,
  `proof_uploaded_at` DATETIME(6) NULL,
  `proof_note` VARCHAR(500) NULL,
  `confirmed_by` CHAR(36) NULL,
  `confirmed_at` DATETIME(6) NULL,
  `bank_reference` VARCHAR(255) NULL,
  `reject_reason` VARCHAR(500) NULL,
  `refund_reason` VARCHAR(500) NULL,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY `uq_bank_transfer_orders_reference` (`reference`),
  INDEX `idx_bank_transfer_orders_org` (`organization_id`, `created_at`),
  INDEX `idx_bank_transfer_orders_status` (`status`, `created_at`),
  INDEX `idx_bank_transfer_orders_renewal` (`renews_subscription_id`, `status`),
  CHECK (`currency` IN ('NGN','USD')),
  CHECK (`plan_code` IN ('STARTER','CLUB','ACADEMY','SEASON')),
  CHECK (`period_months` IN (1, 12)),
  CHECK (`amount_received_minor` <= `amount_minor`),
  CHECK ((`status` = 'CONFIRMED' AND `confirmed_by` IS NOT NULL AND `confirmed_at` IS NOT NULL AND `amount_received_minor` = `amount_minor`)
      OR (`status` <> 'CONFIRMED')),
  CHECK ((`status` = 'REJECTED' AND `reject_reason` IS NOT NULL) OR (`status` <> 'REJECTED')),
  CHECK ((`status` = 'REFUNDED' AND `refund_reason` IS NOT NULL) OR (`status` <> 'REFUNDED')),
  CONSTRAINT `fk_bank_transfer_orders_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_bank_transfer_orders_bank_account` FOREIGN KEY (`bank_account_id`) REFERENCES `bank_accounts` (`id`),
  CONSTRAINT `fk_bank_transfer_orders_subscription` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions` (`id`),
  CONSTRAINT `fk_bank_transfer_orders_renews` FOREIGN KEY (`renews_subscription_id`) REFERENCES `subscriptions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Per-year reference sequence. `next_seq` is the last sequence handed out for the year (0 = none yet); the
-- service takes the next one with SELECT ... FOR UPDATE inside the order transaction (see
-- apps/api/src/modules/billing/billing.ts), so two concurrent orders can never share a reference.
CREATE TABLE `bank_transfer_reference_seq` (
  `year` INT PRIMARY KEY,
  `next_seq` BIGINT NOT NULL DEFAULT 0 CHECK (`next_seq` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
