-- 0033 reel music (OTSI VIE v2, MySQL 8.4) — ADR-047, 2026-11-02 (owner: "no music user can add/upload")
-- A music file an organization uploads for its reels is a brand asset of kind MUSIC, carried by the same rights declaration as a logo
-- (0032): its `rights_grants` row allows REEL_AUDIO, and a render that uses it is refused when that grant is not in force. A fourth basis,
-- FREE_LICENCE, covers music whose free licence allows this use (for example Creative Commons BY), as the uploading person states it.
-- Forward-only: the two CHECK constraints of `brand_assets` are replaced by wider ones; no row changes.
ALTER TABLE `brand_assets` DROP CHECK `ck_ba_kind`;
ALTER TABLE `brand_assets` ADD CONSTRAINT `ck_ba_kind` CHECK (`kind` IN ('COMPETITION_LOGO', 'CUSTOM_LOGO', 'MUSIC'));
ALTER TABLE `brand_assets` DROP CHECK `ck_ba_basis`;
ALTER TABLE `brand_assets` ADD CONSTRAINT `ck_ba_basis` CHECK (`rights_basis` IN ('OWN_BRAND', 'LICENSED', 'PERMISSION', 'FREE_LICENCE'));
