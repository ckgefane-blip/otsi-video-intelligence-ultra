"use client";
/**
 * Page 04: calibrate the pitch (Blueprint 03 step 8 `geometry`). A person pauses on a clear frame, picks a landmark of the pitch (the
 * diagram or the list) and clicks the same place in the picture; with four or more places the pitch lines are drawn over the frame, so
 * the person SEES whether they lie on the white lines before anything is started. The engine then snaps them onto the real lines and
 * follows the camera through the shot (CALIBRATE_PITCH job). Only moments it could measure get positions: everything else stays "not measured".
 * A moment can also have just 2-3 places (owner, 2026-10-31): the engine joins all moments into one match camera, and a moment WAITS until the
 * moments together pin it down. The diagram shows which places were already marked in other moments.
 * Or nobody clicks (ADR-036): "Find the pitch automatically" has the engine find the pitch in the whole video; clicking stays for the rest.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { CreatePitchCalibration, fitFromPoints, MIN_PITCH_EQUATIONS, pitchEquations, pitchLandmarks, pitchLines, type PitchCalibration, type PitchCamera, project, type Pt } from "@otsi-vie/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { u } from "@/components/stage/DesignStage";
import { useDw } from "./ResizableColumns";

const ACTIVE = (s: string) => s === "QUEUED" || s === "RUNNING";
const ALONE = 6;               // places with which a moment stands alone (pitch_job.MIN_TRUSTED_CLICKS), even where the lines are faint
const LEAST = 2;               // places with which a moment can be joined with the others through the match camera (camera.MIN_POINTS_PER_MOMENT)

/** The video's pitch calibrations, newest first, and its match camera; refreshed every 3 s while one is working. */
export function usePitchCalibrations(videoId: string | undefined) {
  const [list, setList] = useState<PitchCalibration[] | null>(null);
  const [camera, setCamera] = useState<PitchCamera | null>(null);
  const reload = useCallback(async () => {
    if (!videoId) { setList(null); setCamera(null); return; }
    try { setList(await api<PitchCalibration[]>(`/v1/videos/${videoId}/pitch-calibrations`)); } catch { setList((l) => l ?? []); }
    try { setCamera((await api<{ camera: PitchCamera | null }>(`/v1/videos/${videoId}/pitch-camera`)).camera); } catch { /* the block then says nothing about the camera */ }
  }, [videoId]);
  useEffect(() => { void reload(); }, [reload]);
  const working = list?.some((r) => ACTIVE(r.status)) ?? false;
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [working, reload]);
  return { list, camera, reload };
}

const group = (name: string) => (name.startsWith("left") ? "Left end" : name.startsWith("right") ? "Right end" : "Centre");

/* ------------------------------------------------------------------ the left-panel block */
export function PitchCalibrationBlock({ videoId, list, camera, reload, canWrite, onStart }: { videoId: string; list: PitchCalibration[] | null; camera: PitchCamera | null; reload: () => Promise<void>; canWrite: boolean; onStart: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const dw = useDw();
  const latest = list?.[0];
  const done = (list ?? []).filter((r) => r.status === "SUCCEEDED");
  const waiting = (list ?? []).filter((r) => r.status === "WAITING" || (r.status === "FAILED" && r.failure_code === "DOES_NOT_FIT_CAMERA"));
  const remove = async (id: string) => {
    setErr(null);
    try { await api(`/v1/pitch-calibrations/${id}`, { method: "DELETE" }); await reload(); } catch (x) { setErr(x instanceof ApiProblem ? x.message : "It could not be removed."); }
  };
  const [starting, setStarting] = useState(false);
  const auto = async () => {
    setErr(null); setStarting(true);
    try { await api(`/v1/videos/${videoId}/pitch-calibrations/auto`, { method: "POST", json: {} }); await reload(); }
    catch (x) { setErr(x instanceof ApiProblem ? x.message : "It could not be started."); } finally { setStarting(false); }
  };
  const busy = !!latest && ACTIVE(latest.status);
  return (
    <div data-pitch-block style={{ display: "flex", flexDirection: "column", gap: u(10), width: u(330 + dw), maxWidth: u(330 + dw), marginTop: u(18), fontSize: u(17), overflowWrap: "anywhere" }}>
      <div style={{ color: "#cfe0f5", fontWeight: 700, fontSize: u(20) }}>Pitch calibration</div>
      {camera ? (
        <span data-pitch-camera style={{ color: "#cfe0f5" }}>Match camera: worked out from {camera.moments} moments ({camera.points} places); it stands {Math.round(camera.height_m)} m up. New moments need fewer places now.</span>
      ) : waiting.length > 0 ? <span data-pitch-camera style={{ color: "#8ea3bf" }}>Match camera: not worked out yet. Add moments of other parts of the pitch.</span> : null}
      {done.length === 0 && !(latest && ACTIVE(latest.status)) && <span style={{ color: "#8ea3bf" }}>The pitch is not calibrated, so players have no position on the pitch and the mini map stays empty.</span>}
      {latest && ACTIVE(latest.status) && (
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div role="progressbar" aria-label="Calibrating the pitch" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(latest.progress ?? 0)} style={{ height: u(14), borderRadius: u(7), border: `${u(1.5)} solid #1e90ff`, background: "#04182b", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(3, Math.min(100, latest.progress ?? 0))}%`, height: "100%", background: "linear-gradient(90deg,#14c3ff,#1e90ff)", transition: "width .6s ease-out" }} />
          </div>
          <span style={{ color: "#cfe0f5" }}>{Math.round(latest.progress ?? 0)}% · {latest.stage_message ?? "Working"}</span>
        </div>
      )}
      {latest?.status === "FAILED" && <span role="alert" style={{ color: "#ff8a8a" }}>{latest.failure_detail ?? "The calibration did not finish."}</span>}
      {done.map((r) => (
        <div key={r.id} data-pitch-done style={{ display: "flex", justifyContent: "space-between", gap: u(8), alignItems: "center", border: `${u(1.5)} solid #1f8a5a`, borderRadius: u(6), padding: `${u(6)} ${u(8)}`, background: "#0a2a2a" }}>
          <span style={{ color: "#cfe0f5" }} data-pitch-mode={r.mode}>
            {r.mode === "AUTO" ? (r.coverage.samples ? "Found automatically: " : "Found automatically: nowhere") : "Positions "}
            {r.coverage.samples > 0 && <>{formatDuration(r.coverage.first_pts_us)} to {formatDuration(r.coverage.last_pts_us)}</>}
            {r.mode !== "AUTO" && <span style={{ color: "#8ea3bf" }}> · {r.coverage.samples} moments</span>}
            {r.mode === "AUTO" && typeof r.metrics?.frames_tried === "number" && (
              <span style={{ display: "block", color: "#8ea3bf" }}>The pitch was found in {String(r.metrics.samples_measured ?? "?")} of {r.metrics.frames_tried} frames looked at ({r.metrics.step_s === 1 ? "one a second" : `one every ${String(r.metrics.step_s ?? 2)} s`}{r.metrics.match_time ? ", match time only" : ""}); between found frames of one shot the camera is followed. The rest are replays, close-ups or unclear and stay not measured.</span>
            )}
            {r.metrics?.kept_person_points === true && (
              <span data-kept-points style={{ display: "block", color: "#ffd600" }}>{r.metrics?.from_camera
                ? "From the match camera: the white lines in that frame did not confirm it, so the camera was not followed. Only that moment has positions."
                : "Your points were kept: the white lines in that frame did not confirm them, so the camera was not followed. Only that moment has positions."}</span>
            )}
          </span>
          {canWrite && <button type="button" onClick={() => void remove(r.id)} style={{ color: "#ff8a8a", background: "none", border: 0, cursor: "pointer", font: "inherit", whiteSpace: "nowrap", flexShrink: 0, alignSelf: "flex-start" }}>Remove</button>}
        </div>
      ))}
      {waiting.map((r) => (
        <div key={r.id} data-pitch-waiting style={{ display: "flex", justifyContent: "space-between", gap: u(8), alignItems: "center", border: `${u(1.5)} solid ${r.status === "FAILED" ? "#9c3a3a" : "#8a7a1f"}`, borderRadius: u(6), padding: `${u(6)} ${u(8)}`, background: "#1f1d0a" }}>
          <span style={{ color: "#cfe0f5" }}>
            Moment at {formatDuration(r.anchor_pts_us)}<span style={{ color: "#8ea3bf" }}> · {r.point_count} places</span>
            <span style={{ display: "block", color: r.status === "FAILED" ? "#ff8a8a" : "#ffd600" }}>
              {r.status === "FAILED" ? r.failure_detail : `Waiting: ${typeof r.metrics?.waiting === "string" ? r.metrics.waiting : "for more moments."}`}
            </span>
          </span>
          {canWrite && <button type="button" onClick={() => void remove(r.id)} style={{ color: "#ff8a8a", background: "none", border: 0, cursor: "pointer", font: "inherit", whiteSpace: "nowrap", flexShrink: 0, alignSelf: "flex-start" }}>Remove</button>}
        </div>
      ))}
      {err && <span role="alert" style={{ color: "#ff8a8a" }}>{err}</span>}
      {canWrite && (
        <button type="button" data-pitch-auto onClick={() => void auto()} disabled={busy || starting}
          style={{ minHeight: u(52), padding: `${u(8)} ${u(12)}`, lineHeight: 1.25, border: 0, borderRadius: u(8), background: busy || starting ? "#16406f" : "#1e90ff", color: "#fff", fontFamily: "inherit", fontSize: u(19), fontWeight: 700, cursor: busy || starting ? "default" : "pointer" }}>
          {starting ? "Starting…" : "Find the pitch automatically"}
        </button>
      )}
      {canWrite ? (
        <button type="button" onClick={onStart} disabled={busy}
          style={{ minHeight: u(52), padding: `${u(8)} ${u(12)}`, lineHeight: 1.25, border: `${u(1.5)} solid #1f5a9c`, borderRadius: u(8), background: "#0a2a55", color: "#33a8ff", fontFamily: "inherit", fontSize: u(19), fontWeight: 700, cursor: latest && ACTIVE(latest.status) ? "default" : "pointer" }}>
          {done.length || waiting.length ? "Calibrate another moment…" : "Calibrate the pitch…"}
        </button>
      ) : <span style={{ color: "#8ea3bf" }}>Your role can look at calibrations but not start one.</span>}
      <span style={{ color: "#8ea3bf" }}>The engine finds the pitch in the whole match by itself (about 30 minutes for the two halves of a match). Where it cannot, pause on a clear frame of the main camera and mark places yourself.</span>
    </div>
  );
}

/* ------------------------------------------------------------------ the dialog */
interface Placed { landmark: string; x: number; y: number }
interface OnLine { line: string; x: number; y: number }
const LINE = "line:";
const marked = (places: number, lineClicks: number) =>
  `${places} place${places === 1 ? "" : "s"}${lineClicks ? ` and ${lineClicks} line click${lineClicks === 1 ? "" : "s"}` : ""} marked.`;              // a selected line (click anywhere on it) rather than a landmark

export function PitchCalibrationDialog({ open, onOpenChange, videoId, videoRef, onStarted, others }: {
  open: boolean; onOpenChange: (o: boolean) => void; videoId: string; videoRef: React.MutableRefObject<HTMLVideoElement | null>; onStarted: () => void;
  /** the video's other moments: their places show on the diagram, and their pitch size is this one's */
  others?: PitchCalibration[] | null;
}) {
  const [length, setLength] = useState(105), [width, setWidth] = useState(68);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [onLine, setOnLine] = useState<OnLine[]>([]);             // clicks anywhere on a line (owner, 2026-10-31: centre views)
  const [kinds, setKinds] = useState<("place" | "line")[]>([]);  // the order of all clicks, for Undo last
  const clear = () => { setPlaced([]); setOnLine([]); setKinds([]); };
  const undo = () => {
    const last = kinds.at(-1);
    if (last === "line") setOnLine((l) => l.slice(0, -1)); else if (last === "place") setPlaced((p) => p.slice(0, -1));
    setKinds((k) => k.slice(0, -1));
  };
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [atUs, setAtUs] = useState(0);
  const frame = useRef<HTMLCanvasElement | null>(null);       // the captured picture
  const [viewEl, setViewEl] = useState<HTMLCanvasElement | null>(null);   // what is shown: the picture plus the pitch lines and marks (state, so drawing waits for the dialog to exist)
  const [frameKey, setFrameKey] = useState(0);                // bumps when a new picture was taken
  const [size, setSize] = useState({ w: 960, h: 540 });

  const lm = useMemo(() => pitchLandmarks(length, width), [length, width]);
  const kept = useMemo(() => (others ?? []).filter((r) => r.status !== "FAILED"), [others]);
  const elsewhere = useMemo(() => new Set(kept.flatMap((r) => r.landmarks)), [kept]);
  useEffect(() => {          // one match, one pitch: a new moment takes the size of the moments already there
    if (open && kept[0]) { setLength(kept[0].pitch_length_m); setWidth(kept[0].pitch_width_m); }
  }, [open, kept]);
  const lines = useMemo(() => pitchLines(length, width, 1.0), [length, width]);
  const fit = useMemo(() => {
    if (placed.length < 4) return null;
    return fitFromPoints(placed.map((p) => lm[p.landmark]!), placed.map((p) => [p.x, p.y] as Pt), 640, Math.round((640 * size.h) / size.w));
  }, [placed, lm, size]);
  // places on one line cannot fix a moment alone, but under the match camera they can (left-right gives the turn, height the tilt, spacing the zoom):
  // the centre landmarks all lie on the halfway line (owner's centre-circle view, 2026-10-31)
  const problem = fit && (fit.collinear ? (placed.length >= ALONE ? "These points lie on one line, which cannot fix the pitch alone: add points off that line, or use fewer than six to join this moment with your others." : null)
    : fit.mirrored ? "The pitch would be seen back to front: check which landmark each click is."
    : fit.rmsPx > 14 ? `The points do not agree with each other (off by about ${Math.round(fit.rmsPx)} px): check the landmark names.` : null);

  const capture = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { setErr("The video is not ready yet."); return; }
    const w = Math.min(1280, v.videoWidth), h = Math.round((w * v.videoHeight) / v.videoWidth);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(v, 0, 0, w, h);
    frame.current = c; setSize({ w, h }); setAtUs(Math.round(v.currentTime * 1_000_000)); setFrameKey((k) => k + 1);
  }, [videoRef]);

  useEffect(() => {          // opening: pause and take the picture
    if (!open) return;
    videoRef.current?.pause();
    clear(); setSelected(null); setErr(null);
    capture();
  }, [open, capture, videoRef]);

  const nudge = (dt: number) => {          // a second earlier or later, then take the picture again
    const v = videoRef.current;
    if (!v) return;
    const done = () => { v.removeEventListener("seeked", done); capture(); };
    v.addEventListener("seeked", done);
    v.currentTime = Math.max(0, v.currentTime + dt);
    clear();
  };

  useEffect(() => {          // draw: picture, pitch lines (once there are four places), the marks
    const c = viewEl, f = frame.current;
    if (!open || !c || !f) return;
    c.width = size.w; c.height = size.h;
    const g = c.getContext("2d")!;
    g.drawImage(f, 0, 0);
    if (fit?.H && !problem) {
      g.lineWidth = 2; g.strokeStyle = "rgba(255,61,242,0.9)";
      for (const pts of Object.values(lines)) {
        g.beginPath(); let pen = false;
        for (const p of pts) {
          const q = project(fit.H, p);
          if (!q || Math.abs(q[0]) > 4 || Math.abs(q[1]) > 4) { pen = false; continue; }
          if (pen) g.lineTo(q[0] * size.w, q[1] * size.h); else { g.moveTo(q[0] * size.w, q[1] * size.h); pen = true; }
        }
        g.stroke();
      }
    }
    placed.forEach((p, i) => {
      g.beginPath(); g.arc(p.x * size.w, p.y * size.h, 7, 0, 2 * Math.PI); g.fillStyle = "#2ee86a"; g.fill(); g.lineWidth = 2; g.strokeStyle = "#04230f"; g.stroke();
      g.fillStyle = "#fff"; g.font = "bold 15px sans-serif"; g.strokeStyle = "#000"; g.lineWidth = 3; g.strokeText(String(i + 1), p.x * size.w + 10, p.y * size.h - 8); g.fillText(String(i + 1), p.x * size.w + 10, p.y * size.h - 8);
    });
    onLine.forEach((p) => {                // a click on a line: an orange diamond
      const x = p.x * size.w, y = p.y * size.h;
      g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y); g.closePath();
      g.fillStyle = "#ff9d2e"; g.fill(); g.lineWidth = 2; g.strokeStyle = "#2b1600"; g.stroke();
    });
  }, [open, viewEl, frameKey, placed, onLine, fit, problem, lines, size]);

  const place = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selected) { setErr("First choose which place on the pitch you are marking: click it in the diagram or the list."); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    setErr(null);
    if (selected.startsWith(LINE)) {          // a line stays chosen: click it again further along
      setOnLine((l) => [...l, { line: selected.slice(LINE.length), x, y }]); setKinds((k) => [...k, "line"]);
      return;
    }
    setPlaced((ps) => [...ps.filter((p) => p.landmark !== selected), { landmark: selected, x, y }]); setKinds((k) => [...k, "place"]);
    setSelected(null);
  };

  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const body = CreatePitchCalibration.parse({ anchor_pts_us: atUs, points: placed, lines: onLine, pitch_length_m: length, pitch_width_m: width });
      await api(`/v1/videos/${videoId}/pitch-calibrations`, { method: "POST", json: body });
      onStarted(); onOpenChange(false);
    } catch (x) { setErr(x instanceof ApiProblem ? x.message : "It could not be started."); } finally { setBusy(false); }
  };

  const names = Object.keys(lm);
  const enough = placed.length >= 1 && pitchEquations(placed.length, onLine.length) >= MIN_PITCH_EQUATIONS;    // two places, or one place and two line clicks
  const ok = enough && !problem && (placed.length < ALONE || !!fit?.H);   // six stand alone; fewer are joined with the other moments
  const selLine = selected?.startsWith(LINE) ? selected.slice(LINE.length) : null;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="pitch-calibration" className="fixed left-1/2 top-1/2 z-50 max-h-[94vh] w-[min(1240px,97vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-semibold">Calibrate the pitch</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">
            Use a clear frame of the main camera. Choose a place on the pitch (diagram or list), then click the same place in the picture. Six or more places that are spread out
            draw the pitch over the picture: the pink lines should lie on the white lines. Corners of the penalty area and of the six-yard box work best.
            Fewer places (3-4, spread apart) are joined with your other moments through one match camera; where few corners show (the centre circle), also
            click lines anywhere along them, such as the far touchline and the circle.
          </Dialog.Description>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <canvas ref={setViewEl} onClick={place} aria-label="The frame to mark" data-pitch-canvas style={{ width: "100%", height: "auto", aspectRatio: `${size.w} / ${size.h}`, cursor: selected ? "crosshair" : "default", background: "#000", borderRadius: 8, display: "block" }} />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>Frame at {formatDuration(atUs)}</span>
                <button type="button" onClick={() => nudge(-1_000_000 / 1_000_000)} className="rounded-ctl border border-line px-2 py-1 text-fg">1 s earlier</button>
                <button type="button" onClick={() => nudge(1)} className="rounded-ctl border border-line px-2 py-1 text-fg">1 s later</button>
                <span className="ml-auto">Pitch size</span>
                <input aria-label="Pitch length in metres" type="number" min={90} max={120} value={length} onChange={(e) => setLength(Number(e.target.value) || 105)} className="w-16 rounded-ctl border border-line bg-transparent px-2 py-1 text-fg" />
                <span>×</span>
                <input aria-label="Pitch width in metres" type="number" min={45} max={90} value={width} onChange={(e) => setWidth(Number(e.target.value) || 68)} className="w-16 rounded-ctl border border-line bg-transparent px-2 py-1 text-fg" />
                <span>m</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <svg viewBox={`${-length / 2 - 4} ${-width / 2 - 4} ${length + 8} ${width + 8}`} role="img" aria-label="Pitch diagram: click a place to mark it" style={{ background: "#12532a", borderRadius: 8, width: "100%" }}>
                {Object.entries(lines).map(([k, pts]) => {
                  const on = selLine === k, used = onLine.some((l) => l.line === k), d = pts.map((p) => p.join(",")).join(" ");
                  return (
                    <g key={k} data-line={k} onClick={() => setSelected(LINE + k)} style={{ cursor: "pointer" }}>
                      <polyline points={d} fill="none" stroke={on ? "#33a8ff" : used ? "#ff9d2e" : "#e8f5ec"} strokeWidth={on || used ? 0.8 : 0.35} />
                      <polyline points={d} fill="none" stroke="transparent" strokeWidth={2.4}><title>{`${k}: click anywhere on it`}</title></polyline>
                    </g>
                  );
                })}
                {names.map((n) => {
                  const [x, y] = lm[n]!, isPlaced = placed.some((p) => p.landmark === n), isSel = selected === n, before = elsewhere.has(n);
                  return <circle key={n} data-landmark={n} data-marked-before={before || undefined} cx={x} cy={y} r={isSel ? 2.1 : 1.5} fill={isSel ? "#33a8ff" : isPlaced ? "#2ee86a" : "#ffd600"}
                    stroke={before && !isPlaced && !isSel ? "#ffffff" : "#000"} strokeWidth={before && !isPlaced && !isSel ? 0.7 : 0.3} onClick={() => setSelected(n)} style={{ cursor: "pointer" }}><title>{before ? `${n} (marked in another moment)` : n}</title></circle>;
                })}
              </svg>
              <p className="text-xs text-muted">{selLine ? <>Now click anywhere on <b className="text-fg">{selLine}</b> in the picture, as often as you like, spread along it.</>
                : selected ? <>Now click <b className="text-fg">{selected}</b> in the picture.</>
                : `Click a yellow dot (or a name below), then the same place in the picture. Green = marked.${elsewhere.size ? " White ring = marked in another moment." : ""} Or click a line, then anywhere on it in the picture (orange).`}</p>
              <ul className="max-h-[200px] overflow-y-auto text-xs" aria-label="Places on the pitch">
                {["Centre", "Left end", "Right end"].map((gname) => (
                  <li key={gname}><div className="mt-1 font-semibold text-muted">{gname}</div>
                    {names.filter((n) => group(n) === gname).map((n) => {
                      const idx = placed.findIndex((p) => p.landmark === n);
                      return (
                        <button key={n} type="button" data-pick={n} onClick={() => setSelected(n)} className={`flex w-full items-center gap-2 rounded-ctl px-2 py-1 text-left hover:bg-white/5 ${selected === n ? "bg-primary/20" : ""}`}>
                          <span aria-hidden className="inline-block w-4 text-center">{idx >= 0 ? idx + 1 : "·"}</span><span className={idx >= 0 ? "text-fg" : "text-muted"}>{n}</span>
                        </button>
                      );
                    })}
                  </li>
                ))}
                <li><div className="mt-1 font-semibold text-muted">Anywhere on a line</div>
                  {Object.keys(lines).map((k) => {
                    const n = onLine.filter((l) => l.line === k).length;
                    return (
                      <button key={k} type="button" data-pick-line={k} onClick={() => setSelected(LINE + k)} className={`flex w-full items-center gap-2 rounded-ctl px-2 py-1 text-left hover:bg-white/5 ${selLine === k ? "bg-primary/20" : ""}`}>
                        <span aria-hidden className="inline-block w-4 text-center">{n || "·"}</span><span className={n ? "text-fg" : "text-muted"}>{k}</span>
                      </button>
                    );
                  })}
                </li>
              </ul>
              <div className="flex gap-2">
                <button type="button" onClick={undo} disabled={!kinds.length} className="rounded-ctl border border-line px-2 py-1">Undo last</button>
                <button type="button" onClick={clear} disabled={!kinds.length} className="rounded-ctl border border-line px-2 py-1">Clear</button>
              </div>
            </div>
          </div>
          <p role="status" className="mt-3 text-xs">
            {!enough ? <span className="text-muted">{marked(placed.length, onLine.length)} Mark at least {LEAST} clear places, or one place and two clicks on lines; six or more places let this moment stand on its own.</span>
              : problem ? <span role="alert" className="text-danger">{problem}</span>
              : placed.length < ALONE ? <span data-joined className="text-fg">{marked(placed.length, onLine.length)}{placed.length >= 4 ? " The pink lines show what you have so far." : ""} With fewer than {ALONE}, this moment is joined with your other moments through the match camera: it gets positions once the moments together pin it down. Four places spread apart usually stand on the camera; with two or three, the white lines of this frame must confirm it.</span>
              : <span className="text-fg">{placed.length} places marked; the clicks agree to within {fit!.rmsPx.toFixed(1)} px. Check that the pink lines lie on the white lines, then start. If they do not, undo or re-mark the places that look wrong.</span>}
          </p>
          {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Dialog.Close className="rounded-ctl border border-line px-3 py-2">Cancel</Dialog.Close>
            <button type="button" data-pitch-start onClick={() => void start()} disabled={!ok || busy} className="rounded-ctl bg-primary px-3 py-2 font-semibold text-white disabled:opacity-50">{busy ? "Starting…" : placed.length >= ALONE ? "Calibrate the pitch" : "Add this moment"}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ------------------------------------------------------------------ the mini map */
export function PitchMinimap({ dots, length = 105, width = 68, calibrated }: { dots: { x: number; y: number; group: number | null; chosen?: boolean }[]; length?: number; width?: number; calibrated: boolean }) {
  const lines = useMemo(() => pitchLines(length, width, 1.5), [length, width]);
  const col = (g: number | null) => (g === 0 ? "#2ee86a" : g === 1 ? "#ff4d4d" : g === 2 ? "#ffd600" : "#19a0ff");
  return (
    <svg viewBox={`${-length / 2 - 3} ${-width / 2 - 3} ${length + 6} ${width + 6}`} style={{ width: "100%", height: "100%", display: "block" }} role="img"
      aria-label={dots.length ? `Pitch mini map: ${dots.length} players placed` : calibrated ? "Pitch mini map: no position at this moment" : "Pitch mini map: the pitch is not calibrated"}>
      <rect x={-length / 2 - 3} y={-width / 2 - 3} width={length + 6} height={width + 6} fill="#1d6a30" />
      {Object.entries(lines).map(([k, pts]) => <polyline key={k} points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#d7efe0" strokeWidth={0.5} />)}
      {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.chosen ? 2.6 : 1.9} fill={d.chosen ? "#fff" : col(d.group)} stroke="#000" strokeWidth={0.4} />)}
    </svg>
  );
}
