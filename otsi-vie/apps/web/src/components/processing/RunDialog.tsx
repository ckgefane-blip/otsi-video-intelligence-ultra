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
import { useLocale } from "@/lib/i18n";

/** format a duration estimate for a dictionary (ADR-139 Group A); without one it stays English. */
const formatEstimate = (s: number, d?: { estimateSeconds: string; estimateMinutes: string; estimateHours: string }) =>
  s < 90 ? (d?.estimateSeconds ?? "{n} s").replace("{n}", String(Math.max(1, Math.round(s))))
    : s < 5400 ? (d?.estimateMinutes ?? "{n} min").replace("{n}", String(Math.round(s / 60)))
    : (d?.estimateHours ?? "{n} h").replace("{n}", (s / 3600).toFixed(1));

export function RunDialog({ p, open, onOpenChange }: { p: ProcessingState; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t: dict } = useLocale();
  const d = dict.body.processing;
  const u = dict.body.upload;
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
    void start(chosen, fps).then(() => onOpenChange(false), (x) => setMsg(x instanceof ApiProblem ? x.message : d.couldNotStartAnalysis))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl"
          data-dialog="run-analysis">
          <Dialog.Title className="text-base font-normal">{run ? d.analyseAgainPlain : d.startAnalysisPlain}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{video?.title ?? video?.original_filename ?? d.videoFallback}</Dialog.Description>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <FootageCheck assessment={assessment} />
            <fieldset className="space-y-1.5" aria-label={u.analysisProfile}>
              <legend className="mb-1 text-xs text-muted">{u.analysisProfile}{assessment?.recommended_profile ? ` ${d.recommendedPreselected}` : ""}</legend>
              {(Object.keys(PROFILES) as AnalysisProfile[]).map((k) => {
                const e = assessment?.estimates.find((x) => x.profile === k);
                return (
                  <label key={k} data-profile={k} className={`flex cursor-pointer items-start gap-2 rounded-ctl border px-2.5 py-2 ${chosen === k ? "border-primary bg-primary/5" : "border-line/70"}`}>
                    <input type="radio" name="profile" value={k} checked={chosen === k} onChange={() => setProfile(k)} className="mt-1" aria-label={PROFILES[k].label} />
                    <span className="min-w-0 flex-1">
                      <span className="font-normal">{PROFILES[k].label}</span>
                      {assessment?.recommended_profile === k && <span className="ml-2 rounded bg-ok/15 px-1.5 py-0.5 text-[11px] text-ok">{d.recommendedBadge}</span>}
                      <span className="block text-xs text-muted">{PROFILES[k].summary} {d.fpsPasses.replace("{fps}", String(PROFILES[k].sample_fps)).replace("{passes}", String(e?.passes_per_frame ?? "?"))}</span>
                      <span className="block text-xs text-muted" data-estimate={k}>{e?.seconds != null ? d.estimateAbout.replace("{est}", formatEstimate(e.seconds, d)).replace("{gb}", (e.peak_memory_mb! / 1024).toFixed(1)) : d.estimateAfterCheck}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted">{d.framesAnalysed}
                <select value={fps ?? ""} onChange={(e) => setFps(e.target.value ? Number(e.target.value) : null)} className="rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm text-ink">
                  <option value="">{d.profileSetting.replace("{fps}", String(PROFILES[chosen].sample_fps))}</option>
                  {[1, 2, 3, 5, 6, 8, 10].map((v) => <option key={v} value={v}>{d.fpsOption.replace("{n}", String(v))}</option>)}
                </select>
              </label>
              <div className="flex gap-2">
                <Dialog.Close className="rounded-ctl border border-line px-3 py-2 hover:border-primary/60">{dict.common.close}</Dialog.Close>
                <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-ctl bg-primary px-3 py-2 font-normal text-white disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {run ? d.analyseAgainPlain : d.startAnalysisPlain}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted">{d.identityRulesNote}</p>
            {msg && <p role="alert" className="text-danger">{msg}</p>}
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FootageCheck({ assessment }: { assessment: QualityAssessment | null }) {
  const { t: dict } = useLocale();
  const d = dict.body.processing;
  const u = dict.body.upload;
  if (!assessment) return <p className="text-xs text-muted">{d.footageCheckNotRun}</p>;
  if (assessment.status === "QUEUED" || assessment.status === "RUNNING")
    return <p role="status" className="flex items-center gap-2 text-xs text-muted" data-assessment="RUNNING"><Loader2 className="h-3.5 w-3.5 animate-spin" />{u.checkingFootage}</p>;
  if (assessment.status === "FAILED") return <p className="text-xs text-amber" data-assessment="FAILED">{d.footageCheckFailed.replace("{code}", assessment.failure_code ?? "")}</p>;
  const m = assessment.metrics as { people?: { measured?: boolean; median_height_px?: number; people_per_frame?: number } } | null;
  return (
    <div className="space-y-1 rounded-ctl border border-line/70 p-2 text-xs" data-assessment="SUCCEEDED">
      <p className="font-normal">{d.footageCheck}</p>
      {m?.people?.measured && <p className="text-muted">{d.playersAbout.replace("{px}", String(Math.round(m.people.median_height_px ?? 0))).replace("{n}", (m.people.people_per_frame ?? 0).toFixed(1))}</p>}
      {assessment.issues.length === 0 ? <p className="text-ok">{d.noProblemFound}</p> : (
        <ul className="space-y-0.5" aria-label={d.footageCheck}>
          {assessment.issues.map((i) => <li key={i.code} data-issue={i.code} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber" />{i.text}</li>)}
        </ul>
      )}
    </div>
  );
}
