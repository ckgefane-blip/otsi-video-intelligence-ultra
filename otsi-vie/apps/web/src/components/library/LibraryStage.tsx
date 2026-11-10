"use client";
/**
 * Page 09 Library / Project Center on the approved composition (corrected reference 09_LIBRARY_PROJECT_CENTER). The tab can come from
 * the address (?tab=matches etc.), an open folder too (?folder=<id>); the selected asset's linked match feeds the left panel and the details.
 * v3 Phase A.14 (ADR-073): the left panel's Browse view is the Library tree; which view is open is kept per browser.
 */
import type { Match, Member } from "@otsi-vie/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { DesignStage, T, u } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { recallVideo } from "@/lib/currentVideo";
import { LeftPanel, type TeamSide } from "./LeftPanel";
import { LibraryMain } from "./LibraryMain";
import { LibraryTree } from "./LibraryTree";
import { SelectedItem } from "./SelectedItem";
import { apply, NO_FILTERS, TABS, useLibrary, type Filters } from "./useLibrary";

const WRITERS = ["OWNER", "ADMIN", "ANALYST", "EDITOR"];
const LEFT_KEY = "otsi-vie.library-left";

export function LibraryStage() {
  const sp = useSearchParams(), want = sp.get("tab"), q0 = sp.get("q");   // ?q=: a search to start with (e.g. a player's name from his report)
  const { all, load, competitions, teams } = useLibrary();
  const { organization } = useAuth();
  const [tab, setTab] = useState(() => Math.max(0, TABS.findIndex(([, l]) => l.toLowerCase().replace(/\s+/g, "-") === want)));
  const [f, setF] = useState<Filters>(() => (q0 ? { ...NO_FILTERS, q: q0, range: "all" } : NO_FILTERS));
  const [desc, setDesc] = useState(true);
  const [selected, select] = useState<string | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const router = useRouter(), path = usePathname();
  const folder = sp.get("folder");
  /** opening a folder is part of the address, so Back and a reload keep it */
  const setFolder = useCallback((id: string | null) => {
    const q = new URLSearchParams(sp.toString());
    if (id) q.set("folder", id); else q.delete("folder");
    router.push(q.size ? `${path}?${q.toString()}` : path);
  }, [sp, path, router]);
  // a folder that no longer exists (deleted) closes
  const live = !folder || !all || all.some((a) => a.kind === "Folder" && a.id === folder);
  const shown = useMemo(() => (all ? apply(all, tab, f, desc, live ? folder : null) : []), [all, tab, f, desc, folder, live]);
  // nothing chosen yet: start on the match of the video open on another page (v3 Phase 0, P9), so the left panel is not empty
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current || !all || selected) return;
    picked.current = true;
    const id = recallVideo(organization?.organization_id);
    const m = id ? all.find((a) => a.kind === "Match" && (a.raw as { video_ids?: string[] }).video_ids?.includes(id)) : undefined;
    if (m) select(m.key);
  }, [all, selected, organization?.organization_id]);
  const asset = all?.find((a) => a.key === selected) ?? null;
  useEffect(() => {
    setMatch(null);
    if (asset?.matchId) void api<Match>(`/v1/matches/${asset.matchId}`).then(setMatch, () => setMatch(null));
  }, [asset?.matchId]);
  const canWrite = !!organization && WRITERS.includes(organization.role);
  const { me } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => { void api<Member[]>("/v1/members").then(setMembers, () => setMembers([])); }, []);
  const [side, setSide] = useState(0);
  const [trash, setTrash] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const [browse, setBrowseState] = useState(false);
  useEffect(() => { try { setBrowseState(localStorage.getItem(LEFT_KEY) === "browse"); } catch { /* private window */ } }, []);
  const setBrowse = useCallback((b: boolean) => { setBrowseState(b); try { localStorage.setItem(LEFT_KEY, b ? "browse" : "match"); } catch { /* private window */ } }, []);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // stable, so the memoised panels below do not re-render on every stage render (e.g. every search keystroke)
  const say = useCallback((t: string) => { setNote(t); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNote(null), 3500); }, []);
  const openTrash = useCallback(() => setTrash(true), []);
  const openNewFolder = useCallback(() => setNewFolder(true), []);
  const closeSelected = useCallback(() => select(null), []);
  const tree = useMemo(() => (
    <LibraryTree all={all} folder={live ? folder : null} setFolder={setFolder} tab={tab} setTab={setTab} canWrite={canWrite}
      openTrash={openTrash} newFolder={openNewFolder} say={say} version={all} />
  ), [all, folder, live, tab, canWrite, setFolder, setTab, openTrash, openNewFolder, say]);
  // the left panel's team filter is the table's Team filter set to the selected match's home or away club
  const clubLabel = (c: Match["home"]) => c?.short_name ?? c?.name ?? null;
  const teamSide: TeamSide = match && f.team !== "all" ? (f.team === clubLabel(match.home) ? "home" : f.team === clubLabel(match.away) ? "away" : "all") : "all";
  const setTeamSide = useCallback((t: TeamSide) => setF({ ...f, team: t === "all" || !match ? "all" : clubLabel(t === "home" ? match.home : match.away) ?? "all" }), [f, match]);
  const analysed = !!asset && (asset.kind === "Reel" || asset.kind === "Export");   // a reel exists only for an analysed video

  return (
    <DesignStage page="library">
      <LeftPanel match={match} analysed={analysed} side={side} setSide={setSide} team={teamSide} setTeam={setTeamSide} say={say}
        videoId={asset?.videoId ?? null} reelId={asset && (asset.kind === "Reel" || asset.kind === "Export") ? (asset.raw as { id: string }).id : null}
        browse={browse} setBrowse={setBrowse} tree={tree} />
      <LibraryMain all={all} shown={shown} tab={tab} setTab={setTab} f={f} setF={setF} desc={desc} setDesc={setDesc} selected={selected} select={select}
        competitions={competitions} teams={teams} reload={load} canWrite={canWrite} members={members} me={me?.user.id ?? null} say={say}
        folder={live ? folder : null} setFolder={setFolder} trash={trash} setTrash={setTrash} newFolder={newFolder} setNewFolder={setNewFolder} />
      {note && <T x={1983} y={466} size={16} color="#ffc66d" align="right"><span role="status">{note}</span></T>}
      <SelectedItem a={asset} match={match} onClose={closeSelected} reload={load} canWrite={canWrite} />
    </DesignStage>
  );
}
