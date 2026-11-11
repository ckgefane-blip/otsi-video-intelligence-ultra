"use client";
/**
 * Page 01 Section 07 — Sample Reels (approved reference 01_HOME_OVERVIEW, "sample reels").
 *
 * Real data only: the organization's three most recently rendered reels (a finished render with a file). Title = the reel's player,
 * subtitle = the reel's name, duration = the rendered length. Play streams the MP4 inline through the signed media gateway. Views,
 * likes and saving are not recorded yet, so they show "—" and the bookmark is disabled with its reason. The three dots (MoreMenu) open the
 * reel in each editor, export it, download the MP4 or copy its link; View All opens the Library. With no rendered reel: the reference's empty state.
 * A failed read is not that empty state: the first card says the reels could not be read, and its subtitle retries the read.
 */
import type { Reel } from "@otsi-vie/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MoreMenu } from "@/components/stage/MoreMenu";
import { reelActions } from "@/lib/actions";
import { ACC, B, Ic, P, T, stageStyles as s, u } from "@/components/stage/DesignStage";
import { mmss, playback, Playback, reelSeconds, reloadRenderedReels, useRenderedReels } from "./renderedReels";
import { useLocale } from "@/lib/i18n";

/** card x and the drawn placeholder's first gradient colour (reference PH) */
const CARDS: [number, string][] = [[867, "#27487a"], [1185, "#4a2a30"], [1502, "#4a1a28"]];

const plain = { position: "absolute" as const, padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit" };

function ReelCard({ x, tone, reel, empty, failed }: { x: number; tone: string; reel: Reel | undefined; empty: boolean; failed: boolean }) {
  const { t } = useLocale();
  const [play, setPlay] = useState<Playback | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (msg: string) => { setNote(msg); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNote(null), 2000); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const get = async () => play ?? await playback(reel!);
  const title = reel ? (reel.player?.display_name ?? reel.name) : failed ? t.body.home.couldntLoadReels : empty ? t.body.home.noReelsYet : "—";
  const sub = reel ? reel.name : failed ? t.body.home.tapRetry : empty ? t.body.home.reelsAppearHere : "—";

  return (
    <div role="group" aria-label={reel ? `Reel: ${title}, ${sub}` : title} data-reel={reel?.id ?? "none"}>
      <B x={x - 1} y={816} w={300} h={335} style={{ background: "#06142a", border: `${u(1.5)} solid #12335f`, borderRadius: u(10) }} />
      <B x={x} y={817} w={298} h={189} style={{
        background: `radial-gradient(ellipse at 45% 40%,#e0b090 0,#c98c6a 7%,transparent 8%),radial-gradient(ellipse at 50% 100%,#6fb8ee 0,#2a6fb8 35%,transparent 70%),linear-gradient(135deg,${tone},#0e2040)`,
        borderRadius: u(6), overflow: "hidden" }}>
        {play && <video src={play.url} controls autoPlay playsInline aria-label={`Reel: ${title}`}
          style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000", display: "block" }} />}
      </B>
      {!play && (
        <>
          <button type="button" disabled={!reel} aria-label={reel ? `Play ${title}` : "No reel to play"}
            onClick={() => void get().then(setPlay, () => flash("Playback unavailable"))}
            style={{ ...plain, left: u(x + 148 - 31), top: u(911 - 101 - 31), width: u(62), height: u(62), borderRadius: "50%",
              background: "rgba(10,20,40,.65)", border: `${u(2)} solid rgba(255,255,255,.35)`, cursor: reel ? "pointer" : "default" }}>
            <span style={{ position: "absolute", left: u(31 - 31 * 0.22 - 2), top: u(31 - 31 * 0.4 - 2), width: u(31 * 0.7), height: u(31 * 0.8),
              background: "#fff", clipPath: "polygon(0 0,100% 50%,0 100%)" }} />
          </button>
          <B x={x + 216} y={970} w={70} h={28} style={{ background: "rgba(0,10,25,.85)", borderRadius: u(5) }} />
          <T x={x + 251} y={984} size={19} weight={600} align="center">{reel ? mmss(reelSeconds(reel)) : "—"}</T>
        </>
      )}
      {reel ? (
        <Link href={`/reels/${reel.id}`} className={s.cta} style={{ left: u(x + 8), top: u(1015 - 101), width: u(282), height: u(30) }}>
          <T o={[x + 8, 1015]} x={x + 8} y={1030} size={23} weight={600} as="span" style={{ maxWidth: u(280), overflow: "hidden", textOverflow: "ellipsis" }}>{title}</T>
        </Link>
      ) : (
        <T x={x + 8} y={1030} size={23} weight={600}>{title}</T>
      )}
      {failed ? (
        <button type="button" onClick={() => reloadRenderedReels()} aria-label={t.body.home.reelsReadFailed}
          style={{ position: "absolute", left: u(x + 8), top: u(1058 - 101), transform: "translateY(-50%)", padding: 0, border: 0,
            background: "transparent", color: "#33a8ff", fontSize: u(20), fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            maxWidth: u(280), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</button>
      ) : (
        <T x={x + 8} y={1058} size={20} color="#9fb3cc" style={{ maxWidth: u(280), overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</T>
      )}

      <Ic x={x + 22} y={1112} k="eye" size={30} />
      <T x={x + 52} y={1112} size={21}>—</T>
      <Ic x={x + 140} y={1112} k="heart" size={30} />
      <T x={x + 168} y={1112} size={21}>—</T>
      <button type="button" disabled aria-label="Save reel (not available yet)" title="Saving reels is not available yet"
        style={{ ...plain, left: u(x + 250 - 16), top: u(1112 - 101 - 16), width: u(32), height: u(32), cursor: "default" }}>
        <Ic o={[x + 234, 1096]} x={x + 250} y={1112} k="bm" size={24} />
      </button>
      <MoreMenu x={x + 281} y={1112} w={30} h={36} size={22} color="#fff" label="More reel actions" items={reel ? reelActions(reel) : []}
        empty={empty ? "No finished reel yet: make one in the Reel Builder" : "No reel in this slot yet"} />
      {note && <T x={x + 148} y={1085} size={18} color="#33a8ff" align="center">{note}</T>}
    </div>
  );
}

export function SampleReels() {
  const { t } = useLocale();
  const reels = useRenderedReels();
  const failed = reels === null;                                               // a failed read, not "no reels yet"
  const empty = reels !== undefined && !failed && reels.length === 0;
  return (
    <section aria-label="Sample reels gallery" data-section="p01-s07" data-count={reels ? String(Math.min(3, reels.length)) : reels === null ? "error" : "loading"}>
      <P x={850} y={757} w={968} h={405} />
      <ACC x={866} y={771} h={26} />
      <T x={891} y={783} size={27} weight={600} as="h2">{t.body.home.sampleReels}</T>
      <Link href="/library" className={s.cta} aria-label="View all reels in the Library"
        style={{ left: u(1658), top: u(770 - 101), width: u(124), height: u(34) }}>
        <T o={[1658, 770]} x={1752} y={786} size={21} color="#33a8ff" align="right" as="span">{t.body.home.viewAll}</T>
        <Ic o={[1658, 770]} x={1767} y={786} k="arr" size={20} color="#33a8ff" />
      </Link>
      {CARDS.map(([x, tone], i) => <ReelCard key={x} x={x} tone={tone} reel={reels?.[i]} empty={empty && i === 0} failed={failed && i === 0} />)}
    </section>
  );
}
