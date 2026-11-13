/**
 * Licence (ADR-144 §1.4/§1.5, ultra-only): the central server's signed statement of what an organization may
 * do — its plan, its features, its token balance, and how long the statement is good for.
 *
 *   GET  /v1/licence         (AuthGuard)                   the current licence snapshot for the caller's org
 *   POST /v1/licence/refresh (refresh cookie, no Bearer)    a fresh signed licence token (JWT, Ed25519)
 *
 * The snapshot is DERIVED — this module needs no new tables: the plan and valid_until come from the active
 * subscription (subscriptions -> plan_versions -> plans), the features from the currently-valid entitlement
 * grants, and the token balance from the wallet service (WalletService.balance — the ledger is never
 * reimplemented here). An organization with no TRIALING/ACTIVE subscription is on the free tier: plan "FREE",
 * no valid_until, no grace_until.
 *
 * The licence token is SERVER-SIGNED Ed25519 (ADR-144 v3 §1.5): the central server holds the Ed25519 signing
 * key (OTSI_VIE_LICENCE_SIGNING_KEY — central server only, never in the installer, never logged) and a local
 * engine verifies the token with the central server's Ed25519 public key (OTSI_VIE_LICENCE_PUBLIC_KEY_PEM or
 * OTSI_VIE_CENTRAL_JWKS_URL). It is deliberately NOT the RS256 local signing key used for access tokens: a
 * licence is a server statement, not a session, and the access-token key must never be able to mint one.
 * verifyLicenceToken() is the REFERENCE implementation of the check the compiled native code performs (plan
 * §1c): it verifies the Ed25519 signature, the expiry, and the organisation/plan claims, and rejects with the
 * stable codes LICENCE_INVALID / LICENCE_EXPIRED. Never trust a plain flag. Its audience is
 * "otsi-vie-licence", so a licence token can never be an access token and an access token can never be a
 * licence token. The token never claims entitlement past the paid period: it expires at the subscription's
 * valid_until when that is sooner than the 30-day token life.
 *
 * The refresh needs a live session, not a live access token: it authenticates on the refresh cookie alone
 * (plus the CSRF header and the origin guard), so an access token that expired 15 minutes after sign-in
 * does not break it — the session the cookie names is checked read-only, and the caller names the
 * organization with X-Organization-Id (the same header AuthGuard reads). An access token alone cannot mint
 * a licence token, and a refresh cookie without an organization cannot either: the membership check below
 * is the same ACTIVE-membership check AuthGuard performs. The session is NOT rotated here; that is
 * POST /v1/auth/refresh's job. Issuance is written to the audit log (licence.refreshed) and nothing else:
 * a refresh changes no business state.
 *
 * Offline grace (ADR-144 §1.5): the token itself is strict — verifyLicenceToken() throws LICENCE_EXPIRED the
 * moment it expires. The grace is applied by the HOLDER (the desktop shell / native code): a token no more
 * than OTSI_VIE_LICENCE_GRACE_DAYS past its expiry still permits offline work. graceUntil() is the one place
 * that arithmetic lives, and the snapshot carries grace_until so the shell never recomputes it from the wrong
 * date.
 */
import { Controller, Get, Headers, HttpCode, Inject, Injectable, Post, Req, UseGuards } from "@nestjs/common";
import { LicenceClaims, LicenceRefreshResponse, LicenceSnapshot, OFFLINE_ALLOWANCE_TOKENS } from "@otsi-vie/contracts";
import { createHash } from "node:crypto";
import { createRemoteJWKSet, errors, importPKCS8, importSPKI, jwtVerify, JWTPayload, KeyLike, SignJWT } from "jose";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Role } from "../../core/auth";
import { CONFIG, Config, publicKeyOf } from "../../core/config";
import { Db } from "../../core/db";
import { ApiError } from "../../core/problem";
import { CSRF_HEADER } from "../auth/auth.controller";
import { WalletService } from "../wallet/wallet";
import type { FastifyRequest } from "fastify";

/** The licence token's audience: distinct from the API audience, so the two token kinds never interchange. */
export const LICENCE_AUDIENCE = "otsi-vie-licence";
/** A licence token is good for 30 days from issue, capped at the subscription's valid_until (see above). */
export const LICENCE_TOKEN_TTL_DAYS = 30;
/** No active subscription: the free tier. The plan code comes from the `plans` table; "FREE" is the code used
 *  when there is no subscription row at all. */
export const FREE_PLAN_CODE = "FREE";

const LICENCE_INVALID = () => new ApiError(401, "LICENCE_INVALID", "That licence token could not be verified.");
const LICENCE_EXPIRED = () => new ApiError(401, "LICENCE_EXPIRED", "That licence token has expired. Sign in again to refresh it.");
const LICENCE_NOT_CONFIGURED = () => new ApiError(401, "LICENCE_NOT_CONFIGURED", "No licence verification key is configured on this engine.");
const NO_SESSION = () => new ApiError(401, "NO_SESSION", "Your session has ended. Sign in again.");

/** The same cookie reader as AuthController (a malformed cookie is no session, not a server error). */
function readCookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** `valid_until` + grace days (ADR-144 §1.5), as an ISO string; null when there is no valid_until (free tier). */
export function graceUntil(validUntil: string | null, graceDays: number): string | null {
  if (!validUntil) return null;
  return new Date(Date.parse(validUntil) + graceDays * 86_400_000).toISOString();
}

/**
 * Verify a licence token a local engine was presented with, against the configured key(s). The key order is
 * deliberate: an explicitly configured central public key (or JWKS) always wins — on a local engine the
 * issuer's own access-token key must NEVER verify a licence token, or the engine could forge its own licences
 * (and it is RS256 anyway: a licence token is EdDSA, so it would not verify under it regardless). The
 * issuer's own licence public key is used only when this deployment IS the central server (centralMode on),
 * derived from its signing key — so the central server can verify what it issues. With no key at all the
 * engine accepts no licence token (ADR-144 §1.5: without a central key it behaves exactly as today — local
 * sign-in only). This is the reference implementation of the check the compiled native code performs: the
 * Ed25519 signature, the expiry, and the organisation/plan claims are all verified, never a plain flag.
 */
export async function verifyLicenceToken(token: string, cfg: Config): Promise<LicenceClaims> {
  let key: KeyLike | ReturnType<typeof createRemoteJWKSet>;
  const central = cfg.central;
  if (central?.licencePublicKeyPem) key = await importSPKI(central.licencePublicKeyPem, "EdDSA");
  else if (central?.centralJwksUrl) key = createRemoteJWKSet(new URL(central.centralJwksUrl));
  else if (central?.centralMode && central.licenceSigningKeyPem) key = await importSPKI(publicKeyOf(central.licenceSigningKeyPem), "EdDSA");
  else throw LICENCE_NOT_CONFIGURED();
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, key as KeyLike, { issuer: cfg.jwtIssuer, audience: LICENCE_AUDIENCE, algorithms: ["EdDSA"] }));
  } catch (err) {
    if (err instanceof errors.JWTExpired) throw LICENCE_EXPIRED();
    throw LICENCE_INVALID();
  }
  try {
    return LicenceClaims.parse({
      organization_id: payload.organization_id,
      plan: payload.plan,
      features: payload.features,
      tokens: payload.tokens,
      offline_allowance: payload.offline_allowance,
      expires_at: payload.expires_at,
    });
  } catch {
    throw LICENCE_INVALID();
  }
}

@Injectable()
export class LicenceService {
  private key: Promise<KeyLike> | undefined;

  constructor(@Inject(CONFIG) private readonly cfg: Config, private readonly db: Db, private readonly wallet: WalletService) {}

  /** The offline grace in days (OTSI_VIE_LICENCE_GRACE_DAYS, default 14). */
  get graceDays(): number {
    return this.cfg.central?.licenceGraceDays ?? 14;
  }

  /** The cookie settings the refresh endpoint's guard needs (the same values AuthController uses). */
  get cookieSettings(): { secureCookies: boolean; allowedOrigins: string[] } {
    return this.cfg.localAuth
      ? { secureCookies: this.cfg.localAuth.secureCookies, allowedOrigins: this.cfg.localAuth.allowedOrigins }
      : { secureCookies: true, allowedOrigins: [] };
  }

  /** The Ed25519 licence signing key (OTSI_VIE_LICENCE_SIGNING_KEY, central server only). Deliberately NOT
   *  the RS256 local signing key used for access tokens: a licence is a server statement, not a session. */
  private signingKey(): Promise<KeyLike> {
    return (this.key ??= importPKCS8(this.cfg.central!.licenceSigningKeyPem!, "EdDSA"));
  }

  /** The plan + valid_until of the latest TRIALING/ACTIVE subscription (an open-ended one first — it has no
   *  end to run out). A PAST_DUE subscription is not active: the organization falls back to the free tier
   *  until it is paid; its grants stay valid until their own valid_until, so features already granted are not
   *  silently taken away. */
  private async subscription(p: Principal): Promise<{ plan: string; valid_until: string | null }> {
    const row = await this.db.one<RowDataPacket>(
      `SELECT p.code AS plan_code, s.period_end AS valid_until
         FROM subscriptions s
         JOIN plan_versions pv ON pv.id = s.plan_version_id
         JOIN plans p ON p.id = pv.plan_id
        WHERE s.organization_id = ? AND s.state IN ('TRIALING', 'ACTIVE')
        ORDER BY (s.period_end IS NULL) DESC, s.period_end DESC, s.created_at DESC LIMIT 1`,
      [p.organizationId]);
    if (!row) return { plan: FREE_PLAN_CODE, valid_until: null };
    return {
      plan: String(row.plan_code),
      valid_until: row.valid_until ? new Date(row.valid_until).toISOString() : null,
    };
  }

  /** The feature_key values of the organization's currently-valid entitlement grants, in key order. */
  private async features(organizationId: string): Promise<string[]> {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT DISTINCT feature_key FROM entitlement_grants
        WHERE organization_id = ? AND (valid_until IS NULL OR valid_until > CURRENT_TIMESTAMP(6))
        ORDER BY feature_key ASC`,
      [organizationId]);
    return rows.map((r) => String(r.feature_key));
  }

  /** The snapshot: plan + valid_until from the active subscription, features from the grants, tokens from the
   *  wallet's spendable balance. */
  async snapshot(p: Principal): Promise<LicenceSnapshot> {
    const sub = await this.subscription(p);
    const [features, balance] = await Promise.all([this.features(p.organizationId), this.wallet.balance(p.organizationId)]);
    const validUntil = sub.valid_until;
    return LicenceSnapshot.parse({
      organization_id: p.organizationId,
      plan: sub.plan,
      features,
      tokens: balance.spendable_balance,
      offline_allowance: OFFLINE_ALLOWANCE_TOKENS,
      valid_until: validUntil,
      grace_until: graceUntil(validUntil, this.graceDays),
    });
  }

  /** The presented refresh cookie must belong to a live session: unrevoked, unrotated, unexpired. The check
   *  is read-only — the session is not rotated here. Returns the session's user (and subject), so the
   *  refresh endpoint can derive its principal from the session instead of from an access token. */
  private async sessionUser(refreshToken: string | undefined): Promise<{ userId: string; subject: string }> {
    if (!refreshToken) throw NO_SESSION();
    const row = await this.db.one<RowDataPacket>(
      `SELECT s.user_id AS user_id, u.external_subject AS subject FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.refresh_hash = ? AND s.revoked_at IS NULL AND s.rotated_at IS NULL
          AND s.expires_at > CURRENT_TIMESTAMP(6)`,
      [createHash("sha256").update(refreshToken).digest("hex")]);
    if (!row) throw NO_SESSION();
    return { userId: String(row.user_id), subject: String(row.subject) };
  }

  /** The presented refresh cookie must belong to a live session of this user: unrevoked, unrotated, unexpired.
   *  The check is read-only — the session is not rotated here. */
  private async assertLiveSession(userId: string, refreshToken: string | undefined): Promise<void> {
    const session = await this.sessionUser(refreshToken);
    if (session.userId !== userId) throw NO_SESSION();
  }

  /** Issue a fresh signed licence token from the refresh cookie alone (no live access token needed): the
   *  user comes from the session row, and the organization from X-Organization-Id — the caller must be an
   *  ACTIVE member of it, the same check AuthGuard performs. A missing or unknown organization is refused
   *  the same way AuthGuard refuses it. */
  async refreshFromSession(refreshToken: string | undefined, organizationId: string | undefined, requestId: string): Promise<LicenceRefreshResponse> {
    if (!organizationId) throw new ApiError(400, "ORGANIZATION_REQUIRED", "Choose an organization (X-Organization-Id).");
    const { userId, subject } = await this.sessionUser(refreshToken);
    const m = await this.db.one<RowDataPacket>(
      `SELECT m.role AS role FROM users u JOIN memberships m ON m.user_id = u.id
        WHERE u.id = ? AND m.organization_id = ? AND m.status = 'ACTIVE'`,
      [userId, organizationId]);
    // the same answer whether the organization does not exist or the user is not in it: no probing of other tenants
    if (!m) throw new ApiError(403, "NOT_A_MEMBER", "You are not an active member of that organization.");
    const p: Principal = { userId, subject, organizationId, role: m.role as Role, requestId };
    return this.refresh(p, refreshToken);
  }

  /** Issue a fresh signed licence token for the caller's organization, and audit the issuance. The token's
   *  expiry is the sooner of 30 days from now and the subscription's valid_until. */
  async refresh(p: Principal, refreshToken: string | undefined): Promise<LicenceRefreshResponse> {
    if (!this.cfg.central?.licenceSigningKeyPem) throw new ApiError(503, "LICENCE_SIGNING_NOT_CONFIGURED", "This engine cannot issue licence tokens: no licence signing key is configured.");
    await this.assertLiveSession(p.userId, refreshToken);
    const snap = await this.snapshot(p);
    const now = new Date();
    const ttlEnd = new Date(now.getTime() + LICENCE_TOKEN_TTL_DAYS * 86_400_000);
    const expiresAt = snap.valid_until && Date.parse(snap.valid_until) < ttlEnd.getTime() ? new Date(snap.valid_until) : ttlEnd;
    const expiresAtIso = expiresAt.toISOString();
    const token = await new SignJWT({
      organization_id: snap.organization_id,
      plan: snap.plan,
      features: snap.features,
      tokens: snap.tokens,
      offline_allowance: snap.offline_allowance,
      expires_at: expiresAtIso,
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .setSubject(snap.organization_id)
      .setIssuer(this.cfg.jwtIssuer)
      .setAudience(LICENCE_AUDIENCE)
      .setIssuedAt()
      .setJti(uuidv7())
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(await this.signingKey());
    await this.db.tx(async (c) => {
      await recordChange(c, userActor(p), {
        action: "licence.refreshed", entityType: "organization", entityId: p.organizationId,
        after: { plan: snap.plan, features: snap.features, tokens: snap.tokens, expires_at: expiresAtIso },
      });
    });
    return LicenceRefreshResponse.parse({ licence_token: token, expires_at: expiresAtIso });
  }
}

@Controller("v1/licence")
export class LicenceController {
  constructor(private readonly licence: LicenceService) {}

  // -- the same cookie-endpoint helpers as AuthController (CSRF header + origin guard, refresh cookie) --
  private secure(req: FastifyRequest): boolean {
    const origin = req.headers.origin ?? "";
    return this.licence.cookieSettings.secureCookies && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  }

  private cookieName(req: FastifyRequest): string {
    return this.secure(req) ? "__Host-otsi_vie_refresh" : "otsi_vie_refresh";
  }

  private guard(req: FastifyRequest, csrf: string | undefined): void {
    if (csrf !== "1") throw new ApiError(403, "CSRF_HEADER_REQUIRED", "This request must come from the OTSI VIE app.");
    const origin = req.headers.origin;
    const allowed = this.licence.cookieSettings.allowedOrigins;
    if (origin && allowed.length > 0 && !allowed.includes(origin)) throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This request must come from the OTSI VIE app.");
  }

  @Get()
  @UseGuards(AuthGuard)
  snapshot(@CurrentPrincipal() p: Principal): Promise<LicenceSnapshot> {
    return this.licence.snapshot(p);
  }

  @Post("refresh")
  @HttpCode(200)
  refresh(@Headers("x-organization-id") orgId: string | undefined, @Headers(CSRF_HEADER) csrf: string | undefined, @Req() req: FastifyRequest): Promise<LicenceRefreshResponse> {
    this.guard(req, csrf);
    return this.licence.refreshFromSession(readCookie(req, this.cookieName(req)), orgId, String(req.id));
  }
}
