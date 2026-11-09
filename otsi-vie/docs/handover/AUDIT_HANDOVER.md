# Audit handover — check my pages 01, 02, 03, 05, 07, 09 (2026-10-29)

For the peer session. Read `HANDOVER.md` first; it has the method, the environment and the endpoints. This file says **what to audit on each of my pages, how, and what is already known to be open**. Audit means: find what is wrong and prove it with a measurement or a click. Do not guess, do not redesign.

## 0. Rules for the audit
- Owner's rule: **Unknown beats wrong.** Nothing invented — no players, scores, statistics, clips, detections or job progress.
- No dead controls. Every control is **live**, **always** (locked on, explains) or **not built** (off, explains on click). Selects always open.
- Fix only what you can prove is wrong. Small fixes: do them, test them, and commit them with a pathspec (`git commit -m "…" -- <files>`). Larger ones: write them in section 4 of this file and tell the owner.
- Never touch MySQL 3306, never push, never deploy, nothing on C:.

## 1. How to audit one page (same for every page)
1. **Geometry.**
   - Serve the reference: `python -m http.server 4399 --bind 127.0.0.1` in `D:\OTSI-Workspace\_tmp\owner-ref\corrected\OTSI_VIE_CORRECTED_10_UIS`.
   - Dump `text|left|centreY` from `#s` (Playwright MCP, 2560x1440). Then dump the app page from `[data-stage]` in a background Browser-pane tab at 2560x1440, adding 101 to y.
   - Diff the two dumps. Anything over 1 px apart, or missing, is a finding.
2. **Controls.**
   - Run this in the app page:
     ```js
     [...document.querySelectorAll('[data-stage] button,[data-stage] a,[data-stage] input,[data-stage] select,[data-stage] [role=switch],[data-stage] [role=tab]')].map(e=>`${e.tagName}|${e.getAttribute('aria-label')||e.textContent.trim().slice(0,40)}|disabled=${e.disabled||false}`)
     ```
   - Natively disabled means **dead**, which is a finding. Only pager ends may be disabled.
   - Click every control. Each one must either act (network call or view change) or show its reason. A control that silently does nothing is a finding.
3. **Truth.** For every number or name on screen, find the API field it comes from (component header comment → `apps/api/src/modules/**`). If you can't trace it, it is a finding.
4. **Sections.**
   - `data-section="pNN-sMM"` must be in DOM order.
   - `aria-label` must equal the spec title in `apps/web/src/lib/page-specs.generated.json`.
   - The `h1` must be the reference heading.
5. **Empty and real data.**
   - The owner database (3408) has almost no videos, reels or confirmed players, so most panels show their empty state. Check that the empty states sit in the approved geometry.
   - Where you can, upload one short clip through Page 02 as a user, then re-check the pages that show it: 01, 02, 03, 05 and 09.

## 2. Page by page — what to check, what is known

### 01 Home — `components/home/*`, route `/`
- Built, measured and click-tested **before** the latest backend additions.
- Re-check:
  - the KPI weekly bars (`/v1/overview/stats` `weekly`);
  - Recent Matches (`/v1/overview/recent-matches`);
  - the hero player card (`/v1/overview/latest-player`: it shows a name only for a person-confirmed player, otherwise "—").
- Known open (owner decisions; don't change):
  - the drawn hero instead of a photo;
  - the "up to 50 GB" and "YouTube, Hudl, Wyscout" wording;
  - the Home CTA to /upload: check that it still lands on the rebuilt Page 02.

### 02 Upload & Ingest — `components/upload/*`, route `/upload`
- **Never browser-checked.** Highest priority. Do the full section 1 on all 10 sections.
- Specific clicks to prove:
  - Competition → Season → Match cascade from `/v1/matches`. "+ New match…" opens the MatchLinker dialog. Choosing a match calls `POST /v1/videos/:id/match`, or says it will be linked to the next upload.
  - Ingest panel tabs Filters / Overlays / AI Tools really switch.
    - Stabilize and Send to Analysis toggle and persist in localStorage `otsi.upload.prefs`.
    - Locked rows explain, and not-built rows explain.
  - Drop zone: drag/drop and Browse upload a file. The project line (`data-action="project"`) opens the Project dialog. Create Project calls `POST /v1/projects`. The size limit shown comes from `/v1/upload-limits`.
  - URL input: the provider popover, the access token field, "Which links work?" (Link support list), and "Add URL" on a refused link showing the reason.
  - Supported formats: "View all formats" dialog.
  - Recent uploads: 5 rows, select, ⋮ menu links (only for INGESTED videos).
  - Selected preview: thumbnail, play (needs a playback copy), and Edit Metadata (rename via PATCH, shown in the list after reload).
  - Pipeline: Uploading card Pause / Resume / Cancel during a real upload; AI Detection "Analyse this video" → `/processing?video=<id>`. With Send to Analysis on, an analysis run must start by itself when the upload turns INGESTED.
- Then update `apps/web/e2e/upload.spec.ts` (and `shell.spec.ts` if the Home CTA changed) to this flow, and run the full browser suite (HANDOVER §2).
- **Stale doc to fix:** the gap report's Page 02 bullet says the cascade is not built. It is now built from `/v1/matches`. Update that bullet.

### 03 AI Processing — `components/processing/*`, route `/processing`
- Measured and click-tested.
- Re-check with a real run:
  - stage progress comes from the run and its jobs;
  - Detection tiles show teams only from person-assigned kit groups;
  - the log panel shows the run log;
  - System Resources shows CPU/memory from `/v1/system/resources` while the worker runs, and "Not connected" otherwise.
  - The `?video=` link from Page 02 must preselect the video.
- Known: Event Detection and Indexing read "Not built"; GPU load "—".

### 05 Tactical Intelligence — `components/tactics/*`, route `/tactics`
- Measured and click-tested after the "dead controls" fix.
- Re-check:
  - every `Sel` opens, and greyed options carry a reason;
  - Player Boxes / IDs / Ball switches persist in `otsi.overlays`, and the same choice shows on Page 09's left panel;
  - the team filter uses kit groups;
  - Player Comparison lists the roster;
  - all measurements show "—" / "Not measured" (nothing invented).
- Known: Player Tracks, Team Shapes, Heatmaps and Pass Arrows are not built (off, with a reason).

### 07 Clip Studio — `components/studio/*`, route `/studio?reel=<id>`
- Measured and click-tested.
- Re-check with a real reel:
  - place a clip;
  - undo and redo;
  - save a clip note (`/v1/reels/:id/notes`, then reload: it persists; delete it).
  - Without `?reel=`, "Choose a reel to edit" must open the picker.
- Known: markers, voiceover, captions, graphics, speed, colour, audio, transform and tags are not built. Each `Btn` is dimmed but clickable and explains.

### 09 Library — `components/library/*`, route `/library`
- Measured and click-tested.
- Re-check:
  - the left panel tabs;
  - team radios filter the list;
  - Created By lists real members (`/v1/members`) and filters by `created_by`;
  - saved searches are server-side (create, reload, delete);
  - rename a video from Selected Item;
  - AI Tools links open the right pages.
- **Stale doc to fix:** the gap report's Page 09 bullet still says "Created By has one option", "saved searches in this browser only" and "Duplicate / Send to Client / Manage Access disabled". All are outdated: they now act or explain on click. Rewrite that bullet from what you observe.

## 3. Cross-page checks
- Run the full browser suite once after the Page 02 tests are updated. Last result: 25/25 before the Page 02 rebuild.
- Run the unit and API suites:
  - `npx tsc --noEmit -p .` and `npx vitest run` in apps/web;
  - `npx vitest run` in apps/api (MySQL 3407);
  - `pytest` in services/worker.
- Roles: sign in as a viewer role if one exists in the seed. Write controls (upload, rename, notes, saved searches) must refuse with a reason, never crash.
- `release-evidence/integration-audit/` is untracked and not mine. Leave it alone and ask the owner.

## 4. Findings (fill in)
| Page | Section | Finding | Proof (measurement / click / API) | Fixed in commit / left for owner |
|---|---|---|---|---|
| 02 | S06 URL input | "Which links work?" unclickable while the provider popover shows — popover had no z-index and sat on top of it | Click-test: button existed, visible, enabled, but intercepted by `<div class="absolute">` on every click attempt (Playwright retry log) | Fixed, commit 8a3783c (gave the button `zIndex:5`) |
| 02 | — | e2e/upload.spec.ts (rewritten for the new flow) and workspace.spec.ts (Project select moved into a dialog) were out of date and failing | Ran the real suite (tools/dev/e2e.py) twice: first run 4 failures, second run 24/24 pass on the non-video-analysis tests | Fixed, commit 8a3783c |
| 02 | S10 Pipeline | Not a bug: confirmed `sendToAnalysis` default (true) starts a real analysis run automatically once a fresh upload reaches INGESTED — "Analyse this video" correctly does not appear in that case | Full upload journey e2e test, passing | No fix needed; recorded so the next person doesn't mistake it for one |
| 02 | — | `not-a-video.mp4` stuck at VALIDATING past 90s in one run, then passed (16.7s) on immediate re-run | Playwright log, run 1 vs run 2 of the same test, same build | Not reproduced on retry; likely worker cold-start on a fresh scratch stack. Left for the owner/peer to watch for recurrence, not fixed (nothing provably wrong in app code) |
| 09 | Selected Item, Created By row | Hardcoded "—" even though the real creator (`asset.createdBy`, same `members` list Collaborators already fetches) was available — the left-panel filter used it correctly but the detail row never looked it up | Read the component: `vals` array's 4th entry was a literal `"—"`, not derived from `a.createdBy` | Fixed, commit 8a3783c |
