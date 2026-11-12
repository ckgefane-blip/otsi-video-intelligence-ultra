"use client";

import { cx } from "./cx";

/**
 * Spec §7 job statuses — the ONLY statuses a job ever carries.
 * Never an evidence badge on a job: a job at 72% is "Running", never
 * "Detected"; a finished reel is "Done", never "Not measured".
 */
export type JobStatusKind = "queued" | "running" | "done" | "failed" | "cancelled";

const KINDS: Record<JobStatusKind, { label: string; classes: string }> = {
  queued: { label: "Queued", classes: "border-line bg-raised text-muted" },
  running: { label: "Running", classes: "border-primary/40 bg-primary/10 text-primary" },
  done: { label: "Done", classes: "border-ok/40 bg-ok/10 text-ok" },
  failed: { label: "Failed", classes: "border-danger/40 bg-danger/10 text-danger" },
  cancelled: { label: "Cancelled", classes: "border-line bg-raised text-muted" },
};

export interface JobStatusProps {
  status: JobStatusKind;
  /** Progress percentage, shown only while Running. */
  progress?: number;
  className?: string;
}

/** Spec §4/§7 JobStatus pill, 12px semibold. */
export function JobStatus({ status, progress, className }: JobStatusProps) {
  const { label, classes } = KINDS[status];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-label font-semibold tabular-nums", classes, className)}>
      {label}
      {status === "running" && typeof progress === "number" && <span aria-label={`${Math.round(progress)} percent`}>{Math.round(progress)}%</span>}
    </span>
  );
}
