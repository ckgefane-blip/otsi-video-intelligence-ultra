"use client";
/**
 * Desktop UI v2 (owner, 2026-11-11): the interface mode is Guided or Advanced.
 *
 * - Guided hides the advanced screens (Tactical, Clip Studio, Admin) from the rail and from their routes, and any control marked
 *   `data-advanced`. Advanced shows everything. Both modes are free — this is not a paid plan.
 * - "Pro" now means only the paid subscription tier, so it is never a mode name here. Navigation entries carry `advanced: true`
 *   (formerly `pro: true`).
 * - The per-page Guided / Pro choice of ADR-072 (lib/uiMode.tsx, API value "PRO") is unchanged on the wire; the person reads it as
 *   "Advanced" (dictionary `modePro`). This file is the global, per-browser choice that decides which screens are offered.
 *
 * Kept in this browser (per person, per browser); every read and write tolerates blocked storage (the default, Advanced, applies).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type InterfaceMode = "guided" | "advanced";
export const DEFAULT_INTERFACE_MODE: InterfaceMode = "advanced";
export const INTERFACE_STORAGE_KEY = "otsi-vie.interface-mode";

/** the routes Guided does not offer (their nav entries carry `advanced: true`) */
export const ADVANCED_ROUTES = [/^\/tactics(\/|$)/, /^\/videos\/[^/]+\/tactics(\/|$)/, /^\/studio(\/|$)/, /^\/settings\/admin(\/|$)/];
export const isAdvancedRoute = (path: string) => ADVANCED_ROUTES.some((r) => r.test(path));

interface State { mode: InterfaceMode; setMode(m: InterfaceMode): void }
const Ctx = createContext<State>({ mode: DEFAULT_INTERFACE_MODE, setMode: () => {} });
export const useInterfaceMode = () => useContext(Ctx);

function read(): InterfaceMode {
  try { return localStorage.getItem(INTERFACE_STORAGE_KEY) === "guided" ? "guided" : "advanced"; } catch { return DEFAULT_INTERFACE_MODE; }
}

export function InterfaceModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<InterfaceMode>(DEFAULT_INTERFACE_MODE);
  useEffect(() => { setModeState(read()); }, []);
  useEffect(() => { document.documentElement.dataset.interface = mode; }, [mode]);
  const setMode = useCallback((m: InterfaceMode) => {
    setModeState(m);
    try { localStorage.setItem(INTERFACE_STORAGE_KEY, m); } catch { /* blocked storage: this visit only */ }
  }, []);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
