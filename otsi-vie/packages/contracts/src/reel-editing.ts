/**
 * v3 Phase B.16 (ADR-092): Reel Builder editing aids.
 *   SPOTLIGHT_PRESETS  built-in starting looks for the beam (intensity, width, vignette, glow); Target Lock is left as it is (it is about
 *                      following, not the look). Organization templates of looks are a later step (Phase C.10).
 *   musicLicenceNote   what a person must still do when publishing a reel with this music, from the rights basis they declared at upload
 *   timeline zoom      the visible window of a zoomed timeline (stage units), kept inside the reel
 */
import type { BrandRightsBasis, SpotlightSettings } from "./reels";

export type SpotlightLook = Pick<SpotlightSettings, "dim" | "size" | "vignette" | "feather">;
export const SPOTLIGHT_PRESETS: { key: string; name: string; note: string; look: SpotlightLook }[] = [
  { key: "subtle", name: "Subtle", note: "A soft light; the rest of the picture stays almost as filmed", look: { dim: 0.3, size: 1.2, vignette: 0.2, feather: 0.8 } },
  { key: "standard", name: "Standard", note: "The default look", look: { dim: 0.55, size: 1.6, vignette: 0, feather: 0.6 } },
  { key: "strong", name: "Strong", note: "A bright, narrow beam; easy to follow on a small screen", look: { dim: 0.75, size: 1.3, vignette: 0.4, feather: 0.45 } },
  { key: "cinematic", name: "Cinematic", note: "A wide, soft beam and dark corners", look: { dim: 0.8, size: 2.2, vignette: 0.8, feather: 1.1 } },
];
/** the preset the look matches (to two decimals), else null ("Custom") */
export function presetOf(s: SpotlightLook): string | null {
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;
  return SPOTLIGHT_PRESETS.find((p) => eq(p.look.dim, s.dim) && eq(p.look.size, s.size) && eq(p.look.vignette, s.vignette) && eq(p.look.feather, s.feather))?.key ?? null;
}

export function musicLicenceNote(basis: BrandRightsBasis, holder: string): string {
  switch (basis) {
    case "OWN_BRAND": return `Your own music (${holder}): no further step.`;
    case "LICENSED": return `Licensed from ${holder}: check the licence covers where you publish this reel (web, social, broadcast) and for how long.`;
    case "FREE_LICENCE": return `Free licence (${holder}): credit the author where you publish the reel, as the licence asks (for example in the post text).`;
    case "PERMISSION": return `Written permission from ${holder}: keep it on file; it covers only what it says.`;
    default: return "";
  }
}

export const ZOOM_STEPS = [1, 2, 4, 8, 16] as const;
/** the offset (stage units) of a zoomed timeline of width w*zoom that shows `centre` (0..1 of the reel) in the middle, kept inside */
export function zoomOffset(w: number, zoom: number, centre: number): number {
  const zw = w * zoom;
  return Math.min(Math.max(0, centre * zw - w / 2), Math.max(0, zw - w));
}
