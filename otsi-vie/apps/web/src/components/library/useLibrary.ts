"use client";
/**
 * Page 09 Library / Project Center: the organization's real assets in one list — reels (GET /v1/reels), rendered reels as exports,
 * matches (GET /v1/matches), projects (GET /v1/projects: a project owns the videos uploaded into it and what is made from them),
 * uploaded videos (GET /v1/videos) and Library folders (GET /v1/library/folders: a folder only groups items, ADR-052) with which folder
 * each item is in (GET /v1/library/folder-items). Reports, shared items and templates are not produced yet, so their tabs count 0.
 * Search, filters and sorting run on this list.
 */
import type { FolderItemKind, FolderMembership, LibraryFolder, Match, Project, Reel, Video, OrgTemplate } from "@otsi-vie/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

export type Kind = "Reel" | "Report" | "Folder" | "Project" | "Match" | "Export" | "Video" | "Template";
/** the API name of each kind that can be filed in a folder (Library › Move to folder) */
export const ITEM_KIND: Partial<Record<Kind, FolderItemKind>> = { Reel: "reel", Export: "render", Video: "video", Match: "match", Project: "project" };
export interface Asset {
  key: string; id: string; kind: Kind; title: string; sub: string; durationUs: number | null; updated: string; created: string;
  status: "Published" | "Draft" | "Shared" | "Exported" | "Ready" | "Archived" | "Processing" | "Failed";
  player: string | null; videoId: string | null; matchId: string | null; competition: string | null; teams: string[];
  bytes: number | null; width: number | null; height: number | null; href: string | null; renderId: string | null; raw: Reel | Match | Project | Video | LibraryFolder | OrgTemplate;
  /** the Library folder it is filed in (null: none); a folder row: null */
  folderId: string | null;
  /** the member who created it (null: not recorded, e.g. matches) */
  createdBy: string | null;
  /** the project it belongs to (ADR-057: who may see it, its people); null for matches and folders, which belong to no project */
  project: Project | null;
}

export const TABS: [string, string, Kind[] | null][] = [
  ["grid", "All Assets", null], ["grid", "Reels", ["Reel"]], ["doc", "Reports", ["Report"]], ["ball", "Matches", ["Match"]],
  ["fold", "Folders", ["Folder"]], ["dl", "Exports", ["Export"]], ["user", "Shared With Me", null], ["tmpl", "Templates", ["Template"]],
];
export const RANGES: [string, string, number | null][] = [["7d", "Last 7 Days", 7], ["30d", "Last 30 Days", 30], ["90d", "Last 3 Months", 90], ["all", "All Time", null]];

export interface Filters { q: string; type: Kind | "all"; competition: string; team: string; range: string; creator: string }
export const NO_FILTERS: Filters = { q: "", type: "all", competition: "all", team: "all", range: "90d", creator: "any" };

const club = (m: Match, side: "home" | "away") => m[side]?.short_name ?? m[side]?.name ?? null;
const matchTitle = (m: Match) => `${club(m, "home") ?? "—"} vs ${club(m, "away") ?? "—"}`;

function assets(reels: Reel[], matches: Match[], projects: Project[], videos: Video[], folders: LibraryFolder[], filed: FolderMembership[], templates: OrgTemplate[] = []): Asset[] {
  const byMatch = new Map(matches.map((m) => [m.id, m]));
  const vidMatch = new Map(videos.map((v) => [v.id, v.match_id]));
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const vidProject = new Map(videos.map((v) => [v.id, byProject.get(v.project_id) ?? null]));
  const out: Omit<Asset, "project">[] = [];
  for (const r of reels) {
    const m = byMatch.get(vidMatch.get(r.video_id) ?? "") ?? null;
    const good = r.last_good_render ?? null, rendered = !!good?.has_output;
    const res = (good?.result ?? {}) as { height?: number; width?: number; duration_s?: number; bytes?: number };
    const base = { videoId: r.video_id, matchId: m?.id ?? null, competition: m?.competition ?? null, teams: m ? [club(m, "home"), club(m, "away")].filter(Boolean) as string[] : [],
      player: r.player?.display_name ?? null, created: r.created_at, raw: r, createdBy: r.created_by ?? null };
    out.push({ ...base, key: `reel-${r.id}`, id: r.id, kind: "Reel", title: r.name, sub: `${r.player?.display_name ?? "—"} · ${r.clips.length} clips`,
      durationUs: r.duration_us || null, updated: r.updated_at, status: r.latest_render && ["QUEUED", "RUNNING"].includes(r.latest_render.state) ? "Processing" : rendered ? "Exported" : "Draft",
      bytes: null, width: null, height: null, href: `/reels/${r.id}`, renderId: null, folderId: null });
    if (rendered) {
      out.push({ ...base, key: `export-${good!.id}`, id: good!.id, kind: "Export", title: `${r.name} · rendered`, sub: `${r.player?.display_name ?? "—"} · MP4`,
        durationUs: res.duration_s ? Math.round(res.duration_s * 1e6) : r.duration_us || null, updated: good!.completed_at ?? r.updated_at, status: "Exported",
        bytes: res.bytes ?? null, width: res.width ?? null, height: res.height ?? null, href: `/reels/${r.id}`, renderId: good!.id, folderId: null });
    }
  }
  for (const m of matches) {
    const when = m.kickoff_at ?? null;
    out.push({ key: `match-${m.id}`, id: m.id, kind: "Match", title: matchTitle(m), sub: [m.competition, when ? new Date(when).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null].filter(Boolean).join(" · ") || "Match",
      durationUs: null, updated: when ?? "", created: when ?? "", status: m.video_ids.length ? "Ready" : "Draft", player: null, videoId: m.video_ids[0] ?? null, matchId: m.id,
      competition: m.competition, teams: [club(m, "home"), club(m, "away")].filter(Boolean) as string[], bytes: null, width: null, height: null,
      href: m.video_ids[0] ? `/videos/${m.video_ids[0]}/analyze` : null, renderId: null, raw: m, createdBy: null, folderId: null });
  }
  for (const fo of folders) {
    out.push({ key: `folder-${fo.id}`, id: fo.id, kind: "Folder", title: fo.name, sub: `${fo.item_count} item${fo.item_count === 1 ? "" : "s"}`, durationUs: null,
      updated: fo.updated_at, created: fo.created_at, status: "Ready", player: null, videoId: null, matchId: null, competition: null, teams: [], bytes: null,
      width: null, height: null, href: null, renderId: null, raw: fo, createdBy: fo.created_by, folderId: null });
  }
  for (const p of projects) {
    out.push({ key: `project-${p.id}`, id: p.id, kind: "Project", title: p.name, sub: `${p.video_count} video${p.video_count === 1 ? "" : "s"}${p.description ? ` · ${p.description}` : ""}`,
      durationUs: null, updated: p.updated_at, created: p.created_at, status: p.status === "ARCHIVED" ? "Archived" : "Ready", player: null, videoId: null, matchId: null,
      competition: null, teams: [], bytes: null, width: null, height: null, href: `/upload?project=${p.id}`, renderId: null, raw: p, createdBy: p.created_by ?? null, folderId: null });
  }
  for (const v of videos) {
    const m = byMatch.get(v.match_id ?? "") ?? null;
    out.push({ key: `video-${v.id}`, id: v.id, kind: "Video", title: v.title ?? v.original_filename ?? "Untitled video", sub: m ? matchTitle(m) : "Not linked to a match",
      durationUs: v.duration_us, updated: v.updated_at, created: v.created_at, status: v.state === "INGESTED" ? "Ready" : v.state === "FAILED" || v.state === "QUARANTINED" ? "Failed" : "Processing",
      player: null, videoId: v.id, matchId: v.match_id, competition: m?.competition ?? null, teams: m ? [club(m, "home"), club(m, "away")].filter(Boolean) as string[] : [],
      bytes: v.byte_size, width: v.width, height: v.height, href: `/videos/${v.id}/analyze`, renderId: null, raw: v, createdBy: v.created_by ?? null, folderId: null });
  }
  for (const t of templates) {
    out.push({ key: `template-${t.id}`, id: t.id, kind: "Template", title: t.name, sub: `${t.kind} · ${t.description || (t.is_builtin ? "Built-in preset" : "Organization template")}`,
      durationUs: null, updated: t.updated_at, created: t.created_at, status: "Ready", player: null, videoId: null, matchId: null,
      competition: null, teams: [], bytes: null, width: null, height: null, href: "/studio", renderId: null, raw: t, createdBy: t.created_by, folderId: null });
  }
  const where = new Map(filed.map((m) => [`${m.item_kind}:${m.item_id}`, m.folder_id]));
  return out.map((a) => {
    const k = ITEM_KIND[a.kind], id = a.kind === "Export" ? a.renderId : a.id;
    const project = a.kind === "Project" ? (a.raw as Project) : a.kind === "Video" || a.kind === "Reel" || a.kind === "Export" ? vidProject.get(a.videoId ?? "") ?? null : null;
    return { ...a, project, folderId: k && id ? where.get(`${k}:${id}`) ?? null : null };
  });
}

export function useLibrary() {
  const [all, setAll] = useState<Asset[] | null | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      const [reels, matches, projects, videos, folders, filed, templates] = await Promise.all([api<Reel[]>("/v1/reels"), api<Match[]>("/v1/matches"), api<Project[]>("/v1/projects"),
        api<Video[]>("/v1/videos"), api<LibraryFolder[]>("/v1/library/folders"), api<FolderMembership[]>("/v1/library/folder-items"), api<OrgTemplate[]>("/v1/templates").catch(() => [])]);
      setAll(assets(reels, matches, projects, videos, folders, filed, templates));
    } catch { setAll(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const competitions = useMemo(() => [...new Set((all ?? []).map((a) => a.competition).filter((c): c is string => !!c))].sort(), [all]);
  const teams = useMemo(() => [...new Set((all ?? []).flatMap((a) => a.teams))].sort(), [all]);
  return { all, load, competitions, teams };
}

/** the list shown: the tab and filters, and — when a folder is open — only what is filed in that folder */
export function apply(all: Asset[], tab: number, f: Filters, desc: boolean, folder: string | null = null): Asset[] {
  const kinds = TABS[tab]![2];
  // Shared With Me (ADR-057): what is in someone else's project you were put on
  const shared = TABS[tab]![1] === "Shared With Me";
  const days = RANGES.find((r) => r[0] === f.range)?.[2] ?? null;
  const since = days === null ? 0 : Date.now() - days * 864e5;
  const q = f.q.trim().toLowerCase();
  return all.filter((a) => (folder === null || a.folderId === folder) && (kinds === null || kinds.includes(a.kind)) && (!shared || !!a.project?.shared_with_me) && (f.type === "all" || a.kind === f.type)
      && (f.competition === "all" || a.competition === f.competition) && (f.team === "all" || a.teams.includes(f.team))
      && (f.creator === "any" || a.createdBy === f.creator)
      && (!a.updated || since === 0 || Date.parse(a.updated) >= since)
      && (!q || `${a.title} ${a.sub} ${a.player ?? ""} ${a.competition ?? ""} ${a.teams.join(" ")}`.toLowerCase().includes(q)))
    .sort((x, y) => (desc ? -1 : 1) * (x.updated || "").localeCompare(y.updated || ""));
}
