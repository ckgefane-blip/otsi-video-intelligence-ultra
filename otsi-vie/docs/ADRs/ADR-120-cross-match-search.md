# ADR-120: Cross-Match Search by Player, Event, and Period

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase E.5: Cross-match search by player, event and period
- **Migration:** `0064_search_period.sql`

## Context

Global Smart Search (v3 Phase B.10, ADR-086) allows analysts and scouts to find matches, players, reels, projects, moments, and markers across the organization using word prefix queries and typed filters (`type:`, `event:`, `is:analysed`, `is:confirmed`).

However, professional scouting and performance workflows require filtering moments across all matches simultaneously by:
1. **Match Period:** Analysts need to query actions occurring specifically in the first half (`period:h1` or `half:1`) or second half (`period:h2` or `half:2`), e.g., comparing first-half pressing intensity versus second-half fatigue breakdowns.
2. **Player Conjunction across Matches:** Scouts evaluating prospective signings or match analysts compiling scouting packs need to search across an entire catalog of matches for a specific player's actions (e.g. `player:"José Núñez" event:shot period:h2` or `player:Rashford event:goal`).
3. **Truth Preservation:** Moments must derive their period from confirmed or detected half bounds in `match_periods` (`first_start_us`, `first_end_us`, `second_start_us`, `second_end_us`), never guessing or fabricating periods when unconfirmed or out of bounds.

## Decision

1. **Database Schema (`database/migrations/0064_search_period.sql`):**
   - Added `period VARCHAR(8) NULL` to `search_documents`.
   - Added compound index `idx_search_doc_period (organization_id, kind, period)` for fast period-filtered moment retrieval.

2. **Contracts (`packages/contracts/src/search.ts`):**
   - Extended `SearchHit` with optional `period: z.enum(["H1", "H2"]).nullable().optional()`.
   - Extended `SmartQuery` with `period: "H1" | "H2" | null` and `player: string | null`.
   - Updated `parseSmartQuery()` to:
     - Tokenize input preserving quoted values (e.g. `player:"Marcus Rashford"`).
     - Parse `period:h1|h2|1|2|first_half|second_half` and `half:1|2|h1|h2` into `"H1"` | `"H2"`.
     - Parse `player:<name_or_id>` and index terms for ranking.
     - Updated `hasCriteria()` and `SMART_HINT`.

3. **Search Indexer (`apps/api/src/modules/search/indexer.ts`):**
   - Bumped `INDEX_VERSION = 2` to trigger automatic rebuilds across organizations on next search.
   - In `indexVideo()`:
     - Fetched `match_periods` bounds for the video.
     - Assigned `period: "H1" | "H2" | null` to all MOMENT and MARKER search documents based on temporal timestamp `at_us`.
   - In `catchUp()`:
     - Added change tracking for `match_periods` (`updated_at > watermark`) to automatically re-index videos when periods are confirmed or adjusted.

4. **Search Service (`apps/api/src/modules/overview/search.ts`):**
   - Added period filtering: `WHERE (d.kind NOT IN ('MOMENT', 'MARKER') OR d.period = ?)`.
   - Propagated `period` in `search_documents` projection and `SearchHit`.
   - Cross-match search natively spans all visible videos within the organization when no specific `videoId` is provided.

5. **Web UI (`apps/web/src/components/shell/CommandPalette.tsx`):**
   - Displayed period prefix badge (`H1 · ...` or `H2 · ...`) in moment search result hints.
   - Updated search help text to include period and player filters.

6. **Automated Verification:**
   - Unit tests in `apps/web/test/smartSearch.test.ts` for query tokenization, period parsing, quoted player filters, and criterion checks.
   - Integration tests in `apps/api/test/search.api.test.ts` verifying moment indexing with `match_periods`, cross-match period queries (`period:h1`, `period:h2`), player conjunction (`player:Jose event:goal period:h2`), and version bump to `2`.
   - 57 web test suites (237 tests) passing.
