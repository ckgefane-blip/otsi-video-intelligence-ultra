-- 0018 canonical ID allocator without the deadlock-prone locking lookup (OTSI VIE v2, MySQL 8.4) — ADR-016 addendum, 2026-10-27
-- Root cause of the intermittent concurrent-registration failure: every concurrent issuance deadlocked in the same cycle
--   T1 holds S gap lock on canonical_id_issuances.uq_issuance_request (from `SET v = (SELECT ... WHERE request_key = ...)`, a locking
--      read inside a routine) and waits for the canonical_id_sequences row (X);
--   T2 holds that sequence row (X) and waits to insert its ledger row into T1's gap (insert intention).
-- MySQL rolled one back (1213); the API retried, and under load a request could exhaust its retries. IDs were never duplicated or
-- skipped (each victim rolls back completely), but requests failed. The lookup is now a non-locking consistent read.
-- Behaviour, outputs, error messages and lock order on the players and sequence rows are unchanged.

DROP PROCEDURE IF EXISTS sp_issue_canonical_player_id;

DELIMITER $$
CREATE PROCEDURE sp_issue_canonical_player_id(
  IN p_player_id CHAR(36),
  IN p_country VARCHAR(3) CHARACTER SET ascii,
  IN p_organization_id CHAR(36),
  IN p_issued_by CHAR(36),
  IN p_request_key VARCHAR(191),
  OUT p_canonical_id VARCHAR(20) CHARACTER SET ascii)
MODIFIES SQL DATA
SQL SECURITY DEFINER
proc: BEGIN
  DECLARE v_found INT DEFAULT 1;
  DECLARE v_state VARCHAR(16);
  DECLARE v_existing VARCHAR(20) CHARACTER SET ascii;
  DECLARE v_key_player CHAR(36);
  DECLARE v_key_cid VARCHAR(20) CHARACTER SET ascii;
  DECLARE v_year SMALLINT UNSIGNED;
  DECLARE v_seq INT UNSIGNED;
  DECLARE v_exhausted INT DEFAULT 0;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_found = 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  IF p_player_id IS NULL OR p_organization_id IS NULL OR p_issued_by IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ISSUER_AND_PLAYER_REQUIRED';
  END IF;
  IF p_country IS NULL OR NOT REGEXP_LIKE(p_country, '^[A-Z]{3}$', 'c') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='INVALID_COUNTRY_CODE';
  END IF;

  START TRANSACTION;
  IF p_request_key IS NOT NULL THEN
    -- a NON-locking consistent read (SELECT ... INTO). The former `SET v = (SELECT ...)` is a locking read inside a routine: it took a
    -- shared gap lock on uq_issuance_request and deadlocked against a concurrent issuance inserting its ledger row into that gap while
    -- holding the sequence row (InnoDB deadlock reports, release-evidence/id-issuance-load/20261027). Same-player races stay serialised
    -- by the players row lock below; a key reused for another player is still refused by uq_issuance_request.
    SELECT player_id, canonical_otsi_id INTO v_key_player, v_key_cid FROM canonical_id_issuances WHERE request_key = p_request_key;
    IF v_key_player IS NOT NULL THEN
      IF v_key_player <> p_player_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='REQUEST_KEY_ALREADY_USED_FOR_ANOTHER_PLAYER';
      END IF;
      SET p_canonical_id = v_key_cid;
      COMMIT;
      LEAVE proc;
    END IF;
  END IF;

  SET v_found = 1;
  SELECT canonical_state, canonical_otsi_id INTO v_state, v_existing FROM players WHERE id = p_player_id FOR UPDATE;
  IF v_found = 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PLAYER_NOT_FOUND'; END IF;
  IF v_existing IS NOT NULL THEN                       -- exactly once: an issued ID is returned, never re-issued
    SET p_canonical_id = v_existing;
    COMMIT;
    LEAVE proc;
  END IF;
  IF v_state <> 'PROVISIONAL' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PLAYER_NOT_ELIGIBLE_FOR_ISSUANCE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM countries WHERE code = p_country COLLATE ascii_bin AND active) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='INVALID_COUNTRY_CODE';
  END IF;

  SET v_year = YEAR(UTC_TIMESTAMP());
  -- ONE atomic statement reserves the next number and takes the row's exclusive lock at once (measured: "insert if missing, then
  -- SELECT ... FOR UPDATE" deadlocked under 40 concurrent issuances by upgrading a shared lock). Past 999999 the row's CHECK fails:
  -- that is reported as exhaustion, never wrapped around.
  BEGIN
    DECLARE EXIT HANDLER FOR 3819 SET v_exhausted = 1;
    INSERT INTO canonical_id_sequences (country_code, issue_year, last_sequence) VALUES (p_country, v_year, 1)
      ON DUPLICATE KEY UPDATE last_sequence = last_sequence + 1;
  END;
  IF v_exhausted = 1 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CANONICAL_SEQUENCE_EXHAUSTED'; END IF;
  SET v_found = 1;
  SELECT last_sequence INTO v_seq FROM canonical_id_sequences WHERE country_code = p_country COLLATE ascii_bin AND issue_year = v_year;
  IF v_found = 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SEQUENCE_UNAVAILABLE'; END IF;

  SET p_canonical_id = CONCAT('OTSI-', p_country, '-', LPAD(v_year, 4, '0'), '-', LPAD(v_seq, 6, '0'));
  INSERT INTO canonical_id_issuances (canonical_otsi_id, player_id, country_code, issue_year, sequence_number, issuing_organization_id, issued_by, request_key)
    VALUES (p_canonical_id, p_player_id, p_country, v_year, v_seq, p_organization_id, p_issued_by, p_request_key);
  UPDATE players SET canonical_otsi_id = p_canonical_id, canonical_state = 'REGISTERED' WHERE id = p_player_id;
  INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, after_state)
    VALUES (p_organization_id, p_issued_by, 'player.canonical_id_issued', 'player', p_player_id,
            JSON_OBJECT('canonical_otsi_id', p_canonical_id, 'country_code', p_country, 'issue_year', v_year, 'sequence_number', v_seq));
  COMMIT;
END$$
DELIMITER ;
