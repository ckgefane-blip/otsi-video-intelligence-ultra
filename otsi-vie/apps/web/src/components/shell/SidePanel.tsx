"use client";
/**
 * Drag-resizable side panels (owner, 2026-11-13: "Why are the sidebars not adjustable? As in Claude, ChatGPT, Muse…").
 *
 * Every side menu and inspector is a SidePanel: a drag handle on its inner edge changes its width, and the width is
 * remembered per panel on this computer (localStorage `otsi-vie.panel.<id>`; blocked storage = this visit only).
 * - Drag the edge with the mouse; or focus the handle (Tab) and use ← / → (Shift = bigger steps); Home / End = narrowest /
 *   widest; double-click or Enter = back to the default width.
 * - Each panel keeps between its own minimum and maximum, so the page in the middle never disappears.
 * - The handle is a sibling of the panel (not inside it), so it stays put when the panel scrolls.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useLocale } from "@/lib/i18n";

const storageKey = (id: string) => `otsi-vie.panel.${id}`;
const clamp = (w: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(w)));

export interface PanelWidth {
  id: string;
  width: number;
  min: number;
  max: number;
  def: number;
  /** set the width (clamped); `save` false while dragging, true when the drag ends */
  setWidth: (w: number, save?: boolean) => void;
}

/** One panel's width: the default until the person's own saved width is read, kept between `min` and `max`. */
export function usePanelWidth(id: string, def: number, opts: { min?: number; max?: number; key?: string; snap?: (w: number) => number } = {}): PanelWidth {
  const min = opts.min ?? Math.max(180, Math.round(def * 0.65));
  const max = opts.max ?? Math.round(def * 1.8);
  const key = opts.key ?? storageKey(id);
  const snap = opts.snap;
  const [width, setW] = useState(def);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      const v = raw === null ? NaN : Number(raw);
      if (Number.isFinite(v) && v >= min && v <= max) setW(v);
    } catch { /* blocked storage: the default */ }
  }, [key, min, max]);
  const setWidth = useCallback((w: number, save = true) => {
    let next = clamp(w, min, max);
    if (save && snap) next = clamp(snap(next), min, max);
    setW(next);
    if (save) { try { localStorage.setItem(key, String(next)); } catch { /* this visit only */ } }
  }, [key, min, max, snap]);
  return { id, width, min, max, def, setWidth };
}

/** The drag handle: `edge` is the side of the panel it sits on ("right" for a panel on the left of the page). */
export function PanelResizer({ panel, edge, wrapClassName }: { panel: PanelWidth; edge: "left" | "right"; wrapClassName?: string }) {
  const { t } = useLocale();
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [active, setActive] = useState(false);
  const widthAt = (clientX: number) => {
    const d = drag.current!;
    return edge === "right" ? d.w + (clientX - d.x) : d.w - (clientX - d.x);
  };
  const down = (e: PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { x: e.clientX, w: panel.width };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setActive(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const move = (e: PointerEvent<HTMLSpanElement>) => { if (drag.current) panel.setWidth(widthAt(e.clientX), false); };
  const up = (e: PointerEvent<HTMLSpanElement>) => {
    if (!drag.current) return;
    panel.setWidth(widthAt(e.clientX), true);
    drag.current = null;
    setActive(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  const key = (e: KeyboardEvent<HTMLSpanElement>) => {
    const step = e.shiftKey ? 48 : 16;
    const grow = edge === "right" ? 1 : -1;
    const k = e.key;
    if (k === "ArrowRight" || k === "ArrowLeft") { e.preventDefault(); panel.setWidth(panel.width + (k === "ArrowRight" ? step : -step) * grow); }
    else if (k === "Home") { e.preventDefault(); panel.setWidth(panel.min); }
    else if (k === "End") { e.preventDefault(); panel.setWidth(panel.max); }
    else if (k === "Enter") { e.preventDefault(); panel.setWidth(panel.def); }
  };
  return (
    <div className={wrapClassName ?? "relative z-20 w-0 shrink-0 self-stretch"} data-panel-resizer={panel.id}>
      <span role="separator" aria-orientation="vertical" aria-label={t.desktop.resizePanel} tabIndex={0}
        aria-valuenow={panel.width} aria-valuemin={panel.min} aria-valuemax={panel.max}
        title={t.desktop.resizePanel}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={() => panel.setWidth(panel.def)} onKeyDown={key}
        className={`absolute inset-y-0 -left-[3px] w-[6px] cursor-col-resize touch-none outline-none transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 ${active ? "bg-primary/60" : ""}`} />
    </div>
  );
}

type SidePanelProps = Omit<HTMLAttributes<HTMLElement>, "id"> & {
  /** the remembered-width key, unique per panel */
  panel: string;
  /** the approved design width, used until the person drags it */
  def: number;
  /** where the handle sits: "right" for a panel on the left of the page, "left" for an inspector on the right */
  edge: "left" | "right";
  min?: number;
  max?: number;
  as?: "aside" | "nav";
  children?: ReactNode;
};

/** A side menu or inspector with a drag handle on its inner edge and a remembered width. */
export function SidePanel({ panel, def, edge, min, max, as = "aside", style, children, ...rest }: SidePanelProps) {
  const p = usePanelWidth(panel, def, { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
  const Tag = as;
  const sized: CSSProperties = { ...style, flex: `0 0 ${p.width}px`, width: p.width, maxWidth: p.width, minWidth: 0 };
  const body = <Tag {...rest} data-panel={panel} style={sized}>{children}</Tag>;
  const handle = <PanelResizer panel={p} edge={edge} />;
  return edge === "right" ? <>{body}{handle}</> : <>{handle}{body}</>;
}
