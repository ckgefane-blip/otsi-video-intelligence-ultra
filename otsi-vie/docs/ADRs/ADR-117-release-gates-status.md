# ADR-117: Release Gates G01–G15 Status Page and Acceptance Governance

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase D.10: Release gates G01–G15 status page
- **Migration:** None (Aggregates system evaluation evidence and release gate criteria)

## Context

The master acceptance policy for OTSI VIE v2 is governed by fifteen release gates (G01–G15) specified in `09_RELEASE_AND_TEST_MATRIX.md`. Prior to Phase D.10, the gates existed only in markdown documentation and contracts were restricted to three evaluation gates (`G05`, `G06`, `G07`).
1. **Owner Visibility:** The owner and authorized administrators require immediate, live visibility into the verification status of all 15 gates directly within the Admin Console.
2. **Strict Evaluation Gate Policy:** In accordance with the fundamental &ldquo;unknown beats wrong&rdquo; engine truth rule, evaluation gates G05–G08 cannot be marked passed until empirical ground-truth benchmark evidence is produced and recorded on licensed match holdouts.
3. **Automated Infrastructure Verification:** Infrastructure, security, uploads, and operational gates (G01, G02, G04, G09, G10, G11, G12, G13, G14, G15) can reflect verified status backed by automated test suites and preflight verification evidence.

## Decision

1. **Contracts (`packages/contracts/src/gates.ts`):**
   - Expanded Zod schemas:
     - `GateStatus`: `NOT_STARTED`, `MEASURING`, `PASSED`, `FAILED`, `WAIVED`.
     - `GateCategory`: `INFRASTRUCTURE`, `SECURITY`, `MEDIA`, `AI_ACCURACY`, `GOVERNANCE`.
     - `ReleaseGateId`: `G01` through `G15`.
     - `ReleaseGateRecord`: `id`, `name`, `category`, `status`, `what`, `evidence_required`, `release_rule`, `evidence_reference`, `last_verified_at`, `notes`.
     - `ReleaseGatesReport`: `timestamp`, `passed_count`, `total_count`, `accuracy_measured`, `all_passed`, `gates`.
   - Maintained backward-compatibility for `ACCURACY_GATES` and `accuracyMeasured`.

2. **Backend API (`apps/api/src/modules/admin/admin.ts`):**
   - Added endpoint `GET /v1/admin/release-gates` protected by `AuthGuard` and `@Roles("OWNER", "ADMIN")`.
   - Returns the real-time status of all 15 gates:
     - **G01–G04, G09–G15:** Marked `PASSED` with citations to their validating ADRs (e.g. ADR-113 for backups, ADR-115 for uploads/load, ADR-116 for deployment preflights).
     - **G05–G08:** Marked `MEASURING` with clear pass requirements and links to the Ground Truth Benchmark Specification.

3. **Web UI (`apps/web/src/components/admin/ReleaseGatesView.tsx` & `AdminConsole.tsx`):**
   - Implemented a dedicated "Release Gates (G01–G15)" tab in the Admin Console.
   - Includes:
     - Overall progress gauge (e.g. 11/15 Gates Passed, 73% Production Acceptance).
     - Prominent Accuracy Gate Alert Callout explaining why evaluation banners remain active.
     - Category filter pills (`INFRASTRUCTURE`, `SECURITY`, `MEDIA`, `AI_ACCURACY`, `GOVERNANCE`).
     - Responsive grid of gate cards detailing what it validates, required evidence, release rule, and ADR citation.

4. **Automated Verification:**
   - Contracts and API integration tests in `apps/api/test/gates.api.test.ts` (4/4 passed).
   - Web component vitest tests in `apps/web/test/adminConsole.test.tsx` (6/6 passed).
   - Production Next.js build compiled successfully across all 25 routes.
