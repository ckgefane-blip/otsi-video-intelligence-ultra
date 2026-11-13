/**
 * v3 Phase A.15 (S13, ADR-075): the header's notifications bell.
 *
 *   GET  /v1/notifications        what happened in the organization in the last 14 days (newest first, at most 30), and how many are new
 *   POST /v1/notifications/read   the person opened the bell: everything recorded until now is read (migration 0049 notification_reads)
 *
 * Each notification is a recorded row, read where it lives; nothing is stored twice and nothing is made up:
 *   JOB_DONE / JOB_FAILED  an analysis run finished, failed or needs a review (-> Processing of the video); a reel render finished or
 *                          failed (-> Export)
 *   REVIEW                 the engine or a person suggested a reel's own player on tracks of its video and nobody decided yet (-> Analysis,
 *                          "Is this him?"; only the reel's player, never everyone in the video); team sheets read from a video wait for
 *                          approval (-> Analysis)
 *   COMMENT                someone left a comment through a share link (-> Export, where the links and their comments are)
 *   RIGHTS                 the current rights of a video end within 14 days, or ended in the last 14 (-> Export, where rights are set)
 *   BILLING                a plan order's money events — placed, receipt uploaded or marked paid, confirmed, rejected,
 *                          refunded, a renewal order created — plus a subscription ending within 7 days and an open
 *                          order expiring within 3 days (-> Billing, the order's own page)
 * The caller's organization only; projects hidden from the person, and removed items, are left out. "Unread": recorded after the person
 * last opened the bell in this organization.
 */
import { Controller, Get, HttpCode, Injectable, Post, UseGuards } from "@nestjs/common";
import { NOTIFICATION_LIMIT, NOTIFICATION_WINDOW_DAYS, Notifications, type Notification } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { notHidden } from "../../core/access";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { Db } from "../../core/db";

const WINDOW = `CURRENT_TIMESTAMP(6) - INTERVAL ${NOTIFICATION_WINDOW_DAYS} DAY`;
const DAY = 86_400_000;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const money = (minor: number, currency: string) =>
  currency === "NGN" ? `₦${(minor / 100).toLocaleString("en-NG")}` : `$${(minor / 100).toFixed(2)}`;
const videoTitle = (r: RowDataPacket) => (r.title as string | null) ?? (r.original_filename as string | null) ?? "Untitled video";
type Item = Omit<Notification, "unread" | "at"> & { at: Date };

@Injectable()
export class NotificationsService {
  constructor(private readonly db: Db) {}

  async list(p: Principal, now = new Date()): Promise<Notifications> {
    const org = p.organizationId, vh = notHidden(p, "v.project_id"), rh = notHidden(p, "r.project_id"), L = NOTIFICATION_LIMIT;
    const items: Item[] = [];

    const runs = await this.db.rows<RowDataPacket>(
      `SELECT r.id, r.status, r.finished_at, v.id AS video_id, v.title, v.original_filename FROM pipeline_runs r JOIN video_sources v ON v.id = r.video_id AND v.organization_id = r.organization_id
        WHERE r.organization_id = ? AND r.status IN ('SUCCEEDED', 'FAILED', 'REVIEW_REQUIRED') AND r.finished_at >= ${WINDOW} AND v.removed_at IS NULL${vh}
        ORDER BY r.finished_at DESC LIMIT ${L}`, [org]);
    for (const r of runs) {
      const s = r.status as string;
      items.push({ id: `run:${r.id}`, kind: s === "SUCCEEDED" ? "JOB_DONE" : "JOB_FAILED", at: new Date(r.finished_at),
        title: s === "SUCCEEDED" ? "Analysis finished" : s === "FAILED" ? "Analysis failed" : "Analysis needs a review",
        detail: videoTitle(r), href: `/processing?video=${r.video_id}` });
    }

    const renders = await this.db.rows<RowDataPacket>(
      `SELECT j.id, j.state, COALESCE(j.completed_at, j.started_at, j.created_at) AS at, r.name FROM render_jobs j JOIN reel_projects r ON r.id = j.reel_id AND r.organization_id = j.organization_id
        WHERE j.organization_id = ? AND j.state IN ('SUCCEEDED', 'FAILED') AND COALESCE(j.completed_at, j.started_at, j.created_at) >= ${WINDOW}
          AND j.removed_at IS NULL AND r.removed_at IS NULL${rh}
        ORDER BY at DESC LIMIT ${L}`, [org]);
    for (const r of renders) {
      const ok = r.state === "SUCCEEDED";
      items.push({ id: `render:${r.id}`, kind: ok ? "JOB_DONE" : "JOB_FAILED", at: new Date(r.at), title: ok ? "Reel rendered" : "Render failed",
        detail: r.name as string, href: "/exports" });
    }

    // the reel's own player only (naming is per reel player): suggested on tracks of the reel's video, nobody decided yet
    const asks = await this.db.rows<RowDataPacket>(
      `SELECT r.id, r.name, r.video_id, COUNT(DISTINCT ci.track_id) AS n, MAX(ci.decided_at) AS at
         FROM reel_projects r JOIN video_sources v ON v.id = r.video_id AND v.organization_id = r.organization_id
         JOIN tracks t ON t.video_id = r.video_id JOIN v_track_current_identity ci ON ci.track_id = t.id
        WHERE r.organization_id = ? AND r.removed_at IS NULL AND v.removed_at IS NULL AND r.player_id IS NOT NULL
          AND ci.state = 'CANDIDATE' AND ci.player_id = r.player_id AND ci.decided_at >= ${WINDOW}${rh}
        GROUP BY r.id, r.name, r.video_id ORDER BY at DESC LIMIT ${L}`, [org]);
    for (const r of asks) {
      items.push({ id: `ask:${r.id}`, kind: "REVIEW", at: new Date(r.at), title: `Is this him? ${plural(Number(r.n), "moment")} to check`,
        detail: r.name as string, href: `/analysis?video=${r.video_id}` });
    }

    const sheets = await this.db.rows<RowDataPacket>(
      `SELECT v.id, v.title, v.original_filename, COUNT(*) AS n, MAX(l.created_at) AS at FROM lineup_cards l JOIN video_sources v ON v.id = l.video_id AND v.organization_id = l.organization_id
        WHERE l.organization_id = ? AND l.state = 'PROPOSED' AND l.created_at >= ${WINDOW} AND v.removed_at IS NULL${vh}
        GROUP BY v.id, v.title, v.original_filename ORDER BY at DESC LIMIT ${L}`, [org]);
    for (const r of sheets) {
      items.push({ id: `sheet:${r.id}`, kind: "REVIEW", at: new Date(r.at), title: `${plural(Number(r.n), "team sheet")} to approve`,
        detail: videoTitle(r), href: `/analysis?video=${r.id}` });
    }

    const comments = await this.db.rows<RowDataPacket>(
      `SELECT c.id, c.guest_name, c.body, c.created_at, r.name FROM comments c LEFT JOIN reel_projects r ON r.id = c.reel_id
        WHERE c.organization_id = ? AND c.share_link_id IS NOT NULL AND c.created_at >= ${WINDOW}${notHidden(p, "c.project_id")}
        ORDER BY c.created_at DESC LIMIT ${L}`, [org]);
    for (const r of comments) {
      const body = String(r.body);
      items.push({ id: `comment:${r.id}`, kind: "COMMENT", at: new Date(r.created_at), title: `${r.guest_name as string} commented through a share link`,
        detail: `${r.name ? `${r.name as string}: ` : ""}“${body.length > 120 ? `${body.slice(0, 117)}…` : body}”`, href: "/exports" });
    }

    // the latest grant of each video counts; it is news when it comes within 14 days of its end, and again when it ends
    const rights = await this.db.rows<RowDataPacket>(
      `SELECT g.id, g.created_at, g.valid_until, v.title, v.original_filename FROM rights_grants g JOIN video_sources v ON v.id = g.video_id AND v.organization_id = g.organization_id
        WHERE g.organization_id = ? AND g.valid_until IS NOT NULL AND v.removed_at IS NULL${vh}
          AND g.valid_until BETWEEN ${WINDOW} AND CURRENT_TIMESTAMP(6) + INTERVAL ${NOTIFICATION_WINDOW_DAYS} DAY
          AND NOT EXISTS (SELECT 1 FROM rights_grants n WHERE n.organization_id = g.organization_id AND n.video_id = g.video_id AND (n.created_at > g.created_at OR (n.created_at = g.created_at AND n.id > g.id)))
        ORDER BY g.valid_until LIMIT ${L}`, [org]);
    for (const r of rights) {
      const until = new Date(r.valid_until), created = new Date(r.created_at), ended = until <= now;
      const days = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / DAY));
      const soon = new Date(Math.max(created.getTime(), until.getTime() - NOTIFICATION_WINDOW_DAYS * DAY));
      items.push({ id: `rights:${r.id}:${ended ? "ended" : "ending"}`, kind: "RIGHTS", at: ended ? until : soon,
        title: ended ? "Rights have ended" : `Rights end in ${plural(days, "day")}`,
        detail: `${videoTitle(r)} · until ${until.toISOString().slice(0, 10)}`, href: "/exports" });
    }

    // billing: a plan order's money events are rows read where they live — an order is news when it is
    // placed, when the payer uploads a receipt or marks paid, when the admin confirms / rejects / refunds
    // it, and when the daily job creates its renewal. A row counts if any of its event times falls in the
    // window, so an old order confirmed recently still notifies.
    const orders = await this.db.rows<RowDataPacket>(
      `SELECT id, reference, plan_code, period_months, amount_minor, currency, status, created_at, updated_at,
         confirmed_at, proof_uploaded_at, proof_filename, proof_note, reject_reason, refund_reason,
         renews_subscription_id, expires_at, tokens_granted
       FROM bank_transfer_orders WHERE organization_id = ?
         AND (created_at >= ${WINDOW} OR confirmed_at >= ${WINDOW} OR proof_uploaded_at >= ${WINDOW} OR updated_at >= ${WINDOW})
       ORDER BY created_at DESC LIMIT ${L}`, [org]);
    for (const o of orders) {
      const href = `/settings/billing/orders/${o.id}`;
      const plan = `${o.plan_code as string} · ${Number(o.period_months)} month${Number(o.period_months) === 1 ? "" : "s"}`;
      const amount = money(Number(o.amount_minor), String(o.currency));
      items.push({ id: `order:${o.id}:created`, kind: "BILLING", at: new Date(o.created_at),
        title: `Order placed — ${plan}`, detail: `${o.reference as string} · ${amount}`, href });
      if (o.proof_uploaded_at) {
        items.push({ id: `order:${o.id}:proof`, kind: "BILLING", at: new Date(o.proof_uploaded_at),
          title: "Receipt uploaded", detail: `${(o.proof_filename as string | null) ?? "Receipt"} · ${o.reference as string}`, href });
      } else if (o.status === "AWAITING_CONFIRMATION") {
        // no file: the payer marked paid. updated_at is the last transition, which for an awaiting order
        // is the mark-paid step (a part-payment leaves the order PARTIAL, not awaiting).
        items.push({ id: `order:${o.id}:marked-paid`, kind: "BILLING", at: new Date(o.updated_at),
          title: "Marked paid — no receipt", detail: `${o.reference as string}${o.proof_note ? ` · ${o.proof_note as string}` : ""}`, href });
      }
      if (o.confirmed_at) {
        items.push({ id: `order:${o.id}:confirmed`, kind: "BILLING", at: new Date(o.confirmed_at),
          title: `Payment confirmed — ${plan} active`, detail: `${o.reference as string} · ${Number(o.tokens_granted).toLocaleString("en-GB")} tokens`, href });
      }
      if (o.status === "REJECTED") {
        items.push({ id: `order:${o.id}:rejected`, kind: "BILLING", at: new Date(o.updated_at),
          title: "Order rejected", detail: `${o.reference as string}${o.reject_reason ? ` · ${o.reject_reason as string}` : ""}`, href });
      }
      if (o.status === "REFUNDED") {
        items.push({ id: `order:${o.id}:refunded`, kind: "BILLING", at: new Date(o.updated_at),
          title: "Refund issued", detail: `${o.reference as string}${o.refund_reason ? ` · ${o.refund_reason as string}` : ""}`, href });
      }
      if (o.renews_subscription_id) {
        items.push({ id: `order:${o.id}:renewal`, kind: "BILLING", at: new Date(o.created_at),
          title: `Renewal order created — ${plan}`, detail: `${o.reference as string} · ${amount}`, href });
      }
      if (o.status === "ORDERED" && o.expires_at) {
        const exp = new Date(o.expires_at);
        if (exp > now && exp.getTime() - now.getTime() <= 3 * DAY) {
          const days = Math.max(1, Math.ceil((exp.getTime() - now.getTime()) / DAY));
          items.push({ id: `order:${o.id}:expiring`, kind: "BILLING", at: new Date(Math.max(new Date(o.created_at).getTime(), exp.getTime() - 3 * DAY)),
            title: `Order expires in ${plural(days, "day")}`, detail: `${o.reference as string} · pay by ${exp.toISOString().slice(0, 10)}`, href });
        }
      }
    }

    // a live subscription ending within 7 days is news 7 days before its end (same shape as the rights warning)
    const subs = await this.db.rows<RowDataPacket>(
      `SELECT s.id, s.period_start, s.period_end, p.code AS plan_code FROM subscriptions s
         JOIN plan_versions pv ON pv.id = s.plan_version_id JOIN plans p ON p.id = pv.plan_id
       WHERE s.organization_id = ? AND s.state = 'ACTIVE' AND s.period_end IS NOT NULL
         AND s.period_end > CURRENT_TIMESTAMP(6) AND s.period_end <= CURRENT_TIMESTAMP(6) + INTERVAL 7 DAY
       ORDER BY s.period_end LIMIT ${L}`, [org]);
    for (const s of subs) {
      const end = new Date(s.period_end), start = new Date(s.period_start);
      const days = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / DAY));
      const soon = new Date(Math.max(start.getTime(), end.getTime() - 7 * DAY));
      items.push({ id: `sub:${s.id}:expiring`, kind: "BILLING", at: soon,
        title: `Subscription ends in ${plural(days, "day")}`,
        detail: `${s.plan_code as string} · until ${end.toISOString().slice(0, 10)}`, href: "/settings/billing" });
    }

    const seen = await this.db.one<RowDataPacket>("SELECT seen_at FROM notification_reads WHERE user_id = ? AND organization_id = ?", [p.userId, org]);
    const seenAt = seen ? new Date(seen.seen_at) : null;
    const out = items.sort((x, y) => y.at.getTime() - x.at.getTime() || x.id.localeCompare(y.id)).slice(0, L)
      .map((i) => ({ ...i, at: i.at.toISOString(), unread: !seenAt || i.at > seenAt }));
    return Notifications.parse({ items: out, unread: out.filter((i) => i.unread).length, seen_at: seenAt?.toISOString() ?? null, window_days: NOTIFICATION_WINDOW_DAYS });
  }

  async markRead(p: Principal): Promise<{ seen_at: string }> {
    await this.db.rows(
      `INSERT INTO notification_reads (user_id, organization_id, seen_at) VALUES (?, ?, CURRENT_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE seen_at = CURRENT_TIMESTAMP(6)`, [p.userId, p.organizationId]);
    const r = await this.db.one<RowDataPacket>("SELECT seen_at FROM notification_reads WHERE user_id = ? AND organization_id = ?", [p.userId, p.organizationId]);
    return { seen_at: new Date(r!.seen_at).toISOString() };
  }
}

@Controller("v1/notifications")
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentPrincipal() p: Principal) {
    return this.notifications.list(p);
  }

  @Post("read")
  @HttpCode(200)
  read(@CurrentPrincipal() p: Principal) {
    return this.notifications.markRead(p);
  }
}
