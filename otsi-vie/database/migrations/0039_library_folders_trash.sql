-- 0039 Library folders and Trash (OTSI VIE v2, MySQL 8.4) — 2026-11-05, ADR-052
-- Owner: "STOP ... PATCH EVERYTHING ... LONG TERM FIXES" after Library delete and move went wrong. The cause: the Library showed the
-- owning `projects` table as its "folders", so deleting a folder took its videos and reels, and moving a video relabelled its files.
-- The approved spec (09, `otsi_folder_items`) keeps folders as a grouping. This migration:
--   1. library_folders / library_folder_items: a folder only groups items; an item is in at most one folder; deleting a folder never
--      deletes what is in it.
--   2. library_deletions / library_deletion_items: every delete is one Trash entry listing everything it removed (with each row's prior
--      state), so the person restores it themselves. Nothing is erased.
--   3. reel_projects.removed_at / removed_by: a deleted reel is marked removed like every other item; its status (DRAFT, READY,
--      ARCHIVED...) keeps its own meaning. Reels the earlier delete marked ARCHIVED are carried over with their status from the audit.
--   4. Items already deleted before this migration are carried into the Trash (one entry each). Uploads cancelled before they finished
--      are not: they cannot come back.
-- Forward-only: new tables, nullable columns, the carry-over updates only rows that were already deleted.
ALTER TABLE `reel_projects`
  ADD COLUMN `removed_at` DATETIME(6) NULL,
  ADD COLUMN `removed_by` CHAR(36) NULL,
  ADD CONSTRAINT `fk_reel_removed_by` FOREIGN KEY (`removed_by`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `ck_reel_removed_pair` CHECK ((`removed_at` IS NULL) = (`removed_by` IS NULL));

UPDATE `reel_projects` r
   SET r.`removed_at` = COALESCE((SELECT MAX(a.`occurred_at`) FROM `audit_events` a WHERE a.`entity_id` = r.`id` AND a.`action` = 'reel.deleted'), r.`updated_at`),
       r.`removed_by` = COALESCE((SELECT a.`actor_id` FROM `audit_events` a WHERE a.`entity_id` = r.`id` AND a.`action` = 'reel.deleted' AND a.`actor_id` IS NOT NULL
                                   ORDER BY a.`id` DESC LIMIT 1), r.`created_by`),
       r.`status` = COALESCE((SELECT JSON_UNQUOTE(JSON_EXTRACT(a.`before_state`, '$.status')) FROM `audit_events` a
                               WHERE a.`entity_id` = r.`id` AND a.`action` = 'reel.deleted'
                                 AND JSON_UNQUOTE(JSON_EXTRACT(a.`before_state`, '$.status')) IN ('DRAFT', 'READY', 'PUBLISHED', 'BLOCKED')
                               ORDER BY a.`id` DESC LIMIT 1), 'READY')
 WHERE r.`status` = 'ARCHIVED';

CREATE TABLE `library_folders` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `version` BIGINT NOT NULL DEFAULT 1,
  `removed_at` DATETIME(6) NULL,
  `removed_by` CHAR(36) NULL,
  CONSTRAINT `fk_library_folder_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_library_folder_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_library_folder_removed_by` FOREIGN KEY (`removed_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_library_folder_name` CHECK (CHAR_LENGTH(TRIM(`name`)) >= 1),
  CONSTRAINT `ck_library_folder_removed_pair` CHECK ((`removed_at` IS NULL) = (`removed_by` IS NULL)),
  INDEX `idx_library_folders_org` (`organization_id`, `removed_at`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `library_folder_items` (
  `organization_id` CHAR(36) NOT NULL,
  `item_kind` VARCHAR(16) NOT NULL,
  `item_id` CHAR(36) NOT NULL,
  `folder_id` CHAR(36) NOT NULL,
  `added_by` CHAR(36) NOT NULL,
  `added_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`organization_id`, `item_kind`, `item_id`),
  CONSTRAINT `fk_library_item_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_library_item_folder` FOREIGN KEY (`folder_id`) REFERENCES `library_folders` (`id`),
  CONSTRAINT `fk_library_item_added_by` FOREIGN KEY (`added_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_library_item_kind` CHECK (`item_kind` IN ('reel', 'render', 'video', 'match', 'project')),
  INDEX `idx_library_items_folder` (`folder_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `library_deletions` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `item_kind` VARCHAR(16) NOT NULL,
  `item_id` CHAR(36) NOT NULL,
  `title` VARCHAR(512) NOT NULL,
  `deleted_by` CHAR(36) NOT NULL,
  `deleted_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `restored_at` DATETIME(6) NULL,
  `restored_by` CHAR(36) NULL,
  CONSTRAINT `fk_library_deletion_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_library_deletion_by` FOREIGN KEY (`deleted_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_library_deletion_restored_by` FOREIGN KEY (`restored_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_library_deletion_kind` CHECK (`item_kind` IN ('reel', 'render', 'video', 'match', 'project', 'folder')),
  CONSTRAINT `ck_library_deletion_restored_pair` CHECK ((`restored_at` IS NULL) = (`restored_by` IS NULL)),
  INDEX `idx_library_deletions_open` (`organization_id`, `restored_at`, `deleted_at`),
  INDEX `idx_library_deletions_item` (`organization_id`, `item_kind`, `item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `library_deletion_items` (
  `deletion_id` CHAR(36) NOT NULL,
  `item_kind` VARCHAR(16) NOT NULL,
  `item_id` CHAR(36) NOT NULL,
  `prior` JSON NOT NULL DEFAULT (JSON_OBJECT()),
  PRIMARY KEY (`deletion_id`, `item_kind`, `item_id`),
  CONSTRAINT `fk_library_deletion_item` FOREIGN KEY (`deletion_id`) REFERENCES `library_deletions` (`id`),
  CONSTRAINT `ck_library_deletion_item_kind` CHECK (`item_kind` IN ('reel', 'render', 'video', 'match', 'project', 'folder')),
  INDEX `idx_library_deletion_items_item` (`item_kind`, `item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- carry the items already deleted into the Trash, one entry each
INSERT INTO `library_deletions` (`id`, `organization_id`, `item_kind`, `item_id`, `title`, `deleted_by`, `deleted_at`)
SELECT UUID(), p.`organization_id`, 'project', p.`id`, p.`name`, p.`removed_by`, p.`removed_at` FROM `projects` p WHERE p.`removed_at` IS NOT NULL;
INSERT INTO `library_deletions` (`id`, `organization_id`, `item_kind`, `item_id`, `title`, `deleted_by`, `deleted_at`)
SELECT UUID(), v.`organization_id`, 'video', v.`id`, COALESCE(v.`title`, v.`original_filename`, 'Video'), v.`removed_by`, v.`removed_at`
  FROM `video_sources` v WHERE v.`removed_at` IS NOT NULL AND v.`state` = 'INGESTED' AND v.`removed_by` IS NOT NULL;
INSERT INTO `library_deletions` (`id`, `organization_id`, `item_kind`, `item_id`, `title`, `deleted_by`, `deleted_at`)
SELECT UUID(), m.`organization_id`, 'match', m.`id`, COALESCE(CONCAT(h.`canonical_name`, ' v ', a.`canonical_name`), m.`competition`, 'Match'), m.`removed_by`, m.`removed_at`
  FROM `matches` m LEFT JOIN `clubs` h ON h.`id` = m.`home_club_id` LEFT JOIN `clubs` a ON a.`id` = m.`away_club_id` WHERE m.`removed_at` IS NOT NULL;
INSERT INTO `library_deletions` (`id`, `organization_id`, `item_kind`, `item_id`, `title`, `deleted_by`, `deleted_at`)
SELECT UUID(), r.`organization_id`, 'reel', r.`id`, r.`name`, r.`removed_by`, r.`removed_at` FROM `reel_projects` r WHERE r.`removed_at` IS NOT NULL;
INSERT INTO `library_deletions` (`id`, `organization_id`, `item_kind`, `item_id`, `title`, `deleted_by`, `deleted_at`)
SELECT UUID(), j.`organization_id`, 'render', j.`id`, CONCAT(r.`name`, ' · rendered'), j.`removed_by`, j.`removed_at`
  FROM `render_jobs` j JOIN `reel_projects` r ON r.`id` = j.`reel_id` WHERE j.`removed_at` IS NOT NULL AND r.`removed_at` IS NULL;
INSERT INTO `library_deletion_items` (`deletion_id`, `item_kind`, `item_id`, `prior`)
SELECT d.`id`, d.`item_kind`, d.`item_id`, JSON_OBJECT() FROM `library_deletions` d;
