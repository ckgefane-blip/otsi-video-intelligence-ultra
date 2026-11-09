/**
 * Upload & Ingest switches (Page 02): the viewer's defaults for the NEXT upload or link import, kept in this browser. They are not the
 * record: each upload or import sends them to the server, which saves them with the video (video_ingest_options, migration 0020) and
 * carries out "Send to Analysis" itself, so the saved copy on the video is what counts.
 */
import type { IngestOptions, UploadProfile } from "@otsi-vie/contracts";

/** stabilize and sendToAnalysis are carried out by the engine; the other eight are requests for steps it cannot perform yet (saved, reported as "not performed") */
export interface UploadPrefs {
  stabilize: boolean; sendToAnalysis: boolean;
  /** A.10 (ADR-076): the profile of the automatic analysis; Recommended = the server checks the footage first */
  profile: UploadProfile;
  autoCrop: boolean; enhance: boolean; crowdNoise: boolean; aspect: boolean; pitchLines: boolean; eventMarkers: boolean; autoMatch: boolean; highlights: boolean;
}
export const PREFS_KEY = "otsi.upload.prefs";
/** the approved design's defaults */
// v3 Phase 0: a step the engine does not perform is never on by default (it would read as done)
export const DEFAULT_PREFS: UploadPrefs = { stabilize: true, sendToAnalysis: true, profile: "RECOMMENDED", autoCrop: false, enhance: false, crowdNoise: false, aspect: false, pitchLines: false, eventMarkers: false, autoMatch: false, highlights: false };

export function loadPrefs(): UploadPrefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") }; } catch { return DEFAULT_PREFS; }
}
export function savePrefs(p: UploadPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* this visit only */ }
}
/** what the server is told: the person's ten choices (the four steps every analysis does are not choices) */
export function ingestOptions(p: UploadPrefs = loadPrefs()): IngestOptions {
  return {
    stabilize_video: !!p.stabilize, send_to_analysis: !!p.sendToAnalysis, analysis_profile: p.profile ?? "RECOMMENDED",
    auto_crop_pitch: !!p.autoCrop, enhance_quality: !!p.enhance, remove_crowd_noise: !!p.crowdNoise, correct_aspect_ratio: !!p.aspect,
    overlay_pitch_lines: !!p.pitchLines, overlay_event_markers: !!p.eventMarkers, auto_create_match: !!p.autoMatch, generate_highlights: !!p.highlights,
  };
}
