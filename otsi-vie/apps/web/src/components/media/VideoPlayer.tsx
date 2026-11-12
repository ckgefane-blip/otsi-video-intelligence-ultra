"use client";
/**
 * The one video player of the Desktop UI: every page that plays footage or a reel uses it. It plays only what it is given — a signed
 * address from the API (match footage: GET /v1/videos/:id/playback; a reel: GET /v1/renders/:id/playback) or a file the person opens from
 * this computer — and never a stand-in clip. With nothing to play it shows the honest empty state and, where allowed, "Open local footage".
 *
 * Controls: play / pause, back and forward one second, a scrubber that seeks while dragged, the time, playback speed, fullscreen.
 * Keys while the player has focus: Space or K play/pause, J / L one second back / forward, F fullscreen. `children` draws over the picture
 * (the overlays) and gets nothing it did not measure: the overlay layer reads its own tracks.
 */
import { Maximize2, Minimize2, Pause, Play, SkipBack, SkipForward, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocale } from "@/lib/i18n";

export const clock = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const t = Math.floor(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};
const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

export interface VideoPlayerProps {
  /** a signed address; null = nothing to play (the empty state); undefined = still reading */
  src: string | null | undefined;
  label: string;
  /** offer "Open local footage" in the empty state (match footage pages; not reels) */
  allowLocal?: boolean;
  /** an empty state of the caller's own (e.g. "No reel in this slot") */
  empty?: { title: string; body: string } | undefined;
  aspect?: string;
  autoPlay?: boolean;
  /** start at this second */
  startAt?: number | undefined;
  onTime?: ((t: number) => void) | undefined;
  children?: ReactNode;
  className?: string;
  /** an outside ref that also receives the <video> element (the Analysis workspace drives its boxes and seeking from it) */
  videoRef?: React.MutableRefObject<HTMLVideoElement | null> | undefined;
  /** play only this part of the file (a clip's in / out, microseconds): it starts at `inUs`, stops at `outUs`, and the scrubber and
   *  time cover just that part (the Reel Builder previews one clip of the source this way). Not applied to a file opened locally. */
  range?: { inUs: number; outUs: number } | null | undefined;
  onPlayingChange?: ((playing: boolean) => void) | undefined;
  /** applied to the picture and its overlays together (the Analysis workspace's zoom) */
  pictureStyle?: CSSProperties | undefined;
  /** false: the page handles Space / J K L / arrows itself, so the player does not act on them twice */
  keys?: boolean;
  muted?: boolean;
}

export function VideoPlayer({ src, label, allowLocal = false, empty, aspect = "16 / 9", autoPlay = false, startAt, onTime, children, className = "", videoRef, range, onPlayingChange, pictureStyle, keys = true, muted }: VideoPlayerProps) {
  const { t } = useLocale();
  const d = t.desktop;
  const wrap = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [full, setFull] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = local ?? src ?? null;
  const span = range && !local ? { a: range.inUs / 1e6, b: range.outUs / 1e6 } : null;
  const spanKey = span ? `${span.a}-${span.b}` : "";
  // a new range on the same file: go to its start, paused
  useEffect(() => { const v = vid.current; if (v && span && v.readyState >= 1) { v.pause(); v.currentTime = span.a; setTime(span.a); } }, [spanKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (local) URL.revokeObjectURL(local); }, [local]);
  useEffect(() => { setFailed(false); setTime(0); setDur(0); setPlaying(false); }, [url]);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const lo = span?.a ?? 0, hi = span?.b ?? dur;
  const toggle = useCallback(() => {
    const v = vid.current; if (!v) return;
    if (v.paused) { if (span && v.currentTime >= span.b - 0.05) v.currentTime = span.a; void v.play().catch(() => setFailed(true)); } else v.pause();
  }, [spanKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const nudge = (s: number) => { const v = vid.current; if (v) v.currentTime = Math.max(lo, Math.min(hi || v.duration || 0, v.currentTime + s)); };
  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void wrap.current?.requestFullscreen?.(); };
  const key = (e: React.KeyboardEvent) => {
    if (!keys) return;
    if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
    if (e.key === " " || e.key === "k") { e.preventDefault(); toggle(); }
    else if (e.key === "j" || e.key === "ArrowLeft") nudge(-1);
    else if (e.key === "l" || e.key === "ArrowRight") nudge(1);
    else if (e.key === "f") fullscreen();
  };

  const showEmpty = !url || failed;
  return (
    <div ref={wrap} className={`relative overflow-hidden rounded-md border border-line bg-black ${className}`} style={{ aspectRatio: full ? undefined : aspect }}
      tabIndex={showEmpty ? -1 : 0} onKeyDown={key} aria-label={label} role="region" data-player={showEmpty ? "empty" : "ready"}>
      {url && !failed && (
        // the picture and its overlays share one box with the video's own shape, so an overlay drawn at x% lands on the same pixel, in full screen too
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="relative h-full max-w-full" style={{ aspectRatio: aspect, ...pictureStyle }} data-player-picture>
        <video ref={(el) => { vid.current = el; if (videoRef) videoRef.current = el; }} key={url} src={url} playsInline preload="metadata" autoPlay={autoPlay} muted={muted} className="absolute inset-0 h-full w-full object-contain"
          onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
          onClick={toggle} onPlay={() => { setPlaying(true); onPlayingChange?.(true); }} onPause={() => { setPlaying(false); onPlayingChange?.(false); }} onError={() => setFailed(true)}
          onLoadedMetadata={(e) => { setDur(e.currentTarget.duration); if (span) e.currentTarget.currentTime = span.a; else if (startAt) e.currentTarget.currentTime = startAt; }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (span && v.currentTime >= span.b) { v.pause(); v.currentTime = span.b; }
            setTime(v.currentTime); onTime?.(v.currentTime);
          }} />
        {children ? <div className="pointer-events-none absolute inset-0">{children}</div> : null}
        </div>
        </div>
      )}

      {showEmpty && (
        <div className="absolute inset-0 grid place-items-center bg-p0 p-6 text-center" data-player-empty>
          {src === undefined && !local ? <span className="t-small text-muted">{t.common.loading}</span> : (
            <div className="max-w-[420px]">
              <p className="t-panel">{failed ? d.playbackUnavailable : empty?.title ?? d.noFootageTitle}</p>
              <p className="t-small mt-1 text-muted">{failed ? "" : empty?.body ?? d.noFootageBody}</p>
              {allowLocal && (
                <label className="vie-btn mt-3 cursor-pointer">
                  <Upload className="h-4 w-4" aria-hidden />{d.openLocal}
                  <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="sr-only"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) setLocal(URL.createObjectURL(f)); e.target.value = ""; }} />
                </label>
              )}
            </div>
          )}
        </div>
      )}

      {!showEmpty && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-6 text-ink" data-player-controls>
          <button type="button" className="vie-ib h-8 w-8" aria-label={playing ? d.pause : d.play} onClick={toggle}>
            {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          </button>
          <button type="button" className="vie-ib h-8 w-8" aria-label={d.back1} onClick={() => nudge(-1)}><SkipBack className="h-4 w-4" aria-hidden /></button>
          <button type="button" className="vie-ib h-8 w-8" aria-label={d.fwd1} onClick={() => nudge(1)}><SkipForward className="h-4 w-4" aria-hidden /></button>
          <span className="t-tc w-[52px] text-right">{clock(time - lo)}</span>
          <input type="range" className="vie-range mx-2 flex-1" min={lo} max={hi || 0} step={0.04} value={Math.max(lo, Math.min(time, hi || 0))} aria-label={d.seek}
            aria-valuetext={`${clock(time - lo)} / ${clock(hi - lo)}`}
            onChange={(e) => { const v = vid.current; const s = Number(e.target.value); setTime(s); if (v) v.currentTime = s; }} />
          <span className="t-tc w-[52px] text-muted">{clock(hi - lo)}</span>
          <select aria-label={d.speed} value={speed} className="h-7 rounded border border-line2 bg-raised px-1 t-small"
            onChange={(e) => { const s = Number(e.target.value); setSpeed(s); if (vid.current) vid.current.playbackRate = s; }}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
          <button type="button" className="vie-ib h-8 w-8" aria-label={full ? d.exitFullscreen : d.fullscreen} onClick={fullscreen}>
            {full ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      )}
    </div>
  );
}
