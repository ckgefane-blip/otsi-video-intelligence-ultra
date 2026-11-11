"use client";
/**
 * Page 01 Section 06 — Recent Matches (approved reference 01_HOME_OVERVIEW, "recent matches").
 *
 * Real data only: the four most recently analysed match videos (GET /v1/overview/recent-matches: a finished analysis run). A row shows
 * the linked match (home vs away, competition, kick-off date, score) when someone linked one, otherwise the video's own title and
 * "Not linked to a match". The score is shown only when both scores were recorded. No club crests are stored, so the crest stays the
 * design's neutral disc. A row opens the video in the Analysis workspace; View All opens the Library. With nothing analysed: the
 * reference's empty state.
 */
import type { RecentMatch } from "@otsi-vie/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, apiBlob } from "@/lib/api";
import { ACC, B, Ic, P, T, stageStyles as s, u } from "@/components/stage/DesignStage";
import { useLocale } from "@/lib/i18n";

const ROWS = [855, 939, 1024, 1110];

/** clock of a duration: m:ss, or minutes past the hour as mmm:ss for a full match (94:12) */
const clock = (us: number | null) => {
  if (!us) return "—";
  const t = Math.round(us / 1e6);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);

function title(m: RecentMatch) {
  if (m.match) return `${m.match.home ?? "—"} vs ${m.match.away ?? "—"}`;
  return m.video_title ?? "Untitled video";
}
function subtitle(m: RecentMatch) {
  if (!m.match) return "Not linked to a match";
  return [m.match.competition, day(m.match.kickoff_at)].filter(Boolean).join(" • ") || "No competition or date yet (Upload › Set match details)";
}
const score = (m: RecentMatch) =>
  m.match && m.match.home_score !== null && m.match.away_score !== null ? `${m.match.home_score} - ${m.match.away_score}` : "—";

/** the reference's drawn thumbnail (TH): sky to pitch, used when the video has no thumbnail */
const pitch = (a: number) => `radial-gradient(ellipse at 40% 65%,#6fb8ee 0,#2a6fb8 12%,transparent 13%),linear-gradient(180deg,#27487a,#2d7a3a ${a}%,#1d5a28)`;

function Thumb({ m, a, o, y }: { m: RecentMatch | undefined; a: number; o: [number, number]; y: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!m?.has_thumbnail) return;
    let live = true, url: string | null = null;
    void apiBlob(`/v1/videos/${m.video_id}/thumbnail`).then((b) => { url = URL.createObjectURL(b); if (live) setSrc(url); }, () => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [m?.video_id, m?.has_thumbnail]);
  return (
    <B o={o} x={68} y={y - 35} w={157} h={70} style={{ background: src ? `center / cover no-repeat url(${src})` : pitch(a), borderRadius: u(4) }} />
  );
}

export function RecentMatches() {
  const { t } = useLocale();
  const [list, setList] = useState<RecentMatch[] | null | undefined>(undefined);   // undefined = loading, null = could not read
  const [reload, setReload] = useState(0);
  useEffect(() => { void api<RecentMatch[]>("/v1/overview/recent-matches").then(setList, () => setList(null)); }, [reload]);
  const failed = list === null;
  const empty = list !== undefined && !failed && list.length === 0;

  return (
    <section aria-label="Recent matches" data-section="p01-s06" data-count={list ? String(list.length) : list === null ? "error" : "loading"}>
      <P x={39} y={757} w={791} h={405} />
      <ACC x={55} y={771} h={26} />
      <T x={76} y={783} size={27} weight={600} as="h2">{t.body.home.recentMatches}</T>
      <Link href="/library" className={s.cta} aria-label="View all matches in the Library"
        style={{ left: u(680), top: u(770 - 101), width: u(124), height: u(34) }}>
        <T o={[680, 770]} x={774} y={786} size={21} color="#33a8ff" align="right" as="span">{t.body.home.viewAll}</T>
        <Ic o={[680, 770]} x={790} y={786} k="arr" size={20} color="#33a8ff" />
      </Link>

      {ROWS.map((y, i) => {
        const m = list?.[i];
        const o: [number, number] = [55, y - 39];
        const first = (empty || failed) && i === 0;
        const body = (
          <>
            <Thumb m={m} a={25 + i * 8} o={o} y={y} />
            <B o={o} x={168} y={y + 11} w={54} h={22} style={{ background: "rgba(0,10,25,.85)", borderRadius: u(4) }} />
            <T o={o} x={195} y={y + 22} size={19} weight={600} align="center" as="span">{m ? clock(m.duration_us) : "—"}</T>
            <B o={o} x={250} y={y - 20} w={40} h={40} style={{ background: "#e8eef8", borderRadius: "50%", opacity: 0.9 }} />
            <T o={o} x={319} y={y - 14} size={21} weight={600} as="span" style={{ maxWidth: u(370), overflow: "hidden", textOverflow: "ellipsis" }}>
              {m ? title(m) : failed ? t.body.home.matchesLoadFailed : first ? t.body.home.noMatchesYet : "—"}
            </T>
            <T o={o} x={319} y={y + 16} size={18} color="#b9cbe2" as="span" style={{ maxWidth: u(370), overflow: "hidden", textOverflow: "ellipsis" }}>
              {m ? subtitle(m) : failed ? t.body.home.tapRetry : first ? t.body.home.matchesListedHere : "—"}
            </T>
            <T o={o} x={737} y={y} size={26} weight={700} align="center" as="span">{m ? score(m) : "—"}</T>
            <Ic o={o} x={791} y={y} k="gt" size={20} color="#cfe0f5" />
          </>
        );
        const box = { left: u(55), top: u(y - 39 - 101), width: u(758), height: u(80), background: "#06142a", borderRadius: u(6), ["--bc" as string]: "#10294a" };
        // a failed read used to wear the empty state's words; now the first row says so and retries the read
        if (failed && i === 0) {
          return (
            <button key={y} type="button" className={`${s.cta} ${s.framed}`} style={{ ...box, padding: 0, cursor: "pointer", textAlign: "left" }}
              onClick={() => { setList(undefined); setReload((r) => r + 1); }}
              aria-label="Recent matches could not be read. Retry">{body}</button>
          );
        }
        return m ? (
          <Link key={y} href={`/videos/${m.video_id}/analyze`} className={`${s.cta} ${s.framed}`} style={box}
            aria-label={`${title(m)}, ${subtitle(m)}: open in the Analysis workspace`}>{body}</Link>
        ) : (
          <div key={y} className={`${s.a} ${s.framed}`} style={box} aria-hidden={!first}>{body}</div>
        );
      })}
    </section>
  );
}
