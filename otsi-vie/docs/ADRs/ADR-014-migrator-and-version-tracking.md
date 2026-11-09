# ADR-014: Migrator with explicit version tracking; no destructive repair

Status: accepted (2026-10-26)

## Context
MySQL commits DDL implicitly, so a migration file cannot be rolled back as a unit; the blueprint asks for checksum-locked, ordered migrations.

## Decision
`tools/db/migrate.py` keeps `schema_migrations` (version, name, SHA-256, applied_by, applied_at, duration). It holds a named lock, runs only pending versions in order, treats warnings as errors, and STOPS (never repairs, never drops) on an edited or renamed applied file, a missing applied file, a late older version, or a failing statement; a failed file is not recorded and the runbook restores from the pre-migration snapshot.

## Evidence and alternatives
Tests: re-run is a no-op; edited, late and failing migrations each stop the run with a specific error.
