"use client";
/**
 * The organization's reels that have a finished render with a file (GET /v1/reels), newest render first. Shared by Home's Featured Reel
 * (Section 03) and Sample Reels (Section 07), so the page asks once. A failed read is not the empty state: the hook reports null, and
 * reloadRenderedReels() re-reads them (the page's retry), instead of the person reloading the tab.
 */
import type { Reel } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export type Playback = { url: string; download_url: string };

let pending: Promise<Reel[]> | null = null;

function load(): Promise<Reel[]> {
  pending ??= api<Reel[]>("/v1/reels").then((all) => {
    const done = all.filter((r) => r.last_good_render?.has_output);                 // a finished file, even while a newer render runs
    return done.sort((a, b) => (b.last_good_render!.completed_at ?? "").localeCompare(a.last_good_render!.completed_at ?? ""));
  }).finally(() => { setTimeout(() => { pending = null; }, 0); });
  return pending;
}

/** re-read the reels (a failed read is retried from the page, not by reloading the tab) */
const reloadListeners = new Set<() => void>();
export function reloadRenderedReels() {
  pending = null;
  reloadListeners.forEach((fn) => fn());
}

/** undefined while loading, null when the reels could not be read */
export function useRenderedReels(): Reel[] | null | undefined {
  const [reels, setReels] = useState<Reel[] | null | undefined>(undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    reloadListeners.add(bump);
    return () => { reloadListeners.delete(bump); };
  }, []);
  useEffect(() => {
    let live = true;
    setReels(undefined);
    void load().then((r) => { if (live) setReels(r); }, () => { if (live) setReels(null); });
    return () => { live = false; };
  }, [tick]);
  return reels;
}

export const playback = (reel: Reel) => api<Playback>(`/v1/renders/${reel.last_good_render!.id}/playback`);

/** the rendered file's length: measured by the render, else the reel's planned length */
export function reelSeconds(reel: Reel): number {
  const r = (reel.last_good_render?.result ?? {}) as { duration_s?: number };
  return r.duration_s ?? reel.duration_us / 1e6;
}

export function mmss(seconds: number) {
  const t = Math.round(seconds);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
