/**
 * AI Analyst (ADR-141, ultra-only; scope: ai-analyst-scope.md).
 *
 * A reasoning AI that reads a player's MEASURED data and writes a structured assessment — strengths, development
 * areas, concrete recommendations, tactical fit, and a scout brief — where every claim cites the measured evidence
 * it came from. It is NOT a replacement for the CV pipeline or the Best Moment Rule, NOT a generic chatbot, NOT
 * the command assistant in assistant.ts (navigation/search routing only), and NOT a replacement for the human
 * PlayerAssessment (which stays the human's, beside this one).
 *
 * The honesty rules are enforced in CODE, not by asking the model to be careful (scope §5):
 *   Rule 1  the system prompt states the rules and is versioned and stored with each assessment;
 *   Rule 2  a DETERMINISTIC post-check (postCheckAssessment) validates the model output before anyone sees it:
 *           every number must be in the measured input (or derived from it by a stated step), every claim needs
 *           at least one evidence link to a real measured event, every event type named must be one the engine
 *           measures, and no unmeasured topic (assist, save, dribble, duel, clearance, through ball, xG, rating)
 *           may appear as a claim. A claim that fails is dropped; if nothing verifiable remains, the whole
 *           assessment is rejected and the user sees "could not be verified", never the bad text.
 *   Rule 3  confidence is computed by code (confidenceFor) from the amount of measured data, never by the model;
 *   Rule 4  the output is a DRAFT until a person publishes it — drafts never reach a club or a Scouting Pack;
 *   Rule 5  every assessment stores its input snapshot, model, prompt version, post-check result and publish
 *           state, so any claim traces back to the data it came from;
 *   Rule 6  user-entered data (strengths, summary, club, league, international) is context only, never evidence.
 *
 * No raw video is ever sent to a provider: only this file's input snapshot (structured measured data) leaves the
 * machine. With no provider configured the feature reports "not configured" and never fabricates output.
 */
import { z } from "zod";
import { PlayerEventKind } from "./events";

/** One AI assessment costs 10 tokens — the same as a player report (scope §8). Regeneration costs another 10. */
export const AI_ANALYST_COST_TOKENS = 10;
/** The prompt version stored with every assessment, so what the model was told can be audited later. */
export const AI_ANALYST_PROMPT_VERSION = "1.0";
/** Minimum data rule (scope §4): fewer than 1 full match analysed, or fewer than 5 measured events, and the
 *  Analyst writes nothing about the player except "Not enough data". */
export const AI_ANALYST_MIN_GAMES = 1;
export const AI_ANALYST_MIN_EVENTS = 5;
/** The model is asked to write in the user's language; the fixed labels come from the web i18n dictionaries. */
export const AiAnalystLanguage = z.enum(["en", "ru", "es", "de", "fr"]);
export type AiAnalystLanguage = z.infer<typeof AiAnalystLanguage>;
export const AI_ANALYST_LANGUAGES: Record<AiAnalystLanguage, string> = { en: "English", ru: "Russian", es: "Spanish", de: "German", fr: "French" };

/** Confidence is computed by code from the data volume behind a claim (scope §2e) — the model never chooses it. */
export const AiAnalystConfidence = z.enum(["HIGH", "MEDIUM", "LOW", "NOT_ENOUGH_DATA"]);
export type AiAnalystConfidence = z.infer<typeof AiAnalystConfidence>;

/**
 * What the engine does NOT measure — and so the Analyst must NOT assess (scope §4). Where any of these is asked
 * about, the Analyst answers "Not measured" with the reason. It does not estimate, approximate or infer them.
 * Tackles and interceptions are on this list too: balls won are recorded, but whether one was a tackle or an
 * interception is only a possibility the engine records (BALL_WON `how`), never a measured fact.
 */
export const AI_ANALYST_NOT_MEASURED: { topic: string; reason: string }[] = [
  { topic: "Assists", reason: "Assists are not measured: the engine does not link a pass to a goal (ADR-124)." },
  { topic: "Through balls", reason: "Through balls are not measured: the engine has no event type for them (ADR-131)." },
  { topic: "Dribbles / 1v1 take-ons", reason: "Dribbles are not measured: the engine has no event type for them (ADR-131)." },
  { topic: "Saves", reason: "Saves are not measured: the engine has no event type for them (ADR-131)." },
  { topic: "Duels won", reason: "Duels won are not measured: the engine has no event type for them (ADR-131)." },
  { topic: "Clearances", reason: "Clearances are not measured: the engine has no event type for them (ADR-131)." },
  { topic: "Shot on target", reason: "Shot on target is not measured: shots carry no on-target flag (ADR-131)." },
  { topic: "Tackles / interceptions", reason: "Tackles and interceptions are not measured as such: balls won are recorded, whether one was a tackle or an interception is only a possibility, never a measured fact." },
  { topic: "xG / xA", reason: "xG / xA are never fabricated: the engine has no expected-goals model (ADR-124)." },
  { topic: "Recent form / ratings", reason: "Recent form ratings are not measured: the engine has no per-match rating model (ADR-130). The Analyst gives strengths and development areas, never a score." },
  { topic: "Progressive passes", reason: "Progressive passes are not measured (ADR-124 evidence rules)." },
  { topic: "PPDA / off-ball runs", reason: "PPDA and off-ball runs are not measured (ADR-124 evidence rules)." },
];

/** Words that may only appear in a "Not measured" entry, never as a claim about how the player plays. */
const UNMEASURED_WORDS: { word: string; topic: string }[] = [
  { word: "assist", topic: "Assists" },
  { word: "through ball", topic: "Through balls" },
  { word: "dribble", topic: "Dribbles / 1v1 take-ons" },
  { word: "1v1", topic: "Dribbles / 1v1 take-ons" },
  { word: "take-on", topic: "Dribbles / 1v1 take-ons" },
  { word: "take on", topic: "Dribbles / 1v1 take-ons" },
  { word: "save", topic: "Saves" },
  { word: "duel", topic: "Duels won" },
  { word: "clearance", topic: "Clearances" },
  { word: "on target", topic: "Shot on target" },
  { word: "tackle", topic: "Tackles / interceptions" },
  { word: "interception", topic: "Tackles / interceptions" },
  { word: "xg", topic: "xG / xA" },
  { word: "xa", topic: "xG / xA" },
  { word: "expected goals", topic: "xG / xA" },
  { word: "rating", topic: "Recent form / ratings" },
  { word: "out of 10", topic: "Recent form / ratings" },
  { word: "/ 10", topic: "Recent form / ratings" },
  { word: "progressive pass", topic: "Progressive passes" },
  { word: "ppda", topic: "PPDA / off-ball runs" },
  { word: "off-ball", topic: "PPDA / off-ball runs" },
  { word: "off ball", topic: "PPDA / off-ball runs" },
  { word: "carry", topic: "Carries" },
  { word: "carries", topic: "Carries" },
];

/** Find the unmeasured topic a piece of model text names, if any (word-boundary match, case-insensitive). */
export function unmeasuredTopicNamed(text: string): string | null {
  const lower = ` ${text.toLowerCase()} `;
  for (const { word, topic } of UNMEASURED_WORDS) {
    // whole words, plurals included ("assists", "through balls", "duels"): the stem plus an optional -s / -es
    const pattern = new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(es|s)?([^a-z]|$)`);
    if (pattern.test(lower)) return topic;
  }
  return null;
}

// ------------------------------------------------------------------ input snapshot
/** One measured event the Analyst may cite, in match time. Capped at 200 in the snapshot (see below). */
export const AiAnalystInputEvent = z.object({
  video_id: z.string().uuid(),
  video_title: z.string(),
  kind: PlayerEventKind,
  /** match clock minute the event happened in, so the UI can open the clip */
  minute: z.number().int().min(0),
  key: z.boolean(),
});
export type AiAnalystInputEvent = z.infer<typeof AiAnalystInputEvent>;

/** The per-match breakdown: event counts per match, so the Analyst can say whether a pattern holds across
 *  matches or is one match only. Minutes seen per match are NOT in here: the engine measures time seen on camera
 *  for the player overall, not per match, so the snapshot says so rather than splitting it by guesswork. */
export const AiAnalystPerMatch = z.object({
  video_id: z.string().uuid(),
  video_title: z.string(),
  events: z.record(PlayerEventKind, z.number().int().min(0)),
  events_count: z.number().int().min(0),
});
export type AiAnalystPerMatch = z.infer<typeof AiAnalystPerMatch>;

/** Exactly what the Analyst reads (scope §4) — nothing else is in its input. User-entered fields are marked
 *  "entered by user": context only, never evidence (Rule 6). */
export const AiAnalystInputSnapshot = z.object({
  player_id: z.string().uuid(),
  otsi_pin: z.string().nullable(),
  display_name: z.string(),
  position: z.string().nullable(),
  club: z.string().nullable(),
  club_source: z.enum(["ROSTER", "USER_ENTERED"]).nullable(),
  nationality: z.string().nullable(),
  age: z.number().int().nullable(),
  height_cm: z.number().int().nullable(),
  weight_kg: z.number().nullable(),
  foot: z.string().nullable(),
  league: z.string().nullable(),
  international: z.object({ country: z.string(), caps: z.number().int().nullable(), goals: z.number().int().nullable() }).nullable(),
  /** entered by a person — the Analyst may quote these as what the user entered, never as measured evidence */
  user_entered: z.object({
    strengths: z.array(z.string()),
    summary: z.string().nullable(),
    club: z.string().nullable(),
    league: z.string().nullable(),
  }),
  verified: z.boolean(),
  measures: z.object({
    games_analysed: z.number().int(),
    minutes_seen: z.number().int(),
    tracks: z.number().int(),
    distance_m: z.number().nullable(),
    top_speed_kmh: z.number().nullable(),
    high_speed_m: z.number().nullable(),
    sprint_m: z.number().nullable(),
    sprints: z.number().int(),
    mean_confidence: z.number().nullable(),
    events: z.object({
      passes: z.number().int(), key_passes: z.number().int(), passes_received: z.number().int(),
      balls_won: z.number().int(), pressures: z.number().int(), shots: z.number().int(), goals: z.number().int(),
    }).nullable(),
  }),
  per_match: z.array(AiAnalystPerMatch),
  /** the citable events, oldest first; capped at 200 (a cap the prompt states, so the model never assumes it saw
   *  more than the snapshot holds — the counts in `measures.events` are the complete totals) */
  events: z.array(AiAnalystInputEvent),
  events_capped_at: z.number().int(),
  events_total: z.number().int(),
  /** how the numbers were produced, in one line, for the prompt and the audit trail */
  basis: z.string(),
});
export type AiAnalystInputSnapshot = z.infer<typeof AiAnalystInputSnapshot>;

// ------------------------------------------------------------------ output schema
/** One evidence link: the claim's backing, openable as a clip in Analysis. `clip_ref` is built by code from the
 *  event (the model never invents a link): /analysis?video=<video_id>&t=<seconds>. */
export const AiAnalystEvidence = z.object({
  video_id: z.string().uuid(),
  video_title: z.string(),
  /** the match, as the video is titled — the same label the Best Moment Rule uses */
  match: z.string(),
  minute: z.number().int().min(0).nullable(),
  event: PlayerEventKind,
  count: z.number().int().min(1),
  clip_ref: z.string(),
});
export type AiAnalystEvidence = z.infer<typeof AiAnalystEvidence>;
/** What the model returns for evidence: the same, without the link or the match label (code adds both after
 *  checking the event is real). */
export const AiAnalystEvidenceInput = AiAnalystEvidence.omit({ clip_ref: true, match: true });
export type AiAnalystEvidenceInput = z.infer<typeof AiAnalystEvidenceInput>;

export const AiAnalystClaim = z.object({
  text: z.string().trim().min(1).max(500),
  confidence: AiAnalystConfidence,
  evidence: z.array(AiAnalystEvidence).min(1, "every claim carries at least one evidence link"),
});
export type AiAnalystClaim = z.infer<typeof AiAnalystClaim>;
export const AiAnalystClaimInput = z.object({
  text: z.string().trim().min(1).max(500),
  /** the model may suggest one; code recomputes it and overwrites it (Rule 3) */
  confidence: AiAnalystConfidence.optional(),
  evidence: z.array(AiAnalystEvidenceInput).min(1),
});
export type AiAnalystClaimInput = z.infer<typeof AiAnalystClaimInput>;

export const AiAnalystRecommendation = z.object({
  text: z.string().trim().min(1).max(500),
  action: z.string().trim().min(1).max(300),
  /** recommendations are labelled as suggestions, not facts — in the UI and in any export */
  suggestion: z.literal(true),
  confidence: AiAnalystConfidence,
  evidence: z.array(AiAnalystEvidence).min(1),
});
export type AiAnalystRecommendation = z.infer<typeof AiAnalystRecommendation>;
export const AiAnalystRecommendationInput = AiAnalystRecommendation.omit({ evidence: true }).extend({
  confidence: AiAnalystConfidence.optional(),
  evidence: z.array(AiAnalystEvidenceInput).min(1),
});
export type AiAnalystRecommendationInput = z.infer<typeof AiAnalystRecommendationInput>;

export const AiAnalystTacticalFit = z.object({
  text: z.string().trim().min(1).max(500),
  suggestion: z.literal(true),
  confidence: AiAnalystConfidence,
  evidence: z.array(AiAnalystEvidence).min(1),
});
export type AiAnalystTacticalFit = z.infer<typeof AiAnalystTacticalFit>;
export const AiAnalystTacticalFitInput = AiAnalystTacticalFit.omit({ evidence: true }).extend({
  confidence: AiAnalystConfidence.optional(),
  evidence: z.array(AiAnalystEvidenceInput).min(1),
});
export type AiAnalystTacticalFitInput = z.infer<typeof AiAnalystTacticalFitInput>;

export const AiAnalystScoutBrief = z.object({
  strengths_summary: z.string().trim().min(1).max(500),
  fit_summary: z.string().trim().min(1).max(500),
  what_to_watch: z.string().trim().min(1).max(500),
  /** key clips: match + minute + reason, the same labels the Best Moment Rule uses */
  key_clips: z.array(z.object({
    video_id: z.string().uuid(),
    video_title: z.string(),
    minute: z.number().int().min(0),
    reason: z.string().trim().min(1).max(200),
  })).max(6),
});
export type AiAnalystScoutBrief = z.infer<typeof AiAnalystScoutBrief>;

export const AiAnalystNotMeasured = z.object({ topic: z.string().trim().min(1).max(80), reason: z.string().trim().min(1).max(300) });
export type AiAnalystNotMeasured = z.infer<typeof AiAnalystNotMeasured>;

/** The stored body: the model's output after the post-check — code-built clip links, code-computed confidence. */
export const AiAnalystAssessmentBodyStored = z.object({
  strengths: z.array(AiAnalystClaim),
  development_areas: z.array(AiAnalystClaim),
  recommendations: z.array(AiAnalystRecommendation),
  tactical_fit: AiAnalystTacticalFit,
  scout_brief: AiAnalystScoutBrief,
  not_measured: z.array(AiAnalystNotMeasured),
});
export type AiAnalystAssessmentBodyStored = z.infer<typeof AiAnalystAssessmentBodyStored>;

/** The structured output the model must produce (scope §6, field names as scoped). Free text outside this schema
 *  is rejected by the post-check. */
export const AiAnalystAssessmentBody = z.object({
  strengths: z.array(AiAnalystClaimInput).max(6),
  development_areas: z.array(AiAnalystClaimInput).max(6),
  recommendations: z.array(AiAnalystRecommendationInput).max(6),
  tactical_fit: AiAnalystTacticalFitInput,
  scout_brief: AiAnalystScoutBrief,
  not_measured: z.array(AiAnalystNotMeasured).max(12),
});
export type AiAnalystAssessmentBody = z.infer<typeof AiAnalystAssessmentBody>;

export const AiAnalystDataBasis = z.object({
  games_analysed: z.number().int(),
  minutes_seen: z.number().int(),
  events_count: z.number().int(),
  matches: z.array(z.string().uuid()),
});
export type AiAnalystDataBasis = z.infer<typeof AiAnalystDataBasis>;

export const AiAnalystPostCheck = z.object({
  ok: z.boolean(),
  /** claims dropped by the post-check, with why — the user never sees the dropped text */
  dropped: z.array(z.object({ section: z.string(), text: z.string(), reason: z.string() })),
  failures: z.array(z.string()),
  /** attempts: 1 = first model call passed, 2 = the stricter retry passed */
  attempts: z.number().int().min(1).max(2),
});
export type AiAnalystPostCheck = z.infer<typeof AiAnalystPostCheck>;

export const AiAnalystStatus = z.enum(["DRAFT", "PUBLISHED"]);
export type AiAnalystStatus = z.infer<typeof AiAnalystStatus>;

/** A stored assessment: the body (with code-built clip links and code-computed confidence) plus the audit trail
 *  (Rule 5): input snapshot, model, prompt version, post-check result, publish state. */
export const AiAnalystAssessment = z.object({
  id: z.string().uuid(),
  player_id: z.string().uuid(),
  otsi_pin: z.string().nullable(),
  status: AiAnalystStatus,
  language: AiAnalystLanguage,
  generated_at: z.string(),
  model: z.string(),
  prompt_version: z.string(),
  data_basis: AiAnalystDataBasis,
  confidence_overall: AiAnalystConfidence,
  strengths: z.array(AiAnalystClaim),
  development_areas: z.array(AiAnalystClaim),
  recommendations: z.array(AiAnalystRecommendation),
  tactical_fit: AiAnalystTacticalFit.nullable(),
  scout_brief: AiAnalystScoutBrief.nullable(),
  not_measured: z.array(AiAnalystNotMeasured),
  /** every claim's links, flattened, for the UI to open the clip */
  evidence_links: z.array(AiAnalystEvidence),
  post_check: AiAnalystPostCheck,
  /** the data changed since this was generated (a new match analysed): regenerate before publishing */
  stale: z.boolean(),
  /** below the minimum-data rule: the Analyst wrote nothing except this line (scope §4) */
  not_enough_data_reason: z.string().nullable(),
  requested_by: z.string().uuid(),
  requested_by_name: z.string().nullable(),
  published_by: z.string().uuid().nullable(),
  published_by_name: z.string().nullable(),
  published_at: z.string().nullable(),
  version: z.number().int(),
  /** set only when verification failed twice: the row records the failure, no unverified text is stored */
  failure: z.string().nullable(),
});
export type AiAnalystAssessment = z.infer<typeof AiAnalystAssessment>;

export const GenerateAiAnalysisRequest = z.object({
  language: AiAnalystLanguage.default("en"),
  /** scope §7 Option A: structured data leaves the machine only with the organization's explicit opt-in, recorded
   *  with the assessment. The UI shows the privacy note and this box before the first analysis. */
  consent_acknowledged: z.literal(true, { errorMap: () => ({ message: "Confirm that the organization agrees to send this player's measured data (never video) to the AI provider before generating an assessment." }) }),
  /** regenerate an existing assessment: a new model call, a new 10-token charge, a new version */
  regenerate: z.boolean().default(false),
});
export type GenerateAiAnalysisRequest = z.infer<typeof GenerateAiAnalysisRequest>;

export const AiAnalystProviderStatus = z.object({
  configured: z.boolean(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /** 10 tokens per assessment (scope §8); the per-call model cost still has to be measured against the
   *  unit-cost worksheet before the price is final (ADR-141 §7). */
  cost_tokens: z.literal(10),
  privacy_note: z.string(),
});
export type AiAnalystProviderStatus = z.infer<typeof AiAnalystProviderStatus>;

export const AI_ANALYST_PRIVACY_NOTE =
  "Only this player's structured measured data is sent to the AI provider (profile, measured stats, event list with match and minute). No video, no raw tracking data and no other player's data is sent. Nothing is published to a club until a person has read it and published it.";

// ------------------------------------------------------------------ confidence (Rule 3, by code)
/**
 * Confidence from the data volume behind one claim (scope §2e): HIGH needs 5+ matches analysed and 30+ measured
 * events behind the claim; MEDIUM is 2–4 matches or a smaller sample; LOW is 1 match or a very small sample.
 * A claim the model calls "certain" on one match of data is still LOW — the model does not choose this.
 */
export function confidenceFor(gamesAnalysed: number, eventsTotal: number, claimEvents: number): AiAnalystConfidence {
  if (gamesAnalysed < AI_ANALYST_MIN_GAMES || eventsTotal < AI_ANALYST_MIN_EVENTS) return "NOT_ENOUGH_DATA";
  if (gamesAnalysed === 1 || claimEvents < 5) return "LOW";
  if (gamesAnalysed >= 5 && claimEvents >= 30) return "HIGH";
  return "MEDIUM";
}

/** The minimum-data rule (scope §4): the reason the Analyst writes nothing, or null when there is enough data. */
export function minimumDataReason(input: AiAnalystInputSnapshot): string | null {
  if (!input.verified) return "Not enough data — identity unconfirmed: the Analyst runs only for a player with a confirmed identity (a registered OTSI PIN and at least one track confirmed by a person).";
  if (input.measures.games_analysed < AI_ANALYST_MIN_GAMES) return "Not enough data — fewer than 1 full match analysed for this player.";
  if (input.events_total < AI_ANALYST_MIN_EVENTS) return `Not enough data — only ${input.events_total} measured event${input.events_total === 1 ? "" : "s"} for this player (at least ${AI_ANALYST_MIN_EVENTS} are needed).`;
  return null;
}

// ------------------------------------------------------------------ allowed numbers (Rule 2)
/** Every number in a piece of text (integers and decimals; a trailing % is still the number). */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The numbers the model is allowed to write: every number present in the measured input (rounded to 1 decimal,
 * so 9 and 9.0 are the same number), plus numbers derived from it by a stated arithmetic step — a count divided
 * by games, a per-90 rate, a share of the event total as a percentage — plus the definitional 0 and 100.
 * Anything else (a rating, an invented count, a league position) is rejected by the post-check.
 */
export function allowedNumbers(input: AiAnalystInputSnapshot): Set<number> {
  const allowed = new Set<number>([0, 100]);
  const add = (n: number | null | undefined) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return;
    allowed.add(round1(n));
    allowed.add(Math.trunc(n));
  };
  const m = input.measures;
  add(m.games_analysed); add(m.minutes_seen); add(m.tracks); add(m.distance_m); add(m.top_speed_kmh);
  add(m.high_speed_m); add(m.sprint_m); add(m.sprints); add(m.mean_confidence);
  if (input.age !== null) add(input.age);
  if (input.height_cm !== null) add(input.height_cm);
  if (input.weight_kg !== null) add(input.weight_kg);
  if (input.international?.caps != null) add(input.international.caps);
  if (input.international?.goals != null) add(input.international.goals);
  if (m.events) {
    for (const n of Object.values(m.events)) add(n);
    // derived: per-90 rates and shares of the event total, the two arithmetic steps the prompt allows
    const minutes = m.minutes_seen;
    if (minutes > 0) for (const n of Object.values(m.events)) add((n / minutes) * 90);
    if (input.events_total > 0) for (const n of Object.values(m.events)) add((n / input.events_total) * 100);
  }
  add(input.events_total);
  for (const pm of input.per_match) {
    add(pm.events_count);
    for (const n of Object.values(pm.events)) add(n);
    if (m.games_analysed > 0) add(pm.events_count / m.games_analysed);
  }
  for (const e of input.events) add(e.minute);
  // a count divided by games (e.g. 9 balls won in 3 matches = 3 per match)
  if (m.events && m.games_analysed > 0) for (const n of Object.values(m.events)) add(n / m.games_analysed);
  if (m.minutes_seen > 0 && m.games_analysed > 0) add(m.minutes_seen / m.games_analysed);
  return allowed;
}

// ------------------------------------------------------------------ deterministic post-check (Rule 2)
export interface PostCheckResult {
  ok: boolean;
  /** the cleaned body (stored shape: code-built links, code-computed confidence), or null when nothing
   *  verifiable remains (or the schema itself failed) */
  body: AiAnalystAssessmentBodyStored | null;
  dropped: { section: string; text: string; reason: string }[];
  failures: string[];
}

/** The clip link for one evidence entry, built by code — the model never invents a link. */
export function clipRefFor(videoId: string, minute: number | null): string {
  const seconds = minute === null ? 0 : Math.max(0, minute * 60 - 2);
  return `/analysis?video=${videoId}&t=${seconds}`;
}

function numbersNotAllowed(text: string, allowed: Set<number>): number[] {
  return extractNumbers(text).filter((n) => !allowed.has(round1(n)) && !allowed.has(Math.trunc(n)));
}

function evidenceKey(e: AiAnalystInputEvent): string {
  return `${e.video_id}|${e.kind}|${e.minute}`;
}

/**
 * Validate one model output against the measured input, deterministically. Every claim is checked on its own:
 * a claim with an invented number, an unmeasured topic, or no link to a real measured event is DROPPED (recorded
 * in `dropped`, never shown); a claim that passes keeps its text but gets its confidence recomputed by code and
 * its evidence links built by code. The scout brief may not introduce a claim that is not already in the
 * assessment: every number in it must appear in a surviving claim, and every key clip must be a real event.
 * The whole output fails when the schema fails, when nothing verifiable survives, or when the brief invents a
 * claim — in that case `body` is null and the caller regenerates once, then shows "could not be verified".
 */
export function postCheckAssessment(input: AiAnalystInputSnapshot, candidate: unknown, attempts = 1): PostCheckResult {
  const dropped: PostCheckResult["dropped"] = [];
  const failures: string[] = [];
  const parsed = AiAnalystAssessmentBody.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, body: null, dropped, failures: [`The model output did not match the assessment schema: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`] };
  }
  const body = parsed.data;
  const allowed = allowedNumbers(input);
  const eventByKey = new Map(input.events.map((e) => [evidenceKey(e), e]));
  const eventCounts = new Map<string, number>();
  for (const e of input.events) eventCounts.set(`${e.video_id}|${e.kind}`, (eventCounts.get(`${e.video_id}|${e.kind}`) ?? 0) + 1);
  const totalByKind = new Map<PlayerEventKind, number>();
  for (const e of input.events) totalByKind.set(e.kind, (totalByKind.get(e.kind) ?? 0) + 1);

  const checkEvidence = (section: string, text: string, ev: AiAnalystEvidenceInput[]): AiAnalystEvidence[] | null => {
    const out: AiAnalystEvidence[] = [];
    for (const item of ev) {
      const real = item.minute === null
        ? (eventCounts.get(`${item.video_id}|${item.event}`) ?? 0) > 0
        : eventByKey.has(`${item.video_id}|${item.event}|${item.minute}`);
      if (!real) {
        dropped.push({ section, text, reason: `Evidence does not match a measured event: ${item.event} in ${item.video_title} at minute ${item.minute ?? "?"}.` });
        return null;
      }
      if (item.count > (totalByKind.get(item.event) ?? 0)) {
        dropped.push({ section, text, reason: `Evidence count ${item.count} for ${item.event} is more than the ${totalByKind.get(item.event) ?? 0} measured.` });
        return null;
      }
      out.push({ ...item, match: item.video_title, clip_ref: clipRefFor(item.video_id, item.minute) });
    }
    return out;
  };

  const checkClaim = <T extends { text: string; evidence: AiAnalystEvidenceInput[] }>(section: string, claim: T): { text: string; evidence: AiAnalystEvidence[]; claimEvents: number } | null => {
    const badNumbers = numbersNotAllowed(claim.text, allowed);
    if (badNumbers.length) {
      dropped.push({ section, text: claim.text, reason: `Number(s) not in the measured input: ${badNumbers.join(", ")}.` });
      return null;
    }
    const topic = unmeasuredTopicNamed(claim.text);
    if (topic) {
      dropped.push({ section, text: claim.text, reason: `Names an unmeasured topic (${topic}): the Analyst must write "Not measured" instead.` });
      return null;
    }
    const evidence = checkEvidence(section, claim.text, claim.evidence);
    if (!evidence) return null;
    return { text: claim.text, evidence, claimEvents: evidence.reduce((s, e) => s + e.count, 0) };
  };

  const games = input.measures.games_analysed;
  const total = input.events_total;
  const strengths: AiAnalystClaim[] = [];
  for (const c of body.strengths) {
    const checked = checkClaim("strengths", c);
    if (checked) strengths.push({ text: checked.text, confidence: confidenceFor(games, total, checked.claimEvents), evidence: checked.evidence });
  }
  const development: AiAnalystClaim[] = [];
  for (const c of body.development_areas) {
    const checked = checkClaim("development_areas", c);
    if (checked) development.push({ text: checked.text, confidence: confidenceFor(games, total, checked.claimEvents), evidence: checked.evidence });
  }
  const recommendations: AiAnalystRecommendation[] = [];
  for (const c of body.recommendations) {
    const checked = checkClaim("recommendations", c);
    if (checked) recommendations.push({ text: checked.text, action: c.action, suggestion: true as const, confidence: confidenceFor(games, total, checked.claimEvents), evidence: checked.evidence });
  }
  let tacticalFit: AiAnalystTacticalFit | null = null;
  const tf = checkClaim("tactical_fit", body.tactical_fit);
  if (tf) tacticalFit = { text: tf.text, suggestion: true as const, confidence: confidenceFor(games, total, tf.claimEvents), evidence: tf.evidence };

  // the scout brief is a summary of the assessment, not new claims: every number in it must appear in a
  // surviving claim, and every key clip must be a real measured event
  const survivingNumbers = new Set<number>();
  for (const c of [...strengths, ...development, ...recommendations]) for (const n of extractNumbers(c.text)) survivingNumbers.add(round1(n));
  if (tacticalFit) for (const n of extractNumbers(tacticalFit.text)) survivingNumbers.add(round1(n));
  const brief = body.scout_brief;
  const briefNumbers = [...extractNumbers(brief.strengths_summary), ...extractNumbers(brief.fit_summary), ...extractNumbers(brief.what_to_watch)];
  const briefBad = briefNumbers.filter((n) => !survivingNumbers.has(round1(n)));
  let scoutBrief: AiAnalystScoutBrief | null = null;
  if (briefBad.length) {
    failures.push(`The scout brief introduces numbers no surviving claim states: ${briefBad.join(", ")}.`);
  } else {
    const briefTopic = unmeasuredTopicNamed(`${brief.strengths_summary} ${brief.fit_summary} ${brief.what_to_watch}`);
    if (briefTopic) {
      failures.push(`The scout brief names an unmeasured topic (${briefTopic}).`);
    } else {
      const badClip = brief.key_clips.find((k) => !input.events.some((e) => e.video_id === k.video_id && e.minute === k.minute));
      if (badClip) failures.push(`The scout brief cites a clip that is not a measured event: ${badClip.video_title} at minute ${badClip.minute}.`);
      else scoutBrief = brief;
    }
  }

  const notMeasured = body.not_measured.filter((n) => {
    const known = AI_ANALYST_NOT_MEASURED.some((k) => k.topic.toLowerCase() === n.topic.toLowerCase());
    if (!known) dropped.push({ section: "not_measured", text: n.topic, reason: "Not a known unmeasured topic for this engine." });
    return known;
  });

  if (failures.length) return { ok: false, body: null, dropped, failures };
  if (!strengths.length && !development.length && !recommendations.length && !tacticalFit) {
    return { ok: false, body: null, dropped, failures: ["The post-check dropped every claim: nothing verifiable remains to show."] };
  }
  // a tactical fit or scout brief that could not be verified is a failure of the whole output, not something to
  // invent a fallback for: the schema requires evidence on both, so an unverifiable one means regenerate
  if (!tacticalFit) {
    return { ok: false, body: null, dropped, failures: ["The tactical fit could not be verified from the measured data."] };
  }
  if (!scoutBrief) {
    return { ok: false, body: null, dropped, failures: ["The scout brief could not be verified from the measured data."] };
  }
  const cleaned: AiAnalystAssessmentBodyStored = {
    strengths, development_areas: development, recommendations,
    tactical_fit: tacticalFit,
    scout_brief: scoutBrief,
    not_measured: notMeasured,
  };
  return { ok: true, body: cleaned, dropped, failures: [] };
}

/** Flatten every claim's evidence links, for the UI to open the clip (deduped by video + event + minute). */
export function evidenceLinksOf(body: AiAnalystAssessmentBodyStored): AiAnalystEvidence[] {
  const seen = new Set<string>();
  const out: AiAnalystEvidence[] = [];
  const push = (e: AiAnalystEvidence) => {
    const k = `${e.video_id}|${e.event}|${e.minute}`;
    if (!seen.has(k)) { seen.add(k); out.push(e); }
  };
  const withLinks = (c: { evidence: AiAnalystEvidence[] }) => c.evidence.forEach(push);
  body.strengths.forEach(withLinks);
  body.development_areas.forEach(withLinks);
  body.recommendations.forEach(withLinks);
  withLinks(body.tactical_fit);
  return out;
}

// ------------------------------------------------------------------ prompt (Rule 1)
/** The versioned system prompt (Rule 1). The model is told, in plain terms, what it may and may not do. */
export function buildAnalystPrompt(input: AiAnalystInputSnapshot, language: AiAnalystLanguage, strict: boolean): { version: string; system: string; user: string } {
  const lang = AI_ANALYST_LANGUAGES[language];
  const unmeasured = AI_ANALYST_NOT_MEASURED.map((n) => `- ${n.topic}: ${n.reason}`).join("\n");
  const system = [
    `You are the AI Analyst of the OTSI Video Intelligence Engine. You read measured football data for ONE player and write a structured assessment. Write in ${lang}.`,
    "RULES — breaking one invalidates the whole assessment:",
    "1. Use ONLY the data in the input JSON. Every number you write must appear in the input, or be derived from it by one stated arithmetic step (a count divided by games analysed, a per-90 rate, a share of the event total as a percentage). Never write any other number.",
    "2. Cite the evidence (event type, count, match, minute) for EVERY claim. A claim without evidence is dropped.",
    "3. If something is not in the input, write \"Not measured\" for it under not_measured with its reason and do NOT estimate it. The engine does NOT measure:",
    unmeasured,
    "4. Never write a rating, a score out of 10, or any overall rating. Give strengths and development areas, not a score.",
    "5. Label every recommendation and every tactical suggestion as a suggestion (suggestion: true). Do not state a suggestion as a fact about the player.",
    "6. Do not suggest a position the input gives no measured evidence for, and do not contradict the recorded position without saying so.",
    "7. The scout brief is a summary of the assessment only: it must not introduce any number or claim that is not already in a strength, development area, recommendation or tactical fit, with its evidence.",
    "8. User-entered strengths and summary in the input are context only — quote them as 'entered by the user' if you use them, never as measured evidence.",
    "9. Evidence must name a real event from the input: the same video_id, event type and minute. Do not invent a clip.",
    "10. Minutes are minutes seen on camera, never 'minutes played'.",
    strict ? "STRICT RETRY — your previous output failed verification: a number was invented, an unmeasured topic was named, or evidence did not match a real event. Write fewer claims, use only numbers copied exactly from the input, and cite only events listed in the input." : "",
    "Return ONLY the JSON object matching the assessment schema: { strengths: [{text, evidence: [{video_id, video_title, minute, event, count}]}], development_areas: [...], recommendations: [{text, action, suggestion: true, evidence: [...]}], tactical_fit: {text, suggestion: true, evidence: [...]}, scout_brief: {strengths_summary, fit_summary, what_to_watch, key_clips: [{video_id, video_title, minute, reason}]}, not_measured: [{topic, reason}] }. No other text.",
  ].filter(Boolean).join("\n");
  return { version: AI_ANALYST_PROMPT_VERSION, system, user: JSON.stringify(input) };
}

// ------------------------------------------------------------------ export hook (Scouting Pack, Piece 4)
/**
 * The Scouting Pack export hook (scope §6): the Analyst brief is included in the Scouting Pack ONLY when the
 * assessment is PUBLISHED. A draft is never exported — this returns null for anything unpublished, so the bundle
 * (Piece 4) cannot include it by accident. The brief carries its publish state so the pack can label it.
 */
export function publishedScoutBriefForPack(a: Pick<AiAnalystAssessment, "status" | "scout_brief" | "published_by_name" | "published_at">): AiAnalystScoutBrief | null {
  if (a.status !== "PUBLISHED" || !a.scout_brief) return null;
  return a.scout_brief;
}

/** An assessment is stale when the data it was built on has changed (a new match analysed): it must be regenerated. */
export function analystAssessmentStale(a: Pick<AiAnalystAssessment, "data_basis">, current: AiAnalystDataBasis): boolean {
  return a.data_basis.games_analysed !== current.games_analysed
    || a.data_basis.minutes_seen !== current.minutes_seen
    || a.data_basis.events_count !== current.events_count
    || a.data_basis.matches.length !== current.matches.length
    || a.data_basis.matches.some((m, i) => m !== current.matches[i]);
}

/** The data basis of an input snapshot, for staleness checks. */
export function dataBasisOf(input: AiAnalystInputSnapshot): AiAnalystDataBasis {
  return {
    games_analysed: input.measures.games_analysed,
    minutes_seen: input.measures.minutes_seen,
    events_count: input.events_total,
    matches: input.per_match.map((p) => p.video_id),
  };
}
