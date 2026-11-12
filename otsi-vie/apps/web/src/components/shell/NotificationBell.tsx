"use client";
/**
 * The notifications bell in the top bar (v3 Phase A.15, S13, ADR-075): what happened in the organization in the last 14 days, read from
 * what the engine and the team recorded (GET /v1/notifications): an analysis or render finished or failed, "Is this him?" moments for a
 * reel's player, team sheets to approve, comments left through share links, rights ending. The number is what is new since the person
 * last opened the bell; opening it marks everything read (POST /v1/notifications/read). Each row opens the page that deals with it.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { Notification, NotificationKind, Notifications } from "@otsi-vie/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api } from "@/lib/api";
import { ago, agoTemplates } from "@/lib/jobs";
import { useLocale } from "@/lib/i18n";
import { kindVisible, useNotificationPrefs } from "@/lib/notificationPrefs";

type Styles = Record<string, string>;
const POLL_MS = 60_000;
export const KIND_ICON: Record<NotificationKind, [string, string]> = {
  JOB_DONE: ["✓", "#22C55E"], JOB_FAILED: ["!", "#EF4444"], REVIEW: ["?", "#F1A824"], COMMENT: ["❝", "#079BFF"], RIGHTS: ["⏳", "#F1A824"],
};
/** what the badge says: nothing when nothing is new; at most "9+" */
export const bellBadge = (n: number) => (n <= 0 ? null : n > 9 ? "9+" : String(n));

export function NotificationBell({ styles }: { styles: Styles }) {
  const { t } = useLocale();
  const { status, organization } = useAuth();
  const { prefs } = useNotificationPrefs();
  const org = organization?.organization_id ?? null;
  const [list, setList] = useState<Notifications | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  /** opening the bell marks everything read on the server, so the number goes even though the rows keep their
   *  "new" mark while the panel is open; cleared when the panel closes and the list is read again */
  const [readAll, setReadAll] = useState(false);

  const load = useCallback(async () => {
    if (!org) return;
    try { setList(await api<Notifications>("/v1/notifications")); setFailed(false); } catch { setFailed(true); }
  }, [org]);
  useEffect(() => { setList(null); void load(); }, [load]);
  useEffect(() => {
    if (!org) return;
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => window.clearInterval(t);
  }, [load, org]);

  const openBell = (o: boolean) => {
    setOpen(o);
    if (!o) { setReadAll(false); void load(); return; }  // closing: the unread marks go (they were read)
    void load();
    // opening reads everything so far; the rows keep their "new" mark while the panel is open
    void api<{ seen_at: string }>("/v1/notifications/read", { method: "POST", json: {} })
      .then(() => { setList((l) => (l ? { ...l, unread: 0 } : l)); setReadAll(true); }, () => { /* the number stays; the next open tries again */ });
  };

  if (status !== "signed-in" || !org) return null;
  // the Preferences switches filter the feed: only the kinds the person wants to see, and the badge counts
  // only those (the server's unread count covers kinds that may be hidden)
  const items = (list?.items ?? []).filter((n) => kindVisible(prefs, n.kind));
  const unread = readAll ? 0 : items.filter((n) => n.unread).length;
  const b = bellBadge(unread);
  return (
    <Dialog.Root open={open} onOpenChange={openBell}>
      <Dialog.Trigger asChild>
        <button type="button" className={`${styles.abs} ${styles.bell}`} data-notification-bell
          aria-label={list ? t.body.shell.notifAriaNew.replace("{a}", String(unread)) : failed ? t.body.shell.notifAriaFailed : t.body.shell.notifAriaLoading} title={list ? t.body.shell.notifTitleAttr.replace("{a}", String(unread)).replace("{b}", String(list.window_days)) : t.body.shell.notifTitleFallback}>
          <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" /><path d="M10 20a2 2 0 0 0 4 0" />
          </svg>
          {b && <span className={styles.jobsCount} data-alert="1" data-notification-count={b}>{b}</span>}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50" />
        <Dialog.Content className="fixed right-4 z-50 flex max-h-[75vh] w-[30rem] max-w-[calc(100vw-2rem)] flex-col rounded-card border border-line bg-panel p-3 shadow-2xl"
          style={{ top: "calc(max(0.5px, 100vw / 2560) * 104)" }} data-notification-list>
          <div className="flex items-baseline justify-between gap-2">
            <Dialog.Title className="text-sm font-normal">{t.body.shell.notifTitle}</Dialog.Title>
            <Dialog.Description className="text-xs text-muted">{list ? t.body.shell.notifDesc.replace("{a}", String(list.window_days)) : failed ? t.body.shell.notifDescFailed : t.body.shell.notifDescReading}</Dialog.Description>
          </div>
          <div className="mt-2 flex-1 overflow-y-auto pr-1">
            {failed && !list && <p role="alert" className="py-6 text-center text-sm text-danger">{t.body.shell.notifFailed}</p>}
            {list && items.length === 0 && <p className="py-6 text-center text-sm text-muted">{t.body.shell.notifEmpty.replace("{a}", String(list.window_days))}</p>}
            {items.map((n) => <Row key={n.id} n={n} close={() => openBell(false)} />)}
          </div>
          <p className="mt-2 text-[11px] text-muted">{t.body.shell.notifFooter}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ n, close }: { n: Notification; close: () => void }) {
  const { t } = useLocale();
  const [icon, color] = KIND_ICON[n.kind];
  return (
    <Link href={n.href} onClick={close} className="flex items-start gap-2 rounded-ctl border-b border-line/60 px-1 py-2 last:border-0 hover:bg-raised/50"
      data-notification={n.kind} data-unread={n.unread ? "1" : "0"}>
      <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs font-normal" style={{ color, border: `1.5px solid ${color}` }} aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{n.unread && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-cyan align-middle" aria-label={t.body.shell.notifNew} />}<span className="font-normal">{n.title}</span></span>
        {n.detail && <span className="block truncate text-xs text-muted">{n.detail}</span>}
      </span>
      <span className="flex-none text-xs text-muted">{ago(n.at, Date.now(), agoTemplates(t))}</span>
    </Link>
  );
}
