"use client";
/**
 * Page 01 Section 03 — Featured Reel (approved reference 01_HOME_OVERVIEW, right column of the hero band).
 *
 * Real data only: the organization's most recently completed reel render (GET /v1/reels, latest render SUCCEEDED with an output).
 * Reels have no tags, views or likes yet: the three chips show the reel's own recorded facts instead (clips, aspect, codec of the
 * rendered file), and views / likes stay "—". With no rendered reel the chips keep the design's empty values ("No tags", "—").
 * Play streams the rendered MP4 through the signed media gateway (GET /v1/renders/:id/playback); Share copies the reel's in-app link;
 * the three-dots menu (MoreMenu) opens the reel in each editor, exports, downloads the MP4 or copies its link. With no rendered reel: "No featured reel".
 * A failed read is not that empty state: it says the reels could not be read, and the subtitle retries the read (reloadRenderedReels).
 */
import type { Reel } from "@otsi-vie/contracts";
import { useEffect, useRef, useState } from "react";
import { B, Ic, T, u } from "@/components/stage/DesignStage";
import { MoreMenu } from "@/components/stage/MoreMenu";
import { reelActions } from "@/lib/actions";
import { mmss, playback as fetchPlayback, Playback, reelSeconds, reloadRenderedReels, useRenderedReels } from "./renderedReels";

/** the rendered file's video codec as the render was configured (H.264 / AV1 / VP9) */
const codec = (r: Reel) => String((r.last_good_render?.config as { codec?: string } | undefined)?.codec ?? "—").toUpperCase().replace("H264", "H.264");
const quality = (h: number | undefined) => (!h ? "—" : h >= 2160 ? "4K" : h >= 1440 ? "QHD" : h >= 1080 ? "HD" : "SD");

const chip = { background: "#0a2447", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(6) };
const iconButton = { position: "absolute" as const, padding: 0, border: 0, background: "transparent", color: "inherit", cursor: "pointer", font: "inherit" };

export function FeaturedReel() {
  const reels = useRenderedReels();
  const reel = reels === undefined ? undefined : (reels?.[0] ?? null);        // undefined = loading
  const failed = reels === null;                                               // a failed read, not "no featured reel"
  const [play, setPlay] = useState<Playback | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playback = async (): Promise<Playback> => play ?? await fetchPlayback(reel!);
  const flash = (t: string) => { setNote(t); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNote(null), 2000); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const result = (reel?.last_good_render?.result ?? {}) as { height?: number };
  const seconds = reel ? reelSeconds(reel) : 0;

  return (
    <section aria-label="Featured reel" data-section="p01-s03" data-featured={reel ? reel.id : reel === null ? "none" : "loading"}>
      <B x={1990} y={130} w={532} h={444} style={{ background: "rgba(5,16,36,.82)", border: `${u(1.5)} solid #12335f`, borderRadius: u(14) }} />
      <B x={2010} y={150} w={495} h={295} style={{
        background: "radial-gradient(ellipse at 66% 40%,#e0b090 0,#c98c6a 5%,transparent 6%),radial-gradient(ellipse at 66% 95%,#6fb8ee 0,#2a6fb8 35%,transparent 70%),linear-gradient(135deg,#27487a,#0e2040)",
        borderRadius: u(8), overflow: "hidden" }}>
        {play && (
          <video src={play.url} controls autoPlay playsInline aria-label={`Featured reel: ${reel?.name ?? ""}`}
            style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000", display: "block" }} />
        )}
      </B>
      {!play && (
        <>
          <T x={2025} y={163} size={22} weight={600} ls={3} color="#33a8ff">FEATURED REEL</T>
          <B x={2454} y={148} w={45} h={34} style={{ background: "#0a0a05", border: `${u(2)} solid #f5b82e`, borderRadius: u(4) }} />
          <T x={2476} y={165} size={20} weight={700} color="#f5b82e" align="center">{reel ? quality(result.height) : "—"}</T>

          <button type="button" aria-label={reel ? `Play ${reel.name}` : "No featured reel to play"} disabled={!reel}
            onClick={() => void playback().then(setPlay, () => flash("Playback unavailable"))}
            style={{ ...iconButton, left: u(2255 - 46), top: u(292 - 101 - 46), width: u(92), height: u(92), borderRadius: "50%",
              background: "rgba(10,20,40,.65)", border: `${u(2)} solid rgba(255,255,255,.35)`, cursor: reel ? "pointer" : "default" }}>
            <span style={{ position: "absolute", left: u(46 - 46 * 0.22 - 2), top: u(46 - 46 * 0.4 - 2), width: u(46 * 0.7), height: u(46 * 0.8),
              background: "#fff", clipPath: "polygon(0 0,100% 50%,0 100%)" }} />
          </button>

          <T x={2025} y={381} size={32} weight={700} style={{ maxWidth: u(380), overflow: "hidden", textOverflow: "ellipsis" }}>
            {reel ? (reel.player?.display_name ?? reel.name) : failed ? "Couldn't load reels" : reel === null ? "No featured reel" : ""}
          </T>
          {failed ? (
            <button type="button" onClick={() => reloadRenderedReels()} aria-label="Reels could not be read. Retry"
              style={{ position: "absolute", left: u(2025), top: u(414 - 101), transform: "translateY(-50%)", padding: 0, border: 0,
                background: "transparent", color: "#33a8ff", fontSize: u(25), fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                maxWidth: u(380), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Couldn't load reels — tap to retry
            </button>
          ) : (
            <T x={2025} y={414} size={25} color="#e3eefb" style={{ maxWidth: u(380), overflow: "hidden", textOverflow: "ellipsis" }}>
              {reel ? reel.name : reel === null ? "Published reels appear here" : ""}
            </T>
          )}
          <B x={2417} y={395} w={74} h={34} style={{ background: "rgba(0,10,25,.85)", borderRadius: u(6) }} />
          <T x={2454} y={412} size={22} weight={600} align="center">{reel ? mmss(seconds) : "—"}</T>
        </>
      )}

      {/* fact chips: clips, aspect, codec of the rendered file (reels have no tags yet) */}
      {([[reel ? `${reel.clips.length} clip${reel.clips.length === 1 ? "" : "s"}` : "No tags", 2024, 177],
        [reel ? reel.aspect : "—", 2216, 117],
        [reel ? codec(reel) : "—", 2349, 88]] as const).map(([t, x, w]) => (
        <div key={x}>
          <B x={x} y={447} w={w} h={43} style={chip} />
          <T x={x + w / 2} y={469} size={19} color="#cfe0f5" align="center">{t}</T>
        </div>
      ))}

      {/* engagement: views and likes are not recorded; Share copies the in-app link; three dots: the reel actions */}
      <Ic x={2033} y={542} k="eye" size={34} />
      <T x={2060} y={543} size={23}>—</T>
      <Ic x={2177} y={542} k="heart" size={34} />
      <T x={2204} y={543} size={23}>—</T>
      <button type="button" disabled={!reel} aria-label="Share: copy the reel's link"
        onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/reels/${reel!.id}`).then(() => flash("Link copied"), () => flash("Copy failed")); }}
        style={{ ...iconButton, left: u(2320), top: u(542 - 101 - 22), width: u(108), height: u(44), cursor: reel ? "pointer" : "default" }}>
        <Ic o={[2320, 520]} x={2341} y={542} k="share" size={32} />
        <T o={[2320, 520]} x={2370} y={543} size={23} as="span">Share</T>
      </button>
      <MoreMenu x={2486} y={542} w={40} h={44} size={30} color="#fff" label="More reel actions" items={reel ? reelActions(reel) : []}
        empty="No finished reel yet: make one in the Reel Builder" />
      {note && <T x={2256} y={588} size={18} color="#33a8ff" align="center">{note}</T>}
    </section>
  );
}
