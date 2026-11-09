/**
 * The job tray's rules (v3 Phase A.3, ADR-060), kept apart from the component so they are tested: plain state names, how often the
 * list is read, and what the counter on the icon says. Every value comes from GET /v1/jobs; nothing here invents progress.
 */
import type { Job, JobList } from "@otsi-vie/contracts";

export const STATE_LABEL: Record<Job["state"], string> = {
  QUEUED: "Waiting", RUNNING: "Running", PAUSED: "Paused", SUCCEEDED: "Finished", FAILED: "Failed", CANCELLED: "Cancelled",
};
export const STATE_COLOR: Record<Job["state"], string> = {
  QUEUED: "#8ea3bf", RUNNING: "#33a8ff", PAUSED: "#ffb21a", SUCCEEDED: "#19e6a0", FAILED: "#ff5a5a", CANCELLED: "#8ea3bf",
};

/** read every 3 s while something is moving or the tray is open, every 20 s otherwise, and not at all while the tab is hidden */
export function pollMs(list: JobList | null, open: boolean, hidden: boolean): number | null {
  if (hidden) return null;
  return open || (list?.active ?? 0) > 0 ? 3000 : 20000;
}

/** the counter on the icon: the jobs waiting, running or paused; "!" when none is active but one failed in the last day */
export function badge(list: JobList | null): { text: string; alert: boolean } | null {
  if (!list) return null;
  if (list.active > 0) return { text: list.active > 99 ? "99+" : String(list.active), alert: false };
  if (list.failed_recent > 0) return { text: "!", alert: true };
  return null;
}

/** "3 min ago" style age of a time the server recorded (UTC, "YYYY-MM-DD HH:MM:SS.ffffff" or ISO) */
export function ago(at: string | null, now = Date.now()): string {
  if (!at) return "";
  const t = Date.parse(at.includes("T") ? at : `${at.replace(" ", "T")}Z`);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
}

/** a duration in plain words: between two server times, or `seconds` when given; null when it cannot be told */
export function duration(from: string | null, to: string | null, seconds?: number): string | null {
  let s = seconds;
  if (s === undefined) {
    if (!from || !to) return null;
    const p = (x: string) => Date.parse(x.includes("T") ? x : `${x.replace(" ", "T")}Z`);
    s = (p(to) - p(from)) / 1000;
    if (Number.isNaN(s)) return null;
  }
  s = Math.max(0, Math.round(s));
  return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
}
