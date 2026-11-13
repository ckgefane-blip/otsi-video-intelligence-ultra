/**
 * Job tickets (ADR-146 §3–§4, central server only): the central server is the bank.
 *
 *   POST /v1/tickets         a linked desktop asks before a paid job starts: central charges its own wallet ledger and
 *                            returns an Ed25519-signed ticket (audience "otsi-vie-ticket", 7 days) the desktop's worker checks
 *   POST /v1/tickets/refund  the job was cancelled before it started, or failed: refunded once
 *   POST /v1/tickets/settle  the paid jobs the desktop ran offline, inside its licence's offline allowance: charged now,
 *                            or recorded OWED when the balance is short
 *
 * The ledger is the wallet's (WalletService.charge / refundForJob, the same idempotency keys `spend:<type>:<id>` and
 * `refund:<type>:<id>`): tickets never reimplement it. The ledger cannot go below zero (migration 0071), so a debt is an
 * OWED ticket: while any are OWED, central collects them first (oldest first) and refuses a new ticket it cannot cover
 * after that ("TOKENS_OWED"). Every ticket row is one per (organization, job type, job id): asking twice for the same job
 * returns the first ticket, freshly signed, and never charges twice.
 *
 * Everything here answers 404 unless this deployment is the central server (OTSI_VIE_CENTRAL_MODE=yes) with a licence
 * signing key: a local engine has no bank.
 */
import { Body, Controller, HttpCode, Inject, Injectable, Post, UseGuards } from "@nestjs/common";
import {
  OfflineSpend,
  TicketClaims,
  TicketRefundRequest,
  TicketRefundResponse,
  TicketRequest,
  TicketResponse,
  TicketSettleRequest,
  TicketSettleResponse,
  type WalletJobType,
} from "@otsi-vie/contracts";
import { createRemoteJWKSet, errors, importPKCS8, importSPKI, jwtVerify, type JWTPayload, type KeyLike, SignJWT } from "jose";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { CONFIG, type Config, publicKeyOf } from "../../core/config";
import { Db, type Executor } from "../../core/db";
import { ApiError } from "../../core/problem";
import { INSUFFICIENT_TOKENS, WalletService } from "../wallet/wallet";

/** The ticket's audience: never a licence, never an access token. */
export const TICKET_AUDIENCE = "otsi-vie-ticket";
/** A ticket is good for 7 days: long enough for a long analysis queued on a laptop, short enough not to be a coupon. */
export const TICKET_TTL_DAYS = 7;

const TICKET_INVALID = () => new ApiError(401, "TICKET_INVALID", "That job ticket could not be verified.");
const TICKET_EXPIRED = () => new ApiError(401, "TICKET_EXPIRED", "That job ticket has expired.");
const NOT_CENTRAL = () => new ApiError(404, "NOT_FOUND", "Not found.");

/**
 * Verify a job ticket against the central server's Ed25519 public key (the same key that verifies licences): the
 * signature, the expiry and the claims. The reference implementation of the check the worker performs.
 */
export async function verifyTicketToken(token: string, cfg: Config): Promise<TicketClaims> {
  const central = cfg.central;
  let key: KeyLike | ReturnType<typeof createRemoteJWKSet>;
  if (central?.licencePublicKeyPem) key = await importSPKI(central.licencePublicKeyPem, "EdDSA");
  else if (central?.centralJwksUrl) key = createRemoteJWKSet(new URL(central.centralJwksUrl));
  else if (central?.centralMode && central.licenceSigningKeyPem) key = await importSPKI(publicKeyOf(central.licenceSigningKeyPem), "EdDSA");
  else throw new ApiError(401, "LICENCE_NOT_CONFIGURED", "No licence verification key is configured on this engine.");
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, key as KeyLike, { issuer: cfg.jwtIssuer, audience: TICKET_AUDIENCE, algorithms: ["EdDSA"] }));
  } catch (err) {
    if (err instanceof errors.JWTExpired) throw TICKET_EXPIRED();
    throw TICKET_INVALID();
  }
  const parsed = TicketClaims.safeParse({
    ticket_id: payload.jti, organization_id: payload.organization_id, job_type: payload.job_type,
    job_id: payload.job_id, amount: payload.amount, expires_at: payload.expires_at,
  });
  if (!parsed.success) throw TICKET_INVALID();
  return parsed.data;
}

type TicketRow = { id: string; job_type: WalletJobType; job_id: string; amount: number; state: "CHARGED" | "OWED" | "REFUNDED" };

@Injectable()
export class TicketsService {
  private key: Promise<KeyLike> | undefined;

  constructor(@Inject(CONFIG) private readonly cfg: Config, private readonly db: Db, private readonly wallet: WalletService) {}

  private assertCentral(): void {
    if (!this.cfg.central?.centralMode) throw NOT_CENTRAL();
    if (!this.cfg.central.licenceSigningKeyPem) {
      throw new ApiError(503, "LICENCE_SIGNING_NOT_CONFIGURED", "This server cannot issue job tickets: no licence signing key is configured.");
    }
  }

  private signingKey(): Promise<KeyLike> {
    return (this.key ??= importPKCS8(this.cfg.central!.licenceSigningKeyPem!, "EdDSA"));
  }

  private async sign(organizationId: string, t: { id: string; job_type: WalletJobType; job_id: string; amount: number }): Promise<{ token: string; expiresAt: string }> {
    const expires = new Date(Date.now() + TICKET_TTL_DAYS * 86_400_000);
    const expiresAt = expires.toISOString();
    const token = await new SignJWT({ organization_id: organizationId, job_type: t.job_type, job_id: t.job_id, amount: t.amount, expires_at: expiresAt })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .setSubject(organizationId)
      .setIssuer(this.cfg.jwtIssuer)
      .setAudience(TICKET_AUDIENCE)
      .setIssuedAt()
      .setJti(t.id)
      .setExpirationTime(Math.floor(expires.getTime() / 1000))
      .sign(await this.signingKey());
    return { token, expiresAt };
  }

  private async ticket(ex: Executor, organizationId: string, jobType: WalletJobType, jobId: string): Promise<TicketRow | undefined> {
    const r = await this.db.one<RowDataPacket>(
      "SELECT id, job_type, job_id, amount, state FROM job_tickets WHERE organization_id = ? AND job_type = ? AND job_id = ?",
      [organizationId, jobType, jobId], ex);
    return r ? { id: String(r.id), job_type: r.job_type, job_id: String(r.job_id), amount: Number(r.amount), state: r.state } : undefined;
  }

  /** Pay OWED tickets from the balance, oldest first, while it covers them. Returns the tokens still owed. Runs inside
   *  the caller's transaction (WalletService.charge locks the organization's wallet). */
  private async collectOwed(c: Executor, p: Principal): Promise<number> {
    const owed = await this.db.rows<RowDataPacket>(
      "SELECT id, job_type, job_id, amount FROM job_tickets WHERE organization_id = ? AND state = 'OWED' ORDER BY created_at ASC, id ASC",
      [p.organizationId], c);
    let left = 0;
    for (const o of owed) {
      if (left > 0) { left += Number(o.amount); continue; }       // oldest first: a younger debt never jumps the queue
      try {
        const entry = await this.wallet.charge(c, p.organizationId, p.userId, {
          type: o.job_type, id: String(o.job_id), amount: Number(o.amount), reason: `Offline job settled: ${o.job_type} ${o.job_id}`,
        });
        await c.query("UPDATE job_tickets SET state = 'CHARGED', ledger_id = ? WHERE id = ?", [entry.id, o.id]);
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== INSUFFICIENT_TOKENS) throw e;
        left += Number(o.amount);
      }
    }
    return left;
  }

  /** POST /v1/tickets: charge the job and sign its ticket. */
  async issue(p: Principal, body: TicketRequest): Promise<TicketResponse> {
    this.assertCentral();
    const row = await this.db.tx(async (c) => {
      const existing = await this.ticket(c, p.organizationId, body.job_type, body.job_id);
      if (existing) {
        if (existing.state !== "CHARGED") throw new ApiError(409, "TICKET_NOT_ACTIVE", "This job's ticket was refunded or is still owed. Start the job again.");
        if (existing.amount !== body.amount) throw new ApiError(409, "TICKET_AMOUNT_MISMATCH", "This job already has a ticket for a different amount.");
        return existing;
      }
      const owed = await this.collectOwed(c, p);
      if (owed > 0) {
        throw new ApiError(402, "TOKENS_OWED", `${owed} tokens are still owed for work done offline. Top up your wallet to start more paid work.`);
      }
      const entry = await this.wallet.charge(c, p.organizationId, p.userId, {
        type: body.job_type, id: body.job_id, amount: body.amount, reason: `Charge for ${body.job_type} ${body.job_id}`,
      });
      const id = uuidv7();
      await c.query(
        `INSERT INTO job_tickets (id, organization_id, job_type, job_id, amount, source, state, ledger_id, requested_by)
         VALUES (?, ?, ?, ?, ?, 'ONLINE', 'CHARGED', ?, ?)`,
        [id, p.organizationId, body.job_type, body.job_id, body.amount, entry.id, p.userId]);
      await recordChange(c, userActor(p), {
        action: "ticket.issued", entityType: "job_ticket", entityId: id,
        after: { job_type: body.job_type, job_id: body.job_id, amount: body.amount },
      });
      return { id, job_type: body.job_type, job_id: body.job_id, amount: body.amount, state: "CHARGED" as const };
    });
    const { token, expiresAt } = await this.sign(p.organizationId, row);
    const balance = await this.wallet.balance(p.organizationId);
    return TicketResponse.parse({ ticket_id: row.id, ticket_token: token, expires_at: expiresAt, balance: balance.spendable_balance });
  }

  /** POST /v1/tickets/refund: a CHARGED ticket is refunded through the ledger, an OWED one is cleared. Once. */
  async refund(p: Principal, body: TicketRefundRequest): Promise<TicketRefundResponse> {
    this.assertCentral();
    const state = await this.db.tx(async (c) => {
      const t = await this.ticket(c, p.organizationId, body.job_type, body.job_id);
      if (!t || t.state === "REFUNDED") return "NONE" as const;
      if (t.state === "CHARGED") {
        await this.wallet.refundForJob(c, p.organizationId, p.userId, { type: t.job_type, id: t.job_id, reason: body.reason });
      }
      await c.query("UPDATE job_tickets SET state = 'REFUNDED' WHERE id = ?", [t.id]);
      await recordChange(c, userActor(p), {
        action: "ticket.refunded", entityType: "job_ticket", entityId: t.id,
        before: { state: t.state }, after: { state: "REFUNDED", reason: body.reason },
      });
      return "REFUNDED" as const;
    });
    const balance = await this.wallet.balance(p.organizationId);
    return TicketRefundResponse.parse({ state, balance: balance.spendable_balance });
  }

  /** POST /v1/tickets/settle: charge each offline spend once; a spend the balance cannot cover becomes OWED. */
  async settle(p: Principal, body: TicketSettleRequest): Promise<TicketSettleResponse> {
    this.assertCentral();
    const spends = [...body.spends].sort((a, b) => Date.parse(a.spent_at) - Date.parse(b.spent_at));
    const { results, owed } = await this.db.tx(async (c) => {
      let owedLeft = await this.collectOwed(c, p);
      const out: TicketSettleResponse["results"] = [];
      for (const s of spends) {
        const t = await this.ticket(c, p.organizationId, s.job_type, s.job_id);
        if (t) { out.push({ job_type: s.job_type, job_id: s.job_id, state: t.state }); continue; }
        out.push({ job_type: s.job_type, job_id: s.job_id, state: await this.settleOne(c, p, s, owedLeft > 0) });
        if (out[out.length - 1]!.state === "OWED") owedLeft += s.amount;
      }
      await recordChange(c, userActor(p), {
        action: "ticket.settled", entityType: "organization", entityId: p.organizationId,
        after: { spends: spends.length, owed: owedLeft },
      });
      return { results: out, owed: owedLeft };
    });
    const balance = await this.wallet.balance(p.organizationId);
    return TicketSettleResponse.parse({ results, owed, balance: balance.spendable_balance });
  }

  private async settleOne(c: Executor, p: Principal, s: OfflineSpend, queueBehindDebt: boolean): Promise<"CHARGED" | "OWED"> {
    const id = uuidv7();
    const spentAt = new Date(s.spent_at).toISOString().slice(0, 23).replace("T", " ");
    let ledgerId: string | null = null;
    if (!queueBehindDebt) {
      try {
        ledgerId = (await this.wallet.charge(c, p.organizationId, p.userId, {
          type: s.job_type, id: s.job_id, amount: s.amount, reason: `Offline job settled: ${s.job_type} ${s.job_id}`,
        })).id;
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== INSUFFICIENT_TOKENS) throw e;
      }
    }
    const state = ledgerId ? "CHARGED" : "OWED";
    await c.query(
      `INSERT INTO job_tickets (id, organization_id, job_type, job_id, amount, source, state, ledger_id, requested_by, spent_at)
       VALUES (?, ?, ?, ?, ?, 'OFFLINE', ?, ?, ?, ?)`,
      [id, p.organizationId, s.job_type, s.job_id, s.amount, state, ledgerId, p.userId, spentAt]);
    return state;
  }
}

/** Paid work is started by anyone who may start it locally; a VIEWER starts none. */
const PAYERS = ["OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT"] as const;

@Controller("v1/tickets")
@UseGuards(AuthGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  @HttpCode(200)
  @Roles(...PAYERS)
  issue(@CurrentPrincipal() p: Principal, @Body() body: unknown): Promise<TicketResponse> {
    return this.tickets.issue(p, TicketRequest.parse(body));
  }

  @Post("refund")
  @HttpCode(200)
  @Roles(...PAYERS)
  refund(@CurrentPrincipal() p: Principal, @Body() body: unknown): Promise<TicketRefundResponse> {
    return this.tickets.refund(p, TicketRefundRequest.parse(body));
  }

  @Post("settle")
  @HttpCode(200)
  @Roles(...PAYERS)
  settle(@CurrentPrincipal() p: Principal, @Body() body: unknown): Promise<TicketSettleResponse> {
    return this.tickets.settle(p, TicketSettleRequest.parse(body));
  }
}
