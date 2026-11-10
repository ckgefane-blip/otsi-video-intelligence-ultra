"use client";
/**
 * Page 06 Reel Builder: what the sections share (approved reference 06_REEL_BUILDER, 2560 x 1440 composition).
 *
 * The reel, its moments, clips, targets and renders come from the existing Reel Builder context (ADR-032). The page keeps a DRAFT of the
 * reel name and spotlight look; Save Project and Generate Reel send the draft (with the reel's version) so nothing is lost. Controls for
 * features the engine does not have (description, music) are drawn as in the reference but disabled with their reason; nothing is
 * invented. The overlay and branding switches are real (ADR-044).
 */
import { type Reel, SpotlightSettings } from "@otsi-vie/contracts";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { B, T, u } from "@/components/stage/DesignStage";

export const DEFAULTS: SpotlightSettings = SpotlightSettings.parse({});

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
}
const Ctx = createContext<Stage | null>(null);
export const StageProvider = ({ value, children }: { value: Stage; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export function useStage(): Stage {
  const c = useContext(Ctx);
  if (!c) throw new Error("outside the Reel Builder stage");
  return c;
}

export const secs = (us: number) => `${(us / 1e6).toFixed(1)} s`;
export const mmss = (us: number | null) => (us === null ? "—" : `${String(Math.floor(us / 6e7)).padStart(2, "0")}:${String(Math.floor(us / 1e6) % 60).padStart(2, "0")}`);

/** the reference's switch (56 x 28): drawn here, made interactive by the caller's Hit */
export function Switch({ x, y, on, off }: { x: number; y: number; on: boolean; off?: boolean }) {
  return (
    <>
      <B x={x} y={y - 14} w={56} h={28} style={{ borderRadius: u(14), background: on ? "#0481F9" : "#34445c", opacity: off ? 0.6 : 1 }} />
      <B x={on ? x + 30 : x + 4} y={y - 11} w={22} h={22} style={{ borderRadius: "50%", background: on ? "#fff" : "#c9d3e0", opacity: off ? 0.8 : 1 }} />
    </>
  );
}

// separate border properties: a box may override only the colour (a shorthand mixed with borderColor makes React warn, shown as "1 error")
export const input = { borderWidth: u(1.5), borderStyle: "solid", borderColor: "#17406f", borderRadius: u(8), background: "#041022" };

export function Label({ x, y, size, children, color = "#8ea3bf", weight }: { x: number; y: number; size: number; children: ReactNode; color?: string; weight?: 400 | 600 | 700 }) {
  return <T x={x} y={y} size={size} color={color} weight={weight ?? 400}>{children}</T>;
}

export function useDirty(reel: Reel | null, draft: SpotlightSettings | null, name: string) {
  return useMemo(() => !!reel && !!draft && (JSON.stringify(draft) !== JSON.stringify(reel.settings) || (name.trim() !== "" && name.trim() !== reel.name)), [reel, draft, name]);
}
