# OTSI VIE — PAGE 06: REEL BUILDER / SPOTLIGHT COMPOSER
## Ultra-comprehensive frontend UI inventory, with brief backend/DB source notes

**Source inspected:** `06_REEL_BUILDER.html` supplied by the owner. **Reference coordinate space:** 2560 × 1440 px. **Page state in source:** empty/no player/no reel/moments; several preset switches and slider values shown as visual defaults. **Inventory status:** review draft — not owner-locked. **Authority:** the *actual provided HTML*, not an inferred alternative layout. This inventory describes what is drawn, the state displayed, and the required frontend interaction separately. It does **not** claim those interactions are implemented in this HTML.

### 0. Fidelity and implementation conventions

- **Coordinates:** all `x,y,w,h` values in pixels refer to the fixed `#s` design canvas at 2560×1440; `x,y` are the upper-left corner for boxes (`D`/`P`). `T(x,y)` specifies the **vertical center** of text because `.t {transform:translateY(-50%)}`. Icon `I(x,y)` specifies its **center** and a nominal square icon size. Parent panels are separate painted rectangles, not semantic containers.
- **Responsive preview behavior:** a `fit()` function applies a uniform scale of `min(windowWidth/2560, windowHeight/1440)` and centers the fixed canvas. It does not reflow, collapse or change panel layout at smaller viewports. The page body and canvas both hide overflow.
- **Type system:** Segoe UI → Helvetica Neue → Arial → sans-serif. Default text white `#fff`; `.b` weight **700**, `.sb` weight **600**, `.m` color **#8EA3BF**, `.bl` blue **#1E90FF**, `.lb` light blue **#33A8FF**. Text line-height **1.1**; text is nowrap. Where a `T` call specifies extra color, size or transform, it overrides the class.
- **Base palette:** canvas background **#000913**; header **#071A33**; blue action/active **#0A84FF**, **#1E90FF**, **#33A8FF**, highlighted active nav **#6CC4FF**. Secondary text commonly **#CFE0F5**, **#D6E4F7**, **#B9CBE2** and muted **#9FB3CC**. Panel border **#12335F** at **1.5 px**; panel gradient **#081A35 → #06122A**; panel radius **14 px**. Input dark **#041022**, border **#17406F** at **1.5 px**, radius **8 px**. Dividers typically `#12335F`.
- **Drawn icon system:** helper `I()` inserts simplified SVG icons with `viewBox=0 0 24 24`, default `stroke-width=1.8`, round caps/joins. The icons are approximations, **not a supplied asset pack**. Exact available icon keys: `sun`, `tri`, `ring`, `spark`, `tgt`, `back`, `chk`, `fwd`, `chev`, `star`, `note`, `eye`, `fold`, `dl`, `ref`, `vol`, `gear`, `full`, `film`, `sq`, `ph`, `cam`, `pl`, `plus`, `scr`, `ball`.
- **Static nature:** the source appends absolute-positioned `<div>` and SVG elements using `D`, `T`, `I`, `P`, `TG`, `THUMB`; there are **no native editable `<input>`, `<textarea>`, `<select>`, `<button>` controls**, no event handlers for the drawn controls, no application state/persistence, no requests to NestJS, and no render/export API calls. The only listener is `resize` for canvas fitting. All interactions below are **implementation requirements**, not implemented source behavior.
- **Backend/DB labels:** the brief references indicate conceptual sources (real project, player, clip, consent/rights or render state) in the *existing* OTSI VIE engine/MySQL. They are **not claims that particular endpoints/tables already exist**.
- **Do not confuse empty-state artwork with real media:** the large spotlight scene, light rays, football, frame thumbnails and blue/green tracks are gradients or decorative shapes; the HTML does not embed a video, images, audio, render frames or a player model. Preserve the designed composition while showing truthful states.

---

## 1. Shared global header — x0–2560, y0–100

**Background and shell:** `D(0,0,2560,100)`; `background:#071A33`; **bottom border 1.5 px solid #1E90FF**. All navigation labels are separately positioned 24 px, weight 600. Header is one 100 px high horizontal strip.

| Visible item | Source geometry, typography and styling | Intended frontend behavior | Brief data source |
|---|---|---|---|
| OTSI wordmark | `T(30,38,'OTSI',40,'b')`: 40 px, bold, white | Navigate to Home if brand header is clickable | Static branding |
| VIE wordmark | `T(130,38,'VIE',40,'b bl')`: 40 px, bold `#1E90FF` | Same brand-navigation behavior | Static branding |
| Tagline | `T(31,73,'VIDEO INTELLIGENCE ENGINE',13,'b bl')`: 13 px bold blue | Branding, not an action | Static branding |
| Active route backplate | `D(1198,12,169,78)`: `#073154`, 1.5 px `#1E6FB0` border, 12 px radius | Highlight Reel Builder route only while active | Router |
| Active underline | `D(1207,92,150,5)`: `#1E90FF`, 3 px radius | Follows active route | Router |
| Home | text x381, vertical center y52 | Navigate to Home | Router |
| Upload | x548, y52 | Navigate to Upload | Router |
| Processing | x700, y52 | Navigate to Processing | Router |
| Analysis | x889, y52 | Navigate to Analysis | Router |
| Tactical | x1067, y52 | Navigate to Tactical | Router |
| **Reel Builder** | x1215, y52, 24 px, bold 700, `#6CC4FF` | Current page, accessible active state | Router |
| Clip Studio | x1396, y52 | Navigate to Clip Studio | Router |
| Player Report | x1555, y52 | Navigate to Player Report | Router |
| Library | x1766, y52 | Navigate to Library | Router |
| Export | x1942, y52 | Navigate to Export | Router |
| Right header divider | `D(2117,20,2,62)` `#12335F` | Decorative | Static |
| QHD badge | `D(2140,23,100,54)` dark `#071E37`, 1.5 px `#17406F`, radius 8; `T(2190,50,'QHD',20)` bold `#33A8FF`, horizontally centered | Display current workspace quality/preview mode; only interactive if product spec supports it | Display configuration |
| Owner avatar | `D(2271,25,54,54)` blue `#1E90FF`, circular; centered white bold `O` at (2298,52), 22 px | Profile menu / authenticated session | Auth/session |
| Owner label | `T(2340,41,'Owner',24,'b')` | Real role/name (not invented) | Auth/session |
| Organization text | `T(2340,69,'OTSI VIE',19,'m')` muted | Organization context | Auth/organization |

**Shared header acceptance:** all 10 destinations remain visible in the original order; Reel Builder alone has the active backplate/underline/text; no text is clipped; QHD and owner area remain intact and get real session information.

---

## 2. Left column A — Reel Builder introduction and workflow

**Panel:** `P(20,122,398,654)` → x20–418, y122–776; gradient panel with 1.5 px blue border and 14 px radius. Left-column interior content commonly starts at x40–45.

### 2.1 Navigation, title, description

| Element | Exact drawn specification | Intended operation | Source |
|---|---|---|---|
| Back arrow | `I(58,154,'back',26,'#33A8FF')` | Navigate back to reel list/library, retaining project state | Router / reel projects |
| Back to Reels | `T(87,154,'Back to Reels',22,'lb')` 22 px light-blue | Same clickable target as arrow | Router / reel projects |
| Reel Builder title | `T(45,209,'Reel Builder',46,'b')` 46 px white bold | Section title | Static |
| Spotlight Composer | `T(45,253,'Spotlight Composer',36,'b','color:#1E90FF')` | Product mode identification | Static/mode |
| Three-line description | x45, vertical centers **298**, **328.5**, **359**; 23 px `#CFE0F5`: “Create cinematic, data-driven” / “highlight reels with AI-powered” / “spotlight effects.” | Information only | Static |
| Horizontal divider | `D(45,391,356,1)` `#12335F` | Separates introduction from workflow | Static |

### 2.2 Four-step workflow selector

- Accent background for first step: `D(21,392,397,94)`, left-to-right gradient **#0B2B57 → #08213F**, 8 px radius.
- Number circles: x44, 66×66 each, center x77. First circle **#0A84FF**, radius 50%; remaining circles **#122339** with 1.5 px `#1B3350` border. Step numeral **28 px**, 600 weight, centered.
- Labels at x134, **22 px**, 600 weight; descriptions x134, **20 px**, `#9FB3CC`. All stage status flags are `0` in source; **no green completion-check icons appear**.

| Step | Circle top | Center y | Title (center y minus 14) | Subtitle (center y plus 20) | State / intended behavior |
|---|---:|---:|---|---|---|
| 1 | 403 | 436 | **Select Player** | **No player selected** | Highlighted/current; choose an actual confirmed player before generating a verified player reel |
| 2 | 496 | 529 | **Choose Moments** | **No moments selected** | User selects validated analysis moments/clips; reflect count and selection |
| 3 | 588 | 621 | **Edit & Style** | **Spotlight, overlays, music** | Jump/focus to style controls and project editor, persist settings |
| 4 | 681 | 714 | **Export** | **Render and share** | Validate rights/settings; queue real reel render and navigate to output |

**Behavior:** workflow reflects project progress, validation, readiness and actual completion; navigation must not falsely mark unexecuted stages as complete. **Brief source:** reel project state, canonical player, moments, rights and render jobs.

---

## 3. Left column B — Aspect Ratio

**Panel:** `P(20,787,398,193)` → y787–980. Heading `T(40,817,'Aspect Ratio',22,'sb')`. Three horizontally arranged option cards at **y846**, each **118 px high**, with icon center y878 (34 px), ratio label center y915 (20 px semibold), description center y941 (16 px muted). Treat as **mutually exclusive radio-card controls**.

| Aspect card | Rectangle | Visible content | Displayed state | Behavior / source |
|---|---|---|---|---|
| Widescreen | `D(36,846,125,118)` | film/camera icon `cam`; **16:9**, “YouTube, Web” | **Selected**, `#0A2B55`, **3 px #1E90FF border**, 10 px radius; icon `#33A8FF` | Set render aspect 16:9; composition and crop preview reflect it; persisted reel project |
| Portrait | `D(174,846,107,118)` | phone icon `ph`; **9:16**, “Reels, Shorts” | Unselected, `#0A1D38`, **1.5 px #17406F border**, 10 px radius; icon `#CFE0F5` | Set 9:16; update safe zones/preview; persisted project |
| Square | `D(296,846,106,118)` | square icon `sq`; **1:1**, “Instagram” | Unselected, same inactive styling | Set 1:1; update crop/framing; persisted project |

**Spacing:** cards start at x36, x174, x296 (horizontal gaps **13 px** and **15 px**); right card ends x402; outer panel ends x418. Do not invent a fourth aspect ratio. **No video encoder is triggered by merely changing selection**; it should update project/preview.

---

## 4. Left column C — Reel Info form

**Panel:** `P(20,992,398,423)` → x20–418, y992–1415. Heading `T(40,1027,'Reel Info',24,'sb')`. Input standard: `.in` background **#041022**, border **1.5 px #17406F**, radius **8 px**; these are drawn DIVs, not actual inputs.

| Form field | Label | Input geometry | Placeholder/display | Required frontend behavior | Brief source |
|---|---|---|---|---|---|
| Reel title | `T(40,1052,'Title',19,'m')` | `D(38,1066,363,53,'in')` | `T(51,1092,'Enter a reel title',20)`, `#8EA3BF` | Editable text input; validation, dirty/saved state, keyboard focus; save title | Reel project metadata |
| Description | `T(40,1147,'Description (optional)',19,'m')` | `D(38,1160,363,105,'in')` | `T(51,1187,'Describe this reel (optional)',20)`, muted | Real multiline textarea, optional field, preserve line breaks, save on project | Reel project metadata |
| Duration | `T(40,1305,'Duration',19,'m')` | `D(128,1279,273,52,'in')` | “Auto (Best Moments)” 20 px x146; downward chevron at (381,1305), 20 px | Select target-duration policy; recalculate suggested selection/duration; no invented duration options | Reel settings / clip durations |
| Music | `T(40,1371,'Music',19,'m')` | `D(128,1347,273,52,'in')` | note icon at (153,1373), 28 px; “Choose music” x181 20 px muted; chevron (381,1373), 20 px | Open real music selector/asset library; preview, choose/clear licensed track, enforce audio rights | Media library, rights and project audio settings |

**Preserve exact label-to-field spacing.** Labels “Duration” and “Music” sit to the left of their 273 px wide controls, unlike Title and Description which span x38–401. The source does **not** specify a menu-option list for Duration or Music; do not invent source options in the inventory.

---

## 5. Main upper center — Cinematic Spotlight preview / player

**Outer panel:** `P(445,125,1593,732)` → x445–2038, y125–857. Inner scene: `D(447,127,1589,653)` → x447–2036, y127–780; radius 12 px top corners. Main stage gradient: radial bright-blue spotlight centered near 60% top, **#5FB8FF → #1D5AA0 → transparent**; vertical dark gradient **#0A1A38 → #04101F → #0A2A30**. This is decorative source artwork, not a decoded video.

### 5.1 Scene artwork, player and context card

| Item | Exact source placement / styling | Functional requirement | Brief source |
|---|---|---|---|
| Spotlight halo | `D(1120,300,400,480)` radial `#4A9EE0 → #2A6FB8 → transparent` | Replace/augment with actual player-following effect when real video is loaded; do not imply tracking success without engine evidence | Video frames/track coordinates |
| Decorative football | `D(1395,690,90,90)`, circular radial `#DDE7F5 → #335` | Decorative empty-state only or real overlay when supported | Video scene / overlay config |
| Player portrait | `D(464,147,129,127)` light-blue gradient `#9FD0F5 → #3A6FA8`; border 1.5 px `#8EC4EF`, radius 8 | Show actual player media if present, neutral placeholder otherwise | Player photo/verified identity |
| Player name | `T(618,170,'No player selected',36,'b')` | Current selected canonical player; never use fake name | Player identity |
| Number tag | `D(966,147,56,42)` bright blue `#1E90FF`, radius 6; centered `—` 26 px | Actual confirmed number or dash | Roster/verified jersey |
| Team marker | `D(620,201,26,26)` light blue `#6CC4FF`, circular | Team color/crest when known | Team metadata |
| Team text | `T(659,214,'Team —',22)` | Actual team | Player/team |
| Field separator | pipe `|` at (827,214), 22 px muted | Decorative separator | Static |
| Nationality mark | `D(856,203,22,22)`, `#3A5A88` | Validated country/flag source | Player metadata |
| Nationality | `T(891,214,'Nationality —',22)` | Actual nationality or neutral empty | Player metadata |
| Role | `T(618,256,'Role —',22)` `#9FB3CC` | Player position/role | Player profile |
| Foot | `T(745,256,'Foot —',22)` | Preferred foot, or unknown | Player profile |
| Age | `T(875,256,'Age —',22)` | Age if documented, not guessed | Player profile |
| Separators | (727,256) and (849,256) muted 22 px pipes | Preserve spacing | Static |
| Scoreboard container | `D(1630,153,382,45)` dark translucent `rgba(5,16,36,.8)`, radius 6 | Actual match context, no fabricated score | Match/clock |
| Ball logo | `I(1657,176,'ball',40)` | Visual icon | Static |
| Scoreboard leading value | `T(1705,176,'—',26,'sb')` | Match/competition identifier if available | Match record |
| Score block 1 | `D(1795,153,83,45)` `#0A2BD0`, centered `—` 27 px | Real home score | Match event/score |
| Mid score display | `T(1890,176,'—',26,'sb')` | Real separator/time contextual value as defined by implementation | Match clock |
| Score block 2 | `D(1940,153,72,45)` `#1E5BFF`, centered `—` 27 px | Real away score | Match event/score |

### 5.2 Playback transport, timeline and tools

**Control bar runs through y780–857 within parent preview.** These are individually drawn controls; all currently inactive.

| Control | Exact graphic / coordinates | Intended behavior | Source |
|---|---|---|---|
| Step back / previous | tiny white back icon centered (493,820), with shapes at x483 and x490 | Seek previous frame/moment according to player mode | Video/player |
| Play | white triangle `D(554,803,28,34)` scaled 1.5 | Play video from current timeline position | Video/player |
| Step forward / next | triangle at x628 and bar x642, y806 | Advance to next frame/moment | Video/player |
| Time readout | `T(687,820,'— / —',21)` | Actual current time / duration | Video media metadata |
| Seek track | `D(836,815,777,10)` `#0B2A4D`, radius 5 | Drag/click to seek | Media timeline |
| Scrubber knob | `D(824,809,24,24)` pale `#CFE8FF`, 3 px blue border, circular | Draggable handle, tied to video position | Player position |
| Volume | `I(1690,820,'vol',34)` | Toggle mute/open volume input | Player/audio state |
| Speed selector | `D(1738,797,124,46,'in')`, “1x” at (1758,820), 20 px, chevron at (1840,820) | Change supported playback speeds | Video/player state |
| Player settings | `I(1917,820,'gear',36)` | Open actual playback/settings menu | Player settings |
| Full-screen | `I(1992,820,'full',34)` | Enter/leave fullscreen stage | Player/UI |

**Expected player state:** when no video is selected, show its genuine empty state and disable actions requiring a media source. When a source is present, playback, speed, seek, volume and fullscreen work from real media. **No actual `<video>` tag or media URL exists in the provided HTML**.

---

## 6. Main center — Suggested Key Moments carousel

**Panel:** `P(445,872,1593,258)` → x445–2038, y872–1130. Heading icon star `I(477,905,'star',30,'#33A8FF')`; title `T(505,905,'Suggested Key Moments (0)',25,'sb')`; right action `T(1846,910,'View All Moments',19,'lb')`, right arrow `I(2012,910,'fwd',18,'#33A8FF')`.

**Five moment cards**, at top y939, height 185 px, rounded 10 px; each contains a gradient thumbnail, blue sequence-number chip, right-aligned duration chip, primary and secondary text. Note that the empty-state source still paints five full decorative thumbnail shapes; they are **not real footage**.

| Moment slot | Outer card (x, y, w, h) | Thumbnail | Seq. chip | Duration chip / text | Title and description |
|---|---|---|---|---|---|
| 1 | **455,939,300,185** | x459,y941,w292,h116 | `D(469,950,36,34)`, numeral **1** at (487,967) 20 px bold | `x677,1027,62×26`, `—` | “No suggestions yet” at (470,1078), 20 px 600; “Run AI processing first” at (470,1105), 19 px `#B9CBE2` |
| 2 | **776,939,294,185** | x778,y941,w290,h116 | x790,y950, numeral **2** | x992,y1027, `—` | `—` / `—` at x791 |
| 3 | **1095,939,295,185** | x1097,y941,w291,h116 | x1109,y950, numeral **3** | x1312,y1027, `—` | `—` / `—` at x1110 |
| 4 | **1413,939,299,185** | x1415,y941,w295,h116 | x1427,y950, numeral **4** | x1634,y1027, `—` | `—` / `—` at x1428 |
| 5 | **1733,939,297,185** | x1735,y941,w293,h116 | x1747,y950, numeral **5** | x1952,y1027, `—` | `—` / `—` at x1748 |

**Visual rules:** card fill `#06182F`, border **1.5 px #12335F**; sequence chip blue `#1E90FF`, radius 6; thumbnail uses `THUMB` with player-like blue radial gradation and a multistop blue background; duration chip `rgba(0,10,25,.8)` radius 6; titles 20 px semibold; description 19 px `#B9CBE2`.

**Selection behavior:** moment must be selectable/deselectable; selection state, selected count, order, duration and presence in video timeline are synchronized. Source conditional `if(c[5])` defines a check icon for selected moments, but **all supplied items have `c[5]=0`**, so no selection check currently displays. `View All Moments` goes to the complete real moment list/selector. **Brief source:** analysis event/clip index, match media, verified player association and reel-project moment selections.

---

## 7. Main lower center — Four-layer reel timeline

**Panel:** `P(445,1150,1593,265)` → x445–2038, y1150–1415. Vertical lane-label separator `D(675,1152,1,261)` color `#12335F`. The labels are left of x675, timeline workspace begins around x690. **Exactly four visible lanes**; do not mix up with Clip Studio's separate eight-lane editor.

### 7.1 Timeline labels, icons, ruler

| Label / element | Coordinates and style | Behavior |
|---|---|---|
| Video Clips | Film icon at (475,1225), size26; text x508,y1225 20 px `#D6E4F7` | Lane title; exposes selected moment clip segments |
| Spotlight Effects | Sun icon at (475,1272), size26; text x508,y1272 | Lane for timed spotlight effects |
| Text & Overlays | Standalone Georgia serif “T” at (475,1319), size30; x508 label at y1319 | Lane for timed graphics/text layers |
| Audio | Note icon (475,1370), 26 px; x508 label at y1370 | Music/audio lane |
| Ruler start | “00:00” x715,y1176 20 px, `#CFE0F5`, centered | Current time origin |
| Additional ruler ticks | x900,1083,1280,1478,1677,1878 at y1176, each displaying “—” | Should show computed time values from real reel duration/zoom; no invented numbers |

### 7.2 Lane rectangle geometries and empty state

| Lane | Rectangle / source visuals | Current visible text | Intended implementation | Data |
|---|---|---|---|---|
| Video Clips | `D(690,1203,1340,52)` fill `#07162C`, 1.5 px `#12335F` border, radius 6 | “Add moments to build the reel” centered at (1360,1229), 19 px `#8EA3BF` | Editable ordered clips, drag to reorder, segment duration/trim, select/remove; sync player preview | Reel clips/moments |
| Spotlight Effects | `D(690,1262,1340,28)` fill `#0A2A52`, radius 6 | “No spotlight effects” at (1360,1276), 17 px muted | Timed effect spans and parameter keyframes where supported | Reel effect settings |
| Text & Overlays | No continuous background rectangle drawn in source; the lane's center text is visible | “No text or overlays” at (1360,1319), 19 px muted | Real timed text/overlay blocks; positioning/editing and provenance | Overlay items |
| Audio | `D(690,1350,1340,56)` fill `#05503A`, 1.5 px `#12805A` border, radius 6 | Note icon (720,1378), 28 px; “No audio selected” x748,y1378, 20 px `#CFE0F5` | Attach audio media, arrange span, play/mute/mix as supported, enforce usage rights | Audio asset / project |

**Implementation caution:** source code contains `[].forEach(...)` for overlay blocks, thus **zero real purple timeline overlay clips** are drawn. Do not invent them in the inventory. Timeline in this HTML has no drag/drop, zoom, playhead behavior or data persistence.

---

## 8. Right inspector — three tabs and Spotlight controls

### 8.1 Tabs

**Header strip:** `D(2065,122,475,64)`, background `#071A33`, radius 10; active underline `D(2068,183,157,3)` blue `#1E90FF`.

| Tab | Text position and appearance | State / intended operation |
|---|---|---|
| Spotlight | centered x2146,y153; 23 px semibold, `#6CC4FF` | **Active**; show spotlight settings |
| Overlays | centered x2302,y153; 23 px `#CFE0F5` | Switch inspector context to overlay configuration |
| Branding | centered x2459,y153; 23 px `#CFE0F5` | Switch inspector context to branding configuration |

Note: in the supplied screenshot-style HTML, the Spotlight, Player Targeting, Overlays and Branding panels are **all visibly stacked at once** despite the tab strip. Implement tab behavior only insofar as it preserves the approved layout and visibility intent; do not silently remove the stacked panels.

### 8.2 Spotlight Controls panel

**Panel:** `P(2065,195,475,411)` → x2065–2540, y195–606. Heading `T(2086,227,'Spotlight Controls',23,'sb')`. `Reset All` at (2519,227), 20 px `#33A8FF`, right-aligned by `translate(-100%,-50%)`.

**Five sliders:** shared track start **x2157**, width **355 px**, height **10 px**, fill `#1E90FF`, inactive track `#0B2A4D`, radius5; thumb **22×22**, `#CFE8FF`, **3 px #33A8FF** border, circular. Value readouts use 21 px `#CFE0F5`, right-anchored at x2512. The source explicitly positions the filled segment and thumb; preserve these positions as visual baseline and bind real numerical values.

| # | Slider label / icon | Label center y | Track center y | Displayed value | Blue fill end / thumb center x | Intended frontend behavior | Source |
|---|---|---:|---:|---|---:|---|---|
| 1 | `sun` **Spotlight Intensity** | 277 | 305 | **85%** | 2412 | Adjust ray/spotlight strength and real preview (0–100% if confirmed by effect specification) | Project effect preset |
| 2 | `tri` **Ray Width** | 345 | 373 | **60%** | 2338 | Adjust ray beam spread | Project effect preset |
| 3 | `ring` **Vignette Strength** | 413 | 441 | **45%** | 2303 | Adjust edge darkening | Project effect preset |
| 4 | `spark` **Glow Amount** | 482 | 511 | **55%** | 2338 | Adjust glow/halo | Project effect preset |
| 5 | `tgt` **Target Lock Sensitivity** | 551 | 578 | **72%** | 2405 | Adjust tracking lock preference **without overriding verified identity/evidence** | Tracking/spotlight config |

Icon center x2107 and vertical center `(label y)+10`, size **36 px**. Label starts x2157 at **22 px**, normal weight, `#E3EEFB`.

**Important source nuance:** the slider percentages are **hardcoded UI example/default values**; the fill lengths are graphical approximations and do not all precisely equal the shown percentage of 355 px. On implementation, synchronize slider thumb, fill length, numeric percentage, preview and persisted settings using one real state value. Do not treat displayed percentages as measured tracking confidence. `Reset All` must restore confirmed product defaults, not fabricated analytical output.

---

## 9. Right inspector — Player Targeting

**Panel:** `P(2065,618,475,204)` → y618–822. Heading `T(2086,647,'Player Targeting',23,'sb')`.

| Visible element | Geometry and state | Intended behavior | Source |
|---|---|---|---|
| Auto Track Player | target icon `I(2105,693,'tgt',30)`; label x2149,y693 20 px; `TG(2461,693,1)` | **ON**; toggle auto-follow target in preview and renderer | Reel settings + player track |
| Lock on confirmed player | target icon `I(2105,738,'tgt',30,'#33A8FF')`; text x2149,y738 20 px | **No visible toggle drawn**; label/action area controls lock selection to a confirmed identity; don't invent a switch absent from HTML | Canonical player identity/verification |
| Re-detect Player | `D(2086,765,434,43,'in')`, refresh icon `I(2230,788,'ref',22)`, label at (2255,788),20 px | Re-run targeting request when video and approved player exist; show job/progress/results/errors | Tracking/identity service |

**Toggle style:** `TG(x,y,on)` draws blue **#0481F9** 56×28 px pill from x2461 to 2517, y679–707 and a white 22×22 knob at x2491–2513. Render as an accessible, stateful switch in React; no action exists in HTML.

---

## 10. Right inspector — Overlays

**Panel:** `P(2065,834,475,242)` → y834–1076. Heading `T(2086,864,'Overlays',23,'sb')`.

All four rows include a 32 px icon centered at x2107; text starts x2154, 20 px, `#E3EEFB`; toggle drawn at x2461, **ON**.

| Row | Center y | Icon | Displayed switch | Required effect / brief source |
|---|---:|---|---|---|
| Player Info Card | 912 | `ball` | ON | Show/hide permitted real player identity and verified info card; player profile + overlay config |
| Match Score & Time | 957 | `ball` | ON | Show/hide real match clock and scores; match/video timeline |
| Competition Logo | 1000 | `ball` | ON | Show/hide only cleared competition logo; licensing/asset registry |
| Animated Lower Third | 1042 | `pl` | ON | Show/hide timed name/title bar; real player/project metadata |

All must toggle actual preview rendering and persist in reel settings; “on” in visual HTML does not prove corresponding overlays are rendered, or that rights exist for logos.

---

## 11. Right inspector — Branding

**Panel:** `P(2065,1080,475,182)` → y1080–1262. Heading `T(2086,1108,'Branding',23,'sb')`.

| Row | Center y | Icon | Displayed switch | Behavior / source |
|---|---:|---|---|---|
| Use OTSI VIE Watermark | 1153 | `ball` 32 px | **ON** | Toggle approved branded watermark within permitted export policy; brand assets/project settings |
| Custom Logo | 1196 | `plus` 32 px | **OFF** | Open real image asset picker/upload and preview, then enable selected logo; media assets/rights |
| End Screen | 1237 | `scr` 32 px | **ON** | Include configured closing frame, based on brand/project settings | End-card template/project |

Each row uses x2107 icon, x2154 label, x2461 toggle. Source switch is entirely graphical; actual React implementation needs keyboard access, save/restore, and truthful preview.

---

## 12. Right inspector — output actions

All three actions sit below the Branding panel; they are separate draw elements, not real buttons.

| Action | Exact geometry / style | Behavior / validation | Brief source |
|---|---|---|---|
| **Generate Reel** | Primary `D(2083,1268,441,70)` bright blue **#0A84FF**, radius8. Divider `D(2468,1278,1.5,50)` pale `#4FA8FF`; download icon `I(2228,1304,'dl',26)`; bold 22 px label x2257,y1304; chevron `I(2496,1304,'chev',20)` | Save validated composition and enqueue real render job; drop-down may expose supported render variations if specified. Check media availability, confirmed subject association, consent/rights, permissions and output settings. Show actual queued/running/failed/done status; no fake successful reel. | Reel project, export rights, render jobs |
| **Preview Render** | `D(2083,1351,214,57,'in')`; eye icon at (2119,1380),26 px; 20 px semibold text x2147,y1380 | Request available real-quality preview or show honest unavailable state; do not claim rendered footage based on decorative stage | Preview render service |
| **Save Project** | `D(2311,1351,213,57,'in')`; folder icon at (2357,1380),26 px; 20 px semibold text x2386,y1380 | Validate and persist reel title, description, aspect ratio, duration, audio, target, selected moments, effect sliders, toggles, timeline state; show saved/failed feedback | Reel project storage/MySQL |

**Action gaps and spacing:** Generate Reel x2083–2524. Lower buttons y1351–1408, separated by 14 px (left x2083–2297, right x2311–2524). Rightmost content ends x2524, leaving 36 px to viewport edge.

---

## 13. Comprehensive interactive-element checklist — Page 06

This is a **functional completeness register**, cross-referenced to the visuals. Every control listed exists **visually** in this supplied HTML; none is wired in this standalone source. A few features (such as audio asset picker) imply a secondary UI but are not themselves drawn here.

| Section | Every visible interaction target | Displayed state | Required behavior |
|---|---|---|---|
| Header | Ten navigation items; brand; owner profile area | Reel Builder active | Navigate to real routes, authenticated profile |
| Reel workflow | Back to Reels; Select Player; Choose Moments; Edit & Style; Export | Step 1 highlighted | Real wizard state, focus and validation |
| Aspect ratio | 16:9; 9:16; 1:1 | 16:9 selected | Exactly one active, updates composition |
| Reel Info | Title; Description; Duration dropdown; Music dropdown | Empty title/description; Auto duration; Choose music | Editable, validated, persisted fields |
| Preview/Player | Previous, Play, Next, seek/scrubber, volume, speed, settings, fullscreen | No media/time; 1x shown | Real playback; accurate disabled states |
| Suggested Moments | View All Moments; five moment-card targets and conditional selection chips | Count 0; all unselected | Select/reorder/create composition from real moments |
| Reel Timeline | Video Clips; Spotlight Effects; Text & Overlays; Audio; ruler | Four empty lanes | Real clip/effect/overlay/audio editing per feature |
| Inspector tabs | Spotlight; Overlays; Branding | Spotlight selected | Accurate panel navigation; preserve owner-approved panel visibility |
| Spotlight controls | 5 individual sliders; Reset All | 85%, 60%, 45%, 55%, 72% | Preview update, saved project values, reset |
| Player Targeting | Auto Track Player toggle; Lock on confirmed player action; Re-detect Player | Auto Track ON; lock has **no drawn toggle** | Tracking integration respecting identity verification |
| Overlays | Player Info Card; Match Score & Time; Competition Logo; Animated Lower Third | **4 ON** | Real overlay controls, preview/persist |
| Branding | OTSI watermark; Custom Logo; End Screen | ON/OFF/ON | Brand assets/rights and project persistence |
| Output | Generate Reel dropdown/action; Preview Render; Save Project | Visible, not executed | Real render, honest statuses, persistence |

**Visible toggle count:** **8** total (**1 Player Targeting + 4 Overlays + 3 Branding**); seven ON and one OFF. The “Lock on confirmed player” line is **not an eighth/ninth extra toggle**: it has a colored icon and text, without a drawn switch. **Five slider controls**. **Three aspect cards**. **Four actual visible timeline lanes**. **Five suggested moment cards**. **Ten global navigation destinations**.

---

## 14. Source-truth details and non-invention rules

1. **The HTML page is a 2560×1440 absolute-positioned artwork**, not a live React reel editor. It draws divs and SVG icons, contains only a resize listener, and has no backend/DB connection or reel output. All expected behavior is *to be built*.
2. **No player is selected.** All player name, number, team, nationality, age/role/foot and match scores display neutral text/`—`. Do not populate these with imaginary people, matches, clubs or stats.
3. **No real key moments exist.** Section header explicitly reads `Suggested Key Moments (0)` while five placeholder cards are still drawn. Distinguish fixed five-card design slots from a real five-moment result set.
4. **No actual audio or timeline segments exist.** Timeline says “No audio selected,” “No text or overlays,” “No spotlight effects,” and “Add moments to build the reel.” Empty `[].forEach` means no selected overlay blocks.
5. **Slider values are visual preset labels, not measured evidence.** If default values are product choices, confirm them through saved settings; do not present them as player-confidence metrics.
6. **All overlay switch graphics show ON, but they do not guarantee an allowed render.** Competition logos, brand assets and personal data require policy/rights validation.
7. **Look and feel must remain source-aligned:** exact QHD canvas, three-column grouping, fixed panel locations, dark/navy aesthetic, blue actions, dashed/gradient artwork as applicable, 14 px panels, 8 px inputs, Segoe-style typography, and visible stage workflow.
8. **No unsupported feature additions:** do not invent extra aspect ratios, effects, timeline lanes, feature tabs, specific music titles, menu entries or rendering progress. Define such details later only from owner-approved functionality or actual engine capabilities.
9. **No destructive DB change is implied.** Data notes identify required source categories; use existing engine records and schema, extending via safe migrations only after actual implementation analysis.
10. **Distinguish actions from decorative shapes:** e.g. the blue halo, football, ball icon in scoreboard, thumbnail gradients, timeline placeholder tracks, and score tag are not evidence of computed intelligence.

---

## 15. Frontend visual and interaction acceptance criteria

- [ ] Render Page 06 at **2560×1440** with header y0–100, left panels x20–418, center panels x445–2038, and inspector x2065–2540; keep the same silhouette, relative spacing and section heights.
- [ ] Preserve **all 10 navigation labels** and Reel Builder active styling.
- [ ] Preserve all **four workflow stages** with exactly the current stage highlighted; changing selections updates progress truthfully.
- [ ] Preserve **three aspect cards** with the correct selected/unselected border colors, typography and spacing; changing ratio updates real composition state.
- [ ] Provide actual Title, Description, Duration and Music controls with accessible focus, validation and persistence; keep designed dimensions.
- [ ] Preserve the cinematic preview scene and player context geometry; show real footage/identity only when verified data exists.
- [ ] Wire player controls (previous/play/next/seek/volume/speed/settings/fullscreen) to actual media or an honest disabled state.
- [ ] Preserve exactly **five visible suggested-moment slots** in the reference empty state; bind their values and selection UI to actual suggestions if any.
- [ ] Preserve the exact **four timeline lanes** and their current empty-state wording; support intended editing without pretending clips already exist.
- [ ] Preserve the three inspector tabs, while retaining the page's visible stacked inspector sections unless separately approved.
- [ ] Preserve **five spotlight sliders**, labels, numeric values and fill/knob visuals; bind state, preview and persistence together.
- [ ] Preserve **eight visible switches** and their initial painted states (Auto Track ON; overlays all ON; watermark ON; Custom Logo OFF; End Screen ON) as visual reference, while obtaining real settings from persisted data when editing an existing project.
- [ ] Preserve the separately drawn **Lock on confirmed player** label/action (no invented source toggle), and Re-detect button.
- [ ] Wire Generate Reel, Preview Render and Save Project to actual permitted actions, with real loading/error/completion feedback.
- [ ] Never show invented player identity, moment, render progress, analytics, match score or export success.
- [ ] Keyboard and screen-reader interactions exist for controls despite visual source using only divs; focus styles should not alter the approved layout unexpectedly.
- [ ] Keep integration with the existing NestJS/MySQL/AI processing and render services; do not build a parallel imaginary service.

**Status:** Complete *frontend UI source inventory* for Page 06, plus brief backend/DB source pointers. **Owner approval required before locking or moving on to Page 07.**
