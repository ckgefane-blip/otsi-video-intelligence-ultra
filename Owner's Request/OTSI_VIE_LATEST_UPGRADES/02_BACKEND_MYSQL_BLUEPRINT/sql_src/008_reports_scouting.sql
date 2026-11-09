-- Migration 008 — Player Report (08): reports, frozen KPI snapshots, role profile, AI insights, scouting, dossiers
USE `otsi_owner_vie`;

CREATE TABLE reports (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  project_id        ID36 NOT NULL,
  report_type       ENUM('PLAYER','MATCH','TEAM','SCOUTING_PACK') NOT NULL,
  player_id         ID36 NULL,
  match_id          ID36 NULL,
  video_id          ID36 NULL,
  title             VARCHAR(200) NOT NULL,
  scope_kind        ENUM('MATCH','SEASON','RANGE') NOT NULL DEFAULT 'MATCH',
  scope_from        DATE NULL,
  scope_to          DATE NULL,
  cohort_id         ID36 NULL COMMENT 'Comparison select',
  status            ENUM('DRAFT','GENERATED','REVIEW_REQUIRED','READY','PUBLISHED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  published_by      ID36 NULL,
  published_at      TS6 NULL,
  created_by        ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  updated_at        UPDTS,
  row_version       BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reports_org_id (organization_id, id),
  KEY ix_reports_player (organization_id, player_id, status, updated_at),
  CONSTRAINT fk_rep_project FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id),
  CONSTRAINT fk_rep_player  FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_rep_match   FOREIGN KEY (organization_id, match_id) REFERENCES matches(organization_id, id),
  CONSTRAINT fk_rep_video   FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id),
  CONSTRAINT fk_rep_cohort  FOREIGN KEY (cohort_id) REFERENCES metric_cohorts(id),
  CONSTRAINT fk_rep_pub     FOREIGN KEY (published_by) REFERENCES users(id),
  CONSTRAINT fk_rep_user    FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_rep_player  CHECK (report_type <> 'PLAYER' OR player_id IS NOT NULL),
  CONSTRAINT ck_rep_pub     CHECK (status <> 'PUBLISHED' OR (published_by IS NOT NULL AND published_at IS NOT NULL)),
  CONSTRAINT ck_rep_range   CHECK (scope_to IS NULL OR scope_from IS NULL OR scope_to >= scope_from)
) TBL;

-- Values shown in a report are FROZEN at generation so a published PDF never changes under the reader.
CREATE TABLE report_metric_snapshots (
  report_id         ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  block             ENUM('KPI_TILE','COMPARISON','BIO','CONFIDENCE','HEATMAP','ACTION_MAP','OTHER') NOT NULL,
  metric_key        VARCHAR(48) CHARACTER SET ascii NOT NULL,
  display_order     TINYINT UNSIGNED NOT NULL,
  source_metric_value_id ID36 NULL,
  value_numeric     DOUBLE NULL,
  value_per90       DOUBLE NULL,
  delta_pct         DOUBLE NULL COMMENT 'KPI "↑ +8%" (NULL => hidden)',
  delta_abs         DOUBLE NULL COMMENT 'xG/xA "↑ +0.18"',
  cohort_value      DOUBLE NULL COMMENT 'Comparison grey bar / right value',
  coverage_ratio    DECIMAL(5,4) NULL,
  evidence_state    EVSTATE NOT NULL,
  PRIMARY KEY (report_id, block, metric_key),
  CONSTRAINT fk_rms_report FOREIGN KEY (organization_id, report_id) REFERENCES reports(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_rms_def    FOREIGN KEY (metric_key) REFERENCES metric_definitions(metric_key),
  CONSTRAINT fk_rms_src    FOREIGN KEY (source_metric_value_id) REFERENCES metric_values(id),
  CONSTRAINT ck_rms_nm     CHECK (evidence_state <> 'NOT_MEASURED' OR value_numeric IS NULL)
) TBL;

CREATE TABLE report_identity_confidence (
  report_id         ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  tracking_coverage_ratio DECIMAL(5,4) NULL COMMENT 'Ring value (task: track coverage)',
  identity_state    ENUM('UNRESOLVED','CANDIDATE','CONFIRMED','REJECTED','CONFLICT') NOT NULL COMMENT 'Pill: Unverified / Verified',
  observed_minutes  DECIMAL(7,2) NULL COMMENT '"across N minutes"',
  quality_band      ENUM('EXCELLENT','GOOD','FAIR','POOR','NOT_MEASURED') NOT NULL DEFAULT 'NOT_MEASURED',
  computed_at       TS6 NOT NULL NOWTS,
  PRIMARY KEY (report_id),
  CONSTRAINT fk_ric_report FOREIGN KEY (organization_id, report_id) REFERENCES reports(organization_id, id) ON DELETE CASCADE
) TBL COMMENT='08 Tracking Confidence card — separate per task, never one blended %';

CREATE TABLE player_role_profiles (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  player_id         ID36 NOT NULL,
  report_id         ID36 NULL,
  role_title        VARCHAR(120) NOT NULL COMMENT '"Advanced Midfielder (Right Half-Space)"',
  summary           VARCHAR(1000) NOT NULL,
  author_kind       ENUM('ANALYST','AI_DRAFT') NOT NULL,
  approved_by       ID36 NULL,
  approved_at       TS6 NULL,
  created_by        ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_prp_org_id (organization_id, id),
  KEY ix_prp_player (organization_id, player_id, created_at),
  CONSTRAINT fk_prp_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_prp_report FOREIGN KEY (organization_id, report_id) REFERENCES reports(organization_id, id),
  CONSTRAINT fk_prp_appr   FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT fk_prp_user   FOREIGN KEY (created_by) REFERENCES users(id)
) TBL;

CREATE TABLE player_role_traits (
  profile_id        ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  trait_label       VARCHAR(40) NOT NULL COMMENT 'Chips: Playmaker, Chance Creator ...',
  display_order     TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (profile_id, trait_label),
  CONSTRAINT fk_prt_profile FOREIGN KEY (organization_id, profile_id) REFERENCES player_role_profiles(organization_id, id) ON DELETE CASCADE
) TBL;

-- 08 Generated Insights: AI text MUST cite the metric/event evidence it is based on.
CREATE TABLE report_insights (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  report_id         ID36 NOT NULL,
  display_order     TINYINT UNSIGNED NOT NULL,
  icon_key          VARCHAR(16) CHARACTER SET ascii NOT NULL COMMENT 'trend / pick / tgt / shld',
  accent_color_hex  CHAR(7) CHARACTER SET ascii NOT NULL,
  headline          VARCHAR(80) NOT NULL,
  body              VARCHAR(600) NOT NULL,
  model_version_id  ID36 NOT NULL,
  prompt_version    VARCHAR(20) NOT NULL,
  review_state      ENUM('AI_DRAFT','APPROVED','REJECTED') NOT NULL DEFAULT 'AI_DRAFT',
  reviewed_by       ID36 NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ri_org_id (organization_id, id),
  UNIQUE KEY uq_ri_order (report_id, display_order),
  CONSTRAINT fk_ri_report FOREIGN KEY (organization_id, report_id) REFERENCES reports(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_ri_model  FOREIGN KEY (model_version_id) REFERENCES model_versions(id),
  CONSTRAINT fk_ri_user   FOREIGN KEY (reviewed_by) REFERENCES users(id),
  CONSTRAINT ck_ri_review CHECK (review_state = 'AI_DRAFT' OR reviewed_by IS NOT NULL)
) TBL;

CREATE TABLE report_insight_citations (
  insight_id        ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  citation_no       TINYINT UNSIGNED NOT NULL,
  metric_value_id   ID36 NULL,
  event_id          ID36 NULL,
  cohort_id         ID36 NULL,
  PRIMARY KEY (insight_id, citation_no),
  CONSTRAINT fk_ric_insight FOREIGN KEY (organization_id, insight_id) REFERENCES report_insights(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_ric_metric  FOREIGN KEY (metric_value_id) REFERENCES metric_values(id),
  CONSTRAINT fk_ric_event   FOREIGN KEY (organization_id, event_id) REFERENCES event_candidates(organization_id, id),
  CONSTRAINT fk_ric_cohort  FOREIGN KEY (cohort_id) REFERENCES metric_cohorts(id),
  CONSTRAINT ck_ric_one     CHECK (metric_value_id IS NOT NULL OR event_id IS NOT NULL OR cohort_id IS NOT NULL)
) TBL;

CREATE TABLE scouting_assessments (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  player_id         ID36 NOT NULL,
  report_id         ID36 NULL,
  overall_rating    DECIMAL(3,1) NULL COMMENT 'Overall Rating ring "x / 10"',
  rating_scale_max  TINYINT UNSIGNED NOT NULL DEFAULT 10,
  summary_quote     VARCHAR(600) NULL,
  status            ENUM('DRAFT','SUBMITTED','VERIFIED','ARCHIVED') NOT NULL DEFAULT 'DRAFT' COMMENT 'Footer "Awaiting verified scouting data" until VERIFIED',
  scout_user_id     ID36 NOT NULL,
  verified_by       ID36 NULL,
  verified_at       TS6 NULL,
  created_at        TS6 NOT NULL NOWTS,
  updated_at        UPDTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sa_org_id (organization_id, id),
  KEY ix_sa_player (organization_id, player_id, status, created_at),
  CONSTRAINT fk_sa_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_sa_report FOREIGN KEY (organization_id, report_id) REFERENCES reports(organization_id, id),
  CONSTRAINT fk_sa_scout  FOREIGN KEY (organization_id, scout_user_id) REFERENCES memberships(organization_id, user_id),
  CONSTRAINT fk_sa_ver    FOREIGN KEY (verified_by) REFERENCES users(id),
  CONSTRAINT ck_sa_rating CHECK (overall_rating IS NULL OR overall_rating BETWEEN 0 AND rating_scale_max),
  CONSTRAINT ck_sa_verified CHECK (status <> 'VERIFIED' OR (verified_by IS NOT NULL AND verified_by <> scout_user_id))
) TBL;

CREATE TABLE scouting_strengths (
  assessment_id     ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  display_order     TINYINT UNSIGNED NOT NULL,
  kind              ENUM('STRENGTH','DEVELOPMENT_AREA','RISK') NOT NULL DEFAULT 'STRENGTH',
  text              VARCHAR(120) NOT NULL COMMENT 'Green-check bullet lines',
  PRIMARY KEY (assessment_id, display_order),
  CONSTRAINT fk_sst_assessment FOREIGN KEY (organization_id, assessment_id) REFERENCES scouting_assessments(organization_id, id) ON DELETE CASCADE
) TBL;

CREATE TABLE scouting_dossiers (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  folder_id         ID36 NULL,
  name              VARCHAR(150) NOT NULL,
  created_by        ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sd_org_id (organization_id, id),
  CONSTRAINT fk_sd_folder FOREIGN KEY (organization_id, folder_id) REFERENCES folders(organization_id, id),
  CONSTRAINT fk_sd_user   FOREIGN KEY (created_by) REFERENCES users(id)
) TBL;

CREATE TABLE scouting_dossier_items (
  dossier_id        ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  player_id         ID36 NOT NULL,
  report_id         ID36 NULL,
  added_by          ID36 NOT NULL,
  added_at          TS6 NOT NULL NOWTS,
  PRIMARY KEY (dossier_id, player_id),
  CONSTRAINT fk_sdi_dossier FOREIGN KEY (organization_id, dossier_id) REFERENCES scouting_dossiers(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_sdi_player  FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_sdi_report  FOREIGN KEY (organization_id, report_id) REFERENCES reports(organization_id, id),
  CONSTRAINT fk_sdi_user    FOREIGN KEY (added_by) REFERENCES users(id)
) TBL COMMENT='08 "Add to Scouting Dossier"';

CREATE TABLE player_notes (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  player_id         ID36 NOT NULL,
  body              VARCHAR(4000) NOT NULL,
  visibility        ENUM('PRIVATE','ORGANIZATION') NOT NULL DEFAULT 'ORGANIZATION',
  author_id         ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  KEY ix_pn_player (organization_id, player_id, created_at),
  CONSTRAINT fk_pnote_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_pnote_author FOREIGN KEY (organization_id, author_id) REFERENCES memberships(organization_id, user_id)
) TBL COMMENT='08 sidebar "Notes & Tags"';
