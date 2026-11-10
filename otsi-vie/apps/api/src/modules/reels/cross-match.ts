/**
 * Cross-match best moments (ADR-131): one reel of a player's best moments from ALL his uploaded matches.
 *
 *   GET    /v1/players/:id/cross-match-moments?length_s=180   the selection for a registered player with >= 1 confirmed track
 *
 * Gathering uses confirmed tracks only, per video (the same rule as single-match moments): a video where he has no confirmed
 * track, or no SUCCEEDED ball track, contributes nothing. Event moments come from the per-video form of the reel builder's
 * eventMoments (moved here, unchanged apart from the pass length and the per-event spans it now carries); sprint moments come
 * from his measured positions (positionsOf + movementOf — a sprint Run becomes a candidate window, 3.0 s before it to 2.5 s
 * after it, clamped 4–12 s like an event moment, ADR-131 v2.1). Only measured moments count (ADR-124); the tier rule itself
 * is the pure contracts function (selectCrossMatchMoments).
 *
 * The match minute is computed only when the video's match halves are CONFIRMED (ADR-044), clamped to 45 / 90 like a broadcast
 * clock (stoppage time is not modelled: a moment in first-half stoppage reads 45'); otherwise the label uses media time.
 */
import { Controller, Get, Inject, Injectable, Param, Query, UseGuards } from "@nestjs/common";
import {
  CROSS_MATCH_PER_MATCH_CAPS, CrossMatchCandidate, CrossMatchLength, CrossMatchSelection, CrossMatchTier, crossMatchChainLabel,
  crossMatchClipWindow, isRejected, MomentEvent, movementOf, POSITION_LINES, PositionGroup, selectCrossMatchMoments,
  tierOfCandidate, type Reel,
} from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError } from "../../core/problem";
import { HeatZonesService } from "../analysis/heat";
import { matchWindows, within } from "../analysis/match-time";
import { PlayersService, playerProfile } from "../players/players.service";
import { uuidParam } from "../players/players.controller";
import { videoNotHidden } from "../../core/access";

/** an event moment: from 4 s before the event (the build-up) to 5 s after it (the outcome); events up to 3 s apart are one
 * moment (up to 20 s); while he still has the ball at the end, the moment runs until 3 s after his spell on the ball ends */
const EVENT_BEFORE_US = 4_000_000;
const EVENT_AFTER_US = 5_000_000;
const EVENT_JOIN_US = 3_000_000;
const EVENT_MAX_US = 20_000_000;
const SPELL_AFTER_US = 3_000_000;
/** what each kind of event is worth in the ranking; the order of `events` in a moment follows it */
export const EVENT_SCORE: Record<MomentEvent, number> = { GOAL: 10, FREE_KICK_GOAL: 11, PENALTY_GOAL: 10, SHOT: 5, KEY_PASS: 4, PENALTY: 4, FREE_KICK: 3, CORNER: 3, TACKLE: 3, INTERCEPTION: 3, BALL_WON: 3,
  SET_PIECE: 2, THROW_IN: 1, GOAL_KICK: 1, KICK_OFF: 1, PRESSURE_REGAIN: 3, PRESSURE: 2, PASS: 2, PASS_RECEIVED: 1 };
const EVENT_WORDS: Record<MomentEvent, [string, string]> = {
  GOAL: ["goal", "goals"], FREE_KICK_GOAL: ["free-kick goal", "free-kick goals"], PENALTY_GOAL: ["penalty goal", "penalty goals"],
  SHOT: ["shot", "shots"], KEY_PASS: ["key pass", "key passes"], TACKLE: ["tackle (possible)", "tackles (possible)"],
  INTERCEPTION: ["interception (possible)", "interceptions (possible)"], PENALTY: ["penalty", "penalties"], FREE_KICK: ["free kick", "free kicks"],
  CORNER: ["corner", "corners"], THROW_IN: ["throw-in", "throw-ins"], GOAL_KICK: ["goal kick", "goal kicks"], KICK_OFF: ["kick-off", "kick-offs"],
  SET_PIECE: ["set piece", "set pieces"], BALL_WON: ["ball won", "balls won"], PRESSURE_REGAIN: ["pressure, ball won back", "pressures, ball won back"],
  PRESSURE: ["pressure", "pressures"], PASS: ["pass", "passes"], PASS_RECEIVED: ["pass received", "passes received"],
};

/** ADR-048: the taker's moment for each kind of set piece */
const SET_PIECE_MOMENT: Record<string, MomentEvent> = { PENALTY: "PENALTY", FREE_KICK: "FREE_KICK", CORNER: "CORNER", THROW_IN: "THROW_IN", GOAL_KICK: "GOAL_KICK", KICK_OFF: "KICK_OFF" };

/** "Ball won + 2 passes": what happened in a moment, best first */
export function eventLabel(events: MomentEvent[]): string {
  const n = new Map<MomentEvent, number>();
  for (const e of events) n.set(e, (n.get(e) ?? 0) + 1);
  const words = [...n].sort((x, y) => EVENT_SCORE[y[0]] - EVENT_SCORE[x[0]]).map(([e, k]) => (k === 1 ? EVENT_WORDS[e][0] : `${k} ${EVENT_WORDS[e][1]}`));
  const s = words.join(" + ");
  return s[0]!.toUpperCase() + s.slice(1);
}

export interface VideoEventMoment {
  a: number; b: number; events: MomentEvent[]; tracks: Set<number>; key: number;
  /** the longest pass in the moment, metres (null when it holds no pass, or the length was not measured) */
  pass_length_m: number | null;
  /** ADR-131 v2.1: each event's own span (start/end from its row), in TIME order — `events` is score-ordered, so the chain
   *  label and the cross-match window are built from these spans, never from `a`/`b` (whose 4 s / 5 s buffers plus the
   *  possession-spell extension are single-match timing, not cross-match timing) */
  spans: { event: MomentEvent; start_us: number; end_us: number }[];
}

/**
 * The player's events (ADR-043) on the given tracks, from one video's latest finished ball track, in match time — the
 * per-video form of the reel builder's eventMoments (ReelsService keeps a reel-based wrapper over this, for the existing
 * single-match moments endpoint, unchanged in ranking and behaviour). `trackNumbers` maps each track to its number.
 */
export async function eventMomentsForVideo(db: Db, videoId: string, tracks: string[], trackNumbers: Map<string, number>, dur: number,
    orgId: string): Promise<VideoEventMoment[]> {
  if (!tracks.length) return [];
  const bt = await db.one<RowDataPacket>(
    "SELECT id FROM ball_tracks WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1", [videoId, orgId]);
  if (!bt) return [];
  const mt = await matchWindows(db, videoId);
  const ph = tracks.map(() => "?").join(",");
  const rows = await db.rows<RowDataPacket>(
    `SELECT e.event_type, e.start_pts_us, e.end_pts_us, e.primary_track_id, e.secondary_track_id, JSON_EXTRACT(e.features, '$.key') AS is_key,
            JSON_EXTRACT(e.features, '$.regain') AS regain, JSON_UNQUOTE(JSON_EXTRACT(e.features, '$.kind')) AS sp_kind,
            JSON_UNQUOTE(JSON_EXTRACT(e.features, '$.set_piece')) AS g_sp, JSON_UNQUOTE(JSON_EXTRACT(e.features, '$.set_piece_taker')) AS g_sp_taker,
            JSON_EXTRACT(e.features, '$.length_m') AS length_m
       FROM event_candidates e
      WHERE e.ball_track_id = ? AND e.event_type IN ('PASS', 'POSSESSION_CHANGE', 'PRESSURE', 'SHOT', 'TACKLE', 'INTERCEPTION', 'SET_PIECE', 'GOAL')
        AND (e.primary_track_id IN (${ph}) OR e.secondary_track_id IN (${ph})) AND NOT EXISTS (SELECT 1 FROM event_decisions ed WHERE ed.event_id = e.id AND ed.decision = 'REJECT' AND ed.decided_at = (SELECT MAX(ed2.decided_at) FROM event_decisions ed2 WHERE ed2.event_id = e.id)) ORDER BY e.start_pts_us`, [bt.id, ...tracks, ...tracks]);
  // the rule's possible kind of a ball won (ADR-041): its row has the same start, the winner first
  const how = new Map(rows.filter((r) => r.event_type === "TACKLE" || r.event_type === "INTERCEPTION")
    .map((r) => [`${r.start_pts_us}|${r.primary_track_id}`, r.event_type as "TACKLE" | "INTERCEPTION"]));
  const yes = (x: unknown) => x === true || x === "true" || x === 1;
  const out: { a: number; b: number; events: MomentEvent[]; tracks: Set<number>; at: [MomentEvent, number][]; key: number; pass_length_m: number | null; spans: { event: MomentEvent; start_us: number; end_us: number }[] }[] = [];
  for (const r of rows) {
    // a set piece's moment is its restart (the dead ball before it can be long): from 2 s before the kick
    const e = Number(r.end_pts_us), s = r.event_type === "SET_PIECE" ? Math.max(Number(r.start_pts_us), e - 2_000_000) : Number(r.start_pts_us);
    const mine = tracks.includes(r.primary_track_id), his = tracks.includes(r.secondary_track_id);
    if (r.event_type !== "GOAL" && !within(mt, s)) continue;            // a goal (the scoreboard changed) counts whatever the clock
    // what he did: the passer, the receiver, the one who won the ball, the presser, the shooter (losing the ball is not his highlight)
    const kind: MomentEvent | null = r.event_type === "PASS" ? (mine ? (yes(r.is_key) ? "KEY_PASS" : "PASS") : "PASS_RECEIVED")
      : r.event_type === "POSSESSION_CHANGE" ? (his ? (how.get(`${r.start_pts_us}|${r.secondary_track_id}`) ?? "BALL_WON") : null)
      : r.event_type === "TACKLE" || r.event_type === "INTERCEPTION" ? null
      : r.event_type === "SET_PIECE" ? (mine ? (SET_PIECE_MOMENT[r.sp_kind as string] ?? "SET_PIECE") : null)
      : r.event_type === "PRESSURE" ? (mine ? (yes(r.regain) ? "PRESSURE_REGAIN" : "PRESSURE") : null)
      // ADR-049: the possible scorer (last on the ball before the scoreboard changed); he took the free kick / penalty just before: that kind of goal
      : r.event_type === "GOAL" ? (mine ? (r.g_sp_taker === r.primary_track_id && r.g_sp === "FREE_KICK" ? "FREE_KICK_GOAL"
        : r.g_sp_taker === r.primary_track_id && r.g_sp === "PENALTY" ? "PENALTY_GOAL" : "GOAL") : null)
      : mine ? "SHOT" : null;
    if (!kind) continue;
    // a goal's own span is already the attack and the celebration
    const a = Math.max(0, r.event_type === "GOAL" ? s : s - EVENT_BEFORE_US), b = Math.min(dur, r.event_type === "GOAL" ? e : e + EVENT_AFTER_US);
    if (a >= b) continue;                                                      // outside the video
    const t = trackNumbers.get(mine ? r.primary_track_id : r.secondary_track_id);
    // E4 (ADR-067): when the event itself happens: the kick of a set piece, the middle of a goal's span, else its start
    const at = Math.min(b, Math.max(a, r.event_type === "SET_PIECE" ? e : r.event_type === "GOAL" ? (s + e) / 2 : Number(r.start_pts_us)));
    // ADR-131: a pass's measured length, for the long-pass tier (null = not measured: never a long pass)
    const len = kind === "PASS" && r.length_m !== null && r.length_m !== undefined && r.length_m !== "null" ? Number(r.length_m) : null;
    const last = out[out.length - 1];
    if (last && a - last.b <= EVENT_JOIN_US && b - last.a <= EVENT_MAX_US) {
      last.b = Math.max(last.b, b); last.events.push(kind); last.at.push([kind, at]); last.spans.push({ event: kind, start_us: s, end_us: e });
      if (t !== undefined) last.tracks.add(t);
      if (len !== null) last.pass_length_m = Math.max(last.pass_length_m ?? 0, len);
    } else out.push({ a, b, events: [kind], tracks: new Set(t === undefined ? [] : [t]), at: [[kind, at]], key: at, pass_length_m: len,
      spans: [{ event: kind, start_us: s, end_us: e }] });
  }
  // his own spells on the ball: a moment that ends while he has it runs on until he has played it
  const spells = await db.rows<RowDataPacket>(
    `SELECT start_pts_us, end_pts_us FROM event_candidates WHERE ball_track_id = ? AND event_type = 'POSSESSION' AND primary_track_id IN (${ph})
      ORDER BY start_pts_us`, [bt.id, ...tracks]);
  for (const m of out) {
    for (const sp of spells) {
      const sa = Number(sp.start_pts_us), sb = Number(sp.end_pts_us);
      if (sa > m.b) break;
      if (sb + SPELL_AFTER_US > m.b && sa <= m.b) m.b = Math.min(dur, m.a + EVENT_MAX_US, Math.max(m.b, sb + SPELL_AFTER_US));
    }
  }
  for (let i = out.length - 1; i > 0; i--) {                                 // a moment that now reaches the next one joins it
    const p0 = out[i - 1]!, p1 = out[i]!;
    if (p1.a - p0.b <= EVENT_JOIN_US && p1.b - p0.a <= EVENT_MAX_US) {
      p0.b = Math.max(p0.b, p1.b); p0.events.push(...p1.events); p0.at.push(...p1.at); p0.spans.push(...p1.spans); p1.tracks.forEach((t) => p0.tracks.add(t));
      if (p1.pass_length_m !== null) p0.pass_length_m = Math.max(p0.pass_length_m ?? 0, p1.pass_length_m);
      out.splice(i, 1);
    }
  }
  for (const m of out) {
    m.events.sort((x, y) => EVENT_SCORE[y] - EVENT_SCORE[x]);
    // the key time: his best event's; for a goal, his shot inside it when there is one (the goal's span runs on to the celebration)
    const best = [...m.at].sort((x, y) => EVENT_SCORE[y[0]] - EVENT_SCORE[x[0]] || x[1] - y[1])[0]!;
    const shot = best[0].endsWith("GOAL") ? m.at.filter(([k]) => k === "SHOT").sort((x, y) => y[1] - x[1])[0] : undefined;
    m.key = Math.round((shot ?? best)[1]);
  }
  return out;
}

export interface ConfirmedTarget { trackId: string; decisionId: string; number: number }

/** One video where the player has confirmed tracks: the video, its title and project, and his current targets in it. */
export interface ConfirmedVideo {
  video_id: string; title: string; project_id: string; run_id: string;
  trackIds: string[]; trackNumbers: Map<string, number>; targets: ConfirmedTarget[];
}

interface MatchFacts {
  home: string | null; away: string | null; competition: string | null; kickoff_at: string | null;
  clockConfirmed: boolean; first: [number, number] | null; second: [number, number] | null;
  /** the club that is not the player's in that match (null when it is not known) */
  opponent: string | null;
}

@Injectable()
export class CrossMatchService {
  constructor(private readonly db: Db, @Inject(HeatZonesService) private readonly heat: HeatZonesService,
              @Inject(PlayersService) private readonly players: PlayersService) {}

  /** The player as `p` may see him, registered (his permanent OTSI Player ID issued) — a cross-match reel only follows a
   *  registered player: the same PIN must identify him in every match. */
  async requireRegisteredPlayer(playerId: string, p: Principal) {
    const identity = await this.players.identity(playerId, p);
    if (identity.canonical_state !== "REGISTERED" && identity.canonical_state !== "RETIRED")
      throw new ApiError(409, "PLAYER_NOT_REGISTERED", "Register the player first: a cross-match reel follows one OTSI Player ID across every match, and this player has none yet.");
    return identity;
  }

  /** The player's tracks CONFIRMED in one video's latest finished run, with their numbers and the decisions to pin
   *  (the same rule as a single-match reel). */
  async confirmedTargets(videoId: string, playerId: string, p: Principal) {
    const run = await this.db.one<RowDataPacket>(
      "SELECT id FROM pipeline_runs WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY finished_at DESC, created_at DESC LIMIT 1",
      [videoId, p.organizationId]);
    if (!run) return { runId: null as string | null, targets: [] as ConfirmedTarget[] };
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT ci.track_id, ci.decision_id, t.internal_track_number FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id
        WHERE t.run_id = ? AND ci.state = 'CONFIRMED' AND ci.player_id = ?`, [run.id, playerId]);
    const targets: ConfirmedTarget[] = rows.map((r) => ({ trackId: r.track_id as string, decisionId: r.decision_id as string, number: Number(r.internal_track_number) }));
    return { runId: run.id as string, targets };
  }

  /** Every analysed video where the player has confirmed tracks (oldest first), with his current targets in each. */
  async confirmedVideos(playerId: string, p: Principal): Promise<ConfirmedVideo[]> {
    const videos = await this.db.rows<RowDataPacket>(
      `SELECT DISTINCT t.video_id, v.title, v.project_id, v.created_at FROM v_track_current_identity ci
         JOIN tracks t ON t.id = ci.track_id JOIN pipeline_runs r ON r.id = t.run_id
         JOIN video_sources v ON v.id = t.video_id AND v.removed_at IS NULL
        WHERE ci.player_id = ? AND ci.state = 'CONFIRMED' AND r.organization_id = ? AND r.status = 'SUCCEEDED' AND t.class_name = 'PERSON'
        ${videoNotHidden(p, "t.video_id")} ORDER BY v.created_at`,
      [playerId, p.organizationId]);
    const out: ConfirmedVideo[] = [];
    for (const v of videos) {
      const { runId, targets } = await this.confirmedTargets(String(v.video_id), playerId, p);
      if (!runId || !targets.length) continue;                              // confirmed in an older run only: the latest run superseded it
      out.push({ video_id: String(v.video_id), title: String(v.title ?? "Video"), project_id: String(v.project_id), run_id: runId,
        trackIds: targets.map((t) => t.trackId), trackNumbers: new Map(targets.map((t) => [t.trackId, t.number])), targets });
    }
    return out;
  }

  /** A video's match facts (ADR-044: what the overlays can show) and the match minute at a media time, or null where the halves
   *  were not confirmed by a person (the minute is never invented). */
  async matchFacts(videoId: string, playerId: string, p: Principal): Promise<MatchFacts> {
    const m = await this.db.one<RowDataPacket>(
      `SELECT m.id, m.competition, m.kickoff_at, h.canonical_name AS home, a.canonical_name AS away
         FROM video_sources v JOIN matches m ON m.id = v.match_id AND m.organization_id = v.organization_id
         LEFT JOIN clubs h ON h.id = m.home_club_id LEFT JOIN clubs a ON a.id = m.away_club_id
        WHERE v.id = ? AND v.organization_id = ?`, [videoId, p.organizationId]);
    const per = await this.db.one<RowDataPacket>("SELECT * FROM match_periods WHERE video_id = ? AND organization_id = ?", [videoId, p.organizationId]);
    const club = m && playerId ? await this.db.one<RowDataPacket>(
      "SELECT c.canonical_name FROM match_rosters r JOIN clubs c ON c.id = r.club_id WHERE r.match_id = ? AND r.player_id = ?", [m.id, playerId]) : null;
    const confirmed = per?.state === "CONFIRMED";
    const home = (m?.home as string | null) ?? null, away = (m?.away as string | null) ?? null;
    const mine = (club?.canonical_name as string | null) ?? null;
    return {
      home, away, competition: (m?.competition as string | null) ?? null,
      kickoff_at: m?.kickoff_at ? new Date(m.kickoff_at as string | Date).toISOString() : null,
      clockConfirmed: confirmed,
      first: confirmed ? [Number(per.first_start_us), Number(per.first_end_us)] : null,
      second: confirmed && per.second_start_us !== null ? [Number(per.second_start_us), Number(per.second_end_us)] : null,
      opponent: !mine ? null : mine === home ? away : mine === away ? home : null,
    };
  }

  /** The match minute at a media time (clamped to 45 / 90 like a broadcast clock), or null where the halves are not CONFIRMED. */
  matchMinute(facts: MatchFacts, ptsUs: number): number | null {
    if (!facts.clockConfirmed) return null;
    if (facts.first && ptsUs >= facts.first[0] && ptsUs < facts.first[1])
      return Math.min(45, 1 + Math.floor((ptsUs - facts.first[0]) / 60_000_000));
    if (facts.second && ptsUs >= facts.second[0] && ptsUs < facts.second[1])
      return Math.min(90, 46 + Math.floor((ptsUs - facts.second[0]) / 60_000_000));
    return null;
  }

  private async videoDuration(videoId: string): Promise<number> {
    const v = await this.db.one<RowDataPacket>("SELECT duration_us FROM video_sources WHERE id = ?", [videoId]);
    return Number(v?.duration_us ?? 0) || Number.MAX_SAFE_INTEGER;
  }

  /** Every candidate moment of his across all his videos (event moments + sprint moments), before selection. */
  async gather(playerId: string, p: Principal): Promise<CrossMatchCandidate[]> {
    const videos = await this.confirmedVideos(playerId, p);
    if (!videos.length)
      throw new ApiError(409, "NO_CONFIRMED_TRACKS", "Confirm the player on at least one track of one video first; a cross-match reel only follows confirmed identities.");
    return this.gatherCandidates(videos, playerId, p);
  }

  async gatherCandidates(videos: ConfirmedVideo[], playerId: string, p: Principal): Promise<CrossMatchCandidate[]> {
    const out: CrossMatchCandidate[] = [];
    for (const v of videos) {
      const dur = await this.videoDuration(v.video_id);
      const facts = await this.matchFacts(v.video_id, playerId, p);
      const base = { video_id: v.video_id, video_title: v.title, home: facts.home, away: facts.away, competition: facts.competition,
        kickoff_at: facts.kickoff_at, opponent: facts.opponent };
      for (const m of await eventMomentsForVideo(this.db, v.video_id, v.trackIds, v.trackNumbers, dur, p.organizationId)) {
        // ADR-131 v2.1: the cross-match window is built from the moment's own event spans (3.0 s before the first event's
        // start, 2.5 s after the last event's end, clamped 4–12 s) — never from the moment's `a`/`b`, whose 4 s / 5 s buffers
        // plus the possession-spell extension are single-match timing. A merged group IS the chain: its label is the sequence
        // in time order, from the spans.
        const first = m.spans[0]!, lastSpan = m.spans[m.spans.length - 1]!;
        const w = crossMatchClipWindow(first.start_us, lastSpan.end_us, dur);
        const isChain = m.spans.length >= 2;
        out.push(CrossMatchCandidate.parse({ ...base, match_minute: this.matchMinute(facts, m.key), in_pts_us: w.in_pts_us, out_pts_us: w.out_pts_us,
          key_at_us: m.key, events: m.events, pass_length_m: m.pass_length_m, sprint: null, label: eventLabel(m.events), dedupe_key: m.events[0] ?? "NONE",
          is_chain: isChain, sequence_label: isChain ? crossMatchChainLabel(m.spans.map((s) => s.event), m.pass_length_m) : null }));
      }
      // sprint moments: his measured runs (positionsOf + movementOf — only where the pitch was calibrated), each a candidate
      // window from the run, 3.0 s before it to 2.5 s after it, clamped 4–12 s like an event moment; the tier rule checks it
      // against his top speed in this match
      const { points, seen } = await this.heat.positionsOf(v.video_id, v.trackIds);
      const movement = movementOf(points, seen);
      for (const run of movement.runs.filter((r) => r.sprint)) {
        const w = crossMatchClipWindow(run.start_us, run.end_us, dur);
        if (w.in_pts_us >= w.out_pts_us) continue;
        const top = Math.round(run.top_kmh * 10) / 10;
        out.push(CrossMatchCandidate.parse({ ...base, match_minute: this.matchMinute(facts, run.start_us), in_pts_us: w.in_pts_us, out_pts_us: w.out_pts_us,
          key_at_us: run.start_us, events: [], pass_length_m: null, sprint: { top_kmh: top, match_top_speed_kmh: movement.top_speed_kmh },
          label: `Sprint — ${top} km/h`, dedupe_key: "SPRINT", is_chain: false, sequence_label: null }));
      }
    }
    return out;
  }

  /** His line (GK / DEF / MID / FWD) for the position promotion (ADR-131 §5, v2.1): the same way playerreport.ts does it
   *  (lineOf) — the latest team sheet's position first, then the Players list's recorded usual position, confirmed roles
   *  only; null when neither is recorded, and then no promotion applies. */
  async positionGroup(playerId: string, p: Principal): Promise<PositionGroup | null> {
    const profile = await playerProfile(this.db, playerId, p.organizationId);
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

  /** ADR-131 v2.1: a hand-added clip on a cross-match reel must be a best moment. Its window must hold the decisive touch
   *  (key_at_us) of a tier-assigned candidate of that video — a VISIBLE stretch, a set piece, a plain short pass or any other
   *  ineligible moment has no tier-assigned candidate, so it is refused with INELIGIBLE_MOMENT (409). The per-match cap is
   *  enforced too (Tier S immune, as in the selection): an existing clip of the video counts against it unless it is itself
   *  a Tier S moment; an existing clip matching no tier-assigned candidate counts, conservatively. The length cap is already
   *  enforced by checkClip before this runs. Single-match addClip never comes here. */
  async checkPin(playerId: string, videoId: string, inUs: number, outUs: number,
      existing: { in_pts_us: number; out_pts_us: number }[], lengthS: CrossMatchLength, p: Principal): Promise<void> {
    const group = await this.positionGroup(playerId, p);
    const videos = await this.confirmedVideos(playerId, p);
    const video = videos.find((v) => v.video_id === videoId);
    const candidates = video ? await this.gatherCandidates([video], playerId, p) : [];
    const rank: Record<CrossMatchTier, number> = { S: 0, A: 1, B: 2, C: 3 };
    const tierIn = (a: number, b: number): CrossMatchTier | null => {
      let best: CrossMatchTier | null = null;
      for (const c of candidates) {
        if (c.key_at_us < a || c.key_at_us > b) continue;
        const cls = tierOfCandidate(c, group);
        if (cls.tier && (best === null || rank[cls.tier] < rank[best])) best = cls.tier;
      }
      return best;
    };
    const tier = tierIn(inUs, outUs);
    if (!tier)
      throw new ApiError(409, "INELIGIBLE_MOMENT", "That clip is not one of his best moments: a cross-match clip must hold the decisive touch of a tier-assigned moment (a goal, a shot, a key pass, a tackle, a sprint) — not a visible stretch, a set piece or a plain pass.");
    if (tier !== "S") {
      const cap = CROSS_MATCH_PER_MATCH_CAPS[lengthS];
      let nonS = 0;
      for (const cl of existing) if (tierIn(cl.in_pts_us, cl.out_pts_us) !== "S") nonS++;
      if (nonS >= cap)
        throw new ApiError(409, "PER_MATCH_CAP_REACHED", `That match already has ${cap} moments in this ${lengthS}-second reel (Tier S excepted): a cross-match reel shows breadth across matches.`);
    }
  }

  /** The selection for a player: registered, >= 1 confirmed track, else 409 (do not return another player's moments). */
  async selection(playerId: string, lengthS: CrossMatchLength, p: Principal): Promise<CrossMatchSelection> {
    await this.requireRegisteredPlayer(playerId, p);
    const candidates = await this.gather(playerId, p);
    const group = await this.positionGroup(playerId, p);
    return CrossMatchSelection.parse({ player_id: playerId, ...selectCrossMatchMoments(candidates, lengthS, group) });
  }

  /**
   * The selection for a cross-match reel: the player's selection at the reel's stored length, with the moments a person
   * rejected for this reel taken out (listed last, "rejected for this reel", as single-match moments list them) and in_reel
   * marked from the reel's clips. Single-match reels never come here (their moments are ReelMoment[]).
   */
  async selectionForReel(reel: Reel, p: Principal): Promise<CrossMatchSelection> {
    if (reel.source !== "ALL_MATCHES" || !reel.player) throw new ApiError(409, "NOT_CROSS_MATCH", "This reel follows one match: its moments are the single-match suggestions.");
    const lengthS = (reel.cross_match_length_s ?? 180) as CrossMatchLength;
    const candidates = await this.gather(reel.player.player_id, p);
    const rejections = (await this.db.rows<RowDataPacket>(
      "SELECT video_id, in_pts_us, out_pts_us FROM reel_moment_rejections WHERE reel_id = ?", [reel.id]))
      .map((r) => ({ video_id: r.video_id as string | null, in_pts_us: Number(r.in_pts_us), out_pts_us: Number(r.out_pts_us) }));
    const kept: CrossMatchCandidate[] = [];
    const rejected: CrossMatchCandidate[] = [];
    for (const c of candidates) {
      // a rejection with a video only rejects that video's moments (a NULL-video row is a single-match reel's, and never lands here)
      const windows = rejections.filter((w) => w.video_id === c.video_id);
      if (isRejected(windows, c.in_pts_us, c.out_pts_us)) rejected.push(c); else kept.push(c);
    }
    const sel = selectCrossMatchMoments(kept, lengthS, await this.positionGroup(reel.player.player_id, p));
    const inReel = (c: CrossMatchCandidate) => reel.clips.some((cl) => cl.source_video_id === c.video_id && cl.in_pts_us < c.out_pts_us && cl.out_pts_us > c.in_pts_us);
    return CrossMatchSelection.parse({
      player_id: reel.player.player_id,
      ...sel,
      selected: sel.selected.map((m) => ({ ...m, in_reel: inReel(m) })),
      // rejected ones last, still listed (as single-match moments do)
      not_selected: [...sel.not_selected, ...rejected.map((c) => ({ candidate: c, reason: "rejected for this reel" as const }))],
    });
  }
}

@Controller("v1/players")
@UseGuards(AuthGuard)
export class CrossMatchController {
  constructor(private readonly crossMatch: CrossMatchService) {}

  @Get(":playerId/cross-match-moments")
  async moments(@Param("playerId") id: string, @Query("length_s") lengthS: string | undefined, @CurrentPrincipal() p: Principal) {
    const length = lengthS === undefined ? 180 : Number(lengthS);
    if (length !== 90 && length !== 180 && length !== 300)
      throw new ApiError(400, "BAD_LENGTH", "length_s is 90, 180 or 300 seconds.");
    return this.crossMatch.selection(uuidParam(id, "Player"), length as CrossMatchLength, p);
  }
}

