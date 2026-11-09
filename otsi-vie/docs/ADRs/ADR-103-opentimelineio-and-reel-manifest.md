# ADR-103: OpenTimelineIO export and .otsi-reel manifest (v3 Phase C.3)

Date: 2026-11-08. Status: accepted. No migration.

## Decision

Every non-empty reel can be exported as an OpenTimelineIO timeline (`Timeline.1`, `.otio`) and as a portable OTSI VIE reel manifest (`otsi-reel/v1`, `.otsi-reel`) carrying the reel's evidence flags.

- **Shared contracts (`packages/contracts/src/interchange.ts`):**
  - `buildOtsiReelManifest` and `buildOtioTimeline` (wrapped by `buildInterchangeExport`) construct both files deterministically from the reel's saved clips, retime effects, spacers (`gap_ms`), transitions, audio gain, spotlight look, B.22 export preset (`?preset=`), and current evidence state.
  - Time ranges use microsecond precision (`OTIO_RATE = 1_000_000`). Both files carry the exact source video hashes (`sha256`), clip windows (`start_us`, `end_us`, `output_us`), and per-clip engine events that start inside the clip in video time.
  - **Faithful evidence flags (`OtsiReelEvidenceFlags`):**
    - `player_identity`: `"CONFIRMED"` only when a person has confirmed the player on every followed track (`targets`) and `identity_stale === false`; `"STALE"` when a later decision superseded a followed track's identity; `"UNCONFIRMED"` when no followed track is recorded.
    - `match_clock`: `"CONFIRMED"` when a person confirmed the match halves (`clock_source === "CONFIRMED"`); `"NOT_SET"` otherwise.
    - `match_score`: always `"NOT_MEASURED"` on reels.
    - `events`: `"INFERRED"` when at least one engine-recorded player event starts inside the reel's clips (`events_accuracy_verified: false` while evaluation gates G05–G07 remain open); `"NONE_IN_REEL"` when events exist on the video for the player but none falls inside the clips; `"NOT_RECORDED"` when no events are recorded for the player on the video.
    - `rights`: mirrors the source video's current rights grant (`state`, `share_allowed`, `download_allowed`, `valid_until`, `guardian_consent_status`), or `state: "UNRECORDED"` with sharing and download disallowed when no grant is recorded.
- **API (`apps/api/src/modules/exports/exports.ts`):**
  - `GET /v1/reels/:reelId/interchange` returns `{ filename_base, otio, manifest }` after checking project access (`ProjectsService.requireForVideo`). Refuses an empty reel (`409 REEL_EMPTY`) and unknown presets (`404 EXPORT_PRESET_NOT_FOUND`).
  - `GET /v1/reels/:reelId/interchange/otio` and `GET /v1/reels/:reelId/interchange/otsi-reel` stream the individual JSON documents with `Content-Disposition: attachment` (`application/vnd.pixar.opentimelineio+json` and `application/vnd.otsi.reel+json`).
- **Web (`apps/web/src/components/exportstage/Interchange.tsx`, `Right.tsx`, `ExportStage.tsx`, `state.tsx`):**
  - Export Settings (`p10-settings`) adds `Interchange…` (`[data-open-interchange]`), opening the `Timeline interchange (.otio & .otsi-reel)` dialog (`[data-dialog="interchange"]`).
  - The dialog displays the reel summary, the five faithful evidence lines (`describeEvidenceFlags`), a switcher between `.otsi-reel (otsi-reel/v1)` and `OpenTimelineIO (Timeline.1)` JSON previews, and download buttons for both files (`Save <slug>.otio` and `Save <slug>.otsi-reel`).

## Limits

C.3 covers export only; timeline import is a later item. Exporting `.otio` and `.otsi-reel` is a read-only metadata operation available to any project reader and does not start a media render or grant external sharing rights; the manifest embeds the current rights state so downstream tools and future archive/import checks know whether external sharing or download was permitted at export time.

## Verification

- Contracts build and API and web type checks passed.
- API: 255 passed across 49 files using the disposable MySQL test server. `interchange.api.test.ts` covers empty-reel refusal (`409 REEL_EMPTY`), `.otio` and `.otsi-reel` generation, attachment headers, B.22 preset selection, rights and stale-identity evidence transitions (`CONFIRMED` -> `STALE` after an identity rejection), and organization isolation (`404`).
- Web: 208 passed across 51 files. `interchange.test.ts` covers `.otio` and `.otsi-reel` construction, spacer/transition/retime representation, and `describeEvidenceFlags` across confirmed, stale, unrecorded, and restricted states.
- Deployment: the idle check on port 3508 found zero active jobs and zero unfinished uploads. Redeployed the local stack; `/v1/notifications` and `/v1/reels/:id/interchange` returned 401 without a session, and `https://vie.otsi.cc/` returned 200.
- Signed-in browser at `http://127.0.0.1:4310/exports?reel=01a199aa-08fd-740d-93a3-a27fec2d7a8b`, view only: clicked `Interchange…`, verified the summary (`Chinazom Godwin — highlights · v119 · 16:9`, `58 clips · 597.2 s · 42 followed tracks · 20 engine-inferred events · Preset: Highlights Reel (Recommended)`), the five evidence lines, the `.otsi-reel` / `OpenTimelineIO` preview toggle, and the `Save Chinazom-Godwin-highlights.otio` / `Save Chinazom-Godwin-highlights.otsi-reel` actions, then closed the dialog without mutating any data.
