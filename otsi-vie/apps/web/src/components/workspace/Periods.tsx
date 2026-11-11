"use client";
/**
 * Match time on Page 04 (migration 0030): the halves the engine proposed (or a person confirmed), a draft while handles are dragged on the
 * timeline, and the Time Range choice (Full Match / 1st Half / 2nd Half) that zooms the timeline and moves the video.
 */
import type { MatchPeriods, Period } from "@otsi-vie/contracts";
import { useCallback, useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

export type Range = "FULL" | "FIRST" | "SECOND";
export type PeriodsState = {
  data: MatchPeriods | null;
  /** the halves as shown: the person's unsaved drag, else the stored ones */
  shown: { first: Period | null; second: Period | null };
  dirty: boolean;
  drag(which: "first" | "second", edge: "start_us" | "end_us", us: number): void;
  confirm(): Promise<string | null>;
  reset(): void;
  range: Range;
  setRange(r: Range): void;
  /** the time window the timeline shows: the chosen half, else the whole video */
  window(durationUs: number): [number, number];
};

export function usePeriods(videoId: string | undefined): PeriodsState {
  const { t: dict } = useLocale();
  const [data, setData] = useState<MatchPeriods | null>(null);
  const [draft, setDraft] = useState<{ first: Period | null; second: Period | null } | null>(null);
  const [range, setRange] = useState<Range>("FULL");
  const reload = useCallback(async () => {
    if (!videoId) { setData(null); return; }
    try { setData(await api<MatchPeriods>(`/v1/videos/${videoId}/match-periods`)); } catch { /* keep what is shown */ }
  }, [videoId]);
  useEffect(() => { setData(null); setDraft(null); setRange("FULL"); void reload(); }, [reload]);
  const shown = draft ?? { first: data?.first ?? null, second: data?.second ?? null };
  const drag = (which: "first" | "second", edge: "start_us" | "end_us", us: number) => {
    const cur = { first: shown.first, second: shown.second };
    const p = cur[which];
    if (!p) return;
    const next = { ...p, [edge]: Math.max(0, Math.round(us / 1e6) * 1e6) };
    // keep each half at least a minute long and in order
    if (next.end_us - next.start_us < 60e6) return;
    if (which === "first" && cur.second && next.end_us > cur.second.start_us) return;
    if (which === "second" && cur.first && next.start_us < cur.first.end_us) return;
    setDraft({ ...cur, [which]: next });
  };
  const confirm = async () => {
    if (!videoId || !shown.first) return dict.body.workspace.nothingConfirm;
    try {
      setData(await api<MatchPeriods>(`/v1/videos/${videoId}/match-periods`, { method: "PUT", json: { first: shown.first, second: shown.second } }));
      setDraft(null); return null;
    } catch (x) { return x instanceof ApiProblem ? x.message : dict.body.workspace.notSaved; }
  };
  const window = (dur: number): [number, number] => {
    const p = range === "FIRST" ? shown.first : range === "SECOND" ? shown.second : null;
    return p ? [p.start_us, p.end_us] : [0, dur];
  };
  return { data, shown, dirty: !!draft, drag, confirm, reset: () => setDraft(null), range, setRange, window };
}
