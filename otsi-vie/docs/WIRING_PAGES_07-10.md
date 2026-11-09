# Pages 07-10: each section, the engine data behind it, and the gap

Owner, 2026-11-05: "All pages should work perfectly and fully wired in all sections per page." Then: "First study the engine data as
all sections/pages are designed to work. Do not randomly build rubbish."

Method: each section's approved spec (`blueprint/.../02_APPROVED_UI_IMPLEMENTATION/07-10_*.md`) was set against (1) the tables the
database was designed with, (2) the rows the engine has actually recorded in the live workspace (counted 2026-11-05), (3) the API routes
and (4) what the page does today.

## What the engine has recorded (live workspace, 2026-11-05)
| Data | Rows | Meaning for these pages |
|---|---|---|
| Videos / analysis runs | 8 / 14 | |
| Tracks / track positions | 100,544 / 2.86 M | player trails can be drawn |
| Confirmed identities | 136 decisions, 37 players | only these may be named |
| Pitch calibrations | 21,910 | heatmaps, team shapes and pass arrows have pitch positions |
| Ball positions | 124,164 | |
| Events | 4,768 | POSSESSION 2,973 · TEAM_POSSESSION 1,221 · POSSESSION_CHANGE 258 · **PASS 138** (from/to and length stored) · PRESSURE 78 · TACKLE 38 · INTERCEPTION 32 · SET_PIECE 29 · GOAL 1. **No SHOT events.** All DETECTED/INFERRED; **0 reviewed** (event_decisions empty) |
| Match halves | 1 match, PROPOSED (not confirmed) | 1st / 2nd half filters can work, marked "proposed" |
| Reels / clips / renders | 1 / 57 / 8 | |
| Brand assets | 1 (an intro video) | no logo, no music uploaded yet |
| Rights grants | 1 | |
| Designed but empty | timeline_tracks, timeline_items, effect_keyframes, effect_presets, report_jobs, deliveries, project_acl, share_links, metric_definitions, metric_values, metric_cohorts, evidence_records, clip_reviews, comments | the database was designed for these sections; no service fills them yet |

The renderer (`services/worker/vie_worker/render`) already draws: spotlight, name caption, **score bug, lower third, watermark,
competition logo, custom logo, end screen, event tags, match card, intro, outro, music**. It does **not** apply clip speed
(`reel_clips.playback_speed` exists, nothing reads it), colour, transforms, graphics, captions or transitions.

## Kinds
- **R** ready: the data and the API exist; only the page is not connected (its "not built" label is out of date).
- **A** the data is in the database; an API route is needed, then the page.
- **T** the table was designed and is empty; a service, API and page are needed.
- **W** the renderer must learn it (worker), plus the page.
- **E** the engine does not produce this data. It stays "Not measured" until the engine does (no invented numbers).
- **Z** zero-cost limit (ADR-030): built the free way, stated below.

## Page 07 Clip Studio (11 sections)
| # | Section | Engine data | Today | Gap | Kind |
|---|---|---|---|---|---|
| 1 | Header: Back, Save, Undo, Redo, AI Edit, Export | reels, renders | works | — | done |
| 2 | Media bin: Media | confirmed moments | works | — | done |
| 2 | Media bin: Graphics | brand_assets (logos, intro/outro) | **wired 2026-11-05** | — | done |
| 2 | Media bin: Audio | brand_assets music | **wired 2026-11-05** | — | done |
| 2 | Media bin: Templates | effect_presets (reel-look/1) | **wired 2026-11-06** (ADR-055): save, apply, update, delete a reel look | — | done |
| 3 | Preview compositor | video, spotlight | works | — | done |
| 4 | Inspector: clip details | reel_clips, notes, events | **wired 2026-11-05**: Event Type is his main engine event inside the clip | — | done |
| 4 | Inspector: AI Insights | events inside the clip's time | **wired 2026-11-05**: every engine event in the clip, his marked, Detected / Inferred | — | done |
| 4 | Inspector: Adjustments | reel_clips.playback_speed | "not built" | speed control + renderer | W |
| 5 | Tools: Split, Cut, Ripple Delete, AI Highlights, Zoom | clips | work | — | done |
| 5 | Tools: Marker | comments.at_pts_us (notes with a time) | **wired 2026-11-05** | — | done |
| 5 | Tools: Speed | playback_speed | "not built" | renderer | W |
| 5 | Tools: Audio | music_id, clip volume | music pick **wired 2026-11-05** | per-clip volume | W |
| 5 | Tools: Graphic | logos via settings | **wired 2026-11-05** | — | done |
| 5 | Tools: Color, Transform | — | "not built" | renderer (brightness/contrast, crop/zoom) | W |
| 5 | Tools: Voiceover | — | "not built" | record in the browser, mix in render | W |
| 5 | Tools: Captions | — | "not built" | free local speech model (whisper.cpp, MIT) | W + Z |
| 6-7 | Ruler, video lane | clips | work | — | done |
| 8 | Transitions lane: Fade, Zoom, Spin, Dissolve | timeline_items on a TRANSITION track | **wired 2026-11-06** (ADR-055): set per cut, drawn into the MP4 | — | done |
| 9 | Graphics & spotlight lane | spotlight, logos | spotlight works | pass trajectory from PASS events, logo items | A + W |
| 10 | Lower-third, captions, statistics lanes | lower_third, event_tags | **wired 2026-11-05** | — | done |
| 11 | Soundtrack, audio FX lanes | music_id | **wired 2026-11-05** | — | done |

## Page 08 Player Report (12 sections)
| # | Section | Engine data | Today | Gap | Kind |
|---|---|---|---|---|---|
| 1 | Navigation rail | comments.player_id, player_tags (0042) | **wired 2026-11-06** (ADR-056): Notes & Tags opens the team's notes and tags | — | done |
| 2 | Identity hero | players, profile | works | Edit only by permitted roles | done |
| 3 | Tracking confidence | identity decisions; no calibrated accuracy | shows real coverage | "Unavailable" for accuracy until Step 2 accuracy marks | E |
| 4 | Role summary and traits | player_assessments.published (0042) | **wired 2026-11-06**: the published assessment, marked "Analyst opinion"; Edit writes it | — | done |
| 5 | Actions: Export PDF | report_jobs, assets REPORT | **wired 2026-11-06**: PDF printed by the local headless Chromium (free); notes left out | — | done + Z |
| 5 | Actions: Share Link | share_links on the PDF asset | **wired 2026-11-06**: only when every source video's rights allow sharing; re-checked at opening | — | done |
| 5 | Actions: Scouting Dossier | scouting_dossiers (0042) | **wired 2026-11-06**: named lists of players, tick to add | — | done |
| 6 | KPI row | measures + events (passes, key passes, shots, balls won) | works (passes / shots from events since 2026-11-02) | — | done |
| 7 | Heatmap + 1st/2nd half | heat zones, **halves PROPOSED** | **wired 2026-11-05** (`?half=1|2`) | — | done |
| 8 | Event timeline | events on his confirmed tracks | **wired 2026-11-05** (`GET /v1/players/:id/events`): filter, each opens the video at that moment (`/analysis?video=&t=`) | — | done |
| 9 | Action map: Passes | PASS from/to (picture) + calibrations | **wired 2026-11-05**: arrows where the pitch is calibrated at both ends; says how many could not be placed | — | done |
| 9 | Action map: Shots | **no SHOT events** | — | stays "Not detected by the engine" | E |
| 10 | Peer comparison | his and the group's measures, computed live | **wired 2026-11-06**: his line or all players, per 90 min on camera, group size shown; xA / progressive actions are not measured (E) | — | done |
| 11 | Generated insights | measures + events | **wired 2026-11-06**: up to 4 sentences, each naming its source; no text model | — | done |
| 12 | Scouting rating | player_assessments.published | **wired 2026-11-06**: rating, criteria, scout notes; shown only once published | — | done |

## Page 09 Library (10 sections)
| # | Section | Engine data | Today | Gap | Kind |
|---|---|---|---|---|---|
| 1-5 | Header, tabs, search, saved searches, table | videos, reels, projects, saved_searches | work | — | done |
| 6 | Status / collaborators | projects.access, project_acl (0043) | **wired 2026-11-06** (ADR-057): each row shows its project's people (initials) and a lock when only they may see it; Shared With Me lists items of others' projects you were put on | — | done |
| 7 | Preview: overlays Boxes, IDs, Ball | tracks, ball | work | — | done |
| 7 | Preview: Player Tracks | observations pitch_x/y + window calibrations | **wired 2026-11-05**: default for the Analysis video; last 3 s per shown person, where calibrated | — | done |
| 7 | Preview: Heatmaps, Team Shapes | calibrations, heat-zones | **wired 2026-11-05**: heat of the selected player or each team laid on the pitch; each team's outline of its measured players on screen with m² | — | done |
| 7 | Preview: Pass Arrows | PASS from/to + calibrations | **wired 2026-11-05**: passes around the playhead, ends re-placed into the current frame; key passes gold | — | done |
| 7 | Match periods filter | halves PROPOSED | **wired 2026-11-05**: limits the Events tab | — | done |
| 8 | Metadata | matches, players | works | — | done |
| 9 | Quick actions: Duplicate | reels, clips | **wired 2026-11-05** (`POST /v1/reels/:id/duplicate`) | — | done |
| 9 | Quick actions: Deliver | deliveries (0044) | **wired 2026-11-06** (ADR-058): Send to Client opens the reel's Export & Delivery page | — | done |
| 10 | Collaborator access | projects.access, project_acl (0043) | **wired 2026-11-06** (ADR-057): Manage Access: everyone or only chosen people; Viewer / Reviewer / Editor / Manager; enforced by the server on every route and list | new people are invited on Team (organization invitations) | done |

## Page 10 Export (9 sections)
| # | Section | Engine data | Today | Gap | Kind |
|---|---|---|---|---|---|
| 1 | Workflow rail | renders | works | — | done |
| 2 | Preview + chapters | renders, clips | speed and player settings (loop, picture in picture) **wired 2026-11-05** | captions after Clip Studio captions | W |
| 3 | Preset, resolution, frame rate | encoder profiles | fixed | choices the encoder really supports (no fake 4K) | W |
| 4 | Branded overlays | **renderer already draws all of them** | **wired 2026-11-05** | — | done |
| 5 | Export queue + Clear all | render_jobs.cleared_at (0040) | **wired 2026-11-05** (`POST /v1/renders/clear-finished`) | — | done |
| 6 | Output bundles: PDF / CSV / PNG | export_bundles, export_bundle_items (0044) | **wired 2026-11-06** (ADR-058): Performance PDF, Clip Sheet PDF, Event List CSV, Heatmap PNG per render, each made / failed / not measured; Download All = ZIP + manifest | — | done |
| 7 | Share link | share_links password_hash, can_comment; comments.share_link_id (0040) | **wired 2026-11-05**: password, comments on the shared page, team reads them | — | done |
| 8 | Team and client message | members, invitations, deliveries.team_user_ids / message (0044) | team list + Manage / invite **wired 2026-11-05**; Notify team / client and the message **wired 2026-11-06** (ADR-058) | — | done |
| 9 | Final actions: Deliver to Client | deliveries (0044) | **wired 2026-11-06** (ADR-058): rights-checked link, delivery record (BLOCKED kept), own mail app, link openings counted | — | done |

## Build order (proposed)
1. **All R rows** on the four pages: stale labels go, the page reads data that already exists. No new tables.
2. **A rows**: small API routes over existing data (pass arrows, events per player and per clip, duplicate, share password, clear).
3. **T rows** page by page: Clip Studio (templates, transitions), Player Report (notes, summary, PDF, dossier, cohort, rating),
   Library (project access), Export (reports, delivery).
4. **W rows**: renderer work (speed, colour, transform, transitions, voiceover, captions, resolution).
5. **E rows** stay "Not measured" / "Not detected". They are engine work (shot detection, accuracy), not page work.

Each block: tests, commit, redeploy, then clicked in the real app before it is ticked.
