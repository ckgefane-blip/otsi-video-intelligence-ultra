# ADR-035: Approved-design presentation layer (Figma Make) on the verified engine — integration contract

Status: accepted (2026-10-27). Records the owner's four decisions on visual fidelity and how the reconstructed pages will be connected.

## Owner decisions (2026-10-27)
1. **Placement of new features.** The ten approved compositions are preserved. Roster management, kit-group → team assignment,
   shirt-number review, identity suggestions and the footage-quality check are reached through contextual tabs, inspectors, modals or
   drawers — never as new permanent panels that distort an approved layout.
2. **Empty and unavailable states.** Exact approved section positions, panel geometry and hierarchy are kept; each region shows a
   truthful loading / empty / unavailable / not-measured / error state in place. No fabricated players, matches, statistics,
   detections or reels; no oversized generic empty-state cards replacing an approved composition.
3. **Branding and assets.** Original OTSI branding supplied in the project is used where available. No invented or unauthorized club
   logos, competition marks or player imagery; the intended placement of such elements is preserved when the asset is unavailable.
   *Fact:* this project contains no OTSI emblem file (it appears only inside the approved images); the vector emblem is to be supplied
   by the owner / the Figma work. Assets are not taken from other OTSI projects (CLAUDE.md §2).
   *Update (owner, 2026-10-27):* the blue-disc/green-wedge files later placed in `logos/` are not the approved circular emblem and must
   not be substituted for it; the approved branding stays until the exact original asset is confirmed.
4. **Ownership.** Figma Make reconstructs the ten pages. The lead developer owns the backend, database, engine, tracking, canonical
   player identity, Reel Builder, rendering, testing and final frontend integration. The ten pages are not redesigned independently;
   the owner reviews each corrected Figma page before it is integrated.

## Architecture: presentation over unchanged data hooks
Each connected page already separates a **provider** (data, polling, API calls, decisions) from its views. The providers stay; the
Figma views replace today's views and read the same state through exported hooks:

| Page | Provider (kept) | Hook for the presentation layer | Main state / actions |
|---|---|---|---|
| 02 Upload & Ingest | `UploadWorkspace` | `useUpload()` | projects, videos, transfers, `addFiles`, `importLink`, pause/resume/cancel, `selected`, `reloadVideos` |
| 03 AI Processing | `ProcessingProvider` | `useProcessing()` | video, runs, run, `start(profile, fps)`, `cancel`, `assessment`, `assess` |
| 04 Analysis Workspace | `AnalysisWorkspace` | `useAnalysisWorkspace()` | video, run, tracks (with evidence), playback, `timeUs`/`seek`, `visible` boxes, selection, layers, `canReview`/`canWrite`, `reloadTracks`, `reloadVideo`, `evidenceKey` |
| 06 Reel Builder | `ReelBuilder` | `useReel()` | reel, moments, `run(action)`, selection, `reload` |

Feature components with self-contained data logic, to be re-skinned or wrapped by the Figma drawers/inspectors (Decision 1):
`MatchLinker`, `RosterPanel`, `TeamAssignment` (`components/matches/MatchPanels.tsx`), `ShirtNumberPanel`, `CandidatesPanel`
(`components/analysis/IdentityEvidence.tsx`), `SamePersonPanel` (`components/analysis/SamePerson.tsx`), the footage check inside
`ProcessingView`. Every API route, request and response is in `docs/api/API_CONTRACT_INVENTORY.json` (generated from the zod contracts
and cross-checked with the controllers).

## Proposed homes for the new functions (for the Figma design; owner to approve)
| Function | Proposed contextual home in the approved composition |
|---|---|
| Link video to a match, create match/clubs | Upload §2 "Match Context (Optional)" selects (Competition / Season / Match) + a "New match" modal; Workspace match rail "⋯" menu |
| Roster entry, verification, history | Drawer opened from the match rail / Library "Matches" tab ("Edit roster"); the Workspace "Players (22)" table shows the roster read-only |
| Kit group → team assignment | Workspace left rail "Team Filter" section: a "Assign teams" modal listing kit colours |
| Shirt-number review, identity suggestions, same-person links | Inspector tabs inside the Workspace selected-player card (e.g. "Identity", "Shirt no.", "Same person") |
| Footage check + analysis profile | Processing title band: the run card's "Processing" control opens a settings modal with the check and the three profiles |

## Integration rules
- No unreviewed generated code is merged; nothing verified is overwritten. A Figma page is integrated only after the owner approves it.
- The `data-*` attributes the browser journeys rely on (e.g. `data-box-track`, `data-selected-track`, `data-identity-state`,
  `data-roster`, `data-kit-group`, `data-jersey-state`, `data-candidate`, `data-profile`, `data-assessment`, `data-render-state`,
  `data-download`) are carried onto the new components so the real-footage journey keeps proving the behaviour.
- Acceptance per page: overlay comparison with the approved image at 1672 × 941, real data only, the e2e journey passing.
- Developer artifacts ("Not connected · Block NN", API chips, "Will show") never appear in the integrated pages.
