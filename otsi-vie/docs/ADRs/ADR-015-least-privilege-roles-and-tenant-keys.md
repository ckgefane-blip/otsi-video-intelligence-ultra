# ADR-015: Least-privilege roles and composite tenant keys (MySQL replacement for row-level security)

Status: accepted (2026-10-26)

## Context
MySQL has no row-level security, `SET LOCAL` session claims or security-definer functions; the blueprint's tenant model assumed them.

## Decision
(1) Tenant scoping of every read and write is done in the API service layer with negative cross-tenant tests (ADR-002). (2) Migration 0003 adds `UNIQUE(id, organization_id)` on 8 tenant-owned parents and 27 composite foreign keys `(link, organization_id)`, so the database refuses a row of one tenant pointing at another tenant's parent. (3) `tools/db/roles.py` provisions `otsi_migrator` (DDL), `otsi_app` (DML only; insert-only on history), `otsi_readonly`, `otsi_retention`, generated from the live schema.

## Evidence and alternatives
Tests: 27 parametrized cross-tenant cases plus the quota composite key; `test_roles_are_least_privilege`. Limitation: 49 child tables are tenant-owned only through their parent; their isolation is the API's responsibility and must be covered by API-level cross-tenant tests (Block 01/02).
