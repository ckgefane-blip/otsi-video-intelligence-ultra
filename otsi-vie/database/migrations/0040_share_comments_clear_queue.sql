-- 0040 Share-link comments and a clearable export queue (OTSI VIE v2, MySQL 8.4) - 2026-11-05, ADR-053
-- Page 10 "Allow Comments": a person opening a share link (no account) may leave a comment when the link allows it. The comments table
-- was designed for team notes only (author_id NOT NULL, a user). A comment now has exactly one author: a team member (author_id) or a
-- named guest of one share link (share_link_id + guest_name). Team notes are unchanged.
-- Page 10 "Clear All": finished renders leave the Export queue; the render and its file stay (Library, share links). cleared_at / cleared_by.
-- Forward-only: nullable columns and a relaxed NOT NULL; existing rows already satisfy the new CHECKs.
ALTER TABLE `comments`
  MODIFY `author_id` CHAR(36) NULL,
  ADD COLUMN `share_link_id` CHAR(36) NULL,
  ADD COLUMN `guest_name` VARCHAR(80) NULL,
  ADD CONSTRAINT `fk_comments_share_link` FOREIGN KEY (`share_link_id`) REFERENCES `share_links` (`id`),
  ADD CONSTRAINT `ck_comments_one_author` CHECK ((`author_id` IS NOT NULL AND `share_link_id` IS NULL AND `guest_name` IS NULL)
                                              OR (`author_id` IS NULL AND `share_link_id` IS NOT NULL AND `guest_name` IS NOT NULL));

ALTER TABLE `render_jobs`
  ADD COLUMN `cleared_at` DATETIME(6) NULL,
  ADD COLUMN `cleared_by` CHAR(36) NULL,
  ADD CONSTRAINT `fk_render_cleared_by` FOREIGN KEY (`cleared_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ck_render_cleared_pair` CHECK ((`cleared_at` IS NULL) = (`cleared_by` IS NULL));
