/**
 * Page 03 AI Processing: how the engine's real run maps onto the approved composition. The five pictured stages are the engine's own
 * jobs (v3 Phase 0): the run's steps SHOTS, DETECT, TRACK, IDENTIFY and the video's ball track (TRACK_BALL, started in Analysis), which
 * finds possession, passes, shots and pressures. IDENTIFY gathers appearance evidence only: it never names a player. Nothing is simulated.
 */
import type { AnalysisRun, BallTrack } from "@otsi-vie/contracts";
import { DEV_MODE } from "@/lib/devMode";
import type { Dictionary, Locale } from "@/lib/i18n";

/** The dictionary subsection these labels come from (ADR-139 Group A). */
export type ProcessingDict = Dictionary["body"]["processing"];

/** BCP 47 tag for a locale, for the dates and numbers shown beside translated words. */
export const DATE_TAG: Record<Locale, string> = { en: "en-GB", ru: "ru-RU", es: "es-ES", de: "de-DE", fr: "fr-FR", pt: "pt-BR" };

export type StageState = "WAITING" | "ACTIVE" | "DONE" | "FAILED" | "CANCELLED" | "NOT_BUILT";

export interface StageView { state: StageState; progress: number | null; label: string }

/** the pictured stage -> the engine job that does it (null = not built); TRACK_BALL is the video's ball track, not a run step */
export const STAGE_STEP: (string | null)[] = ["SHOTS", "DETECT", "TRACK", "IDENTIFY", "TRACK_BALL"];

const LABEL: Record<StageState, string> = {
  WAITING: "Waiting", ACTIVE: "Processing", DONE: "Completed", FAILED: "Failed", CANCELLED: "Cancelled", NOT_BUILT: DEV_MODE ? "Not built" : "Not available",
};

/**
 * The stage labels for a dictionary (ADR-139 Group A): `d` translates them,
 * without it they stay English (the unit tests call these helpers bare).
 */
function stageLabels(d?: ProcessingDict): Record<StageState, string> & { NOT_STARTED: string } {
  return {
    WAITING: d?.stageWaiting ?? LABEL.WAITING,
    ACTIVE: d?.stageProcessing ?? LABEL.ACTIVE,
    DONE: d?.stageCompleted ?? LABEL.DONE,
    FAILED: d?.stageFailed ?? LABEL.FAILED,
    CANCELLED: d?.stageCancelled ?? LABEL.CANCELLED,
    NOT_BUILT: d ? (DEV_MODE ? d.stageNotBuilt : d.stageNotAvailable) : LABEL.NOT_BUILT,
    NOT_STARTED: d?.stageNotStarted ?? "Not started",
  };
}

export function stageView(run: AnalysisRun | null, step: string | null, ball: BallTrack | null = null, d?: ProcessingDict): StageView {
  const L = stageLabels(d);
  if (step === null) return { state: "NOT_BUILT", progress: null, label: L.NOT_BUILT };
  if (step === "TRACK_BALL") {
    if (!ball) return { state: "WAITING", progress: null, label: L.NOT_STARTED };
    const bs: StageState = ball.status === "SUCCEEDED" ? "DONE" : ball.status === "RUNNING" ? "ACTIVE" : ball.status === "FAILED" ? "FAILED" : "WAITING";
    return { state: bs, progress: bs === "DONE" ? 100 : bs === "WAITING" ? null : Math.max(0, Math.min(100, ball.progress ?? 0)), label: L[bs] };
  }
  const s = run?.steps.find((x) => x.name === step);
  if (!run || !s) return { state: "WAITING", progress: null, label: L.WAITING };
  const state: StageState = s.status === "SUCCEEDED" ? "DONE" : s.status === "RUNNING" ? "ACTIVE" : s.status === "FAILED" ? "FAILED"
    : s.status === "CANCELLED" ? "CANCELLED" : "WAITING";
  const progress = state === "DONE" ? 100 : state === "WAITING" ? null : Math.max(0, Math.min(100, s.progress));
  return { state, progress, label: L[state] };
}

/** the run's own status for the job card pill */
export function runLabel(run: AnalysisRun | null, d?: ProcessingDict): string {
  if (!run) return d?.runIdle ?? "Idle";
  return ({ QUEUED: d?.runQueued ?? "Queued", RUNNING: d?.stageProcessing ?? "Processing", SUCCEEDED: d?.stageCompleted ?? "Completed",
    FAILED: d?.stageFailed ?? "Failed", CANCELLED: d?.stageCancelled ?? "Cancelled",
    BLOCKED: d?.runBlocked ?? "Blocked", REVIEW_REQUIRED: d?.runReview ?? "Review" } as Record<string, string>)[run.status] ?? run.status;
}

/** overall progress of the run: the worker's job progress while it works, 100 when finished, null when nothing ran */
export function runProgress(run: AnalysisRun | null): number | null {
  if (!run) return null;
  if (run.status === "SUCCEEDED") return 100;
  if (run.status === "QUEUED") return 0;
  if (run.job && (run.status === "RUNNING")) return Math.max(0, Math.min(100, run.job.progress));
  const built = run.steps.filter((s) => STAGE_STEP.includes(s.name));
  return built.length ? built.reduce((n, s) => n + (s.status === "SUCCEEDED" ? 100 : s.progress), 0) / built.length : null;
}

export const isActive = (r: AnalysisRun | null) => !!r && (r.status === "QUEUED" || r.status === "RUNNING");

/** pill colours of the reference: done / active / idle-waiting, plus failed */
export const PILL: Record<StageState, { background: string; color: string }> = {
  DONE: { background: "#0f5a46", color: "#3ee6a8" },
  ACTIVE: { background: "#1580ff", color: "#fff" },
  WAITING: { background: "#1a2a44", color: "#9fb2cc" },
  CANCELLED: { background: "#1a2a44", color: "#9fb2cc" },
  NOT_BUILT: { background: "#141f33", color: "#6b7a92" },
  FAILED: { background: "#5a1f2a", color: "#ff8a8a" },
};

export const pct = (p: number | null) => (p === null ? "—" : `${Math.round(p)}%`);

/**
 * v3 Phase A.4 (ADR-061): the ribbon is the engine's real steps for this video, in order. The run's four steps; then the jobs that work on
 * its result: the ball (TRACK_BALL), the pitch calibration, the team sheets (READ_LINEUPS) and the football facts found from the ball
 * (passes, ball won, shots, pressures, set pieces). Each step is waiting, running, done, skipped (not run for this video), failed,
 * cancelled or STALE: done, but on an older analysis than the newest finished one, so its answer may not match the tracks shown.
 */
export type RibbonState = "WAITING" | "ACTIVE" | "DONE" | "SKIPPED" | "FAILED" | "CANCELLED" | "STALE";
export interface RibbonStep { key: string; title: string; line: string; state: RibbonState; progress: number | null; label: string }

const RIBBON_LABEL: Record<RibbonState, string> = {
  WAITING: "Waiting", ACTIVE: "Running", DONE: "Done", SKIPPED: "Not run", FAILED: "Failed", CANCELLED: "Cancelled", STALE: "Out of date",
};

/** the ribbon labels for a dictionary (ADR-139 Group A); without one they stay English. */
function ribbonLabels(d?: ProcessingDict): Record<RibbonState, string> {
  return {
    WAITING: d?.stageWaiting ?? RIBBON_LABEL.WAITING,
    ACTIVE: d?.ribbonRunning ?? RIBBON_LABEL.ACTIVE,
    DONE: d?.ribbonDone ?? RIBBON_LABEL.DONE,
    SKIPPED: d?.ribbonNotRun ?? RIBBON_LABEL.SKIPPED,
    FAILED: d?.stageFailed ?? RIBBON_LABEL.FAILED,
    CANCELLED: d?.stageCancelled ?? RIBBON_LABEL.CANCELLED,
    STALE: d?.ribbonOutOfDate ?? RIBBON_LABEL.STALE,
  };
}

/** the ribbon titles and lines for a dictionary; without one they stay English. */
function ribbonText(d?: ProcessingDict): [string, string, string][] {
  return [
    ["SHOTS", d?.shotCuts ?? "Shot cuts", d?.shotCutsLine ?? "Camera cuts"],
    ["DETECT", d?.detection ?? "Detection", d?.detectionLine ?? "People and ball"],
    ["TRACK", d?.tracking ?? "Tracking", d?.trackingLine ?? "Temporary numbers"],
    ["IDENTIFY", d?.identity ?? "Identity evidence", d?.identityLine ?? "No identity assigned"],
    ["TRACK_BALL", d?.ball ?? "Ball", d?.ballLine ?? "Followed in Analysis"],
    ["CALIBRATE_PITCH", d?.pitch ?? "Pitch", d?.pitchLine ?? "Calibrated pitch"],
    ["READ_LINEUPS", d?.teamSheets ?? "Team sheets", d?.teamSheetsLine ?? "Lineups read"],
    ["FACTS", d?.facts ?? "Football facts", d?.factsLine ?? "Passes, shots, pressures"],
  ];
}
export const RIBBON_PILL: Record<RibbonState, { background: string; color: string }> = {
  DONE: PILL.DONE, ACTIVE: PILL.ACTIVE, WAITING: PILL.WAITING, CANCELLED: PILL.CANCELLED, FAILED: PILL.FAILED,
  SKIPPED: { background: "#141f33", color: "#6b7a92" }, STALE: { background: "#4a3a12", color: "#ffc94d" },
};

/** a job's latest attempt of one kind in a video's job list (newest first by created_at) */
export interface JobLike { kind: string; state: string; progress: number; created_at: string }
const latest = (jobs: JobLike[] | null, kind: string) =>
  (jobs ?? []).filter((j) => j.kind === kind).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;

function fromJob(j: JobLike | null): { state: RibbonState; progress: number | null } {
  if (!j) return { state: "SKIPPED", progress: null };
  const state: RibbonState = j.state === "SUCCEEDED" ? "DONE" : j.state === "RUNNING" ? "ACTIVE" : j.state === "FAILED" ? "FAILED"
    : j.state === "CANCELLED" ? "CANCELLED" : "WAITING";
  return { state, progress: state === "DONE" ? 100 : state === "ACTIVE" ? Math.max(0, Math.min(100, j.progress)) : null };
}

export interface RibbonInput {
  run: AnalysisRun | null;
  /** the newest finished run (the one the tracks, tiles and events read) */
  finishedRunId: string | null;
  ball: BallTrack | null;
  /** pitch calibrations of the video, newest first (null while loading) */
  pitch: { status: string }[] | null;
  /** the football facts' state (MatchEvents.state) and the ball track they came from */
  events: { state: "NONE" | "RUNNING" | "READY"; ball_track_id: string | null } | null;
  jobs: JobLike[] | null;
}

export function ribbon({ run, finishedRunId, ball, pitch, events, jobs }: RibbonInput, d?: ProcessingDict): RibbonStep[] {
  const RL = ribbonLabels(d);
  const TEXT = new Map(ribbonText(d).map(([k, title, line]) => [k, { title, line }]));
  const step = (key: string): RibbonStep => {
    const v = stageView(run, key, null, d);
    const state: RibbonState = v.state === "NOT_BUILT" ? "SKIPPED" : v.state;
    const { title, line } = TEXT.get(key)!;
    return { key, title, line, state, progress: v.progress, label: RL[state] };
  };
  const mk = (key: string, s: { state: RibbonState; progress: number | null }): RibbonStep => {
    const { title, line } = TEXT.get(key)!;
    return { key, title, line, ...s, label: RL[s.state] };
  };

  // the ball: its own record; done on an older run than the newest finished one = stale
  const b = !ball ? { state: "SKIPPED" as RibbonState, progress: null } : { ...fromJob({ kind: "TRACK_BALL", state: ball.status, progress: ball.progress ?? 0, created_at: "" }) };
  if (b.state === "DONE" && ball && finishedRunId && ball.run_id !== finishedRunId) b.state = "STALE";

  // the pitch: a running request first, else any finished calibration, else the last request's failure
  const pj = latest(jobs, "CALIBRATE_PITCH");
  const pjs = fromJob(pj);
  const pitchDone = !!pitch?.some((c) => c.status === "SUCCEEDED");
  const ps = pjs.state === "ACTIVE" || pjs.state === "WAITING" ? pjs : pitchDone ? { state: "DONE" as RibbonState, progress: 100 } : pjs;

  // football facts: read from the ball; stale with it, running while it runs
  const fs: { state: RibbonState; progress: number | null } = !events || events.state === "NONE" ? { state: b.state === "ACTIVE" || b.state === "WAITING" ? "WAITING" : "SKIPPED", progress: null }
    : events.state === "RUNNING" ? { state: "WAITING", progress: null }
    : { state: b.state === "STALE" ? "STALE" : "DONE", progress: 100 };

  return [
    step("SHOTS"),
    step("DETECT"),
    step("TRACK"),
    step("IDENTIFY"),
    mk("TRACK_BALL", b),
    mk("CALIBRATE_PITCH", ps),
    mk("READ_LINEUPS", fromJob(latest(jobs, "READ_LINEUPS"))),
    mk("FACTS", fs),
  ];
}
