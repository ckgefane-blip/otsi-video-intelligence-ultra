/**
 * Page 08 Player Report, written by people and built from measurements (ADR-056): notes and tags, the analyst's assessment (draft and
 * published), scouting dossiers, the comparison with a group of the organization's players, sentences built from measured values, and
 * the PDF report with its share links. Nothing here is invented: an opinion is marked as a person's, a number names where it came from.
 */
import { z } from "zod";
import { CreateShareLinkRequest, ShareLink } from "./sharing";

// ------------------------------------------------------------------ notes and tags
export const PlayerNote = z.object({
  id: z.string().uuid(),
  body: z.string(),
  author_id: z.string().uuid(),
  author_name: z.string(),
  created_at: z.string(),
  /** the person reading may delete it (its author, or an Owner / Admin) */
  can_delete: z.boolean(),
});
export type PlayerNote = z.infer<typeof PlayerNote>;

export const PlayerNotes = z.object({
  notes: z.array(PlayerNote),
  tags: z.array(z.string()),
  /** the person reading may add notes and tags */
  can_write: z.boolean(),
});
export type PlayerNotes = z.infer<typeof PlayerNotes>;

export const AddPlayerNoteRequest = z.object({ body: z.string().trim().min(1).max(2000) });
export type AddPlayerNoteRequest = z.infer<typeof AddPlayerNoteRequest>;
export const SetPlayerTagsRequest = z.object({
  tags: z.array(z.string().trim().min(1).max(40)).max(20).transform((t) => [...new Map(t.map((x) => [x.toLowerCase(), x])).values()]),
});
export type SetPlayerTagsRequest = z.infer<typeof SetPlayerTagsRequest>;

// ------------------------------------------------------------------ assessment (a person's opinion)
export const AssessmentCriterion = z.object({ name: z.string().trim().min(1).max(40), score: z.number().int().min(1).max(10) });
export type AssessmentCriterion = z.infer<typeof AssessmentCriterion>;

export const AssessmentBody = z.object({
  role: z.string().trim().max(80).default(""),
  summary: z.string().trim().max(600).default(""),
  traits: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
  /** overall rating out of 10, in half points; null = not rated */
  rating: z.number().min(0).max(10).multipleOf(0.5).nullable().default(null),
  criteria: z.array(AssessmentCriterion).max(8).default([]),
  notes: z.string().trim().max(2000).default(""),
});
export type AssessmentBody = z.infer<typeof AssessmentBody>;

export const PlayerAssessment = z.object({
  player_id: z.string().uuid(),
  /** the version shown on the report, null until someone publishes */
  published: AssessmentBody.nullable(),
  published_by_name: z.string().nullable(),
  published_at: z.string().nullable(),
  /** what is being written (only to people who may write it; null otherwise) */
  draft: AssessmentBody.nullable(),
  /** the draft differs from what is published */
  unpublished_changes: z.boolean(),
  updated_at: z.string().nullable(),
  version: z.number().int(),
  can_write: z.boolean(),
});
export type PlayerAssessment = z.infer<typeof PlayerAssessment>;

export const SaveAssessmentRequest = z.object({
  /** the version read (0 when there is none yet); a newer one in the database refuses the save */
  version: z.number().int().min(0),
  draft: AssessmentBody,
  /** also make this draft the published version */
  publish: z.boolean().default(false),
});
export type SaveAssessmentRequest = z.infer<typeof SaveAssessmentRequest>;

// ------------------------------------------------------------------ scouting dossiers
export const DossierPlayer = z.object({ player_id: z.string().uuid(), display_name: z.string(), canonical_otsi_id: z.string().nullable(), added_at: z.string() });
export const Dossier = z.object({
  id: z.string().uuid(),
  name: z.string(),
  created_at: z.string(),
  players: z.array(DossierPlayer),
});
export type Dossier = z.infer<typeof Dossier>;
export const CreateDossierRequest = z.object({ name: z.string().trim().min(1).max(80) });
export type CreateDossierRequest = z.infer<typeof CreateDossierRequest>;

// ------------------------------------------------------------------ comparison with a group of the organization's players
/** the lines a position belongs to; a player whose position is not recorded is compared with everyone only */
export const POSITION_LINES: Record<string, "GK" | "DEF" | "MID" | "FWD"> = {
  GK: "GK", RB: "DEF", CB: "DEF", LB: "DEF", RWB: "DEF", LWB: "DEF", DF: "DEF",
  DM: "MID", CM: "MID", AM: "MID", RM: "MID", LM: "MID", MF: "MID",
  RW: "FWD", LW: "FWD", CF: "FWD", ST: "FWD", FW: "FWD",
};
export const CohortGroup = z.enum(["ALL", "GK", "DEF", "MID", "FWD"]);
export type CohortGroup = z.infer<typeof CohortGroup>;
export const COHORT_NAMES: Record<CohortGroup, string> = { ALL: "All players", GK: "Goalkeepers", DEF: "Defenders", MID: "Midfielders", FWD: "Forwards" };
/** a player is in a group only with at least this much time seen on camera: rates from a few minutes are noise */
export const COHORT_MIN_SEEN_S = 15 * 60;

export const CohortMetric = z.object({
  key: z.enum(["passes_p90", "key_passes_p90", "balls_won_p90", "distance_p90", "top_speed"]),
  label: z.string(),
  unit: z.string(),
  /** this player's value; null = not measured for him */
  player: z.number().nullable(),
  /** the group's average without him; null = no one in the group has it measured */
  group_mean: z.number().nullable(),
  /** how many players of the group have it measured */
  group_n: z.number().int(),
  /** the highest value in the group or his, to draw bars against */
  max: z.number().nullable(),
});
export type CohortMetric = z.infer<typeof CohortMetric>;

export const PlayerComparison = z.object({
  group: CohortGroup,
  group_name: z.string(),
  /** the groups that can be chosen for him: ALL, and his line when his position is recorded */
  groups: z.array(CohortGroup),
  /** players in the group (without him) with enough time seen */
  n: z.number().int(),
  /** his own time seen is below the minimum: his rates are shown but marked */
  player_below_minimum: z.boolean(),
  metrics: z.array(CohortMetric),
  basis: z.string(),
});
export type PlayerComparison = z.infer<typeof PlayerComparison>;

// ------------------------------------------------------------------ sentences built from measured values
export const PlayerInsight = z.object({
  kind: z.enum(["SPEED", "PASSING", "POSITION", "WORK_RATE", "BALL_WINNING"]),
  text: z.string(),
  /** where the numbers in the sentence come from */
  source: z.string(),
});
export type PlayerInsight = z.infer<typeof PlayerInsight>;
export const PlayerInsights = z.object({ items: z.array(PlayerInsight), basis: z.string() });
export type PlayerInsights = z.infer<typeof PlayerInsights>;

// ------------------------------------------------------------------ PDF reports and their share links
export const PlayerReportJob = z.object({
  id: z.string().uuid(),
  player_id: z.string().uuid(),
  state: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "BLOCKED", "REVIEW_REQUIRED"]),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  requested_by_name: z.string(),
  bytes: z.number().int().nullable(),
  /** a short-lived link to the PDF (members only) */
  download_url: z.string().nullable(),
  failure: z.string().nullable(),
  /** the videos his numbers came from: their rights decide whether the report may be shared */
  videos: z.number().int(),
  /** B.24 (ADR-099): the designer's title, and how many of the report's sections it holds */
  title: z.string().nullable().default(null),
  sections: z.number().int().default(6),
});
export type PlayerReportJob = z.infer<typeof PlayerReportJob>;

export const ReportShareLink = ShareLink.omit({ render_id: true }).extend({ report_id: z.string().uuid() });
export type ReportShareLink = z.infer<typeof ReportShareLink>;
export const CreatedReportShareLink = ReportShareLink.extend({ url: z.string() });
export type CreatedReportShareLink = z.infer<typeof CreatedReportShareLink>;
export const CreateReportShareLinkRequest = CreateShareLinkRequest.omit({ can_comment: true });
export type CreateReportShareLinkRequest = z.infer<typeof CreateReportShareLinkRequest>;
