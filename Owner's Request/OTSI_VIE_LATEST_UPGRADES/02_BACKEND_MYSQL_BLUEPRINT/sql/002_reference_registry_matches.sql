-- Migration 002 — Reference data, canonical player registry (OTSI Player IDs), clubs, competitions, matches, rosters
USE `otsi_owner_vie`;

CREATE TABLE countries (
  code              CHAR(2) CHARACTER SET ascii NOT NULL COMMENT 'ISO 3166-1 alpha-2',
  code3             CHAR(3) CHARACTER SET ascii NOT NULL,
  name              VARCHAR(100) NOT NULL,
  flag_asset_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'Flag tile shown beside nationality (06, 08, 04)',
  PRIMARY KEY (code),
  UNIQUE KEY uq_countries_code3 (code3),
  CONSTRAINT fk_countries_flag FOREIGN KEY (flag_asset_id) REFERENCES assets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE competitions (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_organization_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'NULL = platform catalogue; else tenant-private competition',
  name              VARCHAR(150) NOT NULL COMMENT 'e.g. shown in Match card, Competition select, Library filter',
  short_name        VARCHAR(30) NULL COMMENT 'e.g. chip "UCL"',
  competition_type  ENUM('LEAGUE','CUP','INTERNATIONAL','FRIENDLY','YOUTH','TRAINING','OTHER') NOT NULL,
  country_code      CHAR(2) CHARACTER SET ascii NULL,
  logo_asset_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  logo_license_ref  VARCHAR(255) NULL COMMENT 'Required before any logo is rendered (no implied endorsement)',
  external_ids      JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  owner_key         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin AS (COALESCE(owner_organization_id, 'GLOBAL')) STORED COMMENT 'NULL-safe uniqueness',
  PRIMARY KEY (id),
  UNIQUE KEY uq_competitions_owner_name (owner_key, name),
  CONSTRAINT fk_competitions_owner   FOREIGN KEY (owner_organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_competitions_country FOREIGN KEY (country_code) REFERENCES countries(code),
  CONSTRAINT fk_competitions_logo    FOREIGN KEY (logo_asset_id) REFERENCES assets(id),
  CONSTRAINT ck_competitions_logo_license CHECK (logo_asset_id IS NULL OR logo_license_ref IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE seasons (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  competition_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  label             VARCHAR(20) NOT NULL COMMENT 'Season select value, e.g. 2024/2025',
  starts_on         DATE NOT NULL,
  ends_on           DATE NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_seasons_comp_label (competition_id, label),
  CONSTRAINT fk_seasons_comp FOREIGN KEY (competition_id) REFERENCES competitions(id),
  CONSTRAINT ck_seasons_range CHECK (ends_on > starts_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE clubs (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_organization_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  canonical_name    VARCHAR(150) NOT NULL COMMENT 'e.g. team name lines in match cards',
  short_name        VARCHAR(50) NULL,
  code3             CHAR(3) CHARACTER SET ascii NULL COMMENT 'Scorebug / badges e.g. MCI, RMA',
  country_code      CHAR(2) CHARACTER SET ascii NULL,
  crest_asset_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  crest_license_ref VARCHAR(255) NULL,
  primary_color_hex CHAR(7) CHARACTER SET ascii NULL COMMENT 'Crest circle fallback colour',
  external_ids      JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_clubs_name (canonical_name),
  CONSTRAINT fk_clubs_owner   FOREIGN KEY (owner_organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_clubs_country FOREIGN KEY (country_code) REFERENCES countries(code),
  CONSTRAINT fk_clubs_crest   FOREIGN KEY (crest_asset_id) REFERENCES assets(id),
  CONSTRAINT ck_clubs_crest_license CHECK (crest_asset_id IS NULL OR crest_license_ref IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE club_aliases (
  club_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  alias             VARCHAR(150) NOT NULL,
  source            VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
  PRIMARY KEY (club_id, alias),
  KEY ix_club_aliases_alias (alias),
  CONSTRAINT fk_club_aliases_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE club_kits (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  club_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  season_label      VARCHAR(20) NULL,
  kit_type          ENUM('HOME','AWAY','THIRD','GK','OTHER') NOT NULL,
  colour_name       VARCHAR(40) NULL COMMENT 'Team Identification tile: "(Blue)" / "(White)"',
  shirt_color_hex   CHAR(7) CHARACTER SET ascii NOT NULL,
  shorts_color_hex  CHAR(7) CHARACTER SET ascii NULL,
  PRIMARY KEY (id),
  KEY ix_club_kits_club (club_id, season_label),
  CONSTRAINT fk_club_kits_club FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE positions (
  code              VARCHAR(4) CHARACTER SET ascii NOT NULL COMMENT 'GK, CB, LB, RB, DM, MC, AM, LW, RW, CF ...',
  label             VARCHAR(40) NOT NULL COMMENT 'Midfielder / Attacking Midfielder ...',
  line              ENUM('GOALKEEPER','DEFENDER','MIDFIELDER','FORWARD') NOT NULL,
  sort_order        TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

-- Canonical OTSI Player IDs: OTSI-CCC-YYYY-NNNNNN, allocated server-side ONLY via sp_allocate_otsi_player_id (migration 011).
CREATE TABLE otsi_player_id_sequences (
  country_code      CHAR(3) CHARACTER SET ascii NOT NULL,
  year_part         SMALLINT UNSIGNED NOT NULL,
  next_value        INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (country_code, year_part),
  CONSTRAINT ck_otsi_seq CHECK (next_value BETWEEN 1 AND 999999)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE players (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_organization_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'NULL = platform registry; else tenant-private (e.g. academy player)',
  canonical_otsi_id VARCHAR(20) CHARACTER SET ascii NULL,
  canonical_state   ENUM('PENDING','VERIFIED','MERGED','RETIRED') NOT NULL DEFAULT 'PENDING',
  merged_into_player_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  display_name      VARCHAR(120) NOT NULL COMMENT 'Hero name, list names',
  short_name        VARCHAR(60) NULL COMMENT 'Timeline lane labels e.g. "K. De Bruyne"',
  shirt_name        VARCHAR(30) NULL COMMENT 'Formation board labels (uppercase surname)',
  given_name        VARCHAR(80) NULL,
  family_name       VARCHAR(80) NULL,
  birth_date        DATE NULL COMMENT 'Age is DERIVED, never stored',
  nationality_code  CHAR(2) CHARACTER SET ascii NULL,
  second_nationality_code CHAR(2) CHARACTER SET ascii NULL,
  height_cm         SMALLINT UNSIGNED NULL,
  weight_kg         DECIMAL(5,1) NULL,
  preferred_foot    ENUM('LEFT','RIGHT','BOTH','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  primary_position_code VARCHAR(4) CHARACTER SET ascii NULL,
  photo_asset_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  photo_license_ref VARCHAR(255) NULL,
  bio_evidence_state ENUM('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') NOT NULL DEFAULT 'NOT_MEASURED' COMMENT 'Provenance of height/weight/birth date',
  external_ids      JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  row_version       BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_players_otsi_id (canonical_otsi_id),
  KEY ix_players_name (display_name),
  FULLTEXT KEY ft_players_names (display_name, short_name, family_name),
  CONSTRAINT fk_players_owner    FOREIGN KEY (owner_organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_players_merged   FOREIGN KEY (merged_into_player_id) REFERENCES players(id),
  CONSTRAINT fk_players_nat      FOREIGN KEY (nationality_code) REFERENCES countries(code),
  CONSTRAINT fk_players_nat2     FOREIGN KEY (second_nationality_code) REFERENCES countries(code),
  CONSTRAINT fk_players_position FOREIGN KEY (primary_position_code) REFERENCES positions(code),
  CONSTRAINT fk_players_photo    FOREIGN KEY (photo_asset_id) REFERENCES assets(id),
  CONSTRAINT ck_players_otsi_format CHECK (canonical_otsi_id IS NULL OR REGEXP_LIKE(canonical_otsi_id, '^OTSI-[A-Z]{3}-[0-9]{4}-[0-9]{6}$', 'c')),
  CONSTRAINT ck_players_verified_has_id CHECK (canonical_state <> 'VERIFIED' OR canonical_otsi_id IS NOT NULL),
  CONSTRAINT ck_players_merged CHECK ((canonical_state = 'MERGED') = (merged_into_player_id IS NOT NULL)),
  CONSTRAINT ck_players_height CHECK (height_cm IS NULL OR height_cm BETWEEN 120 AND 230),
  CONSTRAINT ck_players_weight CHECK (weight_kg IS NULL OR weight_kg BETWEEN 30 AND 150),
  CONSTRAINT ck_players_photo_license CHECK (photo_asset_id IS NULL OR photo_license_ref IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE player_positions (
  player_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  position_code     VARCHAR(4) CHARACTER SET ascii NOT NULL,
  is_primary        BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order        TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Hero chips MC / AM / RW order',
  PRIMARY KEY (player_id, position_code),
  CONSTRAINT fk_player_positions_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  CONSTRAINT fk_player_positions_pos    FOREIGN KEY (position_code) REFERENCES positions(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE player_club_spells (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  club_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  squad_number      TINYINT UNSIGNED NULL COMMENT 'Jersey badge (never used to infer identity)',
  valid_from        DATE NOT NULL,
  valid_to          DATE NULL,
  source            VARCHAR(80) NOT NULL DEFAULT 'MANUAL',
  verified          BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  KEY ix_spells_player (player_id, valid_from),
  KEY ix_spells_club (club_id, valid_from),
  CONSTRAINT fk_spells_player FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  CONSTRAINT fk_spells_club   FOREIGN KEY (club_id) REFERENCES clubs(id),
  CONSTRAINT ck_spells_number CHECK (squad_number IS NULL OR squad_number <= 99),
  CONSTRAINT ck_spells_range  CHECK (valid_to IS NULL OR valid_to >= valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE matches (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  competition_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  season_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  match_type        ENUM('MATCH','TRAINING','FRIENDLY','OTHER') NOT NULL DEFAULT 'MATCH' COMMENT 'Recent upload subtitle "Training"',
  title_override    VARCHAR(200) NULL COMMENT 'Used when not a fixture (e.g. "Training Session")',
  kickoff_at        DATETIME(6) NULL COMMENT 'Match card date "Tue, 16 Apr 2024" (formatted client-side in org timezone)',
  venue             VARCHAR(150) NULL,
  home_club_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  away_club_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  home_score        TINYINT UNSIGNED NULL,
  away_score        TINYINT UNSIGNED NULL,
  score_state       ENUM('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') NOT NULL DEFAULT 'NOT_MEASURED',
  metadata_state    ENUM('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') NOT NULL DEFAULT 'INFERRED',
  match_status      ENUM('SCHEDULED','PLAYED','ABANDONED','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  created_by        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  row_version       BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_matches_org_id (organization_id, id),
  KEY ix_matches_org_kickoff (organization_id, kickoff_at),
  KEY ix_matches_org_comp (organization_id, competition_id, season_id),
  KEY ix_matches_clubs (home_club_id, away_club_id),
  CONSTRAINT fk_matches_org    FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_matches_comp   FOREIGN KEY (competition_id) REFERENCES competitions(id),
  CONSTRAINT fk_matches_season FOREIGN KEY (season_id) REFERENCES seasons(id),
  CONSTRAINT fk_matches_home   FOREIGN KEY (home_club_id) REFERENCES clubs(id),
  CONSTRAINT fk_matches_away   FOREIGN KEY (away_club_id) REFERENCES clubs(id),
  CONSTRAINT fk_matches_user   FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_matches_distinct_clubs CHECK (home_club_id IS NULL OR away_club_id IS NULL OR home_club_id <> away_club_id),
  CONSTRAINT ck_matches_score CHECK ((home_score IS NULL) = (away_score IS NULL)),
  CONSTRAINT ck_matches_score_state CHECK (score_state <> 'NOT_MEASURED' OR home_score IS NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE match_periods (
  match_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  period            ENUM('FIRST_HALF','SECOND_HALF','ET_FIRST','ET_SECOND','PENALTIES') NOT NULL COMMENT 'Time Range radio: 1st Half / 2nd Half',
  clock_start_ms    INT UNSIGNED NOT NULL COMMENT 'Match clock at period start (0, 2700000 ...)',
  added_time_ms     INT UNSIGNED NULL,
  PRIMARY KEY (match_id, period),
  CONSTRAINT fk_match_periods_match FOREIGN KEY (organization_id, match_id) REFERENCES matches(organization_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE match_rosters (
  match_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  club_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  side              ENUM('HOME','AWAY') NOT NULL,
  jersey_number     TINYINT UNSIGNED NULL,
  position_code     VARCHAR(4) CHARACTER SET ascii NULL,
  is_starter        BOOLEAN NOT NULL DEFAULT FALSE,
  minutes_on        SMALLINT UNSIGNED NULL,
  minutes_off       SMALLINT UNSIGNED NULL,
  roster_state      ENUM('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') NOT NULL DEFAULT 'INFERRED',
  source_uri        VARCHAR(1024) NULL,
  PRIMARY KEY (match_id, player_id),
  UNIQUE KEY uq_rosters_number (match_id, side, jersey_number),
  KEY ix_rosters_player (player_id),
  KEY ix_rosters_org (organization_id, match_id, side),
  CONSTRAINT fk_rosters_match  FOREIGN KEY (organization_id, match_id) REFERENCES matches(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_rosters_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_rosters_club   FOREIGN KEY (club_id) REFERENCES clubs(id),
  CONSTRAINT fk_rosters_pos    FOREIGN KEY (position_code) REFERENCES positions(code),
  CONSTRAINT ck_rosters_number CHECK (jersey_number IS NULL OR jersey_number <= 99)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC COMMENT='Team Filter counts (All Players 22 / team 11) = COUNT(*) per side';

CREATE TABLE partner_brands (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name              VARCHAR(120) NOT NULL,
  logo_asset_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  license_ref       VARCHAR(255) NOT NULL COMMENT 'Contract / written permission reference. No row => nothing shown',
  license_valid_until DATE NULL,
  display_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  CONSTRAINT fk_partner_brands_logo FOREIGN KEY (logo_asset_id) REFERENCES assets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC COMMENT='01 Home "TRUSTED PARTNERS" strip — only licensed marks';
