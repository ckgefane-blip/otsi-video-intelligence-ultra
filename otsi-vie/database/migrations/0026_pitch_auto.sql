-- 0026 automatic pitch calibration (OTSI VIE v2, MySQL 8.4) — ADR-036, 2026-10-31 (owner: "Can't we have the engine auto calibrate pitch in videos?")
-- A calibration request is either a person's clicks on one moment (CLICKS, as before) or the whole video calibrated by the engine with nobody
-- clicking (AUTO: no anchor, no points; the CALIBRATE_PITCH worker finds pitch keypoints in a frame every 2 s and fits the match camera).
-- Forward-only: one column with a default, so every existing request stays CLICKS.
ALTER TABLE `pitch_calibration_requests`
  ADD COLUMN `mode` VARCHAR(8) NOT NULL DEFAULT 'CLICKS' AFTER `video_id`,
  ADD CONSTRAINT `ck_pcr_mode` CHECK (`mode` IN ('CLICKS', 'AUTO'));
