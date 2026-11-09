# OTSI VIE v2 — Owner Rules for Claude Code and Codex

**Applies to:** `D:\OTSI-Workspace\VIE-Engine-v2` and everything within it.
**Mission:** Build the **complete greenfield, commercial OTSI Video Intelligence Engine application**, not only a computer-vision engine or demonstration. The deliverable encompasses the 10 approved frontend pages, all connected backend services, a new MySQL database, detection/tracking/identity intelligence, tactical analytics, Reel Builder, Clip Studio, real MP4 rendering, reporting, commercial administration, access control, deployment, and verification.

## 1. Authority and source-of-truth hierarchy
1. The owner's explicit written decisions in this project (including the choice of **a new isolated MySQL database**, not PostgreSQL, and greenfield development) take precedence.
2. The contents of `blueprint/OTSI-Owner Developer Handoff.zip` and the extracted package establish target product requirements, engineering contracts, and construction order, subject to executable validation.
3. The **10 approved UI images** are the visual source of truth; the corresponding **10 Markdown page specifications** define each page's intended functionality. Reproduce the approved visual direction without silently removing sections or substituting generic layouts.
4. This `CLAUDE.md` governs local work, safety and acceptance discipline. Higher-level workspace rules also apply unless inconsistent with explicit owner project decisions; report contradictions rather than ignoring them.
5. When any blueprint SQL, API or model specification is incomplete, contradictory, unsafe or incompatible with MySQL, correct it with a documented engineering decision and test. **Never blindly execute reference SQL as production-ready.** Do not change the owner-approved product scope or visual design without owner approval.

## 2. Isolated greenfield workspace
- Work **only** within `D:\OTSI-Workspace\VIE-Engine-v2` for new source code, tests, migrations, assets, manifests, generated outputs and environment templates. Maintain a version-controlled repository here.
- Do not read from or change other OTSI projects for implementation unless the owner explicitly authorizes access. No automatic imports or links to `otsi-vie-app`, `02-AI-Specifications\Video-Intelligence-Engine`, `_wt-*`, `Production`, the website/plugins, VPN, or other projects.
- **Never delete or modify existing projects, databases, files or deployments**, including after a backup, without a separate explicit owner instruction for the specific action.
- Do not configure a connection to an existing OTSI database. Create/use a **new, isolated database** (proposed name `otsi_owner_vie`) only after validating the MySQL/MariaDB server version and permissions. Never DROP, TRUNCATE or overwrite existing databases.
- Keep secret values in environment variables or secret stores; do not commit actual credentials, tokens or production user data.

## 3. Scope — the full commercial application
- Build **frontend and backend together**, including all 10 approved screens, responsive layouts, UI state, navigation, API wiring, roles, workflows, billing entitlements, audit, admin console, background jobs and deployment.
- Implement genuine video ingestion, frame/timestamp indexing, per-frame player and ball detection, persistent tracking when visible, occlusion/cut handling, identity candidates and human review, event and tactical analysis, evidence-backed player reports, time-aligned cinematic spotlight effects, real video compositing and playable MP4 exports.
- Maintain distinctions between **detected, inferred, confirmed, and not measured**. Unknown is preferable to a false identification. Tracking does not imply verified personal identity. Do not fabricate unseen off-camera movements, statistics, performance or processing completion.
- Preserve separate produce and export/delivery rights; enforce authorization at job creation, artifact retrieval and external delivery. Unverified or rights-blocked artifacts must not be distributed.
- Mock data and fixtures are permitted **only in clearly labeled development/test environments**; mock results must never masquerade as verified production AI output.

## 4. Database and architecture
- Target **MySQL 8.4 LTS** if compatible with the owner's actual database host. phpMyAdmin is an administration interface, not a DB engine. Detect and report if the host instead runs MariaDB/another MySQL version; test compatibility before choosing syntax.
- No PostgreSQL, `JSONB`, PL/pgSQL, PostgreSQL row-level security or PostgreSQL-only migrations in the deployable application.
- Implement and validate real MySQL schema, forward-only migrations, constraints, indexes, stored routines, triggers, backup/restore, transaction semantics, and **backend-enforced tenant isolation** with tests. Large frame-level observations may use a partitioned or object-storage format, with canonical metadata and manifests in MySQL.
- Use one documented architecture and repository contract. Codex and Claude Code must not silently create competing implementations; use version control and separate branches for concurrent work.

## 5. Autonomy, changes and approvals
- Execute routine, reversible engineering work **without repeatedly waiting for owner approval**: create modules, tests, migrations in disposable databases, code fixes, development configuration, documentation and local demos within this folder.
- Document every material technical deviation in `blueprint/CHANGELOG.md` or an ADR: what changed, why, affected modules, database migrations, alternatives and tests.
- **Get explicit owner approval** for changes to product scope, approved UI, pricing/business rules, third-party expenses, public deployment, production data, real billing activation, destructive operations, external accounts, or changes outside this folder.
- When an external license, dataset, service, credential or owner-only step blocks one task, log the exact dependency and continue other safe tasks; never claim the blocked feature works.

## 6. Definition of done and evidence
- A control is working only when it performs the specified real operation in the actual app **and** its backend behavior is tested. Clicking alone is necessary for UI acceptance but insufficient for correctness.
- Required evidence includes: TypeScript/unit tests, backend integration tests, MySQL migration/tenant-isolation tests, API contract tests, Playwright/browser E2E tests, Python computer-vision benchmark tests on representative labeled football footage, spotlight alignment/identity-switch regression tests, real playable MP4 validation, rights/security tests, and deployment smoke tests.
- Do not classify an AI model as production-ready without documented evaluation metrics and approval thresholds. Do not confuse a generated UI with a deployed, functional commercial application.
- Record each implementation block as **implemented and verified / implemented but unverified / blocked / not implemented**, with test command, result, artifact or screenshot and exact outstanding issues.
- Release only when all relevant product, security, rights, model-quality, data-integrity and operational acceptance gates pass. A local UI preview is not a commercial release.

## 7. Execution instructions
1. Inspect the full owner's handoff ZIP and its `00_START_HERE.md`, SQL, 10 images, 10 UI MD files, build plan and quality gates.
2. Inventory requirements and create a traceability matrix: **UI control → frontend component → API → backend module → DB table/artifact → test**.
3. Validate and repair MySQL migrations on a new disposable MySQL instance; do not touch existing databases.
4. Implement block-by-block in dependency order, connecting actual frontend and backend work throughout.
5. Run tests, document evidence, keep a continuously updated progress report, and advance autonomously where safe.
6. Surface only actual approval gates or unavoidable blockers to the owner. Communicate briefly and plainly.

## 8. Owner approvals and exceptions to the workspace rules (2026-10-26)
These apply ONLY inside `D:\OTSI-Workspace\VIE-Engine-v2`. The workspace file `D:\OTSI-Workspace\CLAUDE.md` is unchanged and still governs every other project. Details: `blueprint/RULES_CONFLICTS.md`.
- **Automated testing — approved and required.** The developer runs frontend unit/browser, backend API/integration, MySQL migration/security, CV evaluation, render/MP4 and end-to-end tests throughout development. The owner's manual walkthrough of finished pages is the final acceptance step, not a substitute. This supersedes workspace line 46 ("run no process yourself… the owner does every frontend test") for this project.
- **Local Git commits — approved.** Commit completed, tested blocks with meaningful messages. **Never push**, publish a repository, change remote branches or deploy to production without the owner's explicit authorization. This narrows workspace line 16 ("ask before … committing") for this project only.
- **Old-engine rules do not govern this project:** the "Reel Studio" product direction (workspace lines 5–12) and the frozen Blueprint v3.3.1 (workspace lines 25–30) belong to the OLD engine. The OTSI-Owner Developer Handoff governs VIE-Engine-v2.
- **Hosting database version check — approved read-only** (`SELECT VERSION(), @@version_comment;`) only over an already-authorized connection. Never modify, import into or migrate an existing production database. Without such a connection the check stays recorded as pending.
- **Canonical OTSI Player ID is fundamental architecture** (owner directive 2026-10-26, ADR-016): one permanent, immutable `OTSI-CCC-YYYY-NNNNNN` per registered player, issued once by the transaction-safe allocator, used consistently by every module, API, overlay, reel, report and export.

## 9. PERMANENT OWNER DIRECTIVE — ZERO-COST DEVELOPMENT (2026-10-27, ADR-030)
The owner's budget for software, models, licences and external services is **zero**.
- Use only free tools, software, AI models, frameworks, libraries, development environments and infrastructure — open-source or
  genuinely free to use for the intended commercial application. Prefer local tools and existing hardware (the Intel Arc GPU).
- Never recommend, purchase or activate paid licences, subscriptions, commercial API plans, cloud GPU services or paid infrastructure.
  Free trials that turn paid, promotional credits and anything needing a payment commitment are not acceptable. Never ask the owner to buy.
- If a technology has a paid dependency, find and evaluate a genuinely free alternative that keeps the approved functionality. Do not
  downgrade or remove approved features to avoid cost.
- Where no zero-cost solution exists, document the limitation (ADR + `docs/IMPLEMENTATION_STATUS.md`) and continue other work.
- Applies to every construction block, model choice, video encoding, export, hosting and deployment plan. Before any download, confirm
  it is free of charge with no subscription or purchase.
- "Free to download/use" is not legal clearance: licence terms (e.g. patent coverage limited to non-remunerated use) are recorded for
  counsel; nothing is commercially activated without the owner's approval.

**Non-negotiable:** Build the complete commercial application from scratch, faithfully to the approved design, with verified working code—never just a plausible-looking prototype.
