"use client";
/**
 * The Jobs Center link in the top bar (SOT rebuild 2026-11-13): the SOT's `.ib` — a link to the jobs page with the pulse icon,
 * no count badge, no drawer. The jobs themselves live on /processing (the All jobs table, with the same pause / resume / cancel /
 * retry actions); this link's aria-label still names how many are active ("Jobs Center, 0 active"), read live from GET /v1/jobs.
 *
 * Note: the drawer this replaces was also the target of the old JOBS_OPEN_EVENT (the palette's "Open Jobs Center" command, Ctrl+J,
 * the Home jobs link, the ActivityLine) — the event is gone; every trigger now links straight to /processing (reconciliation 2026-11-13).
 */
import type { JobList } from "@otsi-vie/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api } from "@/lib/api";
import { pollMs } from "@/lib/jobs";
import { useLocale } from "@/lib/i18n";
import { publishJobs } from "@/lib/jobsLive";
import { setWalletBusy } from "@/lib/wallet";

type Styles = Record<string, string>;

export function JobTray({ styles }: { styles: Styles }) {
  const { t } = useLocale();
  const { status, organization } = useAuth();
  const org = organization?.organization_id ?? null;
  const [list, setList] = useState<JobList | null>(null);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    if (!org) return;
    try { const l = await api<JobList>("/v1/jobs"); setList(l); publishJobs(l); } catch { /* keep the last list; the next read tries again */ }
  }, [org]);

  useEffect(() => {
    const vis = () => setHidden(document.visibilityState === "hidden");
    vis();
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);
  useEffect(() => { setList(null); void load(); }, [load]);
  const every = pollMs(list, false, hidden);
  useEffect(() => {
    if (every === null || !org) return;
    const id = window.setInterval(() => void load(), every);
    return () => window.clearInterval(id);
  }, [every, load, org]);
  useEffect(() => {
    setWalletBusy((list?.jobs ?? []).some((j) => j.state === "RUNNING" || j.state === "QUEUED"));
  }, [list]);

  if (status !== "signed-in" || !org) return null;
  return (
    <Link href="/processing" className={`${styles.abs} ${styles.jobs}`} data-job-tray
      aria-label={list ? t.body.shell.jobsAriaActive.replace("{a}", String(list.active)) : t.body.shell.jobsAriaLoading}
      title={t.desktop.jobsCenter}>
      <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12h4l3-7 4 14 3-7h4" />
      </svg>
    </Link>
  );
}
