"use client";
/**
 * Resizable sidebars (owner 2026-11-12: "all sidebars, left and right, adjustable like Claude's sidebar"). `useSideWidths(key, { l, r })`
 * keeps a page's left / right panel widths (remembered per page in this browser) as CSS variables --sl / --sr for the page's grid
 * (`grid-cols-[var(--sl)_minmax(0,1fr)_var(--sr)]`), and `<SideEdge>` is the drag edge between a panel and the centre: drag it, use the
 * arrow keys (16 px), or double-click / Home to reset. The edges show only at the breakpoint where the panels sit side by side.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const LIMITS = { min: 200, max: 600 };
type Widths = { l?: number | undefined; r?: number | undefined };

export function useSideWidths(key: string, defaults: Widths) {
  const storage = `otsi-vie.side.${key}`;
  const [w, setW] = useState<Widths>(defaults);
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(storage) ?? "null") as Widths | null; if (v) setW((d) => ({ ...d, ...v })); } catch { /* none saved */ }
  }, [storage]);
  const set = useCallback((side: "l" | "r", px: number | null) => {
    setW((cur) => {
      const next = { ...cur, [side]: px === null ? defaults[side] : Math.max(LIMITS.min, Math.min(LIMITS.max, Math.round(px))) };
      try { localStorage.setItem(storage, JSON.stringify({ l: next.l, r: next.r })); } catch { /* private mode */ }
      return next;
    });
  }, [storage, defaults]);
  const style = { ...(w.l ? { "--sl": `${w.l}px` } : {}), ...(w.r ? { "--sr": `${w.r}px` } : {}) } as CSSProperties;
  return { widths: w, set, style };
}

/** the drag edge; `gap` = the grid gap in px (it sits in the middle of it); `show` = the breakpoint classes, e.g. "hidden xl:block" */
export function SideEdge({ side, width, gap, show, onChange }: {
  side: "l" | "r"; width: number | undefined; gap: number; show: string; onChange: (px: number | null) => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [on, setOn] = useState(false);
  if (!width) return null;
  const sign = side === "l" ? 1 : -1;
  const pos: CSSProperties = side === "l" ? { left: width + gap / 2 - 3 } : { right: width + gap / 2 - 3 };
  return (
    <div role="separator" aria-orientation="vertical" tabIndex={0} data-side-edge={side}
      aria-label={`${side === "l" ? "Resize the left panel" : "Resize the right panel"}. Drag, or use the arrow keys; double-click to reset`}
      aria-valuenow={width} aria-valuemin={LIMITS.min} aria-valuemax={LIMITS.max}
      className={`${show} absolute bottom-0 top-0 z-20 w-1.5 cursor-col-resize touch-none rounded hover:bg-primary/50 focus-visible:bg-primary/50 focus-visible:outline-none ${on ? "bg-primary/60" : ""}`}
      style={pos}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, w: width }; setOn(true); document.body.style.cursor = "col-resize"; }}
      onPointerMove={(e) => { if (start.current) onChange(start.current.w + sign * (e.clientX - start.current.x)); }}
      onPointerUp={() => { start.current = null; setOn(false); document.body.style.cursor = ""; }}
      onDoubleClick={() => onChange(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { onChange(width + sign * 16); e.preventDefault(); }
        else if (e.key === "ArrowLeft") { onChange(width - sign * 16); e.preventDefault(); }
        else if (e.key === "Home") { onChange(null); e.preventDefault(); }
      }} />
  );
}

/** for a server page: the same resizable grid as a client wrapper */
export function SideGrid({ storageKey, l, r, gap, showL, showR, className, children }: {
  storageKey: string; l?: number; r?: number; gap: number; showL?: string; showR?: string; className: string; children: ReactNode;
}) {
  const sides = useSideWidths(storageKey, { l, r });
  return (
    <div className={`relative ${className}`} style={sides.style}>
      {l && showL ? <SideEdge side="l" width={sides.widths.l} gap={gap} show={showL} onChange={(px) => sides.set("l", px)} /> : null}
      {r && showR ? <SideEdge side="r" width={sides.widths.r} gap={gap} show={showR} onChange={(px) => sides.set("r", px)} /> : null}
      {children}
    </div>
  );
}
