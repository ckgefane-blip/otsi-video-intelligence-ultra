/**
 * Cross-match best moments (ADR-131, rule v2.1): one highlight reel of a player's best moments from ALL his uploaded matches, for
 * professional use (clubs, academies, scouts) — instead of one reel per match. The rule is the owner's agreed rule (2026-11-10),
 * version 2.1 FINAL: fixed tiers, filled top-down, no weights, no judgement; a goal always beats a key pass, a key pass always
 * beats a dribble. Only measured moments count (ADR-124): anything not measured never counts, and anything from a match where the
 * player's identity is not verified under his PIN is excluded before it reaches here (the API gathers confirmed tracks only).
 *
 * v2.1 over v1.0 (see ADR-131 §10): chains merge into one clip and rank first inside a tier; the fill is round-robin across
 * matches (pure chronological within a tier dropped a late-season match's moments — it was wrong); the per-match cap scales with
 * the reel length and Tier S is immune; clip windows are fixed 3.0 s in / 2.5 s out, clamped 4–12 s; a position promotion lifts
 * one action per line to Tier A; labels are broadcast lower-thirds; the rule version is the string "2.1".
 *
 * This file is pure: no API / DB imports, so the API, the web builder and their tests share the one selection. The tiers map the
 * engine's measured events (see ADR-131 for the evidence behind each, and for every part of the owner's rule the engine cannot
 * measure — those are dropped, never faked).
 */
import { z } from "zod";
import { POSITION_LINES } from "./playerreport";
import { MomentEvent } from "./reels";

/** The version of the best-moments rule a reel was built with (ADR-131): stamped on the reel and in the render snapshot, so a reel
 *  is always reproducible — old reels keep the version they were built with, and the rule never changes under a reel. v2.1 is a
 *  string: the rule's versions are dotted releases now ("2.1", not 2), and the column is VARCHAR (migration 0069). */
export const BEST_MOMENTS_RULE_VERSION = "2.1";

/** The reel lengths a person can choose (seconds): 90 s, 3 min (default), 5 min. 5 minutes is a solid cap, never exceeded. */
export const CrossMatchLength = z.union([z.literal(90), z.literal(180), z.literal(300)]);
export type CrossMatchLength = z.infer<typeof CrossMatchLength>;
export const CROSS_MATCH_DEFAULT_LENGTH_S: CrossMatchLength = 180;
/** How many moments a reel of each length holds (about 12 / 20 / 30). */
export const CROSS_MATCH_MOMENT_CAPS: Record<CrossMatchLength, number> = { 90: 12, 180: 20, 300: 30 };
/** At most this many NON-Tier-S moments from any single match (v2.1: the cap scales with the reel length — 3 / 4 / 5 for
 *  90 s / 3 min / 5 min); Tier S is immune (a hat-trick all makes the reel, never discarded by a cap). */
export const CROSS_MATCH_PER_MATCH_CAPS: Record<CrossMatchLength, number> = { 90: 3, 180: 4, 300: 5 };
/** A pass counts as a long pass / switch of play at this length (ADR-131: the operationalisation of the owner's rule). */
export const CROSS_MATCH_LONG_PASS_M = 25;
/** A sprint counts when it reaches this share of the player's own measured top speed in that match. */
export const CROSS_MATCH_SPRINT_SHARE = 0.85;
/** v2.1 clip timing (fixed, deterministic): in-point this far before the decisive touch, out-point this far after the
 *  action/outcome; clips are clamped to this minimum / maximum (crossMatchClipWindow). No ball-flight-following timing. */
export const CROSS_MATCH_IN_BEFORE_S = 3.0;
export const CROSS_MATCH_OUT_AFTER_S = 2.5;
export const CROSS_MATCH_MIN_CLIP_S = 4;
export const CROSS_MATCH_MAX_CLIP_S = 12;

export const CrossMatchTier = z.enum(["S", "A", "B", "C"]);
export type CrossMatchTier = z.infer<typeof CrossMatchTier>;

/** A player's line, from the existing POSITION_LINES map (playerreport.ts): the API supplies it the same way playerreport does
 *  (latest team position first, then the recorded usual position); unknown / null position means no promotion. */
export type PositionGroup = (typeof POSITION_LINES)[string];

/**
 * The position promotion (ADR-131 §5, v2.1): one promotion per line, applied to an event's tier BEFORE the moment's best-tier is
 * computed. Only the Defender promotion is LIVE today (TACKLE / INTERCEPTION are both measured, as "possible"); the other three
 * are DORMANT — through ball, 1v1 take-on and goalkeeper save have no event type in the engine, so their keys can never match a
 * MomentEvent, and the promotion has nothing to promote until the worker measures those actions. They are in the table so the
 * promotion exists the day they are measured — do not pretend they work today, and do not fake the missing events.
 */
export type PromotableAction = MomentEvent | "THROUGH_BALL" | "TAKE_ON" | "SAVE";
export const POSITION_PROMOTIONS: Record<PositionGroup, Partial<Record<PromotableAction, CrossMatchTier>>> = {
  DEF: { TACKLE: "A", INTERCEPTION: "A" },
  MID: { THROUGH_BALL: "A" },
  FWD: { TAKE_ON: "A" },
  GK: { SAVE: "A" },
};

/**
 * Which tier a measured event belongs to (the FINAL TIER MAP, ADR-131). PASS is tier C only as a long pass — the length check lives
 * in `tierOfCandidate`, because a plain pass is not a best moment. SPRINT is not an event type: a sprint-only candidate is tier B
 * when it reaches 85% of the player's measured top speed in that match (also in `tierOfCandidate`). Everything else the engine
 * records (set pieces, plain passes, receptions, pressure) is in no tier: never selected.
 */
export const TIER_OF_EVENT: Record<MomentEvent, CrossMatchTier | null> = {
  GOAL: "S", FREE_KICK_GOAL: "S", PENALTY_GOAL: "S",
  SHOT: "A", KEY_PASS: "A",
  TACKLE: "B", INTERCEPTION: "B",
  BALL_WON: "C", PRESSURE_REGAIN: "C", PASS: null,
  PENALTY: null, FREE_KICK: null, CORNER: null, THROW_IN: null, GOAL_KICK: null, KICK_OFF: null, SET_PIECE: null,
  PRESSURE: null, PASS_RECEIVED: null,
};

/** The reason a moment is in the reel, in the owner's words (ADR-131: TACKLE / INTERCEPTION are the engine's "possible" kinds;
 *  PRESSURE_REGAIN is shown as the recovery it is). */
export const CROSS_MATCH_REASON_WORDS: Record<MomentEvent, string> = {
  GOAL: "Goal", FREE_KICK_GOAL: "Free-kick goal", PENALTY_GOAL: "Penalty goal",
  SHOT: "Shot", KEY_PASS: "Key pass",
  TACKLE: "Tackle (possible)", INTERCEPTION: "Interception (possible)",
  BALL_WON: "Ball won", PRESSURE_REGAIN: "Recovery", PASS: "Long pass",
  PENALTY: "Penalty", FREE_KICK: "Free kick", CORNER: "Corner", THROW_IN: "Throw-in", GOAL_KICK: "Goal kick",
  KICK_OFF: "Kick-off", SET_PIECE: "Set piece", PRESSURE: "Pressure", PASS_RECEIVED: "Pass received",
};

/** Why a candidate was not selected: shown in the builder, so a person can swap one in by hand. */
export const CROSS_MATCH_NOT_SELECTED_REASONS = [
  "not a best moment", "sprint below 85% of match top speed", "top speed not measured", "duplicate moment",
  "per-match cap reached", "overlaps a selected moment", "length cap reached", "moments cap reached",
  /** a person said "Not this one" for this reel (the API adds it when it applies the reel's rejections) */
  "rejected for this reel",
] as const;
export type CrossMatchNotSelectedReason = (typeof CROSS_MATCH_NOT_SELECTED_REASONS)[number];

/**
 * One candidate moment for the selection. `events` are the engine's events in it, best first (the API's eventMoments order);
 * `pass_length_m` is the longest pass in it (null when it holds no pass, or the length was not measured — then it is not a long
 * pass); `sprint` is set for a sprint-only candidate (a measured run), null for an event moment. `dedupe_key` is the moment's best
 * event (or "SPRINT"): two candidates of one video with the same key and overlapping windows are the same moment, kept once.
 * `match_minute` is set only when the video's match halves are CONFIRMED (ADR-044) — never invented; `opponent` is the club that
 * is not the player's in that match (null when it is not known — the label then falls back to the video title).
 * `is_chain` / `sequence_label` (v2.1): a chain is a candidate with >= 2 events in one sequence (the API sets them from the
 * moment's per-event spans, in TIME order — `events` is score-ordered, so the label cannot be built from it); a single action
 * has is_chain false and a null sequence label.
 */
export const CrossMatchCandidate = z.object({
  video_id: z.string().uuid(),
  video_title: z.string(),
  home: z.string().nullable(),
  away: z.string().nullable(),
  competition: z.string().nullable(),
  kickoff_at: z.string().nullable(),
  opponent: z.string().nullable(),
  match_minute: z.number().int().positive().nullable(),
  in_pts_us: z.number().int().min(0),
  out_pts_us: z.number().int().positive(),
  key_at_us: z.number().int().min(0),
  events: z.array(MomentEvent),
  pass_length_m: z.number().nullable(),
  sprint: z.object({ top_kmh: z.number(), match_top_speed_kmh: z.number().nullable() }).nullable(),
  label: z.string(),
  dedupe_key: z.string(),
  is_chain: z.boolean().default(false),
  sequence_label: z.string().nullable().default(null),
});
export type CrossMatchCandidate = z.infer<typeof CrossMatchCandidate>;

export const CrossMatchSelectedMoment = CrossMatchCandidate.extend({
  tier: CrossMatchTier,
  reason: z.string(),
  /** ADR-131: the moment's clip is already in this reel (false for the player-level selection, which belongs to no reel) */
  in_reel: z.boolean().default(false),
});
export type CrossMatchSelectedMoment = z.infer<typeof CrossMatchSelectedMoment>;

export const CrossMatchNotSelected = z.object({
  candidate: CrossMatchCandidate,
  reason: z.enum(CROSS_MATCH_NOT_SELECTED_REASONS),
});
export type CrossMatchNotSelected = z.infer<typeof CrossMatchNotSelected>;

/** The selection: what the reel holds, what it left out and why, and how many moments came from each match. */
export const CrossMatchSelection = z.object({
  player_id: z.string().uuid(),
  rule_version: z.string(),
  length_s: CrossMatchLength,
  /** the selected clips' length, seconds (never more than length_s) */
  total_s: z.number(),
  selected: z.array(CrossMatchSelectedMoment),
  not_selected: z.array(CrossMatchNotSelected),
  /** video_id -> moments selected from that match (only matches that contributed) */
  per_match_counts: z.record(z.string(), z.number().int()),
});
export type CrossMatchSelection = z.infer<typeof CrossMatchSelection>;

/** Reject / restore a moment of a reel, per video for a cross-match reel (ADR-131): a single-match call sends no video_id, as today. */
export const CrossMatchMomentWindowRequest = z.object({
  in_pts_us: z.number().int().min(0), out_pts_us: z.number().int().positive(), video_id: z.string().uuid().optional(),
}).refine((c) => c.out_pts_us > c.in_pts_us, { message: "out_pts_us must be after in_pts_us" });
export type CrossMatchMomentWindowRequest = z.infer<typeof CrossMatchMomentWindowRequest>;

const TIER_RANK: Record<CrossMatchTier, number> = { S: 0, A: 1, B: 2, C: 3 };

/** A chain is a candidate with >= 2 events in one sequence (the API's merged event group); a single action has 1 event, a sprint
 *  candidate has none. `is_chain` is carried on the candidate, but the event count is authoritative — a caller that builds a
 *  candidate by hand and forgets the flag still gets the chain treatment. */
export function isChainCandidate(c: Pick<CrossMatchCandidate, "events" | "is_chain">): boolean {
  return c.is_chain || c.events.length >= 2;
}

/** A chain's sequence label from its events in TIME order: distinct kinds, joined with " → ", in the existing reason words
 *  (ADR-124 honesty beats style — "(possible)" stays on tackle / interception). A plain pass in a chain reads "Pass"; only a
 *  measured long pass reads "Long pass". Null for fewer than 2 distinct kinds — not a chain. */
export function crossMatchChainLabel(eventsInTimeOrder: MomentEvent[], passLengthM: number | null = null): string | null {
  const distinct: MomentEvent[] = [];
  for (const e of eventsInTimeOrder) if (!distinct.includes(e)) distinct.push(e);
  if (distinct.length < 2) return null;
  return distinct.map((e) =>
    e === "PASS" && (passLengthM === null || passLengthM < CROSS_MATCH_LONG_PASS_M) ? "Pass" : CROSS_MATCH_REASON_WORDS[e]).join(" → ");
}

/**
 * A cross-match clip's window (v2.1, fixed and deterministic): in = first event's start − 3.0 s, out = last event's end + 2.5 s.
 * Clamped: over 12 s keeps the decisive end (in = out − 12 s); under 4 s extends the out-point; then in ≥ 0 and out ≤ the video
 * duration, shifting in earlier where possible to keep the 4 s minimum when the out-point hits the duration cap. (A video shorter
 * than 4 s cannot hold a 4 s clip — then the window is the whole video.)
 */
export function crossMatchClipWindow(firstStartUs: number, lastEndUs: number, durationUs: number): { in_pts_us: number; out_pts_us: number } {
  let inn = firstStartUs - CROSS_MATCH_IN_BEFORE_S * 1_000_000;
  let out = lastEndUs + CROSS_MATCH_OUT_AFTER_S * 1_000_000;
  if (out - inn > CROSS_MATCH_MAX_CLIP_S * 1_000_000) inn = out - CROSS_MATCH_MAX_CLIP_S * 1_000_000;
  if (out - inn < CROSS_MATCH_MIN_CLIP_S * 1_000_000) out = inn + CROSS_MATCH_MIN_CLIP_S * 1_000_000;
  if (inn < 0) {
    inn = 0;
    if (out - inn < CROSS_MATCH_MIN_CLIP_S * 1_000_000) out = Math.min(durationUs, inn + CROSS_MATCH_MIN_CLIP_S * 1_000_000);
  }
  if (out > durationUs) {
    out = durationUs;
    if (out - inn < CROSS_MATCH_MIN_CLIP_S * 1_000_000) inn = Math.max(0, out - CROSS_MATCH_MIN_CLIP_S * 1_000_000);
  }
  return { in_pts_us: Math.round(inn), out_pts_us: Math.round(out) };
}

/** A candidate's tier and reason, or why it is in no tier. A moment's tier is its best event's tier, AFTER the position promotion
 *  (v2.1: one promotion per line, applied per event before the best is taken); a PASS counts only as a long pass (length_m >= 25 m);
 *  a sprint-only candidate is tier B only at >= 85% of the player's measured top speed in that match. */
export function tierOfCandidate(c: CrossMatchCandidate, positionGroup: PositionGroup | null = null): { tier: CrossMatchTier; reason: string } | { tier: null; reason: CrossMatchNotSelectedReason } {
  let best: { tier: CrossMatchTier; reason: string } | null = null;
  for (const e of c.events) {
    if (e === "PASS" && (c.pass_length_m === null || c.pass_length_m < CROSS_MATCH_LONG_PASS_M)) continue;
    // PASS is tier C only as a long pass (checked above); every other event takes its tier from the map, lifted by the
    // position promotion where one applies (a promotion never demotes: it only wins when it is a better tier than the base)
    const base = e === "PASS" ? "C" : TIER_OF_EVENT[e];
    if (!base) continue;
    const promoted = positionGroup ? POSITION_PROMOTIONS[positionGroup][e] : undefined;
    const tier = promoted && TIER_RANK[promoted] < TIER_RANK[base] ? promoted : base;
    if (!best || TIER_RANK[tier] < TIER_RANK[best.tier]) best = { tier, reason: CROSS_MATCH_REASON_WORDS[e] };
  }
  if (c.sprint && (!best || TIER_RANK.B < TIER_RANK[best.tier])) {
    if (c.sprint.match_top_speed_kmh === null) {
      if (!best) return { tier: null, reason: "top speed not measured" };
    } else if (c.sprint.top_kmh >= CROSS_MATCH_SPRINT_SHARE * c.sprint.match_top_speed_kmh) {
      best = { tier: "B", reason: `Sprint — ${Math.round(c.sprint.top_kmh * 10) / 10} km/h` };
    } else if (!best) {
      return { tier: null, reason: "sprint below 85% of match top speed" };
    }
  }
  return best ?? { tier: null, reason: "not a best moment" };
}

const overlaps = (a: { in_pts_us: number; out_pts_us: number }, b: { in_pts_us: number; out_pts_us: number }) =>
  a.in_pts_us < b.out_pts_us && b.in_pts_us < a.out_pts_us;

/**
 * Fill a reel of `lengthS` seconds from the candidates, top-down by tier. Inside a tier (v2.1): chains first, then singles; each
 * group round-robin across matches — one moment from each match before a second from any match (matches oldest kickoff first,
 * ties by video_id; inside a match chronological: match minute, then media time) — so a late-season match gets in ahead of an
 * early match's second moment. Un-tiered candidates sort last, chronological (they are listed, never selected). A candidate is
 * taken only if it fits entirely within the remaining length AND the moments cap — the first candidate that does not fit ends the
 * fill (deterministic: later candidates are listed as not selected, "length cap reached"). At most 3 / 4 / 5 NON-Tier-S moments
 * from one match (by length); Tier S is immune — a hat-trick all makes the reel, and S moments never count toward the cap. A
 * candidate blocked by the cap does NOT end the fill. Fewer than 3 eligible moments: build with what's there, no filler. Never
 * exceeds lengthS (5 minutes is a solid cap at length_s=300). A chain's reason is its sequence label.
 */
export function selectCrossMatchMoments(candidates: CrossMatchCandidate[], lengthS: CrossMatchLength, positionGroup: PositionGroup | null = null): Omit<CrossMatchSelection, "player_id"> {
  const cap = CROSS_MATCH_MOMENT_CAPS[lengthS];
  const perMatchCap = CROSS_MATCH_PER_MATCH_CAPS[lengthS];
  const lengthUs = lengthS * 1_000_000;
  const classified = candidates.map((c) => ({ c, cls: tierOfCandidate(c, positionGroup) }));
  type Classified = (typeof classified)[number];
  const chrono = (a: Classified, b: Classified) =>
    (a.c.kickoff_at ?? "9999-12-31") < (b.c.kickoff_at ?? "9999-12-31") ? -1
    : (a.c.kickoff_at ?? "9999-12-31") > (b.c.kickoff_at ?? "9999-12-31") ? 1
    : (a.c.match_minute ?? Number.MAX_SAFE_INTEGER) - (b.c.match_minute ?? Number.MAX_SAFE_INTEGER) || a.c.in_pts_us - b.c.in_pts_us;
  // round-robin across matches: round 1 takes the earliest chronological candidate of each match, round 2 the next, and so on
  const roundRobin = (group: Classified[]): Classified[] => {
    const byVideo = new Map<string, Classified[]>();
    for (const x of group) {
      const list = byVideo.get(x.c.video_id) ?? [];
      list.push(x);
      byVideo.set(x.c.video_id, list);
    }
    const videos = [...byVideo.keys()].sort((va, vb) => {
      const ka = byVideo.get(va)![0]!.c.kickoff_at ?? "9999-12-31", kb = byVideo.get(vb)![0]!.c.kickoff_at ?? "9999-12-31";
      return ka < kb ? -1 : ka > kb ? 1 : va < vb ? -1 : va > vb ? 1 : 0;
    });
    for (const list of byVideo.values()) list.sort(chrono);
    const out: Classified[] = [];
    for (let r = 0; ; r++) {
      let any = false;
      for (const v of videos) {
        const x = byVideo.get(v)![r];
        if (x) { out.push(x); any = true; }
      }
      if (!any) break;
    }
    return out;
  };
  const ordered: Classified[] = [];
  for (const tier of ["S", "A", "B", "C"] as const) {
    const inTier = classified.filter((x) => x.cls.tier === tier);
    ordered.push(...roundRobin(inTier.filter((x) => isChainCandidate(x.c))), ...roundRobin(inTier.filter((x) => !isChainCandidate(x.c))));
  }
  ordered.push(...classified.filter((x) => !x.cls.tier).sort(chrono));
  const selected: CrossMatchSelectedMoment[] = [];
  const notSelected: CrossMatchNotSelected[] = [];
  const capCount = new Map<string, number>();
  const keptWindows = new Map<string, { in_pts_us: number; out_pts_us: number }[]>();
  let totalUs = 0;
  let ended: "length cap reached" | "moments cap reached" | null = null;
  for (const { c, cls } of ordered) {
    if (ended) { notSelected.push({ candidate: c, reason: ended }); continue; }
    if (!cls.tier) { notSelected.push({ candidate: c, reason: cls.reason }); continue; }
    // the same moment twice (one video, overlapping window, same best event): keep the first, in fill order
    const dkey = `${c.video_id}|${c.dedupe_key}`;
    const kept = keptWindows.get(dkey) ?? [];
    if (kept.some((w) => overlaps(w, c))) { notSelected.push({ candidate: c, reason: "duplicate moment" }); continue; }
    kept.push({ in_pts_us: c.in_pts_us, out_pts_us: c.out_pts_us });
    keptWindows.set(dkey, kept);
    if (selected.length >= cap) { ended = "moments cap reached"; notSelected.push({ candidate: c, reason: ended }); continue; }
    // Tier S is immune to the per-match cap and never counts toward it; a cap block does not end the fill
    if (cls.tier !== "S" && (capCount.get(c.video_id) ?? 0) >= perMatchCap) {
      notSelected.push({ candidate: c, reason: "per-match cap reached" }); continue;
    }
    // a sprint that is part of a moment already selected (the run up to a goal, say) adds nothing: it is the same moment
    const sprintOnly = c.events.length === 0 && c.sprint !== null;
    if (sprintOnly && selected.some((s) => s.video_id === c.video_id && s.events.length > 0 && overlaps(s, c))) {
      notSelected.push({ candidate: c, reason: "overlaps a selected moment" }); continue;
    }
    const d = c.out_pts_us - c.in_pts_us;
    if (totalUs + d > lengthUs) { ended = "length cap reached"; notSelected.push({ candidate: c, reason: ended }); continue; }
    selected.push({ ...c, tier: cls.tier, reason: isChainCandidate(c) && c.sequence_label ? c.sequence_label : cls.reason,
      is_chain: isChainCandidate(c), sequence_label: c.sequence_label ?? null, in_reel: false });
    if (cls.tier !== "S") capCount.set(c.video_id, (capCount.get(c.video_id) ?? 0) + 1);
    totalUs += d;
  }
  const perMatch = new Map<string, number>();
  for (const m of selected) perMatch.set(m.video_id, (perMatch.get(m.video_id) ?? 0) + 1);
  return {
    rule_version: BEST_MOMENTS_RULE_VERSION,
    length_s: lengthS,
    total_s: Math.round(totalUs / 100_000) / 10,
    selected,
    not_selected: notSelected,
    per_match_counts: Object.fromEntries(perMatch),
  };
}

/** Media time as m:ss (12:34), for a label where the match minute is not known. */
export function mediaTimeLabel(us: number): string {
  const s = Math.max(0, Math.floor(us / 1_000_000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A clip's label in the reel, broadcast lower-third style: "[Tier S] Goal · 67' vs Ercakhu" (v2.1). For a chain the reason is
 * the sequence label ("[Tier B] Tackle (possible) → Key pass · 67' vs Ercakhu"). The minute is used only when the video's match
 * halves are CONFIRMED (the candidate carries match_minute only then — never invented); otherwise the label uses media time. The
 * opponent falls back to the video title when it is not known.
 */
export function crossMatchClipLabel(c: Pick<CrossMatchCandidate, "match_minute" | "key_at_us" | "opponent" | "video_title">, tier: CrossMatchTier, reason: string): string {
  const time = c.match_minute !== null ? `${c.match_minute}'` : mediaTimeLabel(c.key_at_us);
  const match = c.opponent ? `vs ${c.opponent}` : c.video_title;
  return `[Tier ${tier}] ${reason} · ${time} ${match}`;
}
