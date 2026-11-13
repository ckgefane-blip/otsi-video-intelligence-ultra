/** Projects, video sources and uploads (Block 03). Every value here is what the system actually recorded or measured. */
import { z } from "zod";
import { UploadRights } from "./rights";

export const Project = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  video_count: z.number().int().nonnegative(),
  /** who created it (a member of the organization) */
  created_by: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  version: z.number().int().positive(),
  /** who may see it (ADR-057): everyone in the organization, or only the people chosen (and Owners / Admins) */
  access: z.enum(["ORGANIZATION", "RESTRICTED"]).default("ORGANIZATION"),
  /** the people on the project (its team list; in a restricted project, who besides Owners / Admins may see it) */
  collaborators: z.array(z.object({ user_id: z.string().uuid(), display_name: z.string(), permission: z.enum(["READ", "REVIEW", "EDIT", "ADMIN"]) })).default([]),
  /** your permission on it (null: you are not on its list) */
  my_permission: z.enum(["READ", "REVIEW", "EDIT", "ADMIN"]).nullable().default(null),
  /** someone else's project you were put on (the Library's Shared With Me) */
  shared_with_me: z.boolean().default(false),
  /** you may choose who is on it (Owner / Admin, or its Manager) */
  can_manage_access: z.boolean().default(false),
});
export type Project = z.infer<typeof Project>;

export const CreateProjectRequest = z.object({
  name: z.string().trim().min(2).max(255),
  description: z.string().trim().max(4000).optional(),
  /** new projects are open to the organization unless "only the people I choose" is picked; then the creator is its Manager */
  access: z.enum(["ORGANIZATION", "RESTRICTED"]).optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const UpdateProjectRequest = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  /** optimistic concurrency: the version you edited */
  version: z.number().int().positive(),
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

export const VideoState = z.enum(["PENDING", "VALIDATING", "INGESTED", "FAILED", "QUARANTINED"]);
export const JobState = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "PAUSED"]);   // PAUSED: ADR-060

/**
 * The switches of Upload & Ingest (Page 02, left panel), saved WITH the video. Two are carried out by the engine (stabilize_video = the High
 * accuracy profile; send_to_analysis = the server starts the analysis once the video is verified). Four are always done by every analysis
 * (players and teams, ball tracking, jersey numbers, metadata): they are not choices and are written by the server. The other eight are the
 * person's REQUEST for steps the engine cannot perform yet: they are saved as asked and reported back as "not performed" (NOT_BUILT_SWITCHES),
 * never as done.
 */
export const NOT_BUILT_SWITCHES = ["auto_crop_pitch", "enhance_quality", "remove_crowd_noise", "correct_aspect_ratio", "overlay_pitch_lines", "overlay_event_markers",
  "auto_create_match", "generate_highlights"] as const;
export type NotBuiltSwitch = (typeof NOT_BUILT_SWITCHES)[number];
/**
 * v3 Phase A.10 (ADR-076, migration 0050): the profile of the automatic analysis, chosen on Upload. RECOMMENDED: the server checks the
 * footage first (ADR-034) and uses the profile it recommends (with Stabilize Video on, never below High accuracy). The others: that profile.
 */
export const UploadProfile = z.enum(["RECOMMENDED", "STANDARD", "HIGH_ACCURACY", "ULTRA_SENSITIVE"]);
export type UploadProfile = z.infer<typeof UploadProfile>;
export const IngestOptions = z.object({
  stabilize_video: z.boolean(),
  send_to_analysis: z.boolean(),
  /** absent: the profile follows Stabilize Video (High accuracy on, Standard off), as before A.10 */
  analysis_profile: UploadProfile.optional(),
  auto_crop_pitch: z.boolean().default(false),
  enhance_quality: z.boolean().default(false),
  remove_crowd_noise: z.boolean().default(false),
  correct_aspect_ratio: z.boolean().default(false),
  overlay_pitch_lines: z.boolean().default(false),
  overlay_event_markers: z.boolean().default(false),
  auto_create_match: z.boolean().default(false),
  generate_highlights: z.boolean().default(false),
});
export type IngestOptions = z.input<typeof IngestOptions>;
/** what the server saved for a video, what it did about "Send to Analysis", and which requested steps it cannot perform */
export const SavedIngestOptions = IngestOptions.extend({
  /** null: saved before A.10 (the profile followed Stabilize Video) */
  analysis_profile: UploadProfile.nullable(),
  /** profile: the one the server analysed with; detail: why (the footage check's recommendation, or why it was not used) */
  analysis: z.object({ outcome: z.enum(["STARTED", "SKIPPED"]), run_id: z.string().uuid().nullable(), detail: z.string().nullable(),
    profile: z.enum(["STANDARD", "HIGH_ACCURACY", "ULTRA_SENSITIVE"]).nullable().default(null) }).nullable(),
  /** requested switches the engine does not perform yet (a subset of NOT_BUILT_SWITCHES) */
  not_performed: z.array(z.string()),
});
export type SavedIngestOptions = z.infer<typeof SavedIngestOptions>;

export const Video = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  title: z.string().nullable(),
  original_filename: z.string().nullable(),
  ingest_mode: z.enum(["UPLOAD", "DIRECT_URL", "AUTHORIZED_PROVIDER"]),
  source_uri: z.string().nullable(),
  state: VideoState,
  byte_size: z.number().int().positive().nullable(),
  /** measured by the media probe; null until probed */
  duration_us: z.number().int().positive().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  frame_rate: z.object({ num: z.number().int().positive(), den: z.number().int().positive() }).nullable(),
  is_variable_frame_rate: z.boolean().nullable(),
  container_format: z.string().nullable(),
  video_codec: z.string().nullable(),
  audio_codec: z.string().nullable(),
  sha256: z.string().nullable(),
  failure_code: z.string().nullable(),
  failure_detail: z.string().nullable(),
  has_thumbnail: z.boolean(),
  /** the video's latest analysis run and the worker's own progress on it (0-100) with what it is doing now; null if it was never analysed */
  analysis: z.object({ run_id: z.string().uuid(), status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]), progress: z.number().nullable(), stage_message: z.string().nullable() }).nullable().optional(),
  /** the switches chosen with this upload or import; null for a video that was added without them */
  ingest_options: SavedIngestOptions.nullable().optional(),
  /** the match this video shows, once someone linked it (Block 07); null = not linked */
  match_id: z.string().uuid().nullable(),
  /** the background job working on this video right now (ingest), if any */
  job: z.object({ kind: z.string(), state: JobState, progress: z.number(), stage_message: z.string().nullable(), error_code: z.string().nullable() }).nullable(),
  /** an unfinished upload of this video (to resume it) */
  upload: z.object({ upload_id: z.string().uuid(), status: z.string(), expected_bytes: z.number().int(), received_bytes: z.number().int() }).nullable(),
  /** who created it (a member of the organization) */
  created_by: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Video = z.infer<typeof Video>;

/** Rename a video (Upload "Edit Metadata"); every other fact of a video is measured, never edited by hand. */
export const UpdateVideoRequest = z.object({ title: z.string().trim().min(1).max(255) });
export type UpdateVideoRequest = z.infer<typeof UpdateVideoRequest>;

/** Upload limits (Block 03): a full match in a common camera format fits; larger needs a deployment setting, not a code change. */
export const ACCEPTED_EXTENSIONS = ["mp4", "m4v", "mov", "mkv", "webm", "avi", "mpg", "mpeg", "ts", "m2ts", "mts", "flv", "ogv", "ogg"] as const;

/** what this server accepts (GET /v1/upload-limits): the deployment's real limit, never a design placeholder */
export const UploadLimits = z.object({ max_upload_bytes: z.number().int().positive(), accepted_extensions: z.array(z.string()) });
export type UploadLimits = z.infer<typeof UploadLimits>;

export const CreateUploadRequest = z.object({
  /** optional: without it the server saves nothing and starts no analysis by itself */
  options: IngestOptions.optional(),
  /** A.11 (ADR-077): the rights declared on Upload; recorded as the video's rights grant. Without it, the video is not analysed until they are recorded */
  rights: UploadRights.optional(),
  project_id: z.string().uuid(),
  file_name: z.string().trim().min(1).max(255),
  byte_size: z.number().int().positive(),
  title: z.string().trim().min(1).max(255).optional(),
  /** SHA-256 of the whole file if the client computed it (verified on completion); optional for very large files */
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
export type CreateUploadRequest = z.infer<typeof CreateUploadRequest>;

export const UploadSession = z.object({
  upload_id: z.string().uuid(),
  video_id: z.string().uuid(),
  status: z.enum(["INITIALIZED", "UPLOADING", "VERIFYING", "COMPLETED", "ABORTED", "EXPIRED", "FAILED"]),
  part_bytes: z.number().int().positive(),
  part_count: z.number().int().positive(),
  expected_bytes: z.number().int().positive(),
  received_parts: z.array(z.number().int().positive()),
  expires_at: z.string(),
});
export type UploadSession = z.infer<typeof UploadSession>;

/** Import a video from a direct link (F07). The server downloads it only from public addresses and verifies it like an upload. */
export const CreateImportRequest = z.object({
  options: IngestOptions.optional(),
  rights: UploadRights.optional(),
  project_id: z.string().uuid(),
  url: z.string().trim().min(10).max(2048),
  title: z.string().trim().min(1).max(255).optional(),
  /** the user's own access token for a provider that needs authorization (Vimeo, Google Drive); sealed at rest, deleted after use */
  access_token: z.string().trim().min(8).max(4096).optional(),
});

import providerPolicy from "./providers.json";

export type ImportProvider = {
  id: string; name: string; status: "supported" | "needs_authorization" | "unsupported"; hosts: string[];
  /** "extractor": a video-page link fetched with yt-dlp by the worker (ADR-145) */
  via?: "extractor";
  method?: string; examples?: string[]; reason?: string; alternative?: string;
};
/** One policy for API, worker and UI (ADR-027). */
export const IMPORT_PROVIDERS: ImportProvider[] = (providerPolicy as { providers: ImportProvider[] }).providers;

export function importProviderFor(host: string, path = ""): ImportProvider {
  const h = host.toLowerCase().replace(/\.$/, "");
  const hit = IMPORT_PROVIDERS.find((p) => p.hosts.some((x) => h === x || h.endsWith(`.${x}`)));
  if (hit) return hit;
  return IMPORT_PROVIDERS.find((p) => p.id === (path.toLowerCase().endsWith(".m3u8") ? "hls" : "direct"))!;
}
export type CreateImportRequest = z.infer<typeof CreateImportRequest>;
