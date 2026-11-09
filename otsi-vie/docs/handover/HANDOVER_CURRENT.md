# Handover: where OTSI VIE v2 stands (kept current; last update 2026-11-09)

Read this first. `HANDOVER.md` and `AUDIT_HANDOVER.md` (2026-10-29) describe how the 10 pages were built and audited; they are still
right about method, but not about status. Work plan: [OTSI VIE v3 Complete Phase Plan](../../../blueprint/v3/OTSI_VIE_v3_Complete_Phase_Plan.md) (phases 0, A–E, track G). See also the [screen-level upgrade blueprint](../../../blueprint/v3/OTSI_VIE_v3_Screen_Level_Upgrade_Blueprint.md).
Every change has an ADR in `docs/ADRs/` and a line in `../blueprint/CHANGELOG.md`.

## 1. Running it
- **Live:** vie.otsi.cc, through a fixed Cloudflare tunnel to this PC. Redeploy after every update.
  - The live stack runs a fixed build (no watch): a code change shows only after a redeploy.
- **Local:**
  - web on 4310 (Next.js), API on 4520 (NestJS/Fastify);
  - MySQL 8.4 in Docker `otsi-vie-v2-mysql`, database `otsi_owner_vie`, port 3508; the test DB is on 3507;
  - Python worker in `services/worker`.
  - Never touch the MySQL on 3306 (another app).
- **Start / redeploy** (from `VIE-Engine-v2`, with TEMP, TMP and COREPACK_HOME under `D:\OTSI-Workspace\VIE-Engine-v2\.local\tmp`):
  ```
  .venv/Scripts/python.exe otsi-vie/tools/dev/local_stack.py run --public-origin https://vie.otsi.cc
  ```
  - Stop the running stack first, and only when nothing is running: `worker_jobs.state` QUEUED/RUNNING = 0 and `upload_sessions.status` not COMPLETED/ABORTED = 0.
  - Check: pages answer 200 through vie.otsi.cc, and `/api/v1/...` without sign-in answers 401.
- **Tests:**
  - web: `apps/web: npx vitest run` and `npx tsc --noEmit -p .`
  - API: `apps/api: npx vitest run`
  - contracts build: `corepack pnpm --filter @otsi-vie/contracts run build`
  - worker: `../.venv/Scripts/python.exe -m pytest -q services/worker/tests/...`. The real-footage render tests take about 11 min.
- **Database password:** in `.local/mysql-owner.env`. Never print it.

## 2. House rules that bite
- **Line endings:** the repo mixes CRLF and LF.
  - Preserve the file's original endings. Never `sed -i` on a CRLF file.
  - Check with `git diff --numstat` against `--ignore-cr-at-eol`.
- **Commits:** local only, with a pathspec. Never push.
- **Owner's data is view-only:** never start or cancel the owner's jobs; the owner clicks.
- **Truth:** unknown beats wrong; the engine is generic (never tuned to one match); zero cost (ADR-030); everything runs locally.
- **Design stage:** sized in design units (`u()`, `--u` from `100cqw/2560`). The container query makes `position: fixed` inside it relative to the stage, not the window. That is why full screen uses a modal `<dialog>` (top layer); see ADR-079.

## 3. Status by phase
- **Phase 0 (truth and polish):** done.
  - 0.12 Dev mode and the 0.13 4:5 frame were finished in ADR-080.
  - Kept on purpose: 0.10, the Library left-panel controls, because they work. Removing them needs the owner.
- **Phase A (shell and trust, A.1–A.15):** done. ADR-060 to ADR-078.
- **Extras on 2026-11-07:**
  - ADR-079: one full screen for all six players, and a steady spotlight beam (the path is smoothed the same way in the preview and the render).
  - The render's sound now ends exactly with the picture.
- **Phase B (editing and discovery):** in progress.
  - B.1 done (ADR-081, migration 0052): reel edit history on the server with compensating undo, and a History dialog in Clip Studio and Reel Builder.
  - B.3 done (ADR-082, migration 0053): Analysis timeline "Engine lanes" (shots, ball found, pitch measured, selected player, markers) and video markers.
  - B.4 + B.5 done (ADR-083, migration 0054): player tools (frame back, In/Out + Loop, zoom, overlay opacity) and Snapshots (SNAPSHOT job, media worker).
  - B.6 + B.7 done (ADR-084, no migration): Properties card with identity history, and the "Before you save" identity impact note.
  - B.8 done (ADR-085): Analysis centre tabs open the matching Tactical tab with the same video, moment and player; duplicate Player Comparison removed from Analysis.
  - B.10 done (ADR-086, migration 0055): search index (outbox subscriber `search.index` + catch-up before each search) and Smart Search (moments, markers, `type:`/`event:`/`is:` filters).
  - B.11 done (ADR-087): Smart Bins (saved Smart Searches that fill themselves) in the Library tree and the Clip Studio Media Bin.
  - B.12 done (ADR-088): Library card/table toggle, Rights/Evidence/Profile/Device and lock columns (GET /v1/library/facts), bulk Move and CSV.
  - B.13 done (ADR-089): Generate Reel confirmation (summary + measured estimate, GET /v1/reels/:id/render-estimate); reel reopens at the last step used.
  - B.14 done (ADR-090): Reel Builder live spotlight with the edited look (reelstage/LiveSpotlight.tsx) and per-clip coverage bar (solid detected, hatched bridged).
  - B.15 done (ADR-091, migration 0056): moment badge + coverage, reject/restore, swap, move; inline "Is this him?" (reelstage/WhoQueue.tsx).
  - B.16 done (ADR-092): timeline zoom/list, spotlight presets, music licence note.
  - B.19 part 1 done (ADR-093): Clip Studio slip, snap, lane solo, tall lane, project panel; AI Highlights skips rejected moments.
  - B.19 part 2 done (ADR-094): spacer (gap before a clip) through API, preview and render.
  - B.20 done (ADR-095): audio mixer (clip level and mute, loudness target, measured readout).
  - B.21 done (ADR-096, migration 0057): transitions picker and every-cut, marker list, saved clip blocks.
  - B.22 done (ADR-097, migration 0058): export preset library, batch to several frames, preflight.
  - B.23 done (ADR-098, no migration): hide no-action chapters, report preview before making, record video rights from the preflight.
  - B.24 done (ADR-099, no migration): Player Report designer with live preview, publish gate (409 IDENTITY_UNCONFIRMED), KPI coverage
    lines, comparison group named, picker landing. Checked in the browser.
  - B.25 done (ADR-100, no migration): Clip Studio "Suggested cuts" (Inferred clip ends around his events, Apply = trim); picker lists
    players before typing. **Phase B is complete except the owner-decision items.**
- **Phase C:**
  - C.1 done (ADR-102, migration 0059). The command palette has guide cards, one-step plan preview, and explicit approval
    for Smart Search, job status, and workspace navigation. Approval and step outcomes are audited. API 253 and web 205 tests passed.
    Redeployed and checked in the signed-in local browser, view only.
  - C.3 done (ADR-103, no migration). OpenTimelineIO (`.otio`, `Timeline.1`) timeline export and `.otsi-reel` (`otsi-reel/v1`) manifest
    carrying the evidence flags (`GET /v1/reels/:id/interchange`, `/otio`, `/otsi-reel`, and the Export Settings `Interchange…` dialog).
    API 255 and web 208 tests passed. Redeployed and checked in the signed-in local browser, view only.
  - C.4 done (ADR-104, migration 0060). Archive bundle (`otsi-archive/v1`) with `manifest.json` and chronological `audit-extract.json`
    (plus `.otsi-reel`, `.otio`, and `reel.mp4` for reels); video rights (`archive-v1`) are checked at pack time and re-checked against live
    `rights_grants` and `reel_targets` on every open and download (`GET /v1/archives/status`, `POST /v1/archives`, `GET /v1/archives/:id`,
    `GET /v1/archives/:id/download`; wired into Export `Interchange…` and Library `⋯` menu for Reels, Videos, and Matches). API 259 and
    web 211 tests passed. Redeployed and checked in the signed-in local browser, view only.
  - C.5 done (ADR-105, migration 0061). Offline beat grid analysis (`BEAT_GRID` worker job, `otsi-beat-v1`, NumPy/SciPy BSD-3-Clause,
    licence noted for counsel in `BEAT_LIBRARY_NOTE`) and beat-aware cut snap in Clip Studio (dragged edges snap to detected beats looped
    in reel time; Soundtrack lane beat ticks; Media Bin and Music Picker beat status with on-demand `Find beat`). API 267 and web 215 tests
    passed. Redeployed and checked in the signed-in local browser, view only.
  - C.6 done (ADR-106, no migration). Player scopes in Clip Studio (Waveform, Histogram, Vectorscope, Audio meter in Preview.tsx and Scopes.tsx)
    and QC in render validation (integrated LUFS loudness compliance within ±2.5 LUFS tolerance and black frame detection in validate.py).
    API 267 and web 222 tests passed, worker tests passed. Redeployed and checked in the signed-in local browser, view only.
  - C.8 done (ADR-107, no migration). Headless render command `vie-render <manifest>` for batch and recovery (`services/worker/vie_worker/render/headless.py`,
    `cli.py`, `tools/dev/vie_render.py`; `--dry-run`, `--validate-only`, `--json`; `packages/contracts/src/headless-render.ts`).
    Full test suites passed. Real CC BY-SA 4.0 footage verified.
  - C.9 done (ADR-108, no migration). Dual timeline comparison of two cuts (Cut A vs Cut B diff highlights, SOURCE_MATCH and RELATIVE
    playhead sync, snapshot and swap; packages/contracts/src/dual-timeline.ts, pps/web/src/components/studio/DualTimeline.tsx, Timeline.tsx).
    All 55 web test files passed. Redeployed and verified in browser, view only.
  - C.10 done (ADR-109, migration 0062). Organization templates for Spotlight, Style and Branding (`packages/contracts/src/templates.ts`,
    `apps/api/src/modules/reels/org-templates.ts`, `apps/web/src/components/studio/MediaBin.tsx`, `useStudio.ts`, `useLibrary.ts`, `LibraryMain.tsx`;
    SPOTLIGHT, STYLE, BRANDING, and FULL modular templates, selective apply, built-in presets Broadcast Gold, Dynamic Cyan, Cinematic Warm,
    Library templates tab). API 270 and web 231 tests passed. Redeployed and verified in browser, view only.
  - Highlight & Spotlight Tracker Overhaul done (ADR-110, no migration). Broadcast pitch tracker on targeted player replacing the legacy conical
    sky beam/ray (feet base disc + glowing cyan ring + floating badge with bold player name and secondary metrics; `apps/web/src/components/studio/spotlight.ts`,
    `services/worker/vie_worker/render/reel.py`, `services/worker/tests/test_render_reel.py`). Web (56 files / 231 tests) and worker tests passed.
    Redeployed and verified in browser, view only.
  - **Next migration 0063, next ADR-111.**
- **Phase D:** D.5 part 1 done and verified (ADR-101): `tools/db/backup.py backup|verify`, runbook `docs/runbooks/BACKUP_RESTORE.md`.
  `.local/backups/20261107T143717Z/verify.json`: **OK**, 140 tables, 4,066,306 rows, 2 routines, 32 triggers; no row-count mismatches.
  Verify now uses its own temporary, disk-backed MySQL container on D:, with no network or published port, and removes the container/data.
  The existing test server is not used. Storage is manifest-only, not a copied media backup. Part 2 (schedule needing the owner's yes,
  keep-last-N, binlog point-in-time, a timed drill) is open.
- **Phase E and track G:** not started. Items needing owner decisions are listed in section 5.
- **Track U (Player Auto-Tracking & Engine Ultra-Enhancements):** scheduled as items 31–42 in section 4 (and `docs/ROADMAP.md` Step 9) to run next when the current plan finishes.

### Last session's stopping point (2026-11-09)
- Phase E.3 (ADR-123) is deployed and verified. Next is item 24 in section 4 (Phase E: E.6 Event types shown but unconfirmed in the engine: evidence rules or not measured).
- Browser checks use `http://127.0.0.1:4310/...` (vie.otsi.cc asks for a sign-in in the built-in browser). They are view only on the
  owner's reel `01a199aa-08fd-740d-93a3-a27fec2d7a8b`.
- How each block is done:
  1. contracts in `packages/contracts/src/<name>.ts`, exported from `index.ts` (append a line);
  2. API service and controller, registered in `apps/api/src/app.ts`;
  3. web component;
  4. API test and web test; full suites;
  5. redeploy (idle check, stop, start, wait for 401 on `/v1/notifications`, check 200 through vie.otsi.cc);
  6. view-only browser check;
  7. ADR, CHANGELOG line (CRLF: `printf -- '...\r\n' >> ../blueprint/CHANGELOG.md`), this file;
  8. line-endings check, then commit with a pathspec (exclude `release-evidence/`).

## 4. Next steps (in order): everything of the plan not yet built
Sizes are the plan's (S, M, L). An item marked **owner** waits for a decision in section 5, or for an outside party. Build the others in this
order, one block each, following the steps above.

**Phase B (finish)**
1–2. Done: B.24 browser check and B.25 (ADR-100).
- Owner: B.2 light theme scope; B.9 Tactical tabs (Decision 8); B.17 org templates for Spotlight, Style and Branding (feeds C.10);
  B.18 spotlight hand edits (Decision 9).

**Phase C (depth)**
3. Done: C.1 Local assistant (ADR-102). C.2's small model waits for Decision 10.
4. Done: C.3 OpenTimelineIO export and `.otsi-reel` manifest carrying the evidence flags (ADR-103). Import comes later.
5. Done: C.4 Archive bundle: manifest and audit extract; rights re-checked at pack time and at every open (ADR-104, migration 0060).
6. Done: C.5 Beat grid and beat-aware cut snap: offline analysis with a free library; its licence noted for counsel (ADR-105, migration 0061).
7. Done: C.6 Scopes in the player (waveform, histogram, vectorscope, audio meter), and QC in render validation (loudness, black frames) (ADR-106).
8. Done: C.8 Headless render command `vie-render <manifest>` for batch and recovery (ADR-107).
9. Done: C.9 Dual timeline: compare two cuts (Pro) (ADR-108).
10. Done: C.10 Save and share Spotlight, Style and Branding as organization templates (ADR-109, migration 0062).
- Owner: C.2 (Decision 10); C.7 local captions (Decision 4 and counsel).

**Phase D (commercial and operations, engineering parts)**
11. Done: D.3 Admin console for members, model registry, concurrency controls and security audit trail (ADR-111).
12. Done: D.4 Retention and erasure: retention per asset type, subject erasure, Trash retention shown to users, purge trash endpoint, GDPR right to be forgotten (ADR-112, migration 0063).
13. Done: D.5 Backups and disaster recovery: scheduled MySQL and storage backups, restore test, recovery runbook, keep-last-N retention, and Admin Console status (ADR-101, ADR-113).
14. Done: D.6 Monitoring and alerts: worker health, queue depth, disk, GPU thresholds, and local alerts in Admin Console (ADR-114).
15. Done: D.7 Load tests: many uploads, long matches, concurrent renders, and resource audits (ADR-115).
16. Done: D.9 Production deployment checks: config review, secrets entropy, tunnel hardening, preflight CLI, and upgrade/rollback runbook (ADR-116).
17. Done: D.10 Release gates G01–G15 status page for the owner: live governance dashboard in Admin Console, G01–G15 contracts and API endpoint (ADR-117).
- Owner or outside party: D.1 legal (model, dataset, codec licences, privacy, terms); D.2 billing (merchant account, Decision 11);
  D.8 penetration test.

**Phase E (analysis truth)**
18. Done: E.1 Event accept/reject: an analyst confirms, edits, or rejects each detected event; rejected events leave reels, player reports, and stats; append-only audit trail in `event_decisions` and `audit_events` (ADR-118).
19. Done: E.4 Transitions analysis (ball won or lost, to the next action), labelled Inferred; team comparison KPIs, counter-press within 5s, interactive stream (ADR-119).
20. Done: E.5 Cross-match search by player, event and period: match half bounds from `match_periods`, `period:h1|h2` and `player:...` filters, search index version 2, and Command Palette period badges (ADR-120, migration 0064).
21. Done: E.7 Pressing metrics from existing pressing events: High Press Success, Final Third Regains, Avg Press Height, calibrated pitch map, and E.1 rejection exclusion (ADR-121).
22. Done: E.8 Roles confirmed by a person (ADR-122, migration 0065): role confirmation state, analyst metadata audit, confirmed-only filtering in GET /v1/players, GET /v1/player-list, global Smart Search (role:am, is:confirmed_role), and player report cohort lines, with interactive badges in PlayersList.tsx and PlayerComparison.tsx.
23. Done: E.3 Formations by name from calibrated positions (ADR-123, migration 0066): line-based clustering into canonical formations (4-3-3, 4-2-3-1, etc.), labelled Inferred, person confirmation workflow with audit trail, Formation Stability %, live Defensive Line Height (m and %), and tactical phase shapes in Panels.tsx.
24. Done: E.6 Event types shown but unconfirmed in the engine (ADR-124): tackles, interceptions, offside line, chances created, progressive passes, xG, xA, carries, PPDA, off-ball runs enforced by rigorous sensor evidence rules or kept 'Not measured'; never fabricated. Added contracts evidence-rules validator functions, GET /v1/videos/:id/evidence-audit endpoint, PPDA calculation in PressingService with honest explanation tooltips in PressingPanel, metric-specific reasons in PlayersPanel, and Panels.tsx off-ball run tooltips.
- **Phase E is complete!** All analysis truth requirements (E.1, E.2, E.3, E.4, E.5, E.6, E.7, E.8) are fully implemented and verified.

**Track G (model evaluation; runs beside the phases)**
25. G.1 Labelled football test set: clips, boxes, identities, ball, events. Free and open data only, with its licence recorded.
26. G.2 Measure detection precision and recall, tracking HOTA and IDF1, identity switches, ball, pitch calibration error.
27. G.3 Event accuracy per event type.
28. G.4 Identity-suggestion accuracy: number plus roster, look-alikes, "Who is this?".
29. G.5 Regression run on every model or threshold change; results stored per model version.
30. G.6 Replace "accuracy not yet measured" with the measured figure and its test set, per value type.

**Track U (Player Auto-Tracking & Engine Ultra-Enhancements — scheduled next when the current plan finishes)**
31. U.1 (M) Occlusion-protected phase follower (`follow.py`): mutual-overlap foreground/background guard (`y2` foot ordering) to freeze FFT patch updates while occluded + forward-backward phase-correlation consistency check.
32. U.2 (M) Deep-EIoU + selective on-demand `DINOv2-small` association gate (`tracker.py`, `embed.py`) for ambiguous same-team crossings and post-occlusion recovery.
33. U.3 (M) Intra-track same-team identity swap splitter (`appearance.py`): extend `split_on_shirt_change` to split tracks with high internal embedding drift (`drift >= 0.28`) or conflicting `RECOGNIZED` jersey numbers at the crossing discontinuity frame.
34. U.4 (L) Pitch-plane (2D world-coordinate) & 8-DOF homography-warped Kalman tracking (`tracker.py`, `camera.py`) with biomechanical speed/acceleration gates (`v <= 10.5 m/s`).
35. U.5 (M) Grass-masked 4-stripe part-based Re-ID embeddings (`appearance.py`, `embed.py`): pool `DINOv2` patch tokens across head/hair/skin, torso/kit, shorts/thighs, and socks/boots after masking turf pixels via `grass_mask`.
36. U.6 (M) Super-resolved & perspective-rectified jersey OCR (`OCR_MIN_PX` `100 -> 75 px`, 2x Lanczos + CLAHE + optional `PARSeq-tiny` / `PP-OCRv5` head) + spatio-temporal pitch reachability and digit posterior fusion in `propose_links` (`jersey.py`, `ocr.py`, `appearance.py`).
37. U.7 (M) Target-anchored dense spotlight re-analysis (`render/reel.py`): anchor 10 fps `target_path()` with the confirmed player's `DINOv2` embedding, `kit_gate`, and intermediate `follow_tracks` up to full render frame rate.
38. U.8 (M) Horizon-guided adaptive multi-scale tiling (`detect/ov_rtdetr.py`, `detect/pitch.py`): restrict `2x2` and `3x3` tiles to `playing_surface` pitch bounds, cutting `ULTRA_SENSITIVE` tile passes by ~40–50% and suppressing stadium-stand/LED-board fragments.
39. U.9 (M) OpenVINO `AsyncInferQueue` (`THROUGHPUT` mode) + Mixed-Precision FP16 backbone / FP32 decoder head in `OvRtDetr` (`detect/ov_rtdetr.py`), preserving `ADR-026` parity check.
40. U.10 (M) Single-pass hardware-accelerated frame decode (`analyze.py`, `follow.py`) unifying `sample_frames` and `FrameStream` with D3D11VA/QSV and a grayscale ring buffer.
41. U.11 (M) Continuous inter-frame pitch calibration propagation (`pitch_auto.py`, `camera.py`): optical-flow homography propagation between `pnlcalib_sv_kp` keypoint frames (`CALIBRATED_PROPAGATED` vs. `CALIBRATED_DIRECT` within `<= 6.0 px` 1-sigma line uncertainty).
42. U.12 (L) 3D parabolic ball flight vs. ground roll separation (`ball.py`, `actions.py`) + calibrated Line-Breaking/Progressive Passes and Pitch Control / Voronoi space occupation (strictly `Inferred` when `>= 8` players/team are calibrated, else `Not measured`).

## 5. Owner decisions still open (plan, "Decisions needed")
- 8: Tactical tabs that switch views, or the scrolling grid.
- 9: may a person edit the spotlight path (stored as Confirmed by hand)?
- 10: the assistant, rules only or a small local model.
- 11: billing merchant account (D.2).
- 12: start Phase D legal and operations work in parallel.

### Backup verification follow-up (Codex, 2026-11-07)
- Original blocker: the test server's 2 GB tmpfs filled. The developer (Claude) stopped that restore and reset the test server; the owner approved a separate temporary disk-backed restore container.
- Fixed in `tools/db/backup.py verify`: unique container, pinned existing local image, D: bind mount, `--network none`, no published port. Cleanup on success/failure; no success result until cleanup finishes. Existing live/test servers are not used by verification.
- **Full restore verified:** 140 tables, 4,066,306 rows, 2 routines, 32 triggers, zero row-count mismatches. Both cleanup flags true; independently confirmed container/data absent. Evidence: `.local/backups/20261107T143717Z/verify.json`.
- Five regression tests and real success/failure Docker smoke checks passed. Contracts build, both type checks, API 250 tests, web 203 tests passed. Line endings preserved.
- ADR-101 and the runbook updated. No app/UI code changed, so no live redeploy was performed.
- Storage remains manifest-only. D.5 part 2 is still open. Historical blocker evidence: `.local/backups/20261107T143717Z/verification-blocker.json`.

## 6. Known limits
- No hosted database version check over an authorized connection yet (pending).
- AI models are not production-ready without the evaluation gates (G05–G07). The accuracy banner says so on every page.
- Native browser full screen is refused inside the desktop app's browser pane. The dialog full screen still fills the window there.
