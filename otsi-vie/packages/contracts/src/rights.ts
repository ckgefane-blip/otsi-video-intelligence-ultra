/**
 * v3 Phase A.11 (ADR-077): the rights a person declares for a video on Upload, in four plain questions, and the rule that a video is
 * analysed only when its current rights allow it. The answers become an ordinary rights grant (rights_grants, history kept), the same
 * record Export's "Sharing & rights" uses; changing a recorded grant stays with an Owner or Admin there.
 */
import { z } from "zod";

export const GuardianConsent = z.enum(["NOT_APPLICABLE", "PENDING", "VERIFIED"]);
export type GuardianConsent = z.infer<typeof GuardianConsent>;

export const UploadRights = z.object({
  /** may the engine analyse this video (detect, track, read shirt numbers, suggest identities)? */
  analyse: z.boolean(),
  /** may reels and reports made from it be shared outside the organization (private links)? */
  share: z.boolean(),
  /** may people who get a link download the file? (only with sharing) */
  download: z.boolean(),
  /** are minors in it: no (NOT_APPLICABLE), consent asked for (PENDING), consent on file (VERIFIED) */
  guardian_consent: GuardianConsent,
  /** the person confirms they are entitled to declare this */
  confirm: z.literal(true),
}).refine((r) => r.share || !r.download, { message: "Downloads need sharing", path: ["download"] });
export type UploadRights = z.infer<typeof UploadRights>;

/** the grant the four answers stand for */
export function grantOfDeclaration(d: UploadRights): { rights_state: "INTERNAL" | "EXPORT_ALLOWED"; allowed_uses: string[] } {
  const uses = ["VIEW", ...(d.analyse ? ["ANALYZE", "PRODUCE"] : []), ...(d.share ? ["EXPORT", "SHARE", "DELIVER"] : []), ...(d.download ? ["DOWNLOAD"] : [])];
  return { rights_state: d.share ? "EXPORT_ALLOWED" : "INTERNAL", allowed_uses: uses };
}

export const ANALYSIS_RIGHTS_REASONS = {
  NO_RIGHTS_RECORDED: "Record this video's rights first: on Upload, select the video, open AI Tools and press Record rights.",
  NOT_FOR_ANALYSIS: "This video's rights do not allow analysis.",
  RIGHTS_NOT_VALID_NOW: "This video's rights are not valid at this time.",
  GUARDIAN_CONSENT: "Guardian consent for a minor in this video is pending or revoked, so it is not analysed.",
} as const;
export type AnalysisRightsReason = keyof typeof ANALYSIS_RIGHTS_REASONS;

/** why the video's current grant does not allow analysis (null: it does) */
export function analysisBlock(g: { rights_state: string; allowed_uses: string[]; valid_from: string | Date | null; valid_until: string | Date | null; guardian_consent_state: string } | null,
  now = new Date(), use: "ANALYZE" | "PRODUCE" = "ANALYZE"): AnalysisRightsReason | null {
  if (!g) return "NO_RIGHTS_RECORDED";
  if (g.rights_state === "UNKNOWN" || !g.allowed_uses.includes(use)) return "NOT_FOR_ANALYSIS";
  if (g.rights_state === "EXPIRED" || (g.valid_from && new Date(g.valid_from) > now) || (g.valid_until && new Date(g.valid_until) <= now)) return "RIGHTS_NOT_VALID_NOW";
  if (g.guardian_consent_state === "PENDING" || g.guardian_consent_state === "REVOKED") return "GUARDIAN_CONSENT";
  return null;
}
