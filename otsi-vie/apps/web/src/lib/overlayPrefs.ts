"use client";
/**
 * The viewer's default video overlays (people boxes, track labels, ball; player tracks, team shapes, heatmap, pass arrows), set in the Library's left panel and used by the video pages
 * (Tactical) as their starting choice. A per-viewer display preference: kept in this browser only; every read and write tolerates
 * private windows and blocked storage (the defaults then apply).
 */
import { useCallback, useEffect, useState } from "react";

export interface OverlayPrefs { boxes: boolean; ids: boolean; ball: boolean; trails: boolean; shapes: boolean; heat: boolean; passes: boolean }
export const DEFAULT_OVERLAYS: OverlayPrefs = { boxes: true, ids: true, ball: true, trails: false, shapes: false, heat: false, passes: false };
const KEY = "otsi.overlays";
const EVENT = "otsi-overlays";

export function readOverlays(): OverlayPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<OverlayPrefs> | null;
    return { ...DEFAULT_OVERLAYS, ...(v ?? {}) };
  } catch { return DEFAULT_OVERLAYS; }
}

export function useOverlayPrefs(): [OverlayPrefs, (p: OverlayPrefs) => void] {
  const [prefs, setPrefs] = useState<OverlayPrefs>(DEFAULT_OVERLAYS);
  useEffect(() => {
    setPrefs(readOverlays());
    const on = () => setPrefs(readOverlays());
    addEventListener(EVENT, on); addEventListener("storage", on);
    return () => { removeEventListener(EVENT, on); removeEventListener("storage", on); };
  }, []);
  const save = useCallback((p: OverlayPrefs) => {
    setPrefs(p);
    try { localStorage.setItem(KEY, JSON.stringify(p)); dispatchEvent(new Event(EVENT)); } catch { /* storage blocked: this visit only */ }
  }, []);
  return [prefs, save];
}
