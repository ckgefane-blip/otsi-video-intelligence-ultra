"use client";
/**
 * Interface scale (Settings > Preferences, SOT): how big the app draws — 90%, 100%, 110% or 125%.
 * Kept in this browser (per person, per browser); every read and write tolerates blocked storage (the default,
 * 100%, applies). Applied as `zoom` on the document element, so the whole shell — rail, top bar, pages — scales
 * together. The app's type sizes are px, so a root font-size would not move them; zoom does.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const INTERFACE_SCALES = [90, 100, 110, 125] as const;
export type InterfaceScale = (typeof INTERFACE_SCALES)[number];
export const DEFAULT_INTERFACE_SCALE: InterfaceScale = 100;
export const INTERFACE_SCALE_KEY = "otsi-vie.interface-scale";

const isScale = (v: unknown): v is InterfaceScale =>
  typeof v === "number" && (INTERFACE_SCALES as readonly number[]).includes(v);

interface State { scale: InterfaceScale; setScale(s: InterfaceScale): void }
const Ctx = createContext<State>({ scale: DEFAULT_INTERFACE_SCALE, setScale: () => {} });
export const useInterfaceScale = () => useContext(Ctx);

function read(): InterfaceScale {
  try {
    const v = Number(localStorage.getItem(INTERFACE_SCALE_KEY));
    return isScale(v) ? v : DEFAULT_INTERFACE_SCALE;
  } catch { return DEFAULT_INTERFACE_SCALE; }
}

export function InterfaceScaleProvider({ children }: { children: ReactNode }) {
  const [scale, setScaleState] = useState<InterfaceScale>(DEFAULT_INTERFACE_SCALE);
  useEffect(() => { setScaleState(read()); }, []);
  useEffect(() => {
    document.documentElement.style.zoom = scale === 100 ? "" : String(scale / 100);
  }, [scale]);
  const setScale = useCallback((s: InterfaceScale) => {
    setScaleState(s);
    try { localStorage.setItem(INTERFACE_SCALE_KEY, String(s)); } catch { /* blocked storage: this visit only */ }
  }, []);
  const value = useMemo(() => ({ scale, setScale }), [scale, setScale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
