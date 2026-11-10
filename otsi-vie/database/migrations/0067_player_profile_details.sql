-- 0067 player profile details for the Player Profile Intro (OTSI VIE v2, MySQL 8.4): ADR-130, 2026-11-10
-- The fields the intro's reference layout shows that the engine does not measure — height and weight, a photo, strengths, a summary,
-- the current club and league, and the international career. All of it is USER_ENTERED: a person typed it, it is shown as such, and a
-- field left empty stays empty (the intro shows "Not measured" / "Unconfirmed"), never filled from a guess (ADR-124).
-- One row per player, keyed by the player (the registry's internal id); the canonical OTSI Player ID is unchanged (ADR-016: the
-- reference image's "OTSI-P-0000001847" is a mock format — the engine's real, allocator-issued ID is OTSI-CCC-YYYY-NNNNNN).
-- The photo is an asset (kind 'PLAYER_PHOTO', following 0032/0044/0054 for BRAND/BUNDLE/SNAPSHOT). Forward-only: one enum value, one table.
ALTER TABLE `assets` MODIFY COLUMN `kind`
  ENUM('SOURCE','PROXY','THUMBNAIL','TRACKS','EVENTS','REEL','REPORT','HEATMAP','MANIFEST','CAPTIONS','DETECTIONS','EMBEDDINGS','BRAND','BUNDLE','SNAPSHOT','PLAYER_PHOTO') NOT NULL;

CREATE TABLE `player_profile_details` (
  `player_id` CHAR(36) NOT NULL PRIMARY KEY,
  `height_cm` SMALLINT UNSIGNED NULL,
  `weight_kg` DECIMAL(5,1) NULL,
  `photo_asset_id` CHAR(36) NULL,
  `strengths` JSON NULL COMMENT 'array of at most 6 short strings, in the order the person wrote them; NULL = none entered',
  `summary` TEXT NULL,
  `club_name` VARCHAR(255) NULL COMMENT 'the current club as the person entered it; used only where no match team sheet names one',
  `league` VARCHAR(255) NULL,
  `international_country_code` VARCHAR(3) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `international_caps` INT UNSIGNED NULL,
  `international_goals` INT UNSIGNED NULL,
  `updated_by` CHAR(36) NULL,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT `fk_ppd_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`),
  CONSTRAINT `fk_ppd_photo` FOREIGN KEY (`photo_asset_id`) REFERENCES `assets` (`id`),
  CONSTRAINT `fk_ppd_country` FOREIGN KEY (`international_country_code`) REFERENCES `countries` (`code`),
  CONSTRAINT `fk_ppd_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_ppd_height` CHECK (`height_cm` IS NULL OR `height_cm` BETWEEN 100 AND 250),
  CONSTRAINT `ck_ppd_weight` CHECK (`weight_kg` IS NULL OR `weight_kg` BETWEEN 30 AND 200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
