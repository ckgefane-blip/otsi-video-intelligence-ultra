"use client";
/**
 * Home hero — the live picture (owner 2026-11-02: "use actual close-up images from real games ... randomly update/refresh itself using
 * each time random available data/players"; owner 2026-11-11: a live picture, not a player, no controls). Every ROTATE_MS (12 s) the
 * engine picks another player a person CONFIRMED and a moment of his own uploaded video where he is shown large
 * (GET /v1/overview/hero-moment); the hero shows that real frame — a <video> seeked to one frame, never played — his box (primary) and
 * the other people the engine detected (amber, with a shirt number only from the match sheet of a confirmed player), his card and his
 * measured numbers. The next one is loaded behind the current one and swapped in once its frame is ready.
 * Nobody confirmed yet (or no playable footage): an honest empty picture that says what to do — never a stand-in clip; the onboarding
 * clips in public/onboarding are not match footage and are never used here.
 *
 * Desktop UI (Drop 1): the same data logic, laid out in the page's flow. The crop is computed from the picture's measured size.
 */
import type { HeroMoment, Playback } from "@otsi-vie/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { HeroMetrics } from "./HeroMetrics";
import { HeroPlayerCard } from "./HeroPlayerCard";

export const ROTATE_MS = 12_000;

interface Shot { m: NonNullable<HeroMoment>; url: string }
interface Size { w: number; h: number }

/** a close-up: the frame zoomed so that he stands about half the picture's height (at most 3x, to stay sharp), centred on him */
export function layout(s: Shot, pic: Size) {
  const ar = s.m.width && s.m.height ? s.m.width / s.m.height : 16 / 9;
  const w0 = Math.max(pic.w, pic.h * ar);
  const me = s.m.boxes.find((b) => b.me);
  const z = me ? Math.min(3, Math.max(1, (pic.h * 0.5) / (me.h * (w0 / ar)))) : 1;
  const w = w0 * z, h = w / ar;
  const cx = me ? (me.x + me.w / 2) * w : w / 2, cy = me ? (me.y + me.h / 2) * h : h / 2;
  const left = -Math.min(Math.max(cx - pic.w * 0.42, 0), w - pic.w);
  const top = -Math.min(Math.max(cy - pic.h * 0.58, 0), h - pic.h);
  return { w, h, left, top };
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function Picture({ s, pic, shown, onReady }: { s: Shot; pic: Size; shown: boolean; onReady: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const { w, h, left, top } = useMemo(() => layout(s, pic), [s, pic]);
  return (
    <div aria-hidden className="absolute inset-0 transition-opacity duration-700" style={{ opacity: shown ? 1 : 0 }}>
      <div className="absolute" style={{ left, top, width: w, height: h }}>
        <video ref={ref} src={s.url} muted playsInline preload="auto" disablePictureInPicture
          onLoadedMetadata={() => { if (ref.current) ref.current.currentTime = s.m.pts_us / 1e6; }} onSeeked={onReady}
          className="absolute inset-0 h-full w-full" style={{ objectFit: "fill" }} />
        {s.m.boxes.map((b, i) => {
          const n = b.me ? s.m.jersey_number : b.number;
          return (
            <div key={i} className="absolute" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`,
              border: `${b.me ? 2 : 1.5}px solid ${b.me ? "rgb(var(--primary))" : "rgb(var(--amber))"}`, background: b.me ? "rgb(var(--primary) / .08)" : undefined }}>
              {n !== null && (
                <span className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 rounded-sm px-1 text-[11px] font-normal leading-4"
                  style={{ background: b.me ? "rgb(var(--primary))" : "rgb(var(--amber))", color: "rgb(var(--primary-ink))" }}>{n}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function HeroLive() {
  const { t } = useLocale();
  const [cur, setCur] = useState<Shot | null | undefined>(undefined);      // undefined = loading, null = nobody confirmed yet
  const [next, setNext] = useState<Shot | null>(null);
  const curRef = useRef<Shot | null | undefined>(undefined);
  useEffect(() => { curRef.current = cur; }, [cur]);
  const [box, pic] = useSize<HTMLDivElement>();

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
    const timer = setInterval(() => void load(), ROTATE_MS);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const swap = () => { if (next) { setCur(next); setNext(null); } };
  const m = cur?.m ?? null;

  return (
    <div ref={box} role="img" aria-label={t.desktop.heroLiveAria} className="relative h-full min-h-[320px] overflow-hidden rounded-md border border-line bg-p0"
      data-hero-picture={m ? `${m.player_id}@${m.pts_us}` : cur === null ? "none" : "loading"}>
      {pic.w > 0 && cur && <Picture key={`${cur.m.video_id}-${cur.m.pts_us}`} s={cur} pic={pic} shown onReady={() => undefined} />}
      {pic.w > 0 && next && <Picture key={`${next.m.video_id}-${next.m.pts_us}`} s={next} pic={pic} shown={false} onReady={swap} />}
      {!m && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <p className="t-small max-w-[360px] text-muted">{cur === undefined ? t.common.loading : t.desktop.heroNoFrames}</p>
        </div>
      )}
      <div className="absolute left-3 top-3"><HeroPlayerCard m={m} loading={cur === undefined} /></div>
      <div className="absolute bottom-3 right-3 w-[236px]"><HeroMetrics playerId={m?.player_id ?? null} /></div>
    </div>
  );
}
