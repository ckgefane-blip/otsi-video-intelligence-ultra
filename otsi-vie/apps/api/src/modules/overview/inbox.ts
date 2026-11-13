/**
 * Home: what needs the person now (v3 Phase A.13, ADR-062).
 *
 *   GET  /v1/overview/inbox                 the next action and the Review inbox
 *   POST /v1/overview/inbox/decisions       decide one inbox row (OWNER / ADMIN / ANALYST): APPROVE does what the row asks
 *                                           for, REJECT declines it; the decision is logged with its reason and the updated
 *                                           inbox is returned. APPROVE: IDENTITY is refused (422 IDENTITY_NOT_IN_BULK: a
 *                                           player is confirmed moment by moment in Analysis, never in bulk), TEAM_SHEET applies the proposed cards (first HOME, second AWAY by frame —
 *                                           the same default the Analysis team-sheet dialog offers), STALE_REEL refreshes
 *                                           the reel's targets, FAILED_JOB runs the failed jobs again. REJECT: IDENTITY
 *                                           rejects the suggestions, TEAM_SHEET dismisses the cards. A stale reel or a failed
 *                                           job cannot be rejected from here (422): open the reel to refresh it, or retry
 *                                           the job, or leave it — the row clears when a newer run of the same kind exists.
 *                                           IDENTITY REJECT declines only the suggestions of the reel's own player.
 *
 * Review inbox rows, each opening the exact page:
 *   IDENTITY    per reel with a player: tracks of the reel's video suggested as THAT player and not decided yet ("Is this him?";
 *               naming is per reel player, never everyone in the video) -> Analysis of that video (decided there, moment by moment)
 *   TEAM_SHEET  lineup cards read from the video and still PROPOSED, per video -> Analysis of that video (the team sheet panel)
 *   STALE_REEL  reels following an identity that has since changed (they cannot render until refreshed) -> that reel
 *   FAILED_JOB  engine jobs that failed in the last 24 hours and were not run again -> Processing of their video
 * Next action, the first that applies: an analysis is running -> watch it; something to review -> the first inbox row; a reel with
 * clips and no finished render -> continue it; a rendered reel of a player -> his report; a finished analysis with no reel -> pick a
 * player. Everything is a count of recorded rows of the caller's organization; projects hidden from the person and items in Trash are
 * left out.
 */
import { Body, Controller, Get, HttpCode, Injectable, Post, UseGuards } from "@nestjs/common";
import { HomeInbox, InboxDecisionRequest, InboxDecisionResult, InboxKind, type InboxItem, type NextAction } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { recordChange, userActor } from "../../core/audit";
import { notHidden } from "../../core/access";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError } from "../../core/problem";
import { LineupsService } from "../analysis/lineups";
import { JobsService } from "../jobs/jobs";
import { uuidParam } from "../players/players.controller";
import { ReelsService } from "../reels/reels";
import { TrackIdentityService } from "../tracks/track-identity.service";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const title = (r: RowDataPacket) => (r.title as string | null) ?? (r.original_filename as string | null) ?? "Untitled video";

@Injectable()
export class HomeInboxService {
  constructor(private readonly db: Db, private readonly tracks: TrackIdentityService, private readonly lineups: LineupsService,
    private readonly reels: ReelsService, private readonly jobs: JobsService) {}

  async inbox(p: Principal): Promise<HomeInbox> {
    const org = p.organizationId, vh = notHidden(p, "v.project_id"), rh = notHidden(p, "r.project_id");
    const items: InboxItem[] = [];

    const identity = await this.db.rows<RowDataPacket>(
      `SELECT r.id, r.name, r.video_id, pi.display_name, COUNT(DISTINCT ci.track_id) AS n
         FROM reel_projects r JOIN video_sources v ON v.id = r.video_id AND v.organization_id = r.organization_id
         JOIN tracks t ON t.video_id = r.video_id JOIN v_track_current_identity ci ON ci.track_id = t.id
         JOIN v_player_identity pi ON pi.player_id = r.player_id
        WHERE r.organization_id = ? AND r.removed_at IS NULL AND v.removed_at IS NULL AND r.player_id IS NOT NULL
          AND ci.state = 'CANDIDATE' AND ci.player_id = r.player_id${rh}${vh}
        GROUP BY r.id, r.name, r.video_id, pi.display_name ORDER BY n DESC LIMIT 5`, [org]);
    for (const r of identity) {
      items.push({ id: `IDENTITY:${r.id}`, kind: "IDENTITY", title: `Is this ${r.display_name as string}? ${plural(Number(r.n), "moment")} to check`,
        detail: r.name as string, count: Number(r.n), href: `/analysis?video=${r.video_id}`, video_id: r.video_id as string, player_name: r.display_name as string });
    }

    const sheets = await this.db.rows<RowDataPacket>(
      `SELECT v.id, v.title, v.original_filename, COUNT(*) AS n
         FROM lineup_cards l JOIN video_sources v ON v.id = l.video_id
        WHERE l.state = 'PROPOSED' AND l.organization_id = ? AND v.removed_at IS NULL${vh}
        GROUP BY v.id, v.title, v.original_filename ORDER BY n DESC LIMIT 5`, [org]);
    for (const r of sheets) {
      items.push({ id: `TEAM_SHEET:${r.id}`, kind: "TEAM_SHEET", title: `Approve ${plural(Number(r.n), "team sheet")}`, detail: title(r), count: Number(r.n), href: `/analysis?video=${r.id}`, video_id: r.id as string, player_name: null });
    }

    const stale = await this.db.rows<RowDataPacket>(
      `SELECT r.id, r.name FROM reel_projects r
        WHERE r.organization_id = ? AND r.removed_at IS NULL${rh}
          AND EXISTS (SELECT 1 FROM reel_targets rt LEFT JOIN v_track_current_identity ci ON ci.track_id = rt.track_id
                       WHERE rt.reel_id = r.id AND NOT ((ci.decision_id = rt.identity_decision_id OR (ci.decision_id IS NULL AND rt.identity_decision_id IS NULL)) AND ci.state = 'CONFIRMED' AND (ci.player_id = rt.player_id OR (ci.player_id IS NULL AND rt.player_id IS NULL))))
        ORDER BY r.updated_at DESC LIMIT 5`, [org]);
    for (const r of stale) {
      items.push({ id: `STALE_REEL:${r.id}`, kind: "STALE_REEL", title: "Refresh a reel: a player identity it follows changed", detail: r.name as string, count: 1, href: `/reels/${r.id}`, video_id: null, player_name: null });
    }

    // a failed job counts while it is the latest of its kind on that video (a retry that ran since clears it)
    const failed = await this.db.rows<RowDataPacket>(
      `SELECT v.id, v.title, v.original_filename, COUNT(*) AS n FROM worker_jobs j
         JOIN video_sources v ON v.organization_id = j.organization_id AND v.id = (CASE j.subject_type
              WHEN 'video' THEN j.subject_id
              WHEN 'analysis_run' THEN (SELECT video_id FROM pipeline_runs WHERE id = j.subject_id)
              WHEN 'quality_assessment' THEN (SELECT video_id FROM video_quality_assessments WHERE id = j.subject_id)
              WHEN 'ball_track' THEN (SELECT video_id FROM ball_tracks WHERE id = j.subject_id)
              WHEN 'pitch_calibration' THEN (SELECT video_id FROM pitch_calibration_requests WHERE id = j.subject_id)
              WHEN 'lineup_read' THEN (SELECT video_id FROM lineup_reads WHERE id = j.subject_id)
              ELSE NULL END)
        WHERE j.organization_id = ? AND j.state = 'FAILED' AND j.finished_at >= CURRENT_TIMESTAMP(6) - INTERVAL 1 DAY AND v.removed_at IS NULL${vh}
          AND NOT EXISTS (SELECT 1 FROM worker_jobs k WHERE k.organization_id = j.organization_id AND k.kind = j.kind AND k.created_at > j.created_at
                           AND k.subject_type = j.subject_type AND (k.subject_id = j.subject_id OR j.subject_type <> 'video'))
        GROUP BY v.id, v.title, v.original_filename LIMIT 5`, [org]);
    for (const r of failed) {
      items.push({ id: `FAILED_JOB:${r.id}`, kind: "FAILED_JOB", title: `${plural(Number(r.n), "engine job")} failed`, detail: title(r), count: Number(r.n), href: `/processing?video=${r.id}`, video_id: r.id as string, player_name: null });
    }

    const done = await this.db.one<RowDataPacket>(
      `SELECT v.id, v.title, v.original_filename FROM pipeline_runs pr JOIN video_sources v ON v.id = pr.video_id
        WHERE pr.organization_id = ? AND pr.status = 'SUCCEEDED' AND v.removed_at IS NULL${vh} ORDER BY pr.finished_at DESC LIMIT 1`, [org]);
    return HomeInbox.parse({ next: await this.next(p, items, done ?? null), items, completed_match: !!done });
  }

  /** Decide one inbox row. The row must still be there when the decision arrives (else 404: it was already decided or
   *  is gone); each underlying subject is decided through its own flow, so its own audit row is written too, and this
   *  decision is logged once more on top with the reason. A subject that cannot be decided does not stop the others:
   *  it is listed in `failures` and the returned inbox already reflects what was applied. */
  async decide(body: InboxDecisionRequest, p: Principal): Promise<InboxDecisionResult> {
    const [kindRaw, subjectRaw] = body.item_id.split(":");
    const kind = InboxKind.safeParse(kindRaw).success ? (kindRaw as InboxKind) : null;
    if (!kind || !subjectRaw) throw new ApiError(404, "INBOX_ITEM_NOT_FOUND", "No such review item.");
    const subjectId = uuidParam(subjectRaw, "Review item");
    const item = (await this.inbox(p)).items.find((i) => i.id === body.item_id);
    if (!item) throw new ApiError(404, "INBOX_ITEM_GONE", "This review item is already decided or gone; reload the inbox.");
    const org = p.organizationId;
    let applied = 0;
    const failures: { subject: string; message: string }[] = [];
    const failed = (subject: string, x: unknown) => failures.push({ subject, message: x instanceof Error ? x.message : "Not decided." });

    if (kind === "IDENTITY") {
      // a player is confirmed moment by moment in Analysis, never in bulk (unknown beats wrong); declining is safe in bulk
      if (body.decision === "APPROVE") throw new ApiError(422, "IDENTITY_NOT_IN_BULK", "A player is confirmed moment by moment: open Analysis and check each one.");
      const vh = notHidden(p, "v.project_id");
      const candidates = await this.db.rows<RowDataPacket>(
        `SELECT t.id AS track_id, ci.decision_id, ci.player_id
           FROM reel_projects r JOIN video_sources v ON v.id = r.video_id AND v.organization_id = r.organization_id
           JOIN tracks t ON t.video_id = r.video_id JOIN v_track_current_identity ci ON ci.track_id = t.id
          WHERE r.id = ? AND r.organization_id = ? AND r.removed_at IS NULL AND v.removed_at IS NULL${vh}
            AND ci.state = 'CANDIDATE' AND ci.player_id = r.player_id`, [subjectId, org]);
      for (const c of candidates) {
        try {
          await this.tracks.decide(String(c.track_id), {
            state: "REJECTED",
            player_id: null,
            supersedes_id: c.decision_id as string, reason: body.reason ?? null, evidence_id: null,
          }, p);
          applied++;
        } catch (x) { failed(`track ${c.track_id}`, x); }
      }
    } else if (kind === "TEAM_SHEET") {
      const proposed = (await this.lineups.list(subjectId, p)).cards.filter((c) => c.state === "PROPOSED");
      if (!proposed.length) throw new ApiError(404, "INBOX_ITEM_GONE", "This review item is already decided or gone; reload the inbox.");
      if (body.decision === "REJECT") {
        for (const c of proposed) {
          try { await this.lineups.dismiss(c.id, { reason: body.reason ?? undefined }, p); applied++; }
          catch (x) { failed(`team sheet card ${c.id}`, x); }
        }
      } else {
        // the cards as read, first HOME then AWAY by frame — the same default the Analysis team-sheet dialog offers,
        // and the person can still correct it there. A row the engine read badly (no number, no name, no team) is left
        // out: it needs a person's correction in Analysis, not a blind approval.
        const usable = proposed.filter((c) => (c.team_name ?? "").trim().length >= 2).slice(0, 2).map((c, i) => ({
          card_id: c.id, side: (i === 0 ? "HOME" : "AWAY") as "HOME" | "AWAY", team_name: c.team_name!.trim(),
          entries: c.entries.map((e) => ({ number: Number(e.number), name: e.name.trim(), role: e.role }))
            .filter((e) => Number.isInteger(e.number) && e.number >= 0 && e.number <= 99 && e.name.length >= 2),
        })).filter((c) => c.entries.length > 0);
        if (!usable.length) throw new ApiError(422, "TEAM_SHEET_NOT_APPLIABLE", "The team sheets as read cannot be applied as they are: correct the numbers, names or team in Analysis first.");
        const out = await this.lineups.apply(subjectId, { cards: usable }, p);
        for (const r of out.rows) {
          if (r.outcome === "FAILED") failures.push({ subject: `No. ${r.number} ${r.name}`, message: r.message ?? "Not added." });
          else applied++;
        }
      }
    } else if (kind === "STALE_REEL") {
      if (body.decision === "REJECT") throw new ApiError(422, "DECISION_NOT_SUPPORTED", "A stale reel can't be rejected from here: open the reel to refresh it, or leave it — the row clears once its identities are refreshed.");
      await this.reels.refreshTargets(subjectId, p);
      applied = 1;
    } else {
      if (body.decision === "REJECT") throw new ApiError(422, "DECISION_NOT_SUPPORTED", "A failed job can't be rejected from here: run it again, or leave it — the row clears when a newer run of the same kind exists.");
      for (const j of await this.failedJobs(subjectId, p)) {
        try { await this.jobs.retry(String(j.id), p); applied++; }
        catch (x) { failed(`job ${j.id} (${j.kind})`, x); }
      }
    }

    await this.db.tx(async (c) => {
      await recordChange(c, userActor(p), { action: "overview.inbox_decided", entityType: "inbox_item", entityId: subjectId,
        after: { item_id: body.item_id, kind, decision: body.decision, reason: body.reason ?? null, applied, failed: failures.length } });
    });
    return InboxDecisionResult.parse({ item_id: body.item_id, kind, decision: body.decision, applied, failures, inbox: await this.inbox(p) });
  }

  /** the latest failed jobs on one video, by the same rule the inbox counts them (a retry that ran since clears the failure) */
  private async failedJobs(videoId: string, p: Principal): Promise<RowDataPacket[]> {
    const vh = notHidden(p, "v.project_id");
    return this.db.rows<RowDataPacket>(
      `SELECT j.id, j.kind FROM worker_jobs j
         JOIN video_sources v ON v.organization_id = j.organization_id AND v.id = (CASE j.subject_type
              WHEN 'video' THEN j.subject_id
              WHEN 'analysis_run' THEN (SELECT video_id FROM pipeline_runs WHERE id = j.subject_id)
              WHEN 'quality_assessment' THEN (SELECT video_id FROM video_quality_assessments WHERE id = j.subject_id)
              WHEN 'ball_track' THEN (SELECT video_id FROM ball_tracks WHERE id = j.subject_id)
              WHEN 'pitch_calibration' THEN (SELECT video_id FROM pitch_calibration_requests WHERE id = j.subject_id)
              WHEN 'lineup_read' THEN (SELECT video_id FROM lineup_reads WHERE id = j.subject_id)
              ELSE NULL END)
        WHERE j.organization_id = ? AND j.state = 'FAILED' AND j.finished_at >= CURRENT_TIMESTAMP(6) - INTERVAL 1 DAY AND v.id = ? AND v.removed_at IS NULL${vh}
          AND NOT EXISTS (SELECT 1 FROM worker_jobs k WHERE k.organization_id = j.organization_id AND k.kind = j.kind AND k.created_at > j.created_at
                           AND k.subject_type = j.subject_type AND (k.subject_id = j.subject_id OR j.subject_type <> 'video'))
        ORDER BY j.created_at DESC`, [p.organizationId, videoId]);
  }

  private async next(p: Principal, items: InboxItem[], done: RowDataPacket | null): Promise<NextAction | null> {
    const org = p.organizationId, vh = notHidden(p, "v.project_id"), rh = notHidden(p, "r.project_id");
    const running = await this.db.one<RowDataPacket>(
      `SELECT v.id, v.title, v.original_filename FROM pipeline_runs pr JOIN video_sources v ON v.id = pr.video_id
        WHERE pr.organization_id = ? AND pr.status IN ('QUEUED', 'RUNNING') AND v.removed_at IS NULL${vh} ORDER BY pr.created_at DESC LIMIT 1`, [org]);
    if (running) return { kind: "WATCH_PROCESSING", label: "Watch the analysis", detail: title(running), href: `/processing?video=${running.id}` };
    const first = items[0];
    if (first) return { kind: "REVIEW", label: first.title, detail: first.detail, href: first.href };
    const draft = await this.db.one<RowDataPacket>(
      `SELECT r.id, r.name FROM reel_projects r
        WHERE r.organization_id = ? AND r.removed_at IS NULL${rh} AND EXISTS (SELECT 1 FROM reel_clips c WHERE c.reel_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM render_jobs j WHERE j.reel_id = r.id AND j.state IN ('QUEUED', 'RUNNING', 'SUCCEEDED') AND j.removed_at IS NULL)
        ORDER BY r.updated_at DESC LIMIT 1`, [org]);
    if (draft) return { kind: "CONTINUE_REEL", label: "Continue the reel", detail: draft.name as string, href: `/reels/${draft.id}` };
    const rendered = await this.db.one<RowDataPacket>(
      `SELECT r.player_id, pi.display_name, pi.canonical_otsi_id FROM reel_projects r
         JOIN render_jobs j ON j.reel_id = r.id AND j.state = 'SUCCEEDED' AND j.removed_at IS NULL
         JOIN v_player_identity pi ON pi.player_id = r.player_id
        WHERE r.organization_id = ? AND r.removed_at IS NULL${rh} AND r.player_id IS NOT NULL ORDER BY j.completed_at DESC LIMIT 1`, [org]);
    if (rendered) {
      return { kind: "OPEN_REPORT", label: "Open the player report", detail: rendered.display_name as string,
        href: `/reports/players/${encodeURIComponent((rendered.canonical_otsi_id as string | null) ?? (rendered.player_id as string))}` };
    }
    if (done) return { kind: "PICK_PLAYER", label: "Pick a player for a reel", detail: title(done), href: `/analysis?video=${done.id}` };
    return null;
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class HomeInboxController {
  constructor(private readonly inbox: HomeInboxService) {}

  @Get("overview/inbox")
  get(@CurrentPrincipal() p: Principal) {
    return this.inbox.inbox(p);
  }

  @Post("overview/inbox/decisions")
  @HttpCode(200)
  @Roles("OWNER", "ADMIN", "ANALYST")
  decide(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.inbox.decide(InboxDecisionRequest.parse(body ?? {}), p);
  }
}
