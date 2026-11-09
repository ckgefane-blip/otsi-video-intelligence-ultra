-- Migration 011 — Defence-in-depth integrity: optimistic-lock versions, state machines, append-only ledgers,
--                 identity projection, canonical OTSI Player ID allocator. The API remains the primary enforcer.
USE `otsi_owner_vie`;
DELIMITER $$

-- ---------- row_version (ETag) ----------
CREATE TRIGGER trg_organizations_ver BEFORE UPDATE ON organizations FOR EACH ROW SET NEW.row_version = OLD.row_version + 1$$
CREATE TRIGGER trg_players_ver       BEFORE UPDATE ON players       FOR EACH ROW SET NEW.row_version = OLD.row_version + 1$$
CREATE TRIGGER trg_matches_ver       BEFORE UPDATE ON matches       FOR EACH ROW SET NEW.row_version = OLD.row_version + 1$$
CREATE TRIGGER trg_projects_ver      BEFORE UPDATE ON projects      FOR EACH ROW SET NEW.row_version = OLD.row_version + 1$$
CREATE TRIGGER trg_reports_ver       BEFORE UPDATE ON reports       FOR EACH ROW BEGIN
  SET NEW.row_version = OLD.row_version + 1;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT'           AND NEW.status IN ('GENERATED','ARCHIVED')) OR
       (OLD.status = 'GENERATED'       AND NEW.status IN ('REVIEW_REQUIRED','READY','DRAFT')) OR
       (OLD.status = 'REVIEW_REQUIRED' AND NEW.status IN ('READY','DRAFT')) OR
       (OLD.status = 'READY'           AND NEW.status IN ('PUBLISHED','DRAFT')) OR
       (OLD.status = 'PUBLISHED'       AND NEW.status IN ('ARCHIVED')) ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_REPORT_STATE_TRANSITION';
  END IF;
END$$
CREATE TRIGGER trg_subscriptions_ver BEFORE UPDATE ON subscriptions FOR EACH ROW SET NEW.row_version = OLD.row_version + 1$$

-- ---------- video source lifecycle ----------
CREATE TRIGGER trg_video_sources_upd BEFORE UPDATE ON video_sources FOR EACH ROW BEGIN
  SET NEW.row_version = OLD.row_version + 1;
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'PENDING'     AND NEW.state IN ('UPLOADING','VALIDATING','FAILED','DELETED')) OR
       (OLD.state = 'UPLOADING'   AND NEW.state IN ('VALIDATING','FAILED','DELETED')) OR
       (OLD.state = 'VALIDATING'  AND NEW.state IN ('INGESTED','FAILED','QUARANTINED')) OR
       (OLD.state = 'FAILED'      AND NEW.state IN ('PENDING','DELETED')) OR
       (OLD.state = 'QUARANTINED' AND NEW.state IN ('VALIDATING','DELETED')) OR
       (OLD.state = 'INGESTED'    AND NEW.state IN ('DELETED')) ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_VIDEO_STATE_TRANSITION';
  END IF;
  IF NEW.state = 'INGESTED' AND OLD.state <> 'INGESTED' THEN SET NEW.ingested_at = COALESCE(NEW.ingested_at, CURRENT_TIMESTAMP(6)); END IF;
END$$

CREATE TRIGGER trg_ingest_options_lock BEFORE UPDATE ON video_ingest_options FOR EACH ROW BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INGEST_OPTIONS_LOCKED_START_NEW_RUN';
  END IF;
END$$

-- ---------- pipeline run state machine (FAILED -> QUEUED only via a NEW attempt row, never in place) ----------
CREATE TRIGGER trg_pipeline_runs_state BEFORE UPDATE ON pipeline_runs FOR EACH ROW BEGIN
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'QUEUED'          AND NEW.status IN ('RUNNING','CANCELLED','BLOCKED')) OR
       (OLD.status = 'RUNNING'         AND NEW.status IN ('SUCCEEDED','FAILED','CANCELLED','REVIEW_REQUIRED','BLOCKED')) OR
       (OLD.status = 'REVIEW_REQUIRED' AND NEW.status IN ('SUCCEEDED','CANCELLED','BLOCKED')) OR
       (OLD.status = 'BLOCKED'         AND NEW.status IN ('QUEUED','CANCELLED')) ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_PIPELINE_STATE_TRANSITION';
  END IF;
  IF NEW.status = 'RUNNING' AND OLD.status <> 'RUNNING' THEN SET NEW.started_at = COALESCE(NEW.started_at, CURRENT_TIMESTAMP(6)); END IF;
  IF NEW.status IN ('SUCCEEDED','FAILED','CANCELLED') AND OLD.status NOT IN ('SUCCEEDED','FAILED','CANCELLED') THEN
    SET NEW.finished_at = COALESCE(NEW.finished_at, CURRENT_TIMESTAMP(6));
  END IF;
  IF NEW.overall_progress < OLD.overall_progress AND NEW.status = OLD.status THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'PROGRESS_MUST_BE_MONOTONIC';
  END IF;
END$$

-- Lock ingest options once the first run starts.
CREATE TRIGGER trg_pipeline_runs_lock_options AFTER UPDATE ON pipeline_runs FOR EACH ROW BEGIN
  IF NEW.status = 'RUNNING' AND OLD.status = 'QUEUED' THEN
    UPDATE video_ingest_options SET locked_at = CURRENT_TIMESTAMP(6) WHERE video_id = NEW.video_id AND locked_at IS NULL;
  END IF;
END$$

-- ---------- render job state machine ----------
CREATE TRIGGER trg_render_jobs_state BEFORE UPDATE ON render_jobs FOR EACH ROW BEGIN
  IF NEW.state <> OLD.state AND NOT (
       (OLD.state = 'QUEUED'          AND NEW.state IN ('RUNNING','CANCELLED','BLOCKED')) OR
       (OLD.state = 'RUNNING'         AND NEW.state IN ('SUCCEEDED','FAILED','CANCELLED','REVIEW_REQUIRED','BLOCKED')) OR
       (OLD.state = 'REVIEW_REQUIRED' AND NEW.state IN ('QUEUED','BLOCKED','CANCELLED')) OR
       (OLD.state = 'FAILED'          AND NEW.state = 'QUEUED') ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_RENDER_STATE_TRANSITION';
  END IF;
  IF NEW.state = 'QUEUED' AND OLD.state = 'FAILED' THEN SET NEW.attempt_count = OLD.attempt_count + 1, NEW.progress_pct = 0; END IF;
  IF NEW.state = 'RUNNING' AND OLD.state <> 'RUNNING' THEN SET NEW.started_at = COALESCE(NEW.started_at, CURRENT_TIMESTAMP(6)); END IF;
  IF NEW.state IN ('SUCCEEDED','FAILED','CANCELLED') AND OLD.state NOT IN ('SUCCEEDED','FAILED','CANCELLED') THEN
    SET NEW.completed_at = COALESCE(NEW.completed_at, CURRENT_TIMESTAMP(6)), NEW.queue_position = NULL;
  END IF;
END$$

-- ---------- reel lifecycle ----------
CREATE TRIGGER trg_reel_projects_upd BEFORE UPDATE ON reel_projects FOR EACH ROW BEGIN
  SET NEW.row_version = OLD.row_version + 1;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'DRAFT'           AND NEW.status IN ('REVIEW_REQUIRED','READY_TO_RENDER','BLOCKED','ARCHIVED')) OR
       (OLD.status = 'REVIEW_REQUIRED' AND NEW.status IN ('DRAFT','READY_TO_RENDER','BLOCKED')) OR
       (OLD.status = 'READY_TO_RENDER' AND NEW.status IN ('DRAFT','RENDERING','BLOCKED')) OR
       (OLD.status = 'RENDERING'       AND NEW.status IN ('QC','FAILED','BLOCKED','DRAFT')) OR
       (OLD.status = 'QC'              AND NEW.status IN ('READY','FAILED','BLOCKED')) OR
       (OLD.status = 'READY'           AND NEW.status IN ('PUBLISHED','DRAFT','ARCHIVED')) OR
       (OLD.status = 'PUBLISHED'       AND NEW.status IN ('ARCHIVED','DRAFT')) OR
       (OLD.status = 'FAILED'          AND NEW.status IN ('DRAFT','READY_TO_RENDER')) OR
       (OLD.status = 'BLOCKED'         AND NEW.status IN ('DRAFT','REVIEW_REQUIRED')) ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_REEL_STATE_TRANSITION';
  END IF;
END$$

-- A spotlight target must be backed by a CONFIRMED identity decision for that same player.
CREATE TRIGGER trg_reel_targets_guard BEFORE INSERT ON reel_targets FOR EACH ROW BEGIN
  DECLARE v_state VARCHAR(20); DECLARE v_player CHAR(36);
  IF NEW.identity_decision_id IS NOT NULL THEN
    SELECT state, player_id INTO v_state, v_player FROM track_identity_decisions
     WHERE id = NEW.identity_decision_id AND organization_id = NEW.organization_id;
    IF v_state IS NULL OR v_state <> 'CONFIRMED' OR v_player <> NEW.player_id THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IDENTITY_UNRESOLVED';
    END IF;
  END IF;
END$$

-- ---------- append-only ledgers ----------
CREATE TRIGGER trg_tid_no_update BEFORE UPDATE ON track_identity_decisions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY_TABLE'$$
CREATE TRIGGER trg_tid_no_delete BEFORE DELETE ON track_identity_decisions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY_TABLE'$$
CREATE TRIGGER trg_ed_no_update  BEFORE UPDATE ON event_decisions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY_TABLE'$$
CREATE TRIGGER trg_ed_no_delete  BEFORE DELETE ON event_decisions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY_TABLE'$$
CREATE TRIGGER trg_rr_no_update  BEFORE UPDATE ON reel_revisions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY_TABLE'$$
CREATE TRIGGER trg_pd_no_update  BEFORE UPDATE ON policy_decisions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY_TABLE'$$
CREATE TRIGGER trg_pd_no_delete  BEFORE DELETE ON policy_decisions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY_TABLE'$$
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY_TABLE'$$
CREATE TRIGGER trg_log_no_update BEFORE UPDATE ON job_log_entries FOR EACH ROW BEGIN
  IF NOT (OLD.is_pending = TRUE AND NEW.is_pending = FALSE AND NEW.message = OLD.message) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'APPEND_ONLY_TABLE_EXCEPT_PENDING_COMPLETION';
  END IF;
END$$

-- ---------- identity projection onto tracks ----------
CREATE TRIGGER trg_tid_project AFTER INSERT ON track_identity_decisions FOR EACH ROW BEGIN
  UPDATE tracks
     SET identity_state = NEW.state,
         current_player_id = IF(NEW.state = 'CONFIRMED', NEW.player_id, NULL),
         current_decision_id = NEW.id
   WHERE id = NEW.track_id AND organization_id = NEW.organization_id;
END$$

-- ---------- event review projection ----------
CREATE TRIGGER trg_ed_project AFTER INSERT ON event_decisions FOR EACH ROW BEGIN
  UPDATE event_candidates
     SET effective_state = CASE NEW.decision WHEN 'CONFIRM' THEN 'CONFIRMED' WHEN 'REJECT' THEN 'REJECTED'
                                             WHEN 'EDIT' THEN 'EDITED' ELSE 'NEEDS_REVIEW' END,
         evidence_state  = CASE NEW.decision WHEN 'CONFIRM' THEN 'CONFIRMED' WHEN 'EDIT' THEN 'CONFIRMED' ELSE evidence_state END
   WHERE id = NEW.event_id AND organization_id = NEW.organization_id;
END$$

-- ---------- canonical OTSI Player ID allocator (concurrency-safe, gap-free per country/year) ----------
CREATE PROCEDURE sp_allocate_otsi_player_id(IN p_player_id CHAR(36), IN p_country3 CHAR(3), IN p_year SMALLINT, OUT p_otsi_id VARCHAR(20))
  MODIFIES SQL DATA
BEGIN
  DECLARE v_next INT UNSIGNED;
  DECLARE v_existing VARCHAR(20);
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
  IF NOT REGEXP_LIKE(p_country3, '^[A-Z]{3}$', 'c') OR p_year NOT BETWEEN 1900 AND 2100 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_OTSI_ID_PARTS';
  END IF;
  START TRANSACTION;
    SELECT canonical_otsi_id INTO v_existing FROM players WHERE id = p_player_id FOR UPDATE;
    IF v_existing IS NOT NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'OTSI_ID_ALREADY_ALLOCATED';
    END IF;
    INSERT INTO otsi_player_id_sequences (country_code, year_part, next_value) VALUES (p_country3, p_year, 1)
      ON DUPLICATE KEY UPDATE next_value = next_value;
    SELECT next_value INTO v_next FROM otsi_player_id_sequences WHERE country_code = p_country3 AND year_part = p_year FOR UPDATE;
    SET p_otsi_id = CONCAT('OTSI-', p_country3, '-', LPAD(p_year, 4, '0'), '-', LPAD(v_next, 6, '0'));
    UPDATE otsi_player_id_sequences SET next_value = v_next + 1 WHERE country_code = p_country3 AND year_part = p_year;
    UPDATE players SET canonical_otsi_id = p_otsi_id, canonical_state = 'VERIFIED' WHERE id = p_player_id;
    INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, event_payload)
      VALUES (NULL, 'player', p_player_id, 'player.otsi_id.allocated', JSON_OBJECT('otsiId', p_otsi_id));
  COMMIT;
END$$

-- Monthly partition maintenance for audit_events (call from a scheduler on the 1st of each month).
CREATE PROCEDURE sp_audit_add_next_partition()
BEGIN
  DECLARE v_next DATE DEFAULT DATE_ADD(LAST_DAY(CURRENT_DATE) + INTERVAL 1 DAY, INTERVAL 1 MONTH);
  DECLARE v_name VARCHAR(16) DEFAULT CONCAT('p', DATE_FORMAT(DATE_SUB(v_next, INTERVAL 1 MONTH), '%Y_%m'));
  IF NOT EXISTS (SELECT 1 FROM information_schema.PARTITIONS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_events' AND PARTITION_NAME = v_name) THEN
    SET @ddl = CONCAT('ALTER TABLE audit_events REORGANIZE PARTITION p_future INTO (PARTITION ', v_name,
                      ' VALUES LESS THAN (''', v_next, '''), PARTITION p_future VALUES LESS THAN (MAXVALUE))');
    PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
  END IF;
END$$

DELIMITER ;
