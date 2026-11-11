"use client";
/**
 * Page 01 Section 08 — six platform capability tiles (approved reference 01_HOME_OVERVIEW, "Platform Capabilities").
 *
 * The approved copy, each tile opening the page where that work is done. View All opens AI Processing, where every engine stage and its
 * real status is listed.
 */
import Link from "next/link";
import { ACC, Ic, P, T, stageStyles as s, u } from "@/components/stage/DesignStage";
import { useLocale } from "@/lib/i18n";

/** icon, title, two description lines, tile x, tile y, icon colour, destination */
const TILES: [string, string, [string, string], number, number, string, string][] = [
  ["scan", "AI Player Detection", ["Automatically identify", "and track all players"], 1855, 815, "#33a8ff", "/processing"],
  ["tac", "Tactical Analysis", ["Team shape, transitions", "and tactical patterns"], 2180, 815, "#f5b82e", "/tactics"],
  ["clap", "Custom Reels", ["Create player highlights", "in minutes"], 1855, 930, "#8a6cff", "/reels"],
  ["doc", "Detailed Reports", ["Export shareable", "PDF reports"], 2180, 930, "#3ee6a8", "/reports"],
  ["bars", "Team & Player Stats", ["Distances, speeds,", "actions and more"], 1855, 1045, "#33a8ff", "/analysis"],
  ["ppl", "Collaborate & Share", ["Work with your team", "and clients"], 2180, 1045, "#e84aa8", "/exports"],
];

export function Capabilities() {
  const { t } = useLocale();
  return (
    <section aria-label="Platform capabilities grid" data-section="p01-s08">
      <P x={1841} y={757} w={681} h={405} />
      <ACC x={1857} y={771} h={26} />
      <T x={1880} y={784} size={27} weight={600} as="h2">{t.body.home.capabilities}</T>
      <Link href="/processing" className={s.cta} aria-label="View all capabilities on AI Processing"
        style={{ left: u(2380), top: u(770 - 101), width: u(124), height: u(34) }}>
        <T o={[2380, 770]} x={2474} y={786} size={21} color="#33a8ff" align="right" as="span">{t.body.home.viewAll}</T>
        <Ic o={[2380, 770]} x={2489} y={786} k="arr" size={20} color="#33a8ff" />
      </Link>
      {TILES.map(([icon, title, [l1, l2], x, y, colour, href]) => {
        const o: [number, number] = [x, y];
        return (
          <Link key={title} href={href} className={`${s.cta} ${s.framed}`} aria-label={`${title}: ${l1} ${l2}`}
            style={{ left: u(x), top: u(y - 101), width: u(x < 2000 ? 311 : 331), height: u(104), background: "#06142a",
              borderRadius: u(8) }}>
            <span className={s.a} style={{ left: u(x + 15 - o[0]), top: u(y + 12 - o[1]), width: u(78), height: u(78), background: "#0a2447", borderRadius: u(10) }} />
            <Ic o={o} x={x + 54} y={y + 51} k={icon} size={44} color={colour} />
            <T o={o} x={x + 116} y={y + 29} size={22} weight={600} as="span">{title}</T>
            <T o={o} x={x + 116} y={y + 57} size={18} color="#9fb3cc" as="span">{l1}</T>
            <T o={o} x={x + 116} y={y + 80} size={18} color="#9fb3cc" as="span">{l2}</T>
          </Link>
        );
      })}
    </section>
  );
}
