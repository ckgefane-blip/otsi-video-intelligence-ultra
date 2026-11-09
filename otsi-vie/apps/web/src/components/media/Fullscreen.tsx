"use client";
/**
 * ADR-079: one full screen for every video player in the app (Clip Studio, Reel Builder, Export, Processing, Analysis, Tactical).
 *
 * Why not element.requestFullscreen(): the players' frames are sized in design units, so in full screen the picture and its overlays kept
 * their small size, the play / seek / exit controls (outside the frame) were gone, and where the browser holds the request (the desktop
 * app's pane) nothing happened at all. Instead the player's frame is a <dialog> that is opened modal: the top layer, above the page, filling
 * the window, with the same <video> (playback goes on) and its overlays; FullscreenBar gives play, position, time, mute and exit inside it.
 * The page also asks the browser for real full screen, so the window fills the screen where that is allowed. Esc, the exit button or the
 * full screen button again leave it.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

export interface PlayerFullscreen {
  ref: React.MutableRefObject<HTMLDialogElement | null>;
  on: boolean;
  enter(): void;
  exit(): void;
  toggle(): void;
}

export function usePlayerFullscreen(): PlayerFullscreen {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [on, setOn] = useState(false);
  const onRef = useRef(false);
  const native = useRef(false);
  const exit = useCallback(() => {
    const d = ref.current;
    if (d?.open) { d.close(); d.setAttribute("open", ""); }      // back in the page, open as before (no focus move, no scroll)
    onRef.current = false; setOn(false);
    if (native.current && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    native.current = false;
  }, []);
  const enter = useCallback(() => {
    const d = ref.current;
    if (!d) return;
    try { if (d.open) d.close(); d.showModal(); } catch { d.setAttribute("open", ""); }
    onRef.current = true; setOn(true);
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) {
      root.requestFullscreen({ navigationUI: "hide" }).then(() => { native.current = true; if (!onRef.current) void document.exitFullscreen().catch(() => undefined); }, () => undefined);
    }
  }, []);
  const toggle = useCallback(() => (onRef.current ? exit() : enter()), [enter, exit]);
  useEffect(() => {
    const d = ref.current;
    const cancel = (e: Event) => { e.preventDefault(); exit(); };          // Esc on the modal player
    const change = () => { if (native.current && !document.fullscreenElement) { native.current = false; if (onRef.current) exit(); } };   // Esc left the browser's full screen
    d?.addEventListener("cancel", cancel);
    document.addEventListener("fullscreenchange", change);
    return () => { d?.removeEventListener("cancel", cancel); document.removeEventListener("fullscreenchange", change); };
  });
  useEffect(() => () => { if (native.current && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); }, []);
  return { ref, on, enter, exit, toggle };
}

/** the frame's style: as designed in the page; full screen, the whole window (a <dialog>'s own margins, border and colours removed) */
export function frameStyle(on: boolean, normal: CSSProperties): CSSProperties {
  const reset: CSSProperties = { margin: 0, padding: 0, border: 0, maxWidth: "none", maxHeight: "none", color: "inherit", overflow: "hidden" };
  return on
    ? { ...normal, ...reset, position: "fixed", left: 0, top: 0, right: "auto", bottom: "auto", width: "100vw", height: "100vh", borderRadius: 0, background: "#000", zIndex: 2147483000 }
    : { ...reset, ...normal };
}

/** a picture box of aspect w:h, as large as fits the full-screen window, centred (its overlays keep their own coordinates in it) */
export function fitFull(w: number, h: number): CSSProperties {
  return { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: `min(100vw, calc(100vh * ${w / h}))`, height: `min(100vh, calc(100vw * ${h / w}))` };
}

const clock = (us: number) => {
  const s = Math.max(0, Math.floor(us / 1e6)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
const btn: CSSProperties = { background: "transparent", border: 0, color: "#fff", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "6px 10px", fontFamily: "inherit", minWidth: 40 };

/** the controls inside a full-screen player: play / pause, time, position, mute, exit. They fade after 3 s without the mouse while playing. */
export function FullscreenBar({ playing, onPlay, now, total, onSeek, muted, onMute, onExit, extra }: {
  playing: boolean; onPlay(): void; now: number; total: number; onSeek(frac: number): void; muted?: boolean; onMute?: () => void; onExit(): void; extra?: React.ReactNode;
}) {
  const [shown, setShown] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const wake = () => {
      setShown(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setShown(false), 3000);
    };
    wake();
    const box = document.querySelector("dialog[data-player-full=on]");
    box?.addEventListener("pointermove", wake); box?.addEventListener("pointerdown", wake); box?.addEventListener("keydown", wake);
    return () => { if (timer.current) clearTimeout(timer.current); box?.removeEventListener("pointermove", wake); box?.removeEventListener("pointerdown", wake); box?.removeEventListener("keydown", wake); };
  }, []);
  const p = total > 0 ? Math.min(1, Math.max(0, now / total)) : 0;
  const visible = shown || !playing;
  return (
    <div data-fullscreen-bar role="toolbar" aria-label="Full screen controls"
      style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 20, display: "flex", alignItems: "center", gap: 12, padding: "28px 20px 14px",
        background: "linear-gradient(180deg, transparent, rgba(0,0,0,.78))", color: "#fff", font: "15px system-ui, sans-serif",
        opacity: visible ? 1 : 0, transition: "opacity .3s", pointerEvents: visible ? "auto" : "none" }}>
      <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={onPlay} style={btn}>{playing ? "❚❚" : "▶"}</button>
      <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{clock(now)} / {clock(total)}</span>
      <input type="range" aria-label="Position" min={0} max={1000} step={1} value={Math.round(p * 1000)} onChange={(e) => onSeek(Number(e.target.value) / 1000)}
        style={{ flex: 1, accentColor: "#1e90ff", cursor: "pointer" }} />
      {extra}
      {onMute && <button type="button" aria-label={muted ? "Unmute" : "Mute"} onClick={onMute} style={btn}>{muted ? "🔇" : "🔊"}</button>}
      <button type="button" aria-label="Exit full screen" title="Exit full screen (Esc)" onClick={onExit} style={{ ...btn, fontSize: 15, border: "1px solid rgba(255,255,255,.5)", borderRadius: 6 }}>Exit full screen</button>
    </div>
  );
}
