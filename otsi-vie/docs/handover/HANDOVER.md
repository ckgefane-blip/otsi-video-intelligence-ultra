# Handover — how the pages are built, and where everything stands (2026-10-29)

Written by the session that built Pages 01, 03, 05, 07, 09 and rebuilt 02, for the session that continues. Read all of it before writing code.

## 1. The method (follow exactly, one section at a time)

1. **Study the real situation first. Never guess.**
   - Read the reference: `D:\OTSI-Workspace\_tmp\owner-ref\corrected\OTSI_VIE_CORRECTED_10_UIS\NN_*.html`, the screenshot in `screenshots_2560x1440/`, and the section list in `apps/web/src/lib/page-specs.generated.json`.
   - Read the backend you will call: the module header comments in `apps/api/src/modules/**` list every route, and `packages/contracts/src/*.ts` has every shape.
   - Read the existing data hooks: `useUpload` (UploadWorkspace.tsx), `useProcessing` (analysis/ProcessingView.tsx), `useAnalysisWorkspace` (analysis/AnalysisWorkspace.tsx), `useReel` (reels/ReelBuilder.tsx).
   - If you are unsure whether something exists, grep for it. Ask the owner only for decisions, never for facts you can read.
2. **Transcribe, don't interpret.** Copy every `D/T/I/P` call of the reference value for value into the stage primitives in `components/stage/DesignStage.tsx`:
   - `B` is a box by its top-left corner; `T` is text by its left edge and vertical centre; `Ic` is an icon by its centre; `P` is a panel; `ACC` is an accent bar.
   - Every coordinate goes through these primitives or `u(px)`. For nested children use `o={[parentX, parentY]}`, never raw px or %.
   - **Never put a number inside JSX text by accident:** that is what printed "175.00000762939453" on the old Page 02.
3. **Bordered boxes with children:** draw the border on the overlay — className `${stageStyles.a} ${stageStyles.framed}` with style `{"--bc": colour, "--bw": width}` — and place the children from the box's outer corner. A 1.5 px border renders as 1 px, so origin offsets drift.
4. **Every control is exactly one of three kinds. There are no dead controls.**
   - **Live:** real state and a real effect (an API call, or a real view change).
   - **Always done by the engine:** shown on and locked; a click says "every analysis does this".
   - **Not built:** shown off and dimmed; a click says why (in a status line or note).
   - Never use a `<span role="switch">`, a disabled select with one option, or plain-text tabs. Selects always open; options without data are listed greyed with the reason.
   - Examples to copy: `components/studio/*` (the `Btn` and `Ui.say/pick` pattern), `components/tactics/kit.tsx` (`Sel` with greyed options, `Toggle`), `components/library/LeftPanel.tsx` (real tabs, switches, radios), `components/upload/page02.tsx` (`ToggleRow`, `Sel`, status line).
5. **Real data only.** Nothing invented: unknown shows "—". Names of players appear only after a person confirmed them. Colours never name teams: a person assigns teams.
6. **Measure, don't eyeball.**
   - Serve the reference: `python -m http.server 4399 --bind 127.0.0.1` in the corrected folder.
   - In the Playwright MCP at 2560x1440, dump every text element under `#s` as `text|round(left/k)|round(centreY/k)`, with k = stage width / 2560.
   - In your own Browser pane (the owner signs in there once), use a **background tab** (`tabs_create`), resize to 2560x1440 and run the same dump on `[data-stage]`, adding 101 to y.
   - Diff the two and fix until identical (±1 px rounding is OK).
   - Then **click-test**: a JS check listing every button/input/select/switch/tab with its disabled state (nothing natively disabled except pager ends). Click each one and confirm its action or its explanation.
   - Stop the http server afterwards.
7. **Section ids:** `data-section="pNN-sMM"` and `aria-label` = the spec's title, in DOM order. `e2e/shell.spec.ts` checks this, and the page's `h1` is the reference heading.
8. **Test after each section:** `npx tsc --noEmit -p .` and `npx vitest run` (in apps/web), plus the API tests for any backend you touch (`npx vitest run test/<file>` in apps/api, which uses the test MySQL on 3407). Unit-test any logic.
9. **Commit only your files:** `git add <files>` then `git commit -m "…" -- <files>`. Check `git diff --cached --name-only` first, and never leave files staged. Local commits only, never push.
10. **Record deviations** from the reference in `docs/visual-fidelity/VISUAL_FIDELITY_GAP_REPORT.md`, and backend changes in `../blueprint/CHANGELOG.md`.
11. **Don't stop after a section.** Go to the next one; the owner watches live at http://127.0.0.1:4310.

## 2. Environment

- **Dev stack:** `.\.venv\Scripts\python.exe otsi-vie\tools\dev\local_stack.py dev` (from VIE-Engine-v2), with hot reload; web on 4310, API on 4320. The owner database is Docker MySQL on 127.0.0.1:3408 (`otsi_owner_vie`); tests use 3407. **Never port 3306.**
- **Full browser suite:** stop the dev stack first (same ports), build (`corepack pnpm --filter @otsi-vie/contracts build`, `corepack pnpm --filter ./apps/api build`, `cd apps/web && corepack pnpm build`), then run `.\.venv\Scripts\python.exe otsi-vie\tools\dev\e2e.py` with `OTSI_E2E_PYTHON` set to the venv Python and `PLAYWRIGHT_BROWSERS_PATH=D:\OTSI-Workspace\_tmp\ms-playwright`. Last result: 25/25 before the Page 02 rebuild.
- **Temp files** go to `D:\OTSI-Workspace\_tmp`. Nothing on C:.

## 3. Backend added in this round (all tested, committed)

- `GET /v1/overview/stats` (+ weekly), `/v1/overview/recent-matches`, `/v1/overview/latest-player`.
- `GET /v1/system/resources` (migration 0019 `worker_status`; the worker reports CPU and memory every 5 s).
- `GET /v1/members`; `GET/POST/DELETE /v1/saved-searches`; `GET/POST/DELETE /v1/reels/:id/notes`.
- `PATCH /v1/videos/:id` {title}; `GET /v1/upload-limits`; `created_by` on Video, Project and Reel.
- Already existing and useful: `/v1/matches` (competition, season, clubs, roster); `POST /v1/videos/:id/match` {match_id}; `/v1/videos/:id/analysis-runs`; `/v1/analysis-runs/:id/kit-groups` (teams a person assigned); `/v1/reels` and its clips/renders; `/v1/imports`; `/v1/projects`.

## 4. State of the pages

| Page | State |
|---|---|
| 01 Home, 03 Processing, 05 Tactical, 07 Clip Studio, 09 Library | Built, wired, measured, click-tested, committed. |
| **02 Upload** | **Rebuilt in commit d43b7b7, type check clean, NOT yet browser-checked.** |
| 04, 06, 08, 10 | Still the old scaffold. Build them with this method. |

**Page 02 remaining work:**
1. Open /upload at 2560x1440 and measure it against `02_UPLOAD_INGEST.html`.
2. Click-test every control.
3. Update `e2e/upload.spec.ts` to the new flow:
   - The project is now chosen in a dialog: the drop zone's bottom line, `data-action="project"`, opens it; it has a "Project" select, "New project name" and "Create Project".
   - Upload progress shows in the pipeline's Uploading card (`data-transfer-state` on `li[data-stage=Uploading]`).
   - "Analyse this video" is in the AI Detection card and links to `/processing?video=<id>`.
   - "Add URL" on a refused link shows the reason instead of being disabled.
   - The "Link support" list opens from "Which links work?".
4. Update the Home CTA test in `e2e/shell.spec.ts` if anything changed.
5. Run the full browser suite.

The peer's leftover untracked `components/upload/useLatestRun.ts` is unused; delete it once confirmed.

**Open owner decisions:**
- the hero photo on Home,
- the "up to 50 GB" and "YouTube, Hudl, Wyscout" wording on Home (Upload now shows the server's real limit, 64 GB by default),
- per-asset access control (not enforced yet).
