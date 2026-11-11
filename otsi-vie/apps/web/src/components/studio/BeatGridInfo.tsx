"use client";
/**
 * v3 Phase C.5 (ADR-105): Beat grid status, beat analysis trigger, and licence note.
 *
 * Calls GET /v1/brand-assets/:id/beat-grid and POST /v1/brand-assets/:id/beat-grid.
 * Shows the beat description (Detected; accuracy not measured) and allows requesting beat analysis.
 */
import { beatsUsable, type BeatGrid, type BeatGridView } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";

/** the beat description, translated at the render site: mirrors contracts describeBeatGrid branch for branch (contracts stays English) */
const beatDesc = (g: BeatGrid | null, d: Dictionary): string => {
  if (!g) return d.body.studio.beatNotAnalysed;
  if (g.status === "QUEUED") return d.body.studio.beatWaiting;
  if (g.status === "RUNNING") return d.body.studio.beatFinding;
  if (g.status === "FAILED") return g.failure ?? d.body.studio.beatNotFound;
  if (!beatsUsable(g)) return d.body.studio.beatNoSteady;
  return d.body.studio.beatDetected.replace("{a}", String(Math.round(g.tempo_bpm ?? 0))).replace("{b}", String(g.beats_us.length));
};

export function useBeatGrid(musicId: string | null | undefined) {
  const { t: dict } = useLocale();
  const [grid, setGrid] = useState<BeatGrid | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!musicId) { setGrid(null); return; }
    let dead = false;
    setLoading(true);
    void api<BeatGridView>(`/v1/brand-assets/${musicId}/beat-grid`)
      .then((v) => { if (!dead) { setGrid(v.grid); setLoading(false); } })
      .catch(() => { if (!dead) { setGrid(null); setLoading(false); } });
    return () => { dead = true; };
  }, [musicId, version]);

  useEffect(() => {
    if (!musicId || !grid || (grid.status !== "QUEUED" && grid.status !== "RUNNING")) return;
    const t = setInterval(() => setVersion((v) => v + 1), 2000);
    return () => clearInterval(t);
  }, [musicId, grid?.status]);

  const findBeat = async () => {
    if (!musicId) return;
    try {
      const res = await api<BeatGridView>(`/v1/brand-assets/${musicId}/beat-grid`, { method: "POST" });
      setGrid(res.grid);
      setVersion((v) => v + 1);
    } catch {
      // handled by caller or state
    }
  };

  return { grid, loading, findBeat, usable: beatsUsable(grid), desc: beatDesc(grid, dict) };
}

export function BeatStatusRow({ musicId, canEdit }: { musicId: string; canEdit: boolean }) {
  const { t: dict } = useLocale();
  const { grid, findBeat, desc } = useBeatGrid(musicId);
  const showBtn = canEdit && (!grid || grid.status === "FAILED");
  const busy = grid?.status === "QUEUED" || grid?.status === "RUNNING";

  return (
    <div className="flex items-center gap-2 text-xs" data-beat-status={grid?.status ?? "NONE"}>
      <span className="text-[#cfe0f5]" title={dict.body.studio.beatLibraryNote}>{dict.body.studio.beatLabel.replace("{a}", desc)}</span>
      {showBtn && (
        <button type="button" data-find-beat={musicId} onClick={() => void findBeat()}
          className="rounded border border-[#33a8ff]/60 bg-[#1e90ff]/20 px-2 py-0.5 text-xs text-[#cfe0f5] hover:bg-[#1e90ff]/30">{dict.body.studio.findBeat}
        </button>
      )}
      {busy && <span className="text-[#8ea3bf]">{dict.body.studio.analyzing}</span>}
    </div>
  );
}
