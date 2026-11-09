"use client";
/**
 * The one "more actions" menu behind every three-dots button (owner 2026-11-02: "The 3 dots are for what? ... FIX THEM ACROSS THE
 * ENGINE"). The button sits on the design at (x, y), the icon's centre; a click opens a list of real actions for that thing (open it
 * elsewhere, download, copy its link, rename...). An action that cannot run now stays in the list, dimmed, and says why when clicked.
 * Esc or a click outside closes it. Never a dead button: with nothing to act on it says so.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Ic, u } from "./DesignStage";

export interface MoreItem {
  label: string;
  /** a page to open */
  href?: string;
  /** an action; a returned string is shown briefly (e.g. "Link copied") */
  run?: () => void | string | Promise<void | string>;
  /** why it cannot run now (dimmed) */
  why?: string;
}

/** copy an in-app address as a full link */
export const copyLink = async (path: string) => {
  try { await navigator.clipboard.writeText(`${location.origin}${path}`); return "Link copied"; } catch { return "Copy failed: your browser blocked the clipboard"; }
};

export function MoreMenu({ x, y, label, items, k = "dots", size = 24, w = 36, h = 40, color = "#cfe0f5", width = 270, side = "left", empty = "Nothing to act on yet" }: {
  x: number; y: number; label: string; items: MoreItem[]; k?: "dots" | "hdots"; size?: number; w?: number; h?: number; color?: string;
  /** menu width; `side`: "left" opens leftwards from the button's right edge, "right" opens rightwards from its left edge */
  width?: number; side?: "left" | "right"; empty?: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (t: string) => { setNote(t); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNote(null), 2600); };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const left = x - w / 2, top = y - h / 2;
  const menuLeft = side === "left" ? left + w - width : left;
  const row = { display: "block", width: "100%", textAlign: "left" as const, padding: `${u(8)} ${u(10)}`, borderRadius: u(5), background: "transparent", border: 0,
    font: "inherit", fontSize: u(19), textDecoration: "none", cursor: "pointer" };
  const act = async (it: MoreItem) => {
    if (it.why) return say(it.why);
    setOpen(false);
    try { const r = await it.run?.(); if (typeof r === "string") say(r); } catch (e) { say(e instanceof Error ? e.message : "That did not work"); }
  };

  return (
    <div ref={box} data-more-menu={label}>
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="absolute"
        style={{ left: u(left), top: u(top - 101), width: u(w), height: u(h), padding: 0, border: 0, borderRadius: u(6), cursor: "pointer",
          background: open ? "rgba(30,144,255,.22)" : "transparent" }}>
        <Ic o={[left, top]} x={x} y={y} k={k} size={size} color={open ? "#33a8ff" : color} />
      </button>
      {open && (
        <div role="menu" aria-label={label} className="absolute" style={{ left: u(menuLeft), top: u(top + h + 4 - 101), width: u(width), zIndex: 40,
          background: "#081a35", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(8), padding: u(6), boxShadow: `0 ${u(8)} ${u(24)} rgba(0,0,0,.55)`, color: "#e3eefb" }}>
          {items.length === 0 && <div style={{ ...row, cursor: "default", color: "#8ea3bf" }}>{empty}</div>}
          {items.map((it) => it.href && !it.why ? (
            <Link key={it.label} role="menuitem" href={it.href} onClick={() => setOpen(false)} style={{ ...row, color: "#e3eefb" }}
              className="hover:bg-[#0f2c55]">{it.label}</Link>
          ) : (
            <button key={it.label} type="button" role="menuitem" aria-disabled={!!it.why || undefined} title={it.why} onClick={() => void act(it)}
              style={{ ...row, color: it.why ? "#6f84a3" : "#e3eefb" }} className="hover:bg-[#0f2c55]">{it.label}</button>
          ))}
        </div>
      )}
      {note && (
        <div role="status" className="absolute" style={{ left: u(side === "left" ? left + w - 340 : left), top: u(top + h + 4 - 101), width: u(340), zIndex: 41,
          background: "#0a2447", border: `${u(1.5)} solid #1e90ff`, borderRadius: u(6), padding: `${u(6)} ${u(10)}`, fontSize: u(17), color: "#e3eefb" }}>{note}</div>
      )}
    </div>
  );
}

/** Download a render's MP4 (the signed address the API gives), or say why not */
export async function downloadRender(get: () => Promise<{ download_url: string }>) {
  try { location.href = (await get()).download_url; return "Download started"; } catch { return "Download unavailable: the file could not be fetched"; }
}
