"use client";
/** The three-dots menu in the Desktop UI's flow layout: the same MoreItem actions as stage/MoreMenu (open elsewhere, export, download,
 *  copy link), the same rules (a dimmed action says why; never a dead button), positioned by the page's flow, not by stage coordinates. */
import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { MoreItem } from "@/components/stage/MoreMenu";

export function ActionsMenu({ label, items, empty = "Nothing to act on yet" }: { label: string; items: MoreItem[]; empty?: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (s: string) => { setNote(s); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNote(null), 2600); };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const act = async (it: MoreItem) => {
    if (it.why) return say(it.why);
    setOpen(false);
    try { const r = await it.run?.(); if (typeof r === "string") say(r); } catch (e) { say(e instanceof Error ? e.message : "That did not work"); }
  };
  const row = "block w-full rounded px-2.5 py-1.5 text-left t-body hover:bg-raised";
  return (
    <div ref={box} className="relative" data-more-menu={label}>
      <button type="button" className="vie-ib" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label={label} className="absolute right-0 top-full z-40 mt-1 w-64 rounded-md border border-line2 bg-panel p-1 shadow-xl">
          {items.length === 0 && <div className={`${row} cursor-default text-muted hover:bg-transparent`}>{empty}</div>}
          {items.map((it) => it.href && !it.why ? (
            <Link key={it.label} role="menuitem" href={it.href} onClick={() => setOpen(false)} className={`${row} text-ink`}>{it.label}</Link>
          ) : (
            <button key={it.label} type="button" role="menuitem" aria-disabled={!!it.why || undefined} title={it.why} onClick={() => void act(it)}
              className={`${row} ${it.why ? "text-muted" : "text-ink"}`}>{it.label}</button>
          ))}
        </div>
      )}
      {note && <div role="status" className="absolute right-0 top-full z-40 mt-1 w-72 rounded-md border border-primary bg-panel px-2.5 py-1.5 t-small">{note}</div>}
    </div>
  );
}
