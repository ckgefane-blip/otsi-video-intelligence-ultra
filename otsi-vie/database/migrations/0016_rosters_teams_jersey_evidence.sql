-- 0016 match rosters, team identity and shirt-number evidence (OTSI VIE v2, MySQL 8.4) — ADR-033
-- None of this is an identity. A shirt number, a club, a kit colour or a look-alike track only SUPPORTS a suggestion; the permanent
-- canonical OTSI Player ID stays in players / track_identity_decisions (ADR-016). Players change clubs and numbers through
-- player_club_memberships / player_jersey_numbers (0007) without any change to their canonical ID.

-- clubs: a record an organization created is visible to that organization (like a provisional player)
ALTER TABLE `clubs`
  ADD COLUMN `created_by_organization_id` CHAR(36) NULL,
  ADD COLUMN `short_name` VARCHAR(32) NULL,
  ADD COLUMN `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  ADD CONSTRAINT `fk_clubs_created_by_org` FOREIGN KEY (`created_by_organization_id`) REFERENCES `organizations` (`id`);
CREATE INDEX `idx_clubs_org_name` ON `clubs` (`created_by_organization_id`, `canonical_name`);

-- matches: who made them, optimistic concurrency, two different teams
ALTER TABLE `matches`
  ADD COLUMN `created_by` CHAR(36) NULL,
  ADD COLUMN `version` BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  ADD CONSTRAINT `fk_matches_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ck_matches_two_teams` CHECK (`home_club_id` IS NULL OR `away_club_id` IS NULL OR `home_club_id` <> `away_club_id`);

-- roster entries: lineup role, position, captain, verification; one shirt number per team per match
ALTER TABLE `match_rosters`
  ADD COLUMN `role` VARCHAR(16) NOT NULL DEFAULT 'STARTER',
  ADD COLUMN `position` VARCHAR(4) NULL,
  ADD COLUMN `captain` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `verified_by` CHAR(36) NULL,
  ADD COLUMN `verified_at` DATETIME(6) NULL,
  ADD COLUMN `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  ADD CONSTRAINT `fk_match_rosters_verified_by` FOREIGN KEY (`verified_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `uq_match_rosters_number` UNIQUE (`match_id`, `club_id`, `jersey_number`),
  ADD CONSTRAINT `ck_match_rosters_role` CHECK (`role` IN ('STARTER', 'SUBSTITUTE')),
  ADD CONSTRAINT `ck_match_rosters_position` CHECK (`position` IS NULL OR `position` IN
    ('GK', 'RB', 'CB', 'LB', 'RWB', 'LWB', 'DM', 'CM', 'AM', 'RM', 'LM', 'RW', 'LW', 'CF', 'ST', 'DF', 'MF', 'FW')),
  ADD CONSTRAINT `ck_match_rosters_verified` CHECK ((`verified_by` IS NULL) = (`verified_at` IS NULL) AND (`verified_by` IS NULL OR `roster_verified`));

-- every roster change, append-only: the correction history people can read
CREATE TABLE `match_roster_changes` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `match_id` CHAR(36) NOT NULL,
  `player_id` CHAR(36) NOT NULL,
  `action` VARCHAR(16) NOT NULL,
  `before_state` JSON NULL,
  `after_state` JSON NULL,
  `changed_by` CHAR(36) NOT NULL,
  `reason` TEXT NULL,
  `changed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_roster_changes_match` FOREIGN KEY (`match_id`) REFERENCES `matches` (`id`),
  CONSTRAINT `fk_roster_changes_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_roster_changes_user` FOREIGN KEY (`changed_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_roster_changes_action` CHECK (`action` IN ('ADDED', 'UPDATED', 'REMOVED', 'VERIFIED', 'UNVERIFIED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX `idx_roster_changes_match` ON `match_roster_changes` (`match_id`, `changed_at`);

-- which match team a run's kit colour group is: a person decides (colour similarity proves nothing); NULL club = not a team
-- (referees, staff, mixed); append-only, a correction supersedes and needs a reason
CREATE TABLE `run_team_assignments` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `run_id` CHAR(36) NOT NULL,
  `kit_group` TINYINT NOT NULL,
  `club_id` CHAR(36) NULL,
  `decided_by` CHAR(36) NOT NULL,
  `reason` TEXT NULL,
  `supersedes_id` CHAR(36) NULL,
  `decided_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_team_assign_run` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs` (`id`),
  CONSTRAINT `fk_team_assign_club` FOREIGN KEY (`club_id`) REFERENCES `clubs` (`id`),
  CONSTRAINT `fk_team_assign_user` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_team_assign_supersedes` FOREIGN KEY (`supersedes_id`) REFERENCES `run_team_assignments` (`id`),
  CONSTRAINT `uq_team_assign_supersedes` UNIQUE (`supersedes_id`),
  CONSTRAINT `ck_team_assign_group` CHECK (`kit_group` BETWEEN 0 AND 9)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE VIEW `v_run_team_current` AS
SELECT a.run_id, a.kit_group, a.club_id, a.id AS assignment_id, a.decided_by, a.decided_at
FROM run_team_assignments a WHERE NOT EXISTS (SELECT 1 FROM run_team_assignments n WHERE n.supersedes_id = a.id);

-- shirt-number evidence per track, aggregated over several frames (never one blurry image)
CREATE TABLE `track_jersey_evidence` (
  `track_id` CHAR(36) NOT NULL PRIMARY KEY,
  `run_id` CHAR(36) NOT NULL,
  `state` VARCHAR(12) NOT NULL,
  `number` VARCHAR(2) NULL,
  `confidence` FLOAT NULL,
  `side` VARCHAR(8) NOT NULL DEFAULT 'UNKNOWN',
  `candidate_frames` INT NOT NULL DEFAULT 0,
  `frame_reads` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  `alternatives` JSON NOT NULL DEFAULT (JSON_ARRAY()),
  `model_version_id` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_jersey_evidence_track` FOREIGN KEY (`track_id`) REFERENCES `tracks` (`id`),
  CONSTRAINT `fk_jersey_evidence_run` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs` (`id`),
  CONSTRAINT `fk_jersey_evidence_model` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions` (`id`),
  CONSTRAINT `ck_jersey_evidence` CHECK (`state` IN ('RECOGNIZED', 'UNCERTAIN', 'UNREADABLE', 'TOO_SMALL') AND `side` IN ('BACK', 'FRONT', 'UNKNOWN')
    AND (`number` IS NULL OR `number` REGEXP '^[0-9]{1,2}$') AND (`state` NOT IN ('RECOGNIZED', 'UNCERTAIN') OR `number` IS NOT NULL)
    AND `candidate_frames` >= 0 AND (`confidence` IS NULL OR `confidence` BETWEEN 0 AND 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX `idx_jersey_evidence_run` ON `track_jersey_evidence` (`run_id`, `number`);

-- a person's verdict on a track's shirt number, append-only
CREATE TABLE `jersey_number_decisions` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `track_id` CHAR(36) NOT NULL,
  `number` VARCHAR(2) NULL,
  `state` VARCHAR(12) NOT NULL,
  `decided_by` CHAR(36) NOT NULL,
  `reason` TEXT NULL,
  `supersedes_id` CHAR(36) NULL,
  `decided_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_jersey_decisions_track` FOREIGN KEY (`track_id`) REFERENCES `tracks` (`id`),
  CONSTRAINT `fk_jersey_decisions_user` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_jersey_decisions_supersedes` FOREIGN KEY (`supersedes_id`) REFERENCES `jersey_number_decisions` (`id`),
  CONSTRAINT `uq_jersey_decisions_supersedes` UNIQUE (`supersedes_id`),
  CONSTRAINT `ck_jersey_decisions` CHECK (`state` IN ('CONFIRMED', 'UNREADABLE') AND (`number` IS NULL OR `number` REGEXP '^[0-9]{1,2}$')
    AND (`state` <> 'CONFIRMED' OR `number` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE VIEW `v_track_jersey_current` AS
SELECT d.track_id, d.id AS decision_id, d.state, d.number, d.decided_by, d.decided_at
FROM jersey_number_decisions d WHERE NOT EXISTS (SELECT 1 FROM jersey_number_decisions n WHERE n.supersedes_id = d.id);

-- appearance neighbours of each person track (top 5 by cosine among tracks that never overlap it in time): the basis of look-alike
-- identity suggestions; computed by the analysis worker
CREATE TABLE `track_neighbours` (
  `track_id` CHAR(36) NOT NULL,
  `neighbour_id` CHAR(36) NOT NULL,
  `cosine` FLOAT NOT NULL,
  `kit_similarity` FLOAT NOT NULL,
  `rank_no` TINYINT NOT NULL,
  PRIMARY KEY (`track_id`, `neighbour_id`),
  CONSTRAINT `fk_track_neighbours_track` FOREIGN KEY (`track_id`) REFERENCES `tracks` (`id`),
  CONSTRAINT `fk_track_neighbours_other` FOREIGN KEY (`neighbour_id`) REFERENCES `tracks` (`id`),
  CONSTRAINT `ck_track_neighbours` CHECK (`track_id` <> `neighbour_id` AND `cosine` BETWEEN -1 AND 1 AND `kit_similarity` BETWEEN 0 AND 1 AND `rank_no` BETWEEN 1 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DELIMITER $$
CREATE TRIGGER trg_roster_changes_no_update BEFORE UPDATE ON match_roster_changes FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ROSTER_CHANGES_APPEND_ONLY'; END$$
CREATE TRIGGER trg_roster_changes_no_delete BEFORE DELETE ON match_roster_changes FOR EACH ROW
BEGIN IF SUBSTRING_INDEX(USER(), '@', 1) NOT LIKE 'otsi\_retention%' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ROSTER_CHANGES_APPEND_ONLY'; END IF; END$$
CREATE TRIGGER trg_team_assign_no_update BEFORE UPDATE ON run_team_assignments FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='TEAM_ASSIGNMENTS_APPEND_ONLY: add a new decision with supersedes_id'; END$$
CREATE TRIGGER trg_team_assign_no_delete BEFORE DELETE ON run_team_assignments FOR EACH ROW
BEGIN IF SUBSTRING_INDEX(USER(), '@', 1) NOT LIKE 'otsi\_retention%' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='TEAM_ASSIGNMENTS_APPEND_ONLY'; END IF; END$$
CREATE TRIGGER trg_team_assign_reason BEFORE INSERT ON run_team_assignments FOR EACH ROW
BEGIN IF NEW.supersedes_id IS NOT NULL AND (NEW.reason IS NULL OR CHAR_LENGTH(TRIM(NEW.reason)) < 3) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CORRECTION_REASON_REQUIRED'; END IF; END$$
CREATE TRIGGER trg_jersey_decisions_no_update BEFORE UPDATE ON jersey_number_decisions FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='JERSEY_DECISIONS_APPEND_ONLY: add a new decision with supersedes_id'; END$$
CREATE TRIGGER trg_jersey_decisions_no_delete BEFORE DELETE ON jersey_number_decisions FOR EACH ROW
BEGIN IF SUBSTRING_INDEX(USER(), '@', 1) NOT LIKE 'otsi\_retention%' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='JERSEY_DECISIONS_APPEND_ONLY'; END IF; END$$
CREATE TRIGGER trg_jersey_decisions_reason BEFORE INSERT ON jersey_number_decisions FOR EACH ROW
BEGIN IF NEW.supersedes_id IS NOT NULL AND (NEW.reason IS NULL OR CHAR_LENGTH(TRIM(NEW.reason)) < 3) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CORRECTION_REASON_REQUIRED'; END IF; END$$
DELIMITER ;
