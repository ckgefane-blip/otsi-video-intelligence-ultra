/** Live token display helpers (billing blueprint §4.2): pure functions, no I/O. */
import { describe, expect, it } from "vitest";
import type { WalletLedgerEntry, WalletLedgerKind, WalletJobType } from "@otsi-vie/contracts";
import { chargedCost, chargedJobKind, minutesCovered, recentFailure, refundForJob, usageBuckets } from "@/lib/tokenCost";

const entry = (overrides: Partial<WalletLedgerEntry> & { kind: WalletLedgerKind; amount: number; created_at: string }): WalletLedgerEntry => ({
  id: "0190a000-0000-7000-8000-000000000001",
  organization_id: "0190a000-0000-7000-8000-000000000002",
  balance_after: 0,
  job_type: null,
  job_id: null,
  idempotency_key: "test",
  invoice_ref: null,
  reason: null,
  actor_id: null,
  expires_at: null,
  ...overrides,
});

describe("chargedJobKind", () => {
  it("maps only analysis and render to charged work", () => {
    expect(chargedJobKind("ANALYZE")).toBe("ANALYSIS");
    expect(chargedJobKind("RENDER")).toBe("REEL_RENDER");
    expect(chargedJobKind("PROXY")).toBeNull();
    expect(chargedJobKind("ASSESS")).toBeNull();
    expect(chargedJobKind("TRACK_BALL")).toBeNull();
    expect(chargedJobKind("INGEST_UPLOAD")).toBeNull();
  });
});

describe("chargedCost", () => {
  it("prices analysis at 1 token per started minute, rounded up", () => {
    expect(chargedCost("ANALYSIS", 90 * 60_000_000)).toBe(90);
    expect(chargedCost("ANALYSIS", 90 * 60_000_000 + 1_000_000)).toBe(91);
    expect(chargedCost("ANALYSIS", 60_000_000)).toBe(1);
  });
  it("refuses a video with no measured duration", () => {
    expect(chargedCost("ANALYSIS", null)).toBeNull();
    expect(chargedCost("ANALYSIS", undefined)).toBeNull();
  });
  it("charges the four flat actions 10 tokens each", () => {
    expect(chargedCost("REEL_RENDER")).toBe(10);
    expect(chargedCost("PLAYER_REPORT")).toBe(10);
    expect(chargedCost("EXPORT_PACK")).toBe(10);
    expect(chargedCost("AI_ANALYSIS")).toBe(10);
  });
});

describe("minutesCovered", () => {
  it("derives footage minutes from progress", () => {
    expect(minutesCovered(0, 90)).toBe(0);
    expect(minutesCovered(50, 90)).toBe(45);
    expect(minutesCovered(100, 90)).toBe(90);
    expect(minutesCovered(37.8, 90)).toBe(34);
  });
  it("clamps progress outside 0-100", () => {
    expect(minutesCovered(-5, 90)).toBe(0);
    expect(minutesCovered(140, 90)).toBe(90);
  });
});

describe("recentFailure", () => {
  it("is true only within 15 minutes of finishing", () => {
    const now = Date.parse("2026-11-13T12:00:00.000Z");
    expect(recentFailure("2026-11-13T11:50:00.000Z", now)).toBe(true);
    expect(recentFailure("2026-11-13T11:44:00.000Z", now)).toBe(false);
    expect(recentFailure(null, now)).toBe(false);
    expect(recentFailure("not-a-date", now)).toBe(false);
  });
});

describe("refundForJob", () => {
  const type: WalletJobType = "REEL_RENDER";
  it("returns the refund issued just after the job failed", () => {
    const entries = [entry({ kind: "REFUND", amount: 10, job_type: type, created_at: "2026-11-13T11:52:00.000Z" })];
    expect(refundForJob(entries, type, "2026-11-13T11:50:00.000Z")).toBe(10);
  });
  it("ignores refunds of another action, before the failure, or too late", () => {
    const entries = [
      entry({ kind: "REFUND", amount: 10, job_type: "ANALYSIS", created_at: "2026-11-13T11:52:00.000Z" }),
      entry({ kind: "REFUND", amount: 10, job_type: type, created_at: "2026-11-13T11:40:00.000Z" }),
      entry({ kind: "REFUND", amount: 10, job_type: type, created_at: "2026-11-13T12:00:00.000Z" }),
    ];
    expect(refundForJob(entries, type, "2026-11-13T11:50:00.000Z")).toBeNull();
  });
  it("returns null when no refund was recorded", () => {
    expect(refundForJob([], type, "2026-11-13T11:50:00.000Z")).toBeNull();
    expect(refundForJob([], type, null)).toBeNull();
  });
});

describe("usageBuckets", () => {
  const now = new Date("2026-11-13T12:00:00.000Z");
  const spend = (job_type: WalletJobType, amount: number, created_at: string) =>
    entry({ kind: "SPEND", amount: -amount, job_type, created_at });
  it("groups spend by day, week and month, broken down by action", () => {
    const entries = [
      spend("ANALYSIS", 90, "2026-11-13T10:00:00.000Z"),
      spend("REEL_RENDER", 10, "2026-11-13T11:00:00.000Z"),
      spend("ANALYSIS", 45, "2026-11-10T10:00:00.000Z"),
      spend("PLAYER_REPORT", 10, "2026-10-20T10:00:00.000Z"),
      spend("EXPORT_PACK", 10, "2026-09-01T10:00:00.000Z"),
    ];
    const u = usageBuckets(entries, now);
    expect(u.day.total).toBe(100);
    expect(u.day.byAction).toEqual({ ANALYSIS: 90, REEL_RENDER: 10, PLAYER_REPORT: 0, EXPORT_PACK: 0, AI_ANALYSIS: 0 });
    expect(u.week.total).toBe(145);
    expect(u.week.byAction.ANALYSIS).toBe(135);
    expect(u.month.total).toBe(155);
    expect(u.month.byAction.PLAYER_REPORT).toBe(10);
    expect(u.month.byAction.EXPORT_PACK).toBe(0);
  });
  it("nets a refund against the same action's spend", () => {
    const entries = [
      spend("REEL_RENDER", 10, "2026-11-13T10:00:00.000Z"),
      entry({ kind: "REFUND", amount: 10, job_type: "REEL_RENDER", created_at: "2026-11-13T10:05:00.000Z" }),
    ];
    const u = usageBuckets(entries, now);
    expect(u.day.total).toBe(0);
    expect(u.day.byAction.REEL_RENDER).toBe(0);
  });
  it("ignores credits and rows without an action", () => {
    const entries = [
      entry({ kind: "PURCHASE", amount: 500, created_at: "2026-11-13T09:00:00.000Z" }),
      entry({ kind: "FREE_GRANT", amount: 100, created_at: "2026-11-13T09:00:00.000Z" }),
      spend("ANALYSIS", 30, "2026-11-13T10:00:00.000Z"),
    ];
    expect(usageBuckets(entries, now).day.total).toBe(30);
  });
});
