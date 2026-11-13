"use client";
/**
 * Page 07 Clip Studio — the timeline (SOT, Studio.dc.html).
 *
 * Four lanes: V2 Draw (the drawings on the clips), V1 Video (the Profile
 * Intro segment first, then the clips), A1 Music (the reel's music, or an
 * empty state) and Beats (the beat marks, once music is added). The
 * toolbar has the tool (Select / Blade / Trim), Snap, Cut to beat and
 * the zoom. Clip interactions: click to select, drag to reorder, drag
 * an edge to trim (saved on release, Escape cancels), drag the playhead
 * to seek. S splits the clip under the playhead, M adds a marker,
 * Delete removes the selected clip. The Blade tool splits where you
 * click; Cut to beat moves the playhead to the nearest beat and splits
 * there. The transitions are edited in the inspector (Clip tab) and in
 * the bin's Effects tab — they are not a lane here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { beatsUsable, reelBeats, type BeatGrid, type BeatGridView } from "@otsi-vie/contracts";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { tc, type Ui } from "./kit";
import { trimEdge, locate, type Placed, type Studio } from "./useStudio";
import { snapTo } from "./editing";

const INTRO_W = 0.11; // the Profile Intro segment is 11% of the track in the SOT

type Tool = "select" | "blade" | "trim";

function LaneLabel({ children }: { children: React.ReactNode }) {
  // SOT (Studio.dc.html): the label sits in the 96px column with 12px left padding, never clipped or wrapped.
  return <div className="t-small flex w-[96px] shrink-0 items-start justify-start whitespace-nowrap py-1 pl-3 pr-2 text-muted">{children}</div>;
}

export function Timeline({ r, st, ui, setBinTab }: { r: ReelState | null; st: Studio; ui: Ui; setBinTab?: (tab: number) => void }) {
  const { t: dict } = useLocale();
  const s = dict.body.studio;
  const reel = st.reel;
  const items = st.items;
  const total = st.total;
  const [tool, setTool] = useState<Tool>("select");
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(1);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trimDrag, setTrimDrag] = useState<{ id: string; edge: "in" | "out"; d: number } | null>(null);
  const [beatGrid, setBeatGrid] = useState<BeatGrid | null>(null);

  const musicId = reel?.settings.music_id ?? null;
  useEffect(() => {
    if (!musicId) { setBeatGrid(null); return; }
    let dead = false;
    void api<BeatGridView>(`/v1/brand-assets/${musicId}/beat-grid`).then(
      (v) => { if (!dead) setBeatGrid(v.grid); },
      () => { if (!dead) setBeatGrid(null); },
    );
    return () => { dead = true; };
  }, [musicId]);

  const beats = useMemo(() => (beatsUsable(beatGrid) ? reelBeats(beatGrid, st.total) : []), [beatGrid, st.total]);

  const span = total > 0 ? Math.min(total, total / zoom) : 0;
  const headPct = span > 0 ? Math.min(100, Math.max(0, (st.playhead / span) * 100)) : 0;

  const toTime = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    // the clips start after the 96px label column
    const inner = rect.width - 96;
    return Math.max(0, Math.min(span, ((clientX - rect.left - 96) / inner) * span));
  }, [span]);

  const clipAt = useCallback((t: number) => locate(items, t), [items]);

  // --- playhead drag on the ruler / empty track ---
  const headDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-clip]")) return;
    const t0 = toTime(e.clientX);
    if (t0 === null) return;
    st.setPlayhead(Math.round(t0));
    const move = (ev: PointerEvent) => { const t = toTime(ev.clientX); if (t !== null) st.setPlayhead(Math.round(Math.max(0, Math.min(total, t)))); };
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  }, [st, toTime, total]);

  // --- edge trim: drag, show the new edge, save on release ---
  const trimDown = useCallback((p: Placed, edge: "in" | "out") => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!r?.canEdit) return ui.say(s.roleViewReel);
    const el = trackRef.current;
    if (!el || !st.total) return;
    const w = el.getBoundingClientRect().width - 96, x0 = e.clientX;
    let d = 0, cancelled = false;
    setTrimDrag({ id: p.clip.id, edge, d: 0 });
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") { cancelled = true; ev.preventDefault(); up(); ui.say(s.trimCancelled); } };
    const k = p.clip.effect.kind === "SLOW" ? p.clip.effect.speed : 1;
    const targets = !snap ? [] : [
      ...st.notes.flatMap((n) => (n.at_pts_us === null ? [] : [n.at_pts_us])),
      ...beats,
    ];
    const move = (ev: PointerEvent) => {
      let want = ((ev.clientX - x0) / w) * span * k;
      const edgeAt = edge === "in" ? p.clip.in_pts_us : p.clip.out_pts_us;
      if (targets.length) want = snapTo(edgeAt + want, targets, (8 / w) * span * k).v - edgeAt;
      const r2 = trimEdge(p.clip, edge, want);
      d = edge === "in" ? r2.in_pts_us - p.clip.in_pts_us : r2.out_pts_us - p.clip.out_pts_us;
      setTrimDrag({ id: p.clip.id, edge, d });
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("keydown", esc, true);
      setTrimDrag(null);
      if (cancelled || Math.abs(d) < 20_000) return;
      const r2 = trimEdge(p.clip, edge, d);
      st.trim(p.clip, r2.in_pts_us, r2.out_pts_us);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("keydown", esc, true);
  }, [r, st, ui, s, snap, span, beats]);

  // --- clip body: click selects (or splits with the Blade), drag reorders ---
  const clipDown = useCallback((p: Placed) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const t = toTime(e.clientX);
    if (t === null) return;
    if (tool === "blade") {
      if (!r?.canEdit) return ui.say(s.roleViewReel);
      st.setPlayhead(Math.round(t));
      if (!st.split()) ui.say(s.splitClipHint);
      return;
    }
    r?.setSelectedClip(p.clip.id);
    st.setPlayhead(p.start);
    if (!r?.canEdit) return;
    const x0 = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => { if (Math.abs(ev.clientX - x0) > 4) moved = true; };
    const up = (ev: PointerEvent) => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up);
      if (!moved) return;
      const t2 = toTime(ev.clientX);
      if (t2 === null) return;
      const target = clipAt(t2)?.p;
      if (!target || target.clip.id === p.clip.id) return;
      const ids = items.map((x) => x.clip.id).filter((id) => id !== p.clip.id);
      const idx = ids.indexOf(target.clip.id);
      // drop after the target when past its middle, else before it
      const after = t2 > target.start + target.dur / 2;
      ids.splice(after ? idx + 1 : idx, 0, p.clip.id);
      st.reorder(ids);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  }, [r, st, ui, s, tool, toTime, clipAt, items]);

  // S split, M marker, Delete remove; SOT rebuild (Clip Studio): B blade tool, V select tool
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, select, textarea, [contenteditable]")) return;
      if (e.key === "s" || e.key === "S") { e.preventDefault(); if (r?.canEdit) st.split(); }
      // while dual compare is open, B belongs to it (capture Cut B / Shift+B apply), so it never also picks the blade
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "b" || e.key === "B") && !document.querySelector("[data-dual-timeline]")) { e.preventDefault(); setTool("blade"); }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "v" || e.key === "V")) { e.preventDefault(); setTool("select"); }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        if (!r?.canEdit) return;
        const under = locate(items, st.playhead);
        if (!under) return;
        void st.addNote(s.markerLabel, Math.round(under.src));
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const sel = r?.selectedClip ? items.find((x) => x.clip.id === r.selectedClip) : null;
        if (sel && r?.canEdit) { e.preventDefault(); st.remove(sel.clip); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [st, r, items, s]);

  const cutToBeat = useCallback(() => {
    if (!beats.length) return ui.say(s.csBeatsDetected);
    if (!r?.canEdit) return ui.say(s.roleViewReel);
    const p = clipAt(st.playhead)?.p;
    if (!p) return ui.say(s.selectClipFirst);
    const nearest = beats.reduce((a, b) => Math.abs(b - st.playhead) < Math.abs(a - st.playhead) ? b : a, beats[0]!);
    if (nearest <= p.start + 100_000 || nearest >= p.start + p.dur - 100_000) return ui.say(s.noBeatHere);
    st.setPlayhead(Math.round(nearest));
    if (!st.split()) ui.say(s.splitClipHint);
  }, [beats, r, st, clipAt, ui, s]);

  const ruler: number[] = [];
  // SOT (Studio.dc.html): the ruler always reads 00:00…03:00. With no reel loaded the total is 0 and the old
  // code built no ticks at all, so the ruler was blank — fall back to the SOT's 3:00 span. Ticks stop at the
  // visible window (span) so a zoomed ruler does not spill past 100%.
  const rulerSpan = span > 0 ? span : 180_000_000;
  const rulerEnd = total > 0 ? Math.min(total, span) : 180_000_000;
  for (let t = 0; t <= rulerEnd; t += 30_000_000) ruler.push(t);

  const introOn = reel?.settings.profile_intro !== false;
  const music = musicId ? st.brand?.find((a) => a.id === musicId) : null;
  const drawSpans = items.flatMap((p) => (p.clip.fx.drawings ?? []).map((d, i) => ({ p, d, i })));

  return (
    <section className="flex h-[204px] shrink-0 flex-col border-t border-line bg-panel" aria-label={s.timelineLabel}>
      {/* toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 px-2.5">
        <div className="seg" role="group" aria-label={s.timelineLabel}>
          {(["select", "blade", "trim"] as Tool[]).map((t) => (
            <button key={t} type="button" aria-pressed={tool === t} className={tool === t ? "on" : ""} onClick={() => setTool(t)}>
              {t === "select" ? s.csToolSelect : t === "blade" ? s.csBlade : s.csTrim}
            </button>
          ))}
        </div>
        <button type="button" aria-pressed={snap} className="vie-chip" onClick={() => setSnap((v) => !v)}
          style={snap ? { background: "rgb(var(--raised))", color: "rgb(var(--ink))" } : undefined}>{s.csSnap}</button>
        <button type="button" className="vie-btn vie-btn-sm" onClick={cutToBeat}>{s.csCutToBeat}</button>
        <span className="flex-1" />
        <label className="t-small text-muted" htmlFor="cs-tl-zoom">{s.zoomSection}</label>
        <input id="cs-tl-zoom" type="range" className="vie-range w-[110px]" min={1} max={8} step={0.5} value={zoom}
          aria-label={s.zoomSection} onChange={(e) => setZoom(Number(e.target.value))} />
      </div>
      {/* ruler */}
      <div className="flex h-6 shrink-0 border-b border-line" style={{ paddingLeft: 96 }}>
        <div className="relative flex-1" onPointerDown={headDown}>
          {ruler.map((t) => (
            <span key={t} className="t-small absolute top-1 text-muted" style={{ left: `${(t / rulerSpan) * 100}%` }}>
              {tc(t).slice(0, 5)}
            </span>
          ))}
        </div>
      </div>
      {/* lanes: SOT (Studio.dc.html) is a 96px label column + the track, no side padding — the ruler row above
          (paddingLeft 96) and the playhead (left 96px) are measured from the same edge, so the container has
          no left padding either; the old px-2.5 shifted the labels 10px right of the ruler and playhead. */}
      <div ref={trackRef} className="relative min-h-0 flex-1 overflow-hidden pb-2 pr-2.5" onPointerDown={headDown}>
        {/* playhead */}
        <div className="pointer-events-none absolute bottom-0 top-[-24px] z-20" style={{ left: `calc(96px + ${headPct}% * (100% - 96px) / 100%)` }}>
          <div style={{ width: 0, height: 0, borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderTop: "8px solid rgb(var(--primary))" }} />
          <div style={{ width: "1.5px", height: "100%", background: "rgb(var(--primary))", marginLeft: 5 }} />
        </div>
        <div className="flex h-full flex-col">
          {/* V2 Draw */}
          <div className="flex min-h-0 flex-1">
            <LaneLabel>{s.csDrawLane}</LaneLabel>
            <div className="relative min-w-0 flex-1">
              {drawSpans.map(({ p, d, i }) => {
                const x = ((p.start + (d.at_ms ?? 0) * 1000) / span) * 100;
                return (
                  <span key={`${p.clip.id}-${i}`} className="t-small absolute top-1/2 -translate-y-1/2 rounded-sm px-1.5 py-0.5"
                    style={{ left: `${x}%`, background: "rgba(43,212,176,.18)", color: "rgb(var(--ink))", border: "1px solid rgb(var(--primary))" }}>
                    {d.kind}
                  </span>
                );
              })}
            </div>
          </div>
          {/* V1 Video */}
          <div className="flex min-h-0 flex-[1.4]">
            <LaneLabel>{s.csVideoLane}</LaneLabel>
            <div className="relative min-w-0 flex-1">
              {/* SOT (Studio.dc.html): the Intro segment and the dashed "No clips on the timeline yet" box sit
                  side by side in V1 — the box shows whenever there are no clips, even with the Intro on. */}
              {items.length === 0 && (
                <div className="absolute inset-y-1 flex items-center rounded-md border border-dashed border-line2 px-2.5 text-muted"
                  style={{ left: introOn ? `${INTRO_W * 100}%` : 0, right: 0 }}>
                  <span className="t-small">{s.csNoClipsTimeline}</span>
                </div>
              )}
              {introOn && (
                <div className="absolute inset-y-1 left-0 flex items-center gap-1.5 rounded-md px-2"
                  style={{ width: `${INTRO_W * 100}%`, background: "rgba(43,212,176,.14)", border: "1px solid rgb(var(--primary))" }}>
                  <span aria-hidden="true">🔒</span>
                  <span className="t-small font-medium">{s.csIntro}</span>
                </div>
              )}
              {items.map((p) => {
                const x = ((p.start) / span) * 100;
                const w = (p.dur / span) * 100;
                const sel = r?.selectedClip === p.clip.id;
                const label = p.clip.label ?? `${s.clipIndex} ${p.index + 1}`;
                const td = trimDrag?.id === p.clip.id ? trimDrag : null;
                const ghost = td ? (td.edge === "in" ? { left: x + (td.d / span) * 100, width: w - (td.d / span) * 100 } : { left: x, width: w + (td.d / span) * 100 }) : null;
                return (
                  <div key={p.clip.id} data-clip className="absolute inset-y-1 overflow-hidden rounded-md text-left"
                    role="button" tabIndex={0}
                    style={{ left: `calc(${INTRO_W * 100}% + ${x * (1 - INTRO_W)}%)`, width: `${w * (1 - INTRO_W)}%`,
                      background: sel ? "rgb(var(--primary))" : "rgb(var(--raised))",
                      border: sel ? "1.5px solid rgb(var(--primary))" : "1px solid rgb(var(--line2))",
                      color: sel ? "rgb(var(--primary-ink))" : "rgb(var(--ink))",
                      ...(ghost ? { left: `calc(${INTRO_W * 100}% + ${ghost.left * (1 - INTRO_W)}%)`, width: `${ghost.width * (1 - INTRO_W)}%`, opacity: 0.7 } : {}) }}
                    onPointerDown={clipDown(p)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r?.setSelectedClip(p.clip.id); st.setPlayhead(p.start); } }}>
                    <span className="t-small block truncate px-2 py-1">{label}</span>
                    {/* edge trim handles */}
                    <span className="absolute inset-y-0 left-0 w-[6px] cursor-ew-resize" onPointerDown={trimDown(p, "in")} />
                    <span className="absolute inset-y-0 right-0 w-[6px] cursor-ew-resize" onPointerDown={trimDown(p, "out")} />
                  </div>
                );
              })}
            </div>
          </div>
          {/* A1 Music */}
          <div className="flex min-h-0 flex-[1.2]">
            <LaneLabel>{s.csMusicLane}</LaneLabel>
            <div className="relative min-w-0 flex-1">
              {music ? (
                <div className="absolute inset-y-1 left-0 right-0 flex items-center gap-2 rounded-md border border-line2 bg-raised px-2">
                  <span className="t-small truncate">{music.name}</span>
                </div>
              ) : (
                // SOT (Studio.dc.html): the text is left-aligned and takes the row, "Upload music" sits at the right end.
                <div className="absolute inset-y-1 left-0 right-0 flex items-center gap-2 rounded-md border border-dashed border-line2 py-1 pl-2.5 pr-1 text-muted">
                  <span className="t-small flex-1">{s.csNoMusic}</span>
                  <button type="button" className="vie-btn vie-btn-sm shrink-0" onClick={() => setBinTab?.(3)}>{s.csUploadMusic}</button>
                </div>
              )}
            </div>
          </div>
          {/* Beats */}
          <div className="flex min-h-0 flex-[0.8]">
            <LaneLabel>{s.csBeatsLane}</LaneLabel>
            <div className="relative min-w-0 flex-1">
              {beats.length === 0 ? (
                <span className="t-small absolute inset-y-0 flex items-center text-muted">{s.csBeatsDetected}</span>
              ) : beats.map((b) => (
                <span key={b} className="absolute top-1/2 h-3 w-px -translate-y-1/2" style={{ left: `${((b) / span) * 100}%`, background: "rgb(var(--primary))" }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
