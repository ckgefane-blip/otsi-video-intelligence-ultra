"use client";
/**
 * v3 Phase A.10 (ADR-076): the analysis profile card, on the AI Tools tab of Upload's left panel, on the Desktop UI flow layout.
 *   - The profile of the automatic analysis for the next upload or link import (kept in this browser with the other switches, sent with
 *     each upload): Recommended (the server checks the footage first and uses what the check recommends; with Stabilize Video on, never
 *     below High accuracy), or Standard, High accuracy, Ultra-sensitive grassroots.
 *   - For the selected video: the profile the server used and why, and its footage check (GET /v1/videos/:id/assessments/latest): the
 *     recommendation, the reason (the measured issues) and the estimate (time and memory, from the detector cost measured on this footage).
 *     A writer can run the check on a verified video that has none (POST /v1/videos/:id/assessments).
 * Only what was recorded or measured; an estimate is labelled as one, and none is shown when the cost could not be measured.
 */
import { PROFILES, type AnalysisProfile, type QualityAssessment, type UploadProfile, type VideoRights } from "@otsi-vie/contracts";
import { useCallback, useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";

/** The dictionary subsection these words come from (ADR-139 Group A). */
export type UploadDict = Dictionary["body"]["upload"];
import { usePage02 } from "./page02";
import { DeclareRightsDialog } from "./RightsDialog";
import { useUpload } from "./UploadWorkspace";

export const PROFILE_CHOICES: [UploadProfile, string, string][] = [
  ["RECOMMENDED", "Recommended", "The server checks the footage first and uses the profile it recommends."],
  ["STANDARD", PROFILES.STANDARD.label, PROFILES.STANDARD.summary],
  ["HIGH_ACCURACY", PROFILES.HIGH_ACCURACY.label, PROFILES.HIGH_ACCURACY.summary],
  ["ULTRA_SENSITIVE", PROFILES.ULTRA_SENSITIVE.label, "Tiny, distant players: looks hardest; slowest. Not yet calibrated: more boxes to review."],
];
/** the profile's name for a dictionary (ADR-139 Group A); without one it stays English. */
export const profileLabel = (p: UploadProfile | null | undefined, d?: UploadDict) =>
  p === "RECOMMENDED" ? (d?.recommended ?? "Recommended")
    : p ? PROFILE_CHOICES.find(([k]) => k === p)?.[1] ?? "Follows Stabilize Video"
    : (d?.followsStabilize ?? "Follows Stabilize Video");

/** "about 14 min", "about 1 h 20 min", "under a minute" — for a dictionary, in its words. */
export function duration(seconds: number, d?: UploadDict): string {
  if (seconds < 60) return d?.underMinute ?? "under a minute";
  const m = Math.round(seconds / 60);
  if (m < 60) return (d?.aboutMin ?? "about {n} min").replace("{n}", String(m));
  const h = Math.floor(m / 60), mm = m % 60;
  const tpl = d?.aboutHourMin ?? "about {h} h {m} min";
  return mm ? tpl.replace("{h}", String(h)).replace("{m}", String(mm)) : tpl.split("{m}")[0]!.replace("{h}", String(h)).trimEnd();
}
/** the estimate line for one profile of a finished check (null: no estimate could be made) */
export function estimateText(a: QualityAssessment, p: AnalysisProfile, d?: UploadDict): string | null {
  const e = a.estimates.find((x) => x.profile === p);
  if (!e || e.seconds === null) return null;
  const mem = e.peak_memory_mb ? ` · ${(d?.estimateMemory ?? "up to {gb} GB memory").replace("{gb}", (e.peak_memory_mb / 1024).toFixed(1))}` : "";
  return `${duration(e.seconds, d)} ${d?.estimateSuffix ?? "on this computer"}${mem} ${d?.estimateTag ?? "(estimate)"}`;
}

/** `y` is the old stage position, kept so existing callers still compile; the flow layout ignores it. */
export function ProfileCard({ y: _y }: { y?: number } = {}) {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { prefs, setPrefs, say } = usePage02();
  const { selected, canWrite } = useUpload();
  const choose = (p: UploadProfile) => {
    // a chosen profile decides Stabilize (High accuracy and Ultra-sensitive stabilise; Standard does not); Recommended keeps it as set
    setPrefs({ ...prefs, profile: p, stabilize: p === "RECOMMENDED" ? prefs.stabilize : p !== "STANDARD" });
    say(d.analysisProfileNextSay.replace("{label}", profileLabel(p, d)));
  };
  /** the choices in this language: the contract labels and summaries stay, only the Recommended words are translated. */
  const choices: [UploadProfile, string, string][] = [
    ["RECOMMENDED", d.recommended, d.recommendedWhy],
    ["STANDARD", PROFILES.STANDARD.label, PROFILES.STANDARD.summary],
    ["HIGH_ACCURACY", PROFILES.HIGH_ACCURACY.label, PROFILES.HIGH_ACCURACY.summary],
    ["ULTRA_SENSITIVE", PROFILES.ULTRA_SENSITIVE.label, d.ultraWhy],
  ];
  return (
    <div data-profile-card>
      <h3 className="t-panel">{d.analysisProfile}</h3>
      <p className="t-small mt-0.5">{d.nextUploadDesc}</p>
      <div role="radiogroup" aria-label={d.analysisProfileNext} className="mt-2 space-y-1.5">
        {choices.map(([k, label, why]) => {
          const on = prefs.profile === k;
          return (
            <button key={k} type="button" role="radio" aria-checked={on} onClick={() => choose(k)} data-profile={k} title={why}
              className={`flex w-full items-start gap-2.5 rounded-ctl border px-2.5 py-2 text-left ${on ? "border-primary bg-primary/5" : "border-line/70"}`}>
              <span aria-hidden className={`mt-1 h-4 w-4 flex-none rounded-full border-2 ${on ? "border-primary bg-primary" : "border-muted"}`} />
              <span className="min-w-0">
                <span className={`block text-sm ${on ? "font-semibold" : ""}`}>{label}</span>
                <span className="block text-xs text-muted">{why}</span>
              </span>
            </button>
          );
        })}
      </div>
      {prefs.profile === "RECOMMENDED" && prefs.stabilize && <p className="t-small mt-1.5">{d.stabilizeOnNote}</p>}
      {!prefs.sendToAnalysis && <p className="t-small mt-1.5 text-amber">{d.sendOffNote}</p>}
      <div className="my-3 border-t border-line/60" />
      <ThisVideo key={selected?.id ?? "none"} canWrite={canWrite} />
    </div>
  );
}

/** the rights' use words, in this language (the summary words from the rights dialog). */
const useWords = (d: UploadDict): [string, string][] => [["ANALYZE", d.sumAnalyse], ["SHARE", d.sumShare], ["DOWNLOAD", d.sumDownload]];

/** A.11 (ADR-077): the selected video's recorded rights, and whether they allow analysis; a video without any can have them recorded */
function RightsLine({ videoId, name, canWrite }: { videoId: string; name: string; canWrite: boolean }) {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const [r, setR] = useState<VideoRights | null | undefined>(undefined);       // undefined: reading; null: could not be read
  const [open, setOpen] = useState(false);
  const { say } = usePage02();
  useEffect(() => {
    let live = true;
    api<VideoRights>(`/v1/videos/${videoId}/rights`).then((x) => { if (live) setR(x); }, () => { if (live) setR(null); });
    return () => { live = false; };
  }, [videoId]);
  if (r === undefined || r === null || !("grant" in r)) return null;
  const g = r.grant;
  const uses = g ? useWords(d).filter(([k]) => (g.allowed_uses as string[]).includes(k)).map(([, w]) => w) : [];
  return (
    <div className="t-small mt-1" data-rights-line={g ? (r.analysis_blocked ? "blocked" : "ok") : "none"}>
      {g ? <>{d.rightsLabel} <span className="text-ink">{uses.length ? uses.join(", ") : d.viewOnly}</span>
          {r.analysis_blocked ? <span className="text-amber">. {r.analysis_blocked}</span> : null}</>
        : <><span className="text-amber">{d.noRights}</span>{" "}
          {canWrite ? <button type="button" onClick={() => setOpen(true)} data-action="record-rights" className="text-primary">{d.recordRights}</button> : d.cannotRecordRights}</>}
      {canWrite && !g && <DeclareRightsDialog videoId={videoId} name={name} open={open} onOpenChange={setOpen}
        onDone={(x) => { setR(x); say(x.analysis_blocked ? d.rightsRecordedBlocked.replace("{blocked}", x.analysis_blocked) : d.rightsRecorded); }} />}
    </div>
  );
}

/** the selected video: the profile its automatic analysis used and why, and its footage check */
function ThisVideo({ canWrite }: { canWrite: boolean }) {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { selected } = useUpload();
  const { say } = usePage02();
  const [a, setA] = useState<QualityAssessment | null | undefined>(undefined);       // undefined: reading; null: never checked
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = selected?.id ?? null;
  const load = useCallback(async () => {
    if (!id) return;
    try { setA(await api<QualityAssessment>(`/v1/videos/${id}/assessments/latest`)); setFailed(false); }
    catch (x) { if (x instanceof ApiProblem && x.status === 404) setA(null); else setFailed(true); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const opt = selected?.ingest_options;
  const waiting = !!opt?.send_to_analysis && opt.analysis_profile === "RECOMMENDED" && !opt.analysis;
  const moving = a?.status === "QUEUED" || a?.status === "RUNNING" || (waiting && selected?.state === "INGESTED" && (a === null || a === undefined));
  useEffect(() => {
    if (!moving) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [moving, load]);

  if (!selected) return <p className="t-small">{d.chooseVideoCheck}</p>;
  const name = selected.title ?? selected.original_filename ?? d.thisVideoTitle;
  const check = async () => {
    setBusy(true);
    try { setA(await api<QualityAssessment>(`/v1/videos/${selected.id}/assessments`, { method: "POST" })); say(d.footageCheckStarted); }
    catch (x) { say(x instanceof ApiProblem ? x.message : d.couldNotStartCheck, true); }
    finally { setBusy(false); }
  };
  const used = opt?.analysis?.profile ?? null;
  const shown: AnalysisProfile | null = used ?? (a?.status === "SUCCEEDED" ? a.recommended_profile : null);
  return (
    <div data-this-video aria-live="polite">
      <p className="truncate text-sm font-semibold" title={name}>{name}</p>
      {opt && (
        <p className="t-small mt-1" data-auto-profile={used ?? ""}>
          {opt.analysis?.outcome === "STARTED" ? <>{d.analysedWith} <b className="text-ink">{profileLabel(used, d)}</b>{opt.analysis.detail ? `. ${opt.analysis.detail}` : ""}</>
            : opt.analysis?.outcome === "SKIPPED" ? d.notAnalysedAuto.replace("{detail}", opt.analysis.detail ?? d.skippedWord)
            : !opt.send_to_analysis ? d.profileAskedOff.replace("{profile}", profileLabel(opt.analysis_profile, d))
            : waiting ? d.profileAskedWaiting
            : d.profileAskedStarts.replace("{profile}", profileLabel(opt.analysis_profile, d))}
        </p>
      )}
      <RightsLine videoId={selected.id} name={name} canWrite={canWrite} />
      <div className="mt-2" data-footage-check={a === undefined ? "reading" : a === null ? "none" : a.status}>
        {failed && <p className="t-small text-danger">{d.checkCouldNotBeRead}</p>}
        {!failed && a === undefined && <p className="t-small">{d.readingCheck}</p>}
        {!failed && a === null && (selected.state !== "INGESTED" ? <p className="t-small">{d.checkOnceVerified}</p> : waiting ? <p className="t-small">{d.checkQueued}</p> : (
          <p className="t-small">{d.footageNotChecked}{" "}
            {canWrite ? <button type="button" disabled={busy} onClick={() => void check()} data-action="check-footage" className="text-primary disabled:opacity-50">{busy ? d.starting : d.checkFootage}</button>
              : d.cannotStartIt}
            {" "}{d.checkMeasures}</p>
        ))}
        {a && (a.status === "QUEUED" || a.status === "RUNNING") && <p className="t-small">{d.checkingFootage}</p>}
        {a?.status === "FAILED" && <p className="t-small text-amber">{d.checkFailed}{a.failure_code ? ` (${a.failure_code})` : ""}.</p>}
        {a?.status === "SUCCEEDED" && (
          <>
            <p className="t-small text-ink2">{d.checkRecommends} <b>{profileLabel(a.recommended_profile, d)}</b>
              {a.issues.length === 0 ? d.recommendSuffixNone : d.recommendSuffixSome}</p>
            {a.issues.length > 0 && (
              <ul className="t-small mt-0.5 list-disc pl-4" aria-label={d.whyLabel}>
                {a.issues.slice(0, 3).map((i) => <li key={i.code} data-issue={i.code}>{i.text}</li>)}
                {a.issues.length > 3 && <li>{d.andMoreIssues.replace("{n}", String(a.issues.length - 3))}</li>}
              </ul>
            )}
            {shown && <p className="t-small mt-1.5" data-estimate>{profileLabel(shown, d)}: {estimateText(a, shown, d) ?? d.noEstimate}</p>}
          </>
        )}
      </div>
    </div>
  );
}
