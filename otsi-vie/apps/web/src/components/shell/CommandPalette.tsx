"use client";
/**
 * Page 08 Command palette (SOT, Palette.dc.html).
 *
 * A centred modal (Ctrl/Cmd + K, or the search button in the header).
 * One field finds, in this order:
 *   Players   the organization's players (GET /v1/player-list), the
 *             sub-line is the team sheet's "#jersey · position · team"
 *             (or the position, or the OTSI Player ID)
 *   Matches   the organization's videos (GET /v1/videos), the sub-line
 *             is the event count from GET /v1/videos/:id/events
 *             (passes + ball won + shots + pressures + set pieces +
 *             goals); a video that was never analysed has no sub-line
 *   Actions   what the person's role may do, from lib/commands.ts
 *             (upload, Jobs Center, keyboard shortcuts, and the rest)
 * The Search / Assistant seg switches to the local assistant (Tab does
 * the same). Arrow keys move, Enter opens, Escape closes. Ctrl/Cmd + J
 * opens the Jobs Center from anywhere.
 *
 * The SOT's palette searches a player, a match or an action. The old
 * palette's Pages group, its Reels / Projects / Moments / Markers
 * hits, its Library row and its Smart Search filters are not in the
 * SOT, so they are not here; moments and markers are still found from
 * the Library's own search and from Analysis.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { MatchEvents, PlayerListEntry, Video } from "@otsi-vie/contracts";
import { Activity, Clapperboard, Download, Play, Receipt, Scissors, Search, Settings, Shield, User, Users, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api } from "@/lib/api";
import { commands, JOBS_HREF, KEYMAP_HREF, matchCommands, type Command } from "@/lib/commands";
import { openJobsCenter } from "@/lib/jobsLive";
import { openKeymap } from "@/lib/keymap";
import { LocalAssistant } from "./LocalAssistant";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { EMPTY_CTX, readCtx } from "@/lib/workContext";

/** the player's sub-line: the team sheet's "#jersey · position · team", else the position, else the OTSI Player ID */
function playerSub(p: PlayerListEntry): string {
  const lt = p.profile.latest_team;
  const parts = [lt?.jersey_number ? `#${lt.jersey_number}` : null, lt?.position ?? p.profile.position, lt?.team].filter(Boolean) as string[];
  if (parts.length) return parts.join(" · ");
  return p.canonical_otsi_id ?? "";
}

/** the match's event count: passes + ball won + shots + pressures + set pieces + goals */
function eventCount(ev: MatchEvents | null): number | null {
  if (!ev || ev.state !== "READY") return null;
  return ev.passes.length + ev.changes.length + ev.shots.length + ev.pressures.length + ev.set_pieces.length + ev.goals.length;
}

const ICONS: Record<string, ReactElement> = {
  player: <User className="h-3.5 w-3.5" style={{ color: "rgb(var(--primary))" }} />,
  match: <Clapperboard className="h-3.5 w-3.5 text-muted" />,
  upload: <Download className="h-3.5 w-3.5 text-muted" />,
  jobs: <Activity className="h-3.5 w-3.5 text-muted" />,
  keys: <span style={{ width: 14, textAlign: "center", fontWeight: 600, color: "rgb(var(--muted))" }}>?</span>,
  players: <User className="h-3.5 w-3.5 text-muted" />,
  matches: <Clapperboard className="h-3.5 w-3.5 text-muted" />,
  admin: <Settings className="h-3.5 w-3.5 text-muted" />,
  wallet: <Wallet className="h-3.5 w-3.5 text-muted" />,
  billing: <Receipt className="h-3.5 w-3.5 text-muted" />,
  team: <Users className="h-3.5 w-3.5 text-muted" />,
  security: <Shield className="h-3.5 w-3.5 text-muted" />,
  continue: <Play className="h-3.5 w-3.5 text-muted" />,
  studio: <Scissors className="h-3.5 w-3.5 text-muted" />,
};

/** the action's label and hint as the person reads them; the SOT's upload and shortcuts labels differ from the commands table */
function actionLabel(t: Dictionary, c: Command): { label: string; hint: string; kbd: string | null } {
  const s = t.body.shell;
  if (c.id === "upload") return { label: s.cpUploadMatch, hint: "", kbd: null };
  if (c.id === "jobs") return { label: s.cpJobsCenter, hint: s.cpJobsCenterHint, kbd: "Ctrl J" };
  if (c.id === "keys") return { label: s.cpShortcuts, hint: "", kbd: "?" };
  const known: Record<string, { label: string; hint: string }> = {
    players: { label: s.cmdPlayers, hint: s.cmdPlayersHint },
    matches: { label: s.cmdMatches, hint: s.cmdMatchesHint },
    admin: { label: s.cmdAdmin, hint: s.cmdAdminHint },
    wallet: { label: s.cmdWallet, hint: s.cmdWalletHint },
    billing: { label: s.cmdBilling, hint: s.cmdBillingHint },
    team: { label: s.cmdTeam, hint: s.cmdTeamHint },
    security: { label: s.cmdSecurity, hint: s.cmdSecurityHint },
    continue: { label: s.cmdContinue, hint: s.cmdContinueHint },
    studio: { label: s.cmdStudio, hint: s.cmdStudioHint },
  };
  const k = known[c.id] ?? { label: c.label, hint: c.hint };
  return { ...k, kbd: null };
}

interface Row { key: string; group: string; label: string; sub: string | null; href: string; kbd: string | null; icon: string }

export function CommandPalette({ open: openProp, onOpenChange }: { open?: boolean; onOpenChange?: (o: boolean) => void } = {}) {
  const { t } = useLocale();
  const s = t.body.shell;
  const [openSelf, setOpenSelf] = useState(false);
  const open = openProp ?? openSelf;
  const setOpen = (o: boolean | ((x: boolean) => boolean)) => {
    const v = typeof o === "function" ? o(open) : o;
    if (onOpenChange) onOpenChange(v); else setOpenSelf(v);
  };
  const [assistant, setAssistant] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [players, setPlayers] = useState<PlayerListEntry[] | null>(null);
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [failed, setFailed] = useState(false);
  const router = useRouter();
  const { organization } = useAuth();
  const ctx = useMemo(() => (open ? readCtx() : EMPTY_CTX), [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        const el = e.target as HTMLElement | null;
        if (el?.closest("input, select, textarea, [contenteditable]")) return;
        e.preventDefault(); openJobsCenter();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // the players and matches, fetched when the palette opens; the event counts are best effort, capped at 10 videos
  useEffect(() => {
    if (!open) return;
    let dead = false;
    setFailed(false);
    void api<PlayerListEntry[]>("/v1/player-list").then(
      (l) => { if (!dead) setPlayers(l); },
      () => { if (!dead) { setPlayers([]); setFailed(true); } },
    );
    void api<Video[]>("/v1/videos").then(
      async (vs) => {
        if (dead) return;
        setVideos(vs);
        const shown = vs.filter((v) => v.analysis).slice(0, 10);
        const entries = await Promise.all(shown.map(async (v) => {
          try {
            const ev = await api<MatchEvents>(`/v1/videos/${v.id}/events`);
            return [v.id, eventCount(ev)] as const;
          } catch { return [v.id, null] as const; }
        }));
        if (!dead) setCounts(Object.fromEntries(entries));
      },
      () => { if (!dead) { setVideos([]); setFailed(true); } },
    );
    return () => { dead = true; };
  }, [open ]);

  const rows = useMemo<Row[]>(() => {
    const n = q.trim().toLowerCase();
    const match = (hay: string) => !n || hay.toLowerCase().includes(n);
    const playerRows: Row[] = (players ?? [])
      .filter((p) => match(`${p.display_name} ${p.canonical_otsi_id ?? ""} ${p.profile.position ?? ""}`))
      .map((p) => ({
        key: `player-${p.player_id}`, group: s.groupPlayer, label: p.display_name, sub: playerSub(p),
        href: `/reports/players/${encodeURIComponent(p.canonical_otsi_id ?? p.player_id)}`, kbd: null, icon: "player",
      }));
    const matchRows: Row[] = (videos ?? [])
      .filter((v) => match(`${v.title ?? ""} ${v.original_filename ?? ""}`))
      .map((v) => {
        const c = counts[v.id] ?? null;
        const sub = c === null ? null : c === 1 ? s.cpEventOne : s.cpEvents.replace("{a}", String(c));
        return {
          key: `match-${v.id}`, group: s.groupMatch, label: v.title ?? v.original_filename ?? "",
          sub, href: `/analysis?video=${v.id}`, kbd: null, icon: "match",
        };
      });
    const actionRows: Row[] = matchCommands(commands(ctx), organization?.role, q).map((c) => {
      const l = actionLabel(t, c);
      return {
        key: `action-${c.id}`, group: s.cpActions,
        label: c.id === "jobs" && l.hint ? `${l.label} · ${l.hint}` : l.label,
        sub: null, href: c.href, kbd: l.kbd, icon: c.id,
      };
    });
    return [...playerRows, ...matchRows, ...actionRows];
  }, [q, players, videos, counts, ctx, organization?.role, t, s]);

  useEffect(() => setCursor(0), [q, players, videos]);
  useEffect(() => { if (!open) { setQ(""); setPlayers(null); setVideos(null); setCounts({}); setAssistant(false); } }, [open ]);

  const go = (row: Row) => {
    setOpen(false);
    if (row.href === KEYMAP_HREF) { openKeymap(); return; }
    if (row.href === JOBS_HREF) { openJobsCenter(); return; }
    router.push(row.href);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/85" />
        <Dialog.Content data-palette aria-label={s.cpTitle}
          className="modal fixed left-1/2 top-24 z-50 w-[min(720px,calc(100vw-32px))] -translate-x-1/2"
          style={{ width: "min(720px, calc(100vw - 32px))" }}
          onKeyDown={(e) => {
            if (assistant || e.target instanceof HTMLButtonElement) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            if (e.key === "Enter" && rows[cursor]) { e.preventDefault(); go(rows[cursor]); }
            if (e.key === "Tab") { e.preventDefault(); setAssistant(true); }
          }}>
          <Dialog.Title className="sr-only">{s.cpTitle}</Dialog.Title>
          <Dialog.Description className="sr-only">{s.paletteDesc}</Dialog.Description>
          <div className="flex h-[52px] items-center gap-2.5 border-b border-line px-3.5">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <label htmlFor="cq" className="sr-only">{s.cpPlaceholder}</label>
            <input id="cq" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={s.cpPlaceholder}
              aria-label={s.paletteSearchAria} role="combobox" aria-expanded="true" aria-controls="palette-results" data-palette-input
              aria-activedescendant={rows[cursor] ? `palette-${cursor}` : undefined}
              className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
            <div className="seg" role="group" aria-label={s.cpTitle}>
              <button type="button" className={!assistant ? "on" : ""} onClick={() => setAssistant(false)}>{s.paletteSearchAria}</button>
              <button type="button" className={assistant ? "on" : ""} onClick={() => setAssistant(true)}>{s.paletteAssistant}</button>
            </div>
          </div>
          {assistant ? <LocalAssistant key={organization?.organization_id} navigate={(href) => { setOpen(false); router.push(href); }} /> : <>
          <div className="flex flex-col gap-px px-2 py-1.5">
            {rows.length === 0 && (
              <p className="t-body px-2.5 py-4 text-center text-muted">
                {failed ? s.paletteUnreachable : q.trim().length >= 1 ? s.paletteNoMatch.replace("{a}", q.trim()) : s.paletteTypeMore}
              </p>
            )}
            {rows.map((r, i) => (
              <div key={r.key}>
                {(i === 0 || rows[i - 1]!.group !== r.group) && <p role="presentation" className="eb px-2.5 pb-1 pt-2">{r.group}</p>}
                <div id={`palette-${i}`} role="option" aria-selected={i === cursor} data-palette-row={r.key}
                  onMouseEnter={() => setCursor(i)} onClick={() => go(r)}
                  className={`lr cursor-pointer rounded-md border-0 ${i === cursor ? "bg-raised" : ""}`}>
                  {ICONS[r.icon] ?? ICONS.match}
                  <span className="min-w-0 flex-1 truncate text-sm font-normal">{r.label}</span>
                  {r.sub && <span className="t-small shrink-0 truncate text-muted">{r.sub}</span>}
                  {r.kbd && <span className="vie-kbd shrink-0">{r.kbd}</span>}
                  {!r.kbd && i === cursor && <span className="vie-kbd shrink-0">Enter</span>}
                </div>
              </div>
            ))}
          </div>
          {failed && <p className="t-small px-3.5 pb-2 text-amber">{s.paletteUnreachable}</p>}
          <div className="mt-auto flex items-center gap-3.5 border-t border-line bg-panel px-3.5 py-2.5 text-muted">
            <span className="t-small"><span className="vie-kbd">↑</span> <span className="vie-kbd">↓</span> {s.cpFooterMove}</span>
            <span className="t-small"><span className="vie-kbd">Enter</span> {s.cpFooterOpen}</span>
            <span className="t-small"><span className="vie-kbd">Tab</span> {s.cpFooterAssistant}</span>
          </div>
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
