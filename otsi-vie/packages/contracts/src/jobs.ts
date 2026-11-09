/**
 * Job system v2 (v3 Phase A.2 / A.3, ADR-060): every engine job of the organization in one list, for the top-bar job tray and the
 * Processing job table. A job is shown with what it works on (its video, reel or run), its state, step and progress as the worker
 * recorded them, and only the actions that are possible for it now (the server decides; the tray never guesses).
 */
import { z } from "zod";
import { JobState } from "./media";

export const JobKind = z.enum(["INGEST_UPLOAD", "INGEST_URL", "PROXY", "ASSESS", "ANALYZE", "TRACK_BALL", "CALIBRATE_PITCH", "READ_LINEUPS", "RENDER", "SNAPSHOT", "BEAT_GRID"]);
export type JobKind = z.infer<typeof JobKind>;

/** what a person may do with a job now: hold or release a waiting job, change its place in the queue, stop it, run it again */
export const JobAction = z.enum(["pause", "resume", "priority", "cancel", "retry"]);
export type JobAction = z.infer<typeof JobAction>;

export const JobPriority = z.enum(["HIGH", "NORMAL", "LOW"]);
export type JobPriority = z.infer<typeof JobPriority>;

export const Job = z.object({
  id: z.string(),
  kind: JobKind,
  /** plain name of the work: "Analysis", "Render", "Playback copy", ... */
  kind_label: z.string(),
  /** the video or reel it works on (its title); null when that is gone */
  subject_title: z.string().nullable(),
  video_id: z.string().nullable(),
  /** the page that shows its result */
  href: z.string().nullable(),
  state: JobState,
  priority: JobPriority,
  progress: z.number(),
  /** the worker's current step, as it recorded it */
  stage: z.string().nullable(),
  /** a failed job's safe message */
  error: z.string().nullable(),
  attempts: z.number().int(),
  requested_by: z.string().nullable(),
  /** the machine whose worker ran it (as the worker named itself); null before a worker took it */
  worker: z.string().nullable(),
  /** an analysis: the estimate given for its profile by the footage check, in seconds (an estimate, never a measurement) */
  estimate_s: z.number().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  actions: z.array(JobAction),
});
export type Job = z.infer<typeof Job>;

export const JobList = z.object({
  jobs: z.array(Job),
  /** waiting, running or paused */
  active: z.number().int(),
  running: z.number().int(),
  failed_recent: z.number().int(),
});
export type JobList = z.infer<typeof JobList>;

export const SetJobPriorityRequest = z.object({ priority: JobPriority });
export type SetJobPriorityRequest = z.infer<typeof SetJobPriorityRequest>;
