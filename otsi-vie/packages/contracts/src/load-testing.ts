import { z } from "zod";

/**
 * v3 Phase D.7 (ADR-115): Load Testing, Throughput Metrics, and Stress Verification.
 *
 * Defines the schemas and metrics for stress-testing concurrent uploads,
 * long-match timeline ingest (90+ min multi-period data), and concurrent
 * reel render queues with zero resource leaks.
 */

export const LoadTestScenario = z.enum(["uploads", "matches", "renders", "all"]);
export type LoadTestScenario = z.infer<typeof LoadTestScenario>;

export const LoadMetric = z.object({
  name: z.string(),
  operations: z.number().int().nonnegative(),
  concurrency: z.number().int().positive(),
  p50_ms: z.number().nonnegative(),
  p95_ms: z.number().nonnegative(),
  p99_ms: z.number().nonnegative(),
  min_ms: z.number().nonnegative(),
  max_ms: z.number().nonnegative(),
  mean_ms: z.number().nonnegative(),
  throughput_ops_per_sec: z.number().nonnegative(),
  bytes_transferred: z.number().int().nonnegative().optional(),
  throughput_mb_per_sec: z.number().nonnegative().optional(),
  errors: z.number().int().nonnegative(),
  error_codes: z.record(z.string(), z.number().int().nonnegative()),
});
export type LoadMetric = z.infer<typeof LoadMetric>;

export const LoadAssertion = z.object({
  name: z.string(),
  passed: z.boolean(),
  message: z.string(),
});
export type LoadAssertion = z.infer<typeof LoadAssertion>;

export const LoadScenarioReport = z.object({
  scenario: z.string(),
  status: z.enum(["PASSED", "FAILED"]),
  duration_ms: z.number().nonnegative(),
  metrics: z.array(LoadMetric),
  assertions: z.array(LoadAssertion),
});
export type LoadScenarioReport = z.infer<typeof LoadScenarioReport>;

export const LoadTestReport = z.object({
  timestamp: z.string(),
  environment: z.string(),
  overall_status: z.enum(["PASSED", "FAILED"]),
  total_duration_ms: z.number().nonnegative(),
  scenarios: z.array(LoadScenarioReport),
  system_resources: z.object({
    memory_mb_delta: z.number(),
    open_handles_delta: z.number().optional(),
    db_connections_peak: z.number().int().nonnegative().optional(),
  }),
});
export type LoadTestReport = z.infer<typeof LoadTestReport>;
