/**
 * Cross-match best moments (ADR-131): one highlight reel of a player's best moments from ALL his uploaded matches, for professional
 * use (clubs, academies, scouts) — instead of one reel per match. The rule is the owner's agreed rule (2026-11-10): fixed tiers,
 * filled top-down, no weights, no judgement; a goal always beats a key pass, a key pass always beats a dribble. Only measured
 * moments count (ADR-124): anything not measured never counts, and anything from a match where the player's identity is not
 * verified under his PIN is excluded before it reaches here (the API gathers confirmed tracks only).
 *
 * This file is pure: no API / DB imports, so the API, the web builder and their tests share the one selection. The tiers map the
 * engine's measured events (see ADR-131 for the evidence behind each, and for every part of the owner's rule the engine cannot
 * measure — those are dropped, never faked).
 */
import { z } from "zod";
import { MomentEvent } from "./reels";

/** The version of the best-moments rule a reel was built with (ADR-131): stamped on the reel and in the render snapshot, so a reel
 *  is always reproducible — old reels keep the version they were built with, and the rule never changes under a reel. */
export const BEST_MOMENTS_RULE_VERSION = 1;

/** The reel lengths a person can choose (seconds): 90 s, 3 min (default), 5 min. 5 minutes is a solid cap, never exceeded. */
export const CrossMatchLength = z.union([z.literal(90), z.literal(180), z.literal(300)]);
export type CrossMatchLength = z.infer<typeof CrossMatchLength>;
export const CROSS_MATCH_DEFAULT_LENGTH_S: CrossMatchLength = 180;
/** How many moments a reel of each length holds (about 12 / 20 / 30). */
export const CROSS_MATCH_MOMENT_CAPS: Record<CrossMatchLength, number> = { 90: 12, 180: 20, 300: 30 };
/** At most this many moments from any single match, however good it was: a cross-match reel shows breadth across matches. */
export const CROSS_MATCH_MAX_PER_MATCH = 4;
/** A pass counts as a long pass / switch of play at this length (ADR-131: the operationalisation of the owner's rule). */
export const CROSS_MATCH_LONG_PASS_M = 25;
/** A sprint counts when it reaches this share of the player's own measured top speed in that match. */
export const CROSS_MATCH_SPRINT_SHARE = 0.85;

export const CrossMatchTier = z.enum(["S", "A", "B", "C"]);
export type CrossMatchTier = z.infer<typeof CrossMatchTier>;

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
] as const;
export type CrossMatchNotSelectedReason = (typeof CROSS_MATCH_NOT_SELECTED_REASONS)[number];

/**
 * One candidate moment for the selection. `events` are the engine's events in it, best first (the API's eventMoments order);
 * `pass_length_m` is the longest pass in it (null when it holds no pass, or the length was not measured — then it is not a long
 * pass); `sprint` is set for a sprint-only candidate (a measured run), null for an event moment. `dedupe_key` is the moment's best
 * event (or "SPRINT"): two candidates of one video with the same key and overlapping windows are the same moment, kept once.
 * `match_minute` is set only when the video's match halves are CONFIRMED (ADR-044) — never invented; `opponent` is the club that
 * is not the player's in that match (null when it is not known — the label then falls back to the video title).
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
});
export type CrossMatchCandidate = z.infer<typeof CrossMatchCandidate>;

export const CrossMatchSelectedMoment = CrossMatchCandidate.extend({
  tier: CrossMatchTier,
  reason: z.string(),
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
  rule_version: z.number().int(),
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

/** A candidate's tier and reason, or why it is in no tier. A moment's tier is its best event's tier; a PASS counts only as a long
 *  pass (length_m >= 25 m); a sprint-only candidate is tier B only at >= 85% of the player's measured top speed in that match. */
export function tierOfCandidate(c: CrossMatchCandidate): { tier: CrossMatchTier; reason: string } | { tier: null; reason: CrossMatchNotSelectedReason } {
  let best: { tier: CrossMatchTier; reason: string } | null = null;
  for (const e of c.events) {
    if (e === "PASS" && (c.pass_length_m === null || c.pass_length_m < CROSS_MATCH_LONG_PASS_M)) continue;
    const tier = TIER_OF_EVENT[e];
    if (!tier) continue;
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
 * Fill a reel of `lengthS` seconds from the candidates, top-down by tier, chronological within a tier (oldest match first by
 * kickoff date, then match minute, then media time; a match or minute not known sorts after the known ones). A candidate is taken
 * only if it fits entirely within the remaining length AND the moments cap — the first candidate that does not fit ends the fill
 * (deterministic: later candidates are listed as not selected, "length cap reached"). At most 4 moments from one match. Fewer
 * than 3 eligible moments: build with what's there, no filler. Never exceeds lengthS (5 minutes is a solid cap at length_s=300).
 */
export function selectCrossMatchMoments(candidates: CrossMatchCandidate[], lengthS: CrossMatchLength): Omit<CrossMatchSelection, "player_id"> {
  const cap = CROSS_MATCH_MOMENT_CAPS[lengthS];
  const lengthUs = lengthS * 1_000_000;
  const classified = candidates.map((c) => ({ c, cls: tierOfCandidate(c) }));
  // chronological within a tier; un-tiered candidates sort last (they are listed, never selected)
  const rank = (x: (typeof classified)[number]) => (x.cls.tier ? TIER_RANK[x.cls.tier] : 4);
  const key = (x: (typeof classified)[number]): [number, string, number, number] => [
    rank(x), x.c.kickoff_at ?? "9999-12-31", x.c.match_minute ?? Number.MAX_SAFE_INTEGER, x.c.in_pts_us,
  ];
  const ordered = [...classified].sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka[0] - kb[0] || (ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0) || ka[2] - kb[2] || ka[3] - kb[3];
  });
  const selected: CrossMatchSelectedMoment[] = [];
  const notSelected: CrossMatchNotSelected[] = [];
  const perMatch = new Map<string, number>();
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
    if ((perMatch.get(c.video_id) ?? 0) >= CROSS_MATCH_MAX_PER_MATCH) {
      notSelected.push({ candidate: c, reason: "per-match cap reached" }); continue;
    }
    // a sprint that is part of a moment already selected (the run up to a goal, say) adds nothing: it is the same moment
    const sprintOnly = c.events.length === 0 && c.sprint !== null;
    if (sprintOnly && selected.some((s) => s.video_id === c.video_id && s.events.length > 0 && overlaps(s, c))) {
      notSelected.push({ candidate: c, reason: "overlaps a selected moment" }); continue;
    }
    const d = c.out_pts_us - c.in_pts_us;
    if (totalUs + d > lengthUs) { ended = "length cap reached"; notSelected.push({ candidate: c, reason: ended }); continue; }
    selected.push({ ...c, tier: cls.tier, reason: cls.reason });
    perMatch.set(c.video_id, (perMatch.get(c.video_id) ?? 0) + 1);
    totalUs += d;
  }
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
 * A clip's label in the reel: reason, match minute and opponent ("Goal — 67' vs Ercakhu"). The minute is used only when the
 * video's match halves are CONFIRMED (the candidate carries match_minute only then — never invented); otherwise the label uses
 * media time. The opponent falls back to the video title when it is not known.
 */
export function crossMatchClipLabel(c: Pick<CrossMatchCandidate, "match_minute" | "key_at_us" | "opponent" | "video_title">, reason: string): string {
  const time = c.match_minute !== null ? `${c.match_minute}'` : mediaTimeLabel(c.key_at_us);
  const match = c.opponent ? `vs ${c.opponent}` : c.video_title;
  return `${reason} — ${time} ${match}`;
}
