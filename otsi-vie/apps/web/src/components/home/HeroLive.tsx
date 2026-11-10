"use client";
/**
 * Page 01 Section 02 — the hero's live picture (owner 2026-11-02: "use actual close-up images from real games ... to randomly fill all
 * fields in the hero"; "randomly update/refresh itself using each time random available data/players"). Every ROTATE_MS the engine
 * picks another player a person CONFIRMED and a moment of his own uploaded video where he is shown large (GET /v1/overview/hero-moment);
 * the hero shows that real frame, his box (blue) and the other people the engine detected (yellow, with a shirt number only from the
 * match sheet of a confirmed player), his card and his measured numbers. The next one is loaded behind the current one and swapped in
 * once its frame is ready. Nobody confirmed yet: the reference's empty illustration.
 */
import type { HeroMoment, Playback } from "@otsi-vie/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { B, u } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { HeroMetrics } from "./HeroMetrics";
import { HeroPlayerCard } from "./HeroPlayerCard";

const ROTATE_MS = 12_000;
/** the picture's place on the design: right of the headline, left of the featured reel */
const PIC = { x: 905, y: 101, w: 1070, h: 500 };
/** the reference's empty detection frames (box x, y, w, h and its tag x, y, w), shown until a player is confirmed */
const FRAMES: [number, number, number, number, number, number, number][] = [
  [967, 376, 109, 198, 992, 345, 46], [1118, 417, 78, 145, 1137, 388, 35], [1782, 398, 84, 166, 1797, 367, 48],
];

interface Shot { m: NonNullable<HeroMoment>; url: string }

/** a close-up: the frame zoomed so that he stands about half the picture's height (at most 3x, to stay sharp), centred on him */
function layout(s: Shot) {
  const ar = s.m.width && s.m.height ? s.m.width / s.m.height : 16 / 9;
  const w0 = Math.max(PIC.w, PIC.h * ar);
  const me = s.m.boxes.find((b) => b.me);
  const z = me ? Math.min(3, Math.max(1, (PIC.h * 0.5) / (me.h * (w0 / ar)))) : 1;
  const w = w0 * z, h = w / ar;
  const cx = me ? (me.x + me.w / 2) * w : w / 2, cy = me ? (me.y + me.h / 2) * h : h / 2;
  const left = -Math.min(Math.max(cx - PIC.w * 0.42, 0), w - PIC.w);
  const top = -Math.min(Math.max(cy - PIC.h * 0.58, 0), h - PIC.h);
  return { w, h, left, top };
}

function Picture({ s, shown, onReady }: { s: Shot; shown: boolean; onReady: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  // the close-up crop depends only on this shot: derive it once, not on every re-render of the rotating hero
  const { w, h, left, top } = useMemo(() => layout(s), [s]);
  return (
    <div aria-hidden className="absolute" style={{ inset: 0, opacity: shown ? 1 : 0, transition: "opacity .9s ease" }}>
      <div className="absolute" style={{ left: u(left), top: u(top), width: u(w), height: u(h) }}>
        <video ref={ref} src={s.url} muted playsInline preload="auto" disablePictureInPicture
          onLoadedMetadata={() => { if (ref.current) ref.current.currentTime = s.m.pts_us / 1e6; }} onSeeked={onReady}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill" }} />
        {s.m.boxes.map((b, i) => (
          <div key={i} className="absolute" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`,
            border: `${u(b.me ? 3 : 2.5)} solid ${b.me ? "#33a8ff" : "#f5b82e"}`, background: b.me ? "rgba(51,168,255,.08)" : "rgba(245,184,46,.05)",
            boxShadow: b.me ? `0 0 ${u(18)} #1e90ff` : undefined }}>
            {(b.me ? s.m.jersey_number : b.number) !== null && (
              <span style={{ position: "absolute", left: "50%", bottom: "100%", transform: `translate(-50%, -${u(4)})`, padding: `0 ${u(6)}`, minWidth: u(30),
                textAlign: "center", fontSize: u(20), fontWeight: 700, color: "#fff", background: "#0a0a05", border: `${u(2)} solid ${b.me ? "#33a8ff" : "#f5b82e"}` }}>
                {b.me ? s.m.jersey_number : b.number}
              </span>
            )}
            {b.me && <span style={{ position: "absolute", left: "-30%", right: "-30%", bottom: `-${u(12)}`, height: u(24), borderRadius: "50%",
              border: `${u(3)} solid #33a8ff`, boxShadow: `0 0 ${u(18)} #1e90ff` }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HeroLive() {
  const [cur, setCur] = useState<Shot | null | undefined>(undefined);      // undefined = loading, null = nobody confirmed yet
  const [next, setNext] = useState<Shot | null>(null);
  const curRef = useRef<Shot | null | undefined>(undefined);
  // the loader reads the current shot: keep the ref in step in an effect, never as a side effect of rendering
  useEffect(() => { curRef.current = cur; }, [cur]);

  useEffect(() => {
    let live = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const m = await api<HeroMoment>("/v1/overview/hero-moment");
        if (!live) return;
        if (!m) { if (curRef.current === undefined) setCur(null); return; }
        const pb = await api<Playback>(`/v1/videos/${m.video_id}/playback`);
        if (!live) return;
        if (pb.available && pb.url) setNext({ m, url: pb.url });
        else if (curRef.current === undefined) setCur(null);
      } catch { if (live && curRef.current === undefined) setCur(null); }
    };
    void load();
    const t = setInterval(() => void load(), ROTATE_MS);
    // coming back to a tab that was hidden: refresh at once instead of waiting out the rest of the rotation interval
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { live = false; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const swap = () => { if (next) { setCur(next); setNext(null); } };
  const m = cur?.m ?? null;

  return (
    <>
      <div data-hero-picture={m ? `${m.player_id}@${m.pts_us}` : cur === null ? "none" : "loading"} className="absolute"
        style={{ left: u(PIC.x), top: u(PIC.y - 101), width: u(PIC.w), height: u(PIC.h), overflow: "hidden",
          maskImage: "linear-gradient(90deg,transparent 0,#000 14%,#000 90%,transparent 100%)", WebkitMaskImage: "linear-gradient(90deg,transparent 0,#000 14%,#000 90%,transparent 100%)" }}>
        {cur && <Picture key={`${cur.m.video_id}-${cur.m.pts_us}`} s={cur} shown onReady={() => undefined} />}
        {next && <Picture key={`${next.m.video_id}-${next.m.pts_us}`} s={next} shown={false} onReady={swap} />}
      </div>
      {!m && (
        <>
          <B x={1180} y={200} w={380} h={420} style={{ background: "radial-gradient(ellipse at 50% 40%,#5aa8ec 0,#2a6fb8 35%,transparent 70%)" }} />
          {FRAMES.map(([x, y, w, h, tx, ty, tw]) => (
            <div key={x}>
              <B x={x} y={y} w={w} h={h} style={{ border: `${u(3)} solid #f5b82e`, background: "rgba(245,184,46,.06)" }} />
              <B x={tx} y={ty} w={tw} h={31} style={{ background: "#0a0a05", border: `${u(2)} solid #f5b82e` }} />
            </div>
          ))}
          <B x={1170} y={568} w={250} h={26} style={{ border: `${u(3)} solid #33a8ff`, borderRadius: "50%", boxShadow: `0 0 ${u(18)} #1e90ff` }} />
        </>
      )}
      <HeroPlayerCard m={m} loading={cur === undefined} />
      <B x={1470} y={170} w={298} h={228} style={{ background: "rgba(6,30,66,.75)", border: `${u(2)} solid #1e90ff`, borderRadius: u(6) }} />
      <HeroMetrics playerId={m?.player_id ?? null} />
    </>
  );
}
