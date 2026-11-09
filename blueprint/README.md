# Owner Blueprint Directory

Place the complete **OTSI-Owner Developer Handoff.zip** in this folder, retain it unchanged, and extract it into a clearly named subfolder (for example `blueprint/owner-handoff/`). Inspect all documents, MySQL migrations, approved UI images and page MD specifications before construction. Do not overwrite the source ZIP.

The ZIP is the *target design and engineering specification*, **not evidence that its SQL or AI services are already production-tested**. Verify the actual MySQL/MariaDB database engine and test every migration in a disposable database. The owner requires a new, isolated database and a complete frontend/backend application.

## Change management

Record technical decisions and necessary corrections in `CHANGELOG.md`; for substantial changes add an architecture decision record under `decisions/`. Routine reversible technical fixes can proceed without owner approval. Product scope, approved UI, pricing, external charges, destructive actions, production deployment or cross-project changes require explicit prior approval.

## Required audit artefacts

Maintain a function registry, UI-to-API-to-DB traceability matrix, migration validation report, build-block checklist, automated test results and production release checklist.
