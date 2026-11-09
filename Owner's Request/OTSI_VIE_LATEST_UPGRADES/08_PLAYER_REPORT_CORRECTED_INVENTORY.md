# OTSI VIE — PAGE 08: PLAYER REPORT
## Ultra-comprehensive, HTML-grounded frontend UI inventory

**Status:** DRAFT FOR OWNER REVIEW — NOT LOCKED  
**Source:** `08_PLAYER_REPORT.html`, as provided by owner for Page 08.  
**Scope:** Full frontend presentation, source-derived element coordinates, styling and shown state; every visible control and its expected purpose. **Backend/database:** brief source notes only.  
**Reading rule:** **SOURCE** means drawn by the supplied HTML; **REQUIRED** means intended application behavior to implement, **not** behavior already present in the HTML. All metrics are currently empty/unmeasured. **Do not invent player records, numerical metrics, scouting grades or confidence.**

## 0. Global rendering, geometry, styling and implementation evidence

| Property | Exact HTML specification |
|---|---|
| Design surface | `#s`, **2560 × 1440 CSS px**, absolute positioned; x grows rightward, y grows downward |
| Resize/fit | `fit()` uniform scale `min(innerWidth/2560, innerHeight/1440)`; adjusts canvas left/top to center in window; does not reflow columns |
| Root page | `html,body margin:0;height:100%;background:#000;overflow:hidden` |
| Page background | `#010812`; white foreground `#fff`; canvas clipped with `overflow:hidden` |
| Font | `"Segoe UI", "Helvetica Neue", Arial, sans-serif` |
| Positioning | `.a` absolute + `box-sizing:border-box`; `D(x,y,w,h)` draws CSS rectangle; `T(x,centerY,label,fontSize)` creates a vertically-centered text element |
| Text transforms | `.t` `translateY(-50%)`, `white-space:nowrap`, `line-height:1.1`; `.c` centers horizontal and vertical; `.r` aligns text right and vertically centered |
| Weight | `.b` = 700; `.sb` = 600; otherwise normal |
| Tokens | `.m #8ea3bf`; `.bl #1e90ff`; `.lb #33a8ff` |
| Standard panel | `.pn` gradient `#081a35 → #06122a`, **1.5px solid #12335f**, radius **14px** |
| Input-like rectangle | `.in` background `#041022`, **1.5px solid #17406f**, radius **8px** |
| Chip | `.ch` background `#0a2447`, **1.5px solid #1d4f8a**, radius **6px** |
| Illustrative SVG | Icons are hand-drawn approximations in 24×24 viewBox; stroke width 1.8, rounded ends/joins, specific size/color at each call |
| Decorative graphics | Profile portrait, crests, flags, KPI spark bars, player pitch/heatmap and scouting rings are **illustrations**, not verified player media or live measurements |
| Real functionality in supplied HTML | **None.** Script appends positioned `<div>`s/SVG icons and runs window resize fitting. No native inputs, buttons, anchors, click handlers, media pipeline, fetch/API requests, persistence or interactive report state |

**Geometry convention:** `D(x,y,w,h)` = exact top-left and dimensions; `T(x, y, fontSize)` = text x/vertical center, not text bounding box; `I(x,y,icon,size)` = SVG center and dimension. Values are measured from source calls, **not inferred DOM bounding boxes**. Preserve approved QHD visual styling while implementing accessible functional HTML/React equivalents.

## 1. Global navigation header — source y=0–100

### 1.1 Surface, branding and navigation specification
- **SOURCE:** Full bar `(0,0,2560,100)`, fill `#071a33`, bottom border **1.5px #1e90ff**.
- Logo typography: `OTSI` at **(30,38)**, **40px bold white**; `VIE` at **(130,38)**, **40px bold `#1e90ff`**.
- Subtitle `VIDEO INTELLIGENCE ENGINE` at **(31,73)**, **13px bold `#1e90ff`**.
- All ten navigation labels are at y-center **52px**, font **24px**, default **600 weight**.

| No. | Destination label | x coordinate | Page 08 visual state | REQUIRED |
|---:|---|---:|---|---|
| 1 | Home | 381 | Inactive | Route to Page 01 |
| 2 | Upload | 548 | Inactive | Route to Page 02 |
| 3 | Processing | 700 | Inactive | Route to Page 03 |
| 4 | Analysis | 889 | Inactive | Route to Page 04 |
| 5 | Tactical | 1067 | Inactive | Route to Page 05 |
| 6 | Reel Builder | 1215 | Inactive | Route to Page 06 |
| 7 | Clip Studio | 1396 | Inactive | Route to Page 07 |
| 8 | **Player Report** | **1555** | **Active, `#6cc4ff`, weight 700** | Current route, selected-state accessibility |
| 9 | Library | 1766 | Inactive | Route to Page 09 |
| 10 | Export | 1942 | Inactive | Route to Page 10 |

- Active tab background `(1546,12,169,78)`, fill **`#073154`**, border **1.5px `#1e6fb0`**, radius **12px**; bottom underline `(1555,92,150,5)` fill **`#1e90ff`**, radius **3px**.
- Horizontal space to right environment controls starts at x≈2117. The current HTML only draws labels/backgrounds; production nav targets need genuine interactive links and focus styling.
- **Backend/DB:** none for static labels; route access may depend on authenticated session and permissions.

### 1.2 Environment and account controls
- Vertical divider `(2117,20,2,62)` fill `#12335f`.
- `QHD` badge rectangle `(2140,23,100,54)`, fill `#071e37`, border **1.5px `#17406f`**, radius 8; label centered `(2190,50)` **20px bold `#33a8ff`**.
- Avatar `(2271,25,54,54)`, fill `#1e90ff`, 50% radius; letter `O` centered `(2298,52)` **22px bold white**.
- Account title `(2340,41)` `Owner`, **24px bold white**; subtitle `(2340,69)` `OTSI VIE`, **19px `#8ea3bf`**.
- **REQUIRED:** avatar and owner area use real session data, open account actions, do not assume literal `O` is a real personal name.
- **Backend/DB:** authenticated user, organization, account permissions.

## 2. Left Player Report navigation rail — x=22–370, y=115–1093

### 2.1 Container and heading
- Standard `P(22,115,348,978)` rounded/gradient panel (bottom = 1093). Page title `Player Report`, text center `(44,158)`, **28px bold**.
- Selected `Overview` card `(28,199,334,61)`, fill `#0a2b55`, border **2px `#1e90ff`**, radius **8px**.
- Eleven entries are drawn separately; labels all **24px**, x=109, icons at `(62, entryY)` generally 28px.

### 2.2 Exact sidebar menu inventory

| Order | Label | Center y | Icon / visual treatment | Initial state | REQUIRED action |
|---:|---|---:|---|---|---|
| 1 | **Overview** | 231 | 24×24 white outlined square at `(50,219)` with white `chk` 16px centered `(62,231)` | **Selected**; 600 text; highlighted row | Scroll/select top-level player overview, preserve identity context |
| 2 | Performance | 296 | `person`, 28px | Not selected | Show performance metrics and breakdown |
| 3 | Attacking Analysis | 362 | `ball`, 28px | Not selected | Open attacking analysis context |
| 4 | Passing Analysis | 428 | `arrows`, 28px | Not selected | Open passing data |
| 5 | Defensive Actions | 494 | `shield`, 28px | Not selected | Open defensive breakdown |
| 6 | Heatmaps | 561 | `grid`, 28px | Not selected | Focus heatmap section |
| 7 | Event Timeline | 627 | `ring`, 28px | Not selected | Focus timeline and event filters |
| 8 | Comparisons | 692 | `user`, 28px | Not selected | Focus comparison section |
| 9 | Scouting Report | 762 | `bag`, 28px | Not selected | Focus scouting report |
| 10 | Video Clips | 828 | `cam`, 28px | Not selected | Open player-linked video clips |
| 11 | Notes & Tags | 895 | `note`, 28px | Not selected | Open player-specific annotation editor |

- Inactive text `#d6e4f7`. Entries are **visual labels and icons, not functional anchors** in current HTML.
- The HTML does not draw separate expanded subpages/panels for every rail destination; do not claim those views exist. The intended React implementation needs corresponding navigation/tab/scroll behavior, with coherent state for selected section.
- **Backend/DB:** selected player identifier, video/events/statistics, scouting notes and saved tags, subject to permissions.

## 3. Player identity hero / profile / actions — x=387–2538, y=115–487

### 3.1 Main hero surface and portrait
- `P(387,115,2151,372)` with overriding gradient **`linear-gradient(90deg,#0a2a5a,#071a38 55%,#06122a)`**, clipped overflow, standard border/radius.
- Large portrait placeholder `(420,115,485,372)` painted using face and jersey radial gradients (`#e8b898`, `#c98c6a`, `#6fb8ee`, `#3a86c8`) and backdrop (`#10244a → #0a1a38`). **No actual image asset is loaded.**
- Player number badge `(929,197,78,61)` fill `#1e90ff`, radius 6; `—` at `(968,228)` **44px bold centered**.
- Main identity `No player selected` at `(1035,224)` **58px bold white**, oversized primary heading.
- Secondary `Position —` at `(1035,276)` **22px `#33a8ff`**.
- Three small empty chips: `(1166,265,56,28)`, `(1228,265,55,28)`, `(1290,265,57,28)`; `.ch` style; each centered `—` **17px `#9fc8f5`**.

### 3.2 Club, country and biodata
- Team crest placeholder circle `(935,308,60,58)`, CSS radial gradient `#f2c56b→#6cc4ff→#fff`, radius 50%; team text `Team —` at `(1015,338)` **24px**.
- Thin vertical separator `(1213,320,2,36)` fill `#2a4a75`.
- Nation/flag placeholder `(1241,318,58,39)` fill `#3a5a88`, radius 4; text `Nationality —` at `(1314,338)` **24px**.
- Four biodata columns, center positions and exact typography:

| Field | Center x | Label y / size | Value y / size | Source value |
|---|---:|---|---|---|
| Age | 963 | y399 / 18px `#b9cbe2` | y431 / 26px semibold | `—` |
| Height | 1082 | y399 / 18px | y431 / 26px semibold | `—` |
| Weight | 1242 | y399 / 18px | y431 / 26px semibold | `—` |
| Preferred Foot | 1410 | y399 / 18px | y431 / 26px semibold | `—` |

- Thin dividers at `(1017,390,2,56)`, `(1168,390,2,56)`, `(1320,390,2,56)`, fill `#2a4a75`.
- **REQUIRED:** bind identity and biodata to the correct confirmed player record, show `—` for unknowns; respect canonical ID and verification state, do not generate biographical facts.
- **Backend/DB:** canonical player/profile, roster/club association, nationality and analyst-approved personal attributes.

### 3.3 Player report actions — all four

| Action | Exact rectangle | Visual style / icon | Text | Intended operation |
|---|---|---|---|---|
| Add to Scouting Dossier | `(1725,130,297,50)` | blue `#0a84ff`, radius 8; `doc` icon `(1751,155)` 28px | `(1778,155)` 21px semibold | Attach current player and verified report to dossier; check authorization and duplicate membership |
| Export PDF | `(2040,130,198,50)` `.in` | `pdf` icon `(2078,155)` 28px | `(2110,155)` 21px semibold | Export actual report PDF with permissions/rights gates |
| Share Link | `(2256,130,196,50)` `.in` | `link` icon `(2292,155)` 28px | `(2330,155)` 21px semibold | Obtain authorized share link, avoid unauthorized player data exposure |
| More actions | `(2469,130,54,50)` `.in` | `dots` icon `(2496,155)` 28px | icon only | Open context-sensitive additional actions menu; no options defined in source |

- Text/icon positions above are exact. Source uses graphic rectangles only; none has an `onclick` or handler.
- **Backend/DB:** dossiers, report/export jobs, signed share permissions and audit metadata.

## 4. Tracking Confidence — x=1581–1946, y=196–476

- Outer panel `(1581,196,365,280)` translucent `rgba(4,16,34,.7)`, **1.5px `#12335f`** border, 12px radius.
- Label `Tracking Confidence` at `(1616,224)` **22px**; question/help SVG (`q`) at `(1825,224)` **26px `#8ea3bf`**.
- Progress circle `RING(1677,335,78,16,0)`: **156×156** origin `(1599,257)`, circumference based on radius `r-w/2 = 70`; background ring `#0a2a52`, **16px stroke**; **0 fill**, *not a measured 0% confidence claim*. Center `—` at `(1677,335)` **36px bold**.
- Verification status badge `(1767,280,122,35)` fill `#1a2840`, border **1.5px `#4a5a78`**, radius 6; circular muted dot `(1779,293,11,11)` `#8ea3bf`; `Unverified` text `(1798,298)`, **18px semibold `#dfe8f5`**.
- Empty-state copy: `No tracking data` at `(1749,395)` and `for this player yet` at `(1749,421)`, both **17px `#8ea3bf`**.
- **REQUIRED:** help describes actual identity/tracking confidence methodology; display verified/inferred/unknown states only from engine provenance and review; do not promote `Unverified` automatically.
- **Backend/DB:** player track association, identity evidence, confidence provenance and reviewer confirmation.

## 5. Player Role & Summary — x=1964–2538, y=196–476

- Outer panel `(1964,196,574,280)` fill `rgba(4,16,34,.7)`, 1.5px `#12335f` border, 12px radius.
- Heading `Player Role & Summary` at `(1987,223)`, **22px semibold**.
- `Edit` button `(2419,208,92,37)` `.in` radius 8; `edit` icon `(2445,227)` **20px**; `Edit` at `(2467,227)` **18px**.
- Empty role `Role not assessed` at `(1987,268)` **24px semibold**.
- Explanation `An analyst-approved role summary appears here.` at `(1990,303)` **20px `#b9cbe2`**.
- Trait empty state `No traits recorded` `(1988,401)` **17px `#8ea3bf`**. Trait chip rendering code exists but iterates `[]` so **no actual trait chips shown**.
- **REQUIRED:** Edit opens a role/summary editor for authorized analyst; preserve drafts, approved/unapproved state, and source attribution. No AI-generated assessment is automatically endorsed.
- **Backend/DB:** analyst-approved player profile, scouting role, trait records and review metadata.

## 6. Nine horizontally arranged KPI cards — y=505–637

- Source iterates exactly **NINE** metric definitions; preserve nine distinct card placements (not eight, not a generic arbitrary grid). Every card is drawn with `.pn` background gradient and **14px radius**, **1.5px `#12335f`** border; the first card also has **4px left `#1e90ff` border**. All heights **132px**, tops y=505.
- Per card, title `(x+40,531)` **21px `#d6e4f7`**; metric SVG `(x+60,586)` **44px `#1e90ff`**; primary value `(x+104,575)` **30px bold**, displayed `—`; secondary value `(x+104,609)` **19px `#b9cbe2`**, displayed `—`. Four tiny decorative spark bars are drawn at y~626, height 4, width 8, spaced 14px from starting x `x+w-62`, colored `#1e3a66`; **not actual trends**.

| No. | Exact metric label | Card x | Width | Icon | Value | Displayed secondary | Required real metric note |
|---:|---|---:|---:|---|---|---|---|
| 1 | Match Minutes | 388 | 247 | `clock` | `—` | `—` | Confirmed match minutes, include denominator/source |
| 2 | Distance (Est.) | 647 | 247 | `run` | `—` | `—` | Explicitly **estimated**; only if calibrated/validated |
| 3 | Top Speed | 907 | 238 | `dbl` | `—` | `—` | Verified physical estimate where supportable |
| 4 | Sprints | 1157 | 205 | `dbl` | `—` | `—` | Engine definition and thresholds, not fabricated |
| 5 | Passes | 1374 | 234 | `ball` | `—` | `—` | Actual tagged pass count |
| 6 | Key Passes | 1621 | 222 | `key` | `—` | `—` | Confirmed/inferred event definition |
| 7 | Shots | 1856 | 220 | `tgt` | `—` | `—` | Detected/verified shot events |
| 8 | xG | 2089 | 217 | `bars` | `—` | `—` | Model metric only if real trained model/evidence |
| 9 | xA | 2319 | 219 | `share` | `—` | `—` | Model metric only if real trained model/evidence |

- **SOURCE detail:** the source also contains a conditional positive-trend branch (`if(k[6])`) that would show an up arrow and `#3ee6a8` text, but **all nine `k[6]` are zero**, therefore no green trend arrow is visible on this supplied page.
- **REQUIRED:** live selected-player context, units, measured vs estimated origin and contextual periods. Don't substitute 0 for unknown or assign arbitrary positive deltas; each card should be accessible for metric detail if the product requirements support it.
- **Backend/DB:** actual analysis metrics, match minutes, linked detection/event models and verified provenance.

## 7. Heatmap panel — x=387–1081, y=657–1093

### 7.1 Panel title and visualization mode control
- Parent panel `P(387,657,694,436)`; short blue accent `(401,672,3,32)` fill `#1e90ff`.
- `Heatmap` heading `(421,687)` **25px bold**.
- Segmented mode wrapper `(543,672,334,34)` `.in`: background `#041022`, border `#17406f`, radius 8.
- Selected mode `Heatmap`: highlight `(543,672,117,34)` fill `#0a84ff`, radius 6; text at `(601,689)` **17px semibold centered**.
- Other modes `Touches` `(714,689)` and `Territory` `(822,689)`, **17px `#b9cbe2`**, unselected.
- Time selector `SEL(889,670,179,38,'Full Match')`: `.in` input-like surface; text x=905 center y=689, **17px**, dropdown chevron icon centered x=1048 y=689, 18px.
- **REQUIRED:** three mutually exclusive visualization modes; time range updates the selected player's rendered spatial data and empty state; no invented heatmap blobs.

### 7.2 Football pitch drawing and empty state
- `PITCH(410,720,652,344)` draws alternating vertical grass strips `#1d5c25` and `#236b2b` using repeating-gradient, then white/near-white `rgba(255,255,255,.85)` field lines (2px strokes).
- Pitch outer line at approximately `(429.56,737.2,612.88,309.6)` (3% horizontal/5% vertical inset), center line near x736, center circle diameter `0.28*344 = 96.32`; penalty/goal areas derived from helper. These are *CSS drawn pitch marks*, not tracking points.
- Empty label `No heatmap data` centered x736, y760, **20px `#e6f3ea`**, with dark translucent `rgba(7,20,42,.78)` background and 4px/12px padding, radius 6.
- No legend or heatmap datapoints are drawn for this empty state.
- **Backend/DB:** mapped player locations/touches/pitch calibration, analysis time windows.

## 8. Event Timeline (All Actions) — x=1096–1781, y=657–1093

- Panel `P(1096,657,685,436)`, blue title rule `(1111,670,3,34)`.
- Heading `Event Timeline (All Actions)` at `(1128,685)`, **22px semibold**.
- Event filter `SEL(1546,669,216,37,'All Events',16)`, `.in` styling, 16px text and chevron centered at x1742 y687.5.
- Empty-state message: `No events recorded for this player`, centered `(1438,880)`, **19px `#8ea3bf`**.
- Underlying dynamic event-row drawing is present, but iterates over `[]`: **zero events, zero visible event rows, zero event thumbnails and zero play buttons**. Do not claim they are present in current UI.
- **When real rows exist, intended arrangement defined in source:** per-row y `729 + i*38.5`; x1113 accent 3×34 (blue or green), timestamp at x1128 (18px), event icon at x1232 (26px), action label x1272 (19px), description x1394 (19px), thumbnail `(1626,y-17,84,34)`, clip-play control `(1714,y-17,42,34)`; row types map to `person`, `key`, `tri`, `burst`, `star` with blue/yellow/orange variants.
- **REQUIRED:** events filter by actual player ID/type/window; selecting event seeks to corresponding footage, thumbnail and clip link only when footage exists, handle unverified annotations honestly.
- **Backend/DB:** player-linked timestamped event records, clip/media references, event provenance.

## 9. Action Map — x=1797–2538, y=657–1093

### 9.1 Title, filter and football pitch
- Parent `P(1797,657,741,436)`; blue accent `(1813,670,3,34)`.
- Heading `(1835,687)` `Action Map`, **25px bold**.
- Event-type filter `SEL(2239,669,283,39,'All Actions')` `.in`, text x2255 center y688.5, dropdown at x2502 center y688.5.
- Pitch `PITCH(1815,716,706,329)` uses same grass and white lines as heatmap, fitted to wider area.
- Empty-state badge `Not measured` centered `(2168,760)` **20px `#e6f3ea`**, dark translucent bg, 4px 12px padding, radius 6. **Do not render fake point coordinates.**

### 9.2 Complete five-item action legend

| Legend | Visual geometry | Color | Text position / typography | Meaning |
|---|---|---|---|---|
| Pass | Circle `(1827,1060,20,20)` | `#1e90ff` | `(1865,1070)` 18px `#cfe0f5` | Pass action location |
| Key Pass | Circle `(1935,1060,20,20)` | `#f5b82e` | `(1971,1070)` 18px | Key pass location |
| Shot | Circle `(2068,1060,20,20)` | `#ff4a3a` | `(2105,1070)` 18px | Shot location |
| Goal | `star` SVG `(2194,1070)` 26px | `#3ee6a8` stroke/fill | `(2228,1070)` 18px | Goal location |
| Carry | Horizontal rule `(2295,1070,70,2)` | white `#fff` | `(2387,1070)` 18px | Player carry path |

- **REQUIRED:** filter maps to actual categorized actions, show tooltip/seek time where supported, respect pitch orientation and event confidence.
- **Backend/DB:** geolocated/tagged player actions, coordinate space, frame/time alignment.

## 10. Player Comparison panel — x=24–853, y=1108–1407

- Panel `P(24,1108,829,299)`, standard gradient and border.
- Heading `Comparison` `(45,1137)` **26px bold**.
- Group dropdown `SEL(463,1118,373,39,'Select comparison group')`: `.in`, text starts x479, chevron center x816, font 17px.
- Horizontal separator `(38,1166,800,1)` fill `#12335f`.
- Five comparative rows appear even with no real measurements:

| Row | Label | Center y | Main bar | Main value | Peer/reference bar | Peer value |
|---|---|---:|---|---|---|---|
| 1 | Progressive Passes (p90) | 1195 | `(276,1187,313,16)` | `—` at x606 | `(684,1187,89,16)` | `—` at x793 |
| 2 | Key Passes (p90) | 1229 | `(276,1221,313,16)` | `—` | `(684,1221,89,16)` | `—` |
| 3 | xA (p90) | 1263 | `(276,1255,313,16)` | `—` | `(684,1255,89,16)` | `—` |
| 4 | Shot Creating Actions (p90) | 1298 | `(276,1290,313,16)` | `—` | `(684,1290,89,16)` | `—` |
| 5 | Progressive Carries (p90) | 1332 | `(276,1324,313,16)` | `—` | `(684,1324,89,16)` | `—` |

- Metric labels at x50, **18px `#d6e4f7`**. Empty bars `#122b4d`, radius 3; selected-player numeric value at x606 **21px semibold `#33a8ff`**; peer x793 **19px `#cfe0f5`**.
- Key/legend: blue selected-player dot `(46,1363,24,24)`, text `(88,1377)` `Selected player` 16px `#cfe0f5`; muted comparison dot `(257,1365,24,24)` fill `#4d6482`, text `(300,1377)` `Midfielders Avg.` 16px.
- **SOURCE nuance:** default dropdown reads `Select comparison group`, yet legend names `Midfielders Avg.`. Treat legend as presentation label, **not proof a group was selected or data computed**.
- **REQUIRED:** comparison group selection, valid p90 denominators, matching cohorts and provenance, real bars proportional to measured values; empty state when unavailable.
- **Backend/DB:** player metric aggregates, group/cohort membership, model definitions and normalization.

## 11. Generated Insights — x=867–1780, y=1108–1407

- Outer `P(867,1108,913,299)` and blue title accent `(879,1124,3,30)`.
- Heading `Generated Insights` `(897,1136)`, **24px bold**.
- Small AI category badge `(1108,1124,117,30)` `.ch`; circle `(1121,1134,11,11)` fill `#33a8ff`; text `AI Analysis` `(1141,1139)`, **15px `#33a8ff`**.
- Exactly **four** source-drawn insight containers, each fill `#071a33`, border **1.5px `#12335f`**, radius 8, x=881, width 883:

| Order | x,y,w,h | Left icon | Heading / text | Extra copy | Status |
|---:|---|---|---|---|---|
| 1 | `(881,1163,883,61)` | `trend` SVG 38px centered `(924,1193.5)` `#3ee6a8` | `No insights yet`, 21px semibold x983 | `AI insights are generated after analysis` / `and require analyst review before display.`, 16px `#b9cbe2`, around x1264 | Empty state |
| 2 | `(881,1230,883,48)` | `pick` SVG 38px `(924,1254)` `#33a8ff` | `—` at x983 | None | Placeholder |
| 3 | `(881,1285,883,52)` | `tgt` SVG 38px `(924,1311)` `#8a6cff` | `—` | None | Placeholder |
| 4 | `(881,1344,883,53)` | `shld` SVG 38px `(924,1370.5)` `#f5b82e` | `—` | None | Placeholder |

- **REQUIRED:** show actual model-derived observations only when generated and reviewed; preserve detected/inferred/confirmed distinctions, allow verified details/action context where authorized; do not fill empty insight cards with scripted generic claims.
- **Backend/DB:** derived insight records, engine evidence links and analyst approval state.

## 12. Scouting Report — x=1797–2538, y=1108–1407

### 12.1 Header and full-report action
- Panel `P(1797,1108,741,299)`.
- `doc` icon centered `(1834,1140)` **34px stroke/fill `#3ee6a8`**; `Scouting Report` at `(1865,1140)`, **24px semibold**.
- `View Full Report` action `(2343,1120,181,39)`, fill `#0a84ff`, radius 6; text `(2362,1140)` **17px semibold**, forward-arrow icon `(2503,1140)` **16px**.
- **REQUIRED:** open actual scouting report (or truthful empty state), use current player context and access rights.

### 12.2 Overall Rating card
- Rating area `(1814,1167,226,230)`, fill `#06142a`, border **1.5px `#12335f`**, radius 10.
- `Overall Rating` at `(1847,1189)` **18px**.
- Circular meter `RING(1920,1275,72,13,0)` drawn at origin `(1848,1203)`, diameter **144px**: background ring `#0a2a52`, stroke 13px, **zero progress because no rating exists**, *not a measured rating of zero*.
- Center `—` at `(1920,1268)`, **42px bold centered**; suffix `/ 10` at `(1920,1305)` **16px muted centered**.
- **REQUIRED:** no numeric grade before approved scouting assessment, maintain assessor attribution and confidence.

### 12.3 Assessment / scout notes
- Upper assessment placeholder `(2051,1167,473,118)`, fill `#06142a`, border 1.5px `#12335f`, radius 10; empty text `No scouting assessment yet` centered `(2287,1226)`, **17px `#8ea3bf`**.
- Conditional checkmark/trait loop uses `[]`; **no assessment checklist entries actually visible**.
- Lower notes box `(2051,1293,473,104)`, same style; text `No scout notes recorded.` at `(2102,1307)`, **16px `#b9cbe2`**.
- Status footer `Awaiting verified scouting data` at `(2500,1373)`, **16px `#8ea3bf` italic**, right-aligned.
- **REQUIRED:** role-based editing and review; show actual assessments, author, notes, evidence and grade only if approved. Preview and output rights must be checked before exporting.
- **Backend/DB:** scouting assessment, authored notes, review state and report generation records.

## 13. Control and field register — all Page 08 affordances

The following register distinguishes genuinely available controls from purely drawn controls in this static HTML. **Every item requires real application wiring if it is meant to be interactive.**

| ID | UI element | Section | Drawn default | Intended behavior | Actual HTML |
|---|---|---|---|---|---|
| P08-G01–G10 | Ten top navigation tabs | Header | Player Report selected | Route between ten pages | Drawn only |
| P08-G11 | Owner/avatar menu | Header | `Owner` / `O` | Open authenticated menu | Drawn only |
| P08-S01–S11 | Eleven left sidebar section items | Sidebar | Overview active | Navigate/open each section | Drawn only |
| P08-H01 | Add to Scouting Dossier | Hero | Blue | Add selected player to dossier with rights | Drawn only |
| P08-H02 | Export PDF | Hero | Neutral | Generate/download authorized PDF | Drawn only |
| P08-H03 | Share Link | Hero | Neutral | Create authorized share link | Drawn only |
| P08-H04 | More `···` | Hero | Neutral | Open defined actions menu | Drawn only; menu options not specified |
| P08-H05 | Tracking Confidence help (?) | Confidence | Muted | Explain calculation/provenance | Drawn only |
| P08-H06 | Player Role Edit | Role summary | Neutral | Edit role and traits with permissions | Drawn only |
| P08-K01–K09 | Nine KPI cards | KPI strip | `—` | Show real measured/inferred values and sources | Decorative/read-only visuals |
| P08-M01 | Heatmap mode | Heatmap | Selected | Switch to density heatmap | Drawn only |
| P08-M02 | Touches mode | Heatmap | Not selected | Show touches plotted | Drawn only |
| P08-M03 | Territory mode | Heatmap | Not selected | Show territory plot | Drawn only |
| P08-M04 | Heatmap time range | Heatmap | `Full Match` | Select analysis window | Drawn only |
| P08-E01 | Event type filter | Event Timeline | `All Events` | Filter real events | Drawn only |
| P08-E02 | Event clip/play buttons | Event Timeline | **None present** | Play/seek specific event when exists | Defined in empty `[].forEach`, not visible |
| P08-A01 | Action type filter | Action Map | `All Actions` | Filter plotted actions | Drawn only |
| P08-C01 | Comparison group selector | Comparison | `Select comparison group` | Compare against real cohort | Drawn only |
| P08-I01 | Generated insight detail/action | Insights | No active action shown | Open evidence/review if built | No click handler |
| P08-R01 | View Full Report | Scouting | Blue | Open full scout report | Drawn only |

**Counts / safeguards:** 10 header nav labels; 11 sidebar entries; 4 hero actions; 9 KPI cards; 3 heatmap modes and 1 time picker; 1 event filter; 1 action filter; 1 comparison selector; 1 scouting action. **This Page 08 source does not depict any toggle switches, checkboxes (apart from the illustrated Overview square/check symbol), or editable native form inputs. Do not invent toggles merely to meet a generic feature count.**

## 14. Color, typography, spacing and decorative asset index

### 14.1 Palette from this exact HTML

| Usage | Color / exact value |
|---|---|
| Root black | `#000` |
| Page canvas | `#010812` |
| Header | `#071a33` |
| General white | `#fff` |
| Primary action blue | `#0a84ff` |
| Brand/nav blue | `#1e90ff` |
| Light blue | `#33a8ff` |
| Active nav label | `#6cc4ff` |
| Selected chip/tile bg | `#0a2b55` |
| Standard panel gradient | `#081a35 → #06122a` |
| Standard panel border | `#12335f` |
| Input fill / border | `#041022` / `#17406f` |
| Chip fill / border | `#0a2447` / `#1d4f8a` |
| Muted text | `#8ea3bf`, `#b9cbe2`, `#d6e4f7` |
| Grass | `#1d5c25` / `#236b2b` alternating |
| Pitch lines | `rgba(255,255,255,.85)` |
| Success/verified-looking accent | `#3ee6a8` — color is not proof of verified source |
| Action-map key pass | `#f5b82e` |
| Action-map shot | `#ff4a3a` |
| Comparison muted peer dot | `#4d6482` |
| Empty bars | `#122b4d`, decorative KPI `#1e3a66` |

### 14.2 Dimensions and placement map

| Major area | Outer bounding box `(x,y,w,h)` | Notes |
|---|---|---|
| Global header | `(0,0,2560,100)` | Entire screen width |
| Left navigation rail | `(22,115,348,978)` | Ends at y1093 |
| Hero | `(387,115,2151,372)` | Ends y487 |
| Confidence inset | `(1581,196,365,280)` | Inside hero |
| Role summary inset | `(1964,196,574,280)` | Inside hero |
| KPI row | y505–637; 9 cards | x388 through 2538 |
| Heatmap | `(387,657,694,436)` | Mid-left |
| Event Timeline | `(1096,657,685,436)` | Mid-centre |
| Action Map | `(1797,657,741,436)` | Mid-right |
| Comparison | `(24,1108,829,299)` | Bottom-left |
| Generated Insights | `(867,1108,913,299)` | Bottom-centre |
| Scouting Report | `(1797,1108,741,299)` | Bottom-right |

- Outer major vertical spacing: header y100 → main top y115 (**15px**); hero bottom y487 → KPI top y505 (**18px**); KPI bottom y637 → mid-panels top y657 (**20px**); mid-panels bottom y1093 → bottom-panels top y1108 (**15px**); bottom-panels end y1407, leaving **33px** to QHD canvas bottom.
- Main x gaps: rail right x370 → hero left x387 (**17px**); Heatmap right x1081 → Event Timeline left x1096 (**15px**); Event Timeline right x1781 → Action Map left x1797 (**16px**). Bottom cards x853→867 (**14px**), x1780→1797 (**17px**).
- Primary panel radius 14px; input radius 8px; chip radius 6px; hero inner cards radius 12px; selected overview row radius 8px; action buttons radius 6–8px. All coordinates refer to authored QHD CSS, not target responsive reflow.
- Font hierarchy: logo 40px; player identity 58px; sidebar 24px; section titles 22–28px; metrics 30px; summary value 42px; descriptive text 16–24px; smaller legend/placeholder 16–19px. `Segoe UI` fallback stack applies everywhere except no explicitly different font used.

## 15. Frontend states and accurate implementation boundary

### 15.1 Current exact authored state
- No selected player; no loaded portrait, roster record, measured stat, scouting score, heatmap, timed event or action location.
- All **nine KPI values display an em dash**; tracking ring and overall rating ring display `—`, not 0.
- `Overview` selected in left sidebar; `Heatmap` selected in its 3-mode segmented control; `Full Match` selected in time selector; `All Events` and `All Actions` selected in their respective filters.
- Three empty trait chips and multiple procedural graphics are generated through **empty-array loops**; only their surrounding labels/empty-state surfaces are visible.
- Comparison bars are completely unfilled placeholders, and no genuine comparison cohort data is shown.
- Four generated insight cards are depicted; only first has descriptive empty-state copy. No approved generated insight has been displayed.
- All UI action surfaces are inert in HTML source. No backend connected; none of the data is fetched.

### 15.2 Frontend implementation obligations (not claims of current functionality)
1. Preserve all authored panels, their dimensions and all nine KPI placements at 2560×1440.
2. Build keyboard/clickable controls corresponding to drawn action rectangles, section nav and selectors; mark read-only metrics as such.
3. Fetch/render a real selected player by canonical ID; no fictional identity or synthetic scouting performance.
4. Keep empty/unknown, not measured, unverified and analysis pending distinct from zero or denied states.
5. Bind each section to the real shared player/match/time window; updates must not leak values from a previously viewed player.
6. Attach correct permission checks to dossier, PDF, sharing and editing actions.
7. Render actual events, clips, pitch points, comparisons and approved insights only when the data source exists; otherwise retain exact designed empty states.
8. Preserve processing provenance and human-review state for any generated insight or tracking confidence display.
9. Test each sidebar link, hero action, section selector and scalable QHD layout against the HTML reference.
10. Maintain the original page composition while providing accessible labels, focus and error states for production interactions.

**Status: PAGE 08 DRAFT — Awaiting owner review and explicit lock. Do not proceed to Page 09 without approval.**
