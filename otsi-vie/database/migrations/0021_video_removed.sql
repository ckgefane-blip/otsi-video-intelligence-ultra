-- 0021 removing an unverified upload (OTSI VIE v2, MySQL 8.4) — Page 02, 2026-10-29
-- A person can remove a video that is not verified yet (a duplicate, a wrong file, a failed upload). The row stays for the audit trail and for
-- the idempotency of an interrupted upload, but it leaves every list. A verified video is never removed this way (it may have analyses and
-- reels). Forward-only: no existing row is changed.
ALTER TABLE `video_sources`
  ADD COLUMN `removed_at` DATETIME(6) NULL,
  ADD COLUMN `removed_by` CHAR(36) NULL,
  ADD CONSTRAINT `fk_video_removed_by` FOREIGN KEY (`removed_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ck_video_removed_pair` CHECK ((`removed_at` IS NULL) = (`removed_by` IS NULL));
