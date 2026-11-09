-- Migration 012 — UI read-model views. One view per screen block; every view exposes organization_id and the API
-- MUST filter `WHERE organization_id = :orgId` (views do not, and cannot, enforce tenancy on their own).
-- Formatting (mm:ss, "Tue, 16 Apr 2024", "1.8 GB") is done in the API/BFF, never in SQL.
USE `otsi_owner_vie`;

-- ===== Shared =====
CREATE OR REPLACE VIEW v_match_labels AS
SELECT m.organization_id, m.id AS match_id, m.match_type, m.kickoff_at,
       COALESCE(m.title_override, CONCAT(hc.canonical_name, ' vs ', ac.canonical_name)) AS match_title,
       hc.id AS home_club_id, hc.canonical_name AS home_name, hc.code3 AS home_code3, hc.crest_asset_id AS home_crest_asset_id, hc.primary_color_hex AS home_color_hex,
       ac.id AS away_club_id, ac.canonical_name AS away_name, ac.code3 AS away_code3, ac.crest_asset_id AS away_crest_asset_id, ac.primary_color_hex AS away_color_hex,
       c.id AS competition_id, c.name AS competition_name, c.short_name AS competition_short_name, s.label AS season_label,
       IF(m.score_state = 'NOT_MEASURED', NULL, m.home_score) AS home_score,
       IF(m.score_state = 'NOT_MEASURED', NULL, m.away_score) AS away_score,
       m.score_state, m.metadata_state
  FROM matches m
  LEFT JOIN clubs hc ON hc.id = m.home_club_id
  LEFT JOIN clubs ac ON ac.id = m.away_club_id
  LEFT JOIN competitions c ON c.id = m.competition_id
  LEFT JOIN seasons s ON s.id = m.season_id;

CREATE OR REPLACE VIEW v_latest_pipeline_run AS
SELECT * FROM (
  SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.video_id ORDER BY r.attempt DESC) AS rn FROM pipeline_runs r
) x WHERE x.rn = 1;

-- ===== 01 Home =====
CREATE OR REPLACE VIEW v_home_kpis AS
SELECT k.organization_id, k.kpi_key, k.value_count, k.previous_value, k.trend_pct, k.series, k.computed_at
  FROM kpi_snapshots k WHERE k.period_kind = 'LAST_30_DAYS'
   AND k.period_start = (SELECT MAX(k2.period_start) FROM kpi_snapshots k2
                          WHERE k2.organization_id = k.organization_id AND k2.kpi_key = k.kpi_key AND k2.period_kind = 'LAST_30_DAYS');

CREATE OR REPLACE VIEW v_home_recent_matches AS
SELECT v.organization_id, v.id AS video_id, v.match_id, v.poster_asset_id, v.duration_us, v.created_at,
       ml.match_title, ml.competition_name, ml.kickoff_at, ml.home_score, ml.away_score, ml.score_state,
       ml.home_crest_asset_id, ml.away_crest_asset_id, lr.status AS analysis_status
  FROM video_sources v
  LEFT JOIN v_match_labels ml ON ml.match_id = v.match_id AND ml.organization_id = v.organization_id
  LEFT JOIN v_latest_pipeline_run lr ON lr.video_id = v.id
 WHERE v.state = 'INGESTED';

CREATE OR REPLACE VIEW v_reel_cards AS
SELECT li.organization_id, li.id AS library_item_id, li.entity_id AS reel_id, li.title, li.subtitle, li.status, li.is_featured,
       li.duration_us, li.thumbnail_asset_id, li.updated_at,
       (SELECT lip.player_id FROM library_item_players lip WHERE lip.library_item_id = li.id ORDER BY lip.display_order LIMIT 1) AS lead_player_id,
       COALESCE((SELECT SUM(e.views) FROM item_engagement_daily e WHERE e.organization_id = li.organization_id AND e.library_item_id = li.id), 0) AS views,
       (SELECT COUNT(*) FROM item_likes l WHERE l.organization_id = li.organization_id AND l.library_item_id = li.id) AS likes,
       rj.resolution AS output_resolution
  FROM library_items li
  LEFT JOIN render_jobs rj ON rj.organization_id = li.organization_id AND rj.output_asset_id = li.primary_asset_id AND rj.state = 'SUCCEEDED'
 WHERE li.item_type = 'REEL' AND li.deleted_at IS NULL;

-- ===== 02 Upload & Ingest =====
CREATE OR REPLACE VIEW v_upload_recent AS
SELECT v.organization_id, v.id AS video_id, v.title, v.state AS video_state, v.ingest_mode, v.duration_us, v.poster_asset_id, v.created_at,
       ml.match_title, ml.competition_name, ml.kickoff_at, v.match_id, m.match_type,
       us.progress_pct AS upload_progress_pct, us.status AS upload_status,
       lr.id AS run_id, lr.status AS run_status, lr.overall_progress AS run_progress,
       CASE WHEN v.state IN ('FAILED','QUARANTINED') OR lr.status = 'FAILED' THEN 'FAILED'
            WHEN lr.status = 'SUCCEEDED' THEN 'COMPLETED'
            WHEN lr.status IN ('RUNNING','REVIEW_REQUIRED') OR v.state IN ('UPLOADING','VALIDATING') THEN 'PROCESSING'
            WHEN lr.status = 'QUEUED' OR v.state = 'PENDING' THEN 'QUEUED'
            ELSE 'NONE' END AS status_pill
  FROM video_sources v
  LEFT JOIN matches m ON m.id = v.match_id
  LEFT JOIN v_match_labels ml ON ml.match_id = v.match_id AND ml.organization_id = v.organization_id
  LEFT JOIN v_latest_pipeline_run lr ON lr.video_id = v.id
  LEFT JOIN (SELECT u.*, ROW_NUMBER() OVER (PARTITION BY u.video_id ORDER BY u.created_at DESC) rn FROM upload_sessions u) us
         ON us.video_id = v.id AND us.rn = 1
 WHERE v.state <> 'DELETED';

CREATE OR REPLACE VIEW v_upload_selected_item AS
SELECT v.organization_id, v.id AS video_id, a.original_filename, a.byte_size, v.width_px, v.height_px, v.fps, v.duration_us,
       vc.content_class, vc.confidence_band, vc.evidence_state AS content_evidence_state,
       ml.match_title, ml.competition_name, ml.kickoff_at, v.poster_asset_id
  FROM video_sources v
  LEFT JOIN assets a ON a.id = v.source_asset_id
  LEFT JOIN v_match_labels ml ON ml.match_id = v.match_id AND ml.organization_id = v.organization_id
  LEFT JOIN (SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.video_id ORDER BY c.created_at DESC) rn FROM video_classifications c) vc
         ON vc.video_id = v.id AND vc.rn = 1;

-- ===== 03 AI Processing =====
CREATE OR REPLACE VIEW v_run_stage_progress AS
SELECT r.organization_id, r.id AS run_id, r.video_id, r.status AS run_status, r.overall_progress, r.eta_seconds,
       d.code AS stage_code, d.label, d.description, d.ui_order, d.ui_surface, d.timeline_color_hex,
       COALESCE(s.status, 'QUEUED') AS stage_status, COALESCE(s.progress, 0) AS stage_progress, s.started_at, s.completed_at
  FROM pipeline_runs r
  CROSS JOIN pipeline_stage_definitions d
  LEFT JOIN pipeline_steps s ON s.run_id = r.id AND s.stage_code = d.code
 WHERE d.ui_surface <> 'INTERNAL';

CREATE OR REPLACE VIEW v_run_output_summary AS
SELECT r.organization_id, r.id AS run_id, r.video_id,
       (SELECT COUNT(*) FROM tracks t WHERE t.run_id = r.id AND t.class_name IN ('PLAYER','GOALKEEPER')) AS players_tracked,
       (SELECT COUNT(*) FROM tracks t WHERE t.run_id = r.id AND t.class_name = 'BALL') AS balls_tracked,
       (SELECT COUNT(*) FROM event_candidates e WHERE e.run_id = r.id AND e.effective_state <> 'REJECTED') AS events_detected,
       IF(r.frames_total IS NULL OR r.frames_total = 0, NULL, ROUND(v.duration_us * r.frames_processed / r.frames_total)) AS processed_duration_us
  FROM pipeline_runs r JOIN video_sources v ON v.id = r.video_id;

CREATE OR REPLACE VIEW v_system_resources AS
SELECT w.pool, MAX(w.gpu_model) AS gpu_model, SUM(w.cpu_cores) AS cpu_cores,
       ROUND(AVG(s.gpu_util_pct), 1) AS gpu_util_pct, ROUND(AVG(s.cpu_util_pct), 1) AS cpu_util_pct,
       SUM(w.memory_bytes) AS memory_total_bytes, SUM(s.memory_used_bytes) AS memory_used_bytes,
       SUM(w.storage_bytes_total) AS storage_total_bytes, SUM(s.storage_used_bytes) AS storage_used_bytes, MAX(s.sampled_at) AS sampled_at
  FROM worker_nodes w
  JOIN (SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.worker_id ORDER BY x.sampled_at DESC) rn FROM worker_resource_samples x) s
    ON s.worker_id = w.id AND s.rn = 1
 WHERE w.status = 'ONLINE'
 GROUP BY w.pool;

-- ===== 04 Analysis Workspace =====
CREATE OR REPLACE VIEW v_analysis_player_rows AS
SELECT t.organization_id, t.video_id, t.run_id, t.id AS track_id, t.class_name, t.team_side, t.identity_state, t.quality_score,
       t.current_player_id AS player_id, p.display_name, p.short_name, mr.jersey_number,
       COALESCE(tc.score, NULL) AS top_candidate_score, tc.player_id AS top_candidate_player_id,
       IF(t.team_side = 'HOME', ml.home_code3, IF(t.team_side = 'AWAY', ml.away_code3, NULL)) AS team_code3
  FROM tracks t
  JOIN video_sources v ON v.id = t.video_id
  LEFT JOIN v_match_labels ml ON ml.match_id = v.match_id AND ml.organization_id = v.organization_id
  LEFT JOIN players p ON p.id = t.current_player_id
  LEFT JOIN match_rosters mr ON mr.match_id = v.match_id AND mr.player_id = t.current_player_id
  LEFT JOIN (SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.track_id ORDER BY c.rank_no) rn FROM track_identity_candidates c) tc
         ON tc.track_id = t.id AND tc.rn = 1
 WHERE t.class_name IN ('PLAYER','GOALKEEPER');

CREATE OR REPLACE VIEW v_event_chip_counts AS
SELECT e.organization_id, e.video_id, et.chip_group, COUNT(*) AS event_count,
       SUM(e.effective_state = 'CONFIRMED') AS confirmed_count
  FROM event_candidates e JOIN event_types et ON et.code = e.event_type
 WHERE e.effective_state <> 'REJECTED' AND et.chip_group IS NOT NULL
 GROUP BY e.organization_id, e.video_id, et.chip_group;

-- ===== 05 / 08 Player header & bio (age derived, never stored) =====
CREATE OR REPLACE VIEW v_player_header AS
SELECT p.id AS player_id, p.canonical_otsi_id, p.canonical_state, p.display_name, p.short_name, p.photo_asset_id,
       TIMESTAMPDIFF(YEAR, p.birth_date, CURRENT_DATE) AS age_years, p.height_cm, p.weight_kg, p.preferred_foot,
       p.nationality_code, cn.name AS nationality_name, cn.flag_asset_id,
       pos.label AS primary_position_label,
       (SELECT JSON_ARRAYAGG(pp.position_code) FROM (SELECT position_code FROM player_positions WHERE player_id = p.id ORDER BY sort_order) pp) AS position_codes,
       sp.club_id AS current_club_id, cl.canonical_name AS current_club_name, cl.code3 AS current_club_code3, sp.squad_number, p.bio_evidence_state
  FROM players p
  LEFT JOIN countries cn ON cn.code = p.nationality_code
  LEFT JOIN positions pos ON pos.code = p.primary_position_code
  LEFT JOIN (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY s.valid_from DESC) rn
               FROM player_club_spells s WHERE s.valid_to IS NULL OR s.valid_to >= CURRENT_DATE) sp ON sp.player_id = p.id AND sp.rn = 1
  LEFT JOIN clubs cl ON cl.id = sp.club_id
 WHERE p.canonical_state <> 'MERGED';

CREATE OR REPLACE VIEW v_player_current_metrics AS
SELECT mv.organization_id, mv.player_id, mv.video_id, mv.match_id, mv.metric_key, md.label, md.unit, md.display_decimals,
       mv.window_kind, mv.period, mv.phase, mv.value_numeric, mv.value_per90, mv.uncertainty, mv.coverage_ratio,
       IF(mv.baseline_value IS NULL OR mv.baseline_value = 0, NULL, ROUND((mv.value_numeric - mv.baseline_value) * 100 / mv.baseline_value, 1)) AS delta_pct,
       mv.evidence_state, mv.quality_score, md.measurement_class, mv.computed_at
  FROM metric_values mv JOIN metric_definitions md ON md.metric_key = mv.metric_key
 WHERE mv.is_current AND mv.subject_kind = 'PLAYER';

-- ===== 09 Library =====
CREATE OR REPLACE VIEW v_library_tab_counts AS
SELECT organization_id, item_type, COUNT(*) AS item_count FROM library_items WHERE deleted_at IS NULL GROUP BY organization_id, item_type;

CREATE OR REPLACE VIEW v_library_rows AS
SELECT li.organization_id, li.id AS library_item_id, li.item_type, li.entity_id, li.title, li.subtitle, li.status, li.duration_us,
       li.thumbnail_asset_id, li.updated_at, li.created_by, li.competition_id, li.primary_club_id, li.folder_id, li.is_featured,
       (SELECT COUNT(*) FROM library_item_players x WHERE x.library_item_id = li.id) AS players_featured_count,
       (SELECT JSON_ARRAYAGG(JSON_OBJECT('userId', u.id, 'initials', u.initials, 'color', u.avatar_color_hex))
          FROM library_item_collaborators c JOIN users u ON u.id = c.user_id WHERE c.library_item_id = li.id) AS collaborators,
       (SELECT JSON_ARRAYAGG(t.label) FROM library_item_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.library_item_id = li.id) AS tags
  FROM library_items li WHERE li.deleted_at IS NULL;

-- ===== 10 Export & Delivery =====
CREATE OR REPLACE VIEW v_export_queue AS
SELECT rj.organization_id, rj.id AS render_job_id, rj.reel_id, rp.title AS reel_title, rj.job_kind, rj.state, rj.is_paused,
       rj.container, rj.resolution, rj.aspect_ratio, rj.expected_duration_us, rj.progress_pct, rj.eta_seconds, rj.queue_position,
       rj.created_at, rj.completed_at, li.thumbnail_asset_id
  FROM render_jobs rj
  JOIN reel_projects rp ON rp.id = rj.reel_id
  LEFT JOIN library_items li ON li.organization_id = rj.organization_id AND li.item_type = 'REEL' AND li.entity_id = rj.reel_id
 WHERE rj.job_kind = 'FINAL' AND rj.state IN ('QUEUED','RUNNING','REVIEW_REQUIRED','BLOCKED','FAILED');

CREATE OR REPLACE VIEW v_delivery_readiness AS
SELECT rj.organization_id, rj.id AS render_job_id, rj.reel_id, rj.state AS render_state,
       (SELECT COUNT(*) FROM render_qc_checks q WHERE q.render_job_id = rj.id AND NOT q.passed) AS failed_qc_checks,
       (SELECT pd.decision FROM policy_decisions pd WHERE pd.organization_id = rj.organization_id AND pd.resource_type = 'RENDER_JOB'
           AND pd.resource_id = rj.id AND pd.action = 'DELIVER' ORDER BY pd.checked_at DESC LIMIT 1) AS latest_rights_decision,
       (rj.state = 'SUCCEEDED'
        AND NOT EXISTS (SELECT 1 FROM render_qc_checks q WHERE q.render_job_id = rj.id AND NOT q.passed)) AS ready_for_delivery
  FROM render_jobs rj WHERE rj.job_kind = 'FINAL';
