# ADR-010: Telemetry must not leak raw video or sensitive biometric templates

Status: reconstructed (2026-11-10) — see Recovery note; not an original ADR file.

## Context
Logs, metrics, and error reports travel further than the video itself — to
dashboards, alerting, and support. If a raw frame or a biometric template
(a face or body embedding usable to identify a person) lands in telemetry,
it is a privacy breach that cannot be recalled, and it undermines the
"unknown beats wrong" identity discipline of the whole product.

## Decision
**Telemetry and logs must never contain raw video frames or sensitive
biometric templates.** No frame pixels and no identifying embeddings in
logs, metrics, error reports, or audit payloads.

## Evidence and alternatives
Alternatives: logging frames/templates for debugging convenience (rejected
— the breach risk outweighs the debugging value). Source:
`otsi-vie/docs/security/THREAT_MODEL.md` §3.9 ("Raw frames / biometric
templates in telemetry | ADR-010: never logged | PLANNED Block 15
(log-scrubbing test)"). Implementation status at the time of that threat
model was PLANNED, not verified; this reconstruction does not claim the
log-scrubbing test exists.

## Recovery note
No original ADR-010 file exists in this repository: `otsi-vie/docs/ADRs/`
starts at ADR-011, and the git history contains no add or delete of an
ADR-010 file. This file is a reconstruction written 2026-11-10 from the
decision log in
`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`
("ADR-010 telemetry must not leak raw video or sensitive biometric
templates") and the corroborating passage cited above. The original date,
author, and alternatives considered beyond those recorded here are not
stated anywhere found and are not invented.

Numbering conflict on record: a second blueprint document,
`blueprint/OTSI-Owner Developer Handoff/04_REFERENCE_ARCHITECTURE_MYSQL/REPOSITORY_AND_BLOCK_BY_BLOCK.md`,
lists a different ADR-001–012 mapping (there ADR-010 is "video timebase
alignment"). That mapping conflicts with the decision log used here, with
the cross-references to ADR-002, ADR-007, ADR-009, and ADR-010 in the
blueprint and product docs, and with the actual ADR-011 and ADR-012 files.
It is not used here; the conflict is recorded for the owner to resolve.
