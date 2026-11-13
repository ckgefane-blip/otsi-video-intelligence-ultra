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
export const PlanCode = z.enum(["FREE", "STARTER", "CLUB", "ACADEMY", "SEASON"]);
export type PlanCode = z.infer<typeof PlanCode>;

export const BankTransferOrderStatus = z.enum(["ORDERED", "AWAITING_CONFIRMATION", "CONFIRMED", "REJECTED", "PARTIAL", "REFUNDED"]);
export type BankTransferOrderStatus = z.infer<typeof BankTransferOrderStatus>;

/**
 * The plan catalogue. Prices and token grants START at the approved token-pack values (ADR-140 §2: Starter
 * 100 tokens ₦15,000 / $49, Club 500 ₦60,000 / $199, Academy 1,200 ₦120,000 / $399, Season 3,000
 * ₦250,000 / $899) so there is one consistent price list, not two invented ones — a plan month buys the same
 * tokens as the pack of the same name. These are recommendations, not measured costs, exactly like the pack
 * prices: the owner must validate them against the unit-cost worksheet and the paid pilots before any real
 * sale (ADR-140 §2). A 12-month period costs 10 monthly payments (2 months free); that rule lives here so a
 * price change is one edit.
 */
export const PlanCatalogueEntry = z.object({
  code: PlanCode,
  label: z.string(),
  /** Tokens credited to the wallet on confirmation, per month of the period. */
  tokens_per_month: z.number().int().min(0),
  /** Monthly price in minor units: kobo for NGN, cents for USD. */
  price_ngn_minor: z.number().int().min(0),
  price_usd_minor: z.number().int().min(0),
  /** What the plan is for, in one line for the plan page. */
  covers: z.string(),
});
export type PlanCatalogueEntry = z.infer<typeof PlanCatalogueEntry>;

export const PLAN_CATALOGUE: PlanCatalogueEntry[] = [
  { code: "FREE", label: "Free", tokens_per_month: 0, price_ngn_minor: 0, price_usd_minor: 0, covers: "The free tier: what a plan drops to after expiry plus the grace period. Never ordered." },
  { code: "STARTER", label: "Starter", tokens_per_month: 100, price_ngn_minor: 1_500_000, price_usd_minor: 4900, covers: "1 full match + 1 reel a month. The trial plan." },
  { code: "CLUB", label: "Club", tokens_per_month: 500, price_ngn_minor: 6_000_000, price_usd_minor: 19900, covers: "~5 matches + reels / reports a month." },
  { code: "ACADEMY", label: "Academy", tokens_per_month: 1200, price_ngn_minor: 12_000_000, price_usd_minor: 39900, covers: "~12 matches + reels / reports a month." },
  { code: "SEASON", label: "Season", tokens_per_month: 3000, price_ngn_minor: 25_000_000, price_usd_minor: 89900, covers: "~30 matches a month — a season for a small club." },
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

/**
 * Revenue totals read from the orders table (admin only, own organization). One bucket per currency —
 * naira and dollars are never added together. Definitions: confirmed = orders with status CONFIRMED,
 * totalled on the amount actually received; outstanding = orders still open (ORDERED, AWAITING_CONFIRMATION
 * or PARTIAL), totalled on what is still owed (amount minus amount received); refunded = orders with
 * status REFUNDED, totalled on the money refunded; partial = orders with status PARTIAL, totalled on
 * what has arrived so far. Counts are orders in each bucket.
 */
export const RevenueSummaryBucket = z.object({
  count: z.number().int().nonnegative(),
  total_minor: z.number().int().nonnegative(),
});
export type RevenueSummaryBucket = z.infer<typeof RevenueSummaryBucket>;

export const RevenueSummary = z.object({
  currencies: z.array(z.object({
    currency: BankTransferCurrency,
    confirmed: RevenueSummaryBucket,
    outstanding: RevenueSummaryBucket,
    refunded: RevenueSummaryBucket,
    partial: RevenueSummaryBucket,
  })),
});
export type RevenueSummary = z.infer<typeof RevenueSummary>;

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
