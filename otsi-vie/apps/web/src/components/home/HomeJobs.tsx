"use client";
/**
 * Home: the engine jobs (GET /v1/jobs — the jobs waiting, running or paused, and those finished in the last 24 hours,
 * newest first). Read once per visit and every 5 s while the page stays open, and shared by the Jobs Center panel and
 * Recent Activity (HomeStage), so the page asks once. A failed read keeps the last good list.
 */
import type { JobList } from "@otsi-vie/contracts";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

const Ctx = createContext<JobList | null | undefined>(undefined);

/** the jobs for this visit (undefined while reading, null when they could not be read) */
export function useHomeJobs(): JobList | null | undefined {
  return useContext(Ctx);
}

/** reads the jobs once per visit (and every 5 s while the page stays open); a later failed read keeps the last good list */
export function HomeJobsProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<JobList | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = () => void api<JobList>("/v1/jobs").then((x) => { if (live) setList(x); }, () => { if (live) setList((cur) => cur ?? null); });
    load();
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") load(); }, 5000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);
  return <Ctx.Provider value={list}>{children}</Ctx.Provider>;
}
