> Adapted architectural reference only. MySQL migration authority is in `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/`. Do not assume a described control is implemented or tested.

# Security, evidence governance, media rights and export policy

## Access control
OIDC authorization code + PKCE where supported, secure httpOnly SameSite session cookie or protected token strategy, MFA for admins, rotating short sessions; server role checks on every route. Membership roles are organization-scoped; project grants and artifact rights can further restrict. CORS allowlist, CSRF protection, WAF/rate limits, session invalidation, API schema validation, secrets in KMS/vault, signed service-to-service auth. Separate GPU worker identity from admin DB role. Encrypted transport and encrypted storage with per-org key strategy where appropriate.

## Threat model highlights
- **URL ingest SSRF**: deny link-local/loopback/private address, cloud metadata endpoints, DNS rebinding, redirects outside allowlist, huge downloads and decompression bombs.
- **Video file attacks**: sandbox transcode/ffprobe, pin patched binaries, time/memory/CPU limits, virus scan, file-size limits, no arbitrary FFmpeg filter insertion from user text.
- **Cross-tenant leak**: server-enforced tenant isolation and authorization on every child table/service/object key; test guessed UUID, cross-org share token, caching, stale roles, direct download.
- **GPU/storage exhaustion**: upload quotas, concurrent jobs/org limits, per-file duration/resolution, queued scheduler, cost exposure limits, hard cancellation and resource monitoring.
- **Renderer injection**: escape title/caption strings, restrict fonts/assets, no shell execution composed from user input, manifests validated with JSON schema.
- **Sensitive identity**: embeddings and player association have purpose limitation, tenant protection, deletion schedule and evidence audit.

## Rights decision table (owner policy)
| Source state | Internal analyze | Produce / attach / preview reel | Export / download / external deliver |
|---|---|---|---|
| UNKNOWN | Restricted pending proof | BLOCK | BLOCK |
| ANALYSIS_ONLY | Allowed only where license explicitly permits | BLOCK | BLOCK |
| INTERNAL | Allowed per internal scope | ALLOW conditional | BLOCK |
| EXPORT_ALLOWED | Allowed per scope | ALLOW conditional | ALLOW conditional |
| PUBLIC | Allowed per scope | ALLOW conditional | ALLOW conditional |
| EXPIRED | Block further use except legally permitted retention | BLOCK | BLOCK |

Enforce territory, license purpose, expiry, attribution, third-party audio/fonts/logos, privacy and **minor guardian consent VERIFIED**. Produce and export are separate decisions. RED media blocked for outgoing jobs. Rights inheritance follows source/dependency graph; every derivative tracks all source and overlay dependencies. Default deny if grant missing. Export tokens generated after current rights check; queued delivery worker rechecks immediately before send.

## Source of truth and auditing
Audit actor identity, org, action, object, source hashes, rule version, reason codes, PTS frame evidence and time. Immutable human identity review and event corrections with supersession. Never present model guess as official truth. Generated reports include source references and explanation of not measured. Config changes, model promotion, allocator integration, rights change and role assignments generate audit entries.

## Media governance
No unauthorized scraping/redistribution; maintain source-rights evidence for each video. Restrict third-party football event feeds/club logos according to licensed use. Use expiring CDN URLs and server-controlled download grants. Revocation invalidates share links and cache, triggers queued-job reevaluation and owner review of already distributed artifacts. Treat already-downloaded file recall as impossible; set contractual limitation clearly.
