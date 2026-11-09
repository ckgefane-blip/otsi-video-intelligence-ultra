/**
 * Heat zones (promise 2 of the owner's build order; Page 04 player card, Page 05 "Possession & Heat Zones", Page 08 player report):
 * where a player (one track) or a team (one kit group of a run) spent their time on the pitch.
 *
 *   GET /v1/analysis-runs/:id/tracks/:trackId/heat-zones      one track, every observation (bucketed to 2 per second)
 *   GET /v1/analysis-runs/:id/heat-zones?kit_group=N           every person of a kit group, one observation per person per second
 *   GET /v1/players/:id/measures[?half=1|2]                   a registered player over the tracks a person CONFIRMED (Page 08); one half only
 *                                                               when asked (videos whose halves are not known then add nothing)
 *   GET /v1/players/:id/events[?half=1|2]                     his events (Page 08 Event Timeline, Action Map): the ones `measures` counts, plus set
 *                                                               pieces and goals; pass ends on the pitch where a calibration covers them
 *   GET /v1/analysis-runs/:id/tracks/:trackId/movement        distance and top speed of one person, over measured stretches only
 *   GET /v1/analysis-runs/:id/team-shape?kit_groups=N,M         a team's shape (promise 3): one moment a second, used when >= SHAPE_MIN_PLAYERS
 *                                                               of its players stand on a measured pitch
 *
 * Positions are the feet of the box placed on the pitch by the best pitch calibration covering that moment (the same rule as the
 * observations window); a moment without a calibration adds to `seen_s` only, never to a zone. Teams change ends at half-time: both halves
 * are drawn as filmed. Team results are kept for 10 minutes per run, group and calibration state.
 */
import { Controller, Get, Injectable, Param, Query, UseGuards } from "@nestjs/common";
import { feetPosition, HEAT_COLS, HEAT_ROWS, heatCell, HeatZones, hullArea, type Mat3, Movement, movementOf, type PlayerEvent, PlayerEvents, PlayerMeasures, type Pt, SetPieceKind,
  SHAPE_COLS, SHAPE_MIN_PLAYERS, SHAPE_ROWS, SHAPE_SPAN_M, TeamShape, unproject } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { notHidden, videoNotHidden } from "../../core/access";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PlayersService } from "../players/players.service";
import { halfWindows, matchWindows, within, windowsKey } from "./match-time";

const TRACK_BUCKET_US = 500_000;            // a track: one observation per half second counts (the tracker samples 6 per second)
const TEAM_BUCKET_US = 1_000_000;           // a team: one per person per second (thousands of tracks)
const CACHE_MS = 10 * 60_000;

interface Slice { s: number; e: number; H: Mat3; L: number; W: number; q: number }
interface Obs { pts: number; x: number; y: number; w: number; h: number }

/** Zone seconds from observations sorted by time, each standing for `step_us`, placed by the best calibration slice covering its moment. */
export function accumulate(obs: Obs[], slices: Slice[], stepUs: number, length: number, width: number): { seconds: number[]; seen: number; measured: number } {
  const seconds = new Array<number>(HEAT_COLS * HEAT_ROWS).fill(0);
  const sorted = [...slices].sort((a, b) => a.s - b.s);
  let next = 0, active: Slice[] = [], measured = 0;
  for (const o of obs) {
    while (next < sorted.length && sorted[next]!.s <= o.pts) active.push(sorted[next++]!);
    active = active.filter((sl) => sl.e > o.pts);
    let best: Slice | null = null;
    for (const sl of active) if (!best || sl.q > best.q) best = sl;
    if (!best) continue;
    const p = feetPosition(best.H, o, best.L, best.W);
    const cell = p && heatCell(p, best.L, best.W);
    if (!cell) continue;
    seconds[cell[1] * HEAT_COLS + cell[0]]! += stepUs / 1e6;
    measured += stepUs / 1e6;
  }
  return { seconds: seconds.map((v) => Math.round(v * 10) / 10), seen: (obs.length * stepUs) / 1e6, measured: Math.round(measured * 10) / 10 };
}

/** The slice covering `t` with the best quality, or null (slices sorted by start; short slices, so a small backwards scan). */
function sliceAt(sorted: Slice[], t: number): Slice | null {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m]!.s <= t) lo = m + 1; else hi = m; }
  let best: Slice | null = null;
  for (let i = lo - 1; i >= 0 && i >= lo - 8; i--) { const sl = sorted[i]!; if (sl.e > t && (!best || sl.q > best.q)) best = sl; }
  return best;
}

const stat = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))]!;
  return { mean: Math.round((v.reduce((t, x) => t + x, 0) / v.length) * 10) / 10, p10: Math.round(q(0.1) * 10) / 10, p90: Math.round(q(0.9) * 10) / 10 };
};

/** The shape over moments [(players' feet in the picture)], each moment placed by the calibration covering it. */
export function shapeOf(moments: { pts: number; feet: Obs[] }[], slices: Slice[], groups: number[]): TeamShape {
  const sorted = [...slices].sort((a, b) => a.s - b.s);
  const density = new Array<number>(SHAPE_COLS * SHAPE_ROWS).fill(0);
  const width: number[] = [], length: number[] = [], area: number[] = [], count: number[] = [];
  for (const m of moments) {
    const sl = sliceAt(sorted, m.pts);
    if (!sl) continue;
    const ps = m.feet.map((o) => feetPosition(sl.H, o, sl.L, sl.W)).filter((p): p is Pt => !!p && Math.abs(p[0]) <= sl.L / 2 && Math.abs(p[1]) <= sl.W / 2);
    if (ps.length < SHAPE_MIN_PLAYERS) continue;
    const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
    const cx = xs.reduce((t, v) => t + v, 0) / ps.length, cy = ys.reduce((t, v) => t + v, 0) / ps.length;
    width.push(Math.max(...ys) - Math.min(...ys)); length.push(Math.max(...xs) - Math.min(...xs)); area.push(hullArea(ps)); count.push(ps.length);
    for (const [x, y] of ps) {
      const c = Math.floor(((x - cx) / SHAPE_SPAN_M[0] + 0.5) * SHAPE_COLS), r = Math.floor(((y - cy) / SHAPE_SPAN_M[1] + 0.5) * SHAPE_ROWS);
      if (c >= 0 && c < SHAPE_COLS && r >= 0 && r < SHAPE_ROWS) density[r * SHAPE_COLS + c]! += 1;
    }
  }
  const a = stat(area);
  const mean = area.length ? area.reduce((t, v) => t + v, 0) / area.length : 0;
  const sd = area.length ? Math.sqrt(area.reduce((t, v) => t + (v - mean) ** 2, 0) / area.length) : 0;
  return TeamShape.parse({
    kit_groups: groups, moments: area.length, seen_moments: moments.length, min_players: SHAPE_MIN_PLAYERS,
    players_per_moment: count.length ? Math.round((count.reduce((t, v) => t + v, 0) / count.length) * 10) / 10 : null,
    width_m: stat(width), length_m: stat(length), compactness_m2: a, variability: area.length && mean > 0 ? Math.round((sd / mean) * 100) / 100 : null,
    density,
    not_measured: {
      formation: "Needs all ten outfield players and the direction of attack: the camera shows part of the pitch and match halves are not recorded.",
      defensive_line_height: "Needs which goal the team defends: match halves are not recorded.",
      phases: "Build-up and defensive shape need possession, which needs a reliable ball.",
    },
  });
}

@Injectable()
export class HeatZonesService {
  private cache = new Map<string, { at: number; value: HeatZones }>();
  private shapeCache = new Map<string, { at: number; value: TeamShape }>();
  constructor(private readonly db: Db, private readonly players: PlayersService) {}

  private async run(id: string, p: Principal): Promise<RowDataPacket> {
    const r = await this.db.one<RowDataPacket>("SELECT id, video_id FROM pipeline_runs WHERE id = ? AND organization_id = ?", [id, p.organizationId]);
    if (!r) throw notFound("Analysis run");
    return r;
  }

  private async slices(videoId: string, fromUs: number, toUs: number): Promise<Slice[]> {
    const cal = await this.db.rows<RowDataPacket>(
      "SELECT start_pts_us, end_pts_us, transform_matrix, pitch_length_m, pitch_width_m, quality_score FROM pitch_calibrations WHERE video_id = ? AND end_pts_us > ? AND start_pts_us < ?",
      [videoId, fromUs, toUs]);
    return cal.map((c) => ({ s: Number(c.start_pts_us), e: Number(c.end_pts_us), H: (typeof c.transform_matrix === "string" ? JSON.parse(c.transform_matrix) : c.transform_matrix) as Mat3,
      L: Number(c.pitch_length_m ?? 105), W: Number(c.pitch_width_m ?? 68), q: Number(c.quality_score ?? 0) }));
  }

  private size(slices: Slice[]): [number, number] {
    return slices.length ? [slices[0]!.L, slices[0]!.W] : [105, 68];
  }

  async track(runId: string, trackId: string, p: Principal): Promise<HeatZones> {
    const run = await this.run(runId, p);
    const t = await this.db.one<RowDataPacket>("SELECT id, class_name FROM tracks WHERE id = ? AND run_id = ?", [trackId, runId]);
    if (!t) throw notFound("Track");
    if (t.class_name !== "PERSON") throw new ApiError(422, "NOT_A_PERSON", "Heat zones are for people, not the ball.");
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT pts_us, bbox_x, bbox_y, bbox_w, bbox_h FROM (
         SELECT o.pts_us, o.bbox_x, o.bbox_y, o.bbox_w, o.bbox_h, ROW_NUMBER() OVER (PARTITION BY FLOOR(o.pts_us / ?) ORDER BY o.pts_us) AS k
           FROM track_observations o WHERE o.track_id = ? AND o.video_id = ?) x WHERE k = 1 ORDER BY pts_us`, [TRACK_BUCKET_US, trackId, run.video_id]);
    const mt = await matchWindows(this.db, String(run.video_id));
    const obs = rows.map(toObs).filter((o) => within(mt, o.pts));                       // match time only
    const slices = obs.length ? await this.slices(String(run.video_id), obs[0]!.pts, obs.at(-1)!.pts + 1) : [];
    const [L, W] = this.size(slices);
    const a = accumulate(obs, slices, TRACK_BUCKET_US, L, W);
    return HeatZones.parse({ subject: { kind: "TRACK", id: trackId }, length_m: L, width_m: W, cols: HEAT_COLS, rows: HEAT_ROWS, seconds: a.seconds, seen_s: a.seen, measured_s: a.measured, ends_as_filmed: true });
  }

  /** measured positions [(t, x, y)] of a person's observations (every observation, time order) and the time seen */
  async positionsOf(videoId: string, trackIds: string[], half: 1 | 2 | null = null): Promise<{ points: [number, number, number][]; seen: number; step?: number }> {
    if (!trackIds.length) return { points: [], seen: 0 };
    const rows = await this.db.rows<RowDataPacket>(
      "SELECT pts_us, bbox_x, bbox_y, bbox_w, bbox_h FROM track_observations WHERE video_id = ? AND track_id IN (?) ORDER BY pts_us", [videoId, trackIds]);
    const mt = await halfWindows(this.db, videoId, half);
    const obs = rows.map(toObs).filter((o) => within(mt, o.pts));                       // match time only
    if (!obs.length) return { points: [], seen: 0 };
    const gaps = obs.slice(1).map((o, i) => o.pts - obs[i]!.pts).filter((g) => g > 0).sort((a, b) => a - b);
    const step = gaps.length ? gaps[Math.floor(gaps.length / 2)]! : 166_667;
    const sorted = (await this.slices(videoId, obs[0]!.pts, obs.at(-1)!.pts + 1)).sort((a, b) => a.s - b.s);
    const points: [number, number, number][] = [];
    for (const o of obs) {
      const sl = sliceAt(sorted, o.pts);
      const q = sl && feetPosition(sl.H, o, sl.L, sl.W);
      if (q) points.push([o.pts, q[0], q[1]]);
    }
    return { points, seen: (obs.length * step) / 1e6, step };
  }

  async player(playerId: string, p: Principal, half: 1 | 2 | null = null): Promise<PlayerMeasures> {
    await this.players.identity(playerId, p);                              // the registry's visibility rule (404 for another organization's provisional player)
    const tracks = await this.db.rows<RowDataPacket>(
      `SELECT t.id, t.video_id, t.mean_confidence, t.observation_count FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id
         JOIN pipeline_runs r ON r.id = t.run_id WHERE ci.player_id = ? AND ci.state = 'CONFIRMED' AND r.organization_id = ? AND t.class_name = 'PERSON'${videoNotHidden(p, "t.video_id")}`,
      [playerId, p.organizationId]);
    const byVideo = new Map<string, string[]>();
    for (const t of tracks) byVideo.set(String(t.video_id), [...(byVideo.get(String(t.video_id)) ?? []), String(t.id)]);
    let seen = 0, measured = 0, distance = 0, anyDistance = false, top: number | null = null, dropped = 0, L = 105, W = 68, high = 0, sprintM = 0, sprints = 0;
    const heat = new Array<number>(HEAT_COLS * HEAT_ROWS).fill(0);
    let heatMeasured = 0;
    for (const [video, ids] of byVideo) {
      const { points, seen: s, step } = await this.positionsOf(video, ids, half);
      const m = movementOf(points, s);
      seen += m.seen_s; measured += m.measured_s; dropped += m.dropped_steps;
      if (m.distance_m !== null) { distance += m.distance_m; anyDistance = true; high += m.high_speed_m ?? 0; sprintM += m.sprint_m ?? 0; }
      sprints += m.sprints;
      if (m.top_speed_kmh !== null) top = Math.max(top ?? 0, m.top_speed_kmh);
      const sl = await this.db.one<RowDataPacket>("SELECT pitch_length_m, pitch_width_m FROM pitch_calibrations WHERE video_id = ? LIMIT 1", [video]);
      if (sl) { L = Number(sl.pitch_length_m); W = Number(sl.pitch_width_m); }
      for (const [, x, y] of points) {
        const c = heatCell([x, y], L, W);
        if (c) { heat[c[1] * HEAT_COLS + c[0]]! += (step ?? 0) / 1e6; heatMeasured += (step ?? 0) / 1e6; }
      }
    }
    // his events (the passer, the receiver, the winner, the presser, the shooter) on the latest followed ball of each video, in match time
    const ev = { passes: 0, key_passes: 0, passes_received: 0, balls_won: 0, pressures: 0, shots: 0, videos: 0 };
    for (const [video, ids] of byVideo) {
      const bt = await this.db.one<RowDataPacket>("SELECT id FROM ball_tracks WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1", [video, p.organizationId]);
      if (!bt) continue;
      ev.videos++;
      const mt = await halfWindows(this.db, video, half);
      const rows = await this.db.rows<RowDataPacket>(
        `SELECT event_type, start_pts_us, primary_track_id, secondary_track_id, JSON_EXTRACT(features, '$.key') AS is_key FROM event_candidates e
          WHERE ball_track_id = ? AND event_type IN ('PASS', 'POSSESSION_CHANGE', 'PRESSURE', 'SHOT') AND (primary_track_id IN (?) OR secondary_track_id IN (?)) AND NOT EXISTS (SELECT 1 FROM event_decisions ed WHERE ed.event_id = e.id AND ed.decision = 'REJECT' AND ed.decided_at = (SELECT MAX(ed2.decided_at) FROM event_decisions ed2 WHERE ed2.event_id = e.id))`, [bt.id, ids, ids]);
      for (const r of rows) {
        if (!within(mt, Number(r.start_pts_us))) continue;
        const mine = ids.includes(r.primary_track_id), his = ids.includes(r.secondary_track_id);
        if (r.event_type === "PASS") { if (mine) { ev.passes++; if (r.is_key === true || r.is_key === "true" || r.is_key === 1) ev.key_passes++; } else if (his) ev.passes_received++; }
        else if (r.event_type === "POSSESSION_CHANGE" && his) ev.balls_won++;           // the loser first, the winner second
        else if (r.event_type === "PRESSURE" && mine) ev.pressures++;
        else if (r.event_type === "SHOT" && mine) ev.shots++;
      }
    }
    const halves = { confirmed: 0, proposed: 0, unknown: byVideo.size };       // how his videos' halves are known: a person confirmed them, or the engine proposed them
    if (byVideo.size) {
      for (const h of await this.db.rows<RowDataPacket>("SELECT state FROM match_periods WHERE video_id IN (?)", [[...byVideo.keys()]])) {
        halves.unknown--;
        if (h.state === "CONFIRMED") halves.confirmed++; else halves.proposed++;
      }
    }
    const weight = tracks.reduce((t, x) => t + Number(x.observation_count ?? 0), 0);
    const conf = weight ? tracks.reduce((t, x) => t + Number(x.mean_confidence ?? 0) * Number(x.observation_count ?? 0), 0) / weight : null;
    const r1 = (v: number) => Math.round(v * 10) / 10;
    return PlayerMeasures.parse({
      player_id: playerId, tracks: tracks.length, videos: byVideo.size, seen_s: r1(seen), measured_s: r1(measured),
      distance_m: anyDistance ? Math.round(distance) : null, top_speed_kmh: top === null ? null : r1(top), dropped_steps: dropped,
      high_speed_m: anyDistance ? high : null, sprint_m: anyDistance ? sprintM : null, sprints,
      mean_confidence: conf === null ? null : Math.round(conf * 1000) / 1000,
      heat: heatMeasured > 0 ? { subject: { kind: "TRACK", id: playerId }, length_m: L, width_m: W, cols: HEAT_COLS, rows: HEAT_ROWS,
        seconds: heat.map((v) => Math.round(v * 10) / 10), seen_s: r1(seen), measured_s: r1(heatMeasured), ends_as_filmed: true } : null,
      events: ev.videos ? ev : null,
      half, halves,
    });
  }

  /** his events on his confirmed tracks (the rows `player()` counts, the same match-time rule) */
  async playerEvents(playerId: string, p: Principal, half: 1 | 2 | null = null): Promise<PlayerEvents> {
    await this.players.identity(playerId, p);
    const tracks = await this.db.rows<RowDataPacket>(
      `SELECT t.id, t.video_id, v.title FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id JOIN pipeline_runs r ON r.id = t.run_id
         JOIN video_sources v ON v.id = t.video_id AND v.removed_at IS NULL
        WHERE ci.player_id = ? AND ci.state = 'CONFIRMED' AND r.organization_id = ? AND t.class_name = 'PERSON'${notHidden(p, "v.project_id")}`, [playerId, p.organizationId]);
    const byVideo = new Map<string, { title: string; ids: string[] }>();
    for (const t of tracks) {
      const v = byVideo.get(String(t.video_id)) ?? { title: String(t.title ?? "Video"), ids: [] };
      v.ids.push(String(t.id)); byVideo.set(String(t.video_id), v);
    }
    const items: PlayerEvent[] = [];
    let videos = 0, L = 105, W = 68;
    const num = (x: unknown) => (x === null || x === undefined || x === "null" ? null : Number(x));
    const yes = (x: unknown) => x === true || x === "true" || x === 1;
    const pt = (x: unknown): [number, number] | null => {
      const a = typeof x === "string" ? JSON.parse(x) as unknown : x;
      return Array.isArray(a) && a.length === 2 && a.every((v) => typeof v === "number") ? [a[0] as number, a[1] as number] : null;
    };
    for (const [video, { title, ids }] of byVideo) {
      const bt = await this.db.one<RowDataPacket>("SELECT id FROM ball_tracks WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1", [video, p.organizationId]);
      if (!bt) continue;
      videos++;
      const mt = await halfWindows(this.db, video, half);
      const rows = await this.db.rows<RowDataPacket>(
        `SELECT e.id, e.event_type, e.start_pts_us, e.end_pts_us, e.primary_track_id, e.secondary_track_id, e.evidence_state,
                JSON_EXTRACT(e.features, '$.key') AS is_key, JSON_EXTRACT(e.features, '$.from') AS f_from, JSON_EXTRACT(e.features, '$.to') AS f_to,
                JSON_EXTRACT(e.features, '$.length_m') AS length_m, JSON_EXTRACT(e.features, '$.regain') AS regain, JSON_UNQUOTE(JSON_EXTRACT(e.features, '$.kind')) AS sp_kind,
                a.player_id AS a_player, b.player_id AS b_player
           FROM event_candidates e
           LEFT JOIN v_track_current_identity a ON a.track_id = e.primary_track_id AND a.state = 'CONFIRMED'
           LEFT JOIN v_track_current_identity b ON b.track_id = e.secondary_track_id AND b.state = 'CONFIRMED'
          WHERE e.ball_track_id = ? AND e.event_type IN ('PASS', 'POSSESSION_CHANGE', 'PRESSURE', 'SHOT', 'TACKLE', 'INTERCEPTION', 'SET_PIECE', 'GOAL')
            AND (e.primary_track_id IN (?) OR e.secondary_track_id IN (?)) AND NOT EXISTS (SELECT 1 FROM event_decisions ed WHERE ed.event_id = e.id AND ed.decision = 'REJECT' AND ed.decided_at = (SELECT MAX(ed2.decided_at) FROM event_decisions ed2 WHERE ed2.event_id = e.id)) ORDER BY e.start_pts_us`, [bt.id, ids, ids]);
      // a TACKLE / INTERCEPTION row sits beside its change of possession, the winner first (as in GET /v1/videos/:id/events)
      const how = new Map(rows.filter((r) => r.event_type === "TACKLE" || r.event_type === "INTERCEPTION")
        .map((r) => [`${r.start_pts_us}|${r.primary_track_id}`, r.event_type as "TACKLE" | "INTERCEPTION"]));
      const passes = rows.filter((r) => r.event_type === "PASS");
      const sorted = passes.length ? (await this.slices(video, Number(passes[0]!.start_pts_us), Number(passes.at(-1)!.end_pts_us) + 1)).sort((x, y) => x.s - y.s) : [];
      if (sorted.length) { L = sorted[0]!.L; W = sorted[0]!.W; }
      // a pass end (the ball, normalised picture point) on the pitch, by the best calibration covering that moment; else not placed
      const onPitch = (q: [number, number] | null, t: number): [number, number] | null => {
        const sl = q ? sliceAt(sorted, t) : null;
        const m = sl && q ? unproject(sl.H, q) : null;
        return sl && m && Number.isFinite(m[0]) && Number.isFinite(m[1]) && Math.abs(m[0]) <= sl.L / 2 + 3 && Math.abs(m[1]) <= sl.W / 2 + 3
          ? [Math.round(m[0] * 10) / 10, Math.round(m[1] * 10) / 10] : null;
      };
      for (const r of rows) {
        const a = Number(r.start_pts_us), b = Number(r.end_pts_us);
        const mine = ids.includes(r.primary_track_id), his = ids.includes(r.secondary_track_id);
        const base = { id: String(r.id), video_id: video, video_title: title, start_us: a, end_us: b, evidence: String(r.evidence_state), key: false, how: null, set_piece: null,
          regain: null, partner_player_id: null, partner_name: null, length_m: null, from_m: null, to_m: null };
        let e: PlayerEvent | null = null;
        if (r.event_type === "SET_PIECE" || r.event_type === "GOAL") {
          if (!mine || !within(mt, b)) continue;
          const sp = SetPieceKind.safeParse(r.sp_kind);
          e = { ...base, kind: r.event_type, set_piece: r.event_type === "SET_PIECE" && sp.success ? sp.data : null };
        } else {
          if (!within(mt, a)) continue;
          if (r.event_type === "PASS" && (mine || his)) {
            const partner = mine ? r.b_player : r.a_player;
            e = { ...base, kind: mine ? "PASS" : "PASS_RECEIVED", key: mine && yes(r.is_key), partner_player_id: (partner as string | null) ?? null, length_m: num(r.length_m),
              from_m: onPitch(pt(r.f_from), a), to_m: onPitch(pt(r.f_to), b) };
          } else if (r.event_type === "POSSESSION_CHANGE" && his) e = { ...base, kind: "BALL_WON", how: how.get(`${r.start_pts_us}|${r.secondary_track_id}`) ?? null };
          else if (r.event_type === "PRESSURE" && mine) e = { ...base, kind: "PRESSURE", regain: yes(r.regain) };
          else if (r.event_type === "SHOT" && mine) e = { ...base, kind: "SHOT" };
        }
        if (e) items.push(e);
      }
    }
    const partners = [...new Set(items.map((i) => i.partner_player_id).filter((x): x is string => !!x))];
    if (partners.length) {
      const names = new Map((await this.db.rows<RowDataPacket>("SELECT player_id, display_name FROM v_player_identity WHERE player_id IN (?)", [partners]))
        .map((n) => [String(n.player_id), String(n.display_name)]));
      for (const i of items) if (i.partner_player_id) i.partner_name = names.get(i.partner_player_id) ?? null;
    }
    return PlayerEvents.parse({ player_id: playerId, half, videos, length_m: L, width_m: W, items });
  }

  async movement(runId: string, trackId: string, p: Principal): Promise<Movement> {
    const run = await this.run(runId, p);
    const t = await this.db.one<RowDataPacket>("SELECT id, class_name FROM tracks WHERE id = ? AND run_id = ?", [trackId, runId]);
    if (!t) throw notFound("Track");
    if (t.class_name !== "PERSON") throw new ApiError(422, "NOT_A_PERSON", "Distance and speed are for people, not the ball.");
    const { points, seen } = await this.positionsOf(String(run.video_id), [trackId]);
    return movementOf(points, seen);
  }

  async teamShape(runId: string, groups: number[], p: Principal): Promise<TeamShape> {
    const run = await this.run(runId, p);
    const state = await this.db.one<RowDataPacket>("SELECT COUNT(*) AS n, MAX(id) AS last FROM pitch_calibrations WHERE video_id = ?", [run.video_id]);
    const mt = await matchWindows(this.db, String(run.video_id));
    const key = `shape:${p.organizationId}:${runId}:${groups.join(",")}:${state?.n}:${state?.last}:${windowsKey(mt)}`;
    const hit = this.shapeCache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    // one analysed frame per second (the first of each second), every person of the team seen in it
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT o.frame_index, o.pts_us, o.bbox_x, o.bbox_y, o.bbox_w, o.bbox_h
         FROM (SELECT MIN(frame_index) AS fi FROM video_frame_index WHERE video_id = ? GROUP BY FLOOR(pts_us / 1000000)) f
         JOIN track_observations o ON o.video_id = ? AND o.frame_index = f.fi
         JOIN tracks t ON t.id = o.track_id JOIN track_appearance ta ON ta.track_id = t.id
        WHERE t.run_id = ? AND t.class_name = 'PERSON' AND ta.kit_group IN (?) ORDER BY o.frame_index`,
      [run.video_id, run.video_id, runId, groups]);
    const moments: { pts: number; feet: Obs[] }[] = [];
    for (const r of rows) {
      const last = moments[moments.length - 1];
      const o = toObs(r);
      if (!within(mt, o.pts)) continue;                                                   // match time only
      if (last && last.pts === o.pts) last.feet.push(o); else moments.push({ pts: o.pts, feet: [o] });
    }
    const slices = moments.length ? await this.slices(String(run.video_id), moments[0]!.pts, moments.at(-1)!.pts + 1) : [];
    const value = shapeOf(moments, slices, groups);
    this.shapeCache.set(key, { at: Date.now(), value });
    return value;
  }

  async kitGroup(runId: string, group: number, p: Principal): Promise<HeatZones> {
    const run = await this.run(runId, p);
    const state = await this.db.one<RowDataPacket>("SELECT COUNT(*) AS n, MAX(id) AS last FROM pitch_calibrations WHERE video_id = ?", [run.video_id]);
    const mt = await matchWindows(this.db, String(run.video_id));
    const key = `${p.organizationId}:${runId}:${group}:${state?.n}:${state?.last}:${windowsKey(mt)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT pts_us, bbox_x, bbox_y, bbox_w, bbox_h FROM (
         SELECT o.pts_us, o.bbox_x, o.bbox_y, o.bbox_w, o.bbox_h, ROW_NUMBER() OVER (PARTITION BY o.track_id, FLOOR(o.pts_us / ?) ORDER BY o.pts_us) AS k
           FROM track_observations o JOIN tracks t ON t.id = o.track_id JOIN track_appearance ta ON ta.track_id = t.id
          WHERE t.run_id = ? AND t.class_name = 'PERSON' AND ta.kit_group = ? AND o.video_id = ?) x WHERE k = 1 ORDER BY pts_us`,
      [TEAM_BUCKET_US, runId, group, run.video_id]);
    const obs = rows.map(toObs).filter((o) => within(mt, o.pts));                       // match time only
    const slices = obs.length ? await this.slices(String(run.video_id), obs[0]!.pts, obs.at(-1)!.pts + 1) : [];
    const [L, W] = this.size(slices);
    const a = accumulate(obs, slices, TEAM_BUCKET_US, L, W);
    const value = HeatZones.parse({ subject: { kind: "KIT_GROUP", id: String(group) }, length_m: L, width_m: W, cols: HEAT_COLS, rows: HEAT_ROWS, seconds: a.seconds,
      seen_s: a.seen, measured_s: a.measured, ends_as_filmed: true });
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}

function toObs(r: RowDataPacket): Obs {
  return { pts: Number(r.pts_us), x: Number(r.bbox_x), y: Number(r.bbox_y), w: Number(r.bbox_w), h: Number(r.bbox_h) };
}

@Controller("v1")
@UseGuards(AuthGuard)
export class HeatZonesController {
  constructor(private readonly heat: HeatZonesService) {}

  @Get("analysis-runs/:id/tracks/:trackId/heat-zones")
  track(@Param("id") id: string, @Param("trackId") trackId: string, @CurrentPrincipal() p: Principal) {
    return this.heat.track(uuidParam(id, "Analysis run"), uuidParam(trackId, "Track"), p);
  }

  @Get("players/:id/measures")
  player(@Param("id") id: string, @Query("half") half: string | undefined, @CurrentPrincipal() p: Principal) {
    if (half !== undefined && half !== "1" && half !== "2") throw new ApiError(400, "BAD_HALF", "half is 1 or 2.");
    return this.heat.player(uuidParam(id, "Player"), p, half ? (Number(half) as 1 | 2) : null);
  }

  @Get("players/:id/events")
  playerEvents(@Param("id") id: string, @Query("half") half: string | undefined, @CurrentPrincipal() p: Principal) {
    if (half !== undefined && half !== "1" && half !== "2") throw new ApiError(400, "BAD_HALF", "half is 1 or 2.");
    return this.heat.playerEvents(uuidParam(id, "Player"), p, half ? (Number(half) as 1 | 2) : null);
  }

  @Get("analysis-runs/:id/tracks/:trackId/movement")
  movement(@Param("id") id: string, @Param("trackId") trackId: string, @CurrentPrincipal() p: Principal) {
    return this.heat.movement(uuidParam(id, "Analysis run"), uuidParam(trackId, "Track"), p);
  }

  @Get("analysis-runs/:id/team-shape")
  teamShape(@Param("id") id: string, @Query("kit_groups") g: string, @CurrentPrincipal() p: Principal) {
    const groups = String(g ?? "").split(",").filter((x) => x !== "").map(Number);
    if (!groups.length || groups.some((x) => !Number.isInteger(x) || x < 0 || x > 9)) throw new ApiError(422, "INVALID_KIT_GROUP", "Give kit_groups as whole numbers 0-9, separated by commas.");
    return this.heat.teamShape(uuidParam(id, "Analysis run"), [...new Set(groups)].sort(), p);
  }

  @Get("analysis-runs/:id/heat-zones")
  kitGroup(@Param("id") id: string, @Query("kit_group") g: string, @CurrentPrincipal() p: Principal) {
    const group = Number(g);
    if (!Number.isInteger(group) || group < 0 || group > 9) throw new ApiError(422, "INVALID_KIT_GROUP", "Give kit_group as a whole number 0-9.");
    return this.heat.kitGroup(uuidParam(id, "Analysis run"), group, p);
  }
}
