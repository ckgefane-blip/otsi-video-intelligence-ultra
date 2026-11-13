/**
 * Token Wallet & Credit System (ADR-140, ultra-only; scope: token-wallet-scope.md).
 * 1 token = 1 minute of footage analysed; reel render, player report and export pack cost 10 each.
 * The wallet belongs to the organization. The balance is DERIVED from wallet_ledger — this module never stores
 * a balance column; every mutation appends one immutable ledger row and records the balance after it.
 * Bank transfer only: there is no payment gateway code anywhere in this build.
 *
 * Concurrency: a charge and a credit for one organization must never interleave, or two charges could both
 * pass on the same balance. Every mutation locks the organization's own row (`SELECT ... FOR UPDATE` on
 * `organizations`) before it reads the ledger: the lock is transactional, so it is held until the transaction
 * commits or rolls back, on whatever pooled connection runs it. (A named GET_LOCK was not used: it is held by
 * the session, not the transaction, and would leak across pooled connections.)
 * Idempotency: a SPEND carries `spend:<jobType>:<jobId>` and a REFUND `refund:<jobType>:<jobId>`; charging or
 * refunding the same job twice returns the first row instead of moving tokens again.
 */
import { Body, Controller, Get, Inject, Injectable, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  AdminWalletAdjustmentRequest,
  AdminWalletCreditRequest,
  AdminWalletRow,
  ConfirmReceiptRequest,
  FREE_GRANT_EXPIRY_DAYS,
  FREE_GRANT_TOKENS,
  IssueInvoiceRequest,
  PACK_EXPIRY_MONTHS,
  PackRequest,
  PackRequestPayment,
  PAY_REFERENCE_NOTE,
  RequestPackRequest,
  TokenPackCatalogue,
  WalletBalance,
  WalletLedgerEntry,
  WalletLedgerPage,
  chargeRefusal,
  deriveWalletBalance,
  expiredCreditTokens,
  tokenPack,
  tokenPackCatalogue,
  type WalletJobType,
} from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, isCompanyOrg, Principal, requireCompanyOrg, Roles } from "../../core/auth";
import { CONFIG, type Config } from "../../core/config";
import { Db, type Executor } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";

export const INSUFFICIENT_TOKENS = "INSUFFICIENT_TOKENS";

/** ADR-140 §8: this codebase has no platform-wide owner role — Admin is the organization's own OWNER / ADMIN
 *  (the same scoping as AdminController). Wallet Admin therefore acts only on the caller's own organization,
 *  EXCEPT the company billing actions (invoice or confirm a token pack, top up a wallet, refund or adjust a
 *  wallet, expire credits): those are the company organisation's alone. The company organisation is the one
 *  named by the server setting OTSI_VIE_COMPANY_ORG_ID (never hard-coded); `requireCompanyOrg` refuses
 *  everybody else, and refuses everybody at all when the setting is missing (fail closed).
 *
 *  The READS follow the same rule the other way round (the visibility fix, as in billing.ts): the company
 *  org's Admin › Billing reads — the pack-request list, the wallet list, one wallet's ledger — show EVERY
 *  customer's rows, with the customer's name on each one. A customer org's reads show only its own.
 *  Without this, OTSI could top up or refund a club's wallet but never see it, so no pack payment could
 *  ever be confirmed in practice. `isCompanyOrg` is the read-side check; it is false when the setting
 *  is missing, so a read never silently widens to all organisations. */
function ownOrgOrDeny(p: Principal, organizationId: string): void {
  if (organizationId !== p.organizationId) throw new ApiError(403, "WALLET_ADMIN_OTHER_ORG", "Wallet Admin acts only on your own organization.");
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

function toDbDate(iso: string | null): string | null {
  if (!iso) return null;
  return iso.replace("T", " ").replace("Z", "").slice(0, 19) + ".000000";
}

function rowToEntry(r: RowDataPacket): WalletLedgerEntry {
  return WalletLedgerEntry.parse({
    id: r.id,
    organization_id: r.organization_id,
    kind: r.kind,
    amount: Number(r.amount),
    balance_after: Number(r.balance_after),
    job_type: r.job_type ?? null,
    job_id: r.job_id ?? null,
    idempotency_key: r.idempotency_key,
    invoice_ref: r.invoice_ref ?? null,
    reason: r.reason ?? null,
    actor_id: r.actor_id ?? null,
    expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
    created_at: new Date(r.created_at).toISOString(),
  });
}

@Injectable()
export class WalletService {
  /** The company organisation id from the server setting (OTSI_VIE_COMPANY_ORG_ID); undefined when the
   *  setting is absent, in which case the company billing actions are refused for everybody. */
  private readonly companyOrgId: string | undefined;

  constructor(
    private readonly db: Db,
    @Inject(CONFIG) cfg: Config,
  ) {
    this.companyOrgId = cfg.companyOrganizationId;
  }

  /** Every ledger row of an organization, oldest first. The caller holds the wallet lock when mutating. */
  async ledgerRows(organizationId: string, ex: Executor = this.db.pool): Promise<WalletLedgerEntry[]> {
    const rows = await this.db.rows<RowDataPacket>(
      "SELECT * FROM wallet_ledger WHERE organization_id = ? ORDER BY created_at ASC, id ASC",
      [organizationId],
      ex,
    );
    return rows.map(rowToEntry);
  }

  async balance(organizationId: string, nowIso: string = new Date().toISOString()): Promise<WalletBalance> {
    return deriveWalletBalance(organizationId, await this.ledgerRows(organizationId), nowIso);
  }

  /** Serialize mutations for one organization: lock its organizations row for the transaction. A charge that
   *  runs while another transaction holds the row waits for it (MySQL lock wait), so two charges can never both
   *  pass on the same balance. */
  private async lockWallet(ex: Executor, organizationId: string): Promise<void> {
    await ex.query<RowDataPacket[]>("SELECT id FROM organizations WHERE id = ? FOR UPDATE", [organizationId]);
  }

  private async append(
    ex: Executor,
    organizationId: string,
    actorId: string | null,
    row: {
      kind: WalletLedgerEntry["kind"];
      amount: number;
      jobType?: WalletJobType | null;
      jobId?: string | null;
      idempotencyKey: string;
      invoiceRef?: string | null;
      reason?: string | null;
      expiresAt?: string | null;
    },
  ): Promise<WalletLedgerEntry> {
    const entries = await this.ledgerRows(organizationId, ex);
    const balanceAfter = entries.reduce((sum, e) => sum + e.amount, 0) + row.amount;
    if (balanceAfter < 0) throw new ApiError(409, "WALLET_WOULD_GO_NEGATIVE", "This would take the wallet below zero. It was not written.");
    const id = uuidv7();
    await ex.query(
      `INSERT INTO wallet_ledger (id, organization_id, kind, amount, balance_after, job_type, job_id, idempotency_key, invoice_ref, reason, actor_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, organizationId, row.kind, row.amount, balanceAfter, row.jobType ?? null, row.jobId ?? null, row.idempotencyKey,
       row.invoiceRef ?? null, row.reason ?? null, actorId, toDbDate(row.expiresAt ?? null)],
    );
    return rowToEntry({
      id, organization_id: organizationId, kind: row.kind, amount: row.amount, balance_after: balanceAfter,
      job_type: row.jobType ?? null, job_id: row.jobId ?? null, idempotency_key: row.idempotencyKey,
      invoice_ref: row.invoiceRef ?? null, reason: row.reason ?? null, actor_id: actorId,
      expires_at: row.expiresAt ?? null, created_at: new Date().toISOString(),
    } as RowDataPacket);
  }

  /**
   * Charge `amount` tokens for one job, inside the caller's transaction (so a job that fails to enqueue charges
   * nothing: the ledger row rolls back with it). Throws 402 INSUFFICIENT_TOKENS when the spendable balance does
   * not cover it. Charging the same job twice returns the first SPEND row.
   */
  async charge(
    ex: Executor,
    organizationId: string,
    actorId: string | null,
    job: { type: WalletJobType; id: string; amount: number; reason?: string },
  ): Promise<WalletLedgerEntry> {
    await this.lockWallet(ex, organizationId);
    const key = `spend:${job.type}:${job.id}`;
    const existing = await this.db.one<RowDataPacket>(
      "SELECT * FROM wallet_ledger WHERE organization_id = ? AND idempotency_key = ?", [organizationId, key], ex);
    if (existing) return rowToEntry(existing);
    const entries = await this.ledgerRows(organizationId, ex);
    const refusal = chargeRefusal(entries, job.amount);
    if (refusal) throw new ApiError(402, INSUFFICIENT_TOKENS, `${refusal} See the Wallet page to buy tokens.`);
    const entry = await this.append(ex, organizationId, actorId, {
      kind: "SPEND", amount: -job.amount, jobType: job.type, jobId: job.id, idempotencyKey: key,
      reason: job.reason ?? `Charge for ${job.type} ${job.id}`,
    });
    return entry;
  }

  /**
   * Auto-refund for a job that failed before producing output (scope §2): returns the SPEND's tokens as a
   * REFUND row. Returns null when the job was never charged or was already refunded. The refunded tokens carry
   * no expiry (ADR-140 §5): the expiry of the credit they came from is not tracked per token, and a refund is
   * an owner-visible ledger row, so silently extending an expiry by a refund is the documented trade-off.
   * The worker that marks a run/render FAILED is the Python worker (services/worker), not this API — it does not
   * call this. The API paths that fail synchronously call it directly, and the Jobs Center list reconciles
   * the worker's failures (JobsService.reconcileFailedRefunds, ADR-140 §7): a FAILED analysis or render that
   * was charged is refunded when the list is next read, so the refund lands within seconds of the failure.
   */
  async refundForJob(
    ex: Executor,
    organizationId: string,
    actorId: string | null,
    job: { type: WalletJobType; id: string; reason: string },
  ): Promise<WalletLedgerEntry | null> {
    await this.lockWallet(ex, organizationId);
    const spend = await this.db.one<RowDataPacket>(
      "SELECT * FROM wallet_ledger WHERE organization_id = ? AND idempotency_key = ?", [organizationId, `spend:${job.type}:${job.id}`], ex);
    if (!spend) return null;
    const already = await this.db.one<RowDataPacket>(
      "SELECT id FROM wallet_ledger WHERE organization_id = ? AND idempotency_key = ?", [organizationId, `refund:${job.type}:${job.id}`], ex);
    if (already) return null;
    return this.append(ex, organizationId, actorId, {
      kind: "REFUND", amount: -Number(spend.amount), jobType: job.type, jobId: job.id,
      idempotencyKey: `refund:${job.type}:${job.id}`, reason: job.reason,
    });
  }

  /** A credit that is not a job refund: PURCHASE, FREE_GRANT or ADJUSTMENT. */
  async credit(
    ex: Executor,
    organizationId: string,
    actorId: string,
    row: {
      kind: "PURCHASE" | "FREE_GRANT" | "REFUND" | "ADJUSTMENT";
      amount: number;
      idempotencyKey: string;
      invoiceRef?: string | null;
      reason: string;
      expiresAt?: string | null;
    },
  ): Promise<WalletLedgerEntry> {
    await this.lockWallet(ex, organizationId);
    const existing = await this.db.one<RowDataPacket>(
      "SELECT * FROM wallet_ledger WHERE organization_id = ? AND idempotency_key = ?", [organizationId, row.idempotencyKey], ex);
    if (existing) return rowToEntry(existing);
    return this.append(ex, organizationId, actorId, { ...row });
  }

  /** The one-time 25-token free grant (scope §4). One per organization, enforced by wallet_free_grants. */
  async grantFreeTier(p: Principal): Promise<WalletLedgerEntry> {
    return this.db.tx(async (c) => {
      await this.lockWallet(c, p.organizationId);
      const already = await this.db.one<RowDataPacket>("SELECT organization_id FROM wallet_free_grants WHERE organization_id = ?", [p.organizationId], c);
      if (already) throw new ApiError(409, "FREE_GRANT_ALREADY_CLAIMED", "The 25 free tokens are granted once per organization. This organization has already claimed them.");
      const user = await this.db.one<RowDataPacket>("SELECT email FROM users WHERE id = ?", [p.userId], c);
      const now = new Date().toISOString();
      const expiresAt = addDays(now, FREE_GRANT_EXPIRY_DAYS);
      await c.query(
        "INSERT INTO wallet_free_grants (organization_id, granted_tokens, email, granted_by, expires_at) VALUES (?, ?, ?, ?, ?)",
        [p.organizationId, FREE_GRANT_TOKENS, user?.email ?? "", p.userId, toDbDate(expiresAt)],
      );
      const entry = await this.append(c, p.organizationId, p.userId, {
        kind: "FREE_GRANT", amount: FREE_GRANT_TOKENS, idempotencyKey: `free-grant:${p.organizationId}`,
        reason: "One-time free tier: 25 tokens on signup, expiring 30 days after signup.", expiresAt,
      });
      await recordChange(c, userActor(p), { action: "wallet.free_grant", entityType: "organization", entityId: p.organizationId, after: { tokens: FREE_GRANT_TOKENS, expires_at: expiresAt } });
      return entry;
    });
  }

  /** Write off credits that have expired and are still unspent, as EXPIRY rows (scope §3: no refund on expiry).
   *  A company job: only the company organisation may expire credits, for any organisation. */
  async expireCredits(p: Principal, organizationId: string): Promise<{ organization_id: string; expired: number }> {
    requireCompanyOrg(p, this.companyOrgId);
    return this.db.tx(async (c) => {
      await this.lockWallet(c, organizationId);
      const entries = await this.ledgerRows(organizationId, c);
      const expired = expiredCreditTokens(entries);
      if (expired <= 0) return { organization_id: organizationId, expired: 0 };
      await this.append(c, organizationId, p.userId, {
        kind: "EXPIRY", amount: -expired, idempotencyKey: `expiry:${organizationId}:${new Date().toISOString().slice(0, 10)}`,
        reason: `Wrote off ${expired} expired token(s). Expired tokens are not refunded.`,
      });
      return { organization_id: organizationId, expired };
    });
  }

  // -- packs: request -> owner issues invoice -> org pays by bank transfer -> owner confirms -> PURCHASE --

  async requestPack(p: Principal, body: RequestPackRequest): Promise<PackRequest> {
    const pack = tokenPack(body.pack_code);
    const amountMinor = body.currency === "NGN" ? pack.price_ngn_minor : pack.price_usd_minor;
    const id = uuidv7();
    await this.db.rows(
      "INSERT INTO wallet_pack_requests (id, organization_id, pack_code, currency, amount_minor, tokens, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, p.organizationId, body.pack_code, body.currency, amountMinor, pack.tokens, p.userId],
    );
    return this.packRequest(id, p.organizationId);
  }

  async packRequests(p: Principal): Promise<PackRequest[]> {
    const rows = await this.db.rows<RowDataPacket>(
      "SELECT * FROM wallet_pack_requests WHERE organization_id = ? ORDER BY created_at DESC LIMIT 50", [p.organizationId]);
    return rows.map((r) => this.parsePackRequest(r));
  }

  private parsePackRequest(r: RowDataPacket): PackRequest {
    return PackRequest.parse({
      id: r.id, organization_id: r.organization_id, organization_name: r.organization_name ?? null,
      pack_code: r.pack_code, currency: r.currency,
      amount_minor: Number(r.amount_minor), tokens: Number(r.tokens), status: r.status,
      invoice_ref: r.invoice_ref ?? null, requested_by: r.requested_by,
      created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString(),
    });
  }

  private async packRequest(id: string, organizationId: string): Promise<PackRequest> {
    const r = await this.db.one<RowDataPacket>("SELECT * FROM wallet_pack_requests WHERE id = ? AND organization_id = ?", [id, organizationId]);
    if (!r) throw notFound("Pack request");
    return this.parsePackRequest(r);
  }

  /** Owner: issue the invoice for a requested pack (bank details, amount, due days go on the invoice itself). */
  async issueInvoice(p: Principal, requestId: string, body: IssueInvoiceRequest): Promise<PackRequest> {
    requireCompanyOrg(p, this.companyOrgId);
    const req = await this.db.one<RowDataPacket>("SELECT * FROM wallet_pack_requests WHERE id = ?", [requestId]);
    if (!req) throw notFound("Pack request");
    if (req.status !== "REQUESTED") throw new ApiError(409, "PACK_REQUEST_NOT_OPEN", "Only a requested pack can be invoiced.");
    await this.db.tx(async (c) => {
      await c.query("UPDATE wallet_pack_requests SET status = 'INVOICED', invoice_ref = ? WHERE id = ?", [body.invoice_ref, requestId]);
      await recordChange(c, userActor(p), { action: "wallet.invoice_issued", entityType: "organization", entityId: String(req.organization_id), after: { pack_request_id: requestId, invoice_ref: body.invoice_ref } });
    });
    return this.packRequest(requestId, String(req.organization_id));
  }

  /** Owner: confirm the bank transfer arrived — the wallet is topped up and the ledger records a PURCHASE. */
  async confirmReceipt(p: Principal, requestId: string, body: ConfirmReceiptRequest): Promise<PackRequest> {
    requireCompanyOrg(p, this.companyOrgId);
    const req = await this.db.one<RowDataPacket>("SELECT * FROM wallet_pack_requests WHERE id = ?", [requestId]);
    if (!req) throw notFound("Pack request");
    if (req.status !== "INVOICED") throw new ApiError(409, "PACK_REQUEST_NOT_INVOICED", "Only an invoiced pack can be confirmed paid. Issue the invoice first.");
    const orgId = String(req.organization_id);
    const now = new Date().toISOString();
    await this.db.tx(async (c) => {
      await this.lockWallet(c, orgId);
      await c.query("UPDATE wallet_pack_requests SET status = 'PAID', invoice_ref = ? WHERE id = ?", [body.invoice_ref, requestId]);
      await this.append(c, orgId, p.userId, {
        kind: "PURCHASE", amount: Number(req.tokens), idempotencyKey: `purchase:${requestId}`,
        invoiceRef: body.invoice_ref, reason: `Bank transfer confirmed for ${req.pack_code} pack (${req.tokens} tokens).`,
        expiresAt: addMonths(now, PACK_EXPIRY_MONTHS),
      });
      await recordChange(c, userActor(p), { action: "wallet.purchase_confirmed", entityType: "organization", entityId: orgId, after: { pack_request_id: requestId, invoice_ref: body.invoice_ref, tokens: Number(req.tokens) } });
    });
    return this.packRequest(requestId, orgId);
  }

  async cancelPackRequest(p: Principal, requestId: string): Promise<PackRequest> {
    const req = await this.db.one<RowDataPacket>("SELECT * FROM wallet_pack_requests WHERE id = ? AND organization_id = ?", [requestId, p.organizationId]);
    if (!req) throw notFound("Pack request");
    if (!["REQUESTED", "INVOICED"].includes(String(req.status))) throw new ApiError(409, "PACK_REQUEST_NOT_OPEN", "Only an open pack request can be cancelled.");
    await this.db.rows("UPDATE wallet_pack_requests SET status = 'CANCELLED' WHERE id = ?", [requestId]);
    return this.packRequest(requestId, p.organizationId);
  }

  /**
   * What the requester needs to pay for a pack: the request plus the owner's bank details for its
   * currency — but only once the owner has issued the invoice (INVOICED or PAID). While the request is
   * still REQUESTED the bank details stay hidden: paying before the invoice exists would leave the
   * payment unmatched. This returns only the public pay-to fields for the request's own currency;
   * the admin bank-account endpoints are never exposed to regular users.
   */
  async packRequestPayment(p: Principal, requestId: string): Promise<PackRequestPayment> {
    const request = await this.packRequest(requestId, p.organizationId);
    const invoiced = request.status === "INVOICED" || request.status === "PAID";
    const account = invoiced
      ? await this.db.one<RowDataPacket>("SELECT * FROM bank_accounts WHERE currency = ? AND is_active = true", [request.currency])
      : null;
    return PackRequestPayment.parse({
      request,
      bank_account: account
        ? {
            account_name: String(account.account_name), bank_name: String(account.bank_name),
            account_number: String(account.account_number), swift_iban: account.swift_iban ?? null,
            currency: request.currency,
          }
        : null,
      pay_reference_note: PAY_REFERENCE_NOTE,
    });
  }

  // -- admin: every organization's wallet and ledger; top-up, refund, adjust, each with a reason --

  /** The wallet list (ADR-140 §8, the visibility fix): the company org sees EVERY customer's wallet,
   *  with the customer's name on each row — otherwise it could top up a club's wallet but never see
   *  it. A customer org sees only its own wallet, as before. */
  async adminWallets(p: Principal): Promise<AdminWalletRow[]> {
    const company = isCompanyOrg(p, this.companyOrgId);
    const orgs = company
      ? await this.db.rows<RowDataPacket>("SELECT id, name FROM organizations ORDER BY name ASC")
      : await this.db.rows<RowDataPacket>("SELECT id, name FROM organizations WHERE id = ? ORDER BY name ASC", [p.organizationId]);
    const out: AdminWalletRow[] = [];
    for (const o of orgs) {
      const entries = await this.ledgerRows(String(o.id));
      const b = deriveWalletBalance(String(o.id), entries);
      out.push(AdminWalletRow.parse({
        organization_id: o.id, organization_name: String(o.name ?? ""),
        balance: b.balance, spendable_balance: b.spendable_balance, low_balance: b.low_balance,
        last_activity_at: entries.length ? entries[entries.length - 1]!.created_at : null,
      }));
    }
    return out;
  }

  async adminLedger(p: Principal, organizationId: string): Promise<WalletLedgerPage> {
    // The company org may read any customer's ledger (it has to, to check a top-up landed); a
    // customer org may read only its own.
    if (!isCompanyOrg(p, this.companyOrgId)) ownOrgOrDeny(p, organizationId);
    const org = await this.db.one<RowDataPacket>("SELECT id FROM organizations WHERE id = ?", [organizationId]);
    if (!org) throw notFound("Organization");
    const entries = await this.ledgerRows(organizationId);
    const page = WalletLedgerPage.parse({ balance: deriveWalletBalance(organizationId, entries), entries: [...entries].reverse().slice(0, 200) });
    return page;
  }

  /** The admin pack-request list (ADR-140 §8, the visibility fix): the company org sees EVERY
   *  customer's request, with the customer's name on each row. A customer org sees only its own. */
  async adminPackRequests(p: Principal): Promise<PackRequest[]> {
    const company = isCompanyOrg(p, this.companyOrgId);
    const rows = company
      ? await this.db.rows<RowDataPacket>("SELECT w.*, o.name AS organization_name FROM wallet_pack_requests w JOIN organizations o ON o.id = w.organization_id ORDER BY w.created_at DESC LIMIT 100")
      : await this.db.rows<RowDataPacket>("SELECT w.*, o.name AS organization_name FROM wallet_pack_requests w JOIN organizations o ON o.id = w.organization_id WHERE w.organization_id = ? ORDER BY w.created_at DESC LIMIT 100", [p.organizationId]);
    return rows.map((r) => this.parsePackRequest(r));
  }

  /** Owner top-up against a bank transfer: a PURCHASE row with the invoice reference. */
  async adminTopUp(p: Principal, organizationId: string, body: AdminWalletCreditRequest): Promise<WalletLedgerEntry> {
    requireCompanyOrg(p, this.companyOrgId);
    return this.db.tx(async (c) => {
      const entry = await this.credit(c, organizationId, p.userId, {
        kind: "PURCHASE", amount: body.amount, idempotencyKey: `topup:${organizationId}:${uuidv7()}`,
        invoiceRef: body.invoice_ref, reason: body.reason, expiresAt: addMonths(new Date().toISOString(), PACK_EXPIRY_MONTHS),
      });
      await recordChange(c, userActor(p), { action: "wallet.top_up", entityType: "organization", entityId: organizationId, after: { tokens: body.amount, invoice_ref: body.invoice_ref, reason: body.reason } });
      return entry;
    });
  }

  /** Owner refund to the wallet (e.g. a failed job the worker could not refund): a REFUND row.
   *  A company action: only the company organisation may refund a wallet, for any organisation. */
  async adminRefund(p: Principal, organizationId: string, body: AdminWalletCreditRequest): Promise<WalletLedgerEntry> {
    requireCompanyOrg(p, this.companyOrgId);
    return this.db.tx(async (c) => {
      const entry = await this.credit(c, organizationId, p.userId, {
        kind: "REFUND", amount: body.amount, idempotencyKey: `admin-refund:${organizationId}:${uuidv7()}`,
        invoiceRef: body.invoice_ref, reason: body.reason,
      });
      await recordChange(c, userActor(p), { action: "wallet.refund", entityType: "organization", entityId: organizationId, after: { tokens: body.amount, reason: body.reason } });
      return entry;
    });
  }

  /** Owner correction, either sign, always with a reason. A money refund that claws tokens back is a negative
   *  adjustment with the refund stated in the reason (scope §5: refunds are manual and owner-approved).
   *  A company action: only the company organisation may adjust a wallet, for any organisation. */
  async adminAdjust(p: Principal, organizationId: string, body: AdminWalletAdjustmentRequest): Promise<WalletLedgerEntry> {
    requireCompanyOrg(p, this.companyOrgId);
    return this.db.tx(async (c) => {
      const entry = await this.credit(c, organizationId, p.userId, {
        kind: "ADJUSTMENT", amount: body.amount, idempotencyKey: `adjust:${organizationId}:${uuidv7()}`, reason: body.reason,
      });
      await recordChange(c, userActor(p), { action: "wallet.adjust", entityType: "organization", entityId: organizationId, after: { tokens: body.amount, reason: body.reason } });
      return entry;
    });
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get("wallet/packs")
  packs(): TokenPackCatalogue {
    return tokenPackCatalogue();
  }

  @Get("wallet")
  balance(@CurrentPrincipal() p: Principal): Promise<WalletBalance> {
    return this.wallet.balance(p.organizationId);
  }

  @Get("wallet/ledger")
  async ledger(@CurrentPrincipal() p: Principal, @Query("limit") limit: string | undefined): Promise<WalletLedgerPage> {
    const entries = await this.wallet.ledgerRows(p.organizationId);
    const n = Math.min(Math.max(Number(limit ?? 100) || 100, 1), 200);
    return WalletLedgerPage.parse({
      balance: deriveWalletBalance(p.organizationId, entries),
      entries: [...entries].reverse().slice(0, n),
    });
  }

  @Post("wallet/free-grant")
  freeGrant(@CurrentPrincipal() p: Principal): Promise<WalletLedgerEntry> {
    return this.wallet.grantFreeTier(p);
  }

  @Post("wallet/packs/request")
  requestPack(@CurrentPrincipal() p: Principal, @Body() body: unknown): Promise<PackRequest> {
    return this.wallet.requestPack(p, RequestPackRequest.parse(body));
  }

  @Get("wallet/packs/requests")
  packRequests(@CurrentPrincipal() p: Principal): Promise<PackRequest[]> {
    return this.wallet.packRequests(p);
  }

  @Get("wallet/packs/requests/:id")
  packRequestPayment(@CurrentPrincipal() p: Principal, @Param("id") id: string): Promise<PackRequestPayment> {
    return this.wallet.packRequestPayment(p, id);
  }

  @Post("wallet/packs/requests/:id/cancel")
  cancelPackRequest(@CurrentPrincipal() p: Principal, @Param("id") id: string): Promise<PackRequest> {
    return this.wallet.cancelPackRequest(p, id);
  }
}

@Controller("v1/admin")
@UseGuards(AuthGuard)
@Roles("OWNER", "ADMIN")
export class AdminWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get("wallet")
  wallets(@CurrentPrincipal() p: Principal): Promise<AdminWalletRow[]> {
    return this.wallet.adminWallets(p);
  }

  @Get("wallet/:organizationId/ledger")
  ledger(@CurrentPrincipal() p: Principal, @Param("organizationId") organizationId: string): Promise<WalletLedgerPage> {
    return this.wallet.adminLedger(p, organizationId);
  }

  @Get("wallet/pack-requests")
  packRequests(@CurrentPrincipal() p: Principal): Promise<PackRequest[]> {
    return this.wallet.adminPackRequests(p);
  }

  @Post("wallet/pack-requests/:id/invoice")
  issueInvoice(@CurrentPrincipal() p: Principal, @Param("id") id: string, @Body() body: unknown): Promise<PackRequest> {
    return this.wallet.issueInvoice(p, id, IssueInvoiceRequest.parse(body));
  }

  @Post("wallet/pack-requests/:id/confirm-receipt")
  confirmReceipt(@CurrentPrincipal() p: Principal, @Param("id") id: string, @Body() body: unknown): Promise<PackRequest> {
    return this.wallet.confirmReceipt(p, id, ConfirmReceiptRequest.parse(body));
  }

  @Post("wallet/:organizationId/topup")
  topUp(@CurrentPrincipal() p: Principal, @Param("organizationId") organizationId: string, @Body() body: unknown): Promise<WalletLedgerEntry> {
    return this.wallet.adminTopUp(p, organizationId, AdminWalletCreditRequest.parse(body));
  }

  @Post("wallet/:organizationId/refund")
  refund(@CurrentPrincipal() p: Principal, @Param("organizationId") organizationId: string, @Body() body: unknown): Promise<WalletLedgerEntry> {
    return this.wallet.adminRefund(p, organizationId, AdminWalletCreditRequest.parse(body));
  }

  @Post("wallet/:organizationId/adjust")
  adjust(@CurrentPrincipal() p: Principal, @Param("organizationId") organizationId: string, @Body() body: unknown): Promise<WalletLedgerEntry> {
    return this.wallet.adminAdjust(p, organizationId, AdminWalletAdjustmentRequest.parse(body));
  }

  @Post("wallet/:organizationId/expire")
  expire(@CurrentPrincipal() p: Principal, @Param("organizationId") organizationId: string): Promise<{ organization_id: string; expired: number }> {
    return this.wallet.expireCredits(p, organizationId);
  }
}
