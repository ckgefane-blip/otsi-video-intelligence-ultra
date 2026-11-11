-- Hand-written SQLite equivalents of the MySQL triggers in the migrations.
-- Read by tools/db/sqlite_translate.py (load_overlay), one section per migration
-- (`-- == NNNN ==`). Do NOT use DELIMITER here: the translator splits this file
-- with sqlite3.complete_statement(), which keeps CREATE TRIGGER ... BEGIN ... END;
-- in one piece.
--
-- Rules:
-- * SIGNAL SQLSTATE '45000' becomes SELECT RAISE(ABORT, '<message>'); the message
--   text is kept EXACTLY, because apps/api/src/core/problem.ts maps these codes.
-- * `NEW.x <=> OLD.x` (MySQL null-safe equality) becomes `NEW.x IS OLD.x`.
-- * A MySQL trigger with several SIGNALs becomes ONE SQLite trigger holding
--   one `SELECT RAISE(ABORT, '<message>') WHERE <condition>;` per check, in the
--   MySQL order. (RAISE takes a literal message only, and SQLite fires
--   same-table triggers alphabetically, not in creation order, so separate
--   triggers could report the checks in the wrong order. A SELECT whose WHERE
--   is false produces no rows, so its RAISE never fires.)
-- * The retention-account DELETE exception (USER() LIKE 'otsi\_retention%') cannot
--   be expressed in SQLite — there is no USER(). Those DELETE triggers refuse every
--   DELETE; the retention path deletes through the adapter's retention bypass
--   (RetentionService, apps/api/src/modules/retention/retention.ts) instead.
--   The one exception is wallet_ledger (0071), whose MySQL triggers already refuse
--   everyone including retention, so the SQLite version matches exactly.
-- * MySQL `SET NEW.updated_at = ...` (0002) cannot be written in a SQLite trigger
--   (NEW is read-only). It becomes an AFTER UPDATE trigger that updates the same
--   row once, guarded by WHEN NEW.updated_at = OLD.updated_at and by stamping
--   MAX(now_ms, OLD.updated_at+1), so the recursive firing sees a changed value
--   and stops after exactly one extra write. A user UPDATE that sets updated_at
--   explicitly does not get the version bump on SQLite; the application never
--   sets updated_at itself (it relies on the trigger), so this is a documented
--   divergence, not a behaviour the app depends on.

-- == 0002 ==
CREATE TRIGGER `trg_projects_update` AFTER UPDATE ON `projects`
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
  UPDATE `projects` SET `updated_at` = MAX((CAST(unixepoch('subsec')*1000 AS INTEGER)), OLD.`updated_at`+1),
    `version` = OLD.`version`+1 WHERE `id` = NEW.`id`;
END;
CREATE TRIGGER `trg_reels_update` AFTER UPDATE ON `reel_projects`
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
  UPDATE `reel_projects` SET `updated_at` = MAX((CAST(unixepoch('subsec')*1000 AS INTEGER)), OLD.`updated_at`+1),
    `version` = OLD.`version`+1 WHERE `id` = NEW.`id`;
END;
CREATE TRIGGER `trg_render_transition` BEFORE UPDATE ON `render_jobs`
BEGIN
  SELECT RAISE(ABORT, 'INVALID_RENDER_STATE_TRANSITION')
  WHERE NEW.`state` <> OLD.`state` AND NOT (
    (OLD.`state`='QUEUED' AND NEW.`state` IN ('RUNNING','CANCELLED','BLOCKED')) OR
    (OLD.`state`='RUNNING' AND NEW.`state` IN ('SUCCEEDED','FAILED','CANCELLED','REVIEW_REQUIRED','BLOCKED')) OR
    (OLD.`state`='REVIEW_REQUIRED' AND NEW.`state` IN ('QUEUED','BLOCKED','CANCELLED')) OR
    (OLD.`state`='FAILED' AND NEW.`state`='QUEUED'));
  SELECT RAISE(ABORT, 'RENDER_ASSET_AND_MANIFEST_REQUIRED')
  WHERE NEW.`state`='SUCCEEDED' AND (NEW.`output_asset_id` IS NULL OR NEW.`manifest_asset_id` IS NULL);
END;

-- == 0005 ==
CREATE TRIGGER `trg_audit_events_no_update` BEFORE UPDATE ON `audit_events`
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENTS_APPEND_ONLY');
END;
CREATE TRIGGER `trg_audit_events_no_delete` BEFORE DELETE ON `audit_events`
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_EVENTS_APPEND_ONLY');
END;
CREATE TRIGGER `trg_identity_decisions_no_update` BEFORE UPDATE ON `track_identity_decisions`
BEGIN
  SELECT RAISE(ABORT, 'IDENTITY_DECISIONS_APPEND_ONLY: add a new decision with supersedes_id');
END;
CREATE TRIGGER `trg_identity_decisions_no_delete` BEFORE DELETE ON `track_identity_decisions`
BEGIN
  SELECT RAISE(ABORT, 'IDENTITY_DECISIONS_APPEND_ONLY');
END;
CREATE TRIGGER `trg_event_decisions_no_update` BEFORE UPDATE ON `event_decisions`
BEGIN
  SELECT RAISE(ABORT, 'EVENT_DECISIONS_APPEND_ONLY: add a new decision');
END;
CREATE TRIGGER `trg_event_decisions_no_delete` BEFORE DELETE ON `event_decisions`
BEGIN
  SELECT RAISE(ABORT, 'EVENT_DECISIONS_APPEND_ONLY');
END;
CREATE TRIGGER `trg_identity_review_no_update` BEFORE UPDATE ON `identity_review_history`
BEGIN
  SELECT RAISE(ABORT, 'IDENTITY_REVIEW_HISTORY_APPEND_ONLY');
END;
CREATE TRIGGER `trg_identity_review_no_delete` BEFORE DELETE ON `identity_review_history`
BEGIN
  SELECT RAISE(ABORT, 'IDENTITY_REVIEW_HISTORY_APPEND_ONLY');
END;

-- == 0007 ==
CREATE TRIGGER `trg_players_insert_guard` BEFORE INSERT ON `players`
BEGIN
  SELECT RAISE(ABORT, 'CANONICAL_ID_ONLY_BY_ALLOCATOR')
  WHERE NEW.`canonical_otsi_id` IS NOT NULL;
  SELECT RAISE(ABORT, 'NEW_PLAYERS_ARE_PROVISIONAL')
  WHERE NEW.`canonical_state` <> 'PROVISIONAL';
END;
CREATE TRIGGER `trg_players_update_guard` BEFORE UPDATE ON `players`
BEGIN
  SELECT RAISE(ABORT, 'CANONICAL_ID_IMMUTABLE')
  WHERE OLD.`canonical_otsi_id` IS NOT NULL AND NEW.`canonical_otsi_id` IS NOT OLD.`canonical_otsi_id`;
  SELECT RAISE(ABORT, 'CANONICAL_ID_NOT_ISSUED_TO_THIS_PLAYER')
  WHERE OLD.`canonical_otsi_id` IS NULL AND NEW.`canonical_otsi_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `canonical_id_issuances` i
                    WHERE i.`canonical_otsi_id` = NEW.`canonical_otsi_id` AND i.`player_id` = NEW.`id`);
  SELECT RAISE(ABORT, 'MERGE_IS_FINAL')
  WHERE OLD.`canonical_state` = 'MERGED'
    AND (NEW.`canonical_state` <> 'MERGED' OR NEW.`merged_into_player_id` IS NOT OLD.`merged_into_player_id`);
  SELECT RAISE(ABORT, 'REGISTERED_PLAYER_CANNOT_BECOME_PROVISIONAL')
  WHERE OLD.`canonical_state` IN ('REGISTERED', 'RETIRED') AND NEW.`canonical_state` = 'PROVISIONAL';
  SELECT RAISE(ABORT, 'MERGE_NEEDS_A_RECORDED_DECISION')
  WHERE NEW.`canonical_state` = 'MERGED' AND OLD.`canonical_state` <> 'MERGED'
    AND NOT EXISTS (SELECT 1 FROM `player_merges` m
                    WHERE m.`from_player_id` = NEW.`id` AND m.`into_player_id` = NEW.`merged_into_player_id`);
  SELECT RAISE(ABORT, 'PLAYER_PROVENANCE_IMMUTABLE')
  WHERE NEW.`created_by_organization_id` IS NOT OLD.`created_by_organization_id`;
END;
CREATE TRIGGER `trg_players_delete_guard` BEFORE DELETE ON `players`
WHEN OLD.`canonical_otsi_id` IS NOT NULL OR OLD.`canonical_state` <> 'PROVISIONAL'
BEGIN
  SELECT RAISE(ABORT, 'REGISTERED_PLAYERS_ARE_NEVER_DELETED');
END;
CREATE TRIGGER `trg_sequences_only_advance` BEFORE UPDATE ON `canonical_id_sequences`
WHEN NEW.`last_sequence` <> OLD.`last_sequence` + 1
  OR NEW.`country_code` <> OLD.`country_code` OR NEW.`issue_year` <> OLD.`issue_year`
BEGIN
  SELECT RAISE(ABORT, 'SEQUENCE_ONLY_ADVANCES_BY_ONE');
END;
CREATE TRIGGER `trg_sequences_no_delete` BEFORE DELETE ON `canonical_id_sequences`
BEGIN
  SELECT RAISE(ABORT, 'SEQUENCES_ARE_NEVER_DELETED');
END;
CREATE TRIGGER `trg_issuances_no_update` BEFORE UPDATE ON `canonical_id_issuances`
BEGIN
  SELECT RAISE(ABORT, 'ISSUED_CANONICAL_IDS_ARE_IMMUTABLE');
END;
CREATE TRIGGER `trg_issuances_no_delete` BEFORE DELETE ON `canonical_id_issuances`
BEGIN
  SELECT RAISE(ABORT, 'ISSUED_CANONICAL_IDS_ARE_NEVER_DELETED');
END;
CREATE TRIGGER `trg_merges_no_update` BEFORE UPDATE ON `player_merges`
BEGIN
  SELECT RAISE(ABORT, 'PLAYER_MERGES_APPEND_ONLY');
END;
CREATE TRIGGER `trg_merges_no_delete` BEFORE DELETE ON `player_merges`
BEGIN
  SELECT RAISE(ABORT, 'PLAYER_MERGES_APPEND_ONLY');
END;

-- == 0008 ==
CREATE TRIGGER `trg_tid_target_is_live` BEFORE INSERT ON `track_identity_decisions`
BEGIN
  SELECT RAISE(ABORT, 'IDENTITY_DECISION_TARGET_NOT_LIVE')
  WHERE NEW.`player_id` IS NOT NULL
    AND EXISTS (SELECT 1 FROM `players` WHERE `id` = NEW.`player_id`
                AND `canonical_state` IN ('MERGED', 'RETIRED'));
  SELECT RAISE(ABORT, 'CORRECTION_REASON_REQUIRED')
  WHERE NEW.`supersedes_id` IS NOT NULL AND NEW.`basis` = 'HUMAN'
    AND (NEW.`reason` IS NULL OR length(trim(NEW.`reason`)) < 3);
END;

-- == 0014 ==
CREATE TRIGGER `trg_link_decisions_no_update` BEFORE UPDATE ON `track_link_decisions`
BEGIN
  SELECT RAISE(ABORT, 'LINK_DECISIONS_APPEND_ONLY: add a new decision with supersedes_id');
END;
CREATE TRIGGER `trg_link_decisions_no_delete` BEFORE DELETE ON `track_link_decisions`
BEGIN
  SELECT RAISE(ABORT, 'LINK_DECISIONS_APPEND_ONLY');
END;
CREATE TRIGGER `trg_link_decisions_reason` BEFORE INSERT ON `track_link_decisions`
WHEN NEW.`supersedes_id` IS NOT NULL AND (NEW.`reason` IS NULL OR length(trim(NEW.`reason`)) < 3)
BEGIN
  SELECT RAISE(ABORT, 'CORRECTION_REASON_REQUIRED');
END;

-- == 0016 ==
CREATE TRIGGER `trg_roster_changes_no_update` BEFORE UPDATE ON `match_roster_changes`
BEGIN
  SELECT RAISE(ABORT, 'ROSTER_CHANGES_APPEND_ONLY');
END;
CREATE TRIGGER `trg_roster_changes_no_delete` BEFORE DELETE ON `match_roster_changes`
BEGIN
  SELECT RAISE(ABORT, 'ROSTER_CHANGES_APPEND_ONLY');
END;
CREATE TRIGGER `trg_team_assign_no_update` BEFORE UPDATE ON `run_team_assignments`
BEGIN
  SELECT RAISE(ABORT, 'TEAM_ASSIGNMENTS_APPEND_ONLY: add a new decision with supersedes_id');
END;
CREATE TRIGGER `trg_team_assign_no_delete` BEFORE DELETE ON `run_team_assignments`
BEGIN
  SELECT RAISE(ABORT, 'TEAM_ASSIGNMENTS_APPEND_ONLY');
END;
CREATE TRIGGER `trg_team_assign_reason` BEFORE INSERT ON `run_team_assignments`
WHEN NEW.`supersedes_id` IS NOT NULL AND (NEW.`reason` IS NULL OR length(trim(NEW.`reason`)) < 3)
BEGIN
  SELECT RAISE(ABORT, 'CORRECTION_REASON_REQUIRED');
END;
CREATE TRIGGER `trg_jersey_decisions_no_update` BEFORE UPDATE ON `jersey_number_decisions`
BEGIN
  SELECT RAISE(ABORT, 'JERSEY_DECISIONS_APPEND_ONLY: add a new decision with supersedes_id');
END;
CREATE TRIGGER `trg_jersey_decisions_no_delete` BEFORE DELETE ON `jersey_number_decisions`
BEGIN
  SELECT RAISE(ABORT, 'JERSEY_DECISIONS_APPEND_ONLY');
END;
CREATE TRIGGER `trg_jersey_decisions_reason` BEFORE INSERT ON `jersey_number_decisions`
WHEN NEW.`supersedes_id` IS NOT NULL AND (NEW.`reason` IS NULL OR length(trim(NEW.`reason`)) < 3)
BEGIN
  SELECT RAISE(ABORT, 'CORRECTION_REASON_REQUIRED');
END;

-- == 0071 ==
CREATE TRIGGER `trg_wallet_ledger_no_update` BEFORE UPDATE ON `wallet_ledger`
BEGIN
  SELECT RAISE(ABORT, 'wallet_ledger is immutable: correct a row with a new ADJUSTMENT or REFUND row, never by updating it');
END;
CREATE TRIGGER `trg_wallet_ledger_no_delete` BEFORE DELETE ON `wallet_ledger`
BEGIN
  SELECT RAISE(ABORT, 'wallet_ledger is immutable: rows are never deleted');
END;
