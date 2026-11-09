-- 0049 Notifications bell: when each person last opened it, per organization (OTSI VIE v2, MySQL 8.4) - 2026-11-06, ADR-075 (v3 Phase A.15, S13)
-- The notifications themselves are not stored: they are read from what the organization recorded (finished analyses and renders, identity
-- suggestions for a reel's player, team sheets to approve, share-link comments, rights ending). This row only says which are new to the person:
-- anything recorded after seen_at is unread. No row: everything in the window is unread. Removed with the person or the organization.
-- Forward-only: a new table.
CREATE TABLE `notification_reads` (
  `user_id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `seen_at` DATETIME(6) NOT NULL,
  PRIMARY KEY (`user_id`, `organization_id`),
  CONSTRAINT `fk_notification_reads_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notification_reads_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
