import { z } from "zod";
import { WalletJobType } from "./wallet";

/**
 * Licence (ADR-144 §1.4/§1.5, ultra-only): the central server's signed statement of what an organization may
 * do — its plan, its features, its token balance, and how long the statement is good for. The desktop app
 * stores the signed token and presents it to the local engine, which verifies it against the central server's
 * Ed25519 public key (it never needs the central server's private key, and it never calls the central server
 * to check). The token is server-signed Ed25519 (ADR-144 v3 §1.5) and is checked inside the compiled native
 * code — never trust a plain flag.
 *
 * `plan` is the code of the plan behind the organization's active subscription (the `plans` table); an
 * organization with no active subscription is on the free tier, plan "FREE". `features` are the `feature_key`
 * values of the organization's currently-valid entitlement grants. `tokens` is the wallet's SPENDABLE balance
 * (credits not yet expired, after debits) — what the organization can actually spend now.
 */

/** The claims inside a signed licence token (ADR-144 §1.5). `expires_at` is an ISO string; the JWT's own `exp`
 *  carries the same instant as seconds, so `jose` enforces expiry on verify. */
export const LicenceClaims = z.object({
  organization_id: z.string().uuid(),
  plan: z.string().min(1),
  features: z.array(z.string().min(1)),
  tokens: z.number().int().min(0),
  /** ADR-146 §4: tokens a linked desktop may spend while it cannot reach the central server, settled later. A token
   *  issued before the allowance existed carries none: 0, fail closed. */
  offline_allowance: z.number().int().min(0).default(0),
  expires_at: z.string(),
});
export type LicenceClaims = z.infer<typeof LicenceClaims>;

/** GET /v1/licence: the snapshot the token is built from. `valid_until` is the active subscription's period
 *  end (null on the free tier — no subscription, no expiry); `grace_until` is `valid_until` plus the offline
 *  grace (ADR-144 §1.5, OTSI_VIE_LICENCE_GRACE_DAYS, default 14 days), also null on the free tier.
 *  The snapshot has NO `expires_at`: that instant belongs to the signed licence token (LicenceClaims /
 *  LicenceRefreshResponse), not to the snapshot — the server used to require it here, so GET /v1/licence
 *  always failed validation with 422 "expires_at: Required" (reconciliation 2026-11-13). */
export const LicenceSnapshot = LicenceClaims.omit({ expires_at: true }).extend({
  valid_until: z.string().nullable(),
  grace_until: z.string().nullable(),
});
export type LicenceSnapshot = z.infer<typeof LicenceSnapshot>;

/** POST /v1/licence/refresh: the fresh signed licence token and the instant it expires. */
export const LicenceRefreshResponse = z.object({
  licence_token: z.string().min(1),
  expires_at: z.string(),
});
export type LicenceRefreshResponse = z.infer<typeof LicenceRefreshResponse>;

/** ADR-146 §4: the offline allowance every licence carries (about 200 tokens, approved 2026-11-13). */
export const OFFLINE_ALLOWANCE_TOKENS = 200;

/**
 * Job tickets (ADR-146 §3, central only): a linked desktop asks central for a ticket before a paid job starts; central
 * charges its own wallet ledger and returns an Ed25519-signed ticket (audience "otsi-vie-ticket", 7 days) that the
 * desktop's worker checks. The balance lives only on the server.
 */
export const TicketRequest = z.object({
  job_type: WalletJobType,
  job_id: z.string().uuid(),
  amount: z.number().int().positive().max(1_000_000),
});
export type TicketRequest = z.infer<typeof TicketRequest>;

/** The claims inside a signed job ticket. */
export const TicketClaims = z.object({
  ticket_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  job_type: WalletJobType,
  job_id: z.string().uuid(),
  amount: z.number().int().positive(),
  expires_at: z.string(),
});
export type TicketClaims = z.infer<typeof TicketClaims>;

/** POST /v1/tickets: the signed ticket and the spendable balance left after the charge. */
export const TicketResponse = z.object({
  ticket_id: z.string().uuid(),
  ticket_token: z.string().min(1),
  expires_at: z.string(),
  balance: z.number().int().min(0),
});
export type TicketResponse = z.infer<typeof TicketResponse>;

/** POST /v1/tickets/refund: a job cancelled before it started, or failed. Refunds once. */
export const TicketRefundRequest = z.object({
  job_type: WalletJobType,
  job_id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});
export type TicketRefundRequest = z.infer<typeof TicketRefundRequest>;

export const TicketRefundResponse = z.object({
  /** REFUNDED: tokens went back (or an owed debt was cleared); NONE: there was no ticket, or it was already refunded */
  state: z.enum(["REFUNDED", "NONE"]),
  balance: z.number().int().min(0),
});
export type TicketRefundResponse = z.infer<typeof TicketRefundResponse>;

/** POST /v1/tickets/settle: the paid jobs a desktop ran offline, inside its allowance. */
export const OfflineSpend = z.object({
  job_type: WalletJobType,
  job_id: z.string().uuid(),
  amount: z.number().int().positive().max(1_000_000),
  spent_at: z.string().datetime({ offset: true }),
});
export type OfflineSpend = z.infer<typeof OfflineSpend>;

export const TicketSettleRequest = z.object({ spends: z.array(OfflineSpend).min(1).max(100) });
export type TicketSettleRequest = z.infer<typeof TicketSettleRequest>;

export const TicketSettleResponse = z.object({
  /** per spend: CHARGED (paid from the balance), OWED (balance short: a debt, collected when tokens arrive), REFUNDED */
  results: z.array(z.object({ job_type: WalletJobType, job_id: z.string().uuid(), state: z.enum(["CHARGED", "OWED", "REFUNDED"]) })),
  /** tokens still owed after this settlement; while above zero central issues no new tickets */
  owed: z.number().int().min(0),
  balance: z.number().int().min(0),
});
export type TicketSettleResponse = z.infer<typeof TicketSettleResponse>;
