# OTSI VIE — PAGE 05: TACTICAL INTELLIGENCE
## Ultra-comprehensive frontend UI inventory · source-grounded · REVIEW COPY (NOT LOCKED)

**Source inspected:** `05_TACTICAL_INTELLIGENCE.html` (supplied Page 05). **Reference canvas:** 2560 × 1440 px. **Source scope:** this actual HTML and its emitted CSS/JavaScript, not an assumed React application or separate original PNG. **Purpose:** reproduce every visible field, pixel-level styling convention, control, section, drawing, label, state and expected action in the real frontend; append only **brief backend/DB source notes**. **Approval:** not approved or locked yet.

> **Implementation truth:** This file is a *visual drawing*. It constructs HTML strings with `D`, `T`, `H`, `SEL`, `PITCH`, `PL`, `HEAT` and assigns `innerHTML` once. There are no application-state handlers, actual HTML `<select>`, `<input>`, `<button>`, navigation routes, video element, network calls or database connectivity in the supplied source. **Every described interaction below is a required implementation**, not a claim about current HTML behavior. A drawn placeholder such as `—` or `Not measured` must never be replaced with fabricated analytics. The literal helper `PL` for player marker and `HEAT` for heat rendering exist but are **not invoked** in the delivered empty-state visual.

### Visual measurement and fidelity contract

| Property | Exact source contract |
|---|---|
| Design viewport | **2560 × 1440 px**, absolute-position canvas `#s` |
| Browser background | `#000`; no document scroll (`overflow:hidden`) |
| Canvas background | `#050d1c` (`--bg`) |
| Main font | `Segoe UI`, fallback `Helvetica Neue`, Arial, sans-serif |
| Base foreground | `#fff`; secondary muted `#8ea3bf` |
| Header background | `#040b18`; divider `1.5px solid #123a6e` |
| Generic panel (`.box`) | `linear-gradient(180deg,#081a35,#06122a)`; `1.5px solid #12335f`; radius `10px` |
| Most section accent | `#1e90ff`; labels `#33a8ff`, highlights `#4db3ff`; active dark blue `#0d3a78` |
| Secondary text colors | `#cfdcf0`, `#c9d6ea`, `#b3c4dc`, `#dbe8f8` as placed |
| Pitch | `linear-gradient(90deg,#1c6a30,#26793a 50%,#1c6a30)`; `2px solid #cfe8d6` |
| Pitch markings | `#cfe8d6aa`, mostly 2px |
| Typography | T helper: absolute left / vertical-center alignment (`top = centerY − fontSize/2`), `line-height:1`, no wraps (`white-space:nowrap`); headings usually 25px bold; main page title 40px bold; navigation 24px weight 600 |
| Generic selector | `.sel`: `1.5px solid #17355f`, radius 6px, fill `#0a1d38`, text `#dbe8f8` 19px, horizontal padding 14px, down-chevron from CSS `::after` |
| Toggle | `.tr`: 46×26 px, blue `#1580ff`, radius 13px, white knob 20×20 at top3/right3; all 7 shown **ON** |
| Outline checkbox square | `.ic`: 24×24, border 2px `#7fa4d4`, radius 6px; drawn as icon square, not a native input |
| Progress bar | `.pb`: 9px tall, dark `#17304f`, rounded 4px; its child blue `#1a8cff` defaults to 0% in this empty state |
| Player marker helper (available, not drawn) | Circular bright blue `#1a8cff`, light border `#7fd0ff`, white 21px bold jersey number, optional player label 17px bold below |
| Coordinates | X grows right, Y down. All geometry below refers to the 2560×1440 canvas, **not viewport-scaled CSS pixels** |
| Scaling | `fit()` uses `min(windowWidth/2560, windowHeight/1440)` with centered transform; aspect ratio preserved, no genuine responsive reflow |

### Implementation rules common to every section

1. Preserve the approved 2560×1440 appearance while implementing actual accessible semantic controls. The rendered controls should match the drawn design, including labels, placements, selected/disabled states and keyboard/focus behavior.
2. Where source supplies only a placeholder (`—`, `No data`, `Not measured`, `No team selected`), retain that truthful initial state until validated data exists. Do not interpret drawn colored pitch/legend as actual measured tactical analysis.
3. Any calculated value must identify its origin and status (measured/derived/confirmed/not measured) in the real app; player identity and export rights must remain governed by existing engine logic.
4. A dropdown, tab, checkbox or playback icon is **not implemented** merely because its appearance changes: it must modify the intended view, use state and API requests as applicable, and show unavailable/errors truthfully.
5. **Brief backend notes** here identify likely sources from the named feature; they are not claims that these entities/endpoints already exist. Check and reuse the actual VIE MySQL schema and services.

## 01. Global header — full-width shared chrome

**Bounds:** `(0,0,2560,100)`, background `#040b18`, bottom divider `1.5px solid #123a6e`. No side navigation or second header row.

| Element | Absolute design placement | Typography / visual | Intended frontend behavior | Brief source |
|---|---|---|---|---|
| Wordmark `OTSI VIE` | text left x30, center y38 | **40px bold**, letter-spacing 2px; `VIE` blue `#1e90ff` | Brand/home navigation; preserve exact wordmark | Static brand assets |
| Subtitle `VIDEO INTELLIGENCE ENGINE` | x31, center y73 | 13px bold, letter-spacing .8px, `#2d9bff` | Static | Static |
| Active Tactical tab background | `(1024,12,169,78)` | `#0b2a4d`, 2px `#2a6fb5`, radius 10 | Active tab indicator follows route | Router |
| Active tab underline | `(1032,92,153,5)` | `#1e90ff`, radius 3 | Active tab follows route | Router |
| Vertical separator | `(2118,20,2,60)` | `#1a3556` | Decorative | Static |
| QHD badge | `(2140,23,100,54)` | `#0a2140`, 1.5px `#1f5a9c`, radius 8; `QHD` 22px bold `#3aa0ff` | Display mode/status as designed | Frontend display config |
| Avatar circle | `(2271,25,54,54)` | `#1790ff`, radius 50%; white `O`, 24px bold | Open account menu | Auth session |
| Owner display | x2340 y41 | `Owner`, 23px bold | Read authenticated user role/name, not invented identity | Session |
| Organization subtitle | x2340 y69 | `OTSI VIE`, 20px muted | Real org information | Session/org |

**All ten navigation destinations, exact order and label baselines** (each at `top:40px`, `font-size:24px`, `font-weight:600`):

| # | Visible label | Left X | Source state |
|---:|---|---:|---|
| 1 | Home | 381 | Inactive |
| 2 | Upload | 548 | Inactive |
| 3 | Processing | 700 | Inactive |
| 4 | Analysis | 889 | Inactive |
| 5 | **Tactical** | 1067 | Active, `#4db3ff`, bold |
| 6 | Reel Builder | 1215 | Inactive |
| 7 | Clip Studio | 1396 | Inactive |
| 8 | Player Report | 1555 | Inactive |
| 9 | Library | 1766 | Inactive |
| 10 | Export | 1942 | Inactive |

**Function:** implement ten real accessible route links with active-route highlighting; opening each must preserve user session. **Source:** app router and authenticated user/organization.

## 02. Left sidebar A — Match context

**Main panel:** `(22,115,382,420)` `.box` (`#081a35 → #06122a`, `#12335f` 1.5px, radius 10).

| Element | Coordinates | Visual content/typography | Expected behavior |
|---|---|---|---|
| Panel heading | x40, y151 | `Match`, 26px bold | Section label |
| Overflow | x332, y153 | `··` 20px muted | Match actions menu if supported |
| Chevron | x362, y153 | `⌄` 22px | Expand/select match |
| Match title | x40, y195 | `No match selected`, 22px bold | Replace only with real match name |
| Secondary info | x40, y230 | `—`, 20px `#cfdcf0` | Match date/competition from real record if available |
| Home emblem placeholder | `(44,268,50,50)` | Circular `#7ab6ff` | Real crest only if assigned |
| Home team text | x110, y294 | `Home team`, 24px, font weight 500 | Real home team |
| Home-side score/value | x357, y292 | `—`, 32px bold | Score if known and supported |
| Away emblem placeholder | `(44,334,50,58)` | Circular `#e8d9a0` | Real crest only if assigned |
| Away team text | x110, y364 | `Away team`, 24px, weight 500 | Real away team |
| Away-side score/value | x357, y362 | `—`, 32px bold | Genuine score only |
| Availability strip | `(34,418,356,103)` | background `#0a2a2a`, border 1.5px `#1f8a5a`, radius 8 | Live processing/analysis readiness |
| Availability icon block | `(52,436,36,40)` | `#2a4a78`, radius 8 | Icon placeholder |
| Status title | x108, y445 | `No analysis available`, 21px bold `#cfe0f5` | Show real readiness state |
| Status explanatory line 1 | x108, y473 | `Tracking data, events and models`, 17px muted | Empty-state guidance |
| Status explanatory line 2 | x108, y496 | `appear after processing completes.`, 17px muted | Empty-state guidance |

**Behavior:** match selector should switch the shared selected match across formation, video, metrics, maps and comparisons; never keep stale values from previous selection. **Backend/DB:** match, competition, teams, media asset, processing/analysis readiness.

## 03. Left sidebar B — tabs, overlay checkboxes and switches, team/time filters

**Panel:** `(22,541,382,880)`, `.box`, top border explicitly removed (`border-top:none`). All drawn elements are within fixed sidebar; **no native sidebar scrolling** in source.

**Tab strip:** `(22,545,382,55)`, lower border `#17355f`. Exact text baselines: View `(35,568)` 21px bold cyan `#33a8ff` (active), Filters `(110,568)` 20px, Events `(199,568)` 20px, **`All Tools`** `(292,568)` 20px. Active underline `(22,596,66,3)`, `#1e90ff`. Build four functional tabs; preserve wording **All Tools** (not “AI Tools”). Source only draws the View panel, so content of the other three tabs is **not specified** in this HTML; do not invent feature contents. If other validated specification provides them, source accordingly.

### 03.1 Visual Overlays — every checkbox and toggle

Heading `Visual Overlays` x39, center y639, 22px bold. **Seven** rows, not eight. Each row is: empty square 24×24 at `(41,centerY−12)` with 2px `#7fa4d4` stroke and 6px radius; text at x88, centerY, 21px `#cfdcf0`; right toggle `(340,centerY−13)` of **46×26** with blue `#1580ff`, radius 13, white 20px knob. **All seven switches are drawn ON; the accompanying left checkbox squares appear unmarked**. Preserve this two-control visual representation and clarify distinct intended meanings before wiring both to independent state.

| # | Exact label | Row center Y | Checkbox rect | ON toggle rect | Layer expected when data exists |
|---:|---|---:|---|---|---|
| 1 | Player Boxes | 681 | 41,669,24,24 | 340,668,46,26 | tracked entity bounding boxes |
| 2 | Player IDs | 723 | 41,711,24,24 | 340,710,46,26 | confirmed/qualified ID labels |
| 3 | Player Tracks | 765 | 41,753,24,24 | 340,752,46,26 | trajectories |
| 4 | Team Shapes | 807 | 41,795,24,24 | 340,794,46,26 | team/formation geometry |
| 5 | Heatmaps | 851 | 41,839,24,24 | 340,838,46,26 | measured heat overlays |
| 6 | Ball Tracking | 895 | 41,883,24,24 | 340,882,46,26 | ball detection/trajectory |
| 7 | Pass Arrows | 938 | 41,926,24,24 | 340,925,46,26 | pass vector annotations |

**Behavior:** each toggle must actually show/hide its corresponding overlay in the relevant tactical viewer, persist appropriate preferences and respect unavailable-data conditions; when no tracking exists, keep unavailable state honest. The checkbox and toggle are separate drawn shapes with no defined distinct semantics: do **not** silently assign two conflicting independent data settings. **Backend/DB:** analysis overlay artifacts and user preferences, matched to selected match/video/time.

### 03.2 Team Filter — radio-style choices

Heading `Team Filter` x39 y1000, 21px `#cfdcf0`. Selected row fill `(34,1026,356,46)`, `#0d3a78`, stroke 1.5px `#1e90ff`, radius 6; blue circle `(44,1039,24,24)`. Row text x88; trailing count badge `(339,centerY−15,44,30)`, border `#4a6a96`, radius 5 and 18px `—`.

| Exact label | Center Y | State | Radio control |
|---|---:|---|---|
| All Players | 1050 | Selected | Blue filled circle in selected row |
| Home team | 1100 | Not selected | `(44,1089,22,22)`, border 2px `#7fa4d4` |
| Away team | 1148 | Not selected | `(44,1137,22,22)`, border 2px `#7fa4d4` |

**Behavior:** mutually exclusive filter updates tactical players, team metrics and overlays; counts derived from the real roster/track records, not arbitrary. **Backend/DB:** match teams, tracked players, roster associations.

### 03.3 Time Range — radio-style choices

Heading `Time Range` x39 y1207, 21px `#cfdcf0`. Active row `(34,1233,356,46)` dark blue `#0d3a78`, border `#1e90ff` 1.5px; active filled circle `(46,1245,24,24)`.

| Exact option | Center Y | State | Radio geometry |
|---|---:|---|---|
| Full Match | 1257 | Selected | Filled blue circle (46,1245,24,24) |
| 1st Half | 1303 | Unselected | `(47,1292,22,22)`, outlined |
| 2nd Half | 1344 | Unselected | `(47,1333,22,22)`, outlined |
| Custom Range | 1388 | Unselected | `(47,1377,22,22)`, outlined |

All option labels have x88, font size 21px. **Behavior:** mutually exclusive selection synchronizes all statistics/pitch views/video time interval; Custom Range should expose start/end values in implementation although none are drawn in this source. **Backend/DB:** video timeline, match halves and timestamped analysis artifacts.

## 04. Page heading, top context controls and six navigation tabs

| Visible element | Exact bounds/position | Styling and wording | Functional requirement |
|---|---|---|---|
| Tactical icon frame | `(440,128,76,48)` | `3px solid #19a0ff`, radius 6, **empty drawn frame** | Icon may be provided from approved assets; do not guess glyph |
| Heading | x543 y145 | `Tactical Intelligence`, **40px bold** | Heading |
| Description | x543 y187 | `Go beyond the video. Uncover tactical patterns, team behaviours and player insights with AI-powered analysis.`, 22px `#c9d6ea` | Fixed copy |
| View selector | `(1656,138,364,59)` | `Live Match View`, 19px, selector `#0a1d38` | Change tactical context/view mode |
| Team field label | x2053 y134 | `Team`, 18px `#b3c4dc` | Fixed label |
| Team selector | `(2051,145,236,53)` | `Select team`, blue border `#1e90ff`, blue fill `#0d3a78` | Select available team |
| Phase field label | x2317 y134 | `Phase`, 18px muted | Fixed label |
| Phase selector | `(2316,145,211,53)` | `All Phases` | Filter phase |
| Selected tab background | `(438,222,266,62)` | gradient `#0d2d57→#0a2347`, radius 8 upper corners | Follows selected view |
| Selected-tab underline | `(438,281,266,4)` | `#1e90ff` | Follows selection |

**Six top tab destinations:** All labels 22px, center y253, with preceding 32×28 outline square at `(labelX−45,242)` and text starting at labelX. The source highlights Team Overview in bold cyan `#33a8ff` and uses `#33a8ff` outline for its icon.

| # | Label EXACT | Text left X | Selected in source |
|---:|---|---:|---|
| 1 | Team Overview | 527 | Yes |
| 2 | Pass Network | 791 | No |
| 3 | Heat Zones | 1026 | No |
| 4 | Pressing & Defense | 1238 | No |
| 5 | Off-Ball Runs | 1522 | No |
| 6 | Player Comparison | 1757 | No |

**Behavior:** switch to the corresponding tactical subsections, or scroll/focus to them if view structure retains the single-screen layout; no duplicated data fetched unnecessarily. **Backend/DB:** selected match/team/phase and associated tactical analysis outputs.

## 05. Team Shape & Formation — main left-mid panel

**Outer bounds:** `(432,300,1228,497)` `.box`. **Header:** `H(432,323,'Team Shape & Formation',true)` → blue bar `(440,309,6,28)` with radius 3; heading at x456 y323 **25px bold**; circular info `i` attached (18px muted, 1.5px `#6a84aa` outline). Clicking info should describe definitions, data requirements and limitations.

### 05.1 Pitch and selected team

- **Pitch subpanel:** `(447,350,735,433)` `.box`, border overwritten to `#142f55`.
- **Team color dot:** `(455,360,37,37)` circle `#7ab6ff`; team title `No team selected` x505 y378, 23px bold; value `—` horizontally centered at x849 y378, 21px bold.
- **Selector:** `(1049,360,118,37)` `.sel` showing `—` with chevron; no options are defined in the HTML. Intended to choose formation/time or team context, to be determined from real data.
- **Pitch canvas:** `(447,404,735,379)` with horizontal green gradient and `2px #cfe8d6` boundary. Center line at x814.5 (2px); center circle `(774.5,553.5,80,80)` 2px translucent white; left penalty rectangle at x447 y543.5, width73.5 height100; right penalty rectangle at x1108.5 y543.5, width73.5 height100.
- **Empty-state overlay:** x814 y470 `Not measured — requires calibrated tracking data`, 22px centered, pale green `#e6f3ea`, transparent dark `rgba(7,20,42,.78)` background, 4px × 12px text padding, 6px radius.
- **Player count/markers:** **zero placed in the actual source**. `PL()` helper is defined but not called; no visible actual 11-player formation. Do not claim players are currently plotted.

**Expected behavior:** on confirmed data availability display actual formation, player marks and positions at appropriate timestamp/phase, selectable players, synced team context, uncertainty if uncalibrated. **Backend/DB:** team, match, calibrated field coordinates, track observations/formation estimates.

### 05.2 Team Metrics (Current Phase)

**Metrics panel:** `(1206,350,444,260)`, `.box` alternate border `#142f55`. Header at x1226 y374 `Team Metrics (Current Phase)`, 20px bold; parenthetical is muted `#8ea3bf` regular.

Each row has 21px `#cfdcf0` text at x1226; horizontal bar `(1410,centerY−4,150,9)` dark `#17304f` and a child blue fill 0%; bold em dash at x1583, 19px.

| Row | Center Y | Placeholder |
|---|---:|---|
| Average Width | 411 | `—` |
| Average Length | 451 | `—` |
| Def. Line Height | 492 | `—` |
| Compactness (DEF) | 532 | `—` |
| Shape Variability | 574 | `—` |

**Behavior:** time/phase/team reactive; show units, measured data source and appropriately scaled bars, avoiding arbitrary percentages. **Backend/DB:** calibrated team spatial aggregate metrics.

### 05.3 Formation Stability / phase-shape legend

**Panel:** `(1206,620,444,160)`, border `#142f55`. `Formation Stability` x1226 y645, 22px `#dbe8f8`; value `—` x1584 y645, 24px bold `#33a8ff`.

- **20 mini segments**, each 18×9 px, starting `(1226,666)` at x = 1226 + `20.1*k`, k=0…19; fill `#17304f` (all shown unfilled/inactive).
- `Build-up Shape` x1226 y710, 20px; value `—` x1385 y710, 21px bold; diamond `(1450,703,14,14)` `#19e6a0` rotated 45°; `In Possession` x1480 y710, 19px.
- `Defensive Shape` x1226 y756, 20px; value `—` x1385 y756, 21px bold; diamond `(1450,749,14,14)` same green; `Out of Possession` x1480 y756, 19px.

**Behavior:** update segmented stability and formation labels from real frame/phase results; explain confidence/methodology in info. **Backend/DB:** formation observations, possession phases and computed stability.

## 06. Video Preview (Synced) — top-right panel

**Outer bounds:** `(1676,292,856,505)`, `.box`. Header `H(1676,323,'Video Preview (Synced)',true)` (blue accent bar x1684 y309, 6×28; 25px bold x1700 and info icon).

| Visual element | Exact coordinates | Visual specification | Function |
|---|---|---|---|
| Angle selector | `(2275,305,182,38)` | `.sel`, `Tactical Angle`, chevron | Switch view/camera source if available |
| Square icon control | `(2486,310,28,28)` | border 2px `#cfe3ff`, radius 5, no icon inside | **Unknown**; preserve visually and do not invent effect |
| Video surface | `(1684,351,844,369)` | field green gradient (`#0a2a55`/`#143a70`/`#1d5a2e`/`#256b34`) | Show actual selected video frame |
| Stadium pattern | `(1684,351,844,90)` | striped navy `repeating-linear-gradient(90deg,#183a70,#10264a 14px,#1d4380 28px)` 75% opacity | Visual backdrop only |
| Scoreboard backing | `(1695,360,350,37)` | `#0a1a38`, radius 4 | Actual match label/score/time when known |
| White side badge | `(1695,360,40,37)` | white, radius 3 | Team logo placeholder |
| Score field 1 | x1752 y378 | `—`, 24px bold | Real score only |
| Blue scoreboard pill 1 | `(1826,360,76,37)` | `#1580ff`, 22px bold `—` | Actual score/time as defined by player |
| Score separator | x1912 y378 | `—`, 22px bold | Dynamic |
| Blue scoreboard pill 2 | `(1970,360,75,37)` | `#1580ff`, 22px bold `—` | Actual data |
| No media text | centered x2106 y535 | `No video loaded`, 24px `#dbe8f8` | Correct empty state |
| First transport glyph | x1702 y760 | `▶` 24px | Determine intended skip/play purpose; glyph alone ambiguous |
| Large play glyph | x1750 y760 | `▶` 44px | Play/pause synchronized media |
| Clock | x1807 y760 | `— / —`, 20px | Current / total media time |
| Seek track | `(1945,757,321,7)` | rounded 4px `#17304f`; 0% blue fill | Scrubbable timeline |
| Seek knob | `(1945,751,18,18)` | white circle | Draggable timeline control |
| Speed selector | `(2292,741,73,38)` | `.sel`, `1x` | Playback speed |
| Volume | x2388 y760 | `🔊` 22px | Volume/mute |
| Settings | x2436 y760 | `⚙` 24px | Player settings |
| Fullscreen | x2486 y760 | `⛶` 24px | Fullscreen view |

**Behavior:** camera, play/pause, seek, rate, mute, player settings and fullscreen must control the **same selected media and time window** as all tactical panels; show real buffering/error states. **Backend/DB:** media asset location, playback authorization, time-indexed tactical events; no direct DB connection from browser.

## 07. Pass Network

**Panel:** `(432,810,650,340)` `.box`. Heading `H(432,842,'Pass Network',true)` → x456 y842, 25px bold and circled info; bar `(440,828,6,28)`.

| Element | Coordinates | Content / style / action |
|---|---|---|
| Team dropdown | `(667,824,191,38)` | `.sel`, `Select team`; select real team |
| Time dropdown | `(881,824,185,38)` | `.sel`, `Time range`; change time-filtered pass network |
| Pitch | `(445,879,447,256)` | pitch green gradient/white lines (`PITCH` helper), center line x668.5, 80px center circle, penalty shapes approx 44.7×100 |
| Overlay text | centered at x668 y915 | `Not measured`, 22px `#e6f3ea`, dark translucent rounded label |

**Network legend** at right, text baseline x974 (18px `#cfdcf0`), `Passes` label x919 y917 (19px):

| Legend | Center Y | Stroke origin | Width / style |
|---|---:|---|---|
| `1-3` | 950 | x919 | length 40, 2px thick, `#1a8cff` |
| `4-6` | 979 | x919 | length 40, 4px thick, `#1a8cff` |
| `7-10` | 1008 | x919 | length 40, 6px thick, `#1a8cff` |
| `10+` | 1037 | x919 | length 40, 9px thick, `#dbe8ff` |
| `Successful` | 1076 | `(919,1075,40,3)` | solid blue `#1a8cff` |
| `Unsuccessful` | 1104 | x919, y1103 | red dashed `#ff3a3a`, 3px border-top |

**Behavior:** select team/time, draw only sourced pass connections (real locations, accurate network weighting and success legend); tooltips for edges/nodes where data permits. **Backend/DB:** detected/confirmed pass events with timestamp, source/target player or positions and outcome.

## 08. Possession & Heat Zones

**Panel:** `(1103,810,705,340)` `.box`; `H(1103,842,'Possession & Heat Zones',false)` creates blue bar `(1111,828,6,28)` and 25px bold header x1127. There is **no circled info icon** for this heading in the source.

### 08.1 Three mutually exclusive view choices

| Tab | Placement | Style / selected state |
|---|---|---|
| Heatmap | `(1440,822,122,43)` | active `#0d5ac0`, radius 6, 19px white semibold |
| Territory | text x1592 y844 | inside `(1562,822,240,43)` outlined dark group; 18px muted |
| Final Thirds | text x1709 y844 | inside same outlined dark group; 18px muted |

The inactive Territory/Final Thirds labels share a single drawn container, so implement separate semantic click targets while preserving the combined segmented-control appearance. Switching these must change *both* visual map panels and associated measures, not just the active tab color.

### 08.2 Team indicators and map surfaces

- Home team colored circle `(1126,878,28,28)`, fill `#7ab6ff`; `Home team` x1166 y891 19px bold.
- Away team colored circle `(1480,878,28,28)`, fill `#e8d9a0`; `Away team` x1521 y891 19px bold.
- Home heat/map area `(1125,912,310,160)` fill `#1d5a2e`, white-green border 2px `#cfe3d8`; centered `No data` x1280 y992, 20px `#cfe3d8`.
- Away heat/map area `(1480,912,307,160)` matching style; centered `No data` x1633 y992.
- Home `Possession` x1122 y1096 19px, value `—` x1122 y1121, 25px bold `#33a8ff`; bar `(1213,1115,220,9)` with dark fill and 0% indicator.
- Away `Possession` x1477 y1096 19px, value `—` x1477 y1121, 25px bold white; bar `(1568,1115,220,9)` with 0% white child.
- **Source does not render actual heat data:** `HEAT()` helper defined but not invoked, both surfaces explicitly `No data`.

**Behavior:** on real data display calibrated heat/territory/thirds for home/away, filter by time and phase, show meaningful scales and provenance; never treat gradient backgrounds as observed movement. **Backend/DB:** possession periods, field-zone aggregates, spatial tracking/calibration.

## 09. Pressing Map

**Panel:** `(1830,810,702,340)` `.box`. `H(1830,844,'Pressing Map',true)` → accent `(1838,830,6,28)`, heading x1854 y844 25px bold with circular `i` info.

- **Selectors:** `(2107,824,190,38)` `Select team`; `(2322,824,192,38)` `All Phases`. Both have `.sel` arrow; functionality requires actual team/phase choices.
- **Pitch:** `(1846,879,441,256)` pitch gradient, boundary, midline, center circle/penalty boxes as defined by `PITCH()`.
- **Empty-state:** centered `Not measured` x2066 y915, 22px, mint `#e6f3ea` on dark translucent label.

### 09.1 Full legend

| Marker | Text label | Marker text x/y | Label text x/y | Color |
|---|---|---|---|---|
| `●` | Pressing Event | 2325/888 | 2359/888 | `#2b7bff` |
| `◆` | Recovery | 2325/916 | 2359/916 | `#19e6a0` |
| `▲` | Forced Turnover | 2325/945 | 2359/945 | `#ff3a3a` |
| `- - →` | Pressing Direction | 2315/980 | 2359/980 | foreground white |

Marker glyph size 18px; legend labels 19px `#cfdcf0`.

### 09.2 Four pressing metrics

All labels x2315 at size 18px `#cfdcf0`; each value `—` is right aligned programmatically near x2504 (`2514 - value.length*10`), 18px bold.

| Metric label | Center Y | Empty value |
|---|---:|---|
| PPDA | 1025 | `—` |
| High Press Success | 1056 | `—` |
| Final Third Regains | 1088 | `—` |
| Avg Press Height | 1119 | `—` |

**Behavior:** real location/time plotting for qualified pressing actions, live selector updates, show units and transparent metric definitions, no invented PPDA or pressure measurements. **Backend/DB:** events, possession sequences and calibrated pitch position.

## 10. Off-Ball Runs

**Panel:** `(432,1162,1008,258)` `.box`. `H(432,1193,'Off-Ball Runs',true)` → blue bar `(440,1179,6,28)`, heading x456 y1193 25px bold and info icon.

| Element | Position | Presentation / behavior |
|---|---|---|
| Player selector | `(658,1176,234,36)` | `.sel` `Select player`; only players of selected match |
| Time selector | `(917,1176,187,36)` | `.sel` `Time range`; linked to selected interval |
| Pitch | `(447,1230,460,177)` | actual pitch helper with white markings and gradient |
| Empty-state | centered x677 y1262 | `Not measured`, 20px mint `#e6f3ea` with dark pill |
| Metric group | `(1145,1230,278,177)` | `.box` border `#142f55` |

### 10.1 Complete legend

| Glyph | Label | Glyph x/Y | Label x/Y | Color |
|---|---|---|---|---|
| `- - -` | Off-ball run | 946/1265 | 994/1265 | `#19d3ff` |
| `- - →` | Leading run | 946/1294 | 994/1294 | `#ffb21a` |
| `- - -` | Supporting run | 946/1324 | 994/1324 | `#dbe8ff` |
| Outline circle | Run start | `(956,1350,16,16)` | 994/1357 | 3px white outline, radius 50% |
| Solid circle | Run end | `(956,1380,16,16)` | 994/1388 | solid white, radius 50% |

Labels are 19px `#cfdcf0`, glyph 18px. **No actual run paths are drawn**.

### 10.2 Four metrics

| Exact metric | Label x / centerY | Value coordinate | Initial value |
|---|---|---|---|
| Total Off-Ball Runs | 1163 / 1256 | x1398 | `—` |
| Progressive Runs | 1163 / 1296 | x1398 | `—` |
| Runs Into Box | 1163 / 1337 | x1398 | `—` |
| Avg Run Distance | 1163 / 1377 | x1398 | `—` |

Labels 19px `#cfdcf0`; values 19px bold. **Behavior:** player/time filter, measured run start-end and categories with threshold definitions, accurate distances if calibrated; no inferred physical quantity represented as verified. **Backend/DB:** time-indexed player tracks and derived run events with provenance.

## 11. Player Comparison

**Outer panel:** `(1462,1162,1070,258)` `.box`. Header `H(1462,1193,'Player Comparison',false)` → left accent x1470/y1179 6×28; heading x1486 y1193, 25px bold. No info-circle generated for this header.

### 11.1 Selection controls

- Role/position selector `(2074,1176,216,38)`: `Attacking Midfielder`, `.sel` (19px, dark fill, 1.5px border, radius 6, arrow). This is the **displayed preset label**, not proof any selected player actually plays that position.
- Interval selector `(2317,1176,197,38)`: `Last 30 Minutes`. Connect interval to the comparison scope; no fabricated 30-minute sample.
- The screenshot includes player A and player B **placeholders**; it does **not** include dedicated drawn player-pick dropdown controls. Provide a way to select the two real players in implementation without assuming source contained one.

### 11.2 Player A / Player B blocks

| Feature | Player A | Player B |
|---|---|---|
| Portrait placeholder | `(1489,1230,133,160)` gradient `#5a6f8c → #2a4a78` | `(2215,1230,127,160)` gradient `#6a5f5a → #3a2a28` |
| Side title | `Player A` x1638 y1244, 20px bold | `Player B` x2357 y1244, 20px bold |
| Name empty state | `No player selected` x1660 y1277, 17px `#cfdcf0` | `No player selected` x2378 y1277, 17px `#cfdcf0` |
| Position | `Position —` x1638 y1311, 19px | `Position —` x2357 y1311, 19px |
| Jersey/value badge | `(1638,1350,46,36)`, blue `#1580ff`, white 22px bold `—`, radius 4 | `(2358,1350,44,36)`, white fill with `#07152b` text, 22px bold `—`, radius 4 |

### 11.3 Six exact comparison rows

Source-generated three-part row: A value `—` x1846 at y (18px bold), label centered at x1996 (17px `#cfdcf0`) and B value `—` x2178 (18px bold), plus dark comparison indicator `(2105,y−5,42,10)` `#17304f`, radius 3.

| Comparison metric | Center Y | A initial | B initial |
|---|---:|---|---|
| Passes | 1238 | `—` | `—` |
| Pass Accuracy | 1270 | `—` | `—` |
| Progressive Passes | 1302 | `—` | `—` |
| Key Passes | 1334 | `—` | `—` |
| Off-Ball Runs | 1366 | `—` | `—` |
| Chances Created | 1397 | `—` | `—` |

**Behavior:** select two actual players and comparable time/role scopes, update real numbers, maintain unit/definition parity and provenance, support missing data rather than zeros. **Backend/DB:** matched players/team rosters and verified event/track aggregates for the same match/time context.

## 12. Exhaustive interaction and empty-state ledger

| UI family | Count in this HTML | Source drawing status | Implementation requirement |
|---|---:|---|---|
| Global navigation labels | 10 | text-only | Ten routes, active highlight and accessible links |
| Sidebar primary tabs | 4 | text-only (`View`, `Filters`, `Events`, `All Tools`) | Functional tab state and panels where supported |
| Top tactical feature tabs | 6 | outlines + labels | Functional navigation/focus between feature views |
| Sidebar overlay checkbox squares | 7 | seven empty drawn squares | Semantic, accessible checked/unchecked state; don't assume separate meaning from toggles |
| Sidebar overlay switches | 7 | seven blue ON drawings | Actual per-overlay effect and preference state |
| Team filter radio options | 3 | All Players selected | Mutually exclusive, real roster filtering |
| Time filter radio options | 4 | Full Match selected | Mutually exclusive, synchronized interval |
| Header context selectors | 3 | Live Match View / Select team / All Phases | Real options, dependent state |
| Formation selector | 1 | `—` | Context selection if supported |
| Video angle selector | 1 | Tactical Angle | Switch video source |
| Video speed selector | 1 | 1x | Playback rate |
| Pass network selectors | 2 | Select team / Time range | Filter pass network |
| Heat-zone mode choices | 3 | Heatmap active | Switch maps, not just appearance |
| Pressing selectors | 2 | Select team / All Phases | Filter press data |
| Off-ball selectors | 2 | Select player / Time range | Filter runs |
| Comparison selectors | 2 | Attacking Midfielder / Last 30 Minutes | Scope comparison |
| Video transport, seek and media controls | 9 drawn families | symbols/bar only | Play/seek/speed/volume/settings/fullscreen, clarify ambiguous first glyph |
| Tactical pitch surfaces | 4 | Formation, Pass, Pressing, Off-ball | Real calibrated overlays or empty state |
| Heat-zone surfaces | 2 | green `No data` areas | Real sourced heat data only |
| Team metric rows | 5 | `—`, 0%-fill bars | Actual metrics, units, provenance |
| Stability mini segments | 20 | all muted | Real formation-stability state |
| Stability/phase labels | 2 | Build-up / Defensive | Real classifications |
| Pressing metric rows | 4 | `—` | Actual measured values |
| Off-ball metric rows | 4 | `—` | Actual measured values |
| Comparison metric rows | 6 | both A/B `—` | Comparable, valid data |

**Important source-specific caveats:** (1) The source helper `PL()` does not place 11 players, despite the panel title; (2) helper `HEAT()` is unused; (3) all seven overlay switches visually ON while all adjacent checkbox squares appear empty; (4) no actual API calls or working callbacks occur; (5) fixed coordinates can create crowded labels at non-QHD widths because scaling preserves geometry rather than reflow; (6) some drawings are placeholders or undefined icons; (7) no specific endpoint URL, table name or real SQL schema is asserted by this file.

### Brief backend/DB source index (requirements, **not** claims of implementation)

| Visual section | Minimal source/data needed |
|---|---|
| Global header | Authenticated session and organization |
| Match context | Matches, teams, competition, video asset, analysis status |
| Filters and overlays | User preferences + time-indexed player/ball/team track artifacts |
| Tactical heading controls | Selected match, available teams, phase/time scopes |
| Formation and metrics | Calibrated spatial tracking, phase/formation summaries |
| Synced video | Authorized video asset and timeline synchronization |
| Pass network | Pass-event coordinates, participants, outcomes and time |
| Possession & zones | Possession intervals and spatial aggregates |
| Pressing | Pressure/recovery events, calibrated positions and metrics |
| Off-ball runs | Valid run events derived from player tracks |
| Comparison | Verified player linkage + comparable match/time analytics |

### Page-level acceptance checklist (for subsequent React work)

- [ ] Every visible component, text label, marker, legend, tooltip/info icon, color, border, gradient, radius and layout area matches the source at 2560×1440.
- [ ] Header displays all ten destinations in exact order and retains the Tactical active styling.
- [ ] Left Match section shows true match/team states; no fictional scores/players.
- [ ] Exactly **7** overlay names with matching checkbox-square and ON-switch visuals are accounted for; each effect has defined state and actual influence when data is present.
- [ ] Sidebar team and time filters expose all 3 and 4 options respectively; selected rows visually reproduce the drawing.
- [ ] Every visible selector is accessible and changes the intended scope, or presents an honest disabled/unavailable state when no options exist.
- [ ] Top six feature tabs navigate/activate correctly without breaking the combined layout.
- [ ] Formation pitch/metrics/stability correctly show `Not measured` and `—` without calibrated data.
- [ ] Playback controls act on a genuine video, with honest errors or no-video state.
- [ ] Pass legend includes all four thickness bands and the successful/unsuccessful distinction.
- [ ] Heatmap / Territory / Final Thirds are individually selectable; home and away map/possession surfaces remain correctly styled.
- [ ] Pressing panel includes four metric lines and four legend items.
- [ ] Off-Ball Runs includes all three run-type legends, start/end marker meanings and four KPIs.
- [ ] Player Comparison includes A/B portraits/badges and exactly six paired metric rows.
- [ ] No frontend data is falsely represented as measured or confirmed; provenance and rights remain enforced by real engine boundaries.
- [ ] No page scope or source-truth expansion is silently introduced beyond the supplied HTML.

**STATUS: PAGE 05 — FOR OWNER REVIEW; NOT LOCKED.** Proceed to Page 06 only after explicit owner authorization.
