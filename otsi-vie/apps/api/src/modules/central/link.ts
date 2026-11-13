/**
 * Linked desktop (ADR-146 §1–§5): a club's laptop signs in to the central server (accounts.otsi.cc) and holds NO token
 * balance of its own. Set by OTSI_VIE_CENTRAL_SERVER_URL on an engine that is not itself the central server.
 *
 *  - Sign-in and sign-up go to central. The central user, organizations and memberships are mirrored into this database
 *    WITH THE SAME IDS, so the matches, players and reels made here belong to the organization the licence names. The
 *    central refresh token is kept SEALED (AES-256-GCM, the engine's signing key; never in clear, never logged) in
 *    `central_links`, with the last signed licence. The password is also kept as a local hash, so the person can sign in
 *    on this computer while the internet is down (ADR-146 §4 weak internet; recorded trade-off: offline sign-in uses the
 *    password only, the central two-step check needs central).
 *  - Paid work: WalletService.charge comes here. The licence gate first (no valid licence, also past the grace:
 *    402 LICENCE_REQUIRED); then a ticket from central (charged on the central ledger); when central cannot be reached,
 *    an OFFLINE spend inside the licence's offline allowance, settled later. A central charge made inside a job's
 *    transaction is refunded if that transaction rolls back (Db.onRollback), so a job that never started costs nothing.
 *  - The background sync (every 5 minutes) settles offline spends, sends refunds that could not be sent, and keeps the
 *    licence fresh.
 *
 * Nothing here runs unless the engine is linked: a local-only engine (and the central server itself) never touches it.
 */
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  LicenceClaims,
  type LicenceSnapshot,
  type MfaChallenge,
  SessionResponse,
  type TicketSettleResponse,
  type WalletJobType,
  type WalletLedgerEntry,
} from "@otsi-vie/contracts";
import { createRemoteJWKSet, importSPKI, jwtVerify, type KeyLike } from "jose";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { writeAudit } from "../../core/audit";
import { CONFIG, type Config } from "../../core/config";
import { Db, type Executor } from "../../core/db";
import { hashPassword } from "../../core/passwords";
import { ApiError } from "../../core/problem";
import { openSecret, sealSecret } from "../../core/totp";
/** The licence token audience — the same value as licence.ts LICENCE_AUDIENCE (not imported: licence.ts depends on the
 *  wallet, and the wallet depends on this module). A test checks the two stay equal. */
export const LINKED_LICENCE_AUDIENCE = "otsi-vie-licence";

/** The central server URL when this engine is a linked desktop; null for local-only and for the central server itself. */
export function linkedCentralUrl(cfg: Config): string | null {
  const c = cfg.central;
  if (!c || c.centralMode || !c.centralServerUrl) return null;
  const url = c.centralServerUrl.trim().replace(/\/+$/, "");
  if (/^https:\/\//.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) return url;
  return null; // a central server is a real domain over HTTPS (or this computer, for development); nothing else is guessed
}

/** Central could not be reached at all (network down, DNS, timeout) — not an answer from central. */
export class CentralUnreachable extends Error {}

const LICENCE_REQUIRED = () => new ApiError(402, "LICENCE_REQUIRED", "Sign in to your OTSI account to run paid work.");
const OFFLINE_ALLOWANCE_USED = () => new ApiError(402, "OFFLINE_ALLOWANCE_USED", "Connect to the internet to start more paid work.");
const SIGN_IN_FIRST = () => new ApiError(402, "LICENCE_REQUIRED", "Sign in to your OTSI account to use the token wallet.");

const REQUEST_TIMEOUT_MS = 10_000;
const SYNC_EVERY_MS = 5 * 60_000;
/** A licence older than this is refreshed by the background sync (it is good for 30 days). */
const LICENCE_REFRESH_AFTER_MS = 24 * 3_600_000;

interface CentralReply { status: number; body: any; setCookie: string[]; rawBody?: Buffer; contentType?: string | null; contentDisposition?: string | null }
interface Link { userId: string; organizationId: string; refreshSealed: string; licenceToken: string | null; updatedAt: number }
export interface LicenceState { state: "valid" | "in-grace" | "none"; claims: LicenceClaims | null }

/** A date read back from either database (MySQL "YYYY-MM-DD HH:MM:SS.ffffff" UTC, SQLite the same or epoch ms). */
function fromDb(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  const t = String(v).trim();
  if (/^\d+$/.test(t)) return new Date(Number(t));
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(t);
  if (m) return new Date(`${m[1]}T${m[2]}${(m[3] ?? "").slice(0, 4)}${m[4] ?? "Z"}`);
  return new Date(t);
}

function refreshFrom(setCookie: string[]): string | null {
  for (const c of setCookie) {
    const m = /(?:__Host-)?otsi_vie_refresh=([^;]*)/.exec(c);
    if (m) {
      try { return decodeURIComponent(m[1]!) || null; } catch { return null; }
    }
  }
  return null;
}

@Injectable()
export class CentralLinkService implements OnModuleInit, OnModuleDestroy {
  readonly url: string | null;
  private readonly access = new Map<string, { token: string; until: number }>();
  private readonly refreshing = new Map<string, Promise<string>>();
  private timer: NodeJS.Timeout | undefined;
  private key: Promise<KeyLike | ReturnType<typeof createRemoteJWKSet>> | undefined;

  constructor(@Inject(CONFIG) private readonly cfg: Config, private readonly db: Db) {
    this.url = linkedCentralUrl(cfg);
  }

  get linked(): boolean { return this.url !== null; }

  onModuleInit(): void {
    if (!this.linked) return;
    this.timer = setInterval(() => { void this.syncAll().catch(() => undefined); }, SYNC_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private get sealKey(): string {
    const k = this.cfg.localAuth?.signingKeyPem;
    if (!k) throw new ApiError(503, "LOCAL_AUTH_NOT_CONFIGURED", "This engine has no local sign-in key.");
    return k;
  }

  // ---- HTTP to central ------------------------------------------------------------------------------------------

  /** One request to central. A network failure or timeout is CentralUnreachable; any HTTP answer is returned.
   *  With `rawResponse` the answer is returned as bytes (a receipt download is a file, not JSON). */
  async http(method: string, path: string, opts: { json?: unknown; raw?: { body: Buffer; headers: Record<string, string> }; bearer?: string; orgId?: string; refresh?: string; csrf?: boolean; rawResponse?: boolean } = {}): Promise<CentralReply> {
    if (!this.url) throw new ApiError(404, "NOT_FOUND", "Not found.");
    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.json !== undefined) headers["content-type"] = "application/json";
    if (opts.raw) Object.assign(headers, opts.raw.headers);
    if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    if (opts.orgId) headers["x-organization-id"] = opts.orgId;
    if (opts.csrf || opts.refresh !== undefined) headers["x-otsi-csrf"] = "1";
    if (opts.refresh !== undefined) headers.cookie = `otsi_vie_refresh=${encodeURIComponent(opts.refresh)}; __Host-otsi_vie_refresh=${encodeURIComponent(opts.refresh)}`;
    let res: Response;
    try {
      res = await fetch(`${this.url}${path}`, {
        method, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...(opts.json !== undefined ? { body: JSON.stringify(opts.json) } : opts.raw ? { body: opts.raw.body } : {}),
      });
    } catch {
      throw new CentralUnreachable(`central server ${this.url} could not be reached`);
    }
    const text = opts.rawResponse ? null : await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
    if (opts.rawResponse) {
      return { status: res.status, body: null, setCookie, rawBody: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get("content-type"), contentDisposition: res.headers.get("content-disposition") };
    }
    return { status: res.status, body, setCookie };
  }

  /** Central's own error, passed on with its status, code and message. */
  private fail(r: CentralReply): never {
    const b = (r.body ?? {}) as { code?: string; message?: string };
    throw new ApiError(r.status >= 400 && r.status < 600 ? r.status : 502, b.code ?? "CENTRAL_ERROR", b.message ?? "The OTSI account server refused the request.");
  }

  // ---- sign-in, sign-up -----------------------------------------------------------------------------------------

  /** Sign in at central. A session is mirrored here (returns the user id); a two-step challenge is passed back as is. */
  async signIn(email: string, password: string): Promise<{ userId: string } | { challenge: MfaChallenge }> {
    const r = await this.http("POST", "/v1/auth/login", { json: { email, password }, csrf: true });
    if (r.status !== 200) this.fail(r);
    if (r.body && typeof r.body.mfa_token === "string") return { challenge: r.body as MfaChallenge };
    return { userId: await this.adopt(r, password) };
  }

  async signInSecondStep(mfaToken: string, code: string): Promise<{ userId: string }> {
    const r = await this.http("POST", "/v1/auth/login/two-step", { json: { mfa_token: mfaToken, code }, csrf: true });
    if (r.status !== 200) this.fail(r);
    return { userId: await this.adopt(r, null) };
  }

  /** Create the OTSI account and organization at central (public sign-up), then mirror it here. */
  async signUp(body: { email: string; display_name: string; organization_name: string; password: string }): Promise<{ userId: string }> {
    const r = await this.http("POST", "/v1/auth/sign-up", { json: body, csrf: true });
    if (r.status !== 200) this.fail(r);
    return { userId: await this.adopt(r, body.password) };
  }

  /**
   * Mirror the central session here: the user, the organizations and memberships (same ids), the sealed refresh token
   * per organization, and a local password hash for offline sign-in. Then fetch each organization's licence.
   */
  private async adopt(r: CentralReply, password: string | null): Promise<string> {
    const session = SessionResponse.parse(r.body);
    const refresh = refreshFrom(r.setCookie);
    if (!refresh) throw new ApiError(502, "CENTRAL_NO_SESSION", "The OTSI account server did not start a session.");
    const user = session.me.user;
    const email = user.email.trim().toLowerCase();
    const hash = password ? await hashPassword(password) : null;
    await this.db.tx(async (c) => {
      const clash = await this.db.one<RowDataPacket>(
        "SELECT user_id FROM local_credentials WHERE email_normalized = ? AND user_id <> ?", [email, user.id], c);
      if (clash) {
        throw new ApiError(409, "LOCAL_ACCOUNT_EXISTS",
          "This computer already has a separate local account with that email. Sign in with it, or use another email for your OTSI account.");
      }
      const existing = await this.db.one<RowDataPacket>("SELECT id FROM users WHERE id = ?", [user.id], c);
      if (existing) await c.query("UPDATE users SET email = ?, display_name = ? WHERE id = ?", [email, user.display_name, user.id]);
      else await c.query("INSERT INTO users (id, external_subject, email, display_name) VALUES (?, ?, ?, ?)", [user.id, `central:${user.id}`, email, user.display_name]);
      for (const m of session.me.memberships) {
        const org = await this.db.one<RowDataPacket>("SELECT id FROM organizations WHERE id = ?", [m.organization_id], c);
        if (org) await c.query("UPDATE organizations SET name = ? WHERE id = ?", [m.organization_name, m.organization_id]);
        else {
          await c.query("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", [m.organization_id, m.organization_name, `central-${m.organization_id}`]);
          await writeAudit(c, { kind: "SYSTEM", service: "central-link", organizationId: m.organization_id },
            { action: "organization.linked", entityType: "organization", entityId: m.organization_id, after: { name: m.organization_name } });
        }
        const mem = await this.db.one<RowDataPacket>("SELECT role FROM memberships WHERE organization_id = ? AND user_id = ?", [m.organization_id, user.id], c);
        if (mem) await c.query("UPDATE memberships SET role = ?, status = 'ACTIVE' WHERE organization_id = ? AND user_id = ?", [m.role, m.organization_id, user.id]);
        else await c.query("INSERT INTO memberships (organization_id, user_id, role, status) VALUES (?, ?, ?, 'ACTIVE')", [m.organization_id, user.id, m.role]);
        await this.storeLink(c, user.id, m.organization_id, refresh);
      }
      if (hash) {
        const cred = await this.db.one<RowDataPacket>("SELECT user_id FROM local_credentials WHERE user_id = ?", [user.id], c);
        if (cred) await c.query("UPDATE local_credentials SET email_normalized = ?, password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE user_id = ?", [email, hash, user.id]);
        else await c.query("INSERT INTO local_credentials (user_id, email_normalized, password_hash) VALUES (?, ?, ?)", [user.id, email, hash]);
      }
    });
    // memberships this person no longer has at central stop working here too
    const ids = session.me.memberships.map((m) => m.organization_id);
    const [gone] = await this.db.pool.query<RowDataPacket[]>(
      "SELECT organization_id FROM central_links WHERE user_id = ?", [user.id]);
    for (const g of gone) {
      if (ids.includes(String(g.organization_id))) continue;
      await this.db.pool.query("UPDATE memberships SET status = 'SUSPENDED' WHERE organization_id = ? AND user_id = ?", [g.organization_id, user.id]).catch(() => undefined);
      await this.db.pool.query("DELETE FROM central_links WHERE organization_id = ? AND user_id = ?", [g.organization_id, user.id]);
    }
    this.access.set(user.id, { token: session.access_token, until: Date.now() + (session.expires_in - 30) * 1000 });
    for (const m of session.me.memberships) await this.refreshLicence(user.id, m.organization_id).catch(() => undefined);
    return user.id;
  }

  private async storeLink(ex: Executor, userId: string, orgId: string, refresh: string): Promise<void> {
    const sealed = sealSecret(Buffer.from(refresh, "utf8"), userId, this.sealKey);
    const row = await this.db.one<RowDataPacket>("SELECT user_id FROM central_links WHERE user_id = ? AND organization_id = ?", [userId, orgId], ex);
    if (row) await ex.query("UPDATE central_links SET refresh_sealed = ?, central_url = ? WHERE user_id = ? AND organization_id = ?", [sealed, this.url, userId, orgId]);
    else await ex.query("INSERT INTO central_links (user_id, organization_id, central_url, refresh_sealed) VALUES (?, ?, ?, ?)", [userId, orgId, this.url, sealed]);
  }

  // ---- the central session --------------------------------------------------------------------------------------

  /** The link to use for an organization: the given person's own, else any member's (a background refund has no person). */
  private async link(orgId: string, userId: string | null, ex: Executor = this.db.pool): Promise<Link | null> {
    const r = await this.db.one<RowDataPacket>(
      `SELECT user_id, organization_id, refresh_sealed, licence_token, updated_at FROM central_links
        WHERE organization_id = ? ORDER BY (user_id = ?) DESC, updated_at DESC LIMIT 1`, [orgId, userId ?? ""], ex);
    if (!r) return null;
    return { userId: String(r.user_id), organizationId: String(r.organization_id), refreshSealed: String(r.refresh_sealed),
      licenceToken: r.licence_token ? String(r.licence_token) : null, updatedAt: fromDb(r.updated_at).getTime() || 0 };
  }

  /** A live central access token for this link: the cached one, else a refresh (which rotates the refresh token). */
  private async accessToken(link: Link): Promise<string> {
    const hit = this.access.get(link.userId);
    if (hit && hit.until > Date.now()) return hit.token;
    const running = this.refreshing.get(link.userId);
    if (running) return running;
    const p = (async () => {
      const refresh = openSecret(link.refreshSealed, link.userId, this.sealKey).toString("utf8");
      const r = await this.http("POST", "/v1/auth/refresh", { refresh });
      if (r.status !== 200) {
        // the central session ended (signed out elsewhere, expired): this computer must sign in again
        if (r.status === 401) await this.db.pool.query("DELETE FROM central_links WHERE user_id = ?", [link.userId]);
        this.fail(r);
      }
      const next = refreshFrom(r.setCookie);
      const s = SessionResponse.parse(r.body);
      if (next) {
        const sealed = sealSecret(Buffer.from(next, "utf8"), link.userId, this.sealKey);
        await this.db.pool.query("UPDATE central_links SET refresh_sealed = ? WHERE user_id = ?", [sealed, link.userId]);
      }
      this.access.set(link.userId, { token: s.access_token, until: Date.now() + (s.expires_in - 30) * 1000 });
      return s.access_token;
    })().finally(() => this.refreshing.delete(link.userId));
    this.refreshing.set(link.userId, p);
    return p;
  }

  /** Call central as a member of `orgId`. 401 once: the token is renewed and the call repeated. */
  async call(orgId: string, userId: string | null, method: string, path: string, json?: unknown, ex?: Executor,
             raw?: { body: Buffer; headers: Record<string, string> }, rawResponse = false): Promise<CentralReply> {
    const link = await this.link(orgId, userId, ex);
    if (!link) throw SIGN_IN_FIRST();
    const send = async () => this.http(method, path, { bearer: await this.accessToken(link), orgId, ...(json !== undefined ? { json } : {}), ...(raw ? { raw } : {}), rawResponse });
    let r = await send();
    if (r.status === 401) {
      this.access.delete(link.userId);
      r = await send();
    }
    return r;
  }

  /** Forward one of this engine's wallet / billing / licence requests to central and return central's answer. */
  async forward(orgId: string, userId: string, method: string, pathAndQuery: string, json: unknown,
                raw?: { body: Buffer; headers: Record<string, string> }): Promise<{ status: number; body: unknown }> {
    let r: CentralReply;
    try {
      const bodyless = method === "GET" || method === "HEAD" || raw !== undefined;
      r = await this.call(orgId, userId, method, pathAndQuery, bodyless ? undefined : (json ?? {}), undefined, raw);
    } catch (e) {
      if (e instanceof CentralUnreachable) throw new ApiError(503, "CENTRAL_UNREACHABLE", "Your OTSI account cannot be reached. Check the internet connection.");
      throw e;
    }
    if (r.status >= 400) this.fail(r);
    return { status: r.status, body: r.body };
  }

  /** Forward a receipt download to central and return its bytes (a proof is a file, not JSON). An error answer
   *  from central is surfaced with its own code and message, not sent as a file. */
  async forwardBytes(orgId: string, userId: string, method: string, pathAndQuery: string): Promise<{ status: number; body: Buffer; contentType: string | null; contentDisposition: string | null }> {
    let r: CentralReply;
    try {
      r = await this.call(orgId, userId, method, pathAndQuery, undefined, undefined, undefined, true);
    } catch (e) {
      if (e instanceof CentralUnreachable) throw new ApiError(503, "CENTRAL_UNREACHABLE", "Your OTSI account cannot be reached. Check the internet connection.");
      throw e;
    }
    if (r.status >= 400) {
      let parsed: unknown = null;
      try { parsed = r.rawBody ? JSON.parse(r.rawBody.toString("utf8")) : null; } catch { parsed = null; }
      this.fail({ status: r.status, body: parsed, setCookie: [] });
    }
    if (!r.rawBody) throw new ApiError(502, "CENTRAL_ERROR", "The OTSI account server sent no receipt.");
    return { status: r.status, body: r.rawBody, contentType: r.contentType ?? null, contentDisposition: r.contentDisposition ?? null };
  }

  // ---- the licence ----------------------------------------------------------------------------------------------

  async refreshLicence(userId: string, orgId: string): Promise<void> {
    const link = await this.link(orgId, userId);
    if (!link) return;
    const refresh = openSecret(link.refreshSealed, link.userId, this.sealKey).toString("utf8");
    const r = await this.http("POST", "/v1/licence/refresh", { refresh, orgId });
    if (r.status !== 200 || typeof r.body?.licence_token !== "string") return;
    // the licence refresh does not rotate the session, so the stored refresh token stays as it is
    await this.db.pool.query(
      "UPDATE central_links SET licence_token = ?, licence_expires_at = ? WHERE organization_id = ?",
      [r.body.licence_token, new Date(r.body.expires_at), orgId]);
  }

  private verifyKey(): Promise<KeyLike | ReturnType<typeof createRemoteJWKSet>> {
    const c = this.cfg.central;
    return (this.key ??= (async () => {
      if (c?.licencePublicKeyPem) return importSPKI(c.licencePublicKeyPem, "EdDSA");
      if (c?.centralJwksUrl) return createRemoteJWKSet(new URL(c.centralJwksUrl));
      throw new ApiError(503, "LICENCE_NOT_CONFIGURED", "No licence verification key is configured on this engine.");
    })());
  }

  /** GET /v1/licence while central cannot be reached: the snapshot of the signed licence kept on this computer
   *  (verified with central's key, valid or in its grace), or null when there is none. Offline, the licence is good
   *  on this computer until the signed copy expires, so that instant is valid_until here. */
  async offlineSnapshot(orgId: string): Promise<LicenceSnapshot | null> {
    const { claims } = await this.licence(orgId);
    if (!claims) return null;
    const graceMs = (this.cfg.central?.licenceGraceDays ?? 14) * 86_400_000;
    const { expires_at, ...rest } = claims;
    return { ...rest, valid_until: expires_at, grace_until: new Date(Date.parse(expires_at) + graceMs).toISOString() };
  }

  /** The organization's licence on this computer: valid, in its offline grace, or none. Verified, never a flag. */
  async licence(orgId: string, ex: Executor = this.db.pool): Promise<LicenceState> {
    const r = await this.db.one<RowDataPacket>(
      "SELECT licence_token FROM central_links WHERE organization_id = ? AND licence_token IS NOT NULL ORDER BY licence_expires_at DESC LIMIT 1", [orgId], ex);
    if (!r) return { state: "none", claims: null };
    const key = await this.verifyKey().catch(() => null);
    if (!key) return { state: "none", claims: null };
    const graceMs = (this.cfg.central?.licenceGraceDays ?? 14) * 86_400_000;
    for (const [state, at] of [["valid", new Date()], ["in-grace", new Date(Date.now() - graceMs)]] as const) {
      try {
        const { payload } = await jwtVerify(String(r.licence_token), key as KeyLike,
          // the central server's own issuer name is not known here: its Ed25519 key is the proof, the audience the kind
          { audience: LINKED_LICENCE_AUDIENCE, algorithms: ["EdDSA"], currentDate: at });
        const claims = LicenceClaims.safeParse({ organization_id: payload.organization_id, plan: payload.plan, features: payload.features,
          tokens: payload.tokens, offline_allowance: payload.offline_allowance, expires_at: payload.expires_at });
        if (claims.success && claims.data.organization_id === orgId) return { state, claims: claims.data };
        return { state: "none", claims: null };
      } catch { /* try the grace, then none */ }
    }
    return { state: "none", claims: null };
  }

  // ---- paid work ------------------------------------------------------------------------------------------------

  /** WalletService.charge on a linked desktop: the licence gate, then a central ticket, or an offline spend. */
  async charge(ex: Executor, orgId: string, actorId: string | null, job: { type: WalletJobType; id: string; amount: number; reason?: string }): Promise<WalletLedgerEntry> {
    const existing = await this.db.one<RowDataPacket>(
      "SELECT id, amount, state FROM linked_job_tickets WHERE organization_id = ? AND job_type = ? AND job_id = ?", [orgId, job.type, job.id], ex);
    if (existing && (existing.state === "ACTIVE" || existing.state === "SETTLED")) return this.entry(orgId, String(existing.id), job, 0);
    if (existing) throw new ApiError(409, "TICKET_NOT_ACTIVE", "This job's tokens were already returned. Start the job again.");
    const lic = await this.licence(orgId, ex);
    if (lic.state === "none") throw LICENCE_REQUIRED();
    const id = uuidv7();
    let r: CentralReply;
    try {
      r = await this.call(orgId, actorId, "POST", "/v1/tickets", { job_type: job.type, job_id: job.id, amount: job.amount }, ex);
    } catch (e) {
      if (!(e instanceof CentralUnreachable)) throw e;
      // offline: inside the licence's allowance, counting what is not settled yet
      const open = await this.db.one<RowDataPacket>(
        "SELECT COALESCE(SUM(amount), 0) AS n FROM linked_job_tickets WHERE organization_id = ? AND source = 'OFFLINE' AND state = 'ACTIVE'", [orgId], ex);
      if (Number(open?.n ?? 0) + job.amount > (lic.claims?.offline_allowance ?? 0)) throw OFFLINE_ALLOWANCE_USED();
      await ex.query(
        "INSERT INTO linked_job_tickets (id, organization_id, job_type, job_id, amount, source, state, actor_id) VALUES (?, ?, ?, ?, ?, 'OFFLINE', 'ACTIVE', ?)",
        [id, orgId, job.type, job.id, job.amount, actorId]);
      return this.entry(orgId, id, job, 0);
    }
    if (r.status !== 200) this.fail(r);
    await ex.query(
      "INSERT INTO linked_job_tickets (id, organization_id, job_type, job_id, amount, source, state, ticket_token, actor_id) VALUES (?, ?, ?, ?, ?, 'ONLINE', 'ACTIVE', ?, ?)",
      [id, orgId, job.type, job.id, job.amount, String(r.body.ticket_token), actorId]);
    // the job's transaction may still roll back (the job is not created): then the central charge goes back
    this.db.onRollback(ex, () => this.call(orgId, actorId, "POST", "/v1/tickets/refund",
      { job_type: job.type, job_id: job.id, reason: "The job did not start, so its tokens were returned." }));
    return this.entry(orgId, id, job, Number(r.body.balance ?? 0));
  }

  /** WalletService.refundForJob on a linked desktop. Null when there was nothing to refund. */
  async refund(ex: Executor, orgId: string, actorId: string | null, job: { type: WalletJobType; id: string; reason: string }): Promise<WalletLedgerEntry | null> {
    const t = await this.db.one<RowDataPacket>(
      "SELECT id, amount, source, state FROM linked_job_tickets WHERE organization_id = ? AND job_type = ? AND job_id = ?", [orgId, job.type, job.id], ex);
    if (!t || t.state === "REFUNDED" || t.state === "REFUND_PENDING") return null;
    if (t.source === "OFFLINE" && t.state === "ACTIVE") {
      // never sent to central: nothing was charged there, so nothing goes back — it is simply not settled
      await ex.query("UPDATE linked_job_tickets SET state = 'REFUNDED' WHERE id = ?", [t.id]);
    } else {
      let sent = false;
      try {
        const r = await this.call(orgId, actorId, "POST", "/v1/tickets/refund", { job_type: job.type, job_id: job.id, reason: job.reason }, ex);
        if (r.status !== 200) this.fail(r);
        sent = true;
      } catch (e) {
        if (!(e instanceof CentralUnreachable)) throw e;
      }
      await ex.query("UPDATE linked_job_tickets SET state = ? WHERE id = ?", [sent ? "REFUNDED" : "REFUND_PENDING", t.id]);
    }
    return this.entry(orgId, String(t.id), { ...job, amount: -Number(t.amount) }, 0, "REFUND");
  }

  /** What the call sites get back: a ledger-shaped receipt (the ledger itself is central's). */
  private entry(orgId: string, id: string, job: { type: WalletJobType; id: string; amount: number; reason?: string }, balanceAfter: number, kind: "SPEND" | "REFUND" = "SPEND"): WalletLedgerEntry {
    const amount = kind === "SPEND" ? -Math.abs(job.amount) : Math.abs(job.amount);
    return {
      id, organization_id: orgId, kind, amount, balance_after: Math.max(0, balanceAfter), job_type: job.type, job_id: job.id,
      idempotency_key: `${kind === "SPEND" ? "spend" : "refund"}:${job.type}:${job.id}`, invoice_ref: null,
      reason: job.reason ?? null, actor_id: null, expires_at: null, created_at: new Date().toISOString(),
    } as WalletLedgerEntry;
  }

  // ---- background sync ------------------------------------------------------------------------------------------

  /** Settle offline spends, send waiting refunds, keep licences fresh — for every linked organization. */
  async syncAll(): Promise<void> {
    if (!this.linked) return;
    const [orgs] = await this.db.pool.query<RowDataPacket[]>("SELECT DISTINCT organization_id FROM central_links");
    for (const o of orgs) await this.sync(String(o.organization_id)).catch(() => undefined);
  }

  async sync(orgId: string): Promise<{ settled: number; owed: number } | null> {
    const link = await this.link(orgId, null);
    if (!link) return null;
    // refunds that could not be sent
    const [waiting] = await this.db.pool.query<RowDataPacket[]>(
      "SELECT id, job_type, job_id FROM linked_job_tickets WHERE organization_id = ? AND state = 'REFUND_PENDING'", [orgId]);
    for (const w of waiting) {
      const r = await this.call(orgId, null, "POST", "/v1/tickets/refund", { job_type: w.job_type, job_id: w.job_id, reason: "Job failed or was cancelled (sent when back online)." });
      if (r.status === 200) await this.db.pool.query("UPDATE linked_job_tickets SET state = 'REFUNDED' WHERE id = ?", [w.id]);
    }
    // offline spends
    const [open] = await this.db.pool.query<RowDataPacket[]>(
      "SELECT id, job_type, job_id, amount, spent_at FROM linked_job_tickets WHERE organization_id = ? AND source = 'OFFLINE' AND state = 'ACTIVE' ORDER BY spent_at ASC LIMIT 100", [orgId]);
    let out: { settled: number; owed: number } = { settled: 0, owed: 0 };
    if (open.length > 0) {
      const spends = open.map((s) => ({ job_type: s.job_type, job_id: String(s.job_id), amount: Number(s.amount),
        spent_at: fromDb(s.spent_at).toISOString() }));
      const r = await this.call(orgId, null, "POST", "/v1/tickets/settle", { spends });
      if (r.status !== 200) this.fail(r);
      const body = r.body as TicketSettleResponse;
      for (const s of open) {
        await this.db.pool.query("UPDATE linked_job_tickets SET state = 'SETTLED', settled_at = ? WHERE id = ?", [new Date(), s.id]);
      }
      out = { settled: open.length, owed: body.owed };
    }
    if (Date.now() - link.updatedAt > LICENCE_REFRESH_AFTER_MS || !link.licenceToken) await this.refreshLicence(link.userId, orgId).catch(() => undefined);
    return out;
  }
}
