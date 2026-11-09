-- 0052 Reel edit history (OTSI VIE v2, MySQL 8.4) - 2026-11-07, ADR-081 (v3 Phase B.1, S11)
-- One row per change to a reel's content, with the reel's editable state before and after it (name, frame, look, clips with their
-- effects and zoom/drawings, transitions). Undo and Redo are rows too: they put a recorded state back and point at the edit they took back
-- or put back (compensating changes; nothing is deleted). state applies to EDIT rows: ACTIVE, UNDONE (redo possible) or DROPPED.
-- The hashes let the server refuse an undo when the reel no longer is what the edit left (409), instead of overwriting someone's work.
-- target_edit_id has no foreign key on purpose: InnoDB cannot cascade a self-reference when the reel is removed (same reel, checked in code).
-- Forward-only: a new table; removed with its reel.
CREATE TABLE `reel_edits` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `reel_id` CHAR(36) NOT NULL,
  `seq` INT NOT NULL,
  `kind` VARCHAR(8) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `label` VARCHAR(255) NOT NULL,
  `state` VARCHAR(8) NULL,
  `target_edit_id` CHAR(36) NULL,
  `actor_user_id` CHAR(36) NULL,
  `before_state` JSON NOT NULL,
  `after_state` JSON NOT NULL,
  `before_hash` CHAR(64) NOT NULL,
  `after_hash` CHAR(64) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reel_edits_seq` (`reel_id`, `seq`),
  KEY `idx_reel_edits_state` (`reel_id`, `kind`, `state`, `seq`),
  KEY `idx_reel_edits_target` (`target_edit_id`),
  CONSTRAINT `fk_reel_edits_reel` FOREIGN KEY (`reel_id`, `organization_id`) REFERENCES `reel_projects` (`id`, `organization_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reel_edits_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_reel_edits_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `ck_reel_edits_kind` CHECK (`kind` IN ('EDIT', 'UNDO', 'REDO')),
  CONSTRAINT `ck_reel_edits_state` CHECK ((`kind` = 'EDIT') = (`state` IS NOT NULL) AND (`state` IS NULL OR `state` IN ('ACTIVE', 'UNDONE', 'DROPPED'))),
  CONSTRAINT `ck_reel_edits_target` CHECK ((`kind` = 'EDIT') = (`target_edit_id` IS NULL)),
  CONSTRAINT `ck_reel_edits_states_json` CHECK (JSON_TYPE(`before_state`) = 'OBJECT' AND JSON_TYPE(`after_state`) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
