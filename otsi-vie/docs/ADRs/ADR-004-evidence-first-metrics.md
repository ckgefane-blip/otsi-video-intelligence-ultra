# ADR-004: Evidence-first metrics

Status: reconstructed (2026-11-10) — see Recovery note; not an original ADR file.

## Context
A sports-intelligence product is judged on numbers it reports — speeds,
distances, passes, xG/xA. A number computed without the evidence behind it
(a pitch calibration, a verified identity, a confirmed event) is worse than
no number: it misleads coaches and, once exported in a reel or report,
cannot be taken back. The handoff's "Design/release constraints"
(`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`)
and the agent rules (`CLAUDE.md` §3) both state the same discipline.

## Decision
**No metric is reported as measured unless the evidence supports it.**
Computed speed/distance require a pitch calibration and a quantified
uncertainty. Mock or demo numbers are shown as `DEMO` and never exported
as measurements. A player out of frame has null coordinates, not an
invented position. Values are distinguished as detected, inferred,
confirmed, or not measured — and unknown is preferable to a false
identification. A false spotlight on another player blocks release.

## Evidence and alternatives
Alternatives: reporting best-effort numbers with no provenance (rejected —
it is the failure this decision exists to prevent). As built, this decision
is carried forward by the Phase E evidence rules (ADR-124) and the release
gates (ADR-117), which display "accuracy not yet measured" until a
ground-truth benchmark passes.

## Recovery note
No original ADR-004 file exists in this repository: `otsi-vie/docs/ADRs/`
starts at ADR-011, and the git history contains no add or delete of an
ADR-004 file. This file is a reconstruction written 2026-11-10 from the
decision log in
`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`
("ADR-004 evidence-first metrics") and the corroborating passages cited
above. The original date, author, and alternatives considered beyond those
recorded here are not stated anywhere found and are not invented.

Numbering conflict on record: a second blueprint document,
`blueprint/OTSI-Owner Developer Handoff/04_REFERENCE_ARCHITECTURE_MYSQL/REPOSITORY_AND_BLOCK_BY_BLOCK.md`,
lists a different ADR-001–012 mapping (there ADR-004 is "tracker
architecture and thresholds", ADR-009 "metric ontology and confidence").
That mapping conflicts with the decision log used here, with the
cross-references to ADR-002, ADR-007, ADR-009, and ADR-010 in the blueprint
and product docs, and with the actual ADR-011 and ADR-012 files. It is not
used here; the conflict is recorded for the owner to resolve.
