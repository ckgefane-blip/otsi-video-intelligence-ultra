/**
 * E4 (ADR-067) "Faster assembly": the reel built from the engine's moments of the confirmed player, by rules a person can read.
 *
 * - Candidates: from a length and a theme, up to three draft reels (Best moments, Match story, Every touch), each with what it holds and why.
 * - Template slots: a template can keep a reel's structure (per clip: what kind of moment, how long, its speed effect); applied to another
 *   reel, every slot is filled with the best unused moment of that kind of that reel's player. A slot with no such moment is left out and
 *   named (unknown beats wrong: never another kind of moment in its place).
 *
 * Pure functions, shared by the API (which computes and stores) and the web tests. Only the engine's recorded moments are used.
 */
import { z } from "zod";
import type { MomentEvent, ReelMoment } from "./reels";
import { ClipEffectKind, NO_EFFECT, RAMP_SPEED_DEFAULT, clipOutputUs, type ClipEffect } from "./retime";

/** the kinds of moment a slot or a theme asks for */
export const MomentFamily = z.enum(["GOAL", "SHOT", "CHANCE", "DEFENDING", "SET_PIECE", "PASSING", "ON_CAMERA", "ANY_ACTION"]);
export type MomentFamily = z.infer<typeof MomentFamily>;
export const FAMILY_EVENTS: Record<Exclude<MomentFamily, "ON_CAMERA" | "ANY_ACTION">, MomentEvent[]> = {
  GOAL: ["GOAL", "FREE_KICK_GOAL", "PENALTY_GOAL"],
  SHOT: ["SHOT"],
  CHANCE: ["KEY_PASS"],
  DEFENDING: ["TACKLE", "INTERCEPTION", "BALL_WON", "PRESSURE_REGAIN", "PRESSURE"],
  SET_PIECE: ["PENALTY", "FREE_KICK", "CORNER", "SET_PIECE", "THROW_IN", "GOAL_KICK", "KICK_OFF"],
  PASSING: ["PASS", "PASS_RECEIVED"],
};
export const FAMILY_WORDS: Record<MomentFamily, string> = {
  GOAL: "a goal", SHOT: "a shot", CHANCE: "a key pass", DEFENDING: "defending", SET_PIECE: "a set piece", PASSING: "a pass",
  ON_CAMERA: "on camera, no action", ANY_ACTION: "any action",
};

/** what the reel is about */
export const ReelTheme = z.enum(["BEST", "ATTACK", "DEFENCE", "SET_PIECES", "ALL"]);
export type ReelTheme = z.infer<typeof ReelTheme>;
export const THEME_WORDS: Record<ReelTheme, string> = {
  BEST: "His best actions", ATTACK: "Attacking", DEFENCE: "Defending", SET_PIECES: "Set pieces", ALL: "Everything (also on camera without an action)",
};
const THEME_EVENTS: Record<Exclude<ReelTheme, "BEST" | "ALL">, MomentEvent[]> = {
  ATTACK: [...FAMILY_EVENTS.GOAL, ...FAMILY_EVENTS.SHOT, ...FAMILY_EVENTS.CHANCE, ...FAMILY_EVENTS.PASSING],
  DEFENCE: FAMILY_EVENTS.DEFENDING,
  SET_PIECES: [...FAMILY_EVENTS.SET_PIECE, "FREE_KICK_GOAL", "PENALTY_GOAL"],
};

export const CandidateKey = z.enum(["TOP", "STORY", "EVERY"]);
export type CandidateKey = z.infer<typeof CandidateKey>;
const CANDIDATE: Record<CandidateKey, { title: string; how: string; max_us: number }> = {
  TOP: { title: "Best moments", how: "His best moments, shown in match order; the best one gets a hero ramp.", max_us: 15_000_000 },
  STORY: { title: "Match story", how: "Moments spread across the whole match, in order: how his game went.", max_us: 10_000_000 },
  EVERY: { title: "Every touch", how: "Short, quick cuts of as many of his actions as fit.", max_us: 5_000_000 },
};

/** one slot of a template: the kind of moment, at most how long, and its speed effect (set at the moment's key time) */
export const TemplateSlot = z.object({
  family: MomentFamily,
  max_s: z.number().min(2).max(20),
  effect: ClipEffectKind.default("NONE"),
  speed: z.number().min(0.25).max(1).default(1),
  hold_ms: z.number().int().min(0).max(3000).default(0),
});
export type TemplateSlot = z.infer<typeof TemplateSlot>;
export const ReelStructure = z.object({ slots: z.array(TemplateSlot).min(1).max(40) });
export type ReelStructure = z.infer<typeof ReelStructure>;

export interface AssembledClip {
  in_pts_us: number; out_pts_us: number; label: string; kind: "EVENT" | "VISIBLE"; events: MomentEvent[]; key_at_us: number | null; effect: ClipEffect;
}

const inFamily = (f: MomentFamily, m: ReelMoment) =>
  f === "ON_CAMERA" ? m.kind === "VISIBLE" : f === "ANY_ACTION" ? m.kind === "EVENT" : m.kind === "EVENT" && m.events.some((e) => FAMILY_EVENTS[f].includes(e));

/** the family of a moment: its best event's, or ON_CAMERA */
export function familyOf(m: Pick<ReelMoment, "kind" | "events">): MomentFamily {
  if (m.kind === "VISIBLE" || !m.events.length) return "ON_CAMERA";
  const e = m.events[0]!;
  return (Object.keys(FAMILY_EVENTS) as (keyof typeof FAMILY_EVENTS)[]).find((f) => FAMILY_EVENTS[f].includes(e)) ?? "ANY_ACTION";
}

const inTheme = (t: ReelTheme, m: ReelMoment) =>
  t === "ALL" ? true : m.kind !== "EVENT" ? false : t === "BEST" ? true : m.events.some((e) => THEME_EVENTS[t].includes(e));

/** the part of a moment that fits max_us, around its key time (a little more before it than after) */
export function fitMoment(m: Pick<ReelMoment, "in_pts_us" | "out_pts_us" | "key_at_us">, maxUs: number): [number, number] {
  if (m.out_pts_us - m.in_pts_us <= maxUs) return [m.in_pts_us, m.out_pts_us];
  const k = m.key_at_us ?? (m.in_pts_us + m.out_pts_us) / 2;
  const a = Math.round(Math.min(Math.max(k - 0.55 * maxUs, m.in_pts_us), m.out_pts_us - maxUs));
  return [a, a + maxUs];
}

const MARGIN_US = 300_000;
/** a slot's effect on a clip; a freeze or ramp needs the key time inside the clip, else none */
function effectFor(kind: ClipEffectKind, speed: number, holdMs: number, a: number, b: number, key: number | null): ClipEffect {
  if (kind === "NONE") return NO_EFFECT;
  if (kind === "SLOW") return { kind: "SLOW", at_us: null, speed: Math.min(0.75, speed), hold_ms: 0 };
  if (key === null || key <= a + MARGIN_US || key >= b - MARGIN_US) return NO_EFFECT;
  return kind === "FREEZE" ? { kind: "FREEZE", at_us: key, speed: 1, hold_ms: Math.max(500, holdMs || 1500) } : { kind: "RAMP", at_us: key, speed: Math.min(0.75, speed), hold_ms: 0 };
}

const clipOf = (m: ReelMoment, maxUs: number): AssembledClip => {
  const [a, b] = fitMoment(m, maxUs);
  return { in_pts_us: a, out_pts_us: b, label: m.label, kind: m.kind, events: m.events, key_at_us: m.key_at_us, effect: NO_EFFECT };
};
const lenOf = (c: AssembledClip) => clipOutputUs(c);
const byScore = (x: ReelMoment, y: ReelMoment) => y.score - x.score || y.visible_us - x.visible_us || x.in_pts_us - y.in_pts_us;

export interface Candidate {
  key: CandidateKey; title: string; why: string; clips: AssembledClip[]; duration_us: number; score: number; short: boolean;
}

/** what a list of clips holds, in words: "1 goal, 2 shots, 3 defending" */
export function summarise(clips: Pick<AssembledClip, "kind" | "events">[]): string {
  const n = new Map<MomentFamily, number>();
  for (const c of clips) { const f = familyOf(c); n.set(f, (n.get(f) ?? 0) + 1); }
  const many: Partial<Record<MomentFamily, string>> = { GOAL: "goals", SHOT: "shots", CHANCE: "key passes", SET_PIECE: "set pieces", PASSING: "passes" };
  const word = (f: MomentFamily, k: number) => (f === "ON_CAMERA" ? `${k} on camera` : f === "DEFENDING" ? `${k} defending` : f === "ANY_ACTION" ? `${k} other`
    : `${k} ${k === 1 ? FAMILY_WORDS[f].replace(/^an? /, "") : many[f]}`);
  return MomentFamily.options.filter((f) => n.has(f)).map((f) => word(f, n.get(f)!)).join(", ");
}

/** Up to three draft reels from the player's moments: about target_us long (never more than 10 % over), in match order. */
export function buildCandidates(moments: ReelMoment[], targetUs: number, theme: ReelTheme): Candidate[] {
  const pool = moments.filter((m) => inTheme(theme, m)).sort(byScore);
  if (!pool.length) return [];
  const limit = targetUs * 1.1;
  const take = (key: CandidateKey, order: ReelMoment[]) => {
    const out: { m: ReelMoment; c: AssembledClip }[] = [];
    let sum = 0;
    for (const m of order) {
      if (sum >= targetUs * 0.95) break;
      if (out.some((x) => x.m === m)) continue;
      const c = clipOf(m, CANDIDATE[key].max_us);
      if (sum + lenOf(c) > limit) continue;
      out.push({ m, c }); sum += lenOf(c);
    }
    return out;
  };
  const result: Candidate[] = [];
  const seen = new Set<string>();
  for (const key of CandidateKey.options) {
    let order = pool;
    if (key === "STORY") {                         // the best moment of each stretch of the match first, then the rest by rank
      const n = Math.min(12, Math.max(3, Math.round(targetUs / 10_000_000)));
      const lo = Math.min(...pool.map((m) => m.in_pts_us)), hi = Math.max(...pool.map((m) => m.out_pts_us)), w = Math.max(1, (hi - lo) / n);
      const at = (m: ReelMoment) => m.key_at_us ?? (m.in_pts_us + m.out_pts_us) / 2;
      const firsts: ReelMoment[] = [];
      for (let i = 0; i < n; i++) { const best = pool.find((m) => Math.min(n - 1, Math.floor((at(m) - lo) / w)) === i); if (best) firsts.push(best); }
      order = [...firsts, ...pool.filter((m) => !firsts.includes(m))];
    }
    const chosen = take(key, order);
    if (!chosen.length) continue;
    if (key === "TOP") {                           // the hero ramp on his best moment, if it still fits
      const best = chosen[0]!.c, fx = effectFor("RAMP", RAMP_SPEED_DEFAULT, 0, best.in_pts_us, best.out_pts_us, best.key_at_us);
      const sum = chosen.reduce((s, x) => s + lenOf(x.c), 0);
      if (fx.kind !== "NONE" && sum - lenOf(best) + lenOf({ ...best, effect: fx }) <= limit) best.effect = fx;
    }
    const clips = chosen.map((x) => x.c).sort((x, y) => x.in_pts_us - y.in_pts_us);
    const sig = clips.map((c) => `${c.in_pts_us}-${c.out_pts_us}`).join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    const duration = clips.reduce((s, c) => s + lenOf(c), 0);
    const short = duration < targetUs * 0.8;
    result.push({ key, title: CANDIDATE[key].title, clips, duration_us: duration, score: chosen.reduce((s, x) => s + x.m.score, 0), short,
      why: `${clips.length} clip${clips.length === 1 ? "" : "s"}: ${summarise(clips)}. ${CANDIDATE[key].how}${short ? " There is not enough of his play for the full length." : ""}` });
  }
  return result;
}

/** A template's slots from a reel: per clip (in order) the kind of moment it shows, its length and its speed effect. */
export function slotsFromClips(clips: { in_pts_us: number; out_pts_us: number; effect: ClipEffect }[], moments: ReelMoment[]): TemplateSlot[] {
  return clips.map((c) => {
    let best: ReelMoment | null = null, overlap = 0;
    for (const m of moments) {
      const o = Math.min(c.out_pts_us, m.out_pts_us) - Math.max(c.in_pts_us, m.in_pts_us);
      if (o > overlap) { overlap = o; best = m; }
    }
    return TemplateSlot.parse({ family: best ? familyOf(best) : "ANY_ACTION", max_s: Math.min(20, Math.max(2, Math.round((c.out_pts_us - c.in_pts_us) / 1e5) / 10)),
      effect: c.effect.kind, speed: c.effect.speed, hold_ms: c.effect.hold_ms });
  });
}

/** Fill a template's slots with the best unused moments of each kind; slots that cannot be filled are named. At most maxUs in all. */
export function fillSlots(slots: TemplateSlot[], moments: ReelMoment[], maxUs: number): { clips: AssembledClip[]; left_out: string[] } {
  const used = new Set<ReelMoment>(), clips: AssembledClip[] = [], left: string[] = [];
  let sum = 0;
  slots.forEach((s, i) => {
    const m = moments.filter((x) => !used.has(x) && inFamily(s.family, x)).sort(byScore)[0];
    if (!m) { left.push(`slot ${i + 1} (${FAMILY_WORDS[s.family]}): none of his in this match`); return; }
    const c = clipOf(m, s.max_s * 1e6);
    c.effect = effectFor(s.effect, s.speed, s.hold_ms, c.in_pts_us, c.out_pts_us, c.key_at_us);
    if (sum + lenOf(c) > maxUs) { left.push(`slot ${i + 1} (${FAMILY_WORDS[s.family]}): the reel would be longer than 10 minutes`); return; }
    if (s.effect !== "NONE" && c.effect.kind === "NONE") left.push(`slot ${i + 1}: its ${s.effect.toLowerCase()} has no key moment in the clip, left at normal speed`);
    used.add(m); clips.push(c); sum += lenOf(c);
  });
  return { clips, left_out: left };
}
