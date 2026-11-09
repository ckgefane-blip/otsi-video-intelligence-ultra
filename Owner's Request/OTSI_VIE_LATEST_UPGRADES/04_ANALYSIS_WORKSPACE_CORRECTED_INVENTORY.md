# OTSI VIE — PAGE 04: ANALYSIS WORKSPACE
## Ultra-comprehensive frontend UI inventory — HTML-grounded, section by section

**Source inspected:** `04_ANALYSIS_WORKSPACE.html` (120 source lines, visual reconstruction).  
**Canvas:** 2560 × 1440 px, fixed-position desktop composition; browser-fit uses `min(innerWidth/2560, innerHeight/1440)` and centers scaled canvas.  
**Document status:** Page 04 working inventory for owner review; **not locked/approved**.  
**Scope:** Every visible drawn element, label, setting, control, status, and its styling; intended interaction for implementation; **brief** backend/DB source only.  
**Evidence rule:** Positions and declarations below are read from the HTML. Some text dimensions are browser-rendered, not independently measured. Intended behavior is **not** implemented in the source. Do not mistake illustration for operational functionality.

## 0. Reading conventions and precision

- Coordinates are in the source design's **2560 × 1440** coordinate system; x/y refer to CSS `left` and `top` of the drawn rectangle unless otherwise stated.
- `T(x, yc, text, fontSize)` computes `top = yc − fontSize/2`, with `line-height:1` and `white-space:nowrap`; therefore `yc` is the source's nominal vertical text center, **not a bounding-box measurement**. Text dimensions not fixed explicitly are content-derived.
- `D(x,y,w,h,class,style,text)` creates a positioned `<div>`; cards/controls are **not native form elements**.
- Source icons are Unicode/text glyphs or CSS shapes, not verified production icon assets. Preserve their placement and intent, then implement accessible semantic controls.
- `—` denotes an unknown/empty datum, not numeric zero. Names, team labels and graphic placeholders are design/empty-state text, not live records.
- Backend/DB lines identify **data ownership**, not evidence that an API/table already exists. Confirm against the live NestJS/MySQL project before building or migrating.

## 1. Global styling, layout, type and visual tokens

| Property | Exact source | UI implementation rule |
|---|---|---|
| Viewport and outer background | `html,body{height:100%;background:#000;overflow:hidden}` | Full-view fixed composition, no default scrolling |
| Artboard | `#s` width **2560**, height **1440**; `overflow:hidden` | Reference geometry; responsiveness needs deliberate adaptation without dropping controls |
| Artboard background | `#050d1c` (`--bg`) | Dark navy |
| Primary font stack | `"Segoe UI","Helvetica Neue",Arial,sans-serif` | Do not substitute arbitrary dashboard font |
| Default text | `#fff` | White |
| Muted | `#8ea3bf` (`--mut`) | Muted labels/secondary copy |
| Panel border | `#12335f` (`--line`), 1.5 px | Preserve panel separation |
| Standard panel | `.box`: 1.5px solid `#12335f`; 10px radius; `linear-gradient(180deg,#081a35,#06122a)` | Shared panel appearance |
| Navigation bar | `#040b18`, 1.5px bottom border `#123a6e` | Full width, 100px high |
| Primary blue | `#1e90ff` | Active underline, selection/borders |
| Bright accent text | `#33a8ff`, also `#4db3ff` | Active state, selected labels |
| Blue filled action | `#1580ff` / selected `#0d3a78` | Buttons and active chips |
| Input/control backdrop | `#0a1d38` | Selectors, chips, controls |
| Secondary border | `#17355f`, `#1f4a7a`, `#1f5a9c` | Contextual outlines |
| Content text | `#cfdcf0`, `#dbe8f8` | Main secondary text |
| Secondary caption | `#b3c4dc` | Table/small stats |
| Gold/yellow | `#f5b82e`, `#f5a623` | Tracking or marker accents |
| Cyan | `#19d3ff` | Detection/selection overlay |
| Green | `#19e6c0`, `#2ee59d` | Event/positive legend or indicators |
| Container sizing | `*{box-sizing:border-box;margin:0}` | All specified widths include borders |
| Text | `.t{white-space:nowrap;line-height:1}`, `.b{font-weight:700}` | Specific text size per item below |
| Text horizontal alignment | `.c{transform:translateX(-50%)}` | Applies to centrally positioned text; no auto-wrap |
| Drawn toggle | `.tr`: **54×26**, 13px radius, on background `#1580ff`; knob 20×20 white at right 3px | OFF uses `#34445c`, knob `#c9d3e0` left 3px |
| Drawn checkbox | `.cb`: **20×20**, 2px `#4a6a96` border, radius 4px; `.on` uses `#1a8cff` | No native checkbox behavior present |
| Rectangular icon outline | `.ic`: **24×24**, 2px `#7fa4d4`, radius 6px | Presented next to visual overlay labels |
| Event chip | `.chip`: **42px tall**, 1.5px border `#1f4a7a`, 6px radius, fill `#0a1d38`, font 19px; horizontal padding-left 44px | Active chip uses `#0d3a78`, border `#1e90ff`, text `#33a8ff` |
| Player count badge | `.chip u`: not underlined, dark `#12294a`, radius 4px, 17px font | Currently shows `—` |
| Placeholder/video field | `.ph`: diagonal gradient `#1b4d8f → #0b2a52 → #2a6a3a` | Visual-only |
| Main video | Gradient `#0a2a55 → #143a70 → #1d5a2e → #256b34` | Decorative field, not decoded footage |
| Timeline label | Various **14–20px** | Item-specific values below |

**Global behavior:** `fit()` centers and scales entire artboard on resize; it does **not** rearrange panels. No click, input, keydown, pointer, data fetch, storage or player logic exists. Source inserts generated HTML using `innerHTML` once.

## 2. Header and persistent navigation — `y=0–100`

### 2.1 Bar, branding, active marker
- Full bar: `(0,0,2560,100)`, `#040b18`, bottom border **1.5px** `#123a6e`.
- Brand at `T(30,38)`: **“OTSI VIE”**, **40px bold**, **2px letter-spacing**; `VIE` inline blue `#1e90ff`.
- Subtitle at `T(31,73)`: **“VIDEO INTELLIGENCE ENGINE”**, **13px bold**, letter-spacing **0.8px**, color `#2d9bff`.
- Active Analysis background tab highlight: `(850,12,169,78)` background `#0b2a4d`, **2px** border `#2a6fb5`, radius **10px**; bottom active line `(858,92,153,5)`, `#1e90ff`, radius **3px**.
- Ten navigation labels: **24px, weight 600**, nominal `y=40`, one-row layout: **Home** x381; **Upload** x548; **Processing** x700; **Analysis** x889; **Tactical** x1067; **Reel Builder** x1215; **Clip Studio** x1396; **Player Report** x1555; **Library** x1766; **Export** x1942. **Analysis** active blue `#4db3ff`, weight 700.
- Right divider `(2118,20,2,60)`, `#1a3556`.
- QHD badge `(2140,23,100,54)`, dark `#0a2140`, **1.5px** `#1f5a9c` border, **8px** radius, label **“QHD”** 22px bold `#3aa0ff`, centered.
- Owner avatar `(2271,25,54,54)` circular `#1790ff`, centered **“O”** 24px bold. Text: **“Owner”** at `(2340,41)` **23px bold**, **“OTSI VIE”** at `(2340,69)` **20px muted**.
- **Intended interaction:** Ten links navigate to real routes, active nav highlights the current route; owner avatar opens authenticated account menu; QHD badge is an indicator unless product behavior defines otherwise. In HTML, all are non-interactive divs.
- **Brief backend/DB source:** Authenticated owner/org from session/identity service; route/page identity is frontend router state.

## 3. Left rail — match selection and filters (`x≈22–392`)

### 3.1 Match overview card `(22,118,370,382)`
- `.box` background gradient, 10px radius, 1.5px `#12335f` outline.
- Header **“Match”** `T(47,153)` **28px bold**; ellipsis `T(318,155)` **22px muted**; down chevron `T(358,155)` **24px**.
- Title **“No match selected”** `T(47,197)` **22px bold**; subordinate placeholder **“—”** at `T(47,227)` **20px** `#cfdcf0`.
- Home team indicator: circle `(47,262,48,46)` radius 50%, `#7ab6ff`; label **“Home team”** `T(112,285)` **23px bold**; placeholder **“—”** `T(350,283)` **32px bold**.
- Away team indicator: circle `(47,324,48,54)` radius 50%, `#e8d9a0`; label **“Away team”** `T(112,351)` **23px bold**; placeholder **“—”** `T(350,350)` **32px bold**.
- Notice panel `(37,396,343,98)`, border **1.5px `#1f8a5a`**, radius 8px, background `#0a2a2a`; inner square `(55,412,36,38)` `#2a4a78`, radius 8px. Lines: **“No analysis available”** `(107,423)` 21px bold `#cfe0f5`; **“Tracking data, events and models”** `(107,447)` 17px muted; **“appear after processing completes.”** `(107,468)` 17px muted.
- **Intended interaction:** Match selector/expand via chevron; ellipsis opens match options; selecting a valid match refreshes video, events, player list, overlays and inspector; scores are live-match metadata, not invented.
- **Brief backend/DB source:** Match/team registry, selected match, processing/analysis readiness and rights.

### 3.2 Left rail tabs `(22,510,370,52)`
- Dividing bar `(22,510,370,52)` with 1px bottom `#17355f`.
- **View** `T(42,535)` 22px bold `#33a8ff`, active underline `(24,558,73,3)` `#1e90ff`.
- **Events** `T(121,535)` 21px; **Filters** `T(212,535)` 21px; **AI Tools** `T(301,535)` 21px.
- **Intended interaction:** Four actual rail tabs with distinct contents. Preserve the View panel shown by default. The HTML only renders View contents and does not define the others' detailed panels; **do not invent invisible panel contents as if observed**.
- **Brief backend/DB source:** Rail state frontend; events/filter tools use indexed match event service.

### 3.3 Visual Overlays — eight toggles
- Section label **“Visual Overlays”** `T(48,599)` **22px bold**.
- Each row: outline icon `(48,y−12,24,24)`, `2px #7fa4d4`, radius 6; label `T(96,y)` **21px** `#cfdcf0`; toggle `(313,y−13,54,26)`.

| # | Exact label | Center y | Displayed | On/off appearance | Required control behavior |
|---:|---|---:|---|---|---|
| 1 | Player Boxes | 643 | **ON** | Blue, knob right | Render/hide detected bounding boxes |
| 2 | Player IDs | 681 | **ON** | Blue, knob right | Render/hide verified/indicated identity labels |
| 3 | Player Tracks | 718 | **ON** | Blue, knob right | Render/hide tracked trajectories |
| 4 | Team Shapes | 756 | **ON** | Blue, knob right | Render/hide available team-shape annotations |
| 5 | Ball Tracking | 794 | **ON** | Blue, knob right | Render/hide tracked ball annotations |
| 6 | Pass Arrows | 832 | **ON** | Blue, knob right | Render/hide verified/generated pass arrows |
| 7 | Heatmaps (Live) | 870 | **OFF** | Slate, knob left | Show/hide heatmap overlay only when available |
| 8 | Offside Line | 907 | **OFF** | Slate, knob left | Show/hide offside guide only with supporting analysis |

- **Intended interaction:** Each toggle changes independently, updates viewer rendering immediately and remains consistent during playback. Whether the setting persists is an app decision; do not claim existing persistence. Unavailable analyses require a clear disabled/unavailable indication rather than fabricated overlays.
- **Brief backend/DB source:** Match detections, tracks, identity, possession/events, spatial annotations; toggle state frontend/user preferences.

### 3.4 Team Filter — three mutually exclusive options
- Label **“Team Filter”** `T(48,957)` **22px bold**.
- **All Players**, nominal y1000: row highlight `(38,980,338,40)` background `#0d3a78`, `1.5px #1e90ff`, radius6; indicator circle `(50,989,22,22)` filled `#1e90ff`; label `(96,1000)` 21px; count pill `(326,986,42,28)`, border `#4a6a96`, radius5, **“—”** 17px. **SELECTED**.
- **Home team**, y1044: circle `(50,1033,22,22)`, outline `2px #7fa4d4`; label 21px; count pill `(326,1030,42,28)` `—`. **NOT selected**.
- **Away team**, y1084: circle `(50,1073,22,22)`, same outline; 21px label; count pill `(326,1070,42,28)` `—`. **NOT selected**.
- **Intended interaction:** Single-choice filter; updates viewer overlay, player rows, tracks/events and selected-player availability. Counts from real player set; do not interpret `—` as zero.
- **Brief backend/DB source:** Match-linked teams and player/track membership; selection frontend.

### 3.5 Time Range — four radio options
- Label **“Time Range”** `T(48,1134)` **22px bold**.
- Active highlight behind Full Match `(38,1157,338,36)`, border `1.5px #1e90ff`, radius6, background `#0d3a78`.
- Radio circles `(51,y−11,22,22)`, selected `6px #1e90ff` border with white fill; inactive `2px #7fa4d4` border.

| Choice | Nominal label y | Displayed state |
|---|---:|---|
| Full Match | 1176 | **SELECTED** |
| 1st Half | 1213 | Unselected |
| 2nd Half | 1249 | Unselected |
| Custom Range | 1284 | Unselected |

- Text labels start x97, **21px**. The HTML does **not** draw additional start/end inputs for Custom Range; such a UI must be designed/integrated without misrepresenting it as already visible.
- **Intended interaction:** Mutually exclusive selection; timeline seek boundaries, events, players, metrics and video segment reflect range; custom-range controls only on selection as approved.
- **Brief backend/DB source:** Video period boundaries/match timeline, indexed event timestamps; choice frontend state.

### 3.6 Create Analysis Clip action
- Button-like rectangle `(22,1329,370,69)`, `#0a2a55` background, border `1.5px #1f5a9c`, radius 8.
- Scissors glyph **“✂”** at `T(98,1363)`, 26px `#8fc4ff`; label **“Create Analysis Clip”** at `(146,1363)`, **22px bold** `#33a8ff`.
- **Intended interaction:** Create/open a clip workflow from valid selected match/video/range/filters; enforce authorization and provenance, then transfer to Clip Studio/Reel Builder as appropriate. Must not claim successful clip creation without service confirmation.
- **Brief backend/DB source:** Clip projects/time ranges, media permissions and provenance.

## 4. Center — analysis mode tabs and video player (`x≈414–1994`)

### 4.1 Analysis workspace mode tabs
- **Video Analysis** `T(439,142)`, **27px bold** blue `#33a8ff`, active underline `(414,171,207,3)` `#1e90ff`.
- **Tactical View** `T(661,144)`, 23px.
- **Heatmap** `T(853,144)`, 23px.
- **Pass Network** `T(1006,144)`, 23px.
- **Player Comparison** `T(1202,144)`, 23px.
- **Intended interaction:** Five meaningful workspace tabs, retaining match/player/time context, with visual indication of active mode. The supplied source draws only the Video Analysis mode; do not infer implemented secondary mode layouts.
- **Brief backend/DB source:** Analysis datasets for tactics, heatmaps, passes and comparisons; active mode frontend state.

### 4.2 Video field + empty state `(414,175,1580,675)`
- Main drawn video canvas `(414,175,1580,675)`, corner radius **8px 8px 0 0**, pitch-like four-stop gradient: `#0a2a55` 0%, `#143a70` 20%, `#1d5a2e` 38%, `#256b34` 100%.
- Upper pattern overlay `(414,175,1580,170)`: repeating alternating blue stripe gradient; opacity **.75**.
- Decorative focus/spotlight ray `(1160,175,70,200)` from `rgba(80,170,255,.6)` to transparent.
- Scoreboard base `(439,200,441,40)`, `#0a1a38`, radius4; left white block `(439,200,50,40)` radius3; placeholders at `T(509,220)` 26px bold **“—”**; central blue score block `(603,200,92,40)`, 24px bold **“—”**; text `T(710,222)` 24px bold **“—”**; right blue score block `(789,200,91,40)`, 24px bold **“—”**, radius `0 20px 20px 0`.
- Center empty-state message **“No video loaded — select an analysed match to review tracking”** at `T(1204,512)`, **26px**, color `#dbe8f8`, horizontally centered.
- **Intended interaction:** Playback of selected entitled analyzed video, time-sync tracks/events/annotations and empty-state when missing. Decorative gradient does not count as loaded video.
- **Brief backend/DB source:** Match video assets and streams, rights, processing results, scoreboard/match metadata.

### 4.3 Viewer upper-right tools
- View selector `(1592,190,203,45)`: border `1.5px #2a4f80`, radius6, background `rgba(8,20,40,.85)`, left padding22, **“Broadcast View ⌄”** 20px; intended camera/source mode dropdown.
- Two separate empty icon-button outlines: `(1808,190,45,45)` and `(1867,190,46,45)` with matching border/background/radius. **No visible icon glyph was drawn inside either**. Inventory must preserve these two controls while noting their specific actions are **unidentifiable from the HTML alone**.
- Small gold status/badge `(1927,192,50,38)`, border `2px #f5a623`, radius5, `rgba(40,25,0,.8)`, **“—”** 21px bold `#f5b82e`; meaning unknown without further product contract.
- Bounding box rendering block: source includes `[].forEach(...)`, therefore **no detection boxes or numbered identity labels are actually drawn**. The `.bx`, `.bx.a`, `.nb` CSS establishes cyan/gold candidate styles but is unused on the current screen.
- Lower-right inset pitch `(1717,680,265,158)` border `2px #19a0ff`, radius6, green `#1d6a30`, cyan glow `0 0 12px #19a0ff`; inner vertical line `(1848,682,2,154)` `#d7efe0`. **Decorative/minimap-like region**; no markers or interactions drawn.
- **Intended interaction:** Selection of view, relevant viewer tools when meaning is established, minimize/maximize inset or inspect mini-pitch if product requirements support it. **Do not assign functionality to the two unlabeled tools without confirmation.**
- **Brief backend/DB source:** Video source/camera metadata, tracks and spatial pitch geometry; status data only if defined.

### 4.4 Playback toolbar `(414,850,1580,68)`
- Background `#07142a`, bottom corners radius **0 0 8px 8px**.
- Four first controls: **“▶”** play at `T(448,885)` **30px**; **“❚❚”** pause at `(512,885)` **28px**; **“⏭”** next/skip at `(582,885)` **24px**; current/total **“— / —”** at `(652,885)` **22px**.
- Seek/progress rail `(812,882,766,7)`, background `#17304f`, radius4; playhead circle `(802,874,20,20)`, white.
- Playback speed selector `(1610,866,107,40)`, border `1.5px #17355f`, radius6, fill `#0a1d38`, label **“1x ⌄”** 20px.
- Icons: **“🔊”** volume at `T(1748,885)` 24px; **“⚙”** settings at `(1812,885)` 26px; **“◎”** target/focus at `(1876,885)` 26px; **“⛶”** fullscreen at `(1940,885)` 26px.
- **Intended interaction:** Play/pause, skip navigation, seek/scrub with timestamps, speed change, volume/mute, settings, target/focus, fullscreen. Current source contains no media element, no player events and no handlers.
- **Brief backend/DB source:** Streamable asset and synchronized frame/event timestamps; playback state frontend.

## 5. Center bottom — event filters, tracks, timeline (`414,935,1580,483`)

### 5.1 Panel and nine event-type filter chips
- Outer `.box` `(414,935,1580,483)` standard gradient, radius10, 1.5px border.
- Chip row top y947, height **42px**. Exact source instances:

| # | Chip | x | Width | Displayed count | State |
|---:|---|---:|---:|---|---|
| 1 | All Events | 432 | 149 | *(none)* | **SELECTED**, blue border/fill and text |
| 2 | Goals | 610 | 135 | — | Not selected |
| 3 | Passes | 762 | 168 | — | Not selected |
| 4 | Key Passes | 945 | 177 | — | Not selected |
| 5 | Shots | 1137 | 143 | — | Not selected |
| 6 | Tackles | 1298 | 152 | — | Not selected |
| 7 | Interceptions | 1467 | 204 | — | Not selected |
| 8 | Fouls | 1685 | 138 | — | Not selected |
| 9 | Cards | 1837 | 137 | — | Not selected |

- Each chip's circular icon placeholder `(x+14,957,22,22)` filled **`#33a8ff` active** or **`#2a4f80` inactive**. Chip type 19px text; nonactive count badge `.chip u` 17px background `#12294a`, radius4, padding3×6.
- **Intended interaction:** Filter visible events in timeline/player context; counts from verified event index, not placeholders. Support zero vs unknown distinctions.
- **Brief backend/DB source:** Match-linked event records and event types, confidence/provenance.

### 5.2 Tracks & Presence header, time ruler
- **“Tracks & Presence”** header box `(424,1022,207,41)`, background `#0a1d38`, border `1.5px #1f4a7a`, radius6; text `T(440,1043)` **20px bold**.
- Timeline ruler: **00:00** x650, **15:00** x860, **30:00** x1070, **45:00** x1280, **60:00** x1490, **75:00** x1700, **90:00** x1910; nominal center y1018, **17px** `#cfdcf0`.
- Central empty-state **“No tracks yet — run AI processing to populate presence lanes”** at `T(1200,1180)` **18px** muted `#8ea3bf` and horizontally centered.
- **Intended interaction:** Match-duration-aware ruler, synchronized seeking, track coverage and presence; 90:00 labels are mock reference scale, not proof the selected match lasts 90 minutes.
- **Brief backend/DB source:** Timecoded player track segments, analyzed video duration, event timestamps.

### 5.3 Nine track rows and their checkboxes
- Row formula: `y = 1082 + i × 24.3` for indices 0–8. Each starts with a **20×20 checkbox** at `(425,y−10)` class `.cb` (outlined 2px `#4a6a96`, radius4); the last two use `border-color:#f5b82e` to distinguish team-shape lanes. **No checkbox is checked in the HTML.**
- Number/placeholder text at `T(458,y)` 17px `#cfdcf0`; lane name at `T(495,y)` 18px `#dbe8f8`.

| Row | Center y | Number | Exact label | Checkbox |
|---:|---:|---|---|---|
| 1 | 1082.0 | — | Player track | Unchecked |
| 2 | 1106.3 | — | Player track | Unchecked |
| 3 | 1130.6 | — | Player track | Unchecked |
| 4 | 1154.9 | — | Player track | Unchecked |
| 5 | 1179.2 | — | Player track | Unchecked |
| 6 | 1203.5 | — | Player track | Unchecked |
| 7 | 1227.8 | — | Player track | Unchecked |
| 8 | 1252.1 | *(blank)* | Team Shape (Home) | Unchecked; gold outline |
| 9 | 1276.4 | *(blank)* | Team Shape (Away) | Unchecked; gold outline |

- Source has **no actual coverage bars, event marks, or player numbers** on these lanes. Positioning note: centered empty-state may overlap row labels in the visual reconstruction; test the actual rendered appearance.
- **Intended interaction:** Checkbox selects which tracks/layers are visible; row selection can focus player/track and synchronize overlays. Team shape lanes require real team shape data; never infer it.
- **Brief backend/DB source:** Tracking trajectories, player association and team-shape datasets; selected rows frontend.

### 5.4 Event Types legend
- Heading **“Event Types”** at `T(433,1309)` **17px bold**.
- Legend item labels and center-y positions: **Goals** y1308, **Shots** y1327, **Key Passes** y1346, **Passes** y1364, **Duels** y1382, **Defensive Actions** y1401. Each legend swatch `(540,y−5,10,10)` with 2px radius; labels at `T(560,y)` **14px muted**.
- Corresponding swatches: Goals `#a066ff`, Shots `#19d3ff`, Key Passes `#19e6c0`, Passes `#7ae85a`, Duels `#ffb21a`, Defensive Actions `#ff4a4a`.
- **Important:** Legend has six categories while the nine chips above include e.g. Tackles, Interceptions, Fouls, Cards. They are intentionally **different sets in source**; do not silently claim they match or add undocumented chips.
- **Intended interaction:** Legend explains event color encoding; optional category toggles only if explicitly designed. No active legend interaction exists.
- **Brief backend/DB source:** Event taxonomy and associated timeline markers.

## 6. Right rail — Players / Events / Clips (`x=2015–2537`)

### 6.1 Players panel `(2015,117,522,763)`
- Standard `.box`, gradient `#081a35 → #06122a`, border `#12335f`, radius10.
- Three header tabs: **“Players (—)”** at `T(2062,145)`, **25px bold blue `#33a8ff`** (active); **“Events”** `T(2262,145)`, 24px; **“Clips”** `T(2431,145)`, 24px. Active underline `(2035,171,171,3)` `#1e90ff`.
- Search field drawing `(2033,188,487,40)`, background `#0a1d38`, border `1.5px #17355f`, radius6; **“🔍”** at `T(2052,208)` **18px**, placeholder **“Search players...”** at `T(2083,208)` **18px muted**.
- **Intended interaction:** Tabs switch content, search filters displayed real player records; source does not draw Events or Clips tab contents.
- **Brief backend/DB source:** Match player roster/track association, events, clip references; search state frontend.

### 6.2 Three player-filter chips
- All chip `(2034,243,98,42)`, border `1.5px #1e90ff`, radius6, fill `#0d3a78`; **“All”** at x2052, y264, 19px bold `#33a8ff`; right count badge `(x+w−48,254,36,22)` shows **“—”**. **SELECTED**.
- Home chip `(2148,243,163,42)` border `#17355f`, fill `#0a1d38`, **“Home”** x2194 y264 19px, right count `—`; 22×22 circular color dot `(2160,254)` `#7ab6ff`. **Unselected**.
- Away chip `(2328,243,191,42)` same inactive border/fill, **“Away”** x2374 y264 19px, count `—`; color dot `(2340,254)` `#e8d9a0`. **Unselected**.
- **Intended interaction:** Mutually exclusive All/Home/Away filter, synchronized with left-rail team filter without contradictory state; real counts.
- **Brief backend/DB source:** Match/team/player association; filter state frontend.

### 6.3 Player list: five columns + empty state
- Column labels at nominal y321, **17px muted**: **“#”** x2047, **“Player”** x2127, **“Team”** x2312, **“Conf.”** x2390, **“Status”** x2464.
- Centered empty message **“No players detected yet”** at `T(2276,600)`, **20px muted**.
- Actual player row generation is inside **`[].forEach(...)`**, so zero rows appear. The dormant row template indicates a checkbox, shirt number, circular portrait, name, team badge `MCI`, confidence text, four status bars and selected-row accent, but **none are displayed in this submitted HTML**. Do not inventory these as currently visible live records.
- **Intended interaction:** Player search, row selection, multiselect via checkboxes, confidence/trust treatment, inspect a selected verified/uncertain player. No fabricated team abbreviation or confidence should be supplied.
- **Brief backend/DB source:** Detected tracks, roster identity candidates, identity confidence/provenance and review status.

## 7. Right rail — selected player inspector `(2015,898,522,505)`

### 7.1 Header, placeholder portrait, selection/status
- Standard `.box` `(2015,898,522,505)`.
- Portrait placeholder `(2029,912,110,128)`, 6px radius, gradient `#5a6f8c → #2a4a78`.
- Jersey/identity number badge `(2157,917,39,32)` fill `#1580ff`, radius4, centered **“—”**, **22px bold**.
- Name **“No player selected”** at `T(2214,931)` **26px bold**.
- Close glyph **“✕”** at `T(2493,931)` **24px muted**; intended clear selected player.
- Team-color circle `(2162,960,32,32)`, `#7ab6ff`; text **“Team — |”** at `(2214,973)` 20px `#cfdcf0`; small nationality flag-shaped rectangle `(2378,962,22,22)` `#3a5a88`; **“Nationality —”** at `(2406,973)` 20px `#cfdcf0`.
- Three attribute pills at y1002, h36, border `1.5px #1f4a7a`, 5px radius, fill `#0a1d38`, font18 centered: **“Position —”** `(2158,1002,105,36)`, **“Foot —”** `(2279,1002,104,36)`, **“Age —”** `(2399,1002,81,36)`.
- **Intended interaction:** Open from selected player, clear via X, show only verified/available player attributes and provenance.
- **Brief backend/DB source:** Player identity, roster, verified demographics/attributes and team membership.

### 7.2 Four compact player KPIs
- Four metric cards, all at `y1055`, **h103**, background `#071a33`, border `1.5px #17355f`, radius6. Each has a label at `(x+10,1075)` **16px** `#b3c4dc`, blue circular icon outline `(x+10,1098,26,26)` **2px #19a0ff**, value **“—”** at `(x+44,1109)` **20px bold**, secondary empty text at `(x+14,1139)` **15px** `#2ee59d`.

| KPI | x | w | Value shown |
|---|---:|---:|---|
| Distance | 2029 | 115 | — |
| Top Speed | 2155 | 116 | — |
| Passes | 2282 | 115 | — |
| Key Passes | 2407 | 115 | — |

- **Intended interaction:** Display actual measured/derived player metrics with units, measurement origin and unavailable treatment. Never infer distance/speed from missing tracking.
- **Brief backend/DB source:** Per-player match metrics with units, provenance and calculation status.

### 7.3 Player heatmap
- Heatmap placeholder `(2031,1178,241,188)`, background `#1a4a2a`, border **2px `#cfe3d8`**.
- Centered **“No heatmap”** at `T(2151,1272)` **18px** `#cfe3d8`.
- **Intended interaction:** Show heatmap only when timecoded player positioning supports it, synchronize selected match and player.
- **Brief backend/DB source:** Authorized positional/track sampling and spatial aggregation.

### 7.4 Season/Match selector and five player detail rows
- Selector backdrop `(2288,1177,232,34)`, border `1.5px #17355f`, radius5, fill `#0a1d38`; active **Match** half `(2404,1177,116,34)` background `#0d4aa0`, radius `0 5px 5px 0`.
- **“Season”** at `T(2325,1194)`, **16px muted**, inactive. **“Match”** at `T(2440,1194)`, **17px bold**, selected.
- Five textual statistic rows, label x2292, value x2482, **18px**; exact nominal y positions and values:

| Stat | y | Displayed value |
|---|---:|---|
| Touches | 1231 | — |
| Pass Accuracy | 1261 | — |
| Chances Created | 1291 | — |
| Shot Assists | 1323 | — |
| Progressive Passes | 1353 | — |

- **Intended interaction:** Season/Match segmented switch changes aggregation scope, metrics refresh consistently with selected identity and match; unknown shown as `—`, never forced 0%.
- **Brief backend/DB source:** Match and season aggregated player metrics, with reliability/origin metadata.

## 8. Explicit complete interactive-control checklist (for implementation and UI verification)

The table is a **frontend wiring inventory**, not a claim these controls work in the HTML.

| Element group | Count visible | State/reference | Intended interaction |
|---|---:|---|---|
| Header navigation destinations | **10** | Analysis active | Navigate current route, preserve app session |
| Header owner/profile area | 1 | Owner/O | Account/session menu |
| Match card ellipsis | 1 | Dots | Match actions menu, only verified actions |
| Match card down chevron | 1 | Down | Match selector/expand |
| Left rail tabs | **4** | View selected | Change rail mode |
| Overlay switches | **8** | **6 ON, 2 OFF** | Toggle individual overlay rendering |
| Team filter options (left) | **3** | All Players selected | Exclusive team filtering |
| Time-range radio options | **4** | Full Match selected | Exclusive temporal filtering |
| Create Analysis Clip action | **1** | Outlined filled button | Create clip through real flow |
| Center workspace mode tabs | **5** | Video Analysis selected | Switch analysis view |
| Video-view dropdown | **1** | Broadcast View | Select camera/view |
| Unlabeled video-toolbar boxes | **2** | Empty rectangles | **Unspecified from HTML**; keep without inventing semantics |
| Video playback controls | **3** glyphs | Play, pause, next | Real playback/seek operations |
| Seek bar/playhead | **1** | Empty | Scrub/time sync |
| Playback speed selector | **1** | 1x | Change speed |
| Player volume/settings/target/fullscreen | **4** | Icon glyphs | Relevant viewer actions |
| Gold upper-right video badge | **1** | `—` | Status meaning unverified |
| Event type filter chips | **9** | All Events selected | Event filtering |
| Tracks & Presence row checkboxes | **9** | All unchecked | Layer/track selection |
| Player rail tabs | **3** | Players selected | Switch Players/Events/Clips |
| Player search field | **1** | Placeholder | Text search |
| Player list filter chips | **3** | All selected | Exclusive All/Home/Away |
| Player list checkboxes | **0 visible** | Row generator empty | Only appear with actual row records |
| Selected player inspector clear control | **1** | X | Clear selection |
| Season/Match segmented selector | **2 choices** | Match selected | Scope aggregation |
| Event legend swatches | **6** | Pure legend | Explain classification colors |
| Player mini-pitch inset | 1 | Decorative | No tool behavior confirmed |
| Video scoreboard elements | 4+ | All unknown | Show verified match data; not input controls |
| Main KPI cards | **4** | `—` | Live match-player metrics, not buttons unless designed |
| Secondary statistic rows | **5** | `—` | Display records, not editable fields |

### 8.1 Keyboard, accessibility, and state expectations (implementation only)
- Every actual control needs a semantic button, input, checkbox, radio, select/listbox, tab or slider behavior with accessible name and visible focus indicator; the current HTML has **none** of these semantics.
- Toggle/radio/checkbox values must reflect the displayed default when a valid user context exists and may be reset appropriately on match change; do not persist speculative operational values without confirmed product rules.
- Disabled states must distinguish “no video”, “not yet processed”, “insufficient data”, “unauthorized” and “service unavailable”; never change unknown results to fake values.
- A change in match, player, team, time window, camera view or playback timestamp should keep dependent areas coordinated.
- Canonical OTSI player IDs must never be deduced from temporary tracking labels; respect identity verification and review status.
- Clips, exports and shares must re-check rights/consent before making media accessible.

## 9. Exact source geometry ledger (major objects)

| Block | x | y | w | h | Shape/appearance |
|---|---:|---:|---:|---:|---|
| Artboard | 0 | 0 | 2560 | 1440 | `#050d1c` |
| Global header | 0 | 0 | 2560 | 100 | Dark navy + bottom border |
| Match overview | 22 | 118 | 370 | 382 | Standard `.box` |
| Match unavailable callout | 37 | 396 | 343 | 98 | Green dark-bordered alert |
| Left tab line | 22 | 510 | 370 | 52 | Bottom-line tab region |
| Create clip button | 22 | 1329 | 370 | 69 | Dark blue action |
| Center video | 414 | 175 | 1580 | 675 | Stadium/pitch gradient |
| Center playback controls | 414 | 850 | 1580 | 68 | Dark toolbar |
| Event + track panel | 414 | 935 | 1580 | 483 | Standard `.box` |
| Inset pitch | 1717 | 680 | 265 | 158 | Green blue-outlined minimap |
| Players panel | 2015 | 117 | 522 | 763 | Standard `.box` |
| Players search input visual | 2033 | 188 | 487 | 40 | Dark input |
| Player details panel | 2015 | 898 | 522 | 505 | Standard `.box` |
| Player portrait | 2029 | 912 | 110 | 128 | Placeholder image |
| Heatmap | 2031 | 1178 | 241 | 188 | Green field |
| Season/Match selector | 2288 | 1177 | 232 | 34 | Segmented scope |

## 10. Functional status and short backend/DB source map

**What HTML implements:** It constructs the full **visual** page through DOM insertion, paints fixed rectangles/text, and scales the artboard to viewport.  
**What HTML does NOT implement:** No click handlers, API calls, forms, media playback, real data binding, route navigation, query persistence, player tracking, filters, event sorting, clips, metadata editing, fullscreen or authenticated user behavior. All action descriptions in this inventory are **requirements**, not observed implementation.

| Frontend area | Brief real data source / dependency |
|---|---|
| Header/profile | Authenticated user/org session; frontend routes |
| Match context / scoreboard | Match registry, teams, match/video association |
| Processing readiness | Processing jobs and published analysis outputs |
| Overlay toggles / viewer | Tracks, detections, identity annotations, event/spatial models |
| Team/time filters | Match roster/team mapping, video time range |
| Video playback / mini-pitch | Rights-authorized media playback and spatial metadata |
| Event chips + legend | Indexed real match events with timestamps |
| Track lanes | Timecoded track/presence and team shape segments |
| Player search/list | Match player identities, review confidence and team association |
| Player detail / heatmap | Player roster, movement aggregates, validated measurements |
| Player KPIs and comparison scope | Match/season analytics with clear measurement origin |
| Clip creation | Media clip jobs, asset store, provenance and export permissions |

## 11. Fidelity and validation checklist before Page 04 approval

- [ ] All **ten header routes** visible in the correct order; Analysis active; brand, QHD and owner area match.
- [ ] Left Match card has all its labels, placeholders, status notice, ellipsis and chevron.
- [ ] All **four left rail tabs** present; View selected.
- [ ] All **eight overlay switches** shown and independently operable at the correct default visual state (**6 ON, 2 OFF**).
- [ ] All **three team-filter options** and **four time-range options** present and single-select.
- [ ] Create Analysis Clip control matches size, border, label and icon.
- [ ] All **five center analysis mode tabs** present; Video Analysis selected.
- [ ] Video player preserves scoreboard, empty-state caption, view selector, **two unlabeled upper-right tool boxes**, gold badge, spotlight graphic and inset pitch.
- [ ] Player playback preserves play, pause, next, seek, timecode, 1x speed, volume, settings, target and fullscreen.
- [ ] All **nine event chips** preserve order, labels, positions and empty counts.
- [ ] Time ruler displays all **seven** time labels; **nine track lanes** with individual unchecked boxes are preserved.
- [ ] Six-item event legend displays exact category-to-color mapping.
- [ ] Right player panel preserves three tabs, search, three team filters, five-column table header and empty state.
- [ ] Inspector preserves portrait, clear X, identity/club/nationality fields, three pills, four KPI cards, heatmap, Season/Match switch and five details.
- [ ] Pixel geometry, font sizes and weights, colors, spacings, borders, radii and source-defined active states checked against 2560×1440 reference.
- [ ] Actual functionality tested separately; static source does **not** count as tested interaction.
- [ ] Data-sensitive fields display real values or truthful unavailable states; no fabricated identities, stats or event markers.
- [ ] Owner reviews and **explicitly approves/locks** Page 04 before Page 05 begins.

---

**Source anchor:** `04_ANALYSIS_WORKSPACE.html`, original coordinates and visual declarations. **No modifications were made to the supplied HTML.** This file is the detailed frontend inventory with short backend/DB source notes, not a backend implementation proposal.
