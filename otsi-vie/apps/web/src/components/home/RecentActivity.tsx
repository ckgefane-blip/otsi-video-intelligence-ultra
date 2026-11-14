"use client";
/**
 * Home — Recent Activity (ui-ux-spec §6.1): the finished engine jobs, newest first, with absolute dates (never relative
 * times). The source is GET /v1/jobs (the jobs finished in the last 24 hours) via the shared HomeJobsProvider — real
 * jobs only, never invented rows. Nothing finished recently: the empty state. "View all activity" opens Processing,
 * where every job is listed.
 */
import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { useHomeJobs } from "./HomeJobs";

/** an absolute date and time, e.g. "10 Nov 2026, 20:38" */
export function absoluteAt(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time}`;
}

export function RecentActivity() {
  const { t } = useLocale();
  const h = t.body.home;
  const list = useHomeJobs();
  const done = (list?.jobs ?? [])
    .filter((j) => j.state === "SUCCEEDED" && j.finished_at)
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))
    .slice(0, 5);
  return (
    <section aria-label={h.hmRecentActivity} className="min-w-0 border-t border-line pt-3" data-recent-activity>
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 className="t-panel">{h.hmRecentActivity}</h2>
        <Link href="/processing" className="t-small text-primary hover:underline">{h.hmViewAllActivity}</Link>
      </div>
      {list === undefined && <p className="t-small px-2 py-3 text-muted">{t.common.loading}</p>}
      {list === null && <p className="t-small px-2 py-3 text-danger">{h.hmJobsFailed}</p>}
      {list && done.length === 0 && (
        <div className="px-2 py-3" data-activity-empty>
          <span className="t-body block">{h.hmNoActivity}</span>
          <span className="t-small text-muted">{h.hmNoActivityBody}</span>
        </div>
      )}
      <ul className="flex flex-col">
        {done.map((j) => (
          <li key={j.id}>
            <Link href={j.href ?? "/processing"} className="flex min-h-[48px] items-center gap-3 rounded px-2 py-2 hover:bg-raised">
              <span className="min-w-0 flex-1">
                <span className="t-body block truncate font-normal">
                  {j.kind_label}{j.subject_title ? ` · ${j.subject_title}` : ""}
                </span>
                <span className="t-small block truncate text-muted">{absoluteAt(j.finished_at!)}</span>
              </span>
              <span className="t-small shrink-0 text-muted">{t.body.upload.done}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
