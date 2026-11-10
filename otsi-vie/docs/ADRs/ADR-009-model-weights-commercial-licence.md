# ADR-009: Model weights require a documented commercial licence

Status: reconstructed (2026-11-10) — see Recovery note; not an original ADR file.

## Context
VIE ships third-party model weights (detection, embeddings, OCR). Using a
model without a licence that covers the intended commercial use exposes the
business — and its clients — to a claim, and "free to download" is not
legal clearance (`CLAUDE.md` §9; `otsi-vie/docs/legal/LICENSE_REGISTER.md`).

## Decision
**No model weights without a documented commercial licence.** Every model
carries licence evidence, recorded per model (`license_id` in the model
registry — "Commercial licence evidence required (ADR-009)",
`Owner's Request/OTSI_VIE_LATEST_UPGRADES/02_BACKEND_MYSQL_BLUEPRINT/docs/DATA_DICTIONARY.md`).
Licence terms (including patent coverage limited to non-remunerated use) are
recorded for counsel; nothing is commercially activated without the owner's
approval.

## Evidence and alternatives
Alternatives: using weights on download availability alone (rejected — it
is the exposure this decision exists to prevent). As built: the living
licence register (`otsi-vie/docs/legal/LICENSE_REGISTER.md`, last updated
2026-10-26) tracks every model weight, dataset, codec, and font, with
`CLEARED` / `REVIEWED-LIMITED` / `CANDIDATE` / `BLOCKED` / `OWNER` status,
and a CI licence gate (`otsi-vie/tools/licenses/dependency_licenses.py
--check`). Nothing here is legal advice.

## Recovery note
No original ADR-009 file exists in this repository: `otsi-vie/docs/ADRs/`
starts at ADR-011, and the git history contains no add or delete of an
ADR-009 file. This file is a reconstruction written 2026-11-10 from the
decision log in
`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`
("ADR-009 model weights require documented commercial license") and the
corroborating passages cited above. The original date, author, and
alternatives considered beyond those recorded here are not stated anywhere
found and are not invented.

Numbering conflict on record: a second blueprint document,
`blueprint/OTSI-Owner Developer Handoff/04_REFERENCE_ARCHITECTURE_MYSQL/REPOSITORY_AND_BLOCK_BY_BLOCK.md`,
lists a different ADR-001–012 mapping (there ADR-009 is "metric ontology
and confidence"). That mapping conflicts with the decision log used here,
with the cross-references to ADR-002, ADR-007, ADR-009, and ADR-010 in the
blueprint and product docs, and with the actual ADR-011 and ADR-012 files.
It is not used here; the conflict is recorded for the owner to resolve.
