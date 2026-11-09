# ADR-018: Outbox dispatcher — at-least-once delivery with leases, fencing, receipts and dead letters

Status: accepted (2026-10-26)

## Context
ADR-012 made `outbox_events` the single transactional outbox for every producer (domain and billing). Nothing delivered its rows yet. The blueprint requires that the API commits state and outbox together and that a dispatcher starts downstream work idempotently ("queue consumers are at-least-once and must be idempotent", SYSTEM_ARCHITECTURE.md), runs as its own `outbox-dispatcher` deployment unit (DEPLOYMENT_OPERATIONS.md), and that stuck jobs can be correlated by outbox id and retried with lease fencing.

## Decision
1. **Delivery semantics: at-least-once.** No claim of exactly-once external effects. Two mechanisms make effects safe:
   - a subscriber's **local database effect** commits in the same transaction as its receipt row in `event_consumer_receipts (outbox_event_id, subscriber)` (PK), so it happens once per subscriber even when the event is redelivered;
   - an **external effect** (webhook, broker, payment provider) receives the stable idempotency key `<event id>:<subscriber>`.
2. **Claim** (migration 0009 columns `claim_token`, `lease_expires_at`, `dead_lettered_at`): one short transaction selects open (not delivered, not dead), due (`available_at`), lease-free rows that have **no earlier open event of the same aggregate** (`idx_outbox_aggregate_order`), `ORDER BY id ... FOR UPDATE OF o SKIP LOCKED`. Concurrent dispatchers take disjoint rows without waiting. Claimed rows get a fresh claim token, a lease and `attempt_count + 1`. CHECKs: a claim always has a lease; an event is never both delivered and dead.
3. **Fencing.** Each subscriber runs in its own transaction that first locks the event row and verifies the claim token. A dispatcher whose lease expired and was taken over stops ("lost"); its late completion/retry updates are conditional on the token and change nothing. The lease is renewed when each event's processing starts.
4. **Settling.** All matching subscribers have receipts → `delivered_at`. A failure → `available_at = now + backoff` (capped exponential, equal jitter) with `last_error` = `<subscriber>: <message>`, redacted (bearer tokens, JWTs, URL passwords, key=value secrets) and truncated to 1000 characters. After `maxAttempts` → `dead_lettered_at`, audited as SERVICE `outbox-dispatcher` (`outbox.event_dead_lettered`). An operator **re-drive** (same organization only, audited as that user) resets the attempt budget; receipts are kept, so completed subscribers are not repeated.
5. **Ordering.** Per aggregate (`aggregate_type`, `aggregate_id`), events are delivered in id order: an event waits while an earlier one is pending, in flight or backing off. A dead-lettered event does **not** block later ones (otherwise one poison event freezes an aggregate for ever); the dead letter is surfaced to operators instead. No global order is promised.
6. **Tenants.** A subscriber may be scoped to one organization (e.g. that organization's webhook); it is offered only that organization's events. Platform events (`organization_id` NULL) never reach a tenant-scoped subscriber.
7. **Time-outs and crashes.** A handler exceeding `handlerTimeoutMs` is aborted (AbortSignal), its transaction's connection is destroyed (never reused), and the event retries. A crashed process holds no locks; its lease expires and another dispatcher reclaims the row.
8. **Process.** `apps/api/src/workers/outbox-dispatcher.ts` (`pnpm start:outbox-dispatcher`), least-privilege runtime account, only `OTSI_VIE_DB_DSN` (+ optional `OTSI_VIE_OUTBOX_POLL_MS`), same 3306 guard as the API. Any number of replicas may run. `outboxStats()` reports due / scheduled / in-flight / dead-lettered / oldest open age for the operations dashboard (block 15).
9. **Subscribers.** Registered in `core/outbox/subscribers.ts` with stable names. None exists yet (no consuming module is built); events are settled as delivered to no one. An event published before a subscriber existed is not replayed to it.

## Alternatives
- Broker only (RabbitMQ/SQS) without an outbox: loses atomicity with the business transaction. The broker, when chosen, becomes a *subscriber* of this dispatcher.
- Per-subscriber outbox rows: more rows and a second outbox-like table; ADR-012 forbids competing outboxes. Receipts give per-subscriber progress without it.
- Strict ordering through dead letters: rejected (see 5).

## Evidence
`apps/api/test/outbox.dispatcher.test.ts` (14 tests, runtime account, real MySQL 8.4.13): delivery + no redelivery; replayed billing event stored and delivered once; producer atomicity; malformed events refused; two concurrent dispatchers over 30 events → each handled exactly once; crashed claim recovered after lease expiry and the stale dispatcher fenced; receipts skip completed subscribers on retry; back-off with a redacted error; dead letter + audit + cross-tenant re-drive refused + re-drive; hung handler timed out; failed subscriber's local effect rolled back; per-aggregate ordering; tenant-scoped subscribers. DB constraints: `tests/db/test_behaviour.py` (0009 tests). Compiled worker smoke: `tools/smoke/outbox_worker_smoke.py`. Evidence: `release-evidence/block-01-outbox-audit/`.

Not yet verified: graceful SIGTERM shutdown on Linux containers (the Windows smoke terminates the process); throughput under load (block 15).
