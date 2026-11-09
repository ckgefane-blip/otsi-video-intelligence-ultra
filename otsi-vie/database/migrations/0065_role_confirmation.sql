-- 0065 role confirmation by a person: v3 Phase E.8 (ADR-122), 2026-11-09
-- A player's tactical role/position can be proposed by the engine or imported from team sheets,
-- but role filters in search, scouting, player lists, and tactics comparison must use confirmed roles only.
-- Record who confirmed the role, when, and an explicit confirmation state (ROLE_CONFIRMED / ROLE_PROVISIONAL).

ALTER TABLE `players`
  ADD COLUMN `role_confirmed_by` CHAR(36) NULL AFTER `primary_position`,
  ADD COLUMN `role_confirmed_at` DATETIME(6) NULL AFTER `role_confirmed_by`,
  ADD COLUMN `role_confirmation_state` VARCHAR(20) NOT NULL DEFAULT 'ROLE_PROVISIONAL' AFTER `role_confirmed_at`,
  ADD CONSTRAINT `fk_players_role_confirmed_by` FOREIGN KEY (`role_confirmed_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ck_players_role_conf_state` CHECK (`role_confirmation_state` IN ('ROLE_PROVISIONAL', 'ROLE_CONFIRMED')),
  ADD CONSTRAINT `ck_players_role_confirmed_pair` CHECK ((`role_confirmed_by` IS NULL) = (`role_confirmed_at` IS NULL));

CREATE INDEX `idx_players_position_confirmed` ON `players` (`primary_position`, `role_confirmation_state`);
