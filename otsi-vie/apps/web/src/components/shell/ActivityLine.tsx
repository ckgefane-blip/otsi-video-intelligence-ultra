"use client";
/**
 * The live activity line (owner 2026-11-12: "when the user is working, a real-time update, as Claude and almost every AI does"): while a
 * job runs, the status bar says what the engine is doing right now — animated dots, the job, its subject, the stage the worker reports,
 * a ticking elapsed time (from started_at), the progress, and › to open the Jobs Center. A queued job alone says it is waiting. With
 * nothing running the line is empty. Every word comes from GET /v1/jobs (via the Jobs Center's own reads, every 3 s while busy);
 * the time is counted here between reads. No estimate is shown as a countdown: estimate_s is an estimate, so it is labelled "about".
 */
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { openJobsCenter, useJobs } from "@/lib/jobsLive";

const elapsed = (from: string | null) => {
  if (!from) return null;
  const s = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
};
const about = (s: number | null) => (s == null ? null : s >= 60 ? `about ${Math.round(s / 60)} min` : `about ${Math.round(s)} s`);

export function ActivityLine() {
  const list = useJobs();
  const [, tick] = useState(0);
  const running = list?.jobs.filter((j) => j.state === "RUNNING") ?? [];
  const queued = list?.jobs.filter((j) => j.state === "QUEUED") ?? [];
  useEffect(() => {
    if (!running.length) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running.length]);
  const j = running[0] ?? queued[0];
  if (!j) return null;
  const busy = j.state === "RUNNING";
  const more = running.length + queued.length - 1;
  return (
    <button type="button" onClick={openJobsCenter} data-activity={j.id} aria-live="polite"
      className="flex min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-raised"
      aria-label={`${j.kind_label}${j.subject_title ? `, ${j.subject_title}` : ""}: ${busy ? (j.stage ?? "running") : "waiting"}. Open the Jobs Center`}>
      {busy ? (
        <span className="flex gap-[3px]" aria-hidden>
          {[0, 1, 2].map((i) => <i key={i} className="block h-1 w-1 rounded-full bg-primary animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />)}
        </span>
      ) : <span className="block h-1.5 w-1.5 rounded-full bg-muted" aria-hidden />}
      <span className="truncate text-ink2">
        {j.kind_label}{j.subject_title ? ` · ${j.subject_title}` : ""}
        <span className="text-muted">{busy ? ` — ${j.stage ?? "running"}` : " — waiting to start"}</span>
      </span>
      {busy && <span className="t-mono shrink-0 text-ink">{elapsed(j.started_at) ?? ""}</span>}
      {busy && <span className="t-mono shrink-0 text-muted">{Math.round(j.progress)}%</span>}
      {busy && j.estimate_s != null && <span className="shrink-0 text-muted">({about(j.estimate_s)} in total)</span>}
      {more > 0 && <span className="shrink-0 text-muted">+{more} more</span>}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
    </button>
  );
}
