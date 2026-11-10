# ADR-005: Asynchronous GPU processing

Status: reconstructed (2026-11-10) — see Recovery note; not an original ADR file.

## Context
Video analysis (detection, tracking, embeddings, rendering) takes minutes
per match and needs a GPU. Doing it inline in a web request would time out,
block the UI, and lose work on failure. The handoff's "Locked deployment
stack"
(`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`)
prescribes durable asynchronous processing.

## Decision
Video processing runs **asynchronously on GPU workers through a durable
workflow**, never inline in the request path. Temporal is the preferred
durable workflow orchestrator; Redis is for bounded cache and rate limiting
only — Redis alone is NOT a durable workflow engine. Workers are Python
(PyTorch + OpenCV + FFmpeg); object detections and embeddings are stored in
Parquet on S3, with operational/query indexes in MySQL.

## Evidence and alternatives
Alternatives: synchronous in-request processing (rejected — timeouts and
lost work) and Redis-as-queue (rejected — not durable). As-built note: the
worker job system as implemented is described in ADR-022 and ADR-060, and
GPU inference in ADR-026 (Intel GPU); whether Temporal was ever adopted in
the as-built system is not established by this reconstruction and should be
confirmed against the code, not assumed from the decision.

## Recovery note
No original ADR-005 file exists in this repository: `otsi-vie/docs/ADRs/`
starts at ADR-011, and the git history contains no add or delete of an
ADR-005 file. This file is a reconstruction written 2026-11-10 from the
decision log in
`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`
("ADR-005 asynchronous GPU processing") and the corroborating passage cited
above. The original date, author, and alternatives considered beyond those
recorded here are not stated anywhere found and are not invented.

Numbering conflict on record: a second blueprint document,
`blueprint/OTSI-Owner Developer Handoff/04_REFERENCE_ARCHITECTURE_MYSQL/REPOSITORY_AND_BLOCK_BY_BLOCK.md`,
lists a different ADR-001–012 mapping (there ADR-005 is "object lifecycle").
That mapping conflicts with the decision log used here, with the
cross-references to ADR-002, ADR-007, ADR-009, and ADR-010 in the blueprint
and product docs, and with the actual ADR-011 and ADR-012 files. It is not
used here; the conflict is recorded for the owner to resolve.
