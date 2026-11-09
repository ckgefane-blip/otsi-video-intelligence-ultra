/** v3 Phase B.16 (ADR-092): spotlight presets, music licence notes and timeline zoom */
import { describe, expect, it } from "vitest";
import { musicLicenceNote, presetOf, SPOTLIGHT_PRESETS, SpotlightSettings, zoomOffset } from "@otsi-vie/contracts";

describe("reel editing aids", () => {
  it("Standard is the default look; a moved slider is Custom", () => {
    const d = SpotlightSettings.parse({});
    expect(presetOf(d)).toBe("standard");
    expect(presetOf({ ...d, dim: 0.56 })).toBeNull();
    for (const p of SPOTLIGHT_PRESETS) {
      expect(presetOf(p.look)).toBe(p.key);
      expect(SpotlightSettings.safeParse({ ...d, ...p.look }).success).toBe(true);       // every preset within the sliders' ranges
    }
  });
  it("says what is still to do for each declared music right", () => {
    expect(musicLicenceNote("FREE_LICENCE", "A. Composer")).toMatch(/credit the author/);
    expect(musicLicenceNote("LICENSED", "Label")).toMatch(/covers where you publish/);
    expect(musicLicenceNote("OWN_BRAND", "Club")).toMatch(/no further step/);
  });
  it("zoom keeps the window inside the reel and centred where it can", () => {
    expect(zoomOffset(100, 1, 0.5)).toBe(0);
    expect(zoomOffset(100, 4, 0.5)).toBe(150);
    expect(zoomOffset(100, 4, 0)).toBe(0);
    expect(zoomOffset(100, 4, 1)).toBe(300);
  });
});
