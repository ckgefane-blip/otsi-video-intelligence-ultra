"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { hitHref, parseSmartQuery, SMART_HINT, type SearchHit, type SearchKind, type SearchResponse } from "@otsi-vie/contracts";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api } from "@/lib/api";
import { commands, KEYMAP_HREF, matchCommands } from "@/lib/commands";
import { openKeymap } from "@/lib/keymap";
import { PAGES } from "@/lib/pages";
import { LocalAssistant } from "./LocalAssistant";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { EMPTY_CTX, readCtx } from "@/lib/workContext";

/**
 * Global search and command palette (v3 Phase A.8, S03, ADR-070). Opened by the search button in the header or Ctrl/Cmd + K.
 * One field finds, in this order:
 *   Commands  what the person's role may do (upload, team, security, continue on the open match / reel), from lib/commands.ts
 *   Pages     the ten pages
 *   Matches, Players, Reels, Projects   what the organization recorded whose name matches (GET /v1/search, from 2 characters; the
 *             API applies the organization and project access)
 *   Library   "Search the Library for …" hands the words to the Library's own search
 * Arrow keys move, Enter opens, Escape closes.
 *
 * v3 B.10 (ADR-086): Smart Search. The API reads a search index, so it also finds the engine's moments (goal, shot, pass, ...: they open
 * Analysis at that time) and people's markers, and understands filters typed in the field (type:, event:, is:). A filter it does not
 * understand is said back, never guessed.
 */
/** the group heading for each kind of recorded hit (ADR-139) */
const groupLabel = (t: Dictionary, k: SearchKind): string => ({
  MATCH: t.body.shell.groupMatch, PLAYER: t.body.shell.groupPlayer, REEL: t.body.shell.groupReel,
  PROJECT: t.body.shell.groupProject, MOMENT: t.body.shell.groupMoment, MARKER: t.body.shell.groupMarker,
})[k];

/** the command's label and hint as the person reads them; the English label/hint in lib/commands.ts stay for matching */
const cmdLabel = (t: Dictionary, c: { id: string }): { label: string; hint: string } => ({
  upload: { label: t.body.shell.cmdUpload, hint: t.body.shell.cmdUploadHint },
  players: { label: t.body.shell.cmdPlayers, hint: t.body.shell.cmdPlayersHint },
  matches: { label: t.body.shell.cmdMatches, hint: t.body.shell.cmdMatchesHint },
  admin: { label: t.body.shell.cmdAdmin, hint: t.body.shell.cmdAdminHint },
  wallet: { label: t.body.shell.cmdWallet, hint: t.body.shell.cmdWalletHint },
  billing: { label: t.body.shell.cmdBilling, hint: t.body.shell.cmdBillingHint },
  team: { label: t.body.shell.cmdTeam, hint: t.body.shell.cmdTeamHint },
  keys: { label: t.body.shell.cmdKeys, hint: t.body.shell.cmdKeysHint },
  security: { label: t.body.shell.cmdSecurity, hint: t.body.shell.cmdSecurityHint },
  continue: { label: t.body.shell.cmdContinue, hint: t.body.shell.cmdContinueHint },
  studio: { label: t.body.shell.cmdStudio, hint: t.body.shell.cmdStudioHint },
}[c.id] ?? { label: c.id, hint: "" });

/** the page's title and subtitle as the person reads them, keyed by route */
const pageLabel = (t: Dictionary, href: string): { label: string; hint: string } => ({
  "/dashboard": { label: t.pages.home.title, hint: t.pages.home.subtitle },
  "/upload": { label: t.pages.upload.title, hint: t.pages.upload.subtitle },
  "/processing": { label: t.pages.processing.title, hint: t.pages.processing.subtitle },
  "/analysis": { label: t.pages.analysis.title, hint: t.pages.analysis.subtitle },
  "/tactics": { label: t.pages.tactical.title, hint: t.pages.tactical.subtitle },
  "/reels": { label: t.pages.reels.title, hint: t.pages.reels.subtitle },
  "/studio": { label: t.pages.studio.title, hint: t.pages.studio.subtitle },
  "/reports": { label: t.pages.reports.title, hint: t.pages.reports.subtitle },
  "/library": { label: t.pages.library.title, hint: t.pages.library.subtitle },
  "/exports": { label: t.pages.exports.title, hint: t.pages.exports.subtitle },
}[href] ?? { label: href, hint: "" });
interface Row { key: string; group: string; label: string; hint: string | null; href: string; mono?: boolean }

export function CommandPalette({ open: openProp, onOpenChange }: { open?: boolean; onOpenChange?: (o: boolean) => void } = {}) {
  const { t } = useLocale();
  const [openSelf, setOpenSelf] = useState(false);
  const open = openProp ?? openSelf;
  const setOpen = (o: boolean | ((x: boolean) => boolean)) => {
    const v = typeof o === "function" ? o(open) : o;
    if (onOpenChange) onOpenChange(v); else setOpenSelf(v);
  };
  const [assistant, setAssistant] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [hits, setHits] = useState<SearchHit[] | null>(null);       // null: not searched (fewer than 2 characters) or searching
  const [failed, setFailed] = useState(false);
  const router = useRouter();
  const { organization } = useAuth();
  const ctx = useMemo(() => (open ? readCtx() : EMPTY_CTX), [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // what the organization recorded: asked 200 ms after the last key, the newest answer wins
  const asked = useRef(0);
  useEffect(() => {
    setFailed(false);
    const n = q.trim();
    if (n.length < 2) { setHits(null); return; }
    const mine = ++asked.current;
    const t = setTimeout(() => {
      void api<SearchResponse>(`/v1/search?q=${encodeURIComponent(n)}`).then((r) => { if (asked.current === mine) setHits(r.hits); },
        () => { if (asked.current === mine) { setHits([]); setFailed(true); } });
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const rows = useMemo<Row[]>(() => {
    const n = q.trim().toLowerCase();
    const cmd = matchCommands(commands(ctx), organization?.role, q).map((c) => ({ key: `c-${c.id}`, group: t.body.shell.groupCommands, ...cmdLabel(t, c), href: c.href }));
    const pages = Object.values(PAGES).map((p) => ({ key: `p-${p.href}`, group: t.body.shell.groupPages, ...pageLabel(t, p.href), href: p.href }));
    const byLabel = pages.filter((r) => r.label.toLowerCase().includes(n));
    const pg = !n ? pages : [...byLabel, ...pages.filter((r) => !byLabel.includes(r) && r.hint.toLowerCase().includes(n))];
    const found = (hits ?? []).map((h) => ({
      key: `${h.kind}-${h.id}`,
      group: groupLabel(t, h.kind),
      label: h.title,
      hint: h.period ? `${h.period} · ${h.detail ?? ""}` : h.detail,
      href: hitHref(h),
      mono: h.kind === "PLAYER" && !!h.ref,
    }));
    const lib = n.length >= 2 ? [{ key: "lib", group: t.body.shell.groupLibrary, label: t.body.shell.paletteLibrary.replace("{a}", q.trim()), hint: t.body.shell.paletteLibraryHint, href: `/library?q=${encodeURIComponent(q.trim())}` }] : [];
    return [...cmd, ...pg, ...found, ...lib];
  }, [q, hits, ctx, organization?.role, t]);

  useEffect(() => setCursor(0), [q, hits]);
  useEffect(() => { if (!open) { setQ(""); setHits(null); setAssistant(false); } }, [open]);

  const go = (href: string) => { setOpen(false); if (href === KEYMAP_HREF) openKeymap(); else router.push(href); };
  const n = q.trim();
  const unknown = n.length >= 2 ? parseSmartQuery(n).unknown : [];

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content data-palette
          className="fixed left-1/2 top-24 z-50 w-[min(680px,calc(100vw-32px))] -translate-x-1/2 rounded-card border border-line bg-panel p-2 shadow-2xl"
          onKeyDown={(e) => {
            if (assistant || e.target instanceof HTMLButtonElement) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            if (e.key === "Enter" && rows[cursor]) { e.preventDefault(); go(rows[cursor].href); }
          }}>
          <Dialog.Title className="sr-only">{t.body.shell.paletteTitle}</Dialog.Title>
          <Dialog.Description className="sr-only">{t.body.shell.paletteDesc}</Dialog.Description>
          <div className="flex gap-2 border-b border-line px-2 pb-2">
            <button type="button" aria-pressed={!assistant} onClick={() => setAssistant(false)} className="rounded-ctl px-2 py-1 text-sm aria-pressed:bg-raised">{t.body.shell.paletteTitle}</button>
            <button type="button" aria-pressed={assistant} onClick={() => setAssistant(true)} className="rounded-ctl px-2 py-1 text-sm aria-pressed:bg-raised">{t.body.shell.paletteAssistant}</button>
          </div>
          {assistant ? <LocalAssistant key={organization?.organization_id} navigate={go} /> : <>
          <div className="flex items-center gap-2 border-b border-line px-2 pb-2">
            <Search className="h-4 w-4 text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.body.shell.palettePlaceholder}
              aria-label={t.body.shell.paletteSearchAria} role="combobox" aria-expanded="true" aria-controls="palette-results" data-palette-input
              aria-activedescendant={rows[cursor] ? `palette-${cursor}` : undefined}
              className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
            <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 text-[11px] text-muted">Esc</kbd>
          </div>
          <ul id="palette-results" role="listbox" aria-label={t.body.shell.paletteResultsAria} className="max-h-[60vh] overflow-auto py-1">
            {rows.map((r, i) => (
              <li key={r.key} className="contents">
                {(i === 0 || rows[i - 1]!.group !== r.group) && <p role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-normal uppercase tracking-wide text-muted">{r.group}</p>}
                <div id={`palette-${i}`} role="option" aria-selected={i === cursor} data-palette-row={r.key} onMouseEnter={() => setCursor(i)} onClick={() => go(r.href)}
                  className={`flex cursor-pointer items-baseline justify-between gap-3 rounded-ctl px-3 py-2 ${i === cursor ? "bg-primary/15" : ""}`}>
                  <span className="min-w-0 truncate text-sm font-normal">{r.label}</span>
                  {r.hint && <span className={`shrink-0 truncate text-xs text-muted ${r.mono ? "font-mono" : ""} max-w-[55%]`}>{r.hint}</span>}
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-3 pt-2 text-xs text-muted" data-palette-state>
            {n.length < 2 ? t.body.shell.paletteTypeMore
              : failed ? t.body.shell.paletteUnreachable
              : hits === null ? t.body.shell.paletteSearching
              : hits.length === 0 ? t.body.shell.paletteNoMatch.replace("{a}", n)
              : hits.length === 1 ? t.body.shell.paletteMatchOne.replace("{a}", String(hits.length)).replace("{b}", n)
              : t.body.shell.paletteMatchMany.replace("{a}", String(hits.length)).replace("{b}", n)}
            {" "}{t.body.shell.paletteKeys}
            {unknown.length > 0 && <span data-palette-unknown className="block text-amber">{t.body.shell.paletteUnknown.replace("{a}", unknown.join(" "))}</span>}
            <span className="block">{SMART_HINT}</span>
          </p>
          </>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
