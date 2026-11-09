# OTSI VIE — PAGE 09: LIBRARY / PROJECT CENTER
## Ultra-comprehensive frontend UI inventory — source-grounded, review edition

**Source examined:** `09_LIBRARY_PROJECT_CENTER.html` (143 source lines; visual-only reconstruction).  
**Reference viewport:** 2560 × 1440 px (QHD).  
**Scope:** exact drawn frontend composition, text, controls, visible initial states, intended interactions, and **brief** backend/MySQL source indications.  
**Review state:** **UNLOCKED / awaiting owner approval**.  
**Important:** Pixel coordinates refer to the original 2560×1440 design canvas; browser view scales the entire canvas uniformly. The HTML creates positioned `div`/SVG graphics, not native form elements or functioning application actions. Behavior listed as *required* is an implementation requirement, not functionality already present.

---

## 00. Design system, global geometry, and source semantics

### 00.1 Full-page canvas and scaling

| Property | Exact source value / behavior |
|---|---|
| Document title | `OTSI VIE - 09 Library / Project Center (visual only)` |
| HTML language | `en`; UTF-8 |
| `html,body` | margin `0`, height `100%`, background `#000`, overflow `hidden` |
| Main design surface | `#s`, position absolute, left/top initially `0`, width `2560px`, height `1440px` |
| Main surface background | `#000a14` |
| Main font stack | `"Segoe UI", "Helvetica Neue", Arial, sans-serif` |
| Main text color | `#fff` |
| Canvas overflow | `hidden` |
| Responsive behavior | `fit()` computes `min(innerWidth / 2560, innerHeight / 1440)` then applies `transform:scale(k)` and centers via `left`/`top`; a resize listener reruns it |
| Visual positioning | `.a` elements use absolute x/y/w/h; `box-sizing:border-box` |
| Text anchor | `.t` uses `transform:translateY(-50%)`, `white-space:nowrap`, `line-height:1.1` |
| Right-anchor | `.r`: `translate(-100%,-50%)` |
| Center-anchor | `.c`: `translate(-50%,-50%)` |
| Weight tokens | `.b`: 700; `.sb`: 600; other text normal |
| Accent text | `.bl`: `#1e90ff`; `.lb`: `#33a8ff` |
| Muted text | `.m`: `#8ea3bf` |
| Panel `.pn` | gradient `#081a35` → `#06122a`, `1.5px solid #12335f`, `14px` radius |
| Input-look `.in` | `#041022`, `1.5px solid #17406f`, `8px` radius |
| Chip `.ch` | `#0a2447`, `1.5px solid #1d4f8a`, `6px` radius |
| Standard blue | `#1e90ff`; bright action background `#0a84ff`; sky text `#33a8ff` |
| Other text colors used | `#cfe0f5`, `#d6e4f7`, `#e3eefb`, `#b9cbe2`, `#9fb3cc`, `#8ea3bf` |
| Standard divider | typically `1px` `#12335f` or `#10294a` |

**Source primitives:** `D(x,y,w,h,class,style,text)` draws a box; `T(x,y,text,fontSize,class,style)` draws a label centered vertically at y; `I(cx,cy,name,size,color)` draws an approximate SVG icon centered on the point; `P` draws a rounded panel; `TG` draws a visual toggle; `CREST`, `PH`, `TH`, `AV` draw decorative crests, portraits, video thumbnails, and letter avatars. Numeric x/y positions below come from these calls. Icon paths are simplified visual approximations; do not mistake them for provided licensed club/football imagery.

### 00.2 Required preservation rule

Preserve original panel footprint, positions, labels, state styling, hierarchy, and control affordances. Replacing visual placeholders with real media should retain geometry. An actual frontend must implement controls semantically (keyboard/focus/ARIA) without requiring a visual redesign. Never populate blank data from invented players, asset records, statuses, counts or analytics.

---

## 01. Global application header (`y=0–100`)

### 01.1 Header backing and branding

- Bar: `(0,0) 2560×100`, `background:#071a33`, bottom border `1.5px solid #1e90ff`.
- Wordmark text `OTSI`: anchor `(30,38)`, **40px**, bold, white.
- Wordmark text `VIE`: `(130,38)`, **40px**, bold, blue `#1e90ff`.
- Strapline `VIDEO INTELLIGENCE ENGINE`: `(31,73)`, **13px**, bold blue.
- Source displays text wordmark; no external raster/vector OTSI logo asset is loaded.

### 01.2 Ten exact navigation destinations

| Order | Text | Text x | Center y | Size | Initial appearance |
|---:|---|---:|---:|---:|---|
| 1 | Home | 381 | 52 | 24px | White, semibold |
| 2 | Upload | 548 | 52 | 24px | White, semibold |
| 3 | Processing | 700 | 52 | 24px | White, semibold |
| 4 | Analysis | 889 | 52 | 24px | White, semibold |
| 5 | Tactical | 1067 | 52 | 24px | White, semibold |
| 6 | Reel Builder | 1215 | 52 | 24px | White, semibold |
| 7 | Clip Studio | 1396 | 52 | 24px | White, semibold |
| 8 | Player Report | 1555 | 52 | 24px | White, semibold |
| 9 | **Library** | **1766** | **52** | **24px** | **Active; `#6cc4ff`, bold 700** |
| 10 | Export | 1942 | 52 | 24px | White, semibold |

- Library active backdrop: `(1720,12) 169×78`, background `#073154`, border `1.5px solid #1e6fb0`, `12px` radius.
- Active underline: `(1729,92) 150×5`, fill `#1e90ff`, `3px` radius.
- Navigation occupies a single horizontal line; maintain exact order and visible destinations.
- Intended behavior: click changes route, updates highlight and preserves signed-in application state. **Source behavior:** static text, no anchors or route calls.
- **Brief source:** frontend router; server permission/session checks.

### 01.3 Resolution and owner identity

- Separator: `(2117,20) 2×62`, `#12335f`.
- QHD pill: `(2140,23) 100×54`, background `#071e37`, `1.5px solid #17406f`, `8px` radius; centered `QHD` label anchor `(2190,50)`, **20px**, bold, `#33a8ff`.
- Circular user avatar: `(2271,25) 54×54`, `#1e90ff`, `50%` radius; centered `O` at `(2298,52)`, **22px**, bold white.
- Identity: `Owner` at `(2340,41)`, **24px**, bold; `OTSI VIE` at `(2340,69)`, **19px**, muted.
- Intended: owner/account menu using authenticated profile and organization; QHD display marker (not proof of actual video resolution). **Source:** visual-only.
- **Brief source:** authenticated account/session and organization profile.

---

## 02. Left sidebar: match, viewer controls and filters

### 02.1 Sidebar panel shell

- Main panel: `(20,121) 381×1294`, `.pn`: dark blue gradient, `1.5px #12335f`, `14px` corner radius.
- The sidebar and its controls are **not** a native form; each icon/label/toggle is an independent positioned visual element.

### 02.2 Match selector / context header

| Element | Source position | Exact label / appearance |
|---|---|---|
| Heading | text `(39,156)` | `Match`, 24px bold |
| More menu | SVG center `(325,156)`, 24px | Three-dot icon, `#cfe0f5` |
| Collapse/expand | SVG center `(366,156)`, 20px | Down chevron |
| Selected match name | `(39,201)` | `No match selected`, 22px bold |
| Match subtitle | `(39,234)` | `—`, 21px muted |
| Home crest placeholder | circle center `(66,299)`, diameter 48 | Decorative radial gradient `#f2c56b/#6cc4ff/#fff` |
| Home label | `(109,301)` | `Home team`, 24px |
| Home score | `(363,300)` | `—`, 32px semibold center |
| Away crest placeholder | center `(66,370)`, diameter 48 | Same placeholder gradient |
| Away label | `(109,370)` | `Away team`, 24px |
| Away score | `(363,370)` | `—`, 32px semibold center |

- Intended: match dropdown opens real match selection; menu exposes applicable actions; expand/collapse maintains panel behavior; team names, crests and scores come from selected record or remain absent.
- **Brief source:** matches/teams/competition; permitted match-selection state.

### 02.3 Match-data status card

- Bounds `(35,421) 352×96`, background `#052a28`, border `1.5px solid #14705a`, radius `10px`.
- Shield icon at `(70,455)`, size 38, stroke `#8ea3bf` with helper fill `#2a4a78`.
- `No analysis available` anchor `(106,447)`, 22px semibold `#cfe0f5`.
- Supporting lines: `Tracking data, events and models` at `(106,474)` and `appear after processing completes.` at `(106,494)`; both 16px `#b9cbe2`.
- Intended: job-aware status; remains truthful if processing has not completed.
- **Brief source:** analysis/processing job readiness for selected match.

### 02.4 Sidebar mode tabs

- Text baseline centers y=563: `View` x=33 (**active**, semibold, `#33a8ff`); `Filters` x=108; `Events` x=197; `AI Tools` x=290 (inactive 21px `#cfe0f5`).
- Divider `(21,594) 380×1`, `#12335f`; active underline `(21,592) 67×3`, `#1e90ff`.
- Intended: switch sidebar subpanels, preserve filter state, expose relevant content; **only View content is present in this HTML**. Do not invent the exact contents of other tabs without an approved reference.
- **Brief source:** local UI state, with available filter/event metadata from selected match.

### 02.5 Visual Overlays — seven complete switch records

- Section label `Visual Overlays` anchor `(37,630)`, **20px**, semibold.
- Each row: icon centered x=50, **28px**; label anchor x=83, **21px** `#d6e4f7`; toggle origin x=336, center y below.
- `TG` appearance: track **48×26** at `(336, y−14)`, radius `13px`. ON fill `#0481f9`; OFF fill `#26364d`. Knob **21×21** white, top `y−11`, left `x+24` if ON / `x+3` if OFF.

| # | Icon key | Switch label | Row y | Drawn initial state | Intended feature |
|---:|---|---|---:|---|---|
| 1 | `box` | Player Boxes | 674 | **ON** | Show/hide tracked player bounding boxes |
| 2 | `ids` | Player IDs | 715 | **ON** | Show/hide verified/qualified identity labels |
| 3 | `trk` | Player Tracks | 756 | **ON** | Show/hide movement paths |
| 4 | `shp` | Team Shapes | 797 | **OFF** | Show/hide team formations/shape layer |
| 5 | `trk` | Heatmaps | 838 | **OFF** | Show/hide available heatmap overlay |
| 6 | `ball` | Ball Tracking | 879 | **ON** | Show/hide ball track |
| 7 | `pass` | Pass Arrows | 921 | **OFF** | Show/hide detected/inferred pass arrows with provenance |

- These are **seven individually styled switches**, not merely seven text labels. All controls require real keyboard/click state, accessible labels, and actual effects on the applicable viewer. Keep unavailable overlays visibly unavailable rather than fabricating tracking.
- **Source behavior:** `TG()` draws fixed-position DIVs only, no click handler or persistence.
- **Brief source:** per-user/per-project viewer preferences + real analysis overlay availability.

### 02.6 Team Filter — three exclusive choices

- Label `Team Filter` at `(37,980)`, 20px semibold.
- Active `All Players` row box `(34,1004) 353×42`, `#0a2b55`, `1.5px solid #1e90ff`, radius 8px.
- Selected marker `(43,1015) 22×22` blue `#1e90ff`, 50% radius; check glyph SVG `(54,1026)`, 14px.
- `All Players` at `(84,1025)`, 21px. Count chip `(337,1010) 43×30`, class `.ch`; count text `—` centered `(358,1026)`, 19px.
- `Home team`: icon `xc` at `(52,1071)`, 26px muted, text `(84,1071)`, 21px; count chip `(337,1056) 43×30` `.in`, text dash `(358,1071)`.
- `Away team`: icon `xc` at `(52,1114)`, text `(84,1114)`; count chip `(337,1099) 43×30`, text dash `(358,1114)`.
- Initial choice is **All Players**; other two are unselected. These appear as radio-like choices, not checkboxes.
- Intended: mutually exclusive filtering of player-associated assets/overlays, with real team counts if available.
- **Brief source:** match roster, tracked players, team associations; local filter state.

### 02.7 Time Range — four exclusive choices

- Section heading `(37,1170)`, 20px semibold.
- Selected `Full Match`: outer `(34,1194) 353×46`, blue background `#0a2b55`, border `1.5px #1e90ff`, radius 8px; blue marker `(45,1207) 22×22` with check glyph `(56,1218)`; label `(86,1218)`, 21px.
- Unselected options: `1st Half` y=1261; `2nd Half` y=1302; `Custom Range` y=1343, text x=86, 21px `#d6e4f7`; outline circle icons centered `(56,y)`, size 24px `#8ea3bf`.
- Intended: exclusive time-selection filters; Custom Range should expose precise start/end selectors without changing default layout until activated.
- **Brief source:** selected match period/time metadata, local filter state.

---

## 03. Main workspace title and primary project action

### 03.1 Title block

- Page heading `Library / Project Center`: anchor `(448,149)`, **46px**, bold, white.
- Explanatory line `(449,193)`, **22px**, `#9fb3cc`:
  `Manage your reels, reports, matches, exports and folders. Organise, search and collaborate across all your video intelligence assets.`
- Preserve exact spelling `Organise` from the HTML.

### 03.2 New Project button

- Background `(1714,132) 256×63`, fill `#0a84ff`, radius `8px`.
- Plus SVG at `(1755,164)`, 26px white; `New Project` at `(1786,164)`, 24px semibold; chevron SVG at `(1941,164)`, 22px.
- Visual affordance indicates a button with dropdown/split action, but the HTML does not define menu choices; do not invent their approved wording.
- Intended: create a real project with validation and persistence, and expose supported create choices where defined.
- **Brief source:** project records, ownership/permissions.

---

## 04. Asset type tabs — eight individual destinations

- Active tab backdrop `(425,240) 221×60`, background `#0a2b55`, bottom border `3px solid #1e90ff`, top radii `8px`.
- Tab baseline centers y=268. Inactive labels `#cfe0f5`; active `All Assets` `#33a8ff`, 22px semibold.
- All tab icons are **28px** with named SVG icon keys. Counts use `.ch` chips of height 30px; initial values are `0` except `Shared With Me`, which shows **no count** in this HTML.

| # | Tab label | Icon key | Icon x | Text x | Count chip (x×width) | Initial displayed count | Selected? |
|---:|---|---|---:|---:|---|---|---|
| 1 | All Assets | `grid` | 454 | 482 | 590×42 | `0` | **Yes** |
| 2 | Reels | `grid` | 687 | 714 | 770×32 | `0` | No |
| 3 | Reports | `doc` | 852 | 881 | 960×34 | `0` | No |
| 4 | Matches | `ball` | 1048 | 1079 | 1170×36 | `0` | No |
| 5 | Folders | `fold` | 1247 | 1278 | 1364×34 | `0` | No |
| 6 | Exports | `dl` | 1441 | 1467 | 1548×34 | `0` | No |
| 7 | Shared With Me | `user` | 1617 | 1645 | none | none | No |
| 8 | Templates | `tmpl` | 1821 | 1847 | 1948×24 | `0` | No |

- Tab strip divider `(425,303) 1547×1`, fill `#12335f`.
- Intended: filter actual library asset types and permission-scoped shared items; badges reflect query totals, not hardcoded zero in populated state.
- **Brief source:** assets/projects/reels/reports/matches/folders/exports/templates, share ACLs.

---

## 05. Search, structured filters and saved searches

### 05.1 Global library search

- Search field-look `(425,326) 443×62`, `.in` (#041022, #17406f 1.5px, 8px radius).
- Magnifying glass SVG center `(458,356)`, 28px.
- Placeholder `Search projects, players, tags, or content…` anchor `(487,356)`, 20px muted. Note Unicode ellipsis.
- Intended: real text entry, debounce, keyboard submit/reset, matching against authorized indexed records, no invented hits.
- **Brief source:** library/asset metadata search index and permitted related player tags.

### 05.2 Five filter dropdowns, all present simultaneously

All are input-look boxes anchored at y=322, **height 70px**, text labels at `top+22`, **17px** muted; current value text at `top+48`, ~19–20px `#e3eefb`; down-chevron center at `x+width−22`, y=357, size 18.

| # | Field label | Displayed initial option | x | Width | Value typography |
|---:|---|---|---:|---:|---|
| 1 | Type | All Types | 883 | 142 | 20px |
| 2 | Competition | All Competitions | 1036 | 201 | 19px |
| 3 | Team | All Teams | 1249 | 202 | 20px |
| 4 | Created By | Any User | 1462 | 176 | 20px |
| 5 | Date Range | Last 3 Months | 1649 | 214 | 20px |

- Exact source label/value x= `field x + 20`; filter labels centered around y=344 and values around y=370.
- Intended: five individually operable, combined filters. Date range defaults visually to **Last 3 Months** (not Full Match). Selections must affect table and category counts consistently.
- **Brief source:** distinct asset fields, linked competitions/teams, owner directory, timestamps.

### 05.3 Clear Filters

- Blue text action `Clear Filters` at `(1885,356)`, **20px**, class `.lb` (`#33a8ff`).
- Intended: reset search plus selected filter values according to product rules and refresh actual results; do not silently erase saved searches.
- **Brief source:** local filter/query state (no database write required for temporary resets).

### 05.4 Saved Searches

- Label `Saved Searches:` `(431,436)`, **19px**, `#cfe0f5`.
- Empty-state text `No saved searches yet` at `(578,438)`, 19px muted `#8ea3bf`.
- `Save Current Search` button `(1658,417) 228×42`, background `#08203f`, border `1.5px solid #17406f`, radius `8px`; plus icon `(1684,438)` 22px blue; text `(1708,438)` 19px blue.
- Intended: save the currently composed search/filter expression under authenticated user, make saved searches selectable/removable when present. Source HTML shows **no saved-search chips**.
- **Brief source:** user-specific saved filter/search preferences.

---

## 06. Asset table: header, ten-slot layout and empty state

### 06.1 Table outer container and column headings

- Table shell `(425,481) 1558×946`, translucent background `rgba(5,16,34,.7)`, border `1.5px solid #12335f`, radius `12px`.
- Select-all **empty square checkbox** `(447,500) 26×26`, outline `2px solid #cfe0f5`, radius `5px`; no native `input` or click handler.

| Column | Heading exact text | Anchor x | Center y | Font |
|---|---|---:|---:|---|
| 1 | Thumbnail / Title | 503 | 514 | 19px, `#cfe0f5` |
| 2 | Type | 1023 | 512 | 19px, `#cfe0f5` |
| 3 | Players Featured | 1157 | 513 | 19px, `#cfe0f5` |
| 4 | Collaborators | 1352 | 513 | 19px, `#cfe0f5` |
| 5 | Updated | 1573 | 514 | 19px, `#cfe0f5` |
| 6 | Status | 1758 | 514 | 19px, `#cfe0f5` |
| 7 | Unlabeled action area | about 1946 | row-specific | Three-dot action, when real rows exist |

- Sort icon (up/down arrows): center `(1662,514)`, 22px `#33a8ff`, adjacent to Updated.
- Intended: accessible semantic table, multi-select, sorting, per-row select/open actions and contextual menus, populated only from permitted actual assets.
- **Brief source:** asset listing/query, asset relationships and access status.

### 06.2 Source's actual default table state (critical)

- Source defines `var R=[]` **empty**, so **no populated asset rows, checkboxes, thumbnails, player faces, collaboration chips or status pills are rendered**.
- Empty-state text is drawn at `(1204,587)` center: `No assets yet — new projects, reels, reports and exports will appear here`, **20px**, muted `#8ea3bf`.
- Nine decorative horizontal dividers **are** drawn: at y `632`, `723`, `812`, `902`, `991`, `1081`, `1170`, `1256`, `1343`; each originates x=427, width 1554, height 1, color `#10294a`.
- A proposed ten-item row Y array exists: `[587,678,767,857,946,1036,1125,1211,1298,1385]`; **these are not ten currently visible records**.
- The row renderer would draw a selected-row background `(425,543) 1558×91`, blue-border selection, per-row checkbox, thumbnail, timestamp badges, title/subtitle, type chip, featured-player avatars, collaborator avatars/count, update date and status chip, and three-dot menu. It does not run for any row with `R=[]`.
- The renderer's asset types are **Reel, Report, Folder, Match, Export**, with distinct chip colors; predefined status looks are **Published, Draft, Shared, Exported**. These colors and constructs are **latent code styles**, not active content on the empty screen.
- Do not report `10 assets` or list imaginary row names; the rendered default content is **zero assets**.

### 06.3 Latent asset-row styling for future implementation

| Row subelement | Source geometry or style when a row exists |
|---|---|
| Row check area | `(448,y−12) 26×26`; selected row blue fill, unchecked rows outline |
| Preview thumbnail | `(504,y−32) 143×64`, blue/green gradient with `2px solid #2a5a98`, radius 4px |
| Duration/overlay badge | `(588,y+10) 56×22`, translucent dark; text centered at x=612, y+21 |
| Asset name | anchor `(668,y−14)`, **22px** bold |
| Secondary asset text | `(668,y+19)`, 19px muted `#9fb3cc` |
| Type chip | x=1016, y−20; width 75 for Reel, 91 otherwise, height 40, 6px radius |
| Player thumbnail | portrait placeholders center x=`1176+55j`, y, diameter 52 |
| Collaborator avatars | center x=`1372+45j`, y, diameter 48 |
| Updated date/time | x=1575, lines y−9/y+19, 19px muted |
| Status pill | `(1756,y−20) 136×40`, 6px radius, colored dot and text |
| More menu icon | `(1946,y)`, 26px |

- Latent type color schemes: Reel `#0a2f5a/#1d6fc0/#cfe8ff`; Report `#2a0f70/#6a3ff0/#d6c8ff`; Folder `#4a3000/#f5b82e/#ffd36a`; Match `#06402a/#1fc27a/#9ff0c8`; Export `#0a1d38/#4a6a98/#e3eefb` (background/border/text).
- Latent status color schemes: Published `#063a2a/#1a8a5e/#3ee6a8`; Draft `#1a2840/#4a5a78/#dfe8f5`; Shared `#2a0f60/#6a3ff0/#e0d0ff`; Exported `#06305a/#1e6fc0/#cfe8ff`.
- Preserve this component design for **actual records** without pretending they are in the empty-state screenshot.
- **Brief source:** asset metadata, related players/collaborators, life-cycle status, timestamps.

---

## 07. Right column: Selected Item inspector

### 07.1 Inspector panel and header

- Outer shell `(2003,121) 537×1299`, `.pn` panel gradient and 14px corners.
- `Selected Item` anchor `(2027,156)`, **25px** semibold `#33a8ff`.
- Close icon `x` center `(2505,157)`, size **24px**; should clear selection and/or collapse inspector without deleting data.
- Divider `(2003,185) 537×1`, color `#12335f`.

### 07.2 Empty media preview and edit controls

- Preview background `(2025,208) 493×260`, `8px` radius, multi-layer radial gradients over `linear-gradient(135deg,#27487a,#0e2040)`; **decorative approximation, not a real selected asset image**.
- Playback circle `(2232,307) 72×72`, translucent dark, 50% radius; white play triangle `(2258,328) 26×32`.
- Duration badge `(2432,423) 74×32`, translucent dark, 6px radius; `—` at `(2469,439)`, 22px semibold center.
- Selected title `(2025,503)`: `No asset selected`, **26px** bold.
- `Edit` button-look `(2406,484) 111×42`, `.in`; edit-pencil SVG `(2432,505)` 22px; `Edit` text `(2476,505)` 19px.
- Latent badge/chip renderer uses an empty array, so **no asset tags/status chips appear below title**.
- Guidance `(2027,599)`: `Select an asset in the table to see its details.`, **22px**, `#d6e4f7`.
- Intended: selection binds preview, name and supported editable metadata; play must use an actual playable authorized clip, otherwise disabled/empty; edit opens appropriate real editor; buttons should be unavailable or clearly state no selection when empty.
- **Brief source:** selected asset record, thumbnail/preview rights, metadata/edit permissions.

### 07.3 All nine inspector metadata fields

- Each row icon center x=2040, size 26, color `#cfe0f5`; label text x=2073, size 20, `#cfe0f5`; value text x=2244, size 20, `#e3eefb`.

| # | Icon key | Exact field label | y | Initial value | Intended source |
|---:|---|---|---:|---|---|
| 1 | `ball` | Competition | 688 | `—` | Asset-linked competition |
| 2 | `cal` | Match | 736 | `—` | Asset-linked match |
| 3 | `user` | Players Featured | 786 | `—` | Asset/player relation |
| 4 | `cir` | Created By | 832 | `—` | Creator account |
| 5 | `clock` | Curated | 873 | `—` | Curation metadata |
| 6 | `clock` | Duration | 913 | `—` | Media duration |
| 7 | `img` | File Size | 952 | `—` | Storage object size |
| 8 | `img` | Resolution | 988 | `—` | Media dimensions |
| 9 | `tag` | Tags | 1031 | `—` | Asset tag relationships |

- Source has latent tag-chip loop `[].forEach(...)`; no selected asset tags are present.
- Values **must remain absent** until there is an actual selected asset. Different asset types may have appropriately empty or inapplicable fields.
- **Brief source:** asset metadata and linked records in existing backend/DB.

### 07.4 Download split action

- Main button `(2025,1075) 494×58`, solid `#0a84ff`, radius `8px`.
- Subtle divider `(2467,1085) 1.5×38`, `#4fa8ff`.
- Download SVG at `(2194,1104)` size 28; text `Download` anchor `(2231,1104)`, **24px** semibold; dropdown chevron `(2494,1104)`, size 22.
- Intended: request real file through authorized download service, choose only supported formats/options, enforce export/asset rights. In empty state disable/communicate that no asset is selected.
- **Brief source:** asset storage, authorization and signed download endpoint.

### 07.5 Four secondary item actions

| # | Label | x,y | Width×height | Source visual styling | Icon center | Text center/anchor | Intended behavior |
|---:|---|---|---|---|---|---|---|
| 1 | Share | 2025,1145 | 240×52 | `.in`: dark input-look | `(2115,1171)` | `(2144,1171)` | Open real sharing/access controls |
| 2 | Duplicate | 2279,1145 | 240×52 | `.in` | `(2369,1171)` | `(2398,1171)` | Create permitted copy with new ID |
| 3 | Send to Client | 2025,1208 | 240×52 | `.in` | `(2073,1234)` | `(2107,1234)` | Open authorized client delivery flow |
| 4 | Open in Analysis | 2279,1208 | 240×52 | Custom blue dark `#08294d`, `1.5px #1e6fc0`, 8px radius | `(2319,1234)` | `(2351,1234)` | Navigate with selected real match/asset context |

- All button text ~21px semibold; fourth action blue `#33a8ff`; normal text white.
- These are drawn `div` groups. **None is an implemented event handler in this HTML.**
- **Brief source:** asset permissions and service operations (sharing, copies, delivery, cross-page selection).

### 07.6 Collaborators and Manage Access

- Horizontal divider `(2003,1281) 537×1`, `#12335f`.
- Heading `Collaborators`: `(2029,1311)`, **22px** semibold.
- Count chip `(2178,1297) 36×30`, `.ch`; centered `0` at `(2196,1312)`, 17px.
- `Manage Access` text action `(2510,1310)` with **18px** blue, right-anchored by a `translate(-100%,-50%)` override.
- Empty-state text `No collaborators yet`: `(2029,1369)`, 18px muted.
- Intended: collaborator list, invitations, role/grant management and access revocations, with owner permissions. The zero is empty-state display only.
- **Brief source:** asset/project membership, invitations, roles and ACLs.

---

## 08. Control-by-control implementation register

This is a **wiring checklist**, not a claim of implemented handlers in the HTML. Each control requires visible active/disabled/focus state, correct user action and truthful data behavior.

| Group | Every control/choice to implement | Initial appearance | Expected frontend effect | Brief service source |
|---|---|---|---|---|
| Header | 10 navigation destinations | Library active | Navigate and switch active pill | Router/session |
| Header | Owner avatar/account | O / Owner / OTSI VIE | Profile/menu | Auth/session |
| Match | More dots; collapse chevron; match selection | No match | Menu, expand/collapse, selection | Match records |
| Left tabs | View, Filters, Events, AI Tools | View active | Switch content | Local state/analysis metadata |
| Overlays | **7 individual switches** | ON,ON,ON,OFF,OFF,ON,OFF | Toggle actual overlay layers | Viewer state/analysis output |
| Team Filter | All Players, Home team, Away team | All Players | Filter relevant content | Team roster |
| Time Range | Full Match, 1st Half, 2nd Half, Custom Range | Full Match | Change time interval | Match periods |
| Project | New Project main button + chevron | Blue | Create / show permitted actions | Projects API |
| Asset tabs | **8 categories** | All Assets active | Filter list / refresh counts | Assets API |
| Search | Main search field | Placeholder | Search authorized records | Search endpoint |
| Filters | Type, Competition, Team, Created By, Date Range | All Types / All Competitions / All Teams / Any User / Last 3 Months | Combine criteria | Assets metadata |
| Filters | Clear Filters | Blue text | Reset active query | Local state |
| Saved searches | Save Current Search | Enabled-looking | Persist search definition | User preferences |
| Table | Select-all checkbox | Unchecked | Multi-select actual rows | Local selection |
| Table | Updated sort icon | Visible | Toggle sorting | Query order |
| Table | Row checkbox and row select (when rows exist) | No rows rendered | Bind selected asset | Asset list |
| Table | Row three-dot menu (when rows exist) | No rows rendered | Contextual actions | Asset permissions |
| Inspector | Close X | Visible | Deselect/close | Local state |
| Inspector | Preview play | Placeholder | Play selected authorized media | Media streaming |
| Inspector | Edit | Visible | Edit permitted selected asset | Assets API |
| Inspector | Download main + chevron | Visible | Download/format menu | Export/storage |
| Inspector | Share | Visible | Access/share flow | Sharing API |
| Inspector | Duplicate | Visible | Duplicate asset | Asset create API |
| Inspector | Send to Client | Visible | Delivery workflow | Delivery API |
| Inspector | Open in Analysis | Visible | Navigate with context | Router/analysis |
| Collaborators | Manage Access | Blue link | Membership/access editor | Permissions API |

**Important count discipline:** the **seven overlays are seven switches**, the **three team filters and four time ranges are selection options** rather than independent toggles, and table row checkboxes are **latent** until real records exist. The asset list contains eight tabs, not a fabricated list of ten assets.

---

## 09. Frontend acceptance checks for Page 09

### 09.1 Visual fidelity

- [ ] Exactly 2560×1440 reference composition; uniformly scaled and centered on other viewport sizes, without changing its intrinsic QHD coordinate arrangement.
- [ ] Header height, active Library highlight, all ten nav labels, owner block and QHD badge match source.
- [ ] Main columns occupy left x=20–401, center x≈425–1983, right x=2003–2540 with their measured margins and gutters.
- [ ] Left panel uses original navy gradient, match status, tabs, seven switches, team/time filters and accurately styled selected states.
- [ ] Main heading, New Project control, eight asset tabs, five filters, Clear Filters and saved-search controls match source coordinates.
- [ ] Asset table has all seven header/action columns and correct empty state; do not show sample names/records.
- [ ] Right inspector includes all nine metadata fields, action buttons and collaborators block, with placeholders when nothing is selected.
- [ ] Font family, sizes, weights, border thicknesses, radii, muted colors, accents, control dimensions and spacing match explicit source values.

### 09.2 Functional acceptance in actual React app (NOT present in source HTML)

- [ ] Every navigation item and control is keyboard-accessible, receives focus and gives visible, relevant feedback.
- [ ] Each of the **seven** overlays can be toggled individually; actual overlay display reflects true data availability.
- [ ] Team/time selections update local viewer/list context; Custom Range yields usable date/time interval controls.
- [ ] All eight asset tabs use real scoped records; badges reflect true counts.
- [ ] Search and all five filters combine correctly; Clear Filters clears the appropriate state; saved searches persist per user.
- [ ] The table supports sorting and selection; select-all selects only loaded/authorized rows; row context menus act on real records.
- [ ] Selection updates the preview, all **nine** inspector values, collaboration panel and relevant available actions; deselection returns honest empty states.
- [ ] Download, Share, Duplicate, Send to Client, Open in Analysis, Manage Access and Edit perform real authorized actions or honestly explain an unavailable capability.
- [ ] Sharing/export and player-identity rights are checked server-side; no client-only authorization shortcuts.
- [ ] No fabricated player, collaborator, file, project, analysis or KPI data; no dummy success notifications.
- [ ] No source HTML static controls are falsely reported as wired without functional tests.

---

## 10. Short backend / database source map (reference only)

| Frontend region | Brief real source |
|---|---|
| Header/profile | Existing authentication and organization/session records |
| Match context/teams | Match, competition, team and roster records |
| Analysis readiness and overlays | Existing video processing / detections / tracking outputs and viewing preferences |
| Library tabs/table | Real asset/project/reel/report/match/folder/export/template metadata |
| Search/filter/saved search | Searchable asset index, metadata relationships and per-user saved search state |
| Selected Item inspector | Selected asset metadata, file/media properties and related players/matches |
| Download/share/send/duplicate | Existing authorized storage, export, collaboration and delivery services |
| Collaborators | Access grants, memberships, roles and invitations |

**No new MySQL schema is asserted as existing from this HTML.** These are source categories for the implementation team; actual endpoint names, database tables and migrations must be verified in the existing engine.

---

## 11. Source-specific integrity notes

1. `R=[]` is definitive: the HTML displays **no real table records**. The latent array of row Y coordinates does not turn those into visible items.
2. Several CSS token maps (`AC`, `TY`, `ST`) exist for hypothetical populated rows; documenting these as styling provisions is appropriate, but claiming actual asset records, collaborators or statuses would be false.
3. The `View`, `Filters`, `Events`, `AI Tools` tabs are all drawn; only the View panel body is represented. The other tab content is not defined.
4. `No analysis available`, `No match selected`, `No assets yet`, `No asset selected`, and `No collaborators yet` are the displayed default states and must be preserved until real records justify changes.
5. The right inspector shows a decorative gradient preview even with no asset selected; it is **not evidence of an actual video**.
6. Source contains icon approximations and helper rendering, not actual club crests, player photography or licensed imagery.
7. All code creates positioned `div` and SVG elements. No anchor navigation, `input`, `button`, `select`, HTTP fetch, persistence, or backend integration is present in this standalone HTML.
8. The tab labeled **Reels** deliberately uses the `grid` icon key in this source; the inventory records it rather than silently correcting it.
9. `Created By` appears among the **five** dropdown filters, while `Created By` also appears as a distinct **inspector metadata row**; both must be retained.
10. Some latent row CSS/status palettes may not have been visually exercised in the clean-state document, so they are source-derived component styling, not independently visually verified.

**Status:** Page 09 inventory completed from the supplied HTML and **awaiting owner review**. Do not lock or move to Page 10 without the owner's explicit instruction.
