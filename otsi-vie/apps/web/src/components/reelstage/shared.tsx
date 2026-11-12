"use client";
/**
 * Page 06 Reel Builder: what the sections share.
 *
 * The reel, its moments, clips, targets and renders come from the existing Reel Builder context (ADR-032). The page keeps a DRAFT of the
 * reel name and spotlight look; Save Project and Generate Reel send the draft (with the reel's version) so nothing is lost. Controls for
 * features the engine does not have (description, music) are drawn as in the reference but disabled with their reason; nothing is
 * invented. The overlay and branding switches are real (ADR-044).
 *
 * Best Moment Rule v2.1 (ADR-131): the reel's target length lives here too — 90 s / 3 min (default) / 5 min, never over 5:00.
 * A cross-match reel's length was fixed when it was made (reel.cross_match_length_s) and cannot change here; a single-match reel's
 * choice is remembered per reel in this browser. The length is UI state only: the API has no length-target field for single-match
 * reels, and the per-match caps stay enforced by the API on pin/add.
 */
import { type Reel, SpotlightSettings } from "@otsi-vie/contracts";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ReelState } from "@/components/reels/ReelBuilder";

export const DEFAULTS: SpotlightSettings = SpotlightSettings.parse({});

export type ReelLengthS = 90 | 180 | 300;

export interface Stage {
  r: ReelState | null;
  draft: SpotlightSettings | null;
  setDraft(s: SpotlightSettings): void;
  name: string;
  setName(n: string): void;
  dirty: boolean;
  /** saves the draft name and spotlight look (PATCH with the reel's version); resolves with the saved reel */
  save(): Promise<Reel | null>;
  /** which inspector panel / section the user just jumped to (a short highlight) */
  focus: string | null;
  jump(id: string): void;
  tab: number;
  /** preview what: the chosen clip of the source, or the latest render */
  mode: "clip" | "render";
  setMode(m: "clip" | "render"): void;
  /** show the Player Profile Intro preview again (ADR-130): it opens on its own the first time a reel is opened */
  openProfileIntro(): void;
  /** Best Moment Rule v2.1 target length, in seconds (90 / 180 / 300; 180 default) */
  lengthS: ReelLengthS;
  setLengthS(n: ReelLengthS): void;
  /** true for a cross-match reel: its length was fixed when it was made and the picker is read-only */
  lengthFixed: boolean;
}
const Ctx = createContext<Stage | null>(null);
export const StageProvider = ({ value, children }: { value: Stage; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export function useStage(): Stage {
  const c = useContext(Ctx);
  if (!c) throw new Error("outside the Reel Builder stage");
  return c;
}

/** seconds with one decimal, with the unit from the dictionary (RU "с", EN "s"): `secs(us, d.durationSec)`. The default keeps the English unit for callers without a dictionary. */
export const secs = (us: number, unit = "{a} s") => unit.replace("{a}", (us / 1e6).toFixed(1));
export const mmss = (us: number | null) => (us === null ? "—" : `${String(Math.floor(us / 6e7)).padStart(2, "0")}:${String(Math.floor(us / 1e6) % 60).padStart(2, "0")}`);

/** a switch in the flow layout: the shared Drop 1 switch, a real button, dimmed when it cannot act */
export function Switch({ on, disabled, label, onToggle }: { on: boolean; disabled?: boolean; label: string; onToggle?: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled || !onToggle} onClick={onToggle}
      className="vie-sw disabled:cursor-not-allowed disabled:opacity-50" />
  );
}

export function useDirty(reel: Reel | null, draft: SpotlightSettings | null, name: string) {
  return useMemo(() => !!reel && !!draft && (JSON.stringify(draft) !== JSON.stringify(reel.settings) || (name.trim() !== "" && name.trim() !== reel.name)), [reel, draft, name]);
}
