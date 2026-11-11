"use client";
/**
 * Home hero — the player card: the player in the hero picture (HeroLive: a random player a person CONFIRMED), with his shirt number from
 * the match sheet (else initials), name and position · team (else his OTSI Player ID); it opens his report. Until a person confirms one:
 * "— / No player selected / Confirmed players only". Never an unconfirmed track.
 */
import type { HeroMoment } from "@otsi-vie/contracts";
import Link from "next/link";
import { Evidence } from "@/components/evidence/Evidence";
import { POSITION_NAMES } from "@/components/players/PlayersList";
import { useLocale } from "@/lib/i18n";

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export function HeroPlayerCard({ m, loading }: { m: HeroMoment; loading: boolean }) {
  const { t } = useLocale();
  const sub = !m ? (loading ? t.body.home.heroLoading : t.body.home.heroConfirmedOnly)
    : [m.position ? (POSITION_NAMES(t)[m.position] ?? m.position) : null, m.team].filter(Boolean).join(" · ") || (m.canonical_otsi_id ?? t.body.home.heroProvisional);
  const body = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-primary t-panel" style={{ color: "rgb(var(--primary-ink))" }}>
        {m ? (m.jersey_number ?? initials(m.display_name)) : "—"}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="t-panel truncate">{m ? m.display_name : t.body.home.heroNoPlayer}</span>
          {m && <Evidence level="CONFIRMED" compact size={11} why={t.body.home.kpiPlayersWhy} />}
        </span>
        <span className="t-small block truncate text-muted">{sub}</span>
      </span>
    </>
  );
  const cls = "flex w-[264px] items-center gap-2.5 rounded-md border border-line2 bg-p0/90 px-2.5 py-2 backdrop-blur";
  return m ? (
    <Link href={`/reports/players/${m.canonical_otsi_id ?? m.player_id}`} className={`${cls} hover:border-primary`} data-player={m.player_id}
      aria-label={t.body.home.heroPlayerAria.replace("{a}", m.display_name).replace("{b}", m.canonical_otsi_id ? t.body.home.heroPlayerAriaId.replace("{a}", m.canonical_otsi_id) : "")}>{body}</Link>
  ) : (
    <div className={cls} data-player="none">{body}</div>
  );
}
