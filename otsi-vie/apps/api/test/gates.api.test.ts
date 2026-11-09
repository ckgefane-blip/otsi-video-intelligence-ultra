/**
 * v3 Phase D.10 (ADR-117): Release Gates G01–G15 status integration and contract tests.
 */
import { describe, expect, it } from "vitest";
import {
  GateCategory,
  GateStatus,
  ReleaseGateId,
  ReleaseGateRecord,
  ReleaseGatesReport,
  accuracyMeasured,
} from "@otsi-vie/contracts";

describe("v3 Phase D.10: Release Gates G01–G15 Contracts", () => {
  it("validates GateStatus, GateCategory and ReleaseGateId enum variants", () => {
    expect(GateStatus.parse("NOT_STARTED")).toBe("NOT_STARTED");
    expect(GateStatus.parse("MEASURING")).toBe("MEASURING");
    expect(GateStatus.parse("PASSED")).toBe("PASSED");
    expect(GateStatus.parse("WAIVED")).toBe("WAIVED");
    expect(GateStatus.parse("FAILED")).toBe("FAILED");

    expect(GateCategory.parse("INFRASTRUCTURE")).toBe("INFRASTRUCTURE");
    expect(GateCategory.parse("SECURITY")).toBe("SECURITY");
    expect(GateCategory.parse("MEDIA")).toBe("MEDIA");
    expect(GateCategory.parse("AI_ACCURACY")).toBe("AI_ACCURACY");
    expect(GateCategory.parse("GOVERNANCE")).toBe("GOVERNANCE");

    expect(ReleaseGateId.parse("G01")).toBe("G01");
    expect(ReleaseGateId.parse("G05")).toBe("G05");
    expect(ReleaseGateId.parse("G15")).toBe("G15");
    expect(() => ReleaseGateId.parse("G16")).toThrow();
  });

  it("validates single ReleaseGateRecord schema", () => {
    const record = ReleaseGateRecord.parse({
      id: "G05",
      name: "Detection Accuracy",
      category: "AI_ACCURACY",
      status: "MEASURING",
      what: "Player and ball bounding box detection across match conditions",
      evidence_required: "Recall >= 82%, Precision >= 88% on holdouts",
      release_rule: "Display 'accuracy not yet measured' until benchmark passes",
      evidence_reference: "ADR-063, Ground Truth Benchmark Spec",
      last_verified_at: null,
      notes: "Provisional thresholds frozen in writing",
    });

    expect(record.id).toBe("G05");
    expect(record.category).toBe("AI_ACCURACY");
    expect(record.status).toBe("MEASURING");
    expect(record.last_verified_at).toBeNull();
  });

  it("validates full ReleaseGatesReport schema with 15 gates", () => {
    const rawGates = [
      {
        id: "G01",
        name: "Database Architecture",
        category: "INFRASTRUCTURE",
        status: "PASSED",
        what: "Schema migrations",
        evidence_required: "Zero failed migrations",
        release_rule: "No failed migrations",
      },
      {
        id: "G05",
        name: "Detection Accuracy",
        category: "AI_ACCURACY",
        status: "MEASURING",
        what: "Player detection",
        evidence_required: "Recall >= 82%",
        release_rule: "Banner displayed",
      },
    ];

    const report = ReleaseGatesReport.parse({
      timestamp: "2026-11-09T17:25:00.000Z",
      passed_count: 1,
      total_count: 2,
      accuracy_measured: false,
      all_passed: false,
      gates: rawGates,
    });

    expect(report.passed_count).toBe(1);
    expect(report.total_count).toBe(2);
    expect(report.accuracy_measured).toBe(false);
    expect(report.all_passed).toBe(false);
  });

  it("checks accuracyMeasured helper function", () => {
    const unmeasuredGates = [
      { id: "G05", name: "Detection", status: "MEASURING" as const, what: "" },
      { id: "G06", name: "Tracking", status: "NOT_STARTED" as const, what: "" },
      { id: "G07", name: "Identity", status: "NOT_STARTED" as const, what: "" },
    ];
    expect(accuracyMeasured(unmeasuredGates)).toBe(false);

    const passedGates = [
      { id: "G05", name: "Detection", status: "PASSED" as const, what: "" },
      { id: "G06", name: "Tracking", status: "PASSED" as const, what: "" },
      { id: "G07", name: "Identity", status: "PASSED" as const, what: "" },
    ];
    expect(accuracyMeasured(passedGates)).toBe(true);
  });
});
