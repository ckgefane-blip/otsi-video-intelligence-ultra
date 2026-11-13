"use client";
/**
 * The accuracy line (SOT rebuild 2026-11-13): one slim line at the top of the Home page body, not a banner.
 * The SOT's Home (Main.dc.html — and its Jobs Center / keyboard-shortcuts variants, which are the same Home
 * page with an overlay open) has exactly this, as the first row of the page: a warn dot, "Accuracy not yet
 * measured · every number and box is what the engine recorded on this footage" (the second half muted),
 * "G05 not started · G06 not started · G07 not started", and a "Release gates" link on the right. No chips,
 * no "Hide for now". The SOT has no accuracy line at all on Analysis, Tactical, Reels, Clip Studio or
 * Library, so this is rendered only on Home (see HomeStage), not in the (app) layout. It disappears once
 * every gate passes (ADR-063). The gate words come from the same ACCURACY_GATES the old banner used, so
 * with the gates unstarted the line reads exactly as the SOT's.
 */
import { ACCURACY_GATES, accuracyMeasured, type GateStatus } from "@otsi-vie/contracts";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";

export function AccuracyBanner() {
  const { t } = useLocale();
  const d = t.desktop;
  // The keys below live in chrome.json until the reconciliation pass adds them to dictionaries.ts; until
  // then the SOT's English wording shows (the fallback), so the line never renders blank on Home.
  const lead = d.accuracyLineLead ?? "Accuracy not yet measured";
  const rest = d.accuracyLineRest ?? "· every number and box is what the engine recorded on this footage";
  const releaseGates = d.releaseGates ?? "Release gates";
  if (accuracyMeasured()) return null;
  const statusWord = (status: GateStatus) => {
    switch (status) {
      case "NOT_STARTED": return d.accuracyGateNotStarted ?? "not started";
      case "MEASURING": return d.accuracyGateMeasuring ?? "measuring";
      case "PASSED": return d.accuracyGatePassed ?? "passed";
      case "FAILED": return d.accuracyGateFailed ?? "failed";
      case "WAIVED": return d.accuracyGateWaived ?? "waived";
    }
  };
  return (
    <div role="note" aria-label="Accuracy not yet measured" data-accuracy-line
      className="flex items-center gap-3 border-b border-line py-2 text-[12px] leading-5">
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
      <span className="min-w-0 flex-1">
        {lead} <span className="text-muted">{rest}</span>
      </span>
      <span className="shrink-0 text-muted">
        {ACCURACY_GATES.map((g) => `${g.id} ${statusWord(g.status)}`).join(" · ")}
      </span>
      <Link href="/settings/admin/release" className="shrink-0 text-primary hover:underline">{releaseGates}</Link>
    </div>
  );
}
