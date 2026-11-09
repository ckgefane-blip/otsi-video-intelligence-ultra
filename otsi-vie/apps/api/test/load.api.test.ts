/**
 * v3 Phase D.7 (ADR-115): Load Testing and Performance Verification contracts test.
 */
import { describe, expect, it } from "vitest";
import {
  LoadAssertion,
  LoadMetric,
  LoadScenarioReport,
  LoadTestReport,
  LoadTestScenario,
} from "@otsi-vie/contracts";

describe("v3 Phase D.7: Load Testing Contracts", () => {
  it("validates LoadTestScenario enum variants", () => {
    expect(LoadTestScenario.parse("uploads")).toBe("uploads");
    expect(LoadTestScenario.parse("matches")).toBe("matches");
    expect(LoadTestScenario.parse("renders")).toBe("renders");
    expect(LoadTestScenario.parse("all")).toBe("all");
    expect(() => LoadTestScenario.parse("invalid")).toThrow();
  });

  it("validates and parses LoadMetric payload", () => {
    const raw = {
      name: "Concurrent Chunked Uploads",
      operations: 12,
      concurrency: 8,
      p50_ms: 224.3,
      p95_ms: 244.8,
      p99_ms: 250.0,
      min_ms: 180.5,
      max_ms: 260.1,
      mean_ms: 220.4,
      throughput_ops_per_sec: 25.4,
      bytes_transferred: 50331648,
      throughput_mb_per_sec: 105.9,
      errors: 0,
      error_codes: {},
    };
    const parsed = LoadMetric.parse(raw);
    expect(parsed.name).toBe("Concurrent Chunked Uploads");
    expect(parsed.throughput_mb_per_sec).toBe(105.9);
    expect(parsed.errors).toBe(0);
  });

  it("validates and parses LoadAssertion and LoadScenarioReport", () => {
    const assertion = LoadAssertion.parse({
      name: "ZeroUploadErrors",
      passed: true,
      message: "Errors encountered: 0",
    });
    expect(assertion.passed).toBe(true);

    const scenarioReport = LoadScenarioReport.parse({
      scenario: "uploads",
      status: "PASSED",
      duration_ms: 453.3,
      metrics: [
        {
          name: "Upload Operations",
          operations: 12,
          concurrency: 8,
          p50_ms: 224.3,
          p95_ms: 244.8,
          p99_ms: 250.0,
          min_ms: 180.5,
          max_ms: 260.1,
          mean_ms: 220.4,
          throughput_ops_per_sec: 25.4,
          bytes_transferred: 50331648,
          throughput_mb_per_sec: 105.9,
          errors: 0,
          error_codes: {},
        },
      ],
      assertions: [assertion],
    });
    expect(scenarioReport.status).toBe("PASSED");
    expect(scenarioReport.assertions[0].name).toBe("ZeroUploadErrors");
  });

  it("validates full LoadTestReport schema", () => {
    const fullReport = LoadTestReport.parse({
      timestamp: "2026-11-09T15:47:00.000Z",
      environment: "local-stack-3508",
      overall_status: "PASSED",
      total_duration_ms: 16690.0,
      scenarios: [
        {
          scenario: "uploads",
          status: "PASSED",
          duration_ms: 453.3,
          metrics: [],
          assertions: [{ name: "ZeroUploadErrors", passed: true, message: "OK" }],
        },
        {
          scenario: "matches",
          status: "PASSED",
          duration_ms: 2541.6,
          metrics: [],
          assertions: [{ name: "ZeroTimelineQueryErrors", passed: true, message: "OK" }],
        },
      ],
      system_resources: {
        memory_mb_delta: 14.5,
        open_handles_delta: 0,
        db_connections_peak: 12,
      },
    });
    expect(fullReport.overall_status).toBe("PASSED");
    expect(fullReport.scenarios.length).toBe(2);
    expect(fullReport.system_resources.db_connections_peak).toBe(12);
  });
});
