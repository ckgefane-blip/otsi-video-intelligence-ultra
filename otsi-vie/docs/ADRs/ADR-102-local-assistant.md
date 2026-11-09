# ADR-102: Rules-based local assistant (v3 Phase C.1)

Date: 2026-11-08. Status: accepted. Migration 0059.

## Decision

The existing command palette has an Assistant mode with three guide cards and a command field. The guides fill in examples for Smart Search, job status, and opening a workspace.

The server translates a supported command into one step and returns the exact step for preview. Approval refers only to the server's plan ID. A preview expires after five minutes and is bound to the person, organization, and role that requested it. The server checks the current role on approval. It uses the normal access checks for search and jobs.

Approval consumes the plan and records the actor in one transaction. Concurrent or repeated approval cannot run the plan twice. The server also records the step outcome. For navigation, completion means the server returned the workspace destination. If execution is interrupted after approval, the audit can show the approval without a step outcome.

## Limits

C.1 uses fixed rules for one read-only step per plan. Supported commands are `search <query>`, `show jobs` (or `jobs`), and `open library|processing|analysis|studio`. The assistant has no model, job controls, identity confirmation, evidence editing, rights grants, or export approval.

Audit entries omit the search text. The server clears the stored step on approval and deletes expired previews when the same person creates a later preview.

## Verification

- Contracts build and API and web type checks passed.
- API: 253 passed across 48 files using the disposable MySQL test server. The assistant tests cover one-use approval, audit, isolation, expiry, and current access.
- Web: 205 passed across 50 files. The assistant tests cover command rules and the guide, preview, and approval flow.
- Deployment: the idle check found zero active jobs and zero unfinished uploads. The normal local stack restart applied migration 0059. The local notifications and assistant preview endpoints returned 401 without a session, and the public web entry returned 200 after redirects.
- Signed-in browser at `http://127.0.0.1:4310/dashboard`, view only: opened Search and commands, switched to Assistant, and saw Find a moment, Check processing, and Find project media. Selecting Check processing filled in `show jobs` and enabled Preview plan. No plan was submitted or approved, and the verification tab was closed.
