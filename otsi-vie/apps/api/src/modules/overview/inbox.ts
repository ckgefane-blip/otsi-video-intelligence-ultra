/**
 * Home: what needs the person now (v3 Phase A.13, ADR-062).
 *
 *   GET /v1/overview/inbox   the next action and the Review inbox
 *
 * Review inbox rows, each opening the exact page:
 *   IDENTITY    tracks whose current identity is a CANDIDATE (a person or the engine proposed a player; nobody confirmed it), per video
 *               -> Analysis of that video (the identity is decided there; nothing is confirmed here)
 *   TEAM_SHEET  lineup cards read from the video and still PROPOSED, per video -> Analysis of that video (the team sheet panel)
 *   STALE_REEL  reels following an identity that has since changed (they cannot render until refreshed) -> that reel
 *   FAILED_JOB  engine jobs that failed in the last 24 hours and were not run again -> Processing of their video
 * Next action, the first that applies: an analysis is running -> watch it; something to review -> the first inbox row; a reel with
 * clips and no finished render -> continue it; a rendered reel of a player -> his report; a finished analysis with no reel -> pick a
 * player. Everything is a count of recorded rows of the caller's organization; projects hidden from the person and items in Trash are
 * left out.
 */
import { Controller, Get, Injectable, UseGuards } from "@nestjs/common";
import { HomeInbox, type InboxItem, type NextAction } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { notHidden } from "../../core/access";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { Db } from "../../core/db";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const title = (r: RowDataPacket) => (r.title as string | null) ?? (r.original_filename as string | null) ?? "Untitled video";

@Injectable()
export class HomeInboxService {
  constructor(private readonly db: Db) {}

  async inbox(p: Principal): Promise<HomeInbox> {
    const org = p.organizationId, vh = notHidden(p, "v.project_id"), rh = notHidden(p, "r.project_id");
    const items: InboxItem[] = [];

    const identity = await this.db.rows<RowDataPacket>(
      `SELECT v.id, v.title, v.original_filename, COUNT(*) AS n
         FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id JOIN video_sources v ON v.id = t.video_id
        WHERE ci.state = 'CANDIDATE' AND v.organization_id = ? AND v.removed_at IS NULL${vh}
        GROUP BY v.id, v.title, v.original_filename ORDER BY n DESC LIMIT 5`, [org]);
    for (const r of identity) {
      items.push({ kind: "IDENTITY", title: `Check ${plural(Number(r.n), "identity suggestion")}`, detail: title(r), count: Number(r.n), href: `/analysis?video=${r.id}` });
    }

    const sheets = await this.db.rows<RowDataPacket>(
      `SELECT v.id, v.title, v.original_filename, COUNT(*) AS n
         FROM lineup_cards l JOIN video_sources v ON v.id = l.video_id
        WHERE l.state = 'PROPOSED' AND l.organization_id = ? AND v.removed_at IS NULL${vh}
        GROUP BY v.id, v.title, v.original_filename ORDER BY n DESC LIMIT 5`, [org]);
    for (const r of sheets) {
      items.push({ kind: "TEAM_SHEET", title: `Approve ${plural(Number(r.n), "team sheet")}`, detail: title(r), count: Number(r.n), href: `/analysis?video=${r.id}` });
    }

    const stale = await this.db.rows<RowDataPacket>(
      `SELECT r.id, r.name FROM reel_projects r
        WHERE r.organization_id = ? AND r.removed_at IS NULL${rh}
          AND EXISTS (SELECT 1 FROM reel_targets rt LEFT JOIN v_track_current_identity ci ON ci.track_id = rt.track_id
                       WHERE rt.reel_id = r.id AND NOT ((ci.decision_id = rt.identity_decision_id OR (ci.decision_id IS NULL AND rt.identity_decision_id IS NULL)) AND ci.state = 'CONFIRMED' AND (ci.player_id = rt.player_id OR (ci.player_id IS NULL AND rt.player_id IS NULL))))
        ORDER BY r.updated_at DESC LIMIT 5`, [org]);
    for (const r of stale) {
      items.push({ kind: "STALE_REEL", title: "Refresh a reel: a player identity it follows changed", detail: r.name as string, count: 1, href: `/reels/${r.id}` });
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
      items.push({ kind: "FAILED_JOB", title: `${plural(Number(r.n), "engine job")} failed`, detail: title(r), count: Number(r.n), href: `/processing?video=${r.id}` });
    }

    const done = await this.db.one<RowDataPacket>(
      `SELECT v.id, v.title, v.original_filename FROM pipeline_runs pr JOIN video_sources v ON v.id = pr.video_id
        WHERE pr.organization_id = ? AND pr.status = 'SUCCEEDED' AND v.removed_at IS NULL${vh} ORDER BY pr.finished_at DESC LIMIT 1`, [org]);
    return HomeInbox.parse({ next: await this.next(p, items, done ?? null), items, completed_match: !!done });
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
}
