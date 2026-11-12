"use client";
/**
 * Home — the four KPI cards: real totals of the organization from GET /v1/overview/stats (recorded rows only). "—" while loading or when
 * the totals could not be read: unknown, never a guessed number. The change figure is how many were added in the last 7 days ("+N"),
 * and the five bars are the last five weeks, oldest first, scaled to the busiest week. A card opens the page that lists what it counts
 * (players have no list page yet, so that card is not a link). Each card is memoised; a failed read is named in the cards' labels.
 */
import type { OverviewStats } from "@otsi-vie/contracts";
import { Clapperboard, FileText, Users, Video } from "lucide-react";
import Link from "next/link";
import { memo, useEffect, useMemo, useState, type ComponentType } from "react";
import { Evidence } from "@/components/evidence/Evidence";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";

type Stat = Exclude<keyof OverviewStats, "weekly">;
const cardLabel = (t: Dictionary, stat: Stat): string => ({
  matches_analyzed: t.body.home.kpiMatchesAnalyzed, players_tracked: t.body.home.kpiPlayersTracked,
  reels_generated: t.body.home.kpiReelsGenerated, reports_created: t.body.home.kpiReportsCreated,
}[stat]);
const CARDS: [ComponentType<{ className?: string }>, Stat, string | null][] = [
  [Video, "matches_analyzed", "/matches"], [Users, "players_tracked", null], [Clapperboard, "reels_generated", "/reels"], [FileText, "reports_created", "/reports"],
];

const KpiCard = memo(function KpiCard({ Icon, stat, label, href, stats, failed }: { Icon: ComponentType<{ className?: string }>; stat: Stat; label: string; href: string | null; stats: OverviewStats | null; failed: boolean }) {
  const { t } = useLocale();
  const weeks = stats?.weekly[stat] ?? null;
  const peak = useMemo(() => (weeks ? Math.max(...weeks) : 0), [weeks]);
  const value = stats ? stats[stat].toLocaleString("en-GB") : "—";
  const ariaLabel = failed ? t.body.home.kpiAriaFailed.replace("{label}", label)
    : stats ? t.body.home.kpiAriaValue.replace("{label}", label).replace("{n}", String(stats[stat])).replace("{w}", String(weeks![4]))
      : t.body.home.kpiAriaUnknown.replace("{label}", label);
  const body = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-raised text-primary"><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="t-metric block">{value}</span>
        <span className="t-small flex items-center gap-1.5 text-muted">
          <span className="truncate">{label}</span>
          {stat === "players_tracked" && <Evidence level="CONFIRMED" compact size={11} why={t.body.home.kpiPlayersWhy} />}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1.5">
        <span className={`t-small font-normal ${weeks && weeks[4]! > 0 ? "text-ok" : "text-muted"}`}>{weeks ? `+${weeks[4]}` : "—"}</span>
        <span className="flex h-6 items-end gap-[3px]" aria-hidden>
          {[0, 1, 2, 3, 4].map((j) => {
            const h = weeks && peak ? 3 + Math.round((21 * weeks[j]!) / peak) : 3;
            return <i key={j} className={`block w-[6px] rounded-sm ${weeks && weeks[j]! > 0 ? "bg-primary" : "bg-line2"}`} style={{ height: h }} />;
          })}
        </span>
      </span>
    </>
  );
  const cls = "vie-panel flex items-center gap-3 px-3.5 py-3";
  return href ? <Link href={href} className={`${cls} hover:border-line2`} aria-label={ariaLabel} data-kpi={stat}>{body}</Link>
    : <div className={cls} role="group" aria-label={ariaLabel} data-kpi={stat}>{body}</div>;
});

export function KpiCards() {
  const { t } = useLocale();
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void api<OverviewStats>("/v1/overview/stats").then((x) => { setStats(x); setFailed(false); }, () => setFailed(true));
  }, []);
  return (
    <section aria-label={t.body.home.kpiStripAria} data-section="p01-s04" data-loaded={stats ? "yes" : "no"} aria-busy={!stats && !failed}
      className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {CARDS.map(([Icon, key, href]) => <KpiCard key={key} Icon={Icon} stat={key} label={cardLabel(t, key)} href={href} stats={stats} failed={failed} />)}
    </section>
  );
}
