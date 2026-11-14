"use client";
/**
 * Home: what needs the person now (v3 Phase A.13, ADR-062). The inbox (GET /v1/overview/inbox: the next action and the Review inbox) is
 * read once per visit and every 30 s while the page stays open, and shared by the NextActionBar and the Review inbox panel (HomeStage).
 * setInbox lets a decision (POST /v1/overview/inbox/decisions) apply the returned inbox at once, instead of waiting for the next read.
 */
import type { HomeInbox } from "@otsi-vie/contracts";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

interface HomeInboxValue {
  inbox: HomeInbox | null | undefined;
  setInbox: (x: HomeInbox) => void;
}

const Ctx = createContext<HomeInboxValue>({ inbox: undefined, setInbox: () => {} });

/** the inbox for this visit (undefined while reading, null when it could not be read), and a way to apply a decision's result */
export function useHomeInbox(): HomeInboxValue {
  return useContext(Ctx);
}

/** reads the inbox once per visit (and every 30 s while the page stays open); a later failed read keeps the last good inbox */
export function HomeInboxProvider({ children }: { children: ReactNode }) {
  const [inbox, setInboxState] = useState<HomeInbox | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = () => void api<HomeInbox>("/v1/overview/inbox").then((x) => { if (live) setInboxState(x); }, () => { if (live) setInboxState((cur) => cur ?? null); });
    load();
    const t = window.setInterval(() => { if (document.visibilityState !== "hidden") load(); }, 30000);
    return () => { live = false; window.clearInterval(t); };
  }, []);
  const setInbox = (x: HomeInbox) => setInboxState(x);
  return <Ctx.Provider value={{ inbox, setInbox }}>{children}</Ctx.Provider>;
}
