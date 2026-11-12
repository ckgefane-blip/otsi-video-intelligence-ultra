"use client";
/**
 * Desktop UI v2 (owner-approved Source of Truth, 2026-11-11): the left rail replaces the header's tab strip.
 *
 * - Visible and adjustable, like the sidebars in Muse / Claude Code / Codex and the SOT UI:
 *   240 px with labels by default; drag the right edge to widen or narrow it (64–320 px),
 *   drag it narrow and it collapses to icons only; the toggle (and Ctrl/Cmd+B) collapses it
 *   and double-click on the edge resets it to 240. The width is remembered in this browser.
 * - The same ten destinations as before, in the approved order, each opening on the work context (lib/workContext.ts navHref),
 *   then Settings and Admin. Entries marked `advanced: true` (formerly `pro: true`) are offered only in the Advanced interface.
 * - Labels are read from the dictionary (ADR-139); the English label stays the link identity.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType, type PointerEvent as ReactPointerEvent } from "react";
import {
  BarChart3, Clapperboard, Crosshair, Download, FileText, FolderOpen, Home, LayoutGrid, PanelLeftClose, Scissors, Settings, Shield, Upload, Users,
} from "lucide-react";
import { navItems } from "@/lib/pages";
import { EMPTY_CTX, navHref, onCtx, readCtx } from "@/lib/workContext";
import { useInterfaceMode } from "@/lib/interfaceMode";
import { useLocale } from "@/lib/i18n";

export const RAIL_STORAGE_KEY = "otsi-vie.rail.v2";
const MIN_W = 64, MAX_W = 320, DEFAULT_W = 240;

type NavKey = "home" | "upload" | "processing" | "analysis" | "tactical" | "players" | "reels" | "studio" | "reports" | "library" | "export";
interface RailEntry { key: NavKey; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> }

/** the approved order; the English label (lib/pages.ts) is the link identity */
const ENTRIES: Record<string, RailEntry> = {
  Home: { key: "home", icon: Home },
  Upload: { key: "upload", icon: Upload },
  Processing: { key: "processing", icon: BarChart3 },
  Analysis: { key: "analysis", icon: Crosshair },
  Tactical: { key: "tactical", icon: LayoutGrid },
  Players: { key: "players", icon: Users },
  "Reel Builder": { key: "reels", icon: Clapperboard },
  "Clip Studio": { key: "studio", icon: Scissors },
  "Player Report": { key: "reports", icon: FileText },
  Library: { key: "library", icon: FolderOpen },
  Export: { key: "export", icon: Download },
};

function readRail(): number {
  try {
    const raw = localStorage.getItem(RAIL_STORAGE_KEY);
    if (raw === null) return DEFAULT_W;
    const v = Number(raw);
    return Number.isFinite(v) ? Math.min(MAX_W, Math.max(MIN_W, v)) : DEFAULT_W;
  } catch { return DEFAULT_W; }
}
function saveRail(w: number) {
  try { localStorage.setItem(RAIL_STORAGE_KEY, String(Math.round(w))); } catch { /* blocked storage: this visit only */ }
}

export function AppRail() {
  const path = usePathname() ?? "/";
  const items = navItems(path);
  const { t } = useLocale();
  const { mode } = useInterfaceMode();
  const [width, setWidth] = useState(DEFAULT_W);
  const collapsed = width <= MIN_W;
  const [ctx, setCtx] = useState(EMPTY_CTX);
  useEffect(() => { setCtx(readCtx()); return onCtx(() => setCtx(readCtx())); }, []);
  useEffect(() => { setWidth(readRail()); }, []);

  const toggle = () => setWidth((w) => {
    const next = w <= MIN_W ? DEFAULT_W : MIN_W;
    saveRail(next);
    return next;
  });
  // drag the right edge to resize, like the sidebars in Claude Code / Codex:
  // pull it narrow and it collapses to icons; double-click the edge resets to 240.
  const dragRef = useRef<HTMLDivElement | null>(null);
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX, startW = width;
    const el = dragRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setWidth(Math.min(MAX_W, Math.max(MIN_W, startW + (ev.clientX - startX))));
    const up = (ev: PointerEvent) => {
      const w = Math.min(MAX_W, Math.max(MIN_W, startW + (ev.clientX - startX)));
      const final = w < 120 ? MIN_W : w;
      setWidth(final);
      saveRail(final);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const resetWidth = () => { setWidth(DEFAULT_W); saveRail(DEFAULT_W); };
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
          if (!e || (item.advanced && mode === "guided")) return null;
          const Icon = e.icon;
          const label = t.nav[e.key];
          return (
            <Link key={item.label} href={navHref(item.label, item.href, ctx)} aria-current={item.active ? "page" : undefined} title={label}
              className={`${link} ${item.active ? on : ""} ${collapsed ? "justify-center px-0" : ""}`} {...(item.advanced ? { "data-advanced": "" } : {})}>
              <Icon className={`h-[18px] w-[18px] shrink-0 ${item.active ? "text-primary" : ""}`} aria-hidden />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col gap-0.5 border-t border-line p-2">
        <Link href="/settings/team" title={t.desktop.navSettings} aria-current={settingsActive ? "page" : undefined}
          className={`${link} ${settingsActive ? on : ""} ${collapsed ? "justify-center px-0" : ""}`}>
          <Settings className="h-[18px] w-[18px] shrink-0" aria-hidden />{!collapsed && <span>{t.desktop.navSettings}</span>}
        </Link>
        {mode === "advanced" && (
          <Link href="/settings/admin" title={t.desktop.navAdmin} aria-current={adminActive ? "page" : undefined} data-advanced=""
            className={`${link} ${adminActive ? on : ""} ${collapsed ? "justify-center px-0" : ""}`}>
            <Shield className="h-[18px] w-[18px] shrink-0" aria-hidden />{!collapsed && <span>{t.desktop.navAdmin}</span>}
          </Link>
        )}
        <button type="button" onClick={toggle} aria-expanded={!collapsed} data-rail-toggle
          aria-label={collapsed ? t.desktop.railExpandAria : t.desktop.railCollapseAria} title={collapsed ? t.desktop.railExpandAria : t.desktop.railCollapseAria}
          className={`${link} ${collapsed ? "justify-center px-0" : ""}`}>
          <PanelLeftClose className={`h-[18px] w-[18px] shrink-0 ${collapsed ? "-scale-x-100" : ""}`} aria-hidden />
          {!collapsed && <><span className="flex-1 text-left">{t.desktop.railCollapse}</span><span className="vie-kbd">Ctrl B</span></>}
        </button>
      </div>
      <div ref={dragRef} role="separator" aria-orientation="vertical" aria-label={t.desktop.railExpandAria}
        title={t.desktop.railExpandAria} onPointerDown={startDrag} onDoubleClick={resetWidth}
        className="absolute right-0 top-0 h-full w-[6px] cursor-ew-resize touch-none hover:bg-primary/50 focus-visible:bg-primary/50 focus-visible:outline-none" />
    </aside>
  );
}
