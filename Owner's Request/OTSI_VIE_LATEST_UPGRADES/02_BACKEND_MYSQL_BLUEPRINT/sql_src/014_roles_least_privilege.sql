-- Migration 014 — Least-privilege roles. Accounts (and passwords) are created by ops from the secrets manager:
--   CREATE USER 'otsi_api'@'%' IDENTIFIED BY '<from secrets manager>'; GRANT otsi_app_rw TO 'otsi_api'@'%'; SET DEFAULT ROLE ALL TO 'otsi_api'@'%';
-- phpMyAdmin must never be internet-exposed and must use otsi_readonly for browsing production.
USE `otsi_owner_vie`;

CREATE ROLE IF NOT EXISTS otsi_migrator, otsi_app_rw, otsi_worker_rw, otsi_readonly;

GRANT ALL PRIVILEGES ON otsi_owner_vie.* TO otsi_migrator;

-- API: DML only, no DDL; append-only ledgers get INSERT+SELECT only.
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON otsi_owner_vie.* TO otsi_app_rw;
REVOKE UPDATE, DELETE ON otsi_owner_vie.* FROM otsi_app_rw;
GRANT UPDATE, DELETE ON otsi_owner_vie.organizations TO otsi_app_rw;
-- Re-grant UPDATE/DELETE table-by-table for mutable tables (generated list keeps ledgers immutable):
GRANT UPDATE ON otsi_owner_vie.users TO otsi_app_rw;            GRANT UPDATE, DELETE ON otsi_owner_vie.memberships TO otsi_app_rw;
GRANT UPDATE, DELETE ON otsi_owner_vie.invitations TO otsi_app_rw;      GRANT UPDATE, DELETE ON otsi_owner_vie.user_preferences TO otsi_app_rw;
GRANT UPDATE, DELETE ON otsi_owner_vie.notifications TO otsi_app_rw;    GRANT UPDATE ON otsi_owner_vie.assets TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.players TO otsi_app_rw;                  GRANT UPDATE, DELETE ON otsi_owner_vie.player_positions TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.player_club_spells TO otsi_app_rw;       GRANT UPDATE ON otsi_owner_vie.matches TO otsi_app_rw;
GRANT UPDATE, DELETE ON otsi_owner_vie.match_periods TO otsi_app_rw;    GRANT UPDATE, DELETE ON otsi_owner_vie.match_rosters TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.projects TO otsi_app_rw;                 GRANT UPDATE, DELETE ON otsi_owner_vie.project_members TO otsi_app_rw;
GRANT UPDATE, DELETE ON otsi_owner_vie.folders TO otsi_app_rw;          GRANT UPDATE, DELETE ON otsi_owner_vie.tags TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.library_items TO otsi_app_rw;            GRANT UPDATE, DELETE ON otsi_owner_vie.library_item_players TO otsi_app_rw;
GRANT UPDATE, DELETE ON otsi_owner_vie.library_item_tags TO otsi_app_rw;GRANT UPDATE, DELETE ON otsi_owner_vie.library_item_collaborators TO otsi_app_rw;
GRANT UPDATE, DELETE ON otsi_owner_vie.saved_searches TO otsi_app_rw;   GRANT DELETE ON otsi_owner_vie.bookmarks TO otsi_app_rw;
GRANT DELETE ON otsi_owner_vie.item_likes TO otsi_app_rw;               GRANT UPDATE ON otsi_owner_vie.comments TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.video_sources TO otsi_app_rw;            GRANT UPDATE ON otsi_owner_vie.video_ingest_options TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.upload_sessions TO otsi_app_rw;          GRANT UPDATE ON otsi_owner_vie.url_imports TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.video_detected_teams TO otsi_app_rw;     GRANT UPDATE ON otsi_owner_vie.pipeline_runs TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.identity_review_tasks TO otsi_app_rw;    GRANT UPDATE ON otsi_owner_vie.reel_projects TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.reel_style_settings TO otsi_app_rw;      GRANT UPDATE, DELETE ON otsi_owner_vie.reel_targets TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.moment_suggestions TO otsi_app_rw;       GRANT UPDATE, DELETE ON otsi_owner_vie.media_clips TO otsi_app_rw;
GRANT UPDATE, DELETE ON otsi_owner_vie.media_clip_tags TO otsi_app_rw;  GRANT UPDATE, DELETE ON otsi_owner_vie.reel_clips TO otsi_app_rw;
GRANT UPDATE, DELETE ON otsi_owner_vie.timeline_tracks TO otsi_app_rw;  GRANT UPDATE, DELETE ON otsi_owner_vie.timeline_items TO otsi_app_rw;
GRANT UPDATE, DELETE ON otsi_owner_vie.effect_keyframes TO otsi_app_rw; GRANT UPDATE, DELETE ON otsi_owner_vie.caption_cues TO otsi_app_rw;
GRANT UPDATE, DELETE ON otsi_owner_vie.reel_chapters TO otsi_app_rw;    GRANT UPDATE ON otsi_owner_vie.reel_settings_flags TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.reports TO otsi_app_rw;                  GRANT UPDATE ON otsi_owner_vie.player_role_profiles TO otsi_app_rw;
GRANT UPDATE, DELETE ON otsi_owner_vie.player_role_traits TO otsi_app_rw;GRANT UPDATE ON otsi_owner_vie.report_insights TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.scouting_assessments TO otsi_app_rw;     GRANT UPDATE, DELETE ON otsi_owner_vie.scouting_strengths TO otsi_app_rw;
GRANT UPDATE, DELETE ON otsi_owner_vie.scouting_dossier_items TO otsi_app_rw; GRANT UPDATE ON otsi_owner_vie.render_jobs TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.export_bundles TO otsi_app_rw;           GRANT UPDATE ON otsi_owner_vie.share_links TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.deliveries TO otsi_app_rw;               GRANT UPDATE ON otsi_owner_vie.client_contacts TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.subscriptions TO otsi_app_rw;            GRANT UPDATE ON otsi_owner_vie.billing_webhook_inbox TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.quota_counters TO otsi_app_rw;           GRANT UPDATE ON otsi_owner_vie.quota_reservations TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.outbox_events TO otsi_app_rw;            GRANT UPDATE, DELETE ON otsi_owner_vie.idempotency_keys TO otsi_app_rw;
GRANT UPDATE ON otsi_owner_vie.kpi_snapshots TO otsi_app_rw;

-- Workers (CV / render): write pipeline & analytics outputs; no access to billing or identity administration.
GRANT SELECT ON otsi_owner_vie.* TO otsi_worker_rw;
GRANT INSERT, UPDATE ON otsi_owner_vie.pipeline_runs TO otsi_worker_rw;      GRANT INSERT, UPDATE ON otsi_owner_vie.pipeline_steps TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.pipeline_step_segments TO otsi_worker_rw;    GRANT INSERT, UPDATE ON otsi_owner_vie.job_log_entries TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.worker_resource_samples TO otsi_worker_rw;   GRANT INSERT, DELETE ON otsi_owner_vie.run_worker_assignments TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.pipeline_preview_frames TO otsi_worker_rw;   GRANT INSERT, UPDATE ON otsi_owner_vie.assets TO otsi_worker_rw;
GRANT INSERT, UPDATE ON otsi_owner_vie.video_sources TO otsi_worker_rw;     GRANT INSERT ON otsi_owner_vie.video_classifications TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.video_detected_teams TO otsi_worker_rw;      GRANT INSERT ON otsi_owner_vie.video_shots TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.video_frame_index TO otsi_worker_rw;         GRANT INSERT ON otsi_owner_vie.evidence_records TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.detection_batches TO otsi_worker_rw;         GRANT INSERT, UPDATE ON otsi_owner_vie.tracks TO otsi_worker_rw;
GRANT INSERT, DELETE ON otsi_owner_vie.track_observations TO otsi_worker_rw;GRANT INSERT ON otsi_owner_vie.track_segments TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.track_gaps TO otsi_worker_rw;                GRANT INSERT ON otsi_owner_vie.presence_intervals TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.track_identity_candidates TO otsi_worker_rw; GRANT INSERT ON otsi_owner_vie.track_identity_decisions TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.identity_review_tasks TO otsi_worker_rw;     GRANT INSERT ON otsi_owner_vie.pitch_calibrations TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.event_candidates TO otsi_worker_rw;          GRANT INSERT, UPDATE ON otsi_owner_vie.metric_values TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.team_shape_snapshots TO otsi_worker_rw;      GRANT INSERT ON otsi_owner_vie.team_shape_nodes TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.pass_networks TO otsi_worker_rw;             GRANT INSERT ON otsi_owner_vie.pass_network_nodes TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.pass_network_edges TO otsi_worker_rw;        GRANT INSERT ON otsi_owner_vie.heatmaps TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.possession_episodes TO otsi_worker_rw;       GRANT INSERT ON otsi_owner_vie.movement_segments TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.tactical_windows TO otsi_worker_rw;          GRANT INSERT ON otsi_owner_vie.moment_suggestions TO otsi_worker_rw;
GRANT INSERT, UPDATE ON otsi_owner_vie.render_jobs TO otsi_worker_rw;       GRANT INSERT, UPDATE ON otsi_owner_vie.render_job_stages TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.render_qc_checks TO otsi_worker_rw;          GRANT INSERT, UPDATE ON otsi_owner_vie.report_exports TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.artifact_dependencies TO otsi_worker_rw;     GRANT INSERT ON otsi_owner_vie.outbox_events TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.processing_dead_letters TO otsi_worker_rw;   GRANT INSERT ON otsi_owner_vie.report_insights TO otsi_worker_rw;
GRANT INSERT ON otsi_owner_vie.report_insight_citations TO otsi_worker_rw;  GRANT INSERT ON otsi_owner_vie.kpi_snapshots TO otsi_worker_rw;
GRANT UPDATE ON otsi_owner_vie.kpi_snapshots TO otsi_worker_rw;

GRANT SELECT ON otsi_owner_vie.* TO otsi_readonly;
