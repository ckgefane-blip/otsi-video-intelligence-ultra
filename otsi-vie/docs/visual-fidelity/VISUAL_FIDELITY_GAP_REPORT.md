# OTSI VIE v2 — Visual-fidelity gap report (approved designs vs. the current Next.js frontend)

Date: 2026-10-27 · Owner directive: "VISUAL FIDELITY LOCK" · Baseline: the ten approved images in
`blueprint/OTSI-Owner Developer Handoff/02_APPROVED_UI_IMPLEMENTATION/03_APPROVED_UI_IMAGES/` (1672 × 941, desktop).
Current screens: `release-evidence/visual-fidelity/20261027/current/` (captured by the browser tests at the same 1672 × 941 viewport:
`page-NN.png` = each page as a signed-in user with no data; `journey-*.png` = pages with real footage, analysis, roster and reel data).

## Verdict
**No page is visually complete. 0 of 10 match the approved design.** The current frontend reproduces each page's *list of sections*
and wires real data into some of them, but it is not the approved interface: the layout system, section chrome, proportions,
component types and visual hierarchy differ on every page. Sections and controls existing is not visual completion (directive §7).

What stays (directive §1–2): every backend, database, AI, tracking, canonical-ID, identity-review, Reel Builder and MP4 capability,
the API, and the frontend's data/state logic. The reconstruction is presentation only.

## Systemic differences (apply to all ten pages)

| # | Area | Approved design | Current frontend | Consequence |
|---|---|---|---|---|
| S1 | Layout scaffold | Each page is a bespoke composition: a dense one-screen dashboard, panels of very different sizes, nested sub-panels, tab strips, toolbars, overlays on video | One generic scaffold (`PageView` + `SectionCard`): every specification section becomes an equal bordered card in a CSS grid | Proportions, nesting and hierarchy cannot match; must be rebuilt per page |
| S2 | Section headings | Product headings ("Match Context (Optional)", "Recent Uploads", "Spotlight Controls"); many areas have no heading at all (drop zone, KPI strips, tab bars, hero) | The specification's internal section names are shown as headings ("Match context metadata sidebar", "Primary drag-drop file panel", "Headline KPI strip") | Wrong text on every card |
| S3 | Developer artifacts | None | "Not connected · Block NN" badges, "Will show: …" descriptions, lock notes, API-contract chips (`GET /runs/:id/…`), block numbers in captions | Must be removed from the product UI; honest empty states must be designed inside the approved layout instead |
| S4 | Screen fit | Every page fills exactly one 1672 × 941 screen | Only Export fits one screen; the others are 980–2,040 px tall (Workspace ≈ 2,040, Clip Studio ≈ 1,650, Upload ≈ 1,520, Processing ≈ 1,410, Home ≈ 1,340) | Vertical rhythm, density and fold differ |
| S5 | Component vocabulary | Toggle switches; segmented tabs; icon-led rows; thumbnail cards with duration badges and check marks; ring gauges; KPI tiles with trend and sparkline; pitch diagrams; heatmaps; multi-lane timelines with coloured blocks and waveforms; score HUD on video; player headshot cards; status pills (green/blue/amber/red/purple) | Checkboxes; plain selects; text lists; plain buttons; no gauges, no tiles with sparklines, no pitch drawings, no lane timelines, no HUD | A shared component kit must be built first |
| S6 | Typography & density | Compact 12–14 px body, 15–16 px semibold panel titles with the blue bar, large display titles only on hero pages; very little explanatory prose | Larger body text and long explanatory sentences inside panels (honesty notes), heavier headings | Text blocks must move to tooltips / info icons (ⓘ as in the design) |
| S7 | Header & navigation | Circular OTSI emblem left of the wordmark; nav: Home · Matches · Analysis · Upload · Reels · Reports · Library, plus the page's own tab inserted where the design shows it (Tactical Intelligence, Player Report, AI Processing); "⌘K"; avatar + name + role | Wordmark without the emblem; Upload missing from the standard nav on several pages; "ctrl K"; otherwise close | Small fixes; emblem is an owner asset |
| S8 | Colour & depth | Deep navy with blue/cyan glows, gradients behind heroes and active items, coloured pills, filled active tabs | Same base palette, but flat: no glows, gradients or filled pills | Token set is reusable; effects missing |
| S9 | Imagery | Stadium photography behind the home hero and upload drop zone; player headshots; video thumbnails everywhere | None (licensed owner assets not supplied); thumbnails only on track lists | Real thumbnails from the user's own videos can fill most slots; stadium art and headshots need owner-supplied licensed assets; never invented players (directive §8) |

## Page-by-page differences

### 01 Home (`page-01.png`)
- Layout: approved = full-bleed stadium hero across the top two-thirds of the upper band with a player-tracking overlay, stat card and a *Featured Reel* card at top right; KPI strip of four tiles + trust strip; three equal panels (Recent Matches list with thumbnails and scores, Sample Reels with three thumbnail cards, Platform Capabilities 2×3 icon grid); How-It-Works strip with illustrated step cards. Current = hero text in a card without imagery, featured reel/KPI/trust/recent/sample sections as empty "Not connected" cards, capabilities and steps as plain icon cards; page 1,340 px tall.
- Components missing: KPI tiles with sparklines, thumbnail rows, reel cards, illustrated step tiles, hero overlay graphics.
- Data honesty: KPI numbers, sample reels and the trust logos in the design are illustrative; real values come from the organization's own data (empty → designed empty state); league/association logos need contractual permission (owner).

### 02 Upload & Ingest (`page-02.png`, `journey-upload-verified.png`)
- Layout: approved = left rail (Match Context with Competition/Season/Match selects; Filters/Overlays/AI Tools tabs; Visual Processing, AI Overlays, Ingest Options as toggle lists), centre (header with "Need help?", Upload File / YouTube-URL / Batch tabs, a large drop zone with stadium background containing the URL field, formats strip, 5-step processing pipeline with live preview thumbnails), right (Recent Uploads with thumbnails and status pills; Selected Item Preview with metadata list and "Edit Metadata"). Current = similar three columns but: drop zone and URL input are separate cards; the left rail shows project creation + the new match linker instead of Competition/Season/Match selects; Visual Processing / Ingest Options are "Not connected" cards instead of toggle lists; pipeline strip has no live preview; recent uploads have no thumbnails; preview uses the raw frame.
- Retain: upload engine, link import, project/match logic, measured metadata. Rebuild: all presentation.

### 03 AI Processing (`journey-processing-done.png`)
- Layout: approved = title band with match card + progress on the right; five-step lifecycle with ring progress icons and status pills; large Processing Preview video with boxes/HUD and View/Teams/Overlays selects; 2×2 insets (Player Detection, Ball Detection, Team Identification, Event Markers); Processing Log (timestamped, live) and System Resources gauges on the right; Processing Timeline with coloured stage lanes; Output Summary tiles. Current = run controls (and, since this block, the footage check and profile choice) in a full-width card; steps as plain cards; preview/insets/timeline/resources as "Not connected"; log shows run history only; output summary as small cards.
- Engine already provides: steps, progress, counts, run log events, detector/runtime, per-frame detections (not yet drawn here), kit groups and team assignment (not yet shown here). Rebuild presentation; connect preview and insets to existing APIs.
- Note: the profile selector and footage check added in this block are new UI not in the approved image; their placement must follow the design (candidate: the title band's match card / a settings dropdown) — owner decision.

### 04 Analysis Workspace (`journey-shirt-number.png`)
- Layout: approved = left match rail (match, score, "Processing complete", View/Events/Filters/AI Tools tabs, overlay toggle switches, Team Filter with counts, Time Range radio list, "Create Analysis Clip" button); top analysis-mode tabs; large video with score HUD, minimap, 4K badge, view selector; transport bar; events ribbon with counts; "Tracks & Presence" multi-lane timeline (one lane per player + team-shape lanes + event-type rows); right panel "Players (22) | Events | Clips" table (number, headshot, name, team badge, confidence, status) and a selected-player card (headshot, club, position, foot, age, KPI tiles, heatmap, season/match stats). Current = cards with spec headings: match context card (with the new match linker), analysis-mode placeholder card, video with boxes (correct function, smaller, no HUD/minimap), legend card, overlay checkboxes, transport card, events placeholder, single-track presence bar, right column "Tracks/Roster/Teams" tabs with a track list, and a long selected-track card (identity review, shirt number, suggestions, same-person panel). Page ≈ 2,040 px tall.
- Retain: workspace data context, observation windows, box overlay geometry, identity decisions, links, roster/team/shirt-number/candidate logic. Rebuild: all layout. The Roster and Teams tabs added this block deviate from the approved right panel; in the design the roster is the "Players (22)" table and team filtering is in the left rail — they must be re-placed there (owner to confirm where roster *editing* lives: Matches/Upload "Match Context" is the closest approved home).

### 05 Tactical Intelligence (`page-05.png`)
- Layout: approved = left match rail; header with Live Match View/Team/Phase selects and tab strip; Team Shape pitch with player nodes + metrics column; synced video; Pass Network, Possession & Heat Zones, Pressing Map pitch panels; Off-Ball Runs; Player Comparison with headshots. Current = all sections as "Not connected · Block 09" cards.
- Engine: tactical analytics need pitch calibration and events (Block 08–09, not built). The approved panels must render as designed empty states until then.

### 06 Reel Builder (`journey-reel-rendered.png`)
- Layout: approved = left (Back to Reels; title; 4 numbered steps with check marks; aspect cards with device icons; Reel Info with title, description, duration, music); centre (hero video with player header overlay — name, number, club, nationality, position — and score badge; transport; "Suggested Key Moments (12)" thumbnail cards with numbers, check marks and durations; multitrack timeline with lanes Video Clips / Spotlight Effects / Text & Overlays / Audio, ruler and playhead); right (Spotlight / Overlays / Branding tabs; sliders with icons and %; Player Targeting toggles and Re-detect; Overlays and Branding toggle lists; Generate Reel split button, Preview Render, Save Project). Current = cards with spec headings; steps as plain rows; aspect as text buttons; name field only; preview video without player overlay; moments as text cards without thumbnails; clips as a list with in/out fields; sliders without icons; render panel with codec select.
- Retain: reel state, clips, moments, targets/stale logic, render and playback/download. Rebuild: presentation; moment thumbnails from the real video; multitrack lanes from real clips.

### 07 Clip Studio (`page-07.png`)
- Layout: approved = editor header with Save/Undo/Redo/AI Edit/Export; Media Bin (tabs, search, breadcrumbs, thumbnail grid); centre compositor preview with lower third and stat cards; Clip Inspector; tools ribbon; full multi-lane timeline (video, transitions, graphics, lower thirds, captions, statistics, soundtrack, audio FX). Current = every section a "Not connected" card stacked vertically (≈ 1,650 px).
- Engine: Clip Studio editing model not built (Block 10); timeline lanes, transitions and captions need backend work.

### 08 Player Report (`page-08.png`)
- Layout: approved = report navigation rail; hero with headshot, number, name, position chips, club, nationality, age/height/weight/foot; tracking-confidence ring; role summary with trait chips; nine KPI tiles; Heatmap, Event Timeline (with thumbnails and play), Action Map; Comparison bars, Generated Insights, Scouting Report rating ring. Current = placeholder cards; only the OTSI Player ID is shown.
- Engine: needs events/metrics (Blocks 08–09). Player photo/biography come from the registry (not yet captured).

### 09 Library / Project Center (`page-09.png`)
- Layout: approved = match rail; header with "New Project"; asset-type tabs with counts; filter selects and saved-search chips; asset table (thumbnail, type badge, players, collaborators, updated, status pill, menu); right selected-item panel with preview, tags, metadata, Download/Share/Duplicate/Send to Client/Open in Analysis, collaborators. Current = placeholder cards.
- Engine: projects, videos, reels and renders exist and can populate the table now; sharing/collaboration are Block 12.

### 10 Export & Delivery (`page-10.png`)
- Layout: approved = workflow steps + project summary; final video preview with title overlay and stat badges; Highlight Chapters thumbnails; Export Settings form (preset, resolution, frame rate, aspect cards, format, quality); Branded Overlays with logo preview; Export Queue rows with progress; Output & Reports checklist; Shareable Link toggles; Team Collaboration; bottom Render Progress stepper with Download All / Deliver to Client. Current = placeholder cards.
- Engine: render jobs, validated MP4 and download exist; presets, branding assets, bundles, links and delivery are Block 11–12. Paid export/distribution stays inactive (owner E1–E3).

## Retain vs. reconstruct

**Retain (logic, data and contracts — no visual role):**
`lib/api` (auth, refresh, problems), `components/auth/*`, `lib/upload` (resumable upload engine), `lib/format`, `lib/identity`, the data
contexts and hooks inside `AnalysisWorkspace`, `ProcessingView`, `UploadWorkspace`, `ReelBuilder` (state, polling, API calls, decisions),
the overlay geometry of `VideoWithBoxes`, span computation of `PresenceTimeline`, the decision logic in `SamePerson`, `IdentityEvidence`
and `MatchPanels`, `CommandPalette` behaviour, theme tokens (base palette), the e2e journeys and their `data-*` test hooks (to be carried
onto the new components), every API route and contract.

**Reconstruct (presentation):**
`PageView`, `SectionCard`, `StaticSections` and the page grid in `lib/pages.ts`; every page's markup; the header emblem and nav set;
a component kit matching the designs (Switch, SegmentedTabs, IconRow, ThumbCard with duration/check, StatusPill, KpiTile with sparkline,
RingGauge, PitchCanvas (nodes, edges, heat), MultiLaneTimeline, ScoreHud, PlayerHeadshotCard, StepRail, MatchRail); designed empty,
loading and error states placed inside the approved layout (they replace the "Not connected" cards).

**Recommended method (for the owner's decision):**
1. Split each page into a headless data hook (kept) and a presentational view (rebuilt), so the Figma implementation can be wired to the
   same hooks without touching the engine.
2. Review the owner's Figma implementation page by page against this report before anything is merged; never integrate unreviewed
   generated code or overwrite verified behaviour (directive §10).
3. Acceptance per page: pixel-overlay comparison with the approved image at 1672 × 941 (layout, proportions, positions, spacing,
   component types, typography, colours, navigation), real data only, then the existing e2e journey must still pass.

## Owner decisions (2026-10-27) — recorded in ADR-035
1. New functions go into contextual tabs, inspectors, modals or drawers inside the approved compositions; no new permanent panels.
2. Truthful empty / loading / unavailable / not-measured states in the exact approved geometry; no fabricated data; no generic oversized cards.
3. Original OTSI branding where supplied (no emblem file exists in this project yet); no invented club/competition marks or player imagery.
4. Figma Make reconstructs the ten pages; the lead developer owns the engine and the final integration; each page is owner-reviewed first.

## Rebuild deviations awaiting owner decision (2026-10-28)
- **Page 01 Home, Sections 02 and 09:** the reference says "MP4, MOV, up to 50 GB" and "YouTube, Hudl, Wyscout..."; the app's real upload limit is 64 GB and link import accepts direct/public-archive links (YouTube refused). Reference text kept until the owner decides.
- **Page 01 Home, Section 02 hero:** the original approved image is photographic (stadium, real player); the corrected reference is drawn. Drawn version used until a licensed photo is supplied or a free (CC0/public-domain) stadium photo is approved.
- **Page 02 Upload & Ingest, Section 02 (match context sidebar):** rebuilt 2026-10-29 (commit d43b7b7) — the Competition/Season/Match cascade is now real, built from `GET /v1/matches` (distinct competition/season values, then its matches); choosing one links the selected upload via `POST /v1/videos/:id/match`, or links the next upload once created. "+ New match…" opens the real MatchLinker form in a dialog. No longer a mock.
- **Page 03 AI Processing:** Event Detection and Indexing stages read "Not built" (reference: "Waiting"), because the engine has no such steps yet; System Resources stays "Not connected" (no worker telemetry). Starting an analysis, choosing the profile and choosing the video are contextual dialogs (ADR-035 decision 1).
- **Page 05 Tactical Intelligence:** overlay switches the engine cannot honour yet (Player Tracks, Team Shapes, Heatmaps, Pass Arrows) are shown off and disabled with their reason (reference shows every switch on); team, phase, half and time-range selectors are disabled with reasons until those facts are recorded. All tactical measurements show "—"/"Not measured".
- **Page 07 Clip Studio:** edits a real reel (?reel=); without one, the Media Bin shows a "Choose a reel to edit" button and the Video Clips lane says "Choose a reel to start editing" (reference: "No clips in this folder yet" / "Drag clips from the Media Bin…", shown once a reel is open). Markers, voiceover, auto captions, graphics, speed, colour, audio, transform, tags and notes have no backend yet: disabled with their reason; their lanes stay empty (count 0).
- **Page 09 Library:** the left panel's overlay switches show the defaults of the Analysis/Tactical pages and cannot be changed here (Player Tracks shown off: not built). Updated 2026-10-29 (audited against the running app, not assumed): Created By is real — the left-panel filter lists the organization's actual members (`GET /v1/members`) and filters by `created_by`; the Selected Item detail row now resolves the same real creator name too (was hardcoded "—" until this audit, fixed). Saved searches are server-side per person (`/v1/saved-searches`), not browser-only. Duplicate, Send to Client (external delivery not activated) and Manage Access (per-asset access not enforced yet) are not dead: each explains its real reason on click. Uploaded videos are listed as their own type "Video".
- **Update 2026-10-29:** Page 03 System Resources now shows the worker's measured CPU and memory and the GPU's name (GPU load "—": not measurable for free); Page 09 saved searches are stored per person on the server and Collaborators lists the organization's members; Page 07 clip notes are stored (tags still not recorded).
- **Page 05 update 2026-10-29 (owner: "controls are dead"):** the overlay squares (.ic) now show each overlay's own icon instead of an empty square; Player Boxes / IDs / Ball Tracking switch at any time (a display choice applied when a video loads); every selector opens and lists its real choices (match teams, roster players, time ranges, phases, positions), with choices that have no data yet greyed and labelled with the reason. Unbuilt overlays stay off and disabled with their reason.
