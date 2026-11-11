-- 0073 scouting packs (OTSI VIE v2, MySQL 8.4): ADR-142 (ultra-only)
--
-- NUMBERING — read before renumbering anything: ultra is at 0072 (AI Analyst). Antigravity used 0067, 0068, 0069
-- AND 0070 in their own repo for different things, and their series may reach 0071/0072/0073 for something else.
-- This migration is 0073 because it is the next number free in ULTRA as far as ultra can see — but the two repos
-- must never be merged, so a future collision is still possible. If that ever happens, the merge is the problem,
-- not this number: never renumber a migration that has run anywhere.
--
-- MODEL (Roadmap Phase 4, Option B: Single Match Spotlight + Scouting Pack)
--   * One row per Pack. A Pack is the named export bundle for a club: the highlight reel (Player Profile Intro
--     first, then the moments per Best Moment Rule v2.1), the player report, and the AI Analyst brief when
--     published — as ONE ZIP with a manifest. The reel source is recorded: SINGLE_MATCH (the Single Match
--     Spotlight: one reel + one report for one match) or CROSS_MATCH (the same bundle over a cross-match reel,
--     all matches). The reel is the source of truth for the source: a MATCH reel is SINGLE_MATCH, an
--     ALL_MATCHES reel is CROSS_MATCH.
--   * The manifest is stored as JSON (the same manifest.json that goes in the ZIP): what is inside, which
--     match(es), which player, the rule version stamped, and which items are included or excluded and why.
--     The manifest is the Pack's honesty record — it is written once, from the build, and never edited after.
--   * Cost: a Pack is an export pack — 10 tokens, charged at enqueue (ADR-140, job type EXPORT_PACK) in the
--     same transaction as this row, so a Pack that fails to start charges nothing. The reel, report and brief
--     inside the Pack are covered by that one charge and are never charged again. A Pack whose build fails
--     after the charge is auto-refunded (see the API module) and left FAILED.
--   * The ZIP is an asset (kind BUNDLE, like the export-bundle ZIP), referenced by zip_asset_id; the files
--     inside the ZIP are the finished render file, the player report PDF when made, the published Analyst
--     brief as JSON when one exists, and manifest.json. A draft Analyst brief is NEVER written into the ZIP:
--     the manifest records it as EXCLUDED with its reason instead.
--
-- GRANTS: tools/db/roles.py builds grants from the live schema, so re-run it after migrating — this table gets
-- the usual SELECT, INSERT, UPDATE, DELETE for otsi_app (state moves CREATED -> READY / FAILED as the build
-- runs; it is not append-only history). Nothing existing is altered.
--
-- Forward-only: one new table. Nothing existing is altered.

CREATE TABLE `scouting_packs` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `player_id` CHAR(36) NOT NULL,
  `reel_id` CHAR(36) NOT NULL,
  `reel_source` ENUM('SINGLE_MATCH', 'CROSS_MATCH') NOT NULL,
  `state` ENUM('CREATED', 'READY', 'FAILED') NOT NULL DEFAULT 'CREATED',
  `manifest` JSON NOT NULL,
  `cost_tokens` INT NOT NULL DEFAULT 10,
  `zip_asset_id` CHAR(36) NULL,
  `requested_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `completed_at` DATETIME(6) NULL,
  INDEX `idx_scouting_packs_org_player` (`organization_id`, `player_id`, `created_at`),
  INDEX `idx_scouting_packs_reel` (`organization_id`, `reel_id`, `created_at`),
  CONSTRAINT `fk_scouting_packs_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
