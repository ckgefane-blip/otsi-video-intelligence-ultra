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
  tokenPack,
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

  it("publishes the four approved packs with Naira prices first", () => {
    const cat = tokenPackCatalogue();
    expect(cat.packs).toHaveLength(4);
    expect(cat.free_grant_tokens).toBe(100);
    expect(FREE_GRANT_TOKENS).toBe(100);
    expect(LOW_BALANCE_THRESHOLD).toBe(90);
    expect(tokenPack("STARTER")).toMatchObject({ tokens: 100, price_ngn_minor: 1_500_000, price_usd_minor: 4900 });
    expect(tokenPack("CLUB")).toMatchObject({ tokens: 500, price_ngn_minor: 6_000_000, price_usd_minor: 19900 });
    expect(tokenPack("ACADEMY")).toMatchObject({ tokens: 1200, price_ngn_minor: 12_000_000, price_usd_minor: 39900 });
    expect(tokenPack("SEASON")).toMatchObject({ tokens: 3000, price_ngn_minor: 25_000_000, price_usd_minor: 89900 });
  });
});

describe("token wallet balance", () => {
  it("derives the balance from the ledger, never from a stored number", () => {
    const entries = [
      entry({ kind: "FREE_GRANT", amount: 25, balance_after: 25 }),
      entry({ kind: "PURCHASE", amount: 100, balance_after: 125 }),
      entry({ kind: "SPEND", amount: -90, balance_after: 35, job_type: "ANALYSIS", job_id: "33333333-3333-4333-8333-333333333333" }),
    ];
    expect(balanceOf(entries)).toBe(35);
    expect(deriveWalletBalance(ORG, entries, "2026-11-11T00:00:00.000Z")).toMatchObject({
      balance: 35, spendable_balance: 35, expired_unwritten_off: 0, low_balance: true,
    });
  });

  it("spends debits from the credit that expires soonest first", () => {
    const entries = [
      entry({ kind: "FREE_GRANT", amount: 25, balance_after: 25, expires_at: "2026-12-01T00:00:00.000Z", created_at: "2026-11-01T00:00:00.000Z" }),
      entry({ kind: "PURCHASE", amount: 100, balance_after: 125, expires_at: "2027-11-01T00:00:00.000Z", created_at: "2026-11-02T00:00:00.000Z" }),
      entry({ kind: "SPEND", amount: -30, balance_after: 95, job_type: "ANALYSIS", job_id: "33333333-3333-4333-8333-333333333333" }),
    ];
    // the 30-token spend eats the 25 free tokens first, then 5 of the purchase: 95 spendable, none expired
    expect(spendableBalance(entries, "2026-11-11T00:00:00.000Z")).toEqual({ spendable: 95, expiredUnwrittenOff: 0 });
    // after the free grant's expiry, with no further spend, the remaining purchase credit is still spendable
    expect(spendableBalance(entries, "2026-12-02T00:00:00.000Z")).toEqual({ spendable: 95, expiredUnwrittenOff: 0 });
  });

  it("counts unspent expired credits as expired, not spendable", () => {
    const entries = [
      entry({ kind: "FREE_GRANT", amount: 25, balance_after: 25, expires_at: "2026-12-01T00:00:00.000Z", created_at: "2026-11-01T00:00:00.000Z" }),
      entry({ kind: "SPEND", amount: -10, balance_after: 15, job_type: "REEL_RENDER", job_id: "33333333-3333-4333-8333-333333333333" }),
    ];
    expect(spendableBalance(entries, "2026-12-02T00:00:00.000Z")).toEqual({ spendable: 0, expiredUnwrittenOff: 15 });
    expect(expiredCreditTokens(entries, "2026-12-02T00:00:00.000Z")).toBe(15);
    expect(deriveWalletBalance(ORG, entries, "2026-12-02T00:00:00.000Z")).toMatchObject({
      balance: 15, spendable_balance: 0, expired_unwritten_off: 15, low_balance: true,
    });
  });
});

describe("token wallet charging", () => {
  it("refuses a charge the spendable balance cannot cover, and allows one it can", () => {
    const entries = [entry({ kind: "FREE_GRANT", amount: 25, balance_after: 25 })];
    expect(chargeRefusal(entries, 90, "2026-11-11T00:00:00.000Z")).toMatch(/needs 90 tokens but the wallet has 25/);
    expect(chargeRefusal(entries, 25, "2026-11-11T00:00:00.000Z")).toBeNull();
    expect(chargeRefusal(entries, 0)).toMatch(/above zero/);
  });

  it("never charges against tokens that have already expired", () => {
    const entries = [entry({ kind: "FREE_GRANT", amount: 25, balance_after: 25, expires_at: "2026-12-01T00:00:00.000Z" })];
    expect(chargeRefusal(entries, 10, "2026-12-02T00:00:00.000Z")).toMatch(/has 0 tokens that can be spent/);
  });
});
