# ADR-112: Data Retention Policies, Trash Expiry Countdown, and GDPR Subject Erasure

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase D.4: Retention and Erasure
- **Migration:** `0063_retention_and_erasure.sql`

## Context

OTSI VIE v2 organizations manage high-volume media assets, AI inference observations, scouting profiles, and security audit events. Without structured lifecycle policies, organizations face growing storage costs, compliance liabilities, and ambiguity surrounding data disposal:
1. **Configurable Retention Schedules:** Organizations require tenant-level retention policies specifying how long deleted items remain in Trash (`trash_days`, default 30), limits on raw video retention (`raw_footage_days`), rendered clip retention (`rendered_reels_days`), and compliance audit log retention (`audit_log_days`, default 365, min 30).
2. **User Visibility & Expiry Countdown in Trash:** Users restoring or reviewing Library Trash need real-time awareness of countdowns until permanent purge (`days_remaining`, `expires_at`, `can_purge`), avoiding accidental data loss.
3. **Automated & Manual Trash Purging:** Administrative capability to permanently release disk storage by purging items exceeding the retention window (`POST /v1/admin/retention/trash/purge`).
4. **GDPR Right to be Forgotten (Subject Erasure):** Regulatory frameworks (GDPR Art. 17) require organizations to erase or permanently pseudonymize individuals upon request without compromising computer vision tracking continuity or corrupting immutable append-only audit histories.

## Decision

1. **Database Schema (`database/migrations/0063_retention_and_erasure.sql`):**
   - Created `org_retention_policies`:
     - `organization_id`: UUID PK referencing `organizations`.
     - `trash_days`: INT (default 30, range 0–3650).
     - `raw_footage_days`: INT NULL (range 0–3650).
     - `rendered_reels_days`: INT NULL (range 0–3650).
     - `audit_log_days`: INT (default 365, min 30, max 3650).
     - `auto_purge_enabled`: BOOLEAN (default FALSE).
     - `updated_at`, `updated_by`.
   - Created `subject_erasure_requests`:
     - `id`: UUID PK.
     - `organization_id`: UUID FK.
     - `subject_kind`: VARCHAR ('PLAYER', 'USER').
     - `subject_id`: UUID.
     - `subject_ref`: VARCHAR identifier.
     - `requested_by`: UUID FK referencing `users`.
     - `executed_at`: DATETIME(6).
     - `summary`: JSON details of pseudonymization and cleared references.

2. **Data Contracts (`packages/contracts/src/retention.ts`):**
   - Defined Zod schemas:
     - `OrgRetentionPolicy`, `UpdateRetentionPolicyRequest`.
     - `SubjectKind` (`PLAYER`, `USER`), `SubjectErasureRequest`, `SubjectErasureSummary`, `SubjectErasureRecord`.
     - `PurgeTrashRequest`, `PurgedItem`, `PurgeTrashResult`.
   - Updated `TrashEntry` in `packages/contracts/src/removal.ts` to include `expires_at: z.string().optional()`, `days_remaining: z.number().int().optional()`, and `can_purge: z.boolean().optional()`.
   - Exported through `packages/contracts/src/index.ts`.

3. **Backend Service & Controller (`apps/api/src/modules/retention/retention.ts`):**
   - Registered `RetentionController` and `RetentionService` in `apps/api/src/app.ts` under `@Roles("OWNER", "ADMIN")`.
   - Endpoints:
     - `GET /v1/admin/retention`: Returns current organization retention policy or default fallback.
     - `PATCH /v1/admin/retention`: Updates retention policy thresholds with validation.
     - `POST /v1/admin/retention/trash/purge`: Hard-deletes expired items from `library_deletions` and `library_deletion_items`, calculating freed byte size and emitting `trash.purged` audit event.
     - `POST /v1/admin/retention/erasure`: Executes subject erasure:
       - **Player Erasure:** Pseudonymizes player `display_name` (`Anonymized Player <ref>`), clears `birth_date` and `preferred_foot`, removes dossiers (`scouting_dossier_players`), assessments (`player_assessments`), tags (`player_tags`), and notes (`comments`). Supersedes active confirmed track identities with `UNRESOLVED` without breaking spatial CV tracking vectors.
       - **User Erasure:** Prevents erasure of sole organization owner (409 `CANNOT_ERASE_LAST_OWNER`). For members, pseudonymizes `display_name` to `Former Member`, randomizes email, removes 2FA/totp credentials, and removes membership.
       - Appends immutable `subject.erased` audit event.
     - `GET /v1/admin/retention/erasures`: Lists executed erasure audit records.
   - Updated `LibraryRemovalService.trash` in `apps/api/src/modules/library/removal.ts` to enrich each trash row with policy-derived `expires_at`, `days_remaining`, and `can_purge`.

4. **Web UI Updates:**
   - **Trash Countdown (`apps/web/src/components/library/LibraryMain.tsx`):** Added countdown pills to `TrashDialog` items (`${days_remaining}d left` or `Eligible for purge`), along with a "Purge Expired" action button when eligible items exist.
   - **Admin Console (`apps/web/src/components/admin/AdminConsole.tsx`):** Added a 6th navigation tab `Retention & Privacy` with editable retention sliders, immediate purge trigger, GDPR subject erasure request form, and executed erasures table.

5. **Verification & Testing:**
   - API integration test suite `apps/api/test/retention.api.test.ts` (5 tests passing).
   - Library trash API regression suite `apps/api/test/library.api.test.ts` (3 tests passing).
   - Web unit test suite `apps/web/test/adminConsole.test.tsx` (4 tests passing).
   - Regenerated test schema inventory (151 tables) and verified schema drift tests (`tests/db/test_schema.py`).
   - Clean Next.js production build.

## Consequences

- Compliance with GDPR Article 17 Right to Erasure while strictly maintaining multi-tenant database append-only integrity triggers.
- Storage efficiency is maintained through configurable auto-purge and manual trash purge workflows.
- Users gain full transparency regarding item lifespans in the Trash.
