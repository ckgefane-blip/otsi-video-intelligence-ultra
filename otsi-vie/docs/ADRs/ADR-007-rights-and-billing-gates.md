# ADR-007: Rights and billing gates at enqueue AND delivery

Status: reconstructed (2026-11-10) — see Recovery note; not an original ADR file.

## Context
VIE processes footage and delivers reels and reports that the client may or
may not have the rights to use — and rights can be revoked after a job
starts. Checking rights only once (at upload, or only at download) leaves a
window where unlicensed work is done or unlicensed artifacts are delivered.
The agent rules (`CLAUDE.md` §3) require separate produce and export/delivery
rights, enforced at job creation, artifact retrieval, and external delivery.

## Decision
Rights and entitlements are checked **twice: at enqueue AND at delivery**.
Each check is recorded in `policy_decisions`. When a source right is
revoked, `artifact_dependencies` blocks derived renders from that source.
Unverified or rights-blocked artifacts must not be distributed.

## Evidence and alternatives
Alternatives: a single check at enqueue (rejected — a revocation between
enqueue and delivery would still ship) and a single check at delivery
(rejected — unlicensed work would already have been done). Source:
`Owner's Request/OTSI_VIE_LATEST_UPGRADES/02_BACKEND_MYSQL_BLUEPRINT/docs/BACKEND_BLUEPRINT.md`
§7 ("Rights and entitlements are checked at **enqueue and at delivery**
(ADR-007) and recorded in `policy_decisions`").

## Recovery note
No original ADR-007 file exists in this repository: `otsi-vie/docs/ADRs/`
starts at ADR-011, and the git history contains no add or delete of an
ADR-007 file. This file is a reconstruction written 2026-11-10 from the
decision log in
`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`
("ADR-007 rights and billing gates at enqueue AND delivery") and the
corroborating passage cited above. The original date, author, and
alternatives considered beyond those recorded here are not stated anywhere
found and are not invented.

Numbering conflict on record: a second blueprint document,
`blueprint/OTSI-Owner Developer Handoff/04_REFERENCE_ARCHITECTURE_MYSQL/REPOSITORY_AND_BLOCK_BY_BLOCK.md`,
lists a different ADR-001–012 mapping (there ADR-007 is "tenant isolation",
ADR-008 "rights inheritance"). That mapping conflicts with the decision log
used here, with the cross-references to ADR-002, ADR-007, ADR-009, and
ADR-010 in the blueprint and product docs, and with the actual ADR-011 and
ADR-012 files. It is not used here; the conflict is recorded for the owner
to resolve.
