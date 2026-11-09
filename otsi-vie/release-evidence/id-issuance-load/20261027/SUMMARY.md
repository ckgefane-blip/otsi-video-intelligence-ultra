# OTSI Player ID issuance under concurrent load — root cause and fix (2026-10-27)

**Symptom:** identity API test 4 (20 concurrent registrations) failed once in full CI (`release-evidence/ci/20261027T090319Z`).

**Root cause (from InnoDB's own deadlock reports, `before-fix-api-rounds.jsonl`, field `latest_deadlock`):** one cycle, every time —
1. `sp_issue_canonical_player_id` looked up the idempotency key with `SET v = (SELECT … FROM canonical_id_issuances WHERE request_key = …)`.
   Inside a routine this is a *locking* read: it took a shared gap lock on index `uq_issuance_request`.
2. That transaction then waited for the `canonical_id_sequences` row (X).
3. A concurrent issuance holding that row waited to insert its ledger row into the gap (insert intention) → deadlock, MySQL 1213.

The API retried transient errors at most 4 times with 15–60 ms pauses; measured before the fix: 75 deadlock retries in 8 rounds, one
request needing its 4th attempt at only 20 concurrent registrations — so a busier machine (full CI) could exhaust the retries and return
an error. The database test of concurrency never caught it because it issued **without** an idempotency key (the API always sends one).

**What was never wrong:** each deadlock victim rolled back completely (procedure EXIT handler), so no ID was duplicated, skipped or
half-written; the failure was a refused request, not a corrupt identity.

**Fix:** migration 0018 — the key lookup is a non-locking consistent read (`SELECT … INTO`). Same-player races remain serialised by the
`players` row lock; a key reused for another player is still refused by `uq_issuance_request`. Defence in depth: API issuance retries up
to 8 times with exponential, jittered back-off, and counts every transient retry (`Db.transient`).

**Measured after the fix (`after-fix-api-rounds.jsonl`):** 24 rounds through the real HTTP API — 20, 50, 100 and 200 concurrent
registrations, for a never-used country (sequence row created by the race) and a used one, 3 times — 2,220 issuances, **0 failures,
0 deadlock retries**. For every round the database confirmed: each issued ID unique, contiguous from 000001 per country/year, persisted on
the player as REGISTERED, exactly one ledger row and one audit event; every failed request (none occurred) would be checked to leave nothing.

**Negative control:** the new database test `test_4a_concurrent_keyed_issuance_never_deadlocks` (60 keyed issuances, no retries) fails
against the old allocator (48 of 60 deadlocked) and passes with 0018. `test_4c_…` proves a failure mid-issuance (lock timeout on the
sequence row) leaves no ledger row, no ID and no consumed number, and the client's retry with the same key gets the next contiguous
number and is idempotent thereafter.
