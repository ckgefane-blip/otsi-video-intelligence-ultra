# Brief for Codex: continue OTSI VIE v2 by the plan (2026-11-07)

You are continuing a project that is already far along. **Build the next planned item, nothing else.** Do not refactor, rename, restyle,
"clean up" or fix things you were not asked to touch. If you find a real bug outside your item, write it under "Found, not fixed" in the
handover. Fix it only if it blocks your item.

## 1. Read first, in this order
1. `D:\OTSI-Workspace\VIE-Engine-v2\CLAUDE.md`: the owner's rules for this project. They bind you too.
2. `otsi-vie/docs/handover/HANDOVER_CURRENT.md`: what runs where, the status, and **section 4, the ordered list of what to build next**.
3. `blueprint/v3/OTSI_VIE_v3_Complete_Phase_Plan.md`: the plan; each item's row says what it must do.
4. The ADRs that the item's row depends on, in `otsi-vie/docs/ADRs/`.

## 2. What to build next
- Work through `HANDOVER_CURRENT.md` section 4 **one item at a time, starting with the first unfinished item eligible to build.**
- Skip only items marked "owner": they wait for the owner's decision. Never build them on a guess.
  - B.2, B.9, B.17, B.18;
  - C.2, C.7;
  - D.1, D.2, D.8.

## 3. How every item is done (no shortcuts)
1. Read the existing code around the item. Extend what is there; never build a second, competing version.
2. Shared types and rules go in `packages/contracts/src/<name>.ts`, exported from `index.ts`. The API goes in `apps/api/src/modules/...`,
   registered in `app.ts`. The UI goes in `apps/web/src/components/...`. Migrations are `database/migrations/NNNN_...`. Use the next number in the current handover and keep migrations forward-only for MySQL 8.4.
3. Tests for the backend behaviour (`apps/api/test/*.api.test.ts`, real MySQL) and for the rules (`apps/web/test/*.test.ts`). Then run:
   - the contracts build;
   - `npx tsc --noEmit -p .` in `apps/api` and `apps/web`;
   - the full `npx vitest run` in both.

   All must be green before moving on. The commands are in the handover, section 1.
4. Redeploy the live stack (handover section 1: idle check, stop, start, wait for 401, check 200 on vie.otsi.cc).
5. Check it in a browser at `http://127.0.0.1:4310`.
   - **The owner's data is view only:** never press anything that changes, renders, deletes or decides on it.
   - Pause videos and close what you opened.
6. Write an ADR `docs/ADRs/ADR-1xx-name.md`: decision, limits, tests and browser evidence. Use the next ADR number in the current handover.
   - Add one CHANGELOG line to `../blueprint/CHANGELOG.md`. That file uses CRLF line endings.
   - Update the handover's sections 3 and 4.
7. Line endings: the repo mixes CRLF and LF.
   - Keep each file's endings. Never run `sed -i` on a CRLF file.
   - Check that `git diff --numstat` equals `git diff --numstat --ignore-cr-at-eol`.
8. Make a local commit with a pathspec, excluding `release-evidence/`, with a message like "v3 Phase C.3: ... (ADR-103)". **Never push.**

## 4. Hard rules (breaking one is worse than not finishing)
- **Truth:** keep detected, inferred, confirmed and not measured apart. Unknown beats wrong. Never invent a number, an event, an
  identity or a "done". Tracking is not identity: only a person confirms one.
- **Generic engine:** never tune rules, models or UI to the owner's test match or players.
- **Zero cost (ADR-030), local only:** free and open tools only, running on this PC. No paid API, cloud or subscription. Check a
  licence before any download and record it.
- **Data and machines:**
  - Never touch MySQL on port 3306, other OTSI projects, or files outside `D:\OTSI-Workspace\VIE-Engine-v2`.
  - Keep project plans, working files, and generated files in this workspace. Put local scratch files and logs under `.local/tmp/`.
  - Never drop or overwrite existing databases.
- **Secrets:** the database password is in `.local/mysql-owner.env`. Never print, log or commit it, or any other secret.
- **Ask the owner first** for:
  - scope or approved-UI changes;
  - anything paid;
  - public deployment changes beyond the usual redeploy;
  - destructive operations;
  - persistent system configuration (e.g. a scheduled task).
- The owner is not a developer. Report to him in short, plain words: what works now, what is not done, what needs his decision.

## 5. Where to resume

See sections 3 and 4 of the current handover for the latest completed item, verification evidence, and next task.
