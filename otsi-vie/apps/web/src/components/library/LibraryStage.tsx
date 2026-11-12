"use client";
/**
 * SOT rebuild page 14 (alphabetical), Library: the SOT's three-column
 * layout — the left panel (Match + Visual overlays + Team filter +
 * Time range, 272px), the centre (Library header, the selected video,
 * search and the items table), and the right inspector (Collections +
 * Folders + Smart bins + Saved views + Access, 260px).
 *
 * The centre table shows the library's content: matches, players,
 * reels and reports. A match's Details is its event count (GET
 * /v1/videos/:id/events, passes + ball won + shots + pressures +
 * set pieces + goals); a player's is "#jersey · position · team"
 * (GET /v1/player-list); a reel's is its clip count. Folders,
 * projects, exports and templates are not rows here — the SOT's
 * Library is a content library; folders live in the right inspector,
 * exports in Export, projects in Upload. The old tabbed Library
 * (LeftPanel / LibraryMain / LibraryTree / SelectedItem) is not
 * routed by this page any more; the files stay in the repo.
 */
import type { Match, MatchEvents, PlayerListEntry } from "@otsi-vie/contracts";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api } from "@/lib/api";
import { recallVideo } from "@/lib/currentVideo";
import { useLocale } from "@/lib/i18n";
import { LibraryCentre, type LibraryItem, type LibraryItemKind } from "./LibraryCentre";
import { LibraryLeft } from "./LibraryLeft";
import { LibraryRight } from "./LibraryRight";
import { useLibraryFacts } from "./LibraryTable";
import { useLibrary } from "./useLibrary";
import type { TeamSide } from "./LeftPanel";
import type { TimeRange } from "./LeftPanel";

const club = (m: Match, side: "home" | "away") => m[side]?.short_name ?? m[side]?.name ?? null;
const matchTitle = (m: Match) => `${club(m, "home") ?? "—"} vs ${club(m, "away") ?? "—"}`;
/** the player's sub-line: the team sheet's "#jersey · position · team", else the position, else the OTSI Player ID */
const playerSub = (p: PlayerListEntry): string => {
  const lt = p.profile.latest_team;
  const parts = [lt?.jersey_number ? `#${lt.jersey_number}` : null, lt?.position ?? p.profile.position, lt?.team].filter(Boolean) as string[];
  if (parts.length) return parts.join(" · ");
  return p.canonical_otsi_id ?? "";
};
const eventCount = (ev: MatchEvents | null): number | null => {
  if (!ev || ev.state !== "READY") return null;
  return (ev.passes?.length ?? 0) + (ev.changes?.length ?? 0) + (ev.shots?.length ?? 0) + (ev.pressures?.length ?? 0) + (ev.set_pieces?.length ?? 0) + (ev.goals?.length ?? 0);
};

function Stage() {
  const sp = useSearchParams();
  const { all, load } = useLibrary();
  const facts = useLibraryFacts(all);
  const { organization } = useAuth();
  const [players, setPlayers] = useState<PlayerListEntry[] | null>(null);
  useEffect(() => { void api<PlayerListEntry[]>("/v1/player-list").then(setPlayers, () => setPlayers([])); }, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [collection, setCollection] = useState<LibraryItemKind | "all">("all");
  const [q, setQ] = useState(() => sp.get("q") ?? "");
  const [typeFilter, setTypeFilter] = useState<LibraryItemKind | "all">("all");
  const [matchFilter, setMatchFilter] = useState("all");
  const [accessFilter, setAccessFilter] = useState<"all" | "ORGANIZATION" | "RESTRICTED">("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [team, setTeam] = useState<TeamSide>("all");
  const [range, setRange] = useState<TimeRange>("full");
  const [match, setMatch] = useState<Match | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((t: string) => { setNote(t); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNote(null), 3500); }, []);
  const { t: dict } = useLocale();
  const d = dict.body.library;

  const matches = useMemo(() => (all ?? []).filter((a) => a.kind === "Match").map((a) => a.raw as Match), [all]);
  const folders = useMemo(() => (all ?? []).filter((a) => a.kind === "Folder").map((a) => a.raw as import("@otsi-vie/contracts").LibraryFolder), [all]);

  // the event count of each match's first video (the table's Details column)
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let live = true;
    const ids = matches.map((m) => m.video_ids[0]).filter((v): v is string => !!v);
    Promise.all(ids.map((v) => api<MatchEvents>(`/v1/videos/${v}/events`).then((ev) => [v, eventCount(ev)] as const, () => [v, null] as const)))
      .then((rows) => { if (live) setCounts(new Map(rows.filter(([, n]) => n !== null) as [string, number][])); });
    return () => { live = false; };
  }, [matches]);

  const items: LibraryItem[] = useMemo(() => {
    const out: LibraryItem[] = [];
    for (const a of all ?? []) {
      if (a.kind === "Match") {
        const m = a.raw as Match, vid = m.video_ids[0] ?? null, n = vid ? counts.get(vid) : undefined;
        out.push({ key: a.key, kind: "Match", title: matchTitle(m), details: n === undefined ? "—" : `${n} events`, videoId: vid, href: a.href, asset: a, player: null });
      } else if (a.kind === "Reel") {
        const r = a.raw as import("@otsi-vie/contracts").Reel;
        out.push({ key: a.key, kind: "Reel", title: a.title, details: d.lbReelGenerated, videoId: r.video_id, href: a.href, asset: a, player: null });
      } else if (a.kind === "Report") {
        out.push({ key: a.key, kind: "Report", title: a.title, details: a.sub, videoId: a.videoId, href: a.href, asset: a, player: null });
      }
    }
    for (const p of players ?? []) {
      out.push({ key: `player-${p.player_id}`, kind: "Player", title: p.display_name, details: playerSub(p), videoId: null, href: `/reports/players/${p.canonical_otsi_id ?? p.player_id}`, asset: null, player: p });
    }
    return out;
  }, [all, players, counts, d]);

  const shown = useMemo(() => items.filter((i) => collection === "all" || i.kind === collection), [items, collection]);
  const sel = items.find((i) => i.key === selected) ?? null;
  const selMatch = useMemo(() => (sel?.kind === "Match" ? (sel.asset!.raw as Match) : match), [sel, match]);
  const videoId = sel?.videoId ?? selMatch?.video_ids[0] ?? null;

  // nothing chosen yet: start on the match of the video open on another page, so the left panel is not empty
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current || !all || selected) return;
    picked.current = true;
    const id = recallVideo(organization?.organization_id);
    const m = id ? matches.find((x) => x.video_ids.includes(id)) : undefined;
    if (m) { setMatch(m); setSelected(`match-${m.id}`); }
    else if (matches[0]) setMatch(matches[0]!);
  }, [all, selected, organization?.organization_id, matches]);

  const onMatch = useCallback((m: Match | null) => {
    setMatch(m);
    if (m) setSelected(`match-${m.id}`);
  }, []);

  const countsByKind = {
    all: items.length, videos: items.filter((i) => i.kind === "Match").length,
    players: items.filter((i) => i.kind === "Player").length, reels: items.filter((i) => i.kind === "Reel").length,
    reports: items.filter((i) => i.kind === "Report").length,
  };

  return (
    <div className="flex min-h-0 flex-1" data-page="library" data-stage>
      <LibraryLeft match={selMatch} matches={matches} videoId={videoId} onMatch={onMatch} team={team} setTeam={setTeam} range={range} setRange={setRange} say={say} />
      <LibraryCentre items={shown} all={all ?? []} facts={facts} selected={selected} onSelect={setSelected} videoId={videoId}
        q={q} setQ={setQ} typeFilter={typeFilter} setTypeFilter={setTypeFilter} matchFilter={matchFilter} setMatchFilter={setMatchFilter}
        accessFilter={accessFilter} setAccessFilter={setAccessFilter}
        matches={matches.map((m) => ({ id: m.id, title: matchTitle(m) }))} folders={folders} checked={checked} setChecked={setChecked} reload={load} say={say} />
      <LibraryRight counts={countsByKind} collection={collection} setCollection={setCollection} folders={folders} onNewFolder={() => setNewFolder(true)}
        players={players} reportCount={countsByKind.reports} selected={sel} setQ={setQ} onNewBin={() => undefined} />
      {newFolder && <NewFolderInline close={() => setNewFolder(false)} done={async () => { setNewFolder(false); await load(); }} />}
      {note && <div role="status" className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-primary bg-panel px-3 py-2 text-sm shadow-xl">{note}</div>}
    </div>
  );
}

/** a new Library folder (the right inspector's + button) */
function NewFolderInline({ close, done }: { close: () => void; done: () => Promise<void> }) {
  const { t: dict } = useLocale();
  const d = dict.body.library;
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    try { await api("/v1/library/folders", { method: "POST", json: { name: name.trim() } }); await done(); }
    catch (e) { setErr(e instanceof Error ? e.message : d.newFolderFailed); }
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" role="dialog" aria-label={d.newFolder}>
      <div className="w-[min(440px,94vw)] rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
        <h2 className="text-base font-normal">{d.newFolder}</h2>
        <p className="mb-3 text-xs text-muted">{d.newFolderDesc}</p>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void go(); else setErr(d.newFolderNameNeeded); }} className="space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} placeholder={d.newFolderName} aria-label={d.newFolderName} autoFocus
            className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-ink" />
          {err && <p role="alert" className="text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="rounded-ctl border border-line px-3 py-1.5">{dict.common.cancel}</button>
            <button type="submit" className="rounded-ctl bg-primary px-3 py-1.5 font-normal text-white">{d.createFolder}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function LibraryStage() {
  return <Suspense><Stage /></Suspense>;
}
