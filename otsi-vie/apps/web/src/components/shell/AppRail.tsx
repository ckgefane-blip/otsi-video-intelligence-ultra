"use client";
/**
 * The left rail (SOT rebuild 2026-11-13): the SOT's shared rail, not a resizable sidebar.
 *
 * - 240 px with labels by default, 64 px icons-only when collapsed — fixed widths, no drag-resize handle (the SOT has none in any
 *   .dc.html; its `.rsz` CSS is dead). The Collapse toggle (and Ctrl/Cmd+B) switches between the two; the choice is remembered
 *   in this browser (localStorage `otsi-vie.rail.v2`, 240 or 64 only).
 * - The SOT's per-page default: the rail ships collapsed on Analysis, Tactical, Reels, Clip Studio and Library, expanded on the
 *   other shelled pages. Until the person toggles it (which stores a choice), navigating to another page takes that page's default.
 * - All eleven destinations in the SOT's order — Home, Media, Processing, Analysis, Tactical, Players, Reports, Reels, Clip Studio,
 *   Library, Export — shown always; then Settings (Preferences) and Admin in the footer. The SOT has no Guided-mode gating.
 * - Icons are the SOT's own inline SVGs (stroke, 1.6), copied from reel-builder/Reels.dc.html — Media is a download tray,
 *   Processing a pulse, Tactical a pitch, Reels a filmstrip, Export an arrow up out of a tray.
 * - Labels are read from the dictionary (ADR-139); the English label stays the link identity.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { navItems } from "@/lib/pages";
import { EMPTY_CTX, navHref, onCtx, readCtx } from "@/lib/workContext";
import { useLocale } from "@/lib/i18n";

export const RAIL_STORAGE_KEY = "otsi-vie.rail.v2";
const MIN_W = 64, DEFAULT_W = 240;

/** the SOT's five pages that ship with the rail collapsed (class="app shell rc") */
const COLLAPSED_DEFAULT = /^\/(analysis|tactics|reels|studio|library)(\/|$)/;
const defaultWidth = (path: string) => (COLLAPSED_DEFAULT.test(path) ? MIN_W : DEFAULT_W);

type NavKey = "home" | "upload" | "processing" | "analysis" | "tactical" | "players" | "reports" | "reels" | "studio" | "library" | "export";
interface RailEntry { key: NavKey; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> }

/** one SOT glyph per destination: the path data is copied from the SOT's .dc.html files (stroke icons, 24×24) */
function SotIcon({ d, extra, className }: { d: string[]; extra?: ReactNode; className?: string | undefined }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-[18px] w-[18px] shrink-0"} aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      {d.map((p) => <path key={p} d={p} />)}
      {extra}
    </svg>
  );
}
const icon = (d: string[], extra?: ReactNode) => function Icon({ className }: { className?: string; "aria-hidden"?: boolean }) { return <SotIcon d={d} extra={extra} className={className} />; };
const ICONS: Record<NavKey, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  home: icon(["M4 11l8-7 8 7v9H4z", "M10 20v-5h4v5"]),
  upload: icon(["M12 4v11", "M7 10l5 5 5-5", "M4 20h16"]),
  processing: icon(["M3 12h4l3-7 4 14 3-7h4"]),
  analysis: icon(["M12 2v4", "M12 18v4", "M2 12h4", "M18 12h4"], <circle key="c" cx="12" cy="12" r="7" />),
  tactical: icon(["M12 5v14"], <><rect key="r" x="3" y="5" width="18" height="14" rx="1.5" /><circle key="c" cx="12" cy="12" r="2.5" /></>),
  players: icon(["M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6", "M16 4.6a3.5 3.5 0 0 1 0 6.8", "M21 20c0-2.6-1.6-4.8-4-5.6"], <circle key="c" cx="9" cy="8" r="3.5" />),
  reports: icon(["M6 3h9l4 4v14H6z", "M14 3v5h5", "M9 13h7", "M9 17h5"]),
  reels: icon(["M7 4v16", "M17 4v16", "M3 9h4", "M3 15h4", "M17 9h4", "M17 15h4"], <rect key="r" x="3" y="4" width="18" height="16" rx="2" />),
  studio: icon(["M8.5 7.5L20 18", "M8.5 16.5L20 6"], <><circle key="a" cx="6" cy="6" r="3" /><circle key="b" cx="6" cy="18" r="3" /></>),
  library: icon(["M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"]),
  export: icon(["M12 15V3", "M7 8l5-5 5 5", "M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"]),
};
const SettingsIcon = icon(["M12 2.5v3", "M12 18.5v3", "M2.5 12h3", "M18.5 12h3", "M5.3 5.3l2.1 2.1", "M16.6 16.6l2.1 2.1", "M5.3 18.7l2.1-2.1", "M16.6 7.4l2.1-2.1"], <circle key="c" cx="12" cy="12" r="3" />);
const AdminIcon = icon(["M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"]);
const CollapseIcon = icon(["M4 5v14", "M15 8l-4 4 4 4", "M11 12h9"]);

/** the SOT's order; the English label (lib/pages.ts) is the link identity */
const ENTRIES: Record<string, RailEntry> = {
  Home: { key: "home", icon: ICONS.home },
  Media: { key: "upload", icon: ICONS.upload },
  Processing: { key: "processing", icon: ICONS.processing },
  Analysis: { key: "analysis", icon: ICONS.analysis },
  Tactical: { key: "tactical", icon: ICONS.tactical },
  Players: { key: "players", icon: ICONS.players },
  Reports: { key: "reports", icon: ICONS.reports },
  Reels: { key: "reels", icon: ICONS.reels },
  "Clip Studio": { key: "studio", icon: ICONS.studio },
  Library: { key: "library", icon: ICONS.library },
  Export: { key: "export", icon: ICONS.export },
};

function readRail(): number | null {
  try {
    const raw = localStorage.getItem(RAIL_STORAGE_KEY);
    if (raw === null) return null;
    const v = Number(raw);
    return v === MIN_W || v === DEFAULT_W ? v : null;
  } catch { return null; }
}
function saveRail(w: number) {
  try { localStorage.setItem(RAIL_STORAGE_KEY, String(w)); } catch { /* blocked storage: this visit only */ }
}

export function AppRail() {
  const path = usePathname() ?? "/";
  const items = navItems(path);
  const { t } = useLocale();
  const [width, setWidth] = useState(() => defaultWidth(path));
  const collapsed = width <= MIN_W;
  const [ctx, setCtx] = useState(EMPTY_CTX);
  useEffect(() => { setCtx(readCtx()); return onCtx(() => setCtx(readCtx())); }, []);
  // a stored choice wins; without one the page takes the SOT's per-page default (collapsed on the five rc pages)
  useEffect(() => {
    const stored = readRail();
    setWidth(stored ?? defaultWidth(path));
  }, [path]);

  const toggle = () => setWidth((w) => {
    const next = w <= MIN_W ? DEFAULT_W : MIN_W;
    saveRail(next);
    return next;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const link = "flex h-9 items-center gap-3 rounded-md px-2.5 text-[13px] font-normal leading-5 text-[rgb(var(--ink2))] hover:bg-raised hover:text-ink";
  const on = "bg-raised text-ink shadow-[inset_2px_0_0_rgb(var(--primary))]";
  const settingsActive = /^\/settings(\/|$)/.test(path) && !/^\/settings\/admin/.test(path);
  const adminActive = /^\/settings\/admin(\/|$)/.test(path);

  return (
    <aside aria-label={t.body.shell.navAria} data-rail={collapsed ? "collapsed" : "expanded"}
      className="sticky top-0 flex h-screen shrink-0 flex-col border-r border-line bg-[rgb(var(--p0))]" style={{ width }}>
      <Link href="/dashboard" aria-label={t.body.shell.brandAria} data-owner-asset="logo"
        className={`flex h-12 items-center gap-2.5 border-b border-line ${collapsed ? "justify-center" : "px-4"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={collapsed ? "/brand/otsi-mark.png" : "/brand/otsi-logo.png"} alt="OTSI" className={collapsed ? "h-6 w-auto" : "h-[22px] w-auto"} draggable={false} />
        {!collapsed && <span className="text-xs font-normal tracking-[0.14em] text-muted">VIE</span>}
      </Link>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {!collapsed && <span className="t-th px-2.5 pb-1.5 pt-3">{t.desktop.navWorkspace}</span>}
        {items.map((item) => {
          const e = ENTRIES[item.label];
          if (!e) return null;
          const Icon = e.icon;
          const label = t.nav[e.key];
          return (
            <Link key={item.label} href={navHref(item.label, item.href, ctx)} aria-current={item.active ? "page" : undefined} title={label}
              className={`${link} ${item.active ? on : ""} ${collapsed ? "justify-center px-0" : ""}`}>
              <Icon className={`h-[18px] w-[18px] shrink-0 ${item.active ? "text-primary" : ""}`} aria-hidden />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col gap-0.5 border-t border-line p-2">
        <Link href="/settings/preferences" title={t.desktop.navSettings} aria-current={settingsActive ? "page" : undefined}
          className={`${link} ${settingsActive ? on : ""} ${collapsed ? "justify-center px-0" : ""}`}>
          <SettingsIcon className="h-[18px] w-[18px] shrink-0" aria-hidden />{!collapsed && <span>{t.desktop.navSettings}</span>}
        </Link>
        <Link href="/settings/admin" title={t.desktop.navAdmin} aria-current={adminActive ? "page" : undefined}
          className={`${link} ${adminActive ? on : ""} ${collapsed ? "justify-center px-0" : ""}`}>
          <AdminIcon className="h-[18px] w-[18px] shrink-0" aria-hidden />{!collapsed && <span>{t.desktop.navAdmin}</span>}
        </Link>
        <button type="button" onClick={toggle} aria-expanded={!collapsed} data-rail-toggle
          aria-label={collapsed ? t.desktop.railExpandAria : t.desktop.railCollapseAria} title={collapsed ? t.desktop.railExpandAria : t.desktop.railCollapseAria}
          className={`${link} ${collapsed ? "justify-center px-0" : ""}`}>
          <CollapseIcon className={`h-[18px] w-[18px] shrink-0 ${collapsed ? "-scale-x-100" : ""}`} aria-hidden />
          {!collapsed && <><span className="flex-1 text-left">{t.desktop.railCollapse}</span><span className="vie-kbd">Ctrl B</span></>}
        </button>
      </div>
    </aside>
  );
}
