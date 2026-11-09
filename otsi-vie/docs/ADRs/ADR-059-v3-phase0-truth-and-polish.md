# ADR-059 v3 Phase 0: the screens say what the engine does (truth and polish)

**Date:** 2026-11-06. **Status:** accepted (owner: "Yes, after page 10"; "Yes, relabel, keep tiles"). No migration.
Source: OTSI_VIE_v3_Screen_Level_Upgrade_Blueprint.md (P1-P18) and OTSI_VIE_v3_Complete_Phase_Plan.md (Phase 0).

## Done
| Plan | Problem | Change |
|---|---|---|
| 0.1 / P1 | Processing tiles said "0 people tracked" when a run finished while the page was open | the workspace re-reads the run and tracks when the newest finished run changes; "Loading…" instead of 0 while reading |
| 0.2 / P2, P3 | Steps "Event Detection: Not built", "Indexing: Not built" while Analysis shows events; step 3 "Assign player identities" | the five stages are the engine's jobs: Shot Cuts, Detection, Tracking, Identity Evidence ("no identity is assigned"), Ball & Events (the video's ball track). Event Markers tile, Events Detected and Analysis-page step list show the real events; Tactics and Reel Builder no longer say events are not built |
| 0.3 / P4 | "AI-generated tactical analysis", "Generated Insights" | Clip Sheet (PDF) (ADR-058); "Rule-built Insights" |
| 0.4 / P5 | AI Edit, AI Highlights, AI Insights, Voiceover, Auto Captions | "Suggest", "Suggestions" (add the engine's suggested moments), "Clip Events"; Voiceover and Auto Captions left out of the toolbar until they exist |
| 0.5 / P6 | Unbuilt ingest options on by default | every option the engine does not perform is off by default (Stabilize stays: it selects the High accuracy profile) |
| 0.6 / P7 | Home "up to 50 GB" | read from the server (GET /v1/upload-limits) |
| P8 | Home counted videos in Trash | every Home query leaves out removed videos (test added) |
| 0.11 / P13 | "Partner logos appear here once licensing is confirmed" | a neutral line; no partner mark until licensed |
| 0.12 / P14 | Export stepper: step 2 never ticked; step 4 "not built" | step 2 ticks once a render used the settings; step 4 opens Deliver to Client and ticks once delivered |
| 0.13 / P15 | Truncated Score & Time note | shorter text that wraps |
| 0.15 / P17 | "Tracking Confidence" ring showed the detector's mean confidence as if it were accuracy | "Identity & Evidence": Confirmed / Unverified, and evidence coverage = his on-camera time measured on a calibrated pitch; the help says accuracy is not measured |

## Kept as they are (owner: keep tiles)
- 0.16 / P18: "Not measured" tiles (xG, xA, carries, progressive passes, PPDA, formation stability) stay visible and say "Not measured".
- Already true before Phase 0: Home hero from real data (P12), Library "Everyone" (ADR-057), the QHD badge is the display size.

## Done in the second block (same day)
- 0.7 / P8: Home and Library now count by one rule (videos in Trash left out everywhere); live check: Home 1 match, Library 1 match.
- 0.8 / P9: the video open on a page is remembered in this browser per organization (`lib/currentVideo.ts`); Analysis, Tactics and
  Processing opened without a video start on it while it still exists, and Library starts with its match selected. The address always wins.
- 0.9 / P10: a link import is named from the link only when its last part is a video file name; a provider's file id becomes
  "Imported video · host" (the provider's own title replaces it when there is one; rename at any time). Test added.
- 0.14 / P16: the Clip Inspector shows the clip under the playhead when none is chosen, so player, match, event and time are carried.

## Not done (later, each its own change)
- 0.10 Library left-panel controls (they work: the time range filters the Events tab); 4:5 aspect in the renderer (0.13, a new renderer
  frame); the Dev-mode flag for the remaining "not built" hover reasons (S09).

## Tests
- API 195 (overview Trash test, link-import name test), web 59 (processing stages for the five jobs, current video), type checks clean.
