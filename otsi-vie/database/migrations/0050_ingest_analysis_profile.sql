-- 0050 Upload analysis profile (OTSI VIE v2, MySQL 8.4) - 2026-11-06, ADR-076 (v3 Phase A.10)
-- The profile chosen on Upload for the automatic analysis, saved with the video:
--   RECOMMENDED      the server first checks the footage (an ASSESS job, ADR-034) and analyses with the profile it recommends; with
--                    Stabilize Video on, never below High accuracy; if the check fails, Standard (High accuracy with Stabilize), and says so
--   STANDARD / HIGH_ACCURACY / ULTRA_SENSITIVE   that profile, started as soon as the video is verified
--   NULL             a row saved before this migration: the profile follows Stabilize Video, as before
-- auto_profile records which profile the server used, and auto_detail why (the check's recommendation, or its failure).
-- Forward-only: nullable columns; existing rows keep their meaning.
ALTER TABLE `video_ingest_options`
  ADD COLUMN `analysis_profile` VARCHAR(16) NULL,
  ADD COLUMN `auto_profile` VARCHAR(16) NULL,
  ADD CONSTRAINT `ck_ingest_options_profile` CHECK (`analysis_profile` IS NULL OR `analysis_profile` IN ('RECOMMENDED', 'STANDARD', 'HIGH_ACCURACY', 'ULTRA_SENSITIVE')),
  ADD CONSTRAINT `ck_ingest_options_auto_profile` CHECK (`auto_profile` IS NULL OR `auto_profile` IN ('STANDARD', 'HIGH_ACCURACY', 'ULTRA_SENSITIVE'));
