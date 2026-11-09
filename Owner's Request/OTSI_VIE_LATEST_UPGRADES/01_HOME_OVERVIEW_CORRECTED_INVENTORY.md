# OTSI VIE — PAGE 01: HOME / OVERVIEW
## Ultra-detailed frontend UI inventory, checked against the supplied HTML

**Document status:** Page 01 for owner review; **not locked until explicitly approved**.  
**Primary reference:** `01_HOME_OVERVIEW(1).html` (the exact file supplied for this page).  
**Purpose:** Inventory the **actual frontend design** section by section, including every visible group and control. Backend/database references are deliberately **brief** and identify intended source categories, *not* claims of currently implemented endpoints or tables.

### 0. Source and interpretation rules

- The source is a **visual-only**, fixed-canvas HTML drawing. It generates positioned `<div>` nodes through `D()` and `T()`, SVG icon nodes through `I()`, panels through `P()`, and decorative shapes through other helpers. No native buttons, anchors, inputs, checkboxes, switches, or selectors are authored in this HTML. **Every apparent clickable control is currently a drawing.**
- Native design canvas: **2560 × 1440**; `#s` uses `position:absolute`, background `#000d18`, clipped overflow. The `fit()` function uniformly scales the entire scene to the browser viewport and centers it; it is **not** a responsive component layout.
- Typography: Segoe UI, Helvetica Neue, Arial; commonly used sizes range 12–80 px. General text is white; muted text is `#8ea3bf`; blue highlights `#1e90ff` / `#33a8ff`. Main panels are dark navy gradient `#081a35 → #06122a`, border `#12335f`, radius 14 px.
- Coordinates below are the **literal design-canvas coordinates used by the source** (`x, y, width, height`, in pixels), not DOM measurements captured from a runtime browser. Repeated lists specify their exact row/card anchors. Text is drawn separately from its panel and may exceed card bounds; therefore coordinates do not automatically certify absence of overlap.
- **Source text** means exactly what the HTML draws; `—`, “No … yet”, “Player name”, and empty labels are placeholders or empty states. No club/football match, player statistic, detection, video, reel or user record is evidenced by the HTML.
- **Target interaction** describes what to wire when rebuilding the real React application. It does **not** assert the HTML already implements it. For each action: provide keyboard focus, accessible name, proper disabled/loading/error states, and permissions where relevant.
- **Brief source notes** state which existing engine resource should populate a section. Confirm actual API/database names against the working NestJS/MySQL code before wiring; do not invent a live endpoint or assume a new schema already exists.

---

## 1. Global header / top navigation

**Boundary:** Full-width header background `(0, 0, 2560, 100)` with `#071a33`, bottom `1.5px` bright blue rule `#1e90ff`. Remains visually separate from hero starting at y=101.

| Item | Actual visible element / wording | Source geometry and visual treatment | Intended frontend behavior | Brief backend / DB source |
|---|---|---|---|---|
| Wordmark | `OTSI` / `VIE` | `OTSI` text `(30,38)`, 40px bold white; `VIE` `(130,38)`, 40px bold blue | Brand/home navigation; preserve two-color wordmark | Static branding configuration |
| Descriptor | `VIDEO INTELLIGENCE ENGINE` | `(31,73)`, 13px bold blue | Informational only | Static branding |
| Active Home region | Home is highlighted; decorated tab | Background `(328,12,169,78)` teal-blue `#073154`, border `#1e6fb0`, 12px corners; underline `(337,92,150,5)` bright blue; `Home` text center at `(381,52)` 24px bold, `#6cc4ff` | Active route follows current page; Home navigates to Home | Frontend router |
| Upload | `Upload` | Text anchor `(548,52)`, 24px semibold | Route to Page 02 | Frontend router |
| Processing | `Processing` | `(700,52)` | Route to Page 03 | Frontend router |
| Analysis | `Analysis` | `(889,52)` | Route to Page 04 | Frontend router |
| Tactical | `Tactical` | `(1067,52)` | Route to Page 05 | Frontend router |
| Reel Builder | `Reel Builder` | `(1215,52)` | Route to Page 06 | Frontend router |
| Clip Studio | `Clip Studio` | `(1396,52)` | Route to Page 07 | Frontend router |
| Player Report | `Player Report` | `(1555,52)` | Route to Page 08 | Frontend router |
| Library | `Library` | `(1766,52)` | Route to Page 09 | Frontend router |
| Export | `Export` | `(1942,52)` | Route to Page 10 | Frontend router |
| Right separator | Blue divider | `(2117,20,2,62)`, `#12335f` | Decoration | None |
| QHD capsule | `QHD` | Rectangle `(2140,23,100,54)`, dark background and blue border; label `(2190,50)` centered, 20px bold blue | Display density indicator; not a resolution selector in current HTML | Viewport/configuration, if implemented |
| Avatar | `O` | Circle `(2271,25,54,54)`, bright blue; white 22px `O` centered at `(2298,52)` | Account menu trigger, avatar fallback from real session | Authenticated session |
| Profile text | `Owner`, `OTSI VIE` | `(2340,41)` 24px bold; `(2340,69)` 19px muted | Open account menu, show authenticated owner/organization, logout/settings where supported | Authentication/organization records |

**Audit-critical nuances:** Ten nav entries are visible and explicitly ordered. Only **Home** has highlighted tab geometry in this supplied page; active styling must be dynamic in the running app. There is **no** visible moon/theme toggle or dropdown chevron in this specific HTML; do not silently add one to this page's visual inventory. There are **no** click handlers in the source. `QHD` is only a drawn label.

---

## 2. Hero / first viewport call to action

**Boundary:** `(0,101,2560,500)`; atmospheric gradient from bright blue upper center to dark navy and green-tinted pitch at the bottom. Nine small luminous stadium-light dots are drawn from x=180 in 130px steps with varying y positions.

### 2.1 Left hero message

| Element | Exact text | Anchor / style | Target behavior | Brief data source |
|---|---|---|---|---|
| Eyebrow | `TURN FOOTBALL VIDEO INTO INSIGHTS` | `(60,154)`, 22px, letter spacing 5px, pale blue | Static | Marketing/UI copy |
| Headline line 1 | `Professional Football` | `(60,216)`, 80px bold white | Static | Marketing/UI copy |
| Headline line 2 | `Video Intelligence` | `(60,292)`, 80px bold `#0a9bff` | Static | Marketing/UI copy |
| Subtitle line 1 | `Upload matches, analyze every player, create reels and share` | `(60,358)`, 29px near-white | Static | Marketing/UI copy |
| Subtitle line 2 | `insights — built for analysts, scouts and agencies.` | `(60,396)`, 29px near-white | Static | Marketing/UI copy |

### 2.2 Primary actions

| Visual control | Source rectangle / contents | Expected frontend interaction | Brief backend / DB source |
|---|---|---|---|
| **Upload Video** | Blue gradient glowing rectangle `(59,442,384,96)`, radius 10; upload icon center `(131,490)` 56px; title `(185,474)` 29px semibold; subtitle `(185,508)` `MP4, MOV, up to 50 GB` 22px | Real button routes to Upload and/or launches accessible file picker; enforce actual server capability rather than assuming 50 GB is supported. Validate type/size, show queue and progress on Upload page. | Upload/ingestion service and configured limits; video asset records |
| **Paste Link** | Dark bordered rectangle `(466,442,414,96)`, radius 10; link icon `(522,490)` 50px; title `(577,474)` 29px; subtitle `(577,508)` `YouTube, Hudl, Wyscout...` | Real button opens paste-link flow; validate URL and show provider-specific permission/compatibility outcome. **Displayed provider names are not proof ingestion works or is authorized.** | Import provider capability registry; ingestion jobs |

### 2.3 Central player spotlight and identity

- Large blue-glow spotlight ellipse-like radial graphic `(1180,200,380,420)`. **Artwork**, not video playback or a confirmed identity.
- Verified identity panel `(1123,130,304,75)`: dark transparent fill, 2px bright-blue border, radius 6; little blue square `(1135,140,47,48)` with `—` centered; text `No player selected` `(1195,159)`, 24px bold; trust subtitle `Confirmed players only` `(1195,185)`, 17px blue.
- Five-attribute panel `(1470,170,298,228)`, dark-blue translucent, 2px blue border. Metrics are **all empty**; rows, in source order:

| Icon | Metric label | Label baseline y | Displayed value | Intended data source |
|---|---|---:|---|---|
| speed symbol | `Speed` | 196 | `—` | Measured/estimated player movement metric, provenance required |
| football | `Distance` | 239 | `—` | Movement/tracking measurement, if supported |
| pass arrow | `Passes` | 283 | `—` | Verified event detections |
| key action | `Key Passes` | 326 | `—` | Event classifications |
| expected-assist symbol | `xA (Exp. Ast)` | 370 | `—` | Model-derived metric only if an actual model exists |

Metric icons begin x=1497; labels x=1524, values x=1654; separators are drawn above nonfirst rows at x=1480. The labels do **not** represent live measurements.

- Three **gold/orange** detection-style box shapes at approximately `(967,376,109,198)`, `(1118,417,78,145)`, `(1782,398,84,166)`. Matching little dark/gold label overlays are positioned separately; their label text is blank. **Do not infer tracking identities or successful detection.**
- Bottom **cyan oval spotlight ring** `(1170,568,250,26)` with 3px border and glow.
- Target future behavior: when a legitimate featured player is selected, render backend-supported verified identity and authorized metrics; otherwise retain clean placeholder with no implied measurements. Rendering boxes from real tracking must respect identity-confidence and provenance status.
- Brief source: selected player state; canonical identity and tracking/event/metric records from existing VIE engine. For empty state no backend value is required.

---

## 3. Featured Reel panel

**Main container:** `(1990,130,532,444)`, translucent dark navy, `1.5px` outline `#12335f`, radius 14. This overlays the right side of the hero.

| Item | Actual wording / drawing | Position and style | Target frontend behavior | Brief data source |
|---|---|---|---|---|
| Preview image region | stylized person-like radial-gradient placeholder | `(2010,150,495,295)`, rounded 8px | Display genuine authorized thumbnail/video poster; neutral unavailable artwork if none | Published/eligible reel assets |
| Eyebrow | `FEATURED REEL` | `(2025,163)`, 22px semibold cyan, tracking 3px | Static section title | UI copy |
| Small verification-style badge | gold bordered dark badge containing `—` | `(2454,148,45,34)` | Display verified state only when supported, not fabricated | Reel verification/provenance |
| Play affordance | centered circular play shape | circle center `(2255,292)`, radius 46 | Playback for a real, permitted reel; disabled for missing reel | Authorized reel playback URL |
| Primary empty title | `No featured reel` | `(2025,381)`, 32px bold | Empty state; replace with real reel title when available | Reel metadata |
| Secondary empty label | `Published reels appear here` | `(2025,414)`, 25px | Empty-state explanation | Reel publishing state |
| Duration pill | `—` | rectangle `(2417,395,74,34)` | Real duration only from media metadata | Reel media metadata |
| Chip 1 | `No tags` | `(2024,447,177,43)`, light-on-navy chip | Real tag list where available; chip could filter/open reel metadata | Reel tags |
| Chip 2 | `—` | `(2216,447,117,43)` | Display real value only | Reel metadata |
| Chip 3 | `—` | `(2349,447,88,43)` | Display real value only | Reel metadata |
| View icon/count | eye + `—` | icon `(2033,542)`, text `(2060,543)` | Only real, defined view counts | Reel engagement counts |
| Like icon/count | heart + `—` | icon `(2177,542)`, text `(2204,543)` | Like/unlike with authenticated persistence if authorized | User engagement records |
| Share | share icon + `Share` | icon `(2341,542)`, label `(2370,543)` | Open approved share action; enforce export/share rights | Share grants and permissions |
| More menu | three vertically stacked dots | center `(2486,542)` | Real accessible menu of permitted actions | Reel access rights |

**Current source behavior:** all controls are graphic-only; the `PLAY()` triangle does not play media and `Share` does not open a dialog. Keep missing-count values as neutral `—` rather than `0` until an actual zero is confirmed.

---

## 4. KPI strip: four separate statistic cards

**Vertical band:** y=602–737. Four panels with a shared `P()` gradient and rounded blue border. Every value is `—` and each sparkline is exactly five dark-blue, tiny bars of uniform height 4px, **not a dataset**.

| Tile | Panel geometry | Icon | Count label / position | Secondary corner / sparkline | Intended click / data source |
|---|---|---|---|---|---|
| Matches Analyzed | `(39,602,413,135)` | camera icon; navy icon base beginning `(60,623)` | `—` at `(172,649)` 36px; `Matches Analyzed` at `(172,687)` 22px | additional `—` at x=428, y=646; sparkline starts x=365 | Open/route to match history; count real analyzed matches, scope to org and status |
| Players Tracked | `(470,602,408,135)` | persons icon, base `(499,623)` | `—` at `(609,649)`; `Players Tracked` at `(609,687)` | `—` at x=855; sparkline x=782 | Open tracked-player inventory; use actual identity/tracking records |
| Reels Generated | `(896,602,399,135)` | film reel icon, base `(917,623)` | `—` at `(1027,649)`; `Reels Generated` at `(1027,687)` | `—` at x=1270; sparkline x=1195 | Open reel library; count genuine completed reel jobs |
| Reports Created | `(1314,602,401,135)` | document icon, base `(1339,623)` | `—` at `(1444,649)`; `Reports Created` at `(1444,687)` | `—` at x=1689; sparkline x=1615 | Open report library; count genuine generated reports |

**Card visual formula:** navy panel; inner square-like blue icon pad height 86px; cyan 44px SVG icon; white main count; lighter-blue caption; muted mini-value at right. There are no loading indicators or click handlers in source. Source notes: aggregate queries over existing matches, player/tracking records, reel jobs, report records. Apply permissions and organization scope.

---

## 5. Trusted Partners / credibility card

**Container:** `(1735,602,787,135)`; same navy panel gradient and border. Section title `TRUSTED PARTNERS` at `(1767,628)`, 17px, letter spacing 5px, pale blue. Placeholder sentence at `(1767,690)`, 22px muted:

> Partner logos appear here once licensing is confirmed

**Exact source detail:** A `[].forEach(...)` loop contains unreachable logo-rendering branches. Because the array is empty, **no partner logos are displayed**. Do not turn the unused code into asserted visible partners. Placeholder remains in all clean states until rights are confirmed.

**Target UI behavior:** Show authorized partner logos, logo alt text, optional authorized outbound links and responsive layout; absent approval show exact empty text. **Brief source:** rights-approved partner/organization branding assets; governance approval state.

---

## 6. Recent Matches

**Main container:** `(39,757,791,405)`; left content card. Blue vertical accent `(55,771,5,26)`. Title `Recent Matches` at `(76,783)`, 27px semibold. `View All` appears right-aligned at `(774,786)`, 21px blue, with 20px right-arrow icon centered `(790,786)`.

### 6.1 Match rows (four drawn slots)

| Slot | Row center y | Rectangle | Visible primary / secondary text | Right metadata | Thumbnail/crest |
|---|---:|---|---|---|---|
| 1 | 855 | `(55,816,758,80)` | `No matches analysed yet` / `Uploaded matches will be listed here` | `—` | stylized pitch thumbnail at `(68,820,157,70)`; abstract crest circle at x=270 |
| 2 | 939 | `(55,900,758,80)` | `—` / `—` | `—` | stylized pitch thumbnail `(68,904,157,70)`; crest circle |
| 3 | 1024 | `(55,985,758,80)` | `—` / `—` | `—` | stylized pitch thumbnail `(68,989,157,70)`; crest circle |
| 4 | 1110 | `(55,1071,758,80)` | `—` / `—` | `—` | stylized pitch thumbnail `(68,1075,157,70)`; crest circle |

**Inside each row:** dark `#06142a` fill, `1.5px` border `#10294a`, radius 6; thumbnail includes dark duration/value chip at approx `(168, y+11, 54,22)` with `—`; crest placeholder is a white circular mark centered at `(270,y)` diameter 40; title begins x=319 at `y−14` (21px semibold), subtitle x=319 at `y+16` (18px muted); right-end metadata value `—` at x=737, and right-facing chevron icon at x=791.

**Target interactions:** `View All` navigates to the full match collection. Each real row opens selected match analysis/detail; optional thumbnail preview with permission checks. An empty collection should not imply four real matches; retain the visual layout with clearly disabled/empty slots or a faithful designed empty-state region. **Brief source:** organization-scoped uploaded match/video assets and analysis jobs with real derived metadata, thumbnail, team IDs, status.

---

## 7. Sample Reels

**Container:** `(850,757,968,405)`; vertical accent `(866,771,5,26)`. Title `Sample Reels` `(891,783)`, 27px semibold. `View All` at `(1752,786)`, blue 21px, arrow center `(1767,786)`.

### 7.1 Reel cards (three drawn slots)

| Slot | Card left x | Card panel | Preview area | Actual title / subtitle | Values |
|---|---:|---|---|---|---|
| 1 | 867 | `(866,816,300,335)` | `(867,817,298,189)` | `No reels yet` / `Generated reels appear here` | all `—` |
| 2 | 1185 | `(1184,816,300,335)` | `(1185,817,298,189)` | `—` / `—` | all `—` |
| 3 | 1502 | `(1501,816,300,335)` | `(1502,817,298,189)` | `—` / `—` | all `—` |

**Per-card complete inventory:** panel dark navy, blue border radius 10; synthetic portrait-like thumbnail fill uses slightly different gradient tones for each card; circular play affordance centered `(x+148,911)` radius 31; duration chip `(x+216,970,70,28)` with `—` centered `(x+251,984)`; title `(x+8,1030)`, 23px semibold; subtitle `(x+8,1058)` 20px muted; eye icon `(x+22,1112)` and count `(x+52,1112)`; heart `(x+140,1112)` and count `(x+168,1112)`; bookmark `(x+250,1112)`; more menu `(x+281,1112)`.

**Target interactions:** open/play authorized reel on thumbnail; view all; details; like; bookmark; more-options menu. Empty slots must not be interactive as though a clip exists. **Brief source:** permitted reel assets, media thumbnails, durations, metadata, engagement and current user's saved/liked state.

---

## 8. Platform Capabilities

**Container:** `(1841,757,681,405)`; accent stripe `(1857,771,5,26)`; heading `Platform Capabilities` `(1880,784)` 27px semibold; `View All` `(2474,786)` 21px blue, arrow center `(2489,786)`.

**Grid:** two columns × three rows, each with dark card fill, blue border, radius 8; icon backing `(cardX+15,cardY+12,78,78)`, blue-dark fill and radius 10; center icon `(cardX+54,cardY+51)` size 44; title x=`cardX+116` at y=`cardY+29`, 22px semibold; two explanation lines at y=`cardY+57` and `cardY+80`, 18px muted. Left cards width **311px**; right cards width **331px**; height **104px**.

| Row / column | Card rectangle | Icon / color | Exact heading | Exact description lines | Intended destination / source |
|---|---|---|---|---|---|
| R1 C1 | `(1855,815,311,104)` | scan, `#33a8ff` | `AI Player Detection` | `Automatically identify` / `and track all players` | Page 03/04 tracking flow; capabilities from engine |
| R1 C2 | `(2180,815,331,104)` | tactical network, `#f5b82e` | `Tactical Analysis` | `Team shape, transitions` / `and tactical patterns` | Page 05, only measured/available features |
| R2 C1 | `(1855,930,311,104)` | clap, `#8a6cff` | `Custom Reels` | `Create player highlights` / `in minutes` | Page 06, real reel workflow |
| R2 C2 | `(2180,930,331,104)` | doc, `#3ee6a8` | `Detailed Reports` | `Export shareable` / `PDF reports` | Page 08/10, rights-dependent |
| R3 C1 | `(1855,1045,311,104)` | bars, `#33a8ff` | `Team & Player Stats` | `Distances, speeds,` / `actions and more` | Page 04/08, provenance and measurement gating |
| R3 C2 | `(2180,1045,331,104)` | group, `#e84aa8` | `Collaborate & Share` | `Work with your team` / `and clients` | Page 09/10, permissions and sharing |

**Target interaction:** capability cards route to the correct real section; `View All` opens capabilities or available workflows if such a destination exists in the app. Card descriptions are **marketing copy**, not evidence that every promised analytical metric is implemented. **Brief source:** frontend route registry and engine feature/permission availability flags.

---

## 9. How It Works — five-stage illustrated workflow

**Container:** `(39,1180,2483,247)` with blue navy panel border and rounded corners. Left introductory region contains a blue accent `(63,1213,5,49)`; section title `How It Works` `(87,1238)` 34px bold; subtitle line 1 `From video to valuable insights` `(86,1291)`, subtitle line 2 `in minutes.` `(86,1327)`, 24px muted.

### 9.1 Step markers and connectors

- Five blue circular step markers, **diameter 44px**, centers `(410,1206)`, `(822,1206)`, `(1253,1206)`, `(1669,1206)`, `(2108,1206)`; labels `1`, `2`, `3`, `4`, `5`, 24px semibold white.
- Four 44px blue right-arrow SVGs centered `(777,1270)`, `(1217,1270)`, `(1632,1270)`, `(2068,1270)`. The arrows are **decorative, not buttons**.

### 9.2 Illustrated stages, captions, descriptions

| Step | Illustration and exact coordinates | Title anchor / wording | Exact two-line explanation | Intended interaction / source |
|---|---|---|---|---|
| 1 | Dashed blue upload region `(422,1200,313,112)`; 72px cloud upload icon `(573,1258)` | `(422,1339)` **Upload Video** | `Upload a match or training video` / `(MP4, MOV, up to 50 GB).` | Navigate to Upload. File types/limit from configured ingestion service |
| 2 | Pitch/video thumbnail `(838,1196,329,119)`, five skinny blue outline rectangles distributed x=870,920,975,1030,1080 at alternating y levels | `(837,1339)` **Analyze with AI** | `Our AI automatically detects players,` / `tracks the ball and extracts key events.` | Navigate to Processing/Analysis. Actual detection only from engine jobs |
| 3 | Selection panel `(1282,1196,308,120)` with three avatar rows, 28px colored avatar disks, left cyan radio-like rings, right blue `TEAM` chips | `(1281,1339)` **Select a Player** | `Choose any player and filter by` / `actions, phase, or game context.` | Navigate to player selection in Analysis; identities from canonical roster |
| 4 | Dark multi-track illustration `(1704,1196,315,122)` with five 290×10 horizontal tracks at y=1216,1236,1256,1277,1297, colored blue/gold | `(1705,1339)` **Generate Reel** | `Create a professional highlight reel` / `with custom filters and branding.` | Navigate Reel Builder; real clips/render jobs |
| 5 | Player summary graphic `(2137,1200,364,116)` with 34×40 portrait block `(2150,1210)`; `Player name` and `Position • Team` at x=2221; three KPI label/value columns; heatmap-style colorful rectangle `(2378,1214,120,96)` | `(2139,1339)` **Export & Share** | `Download a detailed PDF report` / `or share reels with your team.` | Navigate Export; export permissions, assets and reports |

### 9.3 Extra exact illustrated text / values

- Step 3 illustration contains the literal placeholder `Player name` **three times**, plus `TEAM` **three times**; rows anchored at y=1217, 1255 and 1293. They are **sample explanatory drawing labels**, not evidence of any real roster.
- Step 5 illustration contains literal `Player name` at `(2221,1222)`, `Position • Team` at `(2221,1243)`, then three empty KPI values `—` with labels `Actions`, `Distance`, `Touches`, at y=1279 and 1299; x anchors 2184, 2271, 2342. The adjacent colorful square is an **illustrative heatmap-like gradient**, not a computed heatmap.
- Step 4 bars are static colored illustration tracks, not actual editable timeline lanes.
- Step 1 `50 GB` and step 2 “automatically detects” are descriptive statements in the HTML. Confirm supported size, model limitations, and actual capabilities before presenting them as guaranteed production functionality.

**Target behavior:** Treat this entire strip as an onboarding explanation. Make each named step optionally navigate to its real corresponding workflow, but do not misrepresent the decorative mini-panels as real editor controls. **Brief source:** navigation and capability configuration; no player/match records needed to display the empty illustrated strip.

---

## 10. Exhaustive control/action checklist for React implementation

The HTML has **zero operative controls**. These are the visible potential action targets to implement; do not create invisible actions or assume drawings already work.

| Area | Targets to wire | Correct outcome when data is missing |
|---|---|---|
| Global header | 10 navigation labels; active-tab highlight; avatar/account menu | Navigation works even if destination is in truthful empty state; account menu uses real session |
| Hero | Upload Video; Paste Link | File picker or paste-link flow with validation; blocked providers get explicit truthful reason |
| Hero selected player | Player identity/metric display, if interactive selection is added | `No player selected`; all five `—` values remain neutral |
| Featured Reel | preview/play; tags where actionable; like; Share; more | Play and actions disabled or unavailable until an authorized reel exists |
| Four KPI cards | four routes/drill-down actions if designated clickable | Unknown remains `—`; avoid fake sparklines presented as trends |
| Trusted Partners | authorized logos/links if present | Exact placeholder sentence |
| Recent Matches | View All; each actual row/chevron/thumbnail | No phantom matches; disabled empty row slots |
| Sample Reels | View All; real card/thumbnail/play; like; bookmark; more | No phantom reels; disabled empty preview controls |
| Platform Capabilities | View All; six card destinations | Routes work or disclose unsupported capability accurately |
| How It Works | five step destinations, if made interactive | Explanation remains visible regardless of data; examples not selectable records |

**Interaction implementation rules:** keyboard and touch support; clear focus states; click target matches visible visual bounds; no action from decorative icon alone unless identified as the control; obey rights and roles for sharing/exports; no fake analytics on errors; asynchronous actions show pending/success/failure only in response to genuine outcomes.

---

## 11. Design reproduction and accessibility checklist

1. Preserve header y=0–100, hero y=101–601, statistics y=602–737, three central content panels y=757–1162, and process strip y=1180–1427 at the 2560×1440 reference size.
2. Maintain panel x/ranges: Recent Matches `39–830`, Sample Reels `850–1818`, Platform Capabilities `1841–2522`; 20–23px gutters.
3. Maintain KPI panel x/ranges: 39–452, 470–878, 896–1295, 1314–1715; partner panel 1735–2522.
4. Preserve navy/blue palette, gradients, 1.5px key borders, rounded panel radius 14px, cyan iconography and visibly differentiated primary/secondary actions.
5. Do not replace the hero's spotlight framing, detection-looking rectangles or featured-reel composition with a generic dashboard.
6. Retain all stated textual elements verbatim in the reference inventory. Any changes to provider claims, upload limits or feature copy must be deliberate and owner-reviewed.
7. Use actual semantic controls, accessible labels and keyboard support in React. The visual-only source has none of these.
8. Use layout and responsive techniques appropriate to the app while preserving approved **QHD composition**; `fit()` scaling is a reference behavior, not a complete responsiveness solution.
9. Handle browser zoom, smaller screens and overflow without cropping functional controls. Confirm the 2560×1440 reference screenshot independently after React conversion.
10. All content from fake-looking art is treated as decorative illustration, not proof of measured detections, official partnerships, verified endorsements or player identities.

## 12. Short backend / database source index (reference only)

| Visible Page 01 region | Data/service source category |
|---|---|
| Header | Authenticated session, organization, role |
| Upload and Paste Link | Video ingestion, provider capability/policy, queued upload/import jobs |
| Hero spotlight/metrics | Canonical selected player identity, tracking provenance, events and derived metrics |
| Featured Reel | Authorized published reel media, metadata, verification state, engagement and share rights |
| KPI strip | Organization-scoped aggregation of real match/player/reel/report records |
| Trusted Partners | Licensed branding asset registry and publishing permission |
| Recent Matches | Real video/match records, processing status, team links and thumbnails |
| Sample Reels | Rendered reel/media assets, metadata, user bookmarks/likes |
| Platform Capabilities | Navigation/configuration, actual enabled features and permissions |
| How It Works | Mostly static instructional content and route destinations |

**Important:** This is intentionally *not* a proposed SQL schema or endpoint catalog. Exact API routes, MySQL table names, authorization scopes and response fields must be grounded in the existing working engine when implementation begins.

---

## 13. Page 01 coverage and approval gate

**Complete source groups covered:** header (brand, 10 nav, QHD, account); hero (headline, CTAs, selected player, five metric labels, decorative boxes); Featured Reel (preview, play, chips, engagement and actions); four KPI cards; trusted-partner panel; four Recent Match slots; three Sample Reel slots; six capability tiles; five How It Works steps, step badges, connectors and miniature illustrations; canvas-fit behavior and style tokens.

**Known limitations of this source:** visual-only HTML; no active handlers or backend; graphic rather than semantic controls; painted placeholder media and badges; not a proof of verified data; source coordinates alone are not a pixel-diff or accessibility audit. Do not mark functionality complete on this basis.

**Owner review requested:** Verify text, layout, row counts, card counts and all intended interactive targets against the exact Page 01 you approved. **Do not proceed to Page 02 and do not mark Page 01 locked until the owner explicitly approves.**
