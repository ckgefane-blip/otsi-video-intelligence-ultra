-- 0007 canonical player registry and allocator (OTSI VIE v2, MySQL 8.4) — ADR-016
-- One permanent, immutable, public OTSI Player ID per registered player:  OTSI-CCC-YYYY-NNNNNN  (exactly 20 characters).
--   CCC  = country code recorded at issuance (table `countries`, 0006); an issuance attribute, never updated when nationality changes
--   YYYY = UTC year of issuance (taken from the server clock by the allocator, never from the caller)
--   NNNNNN = sequence within the (CCC, YYYY) namespace: the allocation scope. The prefix makes every namespace disjoint, so the full ID is
--          globally unique; UNIQUE keys on the ID and on (country, year, sequence) enforce it again.
-- Lifecycle: PROVISIONAL (imported/unverified: NO canonical ID) -> REGISTERED (ID issued exactly once by sp_issue_canonical_player_id)
--            -> RETIRED (still REGISTERED identity, ID kept) | MERGED (a duplicate; ID kept for ever, resolves to the survivor).
-- The ID is issued ONLY by the allocator procedure; triggers refuse every other way of setting or changing it; issued IDs are never deleted,
-- updated or reused. The internal UUID `players.id` stays the relational key; `canonical_otsi_id` is its one permanent public counterpart.

-- ---------------------------------------------------------------- players: canonical columns, states and provenance
ALTER TABLE `players`
  DROP CHECK `players_chk_1`,
  DROP CHECK `ck_players_verified_id`,
  DROP INDEX `canonical_otsi_id`;

ALTER TABLE `players`
  MODIFY `canonical_otsi_id` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY `canonical_state` VARCHAR(16) NOT NULL DEFAULT 'PROVISIONAL',
  ADD COLUMN `created_by_organization_id` CHAR(36) NULL COMMENT 'tenant that created the record; a PROVISIONAL player is visible only to it',
  ADD COLUMN `creation_key` VARCHAR(191) NULL COMMENT 'client idempotency key: retrying the same create returns the same player',
  ADD COLUMN `merged_into_player_id` CHAR(36) NULL,
  ADD COLUMN `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  ADD COLUMN `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6);

-- existing rows (none on a fresh install): the old states map one-to-one
UPDATE `players` SET `canonical_state` = CASE `canonical_state` WHEN 'PENDING' THEN 'PROVISIONAL' WHEN 'VERIFIED' THEN 'REGISTERED' ELSE `canonical_state` END;

-- ---------------------------------------------------------------- the issuance ledger (authority for every canonical ID)
CREATE TABLE `canonical_id_sequences` (
  `country_code` VARCHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `issue_year` SMALLINT UNSIGNED NOT NULL,
  `last_sequence` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`country_code`, `issue_year`),
  CONSTRAINT `fk_seq_country` FOREIGN KEY (`country_code`) REFERENCES `countries` (`code`),
  CONSTRAINT `ck_seq_range` CHECK (`last_sequence` <= 999999),
  CONSTRAINT `ck_seq_year` CHECK (`issue_year` BETWEEN 2000 AND 9999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `canonical_id_issuances` (
  `canonical_otsi_id` VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  `player_id` CHAR(36) NOT NULL,
  `country_code` VARCHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `issue_year` SMALLINT UNSIGNED NOT NULL,
  `sequence_number` INT UNSIGNED NOT NULL,
  `issuing_organization_id` CHAR(36) NOT NULL,
  `issued_by` CHAR(36) NOT NULL,
  `request_key` VARCHAR(191) NULL COMMENT 'idempotent retry key of the issuing request',
  `issued_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `uq_issuance_player` UNIQUE (`player_id`),
  CONSTRAINT `uq_issuance_namespace` UNIQUE (`country_code`, `issue_year`, `sequence_number`),
  CONSTRAINT `uq_issuance_request` UNIQUE (`request_key`),
  CONSTRAINT `fk_issuance_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_issuance_country` FOREIGN KEY (`country_code`) REFERENCES `countries` (`code`),
  CONSTRAINT `fk_issuance_org` FOREIGN KEY (`issuing_organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_issuance_user` FOREIGN KEY (`issued_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_issuance_format` CHECK (REGEXP_LIKE(`canonical_otsi_id`, '^OTSI-[A-Z]{3}-[0-9]{4}-[0-9]{6}$', 'c')),
  CONSTRAINT `ck_issuance_parts` CHECK (`canonical_otsi_id` = CONCAT('OTSI-', `country_code`, '-', LPAD(`issue_year`, 4, '0'), '-', LPAD(`sequence_number`, 6, '0'))),
  CONSTRAINT `ck_issuance_sequence` CHECK (`sequence_number` BETWEEN 1 AND 999999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `players`
  ADD CONSTRAINT `uq_players_canonical_otsi_id` UNIQUE (`canonical_otsi_id`),
  ADD CONSTRAINT `uq_players_creation` UNIQUE (`created_by_organization_id`, `creation_key`),
  ADD CONSTRAINT `fk_players_issuance` FOREIGN KEY (`canonical_otsi_id`) REFERENCES `canonical_id_issuances` (`canonical_otsi_id`),
  ADD CONSTRAINT `fk_players_created_by_org` FOREIGN KEY (`created_by_organization_id`) REFERENCES `organizations` (`id`),
  ADD CONSTRAINT `fk_players_merged_into` FOREIGN KEY (`merged_into_player_id`) REFERENCES `players` (`id`),
  ADD CONSTRAINT `ck_players_state` CHECK (`canonical_state` IN ('PROVISIONAL', 'REGISTERED', 'RETIRED', 'MERGED')),
  ADD CONSTRAINT `ck_players_canonical_format` CHECK (`canonical_otsi_id` IS NULL OR REGEXP_LIKE(`canonical_otsi_id`, '^OTSI-[A-Z]{3}-[0-9]{4}-[0-9]{6}$', 'c')),
  ADD CONSTRAINT `ck_players_state_id` CHECK ((`canonical_state` = 'PROVISIONAL' AND `canonical_otsi_id` IS NULL)
                                              OR (`canonical_state` IN ('REGISTERED', 'RETIRED') AND `canonical_otsi_id` IS NOT NULL)
                                              OR `canonical_state` = 'MERGED'),
  ADD CONSTRAINT `ck_players_merge` CHECK ((`canonical_state` = 'MERGED') = (`merged_into_player_id` IS NOT NULL)),
  ADD CONSTRAINT `ck_players_not_self_merged` CHECK (`merged_into_player_id` IS NULL OR `merged_into_player_id` <> `id`);

-- ---------------------------------------------------------------- registry history (identity attributes change; the ID never does)
CREATE TABLE `player_merges` (
  `id` CHAR(36) PRIMARY KEY,
  `from_player_id` CHAR(36) NOT NULL,
  `into_player_id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `decided_by` CHAR(36) NOT NULL,
  `reason` TEXT NOT NULL,
  `evidence_id` CHAR(36) NULL,
  `decided_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `uq_merge_from` UNIQUE (`from_player_id`),
  CONSTRAINT `fk_merge_from` FOREIGN KEY (`from_player_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_merge_into` FOREIGN KEY (`into_player_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_merge_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_merge_user` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_merge_evidence` FOREIGN KEY (`evidence_id`) REFERENCES `evidence_records` (`id`),
  CONSTRAINT `ck_merge_distinct` CHECK (`from_player_id` <> `into_player_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `player_external_ids` (
  `id` CHAR(36) PRIMARY KEY,
  `player_id` CHAR(36) NOT NULL,
  `source` VARCHAR(64) NOT NULL COMMENT 'e.g. OTSI_WEBSITE, FEDERATION, TRANSFERMARKT',
  `external_id` VARCHAR(191) NOT NULL,
  `recorded_by` CHAR(36) NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `uq_external_id` UNIQUE (`source`, `external_id`),
  CONSTRAINT `fk_extid_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_extid_user` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `player_aliases` (
  `id` CHAR(36) PRIMARY KEY,
  `player_id` CHAR(36) NOT NULL,
  `alias` VARCHAR(255) NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `source` VARCHAR(64) NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `uq_player_alias` UNIQUE (`player_id`, `alias`),
  CONSTRAINT `fk_alias_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`),
  CONSTRAINT `ck_alias_kind` CHECK (`kind` IN ('NAME_VARIANT', 'TRANSLITERATION', 'FORMER_NAME', 'NICKNAME'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `player_nationalities` (
  `id` CHAR(36) PRIMARY KEY,
  `player_id` CHAR(36) NOT NULL,
  `country_code` VARCHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `valid_from` DATE NULL,
  `valid_to` DATE NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_nat_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_nat_country` FOREIGN KEY (`country_code`) REFERENCES `countries` (`code`),
  CONSTRAINT `ck_nat_kind` CHECK (`kind` IN ('CITIZENSHIP', 'SPORTING')),
  CONSTRAINT `ck_nat_dates` CHECK (`valid_to` IS NULL OR `valid_from` IS NULL OR `valid_to` >= `valid_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `player_club_memberships` (
  `id` CHAR(36) PRIMARY KEY,
  `player_id` CHAR(36) NOT NULL,
  `club_id` CHAR(36) NOT NULL,
  `valid_from` DATE NOT NULL,
  `valid_to` DATE NULL,
  `source` VARCHAR(64) NULL,
  `recorded_by` CHAR(36) NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_membership_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_membership_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`),
  CONSTRAINT `fk_membership_user` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_membership_dates` CHECK (`valid_to` IS NULL OR `valid_to` >= `valid_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX `idx_membership_player_time` ON `player_club_memberships` (`player_id`, `valid_from`);

CREATE TABLE `player_jersey_numbers` (
  `id` CHAR(36) PRIMARY KEY,
  `player_id` CHAR(36) NOT NULL,
  `club_id` CHAR(36) NULL,
  `jersey_number` SMALLINT UNSIGNED NOT NULL,
  `valid_from` DATE NOT NULL,
  `valid_to` DATE NULL,
  `source` VARCHAR(64) NULL,
  `recorded_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_jersey_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_jersey_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`),
  CONSTRAINT `ck_jersey_range` CHECK (`jersey_number` BETWEEN 0 AND 99),
  CONSTRAINT `ck_jersey_dates` CHECK (`valid_to` IS NULL OR `valid_to` >= `valid_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX `idx_jersey_player_time` ON `player_jersey_numbers` (`player_id`, `valid_from`);

CREATE TABLE `player_duplicate_candidates` (
  `id` CHAR(36) PRIMARY KEY,
  `player_a_id` CHAR(36) NOT NULL,
  `player_b_id` CHAR(36) NOT NULL,
  `score` FLOAT NOT NULL,
  `basis` JSON NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  `reviewed_by` CHAR(36) NULL,
  `reviewed_at` DATETIME(6) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `uq_duplicate_pair` UNIQUE (`player_a_id`, `player_b_id`),
  CONSTRAINT `fk_dup_a` FOREIGN KEY (`player_a_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_dup_b` FOREIGN KEY (`player_b_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_dup_reviewer` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_dup_order` CHECK (`player_a_id` < `player_b_id`),
  CONSTRAINT `ck_dup_score` CHECK (`score` BETWEEN 0 AND 1),
  CONSTRAINT `ck_dup_status` CHECK (`status` IN ('OPEN', 'CONFIRMED_DUPLICATE', 'NOT_DUPLICATE')),
  CONSTRAINT `ck_dup_review` CHECK (`status` = 'OPEN' OR `reviewed_by` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------- integrity triggers
DELIMITER $$
CREATE TRIGGER trg_players_insert_guard BEFORE INSERT ON players FOR EACH ROW
BEGIN
  IF NEW.canonical_otsi_id IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CANONICAL_ID_ONLY_BY_ALLOCATOR'; END IF;
  IF NEW.canonical_state <> 'PROVISIONAL' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='NEW_PLAYERS_ARE_PROVISIONAL'; END IF;
END$$

CREATE TRIGGER trg_players_update_guard BEFORE UPDATE ON players FOR EACH ROW
BEGIN
  IF OLD.canonical_otsi_id IS NOT NULL AND NOT (NEW.canonical_otsi_id <=> OLD.canonical_otsi_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CANONICAL_ID_IMMUTABLE';
  END IF;
  IF OLD.canonical_otsi_id IS NULL AND NEW.canonical_otsi_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM canonical_id_issuances i WHERE i.canonical_otsi_id = NEW.canonical_otsi_id AND i.player_id = NEW.id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CANONICAL_ID_NOT_ISSUED_TO_THIS_PLAYER';
  END IF;
  IF OLD.canonical_state = 'MERGED' AND (NEW.canonical_state <> 'MERGED' OR NOT (NEW.merged_into_player_id <=> OLD.merged_into_player_id)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='MERGE_IS_FINAL';
  END IF;
  IF OLD.canonical_state IN ('REGISTERED', 'RETIRED') AND NEW.canonical_state = 'PROVISIONAL' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='REGISTERED_PLAYER_CANNOT_BECOME_PROVISIONAL';
  END IF;
  IF NEW.canonical_state = 'MERGED' AND OLD.canonical_state <> 'MERGED' THEN
    IF NOT EXISTS (SELECT 1 FROM player_merges m WHERE m.from_player_id = NEW.id AND m.into_player_id = NEW.merged_into_player_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='MERGE_NEEDS_A_RECORDED_DECISION';
    END IF;
  END IF;
  IF NOT (NEW.created_by_organization_id <=> OLD.created_by_organization_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PLAYER_PROVENANCE_IMMUTABLE';
  END IF;
END$$

CREATE TRIGGER trg_players_delete_guard BEFORE DELETE ON players FOR EACH ROW
BEGIN
  IF OLD.canonical_otsi_id IS NOT NULL OR OLD.canonical_state <> 'PROVISIONAL' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='REGISTERED_PLAYERS_ARE_NEVER_DELETED';
  END IF;
END$$

CREATE TRIGGER trg_sequences_only_advance BEFORE UPDATE ON canonical_id_sequences FOR EACH ROW
BEGIN
  IF NEW.last_sequence <> OLD.last_sequence + 1 OR NEW.country_code <> OLD.country_code OR NEW.issue_year <> OLD.issue_year THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SEQUENCE_ONLY_ADVANCES_BY_ONE';
  END IF;
END$$
CREATE TRIGGER trg_sequences_no_delete BEFORE DELETE ON canonical_id_sequences FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SEQUENCES_ARE_NEVER_DELETED'; END$$

CREATE TRIGGER trg_issuances_no_update BEFORE UPDATE ON canonical_id_issuances FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ISSUED_CANONICAL_IDS_ARE_IMMUTABLE'; END$$
CREATE TRIGGER trg_issuances_no_delete BEFORE DELETE ON canonical_id_issuances FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ISSUED_CANONICAL_IDS_ARE_NEVER_DELETED'; END$$

CREATE TRIGGER trg_merges_no_update BEFORE UPDATE ON player_merges FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PLAYER_MERGES_APPEND_ONLY'; END$$
CREATE TRIGGER trg_merges_no_delete BEFORE DELETE ON player_merges FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PLAYER_MERGES_APPEND_ONLY'; END$$

-- ---------------------------------------------------------------- the allocator: the ONLY way a canonical ID is issued
-- Owns its transaction (call it OUTSIDE an open transaction). Locks the player row, then the (country, year) sequence row, so concurrent
-- requests serialize per namespace and per player. Idempotent: a player that already has an ID gets that ID back; a repeated request_key
-- returns the ID it issued (and refuses to issue for a different player under the same key).
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
    SET v_key_player = (SELECT player_id FROM canonical_id_issuances WHERE request_key = p_request_key);
    IF v_key_player IS NOT NULL THEN
      IF v_key_player <> p_player_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='REQUEST_KEY_ALREADY_USED_FOR_ANOTHER_PLAYER';
      END IF;
      SET p_canonical_id = (SELECT canonical_otsi_id FROM canonical_id_issuances WHERE request_key = p_request_key);
      COMMIT;
      LEAVE proc;
    END IF;
  END IF;

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

-- ---------------------------------------------------------------- controlled merge (both IDs survive; history is not rewritten)
CREATE PROCEDURE sp_merge_players(
  IN p_merge_id CHAR(36),
  IN p_from_player_id CHAR(36),
  IN p_into_player_id CHAR(36),
  IN p_organization_id CHAR(36),
  IN p_decided_by CHAR(36),
  IN p_reason TEXT,
  IN p_evidence_id CHAR(36))
MODIFIES SQL DATA
SQL SECURITY DEFINER
BEGIN
  DECLARE v_from_state VARCHAR(16);
  DECLARE v_into_state VARCHAR(16);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  IF p_from_player_id = p_into_player_id THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CANNOT_MERGE_A_PLAYER_INTO_ITSELF'; END IF;
  IF p_reason IS NULL OR CHAR_LENGTH(TRIM(p_reason)) < 3 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='MERGE_REASON_REQUIRED'; END IF;
  START TRANSACTION;
  -- lock both rows in a fixed order (by id) so two opposite merges cannot deadlock or both succeed
  SELECT canonical_state INTO v_from_state FROM players WHERE id = LEAST(p_from_player_id, p_into_player_id) FOR UPDATE;
  SELECT canonical_state INTO v_into_state FROM players WHERE id = GREATEST(p_from_player_id, p_into_player_id) FOR UPDATE;
  SET v_from_state = (SELECT canonical_state FROM players WHERE id = p_from_player_id);
  SET v_into_state = (SELECT canonical_state FROM players WHERE id = p_into_player_id);
  IF v_from_state IS NULL OR v_into_state IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PLAYER_NOT_FOUND'; END IF;
  IF v_from_state = 'MERGED' OR v_into_state = 'MERGED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PLAYER_ALREADY_MERGED'; END IF;
  IF v_into_state <> 'REGISTERED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SURVIVOR_MUST_BE_REGISTERED'; END IF;
  INSERT INTO player_merges (id, from_player_id, into_player_id, organization_id, decided_by, reason, evidence_id)
    VALUES (p_merge_id, p_from_player_id, p_into_player_id, p_organization_id, p_decided_by, p_reason, p_evidence_id);
  UPDATE players SET canonical_state = 'MERGED', merged_into_player_id = p_into_player_id WHERE id = p_from_player_id;
  INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, after_state)
    VALUES (p_organization_id, p_decided_by, 'player.merged', 'player', p_from_player_id,
            JSON_OBJECT('into_player_id', p_into_player_id, 'merge_id', p_merge_id,
                        'from_canonical_otsi_id', (SELECT canonical_otsi_id FROM players WHERE id = p_from_player_id),
                        'into_canonical_otsi_id', (SELECT canonical_otsi_id FROM players WHERE id = p_into_player_id)));
  COMMIT;
END$$
DELIMITER ;

-- ---------------------------------------------------------------- one read path for identity everywhere
-- Every module resolves a player (also an old, merged one) to the CURRENT survivor through this view. Merges are final and never rewritten,
-- so A -> B followed later by B -> C must resolve A to C: the whole merge chain is followed (bounded at 32 hops; a merge can only target a
-- non-merged player, so chains cannot loop).
CREATE VIEW `v_player_identity` AS
WITH RECURSIVE chain (player_id, current_id, next_id, hops) AS (
  SELECT id, id, merged_into_player_id, 0 FROM players
  UNION ALL
  SELECT c.player_id, p.id, p.merged_into_player_id, c.hops + 1
  FROM chain c JOIN players p ON p.id = c.next_id
  WHERE c.hops < 32
)
SELECT p.id AS player_id,
       p.canonical_otsi_id AS own_canonical_otsi_id,
       p.canonical_state AS own_state,
       s.id AS resolved_player_id,
       s.canonical_otsi_id AS canonical_otsi_id,
       s.canonical_state AS resolved_state,
       s.display_name AS display_name,
       p.created_by_organization_id
FROM chain c
JOIN players p ON p.id = c.player_id
JOIN players s ON s.id = c.current_id
WHERE c.next_id IS NULL;
