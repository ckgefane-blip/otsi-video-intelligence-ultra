/**
 * Token Wallet pure ledger math (ADR-140): balance derivation, FIFO expiry, charge refusal and costs.
 * Runs in the web suite without MySQL — the same functions the API uses (packages/contracts/src/wallet.ts).
 */
import {
  FREE_GRANT_TOKENS,
  LOW_BALANCE_THRESHOLD,
  TOKEN_COSTS,
  analysisCostTokens,
  balanceOf,
  chargeRefusal,
  deriveWalletBalance,
  expiredCreditTokens,
  spendableBalance,
  PLAN_CATALOGUE,
  planUploadLimitBytes,
  topUpPrice,
  tokenPackCatalogue,
  type WalletLedgerEntry,
} from "@otsi-vie/contracts";
import { describe, expect, it } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";

function entry(partial: Partial<WalletLedgerEntry> & { amount: number }): WalletLedgerEntry {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    organization_id: ORG,
    kind: "PURCHASE",
    balance_after: 0,
    job_type: null,
    job_id: null,
    idempotency_key: `test-${Math.random()}`,
    invoice_ref: null,
    reason: null,
    actor_id: null,
    expires_at: null,
    created_at: "2026-11-01T00:00:00.000Z",
    ...partial,
  };
}

describe("token wallet costs", () => {
  it("charges 1 token per started minute of footage", () => {
    expect(analysisCostTokens(90 * 60 * 1_000_000)).toBe(90);
    expect(analysisCostTokens(61 * 1_000_000)).toBe(2);
    expect(analysisCostTokens(1)).toBe(1);
    expect(TOKEN_COSTS.reelRender).toBe(10);
    expect(TOKEN_COSTS.playerReport).toBe(10);
    expect(TOKEN_COSTS.exportPack).toBe(10);
  });

  it("refuses to price a video with no measured duration", () => {
    expect(analysisCostTokens(null)).toBeNull();
    expect(analysisCostTokens(undefined)).toBeNull();
    expect(analysisCostTokens(0)).toBeNull();
    expect(analysisCostTokens(-5)).toBeNull();
  });

  it("publishes the approved grassroots price list (owner 2026-11-13; free grant 100 by owner decision 2026-11-14 ~02:33): plans, free grant, top-up rates and upload limits", () => {
    const row = (code: string) => PLAN_CATALOGUE.find((p) => p.code === code)!;
    expect(FREE_GRANT_TOKENS).toBe(100);
    expect(LOW_BALANCE_THRESHOLD).toBe(90);
    // plans: tokens a month and the monthly price in kobo; dollars at ₦1,500 = $1, to the cent
    expect(row("STARTER")).toMatchObject({ tokens_per_month: 300, price_ngn_minor: 750_000, price_usd_minor: 500, upload_gb_per_video: 8, orderable: true });
    expect(row("CLUB")).toMatchObject({ tokens_per_month: 1000, price_ngn_minor: 2_000_000, price_usd_minor: 1333, upload_gb_per_video: 24 });
    expect(row("ACADEMY")).toMatchObject({ tokens_per_month: 3000, price_ngn_minor: 4_500_000, price_usd_minor: 3000, upload_gb_per_video: 48 });
    expect(row("SEASON")).toMatchObject({ tokens_per_month: 6000, price_ngn_minor: 7_500_000, price_usd_minor: 5000, upload_gb_per_video: 64 });
    expect(row("FREE")).toMatchObject({ price_ngn_minor: 0, upload_gb_per_video: 2, orderable: false });
    expect(row("ENTERPRISE")).toMatchObject({ price_ngn_minor: 25_000_000, upload_gb_per_video: null, topup_block_ngn_minor: null, orderable: false });
    // top-ups: blocks of 100 at the plan's own per-token price (₦30 / ₦25 / ₦20 / ₦15 / ₦12.50)
    expect([ "FREE", "STARTER", "CLUB", "ACADEMY", "SEASON" ].map((c) => topUpPrice(c as "FREE", 1)!.ngn_minor)).toEqual([300_000, 250_000, 200_000, 150_000, 125_000]);
    expect(topUpPrice("CLUB", 5)).toEqual({ tokens: 500, ngn_minor: 1_000_000, usd_minor: 665 });
    expect(topUpPrice("ENTERPRISE", 1)).toBeNull();
    // the Wallet's offer: the caller's own rate; no plan (or an unknown old plan) is the Free / Player rate; Enterprise has none
    const free = tokenPackCatalogue(null);
    expect(free).toMatchObject({ rate_plan: "FREE", block_tokens: 100, block_price_ngn_minor: 300_000, free_grant_tokens: 100 });
    expect(free.packs.map((p) => [p.blocks, p.tokens, p.price_ngn_minor, p.label])).toEqual([
      [1, 100, 300_000, "Player pack"], [3, 300, 900_000, "300 tokens"], [5, 500, 1_500_000, "500 tokens"], [10, 1000, 3_000_000, "1000 tokens"]]);
    expect(tokenPackCatalogue("SEASON").packs[0]).toMatchObject({ blocks: 1, price_ngn_minor: 125_000, label: "100 tokens" });
    expect(tokenPackCatalogue("OLD_PLAN").rate_plan).toBe("FREE");
    expect(tokenPackCatalogue("ENTERPRISE").packs).toEqual([]);
    // upload limit per video in bytes; Enterprise has no plan limit; unknown is the Free limit
    expect(planUploadLimitBytes("CLUB")).toBe(24 * 1024 ** 3);
    expect(planUploadLimitBytes("ENTERPRISE")).toBeNull();
    expect(planUploadLimitBytes(null)).toBe(2 * 1024 ** 3);
  });
});

describe("token wallet balance", () => {
  it("derives the balance from the ledger, never from a stored number", () => {
    const entries = [
      entry({ kind: "FREE_GRANT", amount: 100, balance_after: 100 }),
      entry({ kind: "PURCHASE", amount: 100, balance_after: 200 }),
      entry({ kind: "SPEND", amount: -90, balance_after: 110, job_type: "ANALYSIS", job_id: "33333333-3333-4333-8333-333333333333" }),
    ];
    expect(balanceOf(entries)).toBe(110);
    expect(deriveWalletBalance(ORG, entries, "2026-11-11T00:00:00.000Z")).toMatchObject({
      balance: 110, spendable_balance: 110, expired_unwritten_off: 0, low_balance: false,
    });
  });

  it("spends debits from the credit that expires soonest first", () => {
    const entries = [
      entry({ kind: "FREE_GRANT", amount: 100, balance_after: 100, expires_at: "2026-12-01T00:00:00.000Z", created_at: "2026-11-01T00:00:00.000Z" }),
      entry({ kind: "PURCHASE", amount: 100, balance_after: 200, expires_at: "2027-11-01T00:00:00.000Z", created_at: "2026-11-02T00:00:00.000Z" }),
      entry({ kind: "SPEND", amount: -30, balance_after: 170, job_type: "ANALYSIS", job_id: "33333333-3333-4333-8333-333333333333" }),
    ];
    // the 30-token spend eats 30 of the 100 free tokens first: 170 spendable, none expired
    expect(spendableBalance(entries, "2026-11-11T00:00:00.000Z")).toEqual({ spendable: 170, expiredUnwrittenOff: 0 });
    // after the free grant's expiry, the 70 unspent free tokens are expired; the purchase credit is still spendable
    expect(spendableBalance(entries, "2026-12-02T00:00:00.000Z")).toEqual({ spendable: 100, expiredUnwrittenOff: 70 });
  });

  it("counts unspent expired credits as expired, not spendable", () => {
    const entries = [
      entry({ kind: "FREE_GRANT", amount: 100, balance_after: 100, expires_at: "2026-12-01T00:00:00.000Z", created_at: "2026-11-01T00:00:00.000Z" }),
      entry({ kind: "SPEND", amount: -10, balance_after: 90, job_type: "REEL_RENDER", job_id: "33333333-3333-4333-8333-333333333333" }),
    ];
    expect(spendableBalance(entries, "2026-12-02T00:00:00.000Z")).toEqual({ spendable: 0, expiredUnwrittenOff: 90 });
    expect(expiredCreditTokens(entries, "2026-12-02T00:00:00.000Z")).toBe(90);
    expect(deriveWalletBalance(ORG, entries, "2026-12-02T00:00:00.000Z")).toMatchObject({
      balance: 90, spendable_balance: 0, expired_unwritten_off: 90, low_balance: true,
    });
  });
});

describe("token wallet charging", () => {
  it("refuses a charge the spendable balance cannot cover, and allows one it can", () => {
    const entries = [entry({ kind: "FREE_GRANT", amount: 100, balance_after: 100 })];
    expect(chargeRefusal(entries, 150, "2026-11-11T00:00:00.000Z")).toMatch(/needs 150 tokens but the wallet has 100/);
    expect(chargeRefusal(entries, 100, "2026-11-11T00:00:00.000Z")).toBeNull();
    expect(chargeRefusal(entries, 0)).toMatch(/above zero/);
  });

  it("never charges against tokens that have already expired", () => {
    const entries = [entry({ kind: "FREE_GRANT", amount: 100, balance_after: 100, expires_at: "2026-12-01T00:00:00.000Z" })];
    expect(chargeRefusal(entries, 10, "2026-12-02T00:00:00.000Z")).toMatch(/has 0 tokens that can be spent/);
  });
});
