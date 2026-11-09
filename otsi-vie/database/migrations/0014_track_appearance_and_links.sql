-- 0014 track appearance and same-person links (OTSI VIE v2, MySQL 8.4) — ADR-031
-- Appearance is evidence, never identity: a kit group is a colour cluster within one run (not a team name), an embedding only supports a
-- SUGGESTION that two tracks show the same person (across an occlusion or a camera cut). A person confirms or rejects every link; links
-- never create, change or confirm a player identity on their own (identity stays in track_identity_decisions, ADR-016).

ALTER TABLE `assets` MODIFY COLUMN `kind`
  ENUM('SOURCE','PROXY','THUMBNAIL','TRACKS','EVENTS','REEL','REPORT','HEATMAP','MANIFEST','CAPTIONS','DETECTIONS','EMBEDDINGS') NOT NULL;

CREATE TABLE `track_appearance` (
  `track_id` CHAR(36) NOT NULL PRIMARY KEY,
  `run_id` CHAR(36) NOT NULL,
  `kit_group` TINYINT NULL,                       -- colour cluster within the run (0, 1, ...); NULL = not enough evidence
  `kit_rgb` CHAR(7) NULL,                         -- dominant kit colour of the track, #RRGGBB, for display next to the group
  `embedding_asset_id` CHAR(36) NULL,             -- Parquet file of the run's track embeddings
  `embedding_row` INT NULL,
  `crop_count` INT NOT NULL DEFAULT 0,
  `drift_score` FLOAT NULL,                       -- appearance similarity of the track's first and last thirds; low = possible identity switch
  `thumbnail_asset_id` CHAR(36) NULL,             -- the track's largest crop (JPEG)
  `model_version_id` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_track_appearance_track` FOREIGN KEY (`track_id`) REFERENCES `tracks` (`id`),
  CONSTRAINT `fk_track_appearance_run` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs` (`id`),
  CONSTRAINT `fk_track_appearance_emb` FOREIGN KEY (`embedding_asset_id`) REFERENCES `assets` (`id`),
  CONSTRAINT `fk_track_appearance_thumb` FOREIGN KEY (`thumbnail_asset_id`) REFERENCES `assets` (`id`),
  CONSTRAINT `fk_track_appearance_model` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions` (`id`),
  CONSTRAINT `ck_track_appearance` CHECK ((`kit_group` IS NULL OR `kit_group` BETWEEN 0 AND 9) AND `crop_count` >= 0
    AND (`drift_score` IS NULL OR `drift_score` BETWEEN -1 AND 1) AND (`kit_rgb` IS NULL OR `kit_rgb` REGEXP '^#[0-9A-F]{6}$')
    AND ((`embedding_asset_id` IS NULL) = (`embedding_row` IS NULL)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX `idx_track_appearance_run` ON `track_appearance` (`run_id`, `kit_group`);

-- a suggestion that the EARLIER track a and the LATER track b show the same person (they never overlap in time)
CREATE TABLE `track_links` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `run_id` CHAR(36) NOT NULL,
  `track_a_id` CHAR(36) NOT NULL,
  `track_b_id` CHAR(36) NOT NULL,
  `score` FLOAT NOT NULL,
  `method` VARCHAR(32) NOT NULL,
  `crosses_cut` BOOLEAN NOT NULL,
  `gap_us` BIGINT NOT NULL,
  `evidence` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  `model_version_id` CHAR(36) NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_track_links_run` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs` (`id`),
  CONSTRAINT `fk_track_links_a` FOREIGN KEY (`track_a_id`) REFERENCES `tracks` (`id`),
  CONSTRAINT `fk_track_links_b` FOREIGN KEY (`track_b_id`) REFERENCES `tracks` (`id`),
  CONSTRAINT `fk_track_links_model` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions` (`id`),
  CONSTRAINT `uq_track_links_pair` UNIQUE (`track_a_id`, `track_b_id`),
  CONSTRAINT `ck_track_links` CHECK (`track_a_id` <> `track_b_id` AND `score` BETWEEN 0 AND 1 AND `gap_us` >= 0 AND `method` IN ('APPEARANCE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE INDEX `idx_track_links_b` ON `track_links` (`track_b_id`);
CREATE INDEX `idx_track_links_run_score` ON `track_links` (`run_id`, `score`);

-- human decisions on links: append-only, a correction supersedes the previous decision and needs a reason (like identity decisions)
CREATE TABLE `track_link_decisions` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `link_id` CHAR(36) NOT NULL,
  `state` ENUM('CONFIRMED','REJECTED','UNRESOLVED') NOT NULL,
  `decided_by` CHAR(36) NOT NULL,
  `reason` TEXT NULL,
  `supersedes_id` CHAR(36) NULL,
  `decided_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_link_decisions_link` FOREIGN KEY (`link_id`) REFERENCES `track_links` (`id`),
  CONSTRAINT `fk_link_decisions_user` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_link_decisions_supersedes` FOREIGN KEY (`supersedes_id`) REFERENCES `track_link_decisions` (`id`),
  CONSTRAINT `uq_link_decisions_supersedes` UNIQUE (`supersedes_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE VIEW `v_track_link_current` AS
SELECT l.id AS link_id, l.run_id, l.track_a_id, l.track_b_id, l.score, l.crosses_cut, l.gap_us,
       d.id AS decision_id, COALESCE(d.state, 'PROPOSED') AS state, d.decided_by, d.decided_at
FROM track_links l
LEFT JOIN track_link_decisions d ON d.link_id = l.id
  AND NOT EXISTS (SELECT 1 FROM track_link_decisions n WHERE n.supersedes_id = d.id);

DELIMITER $$
CREATE TRIGGER trg_link_decisions_no_update BEFORE UPDATE ON track_link_decisions FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='LINK_DECISIONS_APPEND_ONLY: add a new decision with supersedes_id'; END$$
CREATE TRIGGER trg_link_decisions_no_delete BEFORE DELETE ON track_link_decisions FOR EACH ROW
BEGIN IF SUBSTRING_INDEX(USER(), '@', 1) NOT LIKE 'otsi\_retention%' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='LINK_DECISIONS_APPEND_ONLY'; END IF; END$$
CREATE TRIGGER trg_link_decisions_reason BEFORE INSERT ON track_link_decisions FOR EACH ROW
BEGIN
  IF NEW.supersedes_id IS NOT NULL AND (NEW.reason IS NULL OR CHAR_LENGTH(TRIM(NEW.reason)) < 3) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CORRECTION_REASON_REQUIRED';
  END IF;
END$$
DELIMITER ;
