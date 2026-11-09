# ADR-086: Search index and Smart Search (v3 Phase B.10)

Status: accepted. The owner said "Proceed with implementation nonstop until you finish the very last thing in our planned work" on 2026-11-07.

## Problem
- The A.8 search (ADR-070) scanned names with LIKE: matches, players, reels, projects. It could not find moments (a goal, a player's
  passes) or markers, ignored accents, needed the words in one piece, and had no filters.
- The plan asks for a search index fed by outbox events, and Smart Search over it.

## Decision
- **Migration 0055:** `search_documents` (one row per findable item: kind, title, detail, video and time for moments and markers, event
  type, analysed, confirmed), `search_terms` (its words, binary collation, prefix-indexed), `search_index_state` (per organization: rules
  version and watermark). Derived data only; it never decides access.
- **Shared rules** (`contracts/search.ts`): `searchTerms()` (lower case, accents removed, letters and digits of any script),
  `parseSmartQuery()` (words plus `type:`, `event:`, `is:` filters; a filter not understood is said back, never guessed), `hitHref()`
  (a moment or marker opens Analysis at its time).
- **What is indexed** (`modules/search/indexer.ts`): matches/videos, players the organization created or confirmed, reels, projects,
  the engine's moments of each video's latest finished ball track (goal, shot, pass, tackle, interception, pressure, set piece; the
  player's name only for a person-confirmed identity, otherwise his track number; events a person rejected are left out), and markers.
- **How it stays current:**
  - the outbox subscriber `search.index` re-indexes what each event is about, in its delivery transaction;
  - before every search a catch-up re-indexes whatever changed in the canonical tables since the organization's watermark (3 s overlap),
    so audited changes that publish no event, worker results and identity decisions are found at once;
  - the first search of an organization, or a new rules version, rebuilds it. Writers lock the organization's state row first.
- **Search** (`GET /v1/search`, same contract plus MOMENT and MARKER hits): every word must start a word of the item; title words rank
  above other words, whole words above prefixes; at most 8 per kind; equal scores newest first, moments in match order. Access is
  re-checked against the canonical rows on every query (organization, removed, hidden projects, merged players, removed markers).
- **Palette:** Moments and Markers groups, the filter hint under the field, and "Not understood, left out: …" for an unknown filter.

## Measured
- Owner's data: first search (rebuild of the organization: 1 match, 150 moments, 37 players, 1 reel, 1 project; 1,361 words) 623 ms;
  then 44 ms for "chinazom event:pass" (8 passes of the confirmed player, in match order).

## Alternatives
- **MySQL FULLTEXT:** rejected. The default parser drops words under 3 letters and stop-words; changing that needs server settings on
  the shared MySQL; prefix and accent rules would differ from the page's.
- **Catch-up only, no subscriber:** rejected; the plan asks for an outbox-fed read model, and the subscriber keeps it warm between searches.

## Tests
- `apps/api/test/search.api.test.ts` (real API and MySQL): moments by event word and by the confirmed player's name without accents,
  Cyrillic titles, possession spans not indexed, pass "A → B", `is:confirmed`, a rejected event dropped, a marker found then removed, a
  rename without an event found, `is:analysed`/`is:not_analysed`, `type:project` alone, an unknown filter left out, another
  organization finds nothing, a removed video takes its moments.
- `apps/api/test/access.api.test.ts` "global search" (A.8 rules unchanged on the index).
- `apps/web/test/smartSearch.test.ts`. Suites: API 238, web 162 passed; both type checks clean.
