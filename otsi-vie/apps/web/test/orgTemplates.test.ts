import { describe, expect, it } from "vitest";
import {
  BUILTIN_ORG_TEMPLATES,
  SpotlightSettings,
  applyTemplateSpec,
  extractTemplateSpec,
  type OrgTemplate,
} from "@otsi-vie/contracts";
import { TABS, type Asset } from "@/components/library/useLibrary";

describe("C.10 Organization Templates (ADR-109)", () => {
  const baseSettings: SpotlightSettings = SpotlightSettings.parse({
    dim: 0.55,
    feather: 0.6,
    ring_color: "#17D1F8",
    score_bug: false,
    match_card: false,
    watermark: false,
    music_id: null,
    music_volume: 0.8,
  });

  it("extracts modular specifications based on template kind", () => {
    // SPOTLIGHT only
    const spotSpec = extractTemplateSpec("SPOTLIGHT", baseSettings);
    expect(spotSpec.spotlight).toBeDefined();
    expect(spotSpec.spotlight?.dim).toBe(0.55);
    expect(spotSpec.style).toBeUndefined();
    expect(spotSpec.branding).toBeUndefined();

    // STYLE only
    const styleSpec = extractTemplateSpec("STYLE", baseSettings);
    expect(styleSpec.spotlight).toBeUndefined();
    expect(styleSpec.style).toBeDefined();
    expect(styleSpec.style?.score_bug).toBe(false);
    expect(styleSpec.branding).toBeUndefined();

    // BRANDING only
    const brandSpec = extractTemplateSpec("BRANDING", baseSettings);
    expect(brandSpec.spotlight).toBeUndefined();
    expect(brandSpec.style).toBeUndefined();
    expect(brandSpec.branding).toBeDefined();
    expect(brandSpec.branding?.music_volume).toBe(0.8);

    // FULL
    const fullSpec = extractTemplateSpec("FULL", baseSettings);
    expect(fullSpec.spotlight).toBeDefined();
    expect(fullSpec.style).toBeDefined();
    expect(fullSpec.branding).toBeDefined();
  });

  it("applies modular template sections selectively", () => {
    const goldTemplate = BUILTIN_ORG_TEMPLATES.find((t) => t.name === "Broadcast gold")!;
    expect(goldTemplate).toBeDefined();

    // Selectively apply SPOTLIGHT from Broadcast Gold (ring_color #F5D02E)
    const { settings: s1, applied: a1 } = applyTemplateSpec(baseSettings, goldTemplate, ["SPOTLIGHT"]);
    expect(a1).toEqual(["SPOTLIGHT"]);
    expect(s1.ring_color).toBe("#F5D02E");
    // Style settings should NOT have changed
    expect(s1.score_bug).toBe(false);
    expect(s1.match_card).toBe(false);

    // Selectively apply STYLE from Broadcast Gold (score_bug: true, match_card: true)
    const { settings: s2, applied: a2 } = applyTemplateSpec(s1, goldTemplate, ["STYLE"]);
    expect(a2).toEqual(["STYLE"]);
    expect(s2.ring_color).toBe("#F5D02E"); // retained from s1
    expect(s2.score_bug).toBe(true);
    expect(s2.match_card).toBe(true);

    // Apply specific SPOTLIGHT template
    const cyanTemplate = BUILTIN_ORG_TEMPLATES.find((t) => t.name === "Dynamic cyan")!;
    const { settings: s3, applied: a3 } = applyTemplateSpec(s2, cyanTemplate);
    expect(a3).toEqual(["SPOTLIGHT"]);
    expect(s3.ring_color).toBe("#17D1F8");
    expect(s3.reframe_speed).toBe(0.75);
    expect(s3.score_bug).toBe(true); // style remains
  });

  it("verifies built-in template presets are available and well-formed", () => {
    expect(BUILTIN_ORG_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const t of BUILTIN_ORG_TEMPLATES) {
      expect(t.is_builtin).toBe(true);
      expect(t.name.length).toBeGreaterThan(0);
      expect(["SPOTLIGHT", "STYLE", "BRANDING", "FULL"]).toContain(t.kind);
    }
  });

  it("includes Templates tab in Library configuration", () => {
    const tmplTab = TABS.find((t) => t[1] === "Templates");
    expect(tmplTab).toBeDefined();
    expect(tmplTab![2]).toEqual(["Template"]);
  });
});
