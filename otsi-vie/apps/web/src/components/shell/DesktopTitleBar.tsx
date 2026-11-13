"use client";
/**
 * The desktop app's title bar with its menus (owner 2026-11-13: File · Edit · View · Go to · Help "inside the title bar, in the same
 * top row as OTSI VIE, like VS Code or Filmora … not just for decoration but for actual navigation and useful purposes").
 *
 * Shown only inside the OTSI VIE desktop app (its preload exposes window.otsiDesktop); in a browser it renders nothing. The
 * desktop app hides Windows' own title bar and draws only the minimise / maximise / close buttons on the right, so this
 * row is the window's title bar: it drags the window, and a double-click maximises (Windows does that for drag regions).
 * Each menu name opens the desktop app's native menu under it (apps/desktop/appmenus.js). The items that act inside the
 * page come back here as commands: go to a page (client-side, nothing reloads), or the app's own shortcuts (Ctrl+K search,
 * Ctrl+J Jobs Center, Ctrl+B left menu, the keyboard-shortcuts map).
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { openKeymap } from "@/lib/keymap";

export interface DesktopCommand { type: "navigate"; route: string }
export interface DesktopShortcut { type: "shortcut"; key: "k" | "j" | "b" }
export interface DesktopKeymap { type: "keymap" }
export interface DesktopMenuClosed { type: "menu-closed" }
export type DesktopMessage = DesktopCommand | DesktopShortcut | DesktopKeymap | DesktopMenuClosed;

export interface OtsiDesktop {
  openMenu: (name: string, x: number, y: number) => void;
  setTitleBarColors: (bg: string, fg: string) => void;
  onCommand: (cb: (cmd: DesktopMessage) => void) => () => void;
}

export const MENUS: [string, string][] = [["file", "File"], ["edit", "Edit"], ["view", "View"], ["go", "Go to"], ["help", "Help"]];

/** a command from the desktop menus, carried out in the page */
export function runDesktopCommand(cmd: DesktopMessage, push: (route: string) => void) {
  if (cmd.type === "navigate" && typeof cmd.route === "string" && cmd.route.startsWith("/")) push(cmd.route);
  else if (cmd.type === "shortcut" && ["k", "j", "b"].includes(cmd.key))
    window.dispatchEvent(new KeyboardEvent("keydown", { key: cmd.key, ctrlKey: true, bubbles: true, cancelable: true }));
  else if (cmd.type === "keymap") openKeymap();
}

/** the window buttons drawn by Windows take the theme's bar and text colours */
function syncColors(api: OtsiDesktop) {
  const css = getComputedStyle(document.documentElement);
  const rgb = (v: string, fallback: string) => {
    const parts = css.getPropertyValue(v).trim().split(/\s+/).map(Number);
    return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? "#" + parts.map((n) => n.toString(16).padStart(2, "0")).join("") : fallback;
  };
  api.setTitleBarColors(rgb("--p0", "#0f1114"), rgb("--ink", "#eceef1"));
}

export function DesktopTitleBar() {
  const router = useRouter();
  const [api, setApi] = useState<OtsiDesktop | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const desktop = (window as unknown as { otsiDesktop?: OtsiDesktop }).otsiDesktop;
    if (!desktop) return;
    setApi(desktop);
    document.documentElement.classList.add("vie-desktop");
    syncColors(desktop);
    const theme = new MutationObserver(() => syncColors(desktop));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const off = desktop.onCommand((cmd) => { setOpen(null); runDesktopCommand(cmd, (r) => router.push(r)); });
    return () => { off(); theme.disconnect(); document.documentElement.classList.remove("vie-desktop"); };
  }, [router]);

  if (!api) return null;
  const show = (name: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setOpen(name);
    api.openMenu(name, r.left, r.bottom);
  };
  return (
    <div className="vie-titlebar" data-desktop-titlebar role="menubar" aria-label="Application menu" onMouseLeave={() => setOpen(null)}>
      <img src="/brand/otsi-mark.png" alt="" aria-hidden className="vie-titlebar-icon" draggable={false} />
      <span className="vie-titlebar-name">OTSI VIE</span>
      {MENUS.map(([name, label]) => (
        <button key={name} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === name}
          data-menu={name} className={open === name ? "is-open" : undefined}
          onMouseDown={(e) => { e.preventDefault(); show(name, e.currentTarget); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); show(name, e.currentTarget); } }}>
          {label}
        </button>
      ))}
    </div>
  );
}
