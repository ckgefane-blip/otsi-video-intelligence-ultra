# Ordered construction blocks with exit criteria

|Block|Build|Preconditions|Proof required|
|---|---|---|---|
|00|Repository, licenses, authorized footage, ADR, threat model|none|runtime smoke, source/media licenses|
|01|MySQL 8.4 migrations, tenant isolation, outbox, audit| [MySQL correction C-DOC-07]00|fresh DB up/down, cross-tenant denial|
|02|OIDC/auth, org/users/invite and admin RBAC|01|login/logout/MFA/role e2e|
|03|S3 upload and media probe, URL controls, resumability|01-02|real file, checksum, SSRF tests|
|04|Video proxy, VFR PTS map, player UI timeline|03|sync playback and frame scrubbing|
|05|Detector and bbox endpoint|04|holdout metrics + boxes on real source|
|06|Tracker, camera cuts, gap handling|05|HOTA/IDF1 + cut fixture|
|07|Roster, OCR, re-ID, human review|06|no false confirmation gate|
|08|Events, shot/pitch calibration, metrics|07|provenance, not-measured gate|
|09|Tactical and player report generation|08|actions and report reproducibility|
|10|Reel candidate selection and persistent editor|07-09|timeline version/conflict tests|
|11|Spotlight compositor, multiformat MP4 encoding|10|golden-frame and playable MP4|
|12|Rights, watermark, report export, sharing/delivery|11|revoked rights block queued jobs and links|
|13|Billing plans, checkout/webhooks, quota and metering|02,03,11|race/idempotency test|
|14|All 10 frontend pages and admin console polished|02-13|control coverage and UI screenshot signoff|
|15|Observability, load, backups, privacy, security, release|00-14|full release gate G01-G15|

## Developer output per block
- `docs/block-XX.md`: implemented function IDs, actual table/column changes, routes and schemas, failures, measured quality and user-facing state.
- `release-evidence/block-XX`: automated results with command line and software versions.
- `docs/TRACEABILITY.md`: unique mapping function ID -> API -> DB -> worker -> screen -> test.
- A usable walkthrough on real licensed football footage for blocks 05 onward; for partial blocks state "not yet operational" explicitly.

## Multi-agent split
If using Codex and Claude concurrently: a single architecture owner controls DB/contracts branch; Codex builds app/API, Claude implements isolated Python workers from published schemas (or vice versa). Freeze API contracts first. Separate worktrees. CI merges only after contract and gate tests. Do not let either independently rename tables or rewrite API JSON shapes.
