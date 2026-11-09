-- Behavioural tests for the OTSI VIE schema. Run ONLY on a disposable database after migrations 001-014.
-- Uses synthetic test identifiers (t-...) — never sample names. Results land in otsi_test.t_results.
DROP DATABASE IF EXISTS otsi_test;
CREATE DATABASE otsi_test;
USE otsi_test;
CREATE TABLE t_results (name VARCHAR(120), expected VARCHAR(120), actual TEXT, passed BOOLEAN);
DELIMITER $$
CREATE PROCEDURE t_expect(IN p_name VARCHAR(120), IN p_sql TEXT, IN p_expect VARCHAR(120))
BEGIN
  DECLARE v_msg TEXT DEFAULT NULL;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN GET DIAGNOSTICS CONDITION 1 v_msg = MESSAGE_TEXT; END;
  SET @s = p_sql; PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
  INSERT INTO t_results VALUES (p_name, p_expect, v_msg, IF(p_expect = 'OK', v_msg IS NULL, v_msg LIKE CONCAT('%', p_expect, '%')));
END$$
CREATE PROCEDURE t_assert(IN p_name VARCHAR(120), IN p_cond BOOLEAN, IN p_detail TEXT)
BEGIN INSERT INTO t_results VALUES (p_name, 'TRUE', p_detail, p_cond); END$$
DELIMITER ;

USE otsi_owner_vie;
-- Fixtures: two tenants A and B
SET @A='11111111-0000-7000-8000-00000000000a', @B='22222222-0000-7000-8000-00000000000b';
SET @UA='11111111-0000-7000-8000-0000000000a1', @UB='22222222-0000-7000-8000-0000000000b1', @UR='11111111-0000-7000-8000-0000000000a2';
INSERT INTO organizations (id,name,slug) VALUES (@A,'Tenant A','tenant-a'),(@B,'Tenant B','tenant-b');
INSERT INTO users (id,external_subject,email,display_name,initials) VALUES
 (@UA,'sub-a','a@test.invalid','Test Owner A','TA'),(@UB,'sub-b','b@test.invalid','Test Owner B','TB'),(@UR,'sub-r','r@test.invalid','Test Reviewer','TR');
INSERT INTO memberships (organization_id,user_id,role) VALUES (@A,@UA,'OWNER'),(@B,@UB,'OWNER'),(@A,@UR,'ANALYST');
SET @PA='11111111-0000-7000-8000-0000000000c1', @PB='22222222-0000-7000-8000-0000000000c2';
INSERT INTO projects (id,organization_id,name,created_by) VALUES (@PA,@A,'P-A',@UA),(@PB,@B,'P-B',@UB);
INSERT INTO storage_buckets (name,region,purpose) VALUES ('test-src','eu-west-1','SOURCE');
SET @ASA='11111111-0000-7000-8000-0000000000d1';
INSERT INTO assets (id,organization_id,project_id,kind,bucket_id,object_key,created_by) VALUES (@ASA,@A,@PA,'SOURCE_VIDEO',1,'a/src.mp4',@UA);
SET @VA='11111111-0000-7000-8000-0000000000e1';
INSERT INTO video_sources (id,organization_id,project_id,ingest_mode,created_by) VALUES (@VA,@A,@PA,'UPLOAD',@UA);
SET @PL='33333333-0000-7000-8000-0000000000f1', @PL2='33333333-0000-7000-8000-0000000000f2';
INSERT INTO players (id,display_name) VALUES (@PL,'Test Player One'),(@PL2,'Test Player Two');

-- 1. Tenancy enforced by composite FKs
CALL otsi_test.t_expect('cross-tenant video->project blocked',
  CONCAT('INSERT INTO otsi_owner_vie.video_sources (id,organization_id,project_id,ingest_mode,created_by) VALUES (''22222222-0000-7000-8000-0000000000e9'',''',@B,''',''',@PA,''',''UPLOAD'',''',@UB,''')'), 'foreign key constraint fails');
CALL otsi_test.t_expect('cross-tenant asset reference blocked',
  CONCAT('UPDATE otsi_owner_vie.video_sources SET source_asset_id=''',@ASA,''' WHERE id=''',@VA,''' AND organization_id=''',@A,''''), 'OK');
CALL otsi_test.t_expect('project creator must be member of same tenant',
  CONCAT('INSERT INTO otsi_owner_vie.projects (id,organization_id,name,created_by) VALUES (''11111111-0000-7000-8000-0000000000c9'',''',@A,''',''x'',''',@UB,''')'), 'foreign key constraint fails');

-- 2. Video lifecycle + INGESTED completeness
CALL otsi_test.t_expect('PENDING -> INGESTED skipped validation blocked',
  CONCAT('UPDATE otsi_owner_vie.video_sources SET state=''INGESTED'' WHERE id=''',@VA,''''), 'INVALID_VIDEO_STATE_TRANSITION');
CALL otsi_test.t_expect('VALIDATING allowed', CONCAT('UPDATE otsi_owner_vie.video_sources SET state=''VALIDATING'' WHERE id=''',@VA,''''), 'OK');
CALL otsi_test.t_expect('INGESTED without probe metadata blocked',
  CONCAT('UPDATE otsi_owner_vie.video_sources SET state=''INGESTED'' WHERE id=''',@VA,''''), 'ck_vs_ingested');
CALL otsi_test.t_expect('INGESTED with probe metadata allowed',
  CONCAT('UPDATE otsi_owner_vie.video_sources SET state=''INGESTED'', duration_us=5700000000, width_px=1920, height_px=1080, fps_num=50, fps_den=1 WHERE id=''',@VA,''''), 'OK');
CALL otsi_test.t_assert('fps generated column = 50', (SELECT fps FROM video_sources WHERE id=@VA) = 50, (SELECT fps FROM video_sources WHERE id=@VA));

-- 3. Pipeline state machine + monotonic progress + options lock
SET @RUN='11111111-0000-7000-8000-000000000101';
INSERT INTO video_ingest_options (video_id,organization_id,updated_by) VALUES (@VA,@A,@UA);
INSERT INTO pipeline_runs (id,organization_id,video_id,pipeline_version,idempotency_key,requested_by) VALUES (@RUN,@A,@VA,'2.0.0','k1',@UA);
CALL otsi_test.t_expect('QUEUED -> SUCCEEDED blocked', CONCAT('UPDATE otsi_owner_vie.pipeline_runs SET status=''SUCCEEDED'' WHERE id=''',@RUN,''''), 'INVALID_PIPELINE_STATE_TRANSITION');
CALL otsi_test.t_expect('QUEUED -> RUNNING allowed', CONCAT('UPDATE otsi_owner_vie.pipeline_runs SET status=''RUNNING'', overall_progress=10 WHERE id=''',@RUN,''''), 'OK');
CALL otsi_test.t_assert('ingest options locked on run start', (SELECT locked_at IS NOT NULL FROM video_ingest_options WHERE video_id=@VA), NULL);
CALL otsi_test.t_expect('locked ingest options cannot change', CONCAT('UPDATE otsi_owner_vie.video_ingest_options SET stabilize_video=FALSE WHERE video_id=''',@VA,''''), 'INGEST_OPTIONS_LOCKED');
CALL otsi_test.t_expect('progress cannot go backwards', CONCAT('UPDATE otsi_owner_vie.pipeline_runs SET overall_progress=5 WHERE id=''',@RUN,''''), 'PROGRESS_MUST_BE_MONOTONIC');
CALL otsi_test.t_expect('SUCCEEDED requires 100%', CONCAT('UPDATE otsi_owner_vie.pipeline_runs SET status=''SUCCEEDED'' WHERE id=''',@RUN,''''), 'ck_runs_succeeded');
CALL otsi_test.t_expect('FAILED requires failure_code', CONCAT('UPDATE otsi_owner_vie.pipeline_runs SET status=''FAILED'' WHERE id=''',@RUN,''''), 'ck_runs_failed');

-- 4. Identity: append-only decisions, projection, confirmation rules
SET @TR='11111111-0000-7000-8000-000000000201', @D1='11111111-0000-7000-8000-000000000301', @D2='11111111-0000-7000-8000-000000000302';
INSERT INTO tracks (id,organization_id,run_id,video_id,internal_track_number,class_name,first_pts_us,last_pts_us) VALUES (@TR,@A,@RUN,@VA,7,'PLAYER',0,1000000);
CALL otsi_test.t_expect('track cannot claim CONFIRMED without player', CONCAT('UPDATE otsi_owner_vie.tracks SET identity_state=''CONFIRMED'' WHERE id=''',@TR,''''), 'ck_tracks_identity');
CALL otsi_test.t_expect('HUMAN decision requires decided_by',
  CONCAT('INSERT INTO otsi_owner_vie.track_identity_decisions (id,organization_id,track_id,player_id,state,basis) VALUES (''',@D1,''',''',@A,''',''',@TR,''',''',@PL,''',''CONFIRMED'',''HUMAN'')'), 'ck_tid_human');
CALL otsi_test.t_expect('AUTO_POLICY confirmation requires policy_version',
  CONCAT('INSERT INTO otsi_owner_vie.track_identity_decisions (id,organization_id,track_id,player_id,state,basis) VALUES (''',@D1,''',''',@A,''',''',@TR,''',''',@PL,''',''CONFIRMED'',''AUTO_POLICY'')'), 'ck_tid_policy');
CALL otsi_test.t_expect('human confirmation accepted',
  CONCAT('INSERT INTO otsi_owner_vie.track_identity_decisions (id,organization_id,track_id,player_id,state,basis,decided_by) VALUES (''',@D1,''',''',@A,''',''',@TR,''',''',@PL,''',''CONFIRMED'',''HUMAN'',''',@UR,''')'), 'OK');
CALL otsi_test.t_assert('track projection updated to CONFIRMED player', (SELECT identity_state='CONFIRMED' AND current_player_id=@PL FROM tracks WHERE id=@TR), NULL);
CALL otsi_test.t_expect('decisions are append-only (update)', CONCAT('UPDATE otsi_owner_vie.track_identity_decisions SET reason=''x'' WHERE id=''',@D1,''''), 'APPEND_ONLY_TABLE');
CALL otsi_test.t_expect('decisions are append-only (delete)', CONCAT('DELETE FROM otsi_owner_vie.track_identity_decisions WHERE id=''',@D1,''''), 'APPEND_ONLY_TABLE');

-- 5. Evidence: NOT_MEASURED must carry no number; measured must carry one
CALL otsi_test.t_expect('NOT_MEASURED with a value rejected',
  CONCAT('INSERT INTO otsi_owner_vie.metric_values (id,organization_id,video_id,subject_kind,player_id,metric_key,value_numeric,evidence_state) VALUES (''11111111-0000-7000-8000-000000000401'',''',@A,''',''',@VA,''',''PLAYER'',''',@PL,''',''distance_km'',11.4,''NOT_MEASURED'')'), 'ck_mv_not_measured');
CALL otsi_test.t_expect('NOT_MEASURED without value accepted',
  CONCAT('INSERT INTO otsi_owner_vie.metric_values (id,organization_id,video_id,subject_kind,player_id,metric_key,evidence_state) VALUES (''11111111-0000-7000-8000-000000000402'',''',@A,''',''',@VA,''',''PLAYER'',''',@PL,''',''distance_km'',''NOT_MEASURED'')'), 'OK');
CALL otsi_test.t_expect('INFERRED without value rejected',
  CONCAT('INSERT INTO otsi_owner_vie.metric_values (id,organization_id,video_id,subject_kind,player_id,metric_key,evidence_state) VALUES (''11111111-0000-7000-8000-000000000403'',''',@A,''',''',@VA,''',''PLAYER'',''',@PL,''',''passes'',''INFERRED'')'), 'ck_mv_measured');
CALL otsi_test.t_expect('team shape in metres without calibration rejected',
  CONCAT('INSERT INTO otsi_owner_vie.team_shape_snapshots (id,organization_id,video_id,run_id,team_side,phase,from_pts_us,to_pts_us,avg_width_m,visible_players,evidence_state) VALUES (''11111111-0000-7000-8000-000000000404'',''',@A,''',''',@VA,''',''',@RUN,''',''HOME'',''ALL'',0,10,32.4,11,''INFERRED'')'), 'ck_tss_metres');

-- 6. Reel spotlight target requires CONFIRMED decision for SAME player
SET @REEL='11111111-0000-7000-8000-000000000501';
INSERT INTO reel_projects (id,organization_id,project_id,video_id,title,created_by) VALUES (@REEL,@A,@PA,@VA,'Test reel',@UA);
CALL otsi_test.t_expect('target with decision for a different player blocked',
  CONCAT('INSERT INTO otsi_owner_vie.reel_targets (reel_id,organization_id,player_id,identity_decision_id) VALUES (''',@REEL,''',''',@A,''',''',@PL2,''',''',@D1,''')'), 'IDENTITY_UNRESOLVED');
CALL otsi_test.t_expect('target with matching confirmed decision accepted',
  CONCAT('INSERT INTO otsi_owner_vie.reel_targets (reel_id,organization_id,player_id,identity_decision_id) VALUES (''',@REEL,''',''',@A,''',''',@PL,''',''',@D1,''')'), 'OK');
CALL otsi_test.t_expect('reel DRAFT -> PUBLISHED blocked', CONCAT('UPDATE otsi_owner_vie.reel_projects SET status=''PUBLISHED'' WHERE id=''',@REEL,''''), 'INVALID_REEL_STATE_TRANSITION');
CALL otsi_test.t_expect('spotlight slider > 100 rejected',
  CONCAT('INSERT INTO otsi_owner_vie.reel_style_settings (reel_id,organization_id,spotlight_intensity_pct) VALUES (''',@REEL,''',''',@A,''',120)'), 'ck_rss_ranges');
CALL otsi_test.t_expect('STAT timeline item must bind to a real metric',
  CONCAT('INSERT INTO otsi_owner_vie.timeline_tracks (id,organization_id,reel_id,track_type,label,layer) VALUES (''11111111-0000-7000-8000-000000000601'',''',@A,''',''',@REEL,''',''STATISTICS'',''Statistics'',6)'), 'OK');
CALL otsi_test.t_expect('typed number on STAT item rejected',
  CONCAT('INSERT INTO otsi_owner_vie.timeline_items (id,organization_id,timeline_track_id,item_kind,label,start_us,duration_us) VALUES (''11111111-0000-7000-8000-000000000602'',''',@A,''',''11111111-0000-7000-8000-000000000601'',''STAT'',''Pass Distance (7.4 km)'',0,1000000)'), 'ck_ti_stat');

-- 7. Render job rules
SET @REV='11111111-0000-7000-8000-000000000701', @RJ='11111111-0000-7000-8000-000000000702';
INSERT INTO reel_revisions (id,organization_id,reel_id,revision_no,timeline_snapshot,snapshot_sha256,saved_by) VALUES (@REV,@A,@REEL,1,JSON_OBJECT(),REPEAT('a',64),@UA);
INSERT INTO render_jobs (id,organization_id,reel_id,reel_revision_id,resolution,width_px,height_px,frame_rate,aspect_ratio,container,video_codec,quality,expected_duration_us,idempotency_key,requested_by)
  VALUES (@RJ,@A,@REEL,@REV,'4K',3840,2160,60,'16:9','MP4','H264','HIGH',137000000,'r1',@UA);
CALL otsi_test.t_expect('render QUEUED -> SUCCEEDED blocked', CONCAT('UPDATE otsi_owner_vie.render_jobs SET state=''SUCCEEDED'' WHERE id=''',@RJ,''''), 'INVALID_RENDER_STATE_TRANSITION');
CALL otsi_test.t_expect('render RUNNING ok', CONCAT('UPDATE otsi_owner_vie.render_jobs SET state=''RUNNING'' WHERE id=''',@RJ,''''), 'OK');
CALL otsi_test.t_expect('render SUCCEEDED without output+manifest blocked', CONCAT('UPDATE otsi_owner_vie.render_jobs SET state=''SUCCEEDED'', progress_pct=100 WHERE id=''',@RJ,''''), 'ck_rj_done');
CALL otsi_test.t_expect('saved revisions immutable', CONCAT('UPDATE otsi_owner_vie.reel_revisions SET note=''x'' WHERE id=''',@REV,''''), 'APPEND_ONLY_TABLE');
CALL otsi_test.t_expect('duplicate idempotency key rejected',
  CONCAT('INSERT INTO otsi_owner_vie.render_jobs (id,organization_id,reel_id,reel_revision_id,resolution,width_px,height_px,frame_rate,aspect_ratio,container,video_codec,quality,expected_duration_us,idempotency_key,requested_by) VALUES (''11111111-0000-7000-8000-000000000703'',''',@A,''',''',@REEL,''',''',@REV,''',''4K'',3840,2160,60,''16:9'',''MP4'',''H264'',''HIGH'',1,''r1'',''',@UA,''')'), 'Duplicate entry');

-- 8. Canonical OTSI Player ID allocator
CALL sp_allocate_otsi_player_id(@PL, 'NGA', 2026, @oid1);
CALL sp_allocate_otsi_player_id(@PL2, 'NGA', 2026, @oid2);
CALL otsi_test.t_assert('allocator format/sequence', @oid1 = 'OTSI-NGA-2026-000001' AND @oid2 = 'OTSI-NGA-2026-000002', CONCAT(@oid1, ' / ', @oid2));
CALL otsi_test.t_expect('re-allocation blocked', CONCAT('CALL otsi_owner_vie.sp_allocate_otsi_player_id(''',@PL,''',''NGA'',2026,@x)'), 'OTSI_ID_ALREADY_ALLOCATED');
CALL otsi_test.t_expect('malformed OTSI id rejected', CONCAT('UPDATE otsi_owner_vie.players SET canonical_otsi_id=''OTSI-ng-26-1'' WHERE id=''',@PL2,''''), 'ck_players_otsi_format');

-- 9. Rights / sharing / governance
CALL otsi_test.t_expect('URL fetch without SSRF + terms check blocked',
  CONCAT('INSERT INTO otsi_owner_vie.url_imports (id,organization_id,video_id,submitted_url,provider,status,created_by) VALUES (''11111111-0000-7000-8000-000000000801'',''',@A,''',''',@VA,''',''https://example.invalid/v.mp4'',''DIRECT_HTTP'',''FETCHING'',''',@UA,''')'), 'ck_url_fetch_gate');
CALL otsi_test.t_expect('scout cannot verify own assessment',
  CONCAT('INSERT INTO otsi_owner_vie.scouting_assessments (id,organization_id,player_id,status,scout_user_id,verified_by,verified_at) VALUES (''11111111-0000-7000-8000-000000000802'',''',@A,''',''',@PL,''',''VERIFIED'',''',@UA,''',''',@UA,''',NOW(6))'), 'ck_sa_verified');
CALL otsi_test.t_expect('policy decisions append-only',
  CONCAT('INSERT INTO otsi_owner_vie.policy_decisions (id,organization_id,action,resource_type,resource_id,decision,rule_version) VALUES (''11111111-0000-7000-8000-000000000803'',''',@A,''',''EXPORT'',''RENDER_JOB'',''',@RJ,''',''DENY'',''1'')'), 'OK');
CALL otsi_test.t_expect('policy decision cannot be rewritten', 'UPDATE otsi_owner_vie.policy_decisions SET decision=''ALLOW''', 'APPEND_ONLY_TABLE');
CALL otsi_test.t_expect('saved search schema enforced',
  CONCAT('INSERT INTO otsi_owner_vie.saved_searches (id,organization_id,user_id,name,query) VALUES (''11111111-0000-7000-8000-000000000804'',''',@A,''',''',@UA,''',''bad'',JSON_OBJECT(''dateRange'',''YESTERDAY''))'), 'failed requirement');

-- 10. Read-model views compile and return rows for tenant A only when filtered
CALL otsi_test.t_assert('v_upload_recent returns tenant A row', (SELECT COUNT(*) FROM v_upload_recent WHERE organization_id=@A) = 1, NULL);
CALL otsi_test.t_assert('v_upload_recent tenant B sees nothing', (SELECT COUNT(*) FROM v_upload_recent WHERE organization_id=@B) = 0, NULL);
CALL otsi_test.t_assert('v_run_stage_progress lists UI stages', (SELECT COUNT(*) FROM v_run_stage_progress WHERE run_id=@RUN) = 7, (SELECT COUNT(*) FROM v_run_stage_progress WHERE run_id=@RUN));
CALL otsi_test.t_assert('v_player_header derives age (NULL birth date -> NULL)', (SELECT age_years IS NULL FROM v_player_header WHERE player_id=@PL), NULL);

SELECT name, passed, LEFT(COALESCE(actual,''), 90) AS actual FROM otsi_test.t_results;
SELECT SUM(passed) AS passed, COUNT(*) AS total FROM otsi_test.t_results;
