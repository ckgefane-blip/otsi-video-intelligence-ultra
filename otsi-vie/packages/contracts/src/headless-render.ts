/**
 * v3 Phase C.8 (ADR-107): Headless render command vie-render <manifest> for batch and recovery.
 *
 * Schemas for headless render manifests, execution options, and result summaries.
 */
import { z } from "zod";
import { RenderQcReport } from "./scopes";

export const HeadlessRenderClip = z.object({
  id: z.string().optional(),
  in_pts_us: z.number().int().nonnegative().optional(),
  out_pts_us: z.number().int().nonnegative().optional(),
  in_s: z.number().nonnegative().optional(),
  out_s: z.number().nonnegative().optional(),
  gap_s: z.number().nonnegative().optional(),
  gap_us: z.number().int().nonnegative().optional(),
  label: z.string().nullable().optional(),
  gain_db: z.number().optional(),
  mute: z.boolean().optional(),
  effect: z
    .object({
      kind: z.enum(["NONE", "SLOW", "FREEZE", "RAMP"]),
      speed: z.number().positive().optional(),
      freeze_s: z.number().nonnegative().optional(),
    })
    .optional(),
  fx: z
    .object({
      zoom: z.unknown().optional(),
      drawings: z.array(z.unknown()).optional(),
    })
    .optional(),
  transition: z
    .object({
      kind: z.string(),
      duration_s: z.number().positive().optional(),
    })
    .nullable()
    .optional(),
});
export type HeadlessRenderClip = z.infer<typeof HeadlessRenderClip>;

export const HeadlessRenderManifest = z.object({
  schema_version: z.string().optional(),
  render_id: z.string().optional(),
  reel_id: z.string().optional(),
  video_id: z.string().optional(),
  source: z.string().optional(),
  source_path: z.string().optional(),
  video_path: z.string().optional(),
  output_path: z.string().optional(),
  aspect: z.enum(["16:9", "9:16", "4:5", "1:1"]).optional(),
  codec: z.enum(["h264", "vp9"]).optional(),
  bitrate_mbps: z.number().positive().optional(),
  fps: z.number().positive().optional(),
  clips: z.array(HeadlessRenderClip).min(1),
  audio: z
    .object({
      lufs: z.number().nullable().optional(),
      true_peak_db: z.number().nullable().optional(),
      duck_music: z.boolean().optional(),
    })
    .optional(),
  music: z
    .object({
      path: z.string().optional(),
      key: z.string().optional(),
      volume: z.number().optional(),
      match_volume: z.number().optional(),
    })
    .nullable()
    .optional(),
  overlay: z.record(z.string(), z.unknown()).optional(),
  look: z
    .object({
      lift: z.number().optional(),
      gamma: z.number().optional(),
      gain: z.number().optional(),
      saturation: z.number().optional(),
      temperature: z.number().optional(),
    })
    .optional(),
});
export type HeadlessRenderManifest = z.infer<typeof HeadlessRenderManifest>;

export const HeadlessRenderResult = z.object({
  ok: z.boolean(),
  manifest_path: z.string(),
  output_path: z.string(),
  output_manifest_path: z.string().optional(),
  frames: z.number().int().nonnegative(),
  duration_s: z.number().nonnegative(),
  fps: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  codec: z.string(),
  encoder: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  seconds: z.number().nonnegative(),
  validation: z.object({
    ok: z.boolean(),
    failures: z.array(z.string()),
    qc: RenderQcReport.optional(),
  }),
});
export type HeadlessRenderResult = z.infer<typeof HeadlessRenderResult>;
