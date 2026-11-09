/**
 * v3 Phase C.5 (ADR-105): the beat grid of a reel's music, and beat-aware cut snap.
 *
 * The BEAT_GRID worker job reads a music brand asset on this computer (FFmpeg LGPL build decodes it; NumPy and SciPy, both BSD-3-Clause,
 * analyse it; no network, no model, no new dependency) and records the beats it detects: a spectral-flux onset envelope, the tempo with the
 * strongest periodicity between 60 and 200 BPM, and a dynamic-programming beat tracker (D. P. W. Ellis, "Beat Tracking by Dynamic
 * Programming", 2007). The beats are Detected, their accuracy is not measured (no labelled music test set): the page says so.
 *
 * The render loops the music from the first clip (ADR-047: `-stream_loop -1`, cut at the reel's end), so a beat at music time t is heard at
 * reel time t, t + d, t + 2d, ... (d = the music's decoded length). `reelBeats` gives those times; `beatSnapTargets` turns them into the
 * source times where a dragged clip edge makes its cut land on a beat.
 */
import { z } from "zod";

/** the analysis method recorded with every grid (bumped when the algorithm changes; old grids stay labelled with theirs) */
export const BEAT_METHOD = "otsi-beat-v1";

/** what is used, and its licence, for the owner's counsel (D.1); shown in the music panels and written in ADR-105 */
export const BEAT_LIBRARY_NOTE =
  "Found on this computer by OTSI's own beat analysis (NumPy and SciPy, BSD-3-Clause; the music decoded by the LGPL FFmpeg build). No music leaves the computer.";

export const BeatGridStatus = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]);
export type BeatGridStatus = z.infer<typeof BeatGridStatus>;

export const BeatGrid = z.object({
  id: z.string(),
  /** the music brand asset it was made from */
  music_id: z.string(),
  status: BeatGridStatus,
  method: z.string(),
  /** the tempo with the strongest periodicity, beats per minute; null when no steady beat was found */
  tempo_bpm: z.number().nullable(),
  /** beat times in the music, microseconds from its start, increasing */
  beats_us: z.array(z.number().int()),
  /** the music's decoded length (the loop period in the render) */
  duration_us: z.number().int().nullable(),
  /** 0..1: how strongly the onsets repeat at that tempo (the autocorrelation peak); a measure of steadiness, not of accuracy */
  periodicity: z.number().nullable(),
  failure: z.string().nullable(),
  requested_by: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type BeatGrid = z.infer<typeof BeatGrid>;

/** GET /v1/brand-assets/:id/beat-grid: the latest grid of that music, or null when it was never analysed */
export const BeatGridView = z.object({ music_id: z.string(), grid: BeatGrid.nullable(), library_note: z.string() });
export type BeatGridView = z.infer<typeof BeatGridView>;

/** below this periodicity the beats are not offered for snapping (the music has no steady beat the analysis could follow) */
export const BEAT_MIN_PERIODICITY = 0.1;

/** the grid can be used for snapping */
export function beatsUsable(g: BeatGrid | null | undefined): g is BeatGrid {
  return !!g && g.status === "SUCCEEDED" && g.beats_us.length >= 4 && (g.periodicity ?? 0) >= BEAT_MIN_PERIODICITY && !!g.duration_us && g.duration_us > 0;
}

/** one line saying what the page knows about the music's beat, faithful to what was recorded */
export function describeBeatGrid(g: BeatGrid | null | undefined): string {
  if (!g) return "Beat not analysed yet.";
  if (g.status === "QUEUED") return "Waiting to find the beat…";
  if (g.status === "RUNNING") return "Finding the beat…";
  if (g.status === "FAILED") return g.failure ?? "The beat could not be found.";
  if (!beatsUsable(g)) return "No steady beat found in this music: cuts snap to the playhead and markers only.";
  return `About ${Math.round(g.tempo_bpm ?? 0)} BPM · ${g.beats_us.length} beats · Detected (accuracy not measured)`;
}

/** the beats heard in a reel of `totalUs` (the music looped from the first clip, as the render plays it) */
export function reelBeats(g: BeatGrid | null | undefined, totalUs: number, max = 20_000): number[] {
  if (!beatsUsable(g) || totalUs <= 0) return [];
  const d = g.duration_us!, out: number[] = [];
  for (let k = 0; k * d < totalUs && out.length < max; k++) {
    for (const b of g.beats_us) {
      const t = k * d + b;
      if (t > totalUs) break;
      out.push(t);
      if (out.length >= max) break;
    }
  }
  return out;
}

/**
 * Where a dragged clip edge may snap so that the clip's END (the cut into the next clip) lands on a beat, in SOURCE time.
 * Only for a clip played at normal speed (a slow, frozen or ramped clip maps source to reel time unevenly: no beat targets, said in ADR-105).
 *   out edge: end in reel time = start + (out - in)  ->  out = in + (beat - start)
 *   in edge:  end in reel time = start + (out - in)  ->  in = out - (beat - start)
 * Beats at or before the clip's start are skipped; the 0.5 s minimum length of a clip is the trim rule's job.
 */
export function beatSnapTargets(p: { start: number; clip: { in_pts_us: number; out_pts_us: number; effect: { kind: string } } }, edge: "in" | "out", beats: number[]): number[] {
  if (p.clip.effect.kind !== "NONE" || !beats.length) return [];
  const out: number[] = [];
  for (const b of beats) {
    const len = b - p.start;
    if (len <= 0) continue;
    out.push(edge === "out" ? p.clip.in_pts_us + len : p.clip.out_pts_us - len);
  }
  return out;
}
