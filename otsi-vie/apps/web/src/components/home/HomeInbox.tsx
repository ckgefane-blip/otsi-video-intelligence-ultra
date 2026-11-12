"use client";
/**
 * Home: what needs the person now (v3 Phase A.13, ADR-062).
 *  - NextActionBar: under Upload Video / Paste Link, a third, state-aware action (watch the analysis, review, continue the reel, open the
 *    report, pick a player), from GET /v1/overview/inbox; absent when nothing waits.
 *  - HomeGuidance: until the organization has a finished analysis, the first-run guidance (Platform Capabilities, How It Works) stays as
 *    approved; afterwards those two places show the Review inbox (each row opens the exact page) and Active jobs (the same jobs as the
 *    top-bar tray).
 */
import type { HomeInbox, InboxKind, JobList } from "@otsi-vie/contracts";
import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Clapperboard, FileText, UserCheck } from "lucide-react";
import { api } from "@/lib/api";
import { jobStateLabel, STATE_COLOR } from "@/lib/jobs";
import { Capabilities } from "./Capabilities";
import { useLocale } from "@/lib/i18n";
import { HowItWorks } from "./HowItWorks";

const Ctx = createContext<HomeInbox | null | undefined>(undefined);

/** reads the inbox once per visit (and every 30 s while the page stays open) */
export function HomeInboxProvider({ children }: { children: ReactNode }) {
  const [inbox, setInbox] = useState<HomeInbox | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = () => void api<HomeInbox>("/v1/overview/inbox").then((x) => { if (live) setInbox(x); }, () => { if (live) setInbox(null); });
    load();
    const t = window.setInterval(() => { if (document.visibilityState !== "hidden") load(); }, 30000);
    return () => { live = false; window.clearInterval(t); };
  }, []);
  return <Ctx.Provider value={inbox}>{children}</Ctx.Provider>;
}

export function NextActionBar() {
  const inbox = useContext(Ctx);
  const n = inbox?.next;
  if (!n) return null;
  return (
    <Link href={n.href} data-cta="next-action" data-next-kind={n.kind}
      className="flex items-center gap-2 rounded-md border border-primary/50 bg-primary/10 px-3 py-2 hover:border-primary">
      <ArrowRight className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      <span className="t-body truncate font-normal">{n.label}{n.detail ? <span className="font-normal text-muted">{` · ${n.detail}`}</span> : null}</span>
    </Link>
  );
}

const KIND: Record<InboxKind, [ComponentType<{ className?: string }>, string]> = {
  IDENTITY: [UserCheck, "text-cyan"], TEAM_SHEET: [FileText, "text-ok"], STALE_REEL: [Clapperboard, "text-amber"], FAILED_JOB: [AlertTriangle, "text-danger"],
};

/** until the organization has a finished analysis: the first-run guidance; afterwards the Review inbox (side) and Active jobs (bottom) */
export function HomeGuidance({ place }: { place: "side" | "bottom" }) {
  const inbox = useContext(Ctx);
  if (inbox === undefined) return null;                        // reading: neither, so nothing flickers
  if (!inbox?.completed_match) return place === "side" ? <Capabilities /> : <HowItWorks />;
  return place === "side" ? <ReviewInbox inbox={inbox} /> : <ActiveJobs />;
}

function ReviewInbox({ inbox }: { inbox: HomeInbox }) {
  const { t } = useLocale();
  return (
    <section aria-label={t.body.home.reviewInbox} className="vie-panel min-w-0" data-section="p01-inbox">
      <div className="vie-ph">
        <h2 className="t-panel">{t.body.home.reviewInbox}</h2>
        <span className="t-small text-muted">{inbox.items.length ? t.body.home.inboxToDo.replace("{a}", String(inbox.items.length)) : t.body.home.inboxAllClear}</span>
      </div>
      {inbox.items.length === 0 && <p className="t-small p-3 text-muted">{t.body.home.inboxNothingWaits}</p>}
      <ul className="flex flex-col p-1.5">
        {inbox.items.slice(0, 5).map((it, i) => {
          const [Icon, tone] = KIND[it.kind];
          return (
            <li key={`${it.kind}-${i}`}>
              <Link href={it.href} data-inbox={it.kind} className="flex items-center gap-2.5 rounded px-2 py-2 hover:bg-raised">
                <Icon className={`h-4 w-4 shrink-0 ${tone}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="t-body block truncate font-normal">{it.title}</span>
                  <span className="t-small block truncate text-muted">{it.detail ?? ""}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** the same jobs as the Jobs Center: what runs or waits now, else what finished in the last day */
function ActiveJobs() {
  const { t } = useLocale();
  const [list, setList] = useState<JobList | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void api<JobList>("/v1/jobs").then((x) => { if (live) setList(x); }, () => undefined);
    load();
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") load(); }, 5000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);
  const active = list?.jobs.filter((j) => j.state === "RUNNING" || j.state === "QUEUED" || j.state === "PAUSED") ?? [];
  const shown = (active.length ? active : list?.jobs ?? []).slice(0, 4);
  return (
    <section aria-label={t.body.home.activeJobs} className="vie-panel" data-section="p01-jobs">
      <div className="vie-ph">
        <h2 className="t-panel">{t.body.home.activeJobs}</h2>
        <span className="t-small text-muted">{list ? t.body.home.inboxRunning.replace("{a}", String(list.running)).replace("{b}", String(list.active - list.running)) : t.body.home.inboxReading}</span>
      </div>
      <p className="t-small px-3 pt-2 text-muted">{active.length ? t.body.home.inboxManageJobs : list?.jobs.length ? t.body.home.inboxLastDayJobs : t.body.home.inboxNoJobs}</p>
      <div className="grid grid-cols-1 gap-2 p-3 md:grid-cols-2 xl:grid-cols-4">
        {shown.map((j) => {
          const card = (
            <>
              <span className="flex items-center justify-between gap-2">
                <span className="t-body truncate font-normal">{j.kind_label}</span>
                <span className="t-small shrink-0" style={{ color: STATE_COLOR[j.state] }}>{jobStateLabel(t, j.state)}</span>
              </span>
              <span className="t-small block truncate text-ink2">{j.subject_title ?? "—"}</span>
              <span className={`t-small block truncate ${j.state === "FAILED" ? "text-danger" : "text-muted"}`}>{j.state === "FAILED" ? (j.error ?? t.body.home.inboxJobFailed) : (j.stage ?? "")}</span>
              <span className="mt-1 flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded bg-line"><i className="block h-full rounded" style={{ width: `${Math.max(0, Math.min(100, j.progress))}%`, background: STATE_COLOR[j.state] }} /></span>
                <span className="t-mono text-[11px]">{`${Math.round(j.progress)}%`}</span>
              </span>
            </>
          );
          const cls = "flex flex-col gap-0.5 rounded-md border border-line bg-p0 p-2.5";
          return j.href ? <Link key={j.id} href={j.href} className={`${cls} hover:border-line2`} data-home-job={j.kind}>{card}</Link>
            : <div key={j.id} className={cls} data-home-job={j.kind}>{card}</div>;
        })}
      </div>
    </section>
  );
}
