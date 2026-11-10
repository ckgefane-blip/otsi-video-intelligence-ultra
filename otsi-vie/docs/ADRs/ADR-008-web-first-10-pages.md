# ADR-008: Web-first 10 pages

Status: reconstructed (2026-11-10) — see Recovery note; not an original ADR file.

## Context
The product is a web application first: coaches, analysts, and club staff
use it in a browser, and the engine's value is only realised through the
pages they work in. The owner approved a specific set of 10 pages, with 10
approved UI images as the visual source of truth and 10 Markdown page
specifications defining each page's intended functionality
(`CLAUDE.md` §1, §3).

## Decision
VIE is **web-first, built around the 10 approved pages**. The approved
images define the visual direction and the page specifications define the
functionality; neither is silently reduced or replaced with generic layouts
without owner approval.

## Evidence and alternatives
Alternatives: a desktop-first or API-only product (rejected by the decision
— the approved pages are the product surface). The 10 pages themselves are
defined by the handoff ZIP's 10 images and 10 UI specification files
(`blueprint/OTSI-Owner Developer Handoff/`), not by this ADR; this
reconstruction does not re-list them, because no single authoritative list
of the 10 was found in the repo's text docs. As built, the web app's routes
cover the approved surface (`otsi-vie/apps/web/src/app/`).

## Recovery note
No original ADR-008 file exists in this repository: `otsi-vie/docs/ADRs/`
starts at ADR-011, and the git history contains no add or delete of an
ADR-008 file. This file is a reconstruction written 2026-11-10 from the
decision log in
`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`
("ADR-008 web-first 10 pages") and the corroborating passages cited above.
The original date, author, and alternatives considered beyond those
recorded here are not stated anywhere found and are not invented.

Numbering conflict on record: a second blueprint document,
`blueprint/OTSI-Owner Developer Handoff/04_REFERENCE_ARCHITECTURE_MYSQL/REPOSITORY_AND_BLOCK_BY_BLOCK.md`,
lists a different ADR-001–012 mapping (there ADR-008 is "rights
inheritance"). That mapping conflicts with the decision log used here, with
the cross-references to ADR-002, ADR-007, ADR-009, and ADR-010 in the
blueprint and product docs, and with the actual ADR-011 and ADR-012 files.
It is not used here; the conflict is recorded for the owner to resolve.
