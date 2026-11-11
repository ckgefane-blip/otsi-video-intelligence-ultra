"use client";
/**
 * Page 01 Section 04 — the four KPI cards (approved reference 01_HOME_OVERVIEW, "stats").
 *
 * Real totals of the organization from GET /v1/overview/stats (recorded rows only). "—" while loading or when the totals could not be
 * read: unknown, never a guessed number. The change figure is how many were added in the last 7 days ("+N"), and the five bars are the
 * last five weeks, oldest first, scaled to the busiest week (the reference's 4 px is an empty week). Both "—" / flat until loaded. A card opens the page that lists what it counts (players have no list page yet, so that card is not a link).
 *
 * Ultra pass (in place): each card is memoised so a re-render of the page does not re-render all four cards when the totals have not
 * changed, and the weekly trend is derived once per totals object. A failed read is named, not silent: the cards' labels say the totals
 * could not be read (the retry is the list pages the cards already link to, and Recent Matches on this page).
 */
import type { OverviewStats } from "@otsi-vie/contracts";
import Link from "next/link";
import { memo, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { Evidence } from "@/components/evidence/Evidence";
import { B, Ic, P, T, stageStyles as s, u } from "@/components/stage/DesignStage";

/** icon, stat, label, link, panel x, panel w, icon box x0, x1, text x, change x (right edge), first trend bar x */
type Stat = Exclude<keyof OverviewStats, "weekly">;
/** the card's label as the person reads it (ADR-139) */
const cardLabel = (t: Dictionary, stat: Stat): string => ({
  matches_analyzed: t.body.home.kpiMatchesAnalyzed, players_tracked: t.body.home.kpiPlayersTracked,
  reels_generated: t.body.home.kpiReelsGenerated, reports_created: t.body.home.kpiReportsCreated,
}[stat]);
const CARDS: [string, Stat, string | null, number, number, number, number, number, number, number][] = [
  ["cam", "matches_analyzed", "/matches", 39, 413, 60, 145, 172, 428, 365],
  ["ppl", "players_tracked", null, 470, 408, 499, 584, 609, 855, 782],
  ["reel", "reels_generated", "/reels", 896, 399, 917, 1000, 1027, 1270, 1195],
  ["doc", "reports_created", "/reports", 1314, 401, 1339, 1422, 1444, 1689, 1615],
];

const Y = 602;

interface KpiCardProps {
  icon: string;
  stat: Stat;
  label: string;
  href: string | null;
  px: number;
  pw: number;
  i0: number;
  i1: number;
  tx: number;
  cx: number;
  bx: number;
  stats: OverviewStats | null;
  failed: boolean;
}

const KpiCard = memo(function KpiCard({ icon, stat, label, href, px, pw, i0, i1, tx, cx, bx, stats, failed }: KpiCardProps) {
  const { t } = useLocale();
  const weeks = stats?.weekly[stat] ?? null;
  const peak = useMemo(() => (weeks ? Math.max(...weeks) : 0), [weeks]);
  const value = stats ? stats[stat].toLocaleString("en-GB") : "—";
  const o: [number, number] = [px, Y];
  const ariaLabel = failed
    ? t.body.home.kpiAriaFailed.replace("{label}", label)
    : stats
      ? t.body.home.kpiAriaValue.replace("{label}", label).replace("{n}", String(stats[stat])).replace("{w}", String(weeks![4]))
      : t.body.home.kpiAriaUnknown.replace("{label}", label);
  const body = (
    <>
      <B o={o} x={i0} y={623} w={i1 - i0} h={86} style={{ background: "#0a2b55", borderRadius: u(12) }} />
      <Ic o={o} x={(i0 + i1) / 2} y={666} k={icon} size={44} color="#33a8ff" />
      <T o={o} x={tx} y={649} size={36} weight={700} as="span">{value}</T>
      <T o={o} x={tx} y={687} size={22} color="#cfe0f5" as="span">{label}</T>
      {stat === "players_tracked" && <B o={o} x={tx + 172} y={677} w={20} h={20}><Evidence level="CONFIRMED" compact size={12} why={t.body.home.kpiPlayersWhy} /></B>}
      <T o={o} x={cx} y={646} size={19} weight={600} color={weeks && weeks[4]! > 0 ? "#3ee6a8" : "#8ea3bf"} align="right" as="span">
        {weeks ? `+${weeks[4]}` : "—"}
      </T>
      {[0, 1, 2, 3, 4].map((j) => {
        const h = weeks && peak ? 4 + Math.round((20 * weeks[j]!) / peak) : 4;
        return <B key={j} o={o} x={bx + j * 15} y={712 - h} w={9} h={h} style={{ background: weeks && weeks[j]! > 0 ? "#1e90ff" : "#1e3a66", borderRadius: u(2) }} />;
      })}
    </>
  );
  const box = { left: u(px), top: u(Y - 101), width: u(pw), height: u(135) };
  return href ? (
    <Link href={href} className={`${s.cta} ${s.pnFill} ${s.framed}`} style={box} aria-label={ariaLabel}>{body}</Link>
  ) : (
    <div className={`${s.a} ${s.pnFill} ${s.framed}`} style={box} role="group" aria-label={ariaLabel}>{body}</div>
  );
});

export function KpiCards() {
  const { t } = useLocale();
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void api<OverviewStats>("/v1/overview/stats").then(
      (x) => { setStats(x); setFailed(false); },
      () => setFailed(true),
    );
  }, []);

  return (
    <section aria-label={t.body.home.kpiStripAria} data-section="p01-s04" data-loaded={stats ? "yes" : "no"} aria-busy={!stats && !failed}>
      {CARDS.map(([icon, key, href, px, pw, i0, i1, tx, cx, bx]) => (
        <KpiCard key={key} icon={icon} stat={key} label={cardLabel(t, key)} href={href} px={px} pw={pw} i0={i0} i1={i1} tx={tx} cx={cx} bx={bx} stats={stats} failed={failed} />
      ))}
    </section>
  );
}
