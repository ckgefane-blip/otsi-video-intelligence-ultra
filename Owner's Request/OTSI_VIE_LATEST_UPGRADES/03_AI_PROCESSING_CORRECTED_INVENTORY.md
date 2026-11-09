# OTSI VIE — PAGE 03: AI PROCESSING PIPELINE
## Ultra-Comprehensive Frontend UI Inventory — Verified Against Supplied HTML

**Review status:** DRAFT — awaiting owner review; **not locked**.  
**Source:** `03_AI_PROCESSING.html` supplied for Page 03.  
**Scope:** The **actual visual frontend represented by this HTML**, with intended interactions explained and **brief** backend/database source notes. This is **not** a backend design document, and the depicted UI is **not yet wired**.  
**Coordinate system:** Fixed **2560 × 1440 px**, origin `(0,0)` at top left. Box specifications are expressed as `x, y, width, height` in pixels. Text positions below are the explicit `T()` coordinates unless otherwise indicated; `T()` sets the element’s top at `centerY − fontSize/2`. Text uses `line-height:1` and nowrap.  
**Source notation:** HTML source lines refer to the original uploaded file, not this inventory. All exact colors/text/positions recorded here come from that HTML; proposed interactions are **implementation requirements**, not existing behavior.

---

## 00. Global visual foundation and implementation status

### 00.01 Root viewport / scaling
- Root canvas: `#s`, fixed **2560 × 1440 px**, dark background `#050d1c` (`--bg`), `overflow:hidden`; page/background outside canvas is black `#000`.
- `fit()` scales the entire fixed canvas by `min(window.innerWidth / 2560, window.innerHeight / 1440)`, then centers it. It **does not reflow or responsively rearrange** the layout. Resize handler re-applies the scale.
- Base font: `"Segoe UI", "Helvetica Neue", Arial, sans-serif`; white foreground `#fff`. No external fonts, CSS frameworks, or image files are referenced.
- Shared muted text variable `--mut:#8ea3bf`; shared line variable `--line:#12335f`.
- All UI elements in this source are generated from JavaScript string fragments into `#s` with `innerHTML = o.join('')`. Helpers: `D()` for positioned boxes, `T()` for text, `BAR()` for narrow cyan accent bars; other HTML snippets (including progress-bar `<i>` tags) are embedded in generated markup.
- Most positioning is absolute. There are no semantic page sections, React components, native `<button>`, `<input>`, `<select>`, `<video>`, or `<canvas>` media controls, nor application API calls in the supplied HTML.
- **Critical separation:** A visible tab, dropdown, switch, play icon, timeline, stage progress bar or KPI in this file is **drawn only**. Its intended future behavior must not be described as presently implemented.

### 00.02 Shared visual components
| Component | Exact source styling | UI role |
|---|---|---|
| `.box` | `1.5px solid #12335f`; `border-radius:10px`; gradient `180deg,#081a35 → #06122a` | Main pane and card surfaces |
| `.t` | `white-space:nowrap;line-height:1` | Absolute single-line text (potential clip risk) |
| `.b` | `font-weight:700` | Bold headings |
| `.m` | `color:#8ea3bf` | Secondary muted text |
| `.c` | `transform:translateX(-50%)` | Horizontally centered text at explicit x |
| `.sel` | `1.5px solid #17355f`, `6px` radius, `#0a1d38`, height `36px`, text `18px` | Drawn selectors (not real dropdowns) |
| `.pill` | `18px` radius, height `36px`, text `19px`, weight `600`, flex-centered | Drawn status labels |
| `.pb` | Height `8px`, radius `4px`, background `#17304f`; inner blue `#1a8cff` | Progress track; in initial state fill `0%` |
| `.ph` | Rounded `4px`, `linear-gradient(135deg,#1b4d8f,#0b2a52 55%,#2a6a3a)` | Placeholder visual field |
| `.tg` | `55 × 30px`, blue `#1580ff`, knob `22 × 22px` on right | Drawn ON toggle |
| `BAR()` | `7px` width, blue `#1e90ff`, `3px` radius | Accent markers on panel headings |

**Overall composition:** 100px fixed global header; headline/match-job summary beneath; five-stage pipeline across upper middle; main preview left; four analysis tiles middle; log and resource panels right; timeline and output-summary panels along bottom.

---

## 01. Global application header (x=0–2560, y=0–100)

### 01.01 Header background
- Rect: `(0,0,2560,100)`, background `#040b18`, bottom border `1.5px solid #123a6e`.
- The Page 03 header **differs in background value** from some other supplied pages. Preserve this source fact; do not silently normalize without owner approval.

### 01.02 Product wordmark
- Left label: `OTSI` followed by inline `VIE` in blue `#1e90ff`.
- Anchor: `(30,38)` centerY, font `40px`, weight 700, letter-spacing `2px`.
- Second line: `VIDEO INTELLIGENCE ENGINE` at `(31,73)`, `13px`, bold, letter-spacing `0.8px`, blue `#2d9bff`.
- The logo is **styled text**, not an external logo asset.

### 01.03 Navigation — ten items, exact ordering
- Nav text top is `40px`, font size `24px`, semibold `600` via `.n`.
- Labels and left coordinates: **Home 381; Upload 548; Processing 700; Analysis 889; Tactical 1067; Reel Builder 1215; Clip Studio 1396; Player Report 1555; Library 1766; Export 1942**.
- `Processing` is highlighted blue `#4db3ff`, weight 700.
- Active-item backing plate `(676,12,169,78)` with `2px #2a6fb5` border, `#0b2a4d` background, `10px` radius. Bottom active underline `(684,92,153,5)`, `#1e90ff` and `3px` radius.
- **Intended:** All ten labels must navigate to their corresponding running-app routes; keyboard, active-page state and browser history must work. **Current HTML:** labels and active styling only, no links or route handlers.
- **Brief source:** Frontend router; active tab derives from current route; no database table needed.

### 01.04 QHD badge and account
- Divider `(2118,20,2,60)`, `#1a3556`.
- `QHD` badge `(2140,23,100,54)`, fill `#0a2140`, border `1.5px solid #1f5a9c`, radius 8; `22px` bold blue `#3aa0ff`, center-aligned.
- Circular owner avatar `(2271,25,54,54)`, fill `#1790ff`, visible white letter `O` at `24px`.
- Text: `Owner` anchored `(2340,41)`, `23px` bold; `OTSI VIE` `(2340,69)`, `20px` muted.
- **Intended:** Owner/account menu, sign-out and authenticated identity from real session. QHD is a visual badge, not measured device-resolution telemetry.
- **Brief source:** Existing authenticated-user/session service and organization settings; no invented owner identity in production.

---

## 02. Page heading and current processing-job summary (y=123–267)

### 02.01 Eyebrow, title and explanation
- Eyebrow at `(44,138)`: `FROM RAW VIDEO TO ACTIONABLE INSIGHTS`, `18px`, font-weight 600, letter-spacing `4.5px`, color `#2d9bff`.
- H1 at `(44,192)`: `AI Processing Pipeline`, `72px`, bold, letter-spacing `-0.5px`.
- Explanatory line `(44,249)`, `25px`, `#cdd9ec`: `Our AI automatically detects, tracks, and analyzes every moment of the match, turning video into structured data and insights.`
- This is a fixed copy block, not an input.

### 02.02 Job/match summary container
- Main panel `(1500,123,1030,144)` `.box`.
- Circular empty art `(1520,150,88,90)`, background `#10243f` (not an uploaded match crest or identified player image).
- Three-line empty state:
  - `(1635,154)` `No processing job`, `19px`, `#b9cbe3`.
  - `(1635,190)` `No video selected`, `25px`, bold.
  - `(1635,231)` `Upload a video to begin`, `20px`, `#4db3ff`.
- Vertical rule `(1990,133,1,124)`, `#17355f`.
- Status pill `(2017,145,156,44)`: `Idle`, blue `#1580ff`, text `20px`, `6px` corner radius.
- Progress bar `(2017,215,401,9)`, `.pb` with initial fill `0%`; percentage/output marker at `(2446,217)`: `—`, `26px`, bold.
- **Intended:** On job selection, show real job/video identity, current stage/status and persisted progress. Support idle, queued, running, paused/cancelled if supported, completed and error states without fabricated transitions.
- **Brief source:** Processing jobs + video assets via existing engine API/MySQL job records; job-state updates from polling or authorized real-time events.
- **Important:** No actual job selector, clickable start action, status subscription or progress service exists in the supplied HTML.

---

## 03. Five-stage processing pipeline (x=43–1981, y=293–523)

### 03.01 Whole pipeline frame
- Parent `.box`: `(43,293,1938,230)`.
- Five status groupings in horizontal order, stage 1 through stage 5. Each uses a circular indicator at y=320, title near y=342–343, two subtitle lines at y=375/405, a 9px progress track at y=445, a dash at y=480, and a `Waiting` status pill at y=466.
- Stage circle size `74 × 74`; color in initial state is `5px solid #1c2a40` with `#0a1630` background. Code declares `done=false`, `act=false` for all five, so no visual dynamic stage state exists.
- Connector arrow glyph `→` size `32px` placed at x=`416, 781, 1184, 1558`, y=`355`, color `#1e90ff`.

### 03.02 Stage 1 — Detection
- Circle center `(109,357)`; border box `(72,320,74,74)`.
- Title: `1. Detection`, text anchor x=`169`, y=`342`, `23px` bold.
- Descriptions: `Detect players, ball, referees` and `and key objects in each frame.` at x=`169`, y=`375` and `405`, `19px`, `#b3c4dc`.
- Track `(77,445,283,9)` (0% fill); dash at `(78,480)`.
- Waiting pill `(242,466,121,36)`.
- **Intended:** Real frame/object detector status and progress; display detection classes, not inferred or fictional detections.
- **Brief source:** Detection-stage job events and indexed detections produced by video analysis services.

### 03.03 Stage 2 — Tracking
- Circle center `(500,357)`; box `(463,320,74,74)`.
- Title `2. Tracking`, x=`562`, y=`342`, `23px` bold.
- Descriptions: `Track objects over time` / `with consistent IDs.`, x=`562`, y=`375/405`.
- Track `(468,445,285,9)`; Waiting pill `(632,466,122,36)`; dash x=`469`.
- **Intended:** Track continuity, stage status and genuine tracking progress; temporary tracker IDs must not be misrepresented as verified permanent player IDs.
- **Brief source:** Tracking stage and tracking-entity records from engine.

### 03.04 Stage 3 — Identity Resolution
- Circle center `(862,357)`; box `(825,320,74,74)`.
- Title `3. Identity Resolution`, x=`925`, y=`343`, `23px` bold.
- Descriptions: `Assign player identities,` / `team, and jersey numbers.`, x=`925`, y=`375/405`.
- Track `(826,445,287,9)`; Waiting pill `(988,466,127,36)`; dash x=`827`.
- **Intended:** Show identity resolution progress separately from raw tracking; unresolved identities remain unknown and any confirmation process must respect provenance and user review.
- **Brief source:** Identity candidate, review/confirmation and player/team linkage records.

### 03.05 Stage 4 — Event Detection
- Circle center `(1268,357)`; box `(1231,320,74,74)`.
- Title `4. Event Detection`, x=`1332`, y=`343`, `23px` bold.
- Descriptions: `Detect passes, shots,` / `tackles, and key events.`, x=`1332`, y=`375/405`.
- Track `(1233,445,274,9)`; Waiting pill `(1397,466,110,36)`; dash x=`1234`.
- **Intended:** Real detected event count/status, confidence and provenance where appropriate.
- **Brief source:** Event detector stage and event records indexed to video time.

### 03.06 Stage 5 — Indexing
- Circle center `(1643,357)`; box `(1606,320,74,74)`.
- Title `5. Indexing`, x=`1707`, y=`343`, `23px` bold.
- Descriptions: `Create searchable metadata,` / `clips and analytics.`, x=`1707`, y=`375/405`.
- Track `(1606,445,295,9)`; Waiting pill `(1776,466,125,36)`; dash x=`1607`.
- **Intended:** Search index progress and completed searchable outputs once verified available.
- **Brief source:** Metadata indexing stage, clip/event indexes and job outputs.

### 03.07 State/behavior rules for all five stages
- Current initial visual status = all `Waiting`, all tracks `0%`, all status data `—`. Do not interpret these as measurements.
- In actual app: stage statuses derive from a single real job; only active/completed/failed states may be shown when reported by backend. Progress bars cannot advance based only on timers. Surface job failures and restart/retry only if real services support them.
- Stage relationships reflect the **five named phases in this HTML**; do not silently conflate them with Page 02’s five ingest stages, which have different wording and scope.

---

## 04. Processing Preview — main video workspace (x=43–1180, y=545–1208)

### 04.01 Outer container and titles
- `.box` `(43,545,1137,663)`.
- Vertical cyan accent `(58,565,7,50)`, `#1e90ff`.
- Title `Processing Preview`, text `(75,576)`, `25px` bold.
- Subtitle `Live AI Analysis Output`, text `(75,607)`, `20px`, blue `#4db3ff`.

### 04.02 Three top filter/select controls
- Each group is made from a small caption, a drawn `.sel` box (height `36px`) and a literal chevron `⌄`.
| Field label | Label x,y | Dropdown x,y,w,h | Initial visible value | Intended behavior | Brief data source |
|---|---|---|---|---|---|
| View | `512,573` | `512,587,195,36` | `AI Detections` | Select view type for preview: display the selected supported analysis layer, not fake computed views | Frontend state + capabilities returned by video/analysis services |
| Teams | `744,573` | `744,587,187,36` | `All Teams` | Filter overlay/tracks by actual detected/confirmed teams | Real team associations for selected job/video |
| Overlays | `958,573` | `958,587,195,36` | `Boxes + IDs` | Switch render of bounding boxes, identifiers and other supported overlay types | Frontend display preference + actual detection/track data |
- Text captions `17px` muted; dropdown values `18px`.
- **Current:** No native dropdowns, menu items, selections or change handlers exist.
- **Implementation caution:** `Boxes + IDs` must distinguish ephemeral track IDs from confirmed canonical player identities.

### 04.03 Video/stadium surface
- Base screen `(45,636,1134,509)` painted as static linear-gradient from dark navy `#0a2a55` through blue to pitch greens `#1d5a2e` / `#256b34`.
- Decorative upper-stadium band `(45,636,1134,130)` with repeating 12px/24px stripes, opacity `.8`.
- Synthetic scoreboard backing `(75,653,415,40)`, fill `#0a1a38`, radius 4.
- Scoreboard decorative white rectangular zone `(75,653,49,40)`; left score `—` at `(145,675)`; blue score badge `(233,653,100,40)` with `—`; another `—` at `(335,675)`; final blue badge `(400,653,90,40)` with `—` and rounded right edge.
- Main placeholder at `(612,890)`, `24px` centered: `No video loaded — detections appear here during processing`.
- **Intended:** Render real selected video at its aspect ratio, playback clock and synchronized detection tracks; hide overlay features requiring missing data; display honest no-video state before selection.
- **Brief source:** Source media + signed/authorized playback path and time-coded tracking/detection datasets; scoreboard only when match score is known.

### 04.04 Playback/control bar
- Backing strip `(45,1145,1134,63)` `#07142a`.
- Left to right visual control inventory:
  1. Previous/back-to-start glyph `⏮`, `(78,1177)`, `24px`.
  2. Play glyph `▶`, `(133,1177)`, `28px`.
  3. Next/step-forward glyph `⏭`, `(189,1177)`, `22px` muted.
  4. Playback elapsed/total string `— / —`, `(228,1177)`, `19px`.
  5. Seek track `(358,1173,472,7)`, initial fill 0%.
  6. White circular scrubber `(358,1167,18,18)`.
  7. Speed selector `(855,1158,102,38)` drawn `.sel`, text `1x` plus chevron.
  8. Volume glyph `🔊`, `(990,1177)`, `24px`.
  9. Settings glyph `⚙`, `(1056,1177)`, `26px`.
  10. Fullscreen glyph `⛶`, `(1124,1177)`, `26px`.
- **Intended:** Actual play/pause, frame/time stepping, seeking, duration display, speed changes, volume/mute, settings and fullscreen. Disabled states must be indicated when video is unavailable.
- **Brief source:** Browser video player driven by authorized media URL; analysis overlays time-synchronized to media. No direct database dependency for transient play state.
- **Current:** The visual control strip is static glyphs/rectangles with no event listeners, media element or playback implementation.

---

## 05. Four analysis intelligence tiles (x=1199–1981, y=553–1208)

### 05.01 Shared tile construction
- Each card is a `.box` with customized line color `#142f55`.
- Heading anchored 18px right and 27px down from tile origin; `24px` bold.
- Subtitle anchored +18/+58, `19px` muted `#b3c4dc`.
- Expand icon is a separate **drawn** `34 × 34px` square at `(tile.x + tile.w − 52, tile.y + 22)` with `#0a1d38` background, `1.5px #2a4f80` border, radius 6, glyph `⤢` size 16.
- Expand controls are noninteractive in supplied HTML. Intended behavior: enlarge the corresponding real analysis pane and restore the workspace on close.

### 05.02 Tile A — Player Detection
- Tile `(1199,553,391,297)`.
- Heading `(1217,580)` `Player Detection`.
- Subtitle `(1217,611)` `Not started`.
- Expand icon `(1538,575,34,34)`.
- Inner visualization `(1204,635,379,206)`, class `.ph`.
- Placeholder centered at `(1393.5,738)`: `No detections yet`, `19px`, `#cfdcf0`.
- **Intended:** Show processed frames with genuine player detections, bounding boxes, class/confidence where supported; click expand for detail.
- **Brief source:** Frame-indexed player detections from the selected processing job.

### 05.03 Tile B — Ball Detection
- Tile `(1608,553,373,297)`.
- Heading `(1626,580)` `Ball Detection`.
- Subtitle `(1626,611)` `Not started`.
- Expand `(1929,575,34,34)`.
- Inner visual `(1613,635,359,206)`; overrides `.ph` background with `linear-gradient(135deg,#2a6a3a,#1d4a2a)`.
- Placeholder centered `(1792.5,738)` `No detections yet`.
- **Intended:** Display actual ball location/track and confidence where available; expand pane.
- **Brief source:** Ball detections/tracks and job processing status.

### 05.04 Tile C — Team Identification
- Tile `(1199,860,391,348)`.
- Heading `(1217,887)` `Team Identification`.
- Subtitle `(1217,918)` `Not started`.
- Expand `(1538,882,34,34)`.
- Inner visualization `(1206,947,376,243)` `.ph`.
- Placeholder centered `(1394,1068.5)` `No teams identified yet`.
- **Intended:** Show actual team assignment and associated evidence; do not guess names or claim confirmed identity when only a kit-color grouping exists.
- **Brief source:** Team classification/assignment results and review records.

### 05.05 Tile D — Event Markers (Live)
- Tile `(1608,860,373,348)`.
- Heading `(1626,887)` `Event Markers (Live)`.
- Subtitle `(1626,918)` `Key events detected in timeline` (**this text is fixed in the source even though the page has no processing job**; the production clean state should avoid implying completed detection).
- Expand `(1929,882,34,34)`.
- Decorative pitch `(1620,947,352,196)`, `#1f7a36`, `3px solid #d7efe0`.
- Middle line `(1795,947,2,196)`, `#d7efe0`; center-circle representation `(1750,1015,60,60)`, `2px #d7efe0` border.
- Five **fixed legend items** at y=`1169` swatch / y=`1176` label, each swatch `14 × 14px`, round:
  - `Pass` blue `#1e90ff` at swatch x=`1625`, label x=`1645`.
  - `Shot` red `#ff2a2a` at x=`1693`, label x=`1713`.
  - `Tackle` yellow `#ffc41a` at x=`1761`, label x=`1781`.
  - `Foul` orange `#ff8a1a` at x=`1838`, label x=`1858`.
  - `Offside` purple `#d63aff` at x=`1902`, label x=`1922`.
- **Intended:** Plot real event markers at actual pitch/timeline positions; legend can filter event types if product behavior requires it. Empty dataset must not claim events have been detected.
- **Brief source:** Match events and pitch-space coordinates generated/validated by engine.
- **Visual note:** Legend labels near the right card edge may need explicit inspection for clipping; do not change geometry without visual comparison.

---

## 06. Processing Log (right side, x=2006–2530, y=293–921)

### 06.01 Container and heading
- `.box` `(2006,293,524,628)`.
- `Processing Log` at `(2027,331)`, `25px` bold.
- Idle bullet `(2214,326,10,10)`, background `#8ea3bf`, circular.
- Status text `Idle` at `(2232,331)`, `19px` muted.

### 06.02 Auto-scroll switch
- Label `Auto-scroll` at `(2345,331)`, `19px`, `#cfdcf0`.
- Toggle backing `(2454,315,55,30)`, blue `#1580ff`, radius 15; white knob `22 × 22px`, `top:4px;right:4px`. **Drawn state: ON**.
- **Intended:** Operable ON/OFF preference controlling whether newly arrived log lines automatically scroll into view. It must affect the log immediately, and use appropriate local/user persistence if specified.
- **Brief source:** Frontend user preference; real log events from engine processing job. No new MySQL data needed merely to draw the switch.

### 06.03 Log body
- Initial line `(2030,378)`: `No processing activity yet.`, `19.5px`, `#cfdcf0`.
- No log entries, log timestamp columns, scrollbar, filter or clear button are drawn.
- **Intended:** Show authentic job events with useful severity/time, independent scrolling, correct empty state, and continuous updates when job events exist; protect sensitive tokens and credentials from logs.
- **Brief source:** Processing log/event history for selected job from existing backend.
- **Current:** No switch interaction, scrolling log implementation, polling or real-time connection.

---

## 07. System Resources (right side, x=2006–2530, y=943–1257)

### 07.01 Container/heading/action
- `.box` `(2006,943,524,314)`.
- Heading `(2027,979)`: `System Resources`, `25px` bold.
- `View Details  →` at `(2383,980)`, `19px`, `#2d9bff`, weight 600; **drawn label only**, not a working link.

### 07.02 Three circular gauges
- Each dial draws an outer `124 × 124px` circle at x=center−62, y=1015; inner `104 × 104px` disc at x=center−52, y=1025, fill `#071a33`.
- Background dial remainder `#14233c`; `conic-gradient` configured to a `0%` colored value in source, so **zero visual fill is placeholder and not real device usage**.
- Dial centers:
  - **GPU** center `(2100,1077)`: blue `#1a8cff`, large `—` at y=`1071`, `GPU` at y=`1103`, `Not connected` at y=`1163`.
  - **CPU** center `(2268,1077)`: blue `#1a8cff`, large `—`, `CPU`, `Not connected`.
  - **Memory** center `(2438,1077)`: mint `#19e6c0`, large `—`, `Memory`, `Not connected`.
- Large value `26px` bold; small label `19px`; connection message `19px` `#cfdcf0`.
- **Intended:** Display measured GPU/CPU/memory usage from the actual engine host, with timestamps/availability and clear unknown state when telemetry absent; `View Details` opens real resource detail if supported.
- **Brief source:** Existing worker/host telemetry endpoints; resource samples should not be derived from client browser CPU metrics or invented.
- **Current:** Static placeholder graphics only.

---

## 08. Processing Timeline (bottom left, x=43–1666, y=1228–1410)

### 08.01 Container and heading
- `.box` `(43,1228,1623,182)`.
- Cyan accent `(58,1248,7,52)`.
- Heading `Processing Timeline` at `(75,1260)`, `25px` bold.
- Subtitle `Frame-level pipeline progress` at `(75,1291)`, `19px`, `#b3c4dc`.

### 08.02 Five legend categories
- All legend swatches are solid circles `19 × 19px` with top y=`1253`, and labels at `x+28, y=1262`, `19px`, `#cfdcf0`.
| Stage legend | Swatch x | Color |
|---|---:|---|
| Detection | 596 | `#19e6c0` |
| Tracking | 728 | `#1a8cff` |
| Identity Resolution | 853 | `#8a5cff` |
| Event Detection | 1059 | `#ffb21a` |
| Indexing | 1235 | `#6b7a92` |

### 08.03 Duration labels and timeline bands
- Left time label at `(108,1333)` = `0:00`; right marker `(1591,1333)` = `—`, both `17px`.
- Band 1 `(108,1358,1524,10)`, fill `#2a3a52`.
- Band 2 `(108,1373,1500,13)`, fill `#2a3a52`.
- No segment colors, timestamps, frame ticks, cursor, scrubber or playback synchronization are populated in this initial HTML state.
- **Intended:** Real frame-aligned stage timing and processing intervals; duration should reflect selected video, and segment colors should distinguish the five processing stages when measurement exists. Seeking timeline should synchronize preview only if designed/implemented.
- **Brief source:** Video duration and time-indexed job/stage progress telemetry.
- **Current:** Drawn tracks, labels, legend only.

---

## 09. Output Summary (bottom right, x=1691–2530, y=1228–1410)

### 09.01 Summary panel — important actual-source measurement
- `.box` **`(1691,1228,839,182)`**. The actual supplied Page 03 HTML is **839px wide**, extending to x=`2530`. Do **not** use an earlier 291px width from another version/inventory.
- Heading `(1714,1273)` = `Output Summary ` (bold `25px`) with `(Live)` as inline muted normal-weight span.
- **Visual/state caveat:** The literal `(Live)` tag is permanently displayed in this visual HTML even while no processing job exists. In real app it should identify live-updating summary capability, not falsely imply that a job is currently processing.

### 09.02 Four KPI cards
- Cards share y=`1297`, height=`113`, `.box` border-color `#142f55`.
- Circular KPI icon motif in each at `(card.x+14,1335,46,46)`, `2.5px solid #19a0ff` with circular border; icon detail is decorative, not a distinct source graphic.
| KPI | Card rect `x,y,w,h` | Value anchor | Label anchor | Initial displayed value | Brief source |
|---|---|---|---|---|---|
| Players Tracked | `(1707,1297,188,113)` | `(1775,1337)` | `(1775,1369)` | `—` | Genuine distinct tracked-player count for job; separate from confirmed identities |
| Ball Tracked | `(1906,1297,184,113)` | `(1974,1337)` | `(1974,1369)` | `—` | Ball-tracking output / valid coverage, according to agreed metric |
| Events Detected | `(2103,1297,223,113)` | `(2171,1337)` | `(2171,1369)` | `—` | Actual indexed event count for selected job |
| Processed | `(2341,1297,189,113)` | `(2409,1337)` | `(2409,1369)` | `—` | Backend-reported processed portion or status, with unit clarified in implementation |
- Value typography `26px` bold; label `18px`, `#b3c4dc`.
- **Important:** `Ball Tracked` is not clearly defined as a count, duration, detection percentage or yes/no in the HTML. `Processed` does not specify unit. Do not silently invent definitions or present unmeasured percentages. Confirm/derive metric definitions from real engine contracts when wiring.
- **Current:** All four values are literal dashes; no backend subscriptions.

---

## 10. Functional/control inventory — complete cross-reference

| ID | Section | Visible element | Drawn initial state | Required functional effect | Implementation state in supplied HTML |
|---|---|---|---|---|---|
| P03-C01 | Header | Home tab | Unselected | Navigate to Home | Visual only |
| P03-C02 | Header | Upload tab | Unselected | Navigate to Upload | Visual only |
| P03-C03 | Header | Processing tab | Selected | Stay on Processing; active route marker | Visual only |
| P03-C04 | Header | Analysis tab | Unselected | Navigate to Analysis | Visual only |
| P03-C05 | Header | Tactical tab | Unselected | Navigate to Tactical | Visual only |
| P03-C06 | Header | Reel Builder tab | Unselected | Navigate to Reel Builder | Visual only |
| P03-C07 | Header | Clip Studio tab | Unselected | Navigate to Clip Studio | Visual only |
| P03-C08 | Header | Player Report tab | Unselected | Navigate to Player Report | Visual only |
| P03-C09 | Header | Library tab | Unselected | Navigate to Library | Visual only |
| P03-C10 | Header | Export tab | Unselected | Navigate to Export | Visual only |
| P03-C11 | Header | Owner/avatar area | `O` / Owner | Account menu/session management | Visual only |
| P03-C12 | Preview | View dropdown | AI Detections | Change preview visualization mode | Visual only |
| P03-C13 | Preview | Teams dropdown | All Teams | Filter real detected teams | Visual only |
| P03-C14 | Preview | Overlays dropdown | Boxes + IDs | Show/hide supported overlay layers | Visual only |
| P03-C15 | Preview | Previous/rewind icon | ⏮ | Step/back to media start or previous frame as defined | Visual only |
| P03-C16 | Preview | Play control | ▶ | Play/pause actual video | Visual only |
| P03-C17 | Preview | Next icon | ⏭ | Step/next frame as defined | Visual only |
| P03-C18 | Preview | Time indicator | — / — | Reflect playback clock and duration | Visual only |
| P03-C19 | Preview | Seek track + knob | 0% | Seek actual video, sync overlays | Visual only |
| P03-C20 | Preview | Playback speed dropdown | 1x | Change real media playback rate | Visual only |
| P03-C21 | Preview | Volume | 🔊 | Mute/volume control | Visual only |
| P03-C22 | Preview | Settings | ⚙ | Display supported player settings | Visual only |
| P03-C23 | Preview | Fullscreen | ⛶ | Expand/exit real video view | Visual only |
| P03-C24 | Player Detection | Expand icon | ⤢ | Expand/restore tile | Visual only |
| P03-C25 | Ball Detection | Expand icon | ⤢ | Expand/restore tile | Visual only |
| P03-C26 | Team Identification | Expand icon | ⤢ | Expand/restore tile | Visual only |
| P03-C27 | Event Markers | Expand icon | ⤢ | Expand/restore tile | Visual only |
| P03-C28 | Processing Log | Auto-scroll switch | ON | Toggle following newest events | Visual only |
| P03-C29 | System Resources | View Details | Drawn link-style label | Open real resources details | Visual only |

**Display elements requiring real data (not necessarily actionable):** Job card/status/progress, five individual stage state pills/progress indicators, video/scoreboard, four analysis tiles, log content, three resource gauges, five timeline legend/bands, four output KPIs. All are placeholders in source.

**Not present in HTML:** A visible start-processing button, cancel-job button, retry-job button, file picker, upload button, match/job chooser, stage option checkboxes, editable metadata form, authentic video widget, data tables, or backend connection indicator. **Do not invent these as if already on Page 03.** If product workflow needs them, changes require UI design approval or placement in an existing approved destination.

---

## 11. Brief backend / database source map (NOT an architecture specification)

| Frontend section | Expected real data/service source |
|---|---|
| Owner/account heading | Existing session/auth and organization API |
| Job summary | Existing video assets + processing-job state/progress |
| Stage 1 detection | Video detector job stage + frame detections |
| Stage 2 tracking | Tracking stage + temporary track records |
| Stage 3 identity | Candidate identity resolution and review/confirmation data |
| Stage 4 events | Match-event detector and time-coded event records |
| Stage 5 indexing | Metadata/index status and searchable output records |
| Live video preview | Authorized source-media stream/URL + aligned detections/IDs/events |
| Team filter | Match teams and actual team-assignment records |
| Detection/ball/team/event tiles | Corresponding real inference results for selected job |
| Processing Log | Job event log stream/history |
| Resource gauges | Processing-worker hardware telemetry (GPU/CPU/memory) |
| Timeline | Stage timings and video frame/time map |
| Output Summary | Job output metrics with clearly defined semantics |

Backend integration must reuse the actual existing services and MySQL records, not a second fabricated DB. Persist only data that truly belongs to the job/account; UI filter visibility, seek position and tile expansion can remain frontend state. No endpoint path, table name or SQL migration is asserted by this visual HTML.

---

## 12. Page-specific verification and acceptance checklist

### 12.01 Visual fidelity
- [ ] Render at exact **2560 × 1440**; preserve the approved dark navy/blue appearance and five-column-like dashboard composition.
- [ ] Header contains all **ten** destinations in exactly the stated order, `Processing` active.
- [ ] All exact static section headings, subtitles, status words and placeholders match this inventory.
- [ ] Job summary remains in `(1500,123,1030,144)` without colliding with headline text.
- [ ] Five pipeline circles, tracks, pill labels and connectors are all visible in `(43,293,1938,230)`.
- [ ] Main preview occupies `(43,545,1137,663)` with all three filters and ten visual playback elements.
- [ ] Four analysis tiles present in a 2×2 arrangement, with four expand icons.
- [ ] Right Processing Log and System Resources panels present, Auto-scroll visibly ON in original initial state.
- [ ] Bottom Timeline `(43,1228,1623,182)` and Output Summary `(1691,1228,839,182)` are preserved.
- [ ] No clipped words at right edge, no accidental overlap within output KPIs, overlay controls, legend or header.
- [ ] When scaled, the page must preserve 2560×1440 coordinate relationships rather than silently reflow.

### 12.02 Behavior and truthful-data requirements
- [ ] No stage progresses without backend-reported progress for a genuine job.
- [ ] A selected job drives job header, pipeline, preview, log, timeline, resources context and summary consistently.
- [ ] All preview dropdowns respond to selections and correctly filter the real overlay data when available.
- [ ] All playback controls operate on actual playable media; unavailable controls are clearly disabled.
- [ ] Expand buttons open the correct enlarged analysis tile and return to the layout.
- [ ] Auto-scroll switch actually changes log-follow behavior and has the correct on/off visual state.
- [ ] Resource meters show verified measurements or an explicit unavailable/not connected state.
- [ ] Player IDs, team assignments and event claims retain proper provenance and uncertainty.
- [ ] Summary figures show real values, including metric units, or dashes where not available.
- [ ] Empty-state text never implies processing or event detection has occurred when it has not.
- [ ] No example data is incorrectly shown as real match/job data.

### 12.03 Current HTML limitations (verified source facts)
- **No functioning frontend controls:** The page uses generated `<div>` markup and hardcoded strings; there are no control change handlers.
- **No video playback:** The stadium area is a CSS gradient and glyphs, not a `<video>` player.
- **No live processing:** All five pipeline stages are frozen to `Waiting`, with stage variables `done=false` and `act=false`.
- **No log or system telemetry:** Auto-scroll and dials are decorative placeholders.
- **No data persistence or networking:** No API requests, service connection or database access is defined by this HTML.
- **No true live metrics:** Four KPIs are `—`; other static decorations are not evidence of inference results.

---

## 13. Owner review / lock state

**Page:** 03 / AI Processing Pipeline  
**Source audited:** `03_AI_PROCESSING.html`  
**Deliverable:** Frontend-first, element/section-level corrected Markdown inventory with brief backend/DB source annotations.  
**Approval:** **PENDING — DO NOT LOCK OR MOVE TO PAGE 04 WITHOUT EXPLICIT OWNER APPROVAL.**
