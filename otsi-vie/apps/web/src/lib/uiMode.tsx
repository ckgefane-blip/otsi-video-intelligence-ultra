"use client";
/**
 * v3 Phase A.7 (S05, ADR-072): Guided / Pro, per person and per page.
 * - The choice is the person's own, kept by the API (GET / PUT /v1/me/page-modes) and cached per person in this browser so a page opens
 *   in its mode at once. No choice: Pro, the approved design with every control.
 * - The page's mode is set on <html data-ui-mode>. In Guided, an element marked `data-pro` is hidden (globals.css). Guided hides controls
 *   only: every result, number and warning stays, so the same page shows the same data.
 * - Guided shows a small "Guided · show all controls" chip, so nothing is hidden without saying so.
 */
import { DEFAULT_UI_MODE, uiPageOf, type PageModes, type UiMode, type UiPage } from "@otsi-vie/contracts";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api } from "@/lib/api";

/** what Guided hides on each page (null: the page is the same in both modes for now) */
export const GUIDED_HIDES: Record<UiPage, string | null> = {
  home: null, upload: null, tactical: null, reels: null, reports: null, library: null, export: null,
  processing: "the step log and the job table",
  analysis: "re-tracking, pitch calibration, ball marks and the identity review link",
  studio: "the Edit / Colour / Review layouts, Colour and Transform on the ribbon, and Look, Zoom, Draw, Review and Reframe in Adjustments",
};
export const PAGE_NAME: Record<UiPage, string> = {
  home: "Home", upload: "Upload", processing: "Processing", analysis: "Analysis", tactical: "Tactical", reels: "Reel Builder", studio: "Clip Studio",
  reports: "Player Report", library: "Library", export: "Export",
};

type Modes = Partial<Record<UiPage, UiMode>>;
const cacheKey = (uid: string) => `otsi-vie.ui-modes.${uid}`;
const readCache = (uid: string): Modes => { try { const x = JSON.parse(localStorage.getItem(cacheKey(uid)) ?? "{}"); return x && typeof x === "object" ? x : {}; } catch { return {}; } };
const writeCache = (uid: string, m: Modes) => { try { localStorage.setItem(cacheKey(uid), JSON.stringify(m)); } catch { /* private window: the API still keeps it */ } };

export interface UiModeState { page: UiPage | null; mode: UiMode; hides: string | null; saving: boolean; error: string | null; setMode(m: UiMode): Promise<void> }
const Ctx = createContext<UiModeState | null>(null);
const NONE: UiModeState = { page: null, mode: DEFAULT_UI_MODE, hides: null, saving: false, error: null, setMode: async () => {} };
export const useUiMode = () => useContext(Ctx) ?? NONE;

export function UiModeProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const uid = me?.user.id ?? null;
  const page = uiPageOf(usePathname() ?? "/");
  const [modes, setModes] = useState<Modes>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) { setModes({}); return; }
    setModes(readCache(uid));
    let live = true;
    void api<PageModes>("/v1/me/page-modes", { organization: false }).then((r) => { if (!live) return; setModes(r.modes); writeCache(uid, r.modes); }, () => {});
    return () => { live = false; };
  }, [uid]);
  const mode: UiMode = (page && modes[page]) || DEFAULT_UI_MODE;
  useEffect(() => {
    document.documentElement.dataset.uiMode = mode;
    return () => { delete document.documentElement.dataset.uiMode; };
  }, [mode]);
  const setMode = useCallback(async (m: UiMode) => {
    if (!page || !uid) return;
    const before = modes;
    setModes({ ...modes, [page]: m }); setSaving(true); setError(null);
    try {
      const r = await api<PageModes>(`/v1/me/page-modes/${page}`, { method: "PUT", json: { mode: m }, organization: false });
      setModes(r.modes); writeCache(uid, r.modes);
    } catch { setModes(before); setError("Not saved: the page keeps its previous mode."); } finally { setSaving(false); }
  }, [page, uid, modes]);
  const hides = page ? GUIDED_HIDES[page] : null;
  return (
    <Ctx.Provider value={{ page, mode, hides, saving, error, setMode }}>
      {children}
      {mode === "GUIDED" && hides && (
        <button type="button" data-guided-chip onClick={() => void setMode("PRO")} title={`Guided hides ${hides}. Click to show every control on this page.`}
          className="fixed bottom-3 left-3 z-40 rounded-full border border-primary/60 bg-panel/95 px-3 py-1.5 text-xs text-text shadow-lg hover:border-primary">
          Guided · <span className="text-primary">show all controls</span>
        </button>
      )}
    </Ctx.Provider>
  );
}
