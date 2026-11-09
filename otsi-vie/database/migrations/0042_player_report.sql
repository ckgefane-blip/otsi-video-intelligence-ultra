-- 0042 Player Report: notes and tags, assessment, scouting dossiers, PDF reports (OTSI VIE v2, MySQL 8.4) - 2026-11-06, ADR-056
-- Page 08 T rows. Everything here is written by people of one organization about a player; nothing is engine output.
--  * Notes: a team note about a player is a comment with player_id (author a member; never a share-link guest). Notes may be longer than
--    the 255 characters of reel notes: the body widens to 2000 for every comment (widening keeps every existing row).
--  * Tags: short labels per player per organization.
--  * Assessment: the analyst's role, summary, traits, rating, criteria and notes. `draft` is what is being written; `published` is the
--    version shown on the report (null until someone publishes); who published it and when.
--  * Scouting dossiers: named lists of players of an organization.
--  * report_jobs: a player report is not tied to one project (project_id becomes optional); when it finished and why it failed.
-- Forward-only: new tables, nullable columns, a relaxed NOT NULL and a widened column.
ALTER TABLE `comments`
  MODIFY `body` VARCHAR(2000) NOT NULL,
  ADD COLUMN `player_id` CHAR(36) NULL,
  ADD CONSTRAINT `fk_comments_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`),
  ADD CONSTRAINT `ck_comments_player_note_by_member` CHECK (`player_id` IS NULL OR `author_id` IS NOT NULL),
  ADD KEY `ix_comments_org_player` (`organization_id`, `player_id`, `created_at`);

CREATE TABLE `player_tags` (
  `organization_id` CHAR(36) NOT NULL,
  `player_id` CHAR(36) NOT NULL,
  `tag` VARCHAR(40) NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`organization_id`, `player_id`, `tag`),
  CONSTRAINT `fk_player_tags_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_player_tags_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_player_tags_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_player_tags_tag` CHECK (CHAR_LENGTH(TRIM(`tag`)) BETWEEN 1 AND 40)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `player_assessments` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `player_id` CHAR(36) NOT NULL,
  `draft` JSON NOT NULL,
  `published` JSON NULL,
  `published_by` CHAR(36) NULL,
  `published_at` DATETIME(6) NULL,
  `updated_by` CHAR(36) NOT NULL,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `version` INT NOT NULL DEFAULT 1,
  UNIQUE KEY `uq_player_assessments` (`organization_id`, `player_id`),
  CONSTRAINT `fk_player_assessments_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_player_assessments_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_player_assessments_published_by` FOREIGN KEY (`published_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_player_assessments_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_player_assessments_published` CHECK ((`published` IS NULL) = (`published_by` IS NULL) AND (`published` IS NULL) = (`published_at` IS NULL)),
  CONSTRAINT `ck_player_assessments_version` CHECK (`version` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `scouting_dossiers` (
  `id` CHAR(36) PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY `uq_scouting_dossiers_name` (`organization_id`, `name`),
  CONSTRAINT `fk_scouting_dossiers_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_scouting_dossiers_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_scouting_dossiers_name` CHECK (CHAR_LENGTH(TRIM(`name`)) BETWEEN 1 AND 80)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `scouting_dossier_players` (
  `dossier_id` CHAR(36) NOT NULL,
  `player_id` CHAR(36) NOT NULL,
  `added_by` CHAR(36) NOT NULL,
  `added_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`dossier_id`, `player_id`),
  KEY `ix_scouting_dossier_players_player` (`player_id`),
  CONSTRAINT `fk_scouting_dossier_players_dossier` FOREIGN KEY (`dossier_id`) REFERENCES `scouting_dossiers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_scouting_dossier_players_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_scouting_dossier_players_by` FOREIGN KEY (`added_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE `report_jobs`
  MODIFY `project_id` CHAR(36) NULL,
  ADD COLUMN `completed_at` DATETIME(6) NULL,
  ADD COLUMN `failure` VARCHAR(255) NULL,
  ADD KEY `ix_report_jobs_org_player` (`organization_id`, `player_id`, `created_at`);
