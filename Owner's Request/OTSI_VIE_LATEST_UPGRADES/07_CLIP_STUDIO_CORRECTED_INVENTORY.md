# OTSI VIE — PAGE 07: CLIP STUDIO / TIMELINE EDITOR
## Ultra-comprehensive, source-grounded frontend UI inventory

**Status:** DRAFT FOR OWNER REVIEW — NOT LOCKED  
**Source examined:** `07_CLIP_STUDIO.html` provided for Page 07.  
**Coverage:** Every section, visible field, label, icon/control, styling rule, displayed state and expected frontend interaction in this HTML. **Backend / database source:** brief note per section only.  
**Evidence standard:** `SOURCE` = precisely defined/drawn in supplied HTML; `REQUIRED` = intended real-app behavior, **not** implemented in supplied static HTML. Do not mistake decorative illustration for real footage, media or measured output.

## 0. Global rendering contract — all sections

| Property | Exact source definition |
|---|---|
| Design canvas | `#s` positioned absolute at `(0,0)`, **2560 × 1440 px** |
| Scale behavior | `fit()` applies uniform `scale(min(innerWidth / 2560, innerHeight / 1440))`; centers scaled canvas by adjusting `left/top` on resize |
| Body | `margin:0; height:100%; background:#000; overflow:hidden` |
| Canvas background | `#000c19`; overflow hidden |
| Base font | `"Segoe UI", "Helvetica Neue", Arial, sans-serif` |
| Base foreground | `#fff` |
| Positioning | `.a {position:absolute; box-sizing:border-box}`; `D(x,y,w,h)` uses left/top/width/height; `T(x,y...)` is vertically centered at y via `translateY(-50%)` |
| Right/center text | `.r {transform:translate(-100%,-50%)}`; `.c {transform:translate(-50%,-50%)}` |
| Weight classes | `.b` 700; `.sb` 600; otherwise normal |
| Muted / blue / light blue | `.m #8ea3bf`; `.bl #1e90ff`; `.lb #33a8ff` |
| Standard panel `.pn` | gradient `#081a35 → #06122a`, **1.5px #12335f** border, **14px** corner radius |
| Input-like `.in` | `#041022`, **1.5px #17406f** border, **8px** radius |
| Chip `.ch` | `#0a2447`, **1.5px #1d4f8a** border, **6px** radius |
| Source icon system | Hand-drawn SVG symbols, viewBox 0 0 24 24; typically 1.8px strokes, rounded caps/joins; colors and sizes given below; **icons are approximations**, not supplied licensed assets |
| Dynamic source behavior | `D`, `T`, `I`, `P`, `TH`, `WAVE`, `BAR` create **absolute-positioned drawing elements**. No built-in app router, API calls, persistence, media player, drag-and-drop, editable form fields or event handlers. A visual affordance is not operational proof. |
| Design fidelity | Preserve the supplied coordinates and text; when the running app needs fluid layout or accessibility, adapt behavior without changing the approved QHD composition. |

**Coordinate convention:** `(x,y,w,h)` is CSS canvas position in pixels; text is shown as `(x, centerY, fontSize)`. Where a control is drawn with icon plus label, both coordinates are listed. All measurements are directly traceable to `D`, `T`, `I`, or shared helper calls in source.

## 1. Global application header — y=0–100

### 1.1 Header surface and identity
- **SOURCE:** Full-width bar `D(0,0,2560,100)`; fill `#071a33`; bottom border **1.5px solid #1e90ff**.
- Brand text `OTSI` at **(30,38,40px, bold, white)** and `VIE` at **(130,38,40px, bold, #1e90ff)**.
- Brand subtitle `VIDEO INTELLIGENCE ENGINE` at **(31,73,13px, bold, #1e90ff)**.
- **REQUIRED:** brand may navigate Home if approved; expose an accessible name. Use the real OTSI identity in the production application, without inventing a logo asset.
- **Backend/DB:** Static branding; no data dependency.

### 1.2 Ten navigation destinations — full, exact order
Navigation labels are at y-center **52**, font **24px**, weight **600**, except the active `Clip Studio` label: **700 / #6cc4ff**.

| Order | Label | Text x | State on Page 07 | Intended route behavior |
|---:|---|---:|---|---|
| 1 | Home | 381 | inactive | Navigate to page 01 |
| 2 | Upload | 548 | inactive | Page 02 |
| 3 | Processing | 700 | inactive | Page 03 |
| 4 | Analysis | 889 | inactive | Page 04 |
| 5 | Tactical | 1067 | inactive | Page 05 |
| 6 | Reel Builder | 1215 | inactive | Page 06 |
| 7 | Clip Studio | 1396 | **active** | Remain on page 07 |
| 8 | Player Report | 1555 | inactive | Page 08 |
| 9 | Library | 1766 | inactive | Page 09 |
| 10 | Export | 1942 | inactive | Page 10 |

Active tab panel `D(1372,12,169,78)` is `#073154`, **1.5px #1e6fb0** border, 12px radius; underline `D(1381,92,150,5)` **#1e90ff**, 3px radius. Ensure each entire tab area is clickable and accessible, not only the painted text.

### 1.3 Header environment, owner identity
- Vertical separator at **(2117,20,2,62)**, `#12335f`.
- `QHD` environment badge: panel **(2140,23,100,54)**, `#071e37`, 1.5px `#17406f` border, 8px radius; centered label at (2190,50) **20px bold #33a8ff**.
- Owner avatar: circle **(2271,25,54,54)**, fill `#1e90ff`; centered `O` **22px bold white**.
- `Owner` text **(2340,41,24px bold)**; `OTSI VIE` **(2340,69,19px #8ea3bf)**.
- **REQUIRED:** open real account/profile menu, show authenticated identity and organization; don't hardcode an unrelated person. The `O`, `Owner` and `OTSI VIE` shown are source visual placeholders.
- **Backend/DB:** authenticated session, organization/profile/role.

## 2. Clip Studio title and global editor actions — y=120–182

### 2.1 Back/navigation, breadcrumb and subtitle
- Back control rectangle **(28,120,64,62)** `.in`; SVG `back` at **(60,151)**, **32px #33a8ff**.
- Main breadcrumb: `Clip Studio` **(117,139,36px bold)**; slash `/` **(303,139,36px bold #1e90ff)**; `Timeline Editor` **(332,139,36px bold)**.
- Description **(117,178,22px #b9cbe2)**: `Create, edit and assemble professional reels with AI-powered tools.`
- **REQUIRED:** Back navigates to preceding approved context without losing unsaved changes silently; title reflects editor route/project where appropriate.
- **Backend/DB:** current editor project and navigation context.

### 2.2 Five global editor controls, left-to-right
| Control | Source rectangle | Icon center / size | Label location / type | Visual state | REQUIRED functionality |
|---|---|---|---|---|---|
| Save Project | `(1677,120,192,62)`, `.in` | `(1714,151)`, `sav` 28px | `(1743,152)`, 21px semibold | Normal | Persist current project, timeline, assets and settings; disabled/error handling appropriately |
| Undo | `(1886,120,128,62)`, `.in` | `(1922,151)`, `undo` 28px | `(1948,152)`, 21px semibold | Normal | Undo last reversible edit; maintain history |
| Redo | `(2031,120,129,62)`, `.in` | `(2066,151)`, `redo` 28px muted `#6a7f9c` | `(2095,152)`, 21px muted `#6a7f9c` | **Visually disabled** | Redo history action only when available; proper disabled semantics |
| AI Edit | `(2176,120,144,62)` | `(2212,151)`, `ai` 30px `#9fc8ff` | `(2241,152)`, 21px semibold | Purple gradient `#2a1ab0 → #3a2ae0`, border 1.5px `#5a4af0`, radius 8px | Open AI editing workflow for actual project; unsupported service must show truthful unavailable state |
| Export | `(2344,120,190,62)` | `(2381,151)`, `exp` 30px white; chevron `(2503,151)` 20px | `(2411,152)`, 22px semibold | Blue `#0a84ff`, radius 8px | Export options and rights validation; render through actual engine |

**Keyboard expectations (REQUIRED):** contextually support undo/redo shortcuts where safe; preserve interaction focus, loading state and unsaved-change feedback. Source HTML implements none.
- **Backend/DB:** project save/version metadata, render jobs, export authorization, service capabilities.

## 3. Left Media Bin — panel (28,210,627,610)

### 3.1 Panel appearance and four tabs
- Standard `.pn` surface and border. Tab text y-center **240**, each **22px**: `Media Bin` at x68, semibold **#33a8ff** (selected), `Graphics` x232 **#cfe0f5**, `Audio` x389 **#cfe0f5**, `Templates` x523 **#cfe0f5**.
- Active underline **(41,264,145,3)** `#1e90ff`; divider **(30,267,624,1)** `#12335f`.
- **REQUIRED:** all four tabs change visible browser content and media-type filtering; preserve selection and project context; no static decoration.
- **Backend/DB:** clip assets, media library, graphics, audio and project template metadata.

### 3.2 Search and filter
- Search-like control **(48,284,512,52)** `.in`; search icon **(75,310)** `srch` 26px `#cfe0f5`; placeholder at **(102,311)** **20px #9fb3cc**, exact text `Search clips, players, tags...`.
- Separate filter box **(583,284,52,52)** `.in`, filter SVG at **(609,310)** 26px `#cfe0f5`.
- **REQUIRED:** text is an editable field; search by available clip/player/tag metadata; filter opens relevant options; debounced queries, clear/search/no-results and loading feedback.
- **Backend/DB:** searchable project media, linked player IDs and asset tags.

### 3.3 Folder/navigation rail
- Folder icon `(60,368)` 26px `#cfe0f5`.
- `Folders` text **(102,368,20px)** preceded by chevron icon at **(88,368)** 14px `#8ea3bf`.
- `All media` text **(196,368,20px)** preceded by chevron icon at **(182,368)** 14px `#8ea3bf`.
- **REQUIRED:** expand/collapse folder tree, select folder/all assets, update media list and breadcrumb; keyboard support.
- **Backend/DB:** folders, project associations, accessible media records.

### 3.4 Media grid / empty state / scroll indicator
- Empty text: `No clips in this folder yet` at **(341,590)**, **20px centered #8ea3bf**.
- Media-card generation loop is **empty** in this source: **zero clips actually drawn**. The commented code includes a nine-item duration sample array (`00:14`, `00:27`, `00:18`, `00:21`, `00:32`, `00:15`, `00:11`, `00:24`, `00:19`), but these times **must not be treated as visible data** or real assets.
- Example media-card helper `TH` depicts a synthetic player/football thumbnail; not a real video image. If assets exist, cards need true thumbnails, duration, media type/status, click/drag interaction, accessibility and loading/error states.
- Narrow scroll-indicator bar **(643,400,5,120)** `#17406f`, radius 3px. It is a drawn bar, not a native scroll implementation.
- **REQUIRED:** real scrolling/virtualization as needed; select/preview media; drag media from Media Bin into an applicable timeline track; enforce permissions/rights.
- **Backend/DB:** media assets, thumbnails, durations, rights and ownership.

## 4. Center video preview — panel (678,205,1272,620)

### 4.1 Stage and canvas
- Outer standard panel **(678,205,1272,620)**.
- Preview display **(680,207,1268,533)**, gradient: radial bright-blue at 60% top (`#5fb8ff → #1d4a8a → transparent`), linear `#0a1a38 → #04101f → #0a2a30`.
- Decorative spotlight/football illustration region **(1100,260,500,480)**, radial `#4a9ee0 → #2a6fb8 → transparent`; decorative round element **(1290,640,90,90)**, radial `#dde7f5 → #335`, circle.
- Small top-right status/score badge **(1881,226,48,39)**, dark `#0a0a05`, 2px `#f5b82e` border, radius 5px; centered `—` at **(1905,246)**, 22px bold gold.
- Centered empty-state copy `No clip selected` **(1314,470,26px #dbe8f8)**.
- **REQUIRED:** real video frame/player when a clip is selected; seek/play/pause and apply actual edit effects as supported; show neutral truthful empty state when none selected. The gradient/spotlight and round element are illustration, **not real selected footage**.
- **Backend/DB:** clip/video media URI or authorized streaming endpoint and edit project state.

### 4.2 Playback transport and time display — y≈760–806
| Drawn item | Exact origin | Appearance | REQUIRED interaction |
|---|---|---|---|
| Previous | `prev` SVG center `(729,783)` size 34px | white | Previous boundary/clip/frame as editor mode defines |
| Play | triangle polygon `(796,764,28,38)` | white, scaled 1.3 | Start/pause preview; reflect playback state |
| Next | `next` SVG center `(888,783)` size 34px | white | Next boundary/clip/frame |
| Current time | `(954,783)` 24px | `00:00.00` | Real playhead time; update while playing |
| Slash divider | `(1048,783)` 24px muted | `/` | Static separator |
| Total duration | `(1063,783)` 24px `#8ea3bf` | `00:00.00` | Derived project/clip duration |
| Seek track | `(1180,780,320,6)` | `#0b2a4d`, 3px radius | Seek to timestamp, draggable keyboard-operable progress |
| Seek knob | `(1169,771,22,22)` | `#cfe8ff`, 3px `#33a8ff` outline, circle | Reflect current time without false position |
| Playback speed box | `(1529,760,105,46)` `.in` | `1x` at `(1551,783)`, 20px; chevron `(1607,783)` size 18px | Choose allowed playback speeds and change actual preview clock |
| Volume | `vol` `(1680,783)` 34px | white | Volume/mute adjustment |
| Fullscreen icon #1 | `fs` `(1754,783)` 32px | white | Define/implement viewport or preview fullscreen action |
| Capture | `cap` `(1830,783)` 32px | white camera | Capture authorized still frame / snapshot |
| Fullscreen icon #2 | `fs` `(1904,783)` 32px | white | Appears visually duplicated; preserve visual, clarify distinct behavior during implementation rather than silently remove |

The source contains no `<video>` tag, media source, playback handler or actual cursor synchronization. **Backend/DB:** source asset stream permissions, media metadata; frontend-local playback state.

## 5. Right Clip Inspector — panel (1972,205,562,620)

### 5.1 Inspector tabs and expand action
- Panel standard style.
- Three tab text labels at y235, each **22px**: `Clip Inspector` x1993 **semibold #33a8ff** (selected), `AI Insights` x2171 **#cfe0f5**, `Adjustments` x2318 **#cfe0f5**.
- Expand icon `exv` center **(2502,235)**, size 26px `#cfe0f5`.
- Active underline **(1982,259,145,3)** `#1e90ff`; divider **(1974,262,558,1)** `#12335f`.
- **REQUIRED:** switch inspector subtabs; expand/dock inspector without destroying edited state.
- **Backend/DB:** selected clip, AI analysis summaries and project edit parameters.

### 5.2 Selected-clip summary
- Thumbnail helper `TH(1993,287,215,104,30)` synthetic football image; not real clip screenshot.
- Duration badge **(2152,361,52,27)** dark translucent; value `—` centered **(2178,375)** 17px semibold.
- Title **(2226,303,20px semibold)** `No clip selected`.
- Subtitle **(2226,337,20px #b9cbe2)** `Select a clip in the Media Bin`.
- Third status line **(2226,371,20px #b9cbe2)** `—`.
- **REQUIRED:** selecting a clip updates thumbnail, title, duration and metadata; no fabricated clip/sample.
- **Backend/DB:** selected media asset, duration and related project data.

### 5.3 `Clip Details` heading
- At **(1993,431)**, **24px semibold**.

### 5.4 Six inspector detail rows, every icon, field and displayed value
| Row | Icon center / size | Label position (20px) | Value control/area | Source displayed value | REQUIRED behavior |
|---|---|---|---|---|---|
| Player | `user` `(2006,471)` / 24px | `(2030,471)` | `(2174,449,340,44)`, `#06142a` radius 6px; thumbnail `(2185,454,34,34)` | `Not assigned` `(2229,471)` 20px muted | Select/resolve linked confirmed player; preserve provenance |
| Match | `ball` `(2006,524)` / 24px | `(2030,524)` | `(2174,502,340,44)`; crest `(2178,506,36,36)` | `Not assigned` `(2229,524)` | Choose existing authorized match |
| Event Type | `ball` `(2006,577)` / 24px | `(2030,577)` | `(2174,555,340,44)`; `pass` icon `(2198,577)` / 24px | `Not assigned` `(2227,577)` | Assign/select supported event type with validity rules |
| Timestamp | `clk` `(2006,631)` / 24px | `(2030,631)` | `(2174,608,340,44)` `.in` | `—` `(2189,631)` | Display/edit timestamp within clip/source bounds as permitted |
| Tags | `tag` `(2006,682)` / 24px | `(2030,682)` | Label at `(2176,682)`, plus-chip `(2473,662,40,40)` `.ch` and `plus` icon `(2493,682)` 20px | `No tags` | Add/search/remove tags; persist changes, respect permissions |
| Notes | `note` `(2006,737)` / 24px | `(2030,737)` | multiline-looking `(2174,714,340,92)` `.in` | `Add clip notes` `(2190,737)` | Editable multiline notes with save/autosave and validation |

- Inspector label/icon color: `#cfe0f5`, except placeholders `#8ea3bf`.
- Tag-rendering loop is empty in source (`[].forEach(...)`): **no tag chips drawn**; only `No tags` and plus action.
- **REQUIRED:** focus, validation, editing/persistence states; distinguish auto-detected labels from manually confirmed labels.
- **Backend/DB:** clip-player/match/event associations, timestamps, tags and notes.

## 6. Main editing toolbar — panel (28,843,2506,62)

Standard `.pn`, full-width toolbar. All named tools have SVG center y **875**, SVG **28px**, label center y **875**, font **19px** `#e3eefb`, icon `#cfe0f5` except AI Highlights `#33a8ff`. Do not omit any.

| # | Exact visible label | SVG icon | Icon x | Text x | REQUIRED action |
|---:|---|---|---:|---:|---|
| 1 | Split (S) | `split` | 74 | 101 | Split selected eligible clip at playhead, with undo |
| 2 | Cut (C) | `cut` | 218 | 245 | Cut/remove selected segment according to editor selection semantics |
| 3 | Ripple Delete | `trash` | 355 | 382 | Delete selected interval and close timeline gap, undoable |
| 4 | Add Marker (M) | `mk` | 535 | 562 | Add timestamped marker to project |
| 5 | Voiceover | `mic` | 735 | 762 | Record/import voiceover using user-approved mic permission and media processing |
| 6 | Auto Captions | `cc` | 890 | 919 | Generate/import captions from real audio; unavailable if service absent |
| 7 | Add Graphic | `gfx` | 1083 | 1112 | Insert authorized graphic asset on correct lane |
| 8 | AI Highlights | `ai` | 1265 | 1291 | Open/select real event-driven highlight suggestions; no simulated clips |
| 9 | Speed | `spd` | 1474 | 1502 | Set speed on selected clip or segment |
| 10 | Color | `col` | 1617 | 1645 | Adjust color on selected clip if renderer supports it |
| 11 | Audio | `mus` | 1754 | 1781 | Open volume/mix/audio settings |
| 12 | Transform | `trf` | 1892 | 1919 | Edit scale, crop, position/rotation with visual preview |
| 13 | Fit to Screen | `fit` | 2133 | 2160 | Fit editor/timeline view as context determines |

- Group dividers **(1421,860,1,32)** and **(2078,860,1,32)** in `#12335f`.
- Timeline zoom-out icon `zo` **(2283,875)**, 26px `#cfe0f5`.
- Zoom track **(2310,873,158,5)** background `#0b2a4d`, 3px radius; fill **(2310,873,71,5)** `#1e90ff`; thumb **(2371,865,22,22)** `#cfe8ff` outlined 3px `#33a8ff`.
- Zoom-in icon `zi` **(2498,875)** 26px `#cfe0f5`.
- **REQUIRED:** actual timeline zoom state, keyboard focus, tool disabled states when no clips exist, undo integration, conditional operation handling. Displaying tool icons is not tool implementation.
- **Backend/DB:** saved edit decisions, subtitle jobs/media assets and AI processing services as needed; zoom/selection local UI state.

## 7. Full timeline editor and track control matrix — y≈922–1415

### 7.1 Ruler, clock and background
- Timeline time readout `(42,937)` **32px bold #33a8ff**, text `00:00.00`.
- Secondary time `(42,972)` **20px #8ea3bf**, text `00:00.00`.
- Ruler tick labels at y937 **20px #cfe0f5**, exact x/text: `(357,"00:00")`, `(568,"—")`, `(809,"—")`, `(1055,"—")`, `(1296,"—")`, `(1533,"—")`, `(1780,"—")`, `(2022,"—")`, `(2265,"—")`.
- Ruler band **(335,958,2199,42)** `#0a1d38`, opacity 0.75.
- **REQUIRED:** update ruler labels/ticks according to actual project duration and zoom; no invented timestamps. Include time-to-pixel conversions, horizontal scroll, snapped editing and playhead seeking.
- **Backend/DB:** project duration, timescale and saved edit metadata; ruler is frontend-calculated from real duration.

### 7.2 Track header column and eight lanes
- Left header panel **(28,1003,304,412)** with background `#06122a`, border **1.5px #12335f**, radius 10px.
- Every lane has: eye SVG at x52/y as below **26px #cfe0f5**, second SVG x89/y **24px #cfe0f5** (for lanes 2 and 4: `mute`; all others: `lock`), label x128/y **18px #e3eefb**, count chip **(289,y−16,32,32)** `#0a2447`, radius 6px and centered count `0` at x305/y **19px**.
- Each track content rail drawn **(343,y−20,2128,40)**, `#07162c`, border **1.5px #12335f**, radius **6px**.

| Lane # | Exact lane name | Center y | Header eye | Second drawn icon | Count | Track rail `(x,y,w,h)` | Intended real lane function |
|---:|---|---:|---|---|---:|---|---|
| 1 | Video Clips | 1027 | Eye | Lock | 0 | `(343,1007,2128,40)` | Source video segments: place, trim, split, reorder, move, delete |
| 2 | Transitions | 1074 | Eye | **Mute icon (as drawn)** | 0 | `(343,1054,2128,40)` | Video edit transitions and durations; icon semantics need clarification, not silent redesign |
| 3 | Graphics & Overlays | 1121 | Eye | Lock | 0 | `(343,1101,2128,40)` | Image/graphic overlays and keyframed positions |
| 4 | Lower Thirds | 1168 | Eye | **Mute icon (as drawn)** | 0 | `(343,1148,2128,40)` | Editable lower thirds and player identity labels; icon semantics need clarification |
| 5 | Captions | 1215 | Eye | Lock | 0 | `(343,1195,2128,40)` | Time-aligned captions and text edits |
| 6 | Statistics | 1266 | Eye | Lock | 0 | `(343,1246,2128,40)` | Verified analytics overlays with provenance |
| 7 | Soundtrack | 1320 | Eye | Lock | 0 | `(343,1300,2128,40)` | Licensed music/audio media clips with volume/trim |
| 8 | Audio FX | 1372 | Eye | Lock | 0 | `(343,1352,2128,40)` | Sound effects/media clips with mix and trim |

**Important source-specific fidelity note:** the code literally uses a `mute` icon for *Transitions* and *Lower Thirds*, although those are not ordinarily audio tracks. This is an **observed visual-semantic discrepancy**, not grounds to substitute or omit controls without approval. Document both the exact icon and the intended meaningful behavior.

**REQUIRED for every lane:** clickable track selection; eye show/hide; second control with correct lock/mute function after confirmed semantics; draggable items; snapping; selection; safe reordering; editing; counts from actual lane items; undo/redo and persistence. Source HTML implements none.

### 7.3 Empty-state text, fit button and playhead
- Video lane empty guidance `Drag clips from the Media Bin to start editing` centered **(1407,1027)** **19px #8ea3bf**.
- Timeline fit/expand control box **(2477,1005,49,44)** `.in`; SVG `fit` centered **(2501,1027)** 24px `#cfe0f5`.
- Vertical playhead **(335,935,2,480)** `#33a8ff`, box-shadow `0 0 8px #33a8ff`.
- Playhead top handle **(321,922,30,28)** blue `#1e90ff`, radius 6px; chevron icon `(336,936)` size 16px white.
- Source shows no populated transitions, graphic clips, lower thirds, captions, statistics, soundtrack or audio FX; the section markers for each are comments only. Source includes a `WAVE()` helper for synthetic waveform bars, **but it is never called in the drawn page**. Therefore: **zero audio waveforms visible**.
- **REQUIRED:** seek by dragging playhead, snap to valid boundaries, synchronize preview and inspector; update timeline items/waveforms from actual imported media where present, with no invented timestamps.
- **Backend/DB:** reel project edit timeline, media file timing/duration, captions and audio metadata.

## 8. Interactions / frontend state contract (not implemented in source)

| Scope | Core state | State transitions and persistence |
|---|---|---|
| Global navigation | current route, user identity | Routing with access controls; preserve unsaved-project handling |
| Project | `projectId`, project title, dirty/saving/error flags, revision | Save/restore through existing project backend; show unsaved-change state |
| Media Bin | selected tab/folder, query, filters, current assets, selected media item | Tabs, searches, folder expand, clip selection and drag start; media records from real library |
| Preview | clip/project source, paused/playing, current time, duration, speed, volume/fullscreen | Real browser media element or approved renderer/player; clock/frame synchronization |
| Inspector | selected clip, active tab, player/match/event links, timestamp, tags, notes | Edits bound to selected clip, validated and stored; never fictitious player association |
| Editor | selected track/items, tool/action, history stacks, clipboard, markers | Edits produce real timeline model changes, undo/redo support; persist project |
| Timeline | zoom, scroll, playhead, track visibility, track lock/mute, lane item arrays | Drags, snaps, trim/split, visibility, lock, zoom/seek; prevent forbidden edits |
| Export | requested format/options, job status, rights state | Rights-checked real export; no simulated MP4 completion |

All visible controls need pointer/keyboard accessibility, focus states and appropriate disabled/loading/error responses. **Do not mark a control functional solely because its color changes.** Backend/API source notes in this document describe logical provenance, not verified API route paths or a new database schema.

## 9. Exact visual control checklist for owner review

### Header
- [ ] OTSI / VIE brand + subtitle
- [ ] Ten destinations, exact ordering, Clip Studio active panel and underline
- [ ] QHD badge; Owner avatar and organization

### Title strip and actions
- [ ] Back button, Clip Studio / Timeline Editor breadcrumb, subtitle
- [ ] Save Project; Undo; disabled-looking Redo; AI Edit; Export + chevron

### Media Bin
- [ ] Media Bin, Graphics, Audio, Templates tabs and underline
- [ ] Search clips/players/tags and filter button
- [ ] Folders, All media, folder chevrons, scrollbar indicator
- [ ] `No clips in this folder yet` empty state

### Preview
- [ ] Decorative empty player stage, upper-right gold badge, `No clip selected`
- [ ] Previous, Play, Next; current/total time; seekbar/knob
- [ ] 1x speed/chevron; volume; both distinct fullscreen glyphs; capture icon

### Inspector
- [ ] Clip Inspector, AI Insights, Adjustments; expand icon
- [ ] Thumbnail, duration, selection empty state
- [ ] Clip Details: Player, Match, Event Type, Timestamp, Tags and Notes
- [ ] Tag add button and notes field

### Editing toolbar
- [ ] All **13 named tools**, plus zoom out, slider and zoom in
- [ ] Group divider lines; colors and spacing

### Timeline
- [ ] Two time readouts and all nine ruler labels
- [ ] Eight named lanes, each eye, second control, count `0`, and track rail
- [ ] Empty video lane guidance
- [ ] Timeline fit button; vertical blue playhead and handle

## 10. Traceability / completeness and known source limitations

- **All measurements and wording above are from the uploaded `07_CLIP_STUDIO.html`.** It is labelled `(visual only)` in the HTML title.
- No native `<button>`, `<input>`, `<textarea>`, `<select>`, `<video>` or anchor elements are created in this source; they are drawn `div`s and SVG icons. There are no source event listeners for controls (only window resize) and no API/database calls.
- Source renders an **empty media bin and empty timeline**. Do not copy unused hardcoded durations from dead rendering paths as actual data.
- Clip-preview illustration is synthetic CSS art, not a sample/real clip.
- The second control icon on the Transitions and Lower Thirds lanes is **`mute`**, versus `lock` on all other lanes; treat this as a semantic issue pending approved implementation rules.
- Two fullscreen-style `fs` icons appear in the preview transport. Keep the evidence accurate; assign distinct actions only when the intended distinction is confirmed.
- Synthetic waveform helper exists but **no waveform is rendered** in this supplied clean-state page.
- Exact fidelity at QHD is a visual contract; the user-facing app still needs proper input semantics and real integration with the existing NestJS/MySQL/VIE engine.

**Owner review gate:** Page 07 remains **UNLOCKED** until explicitly approved. Do not claim Section/Page acceptance from document generation alone. No Page 08 implementation or inventory is authorized by this file.
