"use client";
/**
 * v3 Phase B.14 (ADR-090): the Reel Builder's live spotlight and coverage bar.
 *
 * LiveSpotlight draws the beam over the source clip in the preview with the look being edited (the sliders' unsaved values), using the
 * Clip Studio compositor (studio/spotlight.ts, the renderer's own rules) and the confirmed player's analysis positions (GET /v1/reels/:id/path).
 * CoverageBar shows, on the seek bar, where in the selected clip the player was seen (light) and not seen (dark), and the share seen.
 * Honest: the preview follows the analysis positions only; the render's dense re-analysis (Auto Track) can light frames the preview leaves
 * dark. Where he was not seen, nothing is drawn (unknown beats wrong).
 */
import type { Reel, ReelClip, ReelPath, SpotlightSettings } from "@otsi-vie/contracts";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { B, u } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { CROP_LOOKAHEAD_US, SpotlightPreview, boxAt, fitRect, smoothPath, strengthAt, visibleRuns } from "@/components/studio/spotlight";

const FRAME_US = 40_000;

/** the bridging gap for a lock setting, the same as the API's path (reels.ts) and the renderer */
export function maxInterpFor(lock: number): number {
  const l = Math.min(1, Math.max(0, lock));
  return Math.max(Math.round((0.3 + 0.6 * l) * 1000) / 1000, 0.6);
}

/** D: detected (positions at the analysis's normal sampling, each a detection); I: interpolated (a longer gap bridged, or a position that
 *  was not a detection) */
export type CoverKind = "D" | "I";
export interface Coverage { seen: number; detected: number; parts: [number, number, CoverKind][] }

function union(xs: [number, number][]): [number, number][] {
  const s = [...xs].sort((a, b) => a[0] - b[0]), out: [number, number][] = [];
  for (const [a, b] of s) { const l = out[out.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]); }
  return out;
}

/** where in [inUs, outUs] the player has a box, split into detected and interpolated stretches (fractions of the clip), and the shares */
export function clipCoverage(points: ReelPath["points"], inUs: number, outUs: number, maxInterpS: number): Coverage {
  const len = outUs - inUs;
  if (len <= 0 || !points.length) return { seen: 0, detected: 0, parts: [] };
  const pts = [...points].sort((a, b) => a.pts_us - b.pts_us), maxUs = maxInterpS * 1e6;
  const gaps = pts.slice(1).map((p, i) => p.pts_us - pts[i]!.pts_us).filter((g) => g > 0 && g <= maxUs).sort((a, b) => a - b);
  const normal = Math.max(FRAME_US, (gaps[Math.floor(gaps.length / 2)] ?? FRAME_US) * 1.5);   // the analysis's own sampling step
  const det = (p: (typeof pts)[number]) => !p.state || p.state === "DETECTED";
  const d: [number, number][] = [], all: [number, number][] = [];
  for (const [i, p] of pts.entries()) {
    const stub: [number, number] = [p.pts_us - FRAME_US / 2, p.pts_us + FRAME_US / 2];
    all.push(stub); if (det(p)) d.push(stub);
    const q = pts[i + 1];
    if (q && q.pts_us - p.pts_us <= maxUs) { all.push([p.pts_us, q.pts_us]); if (det(p) && det(q) && q.pts_us - p.pts_us <= normal) d.push([p.pts_us, q.pts_us]); }
  }
  const clip = (xs: [number, number][]) => union(xs).map(([a, b]) => [Math.max(a, inUs), Math.min(b, outUs)] as [number, number]).filter(([a, b]) => b > a);
  const seenRuns = clip(all), detRuns = clip(d);
  const total = (xs: [number, number][]) => xs.reduce((s, [a, b]) => s + b - a, 0);
  const frac = (x: number) => (x - inUs) / len;
  // the interpolated stretches: seen minus detected
  const parts: [number, number, CoverKind][] = [];
  for (const [a, b] of seenRuns) {
    let at = a;
    for (const [c, e] of detRuns) {
      if (e <= a || c >= b) continue;
      if (c > at) parts.push([frac(at), frac(c), "I"]);
      parts.push([frac(Math.max(c, a)), frac(Math.min(e, b)), "D"]);
      at = Math.min(e, b);
    }
    if (at < b) parts.push([frac(at), frac(b), "I"]);
  }
  return { seen: Math.min(1, total(seenRuns) / len), detected: Math.min(1, total(detRuns) / len), parts };
}

/** the confirmed player's analysis positions in the reel's clips, fetched again when the reel changes */
export function useReelPath(reel: Reel | null): ReelPath | null {
  const [path, setPath] = useState<ReelPath | null>(null);
  const id = reel?.id, version = reel?.version;
  useEffect(() => {
    setPath(null);
    if (!id) return;
    let live = true;
    void api<ReelPath>(`/v1/reels/${id}/path`).then((x) => { if (live) setPath(x); }, () => undefined);
    return () => { live = false; };
  }, [id, version]);
  return path;
}

export function LiveSpotlight({ video, path, reel, clip, settings, on }: {
  video: RefObject<HTMLVideoElement | null>; path: ReelPath | null; reel: Reel; clip: ReelClip | null; settings: SpotlightSettings; on: boolean;
}) {
  const dark = useRef<HTMLCanvasElement | null>(null), light = useRef<HTMLCanvasElement | null>(null);
  const live = on && !!clip && !!path && path.points.length > 0;
  const maxI = maxInterpFor(settings.lock);
  const steady = useMemo(() => (path ? smoothPath(path.points, maxI) : []), [path, maxI]);
  const look = useRef(settings);
  look.current = settings;                                            // the newest slider values, without restarting the loop
  useEffect(() => {
    const c = dark.current, g = light.current, v = video.current;
    if (!live || !c || !g || !v || !path || !clip) { for (const x of [c, g]) x?.getContext("2d")?.clearRect(0, 0, x.width, x.height); return; }
    const sp = new SpotlightPreview();
    const runs = visibleRuns(path.points, FRAME_US, maxI);
    let shown: number | null = null, vfc = 0;
    const onFrame = (_: number, meta: { mediaTime: number }) => { shown = meta.mediaTime; vfc = v.requestVideoFrameCallback(onFrame); };
    if ("requestVideoFrameCallback" in v) vfc = v.requestVideoFrameCallback(onFrame);
    const caption = reel.player ? (reel.player.canonical_otsi_id ? `${reel.player.display_name}  ·  ${reel.player.canonical_otsi_id}` : reel.player.display_name) : null;
    let raf = 0, last = "", lastLook: SpotlightSettings | null = null;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const parent = c.parentElement!, W = parent.clientWidth, H = parent.clientHeight;
      const tNow = !v.paused && shown !== null ? shown : v.currentTime;
      const dpr = window.devicePixelRatio || 1, key = `${tNow}|${W}|${H}|${dpr}`;
      if (v.paused && key === last && lastLook === look.current) return;
      last = key; lastLook = look.current;
      for (const x of [c, g]) if (x.width !== Math.round(W * dpr) || x.height !== Math.round(H * dpr)) { x.width = Math.round(W * dpr); x.height = Math.round(H * dpr); }
      const t = Math.round(tNow * 1e6);
      const inClip = t >= clip.in_pts_us && t <= clip.out_pts_us;
      const seen = boxAt(path.points, t, FRAME_US, maxI).state !== "MISSING";
      const b = inClip && seen ? boxAt(steady, t, FRAME_US, maxI).box : null;
      const ahead = inClip ? boxAt(steady, t + CROP_LOOKAHEAD_US, FRAME_US, maxI).box : null;
      const ctx = c.getContext("2d")!, add = g.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); add.setTransform(dpr, 0, 0, dpr, 0, 0);
      sp.draw(ctx, add, fitRect(W, H, v.videoWidth, v.videoHeight, false), b, inClip ? strengthAt(runs, t) : 0, look.current, caption, reel.aspect,
        v.videoWidth, v.videoHeight, now, ahead);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); if (vfc && "cancelVideoFrameCallback" in v) v.cancelVideoFrameCallback(vfc); };
  }, [live, path, steady, reel, clip, maxI, video]);
  return (
    <>
      <canvas ref={light} aria-hidden data-spotlight-light style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", mixBlendMode: "plus-lighter" }} />
      <canvas ref={dark} aria-hidden data-spotlight-preview={live ? "on" : "off"} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
    </>
  );
}

/** the note under the picture: what the preview shows, and how much of the clip the player was seen */
export function spotlightNote(reel: Reel, path: ReelPath | null, clip: ReelClip | null, lock: number): { text: string; seen: number | null } | null {
  if (!clip) return null;
  if (reel.stale) return { text: "No spotlight preview: a followed identity changed. Re-detect the player.", seen: null };
  if (!path) return null;
  if (!reel.targets.length) return { text: "No spotlight preview: no confirmed player to follow", seen: null };
  const cov = clipCoverage(path.points, clip.in_pts_us, clip.out_pts_us, maxInterpFor(lock));
  const pct = Math.round(cov.seen * 100), dp = Math.round(cov.detected * 100);
  return { text: pct === 0 ? "Live spotlight · the player was not found in this clip"
    : `Live spotlight · approximate · player seen in ${pct}% of this clip${dp < pct ? ` (${dp}% detected, the rest bridged)` : ""}`, seen: cov.seen };
}

/** on the seek bar (the plan's coverage bar): solid where he was detected, hatched where a gap is bridged (interpolated), empty where unseen */
export function CoverageBar({ path, clip, lock }: { path: ReelPath | null; clip: ReelClip | null; lock: number }) {
  if (!path || !clip) return null;
  const cov = clipCoverage(path.points, clip.in_pts_us, clip.out_pts_us, maxInterpFor(lock));
  const pct = Math.round(cov.seen * 100), dp = Math.round(cov.detected * 100);
  return (
    <B x={836} y={829} w={777} h={7} data-coverage={pct} data-detected={dp} aria-label={`Player detected in ${dp}% of this clip (solid), bridged in ${pct - dp}% (hatched), not seen in ${100 - pct}% (empty)`}
      style={{ background: "transparent", border: `${u(1)} solid #2c4a6e`, borderRadius: u(2), overflow: "hidden", boxSizing: "border-box" }}>
      {cov.parts.map(([a, b, k]) => <i key={`${k}${a}`} data-seen-part={k} style={{ position: "absolute", top: 0, bottom: 0, left: `${a * 100}%`, width: `${Math.max(0.3, (b - a) * 100)}%`,
        background: k === "D" ? "#3ee6a8" : "repeating-linear-gradient(135deg,#3ee6a8 0 2px,transparent 2px 5px)" }} />)}
    </B>
  );
}
