# ADR-142: Single Match Spotlight + Scouting Pack — the paid bundle as one named export (DRAFT, owner approval pending, ultra-only)

- **Status:** Draft. This ADR records the Scouting Pack build on `muse/ultra-main`; it needs owner approval before it is
  presented as accepted. It changes no accepted ADR. **Ultra-only:** the number 142 is the next free number in ultra
  (ultra is at ADR-141 after the AI Analyst). Antigravity's repo is at ADR-138 as far as ultra can see; this build
  is written from the roadmap and the existing ultra code alone — no Antigravity code was read or copied — and the two
  must never be merged (see the migration collision note in §1).
- **Date:** 2026-11-11 (Muse, `muse/ultra-main`)
- **Scope:** Roadmap Phase 4 — Sell it, Option B Managed Service, Nigeria first. Piece 4 of 4 Phase 4 builds
  (Piece 1 i18n page bodies, Piece 2 Token Wallet, Piece 3 AI Analyst). The offer is defined in the commercial SOP
  (`otsi-vie/docs/commercial/spotlight-sop.md`: Spotlight + Scouting Pack in/out) and the Token Wallet scope
  (`workspace/goals/otsi-video-intelligence-engine/files/token-wallet-scope/token-wallet-scope.md`: export pack
  10 tokens). This build puts the mechanism in place; it does not change anything in Phases 1–3, and it does not
  touch the CV pipeline, the Best Moment Rule, the Profile Intro, or the reel.

## 1. Numbering: migration 0073

Ultra is at migration 0072 (AI Analyst). Antigravity used 0067, 0068, 0069 **and 0070** in their own repo for
different things. This build uses **0073** because it is the next number free in ultra as far as ultra can see.
The migration file records this, and the warning stands: a future collision is still possible if their series
reaches 0073 for something else. If that ever happens, the merge is the problem, not this number — never renumber
a migration that has run anywhere.

## 2. Decisions

### What it is

- **One named export bundle — the "Scouting Pack"** — that a club receives: (a) the highlight reel, with the
  Player Profile Intro first and then the moments picked by the Best Moment Rule v2.1; (b) the player report;
  (c) the AI Analyst brief, **only when published**. Packaged as ONE export (one ZIP) with a clear manifest.
- **The "Single Match Spotlight" is the single-match version of the same offer:** a Pack scoped to ONE match
  (one reel + one report for that match). The Scouting Pack is the same bundle shape and may also cover a
  cross-match reel (all matches). The bundle is generic over the reel source — single-match or cross-match —
  and the choice is recorded in the manifest (`reel_source`: `SINGLE_MATCH` | `CROSS_MATCH`, with the match
  titles: one title for a Spotlight, every match for a cross-match Pack).
- **The reel is the source of truth for the source.** The create request names the reel (`reel_id`) and opts out
  of the report or the brief; the API reads the reel's `source` (MATCH → SINGLE_MATCH, ALL_MATCHES →
  CROSS_MATCH) and the reel's player, and refuses a reel that is not the player's reel (409 `PLAYER_MISMATCH`).
  There is no separate "choose the source" that could disagree with the reel.
- **The existing export machinery is reused, not duplicated.** The Pack is built on the export-bundle patterns
  (ADR-058): the finished render's file, the player report made by `PlayerReportService`, the stored-ZIP helper
  `writeZip` from the exports module, signed download links from `AnalysisService`, and the audit log. The new
  code is the named bundle around them: the manifest, the 10-token charge, the publish-gated brief, and the
  single ZIP. The old per-reel bundles (`export_bundles`) are untouched and keep working.

### Cost — Token Wallet (Piece 2)

- **10 tokens for the whole Pack** — the export-pack cost (`TOKEN_COSTS.exportPack`, Token Wallet scope:
  "Export pack (.otsi-reel / .otsi-archive) | 10 tokens"). Charged at enqueue via the WalletService
  (job type `EXPORT_PACK`), in the same transaction as the Pack row, so a Pack that fails to start charges
  nothing. An unrendered reel is refused (409 `NOT_RENDERED`) **before** any token moves.
- **No double charge.** The pieces inside the Pack are covered by that one charge and are never charged again:
  the report is made with `charge: false` (the ADR-140 export-pack pattern from the bundles), the brief is a
  read of an already-paid assessment, and the reel is an already-rendered file.
- **Refund on failure.** A Pack whose build fails after the charge is auto-refunded (`refundForJob`,
  `EXPORT_PACK`, idempotent on `refund:EXPORT_PACK:<packId>`) and left `FAILED` — never half-built.

### The manifest — the Pack is honest about what it contains

- `buildScoutingPackManifest` (pure, in `packages/contracts/src/scouting-pack.ts`) builds the manifest that
  travels inside the Pack as `manifest.json` and is stored on the Pack row: the player and OTSI PIN, the reel
  and its source, the match titles, the Best Moment Rule version stamped (`2.1`, the literal from ADR-131),
  the 10-token cost, a measured-only statement, and one line per item — `INCLUDED`, `EXCLUDED`, `NOT_MEASURED`
  or `FAILED` — with the reason when it is not included.
- **The Analyst brief is included ONLY when published** (ADR-141 Rule 4). The builder calls the Piece 3 hook
  `publishedScoutBriefForPack` and never re-implements the publish gate. A draft is recorded as EXCLUDED with
  the reason "AI Analyst brief: not included (draft, not published)" — never silently included, never invented,
  and never written into the ZIP. No assessment at all, or a published assessment with no scout brief, are
  recorded the same way, each with its own reason.
- **A report that cannot be made does not stop the Pack**: it is recorded FAILED with its reason (the ADR-058
  bundle philosophy — one companion failing does not stop the others), and the Pack still ships with the reel
  and the brief. A reel with no finished render is FAILED in the manifest — and refused outright at create time,
  so that case cannot reach a shipped Pack.
- **Measured data only (ADR-124).** The reel follows the Best Moment Rule v2.1 on moments the engine measured
  for this player under his verified OTSI PIN; the report shows his measured numbers; the brief, when included,
  is a published assessment whose every claim cites measured evidence. The manifest's measured-only statement
  says so, and anything not measured is labelled Not measured.

### API

- `POST /v1/players/:playerId/scouting-packs` (writers only) — build one Pack for the player's reel.
  `GET /v1/players/:playerId/scouting-packs` — the player's Packs, newest first, with download links.
  `GET /v1/players/:playerId/scouting-packs/:packId` — one Pack, with its manifest.
- The ZIP holds: the finished reel file (`reel.mp4` / `reel.webm`), the player report PDF when made,
  `ai-analyst-brief.json` when a brief is published (the brief plus who published it and when), and
  `manifest.json`. The ZIP is stored as a `BUNDLE` asset with its SHA-256, like the export-bundle ZIP.
- The Pack row (`scouting_packs`, migration 0073) stores the manifest JSON, the state
  (`CREATED` → `READY` / `FAILED`), the cost, and the ZIP asset id. The audit log records who built what,
  with the reel source, the report outcome and whether the brief was included.

### Web UI

- A **"Scouting Pack…"** action in the Export flow (the Reports area of the Export page, beside
  "Interchange…"), opening a dialog (`ScoutingPackDialog`, the same Radix dialog pattern as the interchange
  dialog): the reel and its source (Single Match Spotlight vs all matches), the 10-token cost, checkboxes to
  include the report and the brief, the Build button (disabled until the reel has a finished render), the
  player's Packs with their manifests — each item with its state and its reason — and the download link once a
  Pack is ready. The dialog is English-only for now (see §4): the Export page bodies were translated in Piece 1
  but this new dialog was not, and its strings are not in the i18n dictionaries yet.

## 3. What was deliberately not built

- **No per-piece pricing.** The Pack is one 10-token charge; there is no way to buy the reel, the report or
  the brief separately inside a Pack, and no separate charge for the brief (it is a read of an already-paid
  assessment). If the owner later wants the brief priced separately, that is a Token Wallet scope change.
- **No delivery.** The Pack is a download. Delivering it to a club (share link + the sender's own mail app)
  is the existing Deliver to Client flow on the reel (ADR-058) and is not duplicated here; a Pack delivery is
  a follow-up, not part of this piece.
- **No rebuild endpoint.** A Pack is built once at create time. A new render or a newly published brief means
  a new Pack (a new 10-token charge), not a rebuild of the old one — the manifest is the record of what was
  in that Pack at that time, and it is never edited after.
- **No cross-match reel creation here.** The Pack takes an existing reel; building the cross-match reel itself
  is the ADR-131 flow, unchanged.

## 4. Known gaps

- **Not verified live.** No click-through, no real rendered Pack, no DB test run (see §5). The ZIP build, the
  report embed and the brief embed run only against the real schema on the owner's host.
- **Dialog strings are English-only.** The Scouting Pack dialog was not added to the i18n dictionaries
  (EN/RU/ES/DE/FR); the rest of the Export page bodies were translated in Piece 1. Follow-up: add the dialog
  strings to the dictionaries, or accept English for this commercial dialog.
- **No Pack delivery.** See §3: a Pack can be downloaded but not sent to a club from the Pack itself.
- **A stale brief is not re-checked at build time.** The brief included is the latest assessment's published
  brief; if a new match was analysed after it was published, the assessment is stale (ADR-141) but the Pack
  still includes it — the manifest does not record staleness. Follow-up: refuse or warn when the latest
  assessment is stale at Pack build time.
- **Report failure reason is a single line.** A report that fails is recorded FAILED with the error message
  truncated to 255 characters; the underlying cause is in the server log, not the manifest.

## 5. Verification (this VM, 2026-11-11)

- Contracts typecheck clean. API typecheck: only the known pre-existing errors (pressing `sliceFor`,
  exports, events/load API tests). Web typecheck: only the known pre-existing formationsPanel `assigned_by`
  error. No error in any scouting-pack file.
- Web vitest: 78 files / 378 tests pass (13 new: 10 manifest logic in `test/scoutingPack.test.ts`, 3 dialog
  in `test/scoutingPackDialog.test.tsx`).
- `next build`: compiled successfully, 27/27 static pages generated (25 static routes).
- API build (`tsc -p tsconfig.build.json`): emits, including `dist/modules/scoutingpack/scouting-pack.js`,
  with only the 2 known pre-existing errors (pressing `sliceFor`, exports).
- **Not run here:** `apps/api/test/scoutingPack.api.test.ts` needs MySQL 8.4 on 127.0.0.1:3507 on the owner's
  host (migration 0073 not applied anywhere); no live verification, no click-through, no real rendered Pack.
