-- 0055 search index (OTSI VIE v2, MySQL 8.4): v3 Phase B.10 (ADR-086), 2026-11-07
-- A read model for Smart Search. One row per findable item of an organization (a match/video, player, reel, project, an engine moment,
-- a marker) with what the result list shows, and its words in search_terms for prefix matching. It is derived data only: it is
-- rebuilt from the canonical tables (outbox events and a catch-up over changed rows keep it current) and never decides access; every
-- query re-checks the canonical rows (removed, hidden project, merged player). Forward-only; dropping it loses nothing.
CREATE TABLE `search_documents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `kind` VARCHAR(12) NOT NULL,
  `entity_id` CHAR(36) NOT NULL,                       -- the video, player, reel, project, event candidate or marker
  `video_id` CHAR(36) NULL,                            -- matches, moments and markers: the video (access is re-checked through it)
  `at_us` BIGINT NULL,                                 -- moments and markers: the time on the video
  `title` VARCHAR(300) NOT NULL,
  `detail` VARCHAR(300) NULL,
  `ref` VARCHAR(64) NULL,                              -- players: the OTSI Player ID
  `event_type` VARCHAR(32) NULL,                       -- moments: GOAL, SHOT, PASS, ...
  `analysed` TINYINT NULL,                          -- matches: a finished analysis exists
  `confirmed` TINYINT NULL,                         -- players: has an OTSI Player ID; moments: the player is a person-confirmed identity
  `sort_at` DATETIME(6) NOT NULL,                      -- newest first among equal scores
  `indexed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY `uq_search_doc` (`organization_id`, `kind`, `entity_id`),
  KEY `idx_search_doc_video` (`organization_id`, `video_id`, `kind`),
  CONSTRAINT `fk_search_doc_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ck_search_doc_kind` CHECK (`kind` IN ('MATCH', 'PLAYER', 'REEL', 'PROJECT', 'MOMENT', 'MARKER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- the words of each item, normalized by the shared searchTerms() (lower case, no accents, letters and digits only); field 1 = the title
CREATE TABLE `search_terms` (
  `doc_id` BIGINT UNSIGNED NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `term` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `field` TINYINT NOT NULL,
  PRIMARY KEY (`doc_id`, `term`, `field`),
  KEY `idx_search_terms_term` (`organization_id`, `term`, `doc_id`),
  CONSTRAINT `fk_search_terms_doc` FOREIGN KEY (`doc_id`) REFERENCES `search_documents` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- per organization: how far the catch-up has read the canonical tables (the newest change it indexed, minus a safety overlap)
CREATE TABLE `search_index_state` (
  `organization_id` CHAR(36) NOT NULL PRIMARY KEY,
  `version` INT NOT NULL,                              -- the indexer's rules version; a different one rebuilds the organization
  `watermark` DATETIME(6) NOT NULL,
  `rebuilt_at` DATETIME(6) NULL,
  CONSTRAINT `fk_search_state_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
