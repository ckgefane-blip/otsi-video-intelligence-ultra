/**
 * v3 Phase D.9 (ADR-116): Deployment Preflight and Hardening Contracts tests.
 */
import { describe, expect, it } from "vitest";
import {
  CheckCategory,
  CheckStatus,
  DeploymentCheckItem,
  DeploymentCheckReport,
  SecretsAuditReport,
  TunnelConfigReport,
} from "@otsi-vie/contracts";

describe("v3 Phase D.9: Production Deployment Contracts", () => {
  it("validates CheckStatus and CheckCategory enums", () => {
    expect(CheckStatus.parse("PASS")).toBe("PASS");
    expect(CheckStatus.parse("WARN")).toBe("WARN");
    expect(CheckStatus.parse("FAIL")).toBe("FAIL");
    expect(() => CheckStatus.parse("UNKNOWN")).toThrow();

    expect(CheckCategory.parse("CONFIG")).toBe("CONFIG");
    expect(CheckCategory.parse("SECRETS")).toBe("SECRETS");
    expect(CheckCategory.parse("TUNNEL")).toBe("TUNNEL");
    expect(CheckCategory.parse("STORAGE")).toBe("STORAGE");
    expect(CheckCategory.parse("DATABASE")).toBe("DATABASE");
    expect(() => CheckCategory.parse("NETWORK")).toThrow();
  });

  it("validates DeploymentCheckItem schema", () => {
    const item = DeploymentCheckItem.parse({
      name: "PythonVersion",
      category: "CONFIG",
      status: "PASS",
      detail: "Python 3.13.15 >= 3.10",
      remediation: "None",
    });
    expect(item.name).toBe("PythonVersion");
    expect(item.status).toBe("PASS");
  });

  it("validates TunnelConfigReport and SecretsAuditReport schemas", () => {
    const tunnel = TunnelConfigReport.parse({
      public_origin: "https://vie.otsi.cc",
      tunnel_id: "9094b990-6c92-46e9-b9fa-31692841b062",
      ingress_rules_valid: true,
      tls_termination: true,
      headers_hardened: true,
      hsts_enabled: true,
      csp_strict: true,
    });
    expect(tunnel.tls_termination).toBe(true);

    const secrets = SecretsAuditReport.parse({
      env_file_permissions: "0600 (restricted)",
      signing_keys_entropy_bits: 413,
      db_password_hardened: true,
      unsealed_tokens_count: 0,
      exposed_secrets_found: false,
    });
    expect(secrets.unsealed_tokens_count).toBe(0);
    expect(secrets.db_password_hardened).toBe(true);
  });

  it("validates full DeploymentCheckReport schema", () => {
    const full = DeploymentCheckReport.parse({
      timestamp: "2026-11-09T16:30:00.000Z",
      environment: "local-owner-3508",
      overall_status: "PASS",
      checks: [
        {
          name: "MigrationChecksumIntegrity",
          category: "DATABASE",
          status: "PASS",
          detail: "All 63 schema migrations match disk checksums perfectly",
        },
      ],
      tunnel: {
        public_origin: "https://vie.otsi.cc",
        tunnel_id: "9094b990-6c92-46e9-b9fa-31692841b062",
        ingress_rules_valid: true,
        tls_termination: true,
        headers_hardened: true,
        hsts_enabled: true,
        csp_strict: true,
      },
      secrets: {
        env_file_permissions: "0600 (restricted)",
        signing_keys_entropy_bits: 413,
        db_password_hardened: true,
        unsealed_tokens_count: 0,
        exposed_secrets_found: false,
      },
      rollback_checkpoint_id: "20261109T085519Z",
    });
    expect(full.overall_status).toBe("PASS");
    expect(full.rollback_checkpoint_id).toBe("20261109T085519Z");
  });
});
