-- 0045 Job system v2 (OTSI VIE v2, MySQL 8.4) - 2026-11-06, ADR-060
-- v3 Phase A.2. Every engine job (ingest, playback copy, assessment, analysis, ball, pitch, lineups, render) is one worker_jobs row; this
-- adds what a person needs to manage them from the top-bar job tray:
--   priority      1 (first) .. 9 (last), default 5; the worker takes the highest priority first, then the oldest
--   PAUSED        a waiting job held back by a person; the worker never claims it; Resume puts it back in the queue
--   paused_at/by  who held it last and when (both or neither; kept after Resume as the last hold)
-- Who asked for a job is read from the row it works on (a render's, an assessment's, ... requested_by); it is not copied here.
-- A per-organization cap on running jobs is enforced by the worker's claim (OTSI_VIE_ORG_MAX_RUNNING), not by a constraint.
-- Forward-only: new nullable / defaulted columns, a widened state CHECK, new indexes.
ALTER TABLE `worker_jobs`
  ADD COLUMN `priority` TINYINT UNSIGNED NOT NULL DEFAULT 5 AFTER `state`,
  ADD COLUMN `paused_at` DATETIME(6) NULL AFTER `finished_at`,
  ADD COLUMN `paused_by` CHAR(36) NULL AFTER `paused_at`;

ALTER TABLE `worker_jobs` DROP CHECK `ck_worker_jobs_state`;
ALTER TABLE `worker_jobs` ADD CONSTRAINT `ck_worker_jobs_state` CHECK (`state` IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PAUSED'));
ALTER TABLE `worker_jobs` ADD CONSTRAINT `ck_worker_jobs_priority` CHECK (`priority` BETWEEN 1 AND 9);
ALTER TABLE `worker_jobs` ADD CONSTRAINT `ck_worker_jobs_paused_pair` CHECK ((`state` <> 'PAUSED' OR `paused_at` IS NOT NULL) AND (`paused_at` IS NULL) = (`paused_by` IS NULL));

-- the claim reads waiting jobs by priority, then age; the tray reads one organization's jobs by state and age
CREATE INDEX `idx_worker_jobs_queue` ON `worker_jobs` (`state`, `priority`, `created_at`);
CREATE INDEX `idx_worker_jobs_org_state` ON `worker_jobs` (`organization_id`, `state`, `created_at`);
