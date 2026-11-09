# ADR-012: One canonical outbox for every producer

Status: accepted (2026-10-26)

## Context
The original sources defined `outbox_events` twice (domain publishing vs billing); the conversion kept the first, which cannot de-duplicate a replayed billing webhook and has no tenant column.

## Decision
`outbox_events` is the only outbox. Migration 0004 adds `organization_id` (FK), `dedupe_key` (UNIQUE; e.g. `billing:<provider>:<event>:<kind>`), `available_at` (retry back-off) and `last_error`, and replaces the pending index with (`delivered_at`, `available_at`, `id`). Billing producers write here with a dedupe key; inbound provider events stay in `billing_webhook_inbox` (UNIQUE provider + external id).

## Evidence and alternatives
Tests: `test_outbox_deduplicates_and_is_tenant_scoped` (a replayed event is refused with 1062; exactly one outbox table exists).
