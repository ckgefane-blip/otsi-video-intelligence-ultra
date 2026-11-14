/**
 * The live token balance (GET /v1/wallet), shared by the top-bar counter and the status bar. One reader for the whole app: it reads at
 * once, every 15 s while the page is visible, when the window gets focus again, and whenever something says the balance may have changed
 * (`walletChanged()`: a purchase, a run or render that spends tokens, a job that finishes). While a job is running it reads every 5 s, so
 * a spend shows within seconds of the server writing it. undefined = reading, null = could not read. `walletReadAt()` = the last good read.
 */
import type { LicenceSnapshot, PlanCatalogue, WalletBalance } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "./api";

/** The last plan the app actually saw, kept in localStorage so the Wallet page can show it when central
 *  cannot be reached — even if the Wallet page was never opened while online. Only a value the server
 *  really returned is ever shown. The plan is fetched once per session, alongside the balance read
 *  (which runs on every page via the top-bar counter and the status bar), so it is cached whatever
 *  page the person was on while online — the Wallet page alone cannot cache it, because it only
 *  fetches when it mounts. */
const PLAN_KEY = "otsi-wallet-last-known-plan";
function readLastKnownPlan(): string | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(PLAN_KEY);
    return raw || null;
  } catch { return null; }
}
let lastPlan: string | null = readLastKnownPlan();
let planFetched = false;
const planSubs = new Set<(p: string | null) => void>();
async function readPlan() {
  if (planFetched) return;
  try {
    const [l, c] = await Promise.all([api<LicenceSnapshot>("/v1/licence"), api<PlanCatalogue>("/v1/billing/plans")]);
    const name = c.plans.find((p) => p.code === l.plan)?.label ?? l.plan;
    lastPlan = name;
    planFetched = true;
    try { localStorage.setItem(PLAN_KEY, name); } catch { /* storage unavailable */ }
    planSubs.forEach((f) => f(name));
  } catch { /* offline or not ready: retry on the next balance read */ }
}
/** the last known plan name (null = never read); subscribes so the Wallet page updates when it arrives */
export function usePlanName(): string | null {
  const [p, setP] = useState<string | null>(lastPlan);
  useEffect(() => {
    planSubs.add(setP);
    void readPlan();
    return () => { planSubs.delete(setP); };
  }, []);
  return p;
}


const EVENT = "otsi-wallet-changed";
const POLL_MS = 15_000;
const BUSY_MS = 5_000;                                              // while jobs run (setWalletBusy)
let readAt: number | null = null;
let busy = false;
/** The last balance the app actually saw, kept in localStorage so the Wallet page can show it when central
 *  cannot be reached — even after a reload. Only a value the server really returned is ever shown; when
 *  nothing was ever read, there is no cached value and the page shows "—" as before. */
const LAST_KNOWN_KEY = "otsi-wallet-last-known";
function readLastKnown(): WalletBalance | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(LAST_KNOWN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<WalletBalance>;
    return typeof v?.balance === "number" && typeof v?.organization_id === "string" ? v as WalletBalance : null;
  } catch { return null; }
}
function saveLastKnown(w: WalletBalance): void {
  try { localStorage.setItem(LAST_KNOWN_KEY, JSON.stringify(w)); } catch { /* storage unavailable: in-memory only */ }
}
let last: WalletBalance | null | undefined = readLastKnown() ?? undefined;
const subs = new Set<(w: WalletBalance | null) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

async function read() {
  if (inflight || (typeof document !== "undefined" && document.hidden)) return;
  inflight = true;
  try { last = await api<WalletBalance>("/v1/wallet"); readAt = Date.now(); saveLastKnown(last); void readPlan(); } catch { last = last ?? null; } finally { inflight = false; }
  subs.forEach((f) => f(last ?? null));
}
const onWake = () => { if (!document.hidden) void read(); };

/** when the last good read was (ms), for "updated 3 s ago" */
export const walletReadAt = () => readAt;

function restart() {
  if (timer) clearInterval(timer);
  timer = subs.size ? setInterval(() => void read(), busy ? BUSY_MS : POLL_MS) : null;
}
/** jobs are running (Jobs Center knows): read every 5 s instead of every 15 s */
export function setWalletBusy(b: boolean) { if (b !== busy) { busy = b; restart(); } }

/** tell every counter to read the balance again now */
export const walletChanged = () => window.dispatchEvent(new Event(EVENT));

export function useWalletBalance(): WalletBalance | null | undefined {
  const [w, setW] = useState<WalletBalance | null | undefined>(last);
  useEffect(() => {
    subs.add(setW);
    if (subs.size === 1) {
      void read();
      restart();
      window.addEventListener(EVENT, onWake); window.addEventListener("focus", onWake); document.addEventListener("visibilitychange", onWake);
    } else if (last !== undefined) setW(last);
    return () => {
      subs.delete(setW);
      if (subs.size === 0) {
        if (timer) clearInterval(timer);
        timer = null;
        window.removeEventListener(EVENT, onWake); window.removeEventListener("focus", onWake); document.removeEventListener("visibilitychange", onWake);
      }
    };
  }, []);
  return w;
}
