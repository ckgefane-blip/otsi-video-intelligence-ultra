# ADR-023: Importing a video from a link (F07)

Status: accepted (2026-10-26)

## Context
The owner wants a visible "Paste Video URL" workflow that accepts legitimate direct media links and supported provider links where access and rights permit, reports unsupported, inaccessible, DRM-protected or unauthorised sources clearly, and never shows a successful import unless the video was genuinely acquired and validated. Server-side fetching of user-supplied URLs is the classic SSRF risk (threat model 3.4).

## Decision
1. `POST /v1/imports` (OWNER/ADMIN/ANALYST/EDITOR, Idempotency-Key) creates a `DIRECT_URL` video in VALIDATING and publishes `video.import_requested`; the subscriber `jobs.ingest` queues one `INGEST_URL` job. The API rejects obvious problems at once (non-http(s), credentials in the URL, provider pages, literal or local addresses); the worker is the authority.
2. **Worker download** (`vie_worker/fetch.py`): resolve the name once; every address must be public (loopback, private, link-local, CGNAT, multicast, reserved, unspecified, IPv4-mapped/compat, 6to4 and Teredo forms refused); connect to the vetted IP with the original Host/SNI (no DNS rebinding); follow at most 5 redirects by hand, re-checking each, refusing https → http; response must be a media type (web pages, JSON and HLS playlists refused); size cap = the upload limit; connect and idle time-outs; no ambient credentials sent. Decided refusals (`UNSUPPORTED_PROVIDER`, `BLOCKED_DESTINATION`, `NOT_A_MEDIA_FILE`, `ACCESS_DENIED`, `NOT_FOUND`, `FILE_TOO_LARGE`, `TOO_MANY_REDIRECTS`...) are final and shown to the user; network errors are retried (5 attempts).
3. The downloaded file then goes through exactly the upload verification (signature, isolated probe and decode, policy, DRM → QUARANTINED). The stored file extension comes from the content, not the link.
4. **Providers** (YouTube, Vimeo, Facebook, Instagram, TikTok, X, Dailymotion, Twitch, Hudl, Wyscout, Veo, Streamable, Google Drive, Dropbox, OneDrive/SharePoint) are refused: there is no authorised integration. Adding one is an adapter plus the owner's rights/contract decision.
5. The displayed source omits the query string (signed links often carry tokens); the full URL is kept only in the job payload for the download.

## Evidence
`services/worker/tests/test_url_import.py` (address classification incl. mapped/6to4/Teredo, refused links, rebinding answer, downloads with redirects, pages/denials/loops/redirect-to-metadata refused, size cap, truncated transfer retryable, full INGEST_URL job verified like an upload, the real guard refusing the local test server). `apps/api/test/media.api.test.ts` link-import tests. Browser e2e: provider page and private address refused with the reason.
