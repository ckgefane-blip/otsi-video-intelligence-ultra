/**
 * v3 Phase C.4 (ADR-104): Archive bundle with manifest (`otsi-archive/v1`) and audit extract (`audit-extract.json`);
 * rights are re-checked at pack time and at every open or download, and every check is recorded in `policy_decisions` (`archive-v1`).
 *
 * Scope:
 * - Supports packing and opening a portable archive bundle for a Reel (`REEL`), a Video (`VIDEO`), or a Match (`MATCH`).
 * - Rights rule (`checkArchiveRights`):
 *   - Every source video in the archive must have a recorded current rights grant (`rights_grants`) that currently allows `PRODUCE`
 *     (valid at the check time, not `UNKNOWN`, `ANALYSIS_ONLY`, or `EXPIRED`, `PRODUCE` in `allowed_uses`, and guardian consent not
 *     `PENDING` or `REVOKED`), reusing `analysisBlock(..., "PRODUCE")`.
 *   - For a `REEL`, all followed tracks (`reel_targets`) must still match their current confirmed identity (`staleTargets === 0`).
 *   - A `MATCH` must have at least one linked video (`NO_VIDEOS_IN_MATCH` if none).
 * - When an archive is packed (`POST /v1/archives`), the check runs and is stored in `policy_decisions` (`action: 'ARCHIVE_PACK'`).
 * - Every time an archive is opened (`GET /v1/archives/:id`) or downloaded (`GET /v1/archives/:id/download`), the check runs again
 *   against the live database (`rights_grants`, `video_sources.removed_at`, `reel_targets` vs `v_track_current_identity`) and is
 *   recorded in `policy_decisions` (`ARCHIVE_OPEN` / `ARCHIVE_DOWNLOAD`). If rights have been withdrawn or expired, or if a followed
 *   identity became stale, opening or downloading is refused with `409 ARCHIVE_RIGHTS_BLOCKED`.
 */
import { z } from "zod";
import { OtsiReelManifest, OtioTimeline } from "./interchange";
import { ANALYSIS_RIGHTS_REASONS, analysisBlock } from "./rights";
import { RIGHTS_STATES, RIGHTS_USES } from "./sharing";

export const ARCHIVE_SCHEMA = "otsi-archive/v1" as const;

export const ArchiveSubjectKind = z.enum(["REEL", "VIDEO", "MATCH"]);
export type ArchiveSubjectKind = z.infer<typeof ARCHIVE_SCHEMA extends string ? typeof ArchiveSubjectKind : never>;

export const ARCHIVE_REASONS: Record<string, string> = {
  ...ANALYSIS_RIGHTS_REASONS,
  NOT_FOR_ANALYSIS: "A source video's rights do not allow making an archive bundle from it.",
  REEL_STALE: "A player identity this reel follows has changed since the reel was pinned.",
  NO_VIDEOS_IN_MATCH: "Link at least one video to this match before packing a match archive.",
  SOURCE_VIDEO_REMOVED: "A source video in this archive was moved to the Trash.",
};

export const ArchiveVideoRights = z.object({
  video_id: z.string().uuid(),
  title: z.string(),
  grant_id: z.string().uuid().nullable(),
  rights_state: z.enum([...RIGHTS_STATES, "UNRECORDED"]),
  allowed_uses: z.array(z.enum(RIGHTS_USES)),
  valid_from: z.string().nullable(),
  valid_until: z.string().nullable(),
  guardian_consent_state: z.enum(["NOT_APPLICABLE", "PENDING", "VERIFIED", "REVOKED"]).nullable(),
  allowed: z.boolean(),
  reason_code: z.string().nullable(),
  reason_text: z.string().nullable(),
});
export type ArchiveVideoRights = z.infer<typeof ArchiveVideoRights>;

export const ArchiveRightsCheck = z.object({
  allowed: z.boolean(),
  checked_at: z.string(),
  rule_version: z.literal("archive-v1"),
  stale_targets: z.number().int().min(0),
  reason_codes: z.array(z.string()),
  reason_text: z.string().nullable(),
  videos: z.array(ArchiveVideoRights),
});
export type ArchiveRightsCheck = z.infer<typeof ArchiveRightsCheck>;

export const ArchiveAuditEntry = z.object({
  id: z.number().int(),
  occurred_at: z.string(),
  actor_kind: z.string(),
  actor_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  actor_service: z.string().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().nullable(),
  request_id: z.string().nullable(),
  before_state: z.unknown().nullable(),
  after_state: z.unknown().nullable(),
});
export type ArchiveAuditEntry = z.infer<typeof ArchiveAuditEntry>;

export const ArchiveFileEntry = z.object({
  name: z.string(),
  kind: z.enum(["MANIFEST", "AUDIT_EXTRACT", "REEL_MANIFEST", "OTIO_TIMELINE", "RENDERED_REEL"]),
  mime_type: z.string(),
  bytes: z.number().int().min(0),
  sha256: z.string(),
});
export type ArchiveFileEntry = z.infer<typeof ArchiveFileEntry>;

export const ArchiveVideoEvidence = z.object({
  video_id: z.string().uuid(),
  title: z.string(),
  duration_us: z.number().int().nullable(),
  source_sha256: z.string().nullable(),
  analysed: z.boolean(),
  tracks: z.number().int().min(0),
  confirmed_tracks: z.number().int().min(0),
  calibrated: z.boolean(),
});
export type ArchiveVideoEvidence = z.infer<typeof ArchiveVideoEvidence>;

export const ArchiveManifest = z.object({
  schema: z.literal(ARCHIVE_SCHEMA),
  archive_id: z.string().uuid(),
  packed_at: z.string(),
  packed_by_name: z.string(),
  organization_id: z.string().uuid(),
  organization_name: z.string(),
  subject: z.object({
    kind: ArchiveSubjectKind,
    id: z.string().uuid(),
    title: z.string(),
    project_id: z.string().uuid().nullable(),
  }),
  rights_at_pack: ArchiveRightsCheck,
  videos: z.array(ArchiveVideoEvidence),
  reel_interchange: z.object({
    manifest: OtsiReelManifest,
    otio: OtioTimeline,
  }).nullable(),
  audit_summary: z.object({
    count: z.number().int().min(0),
    earliest_at: z.string().nullable(),
    latest_at: z.string().nullable(),
    actions: z.array(z.string()),
  }),
  files: z.array(ArchiveFileEntry),
});
export type ArchiveManifest = z.infer<typeof ArchiveManifest>;

export const ArchiveBundleSummary = z.object({
  id: z.string().uuid(),
  subject_kind: ArchiveSubjectKind,
  subject_id: z.string().uuid(),
  title: z.string(),
  created_at: z.string(),
  created_by_name: z.string(),
  bytes: z.number().int().min(0),
  sha256: z.string(),
  audit_count: z.number().int().min(0),
  file_count: z.number().int().min(1),
  rights_now: ArchiveRightsCheck,
  download_url: z.string().nullable(),
});
export type ArchiveBundleSummary = z.infer<typeof ArchiveBundleSummary>;

export const ArchiveBundleView = ArchiveBundleSummary.extend({
  manifest: ArchiveManifest,
  audit_extract: z.array(ArchiveAuditEntry),
});
export type ArchiveBundleView = z.infer<typeof ArchiveBundleView>;

export const ArchiveStatusView = z.object({
  subject_kind: ArchiveSubjectKind,
  subject_id: z.string().uuid(),
  title: z.string(),
  rights_now: ArchiveRightsCheck,
  archives: z.array(ArchiveBundleSummary),
});
export type ArchiveStatusView = z.infer<typeof ArchiveStatusView>;

export const CreateArchiveRequest = z.object({
  subject_kind: ArchiveSubjectKind,
  subject_id: z.string().uuid(),
});
export type CreateArchiveRequest = z.infer<typeof CreateArchiveRequest>;

export interface ArchiveVideoGrantInput {
  video_id: string;
  title: string;
  removed?: boolean;
  grant: {
    id: string;
    rights_state: (typeof RIGHTS_STATES)[number];
    allowed_uses: (typeof RIGHTS_USES)[number][];
    valid_from: string | null;
    valid_until: string | null;
    guardian_consent_state: "NOT_APPLICABLE" | "PENDING" | "VERIFIED" | "REVOKED";
  } | null;
}

/**
 * Pure rights evaluation run at pack time and at every open/download of an archive bundle (`archive-v1`).
 */
export function checkArchiveRights(input: {
  videos: ArchiveVideoGrantInput[];
  staleTargets?: number;
  now?: Date;
}): ArchiveRightsCheck {
  const now = input.now ?? new Date();
  const stale = Math.max(0, input.staleTargets ?? 0);
  const reasons = new Set<string>();
  if (input.videos.length === 0) reasons.add("NO_VIDEOS_IN_MATCH");
  if (stale > 0) reasons.add("REEL_STALE");

  const videos: ArchiveVideoRights[] = input.videos.map((v) => {
    if (v.removed) {
      reasons.add("SOURCE_VIDEO_REMOVED");
      return {
        video_id: v.video_id,
        title: v.title,
        grant_id: v.grant?.id ?? null,
        rights_state: v.grant?.rights_state ?? "UNRECORDED",
        allowed_uses: v.grant?.allowed_uses ?? [],
        valid_from: v.grant?.valid_from ?? null,
        valid_until: v.grant?.valid_until ?? null,
        guardian_consent_state: v.grant?.guardian_consent_state ?? null,
        allowed: false,
        reason_code: "SOURCE_VIDEO_REMOVED",
        reason_text: ARCHIVE_REASONS.SOURCE_VIDEO_REMOVED!,
      };
    }
    const block = analysisBlock(v.grant, now, "PRODUCE");
    if (block) reasons.add(block);
    const reasonText = block ? (ARCHIVE_REASONS[block] ?? ANALYSIS_RIGHTS_REASONS[block]) : null;
    return {
      video_id: v.video_id,
      title: v.title,
      grant_id: v.grant?.id ?? null,
      rights_state: v.grant?.rights_state ?? "UNRECORDED",
      allowed_uses: v.grant?.allowed_uses ?? [],
      valid_from: v.grant?.valid_from ?? null,
      valid_until: v.grant?.valid_until ?? null,
      guardian_consent_state: v.grant?.guardian_consent_state ?? null,
      allowed: block === null,
      reason_code: block,
      reason_text: reasonText,
    };
  });

  const codeList = [...reasons];
  const textList = codeList.map((c) => ARCHIVE_REASONS[c] ?? c);
  return ArchiveRightsCheck.parse({
    allowed: codeList.length === 0,
    checked_at: now.toISOString(),
    rule_version: "archive-v1",
    stale_targets: stale,
    reason_codes: codeList,
    reason_text: textList.length ? textList.join(" ") : null,
    videos,
  });
}
