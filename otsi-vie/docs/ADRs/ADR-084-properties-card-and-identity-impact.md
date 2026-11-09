# ADR-084: Properties card and identity impact preview (v3 Phases B.6 and B.7)

Status: accepted. The owner said "Proceed with implementation nonstop until you finish the very last thing in our planned work" on 2026-11-07.

## Problem
- A reviewer could not see, in one place, everything the engine recorded about a track: its frames, its identity and who decided it, the
  identities it had before, the jersey and candidate evidence, linked tracks and look-alikes.
- Saving an identity decision could silently put a rendered or shared reel, or a made PDF report, out of date. Nobody saw that before
  pressing the button.

## Decision
- **Identity history (B.6, API):** `GET /v1/tracks/:trackId/identity-history` lists every decision for the track, newest first: state,
  player (name and canonical OTSI ID), basis (HUMAN, AUTO_POLICY, REGISTRY), who decided, when, the reason, which one is current and which
  one it replaced. Read only; another organization's track is a 404.
- **Properties card (B.6, web, `workspace/PropertiesCard.tsx`):** the Inspector's thumbnail opens "ⓘ Properties", a dialog with sections
  Track, Identity (current decision, then the replaced ones), Evidence (jersey reading, candidates), Linked tracks and Look-alikes. Every
  line is a recorded fact; a fact not measured shows as a dash, never a guess.
- **Identity impact (B.7, API, `tracks/identity-impact.ts`):** `GET /v1/identity-impact?track_ids=a,b&state=…&player_id=…`. For each track
  whose current decision would change, it lists:
  - reels following the track under its current decision (they would need their targets refreshed before the next render), with their
    finished renders and live share links;
  - made PDF reports of the player who loses the track and of the player who gains it.
  An unchanged decision lists nothing. A bad query is 422 `BAD_IMPACT_QUERY`. Read only.
- **Impact note (B.7, web, `analysis/ImpactNote.tsx`):** the sentence from the shared `impactText()` shows as "Before you save: …" next to
  the save buttons: the correction panel of a confirmed identity and both "Who is this?" rows. Nothing shows when nothing would go out of
  date. The request waits 150 ms so typing or switching does not flood the API.
- No migration: everything reads existing tables (`identity_decisions`, `v_track_current_identity`, `reel_targets`, `render_jobs`,
  `share_links`, `report_jobs`).

## Alternatives
- Block the decision when a reel or report would go stale: rejected. The person must stay free to correct an identity (unknown beats
  wrong); the note informs, and the reel is already refused for rendering until its targets are refreshed.
- Compute the impact after saving: rejected; the point is to know before.

## Tests
- `apps/api/test/identityHistory.api.test.ts`, `apps/api/test/identityImpact.api.test.ts` (real API and MySQL, tenant scope, bad query).
- `apps/web/test/propertiesCard.test.tsx`, `apps/web/test/impactNote.test.tsx`.
- Suites: web 156 passed, API 237 passed; both type checks clean.
