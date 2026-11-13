/**
 * Sharing (Page 10 "Deliver & Share", promise 10): a private link to one rendered reel, and the video rights that allow it.
 *
 * Rights first (blueprint: separate produce and export/delivery rights; unverified or rights-blocked artifacts are never distributed):
 * a link is made only for a finished render of a reel whose identities are still the confirmed ones, from a video whose current rights
 * grant allows sharing (state EXPORT_ALLOWED or PUBLIC, "SHARE" among the allowed uses, valid now, no pending or revoked guardian consent);
 * the same check runs again every time the link is opened. Every check is recorded (policy_decisions), every opening too (share_link_access).
 */
import { z } from "zod";

export const RIGHTS_STATES = ["UNKNOWN", "ANALYSIS_ONLY", "INTERNAL", "EXPORT_ALLOWED", "PUBLIC", "EXPIRED"] as const;
export const RIGHTS_USES = ["ANALYZE", "PRODUCE", "EXPORT", "VIEW", "DOWNLOAD", "SHARE", "DELIVER"] as const;

/** A video's current rights grant (the newest; grants are history and never edited), or none recorded. */
export const VideoRights = z.object({
  video_id: z.string().uuid(),
  grant: z.object({
    id: z.string().uuid(),
    rights_state: z.enum(RIGHTS_STATES),
    allowed_uses: z.array(z.enum(RIGHTS_USES)),
    valid_from: z.string().nullable(), valid_until: z.string().nullable(),
    guardian_consent_state: z.enum(["NOT_APPLICABLE", "PENDING", "VERIFIED", "REVOKED"]),
    created_at: z.string(),
  }).nullable(),
  /** A.11 (ADR-077): why this video may not be analysed now (null: it may) */
  analysis_blocked: z.string().nullable().default(null),
});
export type VideoRights = z.infer<typeof VideoRights>;

/** Record the video's rights (an Owner or Admin; audited with the reason). Replaces nothing: the new grant becomes the current one. */
export const RecordRightsRequest = z.object({
  rights_state: z.enum(["ANALYSIS_ONLY", "INTERNAL", "EXPORT_ALLOWED", "PUBLIC"]),
  allowed_uses: z.array(z.enum(RIGHTS_USES)).max(7),
  valid_until: z.string().datetime().nullable().default(null),
  guardian_consent_state: z.enum(["NOT_APPLICABLE", "PENDING", "VERIFIED", "REVOKED"]).default("NOT_APPLICABLE"),
  reason: z.string().trim().min(3).max(2000),
});
export type RecordRightsRequest = z.infer<typeof RecordRightsRequest>;

export const CreateShareLinkRequest = z.object({
  expires_in_days: z.number().int().min(1).max(30).default(7),
  can_download: z.boolean().default(false),
  /** the person opening the link must type it (stored as a scrypt hash only) */
  password: z.string().min(8).max(128).nullable().default(null),
  /** people opening the link may leave a comment with their name */
  can_comment: z.boolean().default(false),
});
export type CreateShareLinkRequest = z.infer<typeof CreateShareLinkRequest>;

export const ShareLink = z.object({
  id: z.string().uuid(),
  render_id: z.string().uuid(),
  expires_at: z.string().nullable(),
  can_download: z.boolean(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
  opened: z.number().int(),
  has_password: z.boolean().default(false),
  can_comment: z.boolean().default(false),
  comments: z.number().int().default(0),
  /** ACTIVE, EXPIRED or REVOKED */
  state: z.enum(["ACTIVE", "EXPIRED", "REVOKED"]),
});
export type ShareLink = z.infer<typeof ShareLink>;

/** The link itself is shown once, when it is made (only its hash is stored). */
export const CreatedShareLink = ShareLink.extend({ url: z.string() });
export type CreatedShareLink = z.infer<typeof CreatedShareLink>;

/** Why sharing is refused, in plain words, per reason code. */
export const SHARE_REASONS: Record<string, string> = {
  RENDER_NOT_READY: "The reel has no finished render.",
  REPORT_NOT_READY: "The report has no finished PDF.",
  REPORT_RIGHTS: "The rights of a video this report was built from do not allow sharing it outside the organization.",
  REEL_STALE: "A player identity this reel follows has changed since it was rendered.",
  NO_RIGHTS_RECORDED: "No rights are recorded for the source video.",
  RIGHTS_NOT_VALID_NOW: "The video's rights are not valid at this time.",
  RIGHTS_NOT_SHAREABLE: "The video's rights do not allow sharing outside the organization.",
  DOWNLOAD_NOT_ALLOWED: "The video's rights do not allow downloads.",
  GUARDIAN_CONSENT: "Guardian consent for a minor is pending or revoked.",
  LINK_REVOKED: "This link was revoked.",
  LINK_EXPIRED: "This link has expired.",
};

/** What a person opening a link sees: one video, nothing else of the organization. */
export const SharedView = z.object({
  title: z.string(),
  player_name: z.string().nullable(),
  url: z.string(),
  download_url: z.string().nullable(),
  mime: z.string().nullable(),
  link_expires_at: z.string().nullable(),
  /** the organisation that shared the link (the view header, SOT Pages 25-26) */
  organization_name: z.string().nullable(),
  /** the shared player's line (SOT Pages 25-26): shirt number, position and club, from the player's own profile/team sheet */
  player_jersey_number: z.number().nullable(),
  player_position: z.string().nullable(),
  player_club: z.string().nullable(),
  notice: z.string(),
  can_comment: z.boolean().default(false),
  comments: z.array(z.lazy(() => SharedComment)).default([]),
  /** VIDEO: a reel to play; REPORT: a player report (PDF) to read (ADR-056) */
  kind: z.enum(["VIDEO", "REPORT"]).default("VIDEO"),
});
export type SharedView = z.infer<typeof SharedView>;

/** What the password gate may show before the link is opened: the organisation, the expiry, and whether a password is
 *  needed — nothing else. The password itself is never hinted at, and the gate reveals nothing about the video. */
export const ShareGate = z.object({
  organization_name: z.string().nullable(),
  expires_at: z.string().nullable(),
  has_password: z.boolean(),
});
export type ShareGate = z.infer<typeof ShareGate>;

/** a comment left through a share link (guest_name) or shown to the team */
export const SharedComment = z.object({
  id: z.string().uuid(),
  name: z.string(),
  body: z.string(),
  /** seconds into the shared video, when the person pinned it */
  at_s: z.number().nullable(),
  created_at: z.string(),
});
export type SharedComment = z.infer<typeof SharedComment>;

/** opening a password-protected link: the password goes in the body, never the address */
export const OpenShareRequest = z.object({ password: z.string().max(128).nullable().default(null) });
export type OpenShareRequest = z.infer<typeof OpenShareRequest>;

export const PostSharedCommentRequest = z.object({
  password: z.string().max(128).nullable().default(null),
  name: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(255),
  at_s: z.number().min(0).max(86_400).nullable().default(null),
});
export type PostSharedCommentRequest = z.infer<typeof PostSharedCommentRequest>;
