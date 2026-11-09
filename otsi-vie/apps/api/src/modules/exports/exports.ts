/**
 * Page 10 Output & Reports, Download All and Deliver to Client (ADR-058, migration 0044). Every route is under /v1/reels/:reelId, so the
 * project access check (ADR-057) covers it.
 *   POST /v1/reels/:reelId/bundles {items}            make the companions of the reel's newest finished render, each on its own
 *   GET  /v1/reels/:reelId/bundles                    the reel's bundles, newest first, with signed links to each file
 *   POST /v1/reels/:reelId/bundles/:bundleId/zip      Download All: one ZIP (stored, not compressed) of the render, the files and a manifest
 *   POST /v1/reels/:reelId/deliveries {...}           Deliver to Client: rights-checked share link + a delivery record; the page then opens
 *                                                     the sender's own mail app with the message (zero cost: no mail service)
 *   GET  /v1/reels/:reelId/deliveries                 the reel's deliveries with their receipts (link opened, expired, revoked)
 * Nothing is invented: the PDFs, the CSV and the PNG come from the reel's clips, confirmed identities and measured values. A heatmap with
 * no measured position is NOT_MEASURED, never an empty picture presented as data.
 */
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { BUILTIN_PRESETS, BUNDLE_ITEM_NAMES, BundleItemKind, CreateBundleRequest, CreateDeliveryRequest, CreatedDelivery, Delivery, ExportBundle,
  InterchangeExport, PreviewKind, ReportPreview, buildInterchangeExport, type PlayerEvent, type PlayerMeasures, type Reel } from "@otsi-vie/contracts";
import type { FastifyReply } from "fastify";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { crc32 } from "node:zlib";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { loadAccess } from "../../core/access";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { printPdf, screenshotPng } from "../../core/chromium";
import { CONFIG, Config } from "../../core/config";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { LocalStore } from "../../core/storage";
import { AnalysisService } from "../analysis/analysis";
import { HeatZonesService } from "../analysis/heat";
import { PlayerReportService } from "../playerreport/playerreport";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";
import { ExportPresetsService } from "../reels/export-presets";
import { ReelsService } from "../reels/reels";
import { SharingService } from "../sharing/sharing";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const s = (us: number) => (us / 1e6).toFixed(2);
const clock = (us: number) => `${Math.floor(us / 6e7)}:${String(Math.floor(us / 1e6) % 60).padStart(2, "0")}`;
const csvCell = (v: unknown) => { const t = String(v ?? ""); return /[",\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? "'" : "") + t.replace(/"/g, '""')}"` : t; };
const EVENT_NAMES: Record<string, string> = { PASS: "Pass", RECEIVED: "Pass received", BALL_WON: "Ball won", PRESSURE: "Pressure", SHOT: "Shot" };
const FILE: Record<BundleItemKind, [string, string, string]> = {          // file name, mime type, asset kind
  PERFORMANCE_PDF: ["performance-report.pdf", "application/pdf", "REPORT"], CLIP_SHEET_PDF: ["clip-sheet.pdf", "application/pdf", "REPORT"],
  EVENTS_CSV: ["event-list.csv", "text/csv; charset=utf-8", "EVENTS"], HEATMAP_PNG: ["heatmap.png", "image/png", "HEATMAP"],
};
const ZIP_LIMIT = 0xffff_fff0;                                          // a stored ZIP without ZIP64 holds at most 4 GB
const DEDUP_MIN = 2;

class NotMeasured extends Error {}

/** his events inside each clip of the reel (video time) */
export function eventsInClips(reel: Pick<Reel, "video_id" | "clips">, events: PlayerEvent[]) {
  return [...reel.clips].sort((a, b) => a.sequence_index - b.sequence_index).map((c, i) => ({
    n: i + 1, clip: c, events: events.filter((e) => e.video_id === reel.video_id && e.start_us >= c.in_pts_us && e.start_us <= c.out_pts_us).sort((a, b) => a.start_us - b.start_us),
  }));
}

export function eventsCsv(reel: Pick<Reel, "video_id" | "clips" | "name">, playerName: string, events: PlayerEvent[]): string {
  const head = ["reel", "player", "clip", "clip_in_s", "clip_out_s", "event", "event_start_s", "event_end_s", "key", "detail", "partner", "evidence"];
  const rows: unknown[][] = [];
  for (const { n, clip, events: ev } of eventsInClips(reel, events)) {
    if (!ev.length) rows.push([reel.name, playerName, n, s(clip.in_pts_us), s(clip.out_pts_us), "", "", "", "", "", "", ""]);
    for (const e of ev) rows.push([reel.name, playerName, n, s(clip.in_pts_us), s(clip.out_pts_us), EVENT_NAMES[e.kind] ?? e.kind, s(e.start_us), s(e.end_us), e.key ? "yes" : "no",
      [e.how, e.set_piece, e.regain === null ? null : e.regain ? "regain" : null].filter(Boolean).join(" "), e.partner_name ?? "", e.evidence]);
  }
  return "﻿" + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** a heat grid as an SVG pitch; null when nothing was measured */
export function heatSvg(m: PlayerMeasures, name: string): string | null {
  const h = m.heat;
  if (!h || !h.seconds.some((x) => x > 0)) return null;
  const max = Math.max(...h.seconds), W = 1050, H = Math.round(W * h.width_m / h.length_m), cw = W / h.cols, ch = H / h.rows;
  const cells = h.seconds.map((v, i) => v > 0 ? `<rect x="${(i % h.cols) * cw}" y="${Math.floor(i / h.cols) * ch}" width="${cw}" height="${ch}" fill="#ff5a1f" fill-opacity="${(0.12 + 0.78 * v / max).toFixed(3)}"/>` : "").join("");
  const lines = `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#fff" stroke-width="3"/><line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" stroke="#fff" stroke-width="2"/>
    <circle cx="${W / 2}" cy="${H / 2}" r="${9.15 * W / h.length_m}" fill="none" stroke="#fff" stroke-width="2"/>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#06142a;color:#e3eefb;font:18px Arial,sans-serif}
    .w{padding:24px 40px}h1{font-size:26px;margin:0 0 4px}p{margin:0 0 14px;color:#9fb3cc;font-size:15px}</style></head><body><div class="w">
    <h1>${esc(name)} · heatmap</h1><p>Seconds measured in each zone: ${(h.measured_s / 60).toFixed(1)} min measured of ${(h.seen_s / 60).toFixed(1)} min seen, from ${m.videos} video${m.videos === 1 ? "" : "s"}.
    ${h.ends_as_filmed ? "Ends as filmed (the teams' direction is not turned)." : ""} Darker = longer.</p>
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#1d6b3a"/>${cells}${lines}</svg></div></body></html>`;
}

interface Who { track_id: string; track_number: number; first: number; last: number; state: string; basis: string | null; by: string | null; at: string | null }

export function clipSheetHtml(reel: Reel, events: PlayerEvent[], who: Who[], org: string, at: Date): string {
  const player = reel.player?.display_name ?? "—";
  const clips = eventsInClips(reel, events).map(({ n, clip, events: ev }) => `<tr><td>${n}</td><td>${clock(clip.in_pts_us)}</td><td>${clock(clip.out_pts_us)}</td>
      <td>${s(clip.out_pts_us - clip.in_pts_us)} s</td><td>${esc(clip.label ?? (clip.origin === "SUGGESTED" ? "Suggested moment" : "Chosen by hand"))}</td>
      <td>${ev.length ? ev.map((e) => `${esc(EVENT_NAMES[e.kind] ?? e.kind)}${e.key ? " (key)" : ""} at ${clock(e.start_us)}${e.partner_name ? ` with ${esc(e.partner_name)}` : ""}`).join("<br>") : '<span class="m">No event of his found in this clip</span>'}</td></tr>`).join("");
  const ids = who.map((w) => `<tr><td>#${w.track_number}</td><td>${clock(w.first)} – ${clock(w.last)}</td><td>${esc(w.state === "CONFIRMED" ? "Confirmed by a person" : w.state)}</td>
      <td>${esc(w.basis ?? "—")}</td><td>${esc(w.by ?? "—")}</td><td>${w.at ? esc(new Date(w.at).toISOString().slice(0, 16).replace("T", " ")) : "—"}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:11px Arial,sans-serif;color:#122}h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px}
    table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccd;padding:4px 6px;text-align:left;vertical-align:top}th{background:#eef2f8}.m{color:#778}p{color:#556;margin:2px 0}</style></head><body>
    <h1>${esc(reel.name)}</h1><p>${esc(player)}${reel.player?.canonical_otsi_id ? ` · ${esc(reel.player.canonical_otsi_id)}` : ""}${reel.match?.home && reel.match?.away ? ` · ${esc(reel.match.home)} vs ${esc(reel.match.away)}` : ""}${reel.match?.competition ? ` · ${esc(reel.match.competition)}` : ""}</p>
    <p>${esc(org)} · made ${esc(at.toISOString().slice(0, 16).replace("T", " "))} UTC · times are video time</p>
    <h2>Clips (${reel.clips.length})</h2><table><tr><th>#</th><th>In</th><th>Out</th><th>Length</th><th>What</th><th>His events in the clip (engine-detected)</th></tr>${clips}</table>
    <h2>How he was identified</h2><p>The spotlight follows only the tracks below. Each one was decided by a person; a track the engine merely detected is not shown as him.</p>
    <table><tr><th>Track</th><th>Seen</th><th>State</th><th>Basis</th><th>Decided by</th><th>When (UTC)</th></tr>${ids || '<tr><td colspan="6" class="m">No track</td></tr>'}</table>
    </body></html>`;
}

/** a ZIP of these files, stored (not compressed): CRC-32 from node:zlib, UTF-8 names; refuses more than 4 GB */
export async function writeZip(target: string, files: { name: string; path?: string; data?: Buffer }[]): Promise<{ bytes: number }> {
  const meta: { name: Buffer; crc: number; size: number; offset: number }[] = [];
  let total = 0;
  for (const f of files) {
    let crc = 0, size = 0;
    if (f.data) { crc = crc32(f.data); size = f.data.length; }
    else for await (const chunk of createReadStream(f.path!)) { crc = crc32(chunk as Buffer, crc); size += (chunk as Buffer).length; }
    total += size + 30 + 46 + Buffer.byteLength(f.name) * 2;
    if (total > ZIP_LIMIT) throw new ApiError(413, "BUNDLE_TOO_LARGE", "These files are larger than 4 GB together; download them one by one.");
    meta.push({ name: Buffer.from(f.name, "utf8"), crc, size, offset: 0 });
  }
  const out = createWriteStream(target);
  const write = (b: Buffer) => new Promise<void>((ok, bad) => out.write(b, (e) => (e ? bad(e) : ok())));
  let at = 0;
  const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!, m = meta[i]!;
      m.offset = at;
      const h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(dosTime, 10); h.writeUInt16LE(dosDate, 12);
      h.writeUInt32LE(m.crc >>> 0, 14); h.writeUInt32LE(m.size, 18); h.writeUInt32LE(m.size, 22); h.writeUInt16LE(m.name.length, 26); h.writeUInt16LE(0, 28);
      await write(h); await write(m.name); at += 30 + m.name.length;
      if (f.data) await write(f.data);
      else for await (const chunk of createReadStream(f.path!)) await write(chunk as Buffer);
      at += m.size;
    }
    const cdStart = at;
    for (const m of meta) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10); c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14);
      c.writeUInt32LE(m.crc >>> 0, 16); c.writeUInt32LE(m.size, 20); c.writeUInt32LE(m.size, 24); c.writeUInt16LE(m.name.length, 28); c.writeUInt32LE(m.offset, 42);
      await write(c); await write(m.name); at += 46 + m.name.length;
    }
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(meta.length, 8); e.writeUInt16LE(meta.length, 10); e.writeUInt32LE(at - cdStart, 12); e.writeUInt32LE(cdStart, 16);
    await write(e); at += 22;
  } finally { await new Promise<void>((ok) => out.end(ok)); }
  return { bytes: at };
}

async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

@Injectable()
export class ExportsService {
  private readonly store: LocalStore | null;
  constructor(@Inject(CONFIG) cfg: Config, private readonly db: Db, @Inject(ReelsService) private readonly reels: ReelsService,
              @Inject(HeatZonesService) private readonly heat: HeatZonesService, @Inject(PlayerReportService) private readonly reports: PlayerReportService,
              @Inject(AnalysisService) private readonly analysis: AnalysisService, @Inject(SharingService) private readonly sharing: SharingService,
              @Inject(ExportPresetsService) private readonly presets: ExportPresetsService) {
    this.store = cfg.storage ? new LocalStore(cfg.storage.dir) : null;
  }

  private needStore(): LocalStore {
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    return this.store;
  }

  /** the reel (as its page shows it), its project, and its newest finished render with a file */
  private async finished(reelId: string, p: Principal) {
    const reel = await this.reels.get(reelId, p);
    const row = await this.db.one<RowDataPacket>("SELECT project_id FROM reel_projects WHERE id = ? AND organization_id = ?", [reelId, p.organizationId]);
    const r = await this.db.one<RowDataPacket>(
      `SELECT j.id, j.output_asset_id, a.object_key, a.byte_size, a.mime_type, a.sha256 FROM render_jobs j JOIN assets a ON a.id = j.output_asset_id
        WHERE j.reel_id = ? AND j.organization_id = ? AND j.state = 'SUCCEEDED' AND j.removed_at IS NULL ORDER BY j.completed_at DESC, j.created_at DESC LIMIT 1`, [reelId, p.organizationId]);
    if (!r) throw new ApiError(409, "NOT_RENDERED", "Render the reel first: the companions and the delivery belong to a finished render.");
    return { reel, projectId: String(row!.project_id), render: r };
  }

  /** B.23 (ADR-098): a rule-built report as the page it will print, from the engine's records now; no render needed, nothing saved */
  async preview(reelId: string, kind: PreviewKind, p: Principal): Promise<ReportPreview> {
    const reel = await this.reels.get(reelId, p);
    const playerId = reel.player?.player_id ?? null;
    if (!playerId) throw new ApiError(409, "NO_PLAYER", "The reel has no confirmed player: the reports are about the reel's player.");
    const at = new Date();
    let html: string;
    if (kind === "PERFORMANCE_PDF") html = await this.reports.reportHtmlOf(playerId, p, at);
    else {
      const org = String((await this.db.one<RowDataPacket>("SELECT name FROM organizations WHERE id = ?", [p.organizationId]))?.name ?? "");
      html = clipSheetHtml(reel, (await this.heat.playerEvents(playerId, p)).items, await this.who(reel, p), org, at);
    }
    return ReportPreview.parse({ kind, html, generated_at: at.toISOString() });
  }

  /** C.3 (ADR-103): OpenTimelineIO (.otio) timeline and .otsi-reel manifest carrying faithful evidence flags */
  async interchange(reelId: string, presetId: string | undefined, p: Principal): Promise<InterchangeExport> {
    const reel = await this.reels.get(reelId, p);
    if (!reel.clips.length) throw new ApiError(409, "NO_CLIPS", "Add at least one clip to the reel before exporting its timeline.");
    const wanted = presetId?.trim();
    const preset = wanted ? (await this.presets.list(p)).find((x) => x.id === wanted) ?? null : BUILTIN_PRESETS[0]!;
    if (!preset) throw notFound("Preset");
    const v = await this.db.one<RowDataPacket>(
      `SELECT v.title, v.duration_us, a.sha256
         FROM video_sources v LEFT JOIN assets a ON a.id = v.source_asset_id
        WHERE v.id = ? AND v.organization_id = ?`, [reel.video_id, p.organizationId]);
    const events = reel.player ? (await this.heat.playerEvents(reel.player.player_id, p)).items : [];
    const who = await this.who(reel, p);
    const rights = await this.sharing.rights(reel.video_id, p).catch(() => null);
    return buildInterchangeExport({
      reel,
      video: {
        title: String(v?.title ?? reel.name),
        duration_us: v?.duration_us == null ? null : Number(v.duration_us),
        source_sha256: (v?.sha256 as string | null) ?? null,
      },
      preset,
      who,
      events,
      rights,
    });
  }

  // ------------------------------------------------------------------ bundles
  async createBundle(reelId: string, body: CreateBundleRequest, p: Principal): Promise<ExportBundle> {
    const store = this.needStore();
    const { reel, projectId, render } = await this.finished(reelId, p);
    const id = uuidv7();
    await this.db.rows("INSERT INTO export_bundles (id, organization_id, reel_id, render_id, requested_by, items) VALUES (?, ?, ?, ?, ?, ?)",
      [id, p.organizationId, reelId, render.id, p.userId, JSON.stringify(body.items)]);
    const playerId = reel.player?.player_id ?? null;
    const org = String((await this.db.one<RowDataPacket>("SELECT name FROM organizations WHERE id = ?", [p.organizationId]))?.name ?? "");
    let events: PlayerEvent[] | null = null;
    const eventsOf = async () => (events ??= playerId ? (await this.heat.playerEvents(playerId, p)).items : []);
    const outcome: Record<string, string> = {};
    for (const kind of body.items) {
      try {
        if (!playerId) throw new NotMeasured("The reel has no player.");
        if (kind === "PERFORMANCE_PDF") {
          const job = await this.reports.makeReport(playerId, p);
          const a = await this.db.one<RowDataPacket>("SELECT a.id, a.byte_size, a.sha256 FROM report_jobs j JOIN assets a ON a.id = j.output_asset_id WHERE j.id = ?", [job.id]);
          if (!a) throw new Error("The report has no file.");
          await this.db.rows("INSERT INTO export_bundle_items (bundle_id, kind, state, asset_id, report_job_id, byte_size, sha256) VALUES (?, ?, 'SUCCEEDED', ?, ?, ?, ?)",
            [id, kind, a.id, job.id, a.byte_size, a.sha256]);
        } else {
          let data: Buffer;
          if (kind === "EVENTS_CSV") data = Buffer.from(eventsCsv(reel, reel.player!.display_name, await eventsOf()), "utf8");
          else if (kind === "CLIP_SHEET_PDF") data = await printPdf(clipSheetHtml(reel, await eventsOf(), await this.who(reel, p), org, new Date()), "OTSI VIE clip sheet");
          else {
            const html = heatSvg(await this.heat.player(playerId, p), reel.player!.display_name);
            if (!html) throw new NotMeasured("No position of his was measured on a calibrated pitch.");
            data = await screenshotPng(html, 1130, 860);
          }
          await this.saveItem(store, id, kind, data, projectId, p);
        }
        outcome[kind] = "SUCCEEDED";
      } catch (e) {
        const state = e instanceof NotMeasured ? "NOT_MEASURED" : "FAILED";
        const why = (e instanceof ApiError || e instanceof NotMeasured ? e.message : "This file could not be made.").slice(0, 255);
        await this.db.rows("INSERT INTO export_bundle_items (bundle_id, kind, state, failure) VALUES (?, ?, ?, ?)", [id, kind, state, why]);
        outcome[kind] = state;
      }
    }
    await this.db.tx(async (c) => {
      await c.query("UPDATE export_bundles SET completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: "export_bundle.created", entityType: "reel", entityId: reelId, after: { bundle_id: id, render_id: render.id, items: outcome } });
    });
    return (await this.bundles(reelId, p)).find((b) => b.id === id)!;
  }

  private async saveItem(store: LocalStore, bundleId: string, kind: BundleItemKind, data: Buffer, projectId: string, p: Principal) {
    const [name, mime, assetKind] = FILE[kind];
    const key = `org/${p.organizationId}/exports/${bundleId}/${name}`, file = store.resolve(key), assetId = uuidv7();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    const sha = createHash("sha256").update(data).digest("hex");
    await this.db.tx(async (c) => {
      await c.query(`INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, created_by, metadata)
                     VALUES (?, ?, ?, ?, ?, 'local', ?, ?, ?, ?, ?)`, [assetId, p.organizationId, projectId, assetKind, key, data.length, sha, mime, p.userId, JSON.stringify({ bundle_id: bundleId, filename: name })]);
      await c.query("INSERT INTO export_bundle_items (bundle_id, kind, state, asset_id, byte_size, sha256) VALUES (?, ?, 'SUCCEEDED', ?, ?, ?)", [bundleId, kind, assetId, data.length, sha]);
    });
  }

  /** the reel's tracks and how each was identified */
  private async who(reel: Reel, p: Principal): Promise<Who[]> {
    if (!reel.targets.length) return [];
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT ci.track_id, ci.state, ci.basis, ci.decided_at, u.display_name FROM v_track_current_identity ci LEFT JOIN users u ON u.id = ci.decided_by
        JOIN tracks t ON t.id = ci.track_id JOIN video_sources v ON v.id = t.video_id AND v.organization_id = ? WHERE ci.track_id IN (?)`,
      [p.organizationId, reel.targets.map((t) => t.track_id)]);
    const by = new Map(rows.map((r) => [String(r.track_id), r]));
    return reel.targets.map((t) => {
      const r = by.get(t.track_id);
      return { track_id: t.track_id, track_number: t.track_number, first: t.first_pts_us, last: t.last_pts_us, state: r ? String(r.state) : "UNKNOWN", basis: r?.basis ?? null, by: r?.display_name ?? null, at: iso(r?.decided_at) };
    });
  }

  async bundles(reelId: string, p: Principal): Promise<ExportBundle[]> {
    await this.reels.get(reelId, p);
    const bs = await this.db.rows<RowDataPacket>(
      `SELECT b.*, u.display_name, z.byte_size AS zip_bytes FROM export_bundles b JOIN users u ON u.id = b.requested_by LEFT JOIN assets z ON z.id = b.zip_asset_id
        WHERE b.reel_id = ? AND b.organization_id = ? ORDER BY b.created_at DESC LIMIT 5`, [reelId, p.organizationId]);
    if (!bs.length) return [];
    const items = await this.db.rows<RowDataPacket>("SELECT * FROM export_bundle_items WHERE bundle_id IN (?) ORDER BY FIELD(kind, 'PERFORMANCE_PDF', 'CLIP_SHEET_PDF', 'EVENTS_CSV', 'HEATMAP_PNG')", [bs.map((b) => b.id)]);
    const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;
    return bs.map((b) => ExportBundle.parse({
      id: b.id, reel_id: b.reel_id, render_id: b.render_id, requested: json<string[]>(b.items), created_at: iso(b.created_at), completed_at: iso(b.completed_at),
      requested_by_name: b.display_name ?? "",
      zip: b.zip_asset_id ? { bytes: Number(b.zip_bytes), download_url: this.analysis.signedUrl(String(b.zip_asset_id), p.organizationId, true).url } : null,
      items: items.filter((i) => i.bundle_id === b.id).map((i) => ({
        kind: i.kind, state: i.state, bytes: i.byte_size === null ? null : Number(i.byte_size), sha256: i.sha256 ?? null, failure: i.failure ?? null,
        view_url: i.asset_id ? this.analysis.signedUrl(String(i.asset_id), p.organizationId, false).url : null,
        download_url: i.asset_id ? this.analysis.signedUrl(String(i.asset_id), p.organizationId, true).url : null,
      })),
    }));
  }

  /** Download All: the render and every made file of the bundle in one ZIP, with manifest.json (sizes, SHA-256, what is not included) */
  async zip(reelId: string, bundleId: string, p: Principal): Promise<ExportBundle> {
    const store = this.needStore();
    const { reel } = await this.finished(reelId, p);
    const b = await this.db.one<RowDataPacket>("SELECT * FROM export_bundles WHERE id = ? AND reel_id = ? AND organization_id = ?", [bundleId, reelId, p.organizationId]);
    if (!b) throw notFound("Bundle");
    if (!b.completed_at) throw new ApiError(409, "BUNDLE_NOT_READY", "The files are still being made.");
    if (!b.zip_asset_id) {
      const render = await this.db.one<RowDataPacket>(
        "SELECT a.object_key, a.byte_size, a.mime_type FROM render_jobs j JOIN assets a ON a.id = j.output_asset_id WHERE j.id = ? AND j.state = 'SUCCEEDED' AND j.removed_at IS NULL", [b.render_id]);
      if (!render) throw new ApiError(409, "RENDER_GONE", "The render this bundle belongs to is no longer available. Make the files again for the newest render.");
      const items = await this.db.rows<RowDataPacket>("SELECT i.*, a.object_key FROM export_bundle_items i LEFT JOIN assets a ON a.id = i.asset_id WHERE i.bundle_id = ?", [bundleId]);
      const ext = render.mime_type === "video/webm" ? "webm" : "mp4";
      const renderFile = store.resolve(String(render.object_key));
      const files: { name: string; path?: string; data?: Buffer }[] = [{ name: `reel.${ext}`, path: renderFile }];
      const listed = [{ name: `reel.${ext}`, bytes: (await stat(renderFile)).size, sha256: await sha256File(renderFile) }];
      for (const i of items.filter((x) => x.state === "SUCCEEDED")) {
        const name = FILE[i.kind as BundleItemKind][0];
        files.push({ name, path: store.resolve(String(i.object_key)) });
        listed.push({ name, bytes: Number(i.byte_size), sha256: String(i.sha256) });
      }
      const manifest = { reel: reel.name, player: reel.player?.display_name ?? null, reel_id: reelId, render_id: b.render_id, bundle_id: bundleId, made_at: new Date().toISOString(),
        files: listed, not_included: items.filter((x) => x.state !== "SUCCEEDED").map((x) => ({ item: BUNDLE_ITEM_NAMES[x.kind as BundleItemKind][0], state: x.state, why: x.failure })) };
      files.push({ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") });
      const key = `org/${p.organizationId}/exports/${bundleId}/otsi-export.zip`, file = store.resolve(key), assetId = uuidv7();
      await mkdir(path.dirname(file), { recursive: true });
      const { bytes } = await writeZip(file, files);
      const sha = await sha256File(file);
      await this.db.tx(async (c) => {
        await c.query(`INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, created_by, metadata)
                       SELECT ?, ?, project_id, 'BUNDLE', ?, 'local', ?, ?, 'application/zip', ?, ? FROM reel_projects WHERE id = ?`,
          [assetId, p.organizationId, key, bytes, sha, p.userId, JSON.stringify({ bundle_id: bundleId, filename: `${reel.name.replace(/[^\w.-]+/g, "-").slice(0, 60) || "reel"}.zip` }), reelId]);
        await c.query("UPDATE export_bundles SET zip_asset_id = ? WHERE id = ?", [assetId, bundleId]);
        await recordChange(c, userActor(p), { action: "export_bundle.zipped", entityType: "reel", entityId: reelId, after: { bundle_id: bundleId, bytes, files: listed.length } });
      });
    }
    return (await this.bundles(reelId, p)).find((x) => x.id === bundleId)!;
  }

  // ------------------------------------------------------------------ delivery
  async deliver(reelId: string, body: CreateDeliveryRequest, p: Principal): Promise<CreatedDelivery> {
    const { reel, projectId, render } = await this.finished(reelId, p);
    if (body.notify_client && (!body.recipient_email || !body.recipient_name)) throw new ApiError(422, "CLIENT_REQUIRED", "Enter the client's name and email address.");
    if (body.notify_team && !body.team_user_ids.length) throw new ApiError(422, "TEAM_REQUIRED", "Choose who in the team gets it.");
    if (!body.notify_client && !body.notify_team) throw new ApiError(422, "NO_RECIPIENT", "Turn on Notify client or Notify team and choose who gets it.");
    const team = body.notify_team ? [...new Set(body.team_user_ids)] : [];
    const members = team.length ? await this.db.rows<RowDataPacket>(
      `SELECT u.id, u.display_name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND m.status = 'ACTIVE' AND u.id IN (?)`,
      [p.organizationId, team]) : [];
    if (members.length !== team.length) throw new ApiError(422, "NOT_A_MEMBER", "Someone chosen is not an active member of your organization.");
    const blind: string[] = [];
    for (const m of members) if ((await loadAccess(this.db, String(m.id), p.organizationId, String(m.role))).hidden.includes(projectId)) blind.push(String(m.display_name));
    if (blind.length) throw new ApiError(422, "TEAM_MEMBER_CANNOT_SEE", `${blind.join(", ")} cannot see this project. Add them on the project's Manage Access first, or leave them out.`);
    const email = body.notify_client ? body.recipient_email!.toLowerCase() : null;
    if (email) {
      const dup = await this.db.one<RowDataPacket>(
        `SELECT id FROM deliveries WHERE render_id = ? AND destination_ref = ? AND state = 'SUCCEEDED' AND created_at > CURRENT_TIMESTAMP(6) - INTERVAL ${DEDUP_MIN} MINUTE`, [render.id, email]);
      if (dup) throw new ApiError(409, "DUPLICATE_DELIVERY", `This render was sent to ${email} less than ${DEDUP_MIN} minutes ago.`);
    }
    const id = uuidv7();
    const base = [id, p.organizationId, render.output_asset_id, p.userId, email ? "EMAIL_INVITE" : "INTERNAL", email, reelId, render.id, body.notify_client ? body.recipient_name : null,
      body.message || null, JSON.stringify(team)];
    const insert = (state: string, failure: string | null, linkId: string | null) => this.db.rows(
      `INSERT INTO deliveries (id, organization_id, asset_id, requested_by, destination_type, destination_ref, reel_id, render_id, recipient_name, message, team_user_ids,
                               state, failure_code, share_link_id, channel, rights_checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OWN_MAIL_APP', CURRENT_TIMESTAMP(6))`, [...base, state, failure, linkId]);
    let link;
    try {
      link = await this.sharing.create(String(render.id), body.link, p);                  // the rights rule runs here (share-v1) and is recorded
    } catch (e) {
      if (e instanceof ApiError) {
        await insert("BLOCKED", e.code.slice(0, 255), null);
        await recordChange(this.db.pool, userActor(p), { action: "delivery.blocked", entityType: "reel", entityId: reelId, after: { delivery_id: id, code: e.code } });
      }
      throw e;
    }
    await this.db.tx(async (c) => {
      await insert("SUCCEEDED", null, link.id);
      await recordChange(c, userActor(p), { action: "delivery.created", entityType: "reel", entityId: reelId,
        after: { delivery_id: id, render_id: render.id, share_link_id: link.id, client: !!email, team: team.length, channel: "OWN_MAIL_APP" } });
    });
    const emails = members.map((m) => String(m.email));
    const player = reel.player?.display_name;
    return CreatedDelivery.parse({
      delivery: (await this.deliveries(reelId, p)).find((d) => d.id === id)!, url: link.url,
      mail: { to: email ? [email] : emails, bcc: email ? emails : [], subject: `${reel.name}${player ? ` · ${player}` : ""}`,
        body: `${body.notify_client && body.recipient_name ? `Hello ${body.recipient_name},\n\n` : ""}${body.message ? `${body.message}\n\n` : ""}` +
          `Watch${body.link.can_download ? " or download" : ""} the reel (the link works until ${link.expires_at ? new Date(link.expires_at).toISOString().slice(0, 10) : "it is revoked"}${body.link.password ? "; the password comes separately" : ""}):` },
    });
  }

  async deliveries(reelId: string, p: Principal): Promise<Delivery[]> {
    await this.reels.get(reelId, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT d.*, u.display_name AS by_name, l.expires_at, l.revoked_at,
              (SELECT COUNT(*) FROM share_link_access a WHERE a.share_link_id = l.id AND a.decision = 'ALLOW' AND a.action = 'VIEW') AS opened
         FROM deliveries d JOIN users u ON u.id = d.requested_by LEFT JOIN share_links l ON l.id = d.share_link_id
        WHERE d.reel_id = ? AND d.organization_id = ? ORDER BY d.created_at DESC LIMIT 20`, [reelId, p.organizationId]);
    const ids = [...new Set(rows.flatMap((r) => (typeof r.team_user_ids === "string" ? JSON.parse(r.team_user_ids) : r.team_user_ids ?? []) as string[]))];
    const names = ids.length ? new Map((await this.db.rows<RowDataPacket>("SELECT id, display_name FROM users WHERE id IN (?)", [ids])).map((u) => [String(u.id), String(u.display_name)])) : new Map<string, string>();
    return rows.map((r) => Delivery.parse({
      id: r.id, render_id: r.render_id, state: r.state, channel: r.channel ?? null, recipient_name: r.recipient_name ?? null, recipient_email: r.destination_type === "EMAIL_INVITE" ? r.destination_ref : null,
      team: ((typeof r.team_user_ids === "string" ? JSON.parse(r.team_user_ids) : r.team_user_ids ?? []) as string[]).map((u) => ({ user_id: u, display_name: names.get(u) ?? "—" })),
      message: r.message ?? null, failure: r.failure_code ?? null, created_at: iso(r.created_at), requested_by_name: r.by_name ?? "",
      link: r.share_link_id ? { id: r.share_link_id, opened: Number(r.opened), expires_at: iso(r.expires_at), revoked: !!r.revoked_at, expired: new Date(r.expires_at).getTime() < Date.now() } : null,
    }));
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class ExportsController {
  constructor(private readonly svc: ExportsService) {}

  @Get("reels/:reelId/interchange")
  interchange(@Param("reelId") id: string, @Query("preset") preset: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.svc.interchange(uuidParam(id, "Reel"), preset, p);
  }

  @Get("reels/:reelId/interchange/otio")
  async interchangeOtio(@Param("reelId") id: string, @Query("preset") preset: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) res: FastifyReply) {
    const out = await this.svc.interchange(uuidParam(id, "Reel"), preset, p);
    void res.header("content-disposition", `attachment; filename="${out.filename_base}.otio"`);
    return out.otio;
  }

  @Get("reels/:reelId/interchange/otsi-reel")
  async interchangeManifest(@Param("reelId") id: string, @Query("preset") preset: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) res: FastifyReply) {
    const out = await this.svc.interchange(uuidParam(id, "Reel"), preset, p);
    void res.header("content-disposition", `attachment; filename="${out.filename_base}.otsi-reel"`);
    return out.manifest;
  }

  @Get("reels/:reelId/bundles")
  bundles(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) { return this.svc.bundles(uuidParam(id, "Reel"), p); }

  @Get("reels/:reelId/bundles/preview/:kind")
  preview(@Param("reelId") id: string, @Param("kind") kind: string, @CurrentPrincipal() p: Principal) { return this.svc.preview(uuidParam(id, "Reel"), PreviewKind.parse(kind), p); }

  @Post("reels/:reelId/bundles")
  @HttpCode(201)
  @Roles(...PROJECT_WRITERS)
  create(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.svc.createBundle(uuidParam(id, "Reel"), CreateBundleRequest.parse(body ?? {}), p); }

  @Post("reels/:reelId/bundles/:bundleId/zip")
  @HttpCode(200)
  zip(@Param("reelId") id: string, @Param("bundleId") b: string, @CurrentPrincipal() p: Principal) { return this.svc.zip(uuidParam(id, "Reel"), uuidParam(b, "Bundle"), p); }

  @Get("reels/:reelId/deliveries")
  deliveries(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) { return this.svc.deliveries(uuidParam(id, "Reel"), p); }

  @Post("reels/:reelId/deliveries")
  @HttpCode(201)
  @Roles(...PROJECT_WRITERS)
  deliver(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.svc.deliver(uuidParam(id, "Reel"), CreateDeliveryRequest.parse(body ?? {}), p); }
}
