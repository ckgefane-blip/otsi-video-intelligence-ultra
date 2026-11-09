# Correction register — page by page

Source: the ten `*_AUTHORITATIVE_CLEAN.html` files in `OTSI_VIE_INDEPENDENT_10_PAGE_VISUAL_IMPLEMENTATION_CONTRACTS.zip`. Defects are from `OTSI_VIE_FOUR_WAY_DEEP_COMPARISON.zip`. Every change is an exact, asserted source replacement in `tools/fix_pages.py`, which can be re-run.

**Global (pages 01, 02, 06–10):** the runtime `cleanReferenceText()` string-substitution layer was removed; every visible string is now written literally in the source. That substitution caused the overflows and let sample values through. Pages 03–05 defined it but never called it, which is why they still showed mock data; the unused function was removed there too.

## 01 Home Overview — `01_HOME_OVERVIEW.html`

- Upload limit wording unified to the Upload page policy text "50 GB" (owner must confirm the real limit).
- Hero player card: fictional shirt number, player and club removed.
- Hero metrics card: five fictional values (incl. surviving "7") replaced with "—".
- Hero illustration detection tags: fictional jersey numbers removed (frames kept as illustration).
- Featured reel resolution badge: no reel exists, shows "—".
- Featured reel: fictional player/title replaced with empty state.
- Featured reel duration removed.
- Featured reel tag chips: sample tags removed; chips kept.
- Featured reel view count removed.
- Featured reel like count removed.
- Four KPI cards: fictional totals and trends removed.
- KPI trend: fictional "↑+n%" replaced with muted "—".
- KPI mini bar charts: rising fictional trend flattened to an empty baseline.
- Trust strip heading: unsubstantiated endorsement claim replaced with neutral heading.
- Trust strip: unlicensed third-party marks (UEFA, FIFA, LALIGA, SERIE A + shapes) removed; truthful empty state.
- "View All" (Recent Matches) no longer collides with its arrow icon (anchor 798→774).
- "View All" (Sample Reels) no longer collides with its arrow icon.
- "View All" (Capabilities) no longer collides with its arrow icon.
- Recent Matches: four fictional fixtures/scores/durations replaced by an empty state in row 1 and empty rows 2–4 (row geometry kept).
- Sample Reels: three fictional player reels with durations/views/likes replaced by empty cards.
- How It Works illustration: real player names replaced with generic labels.
- How It Works illustration: club code "MCI" replaced with generic "TEAM".
- How It Works report card: real player/club removed.
- How It Works report card: fictional statistics removed.
- How It Works step 1: upload limit wording unified ("50 GB").

## 02 Upload & Ingest — `02_UPLOAD_INGEST.html`

- Typo "(Optionall)" → "(Optional)".
- Competition select: preset competition removed; muted placeholder.
- Season select: previously rendered "Competition not selected" (wrong field); now "Choose season".
- Uploading stage: fictional file/size, completion tick and full (100%) progress bar removed; empty track kept.
- Uploading stage: green success dot neutralised (nothing uploaded).
- AI Detection stage: typo "anatch context..." fixed; fictional 68% progress fill removed; status "Waiting...".
- Indexing stage: "active" highlight removed (no job running).
- Tracking stage copy shortened so it no longer overflows its card (was +9 px).
- Analysis Ready stage copy shortened so it no longer overflows its card (was +15 px).
- Live Processing Preview: fictional "in progress" labels, completion ticks and progress fills removed.
- Live Processing Preview: fabricated detection boxes and heat-map thumbnail removed (placeholder frames kept).
- Live Processing Preview: zero-length progress fills no longer drawn.
- Recent Uploads: five fictional jobs (titles, competitions, dates, durations, statuses) replaced by an empty state; row geometry kept.
- Recent Uploads: fictional status pills (Completed/Processing/Queued/Failed) removed — previously overflowed and collided with kebab icons.
- Selected Item Preview: fictional duration removed.
- Selected Item Preview: fictional match/competition/date removed.
- Selected Item metadata: fictional file name, size, resolution, frame rate, duration and classification removed.
- Teams (Detected): fictional clubs removed — previously two labels overlapped each other and the second crest.

## 03 AI Processing — `03_AI_PROCESSING.html`

- Job card: fictional competition/match removed.
- Job card: fictional date/resolution/duration removed.
- Job status pill: fictional "Processing" replaced by "Idle".
- Overall progress: contradictory 71 % bar / "68%" label replaced by empty bar and "—".
- Five pipeline stages: fictional Completed/Processing/In Queue states and 100/100/78/32 % progress replaced by "Waiting" and empty bars; stage 2 copy shortened so it no longer runs under the → arrow.
- Stage rings: fictional completed/active rings rendered as pending.
- Stage percentages shown as "—".
- Processing Preview: fictional scoreboard (62:17, MCI 2–1 RMA) and competition banner removed; empty-state message added inside the frame.
- Processing Preview: 8 fabricated detection boxes, ID tags (incl. "17 MCI"), ground ring and pass line removed.
- Preview transport: fictional time code removed.
- Preview scrubber reset to start (no media).
- Player Detection tile: fictional "22 players detected" and box/tag removed; empty state.
- Ball Detection tile: fictional count and "Ball 0.98" confidence removed; empty state.
- Team Identification tile: fictional clubs/kits and boxes removed (also fixes subtitle overlapping the expand icon).
- Processing Log: "Live" indicator replaced by "Idle".
- Processing Log: live (green) dot neutralised.
- Processing Log: 15 fictional log lines (incl. "Identified: Kevin De Bruyne") removed; single empty-state line.
- System Resources: fictional GPU (NVIDIA A100 72 %), CPU (32 cores 48 %) and memory (1.8/2 TB) telemetry removed; rings empty.
- System Resources: fabricated utilisation sparklines removed.
- Processing Timeline: fictional 95:28 time axis (with irregular tick spacing) replaced by start/end markers.
- Processing Timeline: fabricated per-stage progress segments and 62:17 playhead removed; two empty lanes kept.
- Output Summary panel widened 291→839 px so it contains its four cards (cards previously spilled outside the panel).
- Output Summary: fictional counts (22 / 1 / 342 / 95:28) removed.
- Output Summary cards: value/label anchor moved 10 px left so "Players Tracked" fits inside its 188 px card (was +11 px overflow).

## 04 Analysis Workspace — `04_ANALYSIS_WORKSPACE.html`

- Match card: fictional competition and date removed.
- Match card: fictional home club and score removed.
- Match card: fictional away club and score removed.
- Status card: green success indicator neutralised (no analysis has run).
- Status card: false "Processing complete … processed successfully." replaced; second line no longer overflows the card (was +15 px).
- Team Filter: fictional clubs and 22/11/11 roster counts removed.
- Video scoreboard: fictional 62:17 MCI 2–1 RMA removed (scoreboard frame kept).
- Video frame: third-party sponsor marks ("mastercard", "priceless") and competition banner removed; empty-state message added.
- Video resolution badge: fictional "4K" removed.
- Video frame: 15 fabricated player detection boxes with jersey tags removed.
- Video frame: fabricated selected-player ground ring removed.
- Video frame: fabricated pass line removed.
- Transport: fictional time code removed.
- Transport: fictional 64 % scrub position reset to start.
- Event chips: fictional counts removed (nine chips kept); "Interceptions" chip widened 174→204 and "Fouls" 123→138 (Fouls/Cards shifted right into unused row space, Cards now ends at x=1974 inside the panel) so labels are no longer truncated by count badges.
- Active event chip: left padding 50→44 px (matches the base chip change).
- Event chip base style: left padding 50→44 px (icon dot ends at 36 px) to give labels room.
- Event chips: count badge inset reduced (right 10→6 px, padding 8→6 px) so chip labels ("Key Passes", "Interceptions", "Fouls") are no longer covered.
- Timeline scale: irregular tick spacing (189–248 px) corrected to an even 210 px.
- Timeline: 34 fabricated event ticks removed; empty-state message added.
- Tracks & Presence: real player names/numbers removed; nine lanes kept (7 player tracks + 2 team shapes).
- Tracks & Presence: lane checkboxes unchecked (no tracks exist).
- Tracks & Presence: fabricated presence bars removed.
- Timeline: fabricated 62:17 playhead removed.
- Event Types lanes: fabricated event markers removed (legend kept).
- Players tab: fictional count removed.
- Team chips: fictional clubs/counts removed (also fixes "Man City"/"Real Madrid" colliding with count badges).
- Team chip colour mapping updated for neutral labels.
- Players list: ten fictional players with confidence scores and selected row removed; empty state added (column headers kept).
- Player detail: fictional name and shirt number removed.
- Player detail: fictional club, national flag and nationality removed.
- Player detail chips: fictional position/foot/age removed.
- Player KPI cards: fictional values and deltas removed (also fixes "34.2 km/h" overflowing its card).
- Player heatmap: fabricated heat blob replaced with an empty pitch.
- Player stats list: fictional values removed.

## 05 Tactical Intelligence — `05_TACTICAL_INTELLIGENCE.html`

- Match card: fictional competition and date removed.
- Match card: fictional home club and score removed.
- Match card: fictional away club and score removed.
- Status card: green success indicator neutralised.
- Status card: false "Processing complete" replaced; overflowing line (+9 px) shortened.
- Team Filter: fictional clubs and 22/11/11 counts removed.
- Team selector: fictional club removed.
- Team Shape header: fictional club, formation 4-3-3 and 62:17 time removed.
- Formation pitch: fabricated shape polygon/lines removed; truthful empty state.
- Formation pitch: eleven real player nodes/names removed (also fixes "DE BRUYNE" label crossing the centre line).
- Team Metrics: fictional metre values and bar fills removed; "Defensive Line Height" shortened to "Def. Line Height" so it no longer overlaps its bar.
- Shape Variability: fabricated sparkline and "Low" rating replaced by empty bar and "—".
- Formation Stability: fictional 92 % removed.
- Formation Stability: 14 filled segments emptied.
- Build-up shape: fictional 4-2-3-1 removed; phase legend moved 30 px left.
- Defensive shape: fictional 4-4-2 removed; "Out of Possession" no longer overflows the panel (was +9 px).
- Video scoreboard: fictional time/score/clubs removed.
- Video frame: third-party sponsor marks removed; empty-state message added.
- Video frame: fabricated player ring and pass line removed.
- Video transport: fictional time code and 54 % position removed.
- Pass Network selectors: fictional club and time window removed.
- Pass Network: fabricated pass links removed; empty state.
- Pass Network: fabricated player nodes removed (legend kept).
- Possession panel: Heatmap/Territory/Final Thirds control moved 40 px right so it no longer covers the panel title.
- Possession panel: fictional clubs removed.
- Heat zones: two fabricated heat maps replaced with empty pitches.
- Possession: fictional 58 % (with mismatched 64 % bar) removed.
- Possession: fictional 42 % (with mismatched 44 % bar) removed.
- Pressing selector: fictional club removed.
- Pressing Map: 26 fabricated pressing events removed; empty state.
- Pressing metrics: fictional PPDA/success/regains/height removed.
- Off-Ball Runs selectors: real player and time window removed.
- Off-Ball Runs: fabricated run paths removed; empty state.
- Off-Ball Runs: fabricated run marker removed.
- Off-Ball Runs stats: fictional values removed (also fixes "18.3 m" overflowing the stats box).
- Player Comparison A: real player, club and number removed.
- Player Comparison B: real player, club and number removed.
- Player Comparison metrics: fictional head-to-head values and fixed comparison fills removed.

## 06 Reel Builder — `06_REEL_BUILDER.html`

- Wizard: current-step band moved from step 3 to step 1 (no player is selected, so the workflow is at "Select Player").
- Wizard: false completion ticks on steps 1–2 and fictional player/"12 moments selected" removed.
- Wizard: active step circle moved to step 1.
- "Title" label moved above its input (was 64 % hidden behind the input box); fictional title replaced with placeholder.
- Description: fictional reel description replaced with placeholder.
- Description placeholder rendered muted.
- Music selector: fictional track removed.
- Player header: fictional player/number removed; number badge moved 70 px right so it no longer overlaps the name.
- Player header: fictional club removed.
- Player header: national flag and nationality removed.
- Player header: fictional role/foot/age removed.
- Scoreboard: fictional match clock removed.
- Scoreboard: fictional clubs and 2–1 score removed.
- Transport: fictional time code removed.
- Transport: fictional progress fill removed; knob at start.
- Moments header count corrected to 0.
- Suggested Key Moments: five fictional moments with match times, durations and selection ticks replaced by empty slots (five card frames kept).
- Moment card 1 no longer shown as selected.
- Moment cards: fictional opponent removed.
- Timeline ruler: fictional 3-minute reel scale removed (empty timeline).
- Video Clips lane: six fictional clips and trim handles removed; empty-lane hint.
- Spotlight Effects lane: fictional effect segments removed.
- Text & Overlays lane: fictional title/competition overlays removed.
- Audio lane: fictional music file and waveform removed.
- Timeline: fictional 00:42 playhead removed.
- Player Targeting: real player removed; lock requires a confirmed identity.

## 07 Clip Studio — `07_CLIP_STUDIO.html`

- Title: "/" separator moved 10 px right so it no longer touches "Clip Studio".
- Media Bin breadcrumb: fictional club/player/season folders removed (previous labels overlapped each other and their chevrons).
- Media Bin: nine fictional clip thumbnails with durations removed; empty state added.
- Media Bin: fictional selection frame/tick removed.
- Preview: fictional "4K" source badge removed.
- Preview: fictional player overlay card removed; empty-state message added.
- Preview: fictional player name/number/"Progressive Passes" overlay removed.
- Preview: fictional stats overlay panel removed.
- Preview: fictional stats (42 / 8 / 0.54) removed.
- Preview: fictional stats bar glyph removed.
- Preview transport: fictional time code replaced with zero.
- Preview transport: fictional progress removed; knob at start.
- Inspector: fictional clip duration removed.
- Inspector: fictional file name, technical line and added date removed.
- Inspector Player: real player removed.
- Inspector Match: fictional match removed.
- Inspector Event Type: fictional event removed.
- Inspector Timestamp: fictional match time removed.
- Inspector Tags: fictional tags removed (add button kept).
- Inspector Notes: fictional notes replaced with placeholder.
- Timeline timecode: fictional position/length replaced with zero.
- Timeline ruler: fictional sequence scale removed; "00:00" label nudged 22 px right so the playhead handle at 00:00 does not cover it.
- Timeline overview strip: fictional filmstrip replaced with empty strip.
- Track headers: fictional item counts replaced with 0 (eight tracks kept).
- Track header labels 20→18 px so "Graphics & Overlays" no longer runs under its count badge.
- Timeline: all fictional clips removed; eight empty lane guides (one per track) and an empty-state hint added so the lane structure stays visible.
- Timeline: fictional selected clip "de_bruyne_pass_001.mp4" removed.
- Timeline: fictional media files removed.
- Transitions lane: fictional transitions removed.
- Graphics lane: fictional graphics removed.
- Graphics lane: fictional waveform removed.
- Lower Thirds lane: fictional items removed.
- Captions lane: fictional captions (incl. real player name) removed.
- Statistics lane: fictional stats (7.4 km, xA 0.54) removed.
- Soundtrack lane: fictional music file and waveform removed.
- Audio FX lane: fictional sound effects and waveforms removed.
- Playhead moved to 00:00.

## 08 Player Report — `08_PLAYER_REPORT.html`

- Hero: giant fictional shirt-number watermark removed.
- Hero: fictional player name and number removed.
- Hero: fictional position and MC/AM/RW codes removed (three chips kept).
- Hero: fictional club removed.
- Hero: national flag and nationality removed.
- Hero bio: fictional age/height (181 cm)/weight (70 kg)/foot removed.
- Tracking Confidence: fictional 98 % ring removed.
- Tracking Confidence pill: green "High"/success styling replaced by neutral "Unverified"; pill widened 80→122 px so the label fits (was +35 px overflow).
- Tracking Confidence: fictional "Excellent … 528+ minutes" removed.
- Role summary: fictional role removed.
- Role summary: fictional description removed.
- Role summary: five fictional trait chips removed.
- Nine KPI cards kept; all fictional values and deltas (incl. surviving "6", "4", "↑ +8%", "92% of match") removed — deltas previously collided with the mini charts.
- KPI mini charts: fictional rising bars flattened to an empty baseline.
- Heatmap: eleven fabricated heat blobs removed; empty state.
- Event Timeline: ten fictional events (times, descriptions naming real players, clips) removed; empty state.
- Action Map: 46 fabricated actions and 23 pass lines removed (lines previously spilled outside the pitch).
- Action Map: fabricated goal marker removed.
- Comparison selector: fictional cohort removed.
- Comparison: fictional per-90 values and bar lengths removed (bars still encoded sample values before).
- Comparison: zero-length player bars not drawn.
- Comparison: zero-length cohort bars not drawn.
- Comparison legend: real player removed.
- Generated Insights: four fictional AI insights with invented statistics removed; four card frames kept with an empty state.
- Scouting: fictional 9.2/10 rating removed.
- Scouting: five fictional strengths with success ticks removed (also fixes "Leadership and experience" overflowing its box).
- Scouting: decorative quote mark removed (it overlapped the quote text and there is no quote).
- Scouting: fictional scout quote removed.
- Scouting footer: attribution replaced with truthful status.
- "Add to Scouting Dossier" icon/label moved 12–14 px left so the label no longer touches the button edge.
- Ring gauge: no arc (and no stray round-cap dot) is drawn when the value is empty.

## 09 Library / Project Center — `09_LIBRARY_PROJECT_CENTER.html`

- Match card: fictional competition and date removed.
- Match card: fictional clubs and 2–1 score removed.
- Status card: green success shield neutralised.
- Status card: false "Processing complete … processed successfully." replaced.
- Team Filter: fictional count 22 removed.
- Team Filter: fictional clubs and 11/11 counts removed.
- Asset tabs: fictional counts (284/96/48/32/41/67/8) replaced with 0; count chips for Matches (+12 px) and Folders (+17 px) moved clear of their labels; "Shared With Me" moved 14 px left and Templates re-spaced so labels no longer collide with the neighbouring icon/chip.
- Filters: Type select narrowed 167→142 px and Competition widened 176→201 px (same row extent) so "All Competitions" no longer runs under its chevron.
- Filters: Competition value set at 19 px to clear its chevron.
- Saved Searches: five fictional saved searches (real player/club names) removed; empty state (Save Current Search kept).
- Typo "Thumbnall / Title" → "Thumbnail / Title".
- Asset table: ten fictional assets (titles, players, collaborators, dates, statuses) removed; ten-row ruling kept; empty state in row 1. Removes the "Awaiting actual status" pills that overflowed by ~96 px.
- Asset table: fictional row data removed. (×9)
- Selected Item: fictional duration removed.
- Selected Item: fictional title removed.
- Selected Item: fictional type/tag chips removed (previous "Player not selected" overflowed its chip by 139 px).
- Selected Item: fictional description removed.
- Selected Item Competition: fictional value and logo removed.
- Selected Item Match: fictional crests/score/club removed (value previously ran past the 2560 px stage edge).
- Selected Item Players Featured: real players removed.
- Selected Item Created By: fictional user removed.
- Selected Item: fictional curated date, duration, file size and resolution removed.
- Selected Item Tags: fictional tags removed.
- Collaborators: fictional count 55 → 0; count chip moved 20 px right so it no longer overlaps the heading.
- Collaborators: fictional people (John Doe, Sarah Kim, Mike Chen) removed.
- Collaborators: fictional "+2" removed.

## 10 Export & Delivery — `10_EXPORT_DELIVERY.html`

- Intro copy 22→21 px so line 2 no longer overflows the panel (+6 px).
- Wizard: current-step band moved from "Render & Process" to step 1 (nothing has been finalised).
- Wizard: false completion ticks on steps 1–2 removed (also removes the tick that overlapped "Choose format, branding and output").
- Wizard: active step circle moved to step 1.
- Project Summary: fictional player/reel removed.
- Project Summary: fictional match, competition (previously overflowing +18 px), date and duration removed.
- Project Summary: fictional tags removed.
- Preview: third-party competition mark removed.
- Preview: fictional "4K" render badge value removed.
- Preview title card: fictional player/reel/match/date removed (the long name previously ran under the play button).
- Preview stat cards: surviving fictional values 12/8/6 removed; cards widened 258→278 px so "Progressive Passes" fits (was +10 px).
- Preview transport: fictional duration removed.
- Preview transport: fictional progress removed.
- "Auto Chapters" label moved 10 px left so it no longer touches its toggle.
- Chapters header count corrected (was 12 with six cards).
- Chapters: six fictional chapter cards with durations removed; empty state.
- Chapters: selected-chapter underline removed.
- Brand selector wordmark: tagline moved 4 px down so it no longer overlaps "OTSI VIE".
- Brand preview wordmark: tagline moved 4 px down so it no longer overlaps "OTSI VIE".
- Export Queue count corrected.
- Export Queue: fictional rendering job removed.
- Export Queue: fictional job title/spec/"Rendering..." removed.
- Export Queue: fictional 99 %-filled progress bar, "68%" and "12 min remaining" removed.
- Export Queue: job pause/cancel controls removed with the job.
- Export Queue: two fictional queued jobs removed (their spec lines were partly clipped).
- Output & Reports: "Include …" prefix dropped (the checkbox already means include) so labels no longer run under the Preview chips.
- Output & Reports rows 3–4: title/subtitle moved up so the subtitle sits inside its 58 px row (was 4 px outside).
- Shareable Link status: green "Ready" (contradicting no export) replaced by neutral "Not ready"; pill widened 84→124 px (and shifted 12 px left inside the panel) to fit.
- Shareable Link: fictional URL removed.
- Team Collaboration: fictional members removed (add button kept).
- Message box: placeholder instead of pre-written message.
- Render Progress: fictional "Rendering Video 68%" and active steps replaced by "Waiting..." for all four stages.
- Render Progress: step 1 no longer shown as active.
- Render Progress: first connector neutral.
- Render Progress: fictional 62 % bar fill removed.
- Delivery status: contradictory green success tick with "Ready for Delivery" replaced by a neutral indicator and "Delivery not ready".

## Policy decisions taken (owner to confirm)
- **Upload limit:** Home now says "up to 50 GB", matching the Upload page. The real limit is a product/infrastructure decision; change both strings if it differs.
- **Settings versus data:** user-editable defaults are kept as shown. These are toggle states, slider percentages (06), the export preset and 4K / 60 fps / MP4 / High (10), report checkboxes, and share-link toggles. They are configuration, not measured data.
- **Generic scales kept:** the 0–90 minute match-clock axis (04, re-spaced evenly) and the pass-count legend buckets (05).
- **Illustrations kept:** stadium and pitch gradients, placeholder thumbnails, the hero spotlight art and the How-It-Works pictograms (generic labels only).