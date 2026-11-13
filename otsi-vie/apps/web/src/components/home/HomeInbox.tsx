"use client";
/**
 * Home: what needs the person now (v3 Phase A.13, ADR-062). The inbox (GET /v1/overview/inbox: the next action and the Review inbox) is
 * read once per visit and every 30 s while the page stays open, and shared by Start and the Review inbox panel (HomeStage).
 */
import type { HomeInbox } from "@otsi-vie/contracts";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

const Ctx = createContext<HomeInbox | null | undefined>(undefined);

/** the inbox for this visit (undefined while reading, null when it could not be read) */
export function useHomeInbox(): HomeInbox | null | undefined {
  return useContext(Ctx);
}

/** reads the inbox once per visit (and every 30 s while the page stays open); a later failed read keeps the last good inbox */
export function HomeInboxProvider({ children }: { children: ReactNode }) {
  const [inbox, setInbox] = useState<HomeInbox | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = () => void api<HomeInbox>("/v1/overview/inbox").then((x) => { if (live) setInbox(x); }, () => { if (live) setInbox((cur) => cur ?? null); });
    load();
    const t = window.setInterval(() => { if (document.visibilityState !== "hidden") load(); }, 30000);
    return () => { live = false; window.clearInterval(t); };
  }, []);
  return <Ctx.Provider value={inbox}>{children}</Ctx.Provider>;
}
