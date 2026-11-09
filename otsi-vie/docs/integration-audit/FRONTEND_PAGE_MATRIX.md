# Frontend page matrix — current Next.js app

**Commit:** `d3ef2f5` · 2026-10-27 · App: `apps/web` (Next.js 15.1.3, React 19, Tailwind 3), production build served on 127.0.0.1:4310,
API proxied same-origin under `/api/*` to 127.0.0.1:4320.

Every page renders **all sections of its approved specification** (102 sections, generated from the 10 page specs by
`tools/web/extract_page_specs.py`, checked in CI) in the composition of the approved image. Each section is in exactly one state:

| State | Meaning on screen |
|---|---|
| **Live** | Connected to the real API; real operations. |
| **Static** | Product copy or navigation with no data behind it; complete as rendered. |
| **Shell** | Rendered once by the global header. |
| **Owner** | Needs an owner-supplied, licensed asset or decision; shows "Owner asset needed". |
| **Placeholder** | Title, what it will show, the planned contract and "Not connected · Block NN". Never sample data. |

## Global shell (all signed-in pages)
| Control | State | API | Notes |
|---|---|---|---|
| Sign-in page `/login` | Live | `POST /v1/auth/login` | Return address restricted to the app (`safe-next`), e2e |
| Session keep-alive | Live | `POST /v1/auth/refresh` (HttpOnly cookie) | Access token in memory only; one silent refresh on 401 |
| Navigation (Home, Matches, Analysis, Reels, Reports, Library) | Live (routing) | — | Matches route shows the Library page (page 9) |
| Search box / Ctrl+K palette | **Local-only** | — | Finds the app's pages only; says that player/match/clip search needs Block 09 |
| Theme toggle | Local-only | — | Persists in localStorage |
| Profile chip: user, role, organisation switch, sign out | Live | `GET /v1/me`, `POST /v1/auth/logout` | Organisation stored as `X-Organization-Id` choice |
| Match rail (pages 5, 9 composition) | Placeholder | — | "No match selected"; matches do not exist yet |

## Pages
### 01 Home `/dashboard`
| § | Section | State | Notes |
|---|---|---|---|
| 1 | Header & navigation | Shell | |
| 2 | Hero | Static | CTAs deep-link to `/upload?mode=file|url` |
| 3 | Featured reel | Placeholder (Block 10) | |
| 4 | KPI strip | Placeholder (Block 9) | |
| 5 | Trust strip | Owner | Licensed partner marks needed |
| 6 | Recent matches | Placeholder (Block 3) | **Could be connected now** to `GET /v1/videos` (recent videos), but videos are not matches — needs a design decision |
| 7 | Sample reels gallery | Placeholder (Block 10) | No sample/fictional reels may be shown (ADR-020) |
| 8 | Capabilities grid | Static | |
| 9 | How it works | Static | |

### 02 Upload & Ingest `/upload` (`?mode=file|url|batch`)
| § | Section | State | API | Notes |
|---|---|---|---|---|
| 1 | Header + source-mode tabs | Live (local routing) | — | Copy of the URL tab still says platform pages "need a licensed integration" — outdated since ADR-027 (copy fix only) |
| 2 | Match context sidebar | Live | `GET/POST /v1/projects` | Projects only; competition/teams/date fields do not exist (no matches) |
| 3 | Processing configuration | Placeholder (Block 4) | | Analysis settings live on page 03 instead |
| 4 | Detection & ingest options | Placeholder (Block 3) | | |
| 5 | Drag-drop file panel | Live | `POST /v1/uploads`, `PUT …/parts/:n`, `POST …/complete`, `DELETE /v1/uploads/:id` | Parallel parts, SHA-256 per part, pause/resume/cancel |
| 6 | URL import | Live | `GET /v1/import-providers` (policy bundled), `POST /v1/imports` | Shows provider status, reason, alternative; token field for Vimeo/Drive |
| 7 | Supported formats | Static | | |
| 8 | Recent uploads | Live | `GET /v1/videos?project_id=` (polled while busy) | Real states incl. quarantined + reason |
| 9 | Selected upload details | Live | `GET /v1/videos/:id`, `/thumbnail` | Measured facts; "Analyse this video" and "Analysis Workspace" links; metadata **not editable** (no PATCH) |
| 10 | Pipeline strip | Live | from the video | Detection & tracking now point to page 03 |

### 03 AI Processing — `/videos/:videoId/processing` (live) and `/processing` (no video: all placeholders)
| § | Section | State | API |
|---|---|---|---|
| 1 | Run headline + **Start analysis** (fps 1/2/3/5, detail level) + cancel + open workspace | Live | `GET /v1/videos/:id`, `GET/POST /v1/videos/:id/analysis-runs`, `POST /v1/analysis-runs/:id/cancel` |
| 2 | Pipeline lifecycle | Live (Shots, Detection, Tracking with real progress) + Identity/Events/Indexing marked "not built" | polled every 2 s |
| 3 | Frame-level detection preview | Placeholder | (the workspace player covers this need) |
| 4-7 | Player / ball / team / event insets | Placeholder | |
| 8 | Processing log | Live (worker stage message, failure code + reason, run history) | |
| 9 | System resources | Placeholder (Block 15) | |
| 10 | Frame-level timeline | Placeholder | |
| 11 | Live output summary | Live (people tracks, ball tracks, shots, frames, time, detector + device) | |

### 04 Analysis Workspace — `/videos/:videoId/analyze` (live) and `/analysis` (no video: all placeholders)
| § | Section | State | API / behaviour |
|---|---|---|---|
| 1 | Match rail | Live (video, run, counts) | Teams/score/competition: "not detected yet" |
| 2 | Mode tabs | Placeholder (Block 14) | |
| 3 | Video player | Live | `GET /v1/videos/:id/playback` → signed `/api/v1/media/:asset` (Range) |
| 4 | Boxes + IDs | Live | `GET /v1/analysis-runs/:id/observations` (10 s chunks); solid = this frame, dashed = nearest analysed frame; click selects |
| 5 | Overlay toggles | Live (boxes, labels, people, ball) — **local-only state** | |
| 6 | Roster panel | Live as a **track list** (people/ball filter, min observations) | `GET /v1/analysis-runs/:id/tracks`; no 22-player roster, no thumbnails, no teams |
| 7 | Selected detail card | Live as **track detail + identity review** | `GET /v1/tracks/:id/identity`, `GET /v1/players?q=`, `POST /v1/players`, `POST /v1/tracks/:id/identity-decisions`; no portrait/metrics |
| 8 | Transport | Live (play/pause, seek, ±1 analysed frame, speed) | |
| 9 | Events ribbon | Placeholder (Block 8) | |
| 10 | Presence timeline | Live for the selected track (observed spans, gaps) | No team lanes or events |
| 11 | Clip entry | Placeholder (Block 10) | |

### 05 Tactical Intelligence `/tactics`, `/videos/:id/tactics` — all 9 sections Placeholder (Blocks 4, 8, 9)
### 06 Reels / Spotlight Composer `/reels` — all 10 sections Placeholder (Blocks 10, 11)
### 07 Clip Studio `/studio` — all 11 sections Placeholder (Blocks 10, 11)
### 08 Player Report `/reports`, `/reports/players/:playerRef` — all 12 sections Placeholder (Blocks 2, 7, 9, 12); the player route validates the reference (OTSI ID or UUID) and displays it, nothing else
### 09 Library `/library` (also `/matches`) — all 10 sections Placeholder (Blocks 12, 14)
### 10 Export & Delivery `/exports` — all 9 sections Placeholder (Blocks 11, 12)

## Totals
| | Sections |
|---|---|
| Live | 19 (page 02: 7 · page 03: 4 · page 04: 8) — pages 03/04 only on the per-video routes |
| Static | 4 (home 2, 8, 9 · upload 7) |
| Shell | 1 (home 1, the global header) |
| Owner | 1 (home 5) |
| Placeholder | 77 |
| **Total** | **102** |

## Missing features visible in the approved designs (frontend side)
- Matches (teams, competition, score, date) everywhere a "match" is shown.
- Roster with 22 players, thumbnails, jersey numbers, teams (page 04 §6).
- Player portrait, metrics and heatmap (page 04 §7, page 08).
- Events, tactical views, reels editor, clip studio, reports, library assets, exports, billing, admin console.
- Edit video metadata (page 02 §9) — no API.

## Test coverage of the frontend
`apps/web/test/*` (28 unit tests: page/section inventory, identity labels, safe redirects, shell). `apps/web/e2e/shell.spec.ts` (every page renders
every approved section without sample data or errors, navigation, palette, theme, security headers, small screens, sign-in/out),
`upload.spec.ts` (journey 1-3, quarantine, type refusal, link-import policy), `workspace.spec.ts` (journey 3-8 on real footage).
