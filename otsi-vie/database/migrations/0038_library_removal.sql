-- 0038 delete from the Library (OTSI VIE v2, MySQL 8.4) — 2026-11-05 (owner: "The Library page list (3 dots) should have option to
-- delete item")
-- A person deletes a match, a folder (project) or a rendered file from the Library. Like a video (0021), the row is kept and marked
-- removed: it leaves every list, its links stop working, and the audit log keeps who did it. Nothing that other work depends on is
-- removed (the API refuses: a match with videos, a folder with videos or reels). A reel is deleted with its existing ARCHIVED status.
-- Forward-only: nullable columns, no row changes.
ALTER TABLE `matches`
  ADD COLUMN `removed_at` DATETIME(6) NULL,
  ADD COLUMN `removed_by` CHAR(36) NULL,
  ADD CONSTRAINT `fk_match_removed_by` FOREIGN KEY (`removed_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ck_match_removed_pair` CHECK ((`removed_at` IS NULL) = (`removed_by` IS NULL));
ALTER TABLE `projects`
  ADD COLUMN `removed_at` DATETIME(6) NULL,
  ADD COLUMN `removed_by` CHAR(36) NULL,
  ADD CONSTRAINT `fk_project_removed_by` FOREIGN KEY (`removed_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ck_project_removed_pair` CHECK ((`removed_at` IS NULL) = (`removed_by` IS NULL));
ALTER TABLE `render_jobs`
  ADD COLUMN `removed_at` DATETIME(6) NULL,
  ADD COLUMN `removed_by` CHAR(36) NULL,
  ADD CONSTRAINT `fk_render_removed_by` FOREIGN KEY (`removed_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ck_render_removed_pair` CHECK ((`removed_at` IS NULL) = (`removed_by` IS NULL));
