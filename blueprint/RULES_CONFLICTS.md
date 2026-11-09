# Conflicts between the workspace and project rules (for the owner's decision)

Neither file has been changed. Until the owner decides, the **stricter** reading is followed where they collide.

| | Workspace rules — `D:\OTSI-Workspace\CLAUDE.md` | Project rules — `D:\OTSI-Workspace\VIE-Engine-v2\CLAUDE.md` |
|---|---|---|
| **Conflict 1: who runs tests** | Line 46: *"When the engine is finished, run no process yourself. Do not start servers, rebuild, restart, open the browser or run tests. The owner does every frontend test as a user."* | §6 lines 40–41: required evidence includes backend, MySQL, API, **Playwright/browser E2E**, CV and real-MP4 tests; §7 line 51: *"Run tests, document evidence…"* |
| **Conflict 2: committing** | Line 16: *"Ask for permission before anything major or irreversible: … committing or pushing …"* | §2 line 14: *"Maintain a version-controlled repository here"*; §5 line 34: routine, reversible work proceeds *"without repeatedly waiting for owner approval"*; the handoff (`EXECUTE_FROM_ZERO.md`): *"Commit block with acceptance record"* |

## Recommended resolutions

1. **Tests.** Inside `VIE-Engine-v2`, the developer runs every automated and browser test during construction (project §6). The workspace rule's intent stays as a separate, final step: the owner walks through each finished page as a user for acceptance. Suggested one-line note under workspace line 46: *"Applies to the old engine. VIE-Engine-v2 follows its own CLAUDE.md §6; the owner's walkthrough is the final acceptance step."*
2. **Commits.** Local commits inside `VIE-Engine-v2` are reversible and need no approval. **Pushing** to any remote, or creating a hosted repository (GitHub, etc.), still needs the owner's yes (it is an external account, project §5 line 36). Suggested note under workspace line 16: *"Local commits inside VIE-Engine-v2 are allowed; pushing still needs approval."*

**Current handling:** tests are being run, because the owner's latest instruction explicitly requires verification by tests. Nothing has been committed yet: the work is kept in the working tree until the owner answers conflict 2.

## Also outdated (not direct conflicts, but misleading for a new session)
- Workspace lines 5–12, "READ FIRST — the product direction": written 2026-10-26 for the old engine's "Reel Studio" idea (3 pages). The approved 10-page handoff supersedes it for VIE-Engine-v2.
- Workspace lines 25–30, "The engine comes first — Blueprint v3.3.1 governs": that is the OLD engine's blueprint. For VIE-Engine-v2 the owner's new handoff governs.

Recommendation: add *"(old engine only)"* to both headings. Changing the workspace file needs the owner's yes.

## Owner decision (2026-10-26)
Approved as recommended, with scope limits: both exceptions and the old-engine scoping are written ONLY into `VIE-Engine-v2/CLAUDE.md` §8. The workspace file was not edited (owner: do not broadly rewrite workspace-wide rules). Testing: developer runs all automated tests; owner walkthrough = final acceptance. Commits: local only; no push / publish / deploy without explicit authorization.
