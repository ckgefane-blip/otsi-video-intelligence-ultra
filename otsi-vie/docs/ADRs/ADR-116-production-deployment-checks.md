# ADR-116: Production Deployment Checks, Hardening, and Rollback Procedures

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase D.9: Production deployment checks
- **Migration:** None (Audits existing schema, runtime configuration, and storage health)

## Context

Deploying OTSI VIE v2 for production operation—serving analysts and running Option B managed pilots—requires rigorous operational controls before any external traffic is admitted:
1. **Runtime Configuration Integrity:** Guaranteeing that required runtime variables (`NODE_ENV`, `OTSI_VIE_PUBLIC_ORIGIN`, `OTSI_VIE_JWT_AUDIENCE`, `OTSI_VIE_CREDENTIAL_KEY`) are present, properly configured, and non-default.
2. **Cryptographic Secrets & Entropy Hardening:** Ensuring that `MEDIA_SIGNING_KEY` and `CREDENTIAL_KEY` hold at least 256 bits of cryptographic entropy, file permissions on `.local/stack/owner/secrets.env` and `.local/mysql-owner.env` are restricted, and zero unsealed third-party tokens exist in `provider_connections`.
3. **Tunnel Ingress Hardening:** Enforcing that Cloudflare Tunnel `9094b990-6c92-46e9-b9fa-31692841b062` ingress rules strictly bind incoming requests to `http://127.0.0.1:4310`, disallowing raw external access to the API (port 4520) or MySQL (port 3508), with an explicit `http_status:404` catch-all rule and TLS termination.
4. **Database Migration Integrity:** Verifying that all 63 schema migrations in `schema_migrations` match the sha256 checksums of the physical migration SQL files on disk.
5. **Deterministic Upgrade & Rollback Procedures:** Defining a safe upgrade sequence and instant rollback runbook backed by verified local database checkpoints.

## Decision

1. **Contracts (`packages/contracts/src/deployment.ts`):**
   - Defined Zod schemas:
     - `CheckStatus`: `PASS`, `WARN`, `FAIL`.
     - `CheckCategory`: `CONFIG`, `SECRETS`, `TUNNEL`, `STORAGE`, `DATABASE`.
     - `DeploymentCheckItem`: `name`, `category`, `status`, `detail`, `remediation`.
     - `TunnelConfigReport`: `public_origin`, `tunnel_id`, `ingress_rules_valid`, `tls_termination`, `headers_hardened`, `hsts_enabled`, `csp_strict`.
     - `SecretsAuditReport`: `env_file_permissions`, `signing_keys_entropy_bits`, `db_password_hardened`, `unsealed_tokens_count`, `exposed_secrets_found`.
     - `DeploymentCheckReport`: `timestamp`, `environment`, `overall_status`, `checks`, `tunnel`, `secrets`, `rollback_checkpoint_id`.
   - Exported through `packages/contracts/src/index.ts`.

2. **Preflight CLI (`otsi-vie/tools/deploy/production_check.py`):**
   - Standalone auditor tool checking:
     - Python >= 3.10 and LGPL FFmpeg build (ADR-029).
     - Node.js >= 20.
     - Shannon entropy of signing keys and DB credentials.
     - Cloudflare tunnel configuration in `.local/cloudflared-home/.cloudflared/config.yml`.
     - Migration checksums across all 63 migrations.
     - Storage directory structure and free disk space (> 10 GB).
     - Recent backup verification status (`verify.json` with `ok == true`).
   - Supports `--strict` mode (exits non-zero on WARN or FAIL) and `--json` for automation.

3. **API Endpoint (`apps/api/src/modules/admin/admin.ts`):**
   - Implemented `GET /v1/admin/deployment/preflight` in `AdminController` and `AdminService` returning `DeploymentCheckReport` for admin console inspection.

4. **Runbook (`otsi-vie/docs/runbooks/PRODUCTION_DEPLOYMENT.md`):**
   - Documented complete step-by-step pre-deployment verification, backup checkpoint snapshot, zero-loss upgrade sequencing, and emergency rollback procedures.

5. **Automated Verification:**
   - Worker unit tests in `otsi-vie/services/worker/tests/test_production_check.py` (3/3 passed).
   - API contract tests in `otsi-vie/apps/api/test/deployment.api.test.ts` (4/4 passed).
   - Preflight tool execution (`production_check.py`): 14/14 checks reported `[OK] PASS` with overall status `PASS`.
