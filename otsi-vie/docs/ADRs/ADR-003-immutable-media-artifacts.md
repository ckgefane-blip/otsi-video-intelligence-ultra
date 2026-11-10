# ADR-003: Immutable media and artifacts

Status: reconstructed (2026-11-10) — see Recovery note; not an original ADR file.

## Context
Match footage, proxies, reels, reports, and CV outputs are evidence: a reel
or report must be traceable to the exact media and observations it was built
from, and a later correction must not silently rewrite what was delivered.
The handoff's "Separate data planes" section
(`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`)
puts transactional state in MySQL and all media in object storage.

## Decision
Source media, proxies, reels, reports, and CV Parquet outputs are
**immutable once written**. New versions are new versioned objects, never
in-place edits. Objects carry versioned keys and SHA-256 integrity hashes.
Short-lived access uses signed URLs; canonical metadata and manifests live
in MySQL.

## Evidence and alternatives
Alternatives: mutable in-place media (loses the evidence trail) — rejected
by the decision. Adjacent as-built rule: ADR-013, audit and decision
history append-only (migration 0005). This reconstruction does not
independently verify that every writer in the codebase enforces
immutability; that is a code-level check, not a decision record.

## Recovery note
No original ADR-003 file exists in this repository: `otsi-vie/docs/ADRs/`
starts at ADR-011, and the git history contains no add or delete of an
ADR-003 file. This file is a reconstruction written 2026-11-10 from the
decision log in
`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`
("ADR-003 immutable media/artifacts") and the corroborating passage cited
above. The original date, author, and alternatives considered beyond those
recorded here are not stated anywhere found and are not invented.

Numbering conflict on record: a second blueprint document,
`blueprint/OTSI-Owner Developer Handoff/04_REFERENCE_ARCHITECTURE_MYSQL/REPOSITORY_AND_BLOCK_BY_BLOCK.md`,
lists a different ADR-001–012 mapping (there ADR-003 is "model/dataset
licenses", ADR-005 "object lifecycle"). That mapping conflicts with the
decision log used here, with the cross-references to ADR-002, ADR-007,
ADR-009, and ADR-010 in the blueprint and product docs, and with the actual
ADR-011 and ADR-012 files. It is not used here; the conflict is recorded
for the owner to resolve.
