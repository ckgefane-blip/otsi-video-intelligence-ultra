-- 0005 append-only audit and decision history (OTSI VIE v2, MySQL 8.4) — ADR-013
-- Blueprint: "append a new decision with supersedes_id; do not rewrite history"; audit is immutable.
-- UPDATE is refused for everyone. DELETE is refused unless the connected account is a retention account (name starting 'otsi_retention'),
-- which only the documented retention/erasure job uses (database/roles/roles.sql). USER() is the connecting account, not the trigger definer.
DELIMITER $$
CREATE TRIGGER trg_audit_events_no_update BEFORE UPDATE ON audit_events FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='AUDIT_EVENTS_APPEND_ONLY'; END$$
CREATE TRIGGER trg_audit_events_no_delete BEFORE DELETE ON audit_events FOR EACH ROW
BEGIN IF SUBSTRING_INDEX(USER(), '@', 1) NOT LIKE 'otsi\_retention%' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='AUDIT_EVENTS_APPEND_ONLY'; END IF; END$$

CREATE TRIGGER trg_identity_decisions_no_update BEFORE UPDATE ON track_identity_decisions FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IDENTITY_DECISIONS_APPEND_ONLY: add a new decision with supersedes_id'; END$$
CREATE TRIGGER trg_identity_decisions_no_delete BEFORE DELETE ON track_identity_decisions FOR EACH ROW
BEGIN IF SUBSTRING_INDEX(USER(), '@', 1) NOT LIKE 'otsi\_retention%' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IDENTITY_DECISIONS_APPEND_ONLY'; END IF; END$$

CREATE TRIGGER trg_event_decisions_no_update BEFORE UPDATE ON event_decisions FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='EVENT_DECISIONS_APPEND_ONLY: add a new decision'; END$$
CREATE TRIGGER trg_event_decisions_no_delete BEFORE DELETE ON event_decisions FOR EACH ROW
BEGIN IF SUBSTRING_INDEX(USER(), '@', 1) NOT LIKE 'otsi\_retention%' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='EVENT_DECISIONS_APPEND_ONLY'; END IF; END$$

CREATE TRIGGER trg_identity_review_no_update BEFORE UPDATE ON identity_review_history FOR EACH ROW
BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IDENTITY_REVIEW_HISTORY_APPEND_ONLY'; END$$
CREATE TRIGGER trg_identity_review_no_delete BEFORE DELETE ON identity_review_history FOR EACH ROW
BEGIN IF SUBSTRING_INDEX(USER(), '@', 1) NOT LIKE 'otsi\_retention%' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IDENTITY_REVIEW_HISTORY_APPEND_ONLY'; END IF; END$$
DELIMITER ;
