-- 0035 a player's usual position (OTSI VIE v2, MySQL 8.4) — 2026-11-02 (owner: "User should as well enter player position")
-- Recorded by a person on the Players list, with nationality, foot and birth date. The position on a match team sheet
-- (`match_rosters.position`, 0016) stays the position in that match and is shown first; this one is used where a match has none.
-- Same codes as the team sheet. Forward-only: one nullable column, no row changes.
ALTER TABLE `players` ADD COLUMN `primary_position` VARCHAR(4) NULL;
ALTER TABLE `players` ADD CONSTRAINT `ck_players_primary_position` CHECK (`primary_position` IS NULL OR `primary_position` IN
  ('GK', 'RB', 'CB', 'LB', 'RWB', 'LWB', 'DM', 'CM', 'AM', 'RM', 'LM', 'RW', 'LW', 'CF', 'ST', 'DF', 'MF', 'FW'));
