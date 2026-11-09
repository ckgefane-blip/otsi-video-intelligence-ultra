/**
 * v3 Phase B.5 (ADR-083): snapshots, one still picture of a video at a time at the source's full resolution (the SNAPSHOT worker job).
 *   overlays.boxes     draw the boxes the latest finished analysis recorded at that frame (nothing is drawn where nothing was recorded)
 *   overlays.labels    with each box its track number, or the player's name and OTSI Player ID when the identity is confirmed
 *   overlays.selected_track_id  that track drawn highlighted
 *   overlays.caption   a strip saying the video, the time, and that boxes are detections, not verified identities
 */
import { z } from "zod";

export const SnapshotOverlays = z.object({
  boxes: z.boolean().default(false),
  labels: z.boolean().default(false),
  selected_track_id: z.string().uuid().nullable().default(null),
  caption: z.boolean().default(true),
});
export type SnapshotOverlays = z.infer<typeof SnapshotOverlays>;

export const CreateSnapshotRequest = z.object({ at_pts_us: z.number().int().nonnegative(), overlays: SnapshotOverlays.default({}) });
export type CreateSnapshotRequest = z.input<typeof CreateSnapshotRequest>;

export const SnapshotStatus = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]);
export const Snapshot = z.object({
  id: z.string().uuid(),
  video_id: z.string().uuid(),
  pts_us: z.number().int(),
  frame_pts_us: z.number().int().nullable(),
  overlays: SnapshotOverlays,
  status: SnapshotStatus,
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  boxes_drawn: z.number().int().nullable(),
  failure: z.string().nullable(),
  requested_by: z.object({ user_id: z.string().uuid(), name: z.string() }).nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type Snapshot = z.infer<typeof Snapshot>;

/** "Match final 1h02m05s.png": the video's name without its extension and odd characters, and the frame's time */
export function snapshotFileName(title: string | null, ptsUs: number): string {
  const t = Math.floor(ptsUs / 1_000_000);
  const base = String(title ?? "video").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) || "video";
  return `${base} ${Math.floor(t / 3600)}h${String(Math.floor(t / 60) % 60).padStart(2, "0")}m${String(t % 60).padStart(2, "0")}s.png`;
}
