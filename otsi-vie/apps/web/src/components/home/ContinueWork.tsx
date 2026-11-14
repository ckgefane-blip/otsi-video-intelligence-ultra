"use client";
/**
 * Home — Continue Work (ui-ux-spec §6.1): tabs "Recent Matches" / "Recent Sessions". Recent Matches is the real list
 * (RecentMatches, at most the four most recently analysed); Recent Sessions has no backend yet, so the tab shows the
 * empty state "No sessions yet." — never invented rows. "View all" opens Matches (owner 2026-11-13); the spec's
 * Library link is superseded by that decision.
 */
import Link from "next/link";
import { useState } from "react";
import { useLocale } from "@/lib/i18n";
import { RecentMatches } from "./RecentMatches";

export function ContinueWork() {
  const { t } = useLocale();
  const h = t.body.home;
  const [tab, setTab] = useState<"matches" | "sessions">("matches");
  return (
    <section aria-label={h.hmContinueWork} className="min-w-0" data-continue-work>
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 className="t-panel">{h.hmContinueWork}</h2>
        <Link href="/matches" className="t-small text-primary hover:underline" aria-label={h.hmViewAllMatches}>
          {h.hmViewAll}
        </Link>
      </div>
      <div role="tablist" aria-label={h.hmContinueWork} className="flex gap-4 border-b border-line">
        <button type="button" role="tab" aria-selected={tab === "matches"} onClick={() => setTab("matches")}
          className={`t-body border-b-2 px-1 py-2 ${tab === "matches" ? "border-primary font-semibold" : "border-transparent text-muted hover:text-ink"}`}>
          {h.hmRecentMatches}
        </button>
        <button type="button" role="tab" aria-selected={tab === "sessions"} onClick={() => setTab("sessions")}
          className={`t-body border-b-2 px-1 py-2 ${tab === "sessions" ? "border-primary font-semibold" : "border-transparent text-muted hover:text-ink"}`}>
          {h.hmRecentSessions}
        </button>
      </div>
      {tab === "matches" ? (
        <RecentMatches hideHeader />
      ) : (
        <div role="tabpanel" className="px-2 py-3" data-sessions-empty>
          <span className="t-body block">{h.hmNoSessions}</span>
          <span className="t-small text-muted">{h.hmNoSessionsBody}</span>
        </div>
      )}
    </section>
  );
}
