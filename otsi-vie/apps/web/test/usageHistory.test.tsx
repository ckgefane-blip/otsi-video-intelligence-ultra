/**
 * Token usage history (billing blueprint §4.2(5)): where the tokens went — per day, per week, per
 * month, broken down by action. The source is the ledger rows the wallet already loaded; only SPEND
 * rows count, net of REFUND rows of the same action (a refunded spend did not stay spent).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WalletJobType, WalletLedgerEntry } from "@otsi-vie/contracts";

import { UsageHistory } from "@/components/wallet/UsageHistory";

const ORG = "0190a000-0000-7000-8000-000000000001";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const nowIso = () => new Date().toISOString(); // "today" must be this calendar day, whatever the hour

function entry(over: Partial<WalletLedgerEntry> & { kind: WalletLedgerEntry["kind"]; amount: number; job_type: WalletJobType | null; created_at: string }): WalletLedgerEntry {
  return {
    id: "0190a000-0000-7000-8000-000000000101", organization_id: ORG, balance_after: 100,
    job_id: null, idempotency_key: "k", invoice_ref: null, reason: null, actor_id: null, expires_at: null,
    ...over,
  };
}

// today: an analysis of 90 tokens. 3 days ago: a 10-token render, plus a 60-token analysis that was
// refunded in full. 20 days ago: a 10-token player report. 40 days ago: a 10-token export pack.
const entries: WalletLedgerEntry[] = [
  entry({ kind: "SPEND", amount: -90, job_type: "ANALYSIS", created_at: nowIso() }),
  entry({ kind: "SPEND", amount: -10, job_type: "REEL_RENDER", created_at: hoursAgo(3 * 24) }),
  entry({ kind: "SPEND", amount: -60, job_type: "ANALYSIS", created_at: hoursAgo(3 * 24 + 1) }),
  entry({ kind: "REFUND", amount: 60, job_type: "ANALYSIS", created_at: hoursAgo(3 * 24) }),
  entry({ kind: "SPEND", amount: -10, job_type: "PLAYER_REPORT", created_at: hoursAgo(20 * 24) }),
  entry({ kind: "SPEND", amount: -10, job_type: "EXPORT_PACK", created_at: hoursAgo(40 * 24) }),
  entry({ kind: "PURCHASE", amount: 500, job_type: null, created_at: nowIso() }),
];

describe("UsageHistory", () => {
  it("groups spend by action over the month, net of refunds, and never counts credits", () => {
    render(<UsageHistory entries={entries} />);
    // the month tab is the default: today + 3 days ago (refunded analysis nets to zero) + 20 days ago
    expect(screen.getByText("Token usage")).toBeTruthy();
    expect(document.querySelector("[data-usage-period]")?.getAttribute("data-usage-period")).toBe("month");
    expect(document.querySelector('[data-usage-action="ANALYSIS"]')?.textContent).toContain("90 tokens");
    expect(document.querySelector('[data-usage-action="REEL_RENDER"]')?.textContent).toContain("10 tokens");
    expect(document.querySelector('[data-usage-action="PLAYER_REPORT"]')?.textContent).toContain("10 tokens");
    expect(document.querySelector('[data-usage-action="EXPORT_PACK"]')).toBeNull(); // 40 days ago: outside the month
    expect(document.querySelector("[data-usage-total]")?.textContent).toContain("110 tokens");
  });

  it("narrows to today and to the week", () => {
    render(<UsageHistory entries={entries} />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(document.querySelector("[data-usage-period]")?.getAttribute("data-usage-period")).toBe("day");
    expect(document.querySelector('[data-usage-action="ANALYSIS"]')?.textContent).toContain("90 tokens");
    expect(document.querySelector('[data-usage-action="REEL_RENDER"]')).toBeNull();
    expect(document.querySelector("[data-usage-total]")?.textContent).toContain("90 tokens");
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(document.querySelector("[data-usage-period]")?.getAttribute("data-usage-period")).toBe("week");
    expect(document.querySelector("[data-usage-total]")?.textContent).toContain("100 tokens");
  });

  it("says plainly when nothing was spent in the period", () => {
    render(<UsageHistory entries={[]} />);
    expect(screen.getByText("No tokens spent in this period.")).toBeTruthy();
    expect(document.querySelector("[data-usage-total]")).toBeNull();
  });
});
