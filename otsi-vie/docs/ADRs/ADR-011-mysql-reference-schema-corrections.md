# ADR-011: Correct the MySQL reference schema through versioned migrations

Status: accepted (2026-10-26)

## Context
The handoff's `001_full_schema_mysql84.sql` was never executed. On MySQL 8.4.13 it failed with 6 errors from 4 causes: a PostgreSQL array type (`CHAR(36)[]`) in `policy_decisions`, a signed/unsigned foreign-key mismatch (`admin_actions.resulting_audit_event_id`), a duplicated and meaningless outbox index (a translated partial index), and a hard-coded `CREATE DATABASE`/`USE`.

## Decision
The reference files stay unchanged in `blueprint/`. Corrected, versioned migrations live in `otsi-vie/database/migrations/`: 0001 (reference + C-SQL-01..04) and 0002 (guard triggers, no `USE`). Further changes are new migrations, never edits.

## Evidence and alternatives
Alternatives: edit the reference in place (loses the audit trail); hand-fix a live database (forbidden). Tests: `tools/db/db_check.py`, `tests/db/test_schema.py`.
