/**
 * Team identity, shirt-number evidence and combined identity candidates (Block 07, ADR-033).
 *
 *   GET  /v1/analysis-runs/:id/kit-groups                    the run's kit colour groups and the match teams they can be assigned to
 *   POST /v1/analysis-runs/:id/kit-groups/:group/assignment  a person says which match team a kit group is (or "not a team": referees,
 *                                                            staff); append-only, a correction supersedes and needs a reason
 *   GET  /v1/tracks/:id/jersey                               the track's shirt-number evidence: frames read, alternatives, a person's verdict
 *   POST /v1/tracks/:id/jersey-decisions                     a person confirms the number, or marks it unreadable (append-only)
 *   GET  /v1/tracks/:id/candidates                           players this track may show, each with the evidence for and against it
 *   GET  /v1/analysis-runs/:id/named-players                 the players named on the run's tracks (count and one track each)
 *   GET  /v1/analysis-runs/:id/number-proposals              tracks the engine can name from a shirt number + the match roster (ADR-039),
 *                                                            for a person to accept in bulk (each acceptance is an identity decision)
 *
 * Nothing here decides an identity. A colour group is not a team until a person assigns it; a shirt number is clothing, looked up in the
 * match roster; look-alike tracks are appearance evidence. Candidates are suggestions for the person who makes the identity decision
 * (POST /v1/tracks/:id/identity-decisions). A missed identification is better than a wrong one: candidates with a conflict are demoted,
 * never hidden, and the conflict is shown.
 */
import { Body, Controller, Get, HttpCode, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { IdentityCandidate, JerseyDecisionRequest, JerseyEvidence, NamedPlayers, NumberProposals, RunTeams, TeamAssignmentRequest, TrackCandidates } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db, Executor } from "../../core/db";
import { ApiError, fromDatabase, notFound } from "../../core/problem";
import { matchWindows, overlaps } from "../analysis/match-time";
import { uuidParam } from "../players/players.controller";

const j = <T>(v: unknown, d: T): T => (v === null || v === undefined ? d : typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

/** Signal weights. Independent sources combine as 1 - prod(1 - w); appearance sources are correlated, so only the strongest counts. */
const W = {
  numberConfirmed: 0.6, numberRecognized: 0.45, numberUncertain: 0.2,
  unverifiedRoster: 0.5,                 // multiplier: an unverified roster is weaker evidence
  team: 0.15, confirmedLink: 0.8, suggestedLink: 0.35, lookAlike: 0.2,
  conflictPenalty: 0.25,
};

interface Acc { player_id: string; display_name: string; canonical_otsi_id: string | null; number: number; team: number; link: number; appearance: number;
  signals: { kind: string; detail: string; weight: number }[]; conflicts: string[] }

@Injectable()
export class IdentityEvidenceService {
  constructor(private readonly db: Db) {}

  private async run(runId: string, p: Principal, ex: Executor = this.db.pool): Promise<RowDataPacket> {
    const r = await this.db.one<RowDataPacket>(
      `SELECT r.id, v.match_id, m.home_club_id, m.away_club_id FROM pipeline_runs r JOIN video_sources v ON v.id = r.video_id
         LEFT JOIN matches m ON m.id = v.match_id WHERE r.id = ? AND r.organization_id = ?`, [runId, p.organizationId], ex);
    if (!r) throw notFound("Analysis run");
    return r;
  }

  private async track(trackId: string, p: Principal, ex: Executor = this.db.pool, lock = false): Promise<RowDataPacket> {
    const t = await this.db.one<RowDataPacket>(
      `SELECT t.id, t.run_id, t.internal_track_number, t.first_pts_us, t.last_pts_us, ta.kit_group, v.match_id
         FROM tracks t JOIN pipeline_runs r ON r.id = t.run_id JOIN video_sources v ON v.id = r.video_id
         LEFT JOIN track_appearance ta ON ta.track_id = t.id
        WHERE t.id = ? AND r.organization_id = ?${lock ? " FOR UPDATE" : ""}`, [trackId, p.organizationId], ex);
    if (!t) throw notFound("Track");
    return t;
  }

  async kitGroups(runId: string, p: Principal): Promise<RunTeams> {
    const r = await this.run(runId, p);
    const teams = r.match_id
      ? await this.db.rows<RowDataPacket>("SELECT id, canonical_name, short_name, created_by_organization_id FROM clubs WHERE id IN (?, ?) ORDER BY id = ? DESC",
          [r.home_club_id, r.away_club_id, r.home_club_id])
      : [];
    const verified = r.match_id
      ? await this.db.one<RowDataPacket>("SELECT COUNT(*) AS n, SUM(roster_verified) AS v FROM match_rosters WHERE match_id = ?", [r.match_id])
      : null;
    const groups = await this.db.rows<RowDataPacket>(
      `SELECT ta.kit_group, COUNT(*) AS tracks,
              (SELECT x.kit_rgb FROM track_appearance x WHERE x.run_id = ta.run_id AND x.kit_group = ta.kit_group AND x.kit_rgb IS NOT NULL
                GROUP BY x.kit_rgb ORDER BY COUNT(*) DESC, x.kit_rgb LIMIT 1) AS kit_rgb,
              a.assignment_id, a.club_id, c.canonical_name
         FROM track_appearance ta LEFT JOIN v_run_team_current a ON a.run_id = ta.run_id AND a.kit_group = ta.kit_group
         LEFT JOIN clubs c ON c.id = a.club_id
        WHERE ta.run_id = ? AND ta.kit_group IS NOT NULL GROUP BY ta.kit_group, a.assignment_id, a.club_id, c.canonical_name ORDER BY ta.kit_group`, [runId]);
    // typical people of each group: the 40 longest-followed tracks with a picture, then 8 of them spread over time (the first tracks of a
    // broadcast are often the studio, the crowd or other matches' highlights, not this match's players)
    const vid = await this.db.one<RowDataPacket>("SELECT video_id FROM pipeline_runs WHERE id = ?", [runId]);
    const mt = vid ? await matchWindows(this.db, String(vid.video_id)) : null;
    const long = (await this.db.rows<RowDataPacket>(
      `SELECT kit_group, id, first_pts_us, last_pts_us, observation_count FROM (
         SELECT ta.kit_group, t.id, t.first_pts_us, t.last_pts_us, t.observation_count, ROW_NUMBER() OVER (PARTITION BY ta.kit_group ORDER BY t.observation_count DESC, t.id) AS k
           FROM tracks t JOIN track_appearance ta ON ta.track_id = t.id
          WHERE t.run_id = ? AND ta.kit_group IS NOT NULL AND ta.thumbnail_asset_id IS NOT NULL AND t.class_name = 'PERSON') x
        WHERE k <= 200 ORDER BY kit_group, first_pts_us`, [runId]))
      .filter((x) => overlaps(mt, Number(x.first_pts_us), Number(x.last_pts_us)));          // typical players of the match, not of the programme
    const samples = new Map<number, string[]>();
    for (const g of new Set(long.map((x) => Number(x.kit_group)))) {
      const l = long.filter((x) => Number(x.kit_group) === g).sort((a, b) => Number(b.observation_count) - Number(a.observation_count)).slice(0, 40)
        .sort((a, b) => Number(a.first_pts_us) - Number(b.first_pts_us));                      // the 40 longest-followed, then in time order
      const pick = l.length <= 8 ? l : Array.from({ length: 8 }, (_, i) => l[Math.floor((i + 0.5) * l.length / 8)]!);
      samples.set(g, pick.map((x) => String(x.id)));
    }
    return RunTeams.parse({
      run_id: runId, match_id: r.match_id ?? null,
      teams: teams.map((c) => ({ id: c.id, name: c.canonical_name, short_name: c.short_name ?? null, shared: c.created_by_organization_id !== p.organizationId })),
      roster_verified: !!verified && Number(verified.n) > 0 && Number(verified.v) === Number(verified.n),
      groups: groups.map((g) => ({ kit_group: Number(g.kit_group), kit_rgb: g.kit_rgb ?? null, tracks: Number(g.tracks), sample_track_ids: samples.get(Number(g.kit_group)) ?? [],
        assignment: g.assignment_id ? { assignment_id: g.assignment_id, club_id: g.club_id ?? null, club_name: g.canonical_name ?? null } : null })),
    });
  }

  async namedPlayers(runId: string, p: Principal): Promise<NamedPlayers> {
    await this.run(runId, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT ci.player_id, pi.display_name, pi.canonical_otsi_id, COUNT(*) AS tracks, MIN(t.id) AS track_id
         FROM tracks t JOIN v_track_current_identity ci ON ci.track_id = t.id AND ci.state = 'CONFIRMED' JOIN v_player_identity pi ON pi.player_id = ci.player_id
        WHERE t.run_id = ? GROUP BY ci.player_id, pi.display_name, pi.canonical_otsi_id ORDER BY pi.display_name`, [runId]);
    return NamedPlayers.parse(rows.map((r) => ({ player_id: r.player_id, display_name: r.display_name, canonical_otsi_id: r.canonical_otsi_id ?? null, tracks: Number(r.tracks), track_id: r.track_id })));
  }

  async numberProposals(runId: string, p: Principal): Promise<NumberProposals> {
    const r = await this.run(runId, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT t.id, t.internal_track_number, t.first_pts_us, t.last_pts_us, ta.kit_group, ta.thumbnail_asset_id,
              d.state AS d_state, d.number AS d_number, e.state AS e_state, e.number AS e_number, e.confidence AS e_conf,
              rt.assignment_id, rt.club_id AS kit_club, COALESCE(ci.state, 'UNRESOLVED') AS identity_state, ci.player_id AS decided_player
         FROM tracks t
         LEFT JOIN track_appearance ta ON ta.track_id = t.id
         LEFT JOIN v_track_jersey_current d ON d.track_id = t.id
         LEFT JOIN track_jersey_evidence e ON e.track_id = t.id AND e.state IN ('RECOGNIZED', 'UNCERTAIN')
         LEFT JOIN v_run_team_current rt ON rt.run_id = t.run_id AND rt.kit_group = ta.kit_group
         LEFT JOIN v_track_current_identity ci ON ci.track_id = t.id
        WHERE t.run_id = ? AND t.class_name = 'PERSON' AND ((d.state = 'CONFIRMED') OR (d.track_id IS NULL AND e.track_id IS NOT NULL))
        ORDER BY t.first_pts_us`, [runId]);
    const roster = r.match_id ? await this.db.rows<RowDataPacket>(
      `SELECT mr.club_id, mr.jersey_number, mr.player_id, pi.display_name, pi.canonical_otsi_id, c.canonical_name
         FROM match_rosters mr JOIN v_player_identity pi ON pi.player_id = mr.player_id JOIN clubs c ON c.id = mr.club_id
        WHERE mr.match_id = ? AND mr.jersey_number IS NOT NULL`, [r.match_id]) : [];
    const kits = await this.db.one<RowDataPacket>(
      `SELECT COUNT(DISTINCT ta.kit_group) AS n FROM track_appearance ta LEFT JOIN v_run_team_current rt ON rt.run_id = ta.run_id AND rt.kit_group = ta.kit_group
        WHERE ta.run_id = ? AND ta.kit_group IS NOT NULL AND rt.assignment_id IS NULL`, [runId]);
    const vid = await this.db.one<RowDataPacket>("SELECT video_id FROM pipeline_runs WHERE id = ?", [runId]);
    const mt = vid ? await matchWindows(this.db, String(vid.video_id)) : null;
    const out: NumberProposals["proposals"] = [];
    for (const x of rows) {
      if (x.identity_state === "CONFIRMED") continue;                                       // already somebody
      if (!overlaps(mt, Number(x.first_pts_us), Number(x.last_pts_us))) continue;           // outside match time (programme, studio)
      const num = String(x.d_state === "CONFIRMED" ? x.d_number : x.e_number);
      const source = x.d_state === "CONFIRMED" ? "CONFIRMED" : (x.e_state as "RECOGNIZED" | "UNCERTAIN");
      const wearing = roster.filter((m) => String(m.jersey_number) === num);
      let hit: RowDataPacket | undefined, from: "KIT" | "ROSTER" | null = null, note: string | null = null;
      if (x.assignment_id && x.kit_club === null) { note = "This kit is not a team (referee, staff)."; }
      else if (x.kit_club) { hit = wearing.find((m) => m.club_id === x.kit_club); from = "KIT"; if (!hit) note = `No. ${num} is not on this team's roster.`; }
      else if (wearing.length === 1) { hit = wearing[0]; from = "ROSTER"; note = "Team not known from the kit: only one team has this number."; }
      else note = wearing.length ? `Both teams have a No. ${num}: say which kit is which team first.` : `No. ${num} is not on the roster.`;
      if (hit && x.identity_state === "REJECTED" && x.decided_player === hit.player_id) { hit = undefined; note = "A person said this track is not him."; }
      out.push({ track_id: x.id, track_number: Number(x.internal_track_number), first_pts_us: Number(x.first_pts_us), last_pts_us: Number(x.last_pts_us),
        has_thumbnail: !!x.thumbnail_asset_id, shirt: { number: num, source, confidence: x.e_conf === null || x.e_conf === undefined ? null : Number(x.e_conf) },
        team: hit ? { club_id: hit.club_id, name: hit.canonical_name, from: from! } : null,
        player: hit ? { player_id: hit.player_id, display_name: hit.display_name, canonical_otsi_id: hit.canonical_otsi_id ?? null } : null,
        note, accept: !!hit && from === "KIT" && source !== "UNCERTAIN" });
    }
    // one person cannot be on screen twice: proposals of the same player that overlap in time are all left unticked
    for (const a of out) {
      if (!a.player) continue;
      const clash = out.find((b) => b !== a && b.player?.player_id === a.player!.player_id && b.first_pts_us <= a.last_pts_us && b.last_pts_us >= a.first_pts_us);
      if (clash) { a.accept = false; a.note = `On screen at the same time as track ${clash.track_number}, also read as No. ${a.shirt.number}: one of them is misread.`; }
    }
    return NumberProposals.parse({ run_id: runId, match_id: r.match_id ?? null, kits_unassigned: Number(kits?.n ?? 0), proposals: out });
  }

  async assignTeam(runId: string, group: number, body: TeamAssignmentRequest, p: Principal): Promise<RunTeams> {
    try {
      await this.db.tx(async (c) => {
        const r = await this.run(runId, p, c);
        if (body.club_id !== null) {
          if (!r.match_id) throw new ApiError(409, "NO_MATCH", "Link this video to a match first: a kit group can only be one of the match's two teams.");
          if (![r.home_club_id, r.away_club_id].includes(body.club_id)) throw new ApiError(422, "CLUB_NOT_IN_MATCH", "That club does not play in this match.");
        }
        const [g] = await c.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM track_appearance WHERE run_id = ? AND kit_group = ?", [runId, group]);
        if (Number(g[0]?.n ?? 0) === 0) throw notFound("Kit group");
        await c.query("SELECT id FROM pipeline_runs WHERE id = ? FOR UPDATE", [runId]);              // serialise decisions on this run
        const [cur] = await c.query<RowDataPacket[]>("SELECT assignment_id, club_id FROM v_run_team_current WHERE run_id = ? AND kit_group = ?", [runId, group]);
        if ((cur[0]?.assignment_id ?? null) !== (body.supersedes_id ?? null)) {
          throw new ApiError(409, "STALE_DECISION", "Someone assigned this kit group meanwhile; reload and decide again.");
        }
        if (body.club_id !== null) {
          const [other] = await c.query<RowDataPacket[]>("SELECT kit_group FROM v_run_team_current WHERE run_id = ? AND club_id = ? AND kit_group <> ?", [runId, body.club_id, group]);
          if (other[0]) throw new ApiError(409, "TEAM_ALREADY_ASSIGNED", `Kit group ${Number(other[0].kit_group) + 1} is already this team; change that one first.`);
        }
        const id = uuidv7();
        await c.query("INSERT INTO run_team_assignments (id, run_id, kit_group, club_id, decided_by, reason, supersedes_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [id, runId, group, body.club_id, p.userId, body.reason, body.supersedes_id]);
        const payload = { run_id: runId, kit_group: group, club_id: body.club_id, assignment_id: id, supersedes_id: body.supersedes_id };
        await recordChange(c, userActor(p), { action: "run.team_assigned", entityType: "pipeline_run", entityId: runId, after: payload,
          before: cur[0] ? { assignment_id: cur[0].assignment_id, club_id: cur[0].club_id } : null,
          event: { eventType: "run.team_assigned", payload, dedupeKey: `team-assign:${id}` } });
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw fromDatabase(e) ?? e;
    }
    return this.kitGroups(runId, p);
  }

  async jersey(trackId: string, p: Principal): Promise<JerseyEvidence> {
    await this.track(trackId, p);
    const e = await this.db.one<RowDataPacket>("SELECT * FROM track_jersey_evidence WHERE track_id = ?", [trackId]);
    const d = await this.db.one<RowDataPacket>("SELECT decision_id, state, number FROM v_track_jersey_current WHERE track_id = ?", [trackId]);
    if (!e && !d) throw new ApiError(404, "NOT_MEASURED", "No shirt-number reading exists for this track (the analysis did not read numbers).");
    return JerseyEvidence.parse({
      track_id: trackId, state: e?.state ?? "UNREADABLE", number: e?.number ?? null, confidence: e?.confidence === null || e?.confidence === undefined ? null : Number(e.confidence),
      side: e?.side ?? "UNKNOWN", candidate_frames: Number(e?.candidate_frames ?? 0),
      frames: j<{ pts_us: number; number: string | null; confidence: number; texts?: string[] }[]>(e?.frame_reads, []).map((f) => ({ pts_us: Number(f.pts_us), number: f.number ?? null,
        confidence: Number(f.confidence), texts: f.texts ?? [] })),
      alternatives: j<{ number: string; frames: number; confidence: number }[]>(e?.alternatives, []),
      decision: d ? { decision_id: d.decision_id, state: d.state, number: d.number ?? null } : null,
    });
  }

  async decideJersey(trackId: string, body: JerseyDecisionRequest, p: Principal): Promise<JerseyEvidence> {
    try {
      await this.db.tx(async (c) => {
        await this.track(trackId, p, c, true);
        const [cur] = await c.query<RowDataPacket[]>("SELECT decision_id, state, number FROM v_track_jersey_current WHERE track_id = ?", [trackId]);
        if ((cur[0]?.decision_id ?? null) !== (body.supersedes_id ?? null)) {
          throw new ApiError(409, "STALE_DECISION", "Someone decided on this shirt number meanwhile; reload and decide again.");
        }
        const id = uuidv7();
        await c.query("INSERT INTO jersey_number_decisions (id, track_id, number, state, decided_by, reason, supersedes_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [id, trackId, body.state === "CONFIRMED" ? body.number : null, body.state, p.userId, body.reason, body.supersedes_id]);
        const payload = { track_id: trackId, decision_id: id, state: body.state, number: body.number, supersedes_id: body.supersedes_id };
        await recordChange(c, userActor(p), { action: "track.jersey_decided", entityType: "track", entityId: trackId, after: payload,
          before: cur[0] ? { decision_id: cur[0].decision_id, state: cur[0].state, number: cur[0].number } : null,
          event: { eventType: "track.jersey_decided", payload, dedupeKey: `jersey:${id}` } });
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw fromDatabase(e) ?? e;
    }
    return this.jersey(trackId, p);
  }

  async candidates(trackId: string, p: Principal): Promise<TrackCandidates> {
    const t = await this.track(trackId, p);
    const matchId: string | null = t.match_id ?? null;
    const acc = new Map<string, Acc>();
    const get = (r: RowDataPacket): Acc => {
      let a = acc.get(r.player_id);
      if (!a) {
        a = { player_id: r.player_id, display_name: r.display_name, canonical_otsi_id: r.canonical_otsi_id ?? null, number: 0, team: 0, link: 0, appearance: 0, signals: [], conflicts: [] };
        acc.set(r.player_id, a);
      }
      return a;
    };

    // the track's team: only from a person's kit-group assignment (colour similarity alone is not a team)
    const teamRow = t.kit_group === null || t.kit_group === undefined ? null : await this.db.one<RowDataPacket>(
      `SELECT a.club_id, c.canonical_name, c.short_name, c.created_by_organization_id FROM v_run_team_current a LEFT JOIN clubs c ON c.id = a.club_id
        WHERE a.run_id = ? AND a.kit_group = ?`, [t.run_id, t.kit_group]);
    const teamId: string | null = teamRow?.club_id ?? null;
    const notATeam = !!teamRow && teamRow.club_id === null;

    // the shirt number: a person's confirmation wins; else the engine's multi-frame reading
    const dec = await this.db.one<RowDataPacket>("SELECT state, number FROM v_track_jersey_current WHERE track_id = ?", [trackId]);
    const ev = dec ? null : await this.db.one<RowDataPacket>("SELECT state, number FROM track_jersey_evidence WHERE track_id = ? AND state IN ('RECOGNIZED', 'UNCERTAIN')", [trackId]);
    const shirt = dec?.state === "CONFIRMED" ? { number: String(dec.number), source: "CONFIRMED" as const }
      : ev ? { number: String(ev.number), source: ev.state as "RECOGNIZED" | "UNCERTAIN" } : null;

    if (matchId && shirt && !notATeam) {
      const rows = await this.db.rows<RowDataPacket>(
        `SELECT r.player_id, r.club_id, r.roster_verified, r.jersey_number, pi.display_name, pi.canonical_otsi_id, c.canonical_name AS club_name
           FROM match_rosters r JOIN v_player_identity pi ON pi.player_id = r.player_id JOIN clubs c ON c.id = r.club_id
          WHERE r.match_id = ? AND r.jersey_number = ? AND pi.own_state NOT IN ('MERGED', 'RETIRED')`, [matchId, Number(shirt.number)]);
      const base = shirt.source === "CONFIRMED" ? W.numberConfirmed : shirt.source === "RECOGNIZED" ? W.numberRecognized : W.numberUncertain;
      for (const r of rows) {
        const a = get(r);
        const w = base * (r.roster_verified ? 1 : W.unverifiedRoster);
        a.number = Math.max(a.number, w);
        a.signals.push({ kind: "SHIRT_NUMBER", weight: w, detail: `No. ${shirt.number} (${shirt.source === "CONFIRMED" ? "confirmed by a person" : shirt.source === "RECOGNIZED" ? "read in several frames" : "uncertain reading"}) is ${r.display_name}'s number for ${r.club_name} in this match${r.roster_verified ? "" : " — roster not verified"}` });
        if (teamId && r.club_id !== teamId) a.conflicts.push(`This track's kit group is ${teamRow!.canonical_name}, but ${r.display_name} plays for ${r.club_name}.`);
        else if (teamId) { a.team = W.team; a.signals.push({ kind: "TEAM", weight: W.team, detail: `Kit group assigned to ${r.club_name}` }); }
      }
    }

    // other tracks of the same run: confirmed links (same person, confirmed by a person) and suggested links, to CONFIRMED tracks
    const links = await this.db.rows<RowDataPacket>(
      `SELECT c.state, c.score, o.internal_track_number, pi.player_id, pi.display_name, pi.canonical_otsi_id
         FROM v_track_link_current c JOIN tracks o ON o.id = IF(c.track_a_id = ?, c.track_b_id, c.track_a_id)
         JOIN v_track_current_identity ci ON ci.track_id = o.id AND ci.state = 'CONFIRMED'
         JOIN v_player_identity pi ON pi.player_id = ci.player_id
        WHERE (c.track_a_id = ? OR c.track_b_id = ?) AND c.state IN ('CONFIRMED', 'PROPOSED')`, [trackId, trackId, trackId]);
    for (const l of links) {
      const a = get(l);
      if (l.state === "CONFIRMED") {
        a.link = W.confirmedLink;
        a.signals.push({ kind: "CONFIRMED_LINK", weight: W.confirmedLink, detail: `A person confirmed this is the same person as track ${l.internal_track_number}, identified as ${l.display_name}` });
      } else {
        const w = W.suggestedLink * Number(l.score);
        a.appearance = Math.max(a.appearance, w);
        a.signals.push({ kind: "SUGGESTED_LINK", weight: w, detail: `Looks like the same person as track ${l.internal_track_number} (${l.display_name}), suggested, not confirmed` });
      }
    }
    const near = await this.db.rows<RowDataPacket>(
      `SELECT n.cosine, o.internal_track_number, pi.player_id, pi.display_name, pi.canonical_otsi_id
         FROM track_neighbours n JOIN tracks o ON o.id = n.neighbour_id
         JOIN v_track_current_identity ci ON ci.track_id = o.id AND ci.state = 'CONFIRMED'
         JOIN v_player_identity pi ON pi.player_id = ci.player_id
        WHERE n.track_id = ? ORDER BY n.rank_no`, [trackId]);
    for (const n of near) {
      const a = get(n);
      const w = W.lookAlike * Math.max(0, Number(n.cosine));
      if (w <= a.appearance) continue;                                      // correlated with suggested links: keep only the strongest
      a.appearance = w;
      a.signals = a.signals.filter((s) => s.kind !== "LOOK_ALIKE");
      a.signals.push({ kind: "LOOK_ALIKE", weight: w, detail: `Resembles track ${n.internal_track_number}, identified as ${n.display_name} (appearance only)` });
    }

    // a player confirmed on a track that overlaps this one in time cannot be this track as well
    if (acc.size) {
      const ids = [...acc.keys()];
      const busy = await this.db.rows<RowDataPacket>(
        `SELECT ci.player_id, o.internal_track_number FROM tracks o JOIN v_track_current_identity ci ON ci.track_id = o.id AND ci.state = 'CONFIRMED'
          WHERE o.run_id = ? AND o.id <> ? AND o.first_pts_us <= ? AND o.last_pts_us >= ? AND ci.player_id IN (${ids.map(() => "?").join(",")})`,
        [t.run_id, trackId, t.last_pts_us, t.first_pts_us, ...ids]);
      for (const b of busy) acc.get(b.player_id)?.conflicts.push(`Already identified on track ${b.internal_track_number}, which is on screen at the same time.`);
    }

    const out = [...acc.values()].map((a) => {
      let s = 1 - [a.number, a.team, a.link, a.appearance].reduce((m, w) => m * (1 - w), 1);
      if (a.conflicts.length) s *= W.conflictPenalty;
      for (const c of a.conflicts) a.signals.push({ kind: "CONFLICT", weight: 0, detail: c });
      return IdentityCandidate.parse({ player_id: a.player_id, display_name: a.display_name, canonical_otsi_id: a.canonical_otsi_id,
        strength: Math.round(Math.min(0.99, s) * 1000) / 1000, signals: a.signals, conflicts: a.conflicts });
    }).sort((x, y) => y.strength - x.strength).slice(0, 10);

    return TrackCandidates.parse({
      track_id: trackId, match_id: matchId,
      team: teamRow?.club_id ? { id: teamRow.club_id, name: teamRow.canonical_name, short_name: teamRow.short_name ?? null, shared: teamRow.created_by_organization_id !== p.organizationId } : null,
      shirt_number: shirt, candidates: out,
    });
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class IdentityEvidenceController {
  constructor(private readonly ev: IdentityEvidenceService) {}

  @Get("analysis-runs/:runId/kit-groups")
  groups(@Param("runId") id: string, @CurrentPrincipal() p: Principal) { return this.ev.kitGroups(uuidParam(id, "Analysis run"), p); }

  @Post("analysis-runs/:runId/kit-groups/:group/assignment")
  @HttpCode(201)
  @Roles("OWNER", "ADMIN", "ANALYST")
  assign(@Param("runId") id: string, @Param("group") group: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.ev.assignTeam(uuidParam(id, "Analysis run"), z.coerce.number().int().min(0).max(9).parse(group), TeamAssignmentRequest.parse(body), p);
  }

  @Get("tracks/:trackId/jersey")
  jersey(@Param("trackId") id: string, @CurrentPrincipal() p: Principal) { return this.ev.jersey(uuidParam(id, "Track"), p); }

  @Post("tracks/:trackId/jersey-decisions")
  @HttpCode(201)
  @Roles("OWNER", "ADMIN", "ANALYST")
  decideJersey(@Param("trackId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.ev.decideJersey(uuidParam(id, "Track"), JerseyDecisionRequest.parse(body), p);
  }

  @Get("analysis-runs/:runId/named-players")
  namedPlayers(@Param("runId") id: string, @CurrentPrincipal() p: Principal) { return this.ev.namedPlayers(uuidParam(id, "Analysis run"), p); }

  @Get("analysis-runs/:runId/number-proposals")
  numberProposals(@Param("runId") id: string, @CurrentPrincipal() p: Principal) { return this.ev.numberProposals(uuidParam(id, "Analysis run"), p); }

  @Get("tracks/:trackId/candidates")
  candidates(@Param("trackId") id: string, @CurrentPrincipal() p: Principal) { return this.ev.candidates(uuidParam(id, "Track"), p); }
}
