# OTSI VIE v3 — Screen-Level Upgrade Blueprint

*Built from your v2 engine blueprint (2026-11-06) and the 10 screenshots of the running app (dev build, `127.0.0.1:4310`). Reference levels: Filmora (design) and Kdenlive (mechanics). This replaces the earlier proposal documents.*

**Tags.** **[Seen]** visible in your screenshot · **[Fix]** a problem visible on the screen · **[F]** Filmora pattern · **[K]** Kdenlive pattern · **[O]** original to VIE · **[V2]** stated in your engine blueprint. Everything marked as an upgrade is a proposal. Nothing is built.

---

## 0. Read this first: what your screens already have, and what they get wrong

### 0.1 Already in your UI (credit, and some of my earlier proposals duplicated these)

| Already built [Seen] | Where |
|---|---|
| Four-step stepper with subtitles (Select Player, Choose Moments, Edit & Style, Export) | Reel Builder |
| Undo and Redo, Split (S), Cut (C), Ripple Delete, Add Marker (M), Fit to Screen, zoom, eight lanes with eye and lock | Clip Studio |
| Snapshot icon in the player | Clip Studio |
| Honest labels: "Not measured", "saved · not performed yet", "Not built", "Engine data", "Unverified", "Rights needed" | Many pages |
| Match panel, View/Filters/Events/AI Tools tabs, overlay toggles, time range with 1st/2nd half | Analysis, Tactical, Library |
| Saved searches, Trash, tabs with counts, status column | Library |
| Branded overlays preview ("The next render draws: Match info"), render progress, rights gate on share link | Export |
| Tracking Confidence with an "Unverified" badge, "analyst-approved role summary" | Player Report |

So the Reel Builder stepper, Undo/Redo, markers and the snapshot idea are not new. The upgrades below build on them rather than replace them.

### 0.2 Problems visible on the screens (fix before adding features)

| # | Problem | Page | Why it matters |
|---|---|---|---|
| P1 | Preview says "0 people tracked / No people detected" and "0 ball tracks", while Output Summary says 21,666 players tracked and 2,076 ball tracked. Team Identification stays on "Loading…". The preview video is black. | Processing | Contradicts itself on the page that proves the engine works |
| P2 | Pipeline shows "4. Event Detection: Not built" and "5. Indexing: Not built", yet Analysis shows 150 events, 44 passes, 43 balls won, 34 pressures. | Processing, Analysis | Step names no longer match the engine |
| P3 | Step 3 is named "Identity Resolution: Assign player identities, team, and jersey numbers", but your rule is that analysis never assigns identity (every track starts Unidentified). | Processing | Wording breaks "Unknown beats wrong" |
| P4 | "Player Analysis (PDF) — AI-generated tactical analysis" | Export | Your rule: no language-model text; sentences are rule-built from measured numbers |
| P5 | Buttons and tabs named "AI Edit", "AI Highlights", "Auto Captions", "Voiceover", "AI Insights" | Clip Studio | None of these is in your engine blueprint; they imply features that may not exist |
| P6 | Upload page offers Stabilize Video, Enhance Quality, Remove Crowd Noise, Auto Crop Pitch, Correct Aspect Ratio. Several are "saved · not performed yet", two are ON by default. | Upload | These change pixels, are not in the engine, and sit against "nothing invented" |
| P7 | Home says "up to 50 GB"; Upload says "Max file size 64 GB". | Home, Upload | One of them is wrong |
| P8 | Home shows 3 Matches Analyzed; Library shows Matches 1. | Home, Library | Counts come from different sources |
| P9 | "No match selected" on Tactical and Library although Analysis had a match open. | Tactical, Library | Context is lost between pages |
| P10 | A match is titled `0OMIDjg6NUvw0TVkOVYFQQ`; one row is a blank "—"; several placeholder cards and rows with "—". | Home, Upload | Looks broken to a customer |
| P11 | Left panel on Library shows Visual Overlays, Team Filter and Time Range (video-analysis controls) | Library | Irrelevant controls; wastes the most valuable side panel |
| P12 | Home hero shows a named player's live stats (Speed 19.1 km/h, Distance 811 m) | Home | Engine is generic; check whether hero is hard-coded demo data |
| P13 | Home "Trusted Partners: Partner logos appear here once licensing is confirmed" | Home | Internal note shown to users |
| P14 | Export stepper: step 2 is not ticked while steps 1 and 3 are, and 4 is current. "delivery is not built yet" appears in the render bar. | Export | Confusing state and an internal message in the product |
| P15 | Reel Builder: the overlay note "Score & Time: team names and match clock (no score: it is not measu…" is cut off. Aspect list has 3 ratios; Export has 4 (4:5 Social). | Reel Builder, Export | Truncation, and an inconsistency |
| P16 | Clip Inspector shows Player, Match, Event Type "Not assigned" for clips that came from a confirmed player's moments. | Clip Studio | Metadata is not carried from the moment into the clip |
| P17 | "Tracking Confidence" ring on Player Report. Your accuracy is unmeasured. | Player Report | A confidence ring implies a measured number |
| P18 | xG, xA, Sprints, Carry, Tackles, Interceptions, Formation Stability, Off-Ball Runs, PPDA, Compactness appear as tiles or panels; your blueprint lists neither xG/xA nor tackles/interceptions nor off-ball runs as built (formations are "Not built"). | Report, Analysis, Tactical | Verify each: built, or show it as unavailable |

---

## 1. Cross-cutting upgrades (the shell)

Your shell is already consistent: dark navy, blue accent, ten tabs, owner badge. These upgrades sharpen it.

| ID | Upgrade | Detail | Ref |
|---|---|---|---|
| S01 | **Persistent context bar** | Under the nav: `Project ▸ Match ▸ Player`, always visible, carried across Analysis, Tactical, Reel Builder, Clip Studio, Player Report, Export. Fixes P9. Click any chip to change. | F (project-wide), K (active project) |
| S02 | **Job tray in the top bar** | Icon with counter next to the user block: ingest, proxy, assess, analyse, ball, pitch, lineups, render, report. Drop-down with state, stage, progress, cancel, retry, open result. | K task counter |
| S03 | **Global search and command palette** | Search field between nav and the QHD badge; Ctrl+K opens commands. | F Smart Search, K |
| S04 | **Explain the "QHD" badge** | Unlabelled today. Add a tooltip and a settings link (display or playback quality). If it means something else, rename. | — |
| S05 | **Guided / Pro toggle** | In the user menu. Guided shows the main action and few controls; Pro shows every control, IDs, keyframes, scopes. Same page, same data. | F K |
| S06 | **Evidence badge, one component** | Detected, Inferred, Confirmed, Not measured on every value and overlay, plus "accuracy not yet measured" while G01 is open. Replaces ad-hoc labels. | O |
| S07 | **Left context panel, per page** | Analysis and Tactical keep Match + View/Filters/Events/AI Tools. Library, Export, Report get their own panels (below). Fixes P11. | F panel logic |
| S08 | **Empty-state component** | A short sentence, the reason, and the next action. Replaces "—" rows and blank cards. Fixes P10. | O |
| S09 | **Preview flag for unbuilt features** | "Not built" and "delivery is not built yet" show only in a Preview or Dev mode; customer mode hides the feature entirely. Fixes P14 and parts of P2. | O |
| S10 | **Single summary service** | Home totals, Library tab counts, Recent Matches all read one endpoint. Fixes P8. | O |
| S11 | **History panel** | Clip Studio already has Undo/Redo. Add an ordered list of changes; undo is a new compensating entry. Same pattern for identity decisions and reel edits. | K |
| S12 | **Workspace presets** | Review, Track, Assemble, Export; saved custom layouts; resizable panels; **Dual** mode (player pops out to a second monitor); light and dark. | F layout modes, K saved docks |
| S13 | **Notifications** | Bell: job done, review requested, comment on a share link, rights expiring. | O |
| S14 | **Keyboard map** | Visible via `?`. J K L transport, I O marks, S split, C cut, M marker, N next unidentified, Ctrl+K palette. Matches the shortcuts already shown (S, C, M). | K |

---

## 2. Page by page

Each page: **Seen** (what the screenshot shows) · **Fix** (problems) · **Upgrade** (specific changes, with where they sit) · **Done when** (acceptance test).

### Page 01 · Home

**Seen.** Hero ("Professional Football Video Intelligence") with a player overlay and stat card; two actions (Upload Video, Paste Link); Featured Reel card (SD, 09:19, 58 clips, 16:9, H.264, views, likes, Share); four stat tiles with deltas; Trusted Partners box; Recent Matches (4 rows); Sample Reels (3 cards, two empty); Platform Capabilities (6 tiles); How It Works (5 steps).

**Fix.** P7, P8, P10, P12, P13. "Sample Reels" implies demo content; two empty cards. "Platform Capabilities" and "How It Works" are marketing, taking the space an analyst needs.

**Upgrade [F hub]**

| Zone | Change |
|---|---|
| Hero | Keep the visual. Make its player and stats **data-driven** (latest confirmed player) or a neutral sample, every stat with an evidence badge; "—" becomes "Not measured". Collapse to a compact strip after first use (Pro default). |
| Primary action strip | Keep Upload Video and Paste Link; add a third **state-aware** button: *Review N unconfirmed tracks*, *Continue reel*, *Open report*. Quick tiles under it: Open last match, Build a reel, Print a report. |
| New card: Review inbox | Tracks to identify, team sheets to approve, share comments, stale reels. Each row opens the exact place. [O] |
| New card: Active jobs | Mirrors the job tray (S02). |
| Stat tiles | Keep deltas and mini-bars. Each tile becomes a link (Library filtered). Tooltip states coverage, for example "3 of 12 matches have pitch calibration". |
| Recent Matches | Friendly title from metadata or file name; "Not linked to a match" becomes a **Link match** chip; add pipeline stage chip and % tracks identified. Never show a raw ID as a title. Card or table toggle. [F] |
| Sample Reels | Rename **Recent reels**; show only real reels; empty slots disappear. |
| Featured Reel | Keep; add evidence mix and spotlight coverage %. |
| Trusted Partners | Hidden until licensing is confirmed. |
| Platform Capabilities, How It Works | Move to first-run guidance and Help; show only when the org has no completed match. |

**Done when:** no raw ID, no "—" card, one number for matches everywhere, first-time user sees three steps, returning user sees what needs them.

### Page 02 · Upload & Ingest

**Seen.** Left: Match Context (Competition, Season, Match) and tabs Filters / Overlays / AI Tools with Visual Processing toggles, AI Overlays (Auto-Detect), Ingest Options. Centre: Upload File / YouTube-URL / Batch Upload, drop zone ("Max file size 64 GB"), Supported Formats, Processing Pipeline (Uploading → AI Detection → Tracking → Indexing → Analysis Ready) with Live Processing Preview. Right: Recent Uploads and Selected Item Preview (file name, size, resolution, frame rate, duration, Detected Content, Teams (Detected), Edit Metadata).

**Fix.** P6, P7, P2 (Indexing "Not built yet"), P10. Pipeline reads "Analysis finished 100%" on an upload screen. The profile used (High accuracy, 6 fps) is not chosen anywhere on this page.

**Upgrade [F Project Media + Media Info, K Project Bin]**

| Zone | Change |
|---|---|
| Visual Processing toggles | **Remove** Stabilize, Enhance Quality, Remove Crowd Noise, Correct Aspect Ratio from the analysis path. If kept, move to a clearly separate "Playback copy only" group, **default OFF**, labelled "does not change analysis". Auto Crop Pitch only if the engine does it. |
| AI Overlays (Auto-Detect) | Keep as analysis switches: Players & Teams, Ball Tracking, Jersey Numbers, Pitch Lines, Event Markers. Each states what stage it enables (detect, ball, OCR, calibration) and its cost. |
| Ingest Options | Keep Auto Create Match, Extract Metadata, Send to Analysis. "Generate Highlights" off by default and renamed "Suggest moments" to match the engine. |
| **Analysis profile card** (new) | Standard / High accuracy / Ultra-sensitive, with the recommendation from the quality check, the reason, and **time, device and disk estimate**. Override allowed. [F cost-first] |
| **Rights block** (new) | Rights to analyse, share, download; guardian consent for minors. Required before Analyse. Today rights are only asked at Export. |
| Drop zone | Keep. Per-file queue under it: name, size, checksum progress, pause, resume, cancel. Show the active Project in a labelled chip above the zone (today it is tiny text inside it). |
| Pipeline strip | Rename to engine steps (see Processing). Remove "Indexing — Not built yet" until built. After analysis it becomes a link strip ("Open Processing"), not a second progress display. |
| Live Processing Preview | Keep; bind to the real run (see P1). |
| Recent Uploads | Real rows only; empty state instead of four blanks. |
| Selected Item Preview | Becomes the **Media Info panel**: container, codecs, rotation, fps, resolution, duration, scan result, test-decode result, thumbnail strip, each with evidence badge. File name must match the title shown. |

**Done when:** an agent can upload, see the estimate, set rights, and press one Analyse button; nothing offered that the engine does not do.

### Page 03 · AI Processing

**Seen.** Header card (High accuracy, 6 fps, Completed 100%, Open Analysis Workspace, Re-run). Five-step ribbon. Processing Preview (video player, View, Teams, Overlays). Four tiles: Player Detection, Ball Detection, Team Identification, Event Markers (Live) with legend Pass, Shot, Tackle, Foul, Offside. Processing Log with auto-scroll. System Resources (GPU "—" Intel Arc Graphics, CPU 19% 22 threads, Memory 74%). Processing Timeline. Output Summary (Live).

**Fix.** P1, P2, P3, P18 (Tackle, Foul, Offside in the legend).

**Upgrade [K TaskManager, F progress window + results panel]**

| Zone | Change |
|---|---|
| Ribbon | Replace with the **engine's real steps**: Shots → Detect → Track → Identity evidence → Ball → Pitch → Team sheets → Football facts. Each step: waiting, running, done, skipped, failed, **stale**. Click a step to filter the log. Rename step 3 "Identity evidence (no identity assigned)". |
| Header card | Add device (GPU/CPU), start, duration; **Re-run** opens a profile chooser and **keeps the old run** for comparison. [K] |
| Job table (new, below ribbon) | All jobs for the project: type, state, progress, stage, device, duration, output size; filters; **pause, retry, priority**; cancel stays. |
| Processing Preview | Plays the proxy at the current frame with the overlays (boxes + IDs). Black video becomes a poster frame with the reason if no overlay data. |
| Four tiles | Each reads the same run as Output Summary. "0 people tracked" must never appear next to 21,666. Team Identification shows kit groups found or "Not measured". Event legend only lists events the engine produces. |
| System Resources | GPU shows utilisation or "in use via OpenVINO"; "—" only if truly unavailable, with CPU fallback noted. |
| Log | Filter by level and step, copy, download, collapse old runs. |
| Output Summary | Measured counts only; each with coverage (frames analysed / frames total). |
| Estimate vs actual | Show the estimate given at upload next to the real duration. |

**Done when:** one run, one set of numbers on the whole page; step names equal engine jobs.

### Page 04 · Analysis Workspace

**Seen.** Left: Match panel (two teams, "Tracking available: 0 people, 0 ball tracks, 44 passes, 43 balls won, 0 shots, 34 pressures"), tabs View/Events/Filters/AI Tools, Visual Overlays (Player Boxes, IDs, Tracks, Team Shapes, Ball Tracking, Pass Arrows, Heatmaps (Live), Offside Line), Team Filter, Time Range (Full Match, 1st Half 24:30–74:16, 2nd Half 88:27–144:17, Custom), "Match time: confirmed", Create Analysis Clip. Centre: tabs Video Analysis / Tactical View / Heatmap / Pass Network / Player Comparison; video with scoreboard and minimap ("not measured here"), Broadcast View, HD; event chips (All, Goal 1, Passes 44, Key Passes, Shots, Tackles 9, Interceptions 14, Fouls); Tracks & Presence lanes; text summary; Previous/Next event ("150 events"). Right: Players (0)/Events/Clips, table (#, Player, Team, Conf., Status), "No players for this team"; a "No player selected" card (Team, Nationality, Position, Foot, Age; Distance, Top Speed, Passes, Key Passes; heatmap; Season/Match; Touches, Pass Accuracy, Chances Created, Shot Assists, Progressive Passes); Create Highlight Reel ("select a player first").

**Fix.** P18 (tackles, interceptions, offside, chances created, progressive passes: verify built). The Players list is empty while 150 events exist. Centre tabs Tactical View, Heatmap, Pass Network, Player Comparison **duplicate the Tactical page**. The explanatory paragraph under the lanes is dense and easy to miss.

**Upgrade [F five-panel editor with Property panel, K Logging workspace]**

| Zone | Change |
|---|---|
| Preset bar (new) | Review / Track / Assemble / Export presets and Dual mode. |
| Player panel | Keep. Add frame-step, loop span, I/O marks, zoom bar, Snapshot (a photo button), per-overlay opacity. "Broadcast View" becomes a view selector (broadcast, tactical, pitch). |
| Centre tabs | Keep **Video Analysis** only as the working tab; the other four become links that open the Tactical page with the **same context** (single source, no duplicated code). |
| Lanes (below player) | Existing: periods, events, Tracks & Presence. Add: **shots/cuts**, **ball found**, **calibration coverage**, **selected player's visibility**; markers and timestamped notes. [K] |
| Left > Events tab | Event filter with counts, only for event types the engine produces. |
| Right > Players | Unidentified first; columns # / Player / Team / **Evidence** / Status; row actions Confirm, Who is this?. Empty state: "No identified players yet. 12 tracks need review." with button. |
| Right > Property card | Already selection-driven: keep. Add OTSI Player ID, confirmed by / when, appearance evidence, shirt-number reads, linked tracks, look-alikes; each value with badge. [F Property panel] |
| Identity actions | Confirm, change, merge, split as new entries. **Impact preview** before commit: "this will make 2 reels and 1 report stale". [O] |
| Evidence summary | The dense paragraph becomes a collapsible **Evidence summary** card with source and coverage per figure. |
| Right > Events / Clips | Events: Accept or Reject when built (Phase B). Clips: analysis clips created here, drag to Reel Builder. |
| Create buttons | "Create Analysis Clip" works on the current I/O span; "Create Highlight Reel" stays disabled with the reason until a confirmed player is chosen. |

**Done when:** no tab duplicates another page; every identity action shows its consequences first.

### Page 05 · Tactical

**Seen.** Header with Live Match View, Team, Phase; tabs Team Overview / Pass Network / Heat Zones / Pressing & Defense / Off-Ball Runs / Player Comparison; panels: Team Shape & Formation (Team Metrics: Average Width, Average Length, Def. Line Height, Compactness (DEF), Shape Variability; Formation Stability; Build-up Shape; Defensive Shape), Video Preview (Synced), Pass Network, Possession & Heat Zones (Heatmap / Territory / Final Thirds), Pressing Map (PPDA, High Press Success, Final Third Regains, Avg Press Height), Off-Ball Runs, Player Comparison. Everything shows "Not measured" or "No finished analysis". Left panel repeats Analysis.

**Fix.** P9 (no match context), P18 (formation stability, off-ball runs, PPDA, compactness, build-up shape not in the built list). Seven panels crowd one screen; tabs appear to scroll rather than switch.

**Upgrade [K scopes and monitors, F results-driven panels]**

| Zone | Change |
|---|---|
| Context | Inherits S01. Opens on the last match; never "No match selected" if one exists. |
| Coverage banner | Top of page: "Pitch calibration covers 61% of this match; uncalibrated spans are greyed." |
| Tabs | Make tabs **switch** one focused view each (Team Overview, Pass Network, Heat Zones, Pressing, Off-Ball, Comparison) with the Video Preview docked, instead of one long grid. Overview stays the dashboard. |
| Panels | Show only built panels: Team shape, Pass network, Heat/possession, Pressing. Formation, Off-Ball Runs and the metrics not yet computed sit behind the Preview flag (S09). |
| Layers panel | Per pitch: layer list with opacity and badges (shape, heat, passes, pressure, set pieces). [F Property panel] |
| Metrics | Each metric has value, evidence badge, source and "show these moments" (jumps to Analysis or adds to a reel). [F smart bins] |
| Video Preview (Synced) | Loads the proxy at the selected moment; a play-span button. |
| Compare | Two periods or two teams, same scale; Player Comparison links to the Player Report comparison instead of duplicating it. |
| Roles filter | "Attacking Midfielder" appears only if roles are confirmed by a person; otherwise hidden. |
| Export | Image and data with source and evidence footnote; saves into the Library. |

**Done when:** every visible panel has data or an honest empty state; nothing shows a metric the engine cannot compute.

### Page 06 · Reel Builder

**Seen.** Left: Back to Reels; stepper (Select Player ✓ Chinazom Godwin, Choose Moments ✓ 58 clips 555.8 s, Edit & Style (3), Export ✓ Rendered); Aspect Ratio (16:9, 9:16, 1:1); Reel Info (Title, Description, Duration "Auto (Best Moments)", Music "Choose music"). Centre: player with player info card and scoreboard; **Suggested Key Moments (58)** cards (Ball won, Pressure, Pass with durations), "Add all (0)", "More moments of him: Is this him?", View All Moments; timeline with Video Clips, Spotlight Effects, Text & Overlays, Audio ("Match audio of the clips (no music selected)"); Remove all (58). Right: tabs Spotlight / Overlays / Branding. Spotlight Controls (Intensity 38%, Ray Width 46%, Vignette 0%, Glow 30%, Target Lock Sensitivity 81%), Player Targeting (Auto Track Player, Lock on confirmed player "locked", Re-detect Player), Overlays (Player Info Card, Match Score & Time, Competition Logo, Animated Lower Third), Branding (Watermark, Custom Logo, End Screen), Generate Reel again, Preview Render, Save Project.

**Fix.** P15 (truncated note; 3 vs 4 aspect ratios). The player shows the plain frame, so you cannot see the spotlight you are tuning. Fifty-eight numbered blocks in the timeline are unreadable. "Add all (0)" is unclear. Every step is ticked, so the gates are not visible.

**Upgrade [F Idea-to-Video gates, K scene-split into sub-clips]**

| Zone | Change |
|---|---|
| Stepper | Keep your four steps. Add a **gate** on each: clicking Next shows what will happen, the estimate, and what is locked after. Reopening a reel returns to the stage it was left in. [F] |
| Aspect ratio | Four ratios everywhere (16:9, 9:16, 1:1, 4:5) so it matches Export. |
| Player | **Live spotlight preview** on the current clip. Under it a coverage bar: solid where Detected, hatched where Interpolated, empty where the player is unseen. |
| Moment cards | Add evidence badge, spotlight coverage % and the event type; accept, reject, swap, drag to reorder. Low coverage gets a warning chip. "Add all (0)" becomes "Add all suggested (N)". |
| "Is this him?" | Becomes an inline review queue of candidate moments (looks like him, number matches, linked track) with Confirm or Reject; every answer is an audit entry. |
| Timeline | Zoom control and a **list view** toggle for long reels; clip blocks show event icon instead of number at small widths. [K] |
| Spotlight controls | Keep the five sliders and show units. Add presets (Subtle, Broadcast, Bold). Note beside Target Lock: "follows Detected or Interpolated positions only; off where he is unseen." |
| Overlays | Fix the truncated text (wrap, not clip). |
| Music | Select from brand assets with licence shown; **beat-aware cut snap** option. [F AI Beats idea] |
| Branding | Keep; link to Export presets. |
| Footer | Preflight list (stale evidence, low coverage, rights, disk) and estimate above Generate. |

**Done when:** the user sees the spotlight before rendering, knows where it is absent, and sees a plain list of what will be produced.

### Page 07 · Clip Studio

**Seen.** Header with Save Project, Undo, Redo, **AI Edit**, Export; note "every edit is saved as you make it". Left: Media Bin / Graphics / Audio / Templates; search; filter; folder path; clip thumbnails with durations and labels. Centre: player (SD, scoreboard, transport, speed, snapshot icon). Right: Clip Inspector / AI Insights / Adjustments; "No clip selected"; Clip Details (Player, Match, Event Type, Timestamp, Tags, Notes). Toolbar: Split (S), Cut (C), Ripple Delete, Add Marker (M), Voiceover, Auto Captions, Add Graphic, AI Highlights, Speed, Color, Audio, Transform, Fit to Screen, zoom. Timeline 00:00.00 / 09:15.83 with lanes: Video Clips 58, Transitions 0, Graphics & Overlays 58, Lower Thirds 0, Captions 58, Statistics 59, Soundtrack 0, Audio FX 1.

**Fix.** P5, P16. Right panel is empty when nothing is selected. Clip blocks are unreadable at 9 minutes. Transition "+" handles exist but the count is 0.

**Upgrade [F timeline, Property panel, keyframes, mixer; K ripple/slip, effect stack, scopes, compound clips]**

| Zone | Change |
|---|---|
| Header | Add **History** (list of changes) beside Undo and Redo. Rename "AI Edit" to what it truly does, or hide it (S09). |
| Left tabs | Keep Media Bin, Graphics, Audio, Templates; add **Overlays** and **Transitions** tabs like Filmora's top toolbar. Media Bin gets Smart Bins: By event, By match, Unused. |
| Player | Add safe-area guides, aspect switch, loop span, and **scopes** toggle (waveform, histogram, vectorscope, audio meter). [K] |
| Clip Inspector | Default (nothing selected) shows **project properties** (title, aspect, length, evidence mix, stale warnings), like Filmora's Property panel. On selection: In/Out, speed, crop and follow, colour, audio gain and fade, transition, overlay parameters. **Fix P16:** Player, Match, Event Type, Timestamp pre-filled from the moment the clip came from. |
| Toolbar | Keep Split, Cut, Ripple Delete, Marker. Add Slip, Spacer, Snap toggle. **Voiceover, Auto Captions, AI Highlights, AI Insights**: build as optional local features (captions by local speech-to-text, shown as Detected text, off by default) or hide until built. |
| Timeline lanes | Keep all eight. Add a **Spotlight path** lane with editable keyframes: a human nudge is stored as *Confirmed (by hand)*, originals kept, no keyframes where the player is unseen. [K motion-tracker keyframes] Lane controls: lock, mute, **solo**, height. |
| Clips | Show event icon and label at small zoom; thumbnail strip at large zoom. Transitions lane shows chosen transitions; "+" opens the picker. |
| Compound clips | Group an intro block (watermark, match card, lower third) and reuse it. [F Compound Clip, K sequences] |
| Audio | Mixer with faders per lane, loudness target, gain per clip. |
| Markers | Marker list panel with names and regions; markers can sync to events. |
| Render | Preflight button before Export. |

**Done when:** the right panel is never empty, clips carry their metadata, and every button does what it says.

### Page 08 · Player Report

**Seen.** Left section index: Overview, Performance, Attacking Analysis, Passing Analysis, Defensive Actions, Heatmaps, Event Timeline, Comparisons, Scouting Report, Video Clips, Notes & Tags. Header: "No player selected", Position, Team, Nationality, Age, Height, Weight, Preferred Foot, Choose a player. Tracking Confidence ring ("Unverified"). Player Role & Summary ("Role not assessed", Edit). Buttons Add to Scouting Dossier, Export PDF, Share Link. KPI tiles: Match Minutes, Distance (Est.), Top Speed, Sprints, Passes, Key Passes, Shots, xG, xA. Heatmap, Event Timeline, Action Map (Pass, Key Pass, Shot, Goal, Carry), Comparison (per 90), Generated Insights ("Engine data"), Scouting Report (Overall rating /10).

**Fix.** P17, P18 (xG, xA, Sprints, Carry). The page opens empty ("No player selected") even when confirmed players exist.

**Upgrade [F Start hub and Smart Bins, K project notes]**

| Zone | Change |
|---|---|
| Landing | If no player chosen: a **player picker** grid of confirmed players (photo, OTSI Player ID, club, matches analysed), like Filmora's project list; search and filters. |
| Header | Show OTSI Player ID, "confirmed by / when", links to the identity record. Replace "Tracking Confidence" with **Identity: Confirmed / Unverified** and a separate **Evidence coverage** (% of frames where he was seen). No confidence ring until accuracy is measured. |
| KPI tiles | Evidence badge, coverage and per-match or season toggle on every tile. xG, xA, Sprints stay only if the engine produces them; otherwise hidden (S09). "Distance (Est.)" keeps its "Est." as Inferred. |
| Heatmap, Action Map | Calibrated metres; uncalibrated spans greyed; click a point to open the moment. |
| Event Timeline | Filterable; row actions: play, add to reel, pin to report. |
| Comparison | Show the comparison group definition (who, how many, which matches); same scales. |
| Generated Insights | Rename **Rule-built insights**; each sentence has "show the numbers behind this". |
| Scouting Report | Draft and Published states; versioned; audit shown; publish blocked while identity is unconfirmed. |
| Left index | Each item loads its own section; add **Report designer** (section toggles, order, branding, live page preview) before Export PDF. |
| Actions | Export PDF opens a preview first; Share Link goes through the rights check. |

**Done when:** a scout lands on a list of players, not an empty page, and no metric looks more certain than it is.

### Page 09 · Library

**Seen.** Left: Match panel with the same View/Filters/Events/AI Tools and overlay toggles. Main: "Library / Project Center", New Project; tabs All Assets 5, Reels 1, Reports 0, Matches 1, Folders 0, Exports 1, Shared With Me, Templates 0; search; filters (Type, Competition, Team, Created By, Date Range: Last 3 Months); Saved Searches; Trash; Save Current Search; table (Thumbnail/Title, Type, Players Featured, Collaborators "Everyone", Updated, Status). Right: Selected Item (preview, Edit, Competition, Match, Players Featured, Created By, Curated, Duration, File Size, Resolution, Tags; Download, Share, Duplicate, Send to Client, Open in Analysis; Collaborators, Manage Access).

**Fix.** P8, P11. "Everyone" on every row should be checked against project access (ADR-057). No rights or evidence column. Empty table area is large.

**Upgrade [F Smart Search, Smart Media Bin, Media Info, Archive; K Project Bin]**

| Zone | Change |
|---|---|
| Left panel | Replace overlay controls with a **tree**: Folders, **Smart Bins** (by match, team, competition, season, player, event type, rights state, evidence state), Trash, Shared With Me. Smart Bins are saved queries, never copies. |
| Search | Smart Search by player, event, period, tag, shirt number, rights, status. Keep Saved Searches. |
| Table | Add columns: **Rights** (analyse / share / download), **Evidence** (e.g. 12/14 tracks identified), **Profile**, **Device**, project lock icon. Collaborators shows chips or "Restricted", not "Everyone" unless true. Card and table toggle. Multi-select bulk actions. |
| Selected Item | Becomes the **Media Info panel**: probe facts, evidence summary, rights, jobs, assets made from it, thumbnail strip. Actions stay; Send to Client opens the delivery flow. |
| Asset types | Add Snapshots, Archives, Interchange files. |
| Archive | "Archive match" and "Archive reel" make a portable bundle with manifest and audit extract; rights re-checked at pack and open. [F Archive Project] |
| Counts | Tab counts come from S10. |

**Done when:** a user can find "all shots by player X in match Y" without opening a video.

### Page 10 · Export & Delivery

**Seen.** Left: stepper (Edit & Finalize ✓, Export Settings 2, Render & Process ✓, Deliver & Share 4), Project Summary. Centre: player (720p badge), stat tiles (Key Passes, Progressive Passes, Chance Creation), **Highlight Chapters (58)** with Auto Chapters and Edit Chapters (several titled "On camera, no action found"), Export Queue (1), Output & Reports (Performance Report PDF, Player Analysis PDF "AI-generated tactical analysis", Event List CSV, Heatmaps PNG), Shareable Link ("Rights needed", Password Protection, Link expires after 7 days, Allow Download, Allow Comments, "No rights recorded"), Team Collaboration (notify team, notify client, message 0/300). Bottom: Render Progress (Preparing Files, Rendering Video, Processing Reports, Finalizing), "Render ready 1280×720 · 558.83 s · delivery is not built yet", Download All, Deliver to Client. Right: tabs Export / Branding / Reports / Delivery; Output Preset "Highlights Reel (Recommended)", Resolution, Frame Rate, Aspect Ratio (16:9, 9:16, 1:1, 4:5), File Format, Quality; Branded Overlays.

**Fix.** P4, P14, P15. Chapter titles "On camera, no action found" add noise.

**Upgrade [F Batch Export, presets, XML exchange; K render dialog, headless render, OTIO]**

| Zone | Change |
|---|---|
| Stepper | Make states logical: a step is ticked only when complete; current step highlighted; all four clickable. |
| Output Preset | Preset **library**: Club website, Social vertical, Square, Archive, High bitrate, Review proxy; org and user presets with save as. [F] |
| **Batch fan-out** | A checklist of aspects (16:9, 9:16, 1:1, 4:5) so one reel becomes several queued renders. [F Batch Export] |
| Preflight panel | Before Render: rights, stale evidence, spotlight coverage, disk, estimate. Failing item blocks with the reason; the **server** decides. |
| Chapters | Option "Hide chapters with no action"; chapter names from event type and time. |
| Output & Reports | Rename "Player Analysis" to **Rule-built analysis (PDF)**. Add preview for each. |
| Shareable Link | Keep the rights gate; rights capture appears inline ("Record rights" opens the Upload rights form) instead of pointing elsewhere. Add access log and comments toggle behaviour. |
| Render Progress | Same job component as the tray; validation (frame count, full decode) and manifest shown when done. Replace "delivery is not built yet" with a disabled Deliver button and a tooltip, or hide (S09). |
| Delivery tab | Bundle (files, manifest, report), recipient, expiry, password, comments, access log. |
| New: Interchange | Export timeline as OpenTimelineIO and `.otsi-reel` manifest with evidence flags; Archive bundle. [K] |
| Loudness | Target per preset (offline FFmpeg). |

**Done when:** one reel produces several validated outputs, every output states its rights and evidence, and no internal "not built" message reaches a customer.

---

## 3. Build order

| Phase | Scope | Why first |
|---|---|---|
| **0 · Truth and polish** | P1–P18; S08 empty states; S09 preview flag; S10 single summary; relabel steps, AI wording, overlay note; remove or defer Stabilize/Enhance/Crowd Noise; fix metadata carry-over; unify aspects; hide marketing and placeholders | Cheapest changes, biggest trust gain; no engine work |
| **A · Shell** | S01 context bar, S02 job tray, S03 search and palette, S05 Guided/Pro, S06 evidence badge, S14 keys; Upload profile, estimate and rights; Media Info panel; Processing ribbon and job table; Home action strip and Review inbox; Library Smart Bins tree (static) | Foundation every page uses |
| **B · Editing and discovery** | S11 history, S12 presets and Dual mode; spotlight preview and coverage bar, moment accept/reject, gates; spotlight keyframe editor, scopes, compound clips, mixer; Smart Search and Smart Bins; Export presets, batch fan-out, preflight; Player picker and report designer | Where users spend their time |
| **C · Depth** | Assistant with plan preview (rules only); OTIO and manifest export; archive; beat sync; optional local captions; headless render command | After the base is stable |
| **Parallel** | Labelled football test set and accuracy measurement (G01) | Until done, every number keeps "accuracy not yet measured" |

---

## 4. Decisions needed

1. Approve **Phase 0** as the next work. (P1–P18, no new features.)
2. Stabilize, Enhance Quality, Remove Crowd Noise: remove, or keep as "playback copy only, off by default"?
3. Which of xG, xA, Sprints, Carry, Tackles, Interceptions, Off-Ball Runs, PPDA, Formation Stability are actually built? Hide the rest.
4. Which of AI Edit, AI Highlights, AI Insights, Auto Captions, Voiceover exist? Rename, build as local optional features, or remove.
5. Is the Home hero player stat card real data or demo?
6. Is "Everyone" in Collaborators accurate, or should it read "Restricted" where the project lock applies?
7. What does the "QHD" badge control?
8. Should the Tactical tabs switch views (recommended) or keep scrolling the grid?
9. May a human edit the spotlight path (stored as Confirmed by hand)?
10. Assistant: rules only, or also a small local model to interpret requests (never to write facts)?

---

## 5. Evidence limits

- **Screens.** 10 screenshots of a dev build. Many panels are empty (no player selected, no match selected), so I could not see populated states of the Analysis right panel, Player Report or Tactical panels. I did not see modals, hover states, error states or small-screen layouts.
- **Engine.** Only your v2 engine blueprint. I have not seen code, ADR text or the wiring document for pages 07–10. "Verify" items must be checked against the code.
- **Filmora.** From Wondershare's official guides; internals are unpublished.
- **Kdenlive.** From its documentation and a source read; file-level counts were not re-verified this session.
- **Nothing here is implemented.** Phases and effort are proposals.
