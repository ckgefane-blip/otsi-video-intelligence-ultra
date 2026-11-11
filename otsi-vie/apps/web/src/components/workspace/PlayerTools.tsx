"use client";
/**
 * v3 Phase B.4 (ADR-083): the Analysis player's tools beyond play / pause.
 *   useOverlayOpacity  how strongly each overlay is drawn (boxes and IDs, pitch layers, ball), remembered in this browser
 *   useMarks           In and Out marks (I / O keys or the buttons) and Loop: with both marks, playback returns to In at Out
 *   zoomOrigin         the zoom follows the selected player while he is on screen, else the picture's centre
 *   SnapshotDialog     B.5: a full-resolution still of the frame at the playhead, made by the SNAPSHOT job, with only the boxes recorded there
 */
import * as Dialog from "@radix-ui/react-dialog";
import { snapshotFileName, type Snapshot } from "@otsi-vie/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiBlob, ApiProblem } from "@/lib/api";
import { clock } from "./shared";
import type { AnalysisWorkspaceState as WorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { useLocale } from "@/lib/i18n";

/* ------------------------------------------------------------------ overlay opacity */
export type OverlayOpacity = { boxes: number; pitch: number; ball: number };
const OPACITY_KEY = "otsi.analysis.overlayOpacity";
const FULL: OverlayOpacity = { boxes: 1, pitch: 1, ball: 1 };
export const clampOpacity = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0.1, v)) : 1);

export function readOpacity(raw: string | null): OverlayOpacity {
  try {
    const o = raw ? (JSON.parse(raw) as Partial<OverlayOpacity>) : {};
    return { boxes: clampOpacity(o.boxes ?? 1), pitch: clampOpacity(o.pitch ?? 1), ball: clampOpacity(o.ball ?? 1) };
  } catch { return FULL; }
}

export function useOverlayOpacity() {
  const [op, setOp] = useState<OverlayOpacity>(FULL);
  useEffect(() => { try { setOp(readOpacity(localStorage.getItem(OPACITY_KEY))); } catch { /* storage unavailable */ } }, []);
  const set = useCallback((k: keyof OverlayOpacity, v: number) => setOp((o) => {
    const n = { ...o, [k]: clampOpacity(v) };
    try { localStorage.setItem(OPACITY_KEY, JSON.stringify(n)); } catch { /* storage unavailable */ }
    return n;
  }), []);
  return { op, set };
}

/* ------------------------------------------------------------------ In / Out marks and loop */
export type Marks = { inUs: number | null; outUs: number | null; loop: boolean };

/** where playback goes next: back to In when it reaches Out while looping (null: carry on) */
export function loopTarget(m: Marks, tUs: number): number | null {
  if (!m.loop || m.inUs === null || m.outUs === null || m.outUs <= m.inUs) return null;
  return tUs >= m.outUs || tUs < m.inUs - 250_000 ? m.inUs : null;
}

/** setting one mark past the other moves the other, so In is always before Out */
export function setMark(m: Marks, which: "in" | "out", tUs: number): Marks {
  if (which === "in") return { ...m, inUs: tUs, outUs: m.outUs !== null && m.outUs <= tUs ? null : m.outUs };
  return { ...m, outUs: tUs, inUs: m.inUs !== null && m.inUs >= tUs ? null : m.inUs };
}

export function useMarks(ws: WorkspaceState | null) {
  const [marks, setMarks] = useState<Marks>({ inUs: null, outUs: null, loop: false });
  const vid = ws?.video?.id ?? null;
  useEffect(() => { setMarks({ inUs: null, outUs: null, loop: false }); }, [vid]);
  const t = ws?.timeUs ?? 0;
  const playing = !!ws?.playing;
  useEffect(() => {
    if (!playing) return;
    const to = loopTarget(marks, t);
    if (to !== null) ws?.seek(to);
  }, [t, playing, marks, ws]);
  return {
    marks,
    markIn: () => setMarks((m) => setMark(m, "in", Math.round(t))),
    markOut: () => setMarks((m) => setMark(m, "out", Math.round(t))),
    toggleLoop: () => setMarks((m) => ({ ...m, loop: !m.loop })),
    clear: () => setMarks({ inUs: null, outUs: null, loop: false }),
  };
}

/* ------------------------------------------------------------------ zoom */
export const ZOOMS = ["1", "1.5", "2", "3"] as const;

/** the zoom's origin in percent of the picture: the selected player's box centre while he is on screen, else the centre */
export function zoomOrigin(box: { x: number; y: number; w: number; h: number } | null): string {
  if (!box) return "50% 50%";
  const pct = (v: number) => `${Math.round(Math.min(1, Math.max(0, v)) * 1000) / 10}%`;
  return `${pct(box.x + box.w / 2)} ${pct(box.y + box.h / 2)}`;
}

/* ------------------------------------------------------------------ snapshot (B.5) */
type Opts = { boxes: boolean; labels: boolean; selected: boolean; caption: boolean };

export function SnapshotDialog({ ws, open, onOpenChange }: { ws: WorkspaceState | null; open: boolean; onOpenChange(o: boolean): void }) {
  const { t: dict } = useLocale();
  const [opts, setOpts] = useState<Opts>({ boxes: true, labels: false, selected: true, caption: true });
  const [list, setList] = useState<Snapshot[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<{ id: string; url: string } | null>(null);
  const vid = ws?.video?.id ?? null;
  const at = Math.round(ws?.timeUs ?? 0);
  const selId = ws?.selectedId ?? null;
  const load = useCallback(async () => {
    if (!vid) return;
    try { setList(await api<Snapshot[]>(`/v1/videos/${vid}/snapshots`)); } catch { setList([]); }
  }, [vid]);
  useEffect(() => { if (open) void load(); }, [open, load]);
  // ask again while one is being made
  const waiting = !!list?.some((s) => s.status === "QUEUED" || s.status === "RUNNING");
  useEffect(() => {
    if (!open || !waiting) return;
    const h = setInterval(() => void load(), 1500);
    return () => clearInterval(h);
  }, [open, waiting, load]);
  // the newest finished one is shown
  const latest = list?.find((s) => s.status === "SUCCEEDED") ?? null;
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !latest || shown?.id === latest.id) return;
    let live = true;
    void apiBlob(`/v1/snapshots/${latest.id}/image`).then((b) => {
      if (!live) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(b);
      setShown({ id: latest.id, url: urlRef.current });
    }, () => undefined);
    return () => { live = false; };
  }, [open, latest, shown?.id]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const make = async () => {
    if (!vid) return;
    setBusy(true); setErr(null);
    try {
      await api(`/v1/videos/${vid}/snapshots`, { method: "POST", json: { at_pts_us: at, overlays: { boxes: opts.boxes, labels: opts.boxes && opts.labels, selected_track_id: opts.selected ? selId : null, caption: opts.caption } } });
      await load();
    } catch (x) { setErr(x instanceof ApiProblem ? x.message : dict.body.workspace.snapshotNotAsked); } finally { setBusy(false); }
  };
  const save = async (s: Snapshot) => {
    try {
      const b = await apiBlob(`/v1/snapshots/${s.id}/image?download=1`);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = snapshotFileName(ws?.video?.title ?? ws?.video?.original_filename ?? null, s.frame_pts_us ?? s.pts_us);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (x) { setErr(x instanceof ApiProblem ? x.message : dict.body.workspace.pictureNotSaved); }
  };
  const remove = async (s: Snapshot) => {
    try { await api(`/v1/snapshots/${s.id}`, { method: "DELETE" }); if (shown?.id === s.id) setShown(null); await load(); }
    catch (x) { setErr(x instanceof ApiProblem ? x.message : dict.body.analysis.thatDidNotWork); }
  };
  const box = (k: keyof Opts, label: string, disabled = false, note?: string) => (
    <label className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" data-snap-opt={k} checked={opts[k] && !disabled} disabled={disabled} onChange={(e) => setOpts((o) => ({ ...o, [k]: e.target.checked }))} />
      <span>{label}{note && <span className="text-xs text-muted"> · {note}</span>}</span>
    </label>
  );
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="snapshot" className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(860px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-semibold">{dict.body.workspace.snapshotLabel}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">
            {dict.body.workspace.snapshotDesc.replace("{a}", clock(at))}
          </Dialog.Description>
          {ws?.canWrite ? (
            <div className="mb-3 grid gap-1.5 sm:grid-cols-2">
              {box("boxes", dict.body.workspace.playerBoxesLower, !ws.run, ws.run ? undefined : dict.body.workspace.noFinishedAnalysisLower)}
              {box("labels", dict.body.workspace.trackNumbersNames, !opts.boxes || !ws.run)}
              {box("selected", dict.body.workspace.highlightPlayer, !selId, selId ? undefined : dict.body.workspace.selectPlayerFirstLower)}
              {box("caption", dict.body.workspace.captionVideoTime)}
              <div className="sm:col-span-2">
                <button type="button" data-snap-make disabled={busy || !vid} onClick={() => void make()}
                  className="rounded-ctl border border-primary bg-primary/20 px-3 py-1.5 font-semibold disabled:opacity-40">{busy ? dict.body.workspace.asking : dict.body.workspace.makeSnapshotAt.replace("{a}", clock(at))}</button>
              </div>
            </div>
          ) : <p className="mb-3 text-xs text-muted">{dict.body.workspace.roleSnapshots}</p>}
          {err && <p className="mb-2 text-xs text-[#ff8a8a]" role="alert">{err}</p>}
          {shown && latest && shown.id === latest.id && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown.url} alt={dict.body.workspace.snapshotAtAlt.replace("{a}", clock(latest.frame_pts_us ?? latest.pts_us))} data-snap-image className="mb-3 w-full rounded-ctl border border-line" />
          )}
          {list === null ? <p className="text-xs text-muted">{dict.body.workspace.readingSnapshots}</p> : list.length === 0 ? <p className="text-xs text-muted">{dict.body.workspace.noSnapshotsYet}</p> : (
            <ol className="space-y-1" data-snap-list>
              {list.map((s) => (
                <li key={s.id} data-snap={s.status} className="flex items-center gap-2 rounded-ctl border border-line/60 px-2.5 py-1.5">
                  <button type="button" className="shrink-0 font-mono text-xs text-[#9fd0ff]" onClick={() => { ws?.seek(s.frame_pts_us ?? s.pts_us); onOpenChange(false); }}>{clock(s.frame_pts_us ?? s.pts_us)}</button>
                  <span className="min-w-0 flex-1 text-xs">
                    {s.status === "SUCCEEDED" ? `${s.width}×${s.height}${s.overlays.boxes ? dict.body.workspace.boxesDrawn.replace("{a}", String(s.boxes_drawn ?? 0)) : ""}` : s.status === "FAILED" ? <span className="text-[#ff8a8a]">{s.failure}</span> : dict.body.workspace.beingMade}
                    <span className="block text-muted">{s.requested_by?.name ?? dict.body.workspace.someoneLabel}</span>
                  </span>
                  {s.status === "SUCCEEDED" && <button type="button" data-snap-save={s.id} onClick={() => void save(s)} className="shrink-0 rounded-ctl border border-line px-2 py-1 text-xs">{dict.body.workspace.savePng}</button>}
                  {ws?.canWrite && s.status !== "QUEUED" && s.status !== "RUNNING" && (
                    <button type="button" data-snap-remove={s.id} onClick={() => void remove(s)} className="shrink-0 rounded-ctl border border-line px-2 py-1 text-xs">{dict.body.upload.removeVerb}</button>
                  )}
                </li>
              ))}
            </ol>
          )}
          <div className="mt-3 text-right"><Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{dict.common.close}</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
