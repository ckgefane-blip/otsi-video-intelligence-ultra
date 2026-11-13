"use client";
/**
 * Notification preferences (Settings > Preferences, SOT): which kinds of in-app bell notification the person
 * wants to see. Kept in this browser (per person, per browser); every read and write tolerates blocked storage
 * (the defaults apply). Defaults match the SOT: everything on except Team changes.
 *
 * The bell's feed (GET /v1/notifications) has kinds JOB_DONE, JOB_FAILED, REVIEW, COMMENT, RIGHTS and
 * BILLING. The SOT's "Job finished or failed" covers JOB_DONE + JOB_FAILED, "Identity review needed" is
 * REVIEW, "Comment on a shared link" is COMMENT. BILLING (plan orders, payments, renewals) is covered by
 * the wallet row — the preference is stored and shown, and the server records those notifications.
 * The team row has no feed kind yet.
 */
import { useCallback, useEffect, useState } from "react";
import type { NotificationKind } from "@otsi-vie/contracts";

export type NotificationPrefs = { jobs: boolean; review: boolean; comment: boolean; wallet: boolean; team: boolean };
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { jobs: true, review: true, comment: true, wallet: true, team: false };
export const NOTIFICATION_PREFS_KEY = "otsi-vie.notification-prefs";

const PREF_KEYS: (keyof NotificationPrefs)[] = ["jobs", "review", "comment", "wallet", "team"];

function read(): NotificationPrefs {
  try {
    const raw = localStorage.getItem(NOTIFICATION_PREFS_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return { ...DEFAULT_NOTIFICATION_PREFS, ...Object.fromEntries(PREF_KEYS.filter((k) => typeof parsed[k] === "boolean").map((k) => [k, parsed[k]])) };
  } catch { return DEFAULT_NOTIFICATION_PREFS; }
}

/** whether a bell item of this kind is shown under these preferences */
export const kindVisible = (prefs: NotificationPrefs, kind: NotificationKind): boolean => {
  switch (kind) {
    case "JOB_DONE":
    case "JOB_FAILED": return prefs.jobs;
    case "REVIEW": return prefs.review;
    case "COMMENT": return prefs.comment;
    case "BILLING": return prefs.wallet;
    case "RIGHTS": return true; // rights ending has no SOT row; always shown
    case "BILLING": return prefs.wallet; // plan orders paid by bank transfer go with the wallet row
  }
};

export function useNotificationPrefs() {
  const [prefs, setPrefsState] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  useEffect(() => { setPrefsState(read()); }, []);
  const setPref = useCallback((key: keyof NotificationPrefs, value: boolean) => {
    setPrefsState((prev) => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem(NOTIFICATION_PREFS_KEY, JSON.stringify(next)); } catch { /* blocked storage: this visit only */ }
      return next;
    });
  }, []);
  return { prefs, setPref };
}
