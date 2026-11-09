# OTSI VIE — Data Dictionary (generated from the validated MySQL 8.4.13 catalogue)

151 tables · 1537 columns · 357 foreign keys · 615 indexes · 116 CHECK constraints. Grouped by migration module. Column comments name the UI element each column feeds.

## Index

- **001_foundation_identity_storage**: [`assets`](#assets), [`invitations`](#invitations), [`memberships`](#memberships), [`notifications`](#notifications), [`organizations`](#organizations), [`storage_buckets`](#storage_buckets), [`user_preferences`](#user_preferences), [`users`](#users)
- **002_reference_registry_matches**: [`club_aliases`](#club_aliases), [`club_kits`](#club_kits), [`clubs`](#clubs), [`competitions`](#competitions), [`countries`](#countries), [`match_periods`](#match_periods), [`match_rosters`](#match_rosters), [`matches`](#matches), [`otsi_player_id_sequences`](#otsi_player_id_sequences), [`partner_brands`](#partner_brands), [`player_club_spells`](#player_club_spells), [`player_positions`](#player_positions), [`players`](#players), [`positions`](#positions), [`seasons`](#seasons)
- **003_projects_library_collaboration**: [`bookmarks`](#bookmarks), [`comments`](#comments), [`folders`](#folders), [`item_engagement_daily`](#item_engagement_daily), [`item_likes`](#item_likes), [`library_item_collaborators`](#library_item_collaborators), [`library_item_players`](#library_item_players), [`library_item_tags`](#library_item_tags), [`library_items`](#library_items), [`project_members`](#project_members), [`projects`](#projects), [`saved_searches`](#saved_searches), [`tags`](#tags)
- **004_media_ingest_rights**: [`ingest_batches`](#ingest_batches), [`ingest_limits`](#ingest_limits), [`rights_grants`](#rights_grants), [`supported_media_formats`](#supported_media_formats), [`upload_parts`](#upload_parts), [`upload_sessions`](#upload_sessions), [`url_imports`](#url_imports), [`video_classifications`](#video_classifications), [`video_detected_teams`](#video_detected_teams), [`video_frame_index`](#video_frame_index), [`video_ingest_options`](#video_ingest_options), [`video_shots`](#video_shots), [`video_sources`](#video_sources)
- **005_pipeline_cv_identity**: [`detection_batches`](#detection_batches), [`evidence_records`](#evidence_records), [`identity_review_tasks`](#identity_review_tasks), [`job_log_entries`](#job_log_entries), [`model_evaluation_runs`](#model_evaluation_runs), [`model_evaluation_sets`](#model_evaluation_sets), [`model_versions`](#model_versions), [`pipeline_preview_frames`](#pipeline_preview_frames), [`pipeline_runs`](#pipeline_runs), [`pipeline_stage_definitions`](#pipeline_stage_definitions), [`pipeline_step_segments`](#pipeline_step_segments), [`pipeline_steps`](#pipeline_steps), [`pitch_calibrations`](#pitch_calibrations), [`presence_intervals`](#presence_intervals), [`run_worker_assignments`](#run_worker_assignments), [`track_gaps`](#track_gaps), [`track_identity_candidates`](#track_identity_candidates), [`track_identity_decisions`](#track_identity_decisions), [`track_observations`](#track_observations), [`track_segments`](#track_segments), [`tracks`](#tracks), [`worker_nodes`](#worker_nodes), [`worker_resource_samples`](#worker_resource_samples)
- **006_events_metrics_tactics**: [`cohort_metric_baselines`](#cohort_metric_baselines), [`event_candidates`](#event_candidates), [`event_decisions`](#event_decisions), [`event_types`](#event_types), [`heatmaps`](#heatmaps), [`metric_cohorts`](#metric_cohorts), [`metric_definitions`](#metric_definitions), [`metric_values`](#metric_values), [`movement_segments`](#movement_segments), [`pass_network_edges`](#pass_network_edges), [`pass_network_nodes`](#pass_network_nodes), [`pass_networks`](#pass_networks), [`possession_episodes`](#possession_episodes), [`tactical_windows`](#tactical_windows), [`team_shape_nodes`](#team_shape_nodes), [`team_shape_snapshots`](#team_shape_snapshots)
- **007_reels_spotlight_studio**: [`brand_kits`](#brand_kits), [`caption_cues`](#caption_cues), [`effect_keyframes`](#effect_keyframes), [`effect_presets`](#effect_presets), [`media_clip_tags`](#media_clip_tags), [`media_clips`](#media_clips), [`moment_suggestions`](#moment_suggestions), [`music_tracks`](#music_tracks), [`reel_chapters`](#reel_chapters), [`reel_clips`](#reel_clips), [`reel_projects`](#reel_projects), [`reel_revisions`](#reel_revisions), [`reel_settings_flags`](#reel_settings_flags), [`reel_style_settings`](#reel_style_settings), [`reel_targets`](#reel_targets), [`timeline_items`](#timeline_items), [`timeline_tracks`](#timeline_tracks)
- **008_reports_scouting**: [`player_notes`](#player_notes), [`player_role_profiles`](#player_role_profiles), [`player_role_traits`](#player_role_traits), [`report_identity_confidence`](#report_identity_confidence), [`report_insight_citations`](#report_insight_citations), [`report_insights`](#report_insights), [`report_metric_snapshots`](#report_metric_snapshots), [`reports`](#reports), [`scouting_assessments`](#scouting_assessments), [`scouting_dossier_items`](#scouting_dossier_items), [`scouting_dossiers`](#scouting_dossiers), [`scouting_strengths`](#scouting_strengths)
- **009_render_export_delivery**: [`client_contacts`](#client_contacts), [`deliveries`](#deliveries), [`delivery_recipients`](#delivery_recipients), [`export_bundles`](#export_bundles), [`export_presets`](#export_presets), [`render_job_stages`](#render_job_stages), [`render_jobs`](#render_jobs), [`render_qc_checks`](#render_qc_checks), [`report_exports`](#report_exports), [`share_link_access`](#share_link_access), [`share_links`](#share_links)
- **010_commercial_governance_ops**: [`admin_actions`](#admin_actions), [`artifact_dependencies`](#artifact_dependencies), [`audit_events`](#audit_events), [`billing_customers`](#billing_customers), [`billing_webhook_inbox`](#billing_webhook_inbox), [`entitlement_grants`](#entitlement_grants), [`idempotency_keys`](#idempotency_keys), [`invoices`](#invoices), [`kpi_snapshots`](#kpi_snapshots), [`outbox_events`](#outbox_events), [`plan_prices`](#plan_prices), [`plan_versions`](#plan_versions), [`plans`](#plans), [`policy_decisions`](#policy_decisions), [`processing_dead_letters`](#processing_dead_letters), [`quota_counters`](#quota_counters), [`quota_reservations`](#quota_reservations), [`release_signoffs`](#release_signoffs), [`retention_jobs`](#retention_jobs), [`schema_migrations`](#schema_migrations), [`security_events`](#security_events), [`subscriptions`](#subscriptions), [`usage_events`](#usage_events)

---
## Module 001_foundation_identity_storage

### assets

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `project_id` | char(36) | YES |  |  |  |
| 4 | `kind` | enum('SOURCE_VIDEO','PROXY_VIDEO','HLS_PACKAGE','THUMBNAIL','POSTER','SPRITE_SHEET','WAVEFORM','TRACKS_PARQUET','DETECTIONS_PARQUET','EVENTS_PARQUET','HEATMAP_IMAGE','HEATMAP_GRID','CLIP','REEL_RENDER','PREVIEW_RENDER','REPORT_PDF','REPORT_CSV','REPORT_PNG','RENDER_MANIFEST','CAPTIONS_VTT','AUDIO_TRACK','LOGO','FONT','GRAPHIC_TEMPLATE','RIGHTS_EVIDENCE','OTHER') | NO |  |  |  |
| 5 | `bucket_id` | smallint unsigned | NO |  | MUL |  |
| 6 | `object_key` | varchar(1024) | NO |  |  |  |
| 7 | `object_key_hash` | binary(32) | YES | STORED GENERATED |  | Fixed-width uniqueness for long keys |
| 8 | `original_filename` | varchar(512) | YES |  |  | Upload "File Name" |
| 9 | `byte_size` | bigint unsigned | YES |  |  | Upload "File Size" |
| 10 | `sha256` | char(64) | YES |  |  |  |
| 11 | `mime_type` | varchar(127) | YES |  |  |  |
| 12 | `source_asset_id` | char(36) | YES |  |  | Derivation lineage |
| 13 | `storage_state` | enum('PENDING','AVAILABLE','QUARANTINED','DELETING','DELETED') | NO | PENDING |  |  |
| 14 | `retention_until` | datetime(6) | YES |  |  |  |
| 15 | `legal_hold` | tinyint(1) | NO | 0 |  |  |
| 16 | `metadata` | json | NO | json_object() DEFAULT_GENERATED |  |  |
| 17 | `created_by` | char(36) | YES |  | MUL |  |
| 18 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `bucket_id` → `storage_buckets(id)` NO ACTION; `organization_id` → `organizations(id)` NO ACTION; `organization_id,project_id` → `projects(organization_id,id)` NO ACTION; `organization_id,source_asset_id` → `assets(organization_id,id)` NO ACTION; `created_by` → `users(id)` NO ACTION

Indexes: `fk_assets_project`(organization_id,project_id); `fk_assets_user`(created_by); `ix_assets_org_kind`(organization_id,kind,created_at); `ix_assets_source`(organization_id,source_asset_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_assets_location`(bucket_id,object_key_hash); UNIQUE `uq_assets_org_id`(organization_id,id)

Checks: `ck_assets_sha`: ((`sha256` is null) or regexp_like(`sha256`,_ascii\\'^[0-9a-f]{64}$\\'))

### invitations

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `email` | varchar(320) | NO |  |  |  |
| 4 | `role` | enum('ADMIN','ANALYST','EDITOR','SCOUT','VIEWER') | NO |  |  |  |
| 5 | `token_hash` | char(64) | NO |  | UNI |  |
| 6 | `invited_by` | char(36) | NO |  | MUL |  |
| 7 | `expires_at` | datetime(6) | NO |  |  |  |
| 8 | `accepted_at` | datetime(6) | YES |  |  |  |
| 9 | `revoked_at` | datetime(6) | YES |  |  |  |
| 10 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `invited_by` → `users(id)` NO ACTION; `organization_id` → `organizations(id)` CASCADE

Indexes: `fk_invitations_by`(invited_by); `ix_invitations_org_email`(organization_id,email); UNIQUE `PRIMARY`(id); UNIQUE `uq_invitations_token`(token_hash)

### memberships

_Header "Owner" label = role of current membership (or display_name per product decision)_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `organization_id` | char(36) | NO |  | PRI |  |
| 2 | `user_id` | char(36) | NO |  | PRI |  |
| 3 | `role` | enum('OWNER','ADMIN','ANALYST','EDITOR','SCOUT','VIEWER') | NO |  |  |  |
| 4 | `job_title` | varchar(80) | YES |  |  | Shown under collaborator names: Analyst / Scout / Video Editor |
| 5 | `status` | enum('INVITED','ACTIVE','SUSPENDED','REMOVED') | NO | ACTIVE |  |  |
| 6 | `joined_at` | datetime(6) | YES |  |  |  |
| 7 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 8 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |

Foreign keys: `organization_id` → `organizations(id)` CASCADE; `user_id` → `users(id)` NO ACTION

Indexes: `ix_memberships_user`(user_id,status); UNIQUE `PRIMARY`(organization_id,user_id)

### notifications

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `user_id` | char(36) | NO |  |  |  |
| 4 | `kind` | varchar(64) | NO |  |  | JOB_SUCCEEDED, RENDER_READY, DELIVERY_SENT, REVIEW_REQUIRED, MENTION ... |
| 5 | `entity_type` | varchar(48) | NO |  |  |  |
| 6 | `entity_id` | char(36) | NO |  |  |  |
| 7 | `title` | varchar(200) | NO |  |  |  |
| 8 | `body` | varchar(500) | YES |  |  |  |
| 9 | `read_at` | datetime(6) | YES |  |  |  |
| 10 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,user_id` → `memberships(organization_id,user_id)` CASCADE

Indexes: `ix_notifications_inbox`(organization_id,user_id,read_at,created_at); UNIQUE `PRIMARY`(id)

### organizations

_Tenant. Header "OTSI VIE" sub-label = organizations.name_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `name` | varchar(200) | NO |  |  |  |
| 3 | `slug` | varchar(100) | NO |  | UNI |  |
| 4 | `org_type` | enum('CLUB','AGENCY','ANALYST_STUDIO','FEDERATION','MEDIA','INTERNAL') | NO | ANALYST_STUDIO |  |  |
| 5 | `country_code` | char(2) | YES |  |  |  |
| 6 | `default_timezone` | varchar(64) | NO | UTC |  |  |
| 7 | `status` | enum('ACTIVE','SUSPENDED','CLOSED') | NO | ACTIVE |  |  |
| 8 | `settings` | json | NO | json_object() DEFAULT_GENERATED |  |  |
| 9 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 10 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |
| 11 | `row_version` | bigint unsigned | NO | 1 |  |  |

Indexes: UNIQUE `PRIMARY`(id); UNIQUE `uq_organizations_slug`(slug)

Checks: `ck_organizations_slug`: regexp_like(`slug`,_utf8mb4\\'^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$\\')

### storage_buckets

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | smallint unsigned | NO | auto_increment | PRI |  |
| 2 | `name` | varchar(63) | NO |  | UNI |  |
| 3 | `region` | varchar(32) | NO |  |  |  |
| 4 | `purpose` | enum('SOURCE','DERIVED','RENDERS','REPORTS','CV_ARTIFACTS','BRANDING','QUARANTINE') | NO |  |  |  |
| 5 | `kms_key_ref` | varchar(255) | YES |  |  |  |

Indexes: UNIQUE `PRIMARY`(id); UNIQUE `uq_storage_buckets_name`(name)

### user_preferences

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `user_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | PRI |  |
| 3 | `display_mode` | enum('QHD','FHD','AUTO') | NO | QHD |  | Header "QHD" badge |
| 4 | `theme` | enum('DARK','LIGHT','SYSTEM') | NO | DARK |  |  |
| 5 | `ui_state` | json | NO | json_object() DEFAULT_GENERATED |  | Last tabs/toggles per page (e.g. overlay toggles, auto-scroll) |
| 6 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |

Foreign keys: `organization_id,user_id` → `memberships(organization_id,user_id)` CASCADE

Indexes: `fk_userprefs_member`(organization_id,user_id); UNIQUE `PRIMARY`(user_id,organization_id)

### users

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `external_subject` | varchar(255) | NO |  | UNI | OIDC sub; no passwords stored here |
| 3 | `email` | varchar(320) | NO |  | UNI |  |
| 4 | `email_verified` | tinyint(1) | NO | 0 |  |  |
| 5 | `display_name` | varchar(120) | NO |  |  |  |
| 6 | `initials` | varchar(3) | NO |  |  | Avatar text: header "O", collaborator chips "JD","SK","MC" |
| 7 | `avatar_color_hex` | char(7) | YES |  |  |  |
| 8 | `avatar_asset_id` | char(36) | YES |  | MUL |  |
| 9 | `locale` | varchar(16) | NO | en |  |  |
| 10 | `status` | enum('ACTIVE','DISABLED','DELETED') | NO | ACTIVE |  |  |
| 11 | `last_seen_at` | datetime(6) | YES |  |  |  |
| 12 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 13 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |

Foreign keys: `avatar_asset_id` → `assets(id)` NO ACTION

Indexes: `fk_users_avatar`(avatar_asset_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_users_email`(email); UNIQUE `uq_users_subject`(external_subject)

Checks: `ck_users_color`: ((`avatar_color_hex` is null) or regexp_like(`avatar_color_hex`,_ascii\\'^#[0-9a-fA-F]{6}$\\'))


---
## Module 002_reference_registry_matches

### club_aliases

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `club_id` | char(36) | NO |  | PRI |  |
| 2 | `alias` | varchar(150) | NO |  | PRI |  |
| 3 | `source` | varchar(50) | NO | MANUAL |  |  |

Foreign keys: `club_id` → `clubs(id)` CASCADE

Indexes: `ix_club_aliases_alias`(alias); UNIQUE `PRIMARY`(club_id,alias)

### club_kits

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `club_id` | char(36) | NO |  | MUL |  |
| 3 | `season_label` | varchar(20) | YES |  |  |  |
| 4 | `kit_type` | enum('HOME','AWAY','THIRD','GK','OTHER') | NO |  |  |  |
| 5 | `colour_name` | varchar(40) | YES |  |  | Team Identification tile: "(Blue)" / "(White)" |
| 6 | `shirt_color_hex` | char(7) | NO |  |  |  |
| 7 | `shorts_color_hex` | char(7) | YES |  |  |  |

Foreign keys: `club_id` → `clubs(id)` CASCADE

Indexes: `ix_club_kits_club`(club_id,season_label); UNIQUE `PRIMARY`(id)

### clubs

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `owner_organization_id` | char(36) | YES |  | MUL |  |
| 3 | `canonical_name` | varchar(150) | NO |  | MUL | e.g. team name lines in match cards |
| 4 | `short_name` | varchar(50) | YES |  |  |  |
| 5 | `code3` | char(3) | YES |  |  | Scorebug / badges e.g. MCI, RMA |
| 6 | `country_code` | char(2) | YES |  | MUL |  |
| 7 | `crest_asset_id` | char(36) | YES |  | MUL |  |
| 8 | `crest_license_ref` | varchar(255) | YES |  |  |  |
| 9 | `primary_color_hex` | char(7) | YES |  |  | Crest circle fallback colour |
| 10 | `external_ids` | json | NO | json_object() DEFAULT_GENERATED |  |  |
| 11 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `country_code` → `countries(code)` NO ACTION; `crest_asset_id` → `assets(id)` NO ACTION; `owner_organization_id` → `organizations(id)` NO ACTION

Indexes: `fk_clubs_country`(country_code); `fk_clubs_crest`(crest_asset_id); `fk_clubs_owner`(owner_organization_id); `ix_clubs_name`(canonical_name); UNIQUE `PRIMARY`(id)

Checks: `ck_clubs_crest_license`: ((`crest_asset_id` is null) or (`crest_license_ref` is not null))

### competitions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `owner_organization_id` | char(36) | YES |  | MUL | NULL = platform catalogue; else tenant-private competition |
| 3 | `name` | varchar(150) | NO |  |  | e.g. shown in Match card, Competition select, Library filter |
| 4 | `short_name` | varchar(30) | YES |  |  | e.g. chip "UCL" |
| 5 | `competition_type` | enum('LEAGUE','CUP','INTERNATIONAL','FRIENDLY','YOUTH','TRAINING','OTHER') | NO |  |  |  |
| 6 | `country_code` | char(2) | YES |  | MUL |  |
| 7 | `logo_asset_id` | char(36) | YES |  | MUL |  |
| 8 | `logo_license_ref` | varchar(255) | YES |  |  | Required before any logo is rendered (no implied endorsement) |
| 9 | `external_ids` | json | NO | json_object() DEFAULT_GENERATED |  |  |
| 10 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 11 | `owner_key` | char(36) | YES | STORED GENERATED | MUL | NULL-safe uniqueness |

Foreign keys: `country_code` → `countries(code)` NO ACTION; `logo_asset_id` → `assets(id)` NO ACTION; `owner_organization_id` → `organizations(id)` NO ACTION

Indexes: `fk_competitions_country`(country_code); `fk_competitions_logo`(logo_asset_id); `fk_competitions_owner`(owner_organization_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_competitions_owner_name`(owner_key,name)

Checks: `ck_competitions_logo_license`: ((`logo_asset_id` is null) or (`logo_license_ref` is not null))

### countries

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `code` | char(2) | NO |  | PRI | ISO 3166-1 alpha-2 |
| 2 | `code3` | char(3) | NO |  | UNI |  |
| 3 | `name` | varchar(100) | NO |  |  |  |
| 4 | `flag_asset_id` | char(36) | YES |  | MUL | Flag tile shown beside nationality (06, 08, 04) |

Foreign keys: `flag_asset_id` → `assets(id)` NO ACTION

Indexes: `fk_countries_flag`(flag_asset_id); UNIQUE `PRIMARY`(code); UNIQUE `uq_countries_code3`(code3)

### match_periods

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `match_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `period` | enum('FIRST_HALF','SECOND_HALF','ET_FIRST','ET_SECOND','PENALTIES') | NO |  | PRI | Time Range radio: 1st Half / 2nd Half |
| 4 | `clock_start_ms` | int unsigned | NO |  |  | Match clock at period start (0, 2700000 ...) |
| 5 | `added_time_ms` | int unsigned | YES |  |  |  |

Foreign keys: `organization_id,match_id` → `matches(organization_id,id)` CASCADE

Indexes: `fk_match_periods_match`(organization_id,match_id); UNIQUE `PRIMARY`(match_id,period)

### match_rosters

_Team Filter counts (All Players 22 / team 11) = COUNT(*) per side_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `match_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `player_id` | char(36) | NO |  | PRI |  |
| 4 | `club_id` | char(36) | NO |  | MUL |  |
| 5 | `side` | enum('HOME','AWAY') | NO |  |  |  |
| 6 | `jersey_number` | tinyint unsigned | YES |  |  |  |
| 7 | `position_code` | varchar(4) | YES |  | MUL |  |
| 8 | `is_starter` | tinyint(1) | NO | 0 |  |  |
| 9 | `minutes_on` | smallint unsigned | YES |  |  |  |
| 10 | `minutes_off` | smallint unsigned | YES |  |  |  |
| 11 | `roster_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO | INFERRED |  |  |
| 12 | `source_uri` | varchar(1024) | YES |  |  |  |

Foreign keys: `club_id` → `clubs(id)` NO ACTION; `organization_id,match_id` → `matches(organization_id,id)` CASCADE; `player_id` → `players(id)` NO ACTION; `position_code` → `positions(code)` NO ACTION

Indexes: `fk_rosters_club`(club_id); `fk_rosters_pos`(position_code); `ix_rosters_org`(organization_id,match_id,side); `ix_rosters_player`(player_id); UNIQUE `PRIMARY`(match_id,player_id); UNIQUE `uq_rosters_number`(match_id,side,jersey_number)

Checks: `ck_rosters_number`: ((`jersey_number` is null) or (`jersey_number` <= 99))

### matches

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `competition_id` | char(36) | YES |  | MUL |  |
| 4 | `season_id` | char(36) | YES |  | MUL |  |
| 5 | `match_type` | enum('MATCH','TRAINING','FRIENDLY','OTHER') | NO | MATCH |  | Recent upload subtitle "Training" |
| 6 | `title_override` | varchar(200) | YES |  |  | Used when not a fixture (e.g. "Training Session") |
| 7 | `kickoff_at` | datetime(6) | YES |  |  | Match card date "Tue, 16 Apr 2024" (formatted client-side in org timezone) |
| 8 | `venue` | varchar(150) | YES |  |  |  |
| 9 | `home_club_id` | char(36) | YES |  | MUL |  |
| 10 | `away_club_id` | char(36) | YES |  | MUL |  |
| 11 | `home_score` | tinyint unsigned | YES |  |  |  |
| 12 | `away_score` | tinyint unsigned | YES |  |  |  |
| 13 | `score_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO | NOT_MEASURED |  |  |
| 14 | `metadata_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO | INFERRED |  |  |
| 15 | `match_status` | enum('SCHEDULED','PLAYED','ABANDONED','UNKNOWN') | NO | UNKNOWN |  |  |
| 16 | `created_by` | char(36) | NO |  | MUL |  |
| 17 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 18 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |
| 19 | `row_version` | bigint unsigned | NO | 1 |  |  |

Foreign keys: `away_club_id` → `clubs(id)` NO ACTION; `competition_id` → `competitions(id)` NO ACTION; `home_club_id` → `clubs(id)` NO ACTION; `organization_id` → `organizations(id)` NO ACTION; `season_id` → `seasons(id)` NO ACTION; `created_by` → `users(id)` NO ACTION

Indexes: `fk_matches_away`(away_club_id); `fk_matches_comp`(competition_id); `fk_matches_season`(season_id); `fk_matches_user`(created_by); `ix_matches_clubs`(home_club_id,away_club_id); `ix_matches_org_comp`(organization_id,competition_id,season_id); `ix_matches_org_kickoff`(organization_id,kickoff_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_matches_org_id`(organization_id,id)

Checks: `ck_matches_distinct_clubs`: ((`home_club_id` is null) or (`away_club_id` is null) or (`home_club_id` <> `away_club_id`)); `ck_matches_score`: ((`home_score` is null) = (`away_score` is null)); `ck_matches_score_state`: ((`score_state` <> _utf8mb4\\'NOT_MEASURED\\') or (`home_score` is null))

### otsi_player_id_sequences

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `country_code` | char(3) | NO |  | PRI |  |
| 2 | `year_part` | smallint unsigned | NO |  | PRI |  |
| 3 | `next_value` | int unsigned | NO | 1 |  |  |

Indexes: UNIQUE `PRIMARY`(country_code,year_part)

Checks: `ck_otsi_seq`: (`next_value` between 1 and 999999)

### partner_brands

_01 Home "TRUSTED PARTNERS" strip — only licensed marks_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `name` | varchar(120) | NO |  |  |  |
| 3 | `logo_asset_id` | char(36) | NO |  | MUL |  |
| 4 | `license_ref` | varchar(255) | NO |  |  | Contract / written permission reference. No row => nothing shown |
| 5 | `license_valid_until` | date | YES |  |  |  |
| 6 | `display_order` | smallint unsigned | NO | 0 |  |  |
| 7 | `is_active` | tinyint(1) | NO | 1 |  |  |

Foreign keys: `logo_asset_id` → `assets(id)` NO ACTION

Indexes: `fk_partner_brands_logo`(logo_asset_id); UNIQUE `PRIMARY`(id)

### player_club_spells

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `player_id` | char(36) | NO |  | MUL |  |
| 3 | `club_id` | char(36) | NO |  | MUL |  |
| 4 | `squad_number` | tinyint unsigned | YES |  |  | Jersey badge (never used to infer identity) |
| 5 | `valid_from` | date | NO |  |  |  |
| 6 | `valid_to` | date | YES |  |  |  |
| 7 | `source` | varchar(80) | NO | MANUAL |  |  |
| 8 | `verified` | tinyint(1) | NO | 0 |  |  |

Foreign keys: `club_id` → `clubs(id)` NO ACTION; `player_id` → `players(id)` CASCADE

Indexes: `ix_spells_club`(club_id,valid_from); `ix_spells_player`(player_id,valid_from); UNIQUE `PRIMARY`(id)

Checks: `ck_spells_number`: ((`squad_number` is null) or (`squad_number` <= 99)); `ck_spells_range`: ((`valid_to` is null) or (`valid_to` >= `valid_from`))

### player_positions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `player_id` | char(36) | NO |  | PRI |  |
| 2 | `position_code` | varchar(4) | NO |  | PRI |  |
| 3 | `is_primary` | tinyint(1) | NO | 0 |  |  |
| 4 | `sort_order` | tinyint unsigned | NO | 0 |  | Hero chips MC / AM / RW order |

Foreign keys: `player_id` → `players(id)` CASCADE; `position_code` → `positions(code)` NO ACTION

Indexes: `fk_player_positions_pos`(position_code); UNIQUE `PRIMARY`(player_id,position_code)

### players

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `owner_organization_id` | char(36) | YES |  | MUL | NULL = platform registry; else tenant-private (e.g. academy player) |
| 3 | `canonical_otsi_id` | varchar(20) | YES |  | UNI |  |
| 4 | `canonical_state` | enum('PENDING','VERIFIED','MERGED','RETIRED') | NO | PENDING |  |  |
| 5 | `merged_into_player_id` | char(36) | YES |  | MUL |  |
| 6 | `display_name` | varchar(120) | NO |  | MUL | Hero name, list names |
| 7 | `short_name` | varchar(60) | YES |  |  | Timeline lane labels e.g. "K. De Bruyne" |
| 8 | `shirt_name` | varchar(30) | YES |  |  | Formation board labels (uppercase surname) |
| 9 | `given_name` | varchar(80) | YES |  |  |  |
| 10 | `family_name` | varchar(80) | YES |  |  |  |
| 11 | `birth_date` | date | YES |  |  | Age is DERIVED, never stored |
| 12 | `nationality_code` | char(2) | YES |  | MUL |  |
| 13 | `second_nationality_code` | char(2) | YES |  | MUL |  |
| 14 | `height_cm` | smallint unsigned | YES |  |  |  |
| 15 | `weight_kg` | decimal(5,1) | YES |  |  |  |
| 16 | `preferred_foot` | enum('LEFT','RIGHT','BOTH','UNKNOWN') | NO | UNKNOWN |  |  |
| 17 | `primary_position_code` | varchar(4) | YES |  | MUL |  |
| 18 | `photo_asset_id` | char(36) | YES |  | MUL |  |
| 19 | `photo_license_ref` | varchar(255) | YES |  |  |  |
| 20 | `bio_evidence_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO | NOT_MEASURED |  | Provenance of height/weight/birth date |
| 21 | `external_ids` | json | NO | json_object() DEFAULT_GENERATED |  |  |
| 22 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 23 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |
| 24 | `row_version` | bigint unsigned | NO | 1 |  |  |

Foreign keys: `merged_into_player_id` → `players(id)` NO ACTION; `nationality_code` → `countries(code)` NO ACTION; `second_nationality_code` → `countries(code)` NO ACTION; `owner_organization_id` → `organizations(id)` NO ACTION; `photo_asset_id` → `assets(id)` NO ACTION; `primary_position_code` → `positions(code)` NO ACTION

Indexes: `fk_players_merged`(merged_into_player_id); `fk_players_nat`(nationality_code); `fk_players_nat2`(second_nationality_code); `fk_players_owner`(owner_organization_id); `fk_players_photo`(photo_asset_id); `fk_players_position`(primary_position_code); FULLTEXT `ft_players_names`(display_name,short_name,family_name); `ix_players_name`(display_name); UNIQUE `PRIMARY`(id); UNIQUE `uq_players_otsi_id`(canonical_otsi_id)

Checks: `ck_players_otsi_format`: ((`canonical_otsi_id` is null) or regexp_like(`canonical_otsi_id`,_utf8mb4\\'^OTSI-[A-Z]{3}-[0-9]{4}-[0-9]{6}$\\',_utf8mb4\\'c\\')); `ck_players_verified_has_id`: ((`canonical_state` <> _utf8mb4\\'VERIFIED\\') or (`canonical_otsi_id` is not null)); `ck_players_merged`: ((`canonical_state` = _utf8mb4\\'MERGED\\') = (`merged_into_player_id` is not null)); `ck_players_height`: ((`height_cm` is null) or (`height_cm` between 120 and 230)); `ck_players_weight`: ((`weight_kg` is null) or (`weight_kg` between 30 and 150)); `ck_players_photo_license`: ((`photo_asset_id` is null) or (`photo_license_ref` is not null))

### positions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `code` | varchar(4) | NO |  | PRI | GK, CB, LB, RB, DM, MC, AM, LW, RW, CF ... |
| 2 | `label` | varchar(40) | NO |  |  | Midfielder / Attacking Midfielder ... |
| 3 | `line` | enum('GOALKEEPER','DEFENDER','MIDFIELDER','FORWARD') | NO |  |  |  |
| 4 | `sort_order` | tinyint unsigned | NO |  |  |  |

Indexes: UNIQUE `PRIMARY`(code)

### seasons

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `competition_id` | char(36) | NO |  | MUL |  |
| 3 | `label` | varchar(20) | NO |  |  | Season select value, e.g. 2024/2025 |
| 4 | `starts_on` | date | NO |  |  |  |
| 5 | `ends_on` | date | NO |  |  |  |

Foreign keys: `competition_id` → `competitions(id)` NO ACTION

Indexes: UNIQUE `PRIMARY`(id); UNIQUE `uq_seasons_comp_label`(competition_id,label)

Checks: `ck_seasons_range`: (`ends_on` > `starts_on`)


---
## Module 003_projects_library_collaboration

### bookmarks

_01 Home sample-reel bookmark icon_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `organization_id` | char(36) | NO |  | PRI |  |
| 2 | `user_id` | char(36) | NO |  | PRI |  |
| 3 | `library_item_id` | char(36) | NO |  | PRI |  |
| 4 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,library_item_id` → `library_items(organization_id,id)` CASCADE; `organization_id,user_id` → `memberships(organization_id,user_id)` CASCADE

Indexes: `fk_bm_item`(organization_id,library_item_id); UNIQUE `PRIMARY`(organization_id,user_id,library_item_id)

### comments

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `library_item_id` | char(36) | YES |  |  |  |
| 4 | `project_id` | char(36) | YES |  |  |  |
| 5 | `parent_comment_id` | char(36) | YES |  |  |  |
| 6 | `author_user_id` | char(36) | YES |  | MUL |  |
| 7 | `author_share_link_id` | char(36) | YES |  |  | External reviewer via share link with Allow Comments |
| 8 | `body` | varchar(4000) | NO |  |  |  |
| 9 | `at_pts_us` | bigint unsigned | YES |  |  |  |
| 10 | `resolved_at` | datetime(6) | YES |  |  |  |
| 11 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `author_user_id` → `users(id)` NO ACTION; `organization_id,library_item_id` → `library_items(organization_id,id)` CASCADE; `organization_id,parent_comment_id` → `comments(organization_id,id)` NO ACTION; `organization_id,project_id` → `projects(organization_id,id)` NO ACTION; `organization_id,author_share_link_id` → `share_links(organization_id,id)` NO ACTION

Indexes: `fk_comments_author`(author_user_id); `fk_comments_parent`(organization_id,parent_comment_id); `fk_comments_proj`(organization_id,project_id); `fk_comments_share`(organization_id,author_share_link_id); `ix_comments_item`(organization_id,library_item_id,created_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_comments_org_id`(organization_id,id)

Checks: `ck_comments_author`: ((`author_user_id` is not null) or (`author_share_link_id` is not null))

### folders

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `parent_folder_id` | char(36) | YES |  |  |  |
| 4 | `name` | varchar(150) | NO |  |  | Media Bin breadcrumb segments / Library "Folder" rows |
| 5 | `folder_kind` | enum('GENERAL','SCOUTING_DOSSIER','MEDIA_BIN','DELIVERY_PACK') | NO | GENERAL |  |  |
| 6 | `path_cache` | varchar(2000) | YES |  |  | Materialised "/Folders/Team/Player/Season" for breadcrumb |
| 7 | `depth` | tinyint unsigned | NO | 0 |  |  |
| 8 | `created_by` | char(36) | NO |  | MUL |  |
| 9 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 10 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |

Foreign keys: `organization_id` → `organizations(id)` NO ACTION; `organization_id,parent_folder_id` → `folders(organization_id,id)` NO ACTION; `created_by` → `users(id)` NO ACTION

Indexes: `fk_folders_user`(created_by); UNIQUE `PRIMARY`(id); UNIQUE `uq_folders_org_id`(organization_id,id); UNIQUE `uq_folders_sibling_name`(organization_id,parent_folder_id,name)

Checks: `ck_folders_depth`: (`depth` <= 12)

### item_engagement_daily

_01 Home eye/heart counts = SUM over item; written by share/playback event consumers_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `organization_id` | char(36) | NO |  | PRI |  |
| 2 | `library_item_id` | char(36) | NO |  | PRI |  |
| 3 | `day` | date | NO |  | PRI |  |
| 4 | `views` | int unsigned | NO | 0 |  |  |
| 5 | `likes` | int unsigned | NO | 0 |  |  |
| 6 | `shares` | int unsigned | NO | 0 |  |  |
| 7 | `downloads` | int unsigned | NO | 0 |  |  |

Foreign keys: `organization_id,library_item_id` → `library_items(organization_id,id)` CASCADE

Indexes: UNIQUE `PRIMARY`(organization_id,library_item_id,day)

### item_likes

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `organization_id` | char(36) | NO |  | PRI |  |
| 2 | `library_item_id` | char(36) | NO |  | PRI |  |
| 3 | `user_id` | char(36) | NO |  | PRI |  |
| 4 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,library_item_id` → `library_items(organization_id,id)` CASCADE; `organization_id,user_id` → `memberships(organization_id,user_id)` CASCADE

Indexes: `fk_il_member`(organization_id,user_id); UNIQUE `PRIMARY`(organization_id,library_item_id,user_id)

### library_item_collaborators

_Collaborators column / Selected Item Collaborators / Manage Access_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `library_item_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `user_id` | char(36) | NO |  | PRI |  |
| 4 | `access` | enum('VIEW','COMMENT','EDIT','OWNER') | NO | VIEW |  |  |
| 5 | `added_by` | char(36) | NO |  | MUL |  |
| 6 | `added_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `added_by` → `users(id)` NO ACTION; `organization_id,library_item_id` → `library_items(organization_id,id)` CASCADE; `organization_id,user_id` → `memberships(organization_id,user_id)` CASCADE

Indexes: `fk_lic_adder`(added_by); `fk_lic_item`(organization_id,library_item_id); `ix_lic_user`(organization_id,user_id); UNIQUE `PRIMARY`(library_item_id,user_id)

### library_item_players

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `library_item_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `player_id` | char(36) | NO |  | PRI |  |
| 4 | `display_order` | smallint unsigned | NO | 0 |  | Players Featured avatars (first N + "+n") |

Foreign keys: `organization_id,library_item_id` → `library_items(organization_id,id)` CASCADE; `player_id` → `players(id)` NO ACTION

Indexes: `fk_lip_item`(organization_id,library_item_id); `fk_lip_player`(player_id); `ix_lip_player`(organization_id,player_id); UNIQUE `PRIMARY`(library_item_id,player_id)

### library_item_tags

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `library_item_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `tag_id` | char(36) | NO |  | PRI |  |

Foreign keys: `organization_id,library_item_id` → `library_items(organization_id,id)` CASCADE; `organization_id,tag_id` → `tags(organization_id,id)` CASCADE

Indexes: `fk_lit_item`(organization_id,library_item_id); `ix_lit_tag`(organization_id,tag_id); UNIQUE `PRIMARY`(library_item_id,tag_id)

### library_items

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `project_id` | char(36) | YES |  |  |  |
| 4 | `folder_id` | char(36) | YES |  |  |  |
| 5 | `item_type` | enum('REEL','REPORT','MATCH','FOLDER','EXPORT','TEMPLATE','CLIP','VIDEO') | NO |  |  | Type pill |
| 6 | `entity_id` | char(36) | NO |  |  | PK of the domain row for item_type |
| 7 | `title` | varchar(255) | NO |  | MUL | Row title |
| 8 | `subtitle` | varchar(255) | YES |  |  | Row subtitle (series / match label) |
| 9 | `description` | text | YES |  |  | Selected Item description |
| 10 | `status` | enum('DRAFT','IN_REVIEW','PUBLISHED','SHARED','EXPORTED','ARCHIVED','FAILED') | NO | DRAFT |  | Status pill |
| 11 | `match_id` | char(36) | YES |  |  |  |
| 12 | `competition_id` | char(36) | YES |  | MUL |  |
| 13 | `primary_club_id` | char(36) | YES |  | MUL |  |
| 14 | `duration_us` | bigint unsigned | YES |  |  | Thumbnail duration chip / Duration row |
| 15 | `byte_size` | bigint unsigned | YES |  |  | File Size row |
| 16 | `width_px` | smallint unsigned | YES |  |  |  |
| 17 | `height_px` | smallint unsigned | YES |  |  | Resolution row derived (e.g. 1080p) |
| 18 | `thumbnail_asset_id` | char(36) | YES |  |  |  |
| 19 | `primary_asset_id` | char(36) | YES |  |  | Download target |
| 20 | `is_featured` | tinyint(1) | NO | 0 |  | 01 Home FEATURED REEL |
| 21 | `is_template` | tinyint(1) | NO | 0 |  |  |
| 22 | `shared_with_count` | int unsigned | NO | 0 |  |  |
| 23 | `created_by` | char(36) | NO |  | MUL | Created By row |
| 24 | `curated_at` | datetime(6) | YES |  |  | Curated row |
| 25 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 26 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  | Updated column (domain last change, set by projector) |
| 27 | `deleted_at` | datetime(6) | YES |  |  |  |

Foreign keys: `primary_club_id` → `clubs(id)` NO ACTION; `competition_id` → `competitions(id)` NO ACTION; `created_by` → `users(id)` NO ACTION; `organization_id,folder_id` → `folders(organization_id,id)` NO ACTION; `organization_id,match_id` → `matches(organization_id,id)` NO ACTION; `organization_id` → `organizations(id)` NO ACTION; `organization_id,primary_asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id,project_id` → `projects(organization_id,id)` NO ACTION; `organization_id,thumbnail_asset_id` → `assets(organization_id,id)` NO ACTION

Indexes: `fk_li_club`(primary_club_id); `fk_li_comp`(competition_id); `fk_li_creator`(created_by); `fk_li_match`(organization_id,match_id); `fk_li_primary`(organization_id,primary_asset_id); `fk_li_project`(organization_id,project_id); `fk_li_thumb`(organization_id,thumbnail_asset_id); FULLTEXT `ft_library_search`(title,subtitle,description); `ix_library_club`(organization_id,primary_club_id,updated_at); `ix_library_comp`(organization_id,competition_id,updated_at); `ix_library_creator`(organization_id,created_by,updated_at); `ix_library_featured`(organization_id,is_featured,updated_at); `ix_library_folder`(organization_id,folder_id); `ix_library_status`(organization_id,status,updated_at); `ix_library_tab`(organization_id,item_type,deleted_at,updated_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_library_items_entity`(organization_id,item_type,entity_id); UNIQUE `uq_library_items_org_id`(organization_id,id)

### project_members

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `project_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `user_id` | char(36) | NO |  | PRI |  |
| 4 | `permission` | enum('READ','COMMENT','EDIT','REVIEW','ADMIN') | NO |  |  |  |
| 5 | `granted_by` | char(36) | NO |  | MUL |  |
| 6 | `granted_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `granted_by` → `users(id)` NO ACTION; `organization_id,user_id` → `memberships(organization_id,user_id)` CASCADE; `organization_id,project_id` → `projects(organization_id,id)` CASCADE

Indexes: `fk_pm_granter`(granted_by); `fk_pm_project`(organization_id,project_id); `ix_project_members_user`(organization_id,user_id); UNIQUE `PRIMARY`(project_id,user_id)

### projects

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `name` | varchar(200) | NO |  |  |  |
| 4 | `description` | text | YES |  |  |  |
| 5 | `primary_match_id` | char(36) | YES |  |  |  |
| 6 | `status` | enum('ACTIVE','ARCHIVED') | NO | ACTIVE |  |  |
| 7 | `created_by` | char(36) | NO |  |  |  |
| 8 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 9 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |
| 10 | `row_version` | bigint unsigned | NO | 1 |  |  |

Foreign keys: `organization_id,primary_match_id` → `matches(organization_id,id)` NO ACTION; `organization_id` → `organizations(id)` NO ACTION; `organization_id,created_by` → `memberships(organization_id,user_id)` NO ACTION

Indexes: `fk_projects_match`(organization_id,primary_match_id); `fk_projects_user`(organization_id,created_by); `ix_projects_org_updated`(organization_id,status,updated_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_projects_org_id`(organization_id,id)

### saved_searches

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `user_id` | char(36) | NO |  |  |  |
| 4 | `name` | varchar(80) | NO |  |  | Saved Searches chip label |
| 5 | `icon` | enum('SEARCH','GRID') | NO | SEARCH |  |  |
| 6 | `query` | json | NO |  |  | {text,type,competitionId,clubId,createdBy,dateRange,tab} |
| 7 | `display_order` | smallint unsigned | NO | 0 |  |  |
| 8 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,user_id` → `memberships(organization_id,user_id)` CASCADE

Indexes: UNIQUE `PRIMARY`(id); UNIQUE `uq_saved_searches_name`(organization_id,user_id,name)

Checks: `ck_ss_query`: json_schema_valid(_utf8mb4\\'{"type":"object","additionalProperties":false,"properties":{\\\\n      "text":{"type":"string","maxLength":200},"tab":{"type":"string"},"type":{"type":"string"},\\\\n      "competitionId":{"type":"string"},"clubId":{"type":"string"},"createdBy":{"type":"string"},\\\\n   

### tags

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `label` | varchar(60) | NO |  |  | Chips: Progressive, Passing, UCL, Build-up ... |
| 4 | `normalized_label` | varchar(60) | YES | STORED GENERATED |  |  |
| 5 | `tag_kind` | enum('FREE','EVENT','PLAYER','COMPETITION','SYSTEM') | NO | FREE |  |  |
| 6 | `color_hex` | char(7) | YES |  |  |  |
| 7 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id` → `organizations(id)` NO ACTION

Indexes: UNIQUE `PRIMARY`(id); UNIQUE `uq_tags_org_id`(organization_id,id); UNIQUE `uq_tags_org_label`(organization_id,normalized_label)


---
## Module 004_media_ingest_rights

### ingest_batches

_02 Batch Upload tab_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `project_id` | char(36) | NO |  |  |  |
| 4 | `label` | varchar(150) | YES |  |  |  |
| 5 | `item_count` | smallint unsigned | NO | 0 |  |  |
| 6 | `created_by` | char(36) | NO |  | MUL |  |
| 7 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,project_id` → `projects(organization_id,id)` NO ACTION; `created_by` → `users(id)` NO ACTION

Indexes: `fk_ib_project`(organization_id,project_id); `fk_ib_user`(created_by); UNIQUE `PRIMARY`(id); UNIQUE `uq_ingest_batches_org_id`(organization_id,id)

### ingest_limits

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `organization_id` | char(36) | NO |  | PRI |  |
| 2 | `max_file_bytes` | bigint unsigned | NO |  |  | Copy currently conflicts: 01 "2GB" vs 02 "50 GB" — owner must set one value |
| 3 | `max_duration_us` | bigint unsigned | YES |  |  |  |
| 4 | `max_concurrent_uploads` | smallint unsigned | NO | 3 |  |  |
| 5 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |

Foreign keys: `organization_id` → `organizations(id)` NO ACTION

Indexes: UNIQUE `PRIMARY`(organization_id)

### rights_grants

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | YES |  |  |  |
| 4 | `asset_id` | char(36) | YES |  |  |  |
| 5 | `rights_state` | enum('UNKNOWN','ANALYSIS_ONLY','INTERNAL','EXPORT_ALLOWED','PUBLIC','EXPIRED','REVOKED') | NO | UNKNOWN |  |  |
| 6 | `allowed_uses` | json | NO | json_array() DEFAULT_GENERATED |  | ["ANALYZE","PRODUCE","EXPORT","SHARE","DELIVER","PUBLIC_POST"] |
| 7 | `territory_codes` | json | NO | json_array() DEFAULT_GENERATED |  |  |
| 8 | `licensor` | varchar(200) | YES |  |  |  |
| 9 | `valid_from` | datetime(6) | YES |  |  |  |
| 10 | `valid_until` | datetime(6) | YES |  |  |  |
| 11 | `guardian_consent_state` | enum('NOT_APPLICABLE','PENDING','VERIFIED','REVOKED') | NO | NOT_APPLICABLE |  |  |
| 12 | `evidence_asset_id` | char(36) | YES |  |  |  |
| 13 | `recorded_by` | char(36) | NO |  | MUL |  |
| 14 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id,evidence_asset_id` → `assets(organization_id,id)` NO ACTION; `recorded_by` → `users(id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_rights_evid`(organization_id,evidence_asset_id); `fk_rights_user`(recorded_by); `ix_rights_asset`(organization_id,asset_id,rights_state); `ix_rights_video`(organization_id,video_id,rights_state); UNIQUE `PRIMARY`(id)

Checks: `ck_rights_target`: ((`video_id` is not null) or (`asset_id` is not null)); `ck_rights_range`: ((`valid_until` is null) or (`valid_from` is null) or (`valid_until` > `valid_from`)); `ck_rights_uses`: (json_type(`allowed_uses`) = _utf8mb4\\'ARRAY\\')

### supported_media_formats

_02 Supported Formats panel; also the server-side ingest allow-list_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `container_code` | varchar(10) | NO |  | PRI | MP4, MOV, AVI, MKV, MPEG, FLV, TS, WEBM |
| 2 | `display_name` | varchar(20) | NO |  |  |  |
| 3 | `codec_summary` | varchar(40) | NO |  |  | Format chip subtitle e.g. H.264/H.265 |
| 4 | `mime_types` | json | NO |  |  |  |
| 5 | `file_extensions` | json | NO |  |  |  |
| 6 | `accepted` | tinyint(1) | NO | 1 |  |  |
| 7 | `display_order` | tinyint unsigned | NO |  |  |  |

Indexes: UNIQUE `PRIMARY`(container_code)

### upload_parts

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `session_id` | char(36) | NO |  | PRI |  |
| 2 | `part_number` | smallint unsigned | NO |  | PRI |  |
| 3 | `byte_size` | bigint unsigned | NO |  |  |  |
| 4 | `remote_etag` | varchar(255) | NO |  |  |  |
| 5 | `part_sha256` | char(64) | YES |  |  |  |
| 6 | `received_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `session_id` → `upload_sessions(id)` CASCADE

Indexes: UNIQUE `PRIMARY`(session_id,part_number)

Checks: `ck_upload_parts`: ((`part_number` between 1 and 10000) and (`byte_size` > 0))

### upload_sessions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  |  |  |
| 4 | `created_by` | char(36) | NO |  | MUL |  |
| 5 | `idempotency_key` | varchar(128) | NO |  |  |  |
| 6 | `multipart_upload_id` | varchar(255) | YES |  |  |  |
| 7 | `original_filename` | varchar(512) | NO |  |  |  |
| 8 | `declared_mime_type` | varchar(127) | YES |  |  |  |
| 9 | `expected_bytes` | bigint unsigned | NO |  |  |  |
| 10 | `expected_sha256` | char(64) | YES |  |  |  |
| 11 | `part_size_bytes` | int unsigned | NO | 67108864 |  |  |
| 12 | `transferred_bytes` | bigint unsigned | NO | 0 |  |  |
| 13 | `progress_pct` | decimal(5,2) | YES | STORED GENERATED |  | Uploading stage percent |
| 14 | `status` | enum('INITIALIZED','UPLOADING','VERIFYING','COMPLETED','ABORTED','EXPIRED','FAILED') | NO | INITIALIZED | MUL |  |
| 15 | `failure_code` | varchar(64) | YES |  |  |  |
| 16 | `expires_at` | datetime(6) | NO |  |  |  |
| 17 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 18 | `completed_at` | datetime(6) | YES |  |  |  |

Foreign keys: `created_by` → `users(id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_upload_user`(created_by); `ix_upload_expiry`(status,expires_at); `ix_upload_video`(organization_id,video_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_upload_idem`(organization_id,idempotency_key)

Checks: `ck_upload_bytes`: ((`expected_bytes` > 0) and (`transferred_bytes` <= `expected_bytes`))

### url_imports

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  |  |  |
| 4 | `submitted_url` | varchar(2048) | NO |  |  | "Paste YouTube link or direct video URL..." |
| 5 | `provider` | enum('DIRECT_HTTP','YOUTUBE','HUDL','WYSCOUT','VEO','OTHER_AUTHORIZED') | NO |  |  |  |
| 6 | `provider_account_ref` | varchar(255) | YES |  |  | Licensed integration credential reference (secret manager key, never the secret) |
| 7 | `resolved_host` | varchar(255) | YES |  |  |  |
| 8 | `ssrf_check_passed` | tinyint(1) | NO | 0 |  |  |
| 9 | `terms_check_state` | enum('PENDING','ALLOWED','DENIED') | NO | PENDING |  |  |
| 10 | `status` | enum('QUEUED','FETCHING','COMPLETED','REJECTED','FAILED') | NO | QUEUED |  |  |
| 11 | `failure_code` | varchar(64) | YES |  |  |  |
| 12 | `created_by` | char(36) | NO |  | MUL |  |
| 13 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `created_by` → `users(id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_url_user`(created_by); `ix_url_imports_video`(organization_id,video_id); UNIQUE `PRIMARY`(id)

Checks: `ck_url_fetch_gate`: ((`status` not in (_utf8mb4\\'FETCHING\\',_utf8mb4\\'COMPLETED\\')) or ((0 <> `ssrf_check_passed`) and (`terms_check_state` = _utf8mb4\\'ALLOWED\\')))

### video_classifications

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  |  |  |
| 4 | `content_class` | enum('MATCH','TRAINING','HIGHLIGHTS','INTERVIEW','OTHER') | NO |  |  | "Detected Content" |
| 5 | `confidence` | decimal(5,4) | YES |  |  |  |
| 6 | `confidence_band` | enum('HIGH','MEDIUM','LOW') | YES |  |  | "(High Confidence)" |
| 7 | `evidence_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO | INFERRED |  |  |
| 8 | `model_version_id` | char(36) | YES |  | MUL |  |
| 9 | `confirmed_by` | char(36) | YES |  | MUL |  |
| 10 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `model_version_id` → `model_versions(id)` NO ACTION; `confirmed_by` → `users(id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` CASCADE

Indexes: `fk_vc_model`(model_version_id); `fk_vc_user`(confirmed_by); `ix_vc_video`(organization_id,video_id,created_at); UNIQUE `PRIMARY`(id)

Checks: `ck_vc_conf`: ((`confidence` is null) or (`confidence` between 0 and 1)); `ck_vc_confirmed`: ((`evidence_state` <> _utf8mb4\\'CONFIRMED\\') or (`confirmed_by` is not null))

### video_detected_teams

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  | MUL |  |
| 4 | `side` | enum('HOME','AWAY','UNKNOWN') | NO |  |  |  |
| 5 | `cluster_label` | varchar(20) | NO |  |  | Team cluster from kit segmentation, e.g. A / B |
| 6 | `kit_color_hex` | char(7) | YES |  |  |  |
| 7 | `kit_color_name` | varchar(30) | YES |  |  |  |
| 8 | `proposed_club_id` | char(36) | YES |  | MUL |  |
| 9 | `confidence` | decimal(5,4) | YES |  |  |  |
| 10 | `evidence_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO | INFERRED |  |  |
| 11 | `confirmed_club_id` | char(36) | YES |  | MUL |  |
| 12 | `confirmed_by` | char(36) | YES |  | MUL |  |

Foreign keys: `confirmed_club_id` → `clubs(id)` NO ACTION; `proposed_club_id` → `clubs(id)` NO ACTION; `confirmed_by` → `users(id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` CASCADE

Indexes: `fk_vdt_conf`(confirmed_club_id); `fk_vdt_prop`(proposed_club_id); `fk_vdt_user`(confirmed_by); `fk_vdt_video`(organization_id,video_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_vdt`(video_id,cluster_label)

Checks: `ck_vdt_confirm`: ((`evidence_state` <> _utf8mb4\\'CONFIRMED\\') or ((`confirmed_club_id` is not null) and (`confirmed_by` is not null)))

### video_frame_index

_High volume (~170k rows per 95-min match at 30fps). Written in bulk by the worker; FKs omitted by design, integrity checked by orphan job._

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `video_id` | char(36) | NO |  | PRI |  |
| 2 | `frame_index` | int unsigned | NO |  | PRI |  |
| 3 | `pts_us` | bigint unsigned | NO |  |  |  |
| 4 | `shot_id` | char(36) | YES |  |  |  |
| 5 | `is_keyframe` | tinyint(1) | NO | 0 |  |  |

Indexes: UNIQUE `PRIMARY`(video_id,frame_index); UNIQUE `uq_frame_pts`(video_id,pts_us)

### video_ingest_options

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `video_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `stabilize_video` | tinyint(1) | NO | 1 |  |  |
| 4 | `auto_crop_pitch` | tinyint(1) | NO | 1 |  |  |
| 5 | `enhance_quality` | tinyint(1) | NO | 1 |  |  |
| 6 | `remove_crowd_noise` | tinyint(1) | NO | 0 |  |  |
| 7 | `correct_aspect_ratio` | tinyint(1) | NO | 1 |  |  |
| 8 | `overlay_players_teams` | tinyint(1) | NO | 1 |  |  |
| 9 | `overlay_ball_tracking` | tinyint(1) | NO | 1 |  |  |
| 10 | `overlay_jersey_numbers` | tinyint(1) | NO | 1 |  |  |
| 11 | `overlay_pitch_lines` | tinyint(1) | NO | 1 |  |  |
| 12 | `overlay_event_markers` | tinyint(1) | NO | 0 |  |  |
| 13 | `auto_create_match` | tinyint(1) | NO | 1 |  |  |
| 14 | `extract_metadata` | tinyint(1) | NO | 1 |  |  |
| 15 | `generate_highlights` | tinyint(1) | NO | 0 |  |  |
| 16 | `send_to_analysis` | tinyint(1) | NO | 1 |  |  |
| 17 | `locked_at` | datetime(6) | YES |  |  | Set when first pipeline run starts; changes require a new run |
| 18 | `updated_by` | char(36) | NO |  | MUL |  |
| 19 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |

Foreign keys: `updated_by` → `users(id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` CASCADE

Indexes: `fk_vio_user`(updated_by); `fk_vio_video`(organization_id,video_id); UNIQUE `PRIMARY`(video_id)

### video_shots

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  | MUL |  |
| 4 | `start_pts_us` | bigint unsigned | NO |  |  |  |
| 5 | `end_pts_us` | bigint unsigned | NO |  |  |  |
| 6 | `camera_class` | enum('WIDE_TACTICAL','BROADCAST_MAIN','CLOSE_UP','REPLAY','CROWD','GRAPHIC','OTHER') | YES |  |  |  |
| 7 | `confidence` | decimal(5,4) | YES |  |  |  |

Foreign keys: `organization_id,video_id` → `video_sources(organization_id,id)` CASCADE

Indexes: `fk_shots_video`(organization_id,video_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_shots_start`(video_id,start_pts_us)

Checks: `ck_shots_range`: (`end_pts_us` > `start_pts_us`)

### video_sources

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `project_id` | char(36) | NO |  |  |  |
| 4 | `match_id` | char(36) | YES |  |  | Match Context: Match select (optional) |
| 5 | `source_asset_id` | char(36) | YES |  |  |  |
| 6 | `proxy_asset_id` | char(36) | YES |  |  | Browser playback rendition (HLS/MP4) |
| 7 | `poster_asset_id` | char(36) | YES |  |  | Thumbnails in recent lists / previews |
| 8 | `ingest_mode` | enum('UPLOAD','DIRECT_URL','AUTHORIZED_PROVIDER','BATCH') | NO |  |  | Upload method tabs |
| 9 | `batch_id` | char(36) | YES |  |  |  |
| 10 | `source_uri` | varchar(2048) | YES |  |  |  |
| 11 | `title` | varchar(255) | YES |  |  |  |
| 12 | `state` | enum('PENDING','UPLOADING','VALIDATING','INGESTED','FAILED','QUARANTINED','DELETED') | NO | PENDING |  |  |
| 13 | `failure_code` | varchar(64) | YES |  |  |  |
| 14 | `duration_us` | bigint unsigned | YES |  |  | Duration row / thumbnail chip |
| 15 | `width_px` | smallint unsigned | YES |  |  |  |
| 16 | `height_px` | smallint unsigned | YES |  |  |  |
| 17 | `fps_num` | int unsigned | YES |  |  |  |
| 18 | `fps_den` | int unsigned | YES |  |  |  |
| 19 | `fps` | decimal(9,4) | YES | STORED GENERATED |  | Frame Rate row |
| 20 | `timebase_num` | int unsigned | YES |  |  |  |
| 21 | `timebase_den` | int unsigned | YES |  |  |  |
| 22 | `frame_count` | bigint unsigned | YES |  |  |  |
| 23 | `video_codec` | varchar(32) | YES |  |  |  |
| 24 | `audio_codec` | varchar(32) | YES |  |  |  |
| 25 | `container_code` | varchar(10) | YES |  | MUL |  |
| 26 | `bitrate_bps` | bigint unsigned | YES |  |  |  |
| 27 | `video_sha256` | char(64) | YES |  |  |  |
| 28 | `created_by` | char(36) | NO |  | MUL |  |
| 29 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 30 | `ingested_at` | datetime(6) | YES |  |  |  |
| 31 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |
| 32 | `row_version` | bigint unsigned | NO | 1 |  |  |

Foreign keys: `organization_id,batch_id` → `ingest_batches(organization_id,id)` NO ACTION; `container_code` → `supported_media_formats(container_code)` NO ACTION; `organization_id,match_id` → `matches(organization_id,id)` NO ACTION; `organization_id,poster_asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id,project_id` → `projects(organization_id,id)` NO ACTION; `organization_id,proxy_asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id,source_asset_id` → `assets(organization_id,id)` NO ACTION; `created_by` → `users(id)` NO ACTION

Indexes: `fk_vs_batch`(organization_id,batch_id); `fk_vs_format`(container_code); `fk_vs_poster`(organization_id,poster_asset_id); `fk_vs_project`(organization_id,project_id); `fk_vs_proxy`(organization_id,proxy_asset_id); `fk_vs_source`(organization_id,source_asset_id); `fk_vs_user`(created_by); `ix_vs_match`(organization_id,match_id); `ix_vs_org_recent`(organization_id,created_at); `ix_vs_sha`(organization_id,video_sha256); `ix_vs_state`(organization_id,state,created_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_video_sources_org_id`(organization_id,id)

Checks: `ck_vs_ingested`: ((`state` <> _utf8mb4\\'INGESTED\\') or ((`source_asset_id` is not null) and (coalesce(`duration_us`,0) > 0) and (coalesce(`width_px`,0) > 0) and (coalesce(`height_px`,0) > 0) and (coalesce(`fps_num`,0) > 0) and (coalesce(`fps_den`,0) > 0)))


---
## Module 005_pipeline_cv_identity

### detection_batches

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `run_id` | char(36) | NO |  |  |  |
| 4 | `model_version_id` | char(36) | NO |  | MUL |  |
| 5 | `start_frame` | bigint unsigned | NO |  |  |  |
| 6 | `end_frame` | bigint unsigned | NO |  |  |  |
| 7 | `payload_asset_id` | char(36) | NO |  |  | Parquet in S3 |
| 8 | `checksum` | char(64) | NO |  |  |  |
| 9 | `detection_count` | bigint unsigned | NO |  |  |  |

Foreign keys: `organization_id,payload_asset_id` → `assets(organization_id,id)` NO ACTION; `model_version_id` → `model_versions(id)` NO ACTION; `organization_id,run_id` → `pipeline_runs(organization_id,id)` CASCADE

Indexes: `fk_db_asset`(organization_id,payload_asset_id); `fk_db_model`(model_version_id); `ix_db_run`(organization_id,run_id,start_frame); UNIQUE `PRIMARY`(id)

Checks: `ck_db_range`: (`end_frame` >= `start_frame`)

### evidence_records

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | YES |  |  |  |
| 4 | `pipeline_run_id` | char(36) | YES |  |  |  |
| 5 | `model_version_id` | char(36) | YES |  | MUL |  |
| 6 | `state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO |  |  |  |
| 7 | `source_type` | enum('MODEL','HUMAN_REVIEW','OFFICIAL_FEED','ROSTER','CALIBRATION','DERIVED') | NO |  |  |  |
| 8 | `source_ref` | varchar(255) | NO |  |  |  |
| 9 | `frame_from` | bigint unsigned | YES |  |  |  |
| 10 | `frame_to` | bigint unsigned | YES |  |  |  |
| 11 | `confidence` | decimal(5,4) | YES |  |  |  |
| 12 | `reviewer_id` | char(36) | YES |  | MUL |  |
| 13 | `reviewed_at` | datetime(6) | YES |  |  |  |
| 14 | `notes` | text | YES |  |  |  |
| 15 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `model_version_id` → `model_versions(id)` NO ACTION; `organization_id,pipeline_run_id` → `pipeline_runs(organization_id,id)` NO ACTION; `reviewer_id` → `users(id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_ev_model`(model_version_id); `fk_ev_run`(organization_id,pipeline_run_id); `fk_ev_user`(reviewer_id); `ix_evidence_video`(organization_id,video_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_evidence_org_id`(organization_id,id)

Checks: `ck_ev_confirmed`: ((`state` <> _utf8mb4\\'CONFIRMED\\') or (`reviewer_id` is not null) or (`source_type` in (_utf8mb4\\'OFFICIAL_FEED\\',_utf8mb4\\'ROSTER\\'))); `ck_ev_conf`: ((`confidence` is null) or (`confidence` between 0 and 1))

### identity_review_tasks

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  |  |  |
| 4 | `track_id` | char(36) | NO |  |  |  |
| 5 | `flag` | enum('ID_SWITCH','MULTIPLE_CANDIDATES','OVERLAPPING_IDENTITY','BLURRY_JERSEY','KIT_AMBIGUITY','CALIBRATION_DISCONTINUITY','SHOT_CUT','LOW_COVERAGE','UNCERTAIN_BALL_EVENT','TARGET_DISAPPEARANCE','FALSE_POSITIVE') | NO |  |  |  |
| 6 | `priority` | tinyint unsigned | NO | 50 |  |  |
| 7 | `status` | enum('OPEN','IN_PROGRESS','RESOLVED','DISMISSED') | NO | OPEN |  |  |
| 8 | `assigned_to` | char(36) | YES |  | MUL |  |
| 9 | `resolution_decision_id` | char(36) | YES |  |  |  |
| 10 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 11 | `resolved_at` | datetime(6) | YES |  |  |  |

Foreign keys: `organization_id,resolution_decision_id` → `track_identity_decisions(organization_id,id)` NO ACTION; `organization_id,track_id` → `tracks(organization_id,id)` NO ACTION; `assigned_to` → `users(id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_irt_dec`(organization_id,resolution_decision_id); `fk_irt_track`(organization_id,track_id); `fk_irt_user`(assigned_to); `fk_irt_video`(organization_id,video_id); `ix_irt_queue`(organization_id,status,priority,created_at); UNIQUE `PRIMARY`(id)

### job_log_entries

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | bigint unsigned | NO | auto_increment | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `run_id` | char(36) | NO |  |  |  |
| 4 | `step_id` | char(36) | YES |  | MUL |  |
| 5 | `level` | enum('DEBUG','INFO','SUCCESS','WARN','ERROR') | NO | INFO |  |  |
| 6 | `message_code` | varchar(64) | NO |  |  | Stable code for i18n, e.g. TRACKLETS_GENERATED |
| 7 | `message` | varchar(500) | NO |  |  | Rendered text, e.g. "Player tracklets generated (22)" |
| 8 | `params` | json | NO | json_object() DEFAULT_GENERATED |  |  |
| 9 | `is_pending` | tinyint(1) | NO | 0 |  | Pending rows render dimmed with empty circle |
| 10 | `user_visible` | tinyint(1) | NO | 1 |  |  |
| 11 | `occurred_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,run_id` → `pipeline_runs(organization_id,id)` CASCADE; `step_id` → `pipeline_steps(id)` NO ACTION

Indexes: `fk_log_step`(step_id); `ix_log_run`(organization_id,run_id,id); UNIQUE `PRIMARY`(id)

### model_evaluation_runs

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `model_version_id` | char(36) | NO |  | MUL |  |
| 3 | `evaluation_set_id` | char(36) | NO |  | MUL |  |
| 4 | `summary_metrics` | json | NO |  |  | mAP, HOTA, IDF1, event P/R, calibration ... |
| 5 | `acceptance_state` | enum('PENDING','PASSED','FAILED') | NO | PENDING |  |  |
| 6 | `reviewed_by` | char(36) | YES |  | MUL |  |
| 7 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `model_version_id` → `model_versions(id)` NO ACTION; `evaluation_set_id` → `model_evaluation_sets(id)` NO ACTION; `reviewed_by` → `users(id)` NO ACTION

Indexes: `fk_mer_set`(evaluation_set_id); `fk_mer_user`(reviewed_by); `ix_mer_model`(model_version_id,created_at); UNIQUE `PRIMARY`(id)

### model_evaluation_sets

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `name` | varchar(150) | NO |  | UNI |  |
| 3 | `dataset_sha256` | char(64) | NO |  |  |  |
| 4 | `license_note` | text | NO |  |  |  |
| 5 | `manifest_object_key` | varchar(1024) | NO |  |  |  |
| 6 | `split_policy` | varchar(255) | NO | by fixture/stadium/camera |  |  |
| 7 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Indexes: UNIQUE `PRIMARY`(id); UNIQUE `uq_mes_name`(name)

### model_versions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `task` | enum('VIDEO_CLASSIFY','SHOT_DETECT','PLAYER_DETECT','BALL_DETECT','TRACK','REID','JERSEY_OCR','TEAM_CLUSTER','PITCH_KEYPOINTS','EVENT_DETECT','FORMATION','XG','XA','INSIGHT_LLM','CAPTION_ASR','HIGHLIGHT_RANK') | NO |  | MUL |  |
| 3 | `model_name` | varchar(100) | NO |  |  |  |
| 4 | `semantic_version` | varchar(40) | NO |  |  |  |
| 5 | `weights_sha256` | char(64) | NO |  |  |  |
| 6 | `license_id` | varchar(120) | NO |  |  | Commercial licence evidence required (ADR-009) |
| 7 | `approval_state` | enum('CANDIDATE','APPROVED','DEPRECATED','REVOKED') | NO | CANDIDATE |  |  |
| 8 | `approved_by` | char(36) | YES |  | MUL |  |
| 9 | `approved_at` | datetime(6) | YES |  |  |  |
| 10 | `config` | json | NO | json_object() DEFAULT_GENERATED |  |  |
| 11 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `approved_by` → `users(id)` NO ACTION

Indexes: `fk_mv_approver`(approved_by); `ix_model_task_state`(task,approval_state); UNIQUE `PRIMARY`(id); UNIQUE `uq_model_versions`(task,model_name,semantic_version)

Checks: `ck_mv_approved`: ((`approval_state` <> _utf8mb4\\'APPROVED\\') or ((`approved_by` is not null) and (`approved_at` is not null)))

### pipeline_preview_frames

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `run_id` | char(36) | NO |  |  |  |
| 4 | `preview_kind` | enum('PLAYERS','BALL','TEAMS','EVENTS','METADATA','PROCESSING_VIEW') | NO |  |  |  |
| 5 | `pts_us` | bigint unsigned | NO |  |  |  |
| 6 | `frame_asset_id` | char(36) | NO |  |  |  |
| 7 | `overlay` | json | NO | json_array() DEFAULT_GENERATED |  | [{trackId,bbox:[x,y,w,h],label,teamSide,confidence}] |
| 8 | `headline_count` | int unsigned | YES |  |  | "22 players detected" / "1 ball detected" |
| 9 | `headline_confidence` | decimal(5,4) | YES |  |  | "Ball 0.98" |
| 10 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,frame_asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id,run_id` → `pipeline_runs(organization_id,id)` CASCADE

Indexes: `fk_ppf_asset`(organization_id,frame_asset_id); `ix_ppf_run_kind`(organization_id,run_id,preview_kind,created_at); UNIQUE `PRIMARY`(id)

### pipeline_runs

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  | MUL |  |
| 4 | `attempt` | smallint unsigned | NO | 1 |  |  |
| 5 | `retry_of_run_id` | char(36) | YES |  |  |  |
| 6 | `pipeline_version` | varchar(40) | NO |  |  |  |
| 7 | `workflow_id` | varchar(255) | YES |  |  | Temporal workflow id |
| 8 | `status` | enum('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') | NO | QUEUED |  |  |
| 9 | `overall_progress` | decimal(5,2) | NO | 0.00 |  | 03 job card bar + percent (single source; never two numbers) |
| 10 | `eta_seconds` | int unsigned | YES |  |  |  |
| 11 | `frames_total` | bigint unsigned | YES |  |  |  |
| 12 | `frames_processed` | bigint unsigned | NO | 0 |  |  |
| 13 | `config` | json | NO | json_object() DEFAULT_GENERATED |  | Snapshot of video_ingest_options + model pins |
| 14 | `idempotency_key` | varchar(128) | NO |  |  |  |
| 15 | `requested_by` | char(36) | NO |  | MUL |  |
| 16 | `queued_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 17 | `started_at` | datetime(6) | YES |  |  |  |
| 18 | `finished_at` | datetime(6) | YES |  |  |  |
| 19 | `failure_code` | varchar(64) | YES |  |  |  |
| 20 | `failure_detail` | text | YES |  |  |  |

Foreign keys: `organization_id,retry_of_run_id` → `pipeline_runs(organization_id,id)` NO ACTION; `requested_by` → `users(id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_runs_retry`(organization_id,retry_of_run_id); `fk_runs_user`(requested_by); `fk_runs_video`(organization_id,video_id); `ix_runs_org_status`(organization_id,status,queued_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_pipeline_runs_attempt`(video_id,attempt); UNIQUE `uq_pipeline_runs_idem`(organization_id,idempotency_key); UNIQUE `uq_pipeline_runs_org_id`(organization_id,id)

Checks: `ck_runs_progress`: (`overall_progress` between 0 and 100); `ck_runs_frames`: ((`frames_total` is null) or (`frames_processed` <= `frames_total`)); `ck_runs_succeeded`: ((`status` <> _utf8mb4\\'SUCCEEDED\\') or ((`overall_progress` = 100) and (`finished_at` is not null))); `ck_runs_failed`: ((`status` <> _utf8mb4\\'FAILED\\') or (`failure_code` is not null))

### pipeline_stage_definitions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `code` | varchar(24) | NO |  | PRI |  |
| 2 | `engine_step` | enum('VALIDATE','TRANSCODE','CLASSIFY','SHOTS','DETECT','TRACK','IDENTIFY','EVENTS','TACTICS','INDEX','QUALITY','FINISH') | NO |  | UNI |  |
| 3 | `ui_surface` | enum('UPLOAD_PIPELINE','PROCESSING_PIPELINE','BOTH','INTERNAL') | NO |  |  |  |
| 4 | `ui_order` | tinyint unsigned | NO |  |  |  |
| 5 | `label` | varchar(40) | NO |  |  | e.g. "AI Detection", "Identity Resolution" |
| 6 | `description` | varchar(160) | NO |  |  | Stage card two-line description |
| 7 | `timeline_color_hex` | char(7) | YES |  |  | 03 Processing Timeline legend colour |
| 8 | `weight` | decimal(5,2) | NO | 1.00 |  | Contribution to overall progress |

Indexes: UNIQUE `PRIMARY`(code); UNIQUE `uq_psd_step`(engine_step)

### pipeline_step_segments

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | bigint unsigned | NO | auto_increment | PRI |  |
| 2 | `step_id` | char(36) | NO |  | MUL |  |
| 3 | `lane` | tinyint unsigned | NO | 1 |  |  |
| 4 | `from_pts_us` | bigint unsigned | NO |  |  |  |
| 5 | `to_pts_us` | bigint unsigned | NO |  |  |  |
| 6 | `state` | enum('DONE','ACTIVE','PENDING','FAILED') | NO |  |  |  |

Foreign keys: `step_id` → `pipeline_steps(id)` CASCADE

Indexes: `ix_pss_step`(step_id,lane,from_pts_us); UNIQUE `PRIMARY`(id)

Checks: `ck_pss_range`: (`to_pts_us` > `from_pts_us`)

### pipeline_steps

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `run_id` | char(36) | NO |  | MUL |  |
| 4 | `stage_code` | varchar(24) | NO |  | MUL |  |
| 5 | `status` | enum('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') | NO | QUEUED |  | Pills: Completed / Processing / In Queue / Waiting |
| 6 | `attempt` | smallint unsigned | NO | 0 |  |  |
| 7 | `progress` | decimal(5,2) | NO | 0.00 |  |  |
| 8 | `frame_from` | bigint unsigned | YES |  |  | Processing Timeline segment start |
| 9 | `frame_to` | bigint unsigned | YES |  |  |  |
| 10 | `model_version_id` | char(36) | YES |  | MUL |  |
| 11 | `output_asset_id` | char(36) | YES |  | MUL |  |
| 12 | `error_code` | varchar(64) | YES |  |  |  |
| 13 | `started_at` | datetime(6) | YES |  |  |  |
| 14 | `completed_at` | datetime(6) | YES |  |  |  |

Foreign keys: `output_asset_id` → `assets(id)` NO ACTION; `model_version_id` → `model_versions(id)` NO ACTION; `organization_id,run_id` → `pipeline_runs(organization_id,id)` CASCADE; `stage_code` → `pipeline_stage_definitions(code)` NO ACTION

Indexes: `fk_steps_asset`(output_asset_id); `fk_steps_model`(model_version_id); `fk_steps_stage`(stage_code); `ix_steps_org`(organization_id,run_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_steps_run_stage`(run_id,stage_code)

Checks: `ck_steps_progress`: (`progress` between 0 and 100); `ck_steps_done`: ((`status` <> _utf8mb4\\'SUCCEEDED\\') or (`progress` = 100))

### pitch_calibrations

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  |  |  |
| 4 | `shot_id` | char(36) | YES |  | MUL |  |
| 5 | `start_pts_us` | bigint unsigned | NO |  |  |  |
| 6 | `end_pts_us` | bigint unsigned | NO |  |  |  |
| 7 | `homography` | json | NO |  |  | 3x3 row-major |
| 8 | `pitch_length_m` | decimal(5,1) | YES |  |  |  |
| 9 | `pitch_width_m` | decimal(5,1) | YES |  |  |  |
| 10 | `reprojection_error_px` | decimal(8,3) | YES |  |  |  |
| 11 | `quality_score` | decimal(5,4) | YES |  |  |  |
| 12 | `passes_gate` | tinyint(1) | NO | 0 |  | Metric in metres allowed only when TRUE |
| 13 | `evidence_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO | INFERRED |  |  |
| 14 | `model_version_id` | char(36) | YES |  | MUL |  |

Foreign keys: `model_version_id` → `model_versions(id)` NO ACTION; `shot_id` → `video_shots(id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` CASCADE

Indexes: `fk_pc_model`(model_version_id); `fk_pc_shot`(shot_id); `ix_pc_video`(organization_id,video_id,start_pts_us); UNIQUE `PRIMARY`(id)

Checks: `ck_pc_range`: (`end_pts_us` > `start_pts_us`); `ck_pc_h`: (json_length(`homography`) = 9)

### presence_intervals

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  |  |  |
| 4 | `track_id` | char(36) | NO |  | MUL |  |
| 5 | `start_pts_us` | bigint unsigned | NO |  |  |  |
| 6 | `end_pts_us` | bigint unsigned | NO |  |  |  |
| 7 | `observation_count` | int unsigned | NO |  |  |  |

Foreign keys: `organization_id,track_id` → `tracks(organization_id,id)` CASCADE; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_pi_track`(organization_id,track_id); `ix_pi_track`(track_id,start_pts_us); `ix_pi_video`(organization_id,video_id,start_pts_us); UNIQUE `PRIMARY`(id)

Checks: `ck_pi_range`: ((`end_pts_us` > `start_pts_us`) and (`observation_count` >= 1))

### run_worker_assignments

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `run_id` | char(36) | NO |  | PRI |  |
| 2 | `worker_id` | char(36) | NO |  | PRI |  |
| 3 | `stage_code` | varchar(24) | NO |  | PRI |  |
| 4 | `assigned_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 5 | `released_at` | datetime(6) | YES |  |  |  |

Foreign keys: `run_id` → `pipeline_runs(id)` CASCADE; `stage_code` → `pipeline_stage_definitions(code)` NO ACTION; `worker_id` → `worker_nodes(id)` NO ACTION

Indexes: `fk_rwa_stage`(stage_code); `fk_rwa_worker`(worker_id); UNIQUE `PRIMARY`(run_id,worker_id,stage_code)

### track_gaps

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `track_id` | char(36) | NO |  | MUL |  |
| 3 | `start_pts_us` | bigint unsigned | NO |  |  |  |
| 4 | `end_pts_us` | bigint unsigned | NO |  |  |  |
| 5 | `gap_reason` | enum('OCCLUDED','OUT_OF_FRAME','CAMERA_CUT','DETECTION_FAILURE','UNKNOWN') | NO |  |  |  |

Foreign keys: `track_id` → `tracks(id)` CASCADE

Indexes: `ix_tg_track`(track_id,start_pts_us); UNIQUE `PRIMARY`(id)

Checks: `ck_tg_range`: (`end_pts_us` > `start_pts_us`)

### track_identity_candidates

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `track_id` | char(36) | NO |  | MUL |  |
| 4 | `player_id` | char(36) | NO |  | MUL |  |
| 5 | `match_id` | char(36) | YES |  |  |  |
| 6 | `score` | decimal(5,4) | NO |  |  | 04 "Conf." column (identity task only) |
| 7 | `rank_no` | tinyint unsigned | NO |  |  |  |
| 8 | `evidence` | json | NO | json_object() DEFAULT_GENERATED |  | {ocrFrames:[], appearanceScore, kitScore, rosterMatch} |
| 9 | `model_version_id` | char(36) | NO |  | MUL |  |
| 10 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,match_id` → `matches(organization_id,id)` NO ACTION; `model_version_id` → `model_versions(id)` NO ACTION; `player_id` → `players(id)` NO ACTION; `organization_id,track_id` → `tracks(organization_id,id)` CASCADE

Indexes: `fk_tic_match`(organization_id,match_id); `fk_tic_model`(model_version_id); `fk_tic_player`(player_id); `ix_tic_rank`(organization_id,track_id,rank_no); UNIQUE `PRIMARY`(id); UNIQUE `uq_tic`(track_id,player_id,model_version_id)

Checks: `ck_tic_score`: (`score` between 0 and 1)

### track_identity_decisions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `track_id` | char(36) | NO |  |  |  |
| 4 | `player_id` | char(36) | YES |  | MUL |  |
| 5 | `state` | enum('UNRESOLVED','CANDIDATE','CONFIRMED','REJECTED','CONFLICT') | NO |  |  |  |
| 6 | `basis` | enum('HUMAN','AUTO_POLICY','REGISTRY') | NO |  |  |  |
| 7 | `policy_version` | varchar(40) | YES |  |  | Required for AUTO_POLICY confirmations |
| 8 | `decided_by` | char(36) | YES |  | MUL |  |
| 9 | `evidence_id` | char(36) | YES |  |  |  |
| 10 | `supersedes_id` | char(36) | YES |  | UNI |  |
| 11 | `valid_from_pts_us` | bigint unsigned | YES |  |  | Partial-track decisions (ID switch handling) |
| 12 | `valid_to_pts_us` | bigint unsigned | YES |  |  |  |
| 13 | `reason` | varchar(500) | YES |  |  |  |
| 14 | `decided_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,evidence_id` → `evidence_records(organization_id,id)` NO ACTION; `player_id` → `players(id)` NO ACTION; `organization_id,supersedes_id` → `track_identity_decisions(organization_id,id)` NO ACTION; `organization_id,track_id` → `tracks(organization_id,id)` NO ACTION; `decided_by` → `users(id)` NO ACTION

Indexes: `fk_tid_evid`(organization_id,evidence_id); `fk_tid_player`(player_id); `fk_tid_super`(organization_id,supersedes_id); `fk_tid_user`(decided_by); `ix_tid_track`(organization_id,track_id,decided_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_tid_org_id`(organization_id,id); UNIQUE `uq_tid_supersedes`(supersedes_id)

Checks: `ck_tid_player`: ((`state` not in (_utf8mb4\\'CONFIRMED\\',_utf8mb4\\'CANDIDATE\\')) or (`player_id` is not null)); `ck_tid_human`: ((`basis` <> _utf8mb4\\'HUMAN\\') or (`decided_by` is not null)); `ck_tid_policy`: ((`basis` <> _utf8mb4\\'AUTO_POLICY\\') or (`policy_version` is not null)); `ck_tid_range`: ((`valid_to_pts_us` is null) or (`valid_from_pts_us` is null) or (`valid_to_pts_us` > `valid_from_pts_us`))

### track_observations

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `video_id` | char(36) | NO |  | PRI |  |
| 2 | `frame_index` | int unsigned | NO |  | PRI |  |
| 3 | `track_id` | char(36) | NO |  | PRI |  |
| 4 | `pts_us` | bigint unsigned | NO |  |  |  |
| 5 | `bbox_x` | float | NO |  |  |  |
| 6 | `bbox_y` | float | NO |  |  |  |
| 7 | `bbox_w` | float | NO |  |  |  |
| 8 | `bbox_h` | float | NO |  |  |  |
| 9 | `pitch_x_m` | float | YES |  |  | Only when a calibration passed the quality gate |
| 10 | `pitch_y_m` | float | YES |  |  |  |
| 11 | `detector_confidence` | float | YES |  |  |  |
| 12 | `association_confidence` | float | YES |  |  |  |
| 13 | `observation_state` | enum('DETECTED','PREDICTED','INTERPOLATED','REVIEWED') | NO |  |  |  |

Indexes: `ix_obs_pts`(video_id,pts_us); `ix_obs_track_pts`(video_id,track_id,pts_us); UNIQUE `PRIMARY`(video_id,frame_index,track_id)

Checks: `ck_obs_bbox`: ((`bbox_x` between 0 and 1) and (`bbox_y` between 0 and 1) and (`bbox_w` > 0) and (`bbox_h` > 0) and ((`bbox_x` + `bbox_w`) <= 1.00001) and ((`bbox_y` + `bbox_h`) <= 1.00001))

### track_segments

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `track_id` | char(36) | NO |  | MUL |  |
| 3 | `shot_id` | char(36) | YES |  | MUL |  |
| 4 | `start_pts_us` | bigint unsigned | NO |  |  |  |
| 5 | `end_pts_us` | bigint unsigned | NO |  |  |  |
| 6 | `observation_asset_id` | char(36) | NO |  | MUL |  |
| 7 | `interpolation_policy` | enum('NONE','SHORT_GAP_LINEAR','KALMAN','REVIEWED') | NO | NONE |  |  |
| 8 | `gap_count` | int unsigned | NO | 0 |  |  |
| 9 | `quality_score` | decimal(5,4) | YES |  |  |  |

Foreign keys: `observation_asset_id` → `assets(id)` NO ACTION; `shot_id` → `video_shots(id)` NO ACTION; `track_id` → `tracks(id)` CASCADE

Indexes: `fk_ts_asset`(observation_asset_id); `fk_ts_shot`(shot_id); `ix_ts_track`(track_id,start_pts_us); UNIQUE `PRIMARY`(id)

Checks: `ck_ts_range`: (`end_pts_us` > `start_pts_us`)

### tracks

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `run_id` | char(36) | NO |  | MUL |  |
| 4 | `video_id` | char(36) | NO |  |  |  |
| 5 | `internal_track_number` | int unsigned | NO |  |  | Anonymous visual id; NEVER shown as a player id |
| 6 | `class_name` | enum('PLAYER','GOALKEEPER','REFEREE','BALL','OTHER') | NO |  |  |  |
| 7 | `team_side` | enum('HOME','AWAY','NEUTRAL','UNKNOWN') | NO | UNKNOWN |  | Box colour cyan/amber |
| 8 | `team_side_confidence` | decimal(5,4) | YES |  |  |  |
| 9 | `ocr_jersey_number` | tinyint unsigned | YES |  |  | Number tag on boxes (OCR evidence only) |
| 10 | `ocr_jersey_confidence` | decimal(5,4) | YES |  |  |  |
| 11 | `first_pts_us` | bigint unsigned | NO |  |  |  |
| 12 | `last_pts_us` | bigint unsigned | NO |  |  |  |
| 13 | `observed_frames` | int unsigned | NO | 0 |  |  |
| 14 | `status` | enum('ACTIVE','OCCLUDED','LEFT_FRAME','ENDED','REVIEW_REQUIRED') | NO | ACTIVE |  |  |
| 15 | `identity_state` | enum('UNRESOLVED','CANDIDATE','CONFIRMED','REJECTED','CONFLICT') | NO | UNRESOLVED |  |  |
| 16 | `current_player_id` | char(36) | YES |  | MUL | Denormalised from latest CONFIRMED decision (set by trigger/service only) |
| 17 | `current_decision_id` | char(36) | YES |  |  |  |
| 18 | `quality_score` | decimal(5,4) | YES |  |  |  |
| 19 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,current_decision_id` → `track_identity_decisions(organization_id,id)` NO ACTION; `current_player_id` → `players(id)` NO ACTION; `organization_id,run_id` → `pipeline_runs(organization_id,id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_tracks_decision`(organization_id,current_decision_id); `fk_tracks_player`(current_player_id); `fk_tracks_run`(organization_id,run_id); `ix_tracks_player`(organization_id,current_player_id); `ix_tracks_video_class`(organization_id,video_id,class_name,team_side); UNIQUE `PRIMARY`(id); UNIQUE `uq_tracks_number`(run_id,internal_track_number); UNIQUE `uq_tracks_org_id`(organization_id,id)

Checks: `ck_tracks_identity`: ((`identity_state` = _utf8mb4\\'CONFIRMED\\') = (`current_player_id` is not null)); `ck_tracks_ocr`: ((`ocr_jersey_number` is null) or (`ocr_jersey_number` <= 99)); `ck_tracks_range`: (`last_pts_us` >= `first_pts_us`)

### worker_nodes

_Platform-level (not tenant). Exposed to tenants only as aggregated, non-identifying figures_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `hostname` | varchar(255) | NO |  | UNI |  |
| 3 | `pool` | enum('CV_GPU','RENDER_GPU','CPU','ASR') | NO |  |  |  |
| 4 | `gpu_model` | varchar(80) | YES |  |  | System Resources GPU caption, e.g. "NVIDIA A100" |
| 5 | `gpu_count` | tinyint unsigned | NO | 0 |  |  |
| 6 | `gpu_memory_bytes` | bigint unsigned | YES |  |  |  |
| 7 | `cpu_cores` | smallint unsigned | NO |  |  | "32 Cores" |
| 8 | `memory_bytes` | bigint unsigned | NO |  |  |  |
| 9 | `storage_bytes_total` | bigint unsigned | YES |  |  |  |
| 10 | `status` | enum('ONLINE','DRAINING','OFFLINE') | NO | ONLINE |  |  |
| 11 | `last_heartbeat_at` | datetime(6) | YES |  |  |  |

Indexes: UNIQUE `PRIMARY`(id); UNIQUE `uq_worker_host`(hostname)

### worker_resource_samples

_03 System Resources rings + 14-bar sparklines; retain 24h (retention job)_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `worker_id` | char(36) | NO |  | PRI |  |
| 2 | `sampled_at` | datetime(6) | NO |  | PRI |  |
| 3 | `gpu_util_pct` | decimal(5,2) | YES |  |  |  |
| 4 | `cpu_util_pct` | decimal(5,2) | YES |  |  |  |
| 5 | `memory_used_bytes` | bigint unsigned | YES |  |  |  |
| 6 | `storage_used_bytes` | bigint unsigned | YES |  |  |  |

Foreign keys: `worker_id` → `worker_nodes(id)` CASCADE

Indexes: UNIQUE `PRIMARY`(worker_id,sampled_at)


---
## Module 006_events_metrics_tactics

### cohort_metric_baselines

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `cohort_id` | char(36) | NO |  | PRI |  |
| 2 | `metric_key` | varchar(48) | NO |  | PRI |  |
| 3 | `mean_per90` | double | YES |  |  | "Midfielders Avg." bar |
| 4 | `p50_per90` | double | YES |  |  |  |
| 5 | `p90_per90` | double | YES |  |  |  |
| 6 | `sample_count` | int unsigned | NO |  |  |  |
| 7 | `computed_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `cohort_id` → `metric_cohorts(id)` CASCADE; `metric_key` → `metric_definitions(metric_key)` NO ACTION

Indexes: `fk_cmb_def`(metric_key); UNIQUE `PRIMARY`(cohort_id,metric_key)

### event_candidates

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `run_id` | char(36) | NO |  |  |  |
| 4 | `video_id` | char(36) | NO |  |  |  |
| 5 | `match_id` | char(36) | YES |  |  |  |
| 6 | `event_type` | varchar(32) | NO |  | MUL |  |
| 7 | `start_pts_us` | bigint unsigned | NO |  |  |  |
| 8 | `end_pts_us` | bigint unsigned | NO |  |  |  |
| 9 | `period` | enum('FIRST_HALF','SECOND_HALF','ET_FIRST','ET_SECOND','PENALTIES') | YES |  |  |  |
| 10 | `match_clock_ms` | int unsigned | YES |  |  | Displayed "62:17" (formatted client-side) |
| 11 | `primary_track_id` | char(36) | YES |  |  |  |
| 12 | `secondary_track_id` | char(36) | YES |  |  |  |
| 13 | `primary_player_id` | char(36) | YES |  | MUL | Only when the track identity is CONFIRMED at event time |
| 14 | `secondary_player_id` | char(36) | YES |  | MUL |  |
| 15 | `team_side` | enum('HOME','AWAY','UNKNOWN') | NO | UNKNOWN |  |  |
| 16 | `outcome` | enum('SUCCESS','FAIL','UNKNOWN') | NO | UNKNOWN |  | Pass network successful/unsuccessful |
| 17 | `start_x_m` | decimal(6,2) | YES |  |  |  |
| 18 | `start_y_m` | decimal(6,2) | YES |  |  |  |
| 19 | `end_x_m` | decimal(6,2) | YES |  |  |  |
| 20 | `end_y_m` | decimal(6,2) | YES |  |  |  |
| 21 | `calibration_id` | char(36) | YES |  | MUL | Required for pitch coordinates |
| 22 | `description` | varchar(255) | YES |  |  | 08 Event Timeline description (generated from template + confirmed names) |
| 23 | `confidence` | decimal(5,4) | YES |  |  |  |
| 24 | `evidence_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO | DETECTED |  |  |
| 25 | `effective_state` | enum('PENDING','CONFIRMED','REJECTED','EDITED','NEEDS_REVIEW') | NO | PENDING |  | Projection of latest decision |
| 26 | `model_version_id` | char(36) | YES |  | MUL |  |
| 27 | `evidence_id` | char(36) | YES |  |  |  |
| 28 | `clip_asset_id` | char(36) | YES |  |  | 08 event thumbnail/play button |
| 29 | `features` | json | NO | json_object() DEFAULT_GENERATED |  |  |
| 30 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `calibration_id` → `pitch_calibrations(id)` NO ACTION; `organization_id,clip_asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id,evidence_id` → `evidence_records(organization_id,id)` NO ACTION; `organization_id,match_id` → `matches(organization_id,id)` NO ACTION; `model_version_id` → `model_versions(id)` NO ACTION; `primary_player_id` → `players(id)` NO ACTION; `secondary_player_id` → `players(id)` NO ACTION; `organization_id,run_id` → `pipeline_runs(organization_id,id)` NO ACTION; `organization_id,primary_track_id` → `tracks(organization_id,id)` NO ACTION; `organization_id,secondary_track_id` → `tracks(organization_id,id)` NO ACTION; `event_type` → `event_types(code)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_events_cal`(calibration_id); `fk_events_clip`(organization_id,clip_asset_id); `fk_events_evid`(organization_id,evidence_id); `fk_events_model`(model_version_id); `fk_events_p1`(primary_player_id); `fk_events_p2`(secondary_player_id); `fk_events_run`(organization_id,run_id); `fk_events_t1`(organization_id,primary_track_id); `fk_events_t2`(organization_id,secondary_track_id); `fk_events_type`(event_type); `ix_events_match`(organization_id,match_id,event_type); `ix_events_player`(organization_id,primary_player_id,event_type,start_pts_us); `ix_events_video_time`(organization_id,video_id,start_pts_us); `ix_events_video_type`(organization_id,video_id,event_type,effective_state); UNIQUE `PRIMARY`(id); UNIQUE `uq_events_org_id`(organization_id,id)

Checks: `ck_events_range`: (`end_pts_us` >= `start_pts_us`); `ck_events_coords`: ((`start_x_m` is null) or (`calibration_id` is not null)); `ck_events_conf`: ((`confidence` is null) or (`confidence` between 0 and 1))

### event_decisions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `event_id` | char(36) | NO |  |  |  |
| 4 | `decision` | enum('CONFIRM','REJECT','EDIT','NEEDS_REVIEW') | NO |  |  |  |
| 5 | `reviewer_id` | char(36) | NO |  | MUL |  |
| 6 | `revised_start_pts_us` | bigint unsigned | YES |  |  |  |
| 7 | `revised_end_pts_us` | bigint unsigned | YES |  |  |  |
| 8 | `revised_type` | varchar(32) | YES |  | MUL |  |
| 9 | `reason` | varchar(500) | YES |  |  |  |
| 10 | `decided_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,event_id` → `event_candidates(organization_id,id)` NO ACTION; `revised_type` → `event_types(code)` NO ACTION; `reviewer_id` → `users(id)` NO ACTION

Indexes: `fk_ed_type`(revised_type); `fk_ed_user`(reviewer_id); `ix_ed_event`(organization_id,event_id,decided_at); UNIQUE `PRIMARY`(id)

Checks: `ck_ed_edit`: ((`decision` <> _utf8mb4\\'EDIT\\') or (`revised_type` is not null) or (`revised_start_pts_us` is not null))

### event_types

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `code` | varchar(32) | NO |  | PRI | PASS_ATTEMPT, KEY_PASS, SHOT_ATTEMPT, GOAL, TACKLE ... |
| 2 | `label` | varchar(40) | NO |  |  | Event chip / timeline type label |
| 3 | `chip_group` | varchar(24) | YES |  |  | 04 chips: GOALS, PASSES, KEY_PASSES, SHOTS, TACKLES, INTERCEPTIONS, FOULS, CARDS |
| 4 | `lane_group` | varchar(24) | YES |  |  | 04 Event Types lanes: GOALS, SHOTS, KEY_PASSES, PASSES, DUELS, DEFENSIVE |
| 5 | `marker_group` | varchar(24) | YES |  |  | 03 Event Markers legend: PASS, SHOT, TACKLE, FOUL, OFFSIDE |
| 6 | `color_hex` | char(7) | NO |  |  |  |
| 7 | `icon_key` | varchar(24) | YES |  |  | 08 timeline icons person/key/tri/burst/star |
| 8 | `is_ball_event` | tinyint(1) | NO | 1 |  |  |
| 9 | `requires_review_for_confirmed` | tinyint(1) | NO | 1 |  |  |
| 10 | `ontology_version` | varchar(10) | NO | v1 |  |  |
| 11 | `sort_order` | smallint unsigned | NO |  |  |  |

Indexes: UNIQUE `PRIMARY`(code)

### heatmaps

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  |  |  |
| 4 | `subject_kind` | enum('PLAYER','TEAM') | NO |  |  |  |
| 5 | `player_id` | char(36) | YES |  | MUL |  |
| 6 | `team_side` | enum('HOME','AWAY') | YES |  |  |  |
| 7 | `heatmap_kind` | enum('POSITION','TOUCHES','TERRITORY','FINAL_THIRDS','PRESSING') | NO |  |  |  |
| 8 | `space` | enum('PITCH','IMAGE') | NO |  |  | IMAGE heatmaps must be labelled as on-screen, not pitch occupancy |
| 9 | `period` | enum('FULL','FIRST_HALF','SECOND_HALF') | NO | FULL |  |  |
| 10 | `grid_cols` | tinyint unsigned | NO | 24 |  |  |
| 11 | `grid_rows` | tinyint unsigned | NO | 16 |  |  |
| 12 | `grid_values` | json | YES |  |  | Row-major normalised densities 0..1 |
| 13 | `image_asset_id` | char(36) | YES |  |  |  |
| 14 | `coverage_ratio` | decimal(5,4) | YES |  |  |  |
| 15 | `evidence_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO |  |  |  |
| 16 | `computed_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,image_asset_id` → `assets(organization_id,id)` NO ACTION; `player_id` → `players(id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_hm_img`(organization_id,image_asset_id); `fk_hm_player`(player_id); `ix_hm_lookup`(organization_id,video_id,subject_kind,player_id,team_side,heatmap_kind,period); UNIQUE `PRIMARY`(id)

Checks: `ck_hm_subject`: (((`subject_kind` = _utf8mb4\\'PLAYER\\') and (`player_id` is not null)) or ((`subject_kind` = _utf8mb4\\'TEAM\\') and (`team_side` is not null))); `ck_hm_payload`: ((`evidence_state` = _utf8mb4\\'NOT_MEASURED\\') or (`grid_values` is not null) or (`image_asset_id` is not null)); `ck_hm_grid`: ((`grid_values` is null) or (json_length(`grid_values`) = (`grid_cols` * `grid_rows`)))

### metric_cohorts

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `owner_organization_id` | char(36) | YES |  | MUL |  |
| 3 | `name` | varchar(120) | NO |  |  | 08 select "vs. Midfielders (UCL 23/24)" / 05 "Attacking Midfielder" |
| 4 | `version` | varchar(20) | NO |  |  |  |
| 5 | `definition` | json | NO |  |  | {positions:[],competitionIds:[],seasonIds:[],minMinutes:..} |
| 6 | `sample_count` | int unsigned | YES |  |  |  |
| 7 | `minimum_sample` | int unsigned | NO | 10 |  |  |
| 8 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `owner_organization_id` → `organizations(id)` NO ACTION

Indexes: `fk_mc_owner`(owner_organization_id); UNIQUE `PRIMARY`(id)

### metric_definitions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `metric_key` | varchar(48) | NO |  | PRI | distance_m, top_speed_kmh, sprints, passes, pass_accuracy_pct ... |
| 2 | `label` | varchar(60) | NO |  |  | KPI tile / table label |
| 3 | `unit` | varchar(16) | NO |  |  | km, km/h, %, count, m, xG ... |
| 4 | `display_decimals` | tinyint unsigned | NO | 0 |  |  |
| 5 | `aggregation` | enum('SUM','AVG','MAX','MIN','RATIO','LAST','MODEL') | NO |  |  |  |
| 6 | `subject_kind` | enum('PLAYER','TEAM','MATCH','BALL','WORKSPACE') | NO |  |  |  |
| 7 | `measurement_class` | enum('PIXEL','PITCH_CALIBRATED','OBSERVED_EVENT','MODEL_ESTIMATE','HUMAN_REVIEW','OPERATIONAL') | NO |  |  |  |
| 8 | `requires_calibration` | tinyint(1) | NO | 0 |  |  |
| 9 | `minimum_quality` | decimal(5,4) | NO | 0.0000 |  |  |
| 10 | `higher_is_better` | tinyint(1) | YES |  |  |  |
| 11 | `per90_supported` | tinyint(1) | NO | 0 |  |  |
| 12 | `formula_version` | varchar(20) | NO |  |  |  |
| 13 | `description` | varchar(500) | NO |  |  | Tooltip / report footnote |

Indexes: UNIQUE `PRIMARY`(metric_key)

### metric_values

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | YES |  |  |  |
| 4 | `match_id` | char(36) | YES |  |  |  |
| 5 | `run_id` | char(36) | YES |  |  |  |
| 6 | `subject_kind` | enum('PLAYER','TEAM','MATCH','BALL','WORKSPACE') | NO |  |  |  |
| 7 | `player_id` | char(36) | YES |  | MUL |  |
| 8 | `track_id` | char(36) | YES |  |  |  |
| 9 | `team_side` | enum('HOME','AWAY') | YES |  |  |  |
| 10 | `metric_key` | varchar(48) | NO |  | MUL |  |
| 11 | `window_kind` | enum('FULL','PERIOD','RANGE','PHASE','ROLLING') | NO | FULL |  |  |
| 12 | `period` | enum('FIRST_HALF','SECOND_HALF','ET_FIRST','ET_SECOND') | YES |  |  |  |
| 13 | `phase` | enum('ALL','IN_POSSESSION','OUT_OF_POSSESSION','TRANSITION','SET_PIECE') | NO | ALL |  |  |
| 14 | `start_pts_us` | bigint unsigned | YES |  |  |  |
| 15 | `end_pts_us` | bigint unsigned | YES |  |  |  |
| 16 | `value_numeric` | double | YES |  |  |  |
| 17 | `value_per90` | double | YES |  |  |  |
| 18 | `uncertainty` | double | YES |  |  | ± in metric unit |
| 19 | `coverage_ratio` | decimal(5,4) | YES |  |  | Observed share of window (e.g. "92% of match") |
| 20 | `baseline_value` | double | YES |  |  | Delta source for "↑ +8%"; NULL => no delta shown |
| 21 | `baseline_ref` | varchar(80) | YES |  |  | e.g. season_avg:2024/2025, cohort:<id> |
| 22 | `evidence_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO |  |  |  |
| 23 | `evidence_id` | char(36) | YES |  |  |  |
| 24 | `quality_score` | decimal(5,4) | YES |  |  |  |
| 25 | `model_version_id` | char(36) | YES |  | MUL |  |
| 26 | `computed_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 27 | `is_current` | tinyint(1) | NO | 1 |  | Previous versions kept, flagged FALSE on recompute |
| 28 | `scope_key` | varchar(220) | YES | STORED GENERATED |  |  |

Foreign keys: `metric_key` → `metric_definitions(metric_key)` NO ACTION; `organization_id,evidence_id` → `evidence_records(organization_id,id)` NO ACTION; `organization_id,match_id` → `matches(organization_id,id)` NO ACTION; `model_version_id` → `model_versions(id)` NO ACTION; `player_id` → `players(id)` NO ACTION; `organization_id,run_id` → `pipeline_runs(organization_id,id)` NO ACTION; `organization_id,track_id` → `tracks(organization_id,id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_mv_def`(metric_key); `fk_mv_evid`(organization_id,evidence_id); `fk_mv_match`(organization_id,match_id); `fk_mv_model`(model_version_id); `fk_mv_player`(player_id); `fk_mv_run`(organization_id,run_id); `fk_mv_track`(organization_id,track_id); `ix_mv_player`(organization_id,player_id,metric_key,is_current,computed_at); `ix_mv_scope`(organization_id,scope_key,is_current); `ix_mv_video`(organization_id,video_id,subject_kind,metric_key,is_current); UNIQUE `PRIMARY`(id)

Checks: `ck_mv_not_measured`: ((`evidence_state` <> _utf8mb4\\'NOT_MEASURED\\') or ((`value_numeric` is null) and (`value_per90` is null))); `ck_mv_measured`: ((`evidence_state` = _utf8mb4\\'NOT_MEASURED\\') or (`value_numeric` is not null)); `ck_mv_subject`: ((`subject_kind` <> _utf8mb4\\'PLAYER\\') or (`player_id` is not null) or (`track_id` is not null)); `ck_mv_range`: ((`end_pts_us` is null) or (`start_pts_us` is null) or (`end_pts_us` > `start_pts_us`)); `ck_mv_cov`: ((`coverage_ratio` is null) or (`coverage_ratio` between 0 and 1))

### movement_segments

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  |  |  |
| 4 | `track_id` | char(36) | NO |  |  |  |
| 5 | `player_id` | char(36) | YES |  | MUL |  |
| 6 | `start_pts_us` | bigint unsigned | NO |  |  |  |
| 7 | `end_pts_us` | bigint unsigned | NO |  |  |  |
| 8 | `movement_kind` | enum('OFF_BALL_RUN','LEADING_RUN','SUPPORTING_RUN','PROGRESSIVE_RUN','RUN_INTO_BOX','SPRINT','CARRY','PRESS') | NO |  |  |  |
| 9 | `path_norm` | json | YES |  |  | [[x,y],...] normalised pitch coords for drawing |
| 10 | `distance_m` | decimal(6,2) | YES |  |  |  |
| 11 | `calibration_id` | char(36) | YES |  | MUL |  |
| 12 | `confidence` | decimal(5,4) | YES |  |  |  |
| 13 | `evidence_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO |  |  |  |

Foreign keys: `calibration_id` → `pitch_calibrations(id)` NO ACTION; `player_id` → `players(id)` NO ACTION; `organization_id,track_id` → `tracks(organization_id,id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_ms_cal`(calibration_id); `fk_ms_player`(player_id); `fk_ms_track`(organization_id,track_id); `ix_ms_player`(organization_id,video_id,player_id,movement_kind,start_pts_us); UNIQUE `PRIMARY`(id)

Checks: `ck_ms_range`: (`end_pts_us` > `start_pts_us`); `ck_ms_metres`: ((`distance_m` is null) or (`calibration_id` is not null))

### pass_network_edges

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `network_id` | char(36) | NO |  | PRI |  |
| 2 | `from_node_key` | varchar(40) | NO |  | PRI |  |
| 3 | `to_node_key` | varchar(40) | NO |  | PRI |  |
| 4 | `pass_count` | smallint unsigned | NO |  |  |  |
| 5 | `successful_count` | smallint unsigned | NO |  |  |  |

Foreign keys: `network_id,from_node_key` → `pass_network_nodes(network_id,node_key)` CASCADE; `network_id,to_node_key` → `pass_network_nodes(network_id,node_key)` CASCADE

Indexes: `fk_pne_to`(network_id,to_node_key); UNIQUE `PRIMARY`(network_id,from_node_key,to_node_key)

Checks: `ck_pne`: ((`successful_count` <= `pass_count`) and (`pass_count` > 0) and (`from_node_key` <> `to_node_key`))

### pass_network_nodes

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `network_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `node_key` | varchar(40) | NO |  | PRI | player id or "UNKNOWN:<track>" |
| 4 | `player_id` | char(36) | YES |  | MUL |  |
| 5 | `track_id` | char(36) | YES |  |  |  |
| 6 | `avg_x_norm` | decimal(6,5) | NO |  |  |  |
| 7 | `avg_y_norm` | decimal(6,5) | NO |  |  |  |
| 8 | `touches` | int unsigned | NO | 0 |  |  |

Foreign keys: `organization_id,network_id` → `pass_networks(organization_id,id)` CASCADE; `player_id` → `players(id)` NO ACTION

Indexes: `fk_pnn_net`(organization_id,network_id); `fk_pnn_player`(player_id); UNIQUE `PRIMARY`(network_id,node_key)

### pass_networks

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  |  |  |
| 4 | `team_side` | enum('HOME','AWAY') | NO |  |  |  |
| 5 | `from_pts_us` | bigint unsigned | NO |  |  |  |
| 6 | `to_pts_us` | bigint unsigned | NO |  |  |  |
| 7 | `min_event_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO | INFERRED |  | Lowest evidence admitted into the network |
| 8 | `computed_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `ix_pn_lookup`(organization_id,video_id,team_side,from_pts_us,to_pts_us); UNIQUE `PRIMARY`(id); UNIQUE `uq_pn_org_id`(organization_id,id)

Checks: `ck_pn_range`: (`to_pts_us` > `from_pts_us`)

### possession_episodes

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  |  |  |
| 4 | `run_id` | char(36) | NO |  |  |  |
| 5 | `team_side` | enum('HOME','AWAY','UNKNOWN') | NO |  |  |  |
| 6 | `player_id` | char(36) | YES |  | MUL |  |
| 7 | `start_pts_us` | bigint unsigned | NO |  |  |  |
| 8 | `end_pts_us` | bigint unsigned | NO |  |  |  |
| 9 | `confidence` | decimal(5,4) | YES |  |  |  |
| 10 | `evidence_id` | char(36) | YES |  |  |  |

Foreign keys: `player_id` → `players(id)` NO ACTION; `organization_id,run_id` → `pipeline_runs(organization_id,id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_pe_player`(player_id); `fk_pe_run`(organization_id,run_id); `ix_pe_video`(organization_id,video_id,start_pts_us); UNIQUE `PRIMARY`(id)

Checks: `ck_pe_range`: (`end_pts_us` > `start_pts_us`)

### tactical_windows

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  |  |  |
| 4 | `run_id` | char(36) | NO |  |  |  |
| 5 | `kind` | enum('PRESSING','BUILD_UP','TRANSITION','SET_PIECE','DEFENSIVE_BLOCK') | NO |  |  |  |
| 6 | `team_side` | enum('HOME','AWAY') | NO |  |  |  |
| 7 | `from_pts_us` | bigint unsigned | NO |  |  |  |
| 8 | `to_pts_us` | bigint unsigned | NO |  |  |  |
| 9 | `coverage_ratio` | decimal(5,4) | NO |  |  |  |
| 10 | `metrics` | json | NO |  |  | e.g. PPDA, regains, press height for 05 Pressing Map |
| 11 | `evidence_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO |  |  |  |
| 12 | `evidence_id` | char(36) | YES |  |  |  |

Foreign keys: `organization_id,run_id` → `pipeline_runs(organization_id,id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_tw_run`(organization_id,run_id); `ix_tw`(organization_id,video_id,kind,team_side,from_pts_us); UNIQUE `PRIMARY`(id)

Checks: `ck_tw_range`: ((`to_pts_us` > `from_pts_us`) and (`coverage_ratio` between 0 and 1))

### team_shape_nodes

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `snapshot_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `slot_no` | tinyint unsigned | NO |  | PRI |  |
| 4 | `track_id` | char(36) | YES |  |  |  |
| 5 | `player_id` | char(36) | YES |  | MUL | Node label shown only when identity CONFIRMED |
| 6 | `avg_x_norm` | decimal(6,5) | NO |  |  | 0..1 pitch length (attacking direction normalised) |
| 7 | `avg_y_norm` | decimal(6,5) | NO |  |  |  |
| 8 | `role_line` | enum('GK','DEF','MID','FWD') | YES |  |  |  |

Foreign keys: `player_id` → `players(id)` NO ACTION; `organization_id,snapshot_id` → `team_shape_snapshots(organization_id,id)` CASCADE; `organization_id,track_id` → `tracks(organization_id,id)` NO ACTION

Indexes: `fk_tsn_player`(player_id); `fk_tsn_snap`(organization_id,snapshot_id); `fk_tsn_track`(organization_id,track_id); UNIQUE `PRIMARY`(snapshot_id,slot_no)

Checks: `ck_tsn_xy`: ((`avg_x_norm` between 0 and 1) and (`avg_y_norm` between 0 and 1))

### team_shape_snapshots

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `video_id` | char(36) | NO |  |  |  |
| 4 | `run_id` | char(36) | NO |  |  |  |
| 5 | `team_side` | enum('HOME','AWAY') | NO |  |  |  |
| 6 | `phase` | enum('ALL','IN_POSSESSION','OUT_OF_POSSESSION','TRANSITION','SET_PIECE') | NO |  |  |  |
| 7 | `from_pts_us` | bigint unsigned | NO |  |  |  |
| 8 | `to_pts_us` | bigint unsigned | NO |  |  |  |
| 9 | `formation_code` | varchar(12) | YES |  |  | 4-3-3 / 4-2-3-1 / 4-4-2 |
| 10 | `formation_confidence` | decimal(5,4) | YES |  |  |  |
| 11 | `avg_width_m` | decimal(5,2) | YES |  |  |  |
| 12 | `avg_length_m` | decimal(5,2) | YES |  |  |  |
| 13 | `def_line_height_m` | decimal(5,2) | YES |  |  |  |
| 14 | `compactness_m` | decimal(5,2) | YES |  |  |  |
| 15 | `shape_variability` | enum('LOW','MEDIUM','HIGH') | YES |  |  |  |
| 16 | `variability_series` | json | YES |  |  | Sparkline points |
| 17 | `stability_pct` | decimal(5,2) | YES |  |  | Formation Stability |
| 18 | `visible_players` | tinyint unsigned | NO |  |  | Shape is partial when < 10 |
| 19 | `calibration_id` | char(36) | YES |  | MUL |  |
| 20 | `evidence_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO |  |  |  |

Foreign keys: `calibration_id` → `pitch_calibrations(id)` NO ACTION; `organization_id,run_id` → `pipeline_runs(organization_id,id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_tss_cal`(calibration_id); `fk_tss_run`(organization_id,run_id); `ix_tss_lookup`(organization_id,video_id,team_side,phase,from_pts_us); UNIQUE `PRIMARY`(id); UNIQUE `uq_tss_org_id`(organization_id,id)

Checks: `ck_tss_range`: (`to_pts_us` > `from_pts_us`); `ck_tss_metres`: ((`avg_width_m` is null) or (`calibration_id` is not null)); `ck_tss_nm`: ((`evidence_state` <> _utf8mb4\\'NOT_MEASURED\\') or ((`formation_code` is null) and (`avg_width_m` is null)))


---
## Module 007_reels_spotlight_studio

### brand_kits

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `name` | varchar(100) | NO |  |  | 10 Branded Overlays logo select ("OTSI VIE") |
| 4 | `logo_asset_id` | char(36) | YES |  |  |  |
| 5 | `watermark_asset_id` | char(36) | YES |  |  |  |
| 6 | `intro_asset_id` | char(36) | YES |  |  |  |
| 7 | `outro_asset_id` | char(36) | YES |  |  | "End Screen" / Custom Intro/Outro |
| 8 | `primary_color_hex` | char(7) | YES |  |  |  |
| 9 | `font_asset_id` | char(36) | YES |  |  |  |
| 10 | `is_default` | tinyint(1) | NO | 0 |  |  |
| 11 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,font_asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id,intro_asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id,logo_asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id` → `organizations(id)` NO ACTION; `organization_id,outro_asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id,watermark_asset_id` → `assets(organization_id,id)` NO ACTION

Indexes: `fk_bk_font`(organization_id,font_asset_id); `fk_bk_intro`(organization_id,intro_asset_id); `fk_bk_logo`(organization_id,logo_asset_id); `fk_bk_outro`(organization_id,outro_asset_id); `fk_bk_wm`(organization_id,watermark_asset_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_brand_kits_name`(organization_id,name); UNIQUE `uq_brand_kits_org_id`(organization_id,id)

### caption_cues

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `timeline_item_id` | char(36) | NO |  | MUL |  |
| 3 | `start_us` | bigint unsigned | NO |  |  |  |
| 4 | `end_us` | bigint unsigned | NO |  |  |  |
| 5 | `text` | varchar(500) | NO |  |  |  |
| 6 | `language` | varchar(16) | NO | en |  |  |
| 7 | `source` | enum('MANUAL','AUTO_ASR','AUTO_TEMPLATE') | NO |  |  |  |

Foreign keys: `timeline_item_id` → `timeline_items(id)` CASCADE

Indexes: `ix_cc_item`(timeline_item_id,start_us); UNIQUE `PRIMARY`(id)

Checks: `ck_cc_range`: (`end_us` > `start_us`)

### effect_keyframes

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `timeline_item_id` | char(36) | NO |  | MUL |  |
| 3 | `time_offset_us` | bigint unsigned | NO |  |  |  |
| 4 | `property_name` | varchar(48) | NO |  |  |  |
| 5 | `value` | json | NO |  |  |  |
| 6 | `interpolation` | enum('HOLD','LINEAR','EASE_IN_OUT') | NO | LINEAR |  |  |

Foreign keys: `timeline_item_id` → `timeline_items(id)` CASCADE

Indexes: UNIQUE `PRIMARY`(id); UNIQUE `uq_ek`(timeline_item_id,time_offset_us,property_name)

### effect_presets

_Transitions Fade/Zoom/Spin/Dissolve; graphics Spotlight Circle/Pass Trajectory/Player Highlight/Team Logo ..._

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `owner_organization_id` | char(36) | YES |  | MUL |  |
| 3 | `name` | varchar(100) | NO |  |  |  |
| 4 | `effect_family` | enum('SPOTLIGHT','TRANSITION','GRAPHIC','LOWER_THIRD','STAT_CARD','CAPTION_STYLE','COLOR','SPEED','TRANSFORM') | NO |  |  |  |
| 5 | `version` | varchar(20) | NO |  |  |  |
| 6 | `schema_version` | varchar(20) | NO |  |  |  |
| 7 | `config` | json | NO |  |  |  |
| 8 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 9 | `owner_key` | char(36) | YES | STORED GENERATED | MUL |  |

Foreign keys: `owner_organization_id` → `organizations(id)` NO ACTION

Indexes: `fk_ep_owner`(owner_organization_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_effect_presets`(owner_key,name,version)

### media_clip_tags

_Inspector Tags chips (Pass / Progressive / Build-up) + "+" add_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `clip_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `tag_id` | char(36) | NO |  | PRI |  |

Foreign keys: `organization_id,clip_id` → `media_clips(organization_id,id)` CASCADE; `organization_id,tag_id` → `tags(organization_id,id)` CASCADE

Indexes: `fk_mct_clip`(organization_id,clip_id); `fk_mct_tag`(organization_id,tag_id); UNIQUE `PRIMARY`(clip_id,tag_id)

### media_clips

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `folder_id` | char(36) | YES |  |  | Media Bin breadcrumb location |
| 4 | `source_video_id` | char(36) | NO |  |  |  |
| 5 | `in_pts_us` | bigint unsigned | NO |  |  |  |
| 6 | `out_pts_us` | bigint unsigned | NO |  |  |  |
| 7 | `duration_us` | bigint unsigned | YES | STORED GENERATED |  | Clip duration chip |
| 8 | `clip_asset_id` | char(36) | YES |  |  | Optional pre-cut file (name shown, e.g. *.mp4) |
| 9 | `thumbnail_asset_id` | char(36) | YES |  |  |  |
| 10 | `display_name` | varchar(255) | NO |  | MUL | Inspector title / timeline label |
| 11 | `player_id` | char(36) | YES |  | MUL | Inspector Player (confirmed only) |
| 12 | `match_id` | char(36) | YES |  |  | Inspector Match |
| 13 | `event_id` | char(36) | YES |  |  |  |
| 14 | `event_type` | varchar(32) | YES |  | MUL | Inspector Event Type |
| 15 | `match_clock_ms` | int unsigned | YES |  |  | Inspector Timestamp |
| 16 | `period` | enum('FIRST_HALF','SECOND_HALF','ET_FIRST','ET_SECOND') | YES |  |  | "(2nd Half)" |
| 17 | `notes` | varchar(2000) | YES |  |  | Inspector Notes |
| 18 | `created_by` | char(36) | NO |  | MUL |  |
| 19 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  | "Added 16 Apr 2024, 14:32" |
| 20 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |

Foreign keys: `organization_id,clip_asset_id` → `assets(organization_id,id)` NO ACTION; `event_type` → `event_types(code)` NO ACTION; `organization_id,event_id` → `event_candidates(organization_id,id)` NO ACTION; `organization_id,folder_id` → `folders(organization_id,id)` NO ACTION; `organization_id,match_id` → `matches(organization_id,id)` NO ACTION; `player_id` → `players(id)` NO ACTION; `organization_id,thumbnail_asset_id` → `assets(organization_id,id)` NO ACTION; `created_by` → `users(id)` NO ACTION; `organization_id,source_video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_mc_asset`(organization_id,clip_asset_id); `fk_mc_etype`(event_type); `fk_mc_event`(organization_id,event_id); `fk_mc_match`(organization_id,match_id); `fk_mc_player`(player_id); `fk_mc_thumb`(organization_id,thumbnail_asset_id); `fk_mc_user`(created_by); `fk_mc_video`(organization_id,source_video_id); FULLTEXT `ft_mc_search`(display_name,notes); `ix_mc_folder`(organization_id,folder_id,created_at); `ix_mc_player`(organization_id,player_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_media_clips_org_id`(organization_id,id)

Checks: `ck_mc_range`: (`out_pts_us` > `in_pts_us`)

### moment_suggestions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `reel_id` | char(36) | NO |  | MUL |  |
| 4 | `event_id` | char(36) | YES |  |  |  |
| 5 | `video_id` | char(36) | NO |  |  |  |
| 6 | `in_pts_us` | bigint unsigned | NO |  |  |  |
| 7 | `out_pts_us` | bigint unsigned | NO |  |  |  |
| 8 | `title` | varchar(80) | NO |  |  | Card title e.g. "Progressive Pass" |
| 9 | `rank_no` | smallint unsigned | NO |  |  | Card number badge |
| 10 | `score` | decimal(5,4) | NO |  |  |  |
| 11 | `thumbnail_asset_id` | char(36) | YES |  |  |  |
| 12 | `status` | enum('SUGGESTED','SELECTED','DISMISSED') | NO | SUGGESTED |  | Checkbox badge |
| 13 | `model_version_id` | char(36) | YES |  | MUL |  |
| 14 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,event_id` → `event_candidates(organization_id,id)` NO ACTION; `model_version_id` → `model_versions(id)` NO ACTION; `organization_id,reel_id` → `reel_projects(organization_id,id)` CASCADE; `organization_id,thumbnail_asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_mom_event`(organization_id,event_id); `fk_mom_model`(model_version_id); `fk_mom_thumb`(organization_id,thumbnail_asset_id); `fk_mom_video`(organization_id,video_id); `ix_ms_reel`(organization_id,reel_id,status,rank_no); UNIQUE `PRIMARY`(id); UNIQUE `uq_ms_rank`(reel_id,rank_no)

Checks: `ck_mom_range`: ((`out_pts_us` > `in_pts_us`) and (`score` between 0 and 1))

### music_tracks

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `owner_organization_id` | char(36) | YES |  | MUL | NULL = platform-licensed library |
| 3 | `title` | varchar(150) | NO |  |  | Music select "Epic Cinematic" |
| 4 | `mood` | varchar(40) | YES |  |  |  |
| 5 | `bpm` | smallint unsigned | YES |  |  |  |
| 6 | `duration_us` | bigint unsigned | NO |  |  |  |
| 7 | `audio_asset_id` | char(36) | NO |  | MUL |  |
| 8 | `waveform_asset_id` | char(36) | YES |  | MUL |  |
| 9 | `license_ref` | varchar(255) | NO |  |  |  |
| 10 | `allowed_uses` | json | NO | json_array(_utf8mb4\\'INTERNAL\\',_utf8mb4\\'EXPORT\\') DEFAULT_GENERATED |  |  |
| 11 | `is_active` | tinyint(1) | NO | 1 |  |  |

Foreign keys: `audio_asset_id` → `assets(id)` NO ACTION; `owner_organization_id` → `organizations(id)` NO ACTION; `waveform_asset_id` → `assets(id)` NO ACTION

Indexes: `fk_music_audio`(audio_asset_id); `fk_music_owner`(owner_organization_id); `fk_music_wave`(waveform_asset_id); UNIQUE `PRIMARY`(id)

### reel_chapters

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `reel_id` | char(36) | NO |  | MUL |  |
| 4 | `chapter_no` | smallint unsigned | NO |  |  |  |
| 5 | `title` | varchar(80) | NO |  |  | Intro, Build Up Play, Progressive Passes ... |
| 6 | `start_us` | bigint unsigned | NO |  |  |  |
| 7 | `duration_us` | bigint unsigned | NO |  |  |  |
| 8 | `thumbnail_asset_id` | char(36) | YES |  |  |  |
| 9 | `source` | enum('AUTO','MANUAL') | NO |  |  |  |

Foreign keys: `organization_id,reel_id` → `reel_projects(organization_id,id)` CASCADE; `organization_id,thumbnail_asset_id` → `assets(organization_id,id)` NO ACTION

Indexes: `fk_rch_reel`(organization_id,reel_id); `fk_rch_thumb`(organization_id,thumbnail_asset_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_rch_no`(reel_id,chapter_no)

Checks: `ck_rch_dur`: (`duration_us` > 0)

### reel_clips

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `reel_id` | char(36) | NO |  | MUL |  |
| 4 | `media_clip_id` | char(36) | YES |  |  |  |
| 5 | `moment_suggestion_id` | char(36) | YES |  | MUL |  |
| 6 | `source_video_id` | char(36) | NO |  |  |  |
| 7 | `in_pts_us` | bigint unsigned | NO |  |  |  |
| 8 | `out_pts_us` | bigint unsigned | NO |  |  |  |
| 9 | `sequence_index` | smallint unsigned | NO |  |  |  |
| 10 | `playback_speed` | decimal(6,3) | NO | 1.000 |  |  |
| 11 | `output_duration_us` | bigint unsigned | YES | STORED GENERATED |  |  |
| 12 | `source_event_id` | char(36) | YES |  |  |  |
| 13 | `review_state` | enum('PENDING','APPROVED','REJECTED','RED') | NO | PENDING |  |  |
| 14 | `target_identity_verified` | tinyint(1) | NO | 0 |  | Target CONFIRMED across [in,out]; render blocks otherwise |

Foreign keys: `organization_id,source_event_id` → `event_candidates(organization_id,id)` NO ACTION; `organization_id,media_clip_id` → `media_clips(organization_id,id)` NO ACTION; `moment_suggestion_id` → `moment_suggestions(id)` NO ACTION; `organization_id,reel_id` → `reel_projects(organization_id,id)` CASCADE; `organization_id,source_video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_rc_event`(organization_id,source_event_id); `fk_rc_mclip`(organization_id,media_clip_id); `fk_rc_moment`(moment_suggestion_id); `fk_rc_reel`(organization_id,reel_id); `fk_rc_video`(organization_id,source_video_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_reel_clips_org_id`(organization_id,id); UNIQUE `uq_reel_clips_seq`(reel_id,sequence_index)

Checks: `ck_rc_range`: (`out_pts_us` > `in_pts_us`); `ck_rc_speed`: (`playback_speed` between 0.1 and 8)

### reel_projects

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `project_id` | char(36) | NO |  |  |  |
| 4 | `video_id` | char(36) | YES |  |  | Primary source; clips may come from several videos |
| 5 | `match_id` | char(36) | YES |  |  |  |
| 6 | `reel_kind` | enum('SPOTLIGHT','HIGHLIGHTS','TACTICAL','CUSTOM') | NO | SPOTLIGHT |  |  |
| 7 | `title` | varchar(200) | NO |  |  | Reel Info Title |
| 8 | `description` | varchar(2000) | YES |  |  | Reel Info Description (optional) |
| 9 | `reel_type_label` | varchar(80) | YES |  |  | e.g. "Progressive Passes" subtitle on cards/summary |
| 10 | `wizard_step` | enum('SELECT_PLAYER','CHOOSE_MOMENTS','EDIT_STYLE','EXPORT') | NO | SELECT_PLAYER |  |  |
| 11 | `aspect_ratio` | enum('16:9','9:16','1:1','4:5') | NO | 16:9 |  |  |
| 12 | `duration_mode` | enum('AUTO_BEST','FIXED_30S','FIXED_60S','FIXED_90S','FIXED_120S','CUSTOM') | NO | AUTO_BEST |  |  |
| 13 | `target_duration_us` | bigint unsigned | YES |  |  |  |
| 14 | `music_track_id` | char(36) | YES |  | MUL |  |
| 15 | `brand_kit_id` | char(36) | YES |  |  |  |
| 16 | `status` | enum('DRAFT','REVIEW_REQUIRED','READY_TO_RENDER','RENDERING','QC','READY','PUBLISHED','BLOCKED','FAILED','ARCHIVED') | NO | DRAFT |  |  |
| 17 | `blocked_reason` | varchar(64) | YES |  |  | IDENTITY_UNRESOLVED, RIGHTS_BLOCKED ... |
| 18 | `current_revision` | int unsigned | NO | 0 |  |  |
| 19 | `sequence_duration_us` | bigint unsigned | NO | 0 |  | Total timeline length "01:28.00" |
| 20 | `created_by` | char(36) | NO |  | MUL |  |
| 21 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 22 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |
| 23 | `row_version` | bigint unsigned | NO | 1 |  |  |

Foreign keys: `organization_id,brand_kit_id` → `brand_kits(organization_id,id)` NO ACTION; `organization_id,match_id` → `matches(organization_id,id)` NO ACTION; `music_track_id` → `music_tracks(id)` NO ACTION; `organization_id,project_id` → `projects(organization_id,id)` NO ACTION; `created_by` → `users(id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_reels_brand`(organization_id,brand_kit_id); `fk_reels_match`(organization_id,match_id); `fk_reels_music`(music_track_id); `fk_reels_user`(created_by); `fk_reels_video`(organization_id,video_id); `ix_reels_org_status`(organization_id,status,updated_at); `ix_reels_project`(organization_id,project_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_reels_org_id`(organization_id,id)

Checks: `ck_reels_blocked`: ((`status` <> _utf8mb4\\'BLOCKED\\') or (`blocked_reason` is not null))

### reel_revisions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `reel_id` | char(36) | NO |  | MUL |  |
| 4 | `revision_no` | int unsigned | NO |  |  |  |
| 5 | `timeline_snapshot` | json | NO |  |  |  |
| 6 | `snapshot_sha256` | char(64) | NO |  |  |  |
| 7 | `saved_by` | char(36) | NO |  | MUL |  |
| 8 | `saved_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 9 | `note` | varchar(255) | YES |  |  |  |

Foreign keys: `organization_id,reel_id` → `reel_projects(organization_id,id)` CASCADE; `saved_by` → `users(id)` NO ACTION

Indexes: `fk_rr_reel`(organization_id,reel_id); `fk_rr_user`(saved_by); UNIQUE `PRIMARY`(id); UNIQUE `uq_rr_no`(reel_id,revision_no); UNIQUE `uq_rr_org_id`(organization_id,id)

### reel_settings_flags

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `reel_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `auto_chapters` | tinyint(1) | NO | 1 |  |  |

Foreign keys: `organization_id,reel_id` → `reel_projects(organization_id,id)` CASCADE

Indexes: `fk_rsf_reel`(organization_id,reel_id); UNIQUE `PRIMARY`(reel_id)

### reel_style_settings

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `reel_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `spotlight_intensity_pct` | tinyint unsigned | NO | 85 |  |  |
| 4 | `ray_width_pct` | tinyint unsigned | NO | 60 |  |  |
| 5 | `vignette_strength_pct` | tinyint unsigned | NO | 45 |  |  |
| 6 | `glow_amount_pct` | tinyint unsigned | NO | 55 |  |  |
| 7 | `target_lock_sensitivity_pct` | tinyint unsigned | NO | 72 |  |  |
| 8 | `auto_track_player` | tinyint(1) | NO | 1 |  |  |
| 9 | `overlay_player_info_card` | tinyint(1) | NO | 1 |  |  |
| 10 | `overlay_match_score_time` | tinyint(1) | NO | 1 |  |  |
| 11 | `overlay_competition_logo` | tinyint(1) | NO | 1 |  | Requires competitions.logo_license_ref at render |
| 12 | `overlay_lower_third` | tinyint(1) | NO | 1 |  |  |
| 13 | `use_watermark` | tinyint(1) | NO | 1 |  |  |
| 14 | `custom_logo` | tinyint(1) | NO | 0 |  |  |
| 15 | `end_screen` | tinyint(1) | NO | 1 |  |  |
| 16 | `spotlight_preset_id` | char(36) | YES |  | MUL |  |
| 17 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |

Foreign keys: `spotlight_preset_id` → `effect_presets(id)` NO ACTION; `organization_id,reel_id` → `reel_projects(organization_id,id)` CASCADE

Indexes: `fk_rss_preset`(spotlight_preset_id); `fk_rss_reel`(organization_id,reel_id); UNIQUE `PRIMARY`(reel_id)

Checks: `ck_rss_ranges`: ((`spotlight_intensity_pct` <= 100) and (`ray_width_pct` <= 100) and (`vignette_strength_pct` <= 100) and (`glow_amount_pct` <= 100) and (`target_lock_sensitivity_pct` <= 100))

### reel_targets

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `reel_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `player_id` | char(36) | NO |  | PRI | "Lock on confirmed player" — must be a canonical player |
| 4 | `primary_track_id` | char(36) | YES |  |  |  |
| 5 | `identity_decision_id` | char(36) | YES |  |  | CONFIRMED decision that authorises the lock |
| 6 | `is_primary` | tinyint(1) | NO | 1 |  |  |
| 7 | `added_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,identity_decision_id` → `track_identity_decisions(organization_id,id)` NO ACTION; `player_id` → `players(id)` NO ACTION; `organization_id,reel_id` → `reel_projects(organization_id,id)` CASCADE; `organization_id,primary_track_id` → `tracks(organization_id,id)` NO ACTION

Indexes: `fk_rt_dec`(organization_id,identity_decision_id); `fk_rt_player`(player_id); `fk_rt_reel`(organization_id,reel_id); `fk_rt_track`(organization_id,primary_track_id); UNIQUE `PRIMARY`(reel_id,player_id)

### timeline_items

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `timeline_track_id` | char(36) | NO |  | MUL |  |
| 4 | `reel_clip_id` | char(36) | YES |  |  |  |
| 5 | `item_kind` | enum('CLIP','TRANSITION','GRAPHIC','TEXT','LOWER_THIRD','CAPTION','STAT','AUDIO','SPOTLIGHT') | NO |  |  |  |
| 6 | `label` | varchar(200) | YES |  |  | Bar label e.g. "Fade", "Stat Card", "Pass Distance (7.4 km)" |
| 7 | `start_us` | bigint unsigned | NO |  |  |  |
| 8 | `duration_us` | bigint unsigned | NO |  |  |  |
| 9 | `end_us` | bigint unsigned | YES | STORED GENERATED |  |  |
| 10 | `effect_preset_id` | char(36) | YES |  | MUL |  |
| 11 | `asset_id` | char(36) | YES |  | MUL |  |
| 12 | `metric_value_id` | char(36) | YES |  | MUL | STAT items must bind to a real metric (never typed numbers) |
| 13 | `parameters` | json | NO | json_object() DEFAULT_GENERATED |  |  |

Foreign keys: `asset_id` → `assets(id)` NO ACTION; `organization_id,reel_clip_id` → `reel_clips(organization_id,id)` NO ACTION; `metric_value_id` → `metric_values(id)` NO ACTION; `effect_preset_id` → `effect_presets(id)` NO ACTION; `organization_id,timeline_track_id` → `timeline_tracks(organization_id,id)` CASCADE

Indexes: `fk_ti_asset`(asset_id); `fk_ti_clip`(organization_id,reel_clip_id); `fk_ti_metric`(metric_value_id); `fk_ti_preset`(effect_preset_id); `fk_ti_track`(organization_id,timeline_track_id); `ix_ti_track_time`(timeline_track_id,start_us); UNIQUE `PRIMARY`(id); UNIQUE `uq_ti_org_id`(organization_id,id)

Checks: `ck_ti_dur`: (`duration_us` > 0); `ck_ti_clip`: ((`item_kind` <> _utf8mb4\\'CLIP\\') or (`reel_clip_id` is not null)); `ck_ti_stat`: ((`item_kind` <> _utf8mb4\\'STAT\\') or (`metric_value_id` is not null))

### timeline_tracks

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `reel_id` | char(36) | NO |  | MUL |  |
| 4 | `track_type` | enum('VIDEO','SPOTLIGHT','TRANSITION','GRAPHICS','TEXT_OVERLAY','LOWER_THIRD','CAPTIONS','STATISTICS','SOUNDTRACK','AUDIO_FX','VOICEOVER') | NO |  |  |  |
| 5 | `label` | varchar(40) | NO |  |  | 07 track header labels; 06 "Video Clips / Spotlight Effects / Text & Overlays / Audio" |
| 6 | `layer` | tinyint unsigned | NO |  |  |  |
| 7 | `is_visible` | tinyint(1) | NO | 1 |  | Eye icon |
| 8 | `is_locked` | tinyint(1) | NO | 0 |  | Lock icon |
| 9 | `is_muted` | tinyint(1) | NO | 0 |  | Mute icon (audio tracks) |

Foreign keys: `organization_id,reel_id` → `reel_projects(organization_id,id)` CASCADE

Indexes: `fk_tt_reel`(organization_id,reel_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_tt_layer`(reel_id,layer); UNIQUE `uq_tt_org_id`(organization_id,id)


---
## Module 008_reports_scouting

### player_notes

_08 sidebar "Notes & Tags"_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `player_id` | char(36) | NO |  | MUL |  |
| 4 | `body` | varchar(4000) | NO |  |  |  |
| 5 | `visibility` | enum('PRIVATE','ORGANIZATION') | NO | ORGANIZATION |  |  |
| 6 | `author_id` | char(36) | NO |  |  |  |
| 7 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,author_id` → `memberships(organization_id,user_id)` NO ACTION; `player_id` → `players(id)` NO ACTION

Indexes: `fk_pnote_author`(organization_id,author_id); `fk_pnote_player`(player_id); `ix_pn_player`(organization_id,player_id,created_at); UNIQUE `PRIMARY`(id)

### player_role_profiles

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `player_id` | char(36) | NO |  | MUL |  |
| 4 | `report_id` | char(36) | YES |  |  |  |
| 5 | `role_title` | varchar(120) | NO |  |  | "Advanced Midfielder (Right Half-Space)" |
| 6 | `summary` | varchar(1000) | NO |  |  |  |
| 7 | `author_kind` | enum('ANALYST','AI_DRAFT') | NO |  |  |  |
| 8 | `approved_by` | char(36) | YES |  | MUL |  |
| 9 | `approved_at` | datetime(6) | YES |  |  |  |
| 10 | `created_by` | char(36) | NO |  | MUL |  |
| 11 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `approved_by` → `users(id)` NO ACTION; `player_id` → `players(id)` NO ACTION; `organization_id,report_id` → `reports(organization_id,id)` NO ACTION; `created_by` → `users(id)` NO ACTION

Indexes: `fk_prp_appr`(approved_by); `fk_prp_player`(player_id); `fk_prp_report`(organization_id,report_id); `fk_prp_user`(created_by); `ix_prp_player`(organization_id,player_id,created_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_prp_org_id`(organization_id,id)

### player_role_traits

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `profile_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `trait_label` | varchar(40) | NO |  | PRI | Chips: Playmaker, Chance Creator ... |
| 4 | `display_order` | tinyint unsigned | NO |  |  |  |

Foreign keys: `organization_id,profile_id` → `player_role_profiles(organization_id,id)` CASCADE

Indexes: `fk_prt_profile`(organization_id,profile_id); UNIQUE `PRIMARY`(profile_id,trait_label)

### report_identity_confidence

_08 Tracking Confidence card — separate per task, never one blended %_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `report_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `tracking_coverage_ratio` | decimal(5,4) | YES |  |  | Ring value (task: track coverage) |
| 4 | `identity_state` | enum('UNRESOLVED','CANDIDATE','CONFIRMED','REJECTED','CONFLICT') | NO |  |  | Pill: Unverified / Verified |
| 5 | `observed_minutes` | decimal(7,2) | YES |  |  | "across N minutes" |
| 6 | `quality_band` | enum('EXCELLENT','GOOD','FAIR','POOR','NOT_MEASURED') | NO | NOT_MEASURED |  |  |
| 7 | `computed_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,report_id` → `reports(organization_id,id)` CASCADE

Indexes: `fk_ric_report`(organization_id,report_id); UNIQUE `PRIMARY`(report_id)

### report_insight_citations

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `insight_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `citation_no` | tinyint unsigned | NO |  | PRI |  |
| 4 | `metric_value_id` | char(36) | YES |  | MUL |  |
| 5 | `event_id` | char(36) | YES |  |  |  |
| 6 | `cohort_id` | char(36) | YES |  | MUL |  |

Foreign keys: `cohort_id` → `metric_cohorts(id)` NO ACTION; `organization_id,event_id` → `event_candidates(organization_id,id)` NO ACTION; `organization_id,insight_id` → `report_insights(organization_id,id)` CASCADE; `metric_value_id` → `metric_values(id)` NO ACTION

Indexes: `fk_ric_cohort`(cohort_id); `fk_ric_event`(organization_id,event_id); `fk_ric_insight`(organization_id,insight_id); `fk_ric_metric`(metric_value_id); UNIQUE `PRIMARY`(insight_id,citation_no)

Checks: `ck_ric_one`: ((`metric_value_id` is not null) or (`event_id` is not null) or (`cohort_id` is not null))

### report_insights

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `report_id` | char(36) | NO |  | MUL |  |
| 4 | `display_order` | tinyint unsigned | NO |  |  |  |
| 5 | `icon_key` | varchar(16) | NO |  |  | trend / pick / tgt / shld |
| 6 | `accent_color_hex` | char(7) | NO |  |  |  |
| 7 | `headline` | varchar(80) | NO |  |  |  |
| 8 | `body` | varchar(600) | NO |  |  |  |
| 9 | `model_version_id` | char(36) | NO |  | MUL |  |
| 10 | `prompt_version` | varchar(20) | NO |  |  |  |
| 11 | `review_state` | enum('AI_DRAFT','APPROVED','REJECTED') | NO | AI_DRAFT |  |  |
| 12 | `reviewed_by` | char(36) | YES |  | MUL |  |
| 13 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `model_version_id` → `model_versions(id)` NO ACTION; `organization_id,report_id` → `reports(organization_id,id)` CASCADE; `reviewed_by` → `users(id)` NO ACTION

Indexes: `fk_ri_model`(model_version_id); `fk_ri_report`(organization_id,report_id); `fk_ri_user`(reviewed_by); UNIQUE `PRIMARY`(id); UNIQUE `uq_ri_order`(report_id,display_order); UNIQUE `uq_ri_org_id`(organization_id,id)

Checks: `ck_ri_review`: ((`review_state` = _utf8mb4\\'AI_DRAFT\\') or (`reviewed_by` is not null))

### report_metric_snapshots

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `report_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `block` | enum('KPI_TILE','COMPARISON','BIO','CONFIDENCE','HEATMAP','ACTION_MAP','OTHER') | NO |  | PRI |  |
| 4 | `metric_key` | varchar(48) | NO |  | PRI |  |
| 5 | `display_order` | tinyint unsigned | NO |  |  |  |
| 6 | `source_metric_value_id` | char(36) | YES |  | MUL |  |
| 7 | `value_numeric` | double | YES |  |  |  |
| 8 | `value_per90` | double | YES |  |  |  |
| 9 | `delta_pct` | double | YES |  |  | KPI "↑ +8%" (NULL => hidden) |
| 10 | `delta_abs` | double | YES |  |  | xG/xA "↑ +0.18" |
| 11 | `cohort_value` | double | YES |  |  | Comparison grey bar / right value |
| 12 | `coverage_ratio` | decimal(5,4) | YES |  |  |  |
| 13 | `evidence_state` | enum('DETECTED','INFERRED','CONFIRMED','NOT_MEASURED') | NO |  |  |  |

Foreign keys: `metric_key` → `metric_definitions(metric_key)` NO ACTION; `organization_id,report_id` → `reports(organization_id,id)` CASCADE; `source_metric_value_id` → `metric_values(id)` NO ACTION

Indexes: `fk_rms_def`(metric_key); `fk_rms_report`(organization_id,report_id); `fk_rms_src`(source_metric_value_id); UNIQUE `PRIMARY`(report_id,block,metric_key)

Checks: `ck_rms_nm`: ((`evidence_state` <> _utf8mb4\\'NOT_MEASURED\\') or (`value_numeric` is null))

### reports

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `project_id` | char(36) | NO |  |  |  |
| 4 | `report_type` | enum('PLAYER','MATCH','TEAM','SCOUTING_PACK') | NO |  |  |  |
| 5 | `player_id` | char(36) | YES |  | MUL |  |
| 6 | `match_id` | char(36) | YES |  |  |  |
| 7 | `video_id` | char(36) | YES |  |  |  |
| 8 | `title` | varchar(200) | NO |  |  |  |
| 9 | `scope_kind` | enum('MATCH','SEASON','RANGE') | NO | MATCH |  |  |
| 10 | `scope_from` | date | YES |  |  |  |
| 11 | `scope_to` | date | YES |  |  |  |
| 12 | `cohort_id` | char(36) | YES |  | MUL | Comparison select |
| 13 | `status` | enum('DRAFT','GENERATED','REVIEW_REQUIRED','READY','PUBLISHED','ARCHIVED') | NO | DRAFT |  |  |
| 14 | `published_by` | char(36) | YES |  | MUL |  |
| 15 | `published_at` | datetime(6) | YES |  |  |  |
| 16 | `created_by` | char(36) | NO |  | MUL |  |
| 17 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 18 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |
| 19 | `row_version` | bigint unsigned | NO | 1 |  |  |

Foreign keys: `cohort_id` → `metric_cohorts(id)` NO ACTION; `organization_id,match_id` → `matches(organization_id,id)` NO ACTION; `player_id` → `players(id)` NO ACTION; `organization_id,project_id` → `projects(organization_id,id)` NO ACTION; `published_by` → `users(id)` NO ACTION; `created_by` → `users(id)` NO ACTION; `organization_id,video_id` → `video_sources(organization_id,id)` NO ACTION

Indexes: `fk_rep_cohort`(cohort_id); `fk_rep_match`(organization_id,match_id); `fk_rep_player`(player_id); `fk_rep_project`(organization_id,project_id); `fk_rep_pub`(published_by); `fk_rep_user`(created_by); `fk_rep_video`(organization_id,video_id); `ix_reports_player`(organization_id,player_id,status,updated_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_reports_org_id`(organization_id,id)

Checks: `ck_rep_player`: ((`report_type` <> _utf8mb4\\'PLAYER\\') or (`player_id` is not null)); `ck_rep_pub`: ((`status` <> _utf8mb4\\'PUBLISHED\\') or ((`published_by` is not null) and (`published_at` is not null))); `ck_rep_range`: ((`scope_to` is null) or (`scope_from` is null) or (`scope_to` >= `scope_from`))

### scouting_assessments

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `player_id` | char(36) | NO |  | MUL |  |
| 4 | `report_id` | char(36) | YES |  |  |  |
| 5 | `overall_rating` | decimal(3,1) | YES |  |  | Overall Rating ring "x / 10" |
| 6 | `rating_scale_max` | tinyint unsigned | NO | 10 |  |  |
| 7 | `summary_quote` | varchar(600) | YES |  |  |  |
| 8 | `status` | enum('DRAFT','SUBMITTED','VERIFIED','ARCHIVED') | NO | DRAFT |  | Footer "Awaiting verified scouting data" until VERIFIED |
| 9 | `scout_user_id` | char(36) | NO |  |  |  |
| 10 | `verified_by` | char(36) | YES |  | MUL |  |
| 11 | `verified_at` | datetime(6) | YES |  |  |  |
| 12 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 13 | `updated_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6) |  |  |

Foreign keys: `player_id` → `players(id)` NO ACTION; `organization_id,report_id` → `reports(organization_id,id)` NO ACTION; `organization_id,scout_user_id` → `memberships(organization_id,user_id)` NO ACTION; `verified_by` → `users(id)` NO ACTION

Indexes: `fk_sa_player`(player_id); `fk_sa_report`(organization_id,report_id); `fk_sa_scout`(organization_id,scout_user_id); `fk_sa_ver`(verified_by); `ix_sa_player`(organization_id,player_id,status,created_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_sa_org_id`(organization_id,id)

Checks: `ck_sa_rating`: ((`overall_rating` is null) or (`overall_rating` between 0 and `rating_scale_max`)); `ck_sa_verified`: ((`status` <> _utf8mb4\\'VERIFIED\\') or ((`verified_by` is not null) and (`verified_by` <> `scout_user_id`)))

### scouting_dossier_items

_08 "Add to Scouting Dossier"_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `dossier_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `player_id` | char(36) | NO |  | PRI |  |
| 4 | `report_id` | char(36) | YES |  |  |  |
| 5 | `added_by` | char(36) | NO |  | MUL |  |
| 6 | `added_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,dossier_id` → `scouting_dossiers(organization_id,id)` CASCADE; `player_id` → `players(id)` NO ACTION; `organization_id,report_id` → `reports(organization_id,id)` NO ACTION; `added_by` → `users(id)` NO ACTION

Indexes: `fk_sdi_dossier`(organization_id,dossier_id); `fk_sdi_player`(player_id); `fk_sdi_report`(organization_id,report_id); `fk_sdi_user`(added_by); UNIQUE `PRIMARY`(dossier_id,player_id)

### scouting_dossiers

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `folder_id` | char(36) | YES |  |  |  |
| 4 | `name` | varchar(150) | NO |  |  |  |
| 5 | `created_by` | char(36) | NO |  | MUL |  |
| 6 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,folder_id` → `folders(organization_id,id)` NO ACTION; `created_by` → `users(id)` NO ACTION

Indexes: `fk_sd_folder`(organization_id,folder_id); `fk_sd_user`(created_by); UNIQUE `PRIMARY`(id); UNIQUE `uq_sd_org_id`(organization_id,id)

### scouting_strengths

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `assessment_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `display_order` | tinyint unsigned | NO |  | PRI |  |
| 4 | `kind` | enum('STRENGTH','DEVELOPMENT_AREA','RISK') | NO | STRENGTH |  |  |
| 5 | `text` | varchar(120) | NO |  |  | Green-check bullet lines |

Foreign keys: `organization_id,assessment_id` → `scouting_assessments(organization_id,id)` CASCADE

Indexes: `fk_sst_assessment`(organization_id,assessment_id); UNIQUE `PRIMARY`(assessment_id,display_order)


---
## Module 009_render_export_delivery

### client_contacts

_"Notify client" / "Deliver to Client" / "Send to Client" recipients_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `display_name` | varchar(120) | NO |  |  |  |
| 4 | `email` | varchar(320) | NO |  |  |  |
| 5 | `company` | varchar(150) | YES |  |  |  |
| 6 | `consent_state` | enum('UNKNOWN','GRANTED','WITHDRAWN') | NO | UNKNOWN |  |  |
| 7 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id` → `organizations(id)` NO ACTION

Indexes: UNIQUE `PRIMARY`(id); UNIQUE `uq_cc_email`(organization_id,email); UNIQUE `uq_cc_org_id`(organization_id,id)

### deliveries

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `library_item_id` | char(36) | NO |  |  |  |
| 4 | `render_job_id` | char(36) | YES |  |  |  |
| 5 | `share_link_id` | char(36) | YES |  |  |  |
| 6 | `channel` | enum('SIGNED_URL','EMAIL','INTERNAL','PORTAL') | NO |  |  |  |
| 7 | `message` | varchar(300) | YES |  |  | Team Collaboration textarea (counter "0/300") |
| 8 | `notify_team_when_ready` | tinyint(1) | NO | 1 |  |  |
| 9 | `notify_client` | tinyint(1) | NO | 1 |  |  |
| 10 | `state` | enum('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') | NO | QUEUED |  | Ready for Delivery / Delivery not ready |
| 11 | `rights_checked_at` | datetime(6) | YES |  |  |  |
| 12 | `rights_decision_id` | char(36) | YES |  | MUL |  |
| 13 | `requested_by` | char(36) | NO |  | MUL |  |
| 14 | `scheduled_for` | datetime(6) | YES |  |  |  |
| 15 | `delivered_at` | datetime(6) | YES |  |  |  |
| 16 | `failure_code` | varchar(64) | YES |  |  |  |
| 17 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,library_item_id` → `library_items(organization_id,id)` NO ACTION; `organization_id,render_job_id` → `render_jobs(organization_id,id)` NO ACTION; `organization_id,share_link_id` → `share_links(organization_id,id)` NO ACTION; `rights_decision_id` → `policy_decisions(id)` NO ACTION; `requested_by` → `users(id)` NO ACTION

Indexes: `fk_del_job`(organization_id,render_job_id); `fk_del_link`(organization_id,share_link_id); `fk_del_policy`(rights_decision_id); `fk_del_user`(requested_by); `ix_del_item`(organization_id,library_item_id,created_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_del_org_id`(organization_id,id)

Checks: `ck_del_done`: ((`state` <> _utf8mb4\\'SUCCEEDED\\') or ((`delivered_at` is not null) and (`rights_checked_at` is not null)))

### delivery_recipients

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `delivery_id` | char(36) | NO |  |  |  |
| 4 | `recipient_kind` | enum('TEAM_MEMBER','CLIENT') | NO |  |  |  |
| 5 | `user_id` | char(36) | YES |  |  |  |
| 6 | `client_contact_id` | char(36) | YES |  |  |  |
| 7 | `status` | enum('PENDING','SENT','OPENED','BOUNCED','FAILED') | NO | PENDING |  |  |
| 8 | `sent_at` | datetime(6) | YES |  |  |  |
| 9 | `opened_at` | datetime(6) | YES |  |  |  |

Foreign keys: `organization_id,client_contact_id` → `client_contacts(organization_id,id)` NO ACTION; `organization_id,delivery_id` → `deliveries(organization_id,id)` CASCADE; `organization_id,user_id` → `memberships(organization_id,user_id)` NO ACTION

Indexes: `fk_dr_client`(organization_id,client_contact_id); `fk_dr_user`(organization_id,user_id); `ix_dr_delivery`(organization_id,delivery_id); UNIQUE `PRIMARY`(id)

Checks: `ck_dr_target`: (((`recipient_kind` = _utf8mb4\\'TEAM_MEMBER\\') and (`user_id` is not null)) or ((`recipient_kind` = _utf8mb4\\'CLIENT\\') and (`client_contact_id` is not null)))

### export_bundles

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `render_job_id` | char(36) | NO |  | UNI |  |
| 4 | `include_performance_report_pdf` | tinyint(1) | NO | 1 |  |  |
| 5 | `include_player_analysis_pdf` | tinyint(1) | NO | 1 |  |  |
| 6 | `include_event_list_csv` | tinyint(1) | NO | 0 |  |  |
| 7 | `include_heatmaps_png` | tinyint(1) | NO | 0 |  |  |
| 8 | `report_id` | char(36) | YES |  |  |  |
| 9 | `status` | enum('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') | NO | QUEUED |  |  |
| 10 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,render_job_id` → `render_jobs(organization_id,id)` CASCADE; `organization_id,report_id` → `reports(organization_id,id)` NO ACTION

Indexes: `fk_eb_job`(organization_id,render_job_id); `fk_eb_report`(organization_id,report_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_eb_job`(render_job_id); UNIQUE `uq_eb_org_id`(organization_id,id)

### export_presets

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `owner_organization_id` | char(36) | YES |  | MUL |  |
| 3 | `name` | varchar(80) | NO |  |  | Output Preset select e.g. "Highlights Reel" |
| 4 | `is_recommended` | tinyint(1) | NO | 0 |  | "(Recommended)" suffix |
| 5 | `helper_text` | varchar(200) | YES |  |  | "Optimized for professional analysis and client sharing." |
| 6 | `resolution` | enum('720p','1080p','1440p','4K') | NO |  |  |  |
| 7 | `frame_rate` | decimal(6,3) | NO |  |  |  |
| 8 | `aspect_ratio` | enum('16:9','9:16','1:1','4:5') | NO |  |  |  |
| 9 | `container` | enum('MP4','MOV','WEBM') | NO | MP4 |  |  |
| 10 | `video_codec` | enum('H264','H265','PRORES','VP9','AV1') | NO | H264 |  |  |
| 11 | `quality` | enum('LOW','MEDIUM','HIGH','MAX') | NO | HIGH |  |  |
| 12 | `owner_key` | char(36) | YES | STORED GENERATED | MUL |  |

Foreign keys: `owner_organization_id` → `organizations(id)` NO ACTION

Indexes: `fk_xp_owner`(owner_organization_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_export_presets`(owner_key,name)

### render_job_stages

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `render_job_id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `stage` | enum('PREPARING_FILES','RENDERING_VIDEO','PROCESSING_REPORTS','FINALIZING','QC') | NO |  | PRI |  |
| 4 | `ui_order` | tinyint unsigned | NO |  |  |  |
| 5 | `status` | enum('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') | NO | QUEUED |  |  |
| 6 | `progress_pct` | decimal(5,2) | NO | 0.00 |  |  |
| 7 | `started_at` | datetime(6) | YES |  |  |  |
| 8 | `completed_at` | datetime(6) | YES |  |  |  |

Foreign keys: `organization_id,render_job_id` → `render_jobs(organization_id,id)` CASCADE

Indexes: `fk_rjs_job`(organization_id,render_job_id); UNIQUE `PRIMARY`(render_job_id,stage)

Checks: `ck_rjs_progress`: (`progress_pct` between 0 and 100)

### render_jobs

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `reel_id` | char(36) | NO |  |  |  |
| 4 | `reel_revision_id` | char(36) | NO |  |  | Exact saved timeline being rendered |
| 5 | `job_kind` | enum('FINAL','PREVIEW') | NO | FINAL |  | Preview Render vs Generate/Export |
| 6 | `preset_id` | char(36) | YES |  | MUL |  |
| 7 | `resolution` | enum('720p','1080p','1440p','4K') | NO |  |  | Queue spec line "MP4 • 4K • 16:9 • 02:17" |
| 8 | `width_px` | smallint unsigned | NO |  |  |  |
| 9 | `height_px` | smallint unsigned | NO |  |  |  |
| 10 | `frame_rate` | decimal(6,3) | NO |  |  |  |
| 11 | `aspect_ratio` | enum('16:9','9:16','1:1','4:5') | NO |  |  |  |
| 12 | `container` | enum('MP4','MOV','WEBM') | NO |  |  |  |
| 13 | `video_codec` | enum('H264','H265','PRORES','VP9','AV1') | NO |  |  |  |
| 14 | `quality` | enum('LOW','MEDIUM','HIGH','MAX') | NO |  |  |  |
| 15 | `include_branding` | tinyint(1) | NO | 1 |  |  |
| 16 | `brand_kit_id` | char(36) | YES |  |  |  |
| 17 | `overlay_logo` | tinyint(1) | NO | 1 |  |  |
| 18 | `overlay_player_name_stats` | tinyint(1) | NO | 1 |  |  |
| 19 | `overlay_match_info_banner` | tinyint(1) | NO | 1 |  |  |
| 20 | `custom_intro_outro` | tinyint(1) | NO | 1 |  |  |
| 21 | `expected_duration_us` | bigint unsigned | NO |  |  |  |
| 22 | `state` | enum('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') | NO | QUEUED |  |  |
| 23 | `queue_position` | int unsigned | YES |  |  |  |
| 24 | `progress_pct` | decimal(5,2) | NO | 0.00 |  |  |
| 25 | `eta_seconds` | int unsigned | YES |  |  | "12 min remaining" |
| 26 | `is_paused` | tinyint(1) | NO | 0 |  | Pause button |
| 27 | `manifest_asset_id` | char(36) | YES |  |  |  |
| 28 | `output_asset_id` | char(36) | YES |  |  |  |
| 29 | `idempotency_key` | varchar(128) | NO |  |  |  |
| 30 | `attempt_count` | smallint unsigned | NO | 0 |  |  |
| 31 | `failure_code` | varchar(64) | YES |  |  |  |
| 32 | `requested_by` | char(36) | NO |  | MUL |  |
| 33 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 34 | `started_at` | datetime(6) | YES |  |  |  |
| 35 | `completed_at` | datetime(6) | YES |  |  |  |

Foreign keys: `organization_id,brand_kit_id` → `brand_kits(organization_id,id)` NO ACTION; `organization_id,manifest_asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id,output_asset_id` → `assets(organization_id,id)` NO ACTION; `preset_id` → `export_presets(id)` NO ACTION; `organization_id,reel_id` → `reel_projects(organization_id,id)` NO ACTION; `organization_id,reel_revision_id` → `reel_revisions(organization_id,id)` NO ACTION; `requested_by` → `users(id)` NO ACTION

Indexes: `fk_rj_brand`(organization_id,brand_kit_id); `fk_rj_man`(organization_id,manifest_asset_id); `fk_rj_out`(organization_id,output_asset_id); `fk_rj_preset`(preset_id); `fk_rj_rev`(organization_id,reel_revision_id); `fk_rj_user`(requested_by); `ix_rj_queue`(organization_id,state,queue_position,created_at); `ix_rj_reel`(organization_id,reel_id,created_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_rj_idem`(organization_id,idempotency_key); UNIQUE `uq_rj_org_id`(organization_id,id)

Checks: `ck_rj_progress`: (`progress_pct` between 0 and 100); `ck_rj_done`: ((`state` <> _utf8mb4\\'SUCCEEDED\\') or ((`output_asset_id` is not null) and (`manifest_asset_id` is not null) and (`progress_pct` = 100))); `ck_rj_fps`: ((`frame_rate` > 0) and (`frame_rate` <= 120))

### render_qc_checks

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `render_job_id` | char(36) | NO |  | MUL |  |
| 4 | `check_kind` | enum('FFPROBE_STREAMS','DURATION_MATCH','AV_SYNC','LOUDNESS','SPOTLIGHT_TARGET_ALIGNMENT','RIGHTS_DEPENDENCIES','BLACK_FRAMES') | NO |  |  |  |
| 5 | `passed` | tinyint(1) | NO |  |  |  |
| 6 | `measurements` | json | NO | json_object() DEFAULT_GENERATED |  |  |
| 7 | `checked_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,render_job_id` → `render_jobs(organization_id,id)` CASCADE

Indexes: `fk_rqc_job`(organization_id,render_job_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_rqc`(render_job_id,check_kind)

### report_exports

_08 Export PDF, 10 bundle files, 09 report downloads_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `report_id` | char(36) | YES |  |  |  |
| 4 | `bundle_id` | char(36) | YES |  |  |  |
| 5 | `export_kind` | enum('PERFORMANCE_PDF','PLAYER_ANALYSIS_PDF','EVENT_LIST_CSV','HEATMAPS_PNG_ZIP','PLAYER_REPORT_PDF') | NO |  |  |  |
| 6 | `state` | enum('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','BLOCKED','REVIEW_REQUIRED') | NO | QUEUED |  |  |
| 7 | `output_asset_id` | char(36) | YES |  |  |  |
| 8 | `idempotency_key` | varchar(128) | NO |  |  |  |
| 9 | `requested_by` | char(36) | NO |  | MUL |  |
| 10 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 11 | `completed_at` | datetime(6) | YES |  |  |  |

Foreign keys: `organization_id,bundle_id` → `export_bundles(organization_id,id)` NO ACTION; `organization_id,output_asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id,report_id` → `reports(organization_id,id)` NO ACTION; `requested_by` → `users(id)` NO ACTION

Indexes: `fk_re_bundle`(organization_id,bundle_id); `fk_re_out`(organization_id,output_asset_id); `fk_re_user`(requested_by); `ix_re_report`(organization_id,report_id,created_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_re_idem`(organization_id,idempotency_key)

Checks: `ck_re_src`: ((`report_id` is not null) or (`bundle_id` is not null)); `ck_re_done`: ((`state` <> _utf8mb4\\'SUCCEEDED\\') or (`output_asset_id` is not null))

### share_link_access

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | bigint unsigned | NO | auto_increment | PRI |  |
| 2 | `share_link_id` | char(36) | NO |  | MUL |  |
| 3 | `action` | enum('OPEN','PLAY','DOWNLOAD','COMMENT','PASSWORD_FAIL') | NO |  |  |  |
| 4 | `decision` | enum('ALLOW','DENY') | NO |  |  |  |
| 5 | `deny_reason` | varchar(64) | YES |  |  |  |
| 6 | `ip_hash` | char(64) | YES |  |  |  |
| 7 | `user_agent_hash` | char(64) | YES |  |  |  |
| 8 | `accessed_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `share_link_id` → `share_links(id)` CASCADE

Indexes: `ix_sla_link`(share_link_id,accessed_at); UNIQUE `PRIMARY`(id)

### share_links

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `library_item_id` | char(36) | NO |  |  |  |
| 4 | `asset_id` | char(36) | YES |  |  | Pinned file (NULL => latest primary asset of the item) |
| 5 | `token_hash` | char(64) | NO |  | UNI | SHA-256 of random token; token shown once |
| 6 | `public_slug` | varchar(64) | NO |  | UNI | URL path segment (non-guessable) |
| 7 | `password_hash` | varchar(255) | YES |  |  | argon2id; Password Protection toggle |
| 8 | `expires_at` | datetime(6) | YES |  |  | Set Expiry Date toggle |
| 9 | `can_download` | tinyint(1) | NO | 1 |  |  |
| 10 | `can_comment` | tinyint(1) | NO | 1 |  |  |
| 11 | `status` | enum('PENDING_EXPORT','ACTIVE','REVOKED','EXPIRED') | NO | PENDING_EXPORT |  | Pill "Not ready" / "Ready" |
| 12 | `created_by` | char(36) | NO |  | MUL |  |
| 13 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 14 | `revoked_at` | datetime(6) | YES |  |  |  |

Foreign keys: `organization_id,asset_id` → `assets(organization_id,id)` NO ACTION; `organization_id,library_item_id` → `library_items(organization_id,id)` NO ACTION; `created_by` → `users(id)` NO ACTION

Indexes: `fk_sl_asset`(organization_id,asset_id); `fk_sl_user`(created_by); `ix_sl_item`(organization_id,library_item_id,status); UNIQUE `PRIMARY`(id); UNIQUE `uq_sl_org_id`(organization_id,id); UNIQUE `uq_sl_slug`(public_slug); UNIQUE `uq_sl_token`(token_hash)

Checks: `ck_sl_revoked`: ((`status` <> _utf8mb4\\'REVOKED\\') or (`revoked_at` is not null))


---
## Module 010_commercial_governance_ops

### admin_actions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `actor_id` | char(36) | NO |  | MUL |  |
| 3 | `organization_id` | char(36) | YES |  |  |  |
| 4 | `action` | varchar(80) | NO |  |  |  |
| 5 | `justification` | text | NO |  |  |  |
| 6 | `approved_by` | char(36) | YES |  | MUL |  |
| 7 | `occurred_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `actor_id` → `users(id)` NO ACTION; `approved_by` → `users(id)` NO ACTION

Indexes: `fk_aa_actor`(actor_id); `fk_aa_appr`(approved_by); UNIQUE `PRIMARY`(id)

Checks: `ck_aa_four_eyes`: ((`approved_by` is null) or (`approved_by` <> `actor_id`))

### artifact_dependencies

_Revoking a source right blocks every derived render/report that depends on it_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `artifact_asset_id` | char(36) | NO |  | PRI |  |
| 2 | `depends_on_asset_id` | char(36) | NO |  | PRI |  |
| 3 | `dependency_type` | enum('SOURCE_VIDEO','AUDIO','FONT','LOGO','TRACKS','MODEL','METADATA','OTHER') | NO |  | PRI |  |

Foreign keys: `artifact_asset_id` → `assets(id)` NO ACTION; `depends_on_asset_id` → `assets(id)` NO ACTION

Indexes: `ix_ad_dep`(depends_on_asset_id); UNIQUE `PRIMARY`(artifact_asset_id,depends_on_asset_id,dependency_type)

Checks: `ck_ad_self`: (`artifact_asset_id` <> `depends_on_asset_id`)

### audit_events

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | bigint unsigned | NO | auto_increment | PRI |  |
| 2 | `occurred_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED | PRI |  |
| 3 | `organization_id` | char(36) | YES |  | MUL |  |
| 4 | `actor_id` | char(36) | YES |  |  |  |
| 5 | `actor_kind` | enum('USER','SERVICE','SHARE_LINK','SYSTEM') | NO |  |  |  |
| 6 | `action` | varchar(80) | NO |  |  |  |
| 7 | `entity_type` | varchar(40) | NO |  |  |  |
| 8 | `entity_id` | char(36) | YES |  |  |  |
| 9 | `request_id` | varchar(64) | YES |  |  |  |
| 10 | `ip_hash` | char(64) | YES |  |  |  |
| 11 | `before_state` | json | YES |  |  |  |
| 12 | `after_state` | json | YES |  |  |  |

Indexes: `ix_audit_actor`(organization_id,actor_id,occurred_at); `ix_audit_entity`(organization_id,entity_type,entity_id,occurred_at); UNIQUE `PRIMARY`(id,occurred_at)

### billing_customers

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | UNI |  |
| 3 | `provider` | enum('STRIPE','PADDLE','MANUAL') | NO |  | MUL |  |
| 4 | `provider_customer_id` | varchar(255) | NO |  |  |  |
| 5 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id` → `organizations(id)` NO ACTION

Indexes: UNIQUE `PRIMARY`(id); UNIQUE `uq_bc_ext`(provider,provider_customer_id); UNIQUE `uq_bc_org`(organization_id)

### billing_webhook_inbox

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | bigint unsigned | NO | auto_increment | PRI |  |
| 2 | `provider` | enum('STRIPE','PADDLE','MANUAL') | NO |  | MUL |  |
| 3 | `external_event_id` | varchar(255) | NO |  |  |  |
| 4 | `signature_verified` | tinyint(1) | NO |  |  |  |
| 5 | `event_kind` | varchar(100) | NO |  |  |  |
| 6 | `payload_sha256` | char(64) | NO |  |  |  |
| 7 | `payload` | json | NO |  |  |  |
| 8 | `received_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 9 | `processed_at` | datetime(6) | YES |  |  |  |
| 10 | `error_code` | varchar(64) | YES |  |  |  |

Indexes: UNIQUE `PRIMARY`(id); UNIQUE `uq_bwi`(provider,external_event_id)

Checks: `ck_bwi_verified`: ((`processed_at` is null) or (0 <> `signature_verified`))

### entitlement_grants

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `source_subscription_id` | char(36) | YES |  | MUL |  |
| 4 | `feature_key` | varchar(64) | NO |  |  |  |
| 5 | `limit_value` | bigint | YES |  |  | NULL = unlimited |
| 6 | `valid_from` | datetime(6) | NO |  |  |  |
| 7 | `valid_until` | datetime(6) | YES |  |  |  |

Foreign keys: `organization_id` → `organizations(id)` NO ACTION; `source_subscription_id` → `subscriptions(id)` NO ACTION

Indexes: `fk_eg_sub`(source_subscription_id); `ix_eg_lookup`(organization_id,feature_key,valid_from); UNIQUE `PRIMARY`(id)

Checks: `ck_eg_range`: ((`valid_until` is null) or (`valid_until` > `valid_from`))

### idempotency_keys

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `organization_id` | char(36) | NO |  | PRI |  |
| 2 | `idempotency_key` | varchar(128) | NO |  | PRI |  |
| 3 | `request_hash` | char(64) | NO |  |  |  |
| 4 | `route` | varchar(120) | NO |  |  |  |
| 5 | `response_status` | smallint unsigned | YES |  |  |  |
| 6 | `response_body` | json | YES |  |  |  |
| 7 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 8 | `expires_at` | datetime(6) | NO |  | MUL |  |

Indexes: `ix_idem_expiry`(expires_at); UNIQUE `PRIMARY`(organization_id,idempotency_key)

### invoices

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `subscription_id` | char(36) | YES |  | MUL |  |
| 4 | `provider_invoice_id` | varchar(255) | YES |  | UNI |  |
| 5 | `amount_due_minor` | bigint unsigned | NO |  |  |  |
| 6 | `currency` | char(3) | NO |  |  |  |
| 7 | `invoice_state` | enum('DRAFT','OPEN','PAID','VOID','UNCOLLECTIBLE') | NO |  |  |  |
| 8 | `occurred_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id` → `organizations(id)` NO ACTION; `subscription_id` → `subscriptions(id)` NO ACTION

Indexes: `fk_inv_org`(organization_id); `fk_inv_sub`(subscription_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_inv_ext`(provider_invoice_id)

### kpi_snapshots

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `organization_id` | char(36) | NO |  | PRI |  |
| 2 | `kpi_key` | enum('MATCHES_ANALYZED','PLAYERS_TRACKED','REELS_GENERATED','REPORTS_CREATED') | NO |  | PRI |  |
| 3 | `period_kind` | enum('ALL_TIME','LAST_30_DAYS','MONTH') | NO |  | PRI |  |
| 4 | `period_start` | date | NO |  | PRI |  |
| 5 | `value_count` | bigint unsigned | NO |  |  |  |
| 6 | `previous_value` | bigint unsigned | YES |  |  |  |
| 7 | `trend_pct` | decimal(7,2) | YES | STORED GENERATED |  |  |
| 8 | `series` | json | YES |  |  | Mini bar chart points (last 5 periods) — replaces decorative fixed bars |
| 9 | `computed_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id` → `organizations(id)` CASCADE

Indexes: UNIQUE `PRIMARY`(organization_id,kpi_key,period_kind,period_start)

### outbox_events

_Dispatcher: SELECT ... WHERE delivered_at IS NULL AND available_at<=NOW(6) ORDER BY id LIMIT n FOR UPDATE SKIP LOCKED_

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | bigint unsigned | NO | auto_increment | PRI |  |
| 2 | `organization_id` | char(36) | YES |  |  |  |
| 3 | `aggregate_type` | varchar(40) | NO |  | MUL |  |
| 4 | `aggregate_id` | char(36) | NO |  |  |  |
| 5 | `event_type` | varchar(80) | NO |  |  | e.g. pipeline.step.progressed, render.job.succeeded |
| 6 | `schema_version` | smallint unsigned | NO | 1 |  |  |
| 7 | `event_payload` | json | NO |  |  |  |
| 8 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 9 | `available_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 10 | `claimed_by` | varchar(64) | YES |  |  |  |
| 11 | `claimed_at` | datetime(6) | YES |  |  |  |
| 12 | `delivered_at` | datetime(6) | YES |  | MUL |  |
| 13 | `attempt_count` | smallint unsigned | NO | 0 |  |  |
| 14 | `last_error` | varchar(500) | YES |  |  |  |

Indexes: `ix_outbox_aggregate`(aggregate_type,aggregate_id,id); `ix_outbox_pending`(delivered_at,available_at,id); UNIQUE `PRIMARY`(id)

### plan_prices

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `plan_version_id` | char(36) | NO |  | MUL |  |
| 3 | `provider` | enum('STRIPE','PADDLE','MANUAL') | NO |  | MUL |  |
| 4 | `external_price_id` | varchar(255) | NO |  |  |  |
| 5 | `billing_period` | enum('MONTHLY','YEARLY','CUSTOM') | NO |  |  |  |
| 6 | `currency` | char(3) | NO |  |  |  |
| 7 | `unit_amount_minor` | bigint unsigned | NO |  |  |  |
| 8 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `plan_version_id` → `plan_versions(id)` NO ACTION

Indexes: `fk_pp_version`(plan_version_id); UNIQUE `PRIMARY`(id); UNIQUE `uq_plan_prices_ext`(provider,external_price_id)

### plan_versions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `plan_id` | char(36) | NO |  | MUL |  |
| 3 | `version` | int unsigned | NO |  |  |  |
| 4 | `effective_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 5 | `feature_limits` | json | NO |  |  | {"analysis_minutes":600,"render_minutes":120,"storage_gb":500,"seats":5,"max_upload_bytes":...} |
| 6 | `is_published` | tinyint(1) | NO | 0 |  |  |

Foreign keys: `plan_id` → `plans(id)` NO ACTION

Indexes: UNIQUE `PRIMARY`(id); UNIQUE `uq_plan_versions`(plan_id,version)

### plans

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `code` | varchar(40) | NO |  | UNI |  |
| 3 | `name` | varchar(80) | NO |  |  |  |
| 4 | `active` | tinyint(1) | NO | 1 |  |  |
| 5 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Indexes: UNIQUE `PRIMARY`(id); UNIQUE `uq_plans_code`(code)

### policy_decisions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `action` | enum('ANALYZE','PRODUCE','EXPORT','VIEW','DOWNLOAD','SHARE','DELIVER') | NO |  |  |  |
| 4 | `resource_type` | varchar(40) | NO |  |  |  |
| 5 | `resource_id` | char(36) | NO |  |  |  |
| 6 | `actor_id` | char(36) | YES |  | MUL |  |
| 7 | `decision` | enum('ALLOW','DENY','REVIEW') | NO |  |  |  |
| 8 | `rule_version` | varchar(20) | NO |  |  |  |
| 9 | `grant_ids` | json | NO | json_array() DEFAULT_GENERATED |  |  |
| 10 | `dependency_asset_ids` | json | NO | json_array() DEFAULT_GENERATED |  |  |
| 11 | `reason_codes` | json | NO | json_array() DEFAULT_GENERATED |  |  |
| 12 | `checked_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `actor_id` → `users(id)` NO ACTION; `organization_id` → `organizations(id)` NO ACTION

Indexes: `fk_pd_actor`(actor_id); `ix_pd_resource`(organization_id,resource_type,resource_id,checked_at); UNIQUE `PRIMARY`(id)

Checks: `ck_pd_arrays`: ((json_type(`grant_ids`) = _utf8mb4\\'ARRAY\\') and (json_type(`dependency_asset_ids`) = _utf8mb4\\'ARRAY\\') and (json_type(`reason_codes`) = _utf8mb4\\'ARRAY\\'))

### processing_dead_letters

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `workflow_id` | varchar(255) | NO |  |  |  |
| 4 | `job_kind` | varchar(40) | NO |  |  |  |
| 5 | `error_code` | varchar(64) | NO |  |  |  |
| 6 | `attempt_count` | smallint unsigned | NO |  |  |  |
| 7 | `payload_object_key` | varchar(1024) | NO |  |  |  |
| 8 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 9 | `resolved_at` | datetime(6) | YES |  | MUL |  |

Foreign keys: `organization_id` → `organizations(id)` NO ACTION

Indexes: `fk_pdl_org`(organization_id); `ix_pdl_open`(resolved_at,created_at); UNIQUE `PRIMARY`(id)

### quota_counters

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `organization_id` | char(36) | NO |  | PRI |  |
| 2 | `feature_key` | varchar(64) | NO |  | PRI |  |
| 3 | `window_start` | datetime(6) | NO |  | PRI |  |
| 4 | `used_amount` | bigint unsigned | NO | 0 |  |  |
| 5 | `reserved_amount` | bigint unsigned | NO | 0 |  |  |

Foreign keys: `organization_id` → `organizations(id)` NO ACTION

Indexes: UNIQUE `PRIMARY`(organization_id,feature_key,window_start)

### quota_reservations

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `feature_key` | varchar(64) | NO |  |  |  |
| 4 | `window_start` | datetime(6) | NO |  |  |  |
| 5 | `quantity` | bigint unsigned | NO |  |  |  |
| 6 | `status` | enum('RESERVED','COMMITTED','RELEASED') | NO |  |  |  |
| 7 | `subject_type` | varchar(40) | NO |  |  | PIPELINE_RUN / RENDER_JOB / UPLOAD |
| 8 | `subject_id` | char(36) | NO |  |  |  |
| 9 | `idempotency_key` | varchar(128) | NO |  |  |  |
| 10 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id,feature_key,window_start` → `quota_counters(organization_id,feature_key,window_start)` NO ACTION

Indexes: `fk_qr_counter`(organization_id,feature_key,window_start); UNIQUE `PRIMARY`(id); UNIQUE `uq_qr_idem`(organization_id,feature_key,idempotency_key)

Checks: `ck_qr_qty`: (`quantity` > 0)

### release_signoffs

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `build_sha` | char(40) | NO |  | MUL |  |
| 3 | `gate_code` | varchar(64) | NO |  |  |  |
| 4 | `state` | enum('PENDING','PASS','FAIL','WAIVED') | NO |  |  |  |
| 5 | `signed_by` | char(36) | YES |  | MUL |  |
| 6 | `evidence_object_key` | varchar(1024) | YES |  |  |  |
| 7 | `signed_at` | datetime(6) | YES |  |  |  |

Foreign keys: `signed_by` → `users(id)` NO ACTION

Indexes: `fk_rs_user`(signed_by); UNIQUE `PRIMARY`(id); UNIQUE `uq_rs`(build_sha,gate_code)

### retention_jobs

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `subject_type` | varchar(40) | NO |  |  |  |
| 4 | `subject_id` | char(36) | NO |  |  |  |
| 5 | `requested_by` | char(36) | YES |  |  |  |
| 6 | `legal_hold` | tinyint(1) | NO | 0 |  |  |
| 7 | `status` | enum('QUEUED','RUNNING','DONE','BLOCKED','FAILED') | NO |  |  |  |
| 8 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 9 | `finished_at` | datetime(6) | YES |  |  |  |

Foreign keys: `organization_id` → `organizations(id)` NO ACTION

Indexes: `fk_ret_org`(organization_id); UNIQUE `PRIMARY`(id)

Checks: `ck_ret_hold`: ((0 = `legal_hold`) or (`status` <> _utf8mb4\\'DONE\\'))

### schema_migrations

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `version` | varchar(10) | NO |  | PRI |  |
| 2 | `description` | varchar(200) | NO |  |  |  |
| 3 | `checksum_sha256` | char(64) | NO |  |  |  |
| 4 | `applied_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |
| 5 | `applied_by` | varchar(100) | NO | current_user() DEFAULT_GENERATED |  |  |

Indexes: UNIQUE `PRIMARY`(version)

### security_events

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | bigint unsigned | NO | auto_increment | PRI |  |
| 2 | `organization_id` | char(36) | YES |  | MUL |  |
| 3 | `actor_id` | char(36) | YES |  |  |  |
| 4 | `ip_hash` | char(64) | YES |  |  |  |
| 5 | `event_kind` | varchar(64) | NO |  |  |  |
| 6 | `outcome` | enum('SUCCESS','FAILURE','BLOCKED') | NO |  |  |  |
| 7 | `details` | json | YES |  |  |  |
| 8 | `occurred_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Indexes: `ix_sec`(organization_id,event_kind,occurred_at); UNIQUE `PRIMARY`(id)

### subscriptions

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `plan_version_id` | char(36) | NO |  | MUL |  |
| 4 | `provider_subscription_id` | varchar(255) | YES |  | UNI |  |
| 5 | `state` | enum('TRIALING','ACTIVE','PAST_DUE','CANCELED','UNPAID','INCOMPLETE') | NO |  |  |  |
| 6 | `period_start` | datetime(6) | YES |  |  |  |
| 7 | `period_end` | datetime(6) | YES |  |  |  |
| 8 | `trial_end` | datetime(6) | YES |  |  |  |
| 9 | `cancel_at_period_end` | tinyint(1) | NO | 0 |  |  |
| 10 | `row_version` | bigint unsigned | NO | 1 |  |  |
| 11 | `created_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id` → `organizations(id)` NO ACTION; `plan_version_id` → `plan_versions(id)` NO ACTION

Indexes: `fk_sub_pv`(plan_version_id); `ix_sub_org`(organization_id,state); UNIQUE `PRIMARY`(id); UNIQUE `uq_sub_ext`(provider_subscription_id)

Checks: `ck_sub_period`: ((`period_end` is null) or (`period_start` is null) or (`period_end` > `period_start`))

### usage_events

| # | column | type | null | default / extra | key | UI / meaning |
|---|---|---|---|---|---|---|
| 1 | `id` | char(36) | NO |  | PRI |  |
| 2 | `organization_id` | char(36) | NO |  | MUL |  |
| 3 | `reservation_id` | char(36) | YES |  | MUL |  |
| 4 | `event_key` | varchar(160) | NO |  | UNI |  |
| 5 | `quantity` | bigint unsigned | NO |  |  |  |
| 6 | `unit` | enum('ANALYSIS_SECOND','RENDER_SECOND','STORAGE_BYTE_DAY','UPLOAD_BYTE','SEAT','REPORT') | NO |  |  |  |
| 7 | `occurred_at` | datetime(6) | NO | CURRENT_TIMESTAMP(6) DEFAULT_GENERATED |  |  |

Foreign keys: `organization_id` → `organizations(id)` NO ACTION; `reservation_id` → `quota_reservations(id)` NO ACTION

Indexes: `fk_ue_res`(reservation_id); `ix_ue_org`(organization_id,unit,occurred_at); UNIQUE `PRIMARY`(id); UNIQUE `uq_ue_key`(event_key)
