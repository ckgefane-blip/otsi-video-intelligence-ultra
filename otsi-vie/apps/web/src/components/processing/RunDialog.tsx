"use client";
/**
 * Page 03: start an analysis run (contextual dialog, ADR-035 decision 1). The footage check runs once the video is verified; it
 * recommends a profile and estimates time and memory per profile. The person chooses the profile and the analysed frame rate; the run
 * is created by POST /v1/videos/:id/analysis-runs (through the shared processing hook). Same identity rules for every profile.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { PROFILES, type AnalysisProfile, type QualityAssessment } from "@otsi-vie/contracts";
import { AlertTriangle, Loader2, Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { ProcessingState } from "@/components/analysis/ProcessingView";
import { ApiProblem } from "@/lib/api";

const formatEstimate = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s))} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

export function RunDialog({ p, open, onOpenChange }: { p: ProcessingState; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { video, run, assessment, assess, start, canRun } = p;
  const [profile, setProfile] = useState<AnalysisProfile | null>(null);   // null = follow the recommendation
  const [fps, setFps] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {                                   // measure the footage once, when the dialog is first opened on a verified video
    if (open && !asked && video?.state === "INGESTED" && canRun && assessment === null) { setAsked(true); void assess().catch(() => undefined); }
  }, [open, asked, video?.state, canRun, assessment, assess]);
  const chosen: AnalysisProfile = profile ?? assessment?.recommended_profile ?? "STANDARD";

  const submit = () => {
    setBusy(true); setMsg(null);
    void start(chosen, fps).then(() => onOpenChange(false), (x) => setMsg(x instanceof ApiProblem ? x.message : "The analysis could not be started."))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl"
          data-dialog="run-analysis">
          <Dialog.Title className="text-base font-semibold">{run ? "Analyse again" : "Start analysis"}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{video?.title ?? video?.original_filename ?? "Video"}</Dialog.Description>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
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
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted">Frames analysed per second
                <select value={fps ?? ""} onChange={(e) => setFps(e.target.value ? Number(e.target.value) : null)} className="rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm text-ink">
                  <option value="">Profile setting ({PROFILES[chosen].sample_fps})</option>
                  {[1, 2, 3, 5, 6, 8, 10].map((v) => <option key={v} value={v}>{v} fps</option>)}
                </select>
              </label>
              <div className="flex gap-2">
                <Dialog.Close className="rounded-ctl border border-line px-3 py-2 hover:border-primary/60">Close</Dialog.Close>
                <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-ctl bg-primary px-3 py-2 font-semibold text-white disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {run ? "Analyse again" : "Start analysis"}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted">Every profile keeps the same identity rules: a player is named only after a person confirms it. The sensitive profiles look harder and confirm boxes over time; they never accept weak single detections as players.</p>
            {msg && <p role="alert" className="text-danger">{msg}</p>}
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FootageCheck({ assessment }: { assessment: QualityAssessment | null }) {
  if (!assessment) return <p className="text-xs text-muted">Footage check: not run yet.</p>;
  if (assessment.status === "QUEUED" || assessment.status === "RUNNING")
    return <p role="status" className="flex items-center gap-2 text-xs text-muted" data-assessment="RUNNING"><Loader2 className="h-3.5 w-3.5 animate-spin" />Checking the footage (sharpness, compression, motion, player size)…</p>;
  if (assessment.status === "FAILED") return <p className="text-xs text-amber" data-assessment="FAILED">Footage check failed ({assessment.failure_code}); choose a profile yourself.</p>;
  const m = assessment.metrics as { people?: { measured?: boolean; median_height_px?: number; people_per_frame?: number } } | null;
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
