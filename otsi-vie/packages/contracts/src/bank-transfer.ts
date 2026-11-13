import { z } from "zod";

/**
 * Bank-transfer billing for plans (ADR-144 §1.7, ultra-only; plan step 7 of ULTRA_DISTRIBUTION_PLAN.md §5a).
 * Bank transfer is the MAIN payment method. There is no payment gateway code anywhere in this build; online
 * card payment stays a disabled "Coming soon" button in the UI (plan §5b) and is not built here.
 *
 * This file holds the contracts AND the pure plan catalogue math (no database, no I/O), so the API and the
 * tests use the same prices. It builds on the token wallet (ADR-140): confirming a bank-transfer order credits
 * the wallet with a PURCHASE row (invoice reference = the order reference) via WalletService.credit, and the
 * subscription + entitlement grants use the existing `subscriptions` / `entitlement_grants` tables.
 */

/** Currencies: NGN for local payers, USD for foreign payers. The owner sets one bank account per currency. */
export const BankTransferCurrency = z.enum(["NGN", "USD"]);
export type BankTransferCurrency = z.infer<typeof BankTransferCurrency>;

/** Billable plans. FREE is the drop-to tier after expiry + grace, never something an order can buy. */
export const BillablePlanCode = z.enum(["STARTER", "CLUB", "ACADEMY", "SEASON"]);
export type BillablePlanCode = z.infer<typeof BillablePlanCode>;
export const PlanCode = z.enum(["FREE", "STARTER", "CLUB", "ACADEMY", "SEASON", "ENTERPRISE"]);
export type PlanCode = z.infer<typeof PlanCode>;

export const BankTransferOrderStatus = z.enum(["ORDERED", "AWAITING_CONFIRMATION", "CONFIRMED", "REJECTED", "PARTIAL", "REFUNDED"]);
export type BankTransferOrderStatus = z.infer<typeof BankTransferOrderStatus>;

/**
 * The plan catalogue: the owner's APPROVED grassroots price list (2026-11-13, docs/billing-blueprint.md §5). The market is young
 * grassroots players and local clubs first; analysis runs on the customer's own laptop, so the price follows what they can pay,
 * not compute. Naira is the real price; dollars are derived at the approved rate of ₦1,500 = $1, rounded to the cent (the
 * rounding of dollar prices is still an open owner decision). A 12-month period costs 10 monthly payments (2 months free).
 *
 * Each plan also carries the two other approved numbers that depend on it:
 *  - the upload limit per video (Free 2 GB, Starter 8, Club 24, Academy 48, Season 64 GB, Enterprise no plan limit), and
 *  - the top-up rate: a top-up is sold in blocks of 100 tokens at the customer's OWN plan per-token price
 *    (Free / Player ₦30, Starter ₦25, Club ₦20, Academy ₦15, Season ₦12.50 a token; Enterprise as agreed).
 * Enterprise is "Contact us": from ₦250,000 a month, tokens agreed per customer, never ordered from this page.
 * A full 90-minute match costs 90 tokens and a reel 10, so the one-line "covers" below is plain arithmetic, not a promise.
 */
export const PlanCatalogueEntry = z.object({
  code: PlanCode,
  label: z.string(),
  /** Tokens credited to the wallet on confirmation, per month of the period (0 for Free and for Enterprise, which agrees its own). */
  tokens_per_month: z.number().int().min(0),
  /** Monthly price in minor units: kobo for NGN, cents for USD. For Enterprise this is the "from" price. */
  price_ngn_minor: z.number().int().min(0),
  price_usd_minor: z.number().int().min(0),
  /** What the plan is for, in one line for the plan page. */
  covers: z.string(),
  /** Largest video this plan may upload, in GB; null = no plan limit (only the server's own maximum applies). */
  upload_gb_per_video: z.number().positive().nullable(),
  /** Price of one top-up block of TOPUP_BLOCK_TOKENS tokens on this plan; null = agreed with OTSI (Enterprise). */
  topup_block_ngn_minor: z.number().int().positive().nullable(),
  topup_block_usd_minor: z.number().int().positive().nullable(),
  /** true = ordered by bank transfer from the plan page; false = Free (claimed) or Enterprise (contact us). */
  orderable: z.boolean(),
});
export type PlanCatalogueEntry = z.infer<typeof PlanCatalogueEntry>;

/** Tokens in one top-up block (owner 2026-11-13: top-ups are sold in blocks of 100 only). */
export const TOPUP_BLOCK_TOKENS = 100;

export const PLAN_CATALOGUE: PlanCatalogueEntry[] = [
  { code: "FREE", label: "Free", tokens_per_month: 0, price_ngn_minor: 0, price_usd_minor: 0,
    covers: "100 free tokens once, to try a full match and a reel. Top up 100 tokens at a time (the Player pack).",
    upload_gb_per_video: 2, topup_block_ngn_minor: 300_000, topup_block_usd_minor: 200, orderable: false },
  { code: "STARTER", label: "Starter", tokens_per_month: 300, price_ngn_minor: 750_000, price_usd_minor: 500,
    covers: "About 3 full matches a month, with a reel for each.",
    upload_gb_per_video: 8, topup_block_ngn_minor: 250_000, topup_block_usd_minor: 167, orderable: true },
  { code: "CLUB", label: "Club", tokens_per_month: 1000, price_ngn_minor: 2_000_000, price_usd_minor: 1333,
    covers: "About 10 full matches a month, with a reel for each.",
    upload_gb_per_video: 24, topup_block_ngn_minor: 200_000, topup_block_usd_minor: 133, orderable: true },
  { code: "ACADEMY", label: "Academy", tokens_per_month: 3000, price_ngn_minor: 4_500_000, price_usd_minor: 3000,
    covers: "About 30 full matches a month, with a reel for each.",
    upload_gb_per_video: 48, topup_block_ngn_minor: 150_000, topup_block_usd_minor: 100, orderable: true },
  { code: "SEASON", label: "Season", tokens_per_month: 6000, price_ngn_minor: 7_500_000, price_usd_minor: 5000,
    covers: "About 60 full matches a month, with a reel for each — a full season for a club.",
    upload_gb_per_video: 64, topup_block_ngn_minor: 125_000, topup_block_usd_minor: 83, orderable: true },
  { code: "ENTERPRISE", label: "Enterprise", tokens_per_month: 0, price_ngn_minor: 25_000_000, price_usd_minor: 16667,
    covers: "For federations, leagues and professional clubs. Tokens agreed per customer, no plan limit on upload.",
    upload_gb_per_video: null, topup_block_ngn_minor: null, topup_block_usd_minor: null, orderable: false },
];

export function planCatalogueEntry(code: PlanCode): PlanCatalogueEntry {
  const entry = PLAN_CATALOGUE.find((p) => p.code === code);
  if (!entry) throw new Error(`Unknown plan: ${code}`);
  return entry;
}

/** Periods an order can buy: 1 month, or 12 months at 10 monthly payments. */
export const PlanPeriodMonths = z.union([z.literal(1), z.literal(12)]);
export type PlanPeriodMonths = z.infer<typeof PlanPeriodMonths>;

/** Price of a plan for a period, in minor units. 12 months = 10 monthly payments (2 months free). */
export function planPriceMinor(code: BillablePlanCode, periodMonths: 1 | 12, currency: BankTransferCurrency): number {
  const entry = planCatalogueEntry(code);
  const monthly = currency === "NGN" ? entry.price_ngn_minor : entry.price_usd_minor;
  return periodMonths === 12 ? monthly * 10 : monthly;
}

/** Tokens credited to the wallet when an order for this plan + period is confirmed. */
export function planTokens(code: BillablePlanCode, periodMonths: 1 | 12): number {
  return planCatalogueEntry(code).tokens_per_month * periodMonths;
}

/** An order is payable for this long after it is created; after that the invoice has expired. */
export const ORDER_EXPIRY_DAYS = 14;
/** A renewal order is created this many days before a subscription expires. */
export const RENEWAL_WINDOW_DAYS = 7;
/** After expiry, the subscription stays PAST_DUE for this long, then drops to the free tier. */
export const RENEWAL_GRACE_DAYS = 14;
/** A transfer receipt (PDF or image) may be this large. */
export const PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const PROOF_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type ProofContentType = (typeof PROOF_CONTENT_TYPES)[number];

/** Reference format: OTSI-INV-<year>-<zero-padded per-year sequence>, never reused. */
export const BANK_TRANSFER_REFERENCE = /^OTSI-INV-\d{4}-\d{6}$/;
export function formatBankTransferReference(year: number, sequence: number): string {
  return `OTSI-INV-${year}-${String(sequence).padStart(6, "0")}`;
}

/** One bank account: the owner's pay-to details for one currency. Never hard-coded, never in the repo. */
export const BankAccount = z.object({
  id: z.string().uuid(),
  currency: BankTransferCurrency,
  account_name: z.string(),
  bank_name: z.string(),
  account_number: z.string(),
  swift_iban: z.string().nullable(),
  is_active: z.boolean(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type BankAccount = z.infer<typeof BankAccount>;

/** One plan order, as the API returns it. Bank details are NOT on it — they travel only on the invoice
 *  payload that belongs to the order (see ProFormaInvoice), never on the list. */
export const BankTransferOrder = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  /** The paying organisation's name, for the company org's Admin › Billing view (ADR-140 §8): the
   *  company org sees every customer's order with the customer's name on it; a customer sees only
   *  their own. Null on customer reads, where the name is the caller's own and not needed. */
  organization_name: z.string().nullable(),
  plan_code: BillablePlanCode,
  period_months: PlanPeriodMonths,
  amount_minor: z.number().int().positive(),
  currency: BankTransferCurrency,
  reference: z.string().regex(BANK_TRANSFER_REFERENCE),
  bank_account_id: z.string().uuid(),
  status: BankTransferOrderStatus,
  amount_received_minor: z.number().int().min(0),
  amount_refunded_minor: z.number().int().min(0).nullable(),
  tokens_granted: z.number().int().positive(),
  subscription_id: z.string().uuid().nullable(),
  renews_subscription_id: z.string().uuid().nullable(),
  expires_at: z.string(),
  proof_filename: z.string().nullable(),
  proof_content_type: z.string().nullable(),
  proof_size_bytes: z.number().int().positive().nullable(),
  proof_sha256: z.string().nullable(),
  proof_uploaded_at: z.string().nullable(),
  proof_note: z.string().nullable(),
  confirmed_by: z.string().uuid().nullable(),
  confirmed_at: z.string().nullable(),
  bank_reference: z.string().nullable(),
  reject_reason: z.string().nullable(),
  refund_reason: z.string().nullable(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type BankTransferOrder = z.infer<typeof BankTransferOrder>;

/** The pro-forma invoice for one order: the owner's bank details for the order's currency, the amount, and
 *  the reference the payer must put in the transfer description. This is the only place a non-admin caller
 *  ever sees bank details — and only for their own order. */
export const ProFormaInvoice = z.object({
  reference: z.string().regex(BANK_TRANSFER_REFERENCE),
  plan_code: BillablePlanCode,
  period_months: PlanPeriodMonths,
  amount_minor: z.number().int().positive(),
  currency: BankTransferCurrency,
  expires_at: z.string(),
  pay_reference_note: z.string(),
  bank_account: z.object({
    account_name: z.string(),
    bank_name: z.string(),
    account_number: z.string(),
    swift_iban: z.string().nullable(),
    currency: BankTransferCurrency,
  }),
});
export type ProFormaInvoice = z.infer<typeof ProFormaInvoice>;

export const PAY_REFERENCE_NOTE = "Put this reference in your transfer description, so the payment can be matched to your order.";

export const OrderWithInvoice = z.object({ order: BankTransferOrder, invoice: ProFormaInvoice });
export type OrderWithInvoice = z.infer<typeof OrderWithInvoice>;

/** The organization's current subscription, if it has one that is still live (ACTIVE or inside the grace
 *  period as PAST_DUE). Null when there is none — a fresh organization, or one that dropped to free. */
export const SubscriptionStatus = z.object({
  id: z.string().uuid(),
  plan_code: PlanCode,
  period_start: z.string(),
  period_end: z.string().nullable(),
  state: z.enum(["ACTIVE", "PAST_DUE", "CANCELED"]),
});
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const PlanCatalogue = z.object({
  plans: z.array(PlanCatalogueEntry),
  periods_months: z.array(z.union([z.literal(1), z.literal(12)])),
  order_expiry_days: z.literal(ORDER_EXPIRY_DAYS),
  renewal_window_days: z.literal(RENEWAL_WINDOW_DAYS),
  renewal_grace_days: z.literal(RENEWAL_GRACE_DAYS),
  currencies: z.array(BankTransferCurrency),
  /** Online card payment is "Coming soon": visible, disabled, never charging (plan §5b). */
  online_payment: z.literal("coming_soon"),
});
export type PlanCatalogue = z.infer<typeof PlanCatalogue>;

export function planCatalogue(): PlanCatalogue {
  return PlanCatalogue.parse({
    plans: PLAN_CATALOGUE,
    periods_months: [1, 12],
    order_expiry_days: ORDER_EXPIRY_DAYS,
    renewal_window_days: RENEWAL_WINDOW_DAYS,
    renewal_grace_days: RENEWAL_GRACE_DAYS,
    currencies: ["NGN", "USD"],
    online_payment: "coming_soon",
  });
}

export const CreateOrderRequest = z.object({
  plan_code: BillablePlanCode,
  period_months: PlanPeriodMonths,
  currency: BankTransferCurrency,
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequest>;

/** Marking "I have paid" with no receipt file. The note is optional and is shown to the admin. */
export const MarkPaidRequest = z.object({ note: z.string().trim().max(500).optional() });
export type MarkPaidRequest = z.infer<typeof MarkPaidRequest>;

export const ConfirmOrderRequest = z.object({
  /** Amount received in this confirmation, in minor units. With any earlier partial payments it must add up
   *  to exactly the order amount — otherwise record the rest as a partial payment first. */
  amount_received_minor: z.number().int().positive(),
  bank_reference: z.string().trim().min(1).max(255),
  /** The date the money arrived, as the admin read it off the bank statement. Defaults to now. */
  confirmed_at: z.string().datetime({ offset: true }).optional(),
});
export type ConfirmOrderRequest = z.infer<typeof ConfirmOrderRequest>;

export const RejectOrderRequest = z.object({ reason: z.string().trim().min(1).max(500) });
export type RejectOrderRequest = z.infer<typeof RejectOrderRequest>;

export const RecordPartialRequest = z.object({
  /** Amount received in this part-payment, in minor units. Together with what is already recorded it must
   *  stay below the order amount — the final amount goes through confirm, never through here. */
  amount_received_minor: z.number().int().positive(),
  bank_reference: z.string().trim().min(1).max(255).optional(),
});
export type RecordPartialRequest = z.infer<typeof RecordPartialRequest>;

export const RefundOrderRequest = z.object({
  reason: z.string().trim().min(1).max(500),
  /** Money refunded, in minor units, for the record. The tokens clawed back are always the tokens the
   *  confirmation granted — a money refund never leaves paid-for tokens in the wallet. */
  amount_refunded_minor: z.number().int().positive().optional(),
});
export type RefundOrderRequest = z.infer<typeof RefundOrderRequest>;

export const BankAccountUpsertRequest = z.object({
  currency: BankTransferCurrency,
  account_name: z.string().trim().min(1).max(255),
  bank_name: z.string().trim().min(1).max(255),
  account_number: z.string().trim().min(1).max(64),
  swift_iban: z.string().trim().min(1).max(64).nullable().default(null),
  is_active: z.boolean().default(true),
});
export type BankAccountUpsertRequest = z.infer<typeof BankAccountUpsertRequest>;

export const RenewalRunResult = z.object({
  renewals_created: z.number().int().min(0),
  renewal_order_ids: z.array(z.string().uuid()),
  /** Subscriptions moved to PAST_DUE (inside the grace period) or CANCELED (grace over, dropped to free). */
  past_due: z.number().int().min(0),
  downgraded_to_free: z.number().int().min(0),
});
export type RenewalRunResult = z.infer<typeof RenewalRunResult>;

// ---------------------------------------------------------------------------------------------------------------------------------
// Revenue summary (owner 2026-11-13): Admin › Billing. Money only from recorded rows of the caller's own organization: plan orders
// (bank_transfer_orders) and token packs (wallet_pack_requests). Pure math here, so the API and the tests share one rule:
//  - money in: a CONFIRMED order's amount on the day it was confirmed; a PARTIAL order's amount received so far on its last update;
//    a REFUNDED order still counts its received amount on its confirmation day, and its refund leaves on the refund day; a PAID pack
//    on the day it was marked paid (its last update: PAID is final).
//  - net = money in − refunds. Awaiting = what customers said they paid, or were invoiced, and nobody has confirmed yet.
//  - months are calendar months in UTC, the last 12 including the current one, oldest first.

export const RevenueCurrencyTotals = z.object({
  currency: BankTransferCurrency,
  received_minor: z.number().int(),
  refunded_minor: z.number().int(),
  net_minor: z.number().int(),
  this_month_minor: z.number().int(),
  last_month_minor: z.number().int(),
  last_12_months_minor: z.number().int(),
  plans_minor: z.number().int(),
  packs_minor: z.number().int(),
  awaiting_minor: z.number().int(),
});
export type RevenueCurrencyTotals = z.infer<typeof RevenueCurrencyTotals>;

export const RevenueSummary = z.object({
  totals: z.array(RevenueCurrencyTotals),
  months: z.array(z.object({ month: z.string(), NGN: z.number().int(), USD: z.number().int() })),
  orders: z.object({ ordered: z.number().int(), awaiting: z.number().int(), partial: z.number().int(), confirmed: z.number().int(), rejected: z.number().int(), refunded: z.number().int() }),
  packs: z.object({ requested: z.number().int(), invoiced: z.number().int(), paid: z.number().int(), cancelled: z.number().int() }),
  active_plans: z.array(z.object({ plan_code: z.string(), count: z.number().int() })),
  renewals_due_7d: z.number().int(),
  generated_at: z.string(),
});
export type RevenueSummary = z.infer<typeof RevenueSummary>;

export interface RevenueOrderRow { currency: string; status: string; plan_code: string; amount_minor: number; amount_received_minor: number;
  amount_refunded_minor: number | null; confirmed_at: string | null; updated_at: string }
export interface RevenuePackRow { currency: string; status: string; amount_minor: number; updated_at: string }
export interface RevenueSubscriptionRow { plan_code: string; state: string; period_end: string | null }

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export function summarizeRevenue(orders: RevenueOrderRow[], packs: RevenuePackRow[], subs: RevenueSubscriptionRow[], now = new Date()): RevenueSummary {
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  const thisMonth = months[11]!, lastMonth = months[10]!;
  const cur = ["NGN", "USD"] as const;
  const totals = Object.fromEntries(cur.map((c) => [c, { currency: c, received_minor: 0, refunded_minor: 0, net_minor: 0, this_month_minor: 0, last_month_minor: 0,
    last_12_months_minor: 0, plans_minor: 0, packs_minor: 0, awaiting_minor: 0 }])) as Record<"NGN" | "USD", RevenueCurrencyTotals>;
  const byMonth = Object.fromEntries(months.map((m) => [m, { month: m, NGN: 0, USD: 0 }])) as Record<string, { month: string; NGN: number; USD: number }>;
  const book = (currency: string, amount: number, at: string | null, kind: "plans" | "packs") => {
    if (currency !== "NGN" && currency !== "USD" || !amount) return;
    const t = totals[currency];
    if (amount > 0) t.received_minor += amount; else t.refunded_minor += -amount;
    t.net_minor += amount;
    t[kind === "plans" ? "plans_minor" : "packs_minor"] += amount;
    const m = at ? monthKey(new Date(at)) : null;
    if (m && byMonth[m]) { byMonth[m][currency] += amount; t.last_12_months_minor += amount; }
    if (m === thisMonth) t.this_month_minor += amount;
    if (m === lastMonth) t.last_month_minor += amount;
  };
  const orderCounts = { ordered: 0, awaiting: 0, partial: 0, confirmed: 0, rejected: 0, refunded: 0 };
  for (const o of orders) {
    const s = o.status;
    if (s === "ORDERED") orderCounts.ordered++;
    else if (s === "AWAITING_CONFIRMATION") { orderCounts.awaiting++; if (o.currency in totals) totals[o.currency as "NGN"].awaiting_minor += o.amount_minor - o.amount_received_minor; }
    else if (s === "PARTIAL") { orderCounts.partial++; book(o.currency, o.amount_received_minor, o.updated_at, "plans"); if (o.currency in totals) totals[o.currency as "NGN"].awaiting_minor += o.amount_minor - o.amount_received_minor; }
    else if (s === "CONFIRMED") { orderCounts.confirmed++; book(o.currency, o.amount_received_minor, o.confirmed_at ?? o.updated_at, "plans"); }
    else if (s === "REJECTED") orderCounts.rejected++;
    else if (s === "REFUNDED") {
      orderCounts.refunded++;
      book(o.currency, o.amount_received_minor, o.confirmed_at ?? o.updated_at, "plans");
      book(o.currency, -(o.amount_refunded_minor ?? o.amount_received_minor), o.updated_at, "plans");
    }
  }
  const packCounts = { requested: 0, invoiced: 0, paid: 0, cancelled: 0 };
  for (const k of packs) {
    if (k.status === "REQUESTED") packCounts.requested++;
    else if (k.status === "INVOICED") { packCounts.invoiced++; if (k.currency in totals) totals[k.currency as "NGN"].awaiting_minor += k.amount_minor; }
    else if (k.status === "PAID") { packCounts.paid++; book(k.currency, k.amount_minor, k.updated_at, "packs"); }
    else if (k.status === "CANCELLED") packCounts.cancelled++;
  }
  const active = new Map<string, number>();
  let due = 0;
  for (const s of subs) {
    if (s.state !== "ACTIVE" && s.state !== "PAST_DUE") continue;
    active.set(s.plan_code, (active.get(s.plan_code) ?? 0) + 1);
    if (s.state === "ACTIVE" && s.period_end) {
      const left = Date.parse(s.period_end) - now.getTime();
      if (left >= 0 && left <= 7 * 86_400_000) due++;
    }
  }
  return RevenueSummary.parse({
    totals: cur.map((c) => totals[c]), months: months.map((m) => byMonth[m]), orders: orderCounts, packs: packCounts,
    active_plans: [...active].map(([plan_code, count]) => ({ plan_code, count })).sort((a, b) => b.count - a.count || a.plan_code.localeCompare(b.plan_code)),
    renewals_due_7d: due, generated_at: now.toISOString(),
  });
}

/** The plan's catalogue entry for a plan code read from the database or the licence; an unknown code (an older plan) is
 *  null, and the caller then treats the organisation as Free rather than guessing. */
export function planEntryOrNull(code: string | null | undefined): PlanCatalogueEntry | null {
  return PLAN_CATALOGUE.find((p) => p.code === code) ?? null;
}

/** Upload limit per video in bytes for a plan code; null = no plan limit. An unknown or missing plan is the Free limit. */
export function planUploadLimitBytes(code: string | null | undefined): number | null {
  const entry = planEntryOrNull(code) ?? planCatalogueEntry("FREE");
  return entry.upload_gb_per_video === null ? null : Math.round(entry.upload_gb_per_video * 1024 ** 3);
}
