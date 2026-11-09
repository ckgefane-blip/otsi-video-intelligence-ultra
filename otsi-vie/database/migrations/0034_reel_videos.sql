-- 0034 reel intro / outro videos (OTSI VIE v2, MySQL 8.4) — ADR-050, 2026-11-02 (owner: "engine should have options of adding intro/outro")
-- A video an organization uploads to open or close its reels is a brand asset of kind REEL_VIDEO, carried by the same rights declaration
-- as a logo or music (0032, 0033): its `rights_grants` row allows REEL_OVERLAY and REEL_AUDIO (it is seen and heard), and a render that
-- uses it is refused when that grant is not in force.
-- Forward-only: the kind CHECK constraint of `brand_assets` is replaced by a wider one; no row changes.
ALTER TABLE `brand_assets` DROP CHECK `ck_ba_kind`;
ALTER TABLE `brand_assets` ADD CONSTRAINT `ck_ba_kind` CHECK (`kind` IN ('COMPETITION_LOGO', 'CUSTOM_LOGO', 'MUSIC', 'REEL_VIDEO'));
