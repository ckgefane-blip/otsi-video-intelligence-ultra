/**
 * Home: what needs the person now (v3 Phase A.13, ADR-062). Read from recorded rows only: a next action that follows the
 * organization's real state, and a Review inbox whose every row opens the exact page where the work is done.
 */
import { z } from "zod";

export const InboxKind = z.enum(["IDENTITY", "TEAM_SHEET", "STALE_REEL", "FAILED_JOB"]);
export type InboxKind = z.infer<typeof InboxKind>;

export const InboxItem = z.object({
  /** stable identity of the row, "<kind>:<video or reel id>": what a decision names */
  id: z.string(),
  kind: InboxKind,
  /** what to do, e.g. "Check 3 identity suggestions" */
  title: z.string(),
  /** where: the video or reel it concerns */
  detail: z.string().nullable(),
  count: z.number().int(),
  href: z.string(),
  /** the video the row concerns (IDENTITY, TEAM_SHEET, FAILED_JOB); null for a reel row (STALE_REEL).
   *  The review inbox acts on it from here: a team sheet is approved or rejected for this video. */
  video_id: z.string().uuid().nullable(),
  /** IDENTITY: the reel's own player the suggestions are about (naming is per reel player); null for the other kinds */
  player_name: z.string().nullable().default(null),
});
export type InboxItem = z.infer<typeof InboxItem>;

export const NextAction = z.object({
  kind: z.enum(["WATCH_PROCESSING", "REVIEW", "CONTINUE_REEL", "OPEN_REPORT", "PICK_PLAYER"]),
  label: z.string(),
  detail: z.string().nullable(),
  href: z.string(),
});
export type NextAction = z.infer<typeof NextAction>;

export const HomeInbox = z.object({
  /** null: nothing waits (a new organization: upload first) */
  next: NextAction.nullable(),
  items: z.array(InboxItem),
  /** the organization has at least one finished analysis (first-run guidance is shown until then) */
  completed_match: z.boolean(),
});
export type HomeInbox = z.infer<typeof HomeInbox>;

/** Approve or reject one review-inbox row (Platform Health, SOT Admin). APPROVE does what the row asks for: the suggested
 *  identities are confirmed, the proposed team sheets applied, the stale reel refreshed, the failed jobs run again. REJECT
 *  declines it: the suggested identities are rejected, the proposed team sheets dismissed. A stale reel or a failed job
 *  cannot be rejected from here (422): open the reel to refresh it, or retry the job, or leave it — it clears when a newer
 *  run of the same kind exists. Every decision is logged with its reason. */
export const InboxDecision = z.enum(["APPROVE", "REJECT"]);
export type InboxDecision = z.infer<typeof InboxDecision>;

export const InboxDecisionRequest = z.object({
  /** the row's id (InboxItem.id) */
  item_id: z.string().min(1).max(200),
  decision: InboxDecision,
  /** why, logged on the audit row with the decision */
  reason: z.string().trim().max(500).nullable().default(null),
});
export type InboxDecisionRequest = z.infer<typeof InboxDecisionRequest>;

export const InboxDecisionResult = z.object({
  item_id: z.string(),
  kind: InboxKind,
  decision: InboxDecision,
  /** how many underlying subjects the decision applied to (identities confirmed or rejected, cards applied or dismissed, jobs run again, reels refreshed) */
  applied: z.number().int().nonnegative(),
  /** subjects that could not be decided, with why — the inbox below already reflects the ones that were applied */
  failures: z.array(z.object({ subject: z.string(), message: z.string() })),
  /** the review inbox after the decision */
  inbox: HomeInbox,
});
export type InboxDecisionResult = z.infer<typeof InboxDecisionResult>;
