"use client";
/**
 * Home — the six platform capability tiles (first-run guidance, until the organization has a finished analysis): the approved copy, each
 * tile opening the page where that work is done. View all opens AI Processing, where every engine stage and its real status is listed.
 * Tactical lives in the Advanced interface: in Guided its tile is hidden like its rail entry.
 */
import { ArrowRight, BarChart3, Clapperboard, FileText, LayoutGrid, ScanSearch, Share2 } from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";
import { useLocale, type Dictionary } from "@/lib/i18n";

const tiles = (t: Dictionary): [ComponentType<{ className?: string }>, string, string, string, string, boolean][] => [
  [ScanSearch, t.body.home.capDetectTitle, `${t.body.home.capDetectA} ${t.body.home.capDetectB}`, "text-cyan", "/processing", false],
  [LayoutGrid, t.body.home.capTacticsTitle, `${t.body.home.capTacticsA} ${t.body.home.capTacticsB}`, "text-amber", "/tactics", true],
  [Clapperboard, t.body.home.capReelsTitle, `${t.body.home.capReelsA} ${t.body.home.capReelsB}`, "text-primary", "/reels", false],
  [FileText, t.body.home.capReportsTitle, `${t.body.home.capReportsA} ${t.body.home.capReportsB}`, "text-ok", "/reports", false],
  [BarChart3, t.body.home.capStatsTitle, `${t.body.home.capStatsA} ${t.body.home.capStatsB}`, "text-cyan", "/analysis", false],
  [Share2, t.body.home.capShareTitle, `${t.body.home.capShareA} ${t.body.home.capShareB}`, "text-ink2", "/exports", false],
];

export function Capabilities() {
  const { t } = useLocale();
  return (
    <section aria-label={t.body.home.capGridAria} className="vie-panel min-w-0" data-section="p01-s08">
      <div className="vie-ph">
        <h2 className="t-panel">{t.body.home.capabilities}</h2>
        <Link href="/processing" className="t-small flex items-center gap-1 text-primary hover:underline" aria-label={t.body.home.capViewAllAria}>
          {t.body.home.viewAll}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <ul className="flex flex-col p-1.5">
        {tiles(t).map(([Icon, title, desc, tone, href, advanced]) => (
          <li key={title} {...(advanced ? { "data-advanced": "" } : {})}>
            <Link href={href} className="flex items-start gap-2.5 rounded px-2 py-2 hover:bg-raised" aria-label={`${title}: ${desc}`}>
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
              <span className="min-w-0">
                <span className="t-body block font-normal">{title}</span>
                <span className="t-small block text-muted">{desc}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
