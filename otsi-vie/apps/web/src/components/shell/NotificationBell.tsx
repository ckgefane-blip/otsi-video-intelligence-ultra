"use client";
/**
 * The notifications bell in the top bar (SOT rebuild 2026-11-13): the SOT's plain button — aria "Notifications", the bell glyph,
 * no badge, no menu, no dialog. The notification list it used to open is gone with it; the events it listed (analysis or render
 * finished or failed, "Is this him?" moments, team sheets to approve, share-link comments, rights ending) are still reachable
 * from the pages that deal with them (Home inbox, Processing, Reports).
 */
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/lib/i18n";

type Styles = Record<string, string>;

export function NotificationBell({ styles }: { styles: Styles }) {
  const { t } = useLocale();
  const { status, organization } = useAuth();
  if (status !== "signed-in" || !organization) return null;
  return (
    <button type="button" className={`${styles.abs} ${styles.bell}`} data-notification-bell aria-label={t.body.shell.notifTitle}>
      <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" />
      </svg>
    </button>
  );
}
