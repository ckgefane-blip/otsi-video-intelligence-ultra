/**
 * Project access (ADR-057, migration 0043). A project is open to its organization (ORGANIZATION) or only to the people chosen for it
 * (RESTRICTED). This file is the ONE place that decides it:
 *  - `loadAccess` runs in AuthGuard for every member request: it reads the organization's restricted projects and this user's permission
 *    in each, and puts on the principal the projects he may not see (`hidden`) and his permission in each restricted project he may see.
 *  - `enforceProjectAccess` (also in AuthGuard) finds the project behind every route id (`/videos/:id`, `/reels/:reelId/...`, ...) and every
 *    id in the body (`video_id`, `reel_id`, ...): a hidden project is "not found" (the same answer as an id that does not exist), and a change
 *    in a restricted project needs the Editor or Manager permission there (a Reviewer may make identity decisions and write notes).
 *  - lists and totals leave hidden projects out with `notHidden` / `videoNotHidden` (SQL fragments; the ids are UUIDs checked here).
 * Owners and Admins see every project. A project permission only narrows what the organization role allows; it never adds to it.
 */
import type { FastifyRequest } from "fastify";
import { RowDataPacket } from "mysql2/promise";
import type { Principal } from "./auth";
import { Db } from "./db";
import { ApiError, forbidden, notFound } from "./problem";

export type ProjectPermission = "READ" | "REVIEW" | "EDIT" | "ADMIN";
export const PERMISSION_RANK: Record<ProjectPermission, number> = { READ: 1, REVIEW: 2, EDIT: 3, ADMIN: 4 };
export const SEES_EVERY_PROJECT = new Set(["OWNER", "ADMIN"]);

export interface ProjectAccessInfo {
  /** projects this user may not see (restricted, and he is not on them) */
  hidden: readonly string[];
  /** his permission in each restricted project he can see (Owners / Admins: absent; they have full access) */
  restricted: ReadonlyMap<string, ProjectPermission | "FULL">;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const list = (ids: readonly string[]) => ids.map((i) => { if (!UUID.test(i)) throw new Error("bad project id"); return `'${i}'`; }).join(",");

/** ` AND <col> NOT IN (...)` for the projects this user may not see; "" when there are none (most organizations). Rows without a project
 *  (`col` NULL) are kept. */
export function notHidden(p: Principal, col: string): string {
  const h = p.access?.hidden ?? [];
  return h.length ? ` AND (${col} IS NULL OR ${col} NOT IN (${list(h)}))` : "";
}
/** the same for a column holding a video id */
export function videoNotHidden(p: Principal, col: string): string {
  const h = p.access?.hidden ?? [];
  return h.length ? ` AND ${col} NOT IN (SELECT hv.id FROM video_sources hv WHERE hv.project_id IN (${list(h)}))` : "";
}
/** the same for a column holding a reel id */
export function reelNotHidden(p: Principal, col: string): string {
  const h = p.access?.hidden ?? [];
  return h.length ? ` AND ${col} NOT IN (SELECT hr.id FROM reel_projects hr WHERE hr.project_id IN (${list(h)}))` : "";
}
/** a report (alias of report_jobs) leaves the list when its project, or ANY video its numbers came from, is hidden */
export function reportNotHidden(p: Principal, alias: string): string {
  const h = p.access?.hidden ?? [];
  return h.length ? ` AND (${alias}.project_id IS NULL OR ${alias}.project_id NOT IN (${list(h)}))
    AND NOT EXISTS (SELECT 1 FROM JSON_TABLE(COALESCE(${alias}.config, JSON_OBJECT()), '$.video_ids[*]' COLUMNS (vid CHAR(36) COLLATE utf8mb4_0900_ai_ci PATH '$')) hj
                      JOIN video_sources hv ON hv.id = hj.vid WHERE hv.project_id IN (${list(h)}))` : "";
}
/** a match leaves the list only when it has videos and every one of them is hidden (a match with no video stays) */
export function matchNotHidden(p: Principal, col: string): string {
  const h = p.access?.hidden ?? [];
  return h.length ? ` AND (NOT EXISTS (SELECT 1 FROM video_sources hm WHERE hm.match_id = ${col} AND hm.removed_at IS NULL)
    OR EXISTS (SELECT 1 FROM video_sources hm WHERE hm.match_id = ${col} AND hm.removed_at IS NULL AND hm.project_id NOT IN (${list(h)})))` : "";
}
/** a Library item (kind column, id column: reel, render, video, match, project) the user may not see leaves the list */
export function libraryItemNotHidden(p: Principal, kindCol: string, idCol: string): string {
  const h = p.access?.hidden ?? [];
  if (!h.length) return "";
  const l = list(h);
  return ` AND NOT (
      (${kindCol} = 'project' AND ${idCol} IN (${l}))
   OR (${kindCol} = 'video' AND ${idCol} IN (SELECT hv.id FROM video_sources hv WHERE hv.project_id IN (${l})))
   OR (${kindCol} = 'reel' AND ${idCol} IN (SELECT hr.id FROM reel_projects hr WHERE hr.project_id IN (${l})))
   OR (${kindCol} = 'render' AND ${idCol} IN (SELECT hj.id FROM render_jobs hj JOIN reel_projects hr ON hr.id = hj.reel_id WHERE hr.project_id IN (${l})))
   OR (${kindCol} = 'match' AND EXISTS (SELECT 1 FROM video_sources hm WHERE hm.match_id = ${idCol} AND hm.removed_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM video_sources hm WHERE hm.match_id = ${idCol} AND hm.removed_at IS NULL AND hm.project_id NOT IN (${l}))))`;
}
/** part of a cache key: what this user can see (two users of one organization may see different numbers) */
export const hiddenKey = (p: Principal) => (p.access?.hidden ?? []).slice().sort().join(",");
export const isHidden = (p: Principal, projectId: string | null | undefined) => !!projectId && (p.access?.hidden ?? []).includes(projectId);

export async function loadAccess(db: Db, userId: string, organizationId: string, role: string): Promise<ProjectAccessInfo> {
  const rows = await db.rows<RowDataPacket>(
    `SELECT p.id, a.permission FROM projects p LEFT JOIN project_acl a ON a.project_id = p.id AND a.user_id = ?
      WHERE p.organization_id = ? AND p.access = 'RESTRICTED'`, [userId, organizationId]);
  const restricted = new Map<string, ProjectPermission | "FULL">();
  const seen = new Set<string>();
  for (const r of rows) {
    const id = r.id as string;
    seen.add(id);
    if (SEES_EVERY_PROJECT.has(role)) { restricted.set(id, "FULL"); continue; }
    const perm = r.permission as ProjectPermission | null;
    if (!perm) continue;
    const had = restricted.get(id);
    if (!had || (had !== "FULL" && PERMISSION_RANK[perm] > PERMISSION_RANK[had])) restricted.set(id, perm);
  }
  return { hidden: [...seen].filter((id) => !restricted.has(id)), restricted };
}

/** where the project of each kind of id is found (the id is the first ?, the organization the second) */
const OWNER_SQL: Record<string, string> = {
  video: "SELECT project_id AS pid FROM video_sources WHERE id = ? AND organization_id = ?",
  run: "SELECT v.project_id AS pid FROM pipeline_runs r JOIN video_sources v ON v.id = r.video_id WHERE r.id = ? AND v.organization_id = ?",
  track: "SELECT v.project_id AS pid FROM tracks t JOIN video_sources v ON v.id = t.video_id WHERE t.id = ? AND v.organization_id = ?",
  reel: "SELECT project_id AS pid FROM reel_projects WHERE id = ? AND organization_id = ?",
  render: "SELECT r.project_id AS pid FROM render_jobs j JOIN reel_projects r ON r.id = j.reel_id WHERE j.id = ? AND j.organization_id = ?",
  project: "SELECT id AS pid FROM projects WHERE id = ? AND organization_id = ?",
  calibration: "SELECT v.project_id AS pid FROM pitch_calibrations c JOIN video_sources v ON v.id = c.video_id WHERE c.id = ? AND v.organization_id = ?",
  ballmark: "SELECT v.project_id AS pid FROM ball_marks b JOIN video_sources v ON v.id = b.video_id WHERE b.id = ? AND b.organization_id = ?",
  lineup: "SELECT v.project_id AS pid FROM lineup_cards l JOIN video_sources v ON v.id = l.video_id WHERE l.id = ? AND l.organization_id = ?",
  link: `SELECT v.project_id AS pid FROM track_links l JOIN pipeline_runs r ON r.id = l.run_id JOIN video_sources v ON v.id = r.video_id
          WHERE l.id = ? AND v.organization_id = ?`,
  upload: "SELECT v.project_id AS pid FROM upload_sessions u JOIN video_sources v ON v.id = u.video_id WHERE u.id = ? AND u.organization_id = ?",
  sharelink: "SELECT a.project_id AS pid FROM share_links s JOIN assets a ON a.id = s.asset_id WHERE s.id = ? AND s.organization_id = ?",
  // a player report: its project, else the projects of the videos his numbers came from
  report: `SELECT COALESCE(j.project_id, v.project_id) AS pid FROM report_jobs j
             LEFT JOIN JSON_TABLE(COALESCE(j.config, JSON_OBJECT()), '$.video_ids[*]' COLUMNS (vid CHAR(36) COLLATE utf8mb4_0900_ai_ci PATH '$')) jt ON TRUE
             LEFT JOIN video_sources v ON v.id = jt.vid
            WHERE j.id = ? AND j.organization_id = ?`,
  // a match belongs to every project one of its videos is in; it is hidden only when all of them are
  match: "SELECT DISTINCT project_id AS pid FROM video_sources WHERE match_id = ? AND organization_id = ? AND removed_at IS NULL",
  // an archive bundle belongs to its own project, else the projects of its source videos
  archive: `SELECT COALESCE(ab.project_id, v.project_id) AS pid FROM archive_bundles ab
              LEFT JOIN JSON_TABLE(ab.video_ids, '$[*]' COLUMNS (vid CHAR(36) COLLATE utf8mb4_0900_ai_ci PATH '$')) jt ON TRUE
              LEFT JOIN video_sources v ON v.id = jt.vid
             WHERE ab.id = ? AND ab.organization_id = ?`,
};
/** route segment before an id -> kind */
const SEGMENT: Record<string, string> = {
  videos: "video", "analysis-runs": "run", tracks: "track", reels: "reel", renders: "render", projects: "project",
  "pitch-calibrations": "calibration", "ball-marks": "ballmark", "lineup-cards": "lineup", "track-links": "link", uploads: "upload",
  "share-links": "sharelink", reports: "report", matches: "match", archives: "archive",
};
/** Library `:kind` values -> kind */
const LIBRARY_KIND: Record<string, string> = { reel: "reel", render: "render", video: "video", match: "match", project: "project" };
/** body fields holding an id -> kind */
const BODY: Record<string, string> = {
  video_id: "video", source_video_id: "video", reel_id: "reel", project_id: "project", track_id: "track", run_id: "run", render_id: "render",
};
const LABEL: Record<string, string> = {
  video: "Video", run: "Analysis run", track: "Track", reel: "Reel", render: "Rendered file", project: "Project", calibration: "Pitch calibration",
  ballmark: "Ball mark", lineup: "Team sheet", link: "Track link", upload: "Upload", sharelink: "Share link", report: "Report", match: "Match",
  trash: "Trash entry", archive: "Archive bundle",
};
/** changes a Reviewer may make in a restricted project: identity decisions and notes */
const REVIEW_ROUTES = [/identity-decisions$/, /jersey-decisions$/, /\/decisions$/, /\/assignment$/, /\/notes(\/:noteId)?$/, /\/comments$/, /roster\/verify$/];

async function projectsOf(db: Db, kind: string, id: string, org: string): Promise<(string | null)[] | null> {
  if (kind === "trash") {
    const t = await db.one<RowDataPacket>("SELECT item_kind, item_id FROM library_deletions WHERE id = ? AND organization_id = ?", [id, org]);
    if (!t) return null;
    const k = LIBRARY_KIND[t.item_kind as string];
    return k ? projectsOf(db, k, t.item_id as string, org) : null;
  }
  const sql = OWNER_SQL[kind];
  if (!sql) return null;
  const rows = await db.rows<RowDataPacket>(sql, [id, org]);
  return rows.length ? rows.map((r) => (r.pid as string | null) ?? null) : null;
}

/** every (kind, id) a request names: route ids by the segment before them, Library `:kind/:id`, Trash entries, and body ids */
export function namedIds(template: string, params: Record<string, string>, body: unknown): [string, string][] {
  const out: [string, string][] = [];
  const segs = template.split("/").filter(Boolean);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (!s.startsWith(":")) continue;
    const name = s.slice(1);
    const value = params[name];
    if (typeof value !== "string" || !UUID.test(value)) continue;
    const prev = segs[i - 1] ?? "";
    if (name === "id" && prev === ":kind") { const k = LIBRARY_KIND[params.kind ?? ""]; if (k) out.push([k, value]); continue; }
    if (prev === "trash") { out.push(["trash", value]); continue; }
    // `/v1/tracks/:trackId/...` in the tracks controller is mounted at v1/tracks; the param name says the kind when the segment does not
    const kind = SEGMENT[prev] ?? ({ trackId: "track", videoId: "video", reelId: "reel", runId: "run", renderId: "render", matchId: "match", projectId: "project" } as Record<string, string>)[name];
    if (kind) out.push([kind, value]);
  }
  if (body && typeof body === "object" && !Array.isArray(body) && !Buffer.isBuffer(body)) {
    const b = body as Record<string, unknown>;
    for (const [k, kind] of Object.entries(BODY)) {
      const v = b[k];
      if (typeof v === "string" && UUID.test(v)) out.push([kind, v]);
    }
    if (typeof b.subject_kind === "string" && typeof b.subject_id === "string" && UUID.test(b.subject_id)) {
      const sk = ({ REEL: "reel", VIDEO: "video", MATCH: "match" } as Record<string, string>)[b.subject_kind];
      if (sk) out.push([sk, b.subject_id]);
    }
  }
  return out;
}

export async function enforceProjectAccess(db: Db, req: FastifyRequest, p: Principal): Promise<void> {
  const a = p.access;
  if (!a || (a.hidden.length === 0 && a.restricted.size === 0)) return;          // no restricted project in this organization
  const template = req.routeOptions?.url ?? "";
  const ids = namedIds(template, (req.params ?? {}) as Record<string, string>, req.body);
  const write = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  for (const [kind, id] of ids) {
    const pids = await projectsOf(db, kind, id, p.organizationId);
    if (!pids) continue;                                                          // not found: the handler answers that
    const real = pids.filter((x): x is string => !!x);
    if (real.length === 0) continue;
    const visible = real.filter((x) => !a.hidden.includes(x));
    // a report or archive carrying numbers/evidence from a hidden video is hidden; anything else is hidden when none of its projects can be seen
    if (visible.length === 0 || ((kind === "report" || kind === "archive") && visible.length < real.length)) throw notFound(LABEL[kind] ?? "Item");
    if (!write || SEES_EVERY_PROJECT.has(p.role)) continue;
    for (const pid of visible) {
      const perm = a.restricted.get(pid);
      if (!perm || perm === "FULL" || perm === "EDIT" || perm === "ADMIN") continue;  // an open project, or editor / manager there
      if (perm === "REVIEW" && REVIEW_ROUTES.some((r) => r.test(template))) continue;
      throw forbidden("PROJECT_READ_ONLY", perm === "REVIEW"
        ? "You are a reviewer on this project: you can check identities and write notes, not change it."
        : "You can view this project but not change it. Ask its manager for editor access.");
    }
  }
}

/** may this user manage who is on the project (Owner / Admin, or the project's Manager) */
export function canManageAccess(p: Principal, projectId: string): boolean {
  return SEES_EVERY_PROJECT.has(p.role) || p.access?.restricted.get(projectId) === "ADMIN";
}
export { ApiError };
