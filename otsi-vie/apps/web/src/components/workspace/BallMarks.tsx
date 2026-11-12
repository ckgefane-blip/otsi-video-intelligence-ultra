"use client";
/**
 * The ball on Page 04 (ADR-037). The engine follows the ball by itself in every finished analysis (migration 0028); this module shows where
 * it found it (the ring on the video), how often, and how it compares with a person's marks. Marks (migration 0027) are for the moments the
 * engine cannot see: the marking dialog jumps to those frames, shows the engine's guess where it has one, and records a click, "not
 * visible", or "the engine is right".
 *
 * The ball is 5-10 px on broadcast footage: the frame is shown at full size with a 4x magnifier under the cursor; the previous frame's mark is
 * drawn faintly to show where to look. Keys: N not visible, Enter the engine is right, U next frame it cannot see, arrows move without marking.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { ballAt, type BallMarks, type BallPath } from "@otsi-vie/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { u } from "@/components/stage/DesignStage";
import { useDw } from "./ResizableColumns";
import { useLocale } from "@/lib/i18n";

const ZOOM = 4, LOUPE = 180;

export type BallState = {
  marks: BallMarks | null; setMarks(m: BallMarks): void; reloadMarks(): Promise<void>;
  path: BallPath | null; reloadPath(): Promise<void>;
  /** follow the ball again in the latest finished analysis (POST); null when it started, else the reason it could not */
  start(): Promise<string | null>;
};

export function useBall(videoId: string | undefined): BallState {
  const { t: dict } = useLocale();
  const [marks, setMarks] = useState<BallMarks | null>(null);
  const [path, setPath] = useState<BallPath | null>(null);
  const reloadMarks = useCallback(async () => {
    if (!videoId) { setMarks(null); return; }
    try { setMarks(await api<BallMarks>(`/v1/videos/${videoId}/ball-marks`)); } catch { /* keep what is shown */ }
  }, [videoId]);
  const reloadPath = useCallback(async () => {
    if (!videoId) { setPath(null); return; }
    try { setPath(await api<BallPath>(`/v1/videos/${videoId}/ball`)); } catch { /* keep what is shown */ }
  }, [videoId]);
  useEffect(() => { setMarks(null); setPath(null); void reloadMarks(); void reloadPath(); }, [reloadMarks, reloadPath]);
  const busy = path?.track?.status === "QUEUED" || path?.track?.status === "RUNNING";
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void reloadPath(), 3000);
    return () => clearInterval(t);
  }, [busy, reloadPath]);
  const start = useCallback(async () => {
    if (!videoId) return dict.body.workspace.noVideo;
    try { setPath(await api<BallPath>(`/v1/videos/${videoId}/ball`, { method: "POST" })); return null; }
    catch (e) { return e instanceof ApiProblem ? e.message : dict.body.workspace.engineCouldNotStart; }
  }, [videoId]);
  const set = useCallback((m: BallMarks) => { setMarks(m); void reloadPath(); }, [reloadPath]);   // the check against the marks changes with them
  return { marks, setMarks: set, reloadMarks, path, reloadPath, start };
}

const stepOf = (path: BallPath | null, fallback: number) => Number(path?.track?.metrics?.step_us) || fallback;

/** Where the engine has the ball at `us`: on an analysed frame its own answer; between two known neighbouring frames a straight line. */
export function engineBallAt(path: BallPath | null, us: number, stepUs: number): { x: number; y: number; inferred: boolean } | null {
  if (!path || !path.t.length) return null;
  const t = path.t;
  let lo = 0, hi = t.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t[m]! <= us) lo = m + 1; else hi = m; }
  const a = lo - 1, b = lo;
  const near = (i: number) => i >= 0 && i < t.length && Math.abs(t[i]! - us) < stepUs / 2;
  if (a >= 0 && b < t.length && t[b]! - t[a]! <= stepUs * 1.6) {
    const f = (us - t[a]!) / (t[b]! - t[a]!);
    return { x: path.x[a]! + (path.x[b]! - path.x[a]!) * f, y: path.y[a]! + (path.y[b]! - path.y[a]!) * f, inferred: path.s[a] === "I" && path.s[b] === "I" };
  }
  const i = near(a) ? a : near(b) ? b : -1;
  return i < 0 ? null : { x: path.x[i]!, y: path.y[i]!, inferred: path.s[i] === "I" };
}

/** The ring on the video: solid where detected, dashed where filled in across a short gap; nothing where the engine does not know. */
export function BallOverlay({ ball, timeUs, stepUs }: { ball: BallState; timeUs: number; stepUs: number }) {
  const at = engineBallAt(ball.path, timeUs, stepOf(ball.path, stepUs));
  if (!at) return null;
  return (
    <svg data-ball-ring aria-hidden viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
      <ellipse cx={at.x * 1000} cy={at.y * 1000} rx={11} ry={19.5} fill="none" stroke="#ffd400" strokeWidth={3} strokeDasharray={at.inferred ? "6 5" : undefined} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

export function BallBlock({ ball, canWrite, onMark }: { ball: BallState; canWrite: boolean; onMark: () => void }) {
  const { t: dict } = useLocale();
  const dw = useDw();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tr = ball.path?.track ?? null, m = (tr?.metrics ?? {}) as Record<string, number>;
  const check = ball.path?.check ?? null;
  const n = ball.marks ? ball.marks.visible + ball.marks.hidden : 0;
  const go = async () => { setBusy(true); setErr(await ball.start()); setBusy(false); };
  const line = { color: "#8ea3bf" } as const;
  const btn = { minHeight: u(52), padding: `${u(8)} ${u(12)}`, lineHeight: 1.25, border: `${u(1.5)} solid #1f5a9c`, borderRadius: u(8), background: "#0a2a55", color: "#33a8ff", fontFamily: "inherit", fontSize: u(19), fontWeight: 400, cursor: "pointer" } as const;
  return (
    <div data-ball-block style={{ display: "flex", flexDirection: "column", gap: u(10), width: u(330 + dw), marginTop: u(18), fontSize: u(17) }}>
      <div style={{ color: "#cfe0f5", fontWeight: 400, fontSize: u(20) }}>{dict.body.processing.ball}<span data-ball-experimental style={{ marginLeft: u(8), padding: `${u(1)} ${u(8)}`, borderRadius: u(10), background: "#3a2a05", color: "#ffd400", fontSize: u(14), fontWeight: 400 }}>{dict.body.workspace.experimental}</span></div>
      <span data-ball-source style={{ color: "#ffd400" }}>{String(m.candidates_from ?? "").startsWith("ball_net")
        ? dict.body.workspace.ballModelOwn
        : tr?.status === "SUCCEEDED" ? dict.body.workspace.ballModelGeneral
        : dict.body.workspace.notYetMeasuredBall}</span>
      {!tr && <span style={line}>{dict.body.workspace.engineFollowsBall}</span>}
      {tr && (tr.status === "QUEUED" || tr.status === "RUNNING") && <span role="status" style={line}>{dict.body.workspace.followingBall} {tr.stage_message ?? ""}{tr.progress !== null ? ` (${Math.round(tr.progress)}%)` : ""}</span>}
      {tr?.status === "FAILED" && <span role="alert" style={{ color: "#ff8a8a" }}>{tr.failure_detail ?? dict.body.workspace.engineCouldNotFollow}</span>}
      {tr?.status === "SUCCEEDED" && (
        <span data-ball-found style={line}>
          {dict.body.workspace.ballFoundDetail.replace("{a}", pct((m.detected ?? 0) + (m.inferred ?? 0), m.frames ?? 0)).replace("{b}", String(m.detected ?? 0)).replace("{c}", String(m.inferred ?? 0)).replace("{d}", String(m.unknown ?? 0))}
        </span>
      )}
      {check && (
        <span data-ball-check style={line}>
          {dict.body.workspace.ballCheckStart.replace("{a}", String(n))}<b style={{ color: "#2ee86a" }}>{check.right}</b>{dict.body.workspace.ballCheckWrong}<b style={{ color: check.wrong ? "#ff8a8a" : "#dbe8f8" }}>{check.wrong}</b>{dict.body.workspace.ballCheckUnknown.replace("{a}", String(check.unknown))}{check.marked_hidden ? dict.body.workspace.ballCheckHidden.replace("{a}", String(check.marked_hidden)).replace("{b}", String(check.invented)) : ""}.
        </span>
      )}
      {canWrite && (!tr || tr.status === "FAILED") && <button type="button" data-ball-start onClick={() => void go()} disabled={busy} style={btn}>{dict.body.workspace.findBall}</button>}
      {canWrite && tr?.status === "SUCCEEDED" && (
        <button type="button" data-ball-open onClick={onMark} style={btn}>{dict.body.workspace.markFramesUnseen}</button>
      )}
      {canWrite && tr?.status === "SUCCEEDED" && (
        <button type="button" data-ball-again onClick={() => void go()} disabled={busy} style={{ ...btn, minHeight: u(40), fontSize: u(16), fontWeight: 400, background: "transparent", color: "#8ea3bf", border: `${u(1)} solid #1f3f6a` }}>{dict.body.workspace.followBallAgain}
        </button>
      )}
      {!canWrite && <span style={line}>{dict.body.workspace.roleBallMarks}</span>}
      {err && <span role="alert" style={{ color: "#ff8a8a" }}>{err}</span>}
    </div>
  );
}

export function BallMarkDialog({ open, onOpenChange, videoId, videoRef, stepUs, ball }: {
  open: boolean; onOpenChange: (o: boolean) => void; videoId: string; videoRef: React.MutableRefObject<HTMLVideoElement | null>; stepUs: number; ball: BallState;
}) {
  const { t: dict } = useLocale();
  const marks = ball.marks, path = ball.path;
  const step = stepOf(path, stepUs);
  const [t, setT] = useState(0);
  const [size, setSize] = useState({ w: 1280, h: 720 });
  const [frameKey, setFrameKey] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const frame = useRef<HTMLCanvasElement | null>(null);
  const [view, setView] = useState<HTMLCanvasElement | null>(null);
  const snap = useCallback((us: number) => Math.max(0, Math.round(Math.round(us / step) * step)), [step]);
  const byTime = useMemo(() => new Map((marks?.marks ?? []).map((m) => [m.pts_us, m])), [marks]);
  const near = (us: number) => { for (const d of [0, -1, 1, -2, 2]) { const m = byTime.get(us + d); if (m) return m; } return undefined; };
  const here = near(t), before = near(snap(t - step));
  const ei = path ? ballAt(path.t, t, step) : -1;
  const engine = ei >= 0 && path ? { x: path.x[ei]!, y: path.y[ei]!, inferred: path.s[ei] === "I" } : null;

  const capture = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { setErr(dict.body.workspace.videoNotReady); return; }
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    frame.current = c; setSize({ w: v.videoWidth, h: v.videoHeight }); setFrameKey((k) => k + 1);
  }, [videoRef]);

  const go = useCallback((us: number) => {                // show the analysed frame at `us`
    const v = videoRef.current;
    if (!v) return;
    const target = snap(us);
    setT(target); setErr(null);
    const done = () => { v.removeEventListener("seeked", done); capture(); };
    v.addEventListener("seeked", done);
    v.currentTime = target / 1e6 + 0.001;
  }, [videoRef, snap, capture]);

  /** the next analysed frame after `us` where the engine does not know where the ball is and nobody has marked it */
  const nextUnknown = useCallback((us: number) => {
    const end = (videoRef.current?.duration ?? 0) * 1e6;
    for (let k = Math.round(us / step) + 1; k * step <= end; k++) {
      const s = snap(k * step);
      if ((!path || ballAt(path.t, s, step) < 0) && !near(s)) return s;
    }
    return null;
  }, [path, step, snap, videoRef, byTime]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {                                       // opening: pause on the analysed frame nearest the playhead
    if (!open) return;
    const v = videoRef.current;
    v?.pause();
    go(snap((v?.currentTime ?? 0) * 1e6));
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {                                       // draw: the frame, the engine's ball, last frame's mark (faint), this frame's mark, the magnifier
    const c = view, f = frame.current;
    if (!open || !c || !f) return;
    c.width = size.w; c.height = size.h;
    const g = c.getContext("2d")!;
    g.drawImage(f, 0, 0);
    const ring = (x: number, y: number, col: string, r: number, dash: number[] = []) => { g.setLineDash(dash); g.beginPath(); g.arc(x * size.w, y * size.h, r, 0, 2 * Math.PI); g.lineWidth = 2; g.strokeStyle = col; g.stroke(); g.setLineDash([]); };
    if (engine && !here) ring(engine.x, engine.y, "#33d6ff", 13, engine.inferred ? [5, 4] : []);
    if (before?.visible && before.x !== null && before.y !== null) ring(before.x, before.y, "rgba(255,214,0,0.55)", 16);
    if (here?.visible && here.x !== null && here.y !== null) ring(here.x, here.y, "#2ee86a", 10);
    if (hover) {
      const sx = hover.x * size.w, sy = hover.y * size.h, src = LOUPE / ZOOM;
      const lx = Math.min(size.w - LOUPE - 8, sx + 24), ly = Math.max(8, sy - LOUPE - 24);
      g.save(); g.beginPath(); g.rect(lx, ly, LOUPE, LOUPE); g.clip();
      g.imageSmoothingEnabled = false;
      g.drawImage(f, sx - src / 2, sy - src / 2, src, src, lx, ly, LOUPE, LOUPE);
      g.restore();
      g.lineWidth = 2; g.strokeStyle = "#33a8ff"; g.strokeRect(lx, ly, LOUPE, LOUPE);
      g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(lx + LOUPE / 2, ly + LOUPE / 2 - 12); g.lineTo(lx + LOUPE / 2, ly + LOUPE / 2 + 12); g.moveTo(lx + LOUPE / 2 - 12, ly + LOUPE / 2); g.lineTo(lx + LOUPE / 2 + 12, ly + LOUPE / 2); g.stroke();
    }
  }, [open, view, frameKey, size, hover, here, before, engine?.x, engine?.y]);   // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (visible: boolean, x: number | null = null, y: number | null = null) => {
    setBusy(true); setErr(null);
    try {
      ball.setMarks(await api<BallMarks>(`/v1/videos/${videoId}/ball-marks`, { method: "PUT", json: { pts_us: t, visible, x, y } }));
      go(t + step);
    } catch (x2) { setErr(x2 instanceof ApiProblem ? x2.message : dict.body.workspace.markNotSaved); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!here) return;
    setErr(null);
    try { await api(`/v1/ball-marks/${here.id}`, { method: "DELETE" }); await ball.reloadMarks(); void ball.reloadPath(); }
    catch (x2) { setErr(x2 instanceof ApiProblem ? x2.message : dict.body.workspace.markNotRemoved); }
  };
  const jump = () => { const s = nextUnknown(t); if (s === null) setErr(dict.body.workspace.engineKnowsBall); else go(s); };
  const pos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (busy) return;
    if (e.key === "n" || e.key === "N") { e.preventDefault(); void save(false); }
    else if ((e.key === "u" || e.key === "U")) { e.preventDefault(); jump(); }
    else if (e.key === "Enter" && engine) { e.preventDefault(); void save(true, engine.x, engine.y); }
    else if (e.key === "ArrowRight") { e.preventDefault(); go(t + step); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(t - step); }
  };
  const said = here ? (here.visible ? dict.body.workspace.saidMarkedBall : dict.body.workspace.saidMarkedHidden) : engine ? (engine.inferred ? dict.body.workspace.saidEngineFilled : dict.body.workspace.saidEngineFound) : dict.body.workspace.saidEngineCannotSee;
  const btn = "rounded-ctl border border-line px-2 py-1";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/75" />
        <Dialog.Content data-dialog="ball-marks" onKeyDown={onKey} className="fixed left-1/2 top-1/2 z-50 max-h-[96vh] w-[min(1400px,98vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-normal">{dict.body.workspace.markBallUnseen}</Dialog.Title>
          <Dialog.Description className="mb-2 text-xs text-muted">
            <span className="font-normal">{dict.body.workspace.nextUnseen}</span>{dict.body.workspace.jumpsNextFrame}<span className="font-normal">N</span> {dict.body.workspace.whenNobodyCouldSee}
            {dict.body.workspace.whereBlueRing} <span className="font-normal">Enter</span>{dict.body.workspace.confirmsIt}
          </Dialog.Description>
          <canvas ref={setView} data-ball-canvas aria-label={dict.body.workspace.frameToMark} onMouseMove={(e) => setHover(pos(e))} onMouseLeave={() => setHover(null)}
            onClick={(e) => { if (!busy) { const p = pos(e); void save(true, p.x, p.y); } }}
            style={{ width: "100%", height: "auto", aspectRatio: `${size.w} / ${size.h}`, cursor: "crosshair", background: "#000", borderRadius: 8, display: "block" }} />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" role="status">
            <span className="text-fg">{dict.body.workspace.frameAt.replace("{a}", formatDuration(t))}</span>
            <span className="text-muted">· {said}{marks ? ` · ${dict.body.workspace.markedInVideo.replace("{a}", String(marks.visible + marks.hidden))}` : ""}</span>
            <span className="ml-auto" />
            <button type="button" onClick={() => go(t - step)} disabled={busy} className={btn}>{dict.body.workspace.backArrow}</button>
            <button type="button" onClick={() => go(t + step)} disabled={busy} className={btn}>{dict.body.workspace.skipArrow}</button>
            <button type="button" data-ball-hidden onClick={() => void save(false)} disabled={busy} className={btn}>{dict.body.workspace.notVisibleKey}</button>
            {engine && !here && <button type="button" data-ball-confirm onClick={() => void save(true, engine.x, engine.y)} disabled={busy} className={btn}>{dict.body.workspace.engineIsRightEnter}</button>}
            {here && <button type="button" onClick={() => void remove()} disabled={busy} className={`${btn} text-danger`}>{dict.body.workspace.removeMark}</button>}
            <button type="button" data-ball-next-unknown onClick={jump} disabled={busy} className={btn}>{dict.body.workspace.nextUnseenArrow}</button>
            <Dialog.Close className="rounded-ctl bg-primary px-3 py-1 font-normal text-white">{dict.body.upload.done}</Dialog.Close>
          </div>
          {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
