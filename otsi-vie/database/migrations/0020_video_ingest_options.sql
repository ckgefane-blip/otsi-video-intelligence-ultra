-- 0020 per-video ingest options and the server-side automatic analysis (OTSI VIE v2, MySQL 8.4) — Page 02 left panel, 2026-10-29
-- The 14 switches of Upload & Ingest are a REQUEST that belongs to the video, not a preference of one browser tab: they are saved with the
-- upload or link import, and "Send to Analysis" is carried out by the server (the outbox subscriber jobs.auto_analysis) when the video is
-- verified, whether or not the page is still open. Source: the owner's blueprint table `video_ingest_options` (02_BACKEND_MYSQL_BLUEPRINT,
-- sql_src/004), adapted to this schema (composite tenant FK, no ID36/TS6 macros).
-- Only `stabilize_video` and `send_to_analysis` are choices this engine offers today. The other twelve columns record what the engine
-- really does for every video (TRUE: players and teams, ball tracking, jersey numbers, metadata extraction) or does not do yet (FALSE:
-- auto crop, enhance, crowd noise, aspect correction, pitch lines, event markers, auto-create match, highlights); the server writes them,
-- never the client, so the row never claims a processing step that did not happen.
-- Forward-only: no existing row is changed.
CREATE TABLE `video_ingest_options` (
  `video_id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `stabilize_video` BOOLEAN NOT NULL,
  `auto_crop_pitch` BOOLEAN NOT NULL DEFAULT FALSE,
  `enhance_quality` BOOLEAN NOT NULL DEFAULT FALSE,
  `remove_crowd_noise` BOOLEAN NOT NULL DEFAULT FALSE,
  `correct_aspect_ratio` BOOLEAN NOT NULL DEFAULT FALSE,
  `overlay_players_teams` BOOLEAN NOT NULL DEFAULT TRUE,
  `overlay_ball_tracking` BOOLEAN NOT NULL DEFAULT TRUE,
  `overlay_jersey_numbers` BOOLEAN NOT NULL DEFAULT TRUE,
  `overlay_pitch_lines` BOOLEAN NOT NULL DEFAULT FALSE,
  `overlay_event_markers` BOOLEAN NOT NULL DEFAULT FALSE,
  `auto_create_match` BOOLEAN NOT NULL DEFAULT FALSE,
  `extract_metadata` BOOLEAN NOT NULL DEFAULT TRUE,
  `generate_highlights` BOOLEAN NOT NULL DEFAULT FALSE,
  `send_to_analysis` BOOLEAN NOT NULL,
  `created_by` CHAR(36) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  -- what the server did about "Send to Analysis" once the video was verified (decided exactly once)
  `auto_outcome` VARCHAR(12) NULL,
  `auto_run_id` CHAR(36) NULL,
  `auto_detail` VARCHAR(255) NULL,
  `auto_decided_at` DATETIME(6) NULL,
  CONSTRAINT `fk_ingest_options_video` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`),
  CONSTRAINT `fk_ingest_options_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_ingest_options_outcome` CHECK (`auto_outcome` IS NULL OR `auto_outcome` IN ('STARTED', 'SKIPPED')),
  CONSTRAINT `ck_ingest_options_decided` CHECK ((`auto_outcome` IS NULL) = (`auto_decided_at` IS NULL)),
  CONSTRAINT `ck_ingest_options_started_has_run` CHECK (`auto_outcome` <> 'STARTED' OR `auto_run_id` IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
