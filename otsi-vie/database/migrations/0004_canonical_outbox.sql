-- 0004 canonical outbox (OTSI VIE v2, MySQL 8.4) — ADR-012
-- The handoff's sources defined `outbox_events` twice with different column contracts (publishing vs billing); the MySQL conversion kept the
-- first. This ONE table now serves every producer (domain publishing AND billing). No second outbox table exists or may be added.
--   organization_id  the tenant the event belongs to (NULL only for platform-level events); dispatcher scopes SSE/webhooks by it
--   dedupe_key       idempotent producers: the same logical event can be written twice (a replayed billing webhook, a retried request) but is
--                    stored once, e.g. 'billing:stripe:evt_123:subscription.activated'. NULL = the producer needs no de-duplication.
--   available_at     the dispatcher only claims rows whose time has come (retry back-off without busy loops)
--   last_error       the last dispatch failure, kept for operators; never contains secrets
ALTER TABLE `outbox_events`
  ADD COLUMN `organization_id` CHAR(36) NULL AFTER `id`,
  ADD COLUMN `dedupe_key` VARCHAR(191) NULL AFTER `event_payload`,
  ADD COLUMN `available_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) AFTER `created_at`,
  ADD COLUMN `last_error` VARCHAR(1000) NULL AFTER `attempt_count`,
  ADD CONSTRAINT `uq_outbox_dedupe` UNIQUE (`dedupe_key`),
  ADD CONSTRAINT `fk_outbox_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  ADD CONSTRAINT `ck_outbox_attempts` CHECK (`attempt_count` >= 0);

-- the dispatcher's claim query: undelivered, due, oldest first
DROP INDEX `idx_outbox_pending` ON `outbox_events`;
CREATE INDEX `idx_outbox_pending` ON `outbox_events` (`delivered_at`, `available_at`, `id`);
CREATE INDEX `idx_outbox_org_time` ON `outbox_events` (`organization_id`, `created_at`);
