-- 0008 track <-> canonical identity integrity (OTSI VIE v2, MySQL 8.4) — ADR-016
-- Five identities are never interchangeable:
--   detection  = one `track_observations` row (a box at one timestamp)        track_id  = `tracks.id`, temporary, per processing run
--   player_id  = `players.id`, internal relational key                          canonical_otsi_id = permanent public ID (players, 0007)
--   jersey_number = observed (`match_rosters`, `player_jersey_numbers`), never an identity
-- A track becomes a player only through an appended `track_identity_decisions` row. Corrections append a superseding decision for the SAME
-- track; history is linear (each decision can be superseded once) and append-only (0005). A reel target pins the exact decision version it
-- was built on, for the SAME track and player, so a reused or reassigned track can never carry the spotlight to someone else.

ALTER TABLE `track_identity_decisions`
  ADD CONSTRAINT `uq_tid_id_track` UNIQUE (`id`, `track_id`),
  ADD CONSTRAINT `uq_tid_id_track_player` UNIQUE (`id`, `track_id`, `player_id`),
  ADD CONSTRAINT `uq_tid_supersedes_once` UNIQUE (`supersedes_id`),
  ADD CONSTRAINT `fk_tid_supersedes_same_track` FOREIGN KEY (`supersedes_id`, `track_id`) REFERENCES `track_identity_decisions` (`id`, `track_id`),
  ADD COLUMN `reason` TEXT NULL COMMENT 'why this decision was made (required for a human correction)';

ALTER TABLE `reel_targets`
  ADD CONSTRAINT `fk_reel_target_decision_same_track_player` FOREIGN KEY (`identity_decision_id`, `track_id`, `player_id`)
      REFERENCES `track_identity_decisions` (`id`, `track_id`, `player_id`),
  ADD CONSTRAINT `ck_reel_target_pinned` CHECK ((`identity_decision_id` IS NULL) = (`player_id` IS NULL));

DELIMITER $$
-- a decision may only name a live identity: a merged duplicate must be resolved to its survivor first; a retired record cannot gain tracks
CREATE TRIGGER trg_tid_target_is_live BEFORE INSERT ON track_identity_decisions FOR EACH ROW
BEGIN
  DECLARE v_state VARCHAR(16);
  IF NEW.player_id IS NOT NULL THEN
    SET v_state = (SELECT canonical_state FROM players WHERE id = NEW.player_id);
    IF v_state IN ('MERGED', 'RETIRED') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IDENTITY_DECISION_TARGET_NOT_LIVE';
    END IF;
  END IF;
  IF NEW.supersedes_id IS NOT NULL AND NEW.basis = 'HUMAN' AND (NEW.reason IS NULL OR CHAR_LENGTH(TRIM(NEW.reason)) < 3) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CORRECTION_REASON_REQUIRED';
  END IF;
END$$
DELIMITER ;

-- the CURRENT decision of every track = the one nobody superseded; unresolved tracks have none and stay "Unidentified Player"
CREATE VIEW `v_track_current_identity` AS
SELECT d.track_id, d.id AS decision_id, d.state, d.player_id, d.basis, d.decided_by, d.decided_at
FROM track_identity_decisions d
WHERE NOT EXISTS (SELECT 1 FROM track_identity_decisions n WHERE n.supersedes_id = d.id);
