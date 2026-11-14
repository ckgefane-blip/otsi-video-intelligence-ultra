-- 0078 user-to-user invites: referral with token rewards (owner decision 2026-11-14). OTSI VIE v2, MySQL 8.4
-- (also run on MariaDB 11.4 through tools/db/mariadb_compat.py).
--
-- MODEL
--   * `user_invites` — one invite code per user (10 URL-safe characters, no 0/O/1/l). The user shares a link
--     built from it (<origin>/setup?invite=<code>); the server never has to guess the app's public address.
--     The code is created on first read (GET /v1/invites/mine), never at signup — a user who never invites
--     anyone has no row, and no code is ever reused.
--   * `invite_referrals` — one row per invited organisation: who invited whom, with which code, and whether
--     the inviter's reward has been paid. One inviter per new user (the invitee organisation id is the key);
--     a user cannot use their own code (checked by email at sign-up, before the account is created).
-- REWARDS (ledger rows, so the balance is derived from them like any credit; never a negative balance)
--   * invitee: +25 INVITE_BONUS at signup, on top of the 100-token free grant, expiring 30 days after signup
--     like the grant (idempotency key `invite-bonus:<org>`).
--   * inviter: +100 INVITE_REWARD, no expiry, only when the invitee does something real — their first match
--     analysis (WalletService.charge, ANALYSIS) or their first pack purchase (confirmReceipt). Exactly once
--     per invitee: the referral row is marked paid, and the ledger row carries `invite-reward:<org>`, so a
--     second trigger returns the first row instead of paying again.
-- GRANTS: tools/db/roles.py builds grants from the live schema; re-run it after migrating. These rows change
-- state, so otsi_app gets the usual SELECT, INSERT, UPDATE, DELETE. Forward-only: two new tables, plus the
-- two new kinds on the wallet_ledger kind ENUM and the sign rule that admits them (below).

CREATE TABLE `user_invites` (
  `user_id` CHAR(36) PRIMARY KEY,
  `code` VARCHAR(10) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY `uq_user_invites_code` (`code`),
  CONSTRAINT `fk_user_invites_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `invite_referrals` (
  `invitee_org_id` CHAR(36) PRIMARY KEY,
  `invitee_user_id` CHAR(36) NOT NULL,
  `inviter_user_id` CHAR(36) NOT NULL,
  `inviter_org_id` CHAR(36) NOT NULL,
  `invite_code` VARCHAR(10) NOT NULL,
  `reward_paid_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX `idx_invite_referrals_inviter` (`inviter_user_id`, `created_at`),
  CONSTRAINT `fk_invite_referrals_invitee_org` FOREIGN KEY (`invitee_org_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_invite_referrals_invitee_user` FOREIGN KEY (`invitee_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_invite_referrals_inviter_user` FOREIGN KEY (`inviter_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_invite_referrals_inviter_org` FOREIGN KEY (`inviter_org_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The two new ledger kinds are credits (positive amounts), so the wallet_ledger kind ENUM must admit them
-- and so must the sign rule that keeps credits positive and debits negative. The old sign rule is an
-- unnamed CHECK, so it is dropped by its engine name — MySQL `wallet_ledger_chk_3` (third CHECK in
-- definition order in 0071: the balance_after column check, then `amount <> 0`, then the sign rule), MariaDB
-- `CONSTRAINT_2` (same order; tools/db/mariadb_compat.py maps the MySQL name to the MariaDB one). The
-- replacement is NAMED, so a later migration can drop it by the same name on both engines.
ALTER TABLE `wallet_ledger` DROP CHECK `wallet_ledger_chk_3`;
ALTER TABLE `wallet_ledger` ADD CONSTRAINT `ck_wallet_ledger_sign` CHECK ((`kind` IN ('SPEND','EXPIRY') AND `amount` < 0)
    OR (`kind` IN ('PURCHASE','FREE_GRANT','REFUND','INVITE_BONUS','INVITE_REWARD') AND `amount` > 0)
    OR `kind` = 'ADJUSTMENT');
ALTER TABLE `wallet_ledger` MODIFY COLUMN `kind` ENUM('PURCHASE','FREE_GRANT','SPEND','REFUND','ADJUSTMENT','EXPIRY','INVITE_BONUS','INVITE_REWARD') NOT NULL;
