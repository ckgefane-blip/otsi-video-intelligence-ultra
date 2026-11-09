# ADR-013: Audit and decision history is append-only in the database

Status: accepted (2026-10-26)

## Context
The blueprint requires immutable audit and identity/event decisions corrected by supersession, never rewritten. The reference schema did not enforce it.

## Decision
Migration 0005 adds triggers refusing UPDATE on `audit_events`, `track_identity_decisions`, `event_decisions`, `identity_review_history`, and DELETE unless the connected account is a retention account (`otsi_retention*`). The runtime role has no DELETE/UPDATE grant on these tables at all (ADR-015).

## Evidence and alternatives
Tests: `test_history_cannot_be_rewritten`, `test_only_the_retention_account_can_erase_history`.
