# Implementation status — OTSI VIE v2 (living report)

Statuses: **Implemented and verified** · **Implemented, unverified** · **In progress** · **Blocked** · **Not implemented**.
A table existing in the schema is NOT counted as the function being implemented. Evidence paths are under `otsi-vie/release-evidence/`.

_Last updated: 2026-10-26 (link import; playback copy; RT-DETRv2 detection and tracking on real football footage, CPU benchmark)_

## SQLite conversion (ADR-144, 2026-11-11) — built, host verification pending

Owner approved SQLite on user PCs (written approval, 2026-11-11, in chat). MySQL stays on the central server (accounts, licences, billing, audit). The eight safeguards from the distribution plan v4 §1d, each with its command and result. Nothing is called done without this evidence.

| # | Safeguard | Status | Evidence (command → result) |
|---|---|---|---|
| 1 | One database layer | Built | API `Db` interface unchanged (`rows`/`one`/`tx`/`retryTransient`); MySQL backend (mysql2) + new SQLite backend (`node:sqlite`, WAL, `foreign_keys=ON`, `busy_timeout=5000`, `BEGIN IMMEDIATE`) in `apps/api/src/core/db/`; worker `db.py` same shape (WAL, FK on, `busy_timeout=30000`, `synchronous=NORMAL`); allocator procedures reimplemented in TS (`canonical-allocator.ts`); `tools/db/roles.py` updated so the runtime account gets the allocator writes (re-run roles provisioning on existing installs, or MySQL allocator calls fail 1142). API typecheck: only the 2 known pre-existing errors (`test/events.api.test.ts:238`, `test/load.api.test.ts:78`). |
| 2 | Every test on both databases | Wired; SQLite half verified here | API dialect suite `OTSI_VIE_TEST_DB_BACKEND=sqlite ./node_modules/.bin/vitest run test/db.dialect.test.ts` → 62/62 pass; `sh test/run-dual-db.sh` → PASSED (SQLite 62/62; MySQL half SKIPPED, no `.local/mysql-lint.env` here — host-only, MySQL 3507). Worker `python3 run_sqlite_tests.py` → 35/35 pass. Migration `python3 tools/db/test_sqlite_migration.py` → 16/16 pass. |
| 3 | Known differences, handled + tested | Built + tested | 26 dialect rules in `apps/api/src/core/db/dialect.ts` (header catalog); schema `database/sqlite-bootstrap.sql` → 157 tables, all STRICT, integer-ms datetimes, JSON TEXT + JSON1, 1,494 columns with per-column collation decisions (`sqlite-column-collations.csv`); 34 MySQL triggers → 34 SQLite triggers (`sqlite_triggers.sql`, same names, exact SIGNAL messages via `RAISE(ABORT)`); both stored procedures → app code; full mapping in `database/sqlite-schema-mapping.md`. Retention needs no trigger bypass (verified: it never deletes from a guarded table). Known gaps: non-ASCII LIKE case on `display_name` (accepted); `analyze.py:364` one untranslated `ON DUPLICATE KEY UPDATE` (follow-up). |
| 4 | Three workers writing at once | Tested here: 0 lock errors | `python3 services/worker/load_test_sqlite.py --writers N --cycles 40` (real `db.py`, separate processes): 1 writer 199 ops/0.15s, 3 writers 1,080 ops/0.71s, 5 writers 1,660 ops/1.17s, heavy 3-writer 5,400 ops/8.6s, heavy on real disk (btrfs) 2,700 ops/4.97s — 0 SQLITE_BUSY in every run. Negative control (busy_timeout 0) → 92 lock errors, proving the test detects contention. Real-match load test still needs the owner's host. |
| 5 | Same results on both | Harness built; MySQL side host-only | `python3 services/worker/compare_backends.py selfcheck` → MATCH (SQLite-vs-SQLite); mutated-dump control → DIFFER with exact rows. MySQL side NOT run here (no server, no pymysql) — harness exits 2 "MySQL side NOT RUN"; host command in its docstring (scratch DB on host MySQL 3507, real SQLite migrations, then diff). Real-match comparison needs the host. |
| 6 | Users' data protected | Built + tested | Migration runner backs up the local DB file (copy + WAL, SHA-256 manifest) before any migration, applies inside a transaction, restores on failure and reports plainly — covered by the 16-test migration suite (backup matches; failing migration leaves the DB byte-identical). Desktop: SQLite by default (`<data>/db/otsi-vie.sqlite`, D: when one exists), MySQL path kept working and selectable; portable MySQL bundle NOT removed yet. |
| 7 | Staged switch | Plan written, not executed | `otsi-vie/docs/sqlite-rollout.md`: gate (all eight safeguards) → stage 1 owner's PC (exact steps Claude Code runs) → stage 2 beta users → stage 3 everyone, with entry criteria and rollback per stage. Rollout happens on the owner's machine, not here. |
| 8 | Evidence | This file + ADR-144 §1.2 | Each check above records its command and result. Host-only items (MySQL half of every suite, real-match load test, real-match comparison, desktop app starting with SQLite on Windows, installer build + clean install) are NOT verified here and must run on the owner's host before the switch. |

Open items from the build: (a) `--experimental-sqlite` flag — Node 22.11–22.12 need it when spawning the API/outbox; the owner's Node 22.23.2 does not, and the desktop shell does not pass it today (set the engines floor to >=22.13.0 or add the flag in `backend.js` `spawnChild`); (b) roles provisioning must be re-run on existing installs after the roles.py change; (c) `electron-builder.yml` lists no `database/` resource — the installer must ship `otsi-vie/database/` under `engine/otsi-vie/database/`; (d) `analyze.py:364` `ON DUPLICATE KEY UPDATE` is the one remaining untranslated worker MySQL-ism.

## Construction blocks

| Block | Scope | Status | Evidence / outstanding |
|---|---|---|---|
| 00 | Repository, licenses, authorized footage, ADR, threat model | In progress — engineering items done | Threat model (docs/security/THREAT_MODEL.md), licence register + generated dependency inventory with CI gate (docs/legal/), local CI pipeline `tools/ci/run_ci.py` (12 steps, all passing: release-evidence/ci/), web shell (apps/web), worker runtime smoke. Pending (owner): authorised footage, model/dataset licence decisions, approved logo and palette. |
| 01 | MySQL 8.4 migrations, tenant isolation, outbox, audit | In progress — DB layer, identity API, outbox dispatcher and audit writer verified | Migrations 0001-0009, migrator, roles; 84 DB tests passed. Identity API (ADR-017). Outbox dispatcher worker (ADR-018) and general audit writer + audit log API (ADR-019): 32 API tests passed x3, compiled worker smoke passed (release-evidence/block-01-outbox-audit). Pending: tenant scoping is applied per module as each module is built (projects, matches, uploads, ...); no production outbox subscriber exists yet. |
| 02 | OIDC/auth, org/users/invite and admin RBAC | In progress — sign-in verified | Local sign-in (ADR-021): bootstrap of the first owner, login, rotating refresh sessions with reuse detection, logout, lockout, /v1/me, web login page and session gate, organization switch. 11 API + 4 browser tests. Pending: MFA for OWNER/ADMIN, invitations and member management, password change/reset, external OIDC option, admin RBAC console. |
| 03 | S3 upload and media probe, URL controls, resumability | In progress — upload + probe verified | Projects API; resumable chunked uploads to local storage (exact part sizes, per-part SHA-256, resume, abort, 64 GB limit); outbox subscriber -> ingest job; Python ingest worker (assemble + verify, signature check, isolated probe + test decode, policy, thumbnail) — ADR-022. API 9 + worker 11 tests on real encoded media; browser journey e2e. Link import with SSRF-safe download verified (ADR-023); provider adapters (Wikimedia Commons, Internet Archive live-verified; Dropbox, HLS VOD, Vimeo and Google Drive with the user's own token verified against offline stand-ins only; YouTube and other platforms refused with the reason and an alternative — ADR-027); malware scan of every ingested file (Microsoft Defender). Pending: S3 adapter, upload expiry clean-up, stronger sandbox, live checks of the token providers with real credentials. |
| 04 | Video proxy, VFR PTS map, player UI timeline | In progress — backend verified | PROXY job: WebM VP9/Opus playback copy on the media clock (≈ 8× real time on CPU); frame/timestamp index of analysed frames; signed media gateway with Range (ADR-025). Pending: player UI with overlay and timeline (Analysis Workspace). |
| 05 | Detector and bbox endpoint | In progress — runs on real footage; accuracy NOT measured | Replaceable detector adapter + pinned, hash-verified model registry; RT-DETRv2-R18 (Apache-2.0) on CPU with tiling and an on-pitch filter; raw detections kept as Parquet evidence; observation-window API (ADR-024). Benchmark on 3 real sources: 0.3 s/frame untiled, 1.1-1.2 s tiled on CPU; **Intel Arc GPU via OpenVINO (default, ADR-026): 0.10 s untiled, 0.46 s tiled, identical detections**, parity self-check and CPU fallback. Analysis profiles (ADR-034 stage 1): Standard / High accuracy / Ultra-sensitive (multi-scale 2x2+3x3 tiles, candidate floor with temporal confirmation, touchline filter, camera-motion compensation), footage-quality check with recommendation and estimates; study on 4 clips: High accuracy's extra boxes 77–92 % footballers on match footage, Ultra's 35–63 % (board text, spectators on green seats) — Ultra NOT calibrated and not recommended. Pending: labelled football footage for precision/recall (owner); Ultra calibration (pitch model beyond colour, multi-scale agreement); counsel on COCO-trained weights; role classes. |
| 06 | Tracker, camera cuts, gap handling | In progress — runs on real footage; accuracy NOT measured | Cut detection; ByteTrack-style tracker within shots (no bridging, no interpolation stored); tracks + DETECTED observations + presence intervals; honest labels (ADR-025). Camera-motion compensation (phase correlation) and temporal confirmation in the High/Ultra profiles; evaluation framework (MOTA, IDF1, HOTA, identity rates) ready and unit-tested. Pending: HOTA/IDF1 on manually labelled footage. |
| 07 | Roster, OCR, re-ID, human review | In progress — appearance, same-person links, shirt-number evidence, rosters, team assignment and combined candidates implemented and tested (ADR-031, ADR-033); accuracy NOT measured on labelled footage | Migrations 0014, 0016; DINOv2-small embeddings and PP-OCRv4 shirt-number reading on the Arc GPU (multi-frame states, every read stored; 5/11 legible numbers read, 0 wrong on 120 developer-labelled crops — not ground truth); clubs, matches, rosters with history and verification; kit group → team by a person; identity candidates with conflicts; UI in Upload §2 and Workspace §1/§6/§7; API 10 tests, worker tests, browser e2e on real footage. Pending: track-level OCR and identity-switch evaluation on manually labelled footage (ADR-034), role classes (referee/GK), weight calibration |
| 08 | Events, shot/pitch calibration, metrics | In progress — pitch calibration (ADR-036), possession and passes (ADR-040), key actions (ADR-041), pressing (ADR-042), set pieces (ADR-048), goals (ADR-049), distance/speed/sprints/heat zones/team shape built and tested; accuracy NOT measured | Event accept/reject, formations, transitions pending |
| 09 | Tactical and player report generation | In progress — player measures and Player Report from measured positions; Page 05 team shape, heat zones, pass network | Report PDF, comparisons, scouting profile, formation names not built |
| 10 | Reel candidate selection and persistent editor | In progress — Reel Builder verified end to end (ADR-032) | Reel from a confirmed player (pinned decisions, stale after corrections), visibility moments, clips add/trim/reorder/remove, aspect, settings; API 4 tests; browser journey. Pending: event-based candidates (Block 08), Clip Studio multitrack editor (page 07), versions/undo |
| 11 | Spotlight compositor, multiformat MP4 encoding | In progress — spotlight render to validated MP4 verified on real footage (ADR-029, ADR-032) | Dense re-analysis of clip windows, DETECTED/INTERPOLATED/MISSING path, spotlight + ring + caption, 16:9/9:16/1:1, Intel QSV H.264 / AV1 / VP9, audio, validation, manifest; worker tests on real footage; browser journey downloads the MP4. Not legally reviewed, not commercially approved. Pending: transitions, music, branding |
| 12 | Rights, watermark, report export, sharing/delivery | In progress — rights grants and private share links verified (sharing.api.test.ts); watermark in the renderer | Report export (PDF) and client review not built |
| 13 | Billing plans, checkout/webhooks, quota and metering | Not implemented | Real billing needs a merchant account (owner sign-off). |
| 14 | All 10 frontend pages and admin console | In progress — NOT visually faithful (owner visual-fidelity lock 2026-10-27; 0/10 pages match the approved images, see docs/visual-fidelity/VISUAL_FIDELITY_GAP_REPORT.md) | Next.js 15 app with the approved header/navigation, design tokens, light/dark theme, page palette, all 10 pages with all 102 spec'd sections in the approved compositions; every section is honestly empty ("Not connected · Block NN"), no sample data. 26 unit + 17 browser tests. No page is functionally complete. |
| 15 | Observability, load, backups, privacy, security, release | Not implemented | Release gates G01-G15 not started. |

## Functions F01–F64

> **2026-11-05:** function rows F04-F48 brought up to date with the code (routes, migrations 0024-0035, commits to 2 Nov). Block rows below 08 are summarised in `docs/ROADMAP.md`.

| ID | Domain | Function | Status | Notes |
|---|---|---|---|---|
| F01 | Foundation | Tenant registration / invites | Implemented and verified (invites); self-service registration not built | Invite by one-time link with a role, accept as a new person or an existing account, withdraw, remove (0036, ADR-051); team.api.test.ts. No mail service: the link is copied or opened in the inviter's mail app |
| F02 | Foundation | Session OIDC/MFA | Implemented and verified (local sign-in + two-step); external OIDC pending | Two-step sign-in with any free authenticator app: RFC 6238 codes, sealed secret, replay refused, 10 recovery codes, shared lockout (0037, ADR-051); team.api.test.ts, totp.test.ts |
| F03 | Foundation | Roles/policy engine | Implemented and verified (roles per person); policy engine for plans not built | Six roles enforced per route by @Roles; owners/admins change roles; owner rules and last-owner guard (ADR-051). Plan entitlements are Step 6 |
| F04 | Foundation | Project & match CRUD | In progress | Projects verified; clubs and matches (date, teams, score), video link, roster with history and verify (matches.api.test.ts) |
| F05 | Foundation | Player registry & roster | Implemented and verified | Registry, allocator, merges (ADR-016/017); match rosters with history; lineup cards read (PP-OCRv5) and approved into clubs, match, players and roster (ADR-039, lineups.api.test.ts, test_lineup.py); positions entered by the user (0035) |
| F06 | Ingest | Resumable upload | Implemented and verified | API + browser upload engine (parallel parts, checksums, pause/resume/cancel); media.api.test.ts, e2e upload.spec.ts |
| F07 | Ingest | Authorized URL import | Implemented and verified | Direct links only, SSRF-safe (ADR-023); provider pages refused (no licensed integration) |
| F08 | Ingest | Media probe | Implemented and verified | Ingest worker: signature, isolated probe (duration, resolution, fps, VFR, codecs, rotation, DRM), test decode, thumbnail; services/worker/tests. Runs on the project's LGPL FFmpeg build as separate processes (ADR-029); legal review pending |
| F09 | Ingest | Transcode/proxy | Implemented and verified | VP9/Opus WebM playback copy on the media clock (worker + test on real footage), LGPL FFmpeg (ADR-029) |
| F10 | Ingest | Camera shot boundaries | Implemented, unverified | Hard-cut detector per run; no labelled cut set yet |
| F11 | CV | Visible player detection | Implemented, unverified | RT-DETRv2 persons on the pitch, real footage; precision/recall pending labelled data |
| F12 | CV | Ball detection | Implemented, unverified | COCO sports ball candidates; the engine follows the ball automatically after every analysis (ADR-037, TRACK_BALL): owner's match 48 % of analysed frames placed, rest unknown; ~80 % right by eye, 4/4 owner marks right; precision/recall pending a few hundred owner marks (Page 04 ball dialog). ADR-038: OTSI's own 3-frame ball model trained on the owner's match (held-out crops: precision 0.983, recall 0.815; complaint stretch 17/17 rings on the ball, 0 wrong); full-match measurement pending |
| F13 | CV | Referee/goalkeeper classes | Implemented, unverified (accuracy) | Officials learned per match from colour, no jersey colour assumed (2026-10-31); goalkeepers not separated yet |
| F14 | CV | Multi-target association | Implemented, unverified | Tracker within shots; tracking metrics pending |
| F15 | CV | Camera-motion compensation | Implemented, unverified (accuracy) | Match camera joined from many moments and followed between found frames (ADR-036, test_camera.py) |
| F16 | CV | Occlusion/out-of-frame handling | Partially implemented | Crossing players keep their tracks; one person joined across occlusions and cuts by confirmed links (ADR-031); no automatic bridging |
| F17 | CV | Cross-shot re-ID | Implemented, not verified (accuracy) | Same-person link SUGGESTIONS across occlusions and camera cuts (appearance + kit colour, mutual best), confirmed by a person; rank-1 0.50-0.82 vs simultaneous people on real clips (ADR-031); no labelled ground truth |
| F18 | CV | Team assignment | Implemented, unverified (accuracy) | Team references from the kickoff, kit groups assigned to the match teams by a person (identity-evidence.ts), hard team gate in the tracker |
| F19 | CV | Jersey OCR | Implemented, unverified (accuracy) | Shirt-number evidence per track, proposals from number + roster, person confirms (number-proposals; test_lineup/identity tests) |
| F20 | CV | Player identification | Implemented, unverified (accuracy) | Human decisions; suggestions from linked tracks, look-alikes ranked by look and shirt (ADR-045), Who is this? (ADR-046), number proposals |
| F21 | CV | Human corrections | In progress | DB and API verified (reason, stale refused, history, audit); Him / Not him in the look-alike list; a general correction screen not built |
| F22 | Game | Player on-screen presence | Implemented, unverified (accuracy) | Visibility moments of a confirmed player (Reel Builder) |
| F23 | Game | Pitch calibration | Implemented, unverified (accuracy) | Clicked and automatic calibration of the whole match (ADR-036, pitch.api.test.ts, test_pitch_auto.py, test_geometry.py) |
| F24 | Game | Possession hypotheses | Implemented, unverified (accuracy) | Possession per team from the engine's ball (ADR-040, test_possession.py); owner checked passes by eye |
| F25 | Game | Event candidates | Implemented, unverified (accuracy) | Passes, ball won, shots, key passes (ADR-041), pressures (ADR-042), set pieces (ADR-048), goals from the scoreboard (ADR-049), possible tackles/interceptions/fouls (events.api.test.ts) |
| F26 | Game | Event review | Partially implemented | Events listed on Page 04 (click to watch), possible events labelled; accept/reject of each event not built |
| F27 | Game | Visible off-ball runs | Implemented, unverified (accuracy) | Runs and sprints from measured positions (2026-11-01) |
| F28 | Game | Formations and team shape | Partially implemented | Team shape: width, length, compactness, where 8+ players measured (heat.api.test.ts); formation names and line height not built |
| F29 | Game | Pressing and transition analysis | Partially implemented | Pressures and balls won back (ADR-042, test_pressing.py); transitions not built |
| F30 | Player | Metrics+uncertainty | Implemented, unverified (accuracy) | Distance, top speed, sprints, event counts per confirmed player (GET /v1/players/:id/measures); measured / not measured labelled |
| F31 | Player | Heatmap and action maps | Implemented, unverified (accuracy) | Heat zones per player and team from measured positions |
| F32 | Player | Scouting profile | Not implemented |  |
| F33 | Player | Comparisons | Not implemented |  |
| F34 | Search | Frame/event indexing | Not implemented |  |
| F35 | Search | Cross-match clip query | Not implemented |  |
| F36 | Reels | Target selection | Implemented and verified | Reel targets pinned to confirmed identity, stale after corrections, refresh (reels.api.test.ts) |
| F37 | Reels | Candidate highlights | Implemented, unverified (accuracy) | Ranked suggestions from the player's engine events (ADR-043); visibility moments as fallback |
| F38 | Reels | Clip trimming | Implemented and verified | Add/trim/reorder/remove with limits (reels.api.test.ts, e2e) |
| F39 | Reels | Timeline graph | Not implemented | DB tables in place (0001) |
| F40 | Reels | Spotlight trajectory | Implemented, not verified (accuracy) | Dense re-analysis of clip windows joined to confirmed observations; DETECTED/INTERPOLATED/MISSING per frame (ADR-032) |
| F41 | Reels | Beam and vignette compositor | Implemented and verified | Soft-ellipse spotlight, ring, caption, fades (test_render_reel.py, visual check) |
| F42 | Reels | Multiformat layouts | Implemented and verified | 16:9, 9:16, 1:1 with player-following crop; overlays and branding (ADR-044, test_overlays.py) |
| F43 | Reels | Audio/captions/branding | Implemented and verified | Captions, score, lower third, watermark, logo, end screen (ADR-044), music with rights declaration (ADR-047), intro/outro and event tags (ADR-050) |
| F44 | Reels | Render orchestrator | Implemented and verified | RENDER job with progress and cancel; Intel GPU H.264; validated output (test_render_reel.py) |
| F45 | Reels | Render validation | Implemented and verified | Validator wired to render jobs; each clip exactly its length in frames |
| F46 | Reports | Report builder | Not implemented | DB tables in place (0001) |
| F47 | Delivery | Rights evaluation | Implemented and verified | Rights grant per video with history; checked before a share link and at every opening (sharing.api.test.ts) |
| F48 | Delivery | Signed downloads | Implemented and verified | Short-lived signed playback/download URLs; private share links (hash only stored), optional expiry, revocable |
| F49 | Delivery | Client review | Not implemented |  |
| F50 | Commercial | Plan/price catalog | Not implemented | DB tables in place (0001) |
| F51 | Commercial | Checkout portal | Not implemented | DB tables in place (0001) |
| F52 | Commercial | Usage accounting | Not implemented | DB tables in place (0001) |
| F53 | Commercial | Quota enforcement | Not implemented | DB tables in place (0001) |
| F54 | Commercial | Invoices/credits | Not implemented | DB tables in place (0001) |
| F55 | Admin | Org/user moderation | Not implemented | DB tables in place (0001) |
| F56 | Admin | Model eval/release | Not implemented | DB tables in place (0001) |
| F57 | Admin | Operations dashboard | Not implemented |  |
| F58 | Governance | Retention and erasure | Not implemented |  |
| F59 | Governance | Audit & provenance | In progress | Verified: append-only audit (ADR-013), one audit writer used by every module with actor kind, request correlation, redaction, audit+outbox atomicity (ADR-019); tenant/role-scoped `GET /v1/audit-events`; outbox dispatcher with receipts, retries, dead letters, re-drive (ADR-018). Pending: platform-admin audit console, security event log for denied requests, provenance lineage for CV/render artifacts |
| F60 | Governance | Import/export governance | Not implemented | DB tables in place (0001) |
| F61 | Frontend | 10 screen state machines | In progress | Routes, layouts and section inventory for all 10 pages (generated from the specs); per-section data and state machines are built with each block |
| F62 | Infra | Backup restore and DR | Not implemented |  |
| F63 | Infra | Security & abuse protection | Not implemented |  |
| F64 | Infra | Integration/e2e production smoke | Not implemented |  |

## Foundation services (block 01)

| Component | Status | Evidence |
|---|---|---|
| Outbox dispatcher (`apps/api/src/core/outbox/dispatcher.ts`, worker `src/workers/outbox-dispatcher.ts`) | Implemented and verified | `test/outbox.dispatcher.test.ts` 14 tests; `tools/smoke/outbox_worker_smoke.py`. Not yet verified: graceful SIGTERM in Linux containers, load. No production subscriber registered yet (`core/outbox/subscribers.ts`) |
| General audit writer (`apps/api/src/core/audit.ts`, `core/redact.ts`) + `GET /v1/audit-events` | Implemented and verified | `test/audit.api.test.ts` 7 tests |
| `X-Request-Id` on every response, stored in audit rows | Implemented and verified | `test/audit.api.test.ts` |

## Owner acceptance journey (directive 2026-10-26, ADR-020)

A step is done only when it works for real on the owner's own footage, with evidence.

| # | Step | Status | What is missing |
|---|---|---|---|
| 1 | Open the application with an empty workspace | Done (engineering) — owner walkthrough pending | `tools/dev/local_stack.py run` starts the real stack on an empty database (`otsi_owner_vie`, verified: no organization, no data); the owner creates their account with `bootstrap-owner` and signs in (docs/RUN_LOCALLY.md). Verified in browser e2e on a scratch stack |
| 2 | Create a project | Done (engineering) — owner walkthrough pending | Upload page: Create Project; projects API (e2e upload.spec.ts) |
| 3 | Upload a real football match video | Done (engineering) — owner walkthrough pending | Browser upload -> ingest worker -> verified with measured facts and thumbnail (e2e on a synthetic test file; the owner's own match footage is the acceptance test). Paste-link import works for direct files, Wikimedia Commons and Internet Archive (live-verified), see ADR-027 for the full table |
| 4 | Start analysis through the UI | Done (engineering) — owner walkthrough pending | Upload page -> Analyse this video -> AI Processing page: Start analysis (analysed frames per second, detail level); browser e2e `workspace.spec.ts` on real match footage |
| 5 | Observe real backend processing | Done (engineering) — owner walkthrough pending | Page 03 polls the run: real step status and progress, the worker's stage message, failure code and reason, cancel, and the measured output (people/ball tracks, shots, frames, time, detector + device). Identity/events/indexing steps say "not built yet" |
| 6 | Open the Analysis Workspace | Done (engineering) — owner walkthrough pending | Page 04 plays the signed playback copy with its own transport (play/pause, seek, step one analysed frame, speed) and the selected track's presence timeline (observed spans; gaps = not observed) |
| 7 | Inspect real player bounding boxes and tracking | Done (engineering) — accuracy against labelled footage not measured | Boxes synchronised to the playhead from the observations API: only DETECTED boxes of the nearest analysed frame (solid = this frame, dashed = nearest analysed frame, nothing interpolated); overlay toggles; temporary track numbers, never IDs. Sampling/tracking study ADR-028 |
| 8 | Review or resolve player identities | Done (engineering, manual review) — automatic suggestions not built | Click a box or track -> identity panel: find a player by name or OTSI Player ID (`GET /v1/players?q=`), confirm, create a provisional player and confirm, "not this player", back to unidentified; corrections need a reason and are appended to the history. Automatic identity suggestions (face/jersey/kit) are Block 07 |
| 9 | Select a player | Partly — a track, and the person group of confirmed links (across cuts), can be selected; reel target selection in Block 10 | Track list with filters; selection highlights the box and opens the identity panel. Selecting a confirmed player for a reel (all his tracks) is Block 07/10 |
| 10 | Create and edit a highlight reel | Implemented and verified (engineering) — owner walkthrough pending | Reel Builder: create from confirmed player, add suggested moments, trim, reorder, aspect, spotlight settings (workspace.spec.ts) |
| 11 | Apply the cinematic spotlight effect | Implemented and verified (engineering) | Spotlight only on detected/interpolated positions of the confirmed player, none where unseen; counts reported per render (ADR-032) |
| 12 | Render an actual playable MP4 | Implemented and verified (engineering) — legal review pending | 1080p H.264 MP4 on the Intel GPU, validated (frame count, faststart, full decode), downloaded in the browser journey; playback verified in desktop Chromium. Commercial use awaits counsel (E3) |
| 13 | Open and verify the rendered output | Implemented and verified (engineering) — owner walkthrough pending | Render result with spotlight coverage, manifest, signed playback and download; stale reels refused after identity corrections |

## Pending checks

- **Hosting database version** (`SELECT VERSION(), @@version_comment;`): PENDING — no authorized connection to the hosting database exists in this project. Development continues on the isolated MySQL 8.4.13 server (owner decision 2026-10-26).

- **Concurrent OTSI ID registration failure (2026-10-27): ROOT-CAUSED AND FIXED** — a locking idempotency lookup in the allocator deadlocked against concurrent ledger inserts (InnoDB reports); migration 0018 makes it non-locking. Measured: 2,220 concurrent issuances (up to 200 at once) with 0 failures and 0 deadlocks; old allocator 48/60 deadlocked in the negative-control test. Evidence: `release-evidence/id-issuance-load/20261027/SUMMARY.md`. Load test kept in the API suite (`identity.stress.test.ts`).

## Release gates and owner sign-offs

All G01–G15 gates: **not started**. Required external sign-offs (QUALITY_GATE_MANIFEST.json): model_licenses, rights_to_source_footage, billing_merchant_account, legal_privacy_and_terms, measured_tracking_accuracy, penetration_test, live_deployment_validation — **none given yet**.

## Owner identity tests (Part 8) — where each is proven
- 1–14, 16–18: database level, `tests/db/test_identity.py`.
- 4, 5, 10–15, 20: again through the HTTP API, `apps/api/test/identity.api.test.ts`. Test 15 (cross-tenant) and test 20 (the same ID from every endpoint) are proven here.
- 19 (reports and exports carry the canonical ID): OPEN — no report or export service exists yet. Tied to the report/export blocks.
- 20 also covers UI workflows. The UI part stays OPEN until the web app exists.
