/**
 * v3 Phase C.9 (ADR-108): Dual timeline comparison of two cuts (Pro).
 *
 * Pure computation functions and schemas for comparing two cuts of a reel:
 * - Cut A (Active edit) vs Cut B (Reference cut / historical snapshot / saved block).
 * - Per-clip diff detection (MATCHED, TRIMMED, ADDED, REMOVED).
 * - Synchronized playhead mapping (relative percentage or source-timecode match).
 */
import { z } from "zod";

export type ClipDiffStatus = "MATCHED" | "TRIMMED" | "ADDED" | "REMOVED";

export interface CutClip {
  id: string;
  source_video_id?: string;
  in_pts_us: number;
  out_pts_us: number;
  gap_us?: number;
  label?: string | null;
  start_us?: number;
  dur_us?: number;
}

export interface ClipComparisonItem {
  id: string;
  label: string | null;
  status: ClipDiffStatus;
  in_pts_us: number;
  out_pts_us: number;
  delta_in_us?: number;
  delta_out_us?: number;
  delta_dur_us?: number;
  ref_clip_id?: string;
}

export interface CutComparison {
  total_a_us: number;
  total_b_us: number;
  delta_duration_us: number;
  clips_a_count: number;
  clips_b_count: number;
  matched_count: number;
  trimmed_count: number;
  added_count: number;
  removed_count: number;
  items: ClipComparisonItem[];
  summary: string;
}

/** Calculate total duration of a cut in microseconds (including spacers/gaps) */
export function cutDurationUs(clips: CutClip[]): number {
  return clips.reduce((acc, c) => acc + (c.gap_us ?? 0) + (c.out_pts_us - c.in_pts_us), 0);
}

/** Compute diff between primary Cut A and comparison Cut B */
export function computeCutDiff(
  cutA: CutClip[],
  cutB: CutClip[],
  timeToleranceUs = 40_000, // 1 frame at 25 fps
): CutComparison {
  const totalA = cutDurationUs(cutA);
  const totalB = cutDurationUs(cutB);
  const deltaDur = totalA - totalB;

  const items: ClipComparisonItem[] = [];
  const bMatched = new Set<string>();

  let matchedCount = 0;
  let trimmedCount = 0;
  let addedCount = 0;

  for (const a of cutA) {
    // Try to find matching clip in Cut B by ID or source range overlap
    const bMatch = cutB.find(
      (b) =>
        !bMatched.has(b.id) &&
        (b.id === a.id ||
          (Math.abs(b.in_pts_us - a.in_pts_us) < 2_000_000 &&
            Math.abs(b.out_pts_us - a.out_pts_us) < 2_000_000)),
    );

    if (bMatch) {
      bMatched.add(bMatch.id);
      const deltaIn = a.in_pts_us - bMatch.in_pts_us;
      const deltaOut = a.out_pts_us - bMatch.out_pts_us;
      const durA = a.out_pts_us - a.in_pts_us;
      const durB = bMatch.out_pts_us - bMatch.in_pts_us;
      const deltaClipDur = durA - durB;

      if (Math.abs(deltaIn) <= timeToleranceUs && Math.abs(deltaOut) <= timeToleranceUs) {
        matchedCount++;
        items.push({
          id: a.id,
          label: a.label ?? null,
          status: "MATCHED",
          in_pts_us: a.in_pts_us,
          out_pts_us: a.out_pts_us,
          delta_in_us: 0,
          delta_out_us: 0,
          delta_dur_us: 0,
          ref_clip_id: bMatch.id,
        });
      } else {
        trimmedCount++;
        items.push({
          id: a.id,
          label: a.label ?? null,
          status: "TRIMMED",
          in_pts_us: a.in_pts_us,
          out_pts_us: a.out_pts_us,
          delta_in_us: deltaIn,
          delta_out_us: deltaOut,
          delta_dur_us: deltaClipDur,
          ref_clip_id: bMatch.id,
        });
      }
    } else {
      addedCount++;
      items.push({
        id: a.id,
        label: a.label ?? null,
        status: "ADDED",
        in_pts_us: a.in_pts_us,
        out_pts_us: a.out_pts_us,
        delta_dur_us: a.out_pts_us - a.in_pts_us,
      });
    }
  }

  let removedCount = 0;
  for (const b of cutB) {
    if (!bMatched.has(b.id)) {
      removedCount++;
      items.push({
        id: b.id,
        label: b.label ?? null,
        status: "REMOVED",
        in_pts_us: b.in_pts_us,
        out_pts_us: b.out_pts_us,
        delta_dur_us: -(b.out_pts_us - b.in_pts_us),
        ref_clip_id: b.id,
      });
    }
  }

  // Summary message
  const parts: string[] = [];
  const deltaS = (deltaDur / 1e6).toFixed(1);
  if (deltaDur === 0) {
    parts.push("Both cuts same duration");
  } else if (deltaDur > 0) {
    parts.push(`Cut A +${deltaS}s longer`);
  } else {
    parts.push(`Cut A ${deltaS}s shorter`);
  }

  if (addedCount > 0) parts.push(`${addedCount} added`);
  if (removedCount > 0) parts.push(`${removedCount} removed`);
  if (trimmedCount > 0) parts.push(`${trimmedCount} trimmed`);
  if (matchedCount > 0 && !addedCount && !removedCount && !trimmedCount) parts.push("All cuts identical");

  const summary = parts.join(" · ");

  return {
    total_a_us: totalA,
    total_b_us: totalB,
    delta_duration_us: deltaDur,
    clips_a_count: cutA.length,
    clips_b_count: cutB.length,
    matched_count: matchedCount,
    trimmed_count: trimmedCount,
    added_count: addedCount,
    removed_count: removedCount,
    items,
    summary,
  };
}

/** Map playhead from Cut A to Cut B */
export function syncPlayhead(
  playheadAUs: number,
  cutA: CutClip[],
  cutB: CutClip[],
  mode: "RELATIVE" | "SOURCE_MATCH" = "RELATIVE",
): number {
  const totalA = cutDurationUs(cutA);
  const totalB = cutDurationUs(cutB);
  if (totalA <= 0 || totalB <= 0) return 0;

  if (mode === "RELATIVE") {
    const fraction = Math.max(0, Math.min(1, playheadAUs / totalA));
    return Math.round(fraction * totalB);
  }

  // SOURCE_MATCH: locate which clip is under playhead A and find source timestamp
  let cursorA = 0;
  let targetSrcUs: number | null = null;
  for (const ca of cutA) {
    const gap = ca.gap_us ?? 0;
    cursorA += gap;
    const dur = ca.out_pts_us - ca.in_pts_us;
    if (playheadAUs >= cursorA && playheadAUs <= cursorA + dur) {
      targetSrcUs = ca.in_pts_us + (playheadAUs - cursorA);
      break;
    }
    cursorA += dur;
  }

  if (targetSrcUs !== null) {
    // Locate corresponding position in Cut B
    let cursorB = 0;
    for (const cb of cutB) {
      const gap = cb.gap_us ?? 0;
      cursorB += gap;
      const dur = cb.out_pts_us - cb.in_pts_us;
      if (targetSrcUs >= cb.in_pts_us && targetSrcUs <= cb.out_pts_us) {
        return cursorB + (targetSrcUs - cb.in_pts_us);
      }
      cursorB += dur;
    }
  }

  // Fallback to relative progress
  return Math.round((playheadAUs / totalA) * totalB);
}

export const CutComparisonSchema = z.object({
  total_a_us: z.number().int().nonnegative(),
  total_b_us: z.number().int().nonnegative(),
  delta_duration_us: z.number().int(),
  clips_a_count: z.number().int().nonnegative(),
  clips_b_count: z.number().int().nonnegative(),
  matched_count: z.number().int().nonnegative(),
  trimmed_count: z.number().int().nonnegative(),
  added_count: z.number().int().nonnegative(),
  removed_count: z.number().int().nonnegative(),
  summary: z.string(),
});
export type CutComparisonSchema = z.infer<typeof CutComparisonSchema>;
