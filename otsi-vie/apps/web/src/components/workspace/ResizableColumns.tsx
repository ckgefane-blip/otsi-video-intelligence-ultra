"use client";
/**
 * Page 04's three columns (left tools, centre video + timeline, right players) with adjustable widths, as in Claude's sidebars (owner,
 * 2026-10-31): a panel pulled wider gets more ROOM (its cards, lists and text boxes widen; the text keeps its size), not a larger picture.
 * A first version scaled whole columns like a zoom; the owner rejected it.
 *
 * Each column keeps the approved composition's coordinates and reads its width change `dw` (design px) from `useDw()`: what stretches adds
 * dw to its width, what is anchored to the column's right edge adds dw to its x, the rest stays. The centre is shifted right by the left
 * panel's change and gets the width the side panels leave. dw = 0 everywhere at the default widths: the approved composition, pixel for pixel.
 * A side panel is never narrower than approved; dragged well inside that it collapses (an edge tab brings it back); double-click resets; widths are kept in this browser
 * and saved only when the person resizes.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const BASE = "max(0.5px, calc(100cqw / 2560))";           // the stage's design unit (DesignStage.module.css .stage --u)
export const L0 = 404, C0 = 1600, R0 = 556;                // the columns in the approved composition (design px): 0-404, 404-2004, 2004-2560
const GROW = 400, COLLAPSE = 140, MIN_CENTRE = 780;        // a side panel: never narrower than approved (its rows have no room to give), at most 400 wider,
                                                           // collapsed when dragged 140 inside its width; the centre never below 780
const KEY = "otsi.analysis.columns.v2";                    // v2: widths (the rejected zoom version stored its own values under another key)
const HANDLE = 12;

/** The width change (design px) of the column a component is drawn in: 0 at the approved widths. */
const Dw = createContext(0);
export const useDw = () => useContext(Dw);

interface Widths { l: number; r: number }                  // design px; 0 = collapsed
const DEFAULT: Widths = { l: L0, r: R0 };

export function clamp(w: Widths): Widths {
  const side = (v: number, d: number) => (v < d - COLLAPSE ? 0 : Math.min(d + GROW, Math.max(d, v)));
  let l = side(w.l, L0), r = side(w.r, R0);
  const over = l + r - (2560 - MIN_CENTRE);                // the centre keeps at least its minimum
  if (over > 0) { if (l - over >= L0 && w.l !== DEFAULT.l) l -= over; else r = Math.max(R0, r - over); }
  return { l, r };
}

function read(): Widths {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Widths | null; return v && typeof v.l === "number" && typeof v.r === "number" ? clamp(v) : DEFAULT; } catch { return DEFAULT; }
}

function Column({ shift, dw, hidden, label, children }: { shift: number; dw: number; hidden: boolean; label: string; children: ReactNode }) {
  return (
    <div data-column={label} data-dw={Math.round(dw)} hidden={hidden} style={{ position: "absolute", left: `calc(${shift} * ${BASE})`, top: 0, width: 0, height: 0 }}>
      <Dw.Provider value={dw}>{children}</Dw.Provider>
    </div>
  );
}

export function ResizableColumns({ left, centre, right }: { left: ReactNode; centre: ReactNode; right: ReactNode }) {
  const [w, setRaw] = useState<Widths>(DEFAULT);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setRaw(read()); }, []);
  const setW = useCallback((f: (cur: Widths) => Widths) => setRaw((cur) => {
    const next = f(cur);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* the widths are a convenience only */ }
    return next;
  }), []);
  const c = 2560 - w.l - w.r;

  const drag = useCallback((side: "l" | "r") => (e: React.PointerEvent<HTMLDivElement>) => {
    const stage = box.current?.parentElement;
    if (!stage) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * 2560;
      setW((cur) => clamp(side === "l" ? { ...cur, l: x } : { ...cur, r: 2560 - x }));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, [setW]);
  const key = (side: "l" | "r") => (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowLeft" ? -20 : e.key === "ArrowRight" ? 20 : 0;
    if (!d) return;
    e.preventDefault();
    setW((cur) => clamp(side === "l" ? { ...cur, l: (cur.l || L0) + d } : { ...cur, r: (cur.r || R0) - d }));
  };
  const grip = (side: "l" | "r", x: number, label: string, now: number) => (
    <div role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={Math.round(now)} tabIndex={0}
      title="Drag to resize; double-click to reset" data-grip={side}
      onPointerDown={drag(side)} onDoubleClick={() => setW(() => DEFAULT)} onKeyDown={key(side)}
      className="group" style={{ position: "absolute", left: `calc(${x - HANDLE / 2} * ${BASE})`, top: 0, width: `calc(${HANDLE} * ${BASE})`, height: "100%", cursor: "col-resize", zIndex: 6, touchAction: "none" }}>
      <span aria-hidden className="block h-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ marginLeft: `calc(${HANDLE / 2 - 1.5} * ${BASE})`, width: `calc(3 * ${BASE})`, background: "#1e90ff" }} />
      {now === 0 && (
        <span aria-hidden style={{ position: "absolute", top: "45%", left: side === "l" ? 0 : "auto", right: side === "r" ? 0 : "auto", width: `calc(18 * ${BASE})`, height: `calc(60 * ${BASE})`,
          background: "#10335f", border: `calc(1.5 * ${BASE}) solid #1e90ff`, borderRadius: `calc(6 * ${BASE})`, color: "#33a8ff", fontSize: `calc(18 * ${BASE})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {side === "l" ? "›" : "‹"}
        </span>
      )}
    </div>
  );

  return (
    <div ref={box} data-columns={`${Math.round(w.l)},${Math.round(c)},${Math.round(w.r)}`} style={{ display: "contents" }}>
      <Column shift={0} dw={w.l - L0} hidden={w.l === 0} label="left">{left}</Column>
      <Column shift={w.l - L0} dw={c - C0} hidden={false} label="centre">{centre}</Column>
      <Column shift={-(w.r - R0)} dw={w.r - R0} hidden={w.r === 0} label="right">{right}</Column>
      {grip("l", Math.max(w.l, HANDLE / 2), "Resize the tools panel", w.l)}
      {grip("r", Math.min(w.l + c, 2560 - HANDLE / 2), "Resize the players panel", w.r)}
    </div>
  );
}
