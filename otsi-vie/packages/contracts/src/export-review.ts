/**
 * v3 Phase B.23 (ADR-098): Export review aids.
 *   actionClips     which chapters (clips) hold an event of the reel's player that the engine recorded. With no event of his recorded in
 *                   the video at all, it is NOT known which clips have action (null), never "every clip has none".
 *   ReportPreview   a rule-built report (Performance Report, Clip Sheet) as the page it will print, made now from the engine's records;
 *                   nothing is saved (GET /v1/reels/:id/bundles/preview/:kind).
 *   shareCheck      the source video's rights as a preflight line, so they can be recorded right there (inline capture).
 */
import { z } from "zod";
import type { PreflightCheck } from "./export-presets";
import type { VideoRights } from "./sharing";

export const PreviewKind = z.enum(["PERFORMANCE_PDF", "CLIP_SHEET_PDF"]);
export type PreviewKind = z.infer<typeof PreviewKind>;
export const ReportPreview = z.object({ kind: PreviewKind, html: z.string(), generated_at: z.string() });
export type ReportPreview = z.infer<typeof ReportPreview>;

/** the ids of the clips holding an event of his (video time, as the clip sheet counts them); null when none of his events is recorded in this video */
export function actionClips(videoId: string, clips: { id: string; in_pts_us: number; out_pts_us: number }[], events: { video_id: string; start_us: number }[]): Set<string> | null {
  const mine = events.filter((e) => e.video_id === videoId);
  if (!mine.length) return null;
  return new Set(clips.filter((c) => mine.some((e) => e.start_us >= c.in_pts_us && e.start_us <= c.out_pts_us)).map((c) => c.id));
}

/** may a link to a file of this video be shared outside the organization now (the rule the server applies at every open) */
export function rightsAllowShare(r: VideoRights | null, now = new Date()): boolean {
  const g = r?.grant;
  return !!g && ["EXPORT_ALLOWED", "PUBLIC"].includes(g.rights_state) && g.allowed_uses.includes("SHARE")
    && !(g.valid_until && new Date(g.valid_until) <= now) && !["PENDING", "REVOKED"].includes(g.guardian_consent_state);
}

/** the source video's rights as a preflight line: rendering never needs them, sharing and delivery do */
export function shareCheck(r: VideoRights | null, now = new Date()): PreflightCheck {
  if (!r?.grant) return { key: "share", level: "WARN", text: "No rights are recorded for the video: the file renders, but it cannot be shared or delivered until they are." };
  if (!rightsAllowShare(r, now)) return { key: "share", level: "WARN", text: "The video's rights do not allow sharing now: the file stays inside your organization." };
  return { key: "share", level: "OK", text: `The video's rights allow sharing${r.grant.allowed_uses.includes("DOWNLOAD") ? " and downloads" : ""}.` };
}
