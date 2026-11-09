# ADR-022: MySQL worker-job queue and the upload ingest pipeline

Status: accepted (2026-10-26)

## Context
The owner must be able to upload a full football match and see it genuinely validated (ADR-020). The blueprint prefers Temporal for durable workflows and a broker for jobs, "explicitly chosen during ADR", and requires at-least-once, idempotent consumers. On this single development machine there is no Temporal or broker yet; the outbox dispatcher (ADR-018) already exists.

## Decision
1. **Jobs live in MySQL** (`worker_jobs`, migration 0012) until a workflow engine is chosen: claim with `FOR UPDATE SKIP LOCKED` (QUEUED-and-due, or RUNNING with an expired lease), fresh claim token, lease renewed by a heartbeat thread, every settle conditional on the token, bounded attempts with back-off, CHECKs tying state, claim, lease and error together. Swapping to Temporal/a broker later replaces the claim loop, not the handlers.
2. **Jobs are created only by outbox subscribers**, never by the browser: `video.upload_completed` → subscriber `jobs.ingest` inserts one `INGEST_UPLOAD` job per upload (unique `dedupe_key`, inserted with the subscriber's receipt in one transaction).
3. **Uploads** (API): resumable sessions with a fixed part size (16 MiB default; 1-256 MiB), each part streamed to storage, checked for its exact size, hashed (optional client checksum verified before it can replace an earlier copy), request always drained so the client gets its 4xx; completion requires every part; 48 h expiry; abort deletes parts. Limits: 64 GiB per file (setting), extensions mp4/m4v/mov/mkv/webm/avi/mpg/mpeg/ts/m2ts/mts/flv.
4. **Ingest worker** (Python, `services/worker`): assembles parts re-verifying each part's hash, hashes the whole file (compared with the client's when given), checks the container signature before any decoder runs, then probes and test-decodes in a **separate, time-limited, credential-free process**. Policy: codecs h264/hevc/mpeg2/mpeg4/vp8/vp9/av1/prores/mjpeg/dnxhd, duration ≤ 6 h, ≥ 160x90. Outcomes: INGESTED with measured facts (duration, resolution, average frame rate, variable-frame-rate flag from packet timestamps, codecs, rotation, SHA-256) + source and thumbnail assets; FAILED with a precise code (`DAMAGED_OR_INCOMPLETE`, `UNSUPPORTED_CODEC`, `TOO_LONG`, `RESOLUTION_TOO_LOW`, `CHECKSUM_MISMATCH`, `STORAGE_CORRUPTION`, `UNDECODABLE`...); QUARANTINED when the content is not a video whatever its name (`NOT_A_VIDEO`) or is encrypted (`DRM_PROTECTED`). One transaction records the result, audit (SERVICE `ingest-worker`) and the outbox event. A decided refusal is a successful job; only infrastructure errors are retried.
5. **Storage** is a local object store with server-generated keys (`uploads/<id>/part-NNNNNN`, `org/<org>/videos/<video>/source.<ext>`, `.../thumbnail.jpg`) and escape checks in both the API and the worker; an S3 adapter with the same layout replaces it in deployment.

## Not yet
URL import (F07, SSRF-guarded fetch adapter), proxy transcode and the PTS map (Block 04), malware scanning, a sandbox stronger than a separate process (container without network, Block 15), expiry clean-up job for abandoned uploads, Temporal/broker decision.

## Licensing
The probe uses PyAV 13.1.0, whose wheels bundle a GPL FFmpeg build (libx264): development only; see LICENSE_REGISTER.md section 3.

## Evidence
`apps/api/test/media.api.test.ts` (9): projects, upload validation, exact part sizes, checksums, resume, idempotency, completion → exactly one job under racing dispatchers, abort, tenant isolation, roles. `services/worker/tests/test_ingest.py` (11) on real encoded videos: MP4+AAC accepted with measured facts/thumbnail/assets/audit/event; VFR Matroska detected; AVI/MJPEG accepted; random bytes quarantined; truncated MP4, too-small resolution, checksum mismatch and altered parts refused with reasons; crashed-worker takeover with fencing; retries without leaking internals; cross-tenant job refused.
