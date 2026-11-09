"use client";
/**
 * Page 07 / ADR-108 (v3 Phase C.9): Dual timeline comparison of two cuts (Pro).
 *
 * Provides side-by-side / stacked comparison of Cut A (Active edit) against
 * Cut B (Reference cut / historical snapshot / saved clip block).
 *
 * Displays visual difference highlights:
 * - MATCHED: Identical cut points
 * - TRIMMED: Retimed / trimmed differently (shows delta in seconds)
 * - ADDED: Present in Cut A, absent in Cut B (green accent)
 * - REMOVED: Present in Cut B, absent in Cut A (red accent)
 */
import {
  computeCutDiff,
  cutDurationUs,
  syncPlayhead,
  type ClipComparisonItem,
  type CutClip,
} from "@otsi-vie/contracts";
import React, { useEffect, useMemo, useState } from "react";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { tc, type Ui } from "./kit";
import type { Studio } from "./useStudio";

interface DualTimelineProps {
  st: Studio;
  ui: Ui;
  onClose: () => void;
}

export function DualTimeline({ st, ui, onClose }: DualTimelineProps) {
  const [syncMode, setSyncMode] = useState<"RELATIVE" | "SOURCE_MATCH">("SOURCE_MATCH");
  const [cutBClips, setCutBClips] = useState<CutClip[]>([]);
  const [cutBLabel, setCutBLabel] = useState<string>("Initial Snapshot");

  // Cut A is the active edit
  const cutAClips: CutClip[] = useMemo(() => {
    return st.items.map((p) => ({
      id: p.clip.id,
      in_pts_us: p.clip.in_pts_us,
      out_pts_us: p.clip.out_pts_us,
      gap_us: (p.clip.fx?.gap_ms ?? 0) * 1000,
      label: p.clip.label,
    }));
  }, [st.items]);

  // Initialize Cut B to initial snapshot or historical state if not yet set
  useEffect(() => {
    if (!cutBClips.length && cutAClips.length) {
      // By default, capture an initial reference state
      setCutBClips([...cutAClips]);
      setCutBLabel("Baseline Reference");
    }
  }, [cutAClips, cutBClips.length]);

  const diff = useMemo(() => {
    return computeCutDiff(cutAClips, cutBClips);
  }, [cutAClips, cutBClips]);

  const totalA = diff.total_a_us;
  const totalB = diff.total_b_us;

  // Synced playhead in Cut B
  const playheadB = useMemo(() => {
    return syncPlayhead(st.playhead, cutAClips, cutBClips, syncMode);
  }, [st.playhead, cutAClips, cutBClips, syncMode]);

  const handleApplyCutB = () => {
    if (!st.reel || !cutBClips.length) return;
    ui.say("Applying Cut B to active reel…");
    // Reorder and re-trim clips matching Cut B
    for (const b of cutBClips) {
      const match = st.items.find((p) => p.clip.id === b.id);
      if (match && (match.clip.in_pts_us !== b.in_pts_us || match.clip.out_pts_us !== b.out_pts_us)) {
        st.trim(match.clip, b.in_pts_us, b.out_pts_us);
      }
    }
    const ids = cutBClips.map((c) => c.id).filter((id) => st.items.some((p) => p.clip.id === id));
    if (ids.length) st.reorder(ids);
  };

  const handleCaptureReference = () => {
    setCutBClips([...cutAClips]);
    setCutBLabel("Current Snapshot");
    ui.say("Captured current timeline as reference Cut B");
  };

  return (
    <section
      data-dual-timeline=""
      aria-label="Dual timeline cut comparison"
      className="relative flex flex-col gap-2 rounded border border-[#1e90ff]/60 bg-[#06142e] p-3 text-white shadow-xl z-20"
      style={{
        left: u(28),
        top: u(830 - 101),
        width: u(2506),
        height: u(155),
      }}
    >
      {/* Header bar: summary, stats, controls */}
      <div className="flex items-center justify-between border-b border-[#12335f] pb-2 text-sm">
        <div className="flex items-center gap-3">
          <span className="font-bold text-[#33a8ff]">DUAL TIMELINE (PRO)</span>
          <span
            data-cut-diff-summary=""
            className="rounded bg-[#0b2447] px-2.5 py-1 text-xs font-semibold text-[#cfe0f5]"
          >
            {diff.summary}
          </span>
          <span className="text-xs text-[#8ea3bf]">
            Cut A: {tc(totalA)} · Cut B ({cutBLabel}): {tc(totalB)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Sync mode toggle */}
          <button
            type="button"
            data-dual-sync-mode={syncMode}
            onClick={() => setSyncMode(syncMode === "SOURCE_MATCH" ? "RELATIVE" : "SOURCE_MATCH")}
            className="rounded border border-[#1e90ff]/40 bg-[#0a2040] px-2.5 py-1 text-xs font-medium text-[#cfe8ff] hover:bg-[#123566]"
            title="Toggle between source-timecode match and relative percentage playhead sync"
          >
            Sync: {syncMode === "SOURCE_MATCH" ? "Source Timecode" : "Relative %"}
          </button>

          {/* Capture Snapshot */}
          <button
            type="button"
            onClick={handleCaptureReference}
            className="rounded border border-[#1e90ff]/40 bg-[#0a2040] px-2.5 py-1 text-xs font-medium text-[#cfe8ff] hover:bg-[#123566]"
          >
            Snapshot Cut
          </button>

          {/* Apply Cut B to Reel */}
          <button
            type="button"
            data-dual-swap=""
            onClick={handleApplyCutB}
            className="rounded bg-[#1e90ff] px-3 py-1 text-xs font-semibold text-white hover:bg-[#33a8ff]"
            title="Restore reference Cut B into the active reel timeline"
          >
            Apply Cut B
          </button>

          {/* Close Dual Mode */}
          <button
            type="button"
            aria-label="Close dual timeline"
            onClick={onClose}
            className="ml-2 text-base font-semibold text-[#8ea3bf] hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Dual timeline comparison lanes */}
      <div className="flex flex-col gap-1.5 flex-1 justify-center">
        {/* Cut A (Active Edit) Lane */}
        <div className="flex items-center gap-2">
          <span className="w-16 text-right text-xs font-bold text-[#33a8ff]">Cut A</span>
          <div className="relative flex-1 h-7 rounded border border-[#1d4f8a] bg-[#040e20] overflow-hidden flex">
            {cutAClips.map((c, i) => {
              const dur = (c.gap_us ?? 0) + (c.out_pts_us - c.in_pts_us);
              const widthPct = totalA > 0 ? (dur / totalA) * 100 : 0;
              const itemDiff = diff.items.find((item) => item.id === c.id);
              const isTrimmed = itemDiff?.status === "TRIMMED";
              const isAdded = itemDiff?.status === "ADDED";

              return (
                <div
                  key={c.id || i}
                  data-dual-clip-a={c.id}
                  data-clip-status={itemDiff?.status}
                  style={{ width: `${widthPct}%` }}
                  className={`h-full border-r border-[#06142e] flex items-center px-2 text-xs truncate ${
                    isAdded
                      ? "bg-[#186035] text-[#bbf7d0]"
                      : isTrimmed
                      ? "bg-[#785010] text-[#fef08a]"
                      : "bg-[#103866] text-[#cfe8ff]"
                  }`}
                  title={`${c.label ?? "Clip"} (${((c.out_pts_us - c.in_pts_us) / 1e6).toFixed(1)}s)${
                    isTrimmed ? " · Trimmed" : isAdded ? " · Added in Cut A" : ""
                  }`}
                >
                  <span className="truncate">{c.label ?? `Clip ${i + 1}`}</span>
                  {isTrimmed && <span className="ml-1 text-[10px] opacity-75">Δ</span>}
                </div>
              );
            })}
            {/* Playhead A line */}
            {totalA > 0 && (
              <div
                style={{ left: `${(st.playhead / totalA) * 100}%` }}
                className="absolute top-0 bottom-0 w-0.5 bg-[#f5b82e] z-10 pointer-events-none"
              />
            )}
          </div>
          <span className="w-14 text-xs font-mono text-[#8ea3bf]">{tc(st.playhead)}</span>
        </div>

        {/* Cut B (Comparison Cut) Lane */}
        <div className="flex items-center gap-2">
          <span className="w-16 text-right text-xs font-bold text-[#f5b82e]">Cut B</span>
          <div className="relative flex-1 h-7 rounded border border-[#6b5014] bg-[#040e20] overflow-hidden flex">
            {cutBClips.map((c, i) => {
              const dur = (c.gap_us ?? 0) + (c.out_pts_us - c.in_pts_us);
              const widthPct = totalB > 0 ? (dur / totalB) * 100 : 0;
              const itemDiff = diff.items.find((item) => item.ref_clip_id === c.id || item.id === c.id);
              const isRemoved = itemDiff?.status === "REMOVED";
              const isTrimmed = itemDiff?.status === "TRIMMED";

              return (
                <div
                  key={c.id || i}
                  data-dual-clip-b={c.id}
                  data-clip-status={itemDiff?.status}
                  style={{ width: `${widthPct}%` }}
                  className={`h-full border-r border-[#06142e] flex items-center px-2 text-xs truncate ${
                    isRemoved
                      ? "bg-[#661515] text-[#fecaca] border-dashed border-red-500"
                      : isTrimmed
                      ? "bg-[#553808] text-[#fde047]"
                      : "bg-[#284060] text-[#cfe8ff]"
                  }`}
                  title={`${c.label ?? "Clip"} (${((c.out_pts_us - c.in_pts_us) / 1e6).toFixed(1)}s)${
                    isRemoved ? " · Removed from Cut A" : isTrimmed ? " · Trimmed" : ""
                  }`}
                >
                  <span className="truncate">{c.label ?? `Ref ${i + 1}`}</span>
                  {isRemoved && <span className="ml-1 text-[10px] text-red-300">✕</span>}
                </div>
              );
            })}
            {/* Playhead B line */}
            {totalB > 0 && (
              <div
                style={{ left: `${(playheadB / totalB) * 100}%` }}
                className="absolute top-0 bottom-0 w-0.5 bg-[#33a8ff] z-10 pointer-events-none"
              />
            )}
          </div>
          <span className="w-14 text-xs font-mono text-[#8ea3bf]">{tc(playheadB)}</span>
        </div>
      </div>
    </section>
  );
}
