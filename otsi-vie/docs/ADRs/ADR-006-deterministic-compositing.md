# ADR-006: Compositing is deterministic

Status: reconstructed (2026-11-10) — see Recovery note; not an original ADR file.

## Context
Reels and spotlight renders are commercial deliverables: a client who
re-renders the same match with the same inputs must get the same MP4, and a
render that drifts from the footage (a spotlight on the wrong player, a cut
in the wrong place) is a defect, not a variation. The handoff's "Rendering"
section
(`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`)
prescribes a deterministic compositor with validation gates.

## Decision
Rendering/compositing is **deterministic**: the same inputs produce the
same output. It runs in a dedicated worker using FFmpeg plus a
deterministic OpenCV/PyAV or GPU shader effect compositor. **Every MP4 is
validated** with ffprobe and perceptual alignment quality gates before it
can be delivered.

## Evidence and alternatives
Alternatives: non-deterministic, time-dependent rendering (rejected — output
would not be reproducible or auditable). As built, rendering and its quality
gates are described further in ADR-032 (reel builder, spotlight, render)
and ADR-106 (scopes and render QC); this reconstruction does not
independently verify that every render path in the codebase is
deterministic.

## Recovery note
No original ADR-006 file exists in this repository: `otsi-vie/docs/ADRs/`
starts at ADR-011, and the git history contains no add or delete of an
ADR-006 file. This file is a reconstruction written 2026-11-10 from the
decision log in
`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`
("ADR-006 compositing is deterministic") and the corroborating passage
cited above. The original date, author, and alternatives considered beyond
those recorded here are not stated anywhere found and are not invented.

Numbering conflict on record: a second blueprint document,
`blueprint/OTSI-Owner Developer Handoff/04_REFERENCE_ARCHITECTURE_MYSQL/REPOSITORY_AND_BLOCK_BY_BLOCK.md`,
lists a different ADR-001–012 mapping (there ADR-006 is "canonical ID
adapter"). That mapping conflicts with the decision log used here, with the
cross-references to ADR-002, ADR-007, ADR-009, and ADR-010 in the blueprint
and product docs, and with the actual ADR-011 and ADR-012 files. It is not
used here; the conflict is recorded for the owner to resolve.
