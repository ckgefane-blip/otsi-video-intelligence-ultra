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
  type CutComparison,
} from "@otsi-vie/contracts";
import React, { useEffect, useMemo, useState } from "react";
import { typing } from "@/lib/keymap";
import { tc, type Ui } from "./kit";
import type { Studio } from "./useStudio";
import { useLocale, type Dictionary } from "@/lib/i18n";

/** the cut-diff summary, translated at the render site: mirrors contracts computeCutDiff parts exactly (contracts stays English) */
const cutDiffSummary = (diff: CutComparison, d: Dictionary): string => {
  const parts: string[] = [];
  const deltaS = (diff.delta_duration_us / 1e6).toFixed(1);
  if (diff.delta_duration_us === 0) parts.push(d.body.studio.bothCutsSameDuration);
  else if (diff.delta_duration_us > 0) parts.push(d.body.studio.cutALonger.replace("{a}", deltaS));
  else parts.push(d.body.studio.cutAShorter.replace("{a}", deltaS));
  if (diff.added_count > 0) parts.push(d.body.studio.addedCountN.replace("{a}", String(diff.added_count)));
  if (diff.removed_count > 0) parts.push(d.body.studio.removedCountN.replace("{a}", String(diff.removed_count)));
  if (diff.trimmed_count > 0) parts.push(d.body.studio.trimmedCountN.replace("{a}", String(diff.trimmed_count)));
  if (diff.matched_count > 0 && !diff.added_count && !diff.removed_count && !diff.trimmed_count) parts.push(d.body.studio.allCutsIdentical);
  return parts.join(" · ");
};

interface DualTimelineProps {
  st: Studio;
  ui: Ui;
  onClose: () => void;
}

export function DualTimeline({ st, ui, onClose }: DualTimelineProps) {
  const { t: dict } = useLocale();
  const [syncMode, setSyncMode] = useState<"RELATIVE" | "SOURCE_MATCH">("SOURCE_MATCH");
  const [cutBClips, setCutBClips] = useState<CutClip[]>([]);
  const [cutBLabel, setCutBLabel] = useState<string>(dict.body.studio.initialSnapshot);

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
      setCutBLabel(dict.body.studio.baselineReference);
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
    ui.say(dict.body.studio.applyingCutB);
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
    setCutBLabel(dict.body.studio.currentSnapshot);
    ui.say(dict.body.studio.capturedCutB);
  };

  // Blueprint §2.3: snapshot-and-swap keyboard control — B snapshots the active cut as Cut B, Shift+B applies Cut B.
  // The panel is only mounted while dual comparison is open, so the keys cannot fire elsewhere in the studio.
  // No dep array, like the other studio key handlers: the closures stay fresh and the listener is re-registered each render.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "b" && e.key !== "B") return;
      e.preventDefault();
      if (e.shiftKey) handleApplyCutB(); else handleCaptureReference();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  return (
    <section
      data-dual-timeline=""
      aria-label={dict.body.studio.dualTimelineCompare}
      className="relative z-20 flex flex-col gap-2 rounded border border-[#1e90ff]/60 bg-[#06142e] p-3 text-white shadow-xl"
    >
      {/* Header bar: summary, stats, controls */}
      <div className="t-body flex items-center justify-between border-b border-[#12335f] pb-2">
        <div className="flex items-center gap-3">
          <span className="t-panel text-[#33a8ff]">{dict.body.studio.dualTimelinePro}</span>
          <span
            data-cut-diff-summary=""
            className="text-xs rounded bg-[#0b2447] px-2.5 py-1 font-normal text-[#cfe0f5]"
          >
            {cutDiffSummary(diff, dict)}
          </span>
          <span className="t-small">
            {dict.body.studio.cutA}: {tc(totalA)} · {dict.body.studio.cutB} ({cutBLabel}): {tc(totalB)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Sync mode toggle */}
          <button
            type="button"
            data-dual-sync-mode={syncMode}
            onClick={() => setSyncMode(syncMode === "SOURCE_MATCH" ? "RELATIVE" : "SOURCE_MATCH")}
            className="text-xs rounded border border-[#1e90ff]/40 bg-[#0a2040] px-2.5 py-1 font-normal text-[#cfe8ff] hover:bg-[#123566]"
            title={dict.body.studio.toggleSyncHint}
          >
            Sync: {syncMode === "SOURCE_MATCH" ? dict.body.studio.syncSource : dict.body.studio.syncRelative}
          </button>

          {/* Capture Snapshot */}
          <button
            type="button"
            onClick={handleCaptureReference}
            title={dict.body.studio.snapshotCutBHint}
            className="text-xs rounded border border-[#1e90ff]/40 bg-[#0a2040] px-2.5 py-1 font-normal text-[#cfe8ff] hover:bg-[#123566]"
          >{dict.body.studio.snapshotCut}
          </button>

          {/* Apply Cut B to Reel */}
          <button
            type="button"
            data-dual-swap=""
            onClick={handleApplyCutB}
            className="t-button rounded bg-[#1e90ff] px-3 py-1 text-white hover:bg-[#33a8ff]"
            title={dict.body.studio.restoreCutBHint}
          >{dict.body.studio.applyCutB}
          </button>

          {/* Close Dual Mode */}
          <button
            type="button"
            aria-label={dict.body.studio.closeDualTimeline}
            onClick={onClose}
            className="t-panel ml-2 text-[#8ea3bf] hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Dual timeline comparison lanes */}
      <div className="flex flex-col gap-1.5 flex-1 justify-center">
        {/* Cut A (Active Edit) Lane */}
        <div className="flex items-center gap-2">
          <span className="w-16 text-right text-xs font-normal text-[#33a8ff]">{dict.body.studio.cutA}</span>
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
                  title={`${c.label ?? dict.body.workspace.metricClip} (${((c.out_pts_us - c.in_pts_us) / 1e6).toFixed(1)}s)${
                    isTrimmed ? dict.body.studio.trimmedSuffix : isAdded ? dict.body.studio.addedInCutASuffix : ""
                  }`}
                >
                  <span className="truncate">{c.label ?? dict.body.studio.clipIndex.replace("{a}", String(i + 1))}</span>
                  {isTrimmed && <span className="ml-1 text-xs opacity-75">Δ</span>}
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
          <span className="w-16 text-right text-xs font-normal text-[#f5b82e]">{dict.body.studio.cutB}</span>
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
                  title={`${c.label ?? dict.body.workspace.metricClip} (${((c.out_pts_us - c.in_pts_us) / 1e6).toFixed(1)}s)${
                    isRemoved ? dict.body.studio.removedFromCutASuffix : isTrimmed ? dict.body.studio.trimmedSuffix : ""
                  }`}
                >
                  <span className="truncate">{c.label ?? dict.body.studio.refClipN.replace("{a}", String(i + 1))}</span>
                  {isRemoved && <span className="ml-1 text-xs text-red-300">✕</span>}
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
