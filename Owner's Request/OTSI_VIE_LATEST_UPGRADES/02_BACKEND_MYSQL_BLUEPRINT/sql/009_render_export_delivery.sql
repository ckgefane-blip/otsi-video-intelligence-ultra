-- Migration 009 — Export & Delivery (10): presets, render jobs + stages, report bundles, share links, deliveries, notifications
USE `otsi_owner_vie`;

CREATE TABLE export_presets (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_organization_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  name              VARCHAR(80) NOT NULL COMMENT 'Output Preset select e.g. "Highlights Reel"',
  is_recommended    BOOLEAN NOT NULL DEFAULT FALSE COMMENT '"(Recommended)" suffix',
  helper_text       VARCHAR(200) NULL COMMENT '"Optimized for professional analysis and client sharing."',
  resolution        ENUM('720p','1080p','1440p','4K') NOT NULL,
  frame_rate        DECIMAL(6,3) NOT NULL,
  aspect_ratio      ENUM('16:9','9:16','1:1','4:5') NOT NULL,
  container         ENUM('MP4','MOV','WEBM') NOT NULL DEFAULT 'MP4',
  video_codec       ENUM('H264','H265','PRORES','VP9','AV1') NOT NULL DEFAULT 'H264',
  quality           ENUM('LOW','MEDIUM','HIGH','MAX') NOT NULL DEFAULT 'HIGH',
  owner_key         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin AS (COALESCE(owner_organization_id, 'GLOBAL')) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_export_presets (owner_key, name),
  CONSTRAINT fk_xp_owner FOREIGN KEY (owner_organization_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE render_jobs (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reel_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reel_revision_id  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Exact saved timeline being rendered',
  job_kind          ENUM('FINAL','PREVIEW') NOT NULL DEFAULT 'FINAL' COMMENT 'Preview Render vs Generate/Export',
  preset_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  resolution        ENUM('720p','1080p','1440p','4K') NOT NULL COMMENT 'Queue spec line "MP4 • 4K • 16:9 • 02:17"',
  width_px          SMALLINT UNSIGNED NOT NULL,
  height_px         SMALLINT UNSIGNED NOT NULL,
  frame_rate        DECIMAL(6,3) NOT NULL,
  aspect_ratio      ENUM('16:9','9:16','1:1','4:5') NOT NULL,
  container         ENUM('MP4','MOV','WEBM') NOT NULL,
  video_codec       ENUM('H264','H265','PRORES','VP9','AV1') NOT NULL,
  quality           ENUM('LOW','MEDIUM','HIGH','MAX') NOT NULL,
  include_branding  BOOLEAN NOT NULL DEFAULT TRUE,
  brand_kit_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  overlay_logo      BOOLEAN NOT NULL DEFAULT TRUE,
  overlay_player_name_stats BOOLEAN NOT NULL DEFAULT TRUE,
  overlay_match_info_banner BOOLEAN NOT NULL DEFAULT TRUE,
  custom_intro_outro BOOLEAN NOT NULL DEFAULT TRUE,
  expected_duration_us BIGINT UNSIGNED NOT NULL,
  state             ENUM('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') NOT NULL DEFAULT 'QUEUED',
  queue_position    INT UNSIGNED NULL,
  progress_pct      DECIMAL(5,2) NOT NULL DEFAULT 0,
  eta_seconds       INT UNSIGNED NULL COMMENT '"12 min remaining"',
  is_paused         BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Pause button',
  manifest_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  output_asset_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  idempotency_key   VARCHAR(128) CHARACTER SET ascii NOT NULL,
  attempt_count     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  failure_code      VARCHAR(64) CHARACTER SET ascii NULL,
  requested_by      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  started_at        DATETIME(6) NULL,
  completed_at      DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rj_org_id (organization_id, id),
  UNIQUE KEY uq_rj_idem (organization_id, idempotency_key),
  KEY ix_rj_queue (organization_id, state, queue_position, created_at),
  KEY ix_rj_reel (organization_id, reel_id, created_at),
  CONSTRAINT fk_rj_reel   FOREIGN KEY (organization_id, reel_id) REFERENCES reel_projects(organization_id, id),
  CONSTRAINT fk_rj_rev    FOREIGN KEY (organization_id, reel_revision_id) REFERENCES reel_revisions(organization_id, id),
  CONSTRAINT fk_rj_preset FOREIGN KEY (preset_id) REFERENCES export_presets(id),
  CONSTRAINT fk_rj_brand  FOREIGN KEY (organization_id, brand_kit_id) REFERENCES brand_kits(organization_id, id),
  CONSTRAINT fk_rj_man    FOREIGN KEY (organization_id, manifest_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_rj_out    FOREIGN KEY (organization_id, output_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_rj_user   FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT ck_rj_progress CHECK (progress_pct BETWEEN 0 AND 100),
  CONSTRAINT ck_rj_done   CHECK (state <> 'SUCCEEDED' OR (output_asset_id IS NOT NULL AND manifest_asset_id IS NOT NULL AND progress_pct = 100)),
  CONSTRAINT ck_rj_fps    CHECK (frame_rate > 0 AND frame_rate <= 120)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

-- 10 Render Progress strip: Preparing Files -> Rendering Video -> Processing Reports -> Finalizing.
CREATE TABLE render_job_stages (
  render_job_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  stage             ENUM('PREPARING_FILES','RENDERING_VIDEO','PROCESSING_REPORTS','FINALIZING','QC') NOT NULL,
  ui_order          TINYINT UNSIGNED NOT NULL,
  status            ENUM('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') NOT NULL DEFAULT 'QUEUED',
  progress_pct      DECIMAL(5,2) NOT NULL DEFAULT 0,
  started_at        DATETIME(6) NULL,
  completed_at      DATETIME(6) NULL,
  PRIMARY KEY (render_job_id, stage),
  CONSTRAINT fk_rjs_job FOREIGN KEY (organization_id, render_job_id) REFERENCES render_jobs(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT ck_rjs_progress CHECK (progress_pct BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE render_qc_checks (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  render_job_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  check_kind        ENUM('FFPROBE_STREAMS','DURATION_MATCH','AV_SYNC','LOUDNESS','SPOTLIGHT_TARGET_ALIGNMENT','RIGHTS_DEPENDENCIES','BLACK_FRAMES') NOT NULL,
  passed            BOOLEAN NOT NULL,
  measurements      JSON NOT NULL DEFAULT (JSON_OBJECT()),
  checked_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_rqc (render_job_id, check_kind),
  CONSTRAINT fk_rqc_job FOREIGN KEY (organization_id, render_job_id) REFERENCES render_jobs(organization_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

-- 10 Output & Reports: per export, which deliverables to bundle.
CREATE TABLE export_bundles (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  render_job_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  include_performance_report_pdf BOOLEAN NOT NULL DEFAULT TRUE,
  include_player_analysis_pdf BOOLEAN NOT NULL DEFAULT TRUE,
  include_event_list_csv BOOLEAN NOT NULL DEFAULT FALSE,
  include_heatmaps_png BOOLEAN NOT NULL DEFAULT FALSE,
  report_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status            ENUM('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') NOT NULL DEFAULT 'QUEUED',
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_eb_org_id (organization_id, id),
  UNIQUE KEY uq_eb_job (render_job_id),
  CONSTRAINT fk_eb_job    FOREIGN KEY (organization_id, render_job_id) REFERENCES render_jobs(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_eb_report FOREIGN KEY (organization_id, report_id) REFERENCES reports(organization_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE report_exports (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  report_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  bundle_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  export_kind       ENUM('PERFORMANCE_PDF','PLAYER_ANALYSIS_PDF','EVENT_LIST_CSV','HEATMAPS_PNG_ZIP','PLAYER_REPORT_PDF') NOT NULL,
  state             ENUM('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') NOT NULL DEFAULT 'QUEUED',
  output_asset_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  idempotency_key   VARCHAR(128) CHARACTER SET ascii NOT NULL,
  requested_by      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at      DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_re_idem (organization_id, idempotency_key),
  KEY ix_re_report (organization_id, report_id, created_at),
  CONSTRAINT fk_re_report FOREIGN KEY (organization_id, report_id) REFERENCES reports(organization_id, id),
  CONSTRAINT fk_re_bundle FOREIGN KEY (organization_id, bundle_id) REFERENCES export_bundles(organization_id, id),
  CONSTRAINT fk_re_out    FOREIGN KEY (organization_id, output_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_re_user   FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT ck_re_src    CHECK (report_id IS NOT NULL OR bundle_id IS NOT NULL),
  CONSTRAINT ck_re_done   CHECK (state <> 'SUCCEEDED' OR output_asset_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC COMMENT='08 Export PDF, 10 bundle files, 09 report downloads';

CREATE TABLE share_links (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  library_item_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  asset_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'Pinned file (NULL => latest primary asset of the item)',
  token_hash        CHAR(64) CHARACTER SET ascii NOT NULL COMMENT 'SHA-256 of random token; token shown once',
  public_slug       VARCHAR(64) CHARACTER SET ascii NOT NULL COMMENT 'URL path segment (non-guessable)',
  password_hash     VARCHAR(255) NULL COMMENT 'argon2id; Password Protection toggle',
  expires_at        DATETIME(6) NULL COMMENT 'Set Expiry Date toggle',
  can_download      BOOLEAN NOT NULL DEFAULT TRUE,
  can_comment       BOOLEAN NOT NULL DEFAULT TRUE,
  status            ENUM('PENDING_EXPORT','ACTIVE','REVOKED','EXPIRED') NOT NULL DEFAULT 'PENDING_EXPORT' COMMENT 'Pill "Not ready" / "Ready"',
  created_by        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  revoked_at        DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sl_org_id (organization_id, id),
  UNIQUE KEY uq_sl_token (token_hash),
  UNIQUE KEY uq_sl_slug (public_slug),
  KEY ix_sl_item (organization_id, library_item_id, status),
  CONSTRAINT fk_sl_item  FOREIGN KEY (organization_id, library_item_id) REFERENCES library_items(organization_id, id),
  CONSTRAINT fk_sl_asset FOREIGN KEY (organization_id, asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_sl_user  FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_sl_revoked CHECK (status <> 'REVOKED' OR revoked_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

ALTER TABLE comments ADD CONSTRAINT fk_comments_share FOREIGN KEY (organization_id, author_share_link_id) REFERENCES share_links(organization_id, id);

CREATE TABLE share_link_access (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  share_link_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action            ENUM('OPEN','PLAY','DOWNLOAD','COMMENT','PASSWORD_FAIL') NOT NULL,
  decision          ENUM('ALLOW','DENY') NOT NULL,
  deny_reason       VARCHAR(64) CHARACTER SET ascii NULL,
  ip_hash           CHAR(64) CHARACTER SET ascii NULL,
  user_agent_hash   CHAR(64) CHARACTER SET ascii NULL,
  accessed_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_sla_link (share_link_id, accessed_at),
  CONSTRAINT fk_sla_link FOREIGN KEY (share_link_id) REFERENCES share_links(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE deliveries (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  library_item_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  render_job_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  share_link_id     CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  channel           ENUM('SIGNED_URL','EMAIL','INTERNAL','PORTAL') NOT NULL,
  message           VARCHAR(300) NULL COMMENT 'Team Collaboration textarea (counter "0/300")',
  notify_team_when_ready BOOLEAN NOT NULL DEFAULT TRUE,
  notify_client     BOOLEAN NOT NULL DEFAULT TRUE,
  state             ENUM('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') NOT NULL DEFAULT 'QUEUED' COMMENT 'Ready for Delivery / Delivery not ready',
  rights_checked_at DATETIME(6) NULL,
  rights_decision_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  requested_by      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scheduled_for     DATETIME(6) NULL,
  delivered_at      DATETIME(6) NULL,
  failure_code      VARCHAR(64) CHARACTER SET ascii NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_del_org_id (organization_id, id),
  KEY ix_del_item (organization_id, library_item_id, created_at),
  CONSTRAINT fk_del_item  FOREIGN KEY (organization_id, library_item_id) REFERENCES library_items(organization_id, id),
  CONSTRAINT fk_del_job   FOREIGN KEY (organization_id, render_job_id) REFERENCES render_jobs(organization_id, id),
  CONSTRAINT fk_del_link  FOREIGN KEY (organization_id, share_link_id) REFERENCES share_links(organization_id, id),
  CONSTRAINT fk_del_user  FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT ck_del_done  CHECK (state <> 'SUCCEEDED' OR (delivered_at IS NOT NULL AND rights_checked_at IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE delivery_recipients (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  delivery_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_kind    ENUM('TEAM_MEMBER','CLIENT') NOT NULL,
  user_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  client_contact_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status            ENUM('PENDING','SENT','OPENED','BOUNCED','FAILED') NOT NULL DEFAULT 'PENDING',
  sent_at           DATETIME(6) NULL,
  opened_at         DATETIME(6) NULL,
  PRIMARY KEY (id),
  KEY ix_dr_delivery (organization_id, delivery_id),
  CONSTRAINT fk_dr_delivery FOREIGN KEY (organization_id, delivery_id) REFERENCES deliveries(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_dr_user     FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id),
  CONSTRAINT ck_dr_target   CHECK ((recipient_kind = 'TEAM_MEMBER' AND user_id IS NOT NULL) OR (recipient_kind = 'CLIENT' AND client_contact_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE client_contacts (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name      VARCHAR(120) NOT NULL,
  email             VARCHAR(320) NOT NULL,
  company           VARCHAR(150) NULL,
  consent_state     ENUM('UNKNOWN','GRANTED','WITHDRAWN') NOT NULL DEFAULT 'UNKNOWN',
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_cc_org_id (organization_id, id),
  UNIQUE KEY uq_cc_email (organization_id, email),
  CONSTRAINT fk_cc_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC COMMENT='"Notify client" / "Deliver to Client" / "Send to Client" recipients';

ALTER TABLE delivery_recipients ADD CONSTRAINT fk_dr_client FOREIGN KEY (organization_id, client_contact_id) REFERENCES client_contacts(organization_id, id);
