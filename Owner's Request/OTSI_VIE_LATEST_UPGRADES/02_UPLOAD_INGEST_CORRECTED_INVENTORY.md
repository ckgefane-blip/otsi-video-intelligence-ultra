# OTSI VIE — PAGE 02: UPLOAD & INGEST
## Ultra-detailed frontend UI inventory — actual supplied HTML

**Source inspected:** `02_UPLOAD_INGEST.html` (117 lines; document title `OTSI VIE - 02 Upload & Ingest (visual only)`).  
**Reference canvas:** 2560 × 1440 px, fixed-position absolute layout.  
**Scope:** visible frontend UI, section-by-section; concise backend/database origin alongside each functional group.  
**Status:** Page 02 working inventory for owner approval; **not locked**.  
**Evidence discipline:** text, default switch states, colors and coordinates below come from the supplied HTML source. Behaviors described as *required* are implementation requirements, **not features currently provided by the HTML**. No real backend/database was supplied with this page.

---

## 0. Global visual system, layout and implementation truth

### 0.1 Canvas, viewport and typography

- Root surface `#s`: `x=0, y=0, width=2560, height=1440`, background `#000a16`, text white, `overflow:hidden`; page outside canvas background black.
- Font stack: `"Segoe UI", "Helvetica Neue", Arial, sans-serif`. Most text is absolutely positioned, vertically centered (`transform:translateY(-50%)`), set to `white-space:nowrap`; centered or right-aligned labels use additional transforms.
- Automatic scale: `fit()` scales the complete 2560×1440 surface uniformly to the browser (`min(innerWidth/2560,innerHeight/1440)`), then centers it. **This is proportional scaling of a fixed design, not responsive reflow.**
- Base classes: `.a` absolute positioning, `.t` one-line centered text, `.b` weight 700, `.sb` weight 600, `.m` muted `#8ea3bf`, `.bl` blue `#1e90ff`, `.lb` light blue `#33a8ff`.
- Panel `.pn`: vertical dark gradient `#081a35 → #06122a`, `1.5px solid #12335f`, corner radius `14px`.
- Field `.in`: `#041022`, `1.5px solid #17406f`, radius `8px`.
- Common accents: vivid blue `#1e90ff`, active button blue `#0a84ff`, cyan `#33a8ff`, light text `#cfe0f5` / `#e3eefb`, subdued text `#9fb3cc` / `#b9cbe2`, separators `#12335f`.
- `D(x,y,w,h,...)` draws rectangular HTML divs; `T(x,y,text,size,...)` draws labels; `I(x,y,icon,size,...)` renders inline SVG glyphs; `P` draws panels; `TG` draws switches; `SEL` draws select-like fields; `TH` creates illustration thumbnails; `CREST` creates symbolic crest disks. These are render functions, **not semantic interactive controls**.
- No native `<button>`, `<input>`, `<select>`, `<textarea>`, anchor navigation, click handlers, file picker, drag-drop handler, API calls, upload progress logic or persisted application state exists in this HTML. Only the `resize` listener and initial drawing execute. All apparent interactions below must be implemented in the actual application.
- All images, thumbnail mockups, crests, labels and progress bars in this source are CSS/SVG drawings, **not actual uploaded-media previews**. Do not translate illustrative content into factual records.

### 0.2 Three-column composition

| Region | Source positioning | Design role |
|---|---|---|
| Shared header | `x=0,y=0,w=2560,h=100` | Branding, ten route entries, user status |
| Left, Match Context | `(22,122,383,356)` | Optional competition/season/match context |
| Left, Filters / Overlays / AI Tools | `(22,496,383,922)` | 14 option switches with grouped settings |
| Middle, heading and mode selector | `x≈438–1900,y≈128–311` | Page heading/help and three ingest routes |
| Middle, upload drop zone | `(438,329,1453,538)` | Local video selection and URL entry |
| Middle, supported formats | `(438,886,1455,162)` | Eight format tiles |
| Middle, processing pipeline | `(438,1068,1462,358)` | Five stages and live-preview cells |
| Right, Recent Uploads | `(1923,134,612,626)` | Five recent-upload row slots |
| Right, Selected Item Preview | `(1923,777,612,641)` | Selected media preview, metadata and edit button |

**Geometry caution:** Positions in the HTML are reference coordinates, not proof of collision-free rendering at every DPI. The middle and right panels have only narrow gutters. Preserve the approved composition while fixing overflow only with visual verification.

---

## 1. Shared global header — `y=0–100`

**Geometry:** full-width rectangle `(0,0,2560,100)`, background `#071a33`, `1.5px` blue bottom border.

### 1.1 Branding
- Main brand: `OTSI` at `(30,38)`, 40px bold white; `VIE` at `(130,38)`, 40px bold blue `#1e90ff`.
- Subtitle: `VIDEO INTELLIGENCE ENGINE` at `(31,73)`, 13px bold blue.
- No imported bitmap logo in this HTML; the identity is rendered as typography.

### 1.2 Ten navigation labels, order, reference anchor and state

| # | Exact label | Text x / y | Font | Current page state | Required action |
|---|---|---|---|---|---|
| 1 | Home | 381 / 52 | 24px semibold | Inactive | Navigate Home |
| 2 | Upload | 548 / 52 | 24px semibold | **Active**, `#6cc4ff` bold | Stay on Upload |
| 3 | Processing | 700 / 52 | 24px semibold | Inactive | Navigate Processing |
| 4 | Analysis | 889 / 52 | 24px semibold | Inactive | Navigate Analysis |
| 5 | Tactical | 1067 / 52 | 24px semibold | Inactive | Navigate Tactical |
| 6 | Reel Builder | 1215 / 52 | 24px semibold | Inactive | Navigate Reel Builder |
| 7 | Clip Studio | 1396 / 52 | 24px semibold | Inactive | Navigate Clip Studio |
| 8 | Player Report | 1555 / 52 | 24px semibold | Inactive | Navigate Player Report |
| 9 | Library | 1766 / 52 | 24px semibold | Inactive | Navigate Library |
| 10 | Export | 1942 / 52 | 24px semibold | Inactive | Navigate Export |

- Active Upload decoration: translucent blue outlined rounded rectangle `(502,12,169,78)`; blue lower underline `(511,92,150,5)`.
- Right separator `(2117,20,2,62)` dark blue.
- QHD outlined badge `(2140,23,100,54)`; `QHD` at `(2190,50)` 20px bold cyan, centered.
- Owner avatar: blue circular disk `(2271,25,54,54)` with `O` centered `(2298,52)`, 22px bold.
- Owner text `(2340,41)` `Owner` at 24px bold and `(2340,69)` `OTSI VIE` 19px muted.
- **Behavior required:** actual routes, active indicator following current route, authenticated owner menu (if present in the implemented app), keyboard access. The HTML currently has no routing or profile interaction.
- **Backend/DB source (brief):** authenticated session / organization identity for avatar and account; navigation is frontend routing, not DB data.

---

## 2. Left column — Match Context (Optional)

**Container:** panel `(22,122,383,356)`; title `Match Context` at `(42,153)` 25px semibold; adjacent `(Optional)` `(214,153)` 21px muted; collapse/up icon centered `(376,153)`, 20px.

| Field | Label location / style | Drawn selection box | Initial text | Required behavior | Data source |
|---|---|---|---|---|---|
| Competition | `(41,196)` 20px | `(41,211,345,54)` | `Choose competition` | Open choices, select competition, clear/change; optionally filter seasons and matches | Competitions stored in existing DB |
| Season | `(41,292)` 20px | `(41,308,345,54)` | `Choose season` | Choose season; scope list by competition where applicable | Seasons / competition associations |
| Match | `(41,389)` 20px | `(41,404,345,55)` | `Select match (optional)` | Choose linked match or leave unassigned; selected value available to upload form | Existing match records |

- Select fields each show right chevron icon (18px) and muted placeholder text (20px). Drawn in dark `#041022` with thin `#17406f` border, radius 8px.
- Heading up-chevron suggests collapse/expand; this behavior is not programmed.
- Optionality applies to the **Match Context section**, not an implied mandatory match ID. The HTML has no labels for mandatory fields or error messages.
- **Behavior required:** controlled dropdowns, dependent data, valid blank context, loading/empty/error states, validation before optional association. Do not fabricate dropdown options.
- **Backend/DB source:** competition, season, match and upload-to-match association in the existing engine database.

---

## 3. Left column — Filters / Overlays / AI Tools settings

**Container:** panel `(22,496,383,922)`. Top tab bar:
- `Filters` `(41,528)` 22px semibold cyan, **selected**; underline `(24,555,97,3)` blue.
- `Overlays` `(151,528)` 22px normal pale text, unselected.
- `AI Tools` `(289,528)` 22px normal pale text, unselected.
- Baseline divider `(24,560,380,1)`.
- The HTML does not provide alternate tab content: only the currently drawn Filters content exists in this file. The other two tabs' contents are **unspecified by this HTML**; do not invent exact inventory fields for them.
- **Behavior required:** tab switching, preserve unsaved settings when switching; define tab-specific content from approved assets/requirements before implementing it.
- **Backend/DB source:** selected ingest and processing configuration, persisted with job/upload as appropriate; optional owner/user defaults.

### 3.1 Visual Processing — five switches

Group title: `Visual Processing` `(42,593)`, 22px semibold. Each row uses icon at x=61 (28px), label x=97 (20px), toggle track x=337 (48×28px) centered at the recorded y. Blue track `#0481f9` signifies drawn ON; dark `#26364d` signifies drawn OFF. White thumb 22×22px.

| Order | Label exactly as HTML | Icon | Center y | Drawn default | Actual HTML behavior | Intended application effect |
|---|---|---|---|---|---|---|
| 1 | Stabilize Video | `stab` | 637 | **ON** | Static | Include video stabilization in processing configuration |
| 2 | Auto Crop Pitch | `crop` | 683 | **ON** | Static | Enable pitch-aware cropping when supported |
| 3 | Enhance Quality | `enh` | 728 | **ON** | Static | Enable configured video enhancement |
| 4 | Remove Crowd Noise | `vol` | 775 | **OFF** | Static | Enable supported crowd-noise reduction |
| 5 | Correct Aspect Ratio | `asp` | 821 | **ON** | Static | Enable aspect-ratio correction when appropriate |

**Behavior required for each:** accessible switch, immediate visible ON/OFF state, store boolean in form state, include in job submission, restore existing settings from persisted draft/job; no assertion that an unavailable AI transformation has run merely because ON is selected. Compatibility constraints and execution support must be reflected truthfully.

### 3.2 AI Overlays (Auto-Detect) — five switches

Group title: `AI Overlays` `(42,891)` 22px semibold, secondary `(Auto-Detect)` `(163,891)` 22px muted. Row icon at x=61, label x=97, switch track x=337.

| Order | Label exactly as HTML | Icon | Center y | Drawn default | Intended application effect |
|---|---|---|---|---|---|
| 6 | Players & Teams | `ppl` | 937 | **ON** | Static | Request player/team recognition overlays |
| 7 | Ball Tracking | `ball` | 982 | **ON** | Static | Request ball tracking overlay |
| 8 | Jersey Numbers | `jer` | 1027 | **ON** | Static | Request jersey-number observations; never equate OCR with verified identity |
| 9 | Pitch Lines | `pit` | 1072 | **ON** | Static | Request pitch-line visualization |
| 10 | Event Markers | `mk` | 1118 | **OFF** | Static | Request detected-event markers |

**Behavior required:** boolean values affect configuration and resulting overlay visibility where supported; distinguish detected, inferred, confirmed and unavailable data. Do not render invented player IDs or marker events.

### 3.3 Ingest Options — four switches

Group title: `Ingest Options` `(42,1188)` 22px semibold.

| Order | Label exactly as HTML | Icon | Center y | Drawn default | Intended application effect |
|---|---|---|---|---|---|
| 11 | Auto Create Match | `cal` | 1236 | **ON** | Static | Create/link match record after appropriate metadata validation, avoid duplicates |
| 12 | Extract Metadata | `meta` | 1282 | **ON** | Static | Read actual file/video metadata |
| 13 | Generate Highlights | `hl` | 1328 | **OFF** | Static | Request supported highlights workflow (not proof of render) |
| 14 | Send to Analysis | `snd` | 1373 | **ON** | Static | Queue eligible item for real analysis when ingest succeeds |

**Settings consistency:** all 14 initial ON/OFF positions in this table are drawn illustration defaults; they are not saved user preferences or measured service capability. In the real application, load defaults or persisted preferences from an established configuration source; confirm each state is consistent with selectable processing modes.
- **Backend/DB source (entire group):** per-upload / per-job processing options, owner settings if supported, analysis/render job queue records; real machine processing status sourced separately.

---

## 4. Center header and assistance

- Header icon backing: outlined square `(442,128,50,50)`, border 2px cyan, radius 10px, centered media-related SVG at `(468,153)` 30px.
- Heading `Upload & Ingest` starts `(513,150)`, **46px bold**.
- Subtitle starts `(513,198)`, **24px** light text: `Bring your football footage into OTSI VIE. We automatically detect, track and analyse your video.` Preserve the original source's British spelling `analyse` unless owner directs otherwise.
- Help control: outlined field `(1691,135,200,65)`, help-circle icon center `(1730,168)` 34px, `Need help?` at `(1760,168)` 22px.
- **Required interactions:** help opens accurate upload instructions, support panel or approved relevant destination; heading/icon are informational.
- **Backend/DB source:** static documentation; support content only if actually hosted.

---

## 5. Center acquisition mode selector — three ingest tabs

**Container:** `(438,238,1453,73)`, dark base `#06142a`, blue-grey border `#12335f`, 10px corner radius.

| Tab | Drawn location | Icon | Label / font | Initial state | Required behavior |
|---|---|---|---|---|---|
| Upload File | first third, active backing `(438,238,485,73)` | Cloud centered `(619,274)` 44px | `Upload File` at `(658,275)`, 27px semibold cyan | **Active** blue gradient `#0a2b55 → #083a70`, 4px bottom blue border | Show file selection and drag/drop upload flow |
| YouTube / URL | middle, icon `(1078,275)` | YouTube icon 40px | `YouTube / URL` at `(1119,275)`, 26px | Inactive | Show link import form appropriate to supported providers |
| Batch Upload | right, icon `(1573,275)` | Layers icon 40px | `Batch Upload` at `(1610,275)`, 26px | Inactive | Multi-file queue and per-item status when implemented |

- Right-side vertical separator at `(1409,255,1.5,40)`.
- **Critical source truth:** this HTML draws just one shared upload surface beneath the tabs; it does **not** contain three distinct functional tab implementations. URL entry is visible even while Upload File is selected. Preserve that fact in inventory rather than assuming mutually exclusive screens are already implemented.
- **Backend/DB source:** file-ingest or URL-import submissions and batch ingest queue, using actual supported engine input adapters.

---

## 6. Center upload/drop zone and direct URL field

### 6.1 Main drop zone

- Boundary `(438,329,1453,538)`, dashed **2.5px** border `#1e90ff`, radius 6px.
- Background: blue radial glow around upper center; deep-blue vertical gradient fading through pitch green near bottom. Ten small simulated illuminated dots are drawn along upper interior; these are decorative.
- Central stylized cloud: large outlined shape `(1090,388,172,132)`, `12px` blue stroke; upload icon centered `(1176,484)` size 90px. It is drawn CSS/SVG, not an actual file input.
- Main prompt centered at `(1181,561)` **38px bold**: `Drag and drop your video file here`.
- Helper centered at `(1181,610)` 24px: `Supports MP4, MOV, AVI, MKV and more  •  Max file size 50 GB`.
- File button `(1017,649,330,68)`, blue `#0a84ff`, radius 8px; folder icon at `(1100,683)` 40px, text `Browse Files` at `(1141,683)` 26px semibold.
- Horizontal split rules from `(815,746)` and `(1215,746)` (each width 340, 1px), text `or` centered `(1185,747)` 20px.

**Required behavior:** clicking Browse Files opens native file picker; drop zone accepts files through drag/drop; keyboard operability; validate actual file size and extensions/MIME/content according to engine policy; show file selection, errors, progress, retry and success only on authenticated server response; avoid silently uploading before an intended user confirmation if the chosen workflow requires one. A **50 GB display maximum** is a visual claim, not a proven current backend limit; use the real configured limit and reconcile with approved copy.

### 6.2 Link input and add action

- URL-like field `(631,775,886,64)`, translucent dark background, 1.5px blue-grey border, radius 8px.
- Link icon centered `(672,807)` 30px; placeholder at `(716,807)` 22px muted: `Paste YouTube link or direct video URL...`.
- `Add URL` drawn action `(1534,775,170,64)`, dark background `#041022`, bright 2px blue border, radius 8px; label `(1559,807)` 23px semibold; arrow glyph `(1668,807)` 24px.
- **Required behavior:** editable URL field, syntactic validation, supported-provider detection and explicit unsupported/restricted-provider error, consent/rights handling as required, submission to real import service, truthful task status. Do not promise YouTube support merely because tab or placeholder says YouTube; import eligibility is governed by actual engine/provider rules.
- **Backend/DB source:** secure ingest endpoint, URL-source record, import job and rights/metadata provenance; credentials managed server-side, never embedded in UI.

---

## 7. Supported Formats — eight card inventory

**Container:** `(438,886,1455,162)`; heading `Supported Formats` `(459,913)` 24px semibold; right `View all formats` `(1869,913)` 20px blue and right-aligned.

Eight dark format cards aligned with y=940, height 90, `#06142a`, 1.5px `#12335f` border, radius 8px; each uses a 40px document icon at x+36 and centered vertically near y=972; format label at x+72,y=970,20px semibold, codec detail at x+72,y=1000,17px muted.

| # | Format | Codec text exactly shown | Card x | Card width | Card y/height |
|---|---|---|---|---|---|
| 1 | MP4 | H.264/H.265 | 463 | 164 | 940 / 90 |
| 2 | MOV | Apple ProRes | 643 | 173 | 940 / 90 |
| 3 | AVI | H.264 | 832 | 146 | 940 / 90 |
| 4 | MKV | H.264/H.265 | 994 | 171 | 940 / 90 |
| 5 | MPEG | MPEG-2 | 1181 | 165 | 940 / 90 |
| 6 | FLV | H.264 | 1362 | 158 | 940 / 90 |
| 7 | TS | MPEG-TS | 1536 | 163 | 940 / 90 |
| 8 | WEBM | VP9 | 1715 | 155 | 940 / 90 |

- **Required behavior:** `View all formats` opens actual support guide or full validated list; cards may remain informational unless specifically designated interactive by approved behavior. No codec acceptance should be claimed from the static list alone.
- **Backend/DB source:** effective ingest capability policy and decoder support configuration; no DB requirement for the visual cards themselves.

---

## 8. Processing Pipeline — five stages

**Outer panel:** `(438,1068,1462,358)`; target icon centered `(458,1093)` 34px; title `Processing Pipeline` `(487,1094)` 25px semibold.

### 8.1 Stage 1 — Uploading

- First stage card `(438,1122,319,155)`, blue-tinted `#04264a`, blue 2px border `#1e90ff`, radius 10px — visually emphasized.
- Blue circular disk `(451,1129,52,52)` with upload arrow at `(477,1155)` 30px.
- Title `Uploading` `(515,1154)` 24px semibold cyan.
- Small dark circular marker `(464,1204,26,26)`; descriptive status at `(516,1196)` `No file uploaded` 18px, `(516,1223)` `Awaiting upload` 18px.
- Empty progress track `(457,1246,282,12)` `#12335f`, radius 6px.
- **Required behavior:** real upload state (idle/queued/transferring/failed/completed), server-confirmed bytes, retry/cancel if supported. Current highlighted card does **not** imply a job is actually running.

### 8.2 Stages 2–5: geometry and wording

All four are dark inactive cards y=1122, height 155, radius 10px, light `#12335f` border, with 48px numbered ring, cyan title, custom SVG, two description lines, `Waiting...` status and empty 10px progress track.

| Stage | Card x / width | Number badge center x | Title / title anchor x | Icon | Description lines (exact) | Wait status |
|---|---|---|---|---|---|---|
| 2 | 760 / 290 | 811 | `AI Detection` / 846 | `bars` | `Detecting players, ball` / `and match context...` | `Waiting...` |
| 3 | 1053 / 287 | 1105 | `Tracking` / 1140 | `tgt` | `Tracking players, ball,` / `team shapes, events...` | `Waiting...` |
| 4 | 1346 / 275 | 1393 | `Indexing` / 1428 | `db` | `Indexing key moments` / `and metadata...` | `Waiting...` |
| 5 | 1627 / 263 | 1674 | `Analysis Ready` / 1709 | `ckc` | `Ready for analysis` / `and highlights...` | `Waiting...` |

- Number-ring centers y=1146; label sizes: badge text 22px semibold, stage titles 22px, descriptions 17px, wait state 17px muted.
- Stage icon centers sourced from HTML: 828,1123,1411,1692 at y=1194, size 34px. Description anchors at x=864,1158,1446,1727; lines y=1183/1206.
- Each progress track at y=1253, height=10. Stage connectors: arrow icons at `(775,1200)`, `(1069,1200)`, `(1358,1200)`, `(1640,1200)` size 26. These may visually overlap card boundaries by design.
- **Required behavior:** real job stage/status timestamps/progress when measurable; waiting/failed/skipped/succeeded state; valid route into Processing; no invented percentages, completion, ETA or detection outputs.
- **Backend/DB source:** real ingest/analysis job state, stage events and processing progress in the existing job system/database.

### 8.3 Live Processing Preview — four lanes

- Nested preview frame `(438,1290,1462,136)` with translucent dark background, border and radius 10px.
- Heading `Live Processing Preview` at `(457,1300)` 19px; small gray dash `(677,1300,14,2)`.
- Four drawn faux video thumbnails y=1316, height 74; dividers at `(868,1305,1,110)`, `(1197,1305,1,110)`, `(1570,1305,1,110)`.

| # | Preview label | Thumbnail x / width / y / height | Thumbnail drawn gradient | Status indication | Source |
|---|---|---|---|---|---|
| 1 | Player detection | 457 / 396 / 1316 / 74 | football-pitch-like CSS image | Empty track; no check | Actual detection preview when available |
| 2 | Ball tracking | 883 / 299 / 1316 / 74 | football-pitch-like CSS image | Empty track; no check | Actual ball tracking preview when available |
| 3 | Team identification | 1212 / 343 / 1316 / 74 | football-pitch-like CSS image | Empty track; no check | Actual classified team preview when available |
| 4 | Metadata | 1585 / 297 / 1316 / 74 | football-pitch-like CSS image | Empty track; no check | Actual extraction/metadata preview when available |

- Label y=1408, 17px light; slim 7px progress strips are drawn near label positions. All four initial flags are `0`, so no green check marks are drawn in the supplied HTML.
- **Required behavior:** replace drawn illustrative thumbnails with genuinely generated job previews when they exist; display empty/awaiting/unsupported states otherwise; labels may act as drill-down only if defined by the app.
- **Backend/DB source:** actual processing preview media and stage output metadata from job artifacts/storage.

---

## 9. Right column — Recent Uploads

**Container:** `(1923,134,612,626)` with title `Recent Uploads` at `(1943,165)` 28px semibold; `View All` right-aligned at `(2506,166)` 20px cyan; divider `(1943,198,574,1)`.

Five repeatable item slots, all visual drawings. Each row has a faux thumbnail `(1943,y−44,153,88)`, a small dark duration badge `(2034,y+17,58,24)`, title at x=2115 / row-specific y, metadata text x=2115, and vertical-more icon `(2510,y)` 22px. Row separators appear under rows 1–4.

| Row | Thumbnail center base y | Thumbnail top y | Title text | Secondary text | Badge value | More-menu icon |
|---|---|---|---|---|---|---|
| 1 | 251 | 207 | `No uploads yet` | `Uploaded videos appear here` | `—` | `(2510,251)` |
| 2 | 360 | 316 | `—` | `—` | `—` | `(2510,360)` |
| 3 | 471 | 427 | `—` | `—` | `—` | `(2510,471)` |
| 4 | 583 | 539 | `—` | `—` | `—` | `(2510,583)` |
| 5 | 697 | 653 | `—` | `—` | `—` | `(2510,697)` |

- Source fields include additional blank row text lines; do not interpret the four dash rows as actual uploads.
- Four bottom dividers: `x=1943`, width 574, heights 1 at y=305,414,525,637 respectively.
- **Required behavior:** real recent upload query, sort order (normally most recent), loading and one true empty state rather than five fabricated rows; select a row to update selected preview, more-menu with only authorized actions, `View All` opens full uploads/library view.
- **Backend/DB source:** actual upload/media records, storage, created timestamp, processing status and authorized record actions.

---

## 10. Right column — Selected Item Preview

**Outer panel:** `(1923,777,612,641)`; header `Selected Item Preview` `(1945,811)` 26px semibold.

### 10.1 Preview visual and empty message

- Illustrative rectangular poster `(1948,846,255,174)`, stylized athlete-gradient background, radius 6px.
- Drawn circular playback backing `(2040,918,56,56)`, white play triangle `(2058,933,22,26)`.
- Small duration pill `(2130,983,66,30)` and `—` centered `(2163,998)` 20px.
- Main status to right: `No video selected` `(2222,860)` 22px semibold; help `Select an upload to preview` `(2222,890)` 20px muted; `—` `(2222,919)` 20px muted.
- **Required behavior:** selecting real upload displays playable preview if a supported streaming/transcode URL exists; empty state should not masquerade as a playable uploaded clip. Respect rights and authorization; no assumption that preview media exists.

### 10.2 Metadata rows — exact visible labels

Each icon at `(1962,rowY)` 26px, label x=1997 20px pale, value x=2180 20px light. Rows are drawn, not actual stored values.

| Order | Label | Empty-state value | Center y | Source when selected |
|---|---|---|---|---|
| 1 | File Name | `No file uploaded` | 1056 | Stored original filename |
| 2 | File Size | `—` | 1097 | Stored byte count, formatted |
| 3 | Resolution | `—` | 1139 | Probed video width × height |
| 4 | Frame Rate | `—` | 1180 | Probed rational FPS |
| 5 | Duration | `—` | 1222 | Probed stream duration |
| 6 | Detected Content | `Not classified` | 1263 | Actual classifier output, with provenance/confidence |

### 10.3 Teams (Detected)

- People icon at `(1962,1306)` size 26; label `Teams (Detected)` at `(1997,1306)` 20px pale.
- Two symbolic colored crest circles centered `(2198,1306)` and `(2336,1306)`, diameter 38; dash values at `(2229,1306)` and `(2366,1306)`.
- **Required behavior:** display actual team association/detection only if available; no automatic promotion of appearance/color classification into confirmed team identity. Neutral unavailable visuals should not imply two teams were identified.
- **Backend/DB source:** analysis team-detection output and linked match-team identity with verification status.

### 10.4 Edit Metadata action

- Prominent blue button rectangle `(1950,1342,561,54)` radius 8px; edit icon `(2162,1370)` size 26; text `Edit Metadata` `(2190,1370)` 23px semibold.
- **Required behavior:** enabled only for an authorized selected item; opens actual metadata editor populated from persisted data; validates and saves editable metadata; handles pending/error/success; does not silently overwrite extracted provenance or immutable IDs.
- **Backend/DB source:** existing media record / match context / metadata update endpoint with authorization and audit where required.

---

## 11. Visible control/action wiring checklist (frontend-first)

This checklist exhausts action-bearing visual categories present in the source. **All are currently static drawings.** Backend references are concise intentionally.

| UI element or group | Count | Required frontend behavior | Brief backend/DB source |
|---|---:|---|---|
| Global top navigation labels | 10 | Route navigation and active state | Frontend router/session |
| Owner avatar/details | 1 grouping | Open authenticated owner profile/menu if approved | Session/users/org |
| QHD badge | 1 | Visual indicator; not inherently an action | Static UI |
| Match Context collapse glyph | 1 | Expand/collapse card | Local UI state |
| Match Context selects | 3 | Choose optional competition/season/match, dependents and validation | Competition/season/match |
| Settings top tabs | 3 | Switch Filters/Overlays/AI Tools view; retain state | UI state + saved prefs |
| Visual Processing switches | 5 | Toggle and persist actual request values | Ingest config/job |
| AI Overlays switches | 5 | Toggle requested overlay modules | Ingest config/job |
| Ingest Options switches | 4 | Toggle ingest/analysis job options | Ingest config/job |
| Need help? | 1 | Open help/support | Documentation |
| Ingest route tabs | 3 | Switch Upload File / YouTube-URL / Batch flows | Upload/import services |
| Drop zone | 1 | Accept and validate file drop | File ingest |
| Browse Files | 1 | Open native picker, validate file | File ingest |
| URL field | 1 | Editable, validates user URL | Import intake |
| Add URL | 1 | Submit URL import, show real outcome | Import job |
| View all formats | 1 | Open supported-format guide | Capability policy |
| Five stage pipeline cards | 5 | Render real stage status/progress; optional drilldown | Processing jobs |
| Four live preview cells | 4 | Render actual stage previews as available | Processed artifacts |
| Recent Uploads View All | 1 | Navigate full uploads list | Media records |
| Recent upload row actions/selection | 5 slots | Select, reveal authorized more-menu actions | Media records |
| Selected preview play | 1 | Play real accessible video when selected | Media streaming |
| Edit Metadata | 1 | Open real editor and save changes | Media metadata |

**Non-interactive by default unless separately specified:** brand wordmark, header subtitle, helpfully worded field labels, decoration circles, format cards, informational section titles, progress connector arrows, synthetic crest/thumbnail drawings.

---

## 12. Important UX/integrity constraints for implementation

1. **No invented content:** the source shows explicit empty text (`No uploads yet`, `No video selected`, `No file uploaded`, `Not classified`, dashes). Keep empty states truthful. Do not turn placeholder thumbnails or badges into false records.
2. **Do not confuse controls with functionality:** 14 switches are drawn `TG` shapes. Implement actual switch components and wire every value into a real processing request or accurately show it as unsupported/unavailable.
3. **Context is optional:** match selection is optional, must not block a valid standalone upload unless actual engine policy demands otherwise.
4. **Upload validity:** 50 GB is displayed as design copy, not proven backend capacity. File type tiles likewise represent *claimed* formats; verify effective server acceptance before advertising support as guaranteed.
5. **Provider rights:** `YouTube / URL` is a visible tab, **not evidence that YouTube ingestion is permitted or technically connected**. Preserve correct provider-specific failures and rights checks.
6. **Pipeline truth:** all stages start waiting/empty; do not manufacture percentages, stage completion, analysis results, throughput or previews.
7. **Ingest vs analysis:** user can request Send to Analysis, but completed upload and successfully created analysis job are distinct states.
8. **Trust and identity:** displayed team/jersey detection must not be conflated with verified player identity.
9. **Protection:** credentials, signed upload/download URLs and permission decisions belong in authorized backend services, not browser storage or HTML.
10. **Section parity:** keep the fixed dark QHD composition, preserve all 14 switch labels, all 8 format cards, all 5 pipeline stages, all 4 live-preview lanes and all 6 metadata fields.
11. **No unsupported UI invention:** the specific contents of inactive `Overlays` and `AI Tools` settings tabs are not in this supplied HTML; flag them for user-provided design, rather than fabricating them as if present.
12. **Accessibility:** all required clickable drawings need focusable semantic elements, keyboard access, visible focus, labels, disabled/saving states; retain design fidelity.

---

## 13. Acceptance checks for the implemented Page 02 UI

### Exact visual inventory checks
- [ ] All ten navigation entries visible in original order; Upload active highlight aligns with the supplied HTML.
- [ ] Header branding, owner block and QHD badge match scale/placement.
- [ ] Optional Match Context panel holds Competition, Season and Match selectors.
- [ ] Left settings panel displays Filters/Overlays/AI Tools and the **14 named switches** with correctly shown saved states.
- [ ] Main heading and Need help? control present.
- [ ] Three ingest modes visible with Upload File selected by default.
- [ ] Drop zone, 50 GB displayed guidance (subject to validated effective limit), Browse Files, URL input and Add URL are present.
- [ ] Eight format tiles exactly named and in documented order.
- [ ] Five pipeline cards, original wording and four preview cells remain present.
- [ ] Recent Uploads panel and five available visual row positions preserved without fictional records.
- [ ] Selected Item Preview includes poster, playback affordance, six metadata rows, two detected-team slots and Edit Metadata.
- [ ] 2560×1440 screenshot visually compared against supplied HTML: colors, spacing, typography and geometry; no clipped controls.

### Functional checks (requirements; not current HTML behavior)
- [ ] Match selects populate from real available options, permit optional selection, enforce valid dependent selections.
- [ ] Every visible settings toggle responds to pointer and keyboard, updates local state, is included in actual ingest config and restores appropriate persisted state.
- [ ] Both settings tabs not evidenced by this HTML are implemented only from approved specifications, not invented.
- [ ] File picker and drag/drop handle supported files, reject invalid ones, and display authentic progress, failure and completion states.
- [ ] URL workflow validates and delegates to real supported importer; rejected providers show honest reason.
- [ ] Batch flow, when specified, supports item-level actual statuses rather than static batch illustrations.
- [ ] Pipeline receives and displays real job status; stale/offline conditions identified without imaginary analytics.
- [ ] Recent Uploads selects a real item and correctly updates selected preview/metadata.
- [ ] Selected preview playback functions only when a genuine playable video exists and user has rights.
- [ ] Metadata editor saves authorized changes and reflects refreshed records.
- [ ] No console errors, inaccessible controls, fabricated records or fake success messages.

### Source-to-inventory trace references

| Coverage | HTML line range (source) |
|---|---|
| Global styles, drawing primitives, switches/selects | 3–38 |
| Header and navigation | 40–46 |
| Match Context and all 14 switches | 48–61 |
| Heading, help, mode tabs and upload area | 63–77 |
| Eight supported format cards | 78–81 |
| Five-stage pipeline and four preview cells | 82–97 |
| Recent Uploads and five placeholder rows | 99–105 |
| Selected Item Preview, metadata and edit action | 106–113 |
| Fixed-canvas auto-fit logic | 115–116 |

---

**Owner review gate:** Page 02 remains **DRAFT / NOT LOCKED**. Do not proceed to Page 03 until the owner approves Page 02 inventory.
