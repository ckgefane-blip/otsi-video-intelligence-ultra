"use client";
/**
 * One evidence badge for every value and overlay (v3 Phase A.5, S06, ADR-063): how the engine knows it.
 *   DETECTED      seen by the engine in the frames (a detection, a track, an event found from the followed ball)
 *   INFERRED      worked out from what was seen (positions on a calibrated pitch: distance, speed, sprints)
 *   CONFIRMED     a person decided it (an identity confirmed on a track, an approved team sheet)
 *   NOT_MEASURED  the engine does not measure it (yet); shown instead of a number, never as zero
 * While the accuracy gates are open (ADR-063) the tooltip of a detected or inferred value adds that the engine's accuracy is not yet
 * measured. Sizes are design pixels (`--u` on design-stage pages, 1 px elsewhere).
 */
import { accuracyMeasured } from "@otsi-vie/contracts";
import type { CSSProperties } from "react";

export type EvidenceLevel = "DETECTED" | "INFERRED" | "CONFIRMED" | "NOT_MEASURED";

export const EVIDENCE: Record<EvidenceLevel, { label: string; letter: string; bg: string; fg: string; meaning: string }> = {
  DETECTED: { label: "Detected", letter: "D", bg: "#08311f", fg: "#3ee6a8", meaning: "Seen by the engine in the video" },
  INFERRED: { label: "Inferred", letter: "I", bg: "#3a2a08", fg: "#ffc66d", meaning: "Worked out from what the engine saw" },
  CONFIRMED: { label: "Confirmed", letter: "C", bg: "#0a2b55", fg: "#6cc4ff", meaning: "Decided by a person" },
  NOT_MEASURED: { label: "Not measured", letter: "–", bg: "#1a2232", fg: "#8ea3bf", meaning: "The engine does not measure this yet" },
};

/** the badge's tooltip: what the level means, why for this value, and the accuracy note while the gates are open */
export function evidenceTitle(level: EvidenceLevel, why?: string, measured = accuracyMeasured()): string {
  const e = EVIDENCE[level];
  const acc = (level === "DETECTED" || level === "INFERRED") && !measured ? " Accuracy not yet measured." : "";
  return `${e.label}: ${e.meaning}${why ? ` (${why})` : ""}.${acc}`;
}

const px = (n: number) => `calc(${n} * var(--u, 1px))`;

export function Evidence({ level, why, compact = false, size = 13, style }: { level: EvidenceLevel; why?: string; compact?: boolean; size?: number; style?: CSSProperties }) {
  const e = EVIDENCE[level];
  const title = evidenceTitle(level, why);
  return (
    <span data-evidence={level} title={title} aria-label={title} role="img"
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", boxSizing: "border-box", whiteSpace: "nowrap",
        fontSize: px(size), fontWeight: 700, lineHeight: 1, color: e.fg, background: e.bg, border: `${px(1)} solid ${e.fg}55`, borderRadius: px(4),
        ...(compact ? { width: px(size * 1.7), height: px(size * 1.7) } : { padding: `${px(3)} ${px(7)}` }), ...style }}>
      {compact ? e.letter : e.label}
    </span>
  );
}
