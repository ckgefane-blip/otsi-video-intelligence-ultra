"use client";
/**
 * Page 07 Section 03 — video preview compositor (approved reference 07_CLIP_STUDIO, "preview").
 *
 * Plays the reel from the source video's playback copy (GET /v1/videos/:id/playback): clips back to back in timeline order, starting at
 * the playhead; or, when a Media Bin moment is selected, that moment from its in to its out point. The badge is the source's measured
 * resolution. Transport: previous / next clip, play, time, seek, speed, mute, fit / fill, snapshot of the current frame (PNG download),
 * full screen.
 * E1 (ADR-064): the spotlight is drawn live over the picture (a canvas, spotlight.ts) from the confirmed player's analysis positions, with
 * the renderer's own look rules; it is labelled approximate, because the render re-finds him in every clip. The badge also says whether
 * the last rendered file still matches this edit. Other graphics (lower third, score bug, tags, cards) appear only in the rendered file.
 * E2 (ADR-065): clips with a speed effect play as the render times them: slow stretches at a lower playback rate, a freeze holds the
 * picture for its length while the playhead moves on.
 * E5 (ADR-068): the reel's colour look is drawn on the video with an SVG filter (the same formula the render bakes into its LUT); a clip's
 * keyframed zoom moves the picture in on the player and its drawings draw on over it; with a draw tool chosen, dragging on the picture
 * draws an arrow, line or circle that starts at the playhead. Keys: Space, ← / →, Shift + ← / →, Home / End, A / L / R, Escape.
 */
import { DRAW_RGB, drawingAt, effectActive, gainFactor, isNeutral, lookChannels, outAt, srcAt, zoomAt, zoomWindow, type DrawKind, type Drawing, type Playback, type ReelPath, type Video } from "@otsi-vie/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { B, Ic, P, T, stageStyles, u } from "@/components/stage/DesignStage";
import { FullscreenBar, frameStyle, usePlayerFullscreen } from "@/components/media/Fullscreen";
import { ScopesPanel } from "./Scopes";
import { api } from "@/lib/api";
import { IN, tc, type Ui } from "./kit";
import { jkl } from "@/lib/keymap";
import { typing } from "./shortcuts";
import { locate, markedRange, type Studio } from "./useStudio";
import { CROP_LOOKAHEAD_US, SpotlightPreview, boxAt, fitRect, renderedState, smoothPath, strengthAt, visibleRuns } from "./spotlight";

const F = { x: 680, y: 207, w: 1268, h: 533 };
const quality = (h: number | null | undefined) => (!h ? "—" : h >= 2160 ? "4K" : h >= 1440 ? "QHD" : h >= 1080 ? "HD" : "SD");
/** one drawing at progress p (0..1 drawn) and opacity alpha, in display pixels: a line or arrow grows from its start, a circle goes round */
export function drawInk(g: CanvasRenderingContext2D, d: Pick<Drawing, "kind" | "x1" | "y1" | "x2" | "y2" | "color">, p: number, alpha: number,
  map: (x: number, y: number) => [number, number], width: number) {
  const [x1, y1] = map(d.x1, d.y1), [x2, y2] = map(d.x2, d.y2);
  g.save();
  g.globalAlpha = alpha; g.strokeStyle = g.fillStyle = DRAW_RGB[d.color]; g.lineWidth = width; g.lineCap = "round";
  g.beginPath();
  if (d.kind === "CIRCLE") {
    g.arc(x1, y1, Math.max(2, Math.hypot(x2 - x1, y2 - y1)), -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * p);
    g.stroke();
  } else {
    const tx = x1 + (x2 - x1) * p, ty = y1 + (y2 - y1) * p;
    g.moveTo(x1, y1); g.lineTo(tx, ty); g.stroke();
    if (d.kind === "ARROW" && p > 0.05) {
      const a = Math.atan2(ty - y1, tx - x1), L = width * 4.5;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx - L * Math.cos(a - 0.45), ty - L * Math.sin(a - 0.45)); g.lineTo(tx - L * Math.cos(a + 0.45), ty - L * Math.sin(a + 0.45));
      g.closePath(); g.fill();
    }
  }
  g.restore();
}
const TOOL_KEYS: Record<string, DrawKind> = { a: "ARROW", d: "LINE", r: "CIRCLE" };     // A.9 (ADR-071): line moved from L to D; L is play
const toolName = (k: DrawKind) => (k === "ARROW" ? "Arrow" : k === "LINE" ? "Line" : "Circle");

const icon = (x: number) => ({ position: "absolute" as const, left: u(x - 22), top: u(783 - 101 - 22), width: u(44), height: u(44), padding: 0, border: 0, background: "transparent", cursor: "pointer" });

export function Preview({ st, ui }: { st: Studio; ui: Ui }) {
  const reel = st.reel;
  const [video, setVideo] = useState<Video | null>(null);
  const [pb, setPb] = useState<Playback | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("1");
  const [muted, setMuted] = useState(false);
  const [cover, setCover] = useState(false);
  const [scopesOpen, setScopesOpen] = useState(false);
  const [momentT, setMomentT] = useState(0);
  const el = useRef<HTMLVideoElement | null>(null);
  const fs = usePlayerFullscreen();                                 // ADR-079: the shared full screen
  const fromVideo = useRef(false);
  const hold = useRef<{ id: string; t0: number; us: number; base: number; gap?: boolean } | null>(null);   // E2: a freeze being shown
  const frozeIn = useRef<string | null>(null);                                             // the clip whose freeze already played this pass
  const lastClip = useRef<string | null>(null);
  const speedRef = useRef(1);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const glow = useRef<HTMLCanvasElement | null>(null);              // the beam's light, added to the video (mix-blend-mode plus-lighter)
  const [path, setPath] = useState<ReelPath | null>(null);
  const zoomEl = useRef<HTMLDivElement | null>(null);               // E5: the picture and its spotlight, moved in by the clip's zoom
  const ink = useRef<HTMLCanvasElement | null>(null);               // E5: the clip's drawings
  const win = useRef({ z: 1, x0: 0, y0: 0 });
  const pending = useRef<Drawing | null>(null);                     // a drawing being dragged
  const stRef = useRef(st);
  stRef.current = st;
  // the confirmed player's positions inside the clips: fetched again whenever the reel is saved (clips, settings, targets)
  useEffect(() => {
    setPath(null);
    if (!reel) return;
    let live = true;
    void api<ReelPath>(`/v1/reels/${reel.id}/path`).then((x) => { if (live) setPath(x); }, () => undefined);
    return () => { live = false; };
  }, [reel?.id, reel?.version]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setVideo(null); setPb(null);
    if (!reel) return;
    void Promise.all([api<Video>(`/v1/videos/${reel.video_id}`), api<Playback>(`/v1/videos/${reel.video_id}/playback`)]).then(([v, p]) => { setVideo(v); setPb(p); }, () => undefined);
  }, [reel?.video_id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const url = pb?.available ? pb.url : null;
  const m = st.preview;
  // where the source should be: the moment's own time, or the playhead's place in the reel
  useEffect(() => {
    const v = el.current;
    if (!v || !url) return;
    if (fromVideo.current) { fromVideo.current = false; return; }
    const src = m ? m.in_pts_us + momentT : locate(st.items, st.playhead)?.src;
    if (src !== undefined) v.currentTime = src / 1e6;
  }, [st.playhead, m, url, st.items]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMomentT(0); }, [m?.in_pts_us, m?.out_pts_us]);
  speedRef.current = Number(speed);
  useEffect(() => { if (el.current) el.current.playbackRate = Number(speed); }, [speed, url]);

  // follow the video: keep the playhead in reel time, jump between clips, stop at the end
  useEffect(() => {
    const v = el.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      const src = Math.round(v.currentTime * 1e6);
      if (m) {
        if (Math.abs(v.playbackRate - speedRef.current) > 0.01) v.playbackRate = speedRef.current;
        if (src >= m.out_pts_us) { v.pause(); setMomentT(m.out_pts_us - m.in_pts_us); }
        else setMomentT(Math.max(0, src - m.in_pts_us));
      } else {
        const h = hold.current;
        if (h) {                                                         // E2: a freeze, the picture held while the playhead runs on
          const gone = (performance.now() - h.t0) * 1000 * speedRef.current;
          fromVideo.current = true;
          if (gone >= h.us) { hold.current = null; if (!h.gap) frozeIn.current = h.id; st.setPlayhead(h.base + h.us); void v.play(); return; }
          st.setPlayhead(h.base + gone);
          raf = requestAnimationFrame(tick);
          return;
        }
        const at = locate(st.items, st.playhead);
        if (at?.gap) {                                                   // B.19 (ADR-094): a spacer, black while the playhead runs on
          hold.current = { id: at.p.clip.id, t0: performance.now(), us: at.p.start - st.playhead, base: st.playhead, gap: true };
          v.pause(); v.currentTime = at.p.clip.in_pts_us / 1e6;
          fromVideo.current = true;
          raf = requestAnimationFrame(tick);
          return;
        }
        if (at) {
          const c = at.p.clip;
          if (lastClip.current !== c.id) { lastClip.current = c.id; frozeIn.current = null; }
          if (src >= c.out_pts_us) {
            const next = st.items[at.p.index + 1];
            if (next) { v.currentTime = next.clip.in_pts_us / 1e6; fromVideo.current = true; st.setPlayhead(next.start - next.gap); }
            else { v.pause(); fromVideo.current = true; st.setPlayhead(st.total); }
          } else if (src >= c.in_pts_us) {
            const e = c.effect;
            if (e.kind === "FREEZE" && effectActive(c) && e.at_us !== null && frozeIn.current !== c.id && src >= e.at_us && src < e.at_us + 400_000) {
              hold.current = { id: c.id, t0: performance.now(), us: e.hold_ms * 1000, base: at.p.start + outAt(c, e.at_us) };
              v.pause(); v.currentTime = e.at_us / 1e6;
              fromVideo.current = true; st.setPlayhead(hold.current.base);
              raf = requestAnimationFrame(tick);
              return;
            }
            const o = outAt(c, src);
            const want = speedRef.current * (srcAt(c, o).speed || 1);    // E2: slow motion and the ramp's steps play at their speed
            if (Math.abs(v.playbackRate - want) > 0.01) v.playbackRate = want;
            fromVideo.current = true; st.setPlayhead(at.p.start + o);
          }
        }
      }
      if (!v.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => { hold.current = null; setPlaying(true); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
    const onPause = () => { if (hold.current) return; setPlaying(false); cancelAnimationFrame(raf); };
    v.addEventListener("play", onPlay); v.addEventListener("pause", onPause);
    return () => { cancelAnimationFrame(raf); v.removeEventListener("play", onPlay); v.removeEventListener("pause", onPause); };
  }, [m, st, url]);

  const total = m ? m.out_pts_us - m.in_pts_us : st.total;
  const now = m ? momentT : st.playhead;
  const p = total ? Math.min(1, now / total) : 0;
  const can = !!url && (!!m || st.items.length > 0);
  /** act when there is something to play; otherwise open the reel chooser or say what is missing */
  const ready = (f: () => void) => () => {
    if (!reel) ui.pick();
    else if (!pb) ui.say("Loading the video…");
    else if (!url) ui.say(`No playback copy yet: ${pb.reason ?? "it is being prepared"}`);
    else if (!m && st.items.length === 0) ui.say("The reel has no clips yet: add moments from the Media Bin");
    else f();
  };
  const onTimeline = (f: () => void) => ready(() => (m ? ui.say("Previous / next work on the timeline: select a clip there") : f()));
  const play = () => {
    const v = el.current;
    if (!v) return;
    if (hold.current) { frozeIn.current = hold.current.id; hold.current = null; setPlaying(false); return; }   // pause during a freeze
    if (!v.paused) { v.pause(); return; }
    if (!m && st.playhead >= st.total) st.setPlayhead(0);
    if (m && momentT >= total) setMomentT(0);
    void v.play();
  };
  const jump = (dir: 1 | -1) => {
    const at = locate(st.items, st.playhead);
    const i = at ? at.p.index + (dir === 1 ? 1 : (st.playhead - at.p.start > 1_000_000 ? 0 : -1)) : 0;
    const target = st.items[Math.max(0, Math.min(st.items.length - 1, i))];
    if (target) st.setPlayhead(target.start);
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    if (m) setMomentT(f * total); else st.setPlayhead(f * total);
  };
  const snapshot = () => {
    const v = el.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const a = document.createElement("a"); a.download = `frame-${tc(Math.round(v.currentTime * 1e6)).replace(/[:.]/g, "-")}.png`; a.href = c.toDataURL("image/png"); a.click();
  };
  const message = !reel ? "No clip selected" : !pb ? "Loading the video…" : !url ? `No playback yet: ${pb.reason ?? "being prepared"}` : !m && st.items.length === 0 ? "No clip selected" : null;

  // the live spotlight: every animation frame while playing, and once after each seek or change while paused
  const spot = !!reel && !!url && !message && !m && !!path && path.points.length > 0;
  useEffect(() => {
    const c = canvas.current, g = glow.current, v = el.current;
    if (!spot || !c || !g || !v || !reel || !path) { for (const x of [c, g]) x?.getContext("2d")?.clearRect(0, 0, x.width, x.height); return; }
    const sp = new SpotlightPreview();
    const maxI = path.max_interp_s, frameUs = 40_000;
    const runs = visibleRuns(path.points, frameUs, maxI);
    const steady = smoothPath(path.points, maxI);                // ADR-079: where the beam goes; the raw path still says where he was seen
    // ADR-079: the time of the frame actually on screen (requestVideoFrameCallback), not the media clock, which runs ahead of the picture
    let shown: number | null = null, vfc = 0;
    const onFrame = (_: number, meta: { mediaTime: number }) => { shown = meta.mediaTime; vfc = v.requestVideoFrameCallback(onFrame); };
    if ("requestVideoFrameCallback" in v) vfc = v.requestVideoFrameCallback(onFrame);
    const caption = reel.player ? (reel.player.canonical_otsi_id ? `${reel.player.display_name}  ·  ${reel.player.canonical_otsi_id}` : reel.player.display_name) : null;
    let raf = 0, last = "";
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const parent = c.parentElement!, W = parent.clientWidth, H = parent.clientHeight;
      const tNow = !v.paused && shown !== null ? shown : v.currentTime;
      const dpr = window.devicePixelRatio || 1, key = `${tNow}|${W}|${H}|${cover}|${dpr}`;
      if (v.paused && key === last) return;
      last = key;
      for (const x of [c, g]) if (x.width !== Math.round(W * dpr) || x.height !== Math.round(H * dpr)) { x.width = Math.round(W * dpr); x.height = Math.round(H * dpr); }
      const t = Math.round(tNow * 1e6);
      const inClip = st.items.some((p) => t >= p.clip.in_pts_us && t <= p.clip.out_pts_us);
      const seen = boxAt(path.points, t, frameUs, maxI).state !== "MISSING";
      const b = seen ? boxAt(steady, t, frameUs, maxI).box : null;
      const { box: ahead } = boxAt(steady, t + CROP_LOOKAHEAD_US, frameUs, maxI);
      const ctx = c.getContext("2d")!, add = g.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); add.setTransform(dpr, 0, 0, dpr, 0, 0);
      sp.draw(ctx, add, fitRect(W, H, v.videoWidth, v.videoHeight, cover), inClip ? b : null, inClip ? strengthAt(runs, t) : 0,
        reel.settings, caption, reel.aspect, v.videoWidth, v.videoHeight, now, inClip ? ahead : null);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); if (vfc && "cancelVideoFrameCallback" in v) v.cancelVideoFrameCallback(vfc); };
  }, [spot, path, reel, cover, st.items]);
  const steadyPath = useMemo(() => (path ? smoothPath(path.points, path.max_interp_s) : null), [path]);
  // E5: the clip's zoom and drawings, every animation frame (the playhead says where in the clip; the render uses the same formulas)
  const fxOn = !!reel && !!url && !message && !m;
  useEffect(() => {
    const z0 = zoomEl.current, c = ink.current;
    if (!fxOn || !z0 || !c) { if (z0) z0.style.transform = ""; c?.getContext("2d")?.clearRect(0, 0, c.width, c.height); win.current = { z: 1, x0: 0, y0: 0 }; return; }
    let raf = 0, zc: [number, number] | null = null;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const s = stRef.current, v = el.current;
      if (!v) return;
      const W = z0.clientWidth, H = z0.clientHeight, dpr = window.devicePixelRatio || 1;
      const at = locate(s.items, s.playhead), fx = at?.p.clip.fx, tMs = at ? (s.playhead - at.p.start) / 1000 : 0;
      const rect = fitRect(W, H, v.videoWidth, v.videoHeight, cover);
      const z = fx?.zoom.length ? zoomAt(fx.zoom, tMs) : 1;
      let x0 = 0, y0 = 0;
      if (z > 1.0001) {
        const b = steadyPath ? boxAt(steadyPath, Math.round(v.currentTime * 1e6), 40_000, path!.max_interp_s).box : null;
        const tgt: [number, number] = b ? [rect.x + (b[0] + b[2] / 2) * rect.w, rect.y + (b[1] + b[3] / 2) * rect.h] : zc ?? [W / 2, H / 2];
        zc = zc ? [zc[0] + 0.1 * (tgt[0] - zc[0]), zc[1] + 0.1 * (tgt[1] - zc[1])] : tgt;
        [x0, y0] = zoomWindow(z, zc[0], zc[1], W, H);
      } else zc = null;
      win.current = { z, x0, y0 };
      z0.style.transform = z > 1.0001 ? `translate(${-x0 * z}px, ${-y0 * z}px) scale(${z})` : "";
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      const map = (x: number, y: number): [number, number] => [rect.x + x * rect.w, rect.y + y * rect.h];
      const width = Math.max(3, rect.h * 0.007);
      for (const d of fx?.drawings ?? []) { const a = drawingAt(d, tMs); if (a) drawInk(g, d, a.p, a.alpha, map, width); }
      if (pending.current) drawInk(g, pending.current, 1, 1, map, width);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [fxOn, path, steadyPath, cover]);

  // E5: the frame on screen, small, for match to reference (the source picture, before the look)
  useEffect(() => {
    st.grab.current = () => {
      const v = el.current;
      if (!v || !v.videoWidth) return null;
      try {
        const k = document.createElement("canvas"); k.width = 160; k.height = Math.max(1, Math.round(160 * v.videoHeight / v.videoWidth));
        const g = k.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(v, 0, 0, k.width, k.height);
        return { rgba: g.getImageData(0, 0, k.width, k.height).data, at_us: Math.round(v.currentTime * 1e6) };
      } catch { return null; }
    };
    return () => { st.grab.current = null; };
  });

  // E5: drag on the picture to draw (the tool chosen in Adjustments or with A / L / R)
  const under = !m ? locate(st.items, st.playhead) : null;
  // B.20 (ADR-095): the clip's own sound level while it plays (a browser can lower, not raise, a video's sound: a boost is heard in the file)
  const gainDb = under?.p.clip.fx.gain_db ?? 0;
  useEffect(() => { if (el.current) el.current.volume = Math.min(1, gainFactor(gainDb)); }, [gainDb, url]);
  const drawing = !!st.drawTool && fxOn && !!under && st.playhead < st.total;
  const toSrc = (e: React.PointerEvent): [number, number] | null => {
    const z0 = zoomEl.current, v = el.current;
    if (!z0 || !v || !v.videoWidth) return null;
    const r = z0.parentElement!.getBoundingClientRect(), W = z0.clientWidth, H = z0.clientHeight;
    const lx = (e.clientX - r.left) * (W / r.width), ly = (e.clientY - r.top) * (H / r.height);
    const { z, x0, y0 } = win.current, rect = fitRect(W, H, v.videoWidth, v.videoHeight, cover);
    const qx = lx / z + x0, qy = ly / z + y0;
    return [Math.min(1, Math.max(0, (qx - rect.x) / rect.w)), Math.min(1, Math.max(0, (qy - rect.y) / rect.h))];
  };
  const drawDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toSrc(e);
    if (!p || !under || !st.drawTool) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pending.current = { kind: st.drawTool, x1: p[0], y1: p[1], x2: p[0], y2: p[1], color: st.drawColor,
      at_ms: Math.round((st.playhead - under.p.start) / 1000), draw_ms: 600, hold_ms: 2000 };
  };
  const drawMove = (e: React.PointerEvent) => { const d = pending.current, p = d && toSrc(e); if (d && p) { d.x2 = p[0]; d.y2 = p[1]; } };
  const drawUp = () => {
    const d = pending.current;
    pending.current = null;
    if (!d || !under) return;
    if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 0.01) return ui.say("Drag on the picture to draw it");
    const c = under.p.clip;
    if (c.fx.drawings.length >= 12) return ui.say("A clip holds 12 drawings: delete one in Adjustments first");
    st.setFx(c, { ...c.fx, drawings: [...c.fx.drawings, d] }, `${toolName(d.kind)} drawn at ${tc(st.playhead - under.p.start)} in clip ${under.p.index + 1}`);
  };

  // E5: playback and draw keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key, s = stRef.current;
      const step = (d: number) => { if (m) setMomentT((x) => Math.max(0, Math.min(total, x + d))); else s.setPlayhead(Math.max(0, Math.min(s.total, s.playhead + d))); };
      if (k === " " && !(e.target as HTMLElement).closest("button, a")) ready(play)();
      else if (k === "ArrowLeft" || k === "ArrowRight") { el.current?.pause(); step((k === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1_000_000 : 40_000)); }
      else if (!e.shiftKey && (k.toLowerCase() === "j" || k.toLowerCase() === "k" || k.toLowerCase() === "l")) {
        // A.9 (ADR-071): J K L transport
        const r = jkl(k.toLowerCase() as "j" | "k" | "l", { playing: !!el.current && (!el.current.paused || !!hold.current), rate: Number(speed) });
        ready(() => {
          if (!r.play && el.current && (!el.current.paused || hold.current)) play();
          setSpeed(String(r.rate));
          if (r.backUs) step(-r.backUs);
          if (r.play && el.current?.paused && !hold.current) play();
          if (r.play) ui.say(`Playing at ${r.rate}×`);
        })();
      }
      else if (k === "Home") { if (m) setMomentT(0); else s.setPlayhead(0); }
      else if (k === "End") { if (m) setMomentT(total); else s.setPlayhead(s.total); }
      else if (TOOL_KEYS[k.toLowerCase()] && !e.shiftKey) {
        const t = TOOL_KEYS[k.toLowerCase()]!;
        s.setDrawTool(s.drawTool === t ? null : t);
        ui.say(s.drawTool === t ? "Drawing off" : `${toolName(t)}: drag on the picture; it draws on at the playhead`);
      } else if (k === "Escape" && s.drawTool) { s.setDrawTool(null); ui.say("Drawing off"); }
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  // E1: I / O mark the part of a previewed Media Bin moment to add; Alt+X clears the marks
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey) return;
      const v = el.current, k = e.key.toLowerCase();
      if (e.altKey ? k !== "x" : k !== "i" && k !== "o") return;
      e.preventDefault();
      if (!m || !v) return ui.say("I / O mark a Media Bin moment in the preview; on the timeline use Alt+[ / Alt+] or drag a clip's edge");
      const t = Math.min(m.out_pts_us, Math.max(m.in_pts_us, Math.round(v.currentTime * 1e6)));
      if (e.altKey) { st.setMarks({}); return ui.say("Marks cleared"); }
      const next = k === "i" ? { ...st.marks, in: t } : { ...st.marks, out: t };
      if (next.in !== undefined && next.out !== undefined && next.out <= next.in) { if (k === "i") delete next.out; else delete next.in; }
      st.setMarks(next);
      const r = markedRange(m, next);
      ui.say(r ? `Marked ${tc(r.in_pts_us - m.in_pts_us)} – ${tc(r.out_pts_us - m.in_pts_us)} (${((r.out_pts_us - r.in_pts_us) / 1e6).toFixed(1)} s): + adds the marked part`
        : `${k === "i" ? "In" : "Out"} marked at ${tc(t - m.in_pts_us)}`);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  const mk = m ? markedRange(m, st.marks) : null;
  const markIn = m && st.marks.in !== undefined ? (st.marks.in - m.in_pts_us) / total : null, markOut = m && st.marks.out !== undefined ? (st.marks.out - m.in_pts_us) / total : null;
  const rendered = reel ? renderedState(reel).reel : null;
  const look = reel?.settings.look, lookOn = !!look && !isNeutral(look), ch = look ? lookChannels(look) : null;
  const note = !reel || message ? null : m ? "Media Bin moment: the spotlight shows on the reel's clips"
    : reel.stale ? "No spotlight preview: a followed identity changed" : !path ? null
    : path.points.length === 0 ? (reel.targets.length ? "No spotlight preview: the player was not found in these clips" : "No spotlight preview: no confirmed player to follow")
    : "Live spotlight · approximate";
  const markNote = m ? (mk ? `Marked ${((mk.out_pts_us - mk.in_pts_us) / 1e6).toFixed(1)} s: + adds this part` : "I / O: mark the part to add") : null;

  return (
    <section aria-label="Video preview compositor" data-section="p07-s03" data-playing={playing ? "yes" : "no"}>
      <P x={678} y={205} w={1272} h={620} />
      <dialog ref={fs.ref} open data-player-full={fs.on ? "on" : undefined} role="region" aria-label="Reel preview player" className="absolute" style={frameStyle(fs.on, { left: u(F.x), top: u(F.y - 101), width: u(F.w), height: u(F.h), overflow: "hidden",
        background: url && !message ? "#000" : "radial-gradient(ellipse at 60% 0,#5fb8ff 0,#1d4a8a 20%,transparent 50%),linear-gradient(180deg,#0a1a38,#04101f 60%,#0a2a30)" })}>
        {(!url || message) && (
          <>
            <B o={[F.x, F.y]} x={1100} y={260} w={500} h={480} style={{ background: "radial-gradient(ellipse at 50% 45%,#4a9ee0 0,#2a6fb8 35%,transparent 70%)" }} />
            <B o={[F.x, F.y]} x={1290} y={640} w={90} h={90} style={{ background: "radial-gradient(circle,#dde7f5 0,#335 70%)", borderRadius: "50%" }} />
          </>
        )}
        {ch && (
          <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
            <filter id="otsi-look" colorInterpolationFilters="sRGB">
              <feComponentTransfer>
                {(["R", "G", "B"] as const).map((n, i) => { const F = `feFunc${n}` as const; return <F key={n} type="linear" slope={ch.slope[i]} intercept={ch.intercept[i]} />; })}
              </feComponentTransfer>
              <feComponentTransfer>
                {(["R", "G", "B"] as const).map((n, i) => { const F = `feFunc${n}` as const; return <F key={n} type="gamma" amplitude={1} exponent={ch.exponent[i]} offset={0} />; })}
              </feComponentTransfer>
              <feColorMatrix type="saturate" values={String(ch.saturation)} />
            </filter>
          </svg>
        )}
        <div ref={zoomEl} data-preview-zoom style={{ position: "absolute", inset: 0, transformOrigin: "0 0" }}>
          {url && <video ref={el} src={url} preload="metadata" playsInline muted={muted} aria-label="Reel preview" data-look={lookOn ? "on" : "off"}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: cover ? "cover" : "contain", visibility: message ? "hidden" : "visible",
              filter: lookOn ? "url(#otsi-look)" : undefined }} />}
          {url && !message && under?.gap && (
            <div data-gap-black="" aria-label="Gap before the clip" style={{ position: "absolute", inset: 0, zIndex: 4, background: "#000", pointerEvents: "none", display: "flex",
              alignItems: "flex-end", justifyContent: "center", paddingBottom: u(16), color: "#5f7491", fontSize: u(16) }}>{`Gap · ${(under.p.gap / 1e6).toFixed(1)} s`}</div>
          )}
          {url && <canvas ref={glow} aria-hidden data-spotlight-light
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", mixBlendMode: "plus-lighter", visibility: message ? "hidden" : "visible" }} />}
          {url && <canvas ref={canvas} aria-hidden data-spotlight-preview={spot ? "on" : "off"}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", visibility: message ? "hidden" : "visible" }} />}
          {url && <canvas ref={ink} aria-hidden data-preview-ink
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", visibility: message ? "hidden" : "visible" }} />}
        </div>
        {drawing && <div data-draw-surface={st.drawTool} aria-label={`Draw ${toolName(st.drawTool!)} on the picture`} onPointerDown={drawDown} onPointerMove={drawMove}
          onPointerUp={drawUp} onPointerCancel={() => { pending.current = null; }} style={{ position: "absolute", inset: 0, cursor: "crosshair", touchAction: "none", zIndex: 2 }} />}
        {message && <T o={[F.x, F.y]} x={1314} y={470} size={26} color="#dbe8f8" align="center">{message}</T>}
        {(note || markNote || (rendered && !message)) && (
          <div data-preview-note style={{ position: "absolute", left: u(14), top: u(12), display: "flex", gap: u(8), pointerEvents: "none" }}>
            {note && <span title="The preview follows the analysis positions; Export renders the exact picture" style={{ padding: `${u(4)} ${u(12)}`, borderRadius: u(14),
              background: "rgba(6,22,48,.78)", border: `${u(1.5)} solid #f5d27a`, color: "#ffe6a8", fontSize: u(17) }}>{note}</span>}
            {markNote && !message && <span data-mark-note style={{ padding: `${u(4)} ${u(12)}`, borderRadius: u(14), background: "rgba(6,22,48,.78)",
              border: `${u(1.5)} solid #f5b82e`, color: "#ffe6a8", fontSize: u(17) }}>{markNote}</span>}
            {rendered && !message && <span data-rendered={rendered.state} title={rendered.why} style={{ padding: `${u(4)} ${u(12)}`, borderRadius: u(14),
              background: "rgba(6,22,48,.78)", border: `${u(1.5)} solid ${rendered.state === "RENDERED" ? "#3ecf7a" : "#ffb86b"}`,
              color: rendered.state === "RENDERED" ? "#bff5d4" : "#ffd9b0", fontSize: u(17) }}>
              {rendered.state === "RENDERED" ? "Rendered file matches" : rendered.state === "NEVER" ? "Not rendered yet" : "Changed since the last render"}</span>}
          </div>
        )}
        {fs.on && <FullscreenBar playing={playing} onPlay={ready(play)} now={now} total={total} onSeek={(f) => (m ? setMomentT(f * total) : st.setPlayhead(f * total))}
          muted={muted} onMute={() => setMuted((x) => !x)} onExit={fs.exit} />}
      </dialog>
      <B x={1881} y={226} w={48} h={39} style={{ background: "#0a0a05", border: `${u(2)} solid #f5b82e`, borderRadius: u(5) }} />
      <T x={1905} y={246} size={22} weight={700} color="#f5b82e" align="center">{quality(video?.height)}</T>

      <button type="button" aria-label="Previous clip" onClick={onTimeline(() => jump(-1))} style={icon(729)}><Ic o={[707, 761]} x={729} y={783} k="prev" size={34} /></button>
      <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={ready(play)} className="absolute"
        style={{ left: u(796 - 8), top: u(764 - 101 - 6), width: u(44), height: u(50), padding: 0, border: 0, background: "transparent", cursor: "pointer" }}>
        {playing
          ? <span style={{ position: "absolute", left: u(10), top: u(8), width: u(24), height: u(34), borderLeft: `${u(8)} solid #fff`, borderRight: `${u(8)} solid #fff`, boxSizing: "border-box" }} />
          : <span style={{ position: "absolute", left: u(8), top: u(6), width: u(28), height: u(38), background: "#fff", clipPath: "polygon(0 0,100% 50%,0 100%)", transform: "scale(1.3)" }} />}
      </button>
      <button type="button" aria-label="Next clip" onClick={onTimeline(() => jump(1))} style={icon(888)}><Ic o={[866, 761]} x={888} y={783} k="next" size={34} /></button>
      <T x={954} y={783} size={24}>{tc(now)}</T>
      <T x={1048} y={783} size={24} color="#8ea3bf">/</T>
      <T x={1063} y={783} size={24} color="#8ea3bf">{tc(total)}</T>
      <div role="slider" aria-label="Preview position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} tabIndex={0}
        onClick={(e) => { if (can) seek(e); else ready(() => undefined)(); }} className="absolute" style={{ left: u(1169), top: u(768 - 101), width: u(331), height: u(30), cursor: "pointer" }}>
        <B o={[1169, 768]} x={1180} y={780} w={320} h={6} style={{ background: "#0b2a4d", borderRadius: u(3) }}>
          <i style={{ display: "block", height: "100%", width: `${p * 100}%`, background: "#1e90ff", borderRadius: u(3) }} />
          {(markIn !== null || markOut !== null) && <i data-marks style={{ position: "absolute", top: u(-4), bottom: u(-4), left: `${(markIn ?? 0) * 100}%`,
            width: `${((markOut ?? 1) - (markIn ?? 0)) * 100}%`, background: "rgba(245,184,46,.45)", borderLeft: markIn !== null ? `${u(2)} solid #f5b82e` : 0,
            borderRight: markOut !== null ? `${u(2)} solid #f5b82e` : 0, boxSizing: "border-box" }} />}
        </B>
        <B o={[1169, 768]} x={1169 + p * 320} y={771} w={22} h={22} style={{ background: "#cfe8ff", border: `${u(3)} solid #33a8ff`, borderRadius: "50%" }} />
      </div>
      <div className={`${stageStyles.a} ${stageStyles.framed}`} style={{ left: u(1529), top: u(760 - 101), width: u(105), height: u(46), ...IN }}>
        <T o={[1529, 760]} x={1551} y={783} size={20} as="span">{speed}x</T>
        <Ic o={[1529, 760]} x={1607} y={783} k="chev" size={18} />
        <select aria-label="Preview speed" value={speed} onChange={(e) => setSpeed(e.target.value)}
          style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}>
          {["0.5", "1", "1.5", "2"].map((v) => <option key={v} value={v}>{v}x</option>)}
        </select>
      </div>
      <button type="button" aria-label={scopesOpen ? "Hide scopes" : "Show scopes"} aria-pressed={scopesOpen} data-player-scopes="" onClick={() => setScopesOpen((s) => !s)} style={icon(1660)}>
        <Ic o={[1638, 761]} x={1660} y={783} k="bars" size={32} color={scopesOpen ? "#3ecf7a" : "#fff"} />
      </button>
      <button type="button" aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} onClick={() => setMuted((x) => !x)} style={icon(1720)}>
        <Ic o={[1698, 761]} x={1720} y={783} k={muted ? "mute" : "speaker"} size={34} />
      </button>
      <button type="button" aria-label={cover ? "Fit the picture" : "Fill the frame"} aria-pressed={cover} onClick={() => setCover((x) => !x)} style={icon(1780)}>
        <Ic o={[1758, 761]} x={1780} y={783} k="fs" size={32} />
      </button>
      <button type="button" aria-label="Save a snapshot of this frame" onClick={ready(() => (message ? ui.say("Nothing on screen to capture") : snapshot()))} style={icon(1840)}>
        <Ic o={[1818, 761]} x={1840} y={783} k="cap" size={32} />
      </button>
      <button type="button" aria-label={fs.on ? "Exit full screen" : "Full screen"} aria-pressed={fs.on} onClick={ready(fs.toggle)} style={icon(1900)}>
        <Ic o={[1878, 761]} x={1900} y={783} k="fs" size={32} />
      </button>
      {scopesOpen && <ScopesPanel videoRef={el} onClose={() => setScopesOpen(false)} />}
    </section>
  );
}
