/**
 * Home: what needs the person now (v3 Phase A.13, ADR-062). Read from recorded rows only: a next action that follows the
 * organization's real state, and a Review inbox whose every row opens the exact page where the work is done.
 */
import { z } from "zod";

export const InboxKind = z.enum(["IDENTITY", "TEAM_SHEET", "STALE_REEL", "FAILED_JOB"]);
export type InboxKind = z.infer<typeof InboxKind>;

export const InboxItem = z.object({
  kind: InboxKind,
  /** what to do, e.g. "Check 3 identity suggestions" */
  title: z.string(),
  /** where: the video or reel it concerns */
  detail: z.string().nullable(),
  count: z.number().int(),
  href: z.string(),
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
