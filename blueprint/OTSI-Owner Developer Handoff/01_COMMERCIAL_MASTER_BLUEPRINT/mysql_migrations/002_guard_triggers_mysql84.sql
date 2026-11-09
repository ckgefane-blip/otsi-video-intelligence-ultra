-- MySQL native integrity triggers. No PostgreSQL PL/pgSQL or RLS.
USE `otsi_owner_vie`;
DELIMITER $$
CREATE TRIGGER trg_projects_update BEFORE UPDATE ON projects FOR EACH ROW
BEGIN
 SET NEW.updated_at=CURRENT_TIMESTAMP(6);
 SET NEW.version=OLD.version+1;
END$$
CREATE TRIGGER trg_reels_update BEFORE UPDATE ON reel_projects FOR EACH ROW
BEGIN
 SET NEW.updated_at=CURRENT_TIMESTAMP(6);
 SET NEW.version=OLD.version+1;
END$$
CREATE TRIGGER trg_render_transition BEFORE UPDATE ON render_jobs FOR EACH ROW
BEGIN
 IF NEW.state<>OLD.state AND NOT (
  (OLD.state='QUEUED' AND NEW.state IN ('RUNNING','CANCELLED','BLOCKED')) OR
  (OLD.state='RUNNING' AND NEW.state IN ('SUCCEEDED','FAILED','CANCELLED','REVIEW_REQUIRED','BLOCKED')) OR
  (OLD.state='REVIEW_REQUIRED' AND NEW.state IN ('QUEUED','BLOCKED','CANCELLED')) OR
  (OLD.state='FAILED' AND NEW.state='QUEUED')
 ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='INVALID_RENDER_STATE_TRANSITION'; END IF;
 IF NEW.state='SUCCEEDED' AND (NEW.output_asset_id IS NULL OR NEW.manifest_asset_id IS NULL) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='RENDER_ASSET_AND_MANIFEST_REQUIRED';
 END IF;
END$$
DELIMITER ;
-- DB triggers are defense in depth; API remains responsible for tenant and rights checks.
