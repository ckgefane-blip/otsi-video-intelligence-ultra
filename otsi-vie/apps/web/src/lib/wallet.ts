/**
 * The live token balance (GET /v1/wallet), shared by the top-bar counter and the status bar. One reader for the whole app: it reads at
 * once, every 15 s while the page is visible, when the window gets focus again, and whenever something says the balance may have changed
 * (`walletChanged()`: a purchase, a run or render that spends tokens, a job that finishes). While a job is running it reads every 5 s, so
 * a spend shows within seconds of the server writing it. undefined = reading, null = could not read. `walletReadAt()` = the last good read.
 */
import type { WalletBalance } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "./api";

const EVENT = "otsi-wallet-changed";
const POLL_MS = 15_000;
const BUSY_MS = 5_000;                                              // while jobs run (setWalletBusy)
let readAt: number | null = null;
let busy = false;
let last: WalletBalance | null | undefined;
const subs = new Set<(w: WalletBalance | null) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

async function read() {
  if (inflight || (typeof document !== "undefined" && document.hidden)) return;
  inflight = true;
  try { last = await api<WalletBalance>("/v1/wallet"); readAt = Date.now(); } catch { last = last ?? null; } finally { inflight = false; }
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
