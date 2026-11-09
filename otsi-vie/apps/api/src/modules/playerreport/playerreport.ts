/**
 * Player Report, page 08 T rows (ADR-056, migration 0042). What people write about a player, and what is built from the engine's measured
 * values, never anything invented.
 *
 *   GET    /v1/players/:id/notes                 his notes (newest first) and tags
 *   POST   /v1/players/:id/notes                 add a note {body}
 *   DELETE /v1/players/:id/notes/:noteId         delete a note (its author, or an Owner / Admin)
 *   PUT    /v1/players/:id/tags                  his tags {tags}
 *   GET    /v1/players/:id/assessment            the published assessment (and the draft, to people who may write it)
 *   PUT    /v1/players/:id/assessment            save the draft {version, draft, publish}; publish makes it the version on the report
 *   DELETE /v1/players/:id/assessment/published  take the published version off the report (the draft stays)
 *   GET    /v1/dossiers                          the organization's scouting dossiers and their players
 *   POST   /v1/dossiers                          a new dossier {name} (409 NAME_TAKEN)
 *   DELETE /v1/dossiers/:id                      delete a dossier (the players stay)
 *   PUT    /v1/dossiers/:id/players/:playerId    put a player in it; DELETE takes him out
 *   GET    /v1/players/:id/comparison?group=     him against a group of the organization's players, per 90 minutes seen on camera
 *   GET    /v1/players/:id/insights              up to four sentences from his measured values, each naming its source
 *   POST   /v1/players/:id/reports               make the PDF report now (local headless Chromium, ADR-056); GET lists them
 *
 * An assessment is a person's opinion: it shows on the report only once published, with who published it and when. The comparison counts
 * only tracks a person confirmed as each player and only players seen for at least COHORT_MIN_SEEN_S.
 */
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  AddPlayerNoteRequest, AssessmentBody, COHORT_MIN_SEEN_S, COHORT_NAMES, CohortGroup, CohortMetric, CreateDossierRequest, Dossier, PlayerAssessment, PlayerComparison,
  PlayerInsight, PlayerInsights, PlayerMeasures, PlayerNotes, PlayerReportJob, POSITION_LINES, SaveAssessmentRequest, SetPlayerTagsRequest, SPRINT_KMH, type HeatZones,
  DEFAULT_REPORT_DESIGN, MakeReportRequest, REPORT_SECTIONS, ReportPreviewPage, type PlayerIdentity, type PlayerProfile, type ReportDesign,
} from "@otsi-vie/contracts";
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { hiddenKey, notHidden, reportNotHidden, videoNotHidden } from "../../core/access";
import { printPdf } from "../../core/chromium";
import { CONFIG, Config } from "../../core/config";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { LocalStore } from "../../core/storage";
import { AnalysisService } from "../analysis/analysis";
import { HeatZonesService } from "../analysis/heat";
import { uuidParam } from "../players/players.controller";
import { playerProfile, PlayersService } from "../players/players.service";
import { identityGate, requireIdentity } from "./gate";
import { reportHtml } from "./reportHtml";

export const NOTE_WRITERS = ["OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT"] as const;
export const ASSESSORS = ["OWNER", "ADMIN", "ANALYST", "SCOUT"] as const;
const MEASURE_TTL_MS = 10 * 60 * 1000;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;
const r1 = (v: number) => Math.round(v * 10) / 10;
const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

/** his line (GK / DEF / MID / FWD) from the position recorded for him: the latest team sheet's first, then the Players list's (confirmed roles only, ADR-122) */
export function lineOf(profile: PlayerProfile | null): Exclude<CohortGroup, "ALL"> | null {
  if (profile?.latest_team?.role_confirmed && profile.latest_team.position) {
    const l = POSITION_LINES[profile.latest_team.position.trim().toUpperCase()];
    if (l) return l;
  }
  if (profile?.role_confirmed && profile.position) {
    const l = POSITION_LINES[profile.position.trim().toUpperCase()];
    if (l) return l;
  }
  return null;
}

/** the comparison's values of one player's measures; null where it is not measured */
export function rates(m: PlayerMeasures): Record<CohortMetric["key"], number | null> {
  const per90 = m.seen_s > 0 ? m.seen_s / 5400 : 0, ev = m.events;
  return {
    passes_p90: ev && per90 ? r1(ev.passes / per90) : null,
    key_passes_p90: ev && per90 ? r1(ev.key_passes / per90) : null,
    balls_won_p90: ev && per90 ? r1(ev.balls_won / per90) : null,
    distance_p90: m.distance_m !== null && m.measured_s > 0 ? Math.round(m.distance_m / (m.measured_s / 5400)) : null,
    top_speed: m.top_speed_kmh,
  };
}

const METRICS: [CohortMetric["key"], string, string][] = [["passes_p90", "Passes (p90)", ""], ["key_passes_p90", "Key Passes (p90)", ""], ["balls_won_p90", "Balls Won (p90)", ""],
  ["distance_p90", "Distance (per 90 measured)", "m"], ["top_speed", "Top Speed", "km/h"]];
export const COMPARISON_BASIS = "Per 90 minutes seen on camera in tracks a person confirmed (not minutes played); distance per 90 measured minutes. " +
  `Players seen for at least ${COHORT_MIN_SEEN_S / 60} minutes. Engine readings, not a verified stat sheet.`;

/** the comparison of one player against the others (pure; `others` excludes him) */
export function compare(group: CohortGroup, groups: CohortGroup[], mine: PlayerMeasures, others: PlayerMeasures[]): PlayerComparison {
  const pool = others.filter((m) => m.seen_s >= COHORT_MIN_SEEN_S).map(rates), me = rates(mine);
  return PlayerComparison.parse({
    group, group_name: COHORT_NAMES[group], groups, n: pool.length, player_below_minimum: mine.seen_s < COHORT_MIN_SEEN_S, basis: COMPARISON_BASIS,
    metrics: METRICS.map(([key, label, unit]) => {
      const vals = pool.map((x) => x[key]).filter((v): v is number => v !== null);
      const mean = vals.length ? r1(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      const all = [...vals, ...(me[key] === null ? [] : [me[key]!])];
      return { key, label, unit, player: me[key], group_mean: mean, group_n: vals.length, max: all.length ? Math.max(...all) : null };
    }),
  });
}

/** the share of his measured heat in the middle third of the pitch's width (the same either way the teams attack); null below 5 min */
export function centralShare(h: HeatZones | null): number | null {
  if (!h || h.measured_s < 300) return null;
  let mid = 0, all = 0;
  for (let r = 0; r < h.rows; r++) for (let c = 0; c < h.cols; c++) {
    const v = h.seconds[r * h.cols + c] ?? 0, y = (r + 0.5) / h.rows;
    all += v; if (y > 1 / 3 && y < 2 / 3) mid += v;
  }
  return all > 0 ? mid / all : null;
}

/** up to four sentences, each from measured values and naming its source (pure) */
export function insightsOf(m: PlayerMeasures, speedsOfOthers: number[]): PlayerInsights {
  const out: PlayerInsight[] = [];
  const moved = `Movement over ${mins(m.measured_s)} measured in ${plural(m.videos, "video")}`;
  if (m.top_speed_kmh !== null) {
    const faster = speedsOfOthers.filter((v) => v > m.top_speed_kmh!).length, n = speedsOfOthers.length + 1;
    const rank = n >= 3 ? (faster === 0 ? `, the fastest of ${n} players measured in your organization` : `, ${faster + 1}${["st", "nd", "rd"][faster] ?? "th"} of ${n} players measured in your organization`) : "";
    out.push({ kind: "SPEED", text: `Top speed ${m.top_speed_kmh} km/h, held for 2 seconds${rank}.`, source: moved });
  }
  const ev = m.events, evSrc = ev ? `Engine events in ${plural(ev.videos, "video")} with the ball followed` : "";
  if (ev && ev.passes > 0) {
    out.push({ kind: "PASSING", text: `${plural(ev.passes, "pass", "passes")} found, ${ev.key_passes} of them key (${Math.round((100 * ev.key_passes) / ev.passes)} %); ${ev.passes_received} received.`, source: evSrc });
  }
  const c = centralShare(m.heat);
  if (c !== null) {
    out.push({ kind: "POSITION", text: c >= 0.5 ? `Mostly central: ${Math.round(c * 100)} % of his measured time in the middle third of the pitch's width.`
      : `Mostly wide: ${Math.round((1 - c) * 100)} % of his measured time in the outer thirds of the pitch's width.`, source: `Heat map, ${mins(m.heat!.measured_s)} measured, as filmed` });
  }
  if (m.distance_m !== null && m.measured_s >= 300) {
    const p90 = m.distance_m / (m.measured_s / 5400);
    out.push({ kind: "WORK_RATE", text: `${(p90 / 1000).toFixed(1)} km per 90 measured minutes; ${plural(m.sprints, "sprint")} (${m.sprint_m ?? 0} m at ${SPRINT_KMH} km/h or faster).`, source: moved });
  }
  if (ev && ev.balls_won + ev.pressures > 0) out.push({ kind: "BALL_WINNING", text: `${plural(ev.balls_won, "ball")} won and ${plural(ev.pressures, "pressure")} on an opponent.`, source: evSrc });
  return PlayerInsights.parse({ items: out.slice(0, 4), basis: "Built from the engine's measurements on tracks a person confirmed as him. No text model: each sentence states numbers and where they come from." });
}

/** one PDF at a time per server: Chromium is heavy */
@Injectable()
export class PlayerReportService {
  private readonly store: LocalStore | null;
  private measureCache = new Map<string, { at: number; value: PlayerMeasures }>();
  constructor(@Inject(CONFIG) cfg: Config, private readonly db: Db, @Inject(PlayersService) private readonly players: PlayersService,
              @Inject(HeatZonesService) private readonly heat: HeatZonesService, @Inject(AnalysisService) private readonly analysis: AnalysisService) {
    this.store = cfg.storage ? new LocalStore(cfg.storage.dir) : null;
  }

  private can(p: Principal, roles: readonly string[]) { return roles.includes(p.role); }

  // ------------------------------------------------------------------ notes and tags
  async notes(playerId: string, p: Principal): Promise<PlayerNotes> {
    await this.players.identity(playerId, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT c.id, c.body, c.author_id, c.created_at, u.display_name FROM comments c JOIN users u ON u.id = c.author_id
        WHERE c.organization_id = ? AND c.player_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT 500`, [p.organizationId, playerId]);
    const tags = await this.db.rows<RowDataPacket>("SELECT tag FROM player_tags WHERE organization_id = ? AND player_id = ? ORDER BY tag", [p.organizationId, playerId]);
    const admin = p.role === "OWNER" || p.role === "ADMIN";
    return PlayerNotes.parse({
      notes: rows.map((r) => ({ id: r.id, body: r.body, author_id: r.author_id, author_name: r.display_name, created_at: iso(r.created_at), can_delete: admin || r.author_id === p.userId })),
      tags: tags.map((t) => String(t.tag)), can_write: this.can(p, NOTE_WRITERS),
    });
  }

  async addNote(playerId: string, body: AddPlayerNoteRequest, p: Principal): Promise<PlayerNotes> {
    await this.players.identity(playerId, p);
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO comments (id, organization_id, player_id, author_id, body) VALUES (?, ?, ?, ?, ?)", [id, p.organizationId, playerId, p.userId, body.body]);
      await recordChange(c, userActor(p), { action: "player_note.added", entityType: "player", entityId: playerId, after: { note_id: id, chars: body.body.length } });
    });
    return this.notes(playerId, p);
  }

  async deleteNote(playerId: string, noteId: string, p: Principal): Promise<PlayerNotes> {
    await this.players.identity(playerId, p);
    const n = await this.db.one<RowDataPacket>("SELECT id, author_id, body FROM comments WHERE id = ? AND organization_id = ? AND player_id = ?", [noteId, p.organizationId, playerId]);
    if (!n) throw notFound("Note");
    if (n.author_id !== p.userId && p.role !== "OWNER" && p.role !== "ADMIN") throw new ApiError(403, "NOT_YOUR_NOTE", "Only its author, an Owner or an Admin may delete a note.");
    await this.db.tx(async (c) => {
      await c.query("DELETE FROM comments WHERE id = ?", [noteId]);
      await recordChange(c, userActor(p), { action: "player_note.deleted", entityType: "player", entityId: playerId, before: { note_id: noteId, author_id: n.author_id, body: n.body } });
    });
    return this.notes(playerId, p);
  }

  async setTags(playerId: string, body: SetPlayerTagsRequest, p: Principal): Promise<PlayerNotes> {
    await this.players.identity(playerId, p);
    await this.db.tx(async (c) => {
      const [before] = await c.query<RowDataPacket[]>("SELECT tag FROM player_tags WHERE organization_id = ? AND player_id = ? FOR UPDATE", [p.organizationId, playerId]);
      await c.query("DELETE FROM player_tags WHERE organization_id = ? AND player_id = ?", [p.organizationId, playerId]);
      for (const t of body.tags) await c.query("INSERT INTO player_tags (organization_id, player_id, tag, created_by) VALUES (?, ?, ?, ?)", [p.organizationId, playerId, t, p.userId]);
      await recordChange(c, userActor(p), { action: "player_tags.set", entityType: "player", entityId: playerId, before: { tags: before.map((x) => x.tag) }, after: { tags: body.tags } });
    });
    return this.notes(playerId, p);
  }

  // ------------------------------------------------------------------ assessment
  async assessment(playerId: string, p: Principal): Promise<PlayerAssessment> {
    await this.players.identity(playerId, p);
    const a = await this.db.one<RowDataPacket>(
      `SELECT a.*, u.display_name AS published_by_name FROM player_assessments a LEFT JOIN users u ON u.id = a.published_by WHERE a.organization_id = ? AND a.player_id = ?`,
      [p.organizationId, playerId]);
    const writer = this.can(p, ASSESSORS);
    const draft = a ? AssessmentBody.parse(json(a.draft)) : null, pub = a?.published ? AssessmentBody.parse(json(a.published)) : null;
    return PlayerAssessment.parse({
      player_id: playerId, published: pub, published_by_name: a?.published_by_name ?? null, published_at: iso(a?.published_at),
      draft: writer ? draft : null, unpublished_changes: !!draft && JSON.stringify(draft) !== JSON.stringify(pub), updated_at: iso(a?.updated_at), version: a ? Number(a.version) : 0, can_write: writer,
    });
  }

  async saveAssessment(playerId: string, body: SaveAssessmentRequest, p: Principal): Promise<PlayerAssessment> {
    await this.players.identity(playerId, p);
    if (body.publish) await requireIdentity(this.db, playerId, p.organizationId);                // B.24: a draft may be saved; publishing needs a confirmed identity
    await this.db.tx(async (c) => {
      const [[a]] = await c.query<RowDataPacket[]>("SELECT id, version, published FROM player_assessments WHERE organization_id = ? AND player_id = ? FOR UPDATE", [p.organizationId, playerId]);
      if (Number(a?.version ?? 0) !== body.version) throw new ApiError(409, "STALE_VERSION", "Someone changed this assessment since you opened it: reopen it to see their changes.");
      const draft = JSON.stringify(body.draft);
      if (!a) {
        await c.query(`INSERT INTO player_assessments (id, organization_id, player_id, draft, published, published_by, published_at, updated_by)
                       VALUES (?, ?, ?, ?, ?, ?, ${body.publish ? "CURRENT_TIMESTAMP(6)" : "NULL"}, ?)`,
          [uuidv7(), p.organizationId, playerId, draft, body.publish ? draft : null, body.publish ? p.userId : null, p.userId]);
      } else if (body.publish) {
        await c.query("UPDATE player_assessments SET draft = ?, published = ?, published_by = ?, published_at = CURRENT_TIMESTAMP(6), updated_by = ?, version = version + 1 WHERE id = ?",
          [draft, draft, p.userId, p.userId, a.id]);
      } else {
        await c.query("UPDATE player_assessments SET draft = ?, updated_by = ?, version = version + 1 WHERE id = ?", [draft, p.userId, a.id]);
      }
      await recordChange(c, userActor(p), { action: body.publish ? "player_assessment.published" : "player_assessment.saved", entityType: "player", entityId: playerId,
        before: a?.published ? { published: json(a.published) } : undefined, after: { draft: body.draft, published: body.publish } });
    });
    return this.assessment(playerId, p);
  }

  async unpublish(playerId: string, p: Principal): Promise<PlayerAssessment> {
    await this.players.identity(playerId, p);
    await this.db.tx(async (c) => {
      const [[a]] = await c.query<RowDataPacket[]>("SELECT id, published FROM player_assessments WHERE organization_id = ? AND player_id = ? FOR UPDATE", [p.organizationId, playerId]);
      if (!a?.published) return;
      await c.query("UPDATE player_assessments SET published = NULL, published_by = NULL, published_at = NULL, updated_by = ?, version = version + 1 WHERE id = ?", [p.userId, a.id]);
      await recordChange(c, userActor(p), { action: "player_assessment.withdrawn", entityType: "player", entityId: playerId, before: { published: json(a.published) } });
    });
    return this.assessment(playerId, p);
  }

  // ------------------------------------------------------------------ dossiers
  async dossiers(p: Principal): Promise<Dossier[]> {
    const ds = await this.db.rows<RowDataPacket>("SELECT id, name, created_at FROM scouting_dossiers WHERE organization_id = ? ORDER BY name LIMIT 500", [p.organizationId]);
    if (!ds.length) return [];
    const members = await this.db.rows<RowDataPacket>(
      `SELECT dp.dossier_id, dp.player_id, dp.added_at, v.display_name, v.canonical_otsi_id FROM scouting_dossier_players dp JOIN v_player_identity v ON v.player_id = dp.player_id
        WHERE dp.dossier_id IN (?) ORDER BY v.display_name`, [ds.map((d) => d.id)]);
    return ds.map((d) => Dossier.parse({ id: d.id, name: d.name, created_at: iso(d.created_at),
      players: members.filter((m) => m.dossier_id === d.id).map((m) => ({ player_id: m.player_id, display_name: m.display_name, canonical_otsi_id: m.canonical_otsi_id ?? null, added_at: iso(m.added_at) })) }));
  }

  private async dossier(id: string, p: Principal): Promise<RowDataPacket> {
    const d = await this.db.one<RowDataPacket>("SELECT id, name FROM scouting_dossiers WHERE id = ? AND organization_id = ?", [id, p.organizationId]);
    if (!d) throw notFound("Dossier");
    return d;
  }

  async createDossier(body: CreateDossierRequest, p: Principal): Promise<Dossier> {
    const taken = await this.db.one<RowDataPacket>("SELECT id FROM scouting_dossiers WHERE organization_id = ? AND name = ?", [p.organizationId, body.name]);
    if (taken) throw new ApiError(409, "NAME_TAKEN", `A dossier called "${body.name}" exists: choose another name.`);
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO scouting_dossiers (id, organization_id, name, created_by) VALUES (?, ?, ?, ?)", [id, p.organizationId, body.name, p.userId]);
      await recordChange(c, userActor(p), { action: "dossier.created", entityType: "dossier", entityId: id, after: { name: body.name } });
    });
    return (await this.dossiers(p)).find((d) => d.id === id)!;
  }

  async deleteDossier(id: string, p: Principal): Promise<void> {
    const d = await this.dossier(id, p);
    await this.db.tx(async (c) => {
      const [m] = await c.query<RowDataPacket[]>("SELECT player_id FROM scouting_dossier_players WHERE dossier_id = ?", [id]);
      await c.query("DELETE FROM scouting_dossiers WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: "dossier.deleted", entityType: "dossier", entityId: id, before: { name: d.name, players: m.map((x) => x.player_id) } });
    });
  }

  async setMember(id: string, playerId: string, inIt: boolean, p: Principal): Promise<Dossier> {
    const d = await this.dossier(id, p);
    await this.players.identity(playerId, p);
    await this.db.tx(async (c) => {
      const [r] = inIt
        ? await c.query<import("mysql2").ResultSetHeader>("INSERT IGNORE INTO scouting_dossier_players (dossier_id, player_id, added_by) VALUES (?, ?, ?)", [id, playerId, p.userId])
        : await c.query<import("mysql2").ResultSetHeader>("DELETE FROM scouting_dossier_players WHERE dossier_id = ? AND player_id = ?", [id, playerId]);
      if (r.affectedRows) await recordChange(c, userActor(p), { action: inIt ? "dossier.player_added" : "dossier.player_removed", entityType: "dossier", entityId: id, after: { name: d.name, player_id: playerId } });
    });
    return (await this.dossiers(p)).find((x) => x.id === id)!;
  }

  // ------------------------------------------------------------------ comparison and insights
  private async measuresOf(playerId: string, p: Principal): Promise<PlayerMeasures> {
    const key = `${p.organizationId}:${playerId}:${hiddenKey(p)}`, hit = this.measureCache.get(key);   // what he may see is part of the key
    if (hit && Date.now() - hit.at < MEASURE_TTL_MS) return hit.value;
    const value = await this.heat.player(playerId, p);
    this.measureCache.set(key, { at: Date.now(), value });
    return value;
  }

  /** the organization's players with a track a person confirmed, and their line */
  private async members(p: Principal): Promise<{ id: string; line: CohortGroup | null }[]> {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT DISTINCT ci.player_id FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id JOIN pipeline_runs r ON r.id = t.run_id
        WHERE ci.state = 'CONFIRMED' AND r.organization_id = ? AND t.class_name = 'PERSON' AND ci.player_id IS NOT NULL${videoNotHidden(p, "t.video_id")} LIMIT 500`, [p.organizationId]);
    const out: { id: string; line: CohortGroup | null }[] = [];
    for (const r of rows) out.push({ id: String(r.player_id), line: lineOf(await playerProfile(this.db, String(r.player_id), p.organizationId)) });
    return out;
  }

  async comparison(playerId: string, group: CohortGroup | null, p: Principal): Promise<PlayerComparison> {
    await this.players.identity(playerId, p);
    const mine = await this.measuresOf(playerId, p);
    const line = lineOf(await playerProfile(this.db, playerId, p.organizationId));
    const groups: CohortGroup[] = line ? [line, "ALL"] : ["ALL"];
    const g = group ?? groups[0]!;
    if (!groups.includes(g)) throw new ApiError(422, "GROUP_NOT_HIS", `His position is not recorded as one of the ${COHORT_NAMES[g].toLowerCase()}: compare him with ${groups.map((x) => COHORT_NAMES[x].toLowerCase()).join(" or ")}.`);
    const others: PlayerMeasures[] = [];
    for (const m of await this.members(p)) if (m.id !== playerId && (g === "ALL" || m.line === g)) others.push(await this.measuresOf(m.id, p));
    return compare(g, groups, mine, others);
  }

  async insights(playerId: string, p: Principal): Promise<PlayerInsights> {
    await this.players.identity(playerId, p);
    const mine = await this.measuresOf(playerId, p);
    const speeds: number[] = [];
    for (const m of await this.members(p)) {
      if (m.id === playerId) continue;
      const o = await this.measuresOf(m.id, p);
      if (o.top_speed_kmh !== null) speeds.push(o.top_speed_kmh);
    }
    return insightsOf(mine, speeds);
  }

  // ------------------------------------------------------------------ PDF reports
  private toJob(r: RowDataPacket, p: Principal): PlayerReportJob {
    const cfg = json<{ video_ids?: string[]; design?: ReportDesign }>(r.config) ?? {};
    return PlayerReportJob.parse({ id: r.id, player_id: r.player_id, state: r.state, created_at: iso(r.created_at), completed_at: iso(r.completed_at), requested_by_name: r.requested_by_name ?? "",
      bytes: r.byte_size === null || r.byte_size === undefined ? null : Number(r.byte_size), failure: r.failure ?? null, videos: (cfg.video_ids ?? []).length,
      title: cfg.design?.title ?? null, sections: cfg.design?.sections.length ?? REPORT_SECTIONS.length,
      download_url: r.state === "SUCCEEDED" && r.output_asset_id ? this.analysis.signedUrl(String(r.output_asset_id), p.organizationId, true).url : null });
  }

  async reports(playerId: string, p: Principal): Promise<PlayerReportJob[]> {
    await this.players.identity(playerId, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT j.*, u.display_name AS requested_by_name, a.byte_size FROM report_jobs j JOIN users u ON u.id = j.requested_by LEFT JOIN assets a ON a.id = j.output_asset_id
        WHERE j.organization_id = ? AND j.player_id = ? AND j.report_type = 'PLAYER_REPORT'${reportNotHidden(p, "j")} ORDER BY j.created_at DESC LIMIT 20`, [p.organizationId, playerId]);
    return rows.map((r) => this.toJob(r, p));
  }

  /** the videos his numbers come from: those with a track a person confirmed as him */
  private async videosOf(playerId: string, p: Principal): Promise<string[]> {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT DISTINCT t.video_id FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id JOIN pipeline_runs r ON r.id = t.run_id
         JOIN video_sources v ON v.id = t.video_id AND v.removed_at IS NULL
        WHERE ci.player_id = ? AND ci.state = 'CONFIRMED' AND r.organization_id = ? AND t.class_name = 'PERSON'${notHidden(p, "v.project_id")}`, [playerId, p.organizationId]);
    return rows.map((r) => String(r.video_id)).sort();
  }

  /** B.23 (ADR-098): the report's page, rule-built from his numbers as they are now (the PDF prints it; Export previews it) */
  async reportHtmlOf(playerId: string, p: Principal, at = new Date(), design: ReportDesign = DEFAULT_REPORT_DESIGN): Promise<string> {
    const player: PlayerIdentity = await this.players.identity(playerId, p);
    this.measureCache.delete(`${p.organizationId}:${playerId}:${hiddenKey(p)}`);                   // the report reads his numbers as they are now
    const [profile, measures, comparison, insights, assessment, events, org] = await Promise.all([
      playerProfile(this.db, playerId, p.organizationId), this.measuresOf(playerId, p), this.comparison(playerId, null, p), this.insights(playerId, p), this.assessment(playerId, p),
      this.heat.playerEvents(playerId, p), this.db.one<RowDataPacket>("SELECT name FROM organizations WHERE id = ?", [p.organizationId])]);
    return reportHtml({ player, profile, measures, comparison, insights, assessment, events, organization: String(org?.name ?? ""), generatedAt: at, design });
  }

  /** B.24 (ADR-099): the designer's live preview: the page the PDF will print with this design, and whether it may be made */
  async previewReport(playerId: string, design: ReportDesign, p: Principal): Promise<ReportPreviewPage> {
    const at = new Date();
    const html = await this.reportHtmlOf(playerId, p, at, design);
    return ReportPreviewPage.parse({ html, gate: await identityGate(this.db, playerId, p.organizationId), generated_at: at.toISOString() });
  }

  async makeReport(playerId: string, p: Principal, design: ReportDesign = DEFAULT_REPORT_DESIGN): Promise<PlayerReportJob> {
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    await this.players.identity(playerId, p);
    await requireIdentity(this.db, playerId, p.organizationId);                                    // B.24: nothing about an unconfirmed identity leaves the page
    const id = uuidv7(), videoIds = await this.videosOf(playerId, p);
    await this.db.rows(`INSERT INTO report_jobs (id, organization_id, player_id, requested_by, state, report_type, config) VALUES (?, ?, ?, ?, 'RUNNING', 'PLAYER_REPORT', ?)`,
      [id, p.organizationId, playerId, p.userId, JSON.stringify({ video_ids: videoIds, design })]);
    try {
      const html = await this.reportHtmlOf(playerId, p, new Date(), design);
      const pdf = await printPdf(html, "OTSI VIE player report");
      const key = `org/${p.organizationId}/reports/${id}.pdf`, file = this.store.resolve(key), assetId = uuidv7();
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, pdf);
      await this.db.tx(async (c) => {
        await c.query(`INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, created_by, metadata)
                       VALUES (?, ?, 'REPORT', ?, 'local', ?, ?, 'application/pdf', ?, ?)`,
          [assetId, p.organizationId, key, (await stat(file)).size, createHash("sha256").update(pdf).digest("hex"), p.userId, JSON.stringify({ report_job_id: id, player_id: playerId })]);
        await c.query("UPDATE report_jobs SET state = 'SUCCEEDED', output_asset_id = ?, completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [assetId, id]);
        await recordChange(c, userActor(p), { action: "player_report.exported", entityType: "player", entityId: playerId, after: { report_job_id: id, videos: videoIds.length, bytes: pdf.length } });
      });
    } catch (e) {
      const why = e instanceof ApiError ? e.message : "The PDF could not be made.";
      await this.db.rows("UPDATE report_jobs SET state = 'FAILED', failure = ?, completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [why.slice(0, 255), id]);
      if (e instanceof ApiError) throw e;
      throw new ApiError(500, "REPORT_FAILED", why);
    }
    return (await this.reports(playerId, p)).find((j) => j.id === id)!;
  }

}

@Controller("v1")
@UseGuards(AuthGuard)
export class PlayerReportController {
  constructor(private readonly svc: PlayerReportService) {}

  @Get("players/:id/notes")
  notes(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.svc.notes(uuidParam(id, "Player"), p); }

  @Post("players/:id/notes")
  @Roles(...NOTE_WRITERS)
  addNote(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.svc.addNote(uuidParam(id, "Player"), AddPlayerNoteRequest.parse(body ?? {}), p); }

  @Delete("players/:id/notes/:noteId")
  @Roles(...NOTE_WRITERS)
  deleteNote(@Param("id") id: string, @Param("noteId") noteId: string, @CurrentPrincipal() p: Principal) { return this.svc.deleteNote(uuidParam(id, "Player"), uuidParam(noteId, "Note"), p); }

  @Put("players/:id/tags")
  @Roles(...NOTE_WRITERS)
  setTags(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.svc.setTags(uuidParam(id, "Player"), SetPlayerTagsRequest.parse(body ?? {}), p); }

  @Get("players/:id/assessment")
  assessment(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.svc.assessment(uuidParam(id, "Player"), p); }

  @Put("players/:id/assessment")
  @Roles(...ASSESSORS)
  saveAssessment(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.svc.saveAssessment(uuidParam(id, "Player"), SaveAssessmentRequest.parse(body ?? {}), p); }

  @Delete("players/:id/assessment/published")
  @Roles(...ASSESSORS)
  unpublish(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.svc.unpublish(uuidParam(id, "Player"), p); }

  @Get("dossiers")
  dossiers(@CurrentPrincipal() p: Principal) { return this.svc.dossiers(p); }

  @Post("dossiers")
  @Roles(...NOTE_WRITERS)
  createDossier(@Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.svc.createDossier(CreateDossierRequest.parse(body ?? {}), p); }

  @Delete("dossiers/:id")
  @HttpCode(204)
  @Roles(...NOTE_WRITERS)
  async deleteDossier(@Param("id") id: string, @CurrentPrincipal() p: Principal) { await this.svc.deleteDossier(uuidParam(id, "Dossier"), p); }

  @Put("dossiers/:id/players/:playerId")
  @Roles(...NOTE_WRITERS)
  addMember(@Param("id") id: string, @Param("playerId") pid: string, @CurrentPrincipal() p: Principal) { return this.svc.setMember(uuidParam(id, "Dossier"), uuidParam(pid, "Player"), true, p); }

  @Delete("dossiers/:id/players/:playerId")
  @Roles(...NOTE_WRITERS)
  removeMember(@Param("id") id: string, @Param("playerId") pid: string, @CurrentPrincipal() p: Principal) { return this.svc.setMember(uuidParam(id, "Dossier"), uuidParam(pid, "Player"), false, p); }

  @Get("players/:id/comparison")
  comparison(@Param("id") id: string, @Query("group") group: string | undefined, @CurrentPrincipal() p: Principal) {
    const g = group === undefined || group === "" ? null : CohortGroup.safeParse(group.toUpperCase());
    if (g && !g.success) throw new ApiError(400, "BAD_GROUP", "group is ALL, GK, DEF, MID or FWD.");
    return this.svc.comparison(uuidParam(id, "Player"), g ? g.data! : null, p);
  }

  @Get("players/:id/insights")
  insights(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.svc.insights(uuidParam(id, "Player"), p); }

  @Get("players/:id/reports")
  reports(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.svc.reports(uuidParam(id, "Player"), p); }

  @Post("players/:id/reports")
  @Roles(...NOTE_WRITERS)
  makeReport(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.svc.makeReport(uuidParam(id, "Player"), p, MakeReportRequest.parse(body ?? {}).design);
  }

  /** B.24 (ADR-099): the designer's live preview (a read: nothing is saved) */
  @Post("players/:id/reports/preview")
  @HttpCode(200)
  previewReport(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.svc.previewReport(uuidParam(id, "Player"), MakeReportRequest.parse(body ?? {}).design, p);
  }
}
