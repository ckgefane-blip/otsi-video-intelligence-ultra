"use client";
/**
 * Page 01 Section 02 — the hero's player card: the player in the hero picture (HeroLive: a random player a person CONFIRMED), with his
 * shirt number from the match sheet (else initials), name and position · team (else his OTSI Player ID); it opens his report. Until a
 * person confirms one: "— / No player selected / Confirmed players only", exactly as the reference. Never an unconfirmed track.
 */
import type { HeroMoment } from "@otsi-vie/contracts";
import Link from "next/link";
import { POSITION_NAMES } from "@/components/players/PlayersList";
import { B, T, stageStyles as s, u } from "@/components/stage/DesignStage";

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export function HeroPlayerCard({ m, loading }: { m: HeroMoment; loading: boolean }) {
  const sub = !m ? (loading ? "Loading…" : "Confirmed players only")
    : [m.position ? (POSITION_NAMES[m.position as keyof typeof POSITION_NAMES] ?? m.position) : null, m.team].filter(Boolean).join(" · ") || (m.canonical_otsi_id ?? "Confirmed · provisional");
  const body = (
    <>
      <B o={[1123, 130]} x={1135} y={140} w={47} h={48} style={{ background: "#1e90ff", borderRadius: u(4) }} />
      <T o={[1123, 130]} x={1158} y={164} size={m ? (m.jersey_number !== null ? 26 : 22) : 28} weight={700} align="center" as="span">
        {m ? (m.jersey_number ?? initials(m.display_name)) : "—"}
      </T>
      <T o={[1123, 130]} x={1195} y={159} size={24} weight={700} as="span" style={{ maxWidth: u(220), overflow: "hidden", textOverflow: "ellipsis" }}>
        {m ? m.display_name : "No player selected"}
      </T>
      <T o={[1123, 130]} x={1195} y={185} size={17} color="#33a8ff" as="span" style={{ maxWidth: u(220), overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</T>
    </>
  );
  const box = { left: u(1123), top: u(130 - 101), width: u(304), height: u(75), background: "rgba(6,30,66,.8)", borderRadius: u(6), ["--bc" as string]: "#1e90ff", ["--bw" as string]: 2 };
  return m ? (
    <Link href={`/reports/players/${m.canonical_otsi_id ?? m.player_id}`} className={`${s.cta} ${s.framed}`} style={box} data-player={m.player_id}
      aria-label={`Player in the picture: ${m.display_name}${m.canonical_otsi_id ? `, ${m.canonical_otsi_id}` : ""}. Open the player report`}>{body}</Link>
  ) : (
    <div className={`${s.a} ${s.framed}`} style={box} data-player="none">{body}</div>
  );
}
