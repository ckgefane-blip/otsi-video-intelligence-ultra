# 07 — Mandatory API contract and domain error model

## Transport rules
Base `/v1`, JSON camelCase, UUID IDs, ISO8601 UTC timestamps, video PTS integer **microseconds**, `requestId` and `schemaVersion`. OIDC JWT audience/issuer/expiry enforced. Mutation `Idempotency-Key` header for costly jobs. ETag/If-Match on versioned reel timelines. Cursor-based pagination. Error shape `{error:{code,message,requestId,details,retryable}}`, stable codes. GET endpoints must enforce tenant membership and project scope, not just rely on UI filters. Signed URLs issued only following live authorization.

## Required endpoint index
Auth: `GET /me`, `GET /organizations`, `POST /organizations`, `POST /organizations/:id/invites`, `PATCH /memberships/:id`, `GET /entitlements`.
Projects and matches: `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `GET/POST /matches`, `GET/PATCH /matches/:id`, `GET/POST /clubs`, `GET/POST /players`, `POST /matches/:id/roster`, `POST /players/allocate-id` (privileged).
Media: `POST /uploads/init`, `POST /uploads/:id/parts`, `POST /uploads/:id/complete`, `DELETE /uploads/:id`, `POST /imports`, `GET /videos/:id`, `GET /videos/:id/playback`, `POST /videos/:id/analyze`, `GET /videos/:id/frames`, `GET /videos/:id/shots`.
Pipeline: `GET /jobs/:id`, `POST /jobs/:id/cancel`, `POST /jobs/:id/retry`, `GET /jobs/:id/events` SSE, `GET /model-evaluations/:id`.
Observations: `GET /videos/:id/observations?startPtsUs=&endPtsUs=&cursor=`, `GET /videos/:id/tracks`, `GET /videos/:id/tracks/:id`, `GET /videos/:id/identities`, `POST /identity-reviews`, `GET /videos/:id/events`, `POST /event-reviews`, `GET /videos/:id/tactics`, `GET /players/:id/metrics`.
Reels: `POST /reels`, `GET /reels/:id`, `PATCH /reels/:id`, `GET /videos/:id/clip-candidates`, `PUT /reels/:id/timeline`, `POST /reels/:id/preview-renders`, `POST /reels/:id/render-jobs`, `GET /render-jobs/:id`.
Reports and library: `POST /reports`, `GET /reports/:id`, `POST /reports/:id/exports`, `GET /library/search`, `POST /artifacts/:id/shares`, `POST /shares/:id/open`, `POST /artifacts/:id/download-url`.
Commercial/admin: `GET /plans`, `POST /billing/checkout`, `POST /billing/portal`, `POST /webhooks/billing`, `GET /billing/subscription`, `GET /usage`, `GET /admin/tenants`, `GET /admin/jobs`, `POST /admin/models/:id/approve`, `GET /admin/audit`.

## State machine contracts
- Video `PENDING -> VALIDATING -> INGESTED | FAILED | QUARANTINED`.
- Analysis job `QUEUED -> RUNNING -> SUCCEEDED | REVIEW_REQUIRED | FAILED | CANCELLED`; `FAILED -> QUEUED` only through authorized retry creating attempt and preserving previous error.
- Reel `DRAFT -> REVIEW_REQUIRED -> READY_TO_RENDER -> RENDERING -> QC -> READY | BLOCKED | FAILED`.
- Report `DRAFT -> GENERATED -> REVIEW_REQUIRED | READY -> PUBLISHED`.
No direct `FAILED -> READY` DB update. Workflow controller is the authoritative state machine.

## Permissions and errors
`401 AUTH_REQUIRED`, `403 FORBIDDEN`, `402 ENTITLEMENT_REQUIRED`, `404 NOT_FOUND` (do not disclose cross-tenant IDs), `409 VERSION_CONFLICT`, `409 ACTIVE_JOB_EXISTS`, `422 INVALID_TIME_RANGE`, `422 IDENTITY_UNRESOLVED`, `422 TRACK_GAP_EXCEEDED`, `422 EVIDENCE_NOT_MEASURED`, `423 RIGHTS_BLOCKED`, `429 QUOTA_EXCEEDED`, `500 INTERNAL`, `503 MODEL_UNAVAILABLE`. Client never retries 4xx except documented flow; API idempotency on 5xx-safe replays.
