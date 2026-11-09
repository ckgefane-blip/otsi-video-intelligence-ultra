-- 0009 outbox dispatch state, consumer receipts and audit actor kind (OTSI VIE v2, MySQL 8.4) — ADR-018, ADR-019
-- Forward-only. The ONE outbox stays `outbox_events` (ADR-012); this migration only adds what a safe dispatcher needs:
--   claim_token       fencing token of the dispatcher currently holding the row; a dispatcher whose lease expired cannot complete it
--   lease_expires_at  until when the claim is held; after it, another dispatcher may reclaim the row (worker crash recovery)
--   dead_lettered_at  the row exhausted its attempts (poison event); it is never claimed again until an operator re-drives it
ALTER TABLE `outbox_events`
  ADD COLUMN `claim_token` CHAR(36) NULL AFTER `claimed_at`,
  ADD COLUMN `lease_expires_at` DATETIME(6) NULL AFTER `claim_token`,
  ADD COLUMN `dead_lettered_at` DATETIME(6) NULL AFTER `delivered_at`,
  ADD CONSTRAINT `ck_outbox_claim_has_lease` CHECK ((`claim_token` IS NULL) = (`lease_expires_at` IS NULL)),
  ADD CONSTRAINT `ck_outbox_delivered_or_dead` CHECK (NOT (`delivered_at` IS NOT NULL AND `dead_lettered_at` IS NOT NULL));

-- the claim query: open (neither delivered nor dead), due, oldest first; and the per-aggregate ordering check (earlier open event?)
DROP INDEX `idx_outbox_pending` ON `outbox_events`;
CREATE INDEX `idx_outbox_pending` ON `outbox_events` (`delivered_at`, `dead_lettered_at`, `available_at`, `id`);
CREATE INDEX `idx_outbox_aggregate_order` ON `outbox_events` (`aggregate_type`, `aggregate_id`, `id`);

-- One row per (event, subscriber) that completed. A retried event skips subscribers that already succeeded, and a subscriber's local
-- database effect commits in the SAME transaction as its receipt, so a local effect happens once even though dispatch is at-least-once.
-- (Deliberately not named *outbox*: there is exactly one outbox table.)
CREATE TABLE `event_consumer_receipts` (
  `outbox_event_id` BIGINT UNSIGNED NOT NULL,
  `subscriber` VARCHAR(100) NOT NULL,
  `completed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`outbox_event_id`, `subscriber`),
  CONSTRAINT `fk_receipt_event` FOREIGN KEY (`outbox_event_id`) REFERENCES `outbox_events` (`id`),
  CONSTRAINT `ck_receipt_subscriber` CHECK (REGEXP_LIKE(`subscriber`, '^[a-z][a-z0-9_.-]*$', 'c'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Audit actor: a USER (actor_id required), or the platform itself (SYSTEM: migrations, retention) or a background SERVICE (dispatcher,
-- workers), which have no user row. The action name is a dotted lower-case verb phrase so audit queries can rely on it.
-- actor_service names the component for SYSTEM / SERVICE rows (e.g. 'outbox-dispatcher'); a USER row has none.
ALTER TABLE `audit_events`
  ADD COLUMN `actor_kind` VARCHAR(16) NOT NULL DEFAULT 'USER' AFTER `actor_id`,
  ADD COLUMN `actor_service` VARCHAR(100) NULL AFTER `actor_kind`,
  ADD CONSTRAINT `ck_audit_actor_kind` CHECK (`actor_kind` IN ('USER', 'SYSTEM', 'SERVICE')),
  ADD CONSTRAINT `ck_audit_user_has_actor` CHECK (`actor_kind` <> 'USER' OR `actor_id` IS NOT NULL),
  ADD CONSTRAINT `ck_audit_actor_named` CHECK ((`actor_kind` = 'USER') = (`actor_service` IS NULL)),
  ADD CONSTRAINT `ck_audit_action_format` CHECK (REGEXP_LIKE(`action`, '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$', 'c'));

-- an entity's history ("who changed this match / reel / player, and when")
CREATE INDEX `idx_audit_entity_time` ON `audit_events` (`organization_id`, `entity_type`, `entity_id`, `occurred_at`);
