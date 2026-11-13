"use client";
/**
 * Page 07 Section 03 — video preview compositor (approved reference 07_CLIP_STUDIO, "preview").
 *
 * Plays the reel from the source video's playback copy (GET /v1/videos/:id/playback): clips back to back in timeline order, starting at
 * the playhead; or, when a Media Bin moment is selected, that moment from its in to its out point. The badge is the source's measured
 * resolution. The control bar is the SOT's (Studio.dc.html): play / back and forward one second, time, seek, speed, fullscreen — and
 * with no playable footage the empty state offers Play and "Open local footage" (a file from this computer, played here).
 * E1 (ADR-064): the spotlight is drawn live over the picture (a canvas, spotlight.ts) from the confirmed player's analysis positions, with
 * the renderer's own look rules; it is labelled approximate, because the render re-finds him in every clip. The badge also says whether
 * the last rendered file still matches this edit. Other graphics (lower third, score bug, tags, cards) appear only in the rendered file.
 * E2 (ADR-065): clips with a speed effect play as the render times them: slow stretches at a lower playback rate, a freeze holds the
 * picture for its length while the playhead moves on.
 * E5 (ADR-068): the reel's colour look is drawn on the video with an SVG filter (the same formula the render bakes into its LUT); a clip's
 * keyframed zoom moves the picture in on the player and its drawings draw on over it; with a draw tool chosen, dragging on the picture
 * draws an arrow, line, circle, freehand polyline or spotlight that starts at the playhead, and clicking with the text tool places a text
 * annotation. Keys: Space, ← / →, Shift + ← / →, Home / End, A / D / R / F / T, Escape, "," / "." frame step, "[" / "]" speed.
 *
 * The compositor keeps its own <video> element (not the shared VideoPlayer): the tick loop drives play/pause/seek and playbackRate,
 * volume carries the clip gain, requestVideoFrameCallback times the live spotlight, drawImage feeds the reference-frame grab, a zoom
 * wrapper div moves the picture, the SVG look filter applies to the element, and the draw surface sits over it. Forcing the shared
 * player in would silently drop those controls. A file opened from this computer (Open local footage) plays standalone in the same
 * element: the reel tick leaves it alone, and the time and seek read the file itself.
 */
import { DRAW_RGB, drawingAt, effectActive, gainFactor, isNeutral, lookChannels, outAt, srcAt, zoomAt, zoomWindow, type DrawKind, type Drawing, type Playback, type ReelPath, type Video } from "@otsi-vie/contracts";
import { Expand, Pause, Play, SkipBack, SkipForward, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FullscreenBar, frameStyle, usePlayerFullscreen } from "@/components/media/Fullscreen";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { tc, type Ui } from "./kit";
import { jkl } from "@/lib/keymap";
import { typing } from "./shortcuts";
import { locate, markedRange, type Studio } from "./useStudio";
import { CROP_LOOKAHEAD_US, SpotlightPreview, boxAt, fitRect, renderedState, smoothPath, strengthAt, visibleRuns } from "./spotlight";

const quality = (h: number | null | undefined) => (!h ? "—" : h >= 2160 ? "4K" : h >= 1440 ? "QHD" : h >= 1080 ? "HD" : "SD");
/** one drawing at progress p (0..1 drawn) and opacity alpha, in display pixels: a line or arrow grows from its start, a circle goes round,
 *  a freehand polyline is drawn point by point, a spotlight dims everything outside its circle, a text annotation is written at its point */
export function drawInk(g: CanvasRenderingContext2D, d: Pick<Drawing, "kind" | "x1" | "y1" | "x2" | "y2" | "color" | "points" | "text">, p: number, alpha: number,
  map: (x: number, y: number) => [number, number], width: number) {
  const [x1, y1] = map(d.x1, d.y1), [x2, y2] = map(d.x2, d.y2);
  g.save();
  g.globalAlpha = alpha; g.strokeStyle = g.fillStyle = DRAW_RGB[d.color]; g.lineWidth = width; g.lineCap = "round"; g.lineJoin = "round";
  if (d.kind === "SPOTLIGHT") {
    // dim the whole picture, then punch the circle clear so the footage shows through it (the ink canvas is transparent elsewhere)
    const [rx0, ry0] = map(0, 0), [rx1, ry1] = map(1, 1);
    g.fillStyle = `rgba(0, 0, 0, ${0.65 * alpha})`;
    g.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
    g.globalCompositeOperation = "destination-out";
    g.globalAlpha = 1;
    g.beginPath();
    g.arc(x1, y1, Math.max(2, Math.hypot(x2 - x1, y2 - y1) * Math.max(p, 0.05)), 0, 2 * Math.PI);
    g.fill();
    g.restore();
    return;
  }
  if (d.kind === "TEXT") {
    if (p > 0.05 && d.text) {
      g.font = `600 ${Math.max(14, width * 7)}px Inter, sans-serif`;
      g.textBaseline = "middle";
      g.fillText(d.text, x1, y1);
    }
    g.restore();
    return;
  }
  g.beginPath();
  if (d.kind === "CIRCLE") {
    g.arc(x1, y1, Math.max(2, Math.hypot(x2 - x1, y2 - y1)), -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * p);
    g.stroke();
  } else if (d.kind === "FREEHAND" && d.points && d.points.length > 1) {
    const n = Math.max(2, Math.ceil(d.points.length * p));
    const pts = d.points.slice(0, n).map(([x, y]) => map(x, y));
    g.moveTo(pts[0]![0], pts[0]![1]);
    for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
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
const TOOL_KEYS: Record<string, DrawKind> = { a: "ARROW", d: "LINE", r: "CIRCLE", f: "FREEHAND", t: "TEXT" };     // A.9 (ADR-071): line moved from L to D; L is play
const toolName = (k: DrawKind, d: Dictionary) => (k === "ARROW" ? d.body.studio.arrowTool : k === "LINE" ? d.body.studio.lineTool
  : k === "CIRCLE" ? d.body.studio.circleTool : k === "FREEHAND" ? d.body.studio.csToolFreehand
  : k === "SPOTLIGHT" ? d.body.studio.spotlightLabel : d.body.studio.csToolText);

export function Preview({ st, ui }: { st: Studio; ui: Ui }) {
  const { t: dict } = useLocale();
  const reel = st.reel;
  const [video, setVideo] = useState<Video | null>(null);
  const [pb, setPb] = useState<Playback | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState("1");
  const [muted, setMuted] = useState(false);
  const [momentT, setMomentT] = useState(0);
  // a file opened from this computer (the SOT's "Open local footage"): played standalone in the same element
  const [local, setLocal] = useState<string | null>(null);
  const localRef = useRef<string | null>(null);
  localRef.current = local;
  const [localNow, setLocalNow] = useState(0);
  const [localDur, setLocalDur] = useState(0);
  // the text annotation being placed (display + normalised position, under the text tool)
  const [textAt, setTextAt] = useState<{ dx: number; dy: number; nx: number; ny: number } | null>(null);
  const [textVal, setTextVal] = useState("");
  const textDone = useRef(false);   // Enter commits, then blur fires on the unmounting input: commit once
  useEffect(() => () => { if (localRef.current) URL.revokeObjectURL(localRef.current); }, []);
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
  const src = local ?? url;
  const m = st.preview;
  // where the source should be: the moment's own time, or the playhead's place in the reel (never for a local file: it plays as itself)
  useEffect(() => {
    const v = el.current;
    if (!v || !url || local) return;
    if (fromVideo.current) { fromVideo.current = false; return; }
    const src = m ? m.in_pts_us + momentT : locate(st.items, st.playhead)?.src;
    if (src !== undefined) v.currentTime = src / 1e6;
  }, [st.playhead, m, url, local, st.items]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMomentT(0); }, [m?.in_pts_us, m?.out_pts_us]);
  speedRef.current = Number(speed);
  useEffect(() => { if (el.current) el.current.playbackRate = Number(speed); }, [speed, url]);

  // follow the video: keep the playhead in reel time, jump between clips, stop at the end
  useEffect(() => {
    const v = el.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      // a local file plays as itself: the reel tick leaves it alone (time and seek read the file, below)
      if (localRef.current) { if (!v.paused) raf = requestAnimationFrame(tick); return; }
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

  const total = local ? Math.round(localDur * 1e6) : m ? m.out_pts_us - m.in_pts_us : st.total;
  const now = local ? Math.round(localNow * 1e6) : m ? momentT : st.playhead;
  const p = total ? Math.min(1, now / total) : 0;
  const can = !!local || (!!url && (!!m || st.items.length > 0));
  /** act when there is something to play; otherwise open the reel chooser or say what is missing */
  const ready = (f: () => void) => () => {
    if (local) f();
    else if (!reel) ui.pick();
    else if (!pb) ui.say(dict.body.processing.loadingVideo);
    else if (!url) ui.say(dict.body.studio.noPlaybackCopyYet.replace("{a}", pb.reason ?? dict.body.workspace.beingPrepared));
    else if (!m && st.items.length === 0) ui.say(dict.body.studio.reelNoClips);
    else f();
  };
  const play = () => {
    const v = el.current;
    if (!v) return;
    if (local) {
      if (!v.paused) { v.pause(); return; }
      if (v.duration && v.currentTime >= v.duration - 0.05) v.currentTime = 0;
      void v.play();
      return;
    }
    if (hold.current) { frozeIn.current = hold.current.id; hold.current = null; setPlaying(false); return; }   // pause during a freeze
    if (!v.paused) { v.pause(); return; }
    if (!m && st.playhead >= st.total) st.setPlayhead(0);
    if (m && momentT >= total) setMomentT(0);
    void v.play();
  };
  /** one second back or forward (the SOT's control bar): on the file itself when local, else on the playhead */
  const nudge1 = (dir: 1 | -1) => {
    const v = el.current;
    if (local) { if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + dir)); return; }
    if (m) setMomentT((x) => Math.max(0, Math.min(total, x + dir * 1_000_000)));
    else st.setPlayhead(Math.max(0, Math.min(st.total, st.playhead + dir * 1_000_000)));
  };
  const seekFrac = (f: number) => {
    const v = el.current;
    if (local) { if (v && localDur) v.currentTime = f * localDur; return; }
    if (m) setMomentT(f * total); else st.setPlayhead(f * total);
  };
  // a local file plays on its own: there is no "nothing to play" message for it
  const message = local ? null : !reel ? dict.body.studio.noClipSelected : !pb ? dict.body.processing.loadingVideo : !url ? dict.body.tactics.noPlaybackYetReason.replace("{a}", pb.reason ?? dict.body.workspace.beingPrepared) : !m && st.items.length === 0 ? dict.body.studio.noClipSelected : null;

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
      const dpr = window.devicePixelRatio || 1, key = `${tNow}|${W}|${H}|${dpr}`;
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
      sp.draw(ctx, add, fitRect(W, H, v.videoWidth, v.videoHeight, false), inClip ? b : null, inClip ? strengthAt(runs, t) : 0,
        reel.settings, caption, reel.aspect, v.videoWidth, v.videoHeight, now, inClip ? ahead : null);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); if (vfc && "cancelVideoFrameCallback" in v) v.cancelVideoFrameCallback(vfc); };
  }, [spot, path, reel, st.items]);
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
      const rect = fitRect(W, H, v.videoWidth, v.videoHeight, false);
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
      // spotlights first (their dim punches a hole in the ink canvas, so they must not erase the other drawings)
      const drawings = fx?.drawings ?? [];
      for (const d of drawings.filter((x) => x.kind === "SPOTLIGHT")) { const a = drawingAt(d, tMs); if (a) drawInk(g, d, a.p, a.alpha, map, width); }
      for (const d of drawings.filter((x) => x.kind !== "SPOTLIGHT")) { const a = drawingAt(d, tMs); if (a) drawInk(g, d, a.p, a.alpha, map, width); }
      if (pending.current) drawInk(g, pending.current, 1, 1, map, width);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [fxOn, path, steadyPath]);

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
    const { z, x0, y0 } = win.current, rect = fitRect(W, H, v.videoWidth, v.videoHeight, false);
    const qx = lx / z + x0, qy = ly / z + y0;
    return [Math.min(1, Math.max(0, (qx - rect.x) / rect.w)), Math.min(1, Math.max(0, (qy - rect.y) / rect.h))];
  };
  const drawDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toSrc(e);
    if (!p || !under || !st.drawTool) return;
    e.preventDefault();
    // the text tool places an annotation at the click point (an input opens there; Enter commits it)
    if (st.drawTool === "TEXT") {
      const r = e.currentTarget.getBoundingClientRect();
      setTextVal("");
      textDone.current = false;
      setTextAt({ dx: e.clientX - r.left, dy: e.clientY - r.top, nx: p[0], ny: p[1] });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    pending.current = { kind: st.drawTool, x1: p[0], y1: p[1], x2: p[0], y2: p[1], color: st.drawColor,
      at_ms: Math.round((st.playhead - under.p.start) / 1000), draw_ms: 600, hold_ms: 2000,
      ...(st.drawTool === "FREEHAND" ? { points: [[p[0], p[1]]] } : {}) };
  };
  const drawMove = (e: React.PointerEvent) => {
    const d = pending.current, p = d && toSrc(e);
    if (!d || !p) return;
    if (d.kind === "FREEHAND") {
      const pts = d.points ?? [];
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.005) d.points = [...pts, p];
      d.x2 = p[0]; d.y2 = p[1];
      return;
    }
    d.x2 = p[0]; d.y2 = p[1];
  };
  const drawUp = () => {
    const d = pending.current;
    pending.current = null;
    if (!d || !under) return;
    // a freehand stroke needs a real path, not a dot; a spotlight needs a real radius, like a circle
    if (d.kind === "FREEHAND") {
      const pts = d.points ?? [];
      const len = pts.reduce((n, q, i) => (i ? n + Math.hypot(q[0] - pts[i - 1]![0], q[1] - pts[i - 1]![1]) : n), 0);
      if (pts.length < 2 || len < 0.01) return ui.say(dict.body.studio.dragToDraw);
    } else if (Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 0.01) return ui.say(dict.body.studio.dragToDraw);
    const c = under.p.clip;
    if (c.fx.drawings.length >= 12) return ui.say(dict.body.studio.tooManyDrawings);
    st.setFx(c, { ...c.fx, drawings: [...c.fx.drawings, d] }, dict.body.studio.drawnAt.replace("{a}", toolName(d.kind, dict)).replace("{b}", tc(st.playhead - under.p.start)).replace("{c}", String(under.p.index + 1)));
  };
  /** commit the text annotation being placed (Enter or leaving the field); Escape cancels it */
  const commitText = () => {
    if (textDone.current) return;
    textDone.current = true;
    const at = textAt, value = textVal.trim();
    setTextAt(null);
    if (!at || !under || !value) return;
    const c = under.p.clip;
    if (c.fx.drawings.length >= 12) return ui.say(dict.body.studio.tooManyDrawings);
    const d: Drawing = { kind: "TEXT", x1: at.nx, y1: at.ny, x2: at.nx, y2: at.ny, color: st.drawColor,
      at_ms: Math.round((st.playhead - under.p.start) / 1000), draw_ms: 600, hold_ms: 2000, text: value };
    st.setFx(c, { ...c.fx, drawings: [...c.fx.drawings, d] }, dict.body.studio.drawnAt.replace("{a}", toolName("TEXT", dict)).replace("{b}", tc(st.playhead - under.p.start)).replace("{c}", String(under.p.index + 1)));
  };

  // E5: playback and draw keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key, s = stRef.current;
      const step = (d: number) => { if (m) setMomentT((x) => Math.max(0, Math.min(total, x + d))); else s.setPlayhead(Math.max(0, Math.min(s.total, s.playhead + d))); };
      if (k === " " && !(e.target as HTMLElement).closest("button, a")) ready(play)();
      else if (k === "ArrowLeft" || k === "ArrowRight") { el.current?.pause(); step((k === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1_000_000 : 40_000)); }
      // SOT rebuild (Video players): "," / "." step one frame (40,000 µs, the same step as an unshifted arrow);
      // "[" / "]" step the speed (0.5x / 1x / 1.5x / 2x). P stays mark-out here (the I / P marks below).
      else if (k === "," || k === ".") { el.current?.pause(); step((k === "," ? -1 : 1) * 40_000); }
      else if (k === "[" || k === "]") {
        const SPEEDS = ["0.5", "1", "1.5", "2"];
        const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(speed) + (k === "[" ? -1 : 1)))];
        if (next) setSpeed(next);
      }
      else if (!e.shiftKey && (k.toLowerCase() === "j" || k.toLowerCase() === "k" || k.toLowerCase() === "l")) {
        // A.9 (ADR-071): J K L transport
        const r = jkl(k.toLowerCase() as "j" | "k" | "l", { playing: !!el.current && (!el.current.paused || !!hold.current), rate: Number(speed) });
        ready(() => {
          if (!r.play && el.current && (!el.current.paused || hold.current)) play();
          setSpeed(String(r.rate));
          if (r.backUs) step(-r.backUs);
          if (r.play && el.current?.paused && !hold.current) play();
          if (r.play) ui.say(dict.body.workspace.playingAt.replace("{a}", String(r.rate)));
        })();
      }
      else if (k === "Home") { if (m) setMomentT(0); else s.setPlayhead(0); }
      else if (k === "End") { if (m) setMomentT(total); else s.setPlayhead(s.total); }
      else if (TOOL_KEYS[k.toLowerCase()] && !e.shiftKey) {
        const t = TOOL_KEYS[k.toLowerCase()]!;
        s.setDrawTool(s.drawTool === t ? null : t);
        ui.say(s.drawTool === t ? dict.body.studio.drawingOff : dict.body.studio.toolDragHint.replace("{a}", toolName(t, dict)));
      } else if (k === "Escape" && s.drawTool) { s.setDrawTool(null); ui.say(dict.body.studio.drawingOff); }
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  // E1: I / P mark the part of a previewed Media Bin moment to add; Alt+X clears the marks
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey) return;
      const v = el.current, k = e.key.toLowerCase();
      if (e.altKey ? k !== "x" : k !== "i" && k !== "p") return;
      e.preventDefault();
      if (!m || !v) return ui.say(dict.body.studio.ioMarkHint);
      const t = Math.min(m.out_pts_us, Math.max(m.in_pts_us, Math.round(v.currentTime * 1e6)));
      if (e.altKey) { st.setMarks({}); return ui.say(dict.body.studio.marksCleared); }
      const next = k === "i" ? { ...st.marks, in: t } : { ...st.marks, out: t };
      if (next.in !== undefined && next.out !== undefined && next.out <= next.in) { if (k === "i") delete next.out; else delete next.in; }
      st.setMarks(next);
      const r = markedRange(m, next);
      ui.say(r ? dict.body.studio.markedRangeSay.replace("{a}", tc(r.in_pts_us - m.in_pts_us)).replace("{b}", tc(r.out_pts_us - m.in_pts_us)).replace("{c}", ((r.out_pts_us - r.in_pts_us) / 1e6).toFixed(1))
        : (k === "i" ? dict.body.studio.inMarkedAt : dict.body.studio.outMarkedAt).replace("{a}", tc(t - m.in_pts_us)));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  /** open a file from this computer (the SOT's "Open local footage"): it plays standalone, here, from an object URL */
  const openLocal = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (localRef.current) URL.revokeObjectURL(localRef.current);
    setLocalNow(0); setLocalDur(0);
    setLocal(URL.createObjectURL(f));
  };

  const mk = m ? markedRange(m, st.marks) : null;
  const rendered = reel ? renderedState(reel, dict).reel : null;
  const look = reel?.settings.look, lookOn = !!look && !isNeutral(look), ch = look ? lookChannels(look) : null;
  const note = local || !reel || message ? null : m ? dict.body.studio.mediaBinMoment
    : reel.stale ? dict.body.studio.noSpotlightIdentity : !path ? null
    : path.points.length === 0 ? (reel.targets.length ? dict.body.studio.noSpotlightFound : dict.body.studio.noSpotlightPlayer)
    : dict.body.studio.liveSpotlight;
  const markNote = m ? (mk ? dict.body.studio.markedSeconds.replace("{a}", ((mk.out_pts_us - mk.in_pts_us) / 1e6).toFixed(1)) : dict.body.studio.ioMark) : null;
  const chipCls = "rounded-full border px-3 py-1 text-xs font-normal";

  return (
    <section aria-label={dict.body.studio.videoPreviewCompositor} data-section="p07-s03" data-playing={playing ? "yes" : "no"}
      className="flex min-h-0 flex-col gap-2 p-3" style={{ background: "transparent", border: 0, borderRadius: 0 }}>
      <div className="relative">
      <dialog ref={fs.ref} open data-player-full={fs.on ? "on" : undefined} role="region" aria-label={dict.body.studio.reelPreviewPlayer}
        className="relative aspect-video w-full overflow-hidden rounded-md"
        style={frameStyle(fs.on, { background: url && !message ? "#000" : "#0a1a38" })}>
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
          {src && <video ref={el} src={src} preload="metadata" playsInline muted={muted} aria-label={dict.body.studio.reelPreview} data-look={lookOn ? "on" : "off"}
            onTimeUpdate={(e) => { if (localRef.current) setLocalNow(e.currentTarget.currentTime); }}
            onLoadedMetadata={(e) => { if (localRef.current) setLocalDur(e.currentTarget.duration || 0); }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", visibility: message ? "hidden" : "visible",
              filter: lookOn ? "url(#otsi-look)" : undefined }} />}
          {url && !message && under?.gap && (
            <div data-gap-black="" aria-label={dict.body.studio.gapBeforeClip} className="t-body absolute inset-0 z-[4] flex items-end justify-center bg-black pb-4 text-muted"
              style={{ pointerEvents: "none" }}>{dict.body.studio.gapSeconds.replace("{a}", (under.p.gap / 1e6).toFixed(1))}</div>
          )}
          {url && <canvas ref={glow} aria-hidden data-spotlight-light
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", mixBlendMode: "plus-lighter", visibility: message ? "hidden" : "visible" }} />}
          {url && <canvas ref={canvas} aria-hidden data-spotlight-preview={spot ? "on" : "off"}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", visibility: message ? "hidden" : "visible" }} />}
          {url && <canvas ref={ink} aria-hidden data-preview-ink
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", visibility: message ? "hidden" : "visible" }} />}
        </div>
        {drawing && <div data-draw-surface={st.drawTool} aria-label={dict.body.studio.drawOnPicture.replace("{a}", toolName(st.drawTool!, dict))} onPointerDown={drawDown} onPointerMove={drawMove}
          onPointerUp={drawUp} onPointerCancel={() => { pending.current = null; }} style={{ position: "absolute", inset: 0, cursor: "crosshair", touchAction: "none", zIndex: 2 }}>
          {textAt && (
            <input autoFocus value={textVal} onChange={(e) => setTextVal(e.target.value)} placeholder={dict.body.studio.csTextPlaceholder}
              aria-label={dict.body.studio.csToolText}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitText(); } else if (e.key === "Escape") setTextAt(null); }}
              onBlur={() => commitText()}
              style={{ position: "absolute", left: textAt.dx, top: textAt.dy, transform: "translate(-50%, -50%)", minWidth: 140, zIndex: 3,
                padding: "4px 8px", borderRadius: 4, border: "1px solid rgb(var(--primary))", background: "rgba(6,22,48,.92)", color: "#fff", fontSize: 14, outline: "none" }} />
          )}
        </div>}
        {message && (src ? (
          <p className="t-panel absolute inset-0 z-10 grid place-items-center px-4 text-center text-[#dbe8f8]">{message}</p>
        ) : (
          <div className="absolute inset-0 z-10 grid place-items-center px-4 text-center">
            <div className="flex max-w-[420px] flex-col items-center gap-2">
              {/* SOT (Studio.dc.html): the empty state starts with a 48px dashed icon tile. */}
              <span className="grid h-12 w-12 place-items-center rounded-xl border border-dashed border-line2 text-muted" aria-hidden="true">
                <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9.5v5l4-2.5z" />
                </svg>
              </span>
              <p className="t-panel text-[#dbe8f8]">{dict.body.reels.rbNoFootage}</p>
              <p className="t-small text-muted">{dict.body.reels.rbOpenLocal}</p>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <button type="button" className="vie-btn" onClick={ready(play)}>
                  <Play className="h-4 w-4" />{dict.body.processing.playBtn}
                </button>
                <label className="vie-btn vie-btn-pri cursor-pointer">
                  <Upload className="h-4 w-4" />{dict.desktop.openLocal}
                  <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="sr-only" onChange={openLocal} />
                </label>
              </div>
            </div>
          </div>
        ))}
        {(note || markNote || (rendered && !message)) && (
          <div data-preview-note className="pointer-events-none absolute left-3.5 top-3 z-10 flex gap-2">
            {note && <span title={dict.body.studio.previewFollowsNote} className={chipCls}
              style={{ background: "rgba(6,22,48,.78)", borderColor: "#f5d27a", color: "#ffe6a8" }}>{note}</span>}
            {markNote && !message && <span data-mark-note className={chipCls} style={{ background: "rgba(6,22,48,.78)", borderColor: "#f5b82e", color: "#ffe6a8" }}>{markNote}</span>}
            {rendered && !message && <span data-rendered={rendered.state} title={rendered.why} className={chipCls}
              style={{ background: "rgba(6,22,48,.78)", borderColor: rendered.state === "RENDERED" ? "#3ecf7a" : "#ffb86b",
                color: rendered.state === "RENDERED" ? "#bff5d4" : "#ffd9b0" }}>
              {rendered.state === "RENDERED" ? dict.body.studio.renderedMatches : rendered.state === "NEVER" ? dict.body.studio.notRenderedYet : dict.body.studio.changedSinceRender}</span>}
          </div>
        )}
        <span className="t-tc absolute right-2 top-2 z-10 rounded border bg-black/80 px-2 py-0.5" style={{ borderColor: "#f5b82e", color: "#f5b82e" }}>{quality(video?.height)}</span>
        {fs.on && <FullscreenBar playing={playing} onPlay={ready(play)} now={now} total={total} onSeek={seekFrac}
          muted={muted} onMute={() => setMuted((x) => !x)} onExit={fs.exit} />}
      </dialog>
      </div>

      {/* the SOT's control bar (Studio.dc.html .vpc): play, back and forward one second, time, seek, speed, fullscreen */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" aria-label={playing ? dict.body.upload.pause : dict.body.processing.playBtn} onClick={ready(play)} className="vie-btn vie-btn-sm px-2">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button type="button" aria-label={dict.desktop.back1} onClick={() => ready(() => nudge1(-1))()} className="vie-btn vie-btn-sm px-2" title={dict.desktop.back1}>
          <SkipBack className="h-4 w-4" />
        </button>
        <button type="button" aria-label={dict.desktop.fwd1} onClick={() => ready(() => nudge1(1))()} className="vie-btn vie-btn-sm px-2" title={dict.desktop.fwd1}>
          <SkipForward className="h-4 w-4" />
        </button>
        <span className="t-tc shrink-0" style={{ minWidth: 96 }}>{tc(now)} <span className="text-muted">/ {total ? tc(total) : "--:--"}</span></span>
        <input type="range" min={0} max={1000} value={Math.round(p * 1000)} disabled={!can} aria-label={dict.body.studio.previewPosition}
          onChange={(e) => { const f = Number(e.target.value) / 1000; if (can) seekFrac(f); else ready(() => undefined)(); }}
          className="h-6 min-w-24 flex-1 cursor-pointer accent-[#33a8ff]" />
        <select aria-label={dict.body.studio.previewSpeed} value={speed} onChange={(e) => setSpeed(e.target.value)}
          className="t-body h-9 rounded-ctl border border-line2 bg-canvas px-2">
          {["0.25", "0.5", "1", "1.5", "2"].map((v) => <option key={v} value={v}>{v}x</option>)}
        </select>
        <button type="button" aria-label={fs.on ? dict.body.studio.exitFullScreen : dict.body.processing.fullScreen} aria-pressed={fs.on} onClick={ready(fs.toggle)} className="vie-btn vie-btn-sm px-2">
          <Expand className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
