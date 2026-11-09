-- Migration 003 — Projects, folders, tags, unified Library catalogue (09), saved searches, bookmarks, comments
USE `otsi_owner_vie`;

CREATE TABLE projects (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  name              VARCHAR(200) NOT NULL,
  description       TEXT NULL,
  primary_match_id  ID36 NULL,
  status            ENUM('ACTIVE','ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
  created_by        ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  updated_at        UPDTS,
  row_version       BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_projects_org_id (organization_id, id),
  KEY ix_projects_org_updated (organization_id, status, updated_at),
  CONSTRAINT fk_projects_org   FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_projects_match FOREIGN KEY (organization_id, primary_match_id) REFERENCES matches(organization_id, id),
  CONSTRAINT fk_projects_user  FOREIGN KEY (organization_id, created_by) REFERENCES memberships(organization_id, user_id)
) TBL;

ALTER TABLE assets ADD CONSTRAINT fk_assets_project FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id);

CREATE TABLE project_members (
  project_id        ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  user_id           ID36 NOT NULL,
  permission        ENUM('READ','COMMENT','EDIT','REVIEW','ADMIN') NOT NULL,
  granted_by        ID36 NOT NULL,
  granted_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (project_id, user_id),
  KEY ix_project_members_user (organization_id, user_id),
  CONSTRAINT fk_pm_project FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_member  FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_granter FOREIGN KEY (granted_by) REFERENCES users(id)
) TBL;

CREATE TABLE folders (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  parent_folder_id  ID36 NULL,
  name              VARCHAR(150) NOT NULL COMMENT 'Media Bin breadcrumb segments / Library "Folder" rows',
  folder_kind       ENUM('GENERAL','SCOUTING_DOSSIER','MEDIA_BIN','DELIVERY_PACK') NOT NULL DEFAULT 'GENERAL',
  path_cache        VARCHAR(2000) NULL COMMENT 'Materialised "/Folders/Team/Player/Season" for breadcrumb',
  depth             TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_by        ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  updated_at        UPDTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_folders_org_id (organization_id, id),
  UNIQUE KEY uq_folders_sibling_name (organization_id, parent_folder_id, name),
  CONSTRAINT fk_folders_org    FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_folders_parent FOREIGN KEY (organization_id, parent_folder_id) REFERENCES folders(organization_id, id),
  CONSTRAINT fk_folders_user   FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_folders_depth  CHECK (depth <= 12)
) TBL;

CREATE TABLE tags (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  label             VARCHAR(60) NOT NULL COMMENT 'Chips: Progressive, Passing, UCL, Build-up ...',
  normalized_label  VARCHAR(60) AS (LOWER(TRIM(label))) STORED,
  tag_kind          ENUM('FREE','EVENT','PLAYER','COMPETITION','SYSTEM') NOT NULL DEFAULT 'FREE',
  color_hex         CHAR(7) CHARACTER SET ascii NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tags_org_id (organization_id, id),
  UNIQUE KEY uq_tags_org_label (organization_id, normalized_label),
  CONSTRAINT fk_tags_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
) TBL;

-- Unified catalogue powering Library tabs, counts, table rows, search and the Selected Item panel.
-- Domain tables (reels, reports, matches, folders, render outputs, templates, clips) are the source of truth;
-- library_items is written in the SAME transaction as the domain write (or by outbox projector) — never edited by users directly.
CREATE TABLE library_items (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  project_id        ID36 NULL,
  folder_id         ID36 NULL,
  item_type         ENUM('REEL','REPORT','MATCH','FOLDER','EXPORT','TEMPLATE','CLIP','VIDEO') NOT NULL COMMENT 'Type pill',
  entity_id         ID36 NOT NULL COMMENT 'PK of the domain row for item_type',
  title             VARCHAR(255) NOT NULL COMMENT 'Row title',
  subtitle          VARCHAR(255) NULL COMMENT 'Row subtitle (series / match label)',
  description       TEXT NULL COMMENT 'Selected Item description',
  status            ENUM('DRAFT','IN_REVIEW','PUBLISHED','SHARED','EXPORTED','ARCHIVED','FAILED') NOT NULL DEFAULT 'DRAFT' COMMENT 'Status pill',
  match_id          ID36 NULL,
  competition_id    ID36 NULL,
  primary_club_id   ID36 NULL,
  duration_us       BIGINT UNSIGNED NULL COMMENT 'Thumbnail duration chip / Duration row',
  byte_size         BIGINT UNSIGNED NULL COMMENT 'File Size row',
  width_px          SMALLINT UNSIGNED NULL,
  height_px         SMALLINT UNSIGNED NULL COMMENT 'Resolution row derived (e.g. 1080p)',
  thumbnail_asset_id ID36 NULL,
  primary_asset_id  ID36 NULL COMMENT 'Download target',
  is_featured       BOOLEAN NOT NULL DEFAULT FALSE COMMENT '01 Home FEATURED REEL',
  is_template       BOOLEAN NOT NULL DEFAULT FALSE,
  shared_with_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_by        ID36 NOT NULL COMMENT 'Created By row',
  curated_at        TS6 NULL COMMENT 'Curated row',
  created_at        TS6 NOT NULL NOWTS,
  updated_at        TS6 NOT NULL NOWTS COMMENT 'Updated column (domain last change, set by projector)',
  deleted_at        TS6 NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_library_items_org_id (organization_id, id),
  UNIQUE KEY uq_library_items_entity (organization_id, item_type, entity_id),
  KEY ix_library_tab (organization_id, item_type, deleted_at, updated_at),
  KEY ix_library_status (organization_id, status, updated_at),
  KEY ix_library_comp (organization_id, competition_id, updated_at),
  KEY ix_library_club (organization_id, primary_club_id, updated_at),
  KEY ix_library_creator (organization_id, created_by, updated_at),
  KEY ix_library_folder (organization_id, folder_id),
  KEY ix_library_featured (organization_id, is_featured, updated_at),
  FULLTEXT KEY ft_library_search (title, subtitle, description),
  CONSTRAINT fk_li_org     FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_li_project FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id),
  CONSTRAINT fk_li_folder  FOREIGN KEY (organization_id, folder_id) REFERENCES folders(organization_id, id),
  CONSTRAINT fk_li_match   FOREIGN KEY (organization_id, match_id) REFERENCES matches(organization_id, id),
  CONSTRAINT fk_li_comp    FOREIGN KEY (competition_id) REFERENCES competitions(id),
  CONSTRAINT fk_li_club    FOREIGN KEY (primary_club_id) REFERENCES clubs(id),
  CONSTRAINT fk_li_thumb   FOREIGN KEY (organization_id, thumbnail_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_li_primary FOREIGN KEY (organization_id, primary_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_li_creator FOREIGN KEY (created_by) REFERENCES users(id)
) TBL;

CREATE TABLE library_item_players (
  library_item_id   ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  player_id         ID36 NOT NULL,
  display_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Players Featured avatars (first N + "+n")',
  PRIMARY KEY (library_item_id, player_id),
  KEY ix_lip_player (organization_id, player_id),
  CONSTRAINT fk_lip_item   FOREIGN KEY (organization_id, library_item_id) REFERENCES library_items(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_lip_player FOREIGN KEY (player_id) REFERENCES players(id)
) TBL;

CREATE TABLE library_item_tags (
  library_item_id   ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  tag_id            ID36 NOT NULL,
  PRIMARY KEY (library_item_id, tag_id),
  KEY ix_lit_tag (organization_id, tag_id),
  CONSTRAINT fk_lit_item FOREIGN KEY (organization_id, library_item_id) REFERENCES library_items(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_lit_tag  FOREIGN KEY (organization_id, tag_id) REFERENCES tags(organization_id, id) ON DELETE CASCADE
) TBL;

CREATE TABLE library_item_collaborators (
  library_item_id   ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  user_id           ID36 NOT NULL,
  access            ENUM('VIEW','COMMENT','EDIT','OWNER') NOT NULL DEFAULT 'VIEW',
  added_by          ID36 NOT NULL,
  added_at          TS6 NOT NULL NOWTS,
  PRIMARY KEY (library_item_id, user_id),
  KEY ix_lic_user (organization_id, user_id),
  CONSTRAINT fk_lic_item   FOREIGN KEY (organization_id, library_item_id) REFERENCES library_items(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_lic_member FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE,
  CONSTRAINT fk_lic_adder  FOREIGN KEY (added_by) REFERENCES users(id)
) TBL COMMENT='Collaborators column / Selected Item Collaborators / Manage Access';

CREATE TABLE saved_searches (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  user_id           ID36 NOT NULL,
  name              VARCHAR(80) NOT NULL COMMENT 'Saved Searches chip label',
  icon              ENUM('SEARCH','GRID') NOT NULL DEFAULT 'SEARCH',
  query             JSON NOT NULL COMMENT '{text,type,competitionId,clubId,createdBy,dateRange,tab}',
  display_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_saved_searches_name (organization_id, user_id, name),
  CONSTRAINT fk_ss_member FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE,
  CONSTRAINT ck_ss_query CHECK (JSON_SCHEMA_VALID('{"type":"object","additionalProperties":false,"properties":{
      "text":{"type":"string","maxLength":200},"tab":{"type":"string"},"type":{"type":"string"},
      "competitionId":{"type":"string"},"clubId":{"type":"string"},"createdBy":{"type":"string"},
      "dateRange":{"type":"string","enum":["LAST_7_DAYS","LAST_30_DAYS","LAST_3_MONTHS","LAST_12_MONTHS","ALL","CUSTOM"]},
      "from":{"type":"string"},"to":{"type":"string"}}}', query))
) TBL;

CREATE TABLE bookmarks (
  organization_id   ID36 NOT NULL,
  user_id           ID36 NOT NULL,
  library_item_id   ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (organization_id, user_id, library_item_id),
  CONSTRAINT fk_bm_member FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE,
  CONSTRAINT fk_bm_item   FOREIGN KEY (organization_id, library_item_id) REFERENCES library_items(organization_id, id) ON DELETE CASCADE
) TBL COMMENT='01 Home sample-reel bookmark icon';

CREATE TABLE item_engagement_daily (
  organization_id   ID36 NOT NULL,
  library_item_id   ID36 NOT NULL,
  day               DATE NOT NULL,
  views             INT UNSIGNED NOT NULL DEFAULT 0,
  likes             INT UNSIGNED NOT NULL DEFAULT 0,
  shares            INT UNSIGNED NOT NULL DEFAULT 0,
  downloads         INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, library_item_id, day),
  CONSTRAINT fk_ied_item FOREIGN KEY (organization_id, library_item_id) REFERENCES library_items(organization_id, id) ON DELETE CASCADE
) TBL COMMENT='01 Home eye/heart counts = SUM over item; written by share/playback event consumers';

CREATE TABLE item_likes (
  organization_id   ID36 NOT NULL,
  library_item_id   ID36 NOT NULL,
  user_id           ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (organization_id, library_item_id, user_id),
  CONSTRAINT fk_il_item   FOREIGN KEY (organization_id, library_item_id) REFERENCES library_items(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_il_member FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id) ON DELETE CASCADE
) TBL;

CREATE TABLE comments (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  library_item_id   ID36 NULL,
  project_id        ID36 NULL,
  parent_comment_id ID36 NULL,
  author_user_id    ID36 NULL,
  author_share_link_id ID36 NULL COMMENT 'External reviewer via share link with Allow Comments',
  body              VARCHAR(4000) NOT NULL,
  at_pts_us         BIGINT UNSIGNED NULL,
  resolved_at       TS6 NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_comments_org_id (organization_id, id),
  KEY ix_comments_item (organization_id, library_item_id, created_at),
  CONSTRAINT fk_comments_item   FOREIGN KEY (organization_id, library_item_id) REFERENCES library_items(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_proj   FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id),
  CONSTRAINT fk_comments_parent FOREIGN KEY (organization_id, parent_comment_id) REFERENCES comments(organization_id, id),
  CONSTRAINT fk_comments_author FOREIGN KEY (author_user_id) REFERENCES users(id),
  CONSTRAINT ck_comments_author CHECK (author_user_id IS NOT NULL OR author_share_link_id IS NOT NULL)
) TBL;
