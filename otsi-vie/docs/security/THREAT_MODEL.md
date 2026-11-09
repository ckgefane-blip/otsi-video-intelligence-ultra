# Threat model — OTSI VIE v2 (Block 00)

Method: assets → trust boundaries → STRIDE threats per area → control → **status** (VERIFIED = implemented and tested, with the test; PLANNED = designed, block named; OPEN = decision or work outstanding). A control is only VERIFIED when a test proves it. Re-reviewed at every block exit and before release gate G-security (penetration test is an external sign-off).

_Last updated: 2026-10-26 (after Block 01 outbox + audit)_

## 1. Assets
| Asset | Why it matters |
|---|---|
| Source footage and derived media (proxies, reels, MP4 exports) | Third-party broadcast rights; leaks breach contracts |
| Player identity: canonical OTSI Player IDs, registry, identity decisions | Wrong or forged identity attaches statistics / reels to the wrong person; reputational and legal harm; minors |
| Biometric-like data: appearance embeddings, face / jersey crops | Personal data (GDPR Art. 9 in some uses; NDPR; minors) |
| Analytics, scouting reports | Commercial value; evidence-state integrity (DETECTED / INFERRED / CONFIRMED / NOT_MEASURED) |
| Tenant data (projects, rosters, comments) | Isolation between competing clubs / agencies |
| Billing state, entitlements, quotas | Revenue; abuse of GPU time |
| Audit log | Accountability; must be complete and immutable |
| Credentials: DB accounts, OIDC keys, storage keys, provider secrets | Full compromise |
| Model weights and manifests | Licence compliance; poisoned weights |

## 2. Trust boundaries
1. Browser ↔ web app / API (internet). 2. API ↔ MySQL (runtime account `otsi_app`). 3. API / dispatcher ↔ workers (queue, signed internal asset handles). 4. Workers ↔ untrusted media (decoders). 5. Platform ↔ external services (OIDC, payments, storage, URL import sources, webhook receivers). 6. Operators ↔ production (migrator, retention, admin console). 7. Supply chain (packages, containers, model weights).

## 3. Threats and controls

### 3.1 Authentication and session (S, E)
| Threat | Control | Status |
|---|---|---|
| Forged / foreign / expired tokens | RS256 verification of signature, issuer, audience, expiry on every request | VERIFIED — `identity.api.test.ts` "refuses a missing, foreign, mis-addressed or expired token" |
| Algorithm confusion (`alg: none`, HS256 with public key) | `algorithms: ["RS256"]` pinned | VERIFIED (code) — explicit negative test PLANNED Block 02 |
| Session theft, CSRF (cookie sessions in the web app) | HttpOnly SameSite=Strict refresh cookie (Secure/`__Host-` off localhost), hash-only storage, rotation with reuse detection, CSRF header + origin check, access token in memory only, same-origin API proxy (ADR-021). MFA for OWNER/ADMIN | VERIFIED — `auth.api.test.ts`, e2e session tests. MFA PLANNED Block 02 |
| Credential stuffing / account enumeration | scrypt hashes, identical answer and timing for unknown email / wrong password, lockout after 5 failures; per-IP edge rate limits | VERIFIED (lockout, enumeration) — `auth.api.test.ts`; edge limits PLANNED Block 15 |
| Open redirect after sign-in | only same-app paths accepted as `next` | VERIFIED — `safe-next.test.ts`, e2e |

### 3.2 Tenant isolation and authorization (I, E)
| Threat | Control | Status |
|---|---|---|
| Acting for another organization by changing `X-Organization-Id` | ACTIVE membership looked up per request; role from the membership | VERIFIED — "never trusts the organization header alone" |
| Role escalation through token claims | roles never read from the token | VERIFIED — "enforces roles from the membership" |
| IDOR: reading another tenant's track / provisional player / audit rows | service-layer scoping returns 404 (no existence leak); audit reads filter in SQL | VERIFIED — identity test 15; `audit.api.test.ts` "shows an organization only its own rows" |
| Cross-tenant links written by a bug | 27 composite tenant FKs (0003) | VERIFIED — `tests/db` 28 cross-tenant tests |
| A new module forgets tenant scoping | per-module negative tests are part of each block's definition of done; review checklist | OPEN — enforced per block; consider a lint rule for unscoped queries |
| Outbox fan-out leaks events across tenants | tenant-scoped subscribers; platform events never reach tenant subscribers; re-drive limited to the event's organization | VERIFIED — `outbox.dispatcher.test.ts` "offers an event only to subscribers of the same organization", re-drive cross-tenant refusal |
| Shared registry tampering (merging registered players) | tenant roles cannot; platform-admin flow only | VERIFIED (refusal) — platform-admin surface PLANNED F59 |

### 3.3 Data integrity and repudiation (T, R)
| Threat | Control | Status |
|---|---|---|
| Rewriting identity / event decisions or audit | append-only triggers; runtime account SELECT+INSERT only | VERIFIED — `tests/db` history tests; `audit.api.test.ts` runtime account 1142 |
| Canonical ID forged, reused, changed | allocator-only issuance, immutability triggers, ledger | VERIFIED — `tests/db/test_identity.py` 1-18 |
| Stale identity decision drives a spotlight onto another player | reel targets pinned to (decision, track, player); stale check | VERIFIED (DB) — render-time gate PLANNED Block 11 |
| Lost or duplicated side effects of events | transactional outbox; at-least-once dispatcher with fencing, receipts, dedupe keys | VERIFIED — ADR-018 tests |
| Unattributed changes | one audit writer: actor kind, user / service, request id | VERIFIED — ADR-019 tests |
| Audit log read by too many people | OWNER/ADMIN only | VERIFIED — role matrix test. OPEN: whether audit-log reads are themselves audited (security event log, Block 15) |

### 3.4 Uploads, URL import and media processing (T, D, E) — Blocks 03-04
| Threat | Control | Status |
|---|---|---|
| Malicious files (polyglots, decoder exploits, zip bombs, absurd resolutions / durations) | MIME magic + container probe in an isolated, unprivileged, network-less decode sandbox; size / duration / resolution / stream-count limits; fail closed on DRM / unknown codecs; patched FFmpeg; antivirus where appropriate | PARTLY IMPLEMENTED — signature sniff, isolated probe + test decode, limits, codec allow-list (ADR-022); malware scan of every ingested file with Microsoft Defender, detection quarantines, scanner failure retried never treated as clean (ADR-027, test_ingest/test_providers). Pending: network-less OS sandbox |
| SSRF via "paste a link" (internal IPs, metadata endpoints, DNS rebinding, redirects) | allow-list of schemes; resolve-then-connect to the vetted IP; block private / link-local / metadata ranges incl. IPv6 and IPv4-mapped; re-check on every redirect; no credentials forwarded; licensed integrations only (no scraping) | IMPLEMENTED (ADR-023, ADR-027) — test_url_import.py SSRF suite; provider adapters use only documented APIs, every adapter request goes through the same guard |
| Leak of a user's provider access token | sealed AES-256-GCM bound to the video; removed from the outbox event in the claiming transaction; sent only to the provider's API hosts, never after a cross-host redirect; deleted from the job payload when the job ends; audit stores only that a token was used | IMPLEMENTED (ADR-027) — media.api.test.ts, test_providers.py |
| Circumventing DRM / provider restrictions | encrypted HLS, live streams and download-prohibiting platforms refused before any request, with reason and alternative | IMPLEMENTED (ADR-027) |
| Upload resource exhaustion / quota bypass | resumable sessions with expected size + checksum; quota reserved atomically before work | PLANNED Blocks 03, 13 |
| Path traversal / object-key injection | server-generated object keys only (UUID + SHA-256), never user file names | PLANNED Block 03 |

### 3.5 Rights, delivery and signed URLs (I, E) — Block 12
| Threat | Control | Status |
|---|---|---|
| Export of rights-blocked or RED clips | rights evaluated at job creation, worker start, publish, URL signing and each share open; PRODUCE ≠ EXPORT/DELIVER | PLANNED Block 12 |
| Signed-URL sharing beyond intent | short expiry, single asset, audience binding, revocation list checked at the gateway | PLANNED Block 12 |
| Minors | verified guardian consent required where applicable; never inferred from appearance | PLANNED Blocks 07, 12 |

### 3.6 Render pipeline (T, E) — Block 11
| Threat | Control | Status |
|---|---|---|
| FFmpeg filter / argument injection through captions, titles, file names | argument arrays only (no shell); text rendered via files / escaped drawtext; manifest validated against a schema | PLANNED Block 11 |
| Spotlight on the wrong person | identity pin + stale gate + golden-frame tests; uncertain track suspends the effect | PLANNED Block 11 |

### 3.7 Workers and queues (S, T, D)
| Threat | Control | Status |
|---|---|---|
| A worker acting outside its tenant | jobs carry the tenant id; workers get signed, scoped asset handles, not storage credentials | PLANNED Block 05 |
| Poison messages blocking processing | dead letters, bounded attempts, operator re-drive | VERIFIED (outbox) — ADR-018 |
| Hung handlers exhausting connections | handler time-outs; connections destroyed after a time-out | VERIFIED — "times out a hung handler" |

### 3.8 Billing (S, T) — Block 13
| Threat | Control | Status |
|---|---|---|
| Forged / replayed provider webhooks | signature verification; `billing_webhook_inbox` UNIQUE(provider, external id); outbox dedupe keys | PARTIAL — dedupe VERIFIED (`outbox.dispatcher.test.ts` replay); signature verification PLANNED Block 13 |
| Client-claimed checkout success | entitlements only from verified webhooks | PLANNED Block 13 |
| Card data exposure | no PAN / CVV stored; provider-hosted checkout | PLANNED Block 13 (by design) |

### 3.9 Information disclosure in logs and errors (I)
| Threat | Control | Status |
|---|---|---|
| SQL / stack traces in API errors | one Problem shape; 500s say only "logged" | VERIFIED (code + identity tests) |
| Secrets in audit or dispatcher errors | `redact()` / `redactText()` | VERIFIED — redaction tests |
| Raw frames / biometric templates in telemetry | ADR-010: never logged | PLANNED Block 15 (log-scrubbing test) |

### 3.10 Supply chain and models (T)
| Threat | Control | Status |
|---|---|---|
| Malicious / vulnerable packages | lockfile with exact versions; licence check in CI; dependency audit in CI | PARTIAL — licence check VERIFIED (`tools/ci/run_ci.py`); vulnerability audit PLANNED (needs network access in CI: owner decision on CI host) |
| Tampered model weights | SHA-256 in `ModelManifest`; weights never downloaded unchecked; safetensors over pickle | PLANNED Block 05 |
| Unlicensed model / data use | `docs/legal/LICENSE_REGISTER.md` | VERIFIED (register exists); per-model clearance OPEN (owner) |
| Container tampering | signed images by digest, SBOM | PLANNED Block 15 |

### 3.11 Operations (E, R)
| Threat | Control | Status |
|---|---|---|
| Migrator used at runtime / destructive repairs | separate `otsi_migrator` account; checksum-locked, stop-on-error migrator (ADR-014) | VERIFIED — `tests/db` migrator tests |
| Retention account misuse | only account allowed to delete history; jobs audited | PARTIAL — DB rule VERIFIED; retention job PLANNED F58 |
| Touching the owner's existing MySQL on :3306 | API and workers refuse port 3306 unless explicitly overridden; tests assert it | VERIFIED (config guard; tests/db assert) |

## 4. Open decisions for the owner
1. CI host (local only vs. a hosted runner with network access for dependency-vulnerability audits). Nothing is pushed until approved.
2. Identity provider for Block 02 (managed OIDC vs. self-hosted).
3. Data-protection position on appearance embeddings and minors (counsel), before Block 07.
