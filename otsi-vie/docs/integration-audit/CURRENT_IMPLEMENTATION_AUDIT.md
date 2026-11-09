# Current implementation audit — OTSI VIE v2

**Audited commit:** `d3ef2f5` (branch `main`, local only, not pushed) · **Date:** 2026-10-27 · **Auditor:** lead developer (Claude Code)
**Evidence of record:** full local CI run `release-evidence/ci/20261026T211437Z/` (UTC folder name; run on 2026-10-27 local time) — 13/13 steps passed.

## How to read the statuses
| Status | Meaning in this audit |
|---|---|
| **Implemented and verified** | Performs the real operation in the running app (or worker), and automated tests exercise it against real MySQL / real media / the real browser build. |
| **Implemented, not verified** | The code runs on real input, but a required quality claim is unmeasured (typically: model accuracy without labelled football footage). |
| **Partially implemented** | Some of the specified behaviour exists and is tested; named parts are missing. |
| **Not implemented** | No working code path. A database table, a contract name in a page spec, or a visible but unconnected UI section does **not** count. |
| **Blocked** | Cannot be finished without an owner decision, a licence, a credential, data or a purchase. |

## Test evidence at `d3ef2f5`
| Suite | Command (via `tools/ci/run_ci.py`) | Result |
|---|---|---|
| API integration (real MySQL 8.4.13) | `apps/api: pnpm test` | 63 passed (6 files) |
| Database migrations, constraints, tenant isolation, identity | `pytest tests/db` | 86 passed |
| Outbox dispatcher (compiled) smoke | `tools/smoke/outbox_worker_smoke.py` | passed |
| Worker: ingest, link import, providers, tracker, analysis on real footage | `pytest services/worker/tests` | 79 passed, 3 skipped (opt-in live provider tests; they pass with `OTSI_VIE_LIVE_TESTS=1`, evidence `release-evidence/link-import/20261027-live/`) |
| Web unit | `apps/web: pnpm test` | 28 passed |
| Web browser end-to-end (production build, real API, real worker) | `tools/dev/e2e.py` | 26 passed, including the real-footage journey upload → analysis → boxes → identity |
| Licence gate, page-spec freshness, typechecks, production builds | CI steps 1-5, 10, 12 | passed |

Measurements: GPU benchmark `release-evidence/model-benchmarks/20261027-devices/`, sampling study `release-evidence/sampling-study/20261027/`,
browser screenshots `release-evidence/browser/20261027-analysis-journey/`.

## Construction blocks (00–15)
| Block | Scope | Status | What exists (evidence) | What is missing |
|---|---|---|---|---|
| 00 | Repository, licences, footage, ADRs, threat model | Partially implemented | Repo, 28 ADRs, threat model, licence register + CI licence gate, local CI | Owner: authorised/labelled footage, model-weight counsel review, approved logo and palette |
| 01 | MySQL migrations, tenant isolation, outbox, audit | **Implemented and verified** (for what exists) | Migrations 0001-0013 (checksum-locked), least-privilege roles, 27 composite tenant FKs, append-only history, outbox dispatcher (receipts, retries, dead letters), audit writer + `GET /v1/audit-events` — 86 DB + API tests | Backup/restore drill (Block 15); hosting DB version check pending (no authorised connection) |
| 02 | Auth, organisations, users, RBAC admin | Partially implemented | Local sign-in, rotating refresh cookie with reuse detection, lockout, CSRF, `/v1/me`, organisation switch, role checks on every route (auth.api 11 tests, e2e) | MFA, invitations/member management, password change/reset, external OIDC, admin console |
| 03 | Upload, probe, URL import | Partially implemented (core verified) | Resumable chunked upload (checksums, resume, abort), ingest worker (signature sniff, isolated probe, test decode, policy, thumbnail), Defender malware scan, SSRF-safe link import, provider adapters (ADR-027) | S3/object-storage adapter, upload-expiry clean-up, OS-level decode sandbox, live verification of Vimeo/Google Drive/Dropbox/HLS |
| 04 | Proxy, PTS map, player UI, timeline | **Implemented and verified** (playback scope) | VP9/Opus playback copy on the media clock, frame/timestamp index, signed Range media gateway, Analysis Workspace player + transport + presence timeline (e2e) | Match clock map (periods/halves), multi-camera, 4K proxy option |
| 05 | Detector and box API | Implemented, not verified (accuracy) | RT-DETRv2-R18 (Apache-2.0) via hash-pinned registry, tiling, pitch filter, OpenVINO on the Arc GPU with parity self-check and CPU fallback (ADR-024/026); Parquet evidence; observation-window API | Precision/recall on labelled football footage; referee/goalkeeper/role classes; counsel on COCO-trained weights |
| 06 | Tracker, cuts, gaps | Implemented, not verified (accuracy) | Hard-cut detector, ByteTrack-style tracker within shots, distance-gated ball association, presence intervals; sampling study on 3 real clips (ADR-028) | HOTA/IDF1 against labelled footage; occlusion re-entry handling; camera-motion compensation at full resolution |
| 07 | Roster, OCR, re-ID, human review | Partially implemented | Manual identity review in the UI (find/create player, confirm, reject, reset; corrections need a reason) on top of the verified identity API | Team/kit classification, jersey OCR, appearance re-ID, cross-shot association, roster per match, review queues |
| 08 | Events, pitch calibration, metrics | Not implemented | — | Everything |
| 09 | Tactical and player reports | Not implemented | — | Everything |
| 10 | Reel candidates, persistent editor | Not implemented | DB tables and the pinned reel-target rule exist (not counted) | Reel service, editor API, UI |
| 11 | Spotlight compositor, MP4 encoding | Not implemented · **encoder decision blocked** | — | Compositor; MP4 encoder choice needs owner/counsel decision (see `MP4_ENCODING_AND_LICENSING_REVIEW.md`) |
| 12 | Rights, watermark, export, sharing | Not implemented | DB tables exist (not counted) | Everything |
| 13 | Billing, quota, metering | Not implemented · blocked for live payments | DB tables exist (not counted) | Merchant account (owner), plans, metering |
| 14 | 10 frontend pages + admin console | Partially implemented | All 10 pages render every approved section in the approved composition; pages 02, 03 and 04 are connected to real data for one video; shell (auth, org switch, theme, page palette) | Pages 01, 05-10 have no data; admin console absent |
| 15 | Observability, load, backups, privacy, security, release | Not implemented | Request IDs, redacted logs (not counted as observability) | Metrics/tracing, load tests, backup/restore, retention/erasure, release gates G01-G15 |

## Engineering functions F01–F64
| ID | Function | Status | Evidence / gap |
|---|---|---|---|
| F01 | Tenant registration / invites | Partially implemented | First organisation + owner via CLI bootstrap only; no self-registration, no invitations |
| F02 | Session OIDC/MFA | Partially implemented | Local sign-in verified (auth.api, e2e); MFA and external OIDC absent |
| F03 | Roles/policy engine | Partially implemented | Membership roles enforced on every route from MySQL (deny by default), DB least-privilege roles verified; no policy engine, no role administration |
| F04 | Project & match CRUD | Partially implemented | Projects create/list/read/edit verified (optimistic concurrency, audit); **matches do not exist** (no teams, competition, date, score) |
| F05 | Player registry & roster | Partially implemented | Create/register/lookup/merge/search verified, allocator verified under concurrency; no rosters, aliases, club/jersey history, registry admin tools |
| F06 | Resumable upload | **Implemented and verified** | media.api, upload.spec.ts |
| F07 | Authorised URL import | **Implemented and verified** (direct, Wikimedia, Internet Archive) · Implemented, not verified (Dropbox, HLS, Vimeo, Google Drive — offline stand-ins only) | ADR-027, test_providers.py, live tests |
| F08 | Media probe | **Implemented and verified** · distribution **blocked** | Works; the bundled FFmpeg is a GPL build (licence register) |
| F09 | Transcode / proxy | **Implemented and verified** · distribution **blocked** (same FFmpeg build) | Playback copy used by the workspace e2e |
| F10 | Camera shot boundaries | Implemented, not verified | 6/6 reference cuts found on the Naples clip; no labelled cut set; extra cuts on fast pans at ≤3 fps |
| F11 | Visible player detection | Implemented, not verified | Real footage, e2e shows boxes; precision/recall unmeasured |
| F12 | Ball detection | Implemented, not verified | Tracked in 73-97 % of frames with a ball detection at 2 fps (ADR-028); detection recall unmeasured |
| F13 | Referee/goalkeeper classes | Not implemented | All people are `PERSON` |
| F14 | Multi-target association | Implemented, not verified | Within-shot tracker; persistent switches 0-7 per clip vs dense reference (not ground truth) |
| F15 | Camera-motion compensation | Not implemented (measured, rejected at thumbnail resolution — ADR-028) | Tracker accepts a camera shift; off in production |
| F16 | Occlusion / out-of-frame handling | Partially implemented | Tracks survive short misses (≤1 s) and end otherwise; gaps shown as "not observed"; no re-entry linking |
| F17 | Cross-shot re-ID | Not implemented | Kit-colour re-ID measured and rejected (ADR-028) |
| F18 | Team assignment | Not implemented | |
| F19 | Jersey OCR | Not implemented | |
| F20 | Player identification | Partially implemented | Human confirmation only (UI + API verified); no automatic suggestions |
| F21 | Human corrections | **Implemented and verified** | Append-only decisions, reason required, stale-decision refusal, audit + outbox; UI e2e |
| F22 | Player on-screen presence | Partially implemented | Presence intervals per track and the selected track's timeline; not per player across tracks |
| F23 | Pitch calibration | Not implemented | |
| F24 | Possession hypotheses | Not implemented | |
| F25 | Event candidates | Not implemented | |
| F26 | Event review | Not implemented | |
| F27 | Visible off-ball runs | Not implemented | |
| F28 | Formations and team shape | Not implemented | |
| F29 | Pressing and transitions | Not implemented | |
| F30 | Metrics + uncertainty | Not implemented | |
| F31 | Heatmaps and action maps | Not implemented | |
| F32 | Scouting profile | Not implemented | |
| F33 | Comparisons | Not implemented | |
| F34 | Frame/event indexing | Partially implemented | Frame/timestamp index of analysed frames only; no event index |
| F35 | Cross-match clip query | Not implemented | |
| F36 | Reel target selection | Partially implemented | DB rule pinning a reel target to a confirmed decision is verified; the workspace selects a track; no reel service |
| F37–F45 | Reel candidates, trimming, timeline, spotlight trajectory, compositor, layouts, audio/captions, render orchestrator, render validation | Not implemented | F41/F44 also depend on the encoder decision (blocked) |
| F46 | Report builder | Not implemented | |
| F47 | Rights evaluation | Not implemented | |
| F48 | Signed downloads | Partially implemented | Signed, expiring, Range-capable media gateway exists for playback copies only; no export downloads |
| F49 | Client review | Not implemented | |
| F50–F54 | Plans, checkout, usage, quota, invoices | Not implemented · live billing blocked (merchant account) | |
| F55 | Org/user moderation | Not implemented | |
| F56 | Model evaluation/release | Partially implemented | Hash-pinned registry, device parity check, benchmark + sampling-study tools; no evaluation thresholds/approval workflow (needs labelled data) |
| F57 | Operations dashboard | Not implemented | |
| F58 | Retention and erasure | Not implemented | |
| F59 | Audit & provenance | Partially implemented | Audit writer + API verified; import provenance and model version per run recorded; no admin console, no render lineage |
| F60 | Import/export governance | Partially implemented | Import policy (providers.json), user-authorisation sealing, malware scan, provenance; no export governance |
| F61 | 10 screen state machines | Partially implemented | Pages 02-04 (per video) connected; others show honest "Not connected" states |
| F62 | Backup, restore, DR | Not implemented | |
| F63 | Security & abuse protection | Partially implemented | Threat-model controls for auth, CSRF, SSRF, uploads, tenant isolation verified; no rate limiting service, WAF, abuse handling |
| F64 | Integration/e2e production smoke | Not implemented (local e2e only) | Local real-stack e2e exists; no deployed environment |

**Tally (64 functions):** implemented and verified 5 (F06, F07 core, F08, F09, F21) · implemented, not verified 4 (F10, F11, F12, F14) · partially implemented 16 · not implemented 39 · functions carrying a blocked component: F08, F09 (distribution), F41, F44 (encoder), F50-F54 (merchant account).

## Acceptance journey (ADR-020)
| # | Step | Status |
|---|---|---|
| 1 | Empty workspace | Implemented and verified (e2e); owner walkthrough pending |
| 2 | Create project | Implemented and verified |
| 3 | Upload real match video | Implemented and verified (e2e on real CC BY-SA footage) |
| 4 | Start analysis in the UI | Implemented and verified |
| 5 | Observe real processing | Implemented and verified |
| 6 | Open Analysis Workspace | Implemented and verified |
| 7 | Real boxes and tracking | Implemented, not verified (accuracy) |
| 8 | Review/resolve identities | Partially implemented (manual only) |
| 9 | Select a player | Partially implemented (a track, not a player across tracks) |
| 10 | Create/edit reel | Not implemented |
| 11 | Spotlight effect | Not implemented |
| 12 | Render MP4 | Not implemented · encoder decision blocked |
| 13 | Verify rendered output | Not implemented |

## Remaining gaps, in dependency order
1. Labelled football footage (owner) → detector/tracker accuracy, model approval thresholds.
2. Matches (teams, competition, date) and per-match rosters → Block 07 identity suggestions, reports, Library.
3. Team/kit classification, jersey OCR, re-ID evaluation → automatic identity candidates (always human-confirmed).
4. Encoder decision (owner/counsel) → Block 11 render; then reels (Block 10), export (Block 12).
5. Production FFmpeg build swap (LGPL) before any distribution.
6. Admin console, invitations, MFA; billing (merchant account); operations/backup (Block 15).
