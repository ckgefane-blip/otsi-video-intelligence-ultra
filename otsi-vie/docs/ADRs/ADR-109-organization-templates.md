# ADR-109: Organization Templates for Spotlight, Style, and Branding

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase C.10 (B.17)
- **Migration:** 0062 (`org_templates`)

## Context

Editors and analysts require reusable, team-wide templates to maintain visual branding consistency across reels without having to manually configure spotlight parameters, lower thirds, on-screen graphics, score bugs, and audio branding for every edit.

Previous templates (ADR-055, `effect_presets`) stored full reel looks monolithically without separation of concerns. In practice, editors frequently need to:
1. Apply spotlight geometries or tracking styles without altering team logos, intro videos, or background soundtrack.
2. Apply standard club branding (logos, watermarks, intro/outro bumpers, loudness profiles) across diverse cuts while keeping customized player spotlighting intact.
3. Apply television-style overlays (lower thirds, match cards, event tags, colour looks) independently.
4. Access built-in standard presets out of the box (e.g. Broadcast Gold, Dynamic Cyan, Cinematic Warm).
5. View and manage all organization templates in both Clip Studio (Page 07) and the Project Center Library (Page 09).

## Decision

1. **Database Schema (`database/migrations/0062_org_templates.sql`):**
   - Created table `org_templates` with `id`, `organization_id`, `name`, `description`, `kind` (`SPOTLIGHT`, `STYLE`, `BRANDING`, `FULL`), `spec` (JSON object), `is_shared` (BOOLEAN), `created_by`, `created_at`, `updated_at`.
   - Unique constraint `uq_org_templates_name` on `(organization_id, name)` ensuring distinct names within an organization.
   - Foreign key integrity referencing `organizations(id)` and `users(id)`.
   - Verified schema fingerprint reproducibility on disposable MySQL 8.4 container via `tools/db/db_check.py` (143 tables, 32 triggers, 5 views, 2 routines, 398 foreign keys).

2. **Contracts (`packages/contracts/src/templates.ts`):**
   - Defined `OrgTemplateKind` (`SPOTLIGHT`, `STYLE`, `BRANDING`, `FULL`).
   - Defined modular schemas:
     - `SpotlightSpec`: beam dimension, feather, size, ring, ring color, vignette, tracking lock, auto-tracking, reframe speed.
     - `StyleSpec`: lower third, name caption, event tags, score bug, match card, end screen, watermark, and LUT look.
     - `BrandingSpec`: competition/custom logos, music ID, music & match volume levels, intro/outro video IDs, audio ducking, target LUFS loudness.
   - Built-in presets: `Broadcast Gold` (FULL), `Dynamic Cyan` (SPOTLIGHT), and `Cinematic Warm` (STYLE).
   - Functions `extractTemplateSpec` and `applyTemplateSpec` with selective section overrides.
   - Exported through `packages/contracts/src/index.ts`.

3. **Backend API (`apps/api/src/modules/reels/org-templates.ts`):**
   - `GET /v1/templates?kind=...`: lists built-in and organization-specific templates with kind filtering.
   - `GET /v1/templates/:id`: retrieves single template.
   - `POST /v1/templates`: creates template from active reel settings or direct specification; enforces rights verification on brand assets; prevents duplicate names (409 `NAME_TAKEN`); audits `org_template.created`.
   - `PUT /v1/templates/:id`: updates metadata and specification; protects built-ins (403 `BUILTIN_READ_ONLY`); audits `org_template.updated`.
   - `DELETE /v1/templates/:id`: deletes template; protects built-ins (403 `BUILTIN_CANNOT_BE_DELETED`); audits `org_template.deleted`.
   - `POST /v1/reels/:reelId/apply-org-template`: applies modular sections selectively (`apply_kinds`); verifies active rights on branding assets; updates reel version; audits `reel.org_template_applied`.
   - Registered `OrgTemplatesController` and `OrgTemplatesService` in `apps/api/src/app.ts`.

4. **Web UI (`apps/web`):**
   - `useStudio.ts`: state and actions for `orgTemplates`, `saveOrgTemplate`, `applyOrgTemplate`, `deleteOrgTemplate`.
   - `MediaBin.tsx`: Clip Studio Templates tab with quick kind filters (`ALL`, `SPOTLIGHT`, `STYLE`, `BRANDING`, `FULL`), modular save form, kind badges, and selective apply buttons (`All`, `Spotlight`, `Style`, `Branding`).
   - `useLibrary.ts` and `LibraryMain.tsx`: integrated `Template` into library asset catalog with tab badge counts, filtering, and table/card presentation.

5. **Testing & Verification:**
   - Vitest unit tests in `apps/web/test/orgTemplates.test.ts` (modular extraction, selective application, built-in integrity, library tab integration). Full 56 web test files (231 tests) passed.
   - Vitest integration tests in `apps/api/test/orgTemplates.api.test.ts`. Full 52 API test files (270 tests) passed.
   - Next.js production build succeeded with clean static generation across 24 pages.
   - Stack deployed with migration 0062 applied. Endpoints verified online.
   - Headless browser automated verification confirmed Studio templates rendering (3 built-in presets visible with kind badges and action buttons) and Library templates tab integration.

## Consequences

- Editors can quickly apply approved club branding and styling without overwriting custom spotlight edits.
- Standard visual templates are shared seamlessly across all members of an organization.
- Backward compatibility with legacy monolithic templates is fully maintained.
- Next migration is 0063, next ADR is 110.
