-- 0072 ai analyst assessments (OTSI VIE v2, MySQL 8.4): ADR-141 (ultra-only)
--
-- NUMBERING — read before renumbering anything: ultra is at 0071 (Token Wallet). Antigravity used 0067, 0068, 0069
-- AND 0070 in their own repo for different things, and their series may reach 0071/0072 for something else. This
-- migration is 0072 because it is the next number free in ULTRA as far as ultra can see — but the two repos must
-- never be merged, so a future collision is still possible. If that ever happens, the merge is the problem, not
-- this number: never renumber a migration that has run anywhere.
--
-- MODEL (scope: workspace/goals/otsi-video-intelligence-engine/files/ai-analyst-scope/ai-analyst-scope.md)
--   * One row per generated assessment (a regeneration is a new row, a new version, a new 10-token charge).
--   * The output is a DRAFT until a person publishes it (Rule 4): drafts never reach a club or a Scouting Pack.
--   * Audit trail (Rule 5): the exact input snapshot the model saw, the output, the model name and version, the
--     prompt version, the post-check result, and the publish state — all in this row. The general audit log
--     (audit_events, via recordChange) records who requested / generated / published what, with ids and counts
--     only; the snapshot itself lives here, not in the audit log (it is too large for audit rows).
--   * The provider is never stored here and no API key is ever stored anywhere: the provider + key come from the
--     environment (OTSI_VIE_AI_ANALYST_API_URL / API_KEY / MODEL) and only the model name is recorded.
--   * `failure` is set only when the deterministic post-check rejected the model output twice: the row records
--     the failure and the output stays NULL — no unverified text is ever stored or shown.
--   * Consent (scope §7 Option A): structured data leaves the machine only with the organization's explicit
--     opt-in. The generating member and time are recorded on the row (consent_by / consent_at); the privacy note
--     shown before the first analysis is AiAnalystProviderStatus.privacy_note in the contracts.
--
-- GRANTS: tools/db/roles.py builds grants from the live schema, so re-run it after migrating — this table gets
-- the usual SELECT, INSERT, UPDATE, DELETE for otsi_app (publish/unpublish update the row; it is not append-only
-- history). Nothing existing is altered.
--
-- Forward-only: one new table. Nothing existing is altered.

CREATE TABLE `ai_analyst_assessments` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `player_id` CHAR(36) NOT NULL,
  `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
  `language` CHAR(2) NOT NULL DEFAULT 'en',
  `input_snapshot` JSON NOT NULL,
  `output` JSON NULL,
  `model` VARCHAR(128) NOT NULL,
  `prompt_version` VARCHAR(32) NOT NULL,
  `post_check` JSON NOT NULL,
  `stale` TINYINT NOT NULL DEFAULT 0,
  `not_enough_data_reason` VARCHAR(500) NULL,
  `failure` VARCHAR(500) NULL,
  `requested_by` CHAR(36) NOT NULL,
  `consent_by` CHAR(36) NOT NULL,
  `consent_at` DATETIME(6) NOT NULL,
  `published_by` CHAR(36) NULL,
  `published_at` DATETIME(6) NULL,
  `version` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX `idx_ai_analyst_org_player` (`organization_id`, `player_id`, `created_at`),
  CONSTRAINT `fk_ai_analyst_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
