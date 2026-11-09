/**
 * Possession and passes (migration 0031, ADR-040; contract `events.ts`).
 *
 *   GET /v1/videos/:id/events     the video's latest finished ball track's events, in match time: each team's possession, completed
 *                                 passes (with the passer's and receiver's confirmed identities; key passes marked), the ball won from
 *                                 the other team (with the rule's possible kind: tackle or interception, ADR-041), shots,
 *                                 and pressures with whether the ball was won back within 5 s (ADR-042), and set pieces with their kind and
 *                                 taker (ADR-048)
 *   GET /v1/videos/:id/who-is-this?player=  for the player whose reel is being made: the unnamed players in those events who could be him,
 *                                 most alike first, for a person to answer "is this him?" (ADR-046);
 *                                 &revisit=1: the ones a person said were not him, to move the box onto him
 *
 * The TRACK_BALL worker finds them (vie_worker.possession); following the ball again replaces them. Teams are kit groups named by the
 * current kit -> club assignment at read time, and identities are the current confirmed ones, so a person's later decisions show at once.
 */
import { Body, Controller, Get, Injectable, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  EventDecisionRecord,
  EventDecisionType,
  MatchEvents,
  RecordEventDecisionRequest,
  SetPieceKind,
  WhoIsThis,
  type WhoMomentKind,
} from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { userActor, writeAudit } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PlayersService } from "../players/players.service";
import { matchWindows, within, type Windows } from "./match-time";

const SET_PIECE_KINDS = new Set<string | null>(SetPieceKind.options);

/** possession shares are given once a team was seen on the ball for this share of the counted time */
export const MIN_KNOWN_SHARE = 0.25;

/** seconds of [a, b] inside match time */
function inside(w: Windows, a: number, b: number): number {
  if (!w) return (b - a) / 1e6;
  return w.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0) / 1e6;
}

@Injectable()
export class MatchEventsService {
  constructor(private readonly db: Db, private readonly players: PlayersService) {}

  async get(videoId: string, p: Principal, includeRejected = false): Promise<MatchEvents> {
    const v = await this.db.one<RowDataPacket>("SELECT id, duration_us FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [videoId, p.organizationId]);
    if (!v) throw notFound("Video");
    const mt = await matchWindows(this.db, videoId);
    const counted = mt ? mt.reduce((s, [a, b]) => s + (b - a), 0) / 1e6 : Number(v.duration_us ?? 0) / 1e6;
    const none = { video_id: videoId, ball_track_id: null, match_time: !!mt, counted_s: counted, possession_known_s: 0, teams: [], passes: [], changes: [], shots: [], pressures: [], set_pieces: [], goals: [], rejected_events_count: 0 };
    const open = await this.db.one<RowDataPacket>("SELECT id FROM ball_tracks WHERE video_id = ? AND organization_id = ? AND status IN ('QUEUED', 'RUNNING') LIMIT 1", [videoId, p.organizationId]);
    const bt = await this.db.one<RowDataPacket>(
      "SELECT id, run_id FROM ball_tracks WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1", [videoId, p.organizationId]);
    if (!bt) return MatchEvents.parse({ ...none, state: open ? "RUNNING" : "NONE" });
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT e.id, e.event_type, e.start_pts_us, e.end_pts_us, e.primary_track_id, e.secondary_track_id, e.kit_group, e.confidence, e.evidence_state,
              JSON_EXTRACT(e.features, '$.length_m') AS length_m, JSON_EXTRACT(e.features, '$.from_kit_group') AS from_kit_group,
              JSON_EXTRACT(e.features, '$.key') AS is_key, JSON_EXTRACT(e.features, '$.speed_ms') AS speed_ms, JSON_EXTRACT(e.features, '$.distance_m') AS distance_m,
              JSON_EXTRACT(e.features, '$.regain') AS regain, JSON_EXTRACT(e.features, '$.from') AS p_from, JSON_EXTRACT(e.features, '$.to') AS p_to, JSON_UNQUOTE(JSON_EXTRACT(e.features, '$.kind')) AS sp_kind,
              JSON_EXTRACT(e.features, '$.side') AS g_side, JSON_EXTRACT(e.features, '$.score') AS g_score, JSON_EXTRACT(e.features, '$.changed_by_us') AS g_by,
              JSON_UNQUOTE(JSON_EXTRACT(e.features, '$.set_piece')) AS g_sp, JSON_UNQUOTE(JSON_EXTRACT(e.features, '$.set_piece_taker')) AS g_sp_taker,
              a.player_id AS a_player, b.player_id AS b_player,
              ed.decision, ed.reviewer_id, ed.revised_start_pts_us, ed.revised_end_pts_us, ed.revised_type
         FROM event_candidates e
         LEFT JOIN v_track_current_identity a ON a.track_id = e.primary_track_id AND a.state = 'CONFIRMED'
         LEFT JOIN v_track_current_identity b ON b.track_id = e.secondary_track_id AND b.state = 'CONFIRMED'
         LEFT JOIN (
           SELECT ed1.event_id, ed1.decision, ed1.reviewer_id, ed1.revised_start_pts_us, ed1.revised_end_pts_us, ed1.revised_type
             FROM event_decisions ed1
            INNER JOIN (
              SELECT event_id, MAX(decided_at) AS max_decided_at FROM event_decisions GROUP BY event_id
            ) ed_max ON ed1.event_id = ed_max.event_id AND ed1.decided_at = ed_max.max_decided_at
         ) ed ON ed.event_id = e.id
        WHERE e.ball_track_id = ? AND e.video_id = ? AND e.event_type IN ('PASS', 'POSSESSION_CHANGE', 'TEAM_POSSESSION', 'SHOT', 'PRESSURE', 'TACKLE', 'INTERCEPTION', 'SET_PIECE', 'GOAL') ORDER BY e.start_pts_us`, [bt.id, videoId]);
    // a TACKLE / INTERCEPTION row sits next to its change of possession (same times; the winner first): the change's possible kind
    const how = new Map(rows.filter((r) => r.event_type === "TACKLE" || r.event_type === "INTERCEPTION")
      .map((r) => [`${r.start_pts_us}|${r.primary_track_id}`, r.event_type as "TACKLE" | "INTERCEPTION"]));
    const groups = await this.db.rows<RowDataPacket>(
      `SELECT g.kit_group, a.club_id, c.canonical_name,
              (SELECT x.kit_rgb FROM track_appearance x WHERE x.run_id = g.run_id AND x.kit_group = g.kit_group AND x.kit_rgb IS NOT NULL
                GROUP BY x.kit_rgb ORDER BY COUNT(*) DESC, x.kit_rgb LIMIT 1) AS kit_rgb
         FROM (SELECT DISTINCT run_id, kit_group FROM track_appearance WHERE run_id = ? AND kit_group IS NOT NULL) g
         LEFT JOIN v_run_team_current a ON a.run_id = g.run_id AND a.kit_group = g.kit_group LEFT JOIN clubs c ON c.id = a.club_id ORDER BY g.kit_group`, [bt.run_id]);
    const num = (x: unknown) => (x === null || x === undefined || x === "null" ? null : Number(x));
    const xy = (x: unknown): [number, number] | null => {
      const a = typeof x === "string" ? JSON.parse(x) as unknown : x;
      return Array.isArray(a) && a.length === 2 && a.every((v) => typeof v === "number" && Number.isFinite(v)) ? [a[0] as number, a[1] as number] : null;
    };
    const team = new Map(groups.map((g) => [Number(g.kit_group), { kit_group: Number(g.kit_group), club_id: g.club_id ?? null, name: g.canonical_name ?? null,
      kit_rgb: g.kit_rgb ?? null, possession_s: 0, share: null as number | null, passes: 0, won: 0, pressures: 0, press_regains: 0 }]));
    // when kits are assigned to clubs, only those kit groups are teams (a referee's or a goalkeeper's own kit is not); before that, the two
    // team colours (0 and 1): the analysis puts the officials' colour in group 2 (vie_worker.appearance.find_officials)
    const assigned = [...team.values()].some((t) => t.club_id);
    const isTeam = (k: number | null) => k !== null && team.has(k) && (assigned ? !!team.get(k)!.club_id : k <= 1);
    const passes: MatchEvents["passes"] = [], changes: MatchEvents["changes"] = [], shots: MatchEvents["shots"] = [], pressures: MatchEvents["pressures"] = [];
    const setPieces: MatchEvents["set_pieces"] = [], goals: MatchEvents["goals"] = [];
    let rejectedCount = 0;
    for (const r of rows) {
      if (r.decision === "REJECT") {
        rejectedCount++;
        if (!includeRejected) continue;
      }
      const a = r.revised_start_pts_us != null ? Number(r.revised_start_pts_us) : Number(r.start_pts_us);
      const b = r.revised_end_pts_us != null ? Number(r.revised_end_pts_us) : Number(r.end_pts_us);
      const evType = (r.revised_type as string | null) ?? (r.event_type as string);
      const k = num(r.kit_group);
      const dec = (r.decision as EventDecisionType | null) ?? null;
      const revId = (r.reviewer_id as string | null) ?? null;

      if (evType === "TACKLE" || evType === "INTERCEPTION") continue;               // given as the change's `how`
      if (evType === "TEAM_POSSESSION") {
        if (isTeam(k)) team.get(k!)!.possession_s += inside(mt, a, b);
        continue;
      }
      if (evType === "GOAL") {                                                  // the scoreboard changed: a goal, whatever the clock
        const s = typeof r.g_score === "string" ? JSON.parse(r.g_score) as number[] : (r.g_score as number[]);
        const team = isTeam(k), by = team ? (r.primary_track_id as string | null) ?? null : null;
        goals.push({ id: r.id, start_us: a, end_us: b, scoreboard_us: num(r.g_by) ?? b, side: Number(r.g_side) === 1 ? 1 : 0, score: [Number(s[0]), Number(s[1])],
          track_id: by, player_id: team ? r.a_player ?? null : null, kit_group: team ? k : null,
          set_piece: SET_PIECE_KINDS.has(r.g_sp) ? r.g_sp : null, set_piece_by_scorer: !!by && r.g_sp_taker === by,
          decision: dec, reviewer_id: revId });
        continue;
      }
      if (evType === "SET_PIECE") {                                             // the restart in match time; an official is no taker
        if (!within(mt, b)) continue;
        const team = isTeam(k);
        setPieces.push({ id: r.id, at_us: b, dead_from_us: a, kind: SET_PIECE_KINDS.has(r.sp_kind) ? r.sp_kind : null, track_id: team ? r.primary_track_id ?? null : null,
          player_id: team ? r.a_player ?? null : null, kit_group: team ? k : null,
          decision: dec, reviewer_id: revId });
        continue;
      }
      if (!within(mt, a)) continue;                                                     // match time only
      if (evType === "PASS") {
        if (!isTeam(k)) continue;
        team.get(k!)!.passes++;
        passes.push({ id: r.id, start_us: a, end_us: b, from_track_id: r.primary_track_id ?? null, to_track_id: r.secondary_track_id ?? null,
          from_player_id: r.a_player ?? null, to_player_id: r.b_player ?? null, kit_group: k, length_m: num(r.length_m), evidence: r.evidence_state, confidence: Number(r.confidence),
          key: r.is_key === true || r.is_key === "true" || r.is_key === 1, from_xy: xy(r.p_from), to_xy: xy(r.p_to),
          decision: dec, reviewer_id: revId });
      } else if (evType === "PRESSURE") {
        const f = num(r.from_kit_group);
        if (!isTeam(k) || !isTeam(f)) continue;
        const regain = r.regain === true || r.regain === "true" || r.regain === 1;
        team.get(k!)!.pressures++;
        if (regain) team.get(k!)!.press_regains++;
        pressures.push({ id: r.id, start_us: a, end_us: b, presser_track_id: r.primary_track_id ?? null, presser_player_id: r.a_player ?? null,
          pressed_track_id: r.secondary_track_id ?? null, kit_group: k, regain,
          decision: dec, reviewer_id: revId });
      } else if (evType === "SHOT") {
        if (k !== null && !isTeam(k)) continue;                                        // an official's kit: not a team's shot
        shots.push({ id: r.id, at_us: a, track_id: r.primary_track_id ?? null, player_id: r.a_player ?? null, kit_group: k, speed_ms: num(r.speed_ms),
          distance_m: num(r.distance_m), evidence: r.evidence_state,
          decision: dec, reviewer_id: revId });
      } else {
        const f = num(r.from_kit_group);
        if (!isTeam(k) || !isTeam(f)) continue;
        team.get(k!)!.won++;
        changes.push({ id: r.id, at_us: b, lost_track_id: r.primary_track_id ?? null, won_track_id: r.secondary_track_id ?? null, won_player_id: r.b_player ?? null,
          from_kit_group: f, to_kit_group: k, evidence: r.evidence_state, how: how.get(`${r.start_pts_us}|${r.secondary_track_id}`) ?? null,
          decision: dec, reviewer_id: revId });
      }
    }
    const teams = [...team.values()].filter((t) => isTeam(t.kit_group));
    const known = teams.reduce((s, t) => s + t.possession_s, 0);
    // a share needs a team seen on the ball for a fair part of the match: over a small part, it tells which kit the engine reads best
    const enough = known >= MIN_KNOWN_SHARE * counted;
    for (const t of teams) { t.share = enough && known > 0 ? Math.round((1000 * t.possession_s) / known) / 10 : null; t.possession_s = Math.round(t.possession_s); }
    return MatchEvents.parse({ ...none, state: open ? "RUNNING" : "READY", ball_track_id: bt.id, possession_known_s: Math.round(known), teams, passes, changes, shots, pressures, set_pieces: setPieces, goals, rejected_events_count: rejectedCount });
  }

  /** "Is this him?" (ADR-046): the unnamed players in the latest ball track's events (match time) who could be this player, most alike first. */
  async whoIsThis(videoId: string, playerId: string, p: Principal, revisit = false): Promise<WhoIsThis> {
    const v = await this.db.one<RowDataPacket>("SELECT id FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [videoId, p.organizationId]);
    if (!v) throw notFound("Video");
    const pl = await this.players.identity(playerId, p);
    const bt = await this.db.one<RowDataPacket>(
      "SELECT id, run_id FROM ball_tracks WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1", [videoId, p.organizationId]);
    const base = { video_id: videoId, run_id: bt?.run_id ?? null, player: { player_id: pl.player_id, display_name: pl.display_name }, his_tracks: 0, kit_group: null,
      his_spans: [], items: [], more: 0, his_events: 0 };
    if (!bt) return WhoIsThis.parse({ ...base, state: "NONE" });
    const mt = await matchWindows(this.db, videoId);
    // his named tracks: their times (a track on screen with one of them is someone else) and their colour group (most of them)
    const his = await this.db.rows<RowDataPacket>(
      `SELECT t.id, t.first_pts_us, t.last_pts_us, ta.kit_group FROM tracks t JOIN v_track_current_identity ci ON ci.track_id = t.id AND ci.state = 'CONFIRMED'
         LEFT JOIN track_appearance ta ON ta.track_id = t.id WHERE t.run_id = ? AND ci.player_id = ?`, [bt.run_id, playerId]);
    const kits = new Map<number, number>();
    for (const h of his) if (h.kit_group !== null) kits.set(Number(h.kit_group), (kits.get(Number(h.kit_group)) ?? 0) + 1);
    const kit = [...kits.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    const groups = await this.db.rows<RowDataPacket>(
      `SELECT g.kit_group, a.club_id FROM (SELECT DISTINCT run_id, kit_group FROM track_appearance WHERE run_id = ? AND kit_group IS NOT NULL) g
         LEFT JOIN v_run_team_current a ON a.run_id = g.run_id AND a.kit_group = g.kit_group`, [bt.run_id]);
    const club = new Map(groups.map((g) => [Number(g.kit_group), (g.club_id as string | null) ?? null]));
    const assigned = [...club.values()].some((c) => c);
    const isTeam = (k: number | null) => k !== null && club.has(k) && (assigned ? !!club.get(k) : k <= 1);       // as in get()
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT e.event_type, e.start_pts_us, e.end_pts_us, e.primary_track_id, e.secondary_track_id, e.kit_group, JSON_EXTRACT(e.features, '$.from_kit_group') AS from_kit_group
         FROM event_candidates e
        WHERE e.ball_track_id = ? AND e.video_id = ? AND e.event_type IN ('PASS', 'POSSESSION_CHANGE', 'SHOT', 'PRESSURE', 'SET_PIECE')
          AND NOT EXISTS (
            SELECT 1 FROM event_decisions ed
             WHERE ed.event_id = e.id AND ed.decision = 'REJECT'
               AND ed.decided_at = (SELECT MAX(ed2.decided_at) FROM event_decisions ed2 WHERE ed2.event_id = e.id)
          )
        ORDER BY e.start_pts_us`, [bt.id, videoId]);
    const num = (x: unknown) => (x === null || x === undefined || x === "null" ? null : Number(x));
    // the people in each event (the rules of the events served by get()); the moment shown for a track is its best one
    const RANK: Record<WhoMomentKind, number> = { SHOT: 0, PASS_FROM: 1, SET_PIECE: 2, BALL_WON: 3, PRESSURE: 4, PASS_TO: 5 };
    const per = new Map<string, { n: number; moment: { kind: WhoMomentKind; start_us: number; end_us: number } }>();
    const mine = new Set(his.map((h) => h.id as string));
    let hisEvents = 0;
    const seen = (t: string | null, kind: WhoMomentKind, a: number, b: number) => {
      if (!t) return;
      const x = per.get(t);
      if (!x) per.set(t, { n: 1, moment: { kind, start_us: a, end_us: b } });
      else { x.n++; if (RANK[kind] < RANK[x.moment.kind]) x.moment = { kind, start_us: a, end_us: b }; }
    };
    for (const r of rows) {
      const a = Number(r.start_pts_us), b = Number(r.end_pts_us), k = num(r.kit_group), f = num(r.from_kit_group);
      if (!within(mt, a)) continue;
      let people: (string | null)[] = [];
      if (r.event_type === "PASS" && isTeam(k)) { seen(r.primary_track_id, "PASS_FROM", a, b); seen(r.secondary_track_id, "PASS_TO", a, b); people = [r.primary_track_id, r.secondary_track_id]; }
      else if (r.event_type === "POSSESSION_CHANGE" && isTeam(k) && isTeam(f)) { seen(r.secondary_track_id, "BALL_WON", Math.max(0, b - 2_000_000), b); people = [r.secondary_track_id]; }
      else if (r.event_type === "PRESSURE" && isTeam(k) && isTeam(f)) { seen(r.primary_track_id, "PRESSURE", a, b); people = [r.primary_track_id]; }
      else if (r.event_type === "SHOT" && (k === null || isTeam(k))) { seen(r.primary_track_id, "SHOT", a, b); people = [r.primary_track_id]; }
      else if (r.event_type === "SET_PIECE" && isTeam(k)) { seen(r.primary_track_id, "SET_PIECE", Math.max(a, b - 2_000_000), b); people = [r.primary_track_id]; }
      if (people.some((t) => t && mine.has(t))) hisEvents++;
    }
    const ids = [...per.keys()].filter((t) => !mine.has(t));
    const info = ids.length ? await this.db.rows<RowDataPacket>(
      `SELECT t.id, t.internal_track_number, t.first_pts_us, t.last_pts_us, t.class_name, ta.kit_group, ta.thumbnail_asset_id, ci.state, ci.player_id
         FROM tracks t LEFT JOIN track_appearance ta ON ta.track_id = t.id LEFT JOIN v_track_current_identity ci ON ci.track_id = t.id
        WHERE t.run_id = ? AND t.id IN (${ids.map(() => "?").join(",")})`, [bt.run_id, ...ids]) : [];
    // likeness to his named tracks: the stored look-alike graph, both directions (ADR-045)
    const look = new Map<string, number>();
    if (his.length) {
      const hm = his.map(() => "?").join(",");
      const near = await this.db.rows<RowDataPacket>(
        `SELECT other_id, MAX(cosine * (0.5 + 0.5 * kit)) AS score FROM (
           SELECT n.neighbour_id AS other_id, n.cosine, n.kit_similarity AS kit FROM track_neighbours n WHERE n.track_id IN (${hm})
           UNION ALL SELECT n.track_id, n.cosine, n.kit_similarity FROM track_neighbours n WHERE n.neighbour_id IN (${hm})) x GROUP BY other_id`,
        [...his.map((h) => h.id), ...his.map((h) => h.id)]);
      for (const n of near) look.set(n.other_id as string, Math.round(Number(n.score) * 1000) / 1000);
    }
    const items: WhoIsThis["items"] = [];
    for (const r of info) {
      if (r.state === "CONFIRMED" || r.class_name !== "PERSON") continue;                            // named: him or someone else
      const no = r.state === "REJECTED" && r.player_id === playerId;                                  // a person said: not him
      if (no !== revisit) continue;                                                                  // served only when revisiting those
      const k = r.kit_group === null ? null : Number(r.kit_group);
      if (kit !== null && k !== null && k !== kit) continue;                                           // another shirt colour: not him
      if (kit === null && k !== null && !isTeam(k)) continue;                                          // an official's colour
      const a = Number(r.first_pts_us), b = Number(r.last_pts_us), x = per.get(r.id)!;
      if (his.some((h) => a <= Number(h.last_pts_us) && b >= Number(h.first_pts_us))) continue;       // on screen with him: someone else
      items.push({ track_id: r.id, track_number: Number(r.internal_track_number), first_pts_us: a, last_pts_us: b, has_thumbnail: !!r.thumbnail_asset_id,
        kit_group: k, events: x.n, moment: x.moment, look: look.get(r.id) ?? null, said_not_him: no });
    }
    items.sort((x, y) => (y.look ?? -1) - (x.look ?? -1) || y.events - x.events || x.first_pts_us - y.first_pts_us || x.track_number - y.track_number);
    return WhoIsThis.parse({ ...base, his_tracks: his.length, kit_group: kit, state: "READY",
      his_spans: his.map((h) => ({ track_id: h.id, first_pts_us: Number(h.first_pts_us), last_pts_us: Number(h.last_pts_us) })), items: items.slice(0, WHO_PAGE),
      more: Math.max(0, items.length - WHO_PAGE), his_events: hisEvents });
  }
  /** v3 Phase E.1 (ADR-118): analyst confirms, edits, or rejects an event candidate */
  async recordDecision(videoId: string, eventId: string, req: RecordEventDecisionRequest, p: Principal): Promise<EventDecisionRecord> {
    const v = await this.db.one<RowDataPacket>("SELECT id FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [videoId, p.organizationId]);
    if (!v) throw notFound("Video");
    const ev = await this.db.one<RowDataPacket>("SELECT id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id FROM event_candidates WHERE id = ? AND video_id = ?", [eventId, videoId]);
    if (!ev) throw notFound("Event");

    const decisionId = uuidv7();
    await this.db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO event_decisions (id, event_id, decision, reviewer_id, revised_start_pts_us, revised_end_pts_us, revised_type, reason, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(6))`,
        [decisionId, eventId, req.decision, p.userId, req.revised_start_us ?? null, req.revised_end_us ?? null, req.revised_type ?? null, req.reason ?? null],
      );
      await writeAudit(tx, userActor(p), {
        action: `event.${req.decision.toLowerCase()}`,
        entityType: "event",
        entityId: eventId,
        before: { event_type: ev.event_type, start_pts_us: ev.start_pts_us, end_pts_us: ev.end_pts_us },
        after: { ...req },
      });
    });

    const row = await this.db.one<RowDataPacket>(
      `SELECT ed.id, ed.event_id, ed.decision, ed.reviewer_id, ed.revised_start_pts_us, ed.revised_end_pts_us, ed.revised_type, ed.reason,
              DATE_FORMAT(ed.decided_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS decided_at,
              u.display_name AS reviewer_name
         FROM event_decisions ed
         LEFT JOIN users u ON u.id = ed.reviewer_id
        WHERE ed.id = ?`,
      [decisionId],
    );
    return EventDecisionRecord.parse(row);
  }

  /** v3 Phase E.1 (ADR-118): retrieve decision history for events of a video */
  async getDecisions(videoId: string, p: Principal, eventId?: string): Promise<EventDecisionRecord[]> {
    const v = await this.db.one<RowDataPacket>("SELECT id FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [videoId, p.organizationId]);
    if (!v) throw notFound("Video");
    const params = eventId ? [videoId, eventId] : [videoId];
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT ed.id, ed.event_id, ed.decision, ed.reviewer_id, ed.revised_start_pts_us, ed.revised_end_pts_us, ed.revised_type, ed.reason,
              DATE_FORMAT(ed.decided_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS decided_at,
              u.display_name AS reviewer_name
         FROM event_decisions ed
         JOIN event_candidates e ON e.id = ed.event_id
         LEFT JOIN users u ON u.id = ed.reviewer_id
        WHERE e.video_id = ? ${eventId ? "AND ed.event_id = ?" : ""}
        ORDER BY ed.decided_at DESC`,
      params,
    );
    return rows.map((r) => EventDecisionRecord.parse(r));
  }
}

/** candidates served at a time */
const WHO_PAGE = 30;

@Controller("v1")
@UseGuards(AuthGuard)
export class MatchEventsController {
  constructor(private readonly events: MatchEventsService) {}

  @Get("videos/:id/events")
  get(@Param("id") id: string, @Query("all") all: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.events.get(uuidParam(id, "Video"), p, all === "1" || all === "true");
  }

  @Get("videos/:id/who-is-this")
  who(@Param("id") id: string, @Query("player") player: string, @Query("revisit") revisit: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.events.whoIsThis(uuidParam(id, "Video"), uuidParam(player ?? "", "Player"), p, revisit === "1");
  }

  @Post("videos/:id/events/:eventId/decision")
  @Roles("OWNER", "ADMIN", "ANALYST")
  recordDecision(
    @Param("id") id: string,
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.events.recordDecision(
      uuidParam(id, "Video"),
      uuidParam(eventId, "Event"),
      RecordEventDecisionRequest.parse(body),
      p,
    );
  }

  @Get("videos/:id/events/decisions")
  decisions(@Param("id") id: string, @Query("event_id") eventId: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.events.getDecisions(uuidParam(id, "Video"), p, eventId ? uuidParam(eventId, "Event") : undefined);
  }
}
