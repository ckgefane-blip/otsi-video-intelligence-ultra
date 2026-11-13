import { z } from "zod";
import { PLAN_CATALOGUE, TOPUP_BLOCK_TOKENS, planEntryOrNull } from "./bank-transfer";

/**
 * Token Wallet & Credit System (ADR-140, ultra-only; scope: token-wallet-scope.md).
 * 1 token = 1 minute of footage analysed. Reel render, player report and export pack cost 10 tokens each.
 * The wallet belongs to the organization; the balance is always DERIVED from the ledger, never stored.
 * This file holds the contracts AND the pure ledger math (no database, no I/O), so the same functions are used
 * by the API and by the unit tests that run without MySQL.
 */

/** A ledger row's kind. SPEND and EXPIRY are always negative, PURCHASE / FREE_GRANT / REFUND always positive. */
export const WalletLedgerKind = z.enum(["PURCHASE", "FREE_GRANT", "SPEND", "REFUND", "ADJUSTMENT", "EXPIRY"]);
export type WalletLedgerKind = z.infer<typeof WalletLedgerKind>;

/** What a SPEND paid for. The job_id is the run / render / report / bundle / assessment id the spend references. */
export const WalletJobType = z.enum(["ANALYSIS", "REEL_RENDER", "PLAYER_REPORT", "EXPORT_PACK", "AI_ANALYSIS"]);
export type WalletJobType = z.infer<typeof WalletJobType>;

/** One immutable ledger row. `amount` is signed: credits positive, debits negative. */
export const WalletLedgerEntry = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  kind: WalletLedgerKind,
  amount: z.number().int().refine((n) => n !== 0, "a ledger row is never zero"),
  balance_after: z.number().int().min(0, "balances are never negative"),
  job_type: WalletJobType.nullable(),
  job_id: z.string().uuid().nullable(),
  idempotency_key: z.string().min(1),
  invoice_ref: z.string().nullable(),
  reason: z.string().nullable(),
  actor_id: z.string().uuid().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});
export type WalletLedgerEntry = z.infer<typeof WalletLedgerEntry>;

/** The derived balance of one organization's wallet. */
export const WalletBalance = z.object({
  organization_id: z.string().uuid(),
  /** Sum of every ledger row: the balance. Never negative by construction (see charge rules). */
  balance: z.number().int().min(0),
  /** Credits not yet expired, after debits are spent oldest-expiry-first: what can actually be spent now. */
  spendable_balance: z.number().int().min(0),
  /** Tokens sitting in credits whose expiry has passed and have not yet been written off as EXPIRY rows. */
  expired_unwritten_off: z.number().int().min(0),
  /** Scope §7: warn when the organization falls below the cost of one full match (90 tokens). */
  low_balance: z.boolean(),
});
export type WalletBalance = z.infer<typeof WalletBalance>;

export const WalletLedgerPage = z.object({
  balance: WalletBalance,
  entries: z.array(WalletLedgerEntry),
});
export type WalletLedgerPage = z.infer<typeof WalletLedgerPage>;

/**
 * Top-ups (owner, APPROVED 2026-11-13): tokens are bought in blocks of 100 at the customer's OWN plan per-token price — Free
 * (the "Player pack") ₦3,000, Starter ₦2,500, Club ₦2,000, Academy ₦1,500, Season ₦1,250 a block; Enterprise as agreed with
 * OTSI, so it has no self-serve top-up. The rates live on the plan catalogue (bank-transfer.ts) so there is one price list.
 * `pack_code` on a request is the plan whose rate priced it.
 */
export const TokenPackCode = z.enum(["FREE", "STARTER", "CLUB", "ACADEMY", "SEASON"]);
export type TokenPackCode = z.infer<typeof TokenPackCode>;

/** The sizes offered on the Wallet page, in blocks of 100 tokens; a request may ask for any whole number up to the maximum. */
export const TOPUP_BLOCK_CHOICES = [1, 3, 5, 10] as const;
export const TOPUP_MAX_BLOCKS = 100;

/** 100 free tokens, once, claimed with the "Claim free grant" button (never automatic), expiring 30 days after
 *  signup. Owner decision 2026-11-14 ~02:33 (back to 100; 25 cannot show a full match + reel, so the free
 *  tier never showed the product). 100 = one full 90-minute match (~90) plus its reel (10).
 *  Defined here, before the catalogue schema, so the schema's literal is the constant itself and the two
 *  cannot drift apart (a literal 25 in the schema broke the packs endpoint when the grant went to 100). */
export const FREE_GRANT_TOKENS = 100;
export const FREE_GRANT_EXPIRY_DAYS = 30;

export const TokenPack = z.object({
  blocks: z.number().int().positive(),
  tokens: z.number().int().positive(),
  /** Price in minor units: kobo for NGN, cents for USD. Naira prices are the real prices. */
  price_ngn_minor: z.number().int().positive(),
  price_usd_minor: z.number().int().positive(),
  label: z.string(),
});
export type TokenPack = z.infer<typeof TokenPack>;

export const TokenPackCatalogue = z.object({
  /** The plan whose rate prices this organisation's top-ups; ENTERPRISE has none (agreed with OTSI). */
  rate_plan: z.enum(["FREE", "STARTER", "CLUB", "ACADEMY", "SEASON", "ENTERPRISE"]),
  rate_plan_label: z.string(),
  block_tokens: z.literal(TOPUP_BLOCK_TOKENS),
  block_price_ngn_minor: z.number().int().positive().nullable(),
  block_price_usd_minor: z.number().int().positive().nullable(),
  max_blocks: z.literal(TOPUP_MAX_BLOCKS),
  /** The offered sizes; empty for Enterprise. */
  packs: z.array(TokenPack),
  free_grant_tokens: z.literal(FREE_GRANT_TOKENS),
  free_grant_expiry_days: z.literal(30),
  pack_expiry_months: z.literal(12),
  costs: z.object({
    analysis_per_minute: z.literal(1),
    reel_render: z.literal(10),
    player_report: z.literal(10),
    export_pack: z.literal(10),
    /** ADR-141: one AI Analyst assessment costs 10 tokens, the same as a player report (scope §8). */
    ai_analysis: z.literal(10),
  }),
  low_balance_threshold: z.literal(90),
});
export type TokenPackCatalogue = z.infer<typeof TokenPackCatalogue>;

/** The plan whose top-up rate applies: the organisation's own plan; no plan, or a plan this catalogue does not know, is Free. */
export function topUpRatePlan(planCode: string | null | undefined): TokenPackCatalogue["rate_plan"] {
  const entry = planEntryOrNull(planCode);
  return entry ? entry.code : "FREE";
}

/** The price of `blocks` top-up blocks on a plan, or null for Enterprise (agreed with OTSI). */
export function topUpPrice(ratePlan: TokenPackCatalogue["rate_plan"], blocks: number): { tokens: number; ngn_minor: number; usd_minor: number } | null {
  const entry = PLAN_CATALOGUE.find((p) => p.code === ratePlan)!;
  if (entry.topup_block_ngn_minor === null || entry.topup_block_usd_minor === null) return null;
  return { tokens: blocks * TOPUP_BLOCK_TOKENS, ngn_minor: blocks * entry.topup_block_ngn_minor, usd_minor: blocks * entry.topup_block_usd_minor };
}

export function tokenPackCatalogue(planCode: string | null | undefined = null): TokenPackCatalogue {
  const ratePlan = topUpRatePlan(planCode);
  const entry = PLAN_CATALOGUE.find((p) => p.code === ratePlan)!;
  const packs = TOPUP_BLOCK_CHOICES.flatMap((blocks) => {
    const price = topUpPrice(ratePlan, blocks);
    return price ? [{ blocks, tokens: price.tokens, price_ngn_minor: price.ngn_minor, price_usd_minor: price.usd_minor,
      label: ratePlan === "FREE" && blocks === 1 ? "Player pack" : `${price.tokens} tokens` }] : [];
  });
  return TokenPackCatalogue.parse({
    rate_plan: ratePlan, rate_plan_label: entry.label, block_tokens: TOPUP_BLOCK_TOKENS,
    block_price_ngn_minor: entry.topup_block_ngn_minor, block_price_usd_minor: entry.topup_block_usd_minor,
    max_blocks: TOPUP_MAX_BLOCKS, packs,
    free_grant_tokens: FREE_GRANT_TOKENS,
    free_grant_expiry_days: 30,
    pack_expiry_months: 12,
    costs: { analysis_per_minute: 1, reel_render: 10, player_report: 10, export_pack: 10, ai_analysis: 10 },
    low_balance_threshold: 90,
  });
}

/** Costs (scope §2). Analysis is 1 token per started minute of footage. */
export const TOKEN_COSTS = { analysisPerMinute: 1, reelRender: 10, playerReport: 10, exportPack: 10, aiAnalysis: 10 } as const;
/** Scope §7: low-balance warning below the cost of one full match. */
export const LOW_BALANCE_THRESHOLD = 90;
/** Scope §3: paid tokens expire 12 months after purchase. */
export const PACK_EXPIRY_MONTHS = 12;

/** Analysis cost for a video: 1 token per started minute. A video with no measured duration cannot be
 *  priced — the caller must refuse it rather than charge a guessed number (returns null). */
export function analysisCostTokens(durationUs: number | null | undefined): number | null {
  if (durationUs === null || durationUs === undefined || !Number.isFinite(durationUs) || durationUs <= 0) return null;
  return Math.ceil(durationUs / 60_000_000) * TOKEN_COSTS.analysisPerMinute;
}

/** The balance is the sum of every ledger row. No row is ever trusted on its own. */
export function balanceOf(entries: Pick<WalletLedgerEntry, "amount">[]): number {
  return entries.reduce((sum, e) => sum + e.amount, 0);
}

/**
 * Spendable balance and expired-but-not-yet-written-off tokens, by FIFO on expiry: debits are spent from the
 * credit that expires soonest first (a credit with no expiry is spent last), so a token is only "expired" when
 * it is still unspent after its expiry has passed. `now` is an ISO string; entries carry ISO `expires_at`.
 */
export function spendableBalance(
  entries: Pick<WalletLedgerEntry, "amount" | "expires_at" | "created_at">[],
  nowIso: string,
): { spendable: number; expiredUnwrittenOff: number } {
  const now = Date.parse(nowIso);
  const credits = entries
    .filter((e) => e.amount > 0)
    .map((e) => ({ amount: e.amount, expiresAt: e.expires_at ? Date.parse(e.expires_at) : Number.POSITIVE_INFINITY, createdAt: e.created_at }))
    .sort((a, b) => a.expiresAt - b.expiresAt || (a.createdAt < b.createdAt ? -1 : 1));
  let toSpend = -entries.filter((e) => e.amount < 0).reduce((sum, e) => sum + e.amount, 0);
  for (const c of credits) {
    const used = Math.min(c.amount, toSpend);
    c.amount -= used;
    toSpend -= used;
    if (toSpend <= 0) break;
  }
  let spendable = 0;
  let expiredUnwrittenOff = 0;
  for (const c of credits) {
    if (c.amount <= 0) continue;
    if (c.expiresAt <= now) expiredUnwrittenOff += c.amount;
    else spendable += c.amount;
  }
  return { spendable, expiredUnwrittenOff };
}

/** The full derived balance for an organization at `now`. */
export function deriveWalletBalance(
  organizationId: string,
  entries: WalletLedgerEntry[],
  nowIso: string = new Date().toISOString(),
): WalletBalance {
  const balance = balanceOf(entries);
  const { spendable, expiredUnwrittenOff } = spendableBalance(entries, nowIso);
  return WalletBalance.parse({
    organization_id: organizationId,
    balance,
    spendable_balance: spendable,
    expired_unwritten_off: expiredUnwrittenOff,
    low_balance: spendable < LOW_BALANCE_THRESHOLD,
  });
}

/**
 * Can `amount` tokens be charged now? Returns the plain refusal message, or null when the charge may go ahead.
 * A charge is refused when the spendable balance (expired credits excluded) does not cover it — never by
 * letting the balance go negative, and never by charging against tokens that have already expired.
 */
export function chargeRefusal(entries: WalletLedgerEntry[], amount: number, nowIso: string = new Date().toISOString()): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return "The charge must be a whole number of tokens above zero.";
  const { spendable } = spendableBalance(entries, nowIso);
  if (spendable < amount) {
    return `This needs ${amount} tokens but the wallet has ${spendable} tokens that can be spent. Buy tokens to continue — nothing has been charged.`;
  }
  return null;
}

/** Tokens from credits that have expired and are still unspent: the amount an EXPIRY row must write off. */
export function expiredCreditTokens(entries: WalletLedgerEntry[], nowIso: string = new Date().toISOString()): number {
  return spendableBalance(entries, nowIso).expiredUnwrittenOff;
}

export const RequestPackRequest = z.object({
  /** How many blocks of 100 tokens; the price is the organisation's own plan rate, set by the server, never by the caller. */
  blocks: z.number().int().min(1).max(TOPUP_MAX_BLOCKS),
  /** NGN for the Nigerian market, USD for the international tier. */
  currency: z.enum(["NGN", "USD"]),
});
export type RequestPackRequest = z.infer<typeof RequestPackRequest>;

export const PackRequestStatus = z.enum(["REQUESTED", "INVOICED", "PAID", "CANCELLED"]);
export type PackRequestStatus = z.infer<typeof PackRequestStatus>;

export const PackRequest = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  /** The requesting organisation's name, for the company org's Admin › Billing view (ADR-140 §8):
   *  the company org sees every customer's request with the customer's name on it. Null on
   *  customer reads, where the name is the caller's own and not needed. */
  organization_name: z.string().nullable(),
  pack_code: TokenPackCode,
  currency: z.enum(["NGN", "USD"]),
  amount_minor: z.number().int().positive(),
  tokens: z.number().int().positive(),
  status: PackRequestStatus,
  invoice_ref: z.string().nullable(),
  requested_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type PackRequest = z.infer<typeof PackRequest>;

/**
 * What the requester needs to pay for a pack: the request itself plus the owner's bank details for the
 * request's currency — but only once the owner has issued the invoice (INVOICED or PAID). While the
 * request is still REQUESTED, bank_account is null: paying before the invoice exists would leave the
 * payment unmatched. The invoice reference is the owner's, as issued; the pay-reference note is the
 * same wording as on a plan order's pro-forma invoice.
 */
export const PackRequestPayment = z.object({
  request: PackRequest,
  bank_account: z.object({
    account_name: z.string(),
    bank_name: z.string(),
    account_number: z.string(),
    swift_iban: z.string().nullable(),
    currency: z.enum(["NGN", "USD"]),
  }).nullable(),
  pay_reference_note: z.string(),
});
export type PackRequestPayment = z.infer<typeof PackRequestPayment>;

export const IssueInvoiceRequest = z.object({ invoice_ref: z.string().trim().min(1).max(255) });
export type IssueInvoiceRequest = z.infer<typeof IssueInvoiceRequest>;

export const ConfirmReceiptRequest = z.object({ invoice_ref: z.string().trim().min(1).max(255) });
export type ConfirmReceiptRequest = z.infer<typeof ConfirmReceiptRequest>;

/** Admin top-up / refund / adjustment. Every one needs a reason, recorded in the ledger (scope §8). */
export const AdminWalletCreditRequest = z.object({
  amount: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
  invoice_ref: z.string().trim().min(1).max(255).nullable().default(null),
});
export type AdminWalletCreditRequest = z.infer<typeof AdminWalletCreditRequest>;

export const AdminWalletAdjustmentRequest = z.object({
  amount: z.number().int().refine((n) => n !== 0, "an adjustment is never zero"),
  reason: z.string().trim().min(1).max(500),
});
export type AdminWalletAdjustmentRequest = z.infer<typeof AdminWalletAdjustmentRequest>;

export const AdminWalletRow = z.object({
  organization_id: z.string().uuid(),
  organization_name: z.string(),
  balance: z.number().int().min(0),
  spendable_balance: z.number().int().min(0),
  low_balance: z.boolean(),
  last_activity_at: z.string().nullable(),
});
export type AdminWalletRow = z.infer<typeof AdminWalletRow>;

export const FreeGrant = z.object({
  organization_id: z.string().uuid(),
  granted_tokens: z.literal(FREE_GRANT_TOKENS),
  email: z.string(),
  granted_by: z.string().uuid(),
  granted_at: z.string(),
  expires_at: z.string(),
});
export type FreeGrant = z.infer<typeof FreeGrant>;
