/**
 * Authentication and tenant context (ADR-002, ADR-017). Every route needs a Bearer access token signed by the configured OIDC issuer
 * for the configured audience (both verified). The organization a request acts for is chosen with the `X-Organization-Id` header but
 * is NEVER trusted on its own: the user must have an ACTIVE membership in it, read from MySQL on every request. Roles come from that
 * membership, not from the token. Deny by default.
 */
import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { createLocalJWKSet, createRemoteJWKSet, importSPKI, JWTPayload, jwtVerify, KeyLike } from "jose";
import { RowDataPacket } from "mysql2/promise";
import { enforceProjectAccess, loadAccess, ProjectAccessInfo } from "./access";
import { CONFIG, Config } from "./config";
import { Db } from "./db";
import { ApiError } from "./problem";

export type Role = "OWNER" | "ADMIN" | "ANALYST" | "EDITOR" | "SCOUT" | "VIEWER";
export interface Principal {
  userId: string;
  subject: string;
  organizationId: string;
  role: Role;
  /** this request's id (also returned as the X-Request-Id header); audit rows carry it for correlation */
  requestId: string;
  /** which projects he may not see, and his permission in restricted ones (ADR-057); set by AuthGuard on every member request */
  access?: ProjectAccessInfo;
}

const ROLES_KEY = "otsi:roles";
const ACCOUNT_ONLY_KEY = "otsi:account-only";
/** The route acts for the signed-in user, not for an organization (e.g. GET /v1/me lists the user's organizations). */
export const AccountOnly = () => SetMetadata(ACCOUNT_ONLY_KEY, true);

export interface Account { userId: string; subject: string; requestId: string }
export const CurrentAccount = createParamDecorator((_: unknown, ctx: ExecutionContext): Account => {
  const a = (ctx.switchToHttp().getRequest<FastifyRequest>() as FastifyRequest & { account?: Account }).account;
  if (!a) throw new ApiError(401, "UNAUTHENTICATED", "Sign in first.");
  return a;
});
/** Restrict a route to these membership roles (deny by default: a route without @Roles allows any ACTIVE member). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Company-organisation guard (ADR-140 §8, the bank-account/order fix): the company organisation is the one
 * named by the server setting (OTSI_VIE_COMPANY_ORG_ID). Only a member of that organisation may do the company
 * billing actions (change bank accounts, confirm / part-pay / reject / refund a plan order, invoice or confirm
 * a token pack, top up a wallet). Fail closed: when the setting is absent — or the caller's organisation is
 * any other — the action is refused (403). It never falls back to letting every admin do it. The existing
 * @Roles("OWNER", "ADMIN") still applies on top: the caller must be an owner/admin of the company org.
 */
export function requireCompanyOrg(p: Principal, companyOrganizationId: string | undefined): void {
  if (!companyOrganizationId || p.organizationId !== companyOrganizationId) {
    throw new ApiError(403, "COMPANY_ORG_ONLY", "Only the company organisation can do this.");
  }
}
/** The read side of the same rule (ADR-140 §8): is this caller a member of the company organisation?
 *  The company org's Admin › Billing reads (orders, pack requests, revenue, wallets) show every
 *  customer's rows; a customer org's reads show only its own. False when the setting is missing, so
 *  a read never silently widens to all organisations. */
export function isCompanyOrg(p: Principal, companyOrganizationId: string | undefined): boolean {
  return companyOrganizationId !== undefined && p.organizationId === companyOrganizationId;
}
export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  const p = (ctx.switchToHttp().getRequest<FastifyRequest>() as FastifyRequest & { principal?: Principal }).principal;
  if (!p) throw new ApiError(401, "UNAUTHENTICATED", "Sign in first.");
  return p;
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthGuard implements CanActivate {
  private key: KeyLike | ReturnType<typeof createRemoteJWKSet> | ReturnType<typeof createLocalJWKSet> | undefined;

  constructor(@Inject(CONFIG) private readonly cfg: Config, private readonly db: Db, private readonly reflector: Reflector) {}

  private async verifier() {
    if (!this.key) this.key = this.cfg.jwksUrl ? createRemoteJWKSet(new URL(this.cfg.jwksUrl)) : await importSPKI(this.cfg.jwtPublicKeyPem!, "RS256");
    return this.key;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { principal?: Principal; account?: Account }>();
    const header = req.headers.authorization ?? "";
    const token = /^Bearer (.+)$/.exec(header)?.[1];
    if (!token) throw new ApiError(401, "UNAUTHENTICATED", "A Bearer access token is required.");
    let claims: JWTPayload;
    try {
      const key = await this.verifier();
      ({ payload: claims } = await jwtVerify(token, key as KeyLike, { issuer: this.cfg.jwtIssuer, audience: this.cfg.jwtAudience, algorithms: ["RS256"] }));
    } catch {
      throw new ApiError(401, "INVALID_TOKEN", "The access token is not valid for this service.");
    }
    if (!claims.sub) throw new ApiError(401, "INVALID_TOKEN", "The access token has no subject.");
    if (this.reflector.getAllAndOverride<boolean | undefined>(ACCOUNT_ONLY_KEY, [ctx.getHandler(), ctx.getClass()])) {
      const u = await this.db.one<RowDataPacket>("SELECT id FROM users WHERE external_subject = ?", [claims.sub]);
      if (!u) throw new ApiError(401, "UNKNOWN_ACCOUNT", "This sign-in has no account here.");
      req.account = { userId: u.id as string, subject: claims.sub, requestId: String(req.id) };
      return true;
    }
    const orgId = req.headers["x-organization-id"];
    if (typeof orgId !== "string" || !UUID.test(orgId)) throw new ApiError(400, "ORGANIZATION_REQUIRED", "Choose an organization (X-Organization-Id).");
    const m = await this.db.one<RowDataPacket>(
      `SELECT u.id AS user_id, m.role FROM users u JOIN memberships m ON m.user_id = u.id
       WHERE u.external_subject = ? AND m.organization_id = ? AND m.status = 'ACTIVE'`, [claims.sub, orgId]);
    // the same answer whether the organization does not exist or the user is not in it: no probing of other tenants
    if (!m) throw new ApiError(403, "NOT_A_MEMBER", "You are not an active member of that organization.");
    const principal: Principal = { userId: m.user_id, subject: claims.sub, organizationId: orgId, role: m.role as Role, requestId: String(req.id) };
    // project access (ADR-057): a restricted project he is not on is "not found" on every route (before any role answer, so a refusal
    // never tells him it exists); changes need his project permission
    principal.access = await loadAccess(this.db, principal.userId, orgId, principal.role);
    await enforceProjectAccess(this.db, req, principal);
    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (allowed && !allowed.includes(principal.role)) throw new ApiError(403, "ROLE_NOT_ALLOWED", `This needs one of: ${allowed.join(", ")}.`);
    req.principal = principal;
    return true;
  }
}
