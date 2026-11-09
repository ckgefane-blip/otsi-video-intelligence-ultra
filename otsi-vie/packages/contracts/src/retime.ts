/**
 * E2 (ADR-065): a clip's speed effect and how it maps reel time to source time. The renderer (services/worker/vie_worker/render/reel.py,
 * retime_segments) follows the same rules; Clip Studio uses them for the timeline lengths and the preview.
 *
 *   NONE    the clip plays at its own speed
 *   SLOW    the whole clip at `speed` (0.25 .. 0.75)
 *   FREEZE  the picture stops at the key moment `at_us` for `hold_ms` (0.5 .. 3 s), the spotlight held on the player, then plays on
 *   RAMP    "hero ramp": eases down to `speed` at the key moment and back up, over one second either side (8 steps)
 *
 * The key moment is a source time inside the clip. When a trim leaves it outside, the effect is kept but does nothing (inactive) until
 * the person sets it again or trims back; an undo of the trim brings it back.
 */
import { z } from "zod";

export const ClipEffectKind = z.enum(["NONE", "SLOW", "FREEZE", "RAMP"]);
export type ClipEffectKind = z.infer<typeof ClipEffectKind>;
export const ClipEffect = z.object({
  kind: ClipEffectKind,
  /** the key moment (source time) of a FREEZE or RAMP */
  at_us: z.number().int().nullable(),
  /** SLOW: the clip's speed; RAMP: the slowest speed, at the key moment; 1 otherwise */
  speed: z.number().min(0.25).max(1),
  /** FREEZE: how long the picture stops; 0 otherwise */
  hold_ms: z.number().int().min(0).max(3000),
});
export type ClipEffect = z.infer<typeof ClipEffect>;
export const NO_EFFECT: ClipEffect = { kind: "NONE", at_us: null, speed: 1, hold_ms: 0 };
export const SLOW_SPEEDS = [0.5, 0.25] as const;
export const RAMP_SPEED_DEFAULT = 0.35, FREEZE_MS_DEFAULT = 1500, FREEZE_MS_MIN = 500, FREEZE_MS_MAX = 3000;
export const RAMP_HALF_US = 1_000_000, RAMP_STEPS = 8;

/** PATCH /v1/reels/:id/clips/:clipId/effect */
export const SetClipEffectRequest = z.object({
  kind: ClipEffectKind,
  at_us: z.number().int().min(0).nullable().default(null),
  speed: z.number().min(0.25).max(1).default(1),
  hold_ms: z.number().int().min(0).max(FREEZE_MS_MAX).default(0),
}).superRefine((e, ctx) => {
  if ((e.kind === "FREEZE" || e.kind === "RAMP") && e.at_us === null) ctx.addIssue({ code: "custom", path: ["at_us"], message: "a freeze or ramp needs its key moment" });
  if ((e.kind === "SLOW" || e.kind === "RAMP") && e.speed > 0.75) ctx.addIssue({ code: "custom", path: ["speed"], message: "slow motion is at most 0.75x" });
  if (e.kind === "FREEZE" && e.hold_ms < FREEZE_MS_MIN) ctx.addIssue({ code: "custom", path: ["hold_ms"], message: "a freeze holds 0.5 to 3 s" });
});
export type SetClipEffectRequest = z.infer<typeof SetClipEffectRequest>;

/** the stored form of a request: the fields its kind does not use are reset */
export function normaliseEffect(e: SetClipEffectRequest): ClipEffect {
  if (e.kind === "NONE") return NO_EFFECT;
  if (e.kind === "SLOW") return { kind: "SLOW", at_us: null, speed: e.speed, hold_ms: 0 };
  if (e.kind === "FREEZE") return { kind: "FREEZE", at_us: e.at_us, speed: 1, hold_ms: e.hold_ms };
  return { kind: "RAMP", at_us: e.at_us, speed: e.speed, hold_ms: 0 };
}

/** a stretch of the clip: source a..b played at `speed`, or (hold_us > 0) the picture at a held for hold_us */
export interface RetimeSeg { a: number; b: number; speed: number; hold_us: number }
interface Timed { in_pts_us: number; out_pts_us: number; effect?: ClipEffect | null | undefined }

/** whether the effect changes anything: SLOW always, FREEZE / RAMP while the key moment is inside the clip */
export function effectActive(c: Timed): boolean {
  const e = c.effect;
  if (!e || e.kind === "NONE") return false;
  if (e.kind === "SLOW") return e.speed < 1;
  return e.at_us !== null && e.at_us > c.in_pts_us && e.at_us < c.out_pts_us;
}

export function retimeSegments(c: Timed): RetimeSeg[] {
  const a = c.in_pts_us, b = c.out_pts_us, e = c.effect;
  if (!e || !effectActive(c)) return [{ a, b, speed: 1, hold_us: 0 }];
  if (e.kind === "SLOW") return [{ a, b, speed: e.speed, hold_us: 0 }];
  const t = e.at_us!;
  if (e.kind === "FREEZE") return [{ a, b: t, speed: 1, hold_us: 0 }, { a: t, b: t, speed: 1, hold_us: e.hold_ms * 1000 }, { a: t, b, speed: 1, hold_us: 0 }];
  const lo = Math.max(a, t - RAMP_HALF_US), hi = Math.min(b, t + RAMP_HALF_US), step = (2 * RAMP_HALF_US) / RAMP_STEPS;
  const out: RetimeSeg[] = lo > a ? [{ a, b: lo, speed: 1, hold_us: 0 }] : [];
  for (let k = 0; k < RAMP_STEPS; k++) {
    const x0 = Math.max(lo, t - RAMP_HALF_US + k * step), x1 = Math.min(hi, t - RAMP_HALF_US + (k + 1) * step);
    if (x1 > x0) out.push({ a: x0, b: x1, speed: 1 - (1 - e.speed) * Math.sin((Math.PI * (k + 0.5)) / RAMP_STEPS) ** 2, hold_us: 0 });
  }
  if (b > hi) out.push({ a: hi, b, speed: 1, hold_us: 0 });
  return out;
}

export const segOutUs = (s: RetimeSeg) => (s.hold_us > 0 ? s.hold_us : (s.b - s.a) / s.speed);

/** B.19 (ADR-094): the spacer before a clip (black and silence), in reel microseconds */
export function gapUs(c: { fx?: { gap_ms?: number } | null }): number {
  return Math.max(0, Math.round(c.fx?.gap_ms ?? 0)) * 1000;
}
/** the clip's place in the reel: its spacer and its own (retimed) length */
export function slotUs(c: Timed & { fx?: { gap_ms?: number } | null }): number {
  return gapUs(c) + clipOutputUs(c);
}

/** the clip's length in the reel (without its spacer: see slotUs) */
export function clipOutputUs(c: Timed): number {
  return Math.round(retimeSegments(c).reduce((n, s) => n + segOutUs(s), 0));
}

/** the source time shown at output offset o (from the clip's start), with the speed it plays at (0 while frozen) */
export function srcAt(c: Timed, o: number): { src: number; speed: number } {
  let t = 0;
  const segs = retimeSegments(c);
  for (const s of segs) {
    const d = segOutUs(s);
    if (o < t + d) return s.hold_us > 0 ? { src: s.a, speed: 0 } : { src: s.a + (o - t) * s.speed, speed: s.speed };
    t += d;
  }
  return { src: c.out_pts_us, speed: segs[segs.length - 1]!.speed };
}

/** the output offset (from the clip's start) at which source time src plays (the start of a freeze when src is its moment) */
export function outAt(c: Timed, src: number): number {
  let t = 0;
  for (const s of retimeSegments(c)) {
    if (s.hold_us > 0) { if (src > s.a) t += s.hold_us; continue; }
    if (src <= s.b) return t + Math.max(0, src - s.a) / s.speed;
    t += (s.b - s.a) / s.speed;
  }
  return t;
}

/** where the strap (lower third) and the event caption start, as an output offset: one second before the key moment, else at 0 */
export function strapStartUs(c: Timed): number {
  const e = c.effect;
  if (!e || (e.kind !== "FREEZE" && e.kind !== "RAMP") || !effectActive(c)) return 0;
  return Math.max(0, outAt(c, e.at_us!) - 1_000_000);
}
