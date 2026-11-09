# OTSI VIE — PAGE 10: EXPORT & DELIVERY
## Ultra-comprehensive frontend UI inventory — actual HTML, section-by-section, review edition

**Source:** `10_EXPORT_DELIVERY.html` (155 source lines; visual-only reconstruction).  
**Canvas:** 2560 × 1440 px (QHD).  
**Scope:** every visible frontend section, control, label, value, state, icon, size, spacing, color, and intended UI interaction; **brief** backend/DB source indications only.  
**Status:** **UNLOCKED — awaiting owner approval**.  
**Important:** All coordinates describe the original design canvas. This HTML uses absolute-positioned `div`/SVG drawings, not functional form controls, playback, rendering, API calls, or real MySQL data. Any described behavior is **required for implementation**, not already working.

---

## 00. Global visual specification and source semantics

### 00.1 Canvas, scaling, typography

| Property | Exact specification |
|---|---|
| Document title | `OTSI VIE - 10 Export & Delivery (visual only)` |
| Document language | `en`; UTF-8 |
| Body | `margin:0;height:100%;background:#000;overflow:hidden` |
| Main stage | `#s` absolute `(0,0) 2560×1440`; `background:#000a16`; `overflow:hidden` |
| Main font | `"Segoe UI", "Helvetica Neue", Arial, sans-serif` |
| Text color | `#fff`; muted token `#8ea3bf` |
| Geometry | `.a` absolute elements, `box-sizing:border-box`; exact source coordinates in sections below |
| Text | `.t` has `translateY(-50%)`, `white-space:nowrap`, `line-height:1.1` |
| Text align | `.r` right-anchored, `.c` horizontally centered |
| Font weights | `.b` 700, `.sb` 600; unmarked regular |
| Blue text tokens | `.bl` `#1e90ff`; `.lb` `#33a8ff` |
| Panel `.pn` | `linear-gradient(#081a35,#06122a)`; `1.5px solid #12335f`; `14px` radius |
| Input-look `.in` | background `#041022`; `1.5px solid #17406f`; `8px` radius |
| Chip `.ch` | background `#0a2447`; `1.5px solid #1d4f8a`; `6px` radius |
| Accent rule | `ACC(x,y,h)`: blue `#1e90ff` vertical bar, width `3px` |
| Primary action | `#0a84ff`, typically 8px radius |
| Muted/control backgrounds | `#06142a`, `#0a1d38`, `#0b2a4d`, `#26364d` |
| Dividers | `#12335f`, `#4a5a78`, `#3a4a62` depending on location |
| Scaling | `fit()` calculates `k=min(innerWidth/2560,innerHeight/1440)` and centers/scales entire stage; calls on resize |
| Illustration | Generated CSS radial/linear gradients; no real player/football video/image files included |
| Icons | Simplified inline SVG paths keyed by names; approximate, not licensed graphic assets |

**Source helpers:** `D(x,y,w,h,...)` draws rectangular elements; `T(x,y,text,size,...)` draws vertically centered labels; `I(x,y,icon,size,...)` draws SVG icons centered at `(x,y)`; `P` panel; `TG(x,y,on,width)` switch (default width 56, height 28, rounded radius 14; on fill `#0481f9`, off `#26364d`, white 22px knob); `CB(x,y,on)` checkbox (26px, on fill `#1e90ff`, off outline 2px `#8ea3bf`, check icon when on); `SEL` faux dropdown; `AV` circular collaborator avatar; `TH` faux video thumbnail; `ACC` accent. **No helper attaches an event listener** except the viewport resize listener.

### 00.2 Visual-faithfulness rules

- Preserve the QHD composition, section arrangement, exact field labels, line breaks, alignment, active tab highlight, and controls. Convert drawings to accessible, semantic React controls **without changing their appearance**.
- Empty states are true to this source. Do not invent a project, reel, render job, owner-provided content, collaborators, chapters or metrics.
- User-selectable defaults in this HTML are **presentation defaults**, not proof of a stored/exportable project. A working app must read/write real project configuration.
- Render, download, share and notify actions must be governed by actual export permissions, identity/guardian consent where applicable, provenance and live server-side rechecks. Display absence/unavailability honestly.

---

## 01. Global application header — full width, y=0–100

### 01.1 Header, wordmark and subtitle

- Background: rectangle `(0,0) 2560×100`, fill `#071a33`, bottom border `1.5px solid #1e90ff`.
- `OTSI` text anchor `(30,38)` **40px bold** white; `VIE` `(130,38)` **40px bold** blue `#1e90ff`.
- `VIDEO INTELLIGENCE ENGINE` `(31,73)` **13px bold**, `#1e90ff`.
- HTML contains a text wordmark, not an embedded official logo image. Real logo asset should be used if available without disturbing geometry.

### 01.2 All ten navigation entries (single row)

| Order | Destination | Text x | Text y | Font | State |
|---:|---|---:|---:|---|---|
| 1 | Home | 381 | 52 | 24px semibold | Inactive |
| 2 | Upload | 548 | 52 | 24px semibold | Inactive |
| 3 | Processing | 700 | 52 | 24px semibold | Inactive |
| 4 | Analysis | 889 | 52 | 24px semibold | Inactive |
| 5 | Tactical | 1067 | 52 | 24px semibold | Inactive |
| 6 | Reel Builder | 1215 | 52 | 24px semibold | Inactive |
| 7 | Clip Studio | 1396 | 52 | 24px semibold | Inactive |
| 8 | Player Report | 1555 | 52 | 24px semibold | Inactive |
| 9 | Library | 1766 | 52 | 24px semibold | Inactive |
| 10 | **Export** | **1942** | **52** | **24px bold** | **Active `#6cc4ff`** |

- Active Export backdrop `(1894,12) 169×78`, `#073154`, `1.5px #1e6fb0` border, `12px` radius.
- Active underline `(1903,92) 150×5`, `#1e90ff`, `3px` radius.
- Intended: actual app routing; all ten visible routes, preserve session and current project context. **Source:** drawn text, no links.
- **Brief backend/DB source:** authenticated session, permitted routes, saved project context.

### 01.3 Display badge and account

- Divider `(2117,20) 2×62` `#12335f`.
- `QHD` pill `(2140,23) 100×54`, background `#071e37`, 1.5px `#17406f` border, radius 8; centered label `(2190,50)` 20px bold `#33a8ff`.
- Owner avatar circle `(2271,25) 54×54`, `#1e90ff`; white letter `O` at `(2298,52)`, 22px bold.
- `Owner` `(2340,41)`, 24px bold; `OTSI VIE` `(2340,69)`, 19px muted.
- Intended: account/profile menu and genuine authenticated display name, not a fictional identity. QHD label is UI badge, not proof that output is QHD.
- **Brief backend/DB source:** user session / organization profile.

---

## 02. Left column A — Export & Delivery workflow

### 02.1 Main workflow panel and introduction

- Shell `(30,120) 396×507`, `.pn` gradient/border/radius.
- Heading `Export & Delivery` anchor `(52,158)`, **34px bold**.
- Two-line description `(52,202)` and `(52,230)`, both 21px `#cfe0f5`: `Render, brand and deliver professional` / `video insights to your team and clients.`
- Divider `(52,273) 348×1` fill `#12335f`.
- Highlighted workflow-band `(39,282) 379×75`, gradient `#0b2b57 → #08213f`, `1.5px #1e5fa8`, 8px radius.

### 02.2 Four workflow steps — all separately represented

| No. | Center y | Circle geometry | Exact title | Subtitle | Source state |
|---:|---:|---|---|---|---|
| 1 | 318 | `(51,290) 56×56` | Edit & Finalize | Review highlights and settings | Highlighted blue `#0a84ff` |
| 2 | 400 | `(51,372) 56×56` | Export Settings | Choose format, branding and output | Dark `#122339`, `1.5px #1b3350` outline |
| 3 | 484 | `(51,456) 56×56` | Render & Process | Generate high-quality video | Dark, pending |
| 4 | 569 | `(51,541) 56×56` | Deliver & Share | Send to clients and collaborators | Dark, pending |

- Numbers are centered at x=79, size 26px semibold. Titles at x=128, center y minus 13, 22px semibold; subtitles x=128, center y plus 14, 18px `#9fb3cc`.
- Conditional completion-checkmark branch exists in code but is **not drawn**, because all step flags equal `0`.
- Intended: workflow navigation and stage status driven by actual project/render/delivery state; visually indicate current, completed, blocked or failed states while retaining geometry.
- **Brief backend/DB source:** reel/project stage, render job, delivery status.

---

## 03. Left column B — Project Summary

### 03.1 Summary shell and selected project card

- Panel `(30,644) 396×651`, `.pn`; title `Project Summary` `(49,673)`, 23px semibold.
- Project mini-card `(48,706) 365×127`, background `#06142a`, 1.5px `#12335f` border, radius 8.
- Decorative portrait/thumbnail `(49,707) 138×121`: radial portrait simulation layered over blue linear gradient; **not a real thumbnail**.
- Project name `No project open` anchor `(204,735)`, 24px semibold.
- Instruction `Open a reel to export` anchor `(204,764)`, 22px `#e3eefb`.
- Intended: selecting a saved reel/project replaces empty state; click title/preview should open real project selection.
- **Brief backend/DB source:** reel projects and media preview assets.

### 03.2 Four metadata rows and tags

| Icon | Row label | Label x / center y | Value anchor | Initial value |
|---|---|---|---|---|
| ball | Source Match | `(88,865)` | `(232,865)` | `—` |
| ball | Competition | `(88,900)` | `(232,900)` | `—` |
| calendar | Date | `(88,936)` | `(232,936)` | `—` |
| clock | Duration | `(88,974)` | `(232,974)` | `—` |
| tag | Tags | `(88,1017)` | `(147,1017)` | `—` |

- Each row icon center x=60, size 24px; labels 18px muted `#9fb3cc`; values 19px light `#e3eefb`; Tags 16px.
- Tags have an empty rendering loop (`[].forEach`), so **zero source tag pills** are drawn. A future tag chip style `.ch` has `#0a2447` background, 1.5px `#1d4f8a` border, 6px radius.
- Intended: show genuine metadata from selected project, never inferred match details.
- **Brief backend/DB source:** project, match, competition, media duration, project tags.

---

## 04. Centre — Main reel preview/player

### 04.1 Main panel and illustrative media scene

- Large preview shell `(444,120) 1365×845`, `.pn`.
- Video surface `(464,141) 1327×575`, radius 10; radial spotlight gradient `#5fb8ff` → `#1d4a8a` over dark background `#0a1a38 → #04101f → #0a2a30`.
- Central abstract person/spotlight ellipse `(1000,250) 480×470`, blue gradients; decorative ball `(1290,640) 90×70`, gradient `#dde7f5 → #335`, radius 50%.
- Top-right quality label panel `(1676,170) 84×62`, dark `#0a0a05`, **3px golden `#f5b82e` border**, radius 6; `—` x=1718 y=191 (30px bold gold) and `ULTRA HD` x=1718 y=217 (12px bold gold). This is a badge, not a verified output resolution.
- Empty text: `No reel loaded` at `(534,441)`, **62px bold** with `letter-spacing:-1px`; `NOT RENDERED` at `(534,496)`, **44px bold** bright `#1e9bff`; `OPEN A REEL FROM THE LIBRARY` at `(536,540)`, 24px semibold, letter spacing 3px; dash `—` at `(536,570)` same style.
- Play overlay: circular `(1054,380) 112×112`, dark translucent background, 2px white translucent border, radius 50%, with white triangle `(1098,412) 40×50`.

### 04.2 Three illustrated metric overlay panels

Each: `(1498,y) 278×62`, translucent dark `rgba(5,16,36,.75)`, 1.5px `#17406f` border, radius 6. Icon 34px `#33a8ff` centered at `(1526,y+31)`; dash value 34px bold at x=1566; label 19px `#e3eefb` at x=1611.

| Card | Top y | Icon | Exact label | Value |
|---|---:|---|---|---|
| 1 | 397 | running figure | `Key Passes` | `—` |
| 2 | 472 | search icon | `Progressive Passes` | `—` |
| 3 | 547 | trophy | `Chance Creation` | `—` |

- These are static graphics. Required: only display calculated, provenance-backed metrics for the selected reel/player; hide or dash when unknown.
- **Brief backend/DB source:** rendered reel composition, attached media and verified analysis aggregates.

### 04.3 Playback and transport row — every control

- Horizontal separator `(481,652) 1292×3`, fill `#3a4a62`.
- Play icon center `(509,685)` 30px, white; mute/volume icon center `(568,685)` 30px; vertical rule `(595,672) 1×26`, fill `#4a5a78`.
- Time label `(622,686)`, **20px**: exact `00:00 / 00:00`.
- Scrub track `(750,683) 740×5`, fill `#3a4a62`, radius 3; **no drawn position thumb** in this HTML.
- Playback speed selector `(1527,668) 69×35`, dark translucent, border 1.5px `#17406f`, radius 6; `1x` at `(1542,685)` 18px, downward chevron at `(1577,685)` size 16.
- Additional icons center `(1635,685)` captions (`cap`) 26px; `(1691,685)` settings (`gear`) 28px; `(1748,685)` fullscreen 26px.
- Required interactions: load actual source/preview, play/pause, seek and synchronize current time, volume/mute, playback speed selection, caption availability, settings, fullscreen; disable/empty state if no reel exists. **All are visual-only here.**
- **Brief backend/DB source:** reel media URL/permissions, captions and render preview manifest.

---

## 05. Centre — Highlight Chapters carousel

### 05.1 Container and header

- Chapters panel `(463,733) 1329×212`, background `rgba(5,16,34,.7)`, 1.5px `#12335f` border, radius 10.
- Vertical blue accent `(470,747) 3×30`, `#1e90ff`.
- Title `Highlight Chapters (0)` at `(487,758)` **23px semibold**; count explicitly zero.
- Label `Auto Chapters` at `(726,761)`, **16px** `#cfe0f5`.
- Auto Chapters toggle `TG(837,761,1,52)`: track `(837,747) 52×28`, ON `#0481f9`; white 22px knob starts x=863, y=751. **Default visually ON**.
- `Edit Chapters` secondary action `(1613,741) 161×38`, `.in`; edit SVG center `(1640,760)` size 22; label `(1665,760)` 17px.

### 05.2 Carousel, empty state, template

- Previous arrow button `(453,828) 36×56` `.in`, icon left chevron center `(471,856)` 20px.
- Next arrow `(1767,828) 36×56` `.in`, icon right chevron center `(1785,856)` 20px.
- Empty center message `No chapters yet — chapters are created from the reel timeline` centered anchor `(1128,860)`, **19px** muted `#8ea3bf`.
- Template for chapter cards exists inside **empty** `[].forEach`: thumbnail top y=792, height 102; selected outline blue, numbered badge 32×32, duration badge, title at y=918. **No actual chapter cards are drawn.**
- Required interactions: ON/OFF automatically generated chapter grouping, previous/next navigation, open chapter editor, real ordering/timing/title edits; only allow auto generation when project data exists.
- **Brief backend/DB source:** reel timeline clips/chapters, editor project and auto-chapter preferences.

---

## 06. Right column — Four-tab export workspace

### 06.1 Tab strip and exact geometry

- Strip panel `(1830,120) 710×65` `.pn`.
- Selected Export tab backdrop `(1830,120) 172×65`, fill `#08213f`, blue underline `3px solid #1e90ff`, 10px upper radii.

| Tab | Icon center | Label anchor | Font | Initial state |
|---|---|---|---|---|
| Export | `(1905,153)` cloud 28px | `(1905,153)` `Export` | 22px semibold `#33a8ff` | Selected |
| Branding | `(2073,153)` brand 28px | `(2073,153)` `Branding` | 22px regular | Inactive |
| Reports | `(2271,153)` document 28px | `(2271,153)` `Reports` | 22px regular | Inactive |
| Delivery | `(2444,153)` cloud 28px | `(2444,153)` `Delivery` | 22px regular | Inactive |

**Source note:** Labels/icons are separately rendered at the same x coordinates in source arrays. The intended tab widths can be resolved against the shown UI; only the Export active background is explicitly drawn.

- Intended behavior: select tab to open corresponding option sets and keep config state. **Source:** inactive tabs do not swap panels; all major panels are simultaneously displayed below.
- **Brief backend/DB source:** export project, branding and delivery configuration.

---

## 07. Right — Export Settings: every field, selector, and aspect tile

### 07.1 Panel heading and Reset

- Shell `(1830,200) 710×455` `.pn`; left accent `(1849,216) 3×28` blue.
- Title `Export Settings` `(1871,230)`, 24px semibold.
- `Reset` `(2508,230)`, 20px bright `#33a8ff` right-anchored; intended restore saved/default export settings after an explicit user action.

### 07.2 Output Preset

- Label `Output Preset` `(1851,287)`, 21px.
- Dropdown `SEL(2020,263,495,46,...)`: `(2020,263) 495×46`, `.in` border 1.5px `#17406f`, radius 8, background `#041022`; value **`Highlights Reel (Recommended)`** at `(2044,286)`, 21px `#e3eefb`; chevron center `(2493,286)` size 18.
- Help sentence `Optimized for professional analysis and client sharing.` at `(2020,326)`, 17px muted.
- Required: real preset selection updates dependent resolution, frame-rate, aspect, codec and quality where relevant; do not assert unsupported preset names as source choices.

### 07.3 Resolution and Frame Rate

| Field | Label | Label position | Control bounds | Shown default |
|---|---|---|---|---|
| Resolution | `Resolution` 21px | `(1851,378)` | `(1994,355) 224×45` | `4K (3840 × 2160)` 20px |
| Frame Rate | `Frame Rate` 21px | `(2256,377)` | `(2379,355) 136×45` | `60 fps` 20px |

- Each field is a faux `SEL`: input-look surface, 24px left inset for value, small chevron centered 22px inside right edge.
- Required: chosen output resolution and fps feed actual encoding configuration and feasibility checks, not only text state.

### 07.4 Aspect Ratio — four individually documented cards

- Group heading `Aspect Ratio` at `(1851,434)`, 21px.
- All cards y=420, height 111, white text generally 20px ratio / 19px descriptor. Icon size 34; 8px radius.

| Choice | Geometry x / width | Icon | Ratio / label center y | Initial style |
|---|---|---|---|---|
| **16:9 Landscape** | `(1995,420) 123×111` | `cam` | `16:9` y=485; `Landscape` y=510 | **Selected:** `#0a2b55`, 3px `#1e90ff`, icon/labels blue |
| 9:16 Vertical | `(2132,420) 117×111` | `ph` | `9:16` / `Vertical` | Off: `#0a1d38`, 1.5px `#17406f` |
| 1:1 Square | `(2263,420) 120×111` | `sq1` | `1:1` / `Square` | Off |
| 4:5 Social | `(2396,420) 121×111` | `sq` | `4:5` / `Social` | Off |

- Icon centers: x midpoint of each tile, y=451; ratio y=485; descriptor y=510.
- Required: one selected at a time; click affects crop/layout and output encoding; correctly preserve preview framing and export rights.

### 07.5 File Format and Quality

| Field | Label at | Control bounds | Shown value |
|---|---|---|---|
| File Format | `(1851,576)` | `(1994,553) 224×45` | `MP4 (H.264)` 20px |
| Quality | `(2276,576)` | `(2384,555) 131×43` | `High` 20px |

- Quality uses faux `.in` and a `layers` icon center `(2411,577)` 26px, text `(2435,578)` and chevron center `(2490,578)` 18px.
- File Format chevron is part of `SEL`, centered at right inset 22px.
- Description `Best compatibility, high quality, smaller file size.` `(1996,617)`, 17px muted.
- Required: codec/container and quality choices must be validated against available encoder/output capabilities, not simulated.
- **Brief backend/DB source for Settings:** per-project/export settings, renderer capabilities, render job preset and output metadata.

---

## 08. Right — Branded Overlays

### 08.1 Branding panel header and master switch

- Shell `(1830,672) 710×295` `.pn`; accent `(1849,686) 3×28`.
- `Branded Overlays` `(1871,699)` 23px semibold.
- Green status indicator `(2312,690) 20×20` fill `#17c27a`, white/dark check SVG centered `(2322,700)` size 12. **This is a decorative check indicator, not a functional validation result.**
- Label `Include Branding` `(2345,701)`, 15px `#cfe0f5`.
- Master switch `TG(2464,700,1,54)` → track `(2464,686) 54×28`, blue `#0481f9`, knob x=2492,y=690. **Visually ON.**
- Required: switch gates all branded render overlays consistently; toggling must update derived preview and saved settings.

### 08.2 Logo/brand selector

- Dropdown-look `(1851,735) 284×65`, `.in`.
- Decorative OTSI circular mark `(1873,752) 36×36`, 4px `#1e90ff` outline.
- Brand name `OTSI VIE` at `(1922,762)` **27px bold**; subtitle `VIDEO INTELLIGENCE ENGINE` at `(1922,785)` **8px bold**, `#33a8ff`.
- Chevron center `(2108,767)` 20px.
- Required: select verified brand/approved company logo; avoid substituting placeholder mark as actual uploaded logo.

### 08.3 Four checkboxes — exact initial states

Each CB center x=1868, size 26×26, background blue `#1e90ff` and white check icon **ON**; label at x=1893, 19px `#e3eefb`.

| Row | Center y | Label | Initial |
|---:|---:|---|---|
| 1 | 826 | `Logo Overlay` | **Checked** |
| 2 | 861 | `Player Name & Stats` | **Checked** |
| 3 | 896 | `Match Info Banner` | **Checked** |
| 4 | 930 | `Custom Intro/Outro` | **Checked** |

- `Edit` pill `(2067,909) 66×40` `.in`; centered `Edit` `(2100,929)` 17px.
- Required: each independent checkbox changes render overlay selection; Edit opens configuration for relevant custom intro/outro or branding setup. Missing assets must be flagged, not fabricated.

### 08.4 Static branded preview

- Preview surface `(2161,735) 357×208`, radius 8, radial gradient `#4aa0f0` → `#14407a` → `#06142a`.
- Decorative logo ring `(2243,810) 36×36`, 4px `#1e90ff` outline.
- `OTSI VIE` at `(2293,826)`, **34px bold**; strapline at `(2297,852)`, **9px bold** blue.
- Intended: preview based on actual brand asset and selected overlay settings. **Source:** fixed illustration unaffected by controls.
- **Brief backend/DB source:** permitted organization assets, overlay config, selected project and rendered preview.

---

## 09. Lower centre-left — Export Queue

### 09.1 Panel and header

- Panel `(444,980) 743×317` `.pn`; accent `(462,995) 3×25`.
- `Export Queue (0)` `(482,1007)`, 22px semibold; count `0`.
- `Clear All` `(1160,1008)` right-anchored, 19px `#33a8ff`.
- Empty message `No render jobs queued` centered `(815,1150)` 20px muted.

### 09.2 Queued-job template, not populated

- An empty `[].forEach` defines how queued rows *would* look; **zero rows are currently rendered**.
- Per-row design: dark `#06142a`, border 1.5px `#12335f`, radius 8; thumbnail 96×54; title and secondary information; add icon and three-dot menu.
- Intended: real job list with queue order, status, retry/cancel/remove controls as supported; `Clear All` requires safe confirmation and should not destroy completed outputs unexpectedly.
- **Brief backend/DB source:** render jobs, per-job progress, queue state, rendered assets.

---

## 10. Lower centre — Output & Reports

### 10.1 Shell

- Panel `(1204,980) 411×317` `.pn`; accent `(1214,995) 3×25`.
- Heading `Output & Reports` `(1231,1009)`, 22px semibold.
- Four report rows, each drawn as an independent dark card with checkbox, icon box and two text lines; first two also include a Preview chip.

### 10.2 All four report outputs and checkboxes

| Row | Key y (source array) | Checkbox center | Initial | Title | Subtitle | Icon fill |
|---|---:|---|---|---|---|---|
| 1 | 1058 | `(1234,1066)` | **ON** | `Performance Report (PDF)` | `Key actions, stats and insights` | `#d22` |
| 2 | 1124 | `(1234,1134)` | **ON** | `Player Analysis (PDF)` | `AI-generated tactical analysis` | `#1e6fe0` |
| 3 | 1192 | `(1234,1196)` | **OFF** | `Event List (CSV)` | `All clips and events with timestamps` | `#1fa862` |
| 4 | 1251 | `(1234,1255)` | **OFF** | `Heatmaps (PNG)` | `Tactical visualizations` | `#2a8af0` |

**Source rendering formulas:** For each array row with key `y`: background starts `(1210,y-30)`, width 399; height 64 for first two, 58 for last two; `#06142a`, 1.5px `#12335f`, radius 8. Checkbox center `y+8` for first, `y+10` second, `y+4` third/fourth. Icon rectangle x=1260, width 34, height 40; title at x=1314, near `y-1` (third/fourth y-6), 17px semibold; description x=1314, near y+24 (third/fourth y+17), 15px `#9fb3cc`.

- PDF Preview chips for rows 1 & 2: `(1539,y-14) 58×32`, `.ch` border `#1d4f8a`, `Preview` centered 14px `#33a8ff`.
- Required: checkbox toggles inclusion of each export companion artifact; Preview opens real content or indicates not generated; unavailable report type must not claim generated or downloadable state.
- **Brief backend/DB source:** verified analysis, report generation jobs, per-export selected artifacts.

---

## 11. Lower centre-right — Shareable Link

### 11.1 Panel, status and field

- Shell `(1630,980) 475×317` `.pn`; accent `(1645,995) 3×25`.
- Title `Shareable Link` at `(1662,1009)`, 22px semibold.
- Disabled/not-ready badge `(1977,993) 124×34`, background `#1a2840`, 1.5px `#4a5a78` border, radius 8; gray circle `(1989,1003) 16×16`, fill `#8ea3bf`; `Not ready` `(2016,1011)`, 17px light `#dfe8f5`.
- Link field `(1649,1041) 440×54`, `.in`; placeholder `Link available after export` at `(1662,1069)`, 19px `#8ea3bf`; copy icon center `(2060,1069)`, size 26. **No shareable URL exists in the HTML.**
- Intended: create/manage signed, scoped share link after authorized export; clipboard copies actual URL only after successful issuance, with accurate status.

### 11.2 Four sharing-permission switches

Toggle helper here uses **width 58**, height 28; center y from row definitions; labels 19px `#cfe0f5` at x=1701, icons x=1673 26px.

| Row | Icon | Center y | Label | Initial |
|---:|---|---:|---|---|
| 1 | lock | 1128 | `Password Protection` | **OFF** |
| 2 | calendar | 1167 | `Set Expiry Date` | **OFF** |
| 3 | download | 1207 | `Allow Download` | **ON** |
| 4 | comment | 1247 | `Allow Comments` | **ON** |

- Track x=2029, top=center y−14, width 58, ON fill `#0481f9` / OFF fill `#26364d`; knob 22px white at x=2061 for ON, x=2033 for OFF; y=center y−10.
- Required: password on → password entry/validation UI; expiry on → date/time selection; download/comments switch controls server-enforced permissions, not only appearance. Disabled until a permitted share exists as appropriate.
- **Brief backend/DB source:** share links, access policy, expiry, export rights, permitted comments/downloads.

---

## 12. Lower right — Team Collaboration

### 12.1 Header and collaborators

- Panel `(2117,980) 423×317` `.pn`; accent `(2133,995) 3×25`.
- Heading `Team Collaboration` `(2151,1008)`, 22px semibold.
- `Manage` `(2512,1009)`, 18px `#33a8ff`, right-aligned.
- Empty message `No members yet` `(2140,1058)`, 18px muted `#8ea3bf`.
- Add-member visual circle `(2324,1034) 52×50`, outlined `1.5px #17406f`, 50% radius; plus icon `(2350,1058)`, size 20 muted.
- Required: open authenticated member picker/invite form, manage roles/permissions. No invented members.

### 12.2 Two notification switches

| Row | Icon center | Label | Label anchor | Toggle center / width | Initial |
|---|---|---|---|---|---|
| Notify team when ready | mail `(2154,1112)` 24px | `Notify team when ready` | `(2186,1112)` 19px | `(2465,1111)` width 54 | **ON** |
| Notify client | user `(2154,1148)` 24px | `Notify client` | `(2186,1148)` 19px | `(2465,1146)` width 54 | **ON** |

- Both on-track `#0481f9`, white knob right. Note that the toggle centers in the source are **1111 and 1146**, while respective label centers are 1112 and 1148.
- Required: persist notification preferences; notification dispatched **only** when render and export permissions are satisfied and actual authorized recipients exist; failure states visible.

### 12.3 Optional message field and counter

- Multiline input-look rectangle `(2140,1171) 378×97`, `.in` background `#041022`, border `1.5px #17406f`, radius 8.
- Placeholder `Add a message for recipients (optional)` at `(2154,1190)`, 18px `#8ea3bf`.
- Character counter `0/300` right-anchored `(2512,1281)`, 15px muted.
- Required: real textarea with max **300 characters**, live counter, persistence in delivery draft, sanitization and review before sending.
- **Brief backend/DB source:** organization members, sharing permissions, notification preferences, client contacts and delivery message.

---

## 13. Full-width bottom — Render Progress and delivery actions

### 13.1 Shell and four-stage pipeline

- Footer panel `(30,1312) 2510×110` `.pn`; accent `(40,1326) 3×26`.
- Title `Render Progress` `(57,1337)`, 22px semibold.
- Each stage circular marker is 40×40, centered at specified x, y=1342; all dark `#0a1d38` with 2px `#3a5a88` border, uncompleted. Numbers 19px semibold centered. All status captions are `Waiting...`.

| Stage | Number circle center | Exact stage heading | Heading anchor | Status anchor | Initial |
|---:|---|---|---|---|---|
| 1 | `(288,1342)` | `Preparing Files` | `(326,1342)` | `(326,1370)` | Waiting... |
| 2 | `(597,1342)` | `Rendering Video` | `(635,1342)` | `(635,1370)` | Waiting... |
| 3 | `(891,1342)` | `Processing Reports` | `(931,1342)` | `(931,1370)` | Waiting... |
| 4 | `(1186,1342)` | `Finalizing` | `(1229,1342)` | `(1229,1370)` | Waiting... |

- Direction arrows centered `(509,1340)`, `(807,1340)`, `(1109,1340)`, size 24, muted `#3a5a88`.
- Long unfilled progress track `(270,1387) 1169×13`, background `#0b2a4d`, radius 7. **No real progress percent** displayed.
- Source has conditional styling for completed stage but the four stage states are all `0`, so none is highlighted.

### 13.2 Delivery status

- Divider `(1477,1335) 1.5×45`, fill `#12335f`.
- Inactive status circle `(1500,1330) 38×38`, fill `#26364d`.
- `Delivery not ready` at `(1561,1345)`, **22px semibold**.
- `Nothing has been rendered yet.` at `(1561,1380)`, 18px blue text `#33a8ff`.
- Required: render lifecycle/state machine and truthful delivery readiness; do not show done until outputs really exist and rights validate.

### 13.3 Download All button

- Rectangle `(1948,1331) 243×68`, `.in`; download icon center `(1995,1365)` 28px; `Download All` `(2040,1365)` 22px semibold.
- Intended: download all permitted, completed files; must remain disabled or provide truthful unavailable state when no outputs exist, with authenticated authorization.

### 13.4 Deliver to Client split button

- Main button `(2211,1331) 315×68`, background `#0a84ff`, 8px radius.
- Send icon centered `(2257,1365)` 28px white; label `Deliver to Client` `(2291,1365)` 22px semibold white.
- Split separator `(2467,1341) 1.5×48`, fill `#4fa8ff`; dropdown chevron center `(2496,1365)` size 22.
- Intended: authenticated delivery action, recipient selection/confirmation, explicit consent/rights checks, enqueue/dispatch and actual status feedback. Split menu offers delivery choices **to be drawn/defined in running app**, not invented as source-labeled options.
- **Brief backend/DB source:** render job state, exported assets, rights, delivery recipients, delivery audit/status.

---

## 14. Exhaustive interaction and initial-state checklist

**The source depicts controls but does not implement them.** Every row below becomes an acceptance item for the real frontend.

| ID | Control / element | Initial HTML state | Intended UI response | Brief source |
|---|---|---|---|---|
| 10-001 | Global Home nav | Inactive | Navigate Home | Router |
| 10-002 | Upload nav | Inactive | Navigate Upload | Router |
| 10-003 | Processing nav | Inactive | Navigate Processing | Router |
| 10-004 | Analysis nav | Inactive | Navigate Analysis | Router |
| 10-005 | Tactical nav | Inactive | Navigate Tactical | Router |
| 10-006 | Reel Builder nav | Inactive | Navigate Reel Builder | Router |
| 10-007 | Clip Studio nav | Inactive | Navigate Clip Studio | Router |
| 10-008 | Player Report nav | Inactive | Navigate Player Report | Router |
| 10-009 | Library nav | Inactive | Navigate Library | Router |
| 10-010 | Export nav | Selected | Remain in Export | Router |
| 10-011 | Owner profile | Decorative | Account menu | Session |
| 10-012 | Workflow stages 1–4 | First highlighted | Context/stage navigation and status | Project/job |
| 10-013 | Project selection | No project open | Open reel/project picker | Projects |
| 10-014 | Main preview play overlay | Static | Play loaded reel | Media |
| 10-015 | Player play icon | Static | Play/pause | Media |
| 10-016 | Volume icon | Static | Mute/volume | Media |
| 10-017 | Seek bar | Unfilled | Scrub preview | Media |
| 10-018 | Speed selector | `1x` | Change playback rate | Local player |
| 10-019 | Caption icon | Static | Toggle captions if available | Captions |
| 10-020 | Player settings | Static | Open player options | Local/media |
| 10-021 | Fullscreen icon | Static | Fullscreen toggle | Local player |
| 10-022 | Auto Chapters toggle | **ON** | Recompute/persist auto-chapter preference | Timeline |
| 10-023 | Edit Chapters | Static | Open chapter editor | Timeline |
| 10-024 | Chapter previous arrow | Static | Move carousel backward | Chapters |
| 10-025 | Chapter next arrow | Static | Move carousel forward | Chapters |
| 10-026 | Export tab | **Selected** | Show export options | Local state |
| 10-027 | Branding tab | Inactive | Show branding controls | Local state |
| 10-028 | Reports tab | Inactive | Show report controls | Local state |
| 10-029 | Delivery tab | Inactive | Show delivery controls | Local state |
| 10-030 | Reset settings | Static | Reset settings safely | Settings |
| 10-031 | Output Preset | Highlights Reel | Select preset | Export config |
| 10-032 | Resolution | 4K | Select resolution | Render capability |
| 10-033 | Frame Rate | 60 fps | Select frame rate | Render capability |
| 10-034 | Aspect 16:9 | **Selected** | Keep/apply landscape | Export config |
| 10-035 | Aspect 9:16 | Unselected | Apply vertical | Export config |
| 10-036 | Aspect 1:1 | Unselected | Apply square | Export config |
| 10-037 | Aspect 4:5 | Unselected | Apply social | Export config |
| 10-038 | File Format | MP4 H.264 | Choose output format | Renderer |
| 10-039 | Quality | High | Choose quality | Renderer |
| 10-040 | Include Branding | **ON** | Enable/disable branding | Project/rights |
| 10-041 | Brand selector | OTSI VIE shown | Select approved brand assets | Branding |
| 10-042 | Logo Overlay checkbox | **Checked** | Include/exclude logo | Branding |
| 10-043 | Player Name & Stats checkbox | **Checked** | Include/exclude confirmed info | Player/analysis |
| 10-044 | Match Info Banner checkbox | **Checked** | Include/exclude match info | Match |
| 10-045 | Custom Intro/Outro checkbox | **Checked** | Include/exclude intro/outro | Branding assets |
| 10-046 | Branding Edit | Static | Edit branded elements | Branding config |
| 10-047 | Clear All export queue | Empty queue | Confirm/remove eligible queue items | Render jobs |
| 10-048 | Performance Report PDF | **Checked** | Select companion PDF | Reports |
| 10-049 | Player Analysis PDF | **Checked** | Select companion PDF | Reports |
| 10-050 | Event List CSV | Unchecked | Select companion CSV | Events |
| 10-051 | Heatmaps PNG | Unchecked | Select companion PNG | Heatmaps |
| 10-052 | Performance PDF Preview | Static | Preview real report | Reports |
| 10-053 | Player PDF Preview | Static | Preview real report | Reports |
| 10-054 | Copy shareable link | No URL | Copy only when ready | Share links |
| 10-055 | Password Protection switch | **OFF** | Enable and configure password | Share policy |
| 10-056 | Set Expiry Date switch | **OFF** | Enable/select expiry | Share policy |
| 10-057 | Allow Download switch | **ON** | Change server-enforced download right | Rights |
| 10-058 | Allow Comments switch | **ON** | Change share comment right | Share policy |
| 10-059 | Team Collaboration Manage | Static | Open access management | Members |
| 10-060 | Add member icon | No members | Invite/select member | Members |
| 10-061 | Notify team when ready | **ON** | Save notification preference | Notifications |
| 10-062 | Notify client | **ON** | Save client preference | Notifications |
| 10-063 | Delivery message field | Empty | Editable max-300 textarea | Delivery draft |
| 10-064 | Character counter | `0/300` | Live character counting | Local state |
| 10-065 | Download All | No outputs | Download permitted ready assets only | Exports/rights |
| 10-066 | Deliver to Client | Delivery not ready | Send after ready/rights confirmation | Delivery |
| 10-067 | Delivery split chevron | Static | Open delivery methods | Delivery |

### 14.1 Status and data fields that must not be invented

- Four project metadata dashes and Tags dash; no selected project.
- Reel is explicitly unrendered, no real clip source, `00:00 / 00:00` placeholder.
- Quality badge `ULTRA HD` and selected 4K/60 fps are **design selections**, not an actual completed 4K render.
- Three preview KPI values are dashes; no analytic outputs.
- Highlight chapter count `0`, no actual cards; auto chapters toggle still depicted ON.
- Export Queue count `0`; no rows or progress.
- Share link `Not ready`, placeholder only.
- Team Collaboration `No members yet`; no recipient addresses.
- Render Progress: all four stages `Waiting...`; delivery `not ready`.
- Report selections and notification toggles depict defaults but do not prove stored settings.

---

## 15. Page-level frontend behavior and compact data-source map

| UI region | Frontend responsibility | Brief backend / DB source |
|---|---|---|
| Header | Route selection and session/profile state | Authenticated session / user / org |
| Workflow / project | Active stage and selected export project | Reel project / source match |
| Preview | Actual protected media playback, controls, markers | Media manifest / clip / verified analyses |
| Chapters | Timeline-derived chapters and edit state | Reel timeline / chapters |
| Export Settings | Validate and persist output selections | Export configuration / renderer capability |
| Branding | Enable options, choose approved assets, preview | Branding assets / project config |
| Queue | Show and manage actual queued renders | Render jobs and outputs |
| Reports | Select / preview generated companion deliverables | Report jobs and generated artifacts |
| Shareable Link | Configure access, issue/copy real link | Share tokens / rights / expiry |
| Collaboration | Members, notifications and 300-char message | Members / recipients / notification jobs |
| Render Progress | Job stages, readiness, download and deliver | Render pipeline / rights / delivery logs |

**Implementation requirements:** Every toggle, checkbox and dropdown must have controlled state, validation and accessible keyboard interaction; real save and data retrieval where relevant. Buttons must perform named operations or clearly state why unavailable. Backend cannot be inferred as already implemented from this standalone HTML. Never connect browser code directly to MySQL. Preserve all rights and canonical identity protections.

---

## 16. Visual validation and page acceptance — owner approval gate

- [ ] Render actual React page at **2560×1440** and compare to provided Page 10 reference section by section.
- [ ] Header all ten items visible in correct order; active Export highlight exactly matched.
- [ ] Left four-stage workflow and Project Summary match source geometry and text.
- [ ] Main player frame, three analytic chips, player toolbar and chapters match actual source coordinates.
- [ ] Right tabs, all settings selectors and four aspect tiles retain their exact dimensions and initial visual defaults.
- [ ] Branding master toggle, four checkboxes, selector, edit control and branded preview present.
- [ ] Export Queue, four output-report checkboxes, both Preview pills, Shareable Link, four permission toggles and Collaboration controls are individually present.
- [ ] All bottom render stages, progress track, status, Download All and Deliver to Client controls visible.
- [ ] Every interactive control is a real usable UI control in the application (mouse, keyboard, state) without losing visual design; tests cover intended outcomes.
- [ ] Real operations honor server authorization, export rights, minors/guardian restrictions where relevant, recheck on download/delivery, and show truthful empty/unavailable states.
- [ ] No invented processed statistics, rendered videos, signed links, export jobs or collaborators.
- [ ] **Owner explicitly approves and locks Page 10** before this inventory is considered final.

**End of Page 10 — Export & Delivery inventory.**
