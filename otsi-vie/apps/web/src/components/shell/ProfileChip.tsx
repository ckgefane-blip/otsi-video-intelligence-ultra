"use client";
/**
 * The account button in the top bar (SOT rebuild 2026-11-13): the SOT's `.av` — a 28 px icon-only button with the person
 * silhouette, no name, no role, no account dialog. It links to /settings/team (the SOT's button carries no href; the team page
 * is where the account, members and roles live).
 *
 * Note: this removes the top bar's only entry points to sign out, switching organisations, the profile photo, the Guided/Pro
 * switch and the language switcher. Those live in no other top-level place; whether they get a new home (for example the
 * Settings pages) is an open owner decision — see the rebuild report.
 */
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/lib/i18n";

export function ProfileChip({ styles }: { styles: Record<string, string> }) {
  const { status, me } = useAuth();
  const { t } = useLocale();
  if (status !== "signed-in" || !me) {
    return (
      <span className={`${styles.abs} ${styles.account} ${styles.placeholder}`} aria-hidden>
        <span className={styles.avatar} />
      </span>
    );
  }
  return (
    <Link href="/settings/team" className={styles.avatar} data-account aria-label={t.body.shell.accountLabel} title={t.body.shell.accountLabel}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </Link>
  );
}
