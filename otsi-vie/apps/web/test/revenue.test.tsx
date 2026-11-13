/** Admin › Billing revenue summary: summarizeRevenue (contracts) and the RevenueSummary panel; owner 2026-11-13. */
import { summarizeRevenue, type RevenueOrderRow, type RevenueSummary as Summary } from "@otsi-vie/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api, ApiProblem } = vi.hoisted(() => {
  class ApiProblem extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
  }
  return { api: vi.fn(), ApiProblem };
});
vi.mock("@/lib/api", () => ({ api, apiBlob: vi.fn(), ApiProblem }));

import { RevenueSummary } from "@/components/billing/RevenueSummary";

const NOW = new Date("2026-11-13T12:00:00Z");
const o = (x: Partial<RevenueOrderRow>): RevenueOrderRow => ({ currency: "NGN", status: "CONFIRMED", plan_code: "CLUB", amount_minor: 3_900_000,
  amount_received_minor: 3_900_000, amount_refunded_minor: null, confirmed_at: "2026-11-02T10:00:00Z", updated_at: "2026-11-02T10:00:00Z", ...x });

describe("summarizeRevenue", () => {
  it("books confirmed money by the day it was confirmed and keeps naira and dollars apart", () => {
    const s = summarizeRevenue([
      o({}),
      o({ currency: "USD", amount_minor: 7_900, amount_received_minor: 7_900, confirmed_at: "2026-10-20T10:00:00Z" }),
      o({ status: "PARTIAL", amount_received_minor: 1_000_000, updated_at: "2026-11-05T00:00:00Z" }),
      o({ status: "AWAITING_CONFIRMATION", amount_received_minor: 0 }),
      o({ status: "REFUNDED", confirmed_at: "2026-10-01T00:00:00Z", updated_at: "2026-11-10T00:00:00Z", amount_refunded_minor: 900_000 }),
      o({ status: "REJECTED" }), o({ status: "ORDERED", amount_received_minor: 0 }),
      o({ confirmed_at: "2024-01-01T00:00:00Z" }),                                    // older than 12 months: all time only
    ], [
      { currency: "NGN", status: "PAID", amount_minor: 500_000, updated_at: "2026-11-01T00:00:00Z" },
      { currency: "NGN", status: "INVOICED", amount_minor: 200_000, updated_at: "2026-11-01T00:00:00Z" },
      { currency: "USD", status: "REQUESTED", amount_minor: 1_000, updated_at: "2026-11-01T00:00:00Z" },
    ], [
      { plan_code: "CLUB", state: "ACTIVE", period_end: "2026-11-18T00:00:00Z" },
      { plan_code: "CLUB", state: "PAST_DUE", period_end: "2026-11-01T00:00:00Z" },
      { plan_code: "STARTER", state: "ACTIVE", period_end: "2027-01-01T00:00:00Z" },
      { plan_code: "ACADEMY", state: "CANCELED", period_end: null },
    ], NOW);
    const ngn = s.totals.find((t) => t.currency === "NGN")!;
    const usd = s.totals.find((t) => t.currency === "USD")!;
    // NGN: 3.9m + 1m partial + 3.9m refunded order receipt + 3.9m old + 0.5m pack − 0.9m refund
    expect(ngn.received_minor).toBe(3_900_000 + 1_000_000 + 3_900_000 + 3_900_000 + 500_000);
    expect(ngn.refunded_minor).toBe(900_000);
    expect(ngn.net_minor).toBe(ngn.received_minor - 900_000);
    expect(ngn.this_month_minor).toBe(3_900_000 + 1_000_000 + 500_000 - 900_000);
    expect(ngn.last_month_minor).toBe(3_900_000);
    expect(ngn.last_12_months_minor).toBe(ngn.net_minor - 3_900_000);
    expect(ngn.packs_minor).toBe(500_000);
    expect(ngn.awaiting_minor).toBe(2_900_000 + 3_900_000 + 200_000);           // partial remainder + awaiting order + invoiced pack
    expect(usd.this_month_minor).toBe(0);
    expect(usd.last_month_minor).toBe(7_900);
    expect(s.months).toHaveLength(12);
    expect(s.months[0]!.month).toBe("2025-12");
    expect(s.months[11]).toEqual({ month: "2026-11", NGN: ngn.this_month_minor, USD: 0 });
    expect(s.orders).toEqual({ ordered: 1, awaiting: 1, partial: 1, confirmed: 3, rejected: 1, refunded: 1 });
    expect(s.packs).toEqual({ requested: 1, invoiced: 1, paid: 1, cancelled: 0 });
    expect(s.active_plans).toEqual(expect.arrayContaining([{ plan_code: "CLUB", count: 2 }, { plan_code: "STARTER", count: 1 }]));
    expect(s.active_plans).toHaveLength(2);
    expect(s.renewals_due_7d).toBe(1);
  });

  it("an empty organisation reads as zero, not as missing", () => {
    const s = summarizeRevenue([], [], [], NOW);
    expect(s.totals.map((t) => [t.currency, t.net_minor])).toEqual([["NGN", 0], ["USD", 0]]);
    expect(s.months.every((m) => m.NGN === 0 && m.USD === 0)).toBe(true);
    expect(s.active_plans).toEqual([]);
  });
});

const DATA: Summary = summarizeRevenue([o({}), o({ status: "AWAITING_CONFIRMATION", amount_received_minor: 0 })], [],
  [{ plan_code: "CLUB", state: "ACTIVE", period_end: "2026-11-18T00:00:00Z" }], NOW);

beforeEach(() => api.mockReset());

describe("RevenueSummary panel", () => {
  it("reads the real endpoint and shows totals per currency, the months, the counts and renewals", async () => {
    api.mockResolvedValue(DATA);
    render(<RevenueSummary />);
    expect(screen.getByRole("heading", { name: "Revenue" })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[data-rev="NGN-this-month"]')).toHaveTextContent("39,000"));
    expect(api).toHaveBeenCalledWith("/v1/admin/billing/revenue");
    expect(document.querySelectorAll("[data-rev-currency]")).toHaveLength(2);
    expect(document.querySelector('[data-rev="NGN-awaiting"]')).toHaveTextContent("39,000");
    expect(document.querySelectorAll("[data-rev-months] tbody tr")).toHaveLength(12);
    expect(document.querySelector("[data-rev-orders]")).toHaveTextContent("1 awaiting · 0 part-paid · 1 confirmed");
    expect(document.querySelector("[data-rev-active]")).toHaveTextContent("Active plans: Club 1");
    expect(document.querySelector("[data-rev-renewals]")).toHaveTextContent("Renewals due within 7 days: 1");
  });

  it("says when the revenue cannot be read, and Retry reads it again", async () => {
    api.mockRejectedValueOnce(new ApiProblem(403, "FORBIDDEN", "Only an owner or admin can see revenue")).mockResolvedValue(DATA);
    render(<RevenueSummary />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Only an owner or admin can see revenue"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(document.querySelector("[data-rev-orders]")).toBeInTheDocument());
    expect(api).toHaveBeenCalledTimes(2);
  });
});
