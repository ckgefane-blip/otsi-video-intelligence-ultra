"use client";
/**
 * AI Processing (page 03) for one video, connected to the real API: a footage-quality check with a recommended analysis profile and
 * per-profile time/memory estimates (ADR-034), start an analysis run (section 1), the run's steps with the
 * worker's own progress (2), what the worker is doing now and how runs ended (8), and the measured result of a finished run (11).
 * Events come from the followed ball (Analysis), not from this run, so the run lists only its own four steps; nothing is simulated.
 */
import { PROFILES, type AnalysisProfile, type AnalysisRun, type QualityAssessment, type Video } from "@otsi-vie/contracts";
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Play, Square, XCircle } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, ApiProblem } from "@/lib/api";
import { formatDuration, formatResolution, formatWhen, NOT_MEASURED } from "@/lib/format";

const RUNNERS = ["OWNER", "ADMIN", "ANALYST"];

interface Ctx {
  video: Video | null;
  runs: AnalysisRun[] | null;
  run: AnalysisRun | null;
  error: string | null;
  canRun: boolean;
  start(profile: AnalysisProfile, sampleFps: number | null): Promise<void>;
  assessment: QualityAssessment | null;
  assess(): Promise<void>;
  cancel(): Promise<void>;
}
const ProcessingCtx = createContext<Ctx | null>(null);
/** Processing data and actions for any presentation layer (ADR-035). */
export type ProcessingState = Ctx;
export function useProcessing(): Ctx {
  const c = useContext(ProcessingCtx);
  if (!c) throw new Error("ProcessingView outside its provider");
  return c;
}

const active = (r: AnalysisRun | null) => !!r && (r.status === "QUEUED" || r.status === "RUNNING");

export function ProcessingProvider({ videoId, children }: { videoId: string; children: ReactNode }) {
  const { organization } = useAuth();
  const [video, setVideo] = useState<Video | null>(null);
  const [runs, setRuns] = useState<AnalysisRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<QualityAssessment | null>(null);
  const loadAssessment = useCallback(async () => {
    try { setAssessment(await api<QualityAssessment>(`/v1/videos/${videoId}/assessments/latest`)); }
    catch (x) { if (x instanceof ApiProblem && x.status === 404) setAssessment(null); }
  }, [videoId]);
  useEffect(() => { void loadAssessment(); }, [loadAssessment]);
  useEffect(() => {                                   // follow a running assessment
    if (!assessment || (assessment.status !== "QUEUED" && assessment.status !== "RUNNING")) return;
    const t = setInterval(() => void loadAssessment(), 2000);
    return () => clearInterval(t);
  }, [assessment, loadAssessment]);
  const load = useCallback(async () => {
    try {
      const [v, r] = await Promise.all([api<Video>(`/v1/videos/${videoId}`), api<AnalysisRun[]>(`/v1/videos/${videoId}/analysis-runs`)]);
      setVideo(v); setRuns(r); setError(null);
    } catch (x) {
      setError(x instanceof ApiProblem ? x.message : "The video could not be loaded.");
    }
  }, [videoId]);
  useEffect(() => { void load(); }, [load]);
  const run = runs?.[0] ?? null;
  useEffect(() => {                                   // follow a live run (and a video that is still being verified)
    if (!active(run) && video?.state !== "VALIDATING") return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [run, video?.state, load]);
  const value: Ctx = {
    video, runs, run, error, canRun: !!organization && RUNNERS.includes(organization.role),
    async start(profile, sampleFps) {
      await api<AnalysisRun>(`/v1/videos/${videoId}/analysis-runs`, { method: "POST", json: { profile, ...(sampleFps ? { sample_fps: sampleFps } : {}) } });
      await load();
    },
    assessment,
    async assess() {
      setAssessment(await api<QualityAssessment>(`/v1/videos/${videoId}/assessments`, { method: "POST" }));
    },
    async cancel() {
      if (run) await api<AnalysisRun>(`/v1/analysis-runs/${run.id}/cancel`, { method: "POST" });
      await load();
    },
  };
  return <ProcessingCtx.Provider value={value}>{children}</ProcessingCtx.Provider>;
}

/* ------------------------------------------------------------------ section 1: headline, the video, start analysis */
export function RunHeadline() {
  const { video, run, error, canRun, start, cancel, assessment, assess } = useProcessing();
  const [profile, setProfile] = useState<AnalysisProfile | null>(null);      // null = follow the recommendation
  const [fps, setFps] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  useEffect(() => {                                     // measure the footage once, as soon as it can be analysed
    if (!asked && video?.state === "INGESTED" && canRun && assessment === null) { setAsked(true); void assess().catch(() => undefined); }
  }, [asked, video?.state, canRun, assessment, assess]);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!video) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading the video…</p>;
  const ready = video.state === "INGESTED";
  const chosen: AnalysisProfile = profile ?? assessment?.recommended_profile ?? "STANDARD";
  const act = (f: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    void f().catch((x) => setMsg(x instanceof ApiProblem ? x.message : "That did not work.")).finally(() => setBusy(false));
  };
  return (
    <div className="space-y-3 text-sm" data-video={video.id}>
      <p><span className="font-semibold">{video.title ?? video.original_filename}</span>{" "}
        <span className="text-muted">· {formatDuration(video.duration_us)} · {formatResolution(video.width, video.height)}</span></p>
      {!ready && <p className="text-muted">This video is not verified yet ({video.state.toLowerCase()}); it can be analysed once it is.</p>}
      {ready && !active(run) && canRun && (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); act(() => start(chosen, fps)); }}>
          <FootageCheck assessment={assessment} />
          <fieldset className="space-y-1.5" aria-label="Analysis profile">
            <legend className="mb-1 text-xs text-muted">Analysis profile{assessment?.recommended_profile ? " (recommended one pre-selected; you can change it)" : ""}</legend>
            {(Object.keys(PROFILES) as AnalysisProfile[]).map((k) => {
              const e = assessment?.estimates.find((x) => x.profile === k);
              return (
                <label key={k} data-profile={k} className={`flex cursor-pointer items-start gap-2 rounded-ctl border px-2.5 py-2 ${chosen === k ? "border-primary bg-primary/5" : "border-line/70"}`}>
                  <input type="radio" name="profile" value={k} checked={chosen === k} onChange={() => setProfile(k)} className="mt-1" aria-label={PROFILES[k].label} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{PROFILES[k].label}</span>
                    {assessment?.recommended_profile === k && <span className="ml-2 rounded bg-ok/15 px-1.5 py-0.5 text-[11px] text-ok">recommended</span>}
                    <span className="block text-xs text-muted">{PROFILES[k].summary} {PROFILES[k].sample_fps} frames/s, {e?.passes_per_frame ?? "?"} detector passes per frame.</span>
                    <span className="block text-xs text-muted" data-estimate={k}>{e?.seconds != null ? `Estimate: about ${formatEstimate(e.seconds)}, peak memory about ${(e.peak_memory_mb! / 1024).toFixed(1)} GB` : "Estimate after the footage check"}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">Frames analysed per second
              <select value={fps ?? ""} onChange={(e) => setFps(e.target.value ? Number(e.target.value) : null)} className="rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm text-ink">
                <option value="">Profile setting ({PROFILES[chosen].sample_fps})</option>
                {[1, 2, 3, 5, 6, 8, 10].map((v) => <option key={v} value={v}>{v} fps</option>)}
              </select>
            </label>
            <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-ctl bg-primary px-3 py-2 font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {run ? "Analyse again" : "Start analysis"}
            </button>
          </div>
          <p className="text-[11px] text-muted">Every profile keeps the same identity rules: a player is named only after a person confirms it. The sensitive profiles look harder and confirm boxes over time; they never accept weak single detections as players.</p>
        </form>
      )}
      {ready && !canRun && !run && <p className="text-muted">Your role can view analyses but not start them.</p>}
      {active(run) && canRun && (
        <button type="button" disabled={busy} onClick={() => act(cancel)} className="inline-flex items-center gap-2 rounded-ctl border border-line px-3 py-2 hover:border-danger/60">
          <Square className="h-4 w-4" /> Cancel analysis
        </button>
      )}
      {run?.status === "SUCCEEDED" && (
        <Link href={`/videos/${video.id}/analyze`} className="inline-flex items-center gap-2 rounded-ctl bg-primary px-3 py-2 font-semibold text-white">Open Analysis Workspace</Link>
      )}
      {msg && <p role="alert" className="text-danger">{msg}</p>}
    </div>
  );
}

const formatEstimate = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

function FootageCheck({ assessment }: { assessment: QualityAssessment | null }) {
  if (!assessment) return <p className="text-xs text-muted">Footage check: not run yet.</p>;
  if (assessment.status === "QUEUED" || assessment.status === "RUNNING")
    return <p role="status" className="flex items-center gap-2 text-xs text-muted" data-assessment="RUNNING"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking the footage (sharpness, compression, motion, player size)…</p>;
  if (assessment.status === "FAILED") return <p className="text-xs text-amber" data-assessment="FAILED">Footage check failed ({assessment.failure_code}); choose a profile yourself.</p>;
  const m = assessment.metrics as { people?: { measured?: boolean; median_height_px?: number; people_per_frame?: number }; sharpness?: number; bits_per_pixel?: number | null } | null;
  return (
    <div className="space-y-1 rounded-ctl border border-line/70 p-2 text-xs" data-assessment="SUCCEEDED">
      <p className="font-semibold">Footage check</p>
      {m?.people?.measured && <p className="text-muted">Players about {Math.round(m.people.median_height_px ?? 0)} px tall on median, {m.people.people_per_frame?.toFixed(1)} on the pitch per sampled frame.</p>}
      {assessment.issues.length === 0 ? <p className="text-ok">No problem found.</p> : (
        <ul className="space-y-0.5" aria-label="Footage issues">
          {assessment.issues.map((i) => <li key={i.code} data-issue={i.code} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber" />{i.text}</li>)}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ section 2: the pipeline steps */
const STEP_NAMES: Record<string, { name: string; note: string }> = {
  SHOTS: { name: "Camera cuts", note: "finds hard cuts; no track continues across one" },
  DETECT: { name: "Detection", note: "people and the ball in every analysed frame" },
  TRACK: { name: "Tracking", note: "temporary track numbers within each shot" },
  IDENTIFY: { name: "Identity evidence", note: "kit colours, look-alike suggestions across cuts (for your review); no identity is assigned" },
};

export function PipelineSteps() {
  const { run } = useProcessing();
  if (!run) return <p className="text-sm text-muted">No analysis has been run on this video yet.</p>;
  const icon = (s: string) => s === "SUCCEEDED" ? <CheckCircle2 className="h-4 w-4 text-ok" /> : s === "RUNNING" ? <Loader2 className="h-4 w-4 animate-spin text-cyan" />
    : s === "FAILED" ? <AlertTriangle className="h-4 w-4 text-danger" /> : s === "CANCELLED" ? <XCircle className="h-4 w-4 text-muted" /> : <CircleDashed className="h-4 w-4 text-muted" />;
  return (
    <ol aria-label="Analysis steps" className="grid grid-cols-2 gap-2 md:grid-cols-6">
      {run.steps.map((s) => (
        <li key={s.name} className="rounded-ctl border border-line/70 bg-raised/40 p-2" data-step={s.name} data-step-status={s.status}>
          <span className="flex items-center gap-1.5 text-sm font-medium">{icon(s.status)} {STEP_NAMES[s.name]?.name ?? s.name}</span>
          <span className="mt-1 block text-xs text-muted">{s.status === "RUNNING" ? `${Math.round(s.progress)} %` : s.status.toLowerCase()}{s.error_code ? ` · ${s.error_code}` : ""}</span>
          <div className="mt-1.5 h-1 rounded bg-line/60"><div className="h-1 rounded bg-primary" style={{ width: `${Math.min(100, s.progress)}%` }} /></div>
          <span className="mt-1 block text-[11px] text-muted/80">{STEP_NAMES[s.name]?.note}</span>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ section 8: what the worker says, and earlier runs */
export function ProcessingLog() {
  const { run, runs } = useProcessing();
  if (!runs?.length) return <p className="text-sm text-muted">Nothing has run yet.</p>;
  return (
    <div className="space-y-2 text-sm">
      {run && active(run) && (
        <p role="status" className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-cyan" />
          {run.job?.stage_message ?? (run.status === "QUEUED" ? "Waiting for the analysis worker…" : "Working…")}</p>
      )}
      {run?.status === "FAILED" && (
        <p role="alert" className="rounded-ctl border border-danger/40 bg-danger/10 p-2 text-danger"><span className="font-semibold">{run.failure_code}</span>: {run.failure_detail}</p>
      )}
      <ul aria-label="Analysis runs" className="space-y-1">
        {runs.map((r) => (
          <li key={r.id} className="flex justify-between gap-2 text-xs" data-run={r.id} data-run-status={r.status}>
            <span>{formatWhen(r.created_at)} · {r.config.profile ? PROFILES[r.config.profile].label : r.config.tiles === 2 ? "distant players" : "fast"} · {r.config.sample_fps} fps</span>
            <span className={r.status === "SUCCEEDED" ? "text-ok" : r.status === "FAILED" ? "text-danger" : "text-muted"}>{r.status.toLowerCase()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ section 11: measured output of the finished run */
export function OutputSummary() {
  const { run } = useProcessing();
  const r = run?.status === "SUCCEEDED" ? (run.result as Record<string, number | string | null> | null) : null;
  const look = (run?.result as { appearance?: { link_suggestions: number; links_across_cuts: number } | null } | null)?.appearance ?? null;
  if (!r) return <p className="text-sm text-muted">The numbers appear when a run has finished; they are what the worker measured.</p>;
  const cards: [string, string][] = [
    ["People tracked", String(r.person_tracks ?? NOT_MEASURED)],
    ["Ball tracks", String(r.ball_tracks ?? NOT_MEASURED)],
    ["Camera shots", String(r.shots ?? NOT_MEASURED)],
    ["Frames analysed", String(r.sampled_frames ?? NOT_MEASURED)],
    ["Processing time", r.seconds ? `${Math.round(Number(r.seconds))} s (${r.frames_per_second ?? "—"} frames/s)` : NOT_MEASURED],
    ["Detector", `${r.model ?? NOT_MEASURED} · ${r.runtime ?? ""}`],
    ["Look-alike suggestions", look ? `${look.link_suggestions} (${look.links_across_cuts} across cuts)` : NOT_MEASURED],
  ];
  const rej = (run?.result as { candidate_tracks_rejected?: { too_few_detections: number; no_confident_detection: number } } | null)?.candidate_tracks_rejected;
  if (r.profile) cards.push(["Profile", `${PROFILES[r.profile as AnalysisProfile]?.label ?? r.profile} · ${r.passes_per_frame ?? "?"} passes/frame`]);
  if (rej) cards.push(["Candidates not confirmed", `${rej.too_few_detections + rej.no_confident_detection} (too brief ${rej.too_few_detections}, never confident ${rej.no_confident_detection})`]);
  return (
    <dl className="grid grid-cols-2 gap-2 md:grid-cols-3" aria-label="Run output">
      {cards.map(([k, v]) => (
        <div key={k} className="rounded-ctl border border-line/70 bg-raised/40 p-2"><dt className="text-xs text-muted">{k}</dt><dd className="text-sm font-semibold" data-metric={k}>{v}</dd></div>
      ))}
      <p className="col-span-full text-xs text-muted">Events (goals, passes, shots) are not detected yet (Block 08).</p>
    </dl>
  );
}
