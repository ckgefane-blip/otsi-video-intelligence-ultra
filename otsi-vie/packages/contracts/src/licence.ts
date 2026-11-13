import { z } from "zod";

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
