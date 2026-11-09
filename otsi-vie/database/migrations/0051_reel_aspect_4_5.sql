-- 0051 Reel frame 4:5 (OTSI VIE v2, MySQL 8.4) - 2026-11-07, ADR-080 (v3 Phase 0.13)
-- A reel's frame may now also be 4:5 (social feed posts): like 9:16 and 1:1, the full source height cropped to 4:5 and following the player.
-- Forward-only: the check is widened; existing rows keep their value.
ALTER TABLE `reel_projects` DROP CHECK `ck_reel_projects_aspect`;
ALTER TABLE `reel_projects` ADD CONSTRAINT `ck_reel_projects_aspect` CHECK (`aspect` IN ('16:9', '9:16', '1:1', '4:5'));
