/**
 * Reel Builder (Blocks 10-11, ADR-032): a person makes a player's highlight reel by clicking; the engine suggests and renders.
 *
 *   POST   /v1/reels                         create a reel for a CONFIRMED player of a video (targets pin the exact identity decisions);
 *                                           source ALL_MATCHES: one player, ALL his matches (ADR-131) — video_id absent, length_s 90/180/300
 *   GET    /v1/players/:id/cross-match-moments   the player's best moments across all his matches (ADR-131; in cross-match.ts)
 *   GET    /v1/reels?video_id=               the organization's reels (of one video)
 *   GET    /v1/reels/:id                     reel: player, targets (current or stale), clips, latest render
 *   PATCH  /v1/reels/:id                     name, aspect, spotlight settings (optimistic concurrency: version)
 *   POST   /v1/reels/:id/duplicate           a copy of the reel (Library Duplicate): same video, player, pinned identity decisions, settings and clips;
 *                                           renders, share links and notes are not copied; the audit keeps which reel it came from
 *   POST   /v1/renders/clear-finished        Export "Clear All": finished renders leave the queue (the render and its file stay)
 *   POST   /v1/reels/:id/refresh-targets     re-pin the player's currently CONFIRMED tracks (after identity corrections)
 *   GET    /v1/reels/:id/moments             suggestions: the player's events on his confirmed tracks in match time, ranked (ADR-043),
 *                                           then stretches where he is visible and no event was detected
 *   POST   /v1/reels/:id/clips               add a clip (in/out on the source media clock)
 *   PATCH  /v1/reels/:id/clips/:clipId       trim
 *   PATCH  /v1/reels/:id/clips/:clipId/effect  slow motion, freeze frame or hero ramp (E2, ADR-065)
 *   DELETE /v1/reels/:id/clips/:clipId       remove
 *   DELETE /v1/reels/:id/clips                remove every clip
 *   POST   /v1/reels/:id/clips/add-moments   add every suggested moment not yet in the reel, in match order, up to 10 minutes
 *   POST   /v1/reels/:id/candidates          E4 (ADR-067): up to three draft reels from a length and a theme (nothing is changed)
 *   POST   /v1/reels/:id/assemble            E4: the reel's clips become one draft's (replace: true when it has clips)
 *   PATCH  /v1/reels/:id/clips/:clipId/fx    E5 (ADR-068): a clip's keyframed zoom and telestration
 *   GET    /v1/reels/:id/review-comments     E5: what reviewers wrote through the share links of the reel's renders, with times
 *   POST   /v1/reels/:id/clips/order         reorder
 *   PATCH  /v1/reels/:id/transitions         set or remove the transition into one clip (ADR-055; TRANSITION track of timeline_items)
 *   POST   /v1/reels/:id/renders             render the reel (refused while stale or empty); event reel.render_requested -> RENDER job
 *   GET    /v1/renders/:id                   render job with the worker's progress and measured result
 *   POST   /v1/renders/:id/cancel            stop a queued or running render (the worker drops it within seconds; nothing is kept)
 *   GET    /v1/renders/:id/playback          short-lived signed URLs to watch and to download the rendered file
 *
 * Renders are development / testing output: commercial distribution and paid export are not activated (owner decisions E1-E3, ADR-030).
 */
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  AddClipRequest, AssembleRequest, BEST_MOMENTS_RULE_VERSION, ClipFx, ReviewComment, SetClipFxRequest, CandidatesRequest, CandidatesResponse, buildCandidates, type AssembledClip, CreateReelRequest, CreateRenderRequest, CrossMatchLength, CrossMatchMomentWindowRequest, CrossMatchSelection, crossMatchClipLabel, selectCrossMatchMoments, Reel, ReelMoment, ReelPath, RenderJob, ReorderClipsRequest, SetClipEffectRequest, SetTransitionRequest, SpotlightSettings,
  BoundarySuggestion, suggestBoundary, UpdateClipRequest, UpdateReelRequest, clipOutputUs, slotUs, BatchRenderRequest, BatchRenderResult, Preflight, preflightChecks, outputAspect, uniqueOutputs, SetAllTransitionsRequest, transitionsForAll, normaliseEffect, type ClipEffect, EXPORT_PROFILES, ExportProfile, isRejected, momentCoverage, SwapClipRequest, TOKEN_COSTS,
} from "@otsi-vie/contracts";
import { createHash } from "node:crypto";
import { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { recordEdit, snapshot } from "./edit-state";
import { playerProfile } from "../players/players.service";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { notHidden } from "../../core/access";
import { Db, Executor } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { AnalysisService } from "../analysis/analysis";
import { WalletService } from "../wallet/wallet";
import { CrossMatchService, EVENT_SCORE, eventLabel, eventMomentsForVideo } from "./cross-match";
import { ProfileIntroService } from "../profileintro/profileintro";
import { BrandService, rightsOk } from "./brand";
import { matchWindows, within } from "../analysis/match-time";
import { idempotencyKey, uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

const MAX_CLIP_US = 60_000_000;
const MAX_REEL_US = 10 * 60_000_000;
/** a reel_clips row's speed effect (E2, ADR-065) */
/** E5 (ADR-068): a clip row's zoom and drawings (none when NULL or unreadable) */
const fxOf = (r: RowDataPacket): ClipFx => { const v = json<unknown>(r.clip_fx); const p = ClipFx.safeParse(v ?? {}); return p.success ? p.data : { zoom: [], drawings: [], gap_ms: 0, gain_db: 0 }; };
const effectOf = (r: RowDataPacket): ClipEffect => ({ kind: (r.effect_kind ?? "NONE") as ClipEffect["kind"], at_us: r.effect_at_us === null || r.effect_at_us === undefined ? null : Number(r.effect_at_us),
  speed: Number(r.playback_speed ?? 1), hold_ms: Number(r.effect_hold_ms ?? 0) });                                        // owner 2026-11-02: 10 minutes (was 5)
const MOMENT_PAD_US = 1_000_000;
const MOMENT_MERGE_US = 1_500_000;
const MOMENT_MAX_US = 12_000_000;
const MOMENT_MIN_US = 3_000_000;
/** an event moment: from 4 s before the event (the build-up) to 5 s after it (the outcome: a long ball is still in the air at 3 s); events
 * up to 3 s apart are one moment (a reception and his pass after it), up to 20 s; while he still has the ball at the end, the moment runs
 * until 3 s after his spell on the ball ends - never cut just before he plays it (owner 2026-11-02: "about to make a long pass and the
 * engine abruptly cuts the clip") */
const EVENT_BEFORE_US = 4_000_000;
const EVENT_AFTER_US = 5_000_000;
const EVENT_JOIN_US = 3_000_000;
const EVENT_MAX_US = 20_000_000;
const SPELL_AFTER_US = 3_000_000;
/** a stretch where he is on camera and the engine found no action of his: said plainly, and never written on the reel as an event tag
 * (owner 2026-11-02: "Chinazom Godwin visible ... I have no clue what that means") */
export const VISIBLE_LABEL = "On camera, no action found";
const isVisibleLabel = (l: string | null) => !!l && (l === VISIBLE_LABEL || / visible \d+(\.\d)? s$/.test(l));   // and the older wording
// EVENT_SCORE, EVENT_WORDS and eventLabel live in ./cross-match now (the per-video eventMoments moved there with them);
// this file keeps the reel-based wrapper over it, for the existing single-match moments endpoint.
function json<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

const LOGOS = [["competition_logo_id", "COMPETITION_LOGO"], ["custom_logo_id", "CUSTOM_LOGO"], ["music_id", "MUSIC"], ["intro_id", "REEL_VIDEO"], ["outro_id", "REEL_VIDEO"]] as const;

/** B.21 (ADR-096): a saved clip as stored in a block: the reel_clips columns that make it what it is */
export interface BlockClipRow { in_pts_us: number; out_pts_us: number; label: string | null; origin: string; playback_speed: number; effect_kind: string;
  effect_at_us: number | null; effect_hold_ms: number; clip_fx: unknown }

@Injectable()
export class ReelsService {
  constructor(private readonly db: Db, @Inject(AnalysisService) private readonly analysis: AnalysisService, @Inject(BrandService) private readonly brand: BrandService,
              @Inject(ProfileIntroService) private readonly intro: ProfileIntroService,
              @Inject(CrossMatchService) private readonly crossMatch: CrossMatchService,
              @Inject(WalletService) private readonly wallet: WalletService) {}

  /** ADR-131: a reel's length cap in microseconds — a cross-match reel's chosen length, else 10 minutes as today. */
  private capUs(r: RowDataPacket): number {
    return r.source === "ALL_MATCHES" ? Number(r.cross_match_length_s ?? 180) * 1_000_000 : MAX_REEL_US;
  }
  private capWords(r: RowDataPacket): string {
    if (r.source !== "ALL_MATCHES") return "10 minutes";
    const s = Number(r.cross_match_length_s ?? 180);
    return s === 90 ? "90 seconds" : s === 180 ? "3 minutes" : "5 minutes";
  }

  /** ADR-044: what the overlays can show — the video's match (team names, competition), the halves (a clock only when a person confirmed
   * them) and the player's club in the match roster. Nothing here is measured from the picture, and the score is never shown. */
  private async overlayFacts(videoId: string, playerId: string | null, p: Principal, ex: Executor = this.db.pool) {
    const m = await this.db.one<RowDataPacket>(
      `SELECT m.id, m.competition, m.kickoff_at, m.venue, h.canonical_name AS home, h.short_name AS home_short, a.canonical_name AS away, a.short_name AS away_short
         FROM video_sources v JOIN matches m ON m.id = v.match_id AND m.organization_id = v.organization_id
         LEFT JOIN clubs h ON h.id = m.home_club_id LEFT JOIN clubs a ON a.id = m.away_club_id
        WHERE v.id = ? AND v.organization_id = ?`, [videoId, p.organizationId], ex);
    const per = await this.db.one<RowDataPacket>("SELECT * FROM match_periods WHERE video_id = ? AND organization_id = ?", [videoId, p.organizationId], ex);
    const club = m && playerId ? await this.db.one<RowDataPacket>(
      "SELECT c.id, c.canonical_name, r.jersey_number, r.position, r.role, r.captain FROM match_rosters r JOIN clubs c ON c.id = r.club_id WHERE r.match_id = ? AND r.player_id = ?", [m.id, playerId], ex) : null;
    const confirmed = per?.state === "CONFIRMED";
    return {
      match: m ? { home: (m.home as string | null) ?? null, away: (m.away as string | null) ?? null, competition: (m.competition as string | null) ?? null,
        clock: confirmed ? "CONFIRMED" as const : per ? "PROPOSED" as const : "NONE" as const } : null,
      short: m ? { home: (m.home_short ?? m.home ?? null) as string | null, away: (m.away_short ?? m.away ?? null) as string | null } : null,
      periods: confirmed ? { first: [Number(per.first_start_us), Number(per.first_end_us)], second: per.second_start_us === null ? null : [Number(per.second_start_us), Number(per.second_end_us)] } : null,
      player_club: (club?.canonical_name as string | undefined) ?? null,
      roster: m && club ? { match_id: m.id as string, club_id: club.id as string, team: club.canonical_name as string, jersey_number: club.jersey_number === null ? null : Number(club.jersey_number),
        position: (club.position as string | null) ?? null, role: club.role as string, captain: !!Number(club.captain) } : null,
      /** ADR-050: the match card's date (the kick-off's day) and venue */
      card: m ? { date: m.kickoff_at ? String(m.kickoff_at).slice(0, 10) : null, venue: (m.venue as string | null) ?? null } : null,
    };
  }

  /** a logo a reel shows (or its music, ADR-047) must be this organization's, of the right kind, not retired, with its rights grant in force */
  private async checkLogos(settings: SpotlightSettings, p: Principal, ex?: Executor) {
    const out: Record<string, string | null> = {};
    for (const [field, kind] of LOGOS) {
      const id = settings[field];
      if (!id) { out[field] = null; continue; }
      const r = await this.brand.row(id, p.organizationId, ex).catch(() => null);
      const what = kind === "MUSIC" ? "music" : kind === "REEL_VIDEO" ? "video" : "logo";
      if (!r || r.kind !== kind) throw new ApiError(422, kind === "MUSIC" ? "MUSIC_NOT_FOUND" : kind === "REEL_VIDEO" ? "VIDEO_NOT_FOUND" : "LOGO_NOT_FOUND", `That ${what} does not exist here (or was removed). Choose another.`);
      if (!rightsOk(r)) throw new ApiError(409, "BRAND_RIGHTS_MISSING", `The rights to use "${r.name as string}" in reels are not in force. Choose another ${what} or upload it again with a rights declaration.`);
      out[field] = r.object_key as string;
    }
    return out;
  }

  private async reelRow(id: string, p: Principal, ex: Executor = this.db.pool, lock = false): Promise<RowDataPacket> {
    const r = await this.db.one<RowDataPacket>(`SELECT * FROM reel_projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL${lock ? " FOR UPDATE" : ""}`, [id, p.organizationId], ex);
    if (!r) throw notFound("Reel");
    return r;
  }

  /** The player's tracks CONFIRMED in the video's latest finished run, with the decision to pin. */
  private async confirmedTargets(videoId: string, playerId: string, p: Principal, ex: Executor = this.db.pool) {
    const run = await this.db.one<RowDataPacket>(
      "SELECT id FROM pipeline_runs WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY finished_at DESC, created_at DESC LIMIT 1",
      [videoId, p.organizationId], ex);
    if (!run) throw new ApiError(409, "NO_ANALYSIS", "Analyse the video before making a reel.");
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT ci.track_id, ci.decision_id FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id
        WHERE t.run_id = ? AND ci.state = 'CONFIRMED' AND ci.player_id = ?`, [run.id, playerId], ex);
    return { runId: run.id as string, targets: rows.map((r) => ({ trackId: r.track_id as string, decisionId: r.decision_id as string })) };
  }

  async create(body: CreateReelRequest, p: Principal): Promise<Reel> {
    if (body.source === "ALL_MATCHES") return this.createCrossMatch(body, p);
    // the contract's superRefine requires video_id for MATCH; this narrows it for the compiler
    const videoId = body.video_id;
    if (!videoId) throw new ApiError(422, "INVALID_REQUEST", "video_id is required for a single-match reel.");
    const v = await this.db.one<RowDataPacket>("SELECT project_id, title FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [videoId, p.organizationId]);
    if (!v) throw notFound("Video");
    const player = await this.db.one<RowDataPacket>(
      "SELECT display_name, own_state, created_by_organization_id FROM v_player_identity WHERE player_id = ?", [body.player_id]);
    if (!player || (player.own_state === "PROVISIONAL" && player.created_by_organization_id !== p.organizationId)) throw notFound("Player");
    const { runId, targets } = await this.confirmedTargets(videoId, body.player_id, p);
    if (targets.length === 0) throw new ApiError(409, "NO_CONFIRMED_TRACKS", "Confirm the player on at least one track of this video first; a reel only follows confirmed identities.");
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query(`INSERT INTO reel_projects (id, organization_id, project_id, video_id, player_id, run_id, name, created_by, settings)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, p.organizationId, v.project_id, videoId, body.player_id, runId, body.name ?? `${player.display_name} — highlights`, p.userId, JSON.stringify(SpotlightSettings.parse({}))]);
      for (const t of targets) {
        await c.query("INSERT INTO reel_targets (reel_id, track_id, player_id, identity_decision_id) VALUES (?, ?, ?, ?)", [id, t.trackId, body.player_id, t.decisionId]);
      }
      await recordChange(c, userActor(p), {
        action: "reel.created", entityType: "reel", entityId: id, after: { video_id: videoId, player_id: body.player_id, targets: targets.length },
        event: { eventType: "reel.created", payload: { reel_id: id } },
      });
    });
    return this.get(id, p);
  }

  /** ADR-131: a cross-match reel — one player, ALL his matches. Targets pin his confirmed tracks in every video; the selection's
   *  chosen clips go in, in tier order, each with its real source video and its match + minute + reason label; the Player Profile
   *  Intro opens it exactly as a single-match reel (settings default profile_intro true). Fewer than 3 eligible moments: build
   *  with what's there, no filler. The reel lives in the project of his most recent analysed video. */
  private async createCrossMatch(body: CreateReelRequest, p: Principal): Promise<Reel> {
    const identity = await this.crossMatch.requireRegisteredPlayer(body.player_id, p);
    const videos = await this.crossMatch.confirmedVideos(body.player_id, p);
    if (!videos.length) throw new ApiError(409, "NO_CONFIRMED_TRACKS", "Confirm the player on at least one track of one video first; a cross-match reel only follows confirmed identities.");
    const lengthS = body.length_s ?? 180;
    const selection = selectCrossMatchMoments(await this.crossMatch.gatherCandidates(videos, body.player_id, p), lengthS,
      await this.crossMatch.positionGroup(body.player_id, p));
    const targets = videos.reduce((n, v) => n + v.trackIds.length, 0);
    const id = uuidv7();
    const latest = videos[videos.length - 1]!;
    await this.db.tx(async (c) => {
      await c.query(`INSERT INTO reel_projects (id, organization_id, project_id, video_id, player_id, run_id, name, created_by, settings, source, cross_match_length_s, best_moments_rule_version)
                     VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, 'ALL_MATCHES', ?, ?)`,
        [id, p.organizationId, latest.project_id, body.player_id, body.name ?? `${identity.display_name} — best moments (all matches)`, p.userId,
         JSON.stringify(SpotlightSettings.parse({})), lengthS, BEST_MOMENTS_RULE_VERSION]);
      for (const v of videos) {
        for (const t of v.targets) {
          await c.query("INSERT INTO reel_targets (reel_id, track_id, player_id, identity_decision_id) VALUES (?, ?, ?, ?)",
            [id, t.trackId, body.player_id, t.decisionId]);
        }
      }
      for (const [i, m] of selection.selected.entries()) {
        await c.query("INSERT INTO reel_clips (id, reel_id, source_video_id, in_pts_us, out_pts_us, sequence_index, origin, label) VALUES (?, ?, ?, ?, ?, ?, 'SUGGESTED', ?)",
          [uuidv7(), id, m.video_id, m.in_pts_us, m.out_pts_us, i, crossMatchClipLabel(m, m.tier, m.reason)]);
      }
      await recordChange(c, userActor(p), {
        action: "reel.created", entityType: "reel", entityId: id,
        after: { source: "ALL_MATCHES", player_id: body.player_id, videos: videos.length, targets, length_s: lengthS,
          best_moments_rule_version: BEST_MOMENTS_RULE_VERSION, clips: selection.selected.length },
        event: { eventType: "reel.created", payload: { reel_id: id } },
      });
    });
    return this.get(id, p);
  }

  async list(videoId: string | undefined, p: Principal): Promise<Reel[]> {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT id FROM reel_projects WHERE organization_id = ?${videoId ? " AND video_id = ?" : ""}${notHidden(p, "project_id")} AND removed_at IS NULL ORDER BY updated_at DESC LIMIT 100`,
      videoId ? [p.organizationId, videoId] : [p.organizationId]);
    return Promise.all(rows.map((r) => this.get(r.id as string, p)));
  }

  async get(id: string, p: Principal): Promise<Reel> {
    const r = await this.reelRow(id, p);
    const player = r.player_id ? await this.db.one<RowDataPacket>("SELECT player_id, display_name, canonical_otsi_id FROM v_player_identity WHERE player_id = ?", [r.player_id]) : null;
    const targets = await this.db.rows<RowDataPacket>(
      `SELECT rt.track_id, t.internal_track_number, t.first_pts_us, t.last_pts_us,
              (ci.decision_id = rt.identity_decision_id AND ci.state = 'CONFIRMED' AND ci.player_id = rt.player_id) AS current
         FROM reel_targets rt JOIN tracks t ON t.id = rt.track_id LEFT JOIN v_track_current_identity ci ON ci.track_id = rt.track_id
        WHERE rt.reel_id = ? ORDER BY t.first_pts_us`, [id]);
    const clips = await this.db.rows<RowDataPacket>(
      "SELECT id, sequence_index, source_video_id, in_pts_us, out_pts_us, origin, label, effect_kind, effect_at_us, effect_hold_ms, playback_speed, clip_fx FROM reel_clips WHERE reel_id = ? ORDER BY sequence_index", [id]);
    const render = await this.db.one<RowDataPacket>("SELECT id FROM render_jobs WHERE reel_id = ? AND organization_id = ? AND removed_at IS NULL ORDER BY created_at DESC LIMIT 1", [id, p.organizationId]);
    const goods = await this.db.rows<RowDataPacket>("SELECT id FROM render_jobs WHERE reel_id = ? AND organization_id = ? AND state = 'SUCCEEDED' AND removed_at IS NULL ORDER BY completed_at DESC LIMIT 5", [id, p.organizationId]);
    const latest = render ? await this.render(render.id as string, p) : null;
    let good: RenderJob | null = null;
    for (const g of goods) {                                           // the newest finished render whose file is still there
      const j = g.id === latest?.id ? latest! : await this.render(g.id as string, p);
      if (j.has_output) { good = j; break; }
    }
    // E3 (ADR-066): the newest playable file of each export profile and frame
    const made = await this.db.rows<RowDataPacket>(
      `SELECT id, JSON_UNQUOTE(JSON_EXTRACT(config, '$.profile')) AS profile, JSON_UNQUOTE(JSON_EXTRACT(config, '$.aspect')) AS aspect,
              JSON_EXTRACT(result, '$.width') AS width, JSON_EXTRACT(result, '$.height') AS height, completed_at
         FROM render_jobs WHERE reel_id = ? AND organization_id = ? AND state = 'SUCCEEDED' AND removed_at IS NULL AND output_asset_id IS NOT NULL
        ORDER BY completed_at DESC LIMIT 30`, [id, p.organizationId]);
    const seen = new Set<string>(), formats: Reel["formats"] = [];
    for (const m of made) {
      const profile = ExportProfile.safeParse(m.profile ?? "REEL").success ? (m.profile ?? "REEL") as ExportProfile : "REEL";
      const aspect = (["16:9", "9:16", "1:1", "4:5"].includes(m.aspect) ? m.aspect : "16:9") as Reel["aspect"];
      if (seen.has(`${profile}|${aspect}`)) continue;
      seen.add(`${profile}|${aspect}`);
      formats.push({ render_id: m.id, profile, aspect, width: m.width === null ? null : Number(m.width), height: m.height === null ? null : Number(m.height),
        completed_at: m.completed_at ? new Date(m.completed_at).toISOString() : null });
    }
    const clipList = clips.map((c) => ({ id: c.id, sequence_index: Number(c.sequence_index), source_video_id: c.source_video_id as string, in_pts_us: Number(c.in_pts_us), out_pts_us: Number(c.out_pts_us), origin: c.origin, label: c.label,
      effect: effectOf(c), fx: fxOf(c) }));
    const firstClip = clipList[0]?.id;
    const transitions = (await this.transitionRows(id)).filter((t) => t.clip_id !== firstClip);
    // ADR-131: a cross-match reel has no single match — no match card, no team sheet of one match. player_roster is null, and the
    // web's existing fallback (PreviewPanel: player_roster ?? profile.latest_team) shows his latest team instead; player_club
    // likewise falls back to it.
    const profile = player ? await playerProfile(this.db, player.player_id as string, p.organizationId) : null;
    const facts = r.source === "ALL_MATCHES" ? null : await this.overlayFacts(r.video_id as string, (r.player_id as string | null) ?? null, p);
    return Reel.parse({
      match: facts?.match ?? null, player_club: facts?.player_club ?? profile?.latest_team?.team ?? null, player_roster: facts?.roster ?? null,
      id: r.id, name: r.name, status: r.status, version: Number(r.version), video_id: r.video_id ?? null,
      source: r.source ?? "MATCH", cross_match_length_s: r.cross_match_length_s ?? null, best_moments_rule_version: r.best_moments_rule_version ?? null,
      run_id: r.run_id,
      player: player ? { player_id: player.player_id, display_name: player.display_name, canonical_otsi_id: player.canonical_otsi_id,
        profile: profile ?? undefined } : null,
      aspect: r.aspect, settings: SpotlightSettings.parse(json<Record<string, unknown>>(r.settings) ?? {}),
      targets: targets.map((t) => ({ track_id: t.track_id, track_number: Number(t.internal_track_number), first_pts_us: Number(t.first_pts_us), last_pts_us: Number(t.last_pts_us), decision_current: !!Number(t.current) })),
      stale: targets.some((t) => !Number(t.current)), clips: clipList, transitions,
      duration_us: clipList.reduce((s, c) => s + slotUs(c), 0),         // B.19 (ADR-094): with the spacers
      latest_render: latest, last_good_render: good, formats,
      created_by: r.created_by ?? null, created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString(),
    });
  }

  async update(id: string, body: UpdateReelRequest, p: Principal): Promise<Reel> {
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);                       // B.1 (ADR-081): the edit history
      const r = await this.reelRow(id, p, c, true);
      if (Number(r.version) !== body.version) throw new ApiError(409, "STALE_VERSION", "Someone changed this reel meanwhile; reload and try again.");
      const settings = body.settings ? SpotlightSettings.parse({ ...(json<Record<string, unknown>>(r.settings) ?? {}), ...body.settings }) : null;
      if (settings) await this.checkLogos(settings, p, c);
      await c.query("UPDATE reel_projects SET name = ?, aspect = ?, settings = ? WHERE id = ?",
        [body.name ?? r.name, body.aspect ?? r.aspect, settings ? JSON.stringify(settings) : (typeof r.settings === "string" ? r.settings : JSON.stringify(r.settings)), id]);
      await recordChange(c, userActor(p), { action: "reel.updated", entityType: "reel", entityId: id, after: { name: body.name, aspect: body.aspect, settings } });
      await recordEdit(c, p, id, "reel.updated", body.settings ? "Changed the look" : body.aspect && body.aspect !== r.aspect ? `Frame ${body.aspect}` : "Renamed the reel", before);
    });
    return this.get(id, p);
  }

  /** ADR-055: the reel's transitions, each tied to the clip it leads into */
  private async transitionRows(reelId: string, ex: Executor = this.db.pool) {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT i.reel_clip_id, JSON_UNQUOTE(JSON_EXTRACT(i.parameters, '$.kind')) AS kind, i.duration_us
         FROM timeline_items i JOIN timeline_tracks t ON t.id = i.timeline_track_id
        WHERE t.reel_id = ? AND t.track_type = 'TRANSITION' AND i.reel_clip_id IS NOT NULL`, [reelId], ex);
    return rows.map((r) => ({ clip_id: r.reel_clip_id as string, kind: r.kind as Reel["transitions"][number]["kind"], duration_ms: Math.round(Number(r.duration_us) / 1000) }));
  }

  /** ADR-055. Set or remove the transition into one clip. The transition is drawn over that clip's start, so it may take at most half the clip. */
  async setTransition(id: string, body: SetTransitionRequest, p: Principal): Promise<Reel> {
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);                       // B.1 (ADR-081): the edit history
      await this.reelRow(id, p, c, true);
      const [cl] = await c.query<RowDataPacket[]>("SELECT id, sequence_index, in_pts_us, out_pts_us FROM reel_clips WHERE reel_id = ? ORDER BY sequence_index", [id]);
      const at = cl.findIndex((k) => k.id === body.clip_id);
      if (at < 0) throw notFound("Clip");
      let [tr] = await c.query<RowDataPacket[]>("SELECT id FROM timeline_tracks WHERE reel_id = ? AND track_type = 'TRANSITION' AND layer = 0", [id]);
      if (body.kind === null) {
        if (tr[0]) await c.query("DELETE FROM timeline_items WHERE timeline_track_id = ? AND reel_clip_id = ?", [tr[0].id, body.clip_id]);
      } else {
        if (at === 0) throw new ApiError(422, "FIRST_CLIP", "The first clip has no clip before it: a transition goes between two clips.");
        const len = Number(cl[at]!.out_pts_us) - Number(cl[at]!.in_pts_us);
        if (body.duration_ms * 1000 * 2 > len) throw new ApiError(422, "TRANSITION_TOO_LONG", `This clip is ${(len / 1e6).toFixed(1)} s long: a transition into it can take at most half of it.`);
        if (!tr[0]) {
          await c.query("INSERT INTO timeline_tracks (id, reel_id, track_type, layer) VALUES (?, ?, 'TRANSITION', 0)", [uuidv7(), id]);
          [tr] = await c.query<RowDataPacket[]>("SELECT id FROM timeline_tracks WHERE reel_id = ? AND track_type = 'TRANSITION' AND layer = 0", [id]);
        }
        await c.query(`INSERT INTO timeline_items (id, timeline_track_id, reel_clip_id, start_us, duration_us, parameters) VALUES (?, ?, ?, 0, ?, ?)
                       ON DUPLICATE KEY UPDATE duration_us = VALUES(duration_us), parameters = VALUES(parameters)`,
          [uuidv7(), tr[0]!.id, body.clip_id, body.duration_ms * 1000, JSON.stringify({ kind: body.kind })]);
      }
      await c.query("UPDATE reel_projects SET status = 'DRAFT' WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: body.kind ? "reel.transition_set" : "reel.transition_removed", entityType: "reel", entityId: id,
        after: { clip_id: body.clip_id, kind: body.kind, duration_ms: body.kind ? body.duration_ms : null } });
      await recordEdit(c, p, id, body.kind ? "reel.transition_set" : "reel.transition_removed", body.kind ? `Transition into clip ${at + 1}: ${body.kind.toLowerCase()}` : `Removed the transition into clip ${at + 1}`, before);
    });
    return this.get(id, p);
  }

  /** B.21 (ADR-096): one kind (or none) on every cut, as one change; a short clip gets the longest transition it can take, a clip after a
   *  gap none (it starts from black) */
  async setAllTransitions(id: string, body: SetAllTransitionsRequest, p: Principal): Promise<Reel> {
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);
      await this.reelRow(id, p, c, true);
      const [cl] = await c.query<RowDataPacket[]>("SELECT id, in_pts_us, out_pts_us, clip_fx FROM reel_clips WHERE reel_id = ? ORDER BY sequence_index", [id]);
      let [tr] = await c.query<RowDataPacket[]>("SELECT id FROM timeline_tracks WHERE reel_id = ? AND track_type = 'TRANSITION' AND layer = 0", [id]);
      if (!tr[0]) {
        await c.query("INSERT INTO timeline_tracks (id, reel_id, track_type, layer) VALUES (?, ?, 'TRANSITION', 0)", [uuidv7(), id]);
        [tr] = await c.query<RowDataPacket[]>("SELECT id FROM timeline_tracks WHERE reel_id = ? AND track_type = 'TRANSITION' AND layer = 0", [id]);
      }
      await c.query("DELETE FROM timeline_items WHERE timeline_track_id = ?", [tr[0]!.id]);
      const plan = transitionsForAll(cl.map((k) => ({ id: k.id as string, in_pts_us: Number(k.in_pts_us), out_pts_us: Number(k.out_pts_us), gap_ms: fxOf(k).gap_ms })), body.duration_ms);
      let n = 0;
      if (body.kind) for (const t of plan) {
        if (t.ms === null) continue;
        await c.query("INSERT INTO timeline_items (id, timeline_track_id, reel_clip_id, start_us, duration_us, parameters) VALUES (?, ?, ?, 0, ?, ?)",
          [uuidv7(), tr[0]!.id, t.clip_id, t.ms * 1000, JSON.stringify({ kind: body.kind })]);
        n++;
      }
      await c.query("UPDATE reel_projects SET status = 'DRAFT' WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: "reel.transitions_set_all", entityType: "reel", entityId: id, after: { kind: body.kind, duration_ms: body.duration_ms, cuts: n } });
      await recordEdit(c, p, id, "reel.transitions_set_all", body.kind ? `${body.kind.toLowerCase()} on ${n} cut${n === 1 ? "" : "s"}` : "Removed every transition", before);
    });
    return this.get(id, p);
  }

  /** B.21 (ADR-096): copies of saved clips (a block) put in before position `at` (null = at the end) of this reel, as one change */
  async insertClips(id: string, rows: BlockClipRow[], at: number | null, label: string, p: Principal): Promise<Reel> {
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);
      const r = await this.reelRow(id, p, c, true);
      if (r.source === "ALL_MATCHES")
        throw new ApiError(409, "CROSS_MATCH_SINGLE_VIDEO_ONLY", "A saved block holds clips of one video: a cross-match reel's clips each come from their own video (ADR-131).");
      const [cur] = await c.query<RowDataPacket[]>(
        "SELECT id, in_pts_us, out_pts_us, effect_kind, effect_at_us, effect_hold_ms, playback_speed, clip_fx FROM reel_clips WHERE reel_id = ? ORDER BY sequence_index FOR UPDATE", [id]);
      const len = (k: RowDataPacket | BlockClipRow) => slotUs({ in_pts_us: Number(k.in_pts_us), out_pts_us: Number(k.out_pts_us), effect: effectOf(k as RowDataPacket), fx: fxOf(k as RowDataPacket) });
      if ([...cur, ...rows].reduce((s, k) => s + len(k), 0) > MAX_REEL_US) throw new ApiError(422, "REEL_TOO_LONG", "With this block the reel would be longer than 10 minutes.");
      const pos = at === null ? cur.length : Math.min(at, cur.length);
      const added: string[] = [];                                   // put in far past the end, then renumbered (sequence_index is unique)
      for (const [k, b] of rows.entries()) {
        const clipId = uuidv7();
        added.push(clipId);
        await c.query(`INSERT INTO reel_clips (id, reel_id, source_video_id, in_pts_us, out_pts_us, sequence_index, playback_speed, effect_kind, effect_at_us, effect_hold_ms, clip_fx, origin, label)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [clipId, id, r.video_id, b.in_pts_us, b.out_pts_us, 500000 + k, b.playback_speed ?? 1, b.effect_kind ?? "NONE", b.effect_at_us ?? null, b.effect_hold_ms ?? 0,
           b.clip_fx === null || b.clip_fx === undefined ? null : JSON.stringify(b.clip_fx), b.origin ?? "MANUAL", b.label ?? null]);
      }
      const ids = cur.map((k) => k.id as string);
      await this.resequence(c, id, [...ids.slice(0, pos), ...added, ...ids.slice(pos)]);
      await c.query("UPDATE reel_projects SET status = 'DRAFT' WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: "reel.block_inserted", entityType: "reel", entityId: id, after: { clip_ids: added, at: pos, block: label } });
      await recordEdit(c, p, id, "reel.block_inserted", `Put in the block "${label}" (${rows.length} clip${rows.length === 1 ? "" : "s"})`, before);
    });
    return this.get(id, p);
  }

  async duplicate(id: string, p: Principal): Promise<Reel> {
    const copy = uuidv7();
    await this.db.tx(async (c) => {
      const r = await this.reelRow(id, p, c, true);
      const name = `${String(r.name).slice(0, 240)} (copy)`;
      await c.query(`INSERT INTO reel_projects (id, organization_id, project_id, video_id, player_id, run_id, name, created_by, status, aspect, settings, source, cross_match_length_s, best_moments_rule_version)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)`,
        [copy, p.organizationId, r.project_id, r.video_id, r.player_id, r.run_id, name, p.userId, r.aspect, typeof r.settings === "string" ? r.settings : JSON.stringify(r.settings ?? {}),
         r.source ?? "MATCH", r.cross_match_length_s ?? null, r.best_moments_rule_version ?? null]);
      await c.query("INSERT INTO reel_targets (reel_id, track_id, player_id, identity_decision_id) SELECT ?, track_id, player_id, identity_decision_id FROM reel_targets WHERE reel_id = ?", [copy, id]);
      const [clips] = await c.query<RowDataPacket[]>("SELECT * FROM reel_clips WHERE reel_id = ? ORDER BY sequence_index", [id]);
      const newId = new Map<string, string>();
      for (const k of clips) {
        newId.set(k.id as string, uuidv7());
        await c.query(`INSERT INTO reel_clips (id, reel_id, source_video_id, in_pts_us, out_pts_us, sequence_index, output_duration_us, playback_speed, effect_kind, effect_at_us, effect_hold_ms,
                         clip_fx, source_event_id, review_state, origin, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId.get(k.id as string), copy, k.source_video_id, k.in_pts_us, k.out_pts_us, k.sequence_index, k.output_duration_us, k.playback_speed, k.effect_kind, k.effect_at_us, k.effect_hold_ms,
           k.clip_fx === null || k.clip_fx === undefined ? null : (typeof k.clip_fx === "string" ? k.clip_fx : JSON.stringify(k.clip_fx)), k.source_event_id, k.review_state, k.origin, k.label]);
      }
      const trans = await this.transitionRows(id, c);                  // ADR-055: the transitions go with their clips
      if (trans.length) {
        const track = uuidv7();
        await c.query("INSERT INTO timeline_tracks (id, reel_id, track_type, layer) VALUES (?, ?, 'TRANSITION', 0)", [track, copy]);
        for (const t of trans) {
          await c.query("INSERT INTO timeline_items (id, timeline_track_id, reel_clip_id, start_us, duration_us, parameters) VALUES (?, ?, ?, 0, ?, ?)",
            [uuidv7(), track, newId.get(t.clip_id), t.duration_ms * 1000, JSON.stringify({ kind: t.kind })]);
        }
      }
      await recordChange(c, userActor(p), { action: "reel.duplicated", entityType: "reel", entityId: copy, after: { from_reel_id: id, name, clips: clips.length },
        event: { eventType: "reel.created", payload: { reel_id: copy } } });
    });
    return this.get(copy, p);
  }

  /** Export "Clear All": the organization's finished renders (done, failed, stopped) leave the queue; nothing is deleted */
  async clearFinished(p: Principal): Promise<{ cleared: number }> {
    let n = 0;
    await this.db.tx(async (c) => {
      const [res] = await c.query<ResultSetHeader>(
        `UPDATE render_jobs SET cleared_at = CURRENT_TIMESTAMP(6), cleared_by = ?
          WHERE organization_id = ? AND cleared_at IS NULL AND state IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'BLOCKED')`, [p.userId, p.organizationId]);
      n = res.affectedRows;
      if (n) await recordChange(c, userActor(p), { action: "render.queue_cleared", entityType: "organization", entityId: p.organizationId, after: { cleared: n } });
    });
    return { cleared: n };
  }

  async refreshTargets(id: string, p: Principal): Promise<Reel> {
    const r = await this.reelRow(id, p);
    if (!r.player_id) throw new ApiError(409, "NO_PLAYER", "This reel has no player.");
    if (r.source === "ALL_MATCHES") {
      // ADR-131: re-pin his confirmed tracks across every video again (run_id stays NULL: there is no single run)
      const videos = await this.crossMatch.confirmedVideos(r.player_id as string, p);
      const all = videos.flatMap((v) => v.targets);
      if (!all.length) throw new ApiError(409, "NO_CONFIRMED_TRACKS", "The player is no longer confirmed on any track of any video.");
      await this.db.tx(async (c) => {
        await c.query("DELETE FROM reel_targets WHERE reel_id = ?", [id]);
        for (const t of all) await c.query("INSERT INTO reel_targets (reel_id, track_id, player_id, identity_decision_id) VALUES (?, ?, ?, ?)", [id, t.trackId, r.player_id, t.decisionId]);
        await recordChange(c, userActor(p), { action: "reel.targets_refreshed", entityType: "reel", entityId: id, after: { source: "ALL_MATCHES", videos: videos.length, targets: all.length } });
      });
      return this.get(id, p);
    }
    const { runId, targets } = await this.confirmedTargets(r.video_id as string, r.player_id as string, p);
    if (targets.length === 0) throw new ApiError(409, "NO_CONFIRMED_TRACKS", "The player is no longer confirmed on any track of this video.");
    await this.db.tx(async (c) => {
      await c.query("DELETE FROM reel_targets WHERE reel_id = ?", [id]);
      for (const t of targets) await c.query("INSERT INTO reel_targets (reel_id, track_id, player_id, identity_decision_id) VALUES (?, ?, ?, ?)", [id, t.trackId, r.player_id, t.decisionId]);
      await c.query("UPDATE reel_projects SET run_id = ? WHERE id = ?", [runId, id]);
      await recordChange(c, userActor(p), { action: "reel.targets_refreshed", entityType: "reel", entityId: id, after: { targets: targets.length, run_id: runId } });
    });
    return this.get(id, p);
  }

  /** The player's events (ADR-043) on the reel's current targets, from the video's latest finished ball track, in match time.
   *  The per-video form lives in ./cross-match (eventMomentsForVideo); this is the reel-based wrapper over it, for the existing
   *  single-match moments endpoint — its ranking and behaviour are unchanged. A cross-match reel never comes here (its moments
   *  are the cross-match selection). */
  private async eventMoments(reel: Reel, tracks: string[], dur: number, p: Principal) {
    if (!reel.video_id) return [];
    const numbers = new Map(reel.targets.map((t) => [t.track_id, t.track_number]));
    return eventMomentsForVideo(this.db, reel.video_id, tracks, numbers, dur, p.organizationId);
  }

  /** Suggested moments: the player's events, ranked (best first, then earliest); then the visible stretches of the player on the reel's
   * current targets that no event moment covers: observations closer than 1.5 s merged, padded 1 s, split above 12 s. */
  /** E1 (ADR-064): the confirmed player's positions inside the reel's clip windows (half a second either side), for the live preview.
   *  Nothing when a target is stale. max_interp_s follows the renderer's lock_rules(lock, auto_track=False). */
  /** E1 (ADR-064): the confirmed player's positions inside the reel's clip windows (half a second either side), for the live preview.
   *  Nothing when a target is stale. max_interp_s follows the renderer's lock_rules(lock, auto_track=False).
   *  ADR-131 Build B: `?video_id=` asks for one clip video of a cross-match reel — the preview fetches the path per clip, because one
   *  video's path cannot represent a reel spanning all his matches. Without it a cross-match reel still returns an empty path (not
   *  stale). A video that holds none of the reel's clips is a 404, never another video's positions. */
  async path(id: string, p: Principal, videoId?: string): Promise<ReelPath> {
    const r = await this.reelRow(id, p);
    const lock = Math.min(1, Math.max(0, SpotlightSettings.parse(json<Record<string, unknown>>(r.settings) ?? {}).lock));
    const max_interp_s = Math.max(Math.round((0.3 + 0.6 * lock) * 1000) / 1000, 0.6);
    if (r.source === "ALL_MATCHES") {
      if (!videoId) return { stale: false, max_interp_s, points: [] };
      const inReel = await this.db.one<RowDataPacket>("SELECT 1 AS ok FROM reel_clips WHERE reel_id = ? AND source_video_id = ?", [id, videoId]);
      if (!inReel) throw notFound("Video");
      return this.pathForVideo(id, videoId, max_interp_s);
    }
    return this.pathForVideo(id, r.video_id as string, max_interp_s);
  }

  /** The path for one video: the reel's targets' observations inside that video's clip windows. Shared by the single-match path
   *  and by the per-clip-video path of a cross-match reel (Build B); for a single-match reel every clip is that video's, so the
   *  result is byte-identical to before. */
  private async pathForVideo(id: string, videoId: string, max_interp_s: number): Promise<ReelPath> {
    const targets = await this.db.rows<RowDataPacket>(
      `SELECT rt.track_id, (ci.decision_id = rt.identity_decision_id AND ci.state = 'CONFIRMED' AND ci.player_id = rt.player_id) AS current
         FROM reel_targets rt LEFT JOIN v_track_current_identity ci ON ci.track_id = rt.track_id WHERE rt.reel_id = ?`, [id]);
    const stale = targets.some((t) => !Number(t.current));
    const clips = await this.db.rows<RowDataPacket>("SELECT in_pts_us, out_pts_us FROM reel_clips WHERE reel_id = ? AND source_video_id = ?", [id, videoId]);
    if (stale || !targets.length || !clips.length) return { stale, max_interp_s, points: [] };
    const ids = targets.map((t) => t.track_id as string);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT o.pts_us, o.bbox_x, o.bbox_y, o.bbox_w, o.bbox_h, o.observation_state FROM track_observations o
        WHERE o.video_id = ? AND o.track_id IN (${ids.map(() => "?").join(",")}) AND (${clips.map(() => "o.pts_us BETWEEN ? AND ?").join(" OR ")})
        ORDER BY o.pts_us`,
      [videoId, ...ids, ...clips.flatMap((c) => [Number(c.in_pts_us) - 500_000, Number(c.out_pts_us) + 500_000])]);
    const points: ReelPath["points"] = [];
    for (const o of rows) {                                            // one position per instant (two targets never overlap in time; be safe)
      const t = Number(o.pts_us);
      if (points.length && points[points.length - 1]!.pts_us === t) continue;
      points.push({ pts_us: t, x: Number(o.bbox_x), y: Number(o.bbox_y), w: Number(o.bbox_w), h: Number(o.bbox_h), state: o.observation_state as string });
    }
    return { stale, max_interp_s, points };
  }

  async moments(id: string, p: Principal): Promise<ReelMoment[]> {
    const reel = await this.get(id, p);
    if (reel.source === "ALL_MATCHES")
      throw new ApiError(409, "CROSS_MATCH_USE_SELECTION", "This reel spans all matches: its moments are the cross-match selection, not single-match suggestions.");

    const current = reel.targets.filter((t) => t.decision_current);
    if (current.length === 0) return [];
    const v = await this.db.one<RowDataPacket>("SELECT duration_us FROM video_sources WHERE id = ?", [reel.video_id]);
    const dur = Number(v?.duration_us ?? 0) || Number.MAX_SAFE_INTEGER;
    const evm = await this.eventMoments(reel, current.map((t) => t.track_id), dur, p);
    const inReel = (a: number, b: number) => reel.clips.some((c) => c.in_pts_us < b && c.out_pts_us > a);
    const obs = await this.db.rows<RowDataPacket>(
      `SELECT o.pts_us, t.internal_track_number FROM track_observations o JOIN tracks t ON t.id = o.track_id
        WHERE o.video_id = ? AND o.track_id IN (${current.map(() => "?").join(",")}) ORDER BY o.pts_us`, [reel.video_id, ...current.map((t) => t.track_id)]);
    // B.15 (ADR-091): how much of each moment he has a recorded position in, and the moments a person rejected for this reel
    const times = obs.map((o) => Number(o.pts_us));
    const cover = (a: number, b: number) => Math.round(momentCoverage(times, a, b) * 1000) / 1000;
    const rejections = (await this.db.rows<RowDataPacket>("SELECT in_pts_us, out_pts_us FROM reel_moment_rejections WHERE reel_id = ?", [id]))
      .map((r) => ({ in_pts_us: Number(r.in_pts_us), out_pts_us: Number(r.out_pts_us) }));
    const out: ReelMoment[] = evm.map((m) => ReelMoment.parse({ kind: "EVENT", events: m.events, score: m.events.reduce((s, e) => s + EVENT_SCORE[e], 0),
      in_pts_us: Math.round(m.a), out_pts_us: Math.round(m.b), visible_us: Math.round(m.b - m.a), observations: m.events.length,
      track_numbers: [...m.tracks].sort((x, y) => x - y), in_reel: inReel(m.a, m.b), label: eventLabel(m.events), key_at_us: m.key,
      coverage: cover(m.a, m.b), rejected: isRejected(rejections, m.a, m.b) }))
      .sort((x, y) => y.score - x.score || x.in_pts_us - y.in_pts_us);
    const spans: { a: number; b: number; n: number; tracks: Set<number> }[] = [];
    for (const o of obs) {
      const t = Number(o.pts_us), last = spans[spans.length - 1];
      if (last && t - last.b <= MOMENT_MERGE_US) { last.b = t; last.n++; last.tracks.add(Number(o.internal_track_number)); }
      else spans.push({ a: t, b: t, n: 1, tracks: new Set([Number(o.internal_track_number)]) });
    }
    for (const s of spans) {
      let a = Math.max(0, s.a - MOMENT_PAD_US), b = Math.min(dur, s.b + MOMENT_PAD_US);
      if (b - a < MOMENT_MIN_US) { const mid = (a + b) / 2; a = Math.max(0, mid - MOMENT_MIN_US / 2); b = Math.min(dur, a + MOMENT_MIN_US); }
      for (let x = a; x < b; x += MOMENT_MAX_US) {
        const y = Math.min(b, x + MOMENT_MAX_US);
        if (y - x < 1_000_000 || evm.some((m) => m.a < y && m.b > x)) continue;                  // an event moment already shows it
        out.push(ReelMoment.parse({ kind: "VISIBLE", events: [], score: 0, in_pts_us: Math.round(x), out_pts_us: Math.round(y),
          visible_us: Math.max(0, Math.min(s.b, y) - Math.max(s.a, x)), observations: s.n,
          track_numbers: [...s.tracks].sort((m, n) => m - n), in_reel: inReel(x, y), label: VISIBLE_LABEL, coverage: cover(x, y), rejected: isRejected(rejections, x, y) }));
      }
    }
    return [...out.filter((m) => !m.rejected), ...out.filter((m) => m.rejected)];       // rejected ones last, still listed
  }

  /** ADR-131: the cross-match selection for a reel — the player's selection at the reel's stored length, with rejections applied
   *  and in_reel marked from the reel's clips. Single-match reels never come here (their moments are ReelMoment[]). */
  async crossMatchMoments(id: string, p: Principal): Promise<CrossMatchSelection> {
    const reel = await this.get(id, p);
    return this.crossMatch.selectionForReel(reel, p);
  }

  /** B.25 (ADR-100): for each clip, where its ends would hold his events (Inferred); nothing is changed: a person applies one with a trim */
  async boundarySuggestions(id: string, p: Principal): Promise<BoundarySuggestion[]> {
    const reel = await this.get(id, p);
    if (reel.source === "ALL_MATCHES")
      throw new ApiError(409, "CROSS_MATCH_SINGLE_VIDEO_ONLY", "Boundary suggestions hold one clip's ends against one video's events: a cross-match reel spans all his matches.");
    if (!reel.clips.length) return [];
    const ms = (await this.moments(id, p)).filter((m) => m.kind === "EVENT" && !m.rejected);
    if (!ms.length) return [];
    const v = await this.db.one<RowDataPacket>("SELECT duration_us FROM video_sources WHERE id = ?", [reel.video_id]);
    const run = await this.db.one<RowDataPacket>(
      "SELECT id FROM pipeline_runs WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY finished_at DESC, created_at DESC LIMIT 1", [reel.video_id, p.organizationId]);
    const shots = run ? (await this.db.rows<RowDataPacket>("SELECT start_pts_us, end_pts_us FROM video_shots WHERE run_id = ? ORDER BY start_pts_us", [run.id]))
      .map((s) => ({ start_us: Number(s.start_pts_us), end_us: Number(s.end_pts_us) })) : [];
    const dur = Number(v?.duration_us ?? 0) || Number.MAX_SAFE_INTEGER;
    const out: BoundarySuggestion[] = [];
    for (const c of [...reel.clips].sort((x, y) => x.sequence_index - y.sequence_index)) {
      const s = suggestBoundary(c, ms, shots, dur, reel.clips.filter((o) => o.id !== c.id));
      if (s) out.push(BoundarySuggestion.parse({ clip_id: c.id, from_in_us: c.in_pts_us, from_out_us: c.out_pts_us, ...s, evidence: "INFERRED" }));
    }
    return out;
  }

  /** E4 (ADR-067): draft reels from the player's moments; nothing is changed */
  async candidates(id: string, body: CandidatesRequest, p: Principal): Promise<CandidatesResponse> {
    const r = await this.reelRow(id, p);
    if (r.source === "ALL_MATCHES")
      throw new ApiError(409, "CROSS_MATCH_SINGLE_VIDEO_ONLY", "Draft reels are built from one match's moments: a cross-match reel spans all his matches.");
    const ms = (await this.moments(id, p)).filter((m) => !m.rejected);         // B.15: never a moment a person rejected
    return CandidatesResponse.parse({ candidates: buildCandidates(ms, body.target_s * 1e6, body.theme), moments: ms.length,
      available_us: ms.reduce((s, m) => s + (m.out_pts_us - m.in_pts_us), 0) });
  }

  /** E4: the reel's clips become a draft's, computed again here from the same inputs (the person's choice, not clips sent by the page) */
  async assemble(id: string, body: AssembleRequest, p: Principal): Promise<Reel> {
    const r = await this.reelRow(id, p);
    if (Number(r.version) !== body.version) throw new ApiError(409, "STALE_VERSION", "Someone changed this reel meanwhile; reload and try again.");
    const draft = (await this.candidates(id, body, p)).candidates.find((c) => c.key === body.key);
    if (!draft) throw new ApiError(409, "CANDIDATE_GONE", "That draft cannot be made from this player's moments any more; look at the drafts again.");
    return this.replaceClips(id, draft.clips, p, "reel.assembled", { key: body.key, target_s: body.target_s, theme: body.theme }, body.replace, body.version);
  }

  /** E4: the reel's clips replaced by assembled ones (a draft or a template's filled slots), with their speed effects; one change, audited */
  async replaceClips(id: string, clips: AssembledClip[], p: Principal, action: string, after: Record<string, unknown>, replace: boolean, version?: number): Promise<Reel> {
    if (!clips.length) throw new ApiError(422, "NOTHING_TO_ADD", "There is no moment of his to put in the reel.");
    const r0 = await this.reelRow(id, p);
    if (r0.source === "ALL_MATCHES")
      throw new ApiError(409, "CROSS_MATCH_SINGLE_VIDEO_ONLY", "A draft or template fills one match's clips: a cross-match reel's clips each come from their own video.");
    const total = clips.reduce((s, c) => s + clipOutputUs(c), 0);
    if (total > this.capUs(r0)) throw new ApiError(422, "REEL_TOO_LONG", `A reel can be at most ${this.capWords(r0)}.`);
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);                       // B.1 (ADR-081): the edit history
      const r = await this.reelRow(id, p, c, true);
      if (version !== undefined && Number(r.version) !== version) throw new ApiError(409, "STALE_VERSION", "Someone changed this reel meanwhile; reload and try again.");
      const [had] = await c.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM reel_clips WHERE reel_id = ?", [id]);
      if (Number(had[0]!.n) > 0 && !replace) throw new ApiError(409, "REEL_NOT_EMPTY", "This reel has clips: choose to replace them, or start a new reel.");
      await c.query("DELETE FROM reel_clips WHERE reel_id = ?", [id]);
      let n = 0;
      for (const x of clips) {
        await c.query("INSERT INTO reel_clips (id, reel_id, source_video_id, in_pts_us, out_pts_us, sequence_index, origin, label, effect_kind, effect_at_us, effect_hold_ms, playback_speed) " +
                      "VALUES (?, ?, ?, ?, ?, ?, 'SUGGESTED', ?, ?, ?, ?, ?)",
          [uuidv7(), id, r.video_id, x.in_pts_us, x.out_pts_us, n++, x.label, x.effect.kind, x.effect.at_us, x.effect.hold_ms, x.effect.speed]);
      }
      await c.query("UPDATE reel_projects SET status = 'DRAFT' WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action, entityType: "reel", entityId: id, before: { clips: Number(had[0]!.n) }, after: { ...after, clips: clips.length, duration_us: total } });
      await recordEdit(c, p, id, action, action === "reel.assembled" ? "Built the reel from a draft" : "Filled the reel from a template", before);
    });
    return this.get(id, p);
  }

  /** A clip fits: at most 60 s, inside its video, and the reel stays within its length cap (ADR-131: a cross-match reel's chosen
   *  length, else 10 minutes as today). Returns the reel and the clip's video: the reel's video for a single-match reel, the
   *  given (or the clip's own) source video for a cross-match reel. */
  private async checkClip(reelId: string, inUs: number, outUs: number, p: Principal, exceptClip?: string, sourceVideoId?: string) {
    const reel = await this.reelRow(reelId, p);
    if (outUs - inUs > MAX_CLIP_US) throw new ApiError(422, "CLIP_TOO_LONG", "A clip can be at most 60 seconds.");
    let videoId: string | null = reel.source === "ALL_MATCHES" ? (sourceVideoId ?? null) : (reel.video_id as string);
    if (reel.source === "ALL_MATCHES" && exceptClip && !videoId) {
      const clip = await this.db.one<RowDataPacket>("SELECT source_video_id FROM reel_clips WHERE id = ? AND reel_id = ?", [exceptClip, reelId]);
      videoId = (clip?.source_video_id as string | undefined) ?? null;
    }
    if (!videoId) throw new ApiError(422, "NO_SOURCE_VIDEO", "Give source_video_id: this reel spans all matches, so a clip needs its video.");
    const v = await this.db.one<RowDataPacket>("SELECT duration_us FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [videoId, p.organizationId]);
    if (!v) throw notFound("Video");
    if (v?.duration_us && outUs > Number(v.duration_us) + 100_000) throw new ApiError(422, "CLIP_OUTSIDE_VIDEO", "The clip ends after the video does.");
    const total = await this.db.one<RowDataPacket>("SELECT COALESCE(SUM(out_pts_us - in_pts_us), 0) AS d FROM reel_clips WHERE reel_id = ? AND id <> ?", [reelId, exceptClip ?? ""]);
    if (Number(total?.d ?? 0) + (outUs - inUs) > this.capUs(reel)) throw new ApiError(422, "REEL_TOO_LONG", `A reel can be at most ${this.capWords(reel)}.`);
    return { reel, videoId };
  }

  async addClip(id: string, body: AddClipRequest, p: Principal): Promise<Reel> {
    const { reel, videoId } = await this.checkClip(id, body.in_pts_us, body.out_pts_us, p, undefined, body.source_video_id);
    if (reel.source === "ALL_MATCHES") {
      // ADR-131: a hand-added clip must be of a video where the player has confirmed tracks (else the spotlight has nobody to follow)
      if (body.source_video_id && body.source_video_id !== videoId) throw new ApiError(422, "VIDEO_MISMATCH", "That source_video_id is not this clip's video.");
      const { targets } = await this.crossMatch.confirmedTargets(videoId, reel.player_id as string, p);
      if (!targets.length) throw new ApiError(409, "NO_CONFIRMED_TRACKS", "The player has no confirmed track in that video: a cross-match clip needs one.");
      // ADR-131 v2.1: a hand-added clip must be one of his best moments, and must not break the per-match cap (Tier S immune)
      const existing = await this.db.rows<RowDataPacket>("SELECT in_pts_us, out_pts_us FROM reel_clips WHERE reel_id = ? AND source_video_id = ?", [id, videoId]);
      await this.crossMatch.checkPin(reel.player_id as string, videoId, body.in_pts_us, body.out_pts_us,
        existing.map((cl) => ({ in_pts_us: Number(cl.in_pts_us), out_pts_us: Number(cl.out_pts_us) })),
        (reel.cross_match_length_s ?? 180) as CrossMatchLength, p);
    } else if (body.source_video_id && body.source_video_id !== videoId) {
      throw new ApiError(422, "VIDEO_MISMATCH", "That source_video_id is not this reel's video.");
    }
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);                       // B.1 (ADR-081): the edit history
      const [m] = await c.query<RowDataPacket[]>("SELECT COALESCE(MAX(sequence_index), -1) + 1 AS n FROM reel_clips WHERE reel_id = ? FOR UPDATE", [id]);
      const clipId = uuidv7();
      await c.query("INSERT INTO reel_clips (id, reel_id, source_video_id, in_pts_us, out_pts_us, sequence_index, origin, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [clipId, id, videoId, body.in_pts_us, body.out_pts_us, m[0]!.n, body.origin, body.label]);
      await c.query("UPDATE reel_projects SET status = 'DRAFT' WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: "reel.clip_added", entityType: "reel", entityId: id, after: { clip_id: clipId, in_pts_us: body.in_pts_us, out_pts_us: body.out_pts_us } });
      await recordEdit(c, p, id, "reel.clip_added", "Added a clip", before);
    });
    return this.get(id, p);
  }

  async updateClip(id: string, clipId: string, body: UpdateClipRequest, p: Principal): Promise<Reel> {
    await this.checkClip(id, body.in_pts_us, body.out_pts_us, p, clipId);
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);                       // B.1 (ADR-081): the edit history
      const [r] = await c.query<RowDataPacket[]>("UPDATE reel_clips SET in_pts_us = ?, out_pts_us = ? WHERE id = ? AND reel_id = ?", [body.in_pts_us, body.out_pts_us, clipId, id]);
      if (!(r as unknown as { affectedRows: number }).affectedRows) throw notFound("Clip");
      await recordChange(c, userActor(p), { action: "reel.clip_trimmed", entityType: "reel", entityId: id, after: { clip_id: clipId, ...body } });
      await recordEdit(c, p, id, "reel.clip_trimmed", "Trimmed a clip", before);
    });
    return this.get(id, p);
  }

  /** E2 (ADR-065): slow motion, a freeze frame or a hero ramp on one clip. The key moment must lie inside the clip; the reel, counted with
   *  every clip's effect, stays within 10 minutes. Reset with kind NONE. */
  async setEffect(id: string, clipId: string, body: SetClipEffectRequest, p: Principal): Promise<Reel> {
    await this.reelRow(id, p);
    const e = normaliseEffect(body);
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);                       // B.1 (ADR-081): the edit history
      const [rows] = await c.query<RowDataPacket[]>(
        "SELECT id, in_pts_us, out_pts_us, effect_kind, effect_at_us, effect_hold_ms, playback_speed FROM reel_clips WHERE reel_id = ? FOR UPDATE", [id]);
      const clip = rows.find((r) => r.id === clipId);
      if (!clip) throw notFound("Clip");
      const a = Number(clip.in_pts_us), b = Number(clip.out_pts_us);
      if (e.at_us !== null && (e.at_us <= a || e.at_us >= b)) throw new ApiError(422, "EFFECT_OUTSIDE_CLIP", "The key moment must be inside the clip: move the playhead onto it.");
      const total = rows.reduce((s, r) => s + clipOutputUs(r.id === clipId ? { in_pts_us: a, out_pts_us: b, effect: e } : { in_pts_us: Number(r.in_pts_us), out_pts_us: Number(r.out_pts_us), effect: effectOf(r) }), 0);
      const rr = await this.reelRow(id, p, c, true);
      if (total > this.capUs(rr)) throw new ApiError(422, "REEL_TOO_LONG", `With this effect the reel would be longer than ${this.capWords(rr)}.`);
      await c.query("UPDATE reel_clips SET effect_kind = ?, effect_at_us = ?, effect_hold_ms = ?, playback_speed = ? WHERE id = ?", [e.kind, e.at_us, e.hold_ms, e.speed, clipId]);
      await recordChange(c, userActor(p), { action: "reel.clip_effect_set", entityType: "reel", entityId: id, before: { clip_id: clipId, effect: effectOf(clip) }, after: { clip_id: clipId, effect: e } });
      await recordEdit(c, p, id, "reel.clip_effect_set", e.kind === "NONE" ? "Removed a speed effect" : `Speed effect: ${e.kind === "SLOW" ? "slow motion" : e.kind === "FREEZE" ? "freeze frame" : "hero ramp"}`, before);
    });
    return this.get(id, p);
  }

  /** E5 (ADR-068): a clip's keyframed zoom and telestration; every time must fall inside the clip as it plays in the reel */
  async setFx(id: string, clipId: string, body: SetClipFxRequest, p: Principal): Promise<Reel> {
    await this.reelRow(id, p);
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);                       // B.1 (ADR-081): the edit history
      const [rows] = await c.query<RowDataPacket[]>(
        "SELECT id, in_pts_us, out_pts_us, effect_kind, effect_at_us, effect_hold_ms, playback_speed, clip_fx FROM reel_clips WHERE id = ? AND reel_id = ? FOR UPDATE", [clipId, id]);
      const clip = rows[0];
      if (!clip) throw notFound("Clip");
      const lenMs = clipOutputUs({ in_pts_us: Number(clip.in_pts_us), out_pts_us: Number(clip.out_pts_us), effect: effectOf(clip) }) / 1000;
      if ([...body.zoom.map((k) => k.at_ms), ...body.drawings.map((d) => d.at_ms)].some((t) => t > lenMs))
        throw new ApiError(422, "FX_OUTSIDE_CLIP", "A zoom key or drawing starts after the clip ends: move the playhead inside the clip.");
      if (body.gap_ms !== fxOf(clip).gap_ms) {                  // B.19 (ADR-094): a spacer must keep the reel within 10 minutes
        const [all] = await c.query<RowDataPacket[]>(
          "SELECT id, in_pts_us, out_pts_us, effect_kind, effect_at_us, effect_hold_ms, playback_speed, clip_fx FROM reel_clips WHERE reel_id = ?", [id]);
        const total = all.reduce((s, r) => s + slotUs({ in_pts_us: Number(r.in_pts_us), out_pts_us: Number(r.out_pts_us), effect: effectOf(r), fx: r.id === clipId ? body : fxOf(r) }), 0);
        const rr = await this.reelRow(id, p, c, true);
        if (total > this.capUs(rr)) throw new ApiError(422, "REEL_TOO_LONG", `With this gap the reel would be longer than ${this.capWords(rr)}.`);
      }
      const empty = !body.zoom.length && !body.drawings.length && !body.gap_ms && !body.gain_db;
      const fx = { zoom: [...body.zoom].sort((x, y) => x.at_ms - y.at_ms), drawings: [...body.drawings].sort((x, y) => x.at_ms - y.at_ms), gap_ms: body.gap_ms, gain_db: body.gain_db };
      await c.query("UPDATE reel_clips SET clip_fx = ? WHERE id = ?", [empty ? null : JSON.stringify(fx), clipId]);
      await recordChange(c, userActor(p), { action: "reel.clip_fx_set", entityType: "reel", entityId: id, before: { clip_id: clipId, fx: fxOf(clip) }, after: { clip_id: clipId, fx } });
      await recordEdit(c, p, id, "reel.clip_fx_set", body.gain_db !== fxOf(clip).gain_db ? (body.gain_db <= -60 ? "Clip sound muted" : `Clip sound ${body.gain_db > 0 ? "+" : ""}${body.gain_db} dB`) : body.gap_ms !== fxOf(clip).gap_ms ? (body.gap_ms ? `Gap of ${body.gap_ms / 1000} s before the clip` : "Gap removed") : "Changed zoom and drawings", before);
    });
    return this.get(id, p);
  }

  /** E5: reviewers' comments left through share links of this reel's renders, oldest first, with where the clips start in each file */
  async reviewComments(id: string, p: Principal): Promise<ReviewComment[]> {
    await this.reelRow(id, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT c.id, c.guest_name, c.body, c.at_pts_us, c.created_at, j.id AS render_id, j.completed_at, JSON_EXTRACT(j.result, '$.lead_s') AS lead_s
         FROM comments c JOIN share_links l ON l.id = c.share_link_id JOIN render_jobs j ON j.output_asset_id = l.asset_id
        WHERE j.reel_id = ? AND j.organization_id = ? AND c.organization_id = ? ORDER BY c.created_at, c.id LIMIT 500`, [id, p.organizationId, p.organizationId]);
    return rows.map((r) => ReviewComment.parse({ id: r.id, name: r.guest_name ?? "Reviewer", body: r.body, at_s: r.at_pts_us === null ? null : Number(r.at_pts_us) / 1e6,
      created_at: new Date(r.created_at).toISOString(), render_id: r.render_id, render_completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
      lead_s: r.lead_s === null || r.lead_s === undefined ? null : Number(r.lead_s) }));
  }

  /** owner 2026-11-02 ("Can't user bulk remove clips?"): empty the reel in one click */
  async removeAllClips(id: string, p: Principal): Promise<Reel> {
    await this.reelRow(id, p);
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);                       // B.1 (ADR-081): the edit history
      const [r] = await c.query<RowDataPacket[]>("DELETE FROM reel_clips WHERE reel_id = ?", [id]);
      await c.query("UPDATE reel_projects SET status = 'DRAFT' WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: "reel.clips_cleared", entityType: "reel", entityId: id, after: { removed: (r as unknown as { affectedRows: number }).affectedRows } });
      await recordEdit(c, p, id, "reel.clips_cleared", "Removed every clip", before);
    });
    return this.get(id, p);
  }

  /** B.15 (ADR-091): a clip takes a moment's window and label in place (same position, its speed effect and drawings dropped: they were
   *  set for the old window); one change in the history */
  async swapClip(id: string, clipId: string, body: SwapClipRequest, p: Principal): Promise<Reel> {
    await this.checkClip(id, body.in_pts_us, body.out_pts_us, p, clipId);
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);
      const [r] = await c.query<RowDataPacket[]>(
        `UPDATE reel_clips SET in_pts_us = ?, out_pts_us = ?, label = ?, origin = 'SUGGESTED', effect_kind = 'NONE', effect_at_us = NULL, effect_hold_ms = 0, playback_speed = 1, clip_fx = NULL
          WHERE id = ? AND reel_id = ?`, [body.in_pts_us, body.out_pts_us, body.label, clipId, id]);
      if (!(r as unknown as { affectedRows: number }).affectedRows) throw notFound("Clip");
      await c.query("UPDATE reel_projects SET status = 'DRAFT' WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: "reel.clip_swapped", entityType: "reel", entityId: id, after: { clip_id: clipId, in_pts_us: body.in_pts_us, out_pts_us: body.out_pts_us } });
      await recordEdit(c, p, id, "reel.clip_swapped", "Swapped a clip for another moment", before);
    });
    return this.get(id, p);
  }

  /** B.15: "Not this one" for a suggested moment of this reel, and undoing it. ADR-131: for a cross-match reel the rejection is
   *  per video (video_id required — rejecting a moment in one match never rejects the same window in another). */
  async rejectMoment(id: string, body: CrossMatchMomentWindowRequest, p: Principal): Promise<ReelMoment[] | CrossMatchSelection> {
    const r = await this.reelRow(id, p);
    if (r.source === "ALL_MATCHES") {
      if (!body.video_id) throw new ApiError(422, "VIDEO_REQUIRED", "Give video_id: this reel spans all matches, so a rejection is per video.");
      await this.db.tx(async (c) => {
        await c.query("INSERT INTO reel_moment_rejections (reel_id, video_id, in_pts_us, out_pts_us, rejected_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE out_pts_us = VALUES(out_pts_us)",
          [id, body.video_id, body.in_pts_us, body.out_pts_us, p.userId]);
        await recordChange(c, userActor(p), { action: "reel.moment_rejected", entityType: "reel", entityId: id, after: { ...body } });
      });
      return this.crossMatchMoments(id, p);
    }
    if (body.video_id && body.video_id !== r.video_id) throw new ApiError(422, "VIDEO_MISMATCH", "That video_id is not this reel's video.");
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO reel_moment_rejections (reel_id, in_pts_us, out_pts_us, rejected_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE out_pts_us = VALUES(out_pts_us)",
        [id, body.in_pts_us, body.out_pts_us, p.userId]);
      await recordChange(c, userActor(p), { action: "reel.moment_rejected", entityType: "reel", entityId: id, after: { ...body } });
    });
    return this.moments(id, p);
  }
  async restoreMoment(id: string, body: CrossMatchMomentWindowRequest, p: Principal): Promise<ReelMoment[] | CrossMatchSelection> {
    const r = await this.reelRow(id, p);
    if (r.source === "ALL_MATCHES") {
      if (!body.video_id) throw new ApiError(422, "VIDEO_REQUIRED", "Give video_id: this reel spans all matches, so a rejection is per video.");
      await this.db.tx(async (c) => {
        // every rejected window of that video that rejects this moment
        await c.query("DELETE FROM reel_moment_rejections WHERE reel_id = ? AND video_id = ? AND LEAST(out_pts_us, ?) - GREATEST(in_pts_us, ?) >= ?",
          [id, body.video_id, body.out_pts_us, body.in_pts_us, (body.out_pts_us - body.in_pts_us) / 2]);
        await recordChange(c, userActor(p), { action: "reel.moment_restored", entityType: "reel", entityId: id, after: { ...body } });
      });
      return this.crossMatchMoments(id, p);
    }
    if (body.video_id && body.video_id !== r.video_id) throw new ApiError(422, "VIDEO_MISMATCH", "That video_id is not this reel's video.");
    await this.db.tx(async (c) => {
      // every rejected window that rejects this moment
      await c.query("DELETE FROM reel_moment_rejections WHERE reel_id = ? AND LEAST(out_pts_us, ?) - GREATEST(in_pts_us, ?) >= ?",
        [id, body.out_pts_us, body.in_pts_us, (body.out_pts_us - body.in_pts_us) / 2]);
      await recordChange(c, userActor(p), { action: "reel.moment_restored", entityType: "reel", entityId: id, after: { ...body } });
    });
    return this.moments(id, p);
  }

  /** Add every suggested moment that is not in the reel yet, in match order, as long as the reel stays within 10 minutes */
  async addAllMoments(id: string, p: Principal): Promise<Reel> {
    const reel = await this.reelRow(id, p);
    if (reel.source === "ALL_MATCHES") return this.addAllCrossMatchMoments(id, p, reel);
    const ms = (await this.moments(id, p)).filter((m) => !m.in_reel && !m.rejected).sort((x, y) => x.in_pts_us - y.in_pts_us);
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);                       // B.1 (ADR-081): the edit history
      const [t] = await c.query<RowDataPacket[]>("SELECT COALESCE(SUM(out_pts_us - in_pts_us), 0) AS d, COALESCE(MAX(sequence_index), -1) + 1 AS n FROM reel_clips WHERE reel_id = ? FOR UPDATE", [id]);
      let total = Number(t[0]!.d), n = Number(t[0]!.n), added = 0;
      for (const m of ms) {
        const d = m.out_pts_us - m.in_pts_us;
        if (d > MAX_CLIP_US || total + d > MAX_REEL_US) continue;
        await c.query("INSERT INTO reel_clips (id, reel_id, source_video_id, in_pts_us, out_pts_us, sequence_index, origin, label) VALUES (?, ?, ?, ?, ?, ?, 'SUGGESTED', ?)",
          [uuidv7(), id, reel.video_id, m.in_pts_us, m.out_pts_us, n++, m.label]);
        total += d; added++;
      }
      await c.query("UPDATE reel_projects SET status = 'DRAFT' WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: "reel.moments_added", entityType: "reel", entityId: id, after: { added, skipped: ms.length - added } });
      await recordEdit(c, p, id, "reel.moments_added", "Added the suggested moments", before);
    });
    return this.get(id, p);
  }

  /** ADR-131: add every SELECTED cross-match moment not yet in the reel, in tier order, never past the reel's length cap
   *  (a moment that does not fit is skipped, as single-match add-moments does — a shorter later one may still fit). */
  private async addAllCrossMatchMoments(id: string, p: Principal, reel: RowDataPacket): Promise<Reel> {
    const sel = await this.crossMatchMoments(id, p);
    const capUs = this.capUs(reel);
    const ms = sel.selected.filter((m) => !m.in_reel);
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);                       // B.1 (ADR-081): the edit history
      const [t] = await c.query<RowDataPacket[]>("SELECT COALESCE(SUM(out_pts_us - in_pts_us), 0) AS d, COALESCE(MAX(sequence_index), -1) + 1 AS n FROM reel_clips WHERE reel_id = ? FOR UPDATE", [id]);
      let total = Number(t[0]!.d), n = Number(t[0]!.n), added = 0;
      for (const m of ms) {
        const d = m.out_pts_us - m.in_pts_us;
        if (d > MAX_CLIP_US || total + d > capUs) continue;
        await c.query("INSERT INTO reel_clips (id, reel_id, source_video_id, in_pts_us, out_pts_us, sequence_index, origin, label) VALUES (?, ?, ?, ?, ?, ?, 'SUGGESTED', ?)",
          [uuidv7(), id, m.video_id, m.in_pts_us, m.out_pts_us, n++, crossMatchClipLabel(m, m.tier, m.reason)]);
        total += d; added++;
      }
      await c.query("UPDATE reel_projects SET status = 'DRAFT' WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: "reel.moments_added", entityType: "reel", entityId: id, after: { source: "ALL_MATCHES", added, skipped: ms.length - added } });
      await recordEdit(c, p, id, "reel.moments_added", "Added the suggested moments", before);
    });
    return this.get(id, p);
  }

  async removeClip(id: string, clipId: string, p: Principal): Promise<Reel> {
    await this.reelRow(id, p);
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);                       // B.1 (ADR-081): the edit history
      const [r] = await c.query<RowDataPacket[]>("DELETE FROM reel_clips WHERE id = ? AND reel_id = ?", [clipId, id]);
      if (!(r as unknown as { affectedRows: number }).affectedRows) throw notFound("Clip");
      await this.resequence(c, id, null);
      await recordChange(c, userActor(p), { action: "reel.clip_removed", entityType: "reel", entityId: id, after: { clip_id: clipId } });
      await recordEdit(c, p, id, "reel.clip_removed", "Removed a clip", before);
    });
    return this.get(id, p);
  }

  async reorder(id: string, body: ReorderClipsRequest, p: Principal): Promise<Reel> {
    await this.reelRow(id, p);
    await this.db.tx(async (c) => {
      const before = await snapshot(c, id);                       // B.1 (ADR-081): the edit history
      const [rows] = await c.query<RowDataPacket[]>("SELECT id FROM reel_clips WHERE reel_id = ? FOR UPDATE", [id]);
      const have = new Set(rows.map((r) => r.id as string));
      if (have.size !== body.clip_ids.length || body.clip_ids.some((x) => !have.has(x))) throw new ApiError(422, "CLIPS_MISMATCH", "Send every clip of the reel exactly once.");
      await this.resequence(c, id, body.clip_ids);
      await recordChange(c, userActor(p), { action: "reel.clips_reordered", entityType: "reel", entityId: id, after: { clip_ids: body.clip_ids } });
      await recordEdit(c, p, id, "reel.clips_reordered", "Reordered the clips", before);
    });
    return this.get(id, p);
  }

  /** Two-step renumbering: sequence_index is unique per reel. */
  private async resequence(c: PoolConnection, reelId: string, order: string[] | null) {
    const ids = order ?? (await c.query<RowDataPacket[]>("SELECT id FROM reel_clips WHERE reel_id = ? ORDER BY sequence_index", [reelId]))[0].map((r) => r.id as string);
    await c.query("UPDATE reel_clips SET sequence_index = sequence_index + 100000 WHERE reel_id = ?", [reelId]);
    for (const [i, cid] of ids.entries()) await c.query("UPDATE reel_clips SET sequence_index = ? WHERE id = ?", [i, cid]);
  }

  /** B.22 (ADR-097): several files of one edit in one request, each its own render (key:index); a file already rendering is skipped */
  async startBatch(id: string, body: BatchRenderRequest, key: string, p: Principal): Promise<BatchRenderResult> {
    const reel = await this.get(id, p);
    const started: RenderJob[] = [], skipped: BatchRenderResult["skipped"] = [];
    for (const [i, o] of uniqueOutputs(body.outputs, reel.aspect).entries()) {
      try {
        started.push(await this.startRender(id, { codec: body.codec, bitrate_mbps: body.bitrate_mbps, profile: o.profile, aspect: EXPORT_PROFILES[o.profile].aspect ? null : o.aspect,
          loudness_lufs: body.loudness_lufs }, `${key}:${i}`, p));
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== "RENDER_ALREADY_RUNNING") throw e;
        skipped.push({ profile: o.profile, aspect: o.aspect, code: e.code, message: e.message });
      }
    }
    return BatchRenderResult.parse({ started, skipped });
  }

  /** B.22 (ADR-097): what a person should know before exporting (contracts preflightChecks), and the files rendering now */
  async preflight(id: string, p: Principal): Promise<Preflight> {
    const reel = await this.get(id, p);
    let rights: string | null = null;
    try { await this.checkLogos(reel.settings, p); } catch (e) { rights = e instanceof ApiError ? e.message : "A chosen logo, video or music cannot be used."; }
    // ADR-130: the intro's photo is shown in the reel, so its rights are checked here too (the render refuses it as well)
    const photoRights = reel.settings.profile_intro && reel.player ? await this.intro.photoRightsProblem(reel.player.player_id, p) : null;
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(config, '$.profile')), 'REEL') AS profile, JSON_UNQUOTE(JSON_EXTRACT(config, '$.aspect')) AS aspect
         FROM render_jobs WHERE reel_id = ? AND organization_id = ? AND state IN ('QUEUED', 'RUNNING')`, [id, p.organizationId]);
    const s = reel.settings;
    return Preflight.parse({
      checks: preflightChecks({ clips: reel.clips.length, length_us: reel.duration_us, stale: reel.stale, player: !!reel.player, rights_problem: rights, music: !!s.music_id,
        lower_third: s.lower_third, on_team_sheet: !!reel.player_roster, match_card: s.match_card, match_linked: !!reel.match, score_bug: s.score_bug,
        clock_confirmed: reel.match?.clock === "CONFIRMED", profile_intro: s.profile_intro, photo_rights_problem: photoRights }),
      open: rows.map((r) => ({ profile: r.profile, aspect: r.aspect ?? reel.aspect })),
    });
  }

  async startRender(id: string, body: CreateRenderRequest, key: string, p: Principal): Promise<RenderJob> {
    const reel = await this.get(id, p);
    if (reel.clips.length === 0) throw new ApiError(409, "REEL_EMPTY", "Add at least one clip before rendering.");
    if (reel.stale) throw new ApiError(409, "REEL_TARGETS_STALE", "A player identity this reel follows has changed. Refresh the targets first.");
    const prior = await this.db.one<RowDataPacket>("SELECT id FROM render_jobs WHERE organization_id = ? AND idempotency_key = ?", [p.organizationId, key]);
    if (prior) return this.render(prior.id as string, p);
    const prof = EXPORT_PROFILES[body.profile];
    // B.22 (ADR-097): the frame of this file: the scout / social / archive profile's own, else the one asked for, else the reel's
    if (prof.aspect && body.aspect && body.aspect !== prof.aspect) throw new ApiError(422, "PROFILE_HAS_ITS_FRAME", `The ${prof.label} is always ${prof.aspect}.`);
    const aspect = outputAspect({ profile: body.profile, aspect: body.aspect }, reel.aspect);
    // E3 (ADR-066): one open render per file of the edit (export profile and frame; the files of one edit render one after the other)
    const open = await this.db.one<RowDataPacket>(
      `SELECT id FROM render_jobs WHERE reel_id = ? AND state IN ('QUEUED', 'RUNNING') AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(config, '$.profile')), 'REEL') = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(config, '$.aspect')) = ?`, [id, body.profile, aspect]);
    if (open) throw new ApiError(409, "RENDER_ALREADY_RUNNING", "This file of the reel is already rendering.");
    const renderId = uuidv7();
    const logos = await this.checkLogos(reel.settings, p);
    // ADR-130: the Player Profile Intro, fixed with the render (the worker draws it from this snapshot's profile_intro, never
    // from a guess; the key is profile_intro because `profile` already means the export profile in this snapshot)
    const profile = await this.intro.snapshotForRender(reel, p);
    // ADR-131: a cross-match reel has no single match — the match card cannot represent ten matches, so the overlay's match facts
    // are null (Build B decides what the worker draws in their place); the club, number and position fall back to his latest team,
    // the same fallback the web uses. The intro (profile_intro) opens it exactly as a single-match reel.
    const latestTeam = reel.player?.profile?.latest_team ?? null;
    const facts = reel.video_id ? await this.overlayFacts(reel.video_id, reel.player?.player_id ?? null, p) : null;
    // ADR-044: everything the overlays draw, fixed with the render (the worker reads nothing else for them)
    const overlay = { title: reel.name, home: facts?.short?.home ?? null, away: facts?.short?.away ?? null, competition: facts?.match?.competition ?? null,
      periods: facts?.periods ?? null, player_club: facts?.player_club ?? latestTeam?.team ?? null, competition_logo_key: logos.competition_logo_id ?? null, custom_logo_key: logos.custom_logo_id ?? null,
      home_name: facts?.match?.home ?? null, away_name: facts?.match?.away ?? null, date: facts?.card?.date ?? null, venue: facts?.card?.venue ?? null,
      // E2 (ADR-065): the strap's shirt number and position, from the match's team sheet as a person recorded it (none when not on it)
      player_number: facts?.roster?.jersey_number ?? latestTeam?.jersey_number ?? null, player_position: facts?.roster?.position ?? latestTeam?.position ?? null };
    // ADR-047: the music under the reel, fixed with the render (its file and loudness; the match sound under it)
    const music = logos.music_id ? { key: logos.music_id, volume: reel.settings.music_volume, match_volume: reel.settings.match_volume } : null;
    // ADR-050: the intro / outro files; each clip's label is its event tag
    const intro = logos.intro_id ? { key: logos.intro_id } : null, outro = logos.outro_id ? { key: logos.outro_id } : null;
    const snapshot = { codec: body.codec, bitrate_mbps: prof.bitrate_mbps ?? body.bitrate_mbps, reel_version: reel.version, aspect, settings: reel.settings, overlay, music, intro, outro, profile_intro: profile,
      // ADR-131: a cross-match reel's selection rule, fixed with the render (the worker stamps it into the manifest in Build B)
      ...(reel.source === "ALL_MATCHES" ? { selection: { rule: "best-moments", version: BEST_MOMENTS_RULE_VERSION, length_s: reel.cross_match_length_s } } : {}),
      // E3 (ADR-066): the export profile, and the sound's loudness target (EBU R128, integrated) and whether the music dips under the match
      // B.20 (ADR-095): the reel's own loudness target, when a person chose one, for every file
      // B.22 (ADR-097): this file's own loudness when the export chose one
      profile: body.profile, audio: { lufs: body.loudness_lufs ?? reel.settings.loudness_lufs ?? prof.lufs, true_peak_db: -1.5, duck_music: reel.settings.duck_music },
      clips: reel.clips.map((c) => ({ id: c.id, source_video_id: c.source_video_id, in_pts_us: c.in_pts_us, out_pts_us: c.out_pts_us, label: isVisibleLabel(c.label) ? null : c.label, effect: c.effect, fx: c.fx })),
      // ADR-055: the transition into each clip after the first (kind, length); the worker draws it over that clip's start
      transitions: reel.transitions.map((t) => ({ clip_id: t.clip_id, kind: t.kind, duration_us: t.duration_ms * 1000 })) };
    const manifestHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    await this.db.tx(async (c) => {
      // ADR-140: a render costs 10 tokens, charged at enqueue in this same transaction, so a render that fails to
      // enqueue charges nothing. An idempotent replay returns the earlier render above and never re-charges.
      await this.wallet.charge(c, p.organizationId, p.userId, { type: "REEL_RENDER", id: renderId, amount: TOKEN_COSTS.reelRender, reason: `Render of reel ${id} (10 tokens).` });
      await c.query("INSERT INTO render_jobs (id, reel_id, organization_id, requested_by, config, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)",
        [renderId, id, p.organizationId, p.userId, JSON.stringify({ ...snapshot, snapshot_sha256: manifestHash }), key]);
      await c.query("UPDATE reel_projects SET status = 'RENDERING' WHERE id = ?", [id]);
      await recordChange(c, userActor(p), {
        action: "reel.render_requested", entityType: "reel", entityId: id, after: { render_id: renderId, codec: body.codec, clips: reel.clips.length },
        event: { eventType: "reel.render_requested", payload: { render_id: renderId, reel_id: id }, dedupeKey: `render-requested:${renderId}` },
      });
    });
    return this.render(renderId, p);
  }

  async render(renderId: string, p: Principal): Promise<RenderJob> {
    const r = await this.db.one<RowDataPacket>("SELECT * FROM render_jobs WHERE id = ? AND organization_id = ?", [renderId, p.organizationId]);
    if (!r) throw notFound("Render");
    const job = await this.db.one<RowDataPacket>(
      "SELECT progress, stage_message FROM worker_jobs WHERE organization_id = ? AND kind = 'RENDER' AND subject_id = ? ORDER BY created_at DESC LIMIT 1", [p.organizationId, renderId]);
    return RenderJob.parse({
      id: r.id, reel_id: r.reel_id, state: r.state, config: json<Record<string, unknown>>(r.config) ?? {}, result: json<Record<string, unknown>>(r.result),
      failure_code: r.failure_code, failure_detail: r.failure_detail, progress: job ? Number(job.progress) : null, stage_message: job?.stage_message ?? null,
      created_at: new Date(r.created_at).toISOString(), completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null, has_output: !!r.output_asset_id && !r.removed_at, cleared: !!r.cleared_at,
    });
  }

  /** owner 2026-11-02 ("stop the rendering, I didn't pick all clips"): the person stops their render; the worker loses its claim and drops
   *  the job at its next check, and the reel can be generated again at once */
  async cancelRender(renderId: string, p: Principal): Promise<RenderJob> {
    await this.db.tx(async (c) => {
      const [rows] = await c.query<RowDataPacket[]>("SELECT reel_id, state FROM render_jobs WHERE id = ? AND organization_id = ? FOR UPDATE", [renderId, p.organizationId]);
      const r = rows[0];
      if (!r) throw notFound("Render");
      if (r.state !== "QUEUED" && r.state !== "RUNNING") throw new ApiError(409, "RENDER_NOT_RUNNING", "This render has already finished.");
      const wasQueued = r.state === "QUEUED";
      await c.query("UPDATE render_jobs SET state = 'CANCELLED', completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [renderId]);
      await c.query("UPDATE worker_jobs SET state = 'CANCELLED', claim_token = NULL, lease_expires_at = NULL, finished_at = CURRENT_TIMESTAMP(6) "
        + "WHERE organization_id = ? AND kind = 'RENDER' AND subject_id = ? AND state IN ('QUEUED', 'RUNNING', 'PAUSED')", [p.organizationId, renderId]);
      await c.query("UPDATE reel_projects SET status = 'DRAFT' WHERE id = ? AND status = 'RENDERING'", [r.reel_id]);
      // ADR-140: a render cancelled before it started never produced output, so its tokens come back.
      if (wasQueued) await this.wallet.refundForJob(c, p.organizationId, p.userId, { type: "REEL_RENDER", id: renderId, reason: "Render cancelled before it started, so its tokens were returned." });
      await recordChange(c, userActor(p), { action: "reel.render_cancelled", entityType: "reel", entityId: r.reel_id as string, after: { render_id: renderId } });
    });
    return this.render(renderId, p);
  }



  async renderPlayback(renderId: string, p: Principal) {
    const r = await this.db.one<RowDataPacket>(
      "SELECT j.output_asset_id, a.mime_type FROM render_jobs j JOIN assets a ON a.id = j.output_asset_id AND a.organization_id = j.organization_id WHERE j.id = ? AND j.organization_id = ? AND j.state = 'SUCCEEDED' AND j.removed_at IS NULL",
      [renderId, p.organizationId]);
    if (!r) throw new ApiError(404, "NOT_FOUND", "There is no rendered file for this render.");
    const watch = this.analysis.signedUrl(r.output_asset_id as string, p.organizationId);
    return { url: watch.url, download_url: this.analysis.signedUrl(r.output_asset_id as string, p.organizationId, true).url, mime: r.mime_type, expires_at: watch.expires_at,
      notice: "Development output. Commercial distribution and paid export are not activated (legal review pending)." };
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class ReelsController {
  constructor(private readonly reels: ReelsService) {}

  @Post("reels")
  @Roles(...PROJECT_WRITERS)
  create(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.create(CreateReelRequest.parse(body), p);
  }

  @Get("reels")
  list(@Query("video_id") videoId: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.reels.list(videoId === undefined ? undefined : uuidParam(videoId, "Video"), p);
  }

  @Get("reels/:reelId")
  get(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) {
    return this.reels.get(uuidParam(id, "Reel"), p);
  }



  @Patch("reels/:reelId")
  @Roles(...PROJECT_WRITERS)
  update(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.update(uuidParam(id, "Reel"), UpdateReelRequest.parse(body), p);
  }

  @Post("reels/:reelId/duplicate")
  @Roles(...PROJECT_WRITERS)
  duplicate(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) {
    return this.reels.duplicate(uuidParam(id, "Reel"), p);
  }

  @Post("renders/clear-finished")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  clearFinished(@CurrentPrincipal() p: Principal) {
    return this.reels.clearFinished(p);
  }

  @Post("reels/:reelId/refresh-targets")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  refresh(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) {
    return this.reels.refreshTargets(uuidParam(id, "Reel"), p);
  }

  @Get("reels/:reelId/path")
  path(@Param("reelId") id: string, @Query("video_id") videoId: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.reels.path(uuidParam(id, "Reel"), p, videoId === undefined ? undefined : uuidParam(videoId, "Video"));
  }

  @Get("reels/:reelId/boundary-suggestions")
  boundarySuggestions(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) {
    return this.reels.boundarySuggestions(uuidParam(id, "Reel"), p);
  }

  @Get("reels/:reelId/moments")
  async moments(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) {
    // ADR-131: a cross-match reel's moments are its selection (selected + not selected with reasons); a single-match reel's
    // are the ranked suggestions, as today.
    const reel = await this.reels.get(uuidParam(id, "Reel"), p);
    return reel.source === "ALL_MATCHES" ? this.reels.crossMatchMoments(uuidParam(id, "Reel"), p) : this.reels.moments(uuidParam(id, "Reel"), p);
  }

  @Patch("reels/:reelId/clips/:clipId/fx")
  @Roles(...PROJECT_WRITERS)
  setFx(@Param("reelId") id: string, @Param("clipId") clipId: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.setFx(uuidParam(id, "Reel"), uuidParam(clipId, "Clip"), SetClipFxRequest.parse(body), p);
  }

  @Get("reels/:reelId/review-comments")
  reviewComments(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) {
    return this.reels.reviewComments(uuidParam(id, "Reel"), p);
  }

  @Post("reels/:reelId/candidates")
  @HttpCode(200)
  candidates(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.candidates(uuidParam(id, "Reel"), CandidatesRequest.parse(body ?? {}), p);
  }

  @Post("reels/:reelId/assemble")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  assemble(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.assemble(uuidParam(id, "Reel"), AssembleRequest.parse(body), p);
  }

  @Post("reels/:reelId/clips")
  @Roles(...PROJECT_WRITERS)
  addClip(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.addClip(uuidParam(id, "Reel"), AddClipRequest.parse(body), p);
  }

  @Post("reels/:reelId/clips/add-moments")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  addAll(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) {
    return this.reels.addAllMoments(uuidParam(id, "Reel"), p);
  }

  @Delete("reels/:reelId/clips")
  @Roles(...PROJECT_WRITERS)
  removeAll(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) {
    return this.reels.removeAllClips(uuidParam(id, "Reel"), p);
  }

  @Post("reels/:reelId/clips/order")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  reorder(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.reorder(uuidParam(id, "Reel"), ReorderClipsRequest.parse(body), p);
  }

  @Post("reels/:reelId/transitions/all")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  setAllTransitions(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.setAllTransitions(uuidParam(id, "Reel"), SetAllTransitionsRequest.parse(body), p);
  }

  @Patch("reels/:reelId/transitions")
  @Roles(...PROJECT_WRITERS)
  setTransition(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.setTransition(uuidParam(id, "Reel"), SetTransitionRequest.parse(body), p);
  }

  @Patch("reels/:reelId/clips/:clipId")
  @Roles(...PROJECT_WRITERS)
  trim(@Param("reelId") id: string, @Param("clipId") clipId: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.updateClip(uuidParam(id, "Reel"), uuidParam(clipId, "Clip"), UpdateClipRequest.parse(body), p);
  }

  @Patch("reels/:reelId/clips/:clipId/effect")
  @Roles(...PROJECT_WRITERS)
  effect(@Param("reelId") id: string, @Param("clipId") clipId: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.setEffect(uuidParam(id, "Reel"), uuidParam(clipId, "Clip"), SetClipEffectRequest.parse(body), p);
  }

  @Post("reels/:reelId/clips/:clipId/swap")
  @Roles(...PROJECT_WRITERS)
  @HttpCode(200)
  swap(@Param("reelId") id: string, @Param("clipId") clipId: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.swapClip(uuidParam(id, "Reel"), uuidParam(clipId, "Clip"), SwapClipRequest.parse(body), p);
  }

  @Post("reels/:reelId/moments/reject")
  @Roles(...PROJECT_WRITERS)
  @HttpCode(200)
  rejectMoment(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.rejectMoment(uuidParam(id, "Reel"), CrossMatchMomentWindowRequest.parse(body), p);
  }

  @Post("reels/:reelId/moments/restore")
  @Roles(...PROJECT_WRITERS)
  @HttpCode(200)
  restoreMoment(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.reels.restoreMoment(uuidParam(id, "Reel"), CrossMatchMomentWindowRequest.parse(body), p);
  }

  @Delete("reels/:reelId/clips/:clipId")
  @Roles(...PROJECT_WRITERS)
  remove(@Param("reelId") id: string, @Param("clipId") clipId: string, @CurrentPrincipal() p: Principal) {
    return this.reels.removeClip(uuidParam(id, "Reel"), uuidParam(clipId, "Clip"), p);
  }

  @Post("reels/:reelId/renders/batch")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  startBatch(@Param("reelId") id: string, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.reels.startBatch(uuidParam(id, "Reel"), BatchRenderRequest.parse(body ?? {}), idempotencyKey(key), p);
  }

  @Get("reels/:reelId/preflight")
  preflight(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) {
    return this.reels.preflight(uuidParam(id, "Reel"), p);
  }

  @Post("reels/:reelId/renders")
  @Roles(...PROJECT_WRITERS)
  startRender(@Param("reelId") id: string, @Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.reels.startRender(uuidParam(id, "Reel"), CreateRenderRequest.parse(body ?? {}), idempotencyKey(key), p);
  }

  @Get("renders/:renderId")
  render(@Param("renderId") id: string, @CurrentPrincipal() p: Principal) {
    return this.reels.render(uuidParam(id, "Render"), p);
  }

  @Post("renders/:renderId/cancel")
  @Roles(...PROJECT_WRITERS)
  @HttpCode(200)
  cancelRender(@Param("renderId") id: string, @CurrentPrincipal() p: Principal) {
    return this.reels.cancelRender(uuidParam(id, "Render"), p);
  }

  @Get("renders/:renderId/playback")
  playback(@Param("renderId") id: string, @CurrentPrincipal() p: Principal) {
    return this.reels.renderPlayback(uuidParam(id, "Render"), p);
  }
}
