# 09 — Acceptance tests and non-negotiable release policy

|Gate|Owner/test|Evidence required|Release rule|
|---|---|---|---|
|G01|DB|run up/down from empty PG16, FK and application-enforced tenant isolation checks|no failed migration|
|G02|Security|2+ tenant isolation, IDOR, permissions, audit|zero high-risk leaks|
|G03|UI|Playwright pixel comparisons all 10 screenshots at 2560x1440 and tablet|human signed visual parity + controls functional|
|G04|Uploads|multipart resume, bad codec, SSRF, VFR, 50GB profile policy|media timestamps correct|
|G05|Detection|licensed holdout sets from real games, day/night/color variations|owner-approved measured PR|
|G06|Tracking|HOTA, IDF1, false swaps, camera cuts and occlusions|owner-approved measured thresholds|
|G07|Identity|false-confirm, unknown, referee, substitute, similar numbers|no unsafe forced identity|
|G08|Tactics|calibration error distribution and occlusion coverage|unsupported metrics NOT_MEASURED|
|G09|Reels|verified source timeline + observable tracked target|zero known wrong-player spotlights in gold set|
|G10|Render|real MP4 ffprobe, A/V sync, 9:16 crop, black frame|output playable + alignment gate|
|G11|Rights|expired, internal, external, minor, queued revocation|fail closed throughout|
|G12|Billing|webhook replay, race quotas, trial downgrade, plan change|no unauthorized processing|
|G13|Admin|access restriction, immutable audit, operator commands|traceable each action|
|G14|Operations|backup restore, worker restart, job retry and cost budget|validated recovery|
|G15|Commercial|privacy/rights/licensing/terms, accessibility, support|signoff required|

## Mandatory fixture pack
`fixtures/videos/{broadcast_wide,cut_sequence,low_light,occlusion,jersey_confusion,off_ball,vertical_crop,vfr_audio}` containing licensed short clips and frame-level expert annotations; store secure S3 refs and hashes in repo fixtures manifest; **do not embed copyrighted commercial match footage in public repo**. Provide expected detector output, track ground-truth, identity labels including unknown, spotlight target keypoints and canonical time mapping.

## Test ownership
Vitest TS unit; pytest Python; MySQL integration tests using a real, disposable MySQL 8.4 container [MySQL correction C-DOC-06]; Pact-style API schema tests; Playwright e2e; benchmark runner version-pinned model and dataset. All gate results archived in `release-evidence/<build_sha>/` with hashes and failures. No auto-clearing failures by merely editing thresholds; threshold changes require signed ADR + data review.
