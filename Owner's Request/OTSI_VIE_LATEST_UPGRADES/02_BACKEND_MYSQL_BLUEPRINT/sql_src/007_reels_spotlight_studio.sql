-- Migration 007 — Reel Builder (06), Clip Studio (07), media bin clips, timeline, captions, chapters, revisions
USE `otsi_owner_vie`;

CREATE TABLE music_tracks (
  id                ID36 NOT NULL,
  owner_organization_id ID36 NULL COMMENT 'NULL = platform-licensed library',
  title             VARCHAR(150) NOT NULL COMMENT 'Music select "Epic Cinematic"',
  mood              VARCHAR(40) NULL,
  bpm               SMALLINT UNSIGNED NULL,
  duration_us       BIGINT UNSIGNED NOT NULL,
  audio_asset_id    ID36 NOT NULL,
  waveform_asset_id ID36 NULL,
  license_ref       VARCHAR(255) NOT NULL,
  allowed_uses      JSON NOT NULL DEFAULT (JSON_ARRAY('INTERNAL','EXPORT')),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  CONSTRAINT fk_music_owner FOREIGN KEY (owner_organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_music_audio FOREIGN KEY (audio_asset_id) REFERENCES assets(id),
  CONSTRAINT fk_music_wave  FOREIGN KEY (waveform_asset_id) REFERENCES assets(id)
) TBL;

CREATE TABLE brand_kits (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  name              VARCHAR(100) NOT NULL COMMENT '10 Branded Overlays logo select ("OTSI VIE")',
  logo_asset_id     ID36 NULL,
  watermark_asset_id ID36 NULL,
  intro_asset_id    ID36 NULL,
  outro_asset_id    ID36 NULL COMMENT '"End Screen" / Custom Intro/Outro',
  primary_color_hex CHAR(7) CHARACTER SET ascii NULL,
  font_asset_id     ID36 NULL,
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_brand_kits_org_id (organization_id, id),
  UNIQUE KEY uq_brand_kits_name (organization_id, name),
  CONSTRAINT fk_bk_org   FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_bk_logo  FOREIGN KEY (organization_id, logo_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_bk_wm    FOREIGN KEY (organization_id, watermark_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_bk_intro FOREIGN KEY (organization_id, intro_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_bk_outro FOREIGN KEY (organization_id, outro_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_bk_font  FOREIGN KEY (organization_id, font_asset_id) REFERENCES assets(organization_id, id)
) TBL;

CREATE TABLE effect_presets (
  id                ID36 NOT NULL,
  owner_organization_id ID36 NULL,
  name              VARCHAR(100) NOT NULL,
  effect_family     ENUM('SPOTLIGHT','TRANSITION','GRAPHIC','LOWER_THIRD','STAT_CARD','CAPTION_STYLE','COLOR','SPEED','TRANSFORM') NOT NULL,
  version           VARCHAR(20) NOT NULL,
  schema_version    VARCHAR(20) NOT NULL,
  config            JSON NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  owner_key         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin AS (COALESCE(owner_organization_id, 'GLOBAL')) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_effect_presets (owner_key, name, version),
  CONSTRAINT fk_ep_owner FOREIGN KEY (owner_organization_id) REFERENCES organizations(id)
) TBL COMMENT='Transitions Fade/Zoom/Spin/Dissolve; graphics Spotlight Circle/Pass Trajectory/Player Highlight/Team Logo ...';

CREATE TABLE reel_projects (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  project_id        ID36 NOT NULL,
  video_id          ID36 NULL COMMENT 'Primary source; clips may come from several videos',
  match_id          ID36 NULL,
  reel_kind         ENUM('SPOTLIGHT','HIGHLIGHTS','TACTICAL','CUSTOM') NOT NULL DEFAULT 'SPOTLIGHT',
  title             VARCHAR(200) NOT NULL COMMENT 'Reel Info Title',
  description       VARCHAR(2000) NULL COMMENT 'Reel Info Description (optional)',
  reel_type_label   VARCHAR(80) NULL COMMENT 'e.g. "Progressive Passes" subtitle on cards/summary',
  wizard_step       ENUM('SELECT_PLAYER','CHOOSE_MOMENTS','EDIT_STYLE','EXPORT') NOT NULL DEFAULT 'SELECT_PLAYER',
  aspect_ratio      ENUM('16:9','9:16','1:1','4:5') NOT NULL DEFAULT '16:9',
  duration_mode     ENUM('AUTO_BEST','FIXED_30S','FIXED_60S','FIXED_90S','FIXED_120S','CUSTOM') NOT NULL DEFAULT 'AUTO_BEST',
  target_duration_us BIGINT UNSIGNED NULL,
  music_track_id    ID36 NULL,
  brand_kit_id      ID36 NULL,
  status            ENUM('DRAFT','REVIEW_REQUIRED','READY_TO_RENDER','RENDERING','QC','READY','PUBLISHED','BLOCKED','FAILED','ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  blocked_reason    VARCHAR(64) CHARACTER SET ascii NULL COMMENT 'IDENTITY_UNRESOLVED, RIGHTS_BLOCKED ...',
  current_revision  INT UNSIGNED NOT NULL DEFAULT 0,
  sequence_duration_us BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total timeline length "01:28.00"',
  created_by        ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  updated_at        UPDTS,
  row_version       BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reels_org_id (organization_id, id),
  KEY ix_reels_org_status (organization_id, status, updated_at),
  KEY ix_reels_project (organization_id, project_id),
  CONSTRAINT fk_reels_project FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id),
  CONSTRAINT fk_reels_video   FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id),
  CONSTRAINT fk_reels_match   FOREIGN KEY (organization_id, match_id) REFERENCES matches(organization_id, id),
  CONSTRAINT fk_reels_music   FOREIGN KEY (music_track_id) REFERENCES music_tracks(id),
  CONSTRAINT fk_reels_brand   FOREIGN KEY (organization_id, brand_kit_id) REFERENCES brand_kits(organization_id, id),
  CONSTRAINT fk_reels_user    FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_reels_blocked CHECK (status <> 'BLOCKED' OR blocked_reason IS NOT NULL)
) TBL;

-- 06 right panel: Spotlight Controls, Player Targeting, Overlays, Branding. One row per reel; validated ranges.
CREATE TABLE reel_style_settings (
  reel_id           ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  spotlight_intensity_pct TINYINT UNSIGNED NOT NULL DEFAULT 85,
  ray_width_pct     TINYINT UNSIGNED NOT NULL DEFAULT 60,
  vignette_strength_pct TINYINT UNSIGNED NOT NULL DEFAULT 45,
  glow_amount_pct   TINYINT UNSIGNED NOT NULL DEFAULT 55,
  target_lock_sensitivity_pct TINYINT UNSIGNED NOT NULL DEFAULT 72,
  auto_track_player BOOLEAN NOT NULL DEFAULT TRUE,
  overlay_player_info_card BOOLEAN NOT NULL DEFAULT TRUE,
  overlay_match_score_time BOOLEAN NOT NULL DEFAULT TRUE,
  overlay_competition_logo BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Requires competitions.logo_license_ref at render',
  overlay_lower_third BOOLEAN NOT NULL DEFAULT TRUE,
  use_watermark     BOOLEAN NOT NULL DEFAULT TRUE,
  custom_logo       BOOLEAN NOT NULL DEFAULT FALSE,
  end_screen        BOOLEAN NOT NULL DEFAULT TRUE,
  spotlight_preset_id ID36 NULL,
  updated_at        UPDTS,
  PRIMARY KEY (reel_id),
  CONSTRAINT fk_rss_reel   FOREIGN KEY (organization_id, reel_id) REFERENCES reel_projects(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_rss_preset FOREIGN KEY (spotlight_preset_id) REFERENCES effect_presets(id),
  CONSTRAINT ck_rss_ranges CHECK (spotlight_intensity_pct <= 100 AND ray_width_pct <= 100 AND vignette_strength_pct <= 100
                                  AND glow_amount_pct <= 100 AND target_lock_sensitivity_pct <= 100)
) TBL;

CREATE TABLE reel_targets (
  reel_id           ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  player_id         ID36 NOT NULL COMMENT '"Lock on confirmed player" — must be a canonical player',
  primary_track_id  ID36 NULL,
  identity_decision_id ID36 NULL COMMENT 'CONFIRMED decision that authorises the lock',
  is_primary        BOOLEAN NOT NULL DEFAULT TRUE,
  added_at          TS6 NOT NULL NOWTS,
  PRIMARY KEY (reel_id, player_id),
  CONSTRAINT fk_rt_reel   FOREIGN KEY (organization_id, reel_id) REFERENCES reel_projects(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_rt_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_rt_track  FOREIGN KEY (organization_id, primary_track_id) REFERENCES tracks(organization_id, id),
  CONSTRAINT fk_rt_dec    FOREIGN KEY (organization_id, identity_decision_id) REFERENCES track_identity_decisions(organization_id, id)
) TBL;

-- 06 Suggested Key Moments (ranked; header count = COUNT where status<>'DISMISSED').
CREATE TABLE moment_suggestions (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  reel_id           ID36 NOT NULL,
  event_id          ID36 NULL,
  video_id          ID36 NOT NULL,
  in_pts_us         BIGINT UNSIGNED NOT NULL,
  out_pts_us        BIGINT UNSIGNED NOT NULL,
  title             VARCHAR(80) NOT NULL COMMENT 'Card title e.g. "Progressive Pass"',
  rank_no           SMALLINT UNSIGNED NOT NULL COMMENT 'Card number badge',
  score             DECIMAL(5,4) NOT NULL,
  thumbnail_asset_id ID36 NULL,
  status            ENUM('SUGGESTED','SELECTED','DISMISSED') NOT NULL DEFAULT 'SUGGESTED' COMMENT 'Checkbox badge',
  model_version_id  ID36 NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ms_rank (reel_id, rank_no),
  KEY ix_ms_reel (organization_id, reel_id, status, rank_no),
  CONSTRAINT fk_mom_reel  FOREIGN KEY (organization_id, reel_id) REFERENCES reel_projects(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_mom_event FOREIGN KEY (organization_id, event_id) REFERENCES event_candidates(organization_id, id),
  CONSTRAINT fk_mom_video FOREIGN KEY (organization_id, video_id) REFERENCES video_sources(organization_id, id),
  CONSTRAINT fk_mom_thumb FOREIGN KEY (organization_id, thumbnail_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_mom_model FOREIGN KEY (model_version_id) REFERENCES model_versions(id),
  CONSTRAINT ck_mom_range CHECK (out_pts_us > in_pts_us AND score BETWEEN 0 AND 1)
) TBL;

-- 07 Media Bin clips (sub-clips of a source video) and the Clip Inspector metadata.
CREATE TABLE media_clips (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  folder_id         ID36 NULL COMMENT 'Media Bin breadcrumb location',
  source_video_id   ID36 NOT NULL,
  in_pts_us         BIGINT UNSIGNED NOT NULL,
  out_pts_us        BIGINT UNSIGNED NOT NULL,
  duration_us       BIGINT UNSIGNED AS (out_pts_us - in_pts_us) STORED COMMENT 'Clip duration chip',
  clip_asset_id     ID36 NULL COMMENT 'Optional pre-cut file (name shown, e.g. *.mp4)',
  thumbnail_asset_id ID36 NULL,
  display_name      VARCHAR(255) NOT NULL COMMENT 'Inspector title / timeline label',
  player_id         ID36 NULL COMMENT 'Inspector Player (confirmed only)',
  match_id          ID36 NULL COMMENT 'Inspector Match',
  event_id          ID36 NULL,
  event_type        VARCHAR(32) CHARACTER SET ascii NULL COMMENT 'Inspector Event Type',
  match_clock_ms    INT UNSIGNED NULL COMMENT 'Inspector Timestamp',
  period            ENUM('FIRST_HALF','SECOND_HALF','ET_FIRST','ET_SECOND') NULL COMMENT '"(2nd Half)"',
  notes             VARCHAR(2000) NULL COMMENT 'Inspector Notes',
  created_by        ID36 NOT NULL,
  created_at        TS6 NOT NULL NOWTS COMMENT '"Added 16 Apr 2024, 14:32"',
  updated_at        UPDTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_media_clips_org_id (organization_id, id),
  KEY ix_mc_folder (organization_id, folder_id, created_at),
  KEY ix_mc_player (organization_id, player_id),
  FULLTEXT KEY ft_mc_search (display_name, notes),
  CONSTRAINT fk_mc_folder FOREIGN KEY (organization_id, folder_id) REFERENCES folders(organization_id, id),
  CONSTRAINT fk_mc_video  FOREIGN KEY (organization_id, source_video_id) REFERENCES video_sources(organization_id, id),
  CONSTRAINT fk_mc_asset  FOREIGN KEY (organization_id, clip_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_mc_thumb  FOREIGN KEY (organization_id, thumbnail_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT fk_mc_player FOREIGN KEY (player_id) REFERENCES players(id),
  CONSTRAINT fk_mc_match  FOREIGN KEY (organization_id, match_id) REFERENCES matches(organization_id, id),
  CONSTRAINT fk_mc_event  FOREIGN KEY (organization_id, event_id) REFERENCES event_candidates(organization_id, id),
  CONSTRAINT fk_mc_etype  FOREIGN KEY (event_type) REFERENCES event_types(code),
  CONSTRAINT fk_mc_user   FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT ck_mc_range  CHECK (out_pts_us > in_pts_us)
) TBL;

CREATE TABLE media_clip_tags (
  clip_id           ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  tag_id            ID36 NOT NULL,
  PRIMARY KEY (clip_id, tag_id),
  CONSTRAINT fk_mct_clip FOREIGN KEY (organization_id, clip_id) REFERENCES media_clips(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_mct_tag  FOREIGN KEY (organization_id, tag_id) REFERENCES tags(organization_id, id) ON DELETE CASCADE
) TBL COMMENT='Inspector Tags chips (Pass / Progressive / Build-up) + "+" add';

CREATE TABLE reel_clips (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  reel_id           ID36 NOT NULL,
  media_clip_id     ID36 NULL,
  moment_suggestion_id ID36 NULL,
  source_video_id   ID36 NOT NULL,
  in_pts_us         BIGINT UNSIGNED NOT NULL,
  out_pts_us        BIGINT UNSIGNED NOT NULL,
  sequence_index    SMALLINT UNSIGNED NOT NULL,
  playback_speed    DECIMAL(6,3) NOT NULL DEFAULT 1.000,
  output_duration_us BIGINT UNSIGNED AS (CAST((out_pts_us - in_pts_us) / playback_speed AS UNSIGNED)) STORED,
  source_event_id   ID36 NULL,
  review_state      ENUM('PENDING','APPROVED','REJECTED','RED') NOT NULL DEFAULT 'PENDING',
  target_identity_verified BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Target CONFIRMED across [in,out]; render blocks otherwise',
  PRIMARY KEY (id),
  UNIQUE KEY uq_reel_clips_org_id (organization_id, id),
  UNIQUE KEY uq_reel_clips_seq (reel_id, sequence_index),
  CONSTRAINT fk_rc_reel   FOREIGN KEY (organization_id, reel_id) REFERENCES reel_projects(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_rc_mclip  FOREIGN KEY (organization_id, media_clip_id) REFERENCES media_clips(organization_id, id),
  CONSTRAINT fk_rc_moment FOREIGN KEY (moment_suggestion_id) REFERENCES moment_suggestions(id),
  CONSTRAINT fk_rc_video  FOREIGN KEY (organization_id, source_video_id) REFERENCES video_sources(organization_id, id),
  CONSTRAINT fk_rc_event  FOREIGN KEY (organization_id, source_event_id) REFERENCES event_candidates(organization_id, id),
  CONSTRAINT ck_rc_range  CHECK (out_pts_us > in_pts_us),
  CONSTRAINT ck_rc_speed  CHECK (playback_speed BETWEEN 0.1 AND 8)
) TBL;

CREATE TABLE timeline_tracks (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  reel_id           ID36 NOT NULL,
  track_type        ENUM('VIDEO','SPOTLIGHT','TRANSITION','GRAPHICS','TEXT_OVERLAY','LOWER_THIRD','CAPTIONS','STATISTICS','SOUNDTRACK','AUDIO_FX','VOICEOVER') NOT NULL,
  label             VARCHAR(40) NOT NULL COMMENT '07 track header labels; 06 "Video Clips / Spotlight Effects / Text & Overlays / Audio"',
  layer             TINYINT UNSIGNED NOT NULL,
  is_visible        BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Eye icon',
  is_locked         BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Lock icon',
  is_muted          BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'Mute icon (audio tracks)',
  PRIMARY KEY (id),
  UNIQUE KEY uq_tt_org_id (organization_id, id),
  UNIQUE KEY uq_tt_layer (reel_id, layer),
  CONSTRAINT fk_tt_reel FOREIGN KEY (organization_id, reel_id) REFERENCES reel_projects(organization_id, id) ON DELETE CASCADE
) TBL;

CREATE TABLE timeline_items (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  timeline_track_id ID36 NOT NULL,
  reel_clip_id      ID36 NULL,
  item_kind         ENUM('CLIP','TRANSITION','GRAPHIC','TEXT','LOWER_THIRD','CAPTION','STAT','AUDIO','SPOTLIGHT') NOT NULL,
  label             VARCHAR(200) NULL COMMENT 'Bar label e.g. "Fade", "Stat Card", "Pass Distance (7.4 km)"',
  start_us          BIGINT UNSIGNED NOT NULL,
  duration_us       BIGINT UNSIGNED NOT NULL,
  end_us            BIGINT UNSIGNED AS (start_us + duration_us) STORED,
  effect_preset_id  ID36 NULL,
  asset_id          ID36 NULL,
  metric_value_id   ID36 NULL COMMENT 'STAT items must bind to a real metric (never typed numbers)',
  parameters        JSON NOT NULL DEFAULT (JSON_OBJECT()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ti_org_id (organization_id, id),
  KEY ix_ti_track_time (timeline_track_id, start_us),
  CONSTRAINT fk_ti_track  FOREIGN KEY (organization_id, timeline_track_id) REFERENCES timeline_tracks(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_ti_clip   FOREIGN KEY (organization_id, reel_clip_id) REFERENCES reel_clips(organization_id, id),
  CONSTRAINT fk_ti_preset FOREIGN KEY (effect_preset_id) REFERENCES effect_presets(id),
  CONSTRAINT fk_ti_asset  FOREIGN KEY (asset_id) REFERENCES assets(id),
  CONSTRAINT fk_ti_metric FOREIGN KEY (metric_value_id) REFERENCES metric_values(id),
  CONSTRAINT ck_ti_dur    CHECK (duration_us > 0),
  CONSTRAINT ck_ti_clip   CHECK (item_kind <> 'CLIP' OR reel_clip_id IS NOT NULL),
  CONSTRAINT ck_ti_stat   CHECK (item_kind <> 'STAT' OR metric_value_id IS NOT NULL)
) TBL;

CREATE TABLE effect_keyframes (
  id                ID36 NOT NULL,
  timeline_item_id  ID36 NOT NULL,
  time_offset_us    BIGINT UNSIGNED NOT NULL,
  property_name     VARCHAR(48) CHARACTER SET ascii NOT NULL,
  value             JSON NOT NULL,
  interpolation     ENUM('HOLD','LINEAR','EASE_IN_OUT') NOT NULL DEFAULT 'LINEAR',
  PRIMARY KEY (id),
  UNIQUE KEY uq_ek (timeline_item_id, time_offset_us, property_name),
  CONSTRAINT fk_ek_item FOREIGN KEY (timeline_item_id) REFERENCES timeline_items(id) ON DELETE CASCADE
) TBL;

CREATE TABLE caption_cues (
  id                ID36 NOT NULL,
  timeline_item_id  ID36 NOT NULL,
  start_us          BIGINT UNSIGNED NOT NULL,
  end_us            BIGINT UNSIGNED NOT NULL,
  text              VARCHAR(500) NOT NULL,
  language          VARCHAR(16) NOT NULL DEFAULT 'en',
  source            ENUM('MANUAL','AUTO_ASR','AUTO_TEMPLATE') NOT NULL,
  PRIMARY KEY (id),
  KEY ix_cc_item (timeline_item_id, start_us),
  CONSTRAINT fk_cc_item FOREIGN KEY (timeline_item_id) REFERENCES timeline_items(id) ON DELETE CASCADE,
  CONSTRAINT ck_cc_range CHECK (end_us > start_us)
) TBL;

-- Saved revisions (Save Project). Undo/Redo is client-side within a session; server keeps immutable snapshots.
CREATE TABLE reel_revisions (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  reel_id           ID36 NOT NULL,
  revision_no       INT UNSIGNED NOT NULL,
  timeline_snapshot JSON NOT NULL,
  snapshot_sha256   CHAR(64) CHARACTER SET ascii NOT NULL,
  saved_by          ID36 NOT NULL,
  saved_at          TS6 NOT NULL NOWTS,
  note              VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rr_org_id (organization_id, id),
  UNIQUE KEY uq_rr_no (reel_id, revision_no),
  CONSTRAINT fk_rr_reel FOREIGN KEY (organization_id, reel_id) REFERENCES reel_projects(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_rr_user FOREIGN KEY (saved_by) REFERENCES users(id)
) TBL;

-- 10 Highlight Chapters (Auto Chapters toggle; Edit Chapters).
CREATE TABLE reel_chapters (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  reel_id           ID36 NOT NULL,
  chapter_no        SMALLINT UNSIGNED NOT NULL,
  title             VARCHAR(80) NOT NULL COMMENT 'Intro, Build Up Play, Progressive Passes ...',
  start_us          BIGINT UNSIGNED NOT NULL,
  duration_us       BIGINT UNSIGNED NOT NULL,
  thumbnail_asset_id ID36 NULL,
  source            ENUM('AUTO','MANUAL') NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rch_no (reel_id, chapter_no),
  CONSTRAINT fk_rch_reel  FOREIGN KEY (organization_id, reel_id) REFERENCES reel_projects(organization_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_rch_thumb FOREIGN KEY (organization_id, thumbnail_asset_id) REFERENCES assets(organization_id, id),
  CONSTRAINT ck_rch_dur   CHECK (duration_us > 0)
) TBL;

CREATE TABLE reel_settings_flags (
  reel_id           ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  auto_chapters     BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (reel_id),
  CONSTRAINT fk_rsf_reel FOREIGN KEY (organization_id, reel_id) REFERENCES reel_projects(organization_id, id) ON DELETE CASCADE
) TBL;
