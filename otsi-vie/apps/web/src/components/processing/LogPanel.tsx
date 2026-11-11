"use client";
/**
 * Page 03 Sections 06 and 07 — Processing Log and System Resources (approved reference 03_AI_PROCESSING).
 *
 * The log is the run history as recorded: when each run was queued, started and finished, each engine step's state, the worker's own
 * stage message while it works and the failure it reported. "Live" only while a run is active; Auto-scroll keeps the newest line in
 * view. v3 Phase A.4 (ADR-061): the log also lists this video's other engine jobs (ball, pitch, team sheets, checks, renders); it can be
 * filtered to one step (or by a click on the ribbon), to errors only, and to the newest run (older runs folded); Copy puts the shown
 * lines on the clipboard. System Resources shows the workers' machine as the worker measured it (CPU, memory, GPU name); "Not connected" when no worker
 * reported in the last 20 s; GPU load is not measurable for free on Windows and is never invented.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { PROFILES, type AnalysisRun, type Job, type SystemResources } from "@otsi-vie/contracts";
import { useEffect, useRef, useState } from "react";
import { B, T, u } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { DATE_TAG, isActive, type ProcessingDict } from "./model";

/** fill a dictionary template: "{name}" and the other {placeholders} in it. */
const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s);

/** the log's step names for a dictionary (ADR-139 Group A); without one they stay English. */
const stepName = (name: string, d?: ProcessingDict): string =>
  ({ SHOTS: d?.shotCutsLine ?? "Camera cuts", DETECT: d?.detection ?? "Detection", TRACK: d?.tracking ?? "Tracking",
    IDENTIFY: d?.logStepIdentity ?? "Appearance and identity suggestions" } as Record<string, string>)[name] ?? name;
/** the log's step filter: the ribbon's keys, plus the run itself and the other jobs; FACTS are found from the ball, so they show its lines */
export const LOG_STEPS: string[] = ["SHOTS", "DETECT", "TRACK", "IDENTIFY",
  "TRACK_BALL", "CALIBRATE_PITCH", "READ_LINEUPS", "FACTS", "RUN", "OTHER"];
const ts = (iso: string | null) => (iso ? Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`) : 0);
const time = (iso: string | null, tag = "en-GB") => (iso ? new Date(iso).toLocaleTimeString(tag, { hour12: false }) : "--:--:--");
const day = (iso: string, tag = "en-GB") => new Date(iso).toLocaleDateString(tag, { day: "numeric", month: "short" });

export interface Line { at: string; text: string; tone?: "ok" | "bad" | "live"; step: string; ts: number }

/**
 * The log lines for a dictionary (ADR-139 Group A): `d` translates the fixed
 * words (the step names, "queued", "completed", "failed", ...), `tag` formats
 * the dates. Without them the lines stay English, as the unit tests expect.
 * The worker's own stage message, a job's stage and its error, and a run's
 * failure detail are server text and stay as recorded.
 */
export function lines(runs: AnalysisRun[], jobs: Job[] = [], d?: ProcessingDict, tag = "en-GB"): Line[] {
  const out: Line[] = [];
  const L = {
    queued: d?.logRunQueued ?? "Run queued ({day}) · {profile} · {fps} fps",
    started: d?.logWorkerStarted ?? "Worker started the run",
    completed: d?.logStepCompleted ?? "{name}: completed",
    progress: d?.logStepProgress ?? "{name}: {n}%",
    failed: d?.logStepFailed ?? "{name}: failed",
    failedCode: d?.logStepFailedCode ?? "{name}: failed ({code})",
    runDone: d?.logRunCompleted ?? "Run completed",
    runFailed: d?.logRunFailed ?? "Run failed",
    runCancelled: d?.logRunCancelled ?? "Run cancelled",
    jobQueued: d?.logJobQueued ?? "{name}: queued",
    jobPaused: d?.logJobPaused ?? "{name}: paused",
    jobFailedDetail: d?.logJobFailedDetail ?? "{name}: failed — {detail}",
    jobCancelled: d?.logJobCancelled ?? "{name}: cancelled",
  };
  for (const r of [...runs].reverse()) {                                   // oldest first, newest at the bottom
    const profile = r.config.profile ? PROFILES[r.config.profile].label : "custom";
    const t0 = ts(r.started_at ?? r.created_at);
    out.push({ at: time(r.created_at, tag), text: fill(L.queued, { day: day(r.created_at, tag), profile, fps: r.config.sample_fps }), step: "RUN", ts: ts(r.created_at) });
    if (r.started_at) out.push({ at: time(r.started_at, tag), text: L.started, step: "RUN", ts: t0 });
    r.steps.forEach((s, k) => {
      const at = { at: "", step: s.name, ts: t0 + k + 1 };
      const name = stepName(s.name, d);
      if (s.status === "SUCCEEDED") out.push({ ...at, text: fill(L.completed, { name }), tone: "ok" });
      else if (s.status === "RUNNING") out.push({ ...at, text: fill(L.progress, { name, n: Math.round(s.progress) }), tone: "live" });
      else if (s.status === "FAILED") out.push({ ...at, text: s.error_code ? fill(L.failedCode, { name, code: s.error_code }) : fill(L.failed, { name }), tone: "bad" });
    });
    if (isActive(r) && r.job?.stage_message) out.push({ at: "", text: r.job.stage_message, tone: "live", step: r.steps.find((s) => s.status === "RUNNING")?.name ?? "RUN", ts: t0 + 50 });
    const t1 = ts(r.finished_at) || t0 + 60;
    if (r.status === "SUCCEEDED") out.push({ at: time(r.finished_at, tag), text: L.runDone, tone: "ok", step: "RUN", ts: t1 });
    if (r.status === "FAILED") out.push({ at: time(r.finished_at, tag), text: L.runFailed + (r.failure_code ? `: ${r.failure_code}` : "") + (r.failure_detail ? ` — ${r.failure_detail}` : ""), tone: "bad", step: "RUN", ts: t1 });
    if (r.status === "CANCELLED") out.push({ at: time(r.finished_at, tag), text: L.runCancelled, step: "RUN", ts: t1 });
  }
  // the video's other engine jobs (the analysis itself is the run above; renders make reels, not this video's processing: they are in
  // the Jobs table, and dozens of them would bury the engine's lines)
  for (const j of jobs) {
    if (j.kind === "ANALYZE" || j.kind === "RENDER") continue;
    const step = ["TRACK_BALL", "CALIBRATE_PITCH", "READ_LINEUPS"].includes(j.kind) ? j.kind : "OTHER";
    const name = j.kind_label;
    out.push({ at: time(j.created_at, tag), text: fill(L.jobQueued, { name }), step, ts: ts(j.created_at) });
    if (j.state === "RUNNING") out.push({ at: time(j.started_at, tag), text: fill(L.progress, { name, n: Math.round(j.progress) }) + (j.stage ? ` · ${j.stage}` : ""), tone: "live", step, ts: ts(j.started_at) || ts(j.created_at) + 1 });
    if (j.state === "PAUSED") out.push({ at: "", text: fill(L.jobPaused, { name }), step, ts: ts(j.created_at) + 1 });
    const t1 = ts(j.finished_at) || ts(j.created_at) + 2;
    if (j.state === "SUCCEEDED") out.push({ at: time(j.finished_at, tag), text: fill(L.completed, { name }), tone: "ok", step, ts: t1 });
    if (j.state === "FAILED") out.push({ at: time(j.finished_at, tag), text: j.error ? fill(L.jobFailedDetail, { name, detail: j.error }) : fill(L.failed, { name }), tone: "bad", step, ts: t1 });
    if (j.state === "CANCELLED") out.push({ at: time(j.finished_at, tag), text: fill(L.jobCancelled, { name }), step, ts: t1 });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

/** the shown lines: one step (FACTS shows the ball's), errors only, and from the newest run on unless every run is asked for */
export function visibleLines(all: Line[], runs: AnalysisRun[], step: string | null, errorsOnly: boolean, allRuns: boolean): Line[] {
  const from = !allRuns && runs.length ? ts(runs[0]!.created_at) : 0;          // runs are newest first
  const want = step === "FACTS" ? "TRACK_BALL" : step;
  return all.filter((l) => l.ts >= from && (!want || l.step === want) && (!errorsOnly || l.tone === "bad"));
}

const COLOR = { ok: "#3ee6a8", bad: "#ff8a8a", live: "#4db3ff" } as const;

export function LogPanel({ runs, jobs, step, onStep }: { runs: AnalysisRun[] | null; jobs: Job[] | null; step: string | null; onStep: (s: string | null) => void }) {
  const { t: dict, locale } = useLocale();
  const d = dict.body.processing;
  const tag = DATE_TAG[locale];
  const [auto, setAuto] = useState(true);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [allRuns, setAllRuns] = useState(false);
  const [copied, setCopied] = useState(false);
  const list = useRef<HTMLOListElement | null>(null);
  const live = !!runs?.some(isActive) || !!jobs?.some((j) => j.state === "RUNNING");
  const every = runs ? lines(runs, jobs ?? [], d, tag) : [];
  /** the step filter's label for a key: the ribbon's words, plus the run and the other jobs. */
  const stepLabel = (k: string) => ({ SHOTS: d.shotCuts, DETECT: d.detection, TRACK: d.tracking, IDENTIFY: d.identity,
    TRACK_BALL: d.ball, CALIBRATE_PITCH: d.pitch, READ_LINEUPS: d.teamSheets, FACTS: d.facts,
    RUN: d.logStepAnalysisRun, OTHER: d.logStepOtherJobs } as Record<string, string>)[k] ?? k;
  const items = runs ? visibleLines(every, runs, step, errorsOnly, allRuns) : [];
  const hiddenOld = runs ? visibleLines(every, runs, step, errorsOnly, true).length - items.length : 0;
  const chip = (on: boolean) => ({ height: u(28), padding: `0 ${u(10)}`, border: `${u(1.5)} solid ${on ? "#1580ff" : "#1e3f66"}`, borderRadius: u(14),
    background: on ? "#1580ff" : "#0a1f3a", color: on ? "#fff" : "#cfe3ff", fontSize: u(15), cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" as const });
  useEffect(() => { if (auto && list.current) list.current.scrollTop = list.current.scrollHeight; }, [auto, items.length, runs]);

  return (
    <>
      <section aria-label={d.processingLog} data-section="p03-s08" data-live={live ? "yes" : "no"}>
        <B x={2006} y={293} w={524} h={628} style={{ border: `${u(1.5)} solid #12335f`, borderRadius: u(10), background: "linear-gradient(180deg,#081a35,#06122a)" }} />
        <T x={2027} y={331} size={25} weight={700} as="h2">{d.processingLog}</T>
        <B x={2214} y={326} w={10} h={10} style={{ borderRadius: "50%", background: live ? "#3ee6a8" : "#8ea3bf", boxShadow: live ? `0 0 ${u(8)} #3ee6a8` : undefined }} />
        <T x={2232} y={331} size={19} color={live ? "#3ee6a8" : "#8ea3bf"}>{live ? d.live : d.runIdle}</T>
        <T x={2345} y={331} size={19} color="#cfdcf0" as="span">{d.autoScroll}</T>
        <button type="button" role="switch" aria-checked={auto} aria-label={d.autoScroll} onClick={() => setAuto((a) => !a)} className="absolute"
          style={{ left: u(2454), top: u(315 - 101), width: u(55), height: u(30), borderRadius: u(15), background: auto ? "#1580ff" : "#1a2a44", border: 0, padding: 0, cursor: "pointer" }}>
          <i style={{ position: "absolute", top: u(4), left: auto ? undefined : u(4), right: auto ? u(4) : undefined, width: u(22), height: u(22), borderRadius: "50%", background: "#fff" }} />
        </button>
        <div className="absolute" style={{ left: u(2020), top: u(358 - 101), width: u(496), display: "flex", gap: u(6), alignItems: "center" }} data-log-filters>
          <select aria-label={d.stepHeader} value={step ?? ""} onChange={(e) => onStep(e.target.value || null)} data-log-step
            style={{ ...chip(!!step), width: u(150), padding: `0 ${u(6)}` }}>
            <option value="">{d.everyStep}</option>
            {LOG_STEPS.map((k) => <option key={k} value={k}>{stepLabel(k)}</option>)}
          </select>
          <button type="button" aria-pressed={errorsOnly} onClick={() => setErrorsOnly((x) => !x)} style={chip(errorsOnly)} data-log-errors>{d.errors}</button>
          <button type="button" aria-pressed={allRuns} onClick={() => setAllRuns((x) => !x)} style={chip(allRuns)} data-log-all-runs
            title={allRuns ? d.showingEveryRun : d.olderFolded}>{allRuns ? d.allRuns : hiddenOld ? fill(d.newestRunMore, { n: hiddenOld }) : d.newestRun}</button>
          <button type="button" disabled={!items.length} style={chip(copied)} data-log-copy onClick={() => {
            const text = items.map((l) => `${l.at || "        "}  ${l.text}`).join("\n");
            void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }, () => undefined);
          }}>{copied ? d.copied : d.copy}</button>
        </div>
        {items.length === 0 ? (
          <T x={2030} y={408} size={19.5} color="#cfdcf0">{every.length ? d.noLineMatch : d.noActivity}</T>
        ) : (
          <ol ref={list} aria-label={d.processingLog} className="absolute" style={{ left: u(2020), top: u(390 - 101), width: u(496), height: u(516), margin: 0, padding: 0,
            listStyle: "none", overflowY: "auto", fontSize: u(17), lineHeight: 1.45, color: "#cfdcf0" }}>
            {items.map((l, i) => (
              <li key={i} style={{ display: "flex", gap: u(10), padding: `${u(2)} ${u(10)}`, color: l.tone ? COLOR[l.tone] : undefined }}>
                <span style={{ color: "#6b7a92", fontVariantNumeric: "tabular-nums", minWidth: u(70) }}>{l.at}</span><span>{l.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <Resources />
    </>
  );
}

const gb = (b: number) => `${(b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1)} GB`;

/** Section 09: the workers' machine as last measured (GET /v1/system/resources, every 5 s); GPU load is never estimated */
function Resources() {
  const { t: dict, locale } = useLocale();
  const d = dict.body.processing;
  const tag = DATE_TAG[locale];
  const [r, setR] = useState<SystemResources | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => void api<SystemResources>("/v1/system/resources").then((x) => { if (live) setR(x); }, () => { if (live) setR(null); });
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);
  const on = !!r?.connected;
  const memP = on && r!.memory_used_bytes !== null && r!.memory_total_bytes ? (r!.memory_used_bytes / r!.memory_total_bytes) * 100 : null;
  const rings: [number, string, string, number | null, string, string][] = [
    [2100, "#1a8cff", "GPU", on ? r!.gpu_percent : null, on && r!.gpu_percent !== null ? `${Math.round(r!.gpu_percent)}%` : "—",
      on ? (r!.gpu_name ? r!.gpu_name.replace(/\(R\)|\(TM\)/g, "").replace(/\s+/g, " ").trim() : d.notReported) : d.notConnected],
    [2268, "#1a8cff", "CPU", on ? r!.cpu_percent : null, on && r!.cpu_percent !== null ? `${Math.round(r!.cpu_percent)}%` : "—",
      on ? (r!.cpu_count ? fill(d.threads, { n: r!.cpu_count }) : d.measured) : d.notConnected],
    [2438, "#19e6c0", d.resourceMemory, memP, memP !== null ? `${Math.round(memP)}%` : "—",
      on && r!.memory_used_bytes !== null && r!.memory_total_bytes ? fill(d.memoryOf, { used: gb(r!.memory_used_bytes), total: gb(r!.memory_total_bytes) }) : d.notConnected],
  ];
  return (
    <section aria-label={d.systemResources} data-section="p03-s09" data-connected={on ? "yes" : "no"}>
      <B x={2006} y={943} w={524} h={314} style={{ border: `${u(1.5)} solid #12335f`, borderRadius: u(10), background: "linear-gradient(180deg,#081a35,#06122a)" }} />
      <T x={2027} y={979} size={25} weight={700} as="h2">{d.systemResources}</T>
      <button type="button" disabled={!on} onClick={() => setOpen(true)} title={on ? d.detailsOfMeasurement : d.noWorkerReporting} className="absolute"
        style={{ left: u(2383), top: u(980 - 101 - 10.5), padding: 0, border: 0, background: "transparent", fontSize: u(19), lineHeight: 1.1, color: "#2d9bff", fontWeight: 600,
          whiteSpace: "nowrap", cursor: on ? "pointer" : "not-allowed", fontFamily: "inherit" }}>{d.viewDetails}</button>
      {rings.map(([cx, c, label, p, big, foot]) => (
        <div key={label} role="group" aria-label={`${label}: ${big === "—" ? (on ? d.notMeasuredLower : d.notConnected) : big}, ${foot}`}>
          <B x={cx - 62} y={1015} w={124} h={124} style={{ borderRadius: "50%", background: `conic-gradient(${c} ${p ?? 0}%,#14233c 0)` }} />
          <B x={cx - 52} y={1025} w={104} h={104} style={{ borderRadius: "50%", background: "#071a33" }} />
          <T x={cx} y={1071} size={26} weight={700} align="center">{big}</T>
          <T x={cx} y={1103} size={19} color="#8ea3bf" align="center">{label}</T>
          <T x={cx} y={1163} size={foot.length > 16 ? 15 : 19} color="#cfdcf0" align="center" style={{ maxWidth: u(160), overflow: "hidden", textOverflow: "ellipsis" }}>{foot}</T>
        </div>
      ))}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
            <Dialog.Title className="text-base font-semibold">{d.systemResources}</Dialog.Title>
            <Dialog.Description className="mb-3 text-xs text-muted">{d.resourcesDesc}</Dialog.Description>
            {r && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-muted">{d.machineHeader}</dt><dd>{r.host ?? "—"}</dd>
                <dt className="text-muted">{d.workersReporting}</dt><dd>{fill(d.workersReportingValue, { w: r.workers, b: r.busy_workers })}</dd>
                <dt className="text-muted">CPU</dt><dd>{r.cpu_percent !== null ? fill(d.cpuOfThreads, { cpu: r.cpu_percent, n: r.cpu_count ?? "—" }) : `— · ${fill(d.threads, { n: r.cpu_count ?? "—" })}`}</dd>
                <dt className="text-muted">{d.resourceMemory}</dt><dd>{r.memory_used_bytes !== null && r.memory_total_bytes ? fill(d.memoryOf, { used: gb(r.memory_used_bytes), total: gb(r.memory_total_bytes) }) : "—"}</dd>
                <dt className="text-muted">GPU</dt><dd>{r.gpu_name ?? d.notReported} · {d.gpuLoadNotMeasured}</dd>
                <dt className="text-muted">{d.measured}</dt><dd>{r.reported_at ? new Date(r.reported_at).toLocaleTimeString(tag) : "—"}</dd>
              </dl>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
