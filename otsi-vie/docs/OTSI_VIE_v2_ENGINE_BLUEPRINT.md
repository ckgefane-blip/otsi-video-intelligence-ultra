# OTSI VIE v2 — Engine Blueprint

**One document describing the whole engine as it is built today.**
Version 1.0, 2026-11-06. Built from the code, migrations, tests and ADRs in this repository (`D:\OTSI-Workspace\VIE-Engine-v2\otsi-vie`).
It describes what exists; where something is not built or not measured, it says so.

---

## 1. What the engine is

OTSI VIE (Video Intelligence Engine) takes a football match video and turns it into:
- **tracked players and ball** on every analysed frame,
- **identities that a person confirmed** (never guessed),
- **measured football facts**: positions on the pitch, distance, speed, sprints, heat maps, passes, possession, pressing, set pieces, goals,
- **finished products**: a player's highlight reel (a real MP4 with a spotlight that follows him), a player report (PDF), share links and deliveries.

The engine is a complete commercial application, not a demo: 10 approved pages, a backend API, a MySQL database, a video worker, a renderer, access control, rights checks and an audit trail.

It is **generic**. No club, player or match is written into the code. A video is a test input, never a design input.

---

## 2. The rules the engine follows

| Rule | What it means in practice |
|---|---|
| **Unknown beats wrong** | A player is only named when a person confirmed it. Anything not measured shows "Not measured". |
| **Four kinds of truth** | Every fact is **Detected** (seen by the model), **Inferred** (worked out by a rule), **Confirmed** (decided by a person) or **Not measured**. Tracking a box never means we know who it is. |
| **Nothing invented** | No made-up statistics, no off-camera movement, no "AI analysis" text from a language model. Sentences in reports are built by fixed rules from measured numbers and name their source. |
| **One permanent player ID** | Each registered player gets one immutable `OTSI-CCC-YYYY-NNNNNN`, issued once by a transaction-safe allocator, used everywhere (ADR-016). |
| **Zero cost** | Only free, open-source or free-to-use tools and models; runs on this PC (Intel Arc GPU / CPU). No cloud, no paid APIs (ADR-030). |
| **Local engine** | All analysis runs on the owner's machine with local models. No external AI service. |
| **Tenant isolation** | One organization never sees another's data. Enforced in SQL on every query and by tests. |
| **Rights before sharing** | A video may be analysed, but shared or downloaded outside only if its rights say so; checked again at every opening. |
| **Everything audited** | Every change is written to an append-only audit log with who, when, before and after. |

---

## 3. The big picture

```
 Browser (the 10 pages)                 vie.otsi.cc (Cloudflare tunnel to this PC)
        │
        ▼
 Web app  ── Next.js 15, port 4310 ──────────────────────────────────────────────┐
        │  /api/v1/... is passed to the API                                      │
        ▼                                                                        │
 API  ── NestJS 11 + Fastify, port 4520                                          │
   • sign-in, organizations, roles, project access                               │
   • every page's data and actions (≈ 30 modules)                                │
   • rights, share links, PDF reports (local headless Chromium)                  │
   • writes jobs + audit + outbox in one transaction                             │
        │                                    ▲                                   │
        ▼                                    │ results, progress                 │
 MySQL 8.4  (docker otsi-vie-v2-mysql, port 3508; test DB 3507)                  │
   43 forward-only migrations · 126 tables · tenant keys · triggers · audit      │
        │                                    ▲                                   │
        ▼ jobs (worker_jobs)                 │                                   │
 Python worker  (services/worker/vie_worker)                                     │
   ingest · proxy · analyse · ball · pitch · lineups · render                    │
   models on the Intel Arc GPU (OpenVINO), FFmpeg (LGPL), own renderer           │
        │                                                                        │
        ▼                                                                        │
 Local storage  (.local, D: drive): source videos, playback copies, detections,  │
   thumbnails, rendered MP4s, report PDFs — served only through signed URLs ─────┘
```

All parts start together with `tools/dev/local_stack.py run` (and at sign-in through `.local/live/start_live.ps1` for vie.otsi.cc).

---

## 4. The engine pipeline (from video to reel)

| Step | Job | What happens | Stored as |
|---|---|---|---|
| 1. Upload | `INGEST_UPLOAD` / `INGEST_URL` | Resumable upload in parts (checksums, pause/resume, up to 64 GB) or a direct link (SSRF-safe). File signature check, malware scan, isolated probe (duration, resolution, fps, codecs, rotation), test decode, thumbnail. | `video_sources`, `upload_sessions`, `assets` |
| 2. Playback copy | `PROXY` | WebM VP9/Opus copy on the media clock, for the browser player. | asset `PROXY` |
| 3. Quality check | `ASSESS` | Footage quality and a recommended analysis profile (Standard / High accuracy / Ultra-sensitive) with time estimates. | `video_quality_assessments` |
| 4. Analysis | `ANALYZE` | **Shots** (hard cuts) → **Detect** people and ball per sampled frame (RT-DETRv2, tiled, on-pitch filter) → **Track** within each shot (ByteTrack-style, camera-motion compensation) → **Identify evidence**: kit colour group, appearance embedding (DINOv2-small), shirt numbers (PP-OCR), same-person link suggestions, look-alike graph. No identity is created: every track starts *Unidentified*. | `pipeline_runs`, `video_shots`, `tracks`, `track_observations`, `track_links`, `track_appearance`, raw detections as Parquet evidence |
| 5. Ball | `TRACK_BALL` | Follows the ball automatically after every analysis; OTSI's own 3-frame ball model (ADR-038). Frames where the ball is not found stay unknown. | `ball_tracks`, `ball_positions`, `ball_marks` (person marks) |
| 6. Pitch | `CALIBRATE_PITCH` | Automatic (and clicked) calibration of the match camera to pitch metres, per moment. Gives real positions in metres. | `pitch_calibrations` |
| 7. Team sheets | `READ_LINEUPS` | Reads a photographed team sheet (PP-OCRv5); a person approves it into clubs, players and the match roster. | `lineup_cards`, `match_rosters` |
| 8. Identity (people) | — (API) | A person confirms who a track is. Helpers: number + roster proposals, linked tracks across cuts, look-alikes ranked by look and shirt, "Who is this?". History is appended, never rewritten; corrections make reels stale. | `track_identity_decisions`, `players` |
| 9. Football facts | — (API + worker) | From confirmed tracks and calibrated positions: distance, top speed, sprints, heat zones, team shape; from the ball: possession, passes, key passes, balls won, pressures, shots, set pieces, goals (from the scoreboard), match periods. Each one carries its evidence. | `event_candidates`, `event_decisions`, measures computed live |
| 10. Reel | — (API) | Reel of a confirmed player: suggested moments from his events or visibility, clips trimmed/reordered, transitions, templates, music, intro/outro, logo, lower third, match info. | `reel_projects`, `reel_clips`, timeline tracks |
| 11. Render | `RENDER` | Dense re-analysis of each clip window; the spotlight follows only **Detected** or **Interpolated** positions of the confirmed player (none where unseen); overlays; 16:9 / 9:16 / 1:1 with a following crop; Intel QSV H.264 (also AV1, VP9); validation of frame count and full decode; manifest. | `render_jobs`, asset `REEL` |
| 12. Share & report | — (API) | Rights grant per video; private share links (hash only, optional password, expiry, comments) re-checked at every opening; player report PDF printed by local headless Chromium. | `rights_grants`, `share_links`, `report_jobs`, asset `REPORT` |

Jobs are rows in `worker_jobs`; the worker reports progress and stage messages, and a job can be cancelled at the next batch.

---

## 5. The models and tools (all free)

| Purpose | Tool / model | Licence note | Runs on |
|---|---|---|---|
| People / ball detection | RT-DETRv2-R18 | Apache-2.0 (COCO-trained weights: counsel pending) | Intel Arc GPU via OpenVINO, CPU fallback with parity check |
| Ball | OTSI's own 3-frame ball model | trained in-house (ADR-038) | GPU / CPU |
| Appearance (re-ID evidence) | DINOv2-small | Apache-2.0 | Arc GPU |
| Shirt numbers, team sheets, scoreboard | PP-OCRv4 / v5 | Apache-2.0 | Arc GPU |
| Tracking | own ByteTrack-style tracker | own code | CPU |
| Video decode / encode | FFmpeg, LGPL build, separate processes | LGPL (ADR-029) | CPU + Intel QSV |
| PDF reports | Playwright headless Chromium | Apache-2.0 / BSD | CPU, nothing loaded from outside |
| Malware scan | Microsoft Defender | built into Windows | CPU |

Models are pinned and hash-verified in `services/worker/vie_worker/models/registry.json` (ADR-024). "Free to use" is not legal clearance: licence terms are recorded for counsel.

---

## 6. Data model (main groups)

43 migrations (`database/migrations/0001…0043`), forward only. MySQL 8.4 LTS, no PostgreSQL features.

| Group | Main tables |
|---|---|
| Accounts & tenants | `organizations`, `users`, `memberships` (role), `invitations`, two-step secrets, sessions |
| Projects & access | `projects` (with `access` ORGANIZATION / RESTRICTED), `project_acl` (Viewer / Reviewer / Editor / Manager) |
| Media | `video_sources`, `upload_sessions`, `assets`, `video_frame_index`, `video_shots` |
| Analysis | `pipeline_runs`, `tracks`, `track_observations`, `track_links`, `track_appearance`, `detection_batches`, `ball_tracks`, `pitch_calibrations`, `match_periods`, `event_candidates` |
| Identity | `players` (OTSI Player ID allocator and ledger), `track_identity_decisions` (append-only), merges, nationalities, `clubs`, `matches`, `match_rosters` (with history), `lineup_cards` |
| Reels | `reel_projects`, `reel_clips`, timeline/transition tracks, `effect_presets` (templates), `brand_assets` (logos, music, intro/outro), `render_jobs` |
| Reports & scouting | `report_jobs`, `player_assessments` (draft / published), `player_tags`, `comments` (reel and player notes), `scouting_dossiers` |
| Rights & sharing | `rights_grants`, `share_links`, `share_link_access`, `policy_decisions`, `deliveries` |
| Library | `library_folders`, `library_folder_items`, `library_deletions` (Trash) |
| Governance | `audit_events` (append-only), `outbox_events`, `worker_jobs`, `worker_status` |
| Commercial (tables only) | plans, prices, usage, quotas, invoices — **not built** |

Database safeguards: tenant keys on every child table, foreign keys that include the organization, CHECK constraints for every state, append-only triggers for audit and identity history, least-privilege runtime account (`otsi_app`, per-table grants), never the existing MySQL on port 3306.

---

## 7. Security and access

1. **Sign-in**: local sign-in with rotating refresh sessions, reuse detection, lockout; optional two-step codes (any free authenticator app) with recovery codes (ADR-021, ADR-051).
2. **Organization**: every request names its organization; the API checks an active membership in MySQL on every request. The token's own claims are never trusted for the role.
3. **Six roles**: Owner, Admin, Analyst, Editor, Scout, Viewer. Each route lists the roles allowed.
4. **Project lock** (ADR-057): a project can be restricted to chosen people. One central check resolves every id a request names to its project: hidden projects are "not found" everywhere; lists and totals leave them out. A project permission only narrows a role, never raises it.
5. **Media** is served only through short-lived signed URLs. Shared links store only a hash of the token.
6. **Rights**: separate rights to analyse, to share and to download; guardian consent for minors; checked at link creation and at every opening; every decision stored.
7. **Audit and outbox**: every change writes an audit row and its event in the same transaction (ADR-012, ADR-019).

---

## 8. The 10 pages and what drives them

| # | Page | What it does with the engine |
|---|---|---|
| 01 | Home / Dashboard | Totals (matches analysed, players tracked, reels, reports), weekly trend, latest confirmed player, hero moment, recent matches, machine load |
| 02 | Upload & Ingest | Projects, resumable upload, link import, analysis switches, quality check |
| 03 | AI Processing | Live job steps, progress, stage message, cancel, measured output |
| 04 | Analysis Workspace | Video with boxes, ball, overlays (tracks, team shape, heat, pass arrows); identity panel; events; team sheets |
| 05 | Tactics | Team shape, heat zones, pass network, possession |
| 06 | Reel Builder | Reel of a confirmed player, suggested moments, spotlight settings, render |
| 07 | Clip Studio | Timeline editor: clips, transitions, templates, music, graphics, intro/outro |
| 08 | Player Report | Profile, measures, events, comparison, insights, notes & tags, assessment, dossiers, PDF and share link |
| 09 | Library | All assets, folders, Trash, saved searches, project access, collaborators, Shared With Me |
| 10 | Export & Delivery | Export settings, branding, queue, share links; output bundles and client delivery are being built now |

Page wiring progress for 07–10 is tracked row by row in `docs/WIRING_PAGES_07-10.md`.

---

## 9. Where the engine stands (2026-11-06)

| Area | Status |
|---|---|
| Upload, probe, playback copy, link import | Implemented and verified |
| Detection, tracking, cuts, ball, pitch calibration | Implemented, runs on real footage — **accuracy not yet measured on labelled footage** |
| Identity (human confirmation, OTSI ID, rosters, team sheets, suggestions) | Implemented and verified (workflow); suggestion accuracy not measured |
| Football facts (distance, speed, heat, passes, pressing, set pieces, goals) | Implemented — accuracy not measured |
| Reel Builder, Clip Studio, spotlight render to MP4 | Implemented and verified |
| Player Report (comparison, insights, assessment, notes, PDF, share) | Implemented and verified (ADR-056) |
| Library (folders, Trash, access lock, Shared With Me) | Implemented and verified (ADR-052, ADR-057) |
| Rights, share links, signed downloads | Implemented and verified |
| Export bundles and Deliver to Client | In progress (page 10) |
| Event accept/reject, formations by name, transitions analysis, cross-match search | Not built |
| Billing, quotas, invoices, admin console, retention/erasure, backups/DR | Not built |
| Release gates G01–G15 (accuracy, legal, penetration test, live validation) | Not started |

Test suites at this version: API 188 tests, web 58, database 88, plus worker tests on real footage.

---

## 10. What blocks a commercial release

1. **Measured accuracy**: precision/recall for detection, tracking (HOTA / IDF1), identity switches, ball and events need manually labelled football footage.
2. **Legal**: model and dataset licences (COCO-trained weights), FFmpeg/codec patents, privacy and terms, rights to source footage.
3. **Commercial**: billing needs a merchant account (owner decision).
4. **Operations**: backups and restore, monitoring, load tests, penetration test, production deployment checks.

---

## 11. How to run, test and change it

- **Run**: `tools/dev/local_stack.py run --public-origin https://vie.otsi.cc` (temp files on D:). See `docs/RUN_LOCALLY.md`.
- **Tests**: API `cd apps/api && npx vitest run`; web `cd apps/web && npx vitest run`; database `python -m pytest tests/db`; worker tests in `services/worker/tests`.
- **Change**: every material decision gets an ADR in `docs/ADRs/` and a row in `blueprint/CHANGELOG.md`; migrations are forward only; commits are local (never pushed without the owner).

## 12. Decision record index (ADRs)

| Area | ADRs |
|---|---|
| Database, audit, outbox, roles | 011 schema corrections · 012 outbox · 013 append-only history · 014 migrator · 015 least privilege · 018 dispatcher · 019 audit writer |
| Identity and players | 016 OTSI Player ID · 017 identity authorization · 031 same-person links · 033 shirt numbers and rosters · 039 team sheets · 045 his other tracks · 046 Who is this? |
| Accounts | 020 real operation by default · 021 local sign-in · 051 invitations, roles, two-step · 057 project access lock |
| Ingest and media | 022 jobs and ingest · 023 link import · 025 tracking playback and media clock · 027 provider adapters · 029 LGPL FFmpeg |
| Computer vision | 024 detector and model registry · 026 Intel GPU · 028 frame sampling · 034 ultra-sensitive profile · 036 pitch calibration · 037 ball tracking · 038 own ball model |
| Football facts | 040 possession and passes · 041 key actions · 042 pressing · 048 set pieces · 049 goals from the scoreboard |
| Reels and rendering | 032 reel builder and spotlight · 043 event reels · 044 overlays and branding · 047 music · 050 event tags, match card, intro/outro · 054 pitch overlays · 055 transitions and templates |
| Library, sharing, reports | 052 folders and Trash · 053 share password and comments · 056 player report and PDF |
| Policy | 030 zero-cost development · 035 presentation layer |

---

*This blueprint is updated when the engine changes. The authoritative detail is in the ADRs, the migrations and the tests.*
