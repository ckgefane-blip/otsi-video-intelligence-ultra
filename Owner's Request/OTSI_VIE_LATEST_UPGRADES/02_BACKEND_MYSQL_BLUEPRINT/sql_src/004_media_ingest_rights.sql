-- Migration 004 — Video sources, ingest options (02 toggles), uploads, URL imports, probing, classification, rights
USE `otsi_owner_vie`;

CREATE TABLE supported_media_formats (
  container_code    VARCHAR(10) CHARACTER SET ascii NOT NULL COMMENT 'MP4, MOV, AVI, MKV, MPEG, FLV, TS, WEBM',
  display_name      VARCHAR(20) NOT NULL,
  codec_summary     VARCHAR(40) NOT NULL COMMENT 'Format chip subtitle e.g. H.264/H.265',
  mime_types        JSON NOT NULL,
  file_extensions   JSON NOT NULL,
  accepted          BOOLEAN NOT NULL DEFAULT TRUE,
  display_order     TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (container_code)
) TBL COMMENT='02 Supported Formats panel; also the server-side ingest allow-list';

CREATE TABLE ingest_limits (
  organization_id   ID36 NOT NULL,
  max_file_bytes    BIGINT UNSIGNED NOT NULL COMMENT 'Copy currently conflicts: 01 "2GB" vs 02 "50 GB" — owner must set one value',
  max_duration_us   BIGINT UNSIGNED NULL,
  max_concurrent_uploads SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  updated_at        UPDTS,
  PRIMARY KEY (organization_id),
  CONSTRAINT fk_ingest_limits_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
) TBL;

CREATE TABLE video_sources (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  project_id        ID36 NOT NULL,
  match_id          ID36 NULL COMMENT 'Match Context: Match select (optional)',
  source_asset_id   ID36 NULL,
  proxy_asset_id    ID36 NULL COMMENT 'Browser playback rendition (HLS/MP4)',
  poster_asset_id   ID36 NULL COMMENT 'Thumbnails in recent lists / previews',
  ingest_mode       ENUM('UPLOAD','DIRECT_URL','AUTHORIZED_PROVIDER','BATCH') NOT NULL COMMENT 'Upload method tabs',
  batch_id          ID36 NULL,
  source_uri        VARCHAR(2048) NULL,
  title             VARCHAR(255) NULL,
  state             ENUM('PENDING','UPLOADING','VALIDATING','INGESTED','FAILED','QUARANTINED','DELETED') NOT NULL DEFAULT 'PENDING',
  failure_code      VARCHAR(64) CHARACTER SET ascii NULL,
  duration_us       BIGINT UNSIGNED NULL COMMENT 'Duration row / thumbnail chip',
  width_px          SMALLINT UNSIGNED NULL,
  height_px         SMALLINT UNSIGNED NULL,
  fps_num           INT UNSIGNED NULL,
  fps_den           INT UNSIGNED NULL,
  fps               DECIMAL(9,4) AS (IF(fps_den IS NULL OR fps_den = 0, NULL, fps_num / fps_den)) STORED COMMENT 'Frame Rate row',
  timebase_num      INT UNSIGNED NULL,
  timebase_den      INT UNSIGNED NULL,
  frame_count       BIGINT UNSIGNED NULL,
  video_codec       VARCHAR(32) CHARACTER SET ascii NULL,
  audio_codec       VARCHAR(32) CHARACTER SET ascii NULL,
  container_code    VARCHAR(10) CHARACTER SET ascii NULL,
  bitrate_bps       BIGINT UNSIGNED NULL,
  video_sha256      CHAR(64) CHARACTER SET ascii NULL,
  created_by        ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  ingested_at       TS6 NULL,
  updated_at        UPDTS,
  row_version       BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_video_sources_org_id (organization_id, id),
  KEY ix_vs_org_recent (organization_id, created_at),
  KEY ix_vs_match (organization_id, match_id),
  KEY ix_vs_state (organization_id, state, created_at),
  KEY ix_vs_sha (organization_id, video_sha256),
  CONSTRAINT fk_vs_project FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id),
  CONSTRAINT fk_vs_match   FOREIGN KEY (organization_id, match_id) REFERENCES matches(organization_id, id),
  CONSTRAINT fk_vs_source  FOREIGN KEY (organization_id, source_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_vs_proxy   FOREIGN KEY (organization_id, proxy_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_vs_poster  FOREIGN KEY (organization_id, poster_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_vs_format  FOREIGN KEY (container_code) REFERENCES supported_media_formats(container_code),
  CONSTRAINT fk_vs_user    FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_vs_ingested CHECK (state <> 'INGESTED' OR (source_asset_id IS NOT NULL AND COALESCE(duration_us, 0) > 0 AND COALESCE(width_px, 0) > 0
                                    AND COALESCE(height_px, 0) > 0 AND COALESCE(fps_num, 0) > 0 AND COALESCE(fps_den, 0) > 0))
) TBL;

-- 02 left column toggles: Visual Processing, AI Overlays (Auto-Detect), Ingest Options. One row per video (immutable after run start).
CREATE TABLE video_ingest_options (
  video_id          ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  stabilize_video   BOOLEAN NOT NULL DEFAULT TRUE,
  auto_crop_pitch   BOOLEAN NOT NULL DEFAULT TRUE,
  enhance_quality   BOOLEAN NOT NULL DEFAULT TRUE,
  remove_crowd_noise BOOLEAN NOT NULL DEFAULT FALSE,
  correct_aspect_ratio BOOLEAN NOT NULL DEFAULT TRUE,
  overlay_players_teams BOOLEAN NOT NULL DEFAULT TRUE,
  overlay_ball_tracking BOOLEAN NOT NULL DEFAULT TRUE,
  overlay_jersey_numbers BOOLEAN NOT NULL DEFAULT TRUE,
  overlay_pitch_lines BOOLEAN NOT NULL DEFAULT TRUE,
  overlay_event_markers BOOLEAN NOT NULL DEFAULT FALSE,
  auto_create_match BOOLEAN NOT NULL DEFAULT TRUE,
  extract_metadata  BOOLEAN NOT NULL DEFAULT TRUE,
  generate_highlights BOOLEAN NOT NULL DEFAULT FALSE,
  send_to_analysis  BOOLEAN NOT NULL DEFAULT TRUE,
  locked_at         TS6 NULL COMMENT 'Set when first pipeline run starts; changes require a new run',
  updated_by        ID36 NOT NULL,
  updated_at        UPDTS,
  PRIMARY KEY (video_id),
  CONSTRAINT fk_vio_video FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_vio_user  FOREIGN KEY (updated_by) REFERENCES users(id)
) TBL;

CREATE TABLE ingest_batches (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  project_id        ID36 NOT NULL,
  label             VARCHAR(150) NULL,
  item_count        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_by        ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ingest_batches_org_id (organization_id, id),
  CONSTRAINT fk_ib_project FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id),
  CONSTRAINT fk_ib_user    FOREIGN KEY (created_by) REFERENCES users(id)
) TBL COMMENT='02 Batch Upload tab';

ALTER TABLE video_sources ADD CONSTRAINT fk_vs_batch FOREIGN KEY (organization_id, batch_id) REFERENCES ingest_batches(organization_id, id);

CREATE TABLE upload_sessions (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  video_id          ID36 NOT NULL,
  created_by        ID36 NOT NULL,
  idempotency_key   VARCHAR(128) CHARACTER SET ascii NOT NULL,
  multipart_upload_id VARCHAR(255) CHARACTER SET ascii NULL,
  original_filename VARCHAR(512) NOT NULL,
  declared_mime_type VARCHAR(127) CHARACTER SET ascii NULL,
  expected_bytes    BIGINT UNSIGNED NOT NULL,
  expected_sha256   CHAR(64) CHARACTER SET ascii NULL,
  part_size_bytes   INT UNSIGNED NOT NULL DEFAULT 67108864,
  transferred_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  progress_pct      DECIMAL(5,2) AS (LEAST(100, ROUND(transferred_bytes * 100 / expected_bytes, 2))) STORED COMMENT 'Uploading stage percent',
  status            ENUM('INITIALIZED','UPLOADING','VERIFYING','COMPLETED','ABORTED','EXPIRED','FAILED') NOT NULL DEFAULT 'INITIALIZED',
  failure_code      VARCHAR(64) CHARACTER SET ascii NULL,
  expires_at        TS6 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  completed_at      TS6 NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_upload_idem (organization_id, idempotency_key),
  KEY ix_upload_video (organization_id, video_id),
  KEY ix_upload_expiry (status, expires_at),
  CONSTRAINT fk_upload_video FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id),
  CONSTRAINT fk_upload_user  FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_upload_bytes CHECK (expected_bytes > 0 AND transferred_bytes <= expected_bytes)
) TBL;

CREATE TABLE upload_parts (
  session_id        ID36 NOT NULL,
  part_number       SMALLINT UNSIGNED NOT NULL,
  byte_size         BIGINT UNSIGNED NOT NULL,
  remote_etag       VARCHAR(255) CHARACTER SET ascii NOT NULL,
  part_sha256       CHAR(64) CHARACTER SET ascii NULL,
  received_at       TS6 NOT NULL NOWTS,
  PRIMARY KEY (session_id, part_number),
  CONSTRAINT fk_upload_parts_session FOREIGN KEY (session_id) REFERENCES upload_sessions(id) ON DELETE CASCADE,
  CONSTRAINT ck_upload_parts CHECK (part_number BETWEEN 1 AND 10000 AND byte_size > 0)
) TBL;

CREATE TABLE url_imports (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  video_id          ID36 NOT NULL,
  submitted_url     VARCHAR(2048) NOT NULL COMMENT '"Paste YouTube link or direct video URL..."',
  provider          ENUM('DIRECT_HTTP','YOUTUBE','HUDL','WYSCOUT','VEO','OTHER_AUTHORIZED') NOT NULL,
  provider_account_ref VARCHAR(255) NULL COMMENT 'Licensed integration credential reference (secret manager key, never the secret)',
  resolved_host     VARCHAR(255) NULL,
  ssrf_check_passed BOOLEAN NOT NULL DEFAULT FALSE,
  terms_check_state ENUM('PENDING','ALLOWED','DENIED') NOT NULL DEFAULT 'PENDING',
  status            ENUM('QUEUED','FETCHING','COMPLETED','REJECTED','FAILED') NOT NULL DEFAULT 'QUEUED',
  failure_code      VARCHAR(64) CHARACTER SET ascii NULL,
  created_by        ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  KEY ix_url_imports_video (organization_id, video_id),
  CONSTRAINT fk_url_video FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id),
  CONSTRAINT fk_url_user  FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_url_fetch_gate CHECK (status NOT IN ('FETCHING','COMPLETED') OR (ssrf_check_passed AND terms_check_state = 'ALLOWED'))
) TBL;

CREATE TABLE video_classifications (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  video_id          ID36 NOT NULL,
  content_class     ENUM('MATCH','TRAINING','HIGHLIGHTS','INTERVIEW','OTHER') NOT NULL COMMENT '"Detected Content"',
  confidence        DECIMAL(5,4) NULL,
  confidence_band   ENUM('HIGH','MEDIUM','LOW') NULL COMMENT '"(High Confidence)"',
  evidence_state    EVSTATE NOT NULL DEFAULT 'INFERRED',
  model_version_id  ID36 NULL,
  confirmed_by      ID36 NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  KEY ix_vc_video (organization_id, video_id, created_at),
  CONSTRAINT fk_vc_video FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_vc_user  FOREIGN KEY (confirmed_by) REFERENCES users(id),
  CONSTRAINT ck_vc_conf  CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  CONSTRAINT ck_vc_confirmed CHECK (evidence_state <> 'CONFIRMED' OR confirmed_by IS NOT NULL)
) TBL;

-- "Teams (Detected)" on 02 Selected Item Preview: model proposals that must be confirmed against the match.
CREATE TABLE video_detected_teams (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  video_id          ID36 NOT NULL,
  side              ENUM('HOME','AWAY','UNKNOWN') NOT NULL,
  cluster_label     VARCHAR(20) NOT NULL COMMENT 'Team cluster from kit segmentation, e.g. A / B',
  kit_color_hex     CHAR(7) CHARACTER SET ascii NULL,
  kit_color_name    VARCHAR(30) NULL,
  proposed_club_id  ID36 NULL,
  confidence        DECIMAL(5,4) NULL,
  evidence_state    EVSTATE NOT NULL DEFAULT 'INFERRED',
  confirmed_club_id ID36 NULL,
  confirmed_by      ID36 NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vdt (video_id, cluster_label),
  CONSTRAINT fk_vdt_video FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_vdt_prop  FOREIGN KEY (proposed_club_id) REFERENCES clubs(id),
  CONSTRAINT fk_vdt_conf  FOREIGN KEY (confirmed_club_id) REFERENCES clubs(id),
  CONSTRAINT fk_vdt_user  FOREIGN KEY (confirmed_by) REFERENCES users(id),
  CONSTRAINT ck_vdt_confirm CHECK (evidence_state <> 'CONFIRMED' OR (confirmed_club_id IS NOT NULL AND confirmed_by IS NOT NULL))
) TBL;

CREATE TABLE rights_grants (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  video_id          ID36 NULL,
  asset_id          ID36 NULL,
  rights_state      ENUM('UNKNOWN','ANALYSIS_ONLY','INTERNAL','EXPORT_ALLOWED','PUBLIC','EXPIRED','REVOKED') NOT NULL DEFAULT 'UNKNOWN',
  allowed_uses      JSON NOT NULL DEFAULT (JSON_ARRAY()) COMMENT '["ANALYZE","PRODUCE","EXPORT","SHARE","DELIVER","PUBLIC_POST"]',
  territory_codes   JSON NOT NULL DEFAULT (JSON_ARRAY()),
  licensor          VARCHAR(200) NULL,
  valid_from        TS6 NULL,
  valid_until       TS6 NULL,
  guardian_consent_state ENUM('NOT_APPLICABLE','PENDING','VERIFIED','REVOKED') NOT NULL DEFAULT 'NOT_APPLICABLE',
  evidence_asset_id ID36 NULL,
  recorded_by       ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  KEY ix_rights_video (organization_id, video_id, rights_state),
  KEY ix_rights_asset (organization_id, asset_id, rights_state),
  CONSTRAINT fk_rights_video FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id),
  CONSTRAINT fk_rights_asset FOREIGN KEY (organization_id, asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_rights_evid  FOREIGN KEY (organization_id, evidence_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_rights_user  FOREIGN KEY (recorded_by) REFERENCES users(id),
  CONSTRAINT ck_rights_target CHECK (video_id IS NOT NULL OR asset_id IS NOT NULL),
  CONSTRAINT ck_rights_range  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from),
  CONSTRAINT ck_rights_uses   CHECK (JSON_TYPE(allowed_uses) = 'ARRAY')
) TBL;

CREATE TABLE video_shots (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  video_id          ID36 NOT NULL,
  start_pts_us      BIGINT UNSIGNED NOT NULL,
  end_pts_us        BIGINT UNSIGNED NOT NULL,
  camera_class      ENUM('WIDE_TACTICAL','BROADCAST_MAIN','CLOSE_UP','REPLAY','CROWD','GRAPHIC','OTHER') NULL,
  confidence        DECIMAL(5,4) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shots_start (video_id, start_pts_us),
  CONSTRAINT fk_shots_video FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ck_shots_range CHECK (end_pts_us > start_pts_us)
) TBL;

CREATE TABLE video_frame_index (
  video_id          ID36 NOT NULL,
  frame_index       INT UNSIGNED NOT NULL,
  pts_us            BIGINT UNSIGNED NOT NULL,
  shot_id           ID36 NULL,
  is_keyframe       BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (video_id, frame_index),
  UNIQUE KEY uq_frame_pts (video_id, pts_us)
) TBL COMMENT='High volume (~170k rows per 95-min match at 30fps). Written in bulk by the worker; FKs omitted by design, integrity checked by orphan job.';
