# ADR-122: Player Roles Confirmed by a Person

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase E.8: Roles confirmed by a person
- **Migration:** `database/migrations/0065_role_confirmation.sql`

## Context

In tactical intelligence, scouting, and player evaluations, positional roles (e.g. GK, CB, LB, RB, DM, CM, AM, RW, LW, CF, ST) are frequently proposed by automated engines or imported from provisional team sheets. However:
1. An unverified or guessed position must never corrupt scouting search filters, player comparison rosters, or tactical cohort benchmarks.
2. Filtering by role/position across the player registry (`GET /v1/players?role=`), player list (`GET /v1/player-list?role=`), global Smart Search (`role:am`), and tactical player reports must match **confirmed roles only**.
3. Every role confirmation must record human accountability: who confirmed the role (`role_confirmed_by`), when (`role_confirmed_at`), and an explicit confirmation state (`ROLE_CONFIRMED` vs `ROLE_PROVISIONAL`).
4. Analysts must be able to view confirmation status, confirm provisional roles with one click, and see audit metadata.

## Decision

1. **Database Schema (`0065_role_confirmation.sql`):**
   - Added `role_confirmed_by CHAR(36) NULL` (FK to `users.id`).
   - Added `role_confirmed_at DATETIME(6) NULL`.
   - Added `role_confirmation_state VARCHAR(20) NOT NULL DEFAULT 'ROLE_PROVISIONAL'` with CHECK constraint `IN ('ROLE_PROVISIONAL', 'ROLE_CONFIRMED')`.
   - Enforced pair integrity: `(role_confirmed_by IS NULL) = (role_confirmed_at IS NULL)`.
   - Added index on `(primary_position, role_confirmation_state)`.
   - Updated `PLAYER_EDITABLE` in `tools/db/roles.py` to grant `otsi_app` update rights on role confirmation columns.

2. **Contracts (`packages/contracts/src/`):**
   - Extended `PlayerProfile` with `role_confirmed: boolean`, `role_confirmation_state: "ROLE_PROVISIONAL" | "ROLE_CONFIRMED"`, `role_confirmed_by: string | null`, `role_confirmed_at: string | null`, and `role_confirmed_by_name?: string | null`.
   - Added `role_confirmed?: boolean` to `PlayerProfile.latest_team` reflecting match roster verification.
   - Extended `UpdatePlayerProfileRequest` with `confirm_role?: boolean`.
   - Extended `SmartQuery` in `search.ts` with `role: string | null` and `role_confirmed_only: boolean | null`.
   - Updated `parseSmartQuery` to recognize `role:<pos>`, `position:<pos>`, and `is:confirmed_role`.

3. **Backend API (`apps/api/src/modules/`):**
   - `players.service.ts`:
     - Updated `playerProfile()` to fetch confirmation metadata and join analyst user name.
     - Updated `updateProfile()`: when an analyst sets or modifies a position, it automatically confirms the role (`ROLE_CONFIRMED`, current timestamp, analyst user ID) unless explicitly set to provisional (`confirm_role: false`). Clearing position resets to provisional.
     - Updated `search()` and `list()` to filter by confirmed roles only (`role_confirmation_state = 'ROLE_CONFIRMED' AND primary_position = ?`).
   - `players.controller.ts`:
     - Added `role` and `confirmed_only` query parameters to `GET /v1/players` and `GET /v1/player-list`.
   - `overview/search.ts` & `search/indexer.ts`:
     - Bumped `INDEX_VERSION` to 3.
     - Updated `indexPlayer()` to include confirmed positions in search index.
     - Updated `SearchService.search()` to filter player search documents by confirmed position when `role` or `role_confirmed_only` is queried.
   - `playerreport/playerreport.ts`:
     - Updated `lineOf()`: tactical cohort benchmarking uses person-confirmed roles only (`profile.role_confirmed` or `profile.latest_team.role_confirmed`). Provisional positions do not categorize a player into a specific line without confirmation.

4. **Web UI (`apps/web/src/components/`):**
   - `PlayersList.tsx`:
     - Added position dropdown filter and `Confirmed roles only` checkbox toggle in the page header.
     - Displays `✓ Confirmed` badge (green) or `Provisional` badge (amber) on player position cards.
     - Provided inline "Confirm" button for provisional positions so analysts can confirm in one click.
   - `PlayerComparison.tsx`:
     - Player selection and comparison cards display confirmed position indicators.

5. **Automated Verification:**
   - Integration test in `apps/api/test/roles.api.test.ts` (1 passed in 371ms) verifying role confirmation audit metadata, filtering exclusivity, explicit confirmation workflow, and Smart Search role matching.
   - Component unit test in `apps/web/test/playersList.test.tsx` (1 passed in 95ms) verifying badge rendering and confirmed-only filtering.
   - Full web test suite: 59 test files, 239 passed in 26.37s.
   - Production Next.js build: compiled and statically optimized (25/25 routes).
