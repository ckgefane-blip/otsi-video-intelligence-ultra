/**
 * Bank-transfer billing for plans (ADR-144 §1.7, ultra-only; plan step 7 of ULTRA_DISTRIBUTION_PLAN.md §5a).
 * Bank transfer is the MAIN payment method. There is no payment gateway code anywhere in this module.
 *
 *   POST /v1/billing/orders                         create an order (plan + period) -> order + pro-forma invoice
 *   GET  /v1/billing/orders                         the caller's orders, newest first
 *   GET  /v1/billing/orders/:id                     one order, with its pro-forma invoice
 *   POST /v1/billing/orders/:id/proof               upload a receipt, or mark "I have paid" with no file
 *   GET  /v1/billing/plans                         the plan catalogue (prices, periods, "Pay online — Coming soon")
 *   GET  /v1/billing/subscription                  the caller's live subscription, if any (ACTIVE / PAST_DUE)
 *   GET  /v1/admin/billing/orders                  pending first (OWNER / ADMIN; the company org sees
 *                                                      all customers' orders, a customer org its own)
 *   GET  /v1/admin/billing/orders/:id              one order (admin view)
 *   GET  /v1/admin/billing/orders/:id/proof        download the receipt the payer uploaded (admin view)
 *   GET  /v1/admin/billing/revenue                money confirmed, refunded and awaited, by month, from plans and packs
 *   POST /v1/admin/billing/orders/:id/confirm      confirm the money arrived -> activates plan + wallet
 *   POST /v1/admin/billing/orders/:id/reject       reject with a reason (never activates)
 *   POST /v1/admin/billing/orders/:id/record-partial  record a part-payment (never activates)
 *   POST /v1/admin/billing/orders/:id/refund       money refund: claws the granted tokens back
 *   GET  /v1/admin/billing/bank-accounts           the owner's bank details, one per currency
 *   POST /v1/admin/billing/bank-accounts           create / update a bank account by currency
 *   POST /v1/admin/billing/renewals/run            create renewal orders + apply expiry / grace (daily job trigger)
 *   GET  /v1/admin/billing/revenue                 money in, refunds, awaiting and plans, per currency and month (own organization)
 *
 * Nothing activates without a human confirmation: only the admin confirm step writes the subscription row (the
 * existing `subscriptions` table), the entitlement grants (the existing `entitlement_grants` table) and the
 * wallet PURCHASE credit (WalletService.credit, idempotency key `purchase:<orderId>`, invoice reference = the
 * order reference). Every step is an audit row via recordChange (`billing.*`).
 *
 * Concurrency, like the wallet (ADR-140): mutations for one organization lock its organizations row
 * (`SELECT ... FOR UPDATE`) before they read or write, and the reference sequence row is locked the same way
 * when a reference is generated, so two concurrent orders can never share a reference.
 *
 * Proof upload reuses the media/storage pattern (apps/api/src/core/storage.ts): the receipt is stored under the
 * configured storage dir at org/<org id>/billing/<order id>/receipt-<uuid>.<ext> (the key is server-generated,
 * never from a user file name), and the order row records filename, size, sha256 and storage key. The proof is
 * optional — a JSON body ({}) marks "I have paid" with no file. A receipt upload with no storage configured
 * answers 503 STORAGE_NOT_CONFIGURED, like media uploads; marking paid without a file always works.
 */
import { Body, Controller, Get, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import {
  BankAccount,
  BankAccountUpsertRequest,
  BankTransferOrder,
  ConfirmOrderRequest,
  CreateOrderRequest,
  formatBankTransferReference,
  MarkPaidRequest,
  ORDER_EXPIRY_DAYS,
  OrderWithInvoice,
  planCatalogue,
  planCatalogueEntry,
  planPriceMinor,
  planTokens,
  PROOF_CONTENT_TYPES,
  PROOF_MAX_BYTES,
  RecordPartialRequest,
  RejectOrderRequest,
  RefundOrderRequest,
  RENEWAL_GRACE_DAYS,
  RENEWAL_WINDOW_DAYS,
  RenewalRunResult,
  SubscriptionStatus,
  summarizeRevenue,
  type RevenueSummary,
  type BankTransferOrder as BankTransferOrderType,
  type PlanCatalogue as PlanCatalogueType,
  type ProFormaInvoice,
  type SubscriptionStatus as SubscriptionStatusType,
} from "@otsi-vie/contracts";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, serviceActor, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, isCompanyOrg, Principal, requireCompanyOrg, Roles } from "../../core/auth";
import { CONFIG, type Config } from "../../core/config";
import { Db, type Executor } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { LocalStore } from "../../core/storage";
import { uuidParam } from "../players/players.controller";
import { WalletService } from "../wallet/wallet";

const PROOF_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** The daily renewal job runs every 24 h in central mode (see BillingService.startRenewalScheduler). */
const RENEWAL_JOB_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** ADR-140 §8: this codebase has no platform-wide owner role — Admin is the organization's own OWNER / ADMIN.
 *  Billing Admin therefore acts only on the caller's own organization, EXCEPT the company billing actions
 *  (change bank accounts, confirm / part-pay / reject / refund a plan order, run the renewal job): those are
 *  the company organisation's alone. The company organisation is the one named by the server setting
 *  OTSI_VIE_COMPANY_ORG_ID (never hard-coded); `requireCompanyOrg` refuses everybody else, and refuses
 *  everybody at all when the setting is missing (fail closed). The renewal run's HTTP endpoint requires the
 *  company org; the internal daily scheduler (startRenewalScheduler) calls runRenewals() directly, so the
 *  daily job is unaffected by the endpoint guard.
 *
 *  The READS follow the same rule the other way round (the visibility fix): the company org's Admin ›
 *  Billing reads — the order list, one order, a receipt download, the revenue summary — show EVERY
 *  customer's rows, with the customer's name on each one. A customer org's reads show only its own.
 *  Without this, OTSI could act on a club's order (confirm it) but never see it, so no payment could
 *  ever be confirmed in practice. `isCompanyOrg` is the read-side check; it is false when the setting
 *  is missing, so a read never silently widens to all organisations. */
function ownOrgOrDeny(p: Principal, organizationId: string): void {
  if (organizationId !== p.organizationId) throw new ApiError(403, "BILLING_ADMIN_OTHER_ORG", "Billing Admin acts only on your own organization.");
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

/** A DATETIME(6) value read back with dateStrings: true is "YYYY-MM-DD HH:MM:SS.ffffff" in UTC; parse it as
 *  UTC explicitly (new Date("YYYY-MM-DD HH:MM:SS") would read it in the process timezone). */
function dbIso(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).replace(" ", "T");
  return new Date(s.endsWith("Z") ? s : `${s}Z`).toISOString();
}

/** Whole calendar months between two instants (used to carry a subscription's period into its renewal). */
function monthsBetween(startIso: string, endIso: string): number {
  const a = new Date(startIso);
  const b = new Date(endIso);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return months;
}

function sanitizeFileName(v: string | undefined, fallback: string): string {
  const base = (v ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 200);
  return clean || fallback;
}

/** Read a raw request body (Buffer from inject, or the octet-stream Readable in production) into one Buffer,
 *  refusing anything over the limit. A Buffer is NOT async-iterated (that would yield single bytes). */
async function readRawBody(body: unknown, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const push = (b: Buffer): void => {
    total += b.length;
    if (total > maxBytes) throw new ApiError(413, "FILE_TOO_LARGE", `A transfer receipt may be up to ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    chunks.push(b);
  };
  if (Buffer.isBuffer(body)) push(body);
  else if (typeof body === "string") push(Buffer.from(body, "utf8"));
  else if (body && typeof (body as AsyncIterable<Buffer>)[Symbol.asyncIterator] === "function") {
    for await (const chunk of body as AsyncIterable<Buffer>) push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  } else {
    throw new ApiError(400, "PROOF_BODY_REQUIRED", "Send the receipt as application/octet-stream, or JSON {} to mark paid without a file.");
  }
  return Buffer.concat(chunks);
}

@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("BillingService");
  private readonly store: LocalStore | null;
  /** Central mode only (OTSI_VIE_CENTRAL_MODE=yes): a local / vetting engine must never run renewals. */
  private readonly centralMode: boolean;
  /** The company organisation id from the server setting (OTSI_VIE_COMPANY_ORG_ID); undefined when the
   *  setting is absent, in which case the company billing actions are refused for everybody. */
  private readonly companyOrgId: string | undefined;
  /** The daily renewal job: one chained timer, first run at start-up (catch-up), then every interval. */
  private renewalsTimer: NodeJS.Timeout | null = null;
  private renewalsSchedulerOn = false;
  private renewalsStopped = false;

  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
    @Inject(CONFIG) cfg: Config,
  ) {
    this.store = cfg.storage ? new LocalStore(cfg.storage.dir) : null;
    this.centralMode = cfg.central?.centralMode === true;
    /** The company organisation (OTSI_VIE_COMPANY_ORG_ID); undefined when the setting is absent, in which
     *  case the company billing actions are refused for everybody (fail closed — see requireCompanyOrg). */
    this.companyOrgId = cfg.companyOrganizationId;
  }

  /**
   * Daily renewal job (Finding 4): POST /v1/admin/billing/renewals/run existed but nothing ever called
   * it, so renewals never ran. In central mode the API itself runs it: once at start-up (catch-up after a
   * restart or downtime) and then every 24 h. A local / vetting engine never starts it — centralMode is
   * true only when OTSI_VIE_CENTRAL_MODE=yes; a local engine that only verifies licence tokens against
   * the central server's key has centralMode false (see core/config.ts). A failed run is logged and the
   * next run still happens — a billing failure must never take the API down with it. The timer is unref'd
   * so it never keeps the process (or a test) alive on its own, and onModuleDestroy stops it.
   */
  async onModuleInit(): Promise<void> {
    if (this.centralMode) this.startRenewalScheduler();
  }

  onModuleDestroy(): void {
    this.stopRenewalScheduler();
  }

  /** Start the daily job; `intervalMs` exists only so tests can use a short interval. */
  startRenewalScheduler(intervalMs: number = RENEWAL_JOB_INTERVAL_MS): void {
    if (!this.centralMode || this.renewalsSchedulerOn) return;
    this.renewalsSchedulerOn = true;
    this.renewalsStopped = false;
    // Chained, not setInterval: the next run is scheduled only after the current one finishes, so a
    // slow run can never overlap the next one. A manual POST racing a tick is handled by the
    // in-transaction re-check in createRenewalOrders, not here.
    const tick = async (): Promise<void> => {
      if (this.renewalsStopped) return;
      try {
        await this.runRenewals();
      } catch (e) {
        this.log.error(`daily renewal run failed: ${(e as Error).message}`);
      }
      if (this.renewalsStopped) return;
      this.renewalsTimer = setTimeout(() => void tick(), intervalMs);
      this.renewalsTimer.unref();
    };
    void tick();
  }

  /** Stop the daily job (no further runs; a run already in flight finishes). */
  stopRenewalScheduler(): void {
    this.renewalsStopped = true;
    this.renewalsSchedulerOn = false;
    if (this.renewalsTimer !== null) {
      clearTimeout(this.renewalsTimer);
      this.renewalsTimer = null;
    }
  }

  // -- reads --

  private parseOrder(r: RowDataPacket): BankTransferOrderType {
    return BankTransferOrder.parse({
      id: r.id, organization_id: r.organization_id, organization_name: r.organization_name ?? null,
      plan_code: r.plan_code, period_months: Number(r.period_months),
      amount_minor: Number(r.amount_minor), currency: r.currency, reference: r.reference, bank_account_id: r.bank_account_id,
      status: r.status, amount_received_minor: Number(r.amount_received_minor),
      amount_refunded_minor: r.amount_refunded_minor === null ? null : Number(r.amount_refunded_minor),
      tokens_granted: Number(r.tokens_granted), subscription_id: r.subscription_id ?? null,
      renews_subscription_id: r.renews_subscription_id ?? null, expires_at: dbIso(r.expires_at),
      proof_filename: r.proof_filename ?? null, proof_content_type: r.proof_content_type ?? null,
      proof_size_bytes: r.proof_size_bytes === null ? null : Number(r.proof_size_bytes),
      proof_sha256: r.proof_sha256 ?? null, proof_uploaded_at: dbIso(r.proof_uploaded_at),
      proof_note: r.proof_note ?? null, confirmed_by: r.confirmed_by ?? null, confirmed_at: dbIso(r.confirmed_at),
      bank_reference: r.bank_reference ?? null, reject_reason: r.reject_reason ?? null,
      refund_reason: r.refund_reason ?? null, created_by: r.created_by ?? null,
      created_at: dbIso(r.created_at), updated_at: dbIso(r.updated_at),
    });
  }

  private parseBankAccount(r: RowDataPacket): BankAccount {
    return BankAccount.parse({
      id: r.id, currency: r.currency, account_name: r.account_name, bank_name: r.bank_name,
      account_number: r.account_number, swift_iban: r.swift_iban ?? null, is_active: Boolean(r.is_active),
      created_by: r.created_by, created_at: dbIso(r.created_at), updated_at: dbIso(r.updated_at),
    });
  }

  /** One order row, with the paying organisation's name joined in (the company org's Admin › Billing
   *  view shows the customer's name on each order). Every order belongs to an organisation, so the
   *  inner join never drops a row. */
  private async orderRow(id: string, organizationId?: string): Promise<RowDataPacket> {
    const r = organizationId
      ? await this.db.one<RowDataPacket>("SELECT b.*, o.name AS organization_name FROM bank_transfer_orders b JOIN organizations o ON o.id = b.organization_id WHERE b.id = ? AND b.organization_id = ?", [id, organizationId])
      : await this.db.one<RowDataPacket>("SELECT b.*, o.name AS organization_name FROM bank_transfer_orders b JOIN organizations o ON o.id = b.organization_id WHERE b.id = ?", [id]);
    if (!r) throw notFound("Order");
    return r;
  }

  private async invoiceFor(order: BankTransferOrderType): Promise<ProFormaInvoice> {
    const account = await this.db.one<RowDataPacket>("SELECT * FROM bank_accounts WHERE id = ?", [order.bank_account_id]);
    if (!account) throw new ApiError(409, "BANK_ACCOUNT_MISSING", "The bank account this order was raised against no longer exists. Ask the owner to set the bank details again.");
    const a = this.parseBankAccount(account);
    return {
      reference: order.reference, plan_code: order.plan_code, period_months: order.period_months,
      amount_minor: order.amount_minor, currency: order.currency, expires_at: order.expires_at,
      pay_reference_note: "Put this reference in your transfer description, so the payment can be matched to your order.",
      bank_account: { account_name: a.account_name, bank_name: a.bank_name, account_number: a.account_number, swift_iban: a.swift_iban, currency: a.currency },
    };
  }

  private async orderWithInvoice(id: string, organizationId: string): Promise<OrderWithInvoice> {
    const order = this.parseOrder(await this.orderRow(id, organizationId));
    return { order, invoice: await this.invoiceFor(order) };
  }

  /** Serialize mutations for one organization: lock its organizations row for the transaction. */
  private async lockOrg(ex: Executor, organizationId: string): Promise<void> {
    await ex.query<RowDataPacket[]>("SELECT id FROM organizations WHERE id = ? FOR UPDATE", [organizationId]);
  }

  /**
   * The next reference for a year, taken under SELECT ... FOR UPDATE inside the caller's transaction
   * (migration 0075): the sequence row is created if this is the year's first order, then read locked and
   * incremented, so two concurrent orders can never share a reference and a reference is never reused.
   */
  private async nextReference(ex: Executor, year: number): Promise<string> {
    await ex.query("INSERT IGNORE INTO bank_transfer_reference_seq (`year`, next_seq) VALUES (?, 0)", [year]);
    const row = await this.db.one<RowDataPacket>("SELECT next_seq FROM bank_transfer_reference_seq WHERE `year` = ? FOR UPDATE", [year], ex);
    const seq = Number(row?.next_seq ?? 0) + 1;
    await ex.query("UPDATE bank_transfer_reference_seq SET next_seq = ? WHERE `year` = ?", [seq, year]);
    return formatBankTransferReference(year, seq);
  }

  /**
   * The plan_version row the existing `subscriptions` table needs (migration 0001: plan_version_id is a
   * foreign key). Plans are created here, insert-if-absent inside the caller's transaction — there is no
   * seeded plan data anywhere in the repo, and the catalogue in contracts is the source of truth.
   */
  private async ensurePlanVersion(ex: Executor, code: string, nowIso: string): Promise<string> {
    const entry = planCatalogueEntry(code as "FREE" | "STARTER" | "CLUB" | "ACADEMY" | "SEASON");
    const existing = await this.db.one<RowDataPacket>("SELECT id FROM plans WHERE code = ?", [code], ex);
    let planId = existing ? String(existing.id) : undefined;
    if (!planId) {
      planId = uuidv7();
      await ex.query("INSERT INTO plans (id, code, name, active) VALUES (?, ?, ?, true)", [planId, code, entry.label]);
    }
    const version = await this.db.one<RowDataPacket>("SELECT id FROM plan_versions WHERE plan_id = ? AND version = 1", [planId], ex);
    if (version) return String(version.id);
    const versionId = uuidv7();
    await ex.query(
      "INSERT INTO plan_versions (id, plan_id, version, effective_at, feature_limits, currency, is_published) VALUES (?, ?, 1, ?, ?, NULL, true)",
      [versionId, planId, toDbDate(nowIso), JSON.stringify({ plan: code, tokens_per_month: entry.tokens_per_month })],
    );
    return versionId;
  }

  // -- user: orders --

  plans(): PlanCatalogueType {
    return planCatalogue();
  }

  async createOrder(p: Principal, body: CreateOrderRequest): Promise<OrderWithInvoice> {
    const amountMinor = planPriceMinor(body.plan_code, body.period_months, body.currency);
    const tokens = planTokens(body.plan_code, body.period_months);
    const account = await this.db.one<RowDataPacket>(
      "SELECT * FROM bank_accounts WHERE currency = ? AND is_active = true", [body.currency]);
    if (!account) {
      throw new ApiError(409, "BANK_ACCOUNT_NOT_CONFIGURED",
        `The owner has not set up a bank account for ${body.currency} yet, so no invoice can be raised in that currency. Try the other currency, or ask the owner to add the bank details.`);
    }
    const now = new Date();
    const nowIso = now.toISOString();
    const id = await this.db.tx(async (c) => {
      await this.lockOrg(c, p.organizationId);
      const reference = await this.nextReference(c, now.getUTCFullYear());
      const orderId = uuidv7();
      await c.query(
        `INSERT INTO bank_transfer_orders (id, organization_id, plan_code, period_months, amount_minor, currency, reference,
          bank_account_id, status, tokens_granted, expires_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ORDERED', ?, ?, ?)`,
        [orderId, p.organizationId, body.plan_code, body.period_months, amountMinor, body.currency, reference,
         String(account.id), tokens, toDbDate(addDays(nowIso, ORDER_EXPIRY_DAYS)), p.userId],
      );
      await recordChange(c, userActor(p), {
        action: "billing.order_created", entityType: "bank_transfer_order", entityId: orderId,
        after: { reference, plan_code: body.plan_code, period_months: body.period_months, amount_minor: amountMinor, currency: body.currency },
      });
      return orderId;
    });
    return this.orderWithInvoice(id, p.organizationId);
  }

  async listOrders(p: Principal): Promise<BankTransferOrderType[]> {
    const rows = await this.db.rows<RowDataPacket>(
      "SELECT * FROM bank_transfer_orders WHERE organization_id = ? ORDER BY created_at DESC LIMIT 50", [p.organizationId]);
    return rows.map((r) => this.parseOrder(r));
  }

  async getOrder(p: Principal, id: string): Promise<OrderWithInvoice> {
    return this.orderWithInvoice(id, p.organizationId);
  }

  /** The organization's live subscription, if any (ACTIVE, or PAST_DUE inside the grace period). Null
   *  when there is none — a fresh organization, or one that dropped to free after expiry + grace. */
  async subscription(p: Principal): Promise<SubscriptionStatusType | null> {
    const row = await this.db.one<RowDataPacket>(
      `SELECT s.id, s.period_start, s.period_end, s.state, p.code AS plan_code
       FROM subscriptions s JOIN plan_versions pv ON pv.id = s.plan_version_id JOIN plans p ON p.id = pv.plan_id
       WHERE s.organization_id = ? AND s.state IN ('ACTIVE', 'PAST_DUE') ORDER BY s.period_end DESC LIMIT 1`,
      [p.organizationId]);
    if (!row) return null;
    return SubscriptionStatus.parse({
      id: String(row.id), plan_code: String(row.plan_code),
      period_start: dbIso(row.period_start), period_end: dbIso(row.period_end), state: String(row.state),
    });
  }


  /**
   * Proof of payment, two shapes on one endpoint (the receipt is optional):
   * - application/json {} (or {"note": "..."}) — "I have paid", no file. Always works, needs no storage.
   * - application/octet-stream — the receipt file (PDF or image, ≤10 MB); the real file type comes in the
   *   x-content-type header and the original name in x-file-name. Stored under the configured storage dir.
   * Either way the order becomes AWAITING_CONFIRMATION. An order that is already CONFIRMED, REJECTED or
   * REFUNDED is closed: proof for it is refused.
   */
  async uploadProof(p: Principal, orderId: string, req: FastifyRequest): Promise<BankTransferOrderType> {
    const row = await this.orderRow(orderId, p.organizationId);
    const order = this.parseOrder(row);
    if (!["ORDERED", "PARTIAL", "AWAITING_CONFIRMATION"].includes(order.status)) {
      throw new ApiError(409, "ORDER_NOT_OPEN", `This order is ${order.status}, so no proof can be added to it.`);
    }
    const contentType = String(req.headers["content-type"] ?? "");
    if (contentType.startsWith("application/json")) {
      const body = MarkPaidRequest.parse(req.body ?? {});
      await this.db.tx(async (c) => {
        await c.query("UPDATE bank_transfer_orders SET status = 'AWAITING_CONFIRMATION', proof_note = ? WHERE id = ?", [body.note ?? null, orderId]);
        await recordChange(c, userActor(p), {
          action: "billing.marked_paid", entityType: "bank_transfer_order", entityId: orderId,
          after: { reference: order.reference, note: body.note ?? null },
        });
      });
      return this.parseOrder(await this.orderRow(orderId, p.organizationId));
    }
    if (contentType !== "application/octet-stream") {
      throw new ApiError(415, "OCTET_STREAM_REQUIRED", "Send the receipt as application/octet-stream, or JSON {} to mark paid without a file.");
    }
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Receipt storage is not configured on this server. Mark paid without a file instead, and send the receipt to the owner another way.");
    const fileType = String(req.headers["x-content-type"] ?? "application/octet-stream");
    if (!(PROOF_CONTENT_TYPES as readonly string[]).includes(fileType)) {
      throw new ApiError(415, "PROOF_TYPE_NOT_ACCEPTED", "A transfer receipt must be a PDF or an image (JPEG, PNG, WebP).");
    }
    const bytes = await readRawBody(req.body, PROOF_MAX_BYTES);
    if (bytes.length === 0) throw new ApiError(400, "PROOF_EMPTY", "The receipt file was empty.");
    const ext = PROOF_EXTENSIONS[fileType] ?? "bin";
    const fileName = sanitizeFileName(String(req.headers["x-file-name"] ?? ""), `receipt.${ext}`);
    const key = `org/${p.organizationId}/billing/${orderId}/receipt-${uuidv7()}.${ext}`;
    const fullPath = this.store.resolve(key);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const uploadedAt = new Date().toISOString();
    await this.db.tx(async (c) => {
      await c.query(
        `UPDATE bank_transfer_orders SET status = 'AWAITING_CONFIRMATION', proof_storage_key = ?, proof_filename = ?,
          proof_content_type = ?, proof_size_bytes = ?, proof_sha256 = ?, proof_uploaded_at = ? WHERE id = ?`,
        [key, fileName, fileType, bytes.length, sha256, toDbDate(uploadedAt), orderId],
      );
      await recordChange(c, userActor(p), {
        action: "billing.proof_uploaded", entityType: "bank_transfer_order", entityId: orderId,
        after: { reference: order.reference, proof_filename: fileName, proof_size_bytes: bytes.length, proof_sha256: sha256 },
      });
    });
    return this.parseOrder(await this.orderRow(orderId, p.organizationId));
  }

  // -- admin: bank accounts --

  async listBankAccounts(): Promise<BankAccount[]> {
    const rows = await this.db.rows<RowDataPacket>("SELECT * FROM bank_accounts ORDER BY currency ASC");
    return rows.map((r) => this.parseBankAccount(r));
  }

  /** Create or update the bank account for a currency (one row per currency, by the UNIQUE key). Bank
   *  details are entered here and nowhere else — they are never hard-coded and never in the repo. */
  async upsertBankAccount(p: Principal, body: BankAccountUpsertRequest): Promise<BankAccount> {
    requireCompanyOrg(p, this.companyOrgId);
    const id = await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO bank_accounts (id, currency, account_name, bank_name, account_number, swift_iban, is_active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE account_name = VALUES(account_name), bank_name = VALUES(bank_name),
           account_number = VALUES(account_number), swift_iban = VALUES(swift_iban), is_active = VALUES(is_active)`,
        [uuidv7(), body.currency, body.account_name, body.bank_name, body.account_number, body.swift_iban, body.is_active, p.userId],
      );
      const row = await this.db.one<RowDataPacket>("SELECT id FROM bank_accounts WHERE currency = ?", [body.currency], c);
      const accountId = String(row!.id);
      await recordChange(c, userActor(p), {
        action: "billing.bank_account_saved", entityType: "bank_account", entityId: accountId,
        after: { currency: body.currency, bank_name: body.bank_name, is_active: body.is_active },
      });
      return accountId;
    });
    const row = await this.db.one<RowDataPacket>("SELECT * FROM bank_accounts WHERE id = ?", [id]);
    return this.parseBankAccount(row!);
  }

  // -- admin: orders --

  /** Admin › Billing revenue summary, from plan orders, token pack requests and subscriptions; the math is summarizeRevenue
   *  (contracts) so the rule is tested without a database. The company organisation (OTSI) sees EVERY customer's money: that is
   *  what Admin › Billing is for (ADR-140 §8). A customer organisation, or any caller when the setting is absent, sees its own. */
  async revenue(p: Principal, now = new Date()): Promise<RevenueSummary> {
    const all = isCompanyOrg(p, this.companyOrgId);
    const own = (col: string) => (all ? "" : ` WHERE ${col} = ?`);
    const args = all ? [] : [p.organizationId];
    const orders = await this.db.rows<RowDataPacket>(
      `SELECT currency, status, plan_code, amount_minor, amount_received_minor, amount_refunded_minor, confirmed_at, updated_at
         FROM bank_transfer_orders${own("organization_id")}`, args);
    const packs = await this.db.rows<RowDataPacket>(`SELECT currency, status, amount_minor, updated_at FROM wallet_pack_requests${own("organization_id")}`, args);
    const subs = await this.db.rows<RowDataPacket>(
      `SELECT p.code AS plan_code, s.state, s.period_end FROM subscriptions s JOIN plan_versions pv ON pv.id = s.plan_version_id JOIN plans p ON p.id = pv.plan_id${own("s.organization_id")}`, args);
    const num = (v: unknown) => Number(v ?? 0);
    return summarizeRevenue(
      orders.map((o) => ({ currency: String(o.currency), status: String(o.status), plan_code: String(o.plan_code), amount_minor: num(o.amount_minor),
        amount_received_minor: num(o.amount_received_minor), amount_refunded_minor: o.amount_refunded_minor === null || o.amount_refunded_minor === undefined ? null : num(o.amount_refunded_minor),
        confirmed_at: dbIso(o.confirmed_at as string | null), updated_at: dbIso(o.updated_at as string | null) ?? now.toISOString() })),
      packs.map((k) => ({ currency: String(k.currency), status: String(k.status), amount_minor: num(k.amount_minor), updated_at: dbIso(k.updated_at as string | null) ?? now.toISOString() })),
      subs.map((x) => ({ plan_code: String(x.plan_code), state: String(x.state), period_end: dbIso(x.period_end as string | null) })),
      now,
    );
  }

  /** The admin order list (ADR-140 §8, the visibility fix): the company org sees EVERY customer's
   *  order, with the customer's name on each row — otherwise a club's payment could never be confirmed
   *  in practice. A customer org sees only its own orders, as before. Pending first, then newest. */
  async adminOrders(p: Principal, status?: string): Promise<BankTransferOrderType[]> {
    // The company org has no org filter at all; a customer org is filtered to its own organisation.
    // (`1 = 1` keeps one query shape for both.) Either way the customer's name rides on each row.
    const company = isCompanyOrg(p, this.companyOrgId);
    const orgFilter = company ? "1 = 1" : "b.organization_id = ?";
    const orgArgs = company ? [] : [p.organizationId];
    const rows = status
      ? await this.db.rows<RowDataPacket>(
          `SELECT b.*, o.name AS organization_name FROM bank_transfer_orders b JOIN organizations o ON o.id = b.organization_id
           WHERE ${orgFilter} AND b.status = ? ORDER BY b.created_at DESC LIMIT 100`,
          [...orgArgs, status])
      : await this.db.rows<RowDataPacket>(
          `SELECT b.*, o.name AS organization_name FROM bank_transfer_orders b JOIN organizations o ON o.id = b.organization_id
           WHERE ${orgFilter}
           ORDER BY CASE b.status WHEN 'AWAITING_CONFIRMATION' THEN 0 WHEN 'PARTIAL' THEN 1 WHEN 'ORDERED' THEN 2
             WHEN 'CONFIRMED' THEN 3 WHEN 'REJECTED' THEN 4 WHEN 'REFUNDED' THEN 5 END, b.created_at DESC LIMIT 100`,
          orgArgs);
    return rows.map((r) => this.parseOrder(r));
  }

  async adminGetOrder(p: Principal, id: string): Promise<BankTransferOrderType> {
    const row = await this.orderRow(id);
    // The company org may open any customer's order (it has to, to confirm it); a customer org
    // may open only its own.
    if (!isCompanyOrg(p, this.companyOrgId)) ownOrgOrDeny(p, String(row.organization_id));
    return this.parseOrder(row);
  }

  /**
   * Download the receipt file an order's payer uploaded (admin, own organization). The proof is stored
   * under the configured storage dir at the key recorded on the order row; this streams it back with its
   * original content type and file name. No proof file, or no storage configured, is a 404 / 503 — the
   * admin still sees the file name, size and sha256 on the order itself.
   */
  async downloadProof(p: Principal, orderId: string, res: FastifyReply): Promise<void> {
    const row = await this.orderRow(orderId);
    // The company org may download any customer's receipt (it has to, to verify the payment); a
    // customer org may download only its own.
    if (!isCompanyOrg(p, this.companyOrgId)) ownOrgOrDeny(p, String(row.organization_id));
    const order = this.parseOrder(row);
    const key = row.proof_storage_key as string | null;
    if (!order.proof_filename || !key) throw notFound("Receipt");
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Receipt storage is not configured on this server.");
    const file = this.store.resolve(key);
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch {
      throw notFound("Receipt");
    }
    const safeName = order.proof_filename.replace(/[^A-Za-z0-9._-]+/g, "_");
    void res.header("content-type", order.proof_content_type ?? "application/octet-stream")
      .header("content-length", size)
      .header("content-disposition", `attachment; filename="${safeName}"`)
      .send(createReadStream(file));
  }

  /**
   * Confirm the money arrived — the ONLY step that activates anything. In ONE transaction: the order becomes
   * CONFIRMED, the subscription row becomes (or stays) ACTIVE for the period, the entitlement grant is written,
   * and the wallet is credited with a PURCHASE row (idempotency key `purchase:<orderId>`, invoice reference =
   * the order reference). Confirming twice is refused (the order is no longer awaiting confirmation), and the
   * wallet credit is idempotent on top of that, so a double confirm can never double-credit.
   *
   * The amount received in this confirmation, plus any earlier partial payments, must add up to exactly the
   * order amount — a short payment goes through record-partial instead. A renewal order extends the
   * subscription it renews from its current end, so paying early never loses paid time.
   */
  async confirmOrder(p: Principal, orderId: string, body: ConfirmOrderRequest): Promise<BankTransferOrderType> {
    requireCompanyOrg(p, this.companyOrgId);
    const row = await this.orderRow(orderId);
    const order = this.parseOrder(row);
    if (!["AWAITING_CONFIRMATION", "PARTIAL"].includes(order.status)) {
      throw new ApiError(409, "ORDER_NOT_AWAITING_CONFIRMATION", `Only an order awaiting confirmation can be confirmed. This order is ${order.status}.`);
    }
    const totalReceived = order.amount_received_minor + body.amount_received_minor;
    if (totalReceived !== order.amount_minor) {
      throw new ApiError(409, "ORDER_AMOUNT_MISMATCH",
        `This order is for ${order.amount_minor} minor units and ${order.amount_received_minor} have been recorded so far. Confirm with exactly the remaining ${order.amount_minor - order.amount_received_minor}, or record what arrived as a partial payment.`);
    }
    const orgId = order.organization_id;
    const nowIso = new Date().toISOString();
    const confirmedAt = body.confirmed_at ?? nowIso;
    if (Number.isNaN(Date.parse(confirmedAt))) throw new ApiError(400, "CONFIRMED_AT_INVALID", "confirmed_at must be an ISO date.");
    await this.db.tx(async (c) => {
      await this.lockOrg(c, orgId);
      const planVersionId = await this.ensurePlanVersion(c, order.plan_code, nowIso);
      const sub = await this.activateSubscription(c, orgId, order, planVersionId, order.period_months, nowIso);
      await this.wallet.credit(c, orgId, p.userId, {
        kind: "PURCHASE", amount: order.tokens_granted, idempotencyKey: `purchase:${orderId}`,
        invoiceRef: order.reference,
        reason: `Bank transfer confirmed for the ${order.plan_code} plan (${order.period_months} month(s), ${order.tokens_granted} tokens).`,
        expiresAt: sub.period_end,
      });
      await c.query(
        `UPDATE bank_transfer_orders SET status = 'CONFIRMED', amount_received_minor = ?, confirmed_by = ?,
          confirmed_at = ?, bank_reference = ?, subscription_id = ? WHERE id = ?`,
        [totalReceived, p.userId, toDbDate(confirmedAt), body.bank_reference, sub.id, orderId],
      );
      await recordChange(c, userActor(p), {
        action: "billing.order_confirmed", entityType: "bank_transfer_order", entityId: orderId,
        after: { reference: order.reference, amount_received_minor: totalReceived, bank_reference: body.bank_reference, confirmed_at: confirmedAt, tokens: order.tokens_granted },
      });
      await recordChange(c, userActor(p), {
        action: "billing.plan_activated", entityType: "subscription", entityId: sub.id,
        after: { plan_code: order.plan_code, period_start: sub.period_start, period_end: sub.period_end, tokens: order.tokens_granted },
      });
    });
    return this.parseOrder(await this.orderRow(orderId, orgId));
  }

  /**
   * Activate (or extend) the subscription for a confirmed order. A renewal extends the subscription it
   * renews from its current end; otherwise the latest ACTIVE / PAST_DUE subscription is extended, or a new
   * one is created. Old entitlement grants are capped at the new period start and a fresh grant is written
   * for the new period — grants never overlap, so a consumer summing limit_value cannot double-count.
   */
  private async activateSubscription(
    ex: Executor, orgId: string, order: BankTransferOrderType, planVersionId: string, periodMonths: number, nowIso: string,
  ): Promise<{ id: string; period_start: string; period_end: string }> {
    let sub: RowDataPacket | undefined;
    if (order.renews_subscription_id) {
      sub = await this.db.one<RowDataPacket>(
        "SELECT * FROM subscriptions WHERE id = ? AND organization_id = ?", [order.renews_subscription_id, orgId], ex);
    }
    sub ??= await this.db.one<RowDataPacket>(
      "SELECT * FROM subscriptions WHERE organization_id = ? AND state IN ('ACTIVE','PAST_DUE') ORDER BY period_end DESC LIMIT 1", [orgId], ex);
    let subId: string;
    let periodStart: string;
    if (sub) {
      subId = String(sub.id);
      const existingEnd = dbIso(sub.period_end as string | null);
      periodStart = existingEnd && Date.parse(existingEnd) > Date.parse(nowIso) ? existingEnd : nowIso;
      const end = addMonths(periodStart, periodMonths);
      await ex.query(
        "UPDATE subscriptions SET plan_version_id = ?, state = 'ACTIVE', period_start = ?, period_end = ?, cancel_at_period_end = false WHERE id = ?",
        [planVersionId, toDbDate(periodStart), toDbDate(end), subId],
      );
      await ex.query(
        "UPDATE entitlement_grants SET valid_until = ? WHERE organization_id = ? AND valid_from < ? AND (valid_until IS NULL OR valid_until > ?)",
        [toDbDate(periodStart), orgId, toDbDate(periodStart), toDbDate(periodStart)],
      );
      await ex.query(
        `INSERT INTO entitlement_grants (id, organization_id, source_subscription_id, feature_key, limit_value, valid_from, valid_until)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uuidv7(), orgId, subId, `plan:${order.plan_code.toLowerCase()}`, order.tokens_granted, toDbDate(periodStart), toDbDate(end)],
      );
      return { id: subId, period_start: periodStart, period_end: end };
    }
    subId = uuidv7();
    periodStart = nowIso;
    const end = addMonths(periodStart, periodMonths);
    await ex.query(
      "INSERT INTO subscriptions (id, organization_id, plan_version_id, state, period_start, period_end) VALUES (?, ?, ?, 'ACTIVE', ?, ?)",
      [subId, orgId, planVersionId, toDbDate(periodStart), toDbDate(end)],
    );
    await ex.query(
      `INSERT INTO entitlement_grants (id, organization_id, source_subscription_id, feature_key, limit_value, valid_from, valid_until)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv7(), orgId, subId, `plan:${order.plan_code.toLowerCase()}`, order.tokens_granted, toDbDate(periodStart), toDbDate(end)],
    );
    return { id: subId, period_start: periodStart, period_end: end };
  }

  /** Reject with a reason. A rejection never activates anything — no subscription, no grant, no wallet row. */
  async rejectOrder(p: Principal, orderId: string, body: RejectOrderRequest): Promise<BankTransferOrderType> {
    requireCompanyOrg(p, this.companyOrgId);
    const row = await this.orderRow(orderId);
    const order = this.parseOrder(row);
    if (!["ORDERED", "AWAITING_CONFIRMATION", "PARTIAL"].includes(order.status)) {
      throw new ApiError(409, "ORDER_NOT_OPEN", `Only an open order can be rejected. This order is ${order.status}.`);
    }
    await this.db.tx(async (c) => {
      await c.query("UPDATE bank_transfer_orders SET status = 'REJECTED', reject_reason = ? WHERE id = ?", [body.reason, orderId]);
      await recordChange(c, userActor(p), {
        action: "billing.order_rejected", entityType: "bank_transfer_order", entityId: orderId,
        after: { reference: order.reference, reason: body.reason },
      });
    });
    return this.parseOrder(await this.orderRow(orderId, String(row.organization_id)));
  }

  /** Record a part-payment. The order becomes PARTIAL and stays inactive until the remainder is confirmed. */
  async recordPartial(p: Principal, orderId: string, body: RecordPartialRequest): Promise<BankTransferOrderType> {
    requireCompanyOrg(p, this.companyOrgId);
    const row = await this.orderRow(orderId);
    const order = this.parseOrder(row);
    if (!["AWAITING_CONFIRMATION", "PARTIAL"].includes(order.status)) {
      throw new ApiError(409, "ORDER_NOT_AWAITING_CONFIRMATION", `Only an order awaiting confirmation can take a part-payment. This order is ${order.status}.`);
    }
    const totalReceived = order.amount_received_minor + body.amount_received_minor;
    if (totalReceived >= order.amount_minor) {
      throw new ApiError(409, "ORDER_AMOUNT_MISMATCH",
        `That would record ${totalReceived} of ${order.amount_minor} minor units. A payment that completes the order goes through confirm, not record-partial.`);
    }
    await this.db.tx(async (c) => {
      await c.query(
        "UPDATE bank_transfer_orders SET status = 'PARTIAL', amount_received_minor = ?, bank_reference = ? WHERE id = ?",
        [totalReceived, body.bank_reference ?? order.bank_reference, orderId],
      );
      await recordChange(c, userActor(p), {
        action: "billing.order_partial", entityType: "bank_transfer_order", entityId: orderId,
        after: { reference: order.reference, amount_received_minor: totalReceived, amount_minor: order.amount_minor },
      });
    });
    return this.parseOrder(await this.orderRow(orderId, String(row.organization_id)));
  }

  /**
   * Record a money refund: the order becomes REFUNDED, the subscription it activated is cancelled (grants
   * capped at now), and the tokens the confirmation granted are clawed back as a negative ADJUSTMENT with the
   * refund stated in its reason (ADR-140 §2: the REFUND kind is reserved for tokens returning to a wallet, so
   * a money refund that takes tokens away is an ADJUSTMENT). If the wallet no longer holds the tokens — they
   * were already spent — the clawback is refused with 409 WALLET_WOULD_GO_NEGATIVE and the owner adjusts it
   * manually; a refund never takes a balance below zero.
   */
  async refundOrder(p: Principal, orderId: string, body: RefundOrderRequest): Promise<BankTransferOrderType> {
    requireCompanyOrg(p, this.companyOrgId);
    const row = await this.orderRow(orderId);
    const order = this.parseOrder(row);
    if (order.status !== "CONFIRMED") {
      throw new ApiError(409, "ORDER_NOT_CONFIRMED", `Only a confirmed order can be refunded. This order is ${order.status}.`);
    }
    const orgId = order.organization_id;
    const nowIso = new Date().toISOString();
    await this.db.tx(async (c) => {
      await this.lockOrg(c, orgId);
      await this.wallet.credit(c, orgId, p.userId, {
        kind: "ADJUSTMENT", amount: -order.tokens_granted, idempotencyKey: `refund-clawback:${orderId}`,
        reason: `Money refund for order ${order.reference} (${order.tokens_granted} tokens clawed back): ${body.reason}`,
      });
      if (order.subscription_id) {
        await c.query("UPDATE subscriptions SET state = 'CANCELED' WHERE id = ?", [order.subscription_id]);
        await c.query(
          "UPDATE entitlement_grants SET valid_until = ? WHERE source_subscription_id = ? AND valid_from < ? AND (valid_until IS NULL OR valid_until > ?)",
          [toDbDate(nowIso), order.subscription_id, toDbDate(nowIso), toDbDate(nowIso)],
        );
      }
      await c.query(
        "UPDATE bank_transfer_orders SET status = 'REFUNDED', amount_refunded_minor = ?, refund_reason = ? WHERE id = ?",
        [body.amount_refunded_minor ?? order.amount_minor, body.reason, orderId],
      );
      await recordChange(c, userActor(p), {
        action: "billing.order_refunded", entityType: "bank_transfer_order", entityId: orderId,
        after: { reference: order.reference, tokens_clawed_back: order.tokens_granted, amount_refunded_minor: body.amount_refunded_minor ?? order.amount_minor, reason: body.reason },
      });
    });
    return this.parseOrder(await this.orderRow(orderId, orgId));
  }

  // -- renewals + expiry (the daily job; see docs/bank-transfer-web-ui.md) --

  /** The currency a renewal invoice uses: the currency the subscription was last paid in, else the org's
   *  latest confirmed order, else NGN. */
  private async renewalCurrency(orgId: string, subscriptionId: string): Promise<"NGN" | "USD"> {
    const bySub = await this.db.one<RowDataPacket>(
      "SELECT currency FROM bank_transfer_orders WHERE subscription_id = ? AND status = 'CONFIRMED' ORDER BY confirmed_at DESC LIMIT 1", [subscriptionId]);
    if (bySub) return String(bySub.currency) as "NGN" | "USD";
    const byOrg = await this.db.one<RowDataPacket>(
      "SELECT currency FROM bank_transfer_orders WHERE organization_id = ? AND status = 'CONFIRMED' ORDER BY confirmed_at DESC LIMIT 1", [orgId]);
    if (byOrg) return String(byOrg.currency) as "NGN" | "USD";
    return "NGN";
  }

  /**
   * Create a renewal order (new reference) for every ACTIVE subscription expiring within RENEWAL_WINDOW_DAYS
   * (7) that has no renewal order yet — an open one (ORDERED / AWAITING_CONFIRMATION / PARTIAL) or a
   * confirmed one. A renewal whose order was REJECTED or REFUNDED gets a fresh one on the next run, so a
   * "no" is never silently final. Subscriptions on the FREE plan never renew. A subscription whose period is
   * not 1 or 12 months (hand-made, not from an order) is skipped: its renewal period is not defined.
   * Runs org-wide: in central mode the API runs it daily itself (startRenewalScheduler, once at start-up
   * then every 24 h); POST /v1/admin/billing/renewals/run is the manual trigger.
   * Idempotency: the "already has an open renewal" check below runs outside the transaction as a fast
   * path, and is repeated inside the transaction (after the org lock) before the insert — a concurrent
   * run (the daily job racing a manual POST, or two manual POSTs) can pass the outer check at the same
   * time, and only the in-transaction re-check keeps it from creating a second renewal order.
   */
  async createRenewalOrders(now: Date = new Date()): Promise<{ renewals_created: number; renewal_order_ids: string[]; skipped_subscription_ids: string[] }> {
    const nowIso = now.toISOString();
    const windowEnd = addDays(nowIso, RENEWAL_WINDOW_DAYS);
    const subs = await this.db.rows<RowDataPacket>(
      `SELECT s.id, s.organization_id, s.period_start, s.period_end, p.code AS plan_code
       FROM subscriptions s JOIN plan_versions pv ON pv.id = s.plan_version_id JOIN plans p ON p.id = pv.plan_id
       WHERE s.state = 'ACTIVE' AND s.period_end IS NOT NULL AND s.period_end > ? AND s.period_end <= ?`,
      [toDbDate(nowIso), toDbDate(windowEnd)],
    );
    const created: string[] = [];
    const skipped: string[] = [];
    for (const sub of subs) {
      const subId = String(sub.id);
      const orgId = String(sub.organization_id);
      // The renewal repeats the plan + period the subscription was bought with: the confirmed order that
      // created it is the record of that, not the date difference (the dates move when a subscription is
      // extended or backdated; the order does not).
      const srcOrder = await this.db.one<RowDataPacket>(
        "SELECT plan_code, period_months FROM bank_transfer_orders WHERE subscription_id = ? AND status = 'CONFIRMED' ORDER BY confirmed_at DESC LIMIT 1", [subId]);
      const planCode = srcOrder ? String(srcOrder.plan_code) : String(sub.plan_code);
      const periodMonths = srcOrder
        ? Number(srcOrder.period_months)
        : monthsBetween(dbIso(String(sub.period_start))!, dbIso(String(sub.period_end))!);
      const open = await this.db.one<RowDataPacket>(
        "SELECT id FROM bank_transfer_orders WHERE renews_subscription_id = ? AND status IN ('ORDERED','AWAITING_CONFIRMATION','PARTIAL','CONFIRMED')", [subId]);
      if (open || planCode === "FREE" || (periodMonths !== 1 && periodMonths !== 12)) {
        skipped.push(subId);
        continue;
      }
      const currency = await this.renewalCurrency(orgId, subId);
      const account = await this.db.one<RowDataPacket>(
        "SELECT * FROM bank_accounts WHERE currency = ? AND is_active = true", [currency]);
      if (!account) {
        skipped.push(subId);
        continue;
      }
      const amountMinor = planPriceMinor(planCode as "STARTER" | "CLUB" | "ACADEMY" | "SEASON", periodMonths as 1 | 12, currency);
      const tokens = planTokens(planCode as "STARTER" | "CLUB" | "ACADEMY" | "SEASON", periodMonths as 1 | 12);
      const orderId = await this.db.tx(async (c) => {
        await this.lockOrg(c, orgId);
        // Re-check inside the transaction: a concurrent run may have created the renewal after the
        // outer check above. The org lock serialises the two runs, so the second one sees the first
        // one's committed row here and creates nothing (returns null).
        const raced = await this.db.one<RowDataPacket>(
          "SELECT id FROM bank_transfer_orders WHERE renews_subscription_id = ? AND status IN ('ORDERED','AWAITING_CONFIRMATION','PARTIAL','CONFIRMED')", [subId], c);
        if (raced) return null;
        const reference = await this.nextReference(c, now.getUTCFullYear());
        const id = uuidv7();
        await c.query(
          `INSERT INTO bank_transfer_orders (id, organization_id, plan_code, period_months, amount_minor, currency, reference,
            bank_account_id, status, tokens_granted, renews_subscription_id, expires_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ORDERED', ?, ?, ?, NULL)`,
          [id, orgId, planCode, periodMonths, amountMinor, currency, reference, String(account.id), tokens, subId, toDbDate(addDays(nowIso, ORDER_EXPIRY_DAYS))],
        );
        await recordChange(c, serviceActor("billing", orgId), {
          action: "billing.renewal_order_created", entityType: "bank_transfer_order", entityId: id,
          after: { reference, plan_code: planCode, renews_subscription_id: subId },
        });
        return id;
      });
      if (orderId === null) {
        skipped.push(subId);
        continue;
      }
      created.push(orderId);
    }
    return { renewals_created: created.length, renewal_order_ids: created, skipped_subscription_ids: skipped };
  }

  /**
   * Expiry handling. A subscription past its period end is PAST_DUE while inside the grace period, then drops
   * to the free tier: state CANCELED, plan version set to the FREE plan, grants capped. Projects are kept and
   * never deleted — nothing here touches projects, videos or reels.
   */
  async processExpiries(now: Date = new Date()): Promise<{ past_due: number; downgraded_to_free: number }> {
    const nowIso = now.toISOString();
    const subs = await this.db.rows<RowDataPacket>(
      "SELECT * FROM subscriptions WHERE state IN ('ACTIVE','PAST_DUE') AND period_end IS NOT NULL AND period_end <= ?",
      [toDbDate(nowIso)],
    );
    let pastDue = 0;
    let downgraded = 0;
    for (const sub of subs) {
      const orgId = String(sub.organization_id);
      const periodEnd = dbIso(String(sub.period_end))!;
      const graceUntil = Date.parse(addDays(periodEnd, RENEWAL_GRACE_DAYS));
      if (Date.parse(nowIso) < graceUntil) {
        if (String(sub.state) === "ACTIVE") {
          await this.db.tx(async (c) => {
            await c.query("UPDATE subscriptions SET state = 'PAST_DUE' WHERE id = ?", [String(sub.id)]);
            await recordChange(c, serviceActor("billing", orgId), {
              action: "billing.subscription_past_due", entityType: "subscription", entityId: String(sub.id),
              after: { period_end: periodEnd, grace_until: addDays(periodEnd, RENEWAL_GRACE_DAYS) },
            });
          });
          pastDue += 1;
        }
        continue;
      }
      await this.db.tx(async (c) => {
        const freeVersionId = await this.ensurePlanVersion(c, "FREE", nowIso);
        await c.query("UPDATE subscriptions SET state = 'CANCELED', plan_version_id = ? WHERE id = ?", [freeVersionId, String(sub.id)]);
        await c.query(
          "UPDATE entitlement_grants SET valid_until = ? WHERE organization_id = ? AND valid_from < ? AND (valid_until IS NULL OR valid_until > ?)",
          [toDbDate(periodEnd), orgId, toDbDate(periodEnd), toDbDate(periodEnd)],
        );
        await recordChange(c, serviceActor("billing", orgId), {
          action: "billing.subscription_downgraded", entityType: "subscription", entityId: String(sub.id),
          after: { period_end: periodEnd, plan_code: "FREE" },
        });
      });
      downgraded += 1;
    }
    return { past_due: pastDue, downgraded_to_free: downgraded };
  }

  /** The daily run: renewal orders first, then expiry / grace handling. */
  async runRenewals(now: Date = new Date()): Promise<RenewalRunResult> {
    const renewals = await this.createRenewalOrders(now);
    const expiries = await this.processExpiries(now);
    return RenewalRunResult.parse({
      renewals_created: renewals.renewals_created,
      renewal_order_ids: renewals.renewal_order_ids,
      past_due: expiries.past_due,
      downgraded_to_free: expiries.downgraded_to_free,
    });
  }

  /** The manual trigger for the daily run (POST /v1/admin/billing/renewals/run): a company job, so only the
   *  company organisation may call it. The internal daily scheduler (startRenewalScheduler) calls
   *  runRenewals() directly and is unaffected by this guard. */
  async runRenewalsManual(p: Principal): Promise<RenewalRunResult> {
    requireCompanyOrg(p, this.companyOrgId);
    return this.runRenewals();
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("billing/plans")
  plans(): PlanCatalogueType {
    return this.billing.plans();
  }

  @Post("billing/orders")
  createOrder(@CurrentPrincipal() p: Principal, @Body() body: unknown): Promise<OrderWithInvoice> {
    return this.billing.createOrder(p, CreateOrderRequest.parse(body));
  }

  @Get("billing/orders")
  orders(@CurrentPrincipal() p: Principal): Promise<BankTransferOrderType[]> {
    return this.billing.listOrders(p);
  }

  @Get("billing/orders/:id")
  order(@CurrentPrincipal() p: Principal, @Param("id") id: string): Promise<OrderWithInvoice> {
    return this.billing.getOrder(p, uuidParam(id, "Order"));
  }

  @Get("billing/subscription")
  subscription(@CurrentPrincipal() p: Principal): Promise<SubscriptionStatusType | null> {
    return this.billing.subscription(p);
  }

  @Post("billing/orders/:id/proof")
  proof(@CurrentPrincipal() p: Principal, @Param("id") id: string, @Req() req: FastifyRequest): Promise<BankTransferOrderType> {
    return this.billing.uploadProof(p, uuidParam(id, "Order"), req);
  }
}

@Controller("v1/admin")
@UseGuards(AuthGuard)
@Roles("OWNER", "ADMIN")
export class AdminBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get("billing/orders")
  orders(@CurrentPrincipal() p: Principal, @Query("status") status: string | undefined): Promise<BankTransferOrderType[]> {
    if (status !== undefined && !["ORDERED", "AWAITING_CONFIRMATION", "CONFIRMED", "REJECTED", "PARTIAL", "REFUNDED"].includes(status)) {
      throw new ApiError(400, "ORDER_STATUS_INVALID", "status must be one of ORDERED, AWAITING_CONFIRMATION, CONFIRMED, REJECTED, PARTIAL, REFUNDED.");
    }
    return this.billing.adminOrders(p, status);
  }

  @Get("billing/orders/:id")
  order(@CurrentPrincipal() p: Principal, @Param("id") id: string): Promise<BankTransferOrderType> {
    return this.billing.adminGetOrder(p, uuidParam(id, "Order"));
  }

  @Get("billing/orders/:id/proof")
  proof(@CurrentPrincipal() p: Principal, @Param("id") id: string, @Res() res: FastifyReply): Promise<void> {
    return this.billing.downloadProof(p, uuidParam(id, "Order"), res);
  }

  @Post("billing/orders/:id/confirm")
  confirm(@CurrentPrincipal() p: Principal, @Param("id") id: string, @Body() body: unknown): Promise<BankTransferOrderType> {
    return this.billing.confirmOrder(p, uuidParam(id, "Order"), ConfirmOrderRequest.parse(body));
  }

  @Post("billing/orders/:id/reject")
  reject(@CurrentPrincipal() p: Principal, @Param("id") id: string, @Body() body: unknown): Promise<BankTransferOrderType> {
    return this.billing.rejectOrder(p, uuidParam(id, "Order"), RejectOrderRequest.parse(body));
  }

  @Post("billing/orders/:id/record-partial")
  recordPartial(@CurrentPrincipal() p: Principal, @Param("id") id: string, @Body() body: unknown): Promise<BankTransferOrderType> {
    return this.billing.recordPartial(p, uuidParam(id, "Order"), RecordPartialRequest.parse(body));
  }

  @Post("billing/orders/:id/refund")
  refund(@CurrentPrincipal() p: Principal, @Param("id") id: string, @Body() body: unknown): Promise<BankTransferOrderType> {
    return this.billing.refundOrder(p, uuidParam(id, "Order"), RefundOrderRequest.parse(body));
  }

  @Get("billing/bank-accounts")
  bankAccounts(): Promise<BankAccount[]> {
    return this.billing.listBankAccounts();
  }

  @Post("billing/bank-accounts")
  upsertBankAccount(@CurrentPrincipal() p: Principal, @Body() body: unknown): Promise<BankAccount> {
    return this.billing.upsertBankAccount(p, BankAccountUpsertRequest.parse(body));
  }

  /**
   * Trigger the daily billing run by hand: renewal orders for subscriptions expiring within 7 days, then
   * expiry / grace handling. In central mode the API runs this daily on its own (BillingService
   * .startRenewalScheduler — once at start-up, then every 24 h); this endpoint is the manual trigger,
   * so the owner can run it on demand. It runs org-wide, and it is a company job: only the company
   * organisation may call it (the internal scheduler is unaffected — it calls runRenewals() directly).
   */
  @Get("billing/revenue")
  revenue(@CurrentPrincipal() p: Principal): Promise<RevenueSummary> {
    return this.billing.revenue(p);
  }

  @Post("billing/renewals/run")
  runRenewals(@CurrentPrincipal() p: Principal): Promise<RenewalRunResult> {
    return this.billing.runRenewalsManual(p);
  }
}
