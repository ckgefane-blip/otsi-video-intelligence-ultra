import { z } from "zod";

/**
 * v3 Phase D.9 (ADR-116): Production Deployment Checks, Hardening, and Rollback Contracts.
 *
 * Defines contracts for preflight deployment audits, tunnel security verification,
 * secrets entropy checks, and rollback procedure validations.
 */

export const CheckStatus = z.enum(["PASS", "WARN", "FAIL"]);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const CheckCategory = z.enum(["CONFIG", "SECRETS", "TUNNEL", "STORAGE", "DATABASE"]);
export type CheckCategory = z.infer<typeof CheckCategory>;

export const DeploymentCheckItem = z.object({
  name: z.string(),
  category: CheckCategory,
  status: CheckStatus,
  detail: z.string(),
  remediation: z.string().optional(),
});
export type DeploymentCheckItem = z.infer<typeof DeploymentCheckItem>;

export const TunnelConfigReport = z.object({
  public_origin: z.string(),
  tunnel_id: z.string(),
  ingress_rules_valid: z.boolean(),
  tls_termination: z.boolean(),
  headers_hardened: z.boolean(),
  hsts_enabled: z.boolean(),
  csp_strict: z.boolean(),
});
export type TunnelConfigReport = z.infer<typeof TunnelConfigReport>;

export const SecretsAuditReport = z.object({
  env_file_permissions: z.string(),
  signing_keys_entropy_bits: z.number().int().nonnegative(),
  db_password_hardened: z.boolean(),
  unsealed_tokens_count: z.number().int().nonnegative(),
  exposed_secrets_found: z.boolean(),
});
export type SecretsAuditReport = z.infer<typeof SecretsAuditReport>;

export const DeploymentCheckReport = z.object({
  timestamp: z.string(),
  environment: z.string(),
  overall_status: CheckStatus,
  checks: z.array(DeploymentCheckItem),
  tunnel: TunnelConfigReport,
  secrets: SecretsAuditReport,
  rollback_checkpoint_id: z.string().optional(),
});
export type DeploymentCheckReport = z.infer<typeof DeploymentCheckReport>;
