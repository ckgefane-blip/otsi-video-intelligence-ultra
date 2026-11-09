/**
 * v3 Phase A.12 (ADR-078): Media Info, everything recorded about one video's file, in one answer (GET /v1/videos/:id/media-info).
 *   file      what arrived: name, size, SHA-256, type, the container signature read from its bytes, how and when it came in
 *   streams   what the prober measured (ffprobe in an isolated, time-limited process)
 *   checks    the ingest checks in their order, each passed, failed (with the reason), not run, or still pending
 *   copies    the playback copy and the thumbnail made from it
 *   evidence  what the engine has made from it so far: analyses, tracks, confirmed identities, footage check, rights, reels and renders
 * Only what was recorded: a fact never measured is null, and a check whose result was not kept says so.
 */
import { z } from "zod";

export const MEDIA_CHECKS = ["TRANSFER", "SIGNATURE", "MALWARE_SCAN", "PROBE", "DECODE", "POLICY"] as const;
export const MediaCheckKey = z.enum(MEDIA_CHECKS);
export type MediaCheckKey = z.infer<typeof MediaCheckKey>;
export const MEDIA_CHECK_LABELS: Record<MediaCheckKey, string> = {
  TRANSFER: "File received whole",
  SIGNATURE: "File type from its bytes",
  MALWARE_SCAN: "Malware scan",
  PROBE: "Inspected safely",
  DECODE: "Test decode",
  POLICY: "Accepted for analysis",
};
export const MediaCheckStatus = z.enum(["PASSED", "FAILED", "NOT_RUN", "PENDING"]);
export type MediaCheckStatus = z.infer<typeof MediaCheckStatus>;

export const MediaCheck = z.object({ key: MediaCheckKey, status: MediaCheckStatus, detail: z.string().nullable() });
export type MediaCheck = z.infer<typeof MediaCheck>;

const Rate = z.object({ num: z.number().int(), den: z.number().int() });

export const MediaInfo = z.object({
  video_id: z.string().uuid(),
  state: z.string(),
  file: z.object({
    name: z.string().nullable(),
    bytes: z.number().nullable(),
    sha256: z.string().nullable(),
    mime_type: z.string().nullable(),
    signature: z.string().nullable(),
    ingest_mode: z.string(),
    source_uri: z.string().nullable(),
    added_by: z.string().nullable(),
    added_at: z.string(),
    verified_at: z.string().nullable(),
  }),
  streams: z.object({
    container: z.string().nullable(),
    video_codec: z.string().nullable(),
    audio_codec: z.string().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    frame_rate: Rate.nullable(),
    variable_frame_rate: z.boolean().nullable(),
    frame_count: z.number().nullable(),
    duration_us: z.number().nullable(),
    time_base: Rate.nullable(),
    rotation_degrees: z.number().nullable(),
  }),
  checks: z.array(MediaCheck),
  ingest_job: z.object({ state: z.string(), attempts: z.number(), started_at: z.string().nullable(), finished_at: z.string().nullable(), error_code: z.string().nullable() }).nullable(),
  copies: z.object({ playback: z.object({ bytes: z.number().nullable(), created_at: z.string() }).nullable(), thumbnail: z.boolean() }),
  evidence: z.object({
    analyses: z.number(),
    latest_analysis: z.object({ id: z.string(), status: z.string(), finished_at: z.string().nullable(), tracks: z.number(), confirmed_tracks: z.number() }).nullable(),
    footage_check: z.object({ status: z.string(), recommended_profile: z.string().nullable() }).nullable(),
    rights: z.object({ rights_state: z.string(), allowed_uses: z.array(z.string()), guardian_consent_state: z.string(), analysis_blocked: z.string().nullable() }).nullable(),
    reels: z.number(),
    renders: z.number(),
  }),
});
export type MediaInfo = z.infer<typeof MediaInfo>;

/** the check a failure code belongs to (an unknown code is put on the transfer, the first step) */
const FAILED_AT: Record<string, MediaCheckKey> = {
  NOT_A_VIDEO: "SIGNATURE",
  MALWARE_DETECTED: "MALWARE_SCAN",
  DAMAGED_OR_INCOMPLETE: "PROBE", PROBE_TIMEOUT: "PROBE", PROBE_CRASHED: "PROBE", PROBE_FAILED: "PROBE", NO_VIDEO_STREAM: "PROBE", DRM_PROTECTED: "PROBE", UNREADABLE: "PROBE",
  UNDECODABLE: "DECODE",
  UNSUPPORTED_CODEC: "POLICY", UNKNOWN_DURATION: "POLICY", TOO_LONG: "POLICY", RESOLUTION_TOO_LOW: "POLICY",
};

/** what the source asset recorded about its checks (worker ingest.py) */
export interface SourceMeta {
  sniffed?: string | null;
  malware_scan?: { scanner: string | null; result: string; detail: string | null } | null;
  decode?: { frames_decoded: number | null; frames_tested: number | null } | null;
}

const SCANNERS: Record<string, string> = { "microsoft-defender": "Microsoft Defender", clamav: "ClamAV" };

/** the ingest checks from the video's state, its failure and what the source asset recorded */
export function mediaChecks(state: string, failureCode: string | null, failureDetail: string | null, sha256: string | null, meta: SourceMeta | null): MediaCheck[] {
  const verified = state === "INGESTED";
  const failedAt = state === "FAILED" || state === "QUARANTINED" ? (FAILED_AT[failureCode ?? ""] ?? "TRANSFER") : null;
  const failedIdx = failedAt ? MEDIA_CHECKS.indexOf(failedAt) : -1;
  return MEDIA_CHECKS.map((key, i): MediaCheck => {
    if (failedAt && i === failedIdx) return { key, status: "FAILED", detail: failureDetail ?? failureCode };
    if (failedAt && i > failedIdx) return { key, status: "NOT_RUN", detail: "not reached: an earlier check stopped the file" };
    if (!verified && !failedAt) return { key, status: "PENDING", detail: null };
    // passed (verified, or before the failing check)
    switch (key) {
      case "TRANSFER": return { key, status: "PASSED", detail: sha256 ? "every part checksummed; SHA-256 of the whole file recorded" : "every part checksummed" };
      case "SIGNATURE": return { key, status: "PASSED", detail: meta?.sniffed ? `${meta.sniffed} container` : "a video container (the type was not recorded)" };
      case "MALWARE_SCAN": {
        const s = meta?.malware_scan;
        if (!s) return { key, status: "PASSED", detail: "passed (the scanner's answer was not recorded)" };
        if (s.result === "clean") return { key, status: "PASSED", detail: `${SCANNERS[s.scanner ?? ""] ?? s.scanner ?? "scanner"}: no threat found` };
        return { key, status: "NOT_RUN", detail: s.detail ?? "not scanned" };
      }
      case "PROBE": return { key, status: "PASSED", detail: "read by ffprobe in an isolated, time-limited process" };
      case "DECODE": {
        const d = meta?.decode;
        return { key, status: "PASSED", detail: d?.frames_decoded ? `${d.frames_decoded}${d.frames_tested ? ` of ${d.frames_tested}` : ""} test frames decoded` : "frames decoded (the count was not recorded)" };
      }
      case "POLICY": return { key, status: "PASSED", detail: "codec, length and picture size accepted" };
    }
  });
}
