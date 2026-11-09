-- Migration 013 — Reference/configuration seed ONLY. No players, clubs, matches, metrics values or other sample data.
-- Countries (ISO 3166-1) must be bulk-loaded from an authoritative source by the ops script, not hand-typed.
USE `otsi_owner_vie`;

INSERT INTO organizations (id, name, slug, org_type) VALUES
 ('00000000-0000-7000-8000-000000000000', 'OTSI Platform', 'otsi-platform', 'INTERNAL');

INSERT INTO positions (code, label, line, sort_order) VALUES
 ('GK','Goalkeeper','GOALKEEPER',1),('RB','Right Back','DEFENDER',2),('CB','Centre Back','DEFENDER',3),('LB','Left Back','DEFENDER',4),
 ('RWB','Right Wing Back','DEFENDER',5),('LWB','Left Wing Back','DEFENDER',6),('DM','Defensive Midfielder','MIDFIELDER',7),
 ('MC','Midfielder','MIDFIELDER',8),('AM','Attacking Midfielder','MIDFIELDER',9),('RM','Right Midfielder','MIDFIELDER',10),
 ('LM','Left Midfielder','MIDFIELDER',11),('RW','Right Winger','FORWARD',12),('LW','Left Winger','FORWARD',13),
 ('SS','Second Striker','FORWARD',14),('CF','Centre Forward','FORWARD',15);

-- 02 Supported Formats panel (exact order and captions from the approved UI)
INSERT INTO supported_media_formats (container_code, display_name, codec_summary, mime_types, file_extensions, display_order) VALUES
 ('MP4','MP4','H.264/H.265', JSON_ARRAY('video/mp4'), JSON_ARRAY('.mp4','.m4v'), 1),
 ('MOV','MOV','Apple ProRes', JSON_ARRAY('video/quicktime'), JSON_ARRAY('.mov'), 2),
 ('AVI','AVI','H.264', JSON_ARRAY('video/x-msvideo'), JSON_ARRAY('.avi'), 3),
 ('MKV','MKV','H.264/H.265', JSON_ARRAY('video/x-matroska'), JSON_ARRAY('.mkv'), 4),
 ('MPEG','MPEG','MPEG-2', JSON_ARRAY('video/mpeg'), JSON_ARRAY('.mpg','.mpeg'), 5),
 ('FLV','FLV','H.264', JSON_ARRAY('video/x-flv'), JSON_ARRAY('.flv'), 6),
 ('TS','TS','MPEG-TS', JSON_ARRAY('video/mp2t'), JSON_ARRAY('.ts','.m2ts'), 7),
 ('WEBM','WEBM','VP9', JSON_ARRAY('video/webm'), JSON_ARRAY('.webm'), 8);

-- Stage cards: 02 shows UPLOADING, AI Detection, Tracking, Indexing, Analysis Ready; 03 shows the five AI stages.
-- UPLOADING progress is read from upload_sessions.progress_pct (not from a pipeline step).
INSERT INTO pipeline_stage_definitions (code, engine_step, ui_surface, ui_order, label, description, timeline_color_hex, weight) VALUES
 ('UPLOADING',      'VALIDATE',  'UPLOAD_PIPELINE',     1, 'Uploading',            'Transferring and verifying the source file.',            NULL,      5),
 ('TRANSCODE',      'TRANSCODE', 'INTERNAL',            0, 'Transcode',            'Proxy and HLS renditions.',                              NULL,      5),
 ('CLASSIFY',       'CLASSIFY',  'INTERNAL',            0, 'Classify',             'Detect video content type.',                             NULL,      2),
 ('SHOTS',          'SHOTS',     'INTERNAL',            0, 'Shots',                'Camera-cut segmentation and pitch calibration.',         NULL,      5),
 ('DETECTION',      'DETECT',    'BOTH',                2, 'Detection',            'Detect players, ball, referees and key objects in each frame.', '#19e6c0', 20),
 ('TRACKING',       'TRACK',     'BOTH',                3, 'Tracking',             'Track objects across frames with consistent IDs.',       '#1a8cff', 20),
 ('IDENTITY',       'IDENTIFY',  'PROCESSING_PIPELINE', 4, 'Identity Resolution',  'Assign player identities, team, and jersey numbers.',    '#8a5cff', 15),
 ('EVENTS',         'EVENTS',    'PROCESSING_PIPELINE', 5, 'Event Detection',      'Detect passes, shots, tackles, and key events.',         '#ffb21a', 15),
 ('TACTICS',        'TACTICS',   'INTERNAL',            0, 'Tactics',              'Team shape, networks, heat maps.',                       NULL,      5),
 ('INDEXING',       'INDEX',     'BOTH',                6, 'Indexing',             'Create searchable metadata, clips and analytics.',       '#6b7a92', 5),
 ('QUALITY',        'QUALITY',   'INTERNAL',            0, 'Quality',              'Coverage and confidence gates.',                         NULL,      2),
 ('ANALYSIS_READY', 'FINISH',    'UPLOAD_PIPELINE',     7, 'Analysis Ready',       'Video ready for analysis and highlights.',               NULL,      1);

INSERT INTO event_types (code, label, chip_group, lane_group, marker_group, color_hex, icon_key, is_ball_event, sort_order) VALUES
 ('GOAL',              'Goal',             'GOALS',         'GOALS',      NULL,      '#a066ff', 'star',   TRUE, 1),
 ('SHOT_ATTEMPT',      'Shot',             'SHOTS',         'SHOTS',      'SHOT',    '#ff2a2a', 'burst',  TRUE, 2),
 ('SHOT_ON_TARGET',    'Shot on Target',   'SHOTS',         'SHOTS',      'SHOT',    '#ff2a2a', 'burst',  TRUE, 3),
 ('KEY_PASS',          'Key Pass',         'KEY_PASSES',    'KEY_PASSES', 'PASS',    '#f5b82e', 'key',    TRUE, 4),
 ('ASSIST',            'Assist',           'KEY_PASSES',    'KEY_PASSES', 'PASS',    '#f5b82e', 'star',   TRUE, 5),
 ('PASS_ATTEMPT',      'Pass',             'PASSES',        'PASSES',     'PASS',    '#1e90ff', 'person', TRUE, 6),
 ('PASS_RECEIVED',     'Pass Received',    NULL,            'PASSES',     NULL,      '#1e90ff', 'person', TRUE, 7),
 ('PROGRESSIVE_PASS',  'Progressive Pass', 'PASSES',        'PASSES',     'PASS',    '#1e90ff', 'person', TRUE, 8),
 ('DRIBBLE_CARRY',     'Carry',            NULL,            'PASSES',     NULL,      '#33a8ff', 'tri',    TRUE, 9),
 ('DUEL',              'Duel',             NULL,            'DUELS',      NULL,      '#ffb21a', NULL,     TRUE, 10),
 ('TACKLE_ATTEMPT',    'Tackle',           'TACKLES',       'DEFENSIVE',  'TACKLE',  '#ffc41a', NULL,     TRUE, 11),
 ('INTERCEPTION',      'Interception',     'INTERCEPTIONS', 'DEFENSIVE',  NULL,      '#ff4a4a', NULL,     TRUE, 12),
 ('BALL_RECOVERY',     'Recovery',         NULL,            'DEFENSIVE',  NULL,      '#19e6a0', NULL,     TRUE, 13),
 ('PRESSURE',          'Pressing Event',   NULL,            'DEFENSIVE',  NULL,      '#2b7bff', NULL,     FALSE, 14),
 ('FORCED_TURNOVER',   'Forced Turnover',  NULL,            'DEFENSIVE',  NULL,      '#ff3a3a', NULL,     TRUE, 15),
 ('FOUL',              'Foul',             'FOULS',         'DEFENSIVE',  'FOUL',    '#ff8a1a', NULL,     FALSE, 16),
 ('CARD_YELLOW',       'Yellow Card',      'CARDS',         NULL,         NULL,      '#ffd21a', NULL,     FALSE, 17),
 ('CARD_RED',          'Red Card',         'CARDS',         NULL,         NULL,      '#ff2a2a', NULL,     FALSE, 18),
 ('OFFSIDE_CANDIDATE', 'Offside',          NULL,            NULL,         'OFFSIDE', '#d63aff', NULL,     FALSE, 19),
 ('SET_PIECE',         'Set Piece',        NULL,            NULL,         NULL,      '#6b7a92', NULL,     TRUE, 20),
 ('POSSESSION_CHANGE', 'Possession Change',NULL,            NULL,         NULL,      '#6b7a92', NULL,     TRUE, 21);

INSERT INTO metric_definitions (metric_key, label, unit, display_decimals, aggregation, subject_kind, measurement_class, requires_calibration, minimum_quality, higher_is_better, per90_supported, formula_version, description) VALUES
 ('match_minutes','Match Minutes','min',0,'SUM','PLAYER','OBSERVED_EVENT',FALSE,0,NULL,FALSE,'1','Minutes on pitch from roster/substitution data; coverage shown as share of match observed on camera.'),
 ('visible_duration_s','Visible Duration','s',0,'SUM','PLAYER','PIXEL',FALSE,0,NULL,FALSE,'1','Observed on-screen time from track intervals (off-camera time not counted).'),
 ('tracking_coverage','Tracking Coverage','%',0,'RATIO','PLAYER','PIXEL',FALSE,0,TRUE,FALSE,'1','Observed frames / eligible frames for the track (identity not implied).'),
 ('distance_km','Distance (Est.)','km',1,'SUM','PLAYER','PITCH_CALIBRATED',TRUE,0.7,NULL,TRUE,'1','Calibrated ground-plane distance; NOT_MEASURED when calibration/coverage insufficient.'),
 ('top_speed_kmh','Top Speed','km/h',1,'MAX','PLAYER','PITCH_CALIBRATED',TRUE,0.8,TRUE,FALSE,'1','Max filtered speed over calibrated segments.'),
 ('sprints','Sprints','count',0,'SUM','PLAYER','PITCH_CALIBRATED',TRUE,0.8,TRUE,TRUE,'1','Efforts above 25.2 km/h for >= 1 s (definition versioned).'),
 ('passes','Passes','count',0,'SUM','PLAYER','OBSERVED_EVENT',FALSE,0,TRUE,TRUE,'1','Pass attempts from event candidates (INFERRED until reviewed).'),
 ('pass_accuracy_pct','Pass Accuracy','%',0,'RATIO','PLAYER','OBSERVED_EVENT',FALSE,0,TRUE,FALSE,'1','Completed / attempted passes; requires receiver interpretation.'),
 ('key_passes','Key Passes','count',0,'SUM','PLAYER','OBSERVED_EVENT',FALSE,0,TRUE,TRUE,'1','Passes immediately preceding a shot.'),
 ('shots','Shots','count',0,'SUM','PLAYER','OBSERVED_EVENT',FALSE,0,TRUE,TRUE,'1','Shot attempts.'),
 ('xg','xG','xG',2,'MODEL','PLAYER','MODEL_ESTIMATE',FALSE,0,TRUE,TRUE,'1','Expected goals from a validated model with dataset card; hidden if no approved model.'),
 ('xa','xA','xA',2,'MODEL','PLAYER','MODEL_ESTIMATE',FALSE,0,TRUE,TRUE,'1','Expected assists from a validated model; never inferred from pass counts.'),
 ('touches','Touches','count',0,'SUM','PLAYER','OBSERVED_EVENT',FALSE,0,NULL,TRUE,'1','Ball contacts from event candidates.'),
 ('chances_created','Chances Created','count',0,'SUM','PLAYER','OBSERVED_EVENT',FALSE,0,TRUE,TRUE,'1','Key passes + assists.'),
 ('shot_assists','Shot Assists','count',0,'SUM','PLAYER','OBSERVED_EVENT',FALSE,0,TRUE,TRUE,'1','Passes leading directly to a shot.'),
 ('progressive_passes','Progressive Passes','count',0,'SUM','PLAYER','PITCH_CALIBRATED',TRUE,0.7,TRUE,TRUE,'1','Passes moving the ball >= 25% closer to goal (versioned).'),
 ('progressive_carries','Progressive Carries','count',0,'SUM','PLAYER','PITCH_CALIBRATED',TRUE,0.7,TRUE,TRUE,'1','Carries progressing the ball (versioned).'),
 ('shot_creating_actions','Shot Creating Actions','count',0,'SUM','PLAYER','OBSERVED_EVENT',FALSE,0,TRUE,TRUE,'1','Two offensive actions preceding a shot.'),
 ('off_ball_runs','Off-Ball Runs','count',0,'SUM','PLAYER','PITCH_CALIBRATED',TRUE,0.7,TRUE,TRUE,'1','Runs without the ball from movement_segments.'),
 ('progressive_runs','Progressive Runs','count',0,'SUM','PLAYER','PITCH_CALIBRATED',TRUE,0.7,TRUE,TRUE,'1','Off-ball runs gaining ground toward goal.'),
 ('runs_into_box','Runs Into Box','count',0,'SUM','PLAYER','PITCH_CALIBRATED',TRUE,0.7,TRUE,TRUE,'1','Runs ending in the penalty area.'),
 ('avg_run_distance_m','Avg Run Distance','m',1,'AVG','PLAYER','PITCH_CALIBRATED',TRUE,0.7,NULL,FALSE,'1','Mean calibrated run length.'),
 ('possession_pct','Possession','%',0,'RATIO','TEAM','OBSERVED_EVENT',FALSE,0,NULL,FALSE,'1','Share of possession episodes by time.'),
 ('ppda','PPDA','ratio',1,'RATIO','TEAM','OBSERVED_EVENT',FALSE,0,FALSE,FALSE,'1','Opponent passes per defensive action (definition versioned).'),
 ('high_press_success_pct','High Press Success','%',0,'RATIO','TEAM','OBSERVED_EVENT',FALSE,0,TRUE,FALSE,'1','Successful presses in the attacking third.'),
 ('final_third_regains','Final Third Regains','count',0,'SUM','TEAM','OBSERVED_EVENT',FALSE,0,TRUE,FALSE,'1','Ball recoveries in the final third.'),
 ('avg_press_height_m','Avg Press Height','m',1,'AVG','TEAM','PITCH_CALIBRATED',TRUE,0.7,NULL,FALSE,'1','Mean distance of pressing actions from own goal line.');

INSERT INTO export_presets (id, owner_organization_id, name, is_recommended, helper_text, resolution, frame_rate, aspect_ratio, container, video_codec, quality) VALUES
 ('00000000-0000-7000-8000-00000000e001', NULL, 'Highlights Reel', TRUE, 'Optimized for professional analysis and client sharing.', '4K', 60, '16:9', 'MP4', 'H264', 'HIGH'),
 ('00000000-0000-7000-8000-00000000e002', NULL, 'Social Vertical', FALSE, 'Vertical format for Reels and Shorts.', '1080p', 30, '9:16', 'MP4', 'H264', 'HIGH'),
 ('00000000-0000-7000-8000-00000000e003', NULL, 'Square Social', FALSE, 'Square format for social feeds.', '1080p', 30, '1:1', 'MP4', 'H264', 'HIGH');

INSERT INTO effect_presets (id, owner_organization_id, name, effect_family, version, schema_version, config) VALUES
 ('00000000-0000-7000-8000-00000000f001', NULL, 'Fade', 'TRANSITION', '1', '1', JSON_OBJECT('durationUs', 500000)),
 ('00000000-0000-7000-8000-00000000f002', NULL, 'Zoom', 'TRANSITION', '1', '1', JSON_OBJECT('durationUs', 600000, 'scale', 1.2)),
 ('00000000-0000-7000-8000-00000000f003', NULL, 'Spin', 'TRANSITION', '1', '1', JSON_OBJECT('durationUs', 600000, 'degrees', 180)),
 ('00000000-0000-7000-8000-00000000f004', NULL, 'Dissolve', 'TRANSITION', '1', '1', JSON_OBJECT('durationUs', 800000)),
 ('00000000-0000-7000-8000-00000000f005', NULL, 'Spotlight Circle', 'GRAPHIC', '1', '1', JSON_OBJECT('shape', 'ellipse')),
 ('00000000-0000-7000-8000-00000000f006', NULL, 'Pass Trajectory', 'GRAPHIC', '1', '1', JSON_OBJECT('stroke', 'dashed')),
 ('00000000-0000-7000-8000-00000000f007', NULL, 'Player Highlight', 'GRAPHIC', '1', '1', JSON_OBJECT('glow', TRUE)),
 ('00000000-0000-7000-8000-00000000f008', NULL, 'Team Logo', 'GRAPHIC', '1', '1', JSON_OBJECT('requiresLicensedLogo', TRUE)),
 ('00000000-0000-7000-8000-00000000f009', NULL, 'Player ID Lower Third', 'LOWER_THIRD', '1', '1', JSON_OBJECT()),
 ('00000000-0000-7000-8000-00000000f00a', NULL, 'Stat Card', 'STAT_CARD', '1', '1', JSON_OBJECT('bindsToMetric', TRUE)),
 ('00000000-0000-7000-8000-00000000f00b', NULL, 'Key Highlight Text', 'LOWER_THIRD', '1', '1', JSON_OBJECT()),
 ('00000000-0000-7000-8000-00000000f00c', NULL, 'Spotlight Composer v1', 'SPOTLIGHT', '1', '1',
     JSON_OBJECT('intensity', 85, 'rayWidth', 60, 'vignette', 45, 'glow', 55, 'targetLockSensitivity', 72));

INSERT INTO schema_migrations (version, description, checksum_sha256) VALUES
 ('001','foundation identity storage', REPEAT('0',64)),('002','reference registry matches', REPEAT('0',64)),
 ('003','projects library collaboration', REPEAT('0',64)),('004','media ingest rights', REPEAT('0',64)),
 ('005','pipeline cv identity', REPEAT('0',64)),('006','events metrics tactics', REPEAT('0',64)),
 ('007','reels spotlight studio', REPEAT('0',64)),('008','reports scouting', REPEAT('0',64)),
 ('009','render export delivery', REPEAT('0',64)),('010','commercial governance ops', REPEAT('0',64)),
 ('011','triggers procedures', REPEAT('0',64)),('012','ui read model views', REPEAT('0',64)),
 ('013','reference seed', REPEAT('0',64));
-- The migration runner replaces the zero checksums with the real SHA-256 of each file at apply time.
