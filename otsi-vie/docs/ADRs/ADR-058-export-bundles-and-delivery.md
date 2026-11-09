# ADR-058 Export bundles, Download All and Deliver to Client (page 10 Output & Reports, Team Collaboration, final actions)

**Date:** 2026-11-06. **Status:** accepted (owner: "MOVE ON TO FINISH PAGE 10"). **Migration:** 0044.

## Decisions
1. **A bundle belongs to one finished render** (`export_bundles`, `export_bundle_items`). The user ticks which companion files to make:
   Performance Report (PDF), Clip Sheet (PDF), Event List (CSV), Heatmap (PNG). Each file is made on its own; it is `SUCCEEDED` (with its
   asset, size and SHA-256), `FAILED` (with the reason) or `NOT_MEASURED` (e.g. no position measured on a calibrated pitch: no heatmap is
   drawn). A CHECK keeps `SUCCEEDED` and an asset together. Nothing is invented: the files come only from recorded clips, confirmed identity
   and measured values.
2. **"Player Analysis (PDF) - AI-generated tactical analysis" in the reference becomes "Clip Sheet (PDF)"** (each clip: time, his events,
   how he was identified). The engine produces no AI-written tactical text, and writing one would be fabricated. The row keeps its place,
   colour and Preview button. "Heatmaps" becomes "Heatmap" (one per player). The message counter is 0/2000 (the reference says 0/300).
3. **Download All** packs the render and the made files into one ZIP (asset kind `BUNDLE`, store-only, up to 4 GB) with `manifest.json`
   (every file's size and SHA-256, plus what was not included and why). With nothing ticked it downloads the render alone.
4. **Deliver to Client** never sends email from the server (zero cost, ADR-030; no mail service is configured). The server validates
   the recipients (the client's name and email; team members must be active members who can see the project, ADR-057), refuses a repeat
   to the same address within 2 minutes, makes the share link through the same rights rule as the Share panel (`share-v1`, checked again
   on every opening), records the delivery (`deliveries`, channel `OWN_MAIL_APP`) and the audit entry, and returns the email. The page
   opens the sender's own mail app (mailto). A delivery refused by the rights is recorded as `BLOCKED` with the reason. The app cannot
   know an email was sent; it shows "handed to the mail app" and how often the link was opened.
5. Routes: `GET/POST /v1/reels/:reelId/bundles`, `POST /v1/reels/:reelId/bundles/:bundleId/zip`, `GET/POST /v1/reels/:reelId/deliveries`.
   Making and delivering need a project writer (Owner, Admin, Analyst, Editor); the project lock covers them through `reels/:reelId`.
6. Library "Send to Client" opens the reel's Export & Delivery page.

## Alternatives rejected
- A server mail service (SMTP / paid API): costs money or needs an external account; the user's own mail app is free and already trusted.
- An AI-written "Player Analysis": no model writes evidence-backed tactical text; a generated paragraph would mislead.

## Tests
- `apps/api/test/exports.api.test.ts` (6): events fall into their clips and the CSV defuses formulas; a heatmap only from measured
  seconds; the ZIP opens in any reader; each item made on its own, opened through signed links, ZIP matching its manifest; a reel never
  rendered has no companions; delivery needs recipients, sharing rights and members who can see the project, records every attempt
  (BLOCKED included) and refuses a quick repeat.
- Full suites: API 194, web 58, DB 88 (migration 0044, schema inventory regenerated). Bug found and fixed in testing: 0044 first dropped
  `BRAND` from `assets.kind`, which broke brand uploads.
