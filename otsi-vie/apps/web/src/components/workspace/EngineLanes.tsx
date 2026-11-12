"use client";
/**
 * v3 Phase B.3 (ADR-082): the Analysis timeline's engine lanes, in place of the player rows when "Engine lanes" is chosen above them.
 *   Shots / cuts     the camera shots of the latest finished analysis, alternating shades; a cut is where one ends
 *   Ball found       where the ball track saw the ball (detected, joined while under 1 s apart); "no ball track yet" when none
 *   Pitch measured   where a pitch calibration covers the picture (brighter = better measured)
 *   Selected player  where the selected track was seen (its own observations; gaps stay gaps)
 *   Markers & notes  notes people pinned on the video at a time: click one to go there; + Add pins one at the playhead
 * Only what the engine or a person recorded is drawn; an empty lane says why.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { VideoLanes, VideoMarker } from "@otsi-vie/contracts";
import { useCallback, useEffect, useState } from "react";
import { B, T, u } from "@/components/stage/DesignStage";
import { api, ApiProblem } from "@/lib/api";
import { clock, Hit, type Shared } from "./shared";
import { useLocale } from "@/lib/i18n";


/** the video's lanes, read again when the video, its run or its markers change */
export function useLanes(videoId: string | null, runId: string | null) {
  const [lanes, setLanes] = useState<VideoLanes | null>(null);
  const load = useCallback(() => (videoId ? api<VideoLanes>(`/v1/videos/${videoId}/lanes`).then(setLanes, () => setLanes(null)) : Promise.resolve(setLanes(null))), [videoId]);
  useEffect(() => { setLanes(null); void load(); }, [load, runId]);
  return { lanes, load, setMarkers: (m: VideoMarker[]) => setLanes((l) => (l ? { ...l, markers: m } : l)) };
}

export function EngineLanes({ s, x, lo, hi, spans, selectedLabel, lanes, setMarkers, X0, X1 }: {
  s: Shared; x: (us: number) => number; lo: number; hi: number; spans: [number, number][]; selectedLabel: string | null;
  lanes: VideoLanes | null; setMarkers(m: VideoMarker[]): void; X0: number; X1: number;
}) {
  const { t: dict } = useLocale();
  const ws = s.ws;
  const LANE_ROWS = [dict.body.workspace.shotsCuts, dict.body.workspace.ballFound, dict.body.workspace.pitchMeasured, dict.body.workspace.selectedPlayer, dict.body.workspace.markersNotes] as const;
  const [open, setOpen] = useState(false);
  const row = (i: number) => 1082 + i * 24.3;
  const inView = (a: number, b: number) => b >= lo && a <= hi;
  const bar = (key: string | number, i: number, a: number, b: number, color: string, opacity = 0.85, title?: string) => (
    <B key={key} x={x(a)} y={row(i) - 5} w={Math.max(2, x(b) - x(a))} h={10} style={{ background: color, borderRadius: u(2), opacity }} {...(title ? { title } : {})} />
  );
  const note = (i: number, text: string) => <T x={X0 + 8} y={row(i)} size={14} color="#6f86a6">{text}</T>;
  const L = lanes;
  return (
    <div data-engine-lanes>
      {LANE_ROWS.map((l, i) => (
        <T key={l} x={430} y={row(i)} size={16} color="#cfdcf0" style={{ maxWidth: u(165), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {i === 3 && selectedLabel ? dict.body.workspace.playerLabel.replace("{a}", selectedLabel) : l}
        </T>
      ))}
      {!L ? note(0, ws?.video ? dict.body.workspace.readingLanes : dict.body.workspace.chooseVideo) : (
        <>
          {/* 0 shots: alternating shades, so each cut shows */}
          <div data-lane-shots={L.shots.length}>
            {L.shots.length ? L.shots.filter((k) => inView(k.start_us, k.end_us)).map((k) => bar(`s${k.shot_number}`, 0, k.start_us, k.end_us, k.shot_number % 2 ? "#4a7fd0" : "#2a4f8a", 0.9, dict.body.workspace.shotTitle.replace("{a}", String(k.shot_number)).replace("{b}", clock(k.start_us)).replace("{c}", clock(k.end_us))))
              : note(0, L.run_id ? dict.body.workspace.noShotsRecorded : dict.body.workspace.noFinishedYet)}
          </div>
          <div data-lane-ball={L.ball?.length ?? "none"}>
            {L.ball === null ? note(1, dict.body.workspace.noBallTrackYet) : L.ball.length ? L.ball.filter((k) => inView(k.start_us, k.end_us)).map((k) => bar(`b${k.start_us}`, 1, k.start_us, k.end_us, "#ffd400", 0.85))
              : note(1, dict.body.workspace.ballTrackNoSee)}
          </div>
          <div data-lane-pitch={L.calibrated.length}>
            {L.calibrated.length ? L.calibrated.filter((k) => inView(k.start_us, k.end_us)).map((k) => bar(`c${k.start_us}`, 2, k.start_us, k.end_us, "#2ee86a", 0.35 + 0.55 * Math.min(1, Math.max(0, k.quality ?? 0.5)),
              dict.body.workspace.pitchMeasuredRange.replace("{a}", clock(k.start_us)).replace("{b}", clock(k.end_us)).replace("{c}", k.quality !== null ? dict.body.workspace.pitchQualityPart.replace("{a}", String(Math.round(k.quality * 100))) : "")))
              : note(2, dict.body.workspace.pitchNotMeasuredLane)}
          </div>
          <div data-lane-player={spans.length}>
            {selectedLabel ? spans.filter(([a, b]) => inView(a, b)).map(([a, b]) => bar(`p${a}`, 3, a, b, "#19d3ff")) : note(3, dict.body.workspace.selectPlayerSeen)}
          </div>
          <div data-lane-markers={L.markers.length}>
            {L.markers.length === 0 && note(4, dict.body.workspace.noMarkersLane)}
            {ws && L.markers.filter((m) => m.at_pts_us >= lo && m.at_pts_us <= hi).map((m) => (
              <button key={m.id} type="button" data-marker={m.id} aria-label={dict.body.workspace.markerAt.replace("{a}", clock(m.at_pts_us)).replace("{b}", m.body)} title={`${clock(m.at_pts_us)} · ${m.body}${m.author ? ` · ${m.author.name}` : ""}`}
                onClick={() => ws.seek(m.at_pts_us)}
                style={{ position: "absolute", left: u(x(m.at_pts_us) - 6), top: u(row(4) - 9 - 101), width: u(12), height: u(18), padding: 0, border: 0, cursor: "pointer", background: "transparent", zIndex: 3 }}>
                <span style={{ position: "absolute", left: u(1), top: 0, width: 0, height: 0, borderLeft: `${u(5)} solid transparent`, borderRight: `${u(5)} solid transparent`, borderTop: `${u(9)} solid #ff7ad9` }} />
                <span style={{ position: "absolute", left: u(5), top: u(8), width: u(2), height: u(10), background: "#ff7ad9" }} />
              </button>
            ))}
          </div>
        </>
      )}
      <Hit x={560} y={row(4) - 10} w={70} h={20} label={dict.body.workspace.markersAddNote} {...(ws?.video ? { onClick: () => setOpen(true) } : { reason: dict.body.workspace.chooseVideoFirstNoDot })}
        style={{ border: `${u(1.5)} solid #ff7ad9`, borderRadius: u(4), color: "#ffd1f2", fontSize: u(13), textAlign: "center", lineHeight: u(17) }}>{dict.body.workspace.addNote}</Hit>
      {/* a click on a lane seeks, as on the player rows */}
      {ws && hi > lo && (
        <button type="button" aria-label={dict.body.workspace.seekTimeline} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); ws.seek(lo + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (hi - lo)); }}
          style={{ position: "absolute", left: u(X0), top: u(1068 - 101), width: u(X1 - X0), height: u(24.3 * 4 + 4), padding: 0, border: 0, background: "transparent", cursor: "pointer", zIndex: 0 }} />
      )}
      <MarkerDialog s={s} open={open} onOpenChange={setOpen} markers={L?.markers ?? []} setMarkers={setMarkers} />
    </div>
  );
}

function MarkerDialog({ s, open, onOpenChange, markers, setMarkers }: { s: Shared; open: boolean; onOpenChange(o: boolean): void; markers: VideoMarker[]; setMarkers(m: VideoMarker[]): void }) {
  const { t: dict } = useLocale();
  const ws = s.ws;
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const at = Math.round(ws?.timeUs ?? 0);
  const vid = ws?.video?.id;
  const go = async (f: () => Promise<VideoMarker[]>) => {
    setBusy(true); setErr(null);
    try { setMarkers(await f()); return true; } catch (x) { setErr(x instanceof ApiProblem ? x.message : dict.body.analysis.thatDidNotWork); return false; } finally { setBusy(false); }
  };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setErr(null); } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="markers" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(620px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-normal">{dict.body.workspace.markersNotes}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{dict.body.workspace.notePinned}</Dialog.Description>
          {ws?.canWrite ? (
            <form className="mb-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (vid && body.trim()) void go(() => api<VideoMarker[]>(`/v1/videos/${vid}/markers`, { method: "POST", json: { at_pts_us: at, body: body.trim() } })).then((ok) => ok && setBody("")); }}>
              <label className="block text-xs text-muted" htmlFor="marker-body">{dict.body.workspace.noteAtPlayhead.replace("{a}", clock(at))}</label>
              <textarea id="marker-body" data-marker-body value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={2} className="w-full rounded-ctl border border-line bg-raised p-2" />
              <button type="submit" data-marker-add disabled={busy || !body.trim()} className="rounded-ctl border border-primary bg-primary/20 px-3 py-1.5 font-normal disabled:opacity-40">{dict.body.workspace.pinAt.replace("{a}", clock(at))}</button>
            </form>
          ) : <p className="mb-3 text-xs text-muted">{dict.body.workspace.roleReadMarkers}</p>}
          {err && <p className="mb-2 text-xs text-[#ff8a8a]" role="alert">{err}</p>}
          {markers.length === 0 ? <p className="text-xs text-muted">{dict.body.workspace.noMarkersYet}</p> : (
            <ol className="space-y-1" data-marker-list>
              {markers.map((m) => (
                <li key={m.id} className="flex items-center gap-2 rounded-ctl border border-line/60 px-2.5 py-1.5">
                  <button type="button" className="shrink-0 font-mono text-xs text-[#ffd1f2]" onClick={() => { ws?.seek(m.at_pts_us); onOpenChange(false); }}>{clock(m.at_pts_us)}</button>
                  <span className="min-w-0 flex-1"><span className="block break-words">{m.body}</span><span className="block text-xs text-muted">{m.author?.name ?? dict.body.workspace.someoneLabel}</span></span>
                  {ws?.canWrite && vid && (
                    <button type="button" data-marker-remove={m.id} disabled={busy} onClick={() => void go(() => api<VideoMarker[]>(`/v1/videos/${vid}/markers/${m.id}`, { method: "DELETE" }))}
                      className="shrink-0 rounded-ctl border border-line px-2 py-1 text-xs disabled:opacity-40">{dict.body.upload.removeVerb}</button>
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
