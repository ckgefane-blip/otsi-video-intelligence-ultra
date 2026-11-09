/**
 * Organization Templates for Spotlight, Style, and Branding (ADR-109, v3 Phase C.10).
 *
 * Allows saving, sharing, and selectively applying modular templates:
 * - SPOTLIGHT: beam geometry, intensity, feather, ring color, tracker tolerance.
 * - STYLE: on-screen cards, lower thirds, captions, scoreboard bugs, and colour look.
 * - BRANDING: competition/custom logos, music & volume balance, intro/outro bumpers, loudness.
 * - FULL: all three sections packaged together.
 */
import { z } from "zod";
import { Look, NEUTRAL_LOOK } from "./look";
import { SpotlightSettings } from "./reels";

export const OrgTemplateKind = z.enum(["SPOTLIGHT", "STYLE", "BRANDING", "FULL"]);
export type OrgTemplateKind = z.infer<typeof OrgTemplateKind>;

export const SpotlightSpec = z.object({
  dim: z.number().min(0).max(0.9).default(0.55),
  feather: z.number().min(0.05).max(1.5).default(0.6),
  size: z.number().min(0.8).max(3).default(1.6),
  ring: z.boolean().default(true),
  ring_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#17D1F8"),
  vignette: z.number().min(0).max(1).default(0),
  lock: z.number().min(0).max(1).default(0.5),
  auto_track: z.boolean().default(true),
  reframe_speed: z.number().min(0).max(1).default(0.5),
});
export type SpotlightSpec = z.infer<typeof SpotlightSpec>;

export const StyleSpec = z.object({
  lower_third: z.boolean().default(false),
  name_caption: z.boolean().default(true),
  event_tags: z.boolean().default(true),
  score_bug: z.boolean().default(false),
  match_card: z.boolean().default(true),
  end_screen: z.boolean().default(false),
  watermark: z.boolean().default(false),
  look: Look.default(NEUTRAL_LOOK),
});
export type StyleSpec = z.infer<typeof StyleSpec>;

export const BrandingSpec = z.object({
  competition_logo_id: z.string().uuid().nullable().default(null),
  custom_logo_id: z.string().uuid().nullable().default(null),
  music_id: z.string().uuid().nullable().default(null),
  music_volume: z.number().min(0).max(1).default(0.8),
  match_volume: z.number().min(0).max(1).default(0.3),
  intro_id: z.string().uuid().nullable().default(null),
  outro_id: z.string().uuid().nullable().default(null),
  duck_music: z.boolean().default(true),
  loudness_lufs: z.number().min(-31).max(-9).nullable().default(null),
});
export type BrandingSpec = z.infer<typeof BrandingSpec>;

export const OrgTemplateSpec = z.object({
  spotlight: SpotlightSpec.optional(),
  style: StyleSpec.optional(),
  branding: BrandingSpec.optional(),
});
export type OrgTemplateSpec = z.infer<typeof OrgTemplateSpec>;

export const OrgTemplate = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(255).default(""),
  kind: OrgTemplateKind,
  spec: OrgTemplateSpec,
  is_shared: z.boolean().default(true),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  is_builtin: z.boolean().default(false),
});
export type OrgTemplate = z.infer<typeof OrgTemplate>;

export const CreateOrgTemplateRequest = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(255).default(""),
  kind: OrgTemplateKind,
  reel_id: z.string().uuid().optional(),
  spec: OrgTemplateSpec.optional(),
  is_shared: z.boolean().default(true),
});
export type CreateOrgTemplateRequest = z.infer<typeof CreateOrgTemplateRequest>;

export const UpdateOrgTemplateRequest = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(255).optional(),
  spec: OrgTemplateSpec.optional(),
  is_shared: z.boolean().optional(),
});
export type UpdateOrgTemplateRequest = z.infer<typeof UpdateOrgTemplateRequest>;

export const ApplyOrgTemplateRequest = z.object({
  template_id: z.string().uuid(),
  version: z.number().int().positive(),
  apply_kinds: z.array(OrgTemplateKind).optional(),
});
export type ApplyOrgTemplateRequest = z.infer<typeof ApplyOrgTemplateRequest>;

/** Built-in templates available to all organizations */
export const BUILTIN_ORG_TEMPLATES: OrgTemplate[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    organization_id: "00000000-0000-0000-0000-000000000000",
    name: "Broadcast Gold",
    description: "Golden highlight ring with television match styling and standard audio mix",
    kind: "FULL",
    spec: {
      spotlight: {
        dim: 0.55,
        feather: 0.6,
        size: 1.6,
        ring: true,
        ring_color: "#F5D02E",
        vignette: 0.15,
        lock: 0.5,
        auto_track: true,
        reframe_speed: 0.5,
      },
      style: {
        lower_third: true,
        name_caption: true,
        event_tags: true,
        score_bug: true,
        match_card: true,
        end_screen: true,
        watermark: false,
        look: Look.parse({ preset: "BROADCAST", exposure: 0.05, contrast: 1.08, saturation: 1.12, temperature: 0.1 }),
      },
      branding: {
        competition_logo_id: null,
        custom_logo_id: null,
        music_id: null,
        music_volume: 0.75,
        match_volume: 0.35,
        intro_id: null,
        outro_id: null,
        duck_music: true,
        loudness_lufs: -14,
      },
    },
    is_shared: true,
    created_by: null,
    created_at: "2026-01-01T00:00:00.000000Z",
    updated_at: "2026-01-01T00:00:00.000000Z",
    is_builtin: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    organization_id: "00000000-0000-0000-0000-000000000000",
    name: "Dynamic Cyan",
    description: "High-contrast spotlight with vivid cyan tracker ring and responsive auto-framing",
    kind: "SPOTLIGHT",
    spec: {
      spotlight: {
        dim: 0.62,
        feather: 0.55,
        size: 1.5,
        ring: true,
        ring_color: "#17D1F8",
        vignette: 0.2,
        lock: 0.6,
        auto_track: true,
        reframe_speed: 0.75,
      },
    },
    is_shared: true,
    created_by: null,
    created_at: "2026-01-01T00:00:00.000000Z",
    updated_at: "2026-01-01T00:00:00.000000Z",
    is_builtin: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    organization_id: "00000000-0000-0000-0000-000000000000",
    name: "Cinematic Warm",
    description: "Subtle film look with vignette and elegant lower third tags",
    kind: "STYLE",
    spec: {
      style: {
        lower_third: true,
        name_caption: true,
        event_tags: true,
        score_bug: false,
        match_card: true,
        end_screen: false,
        watermark: false,
        look: Look.parse({ preset: "WARM", exposure: 0.05, contrast: 1.04, saturation: 1.08, temperature: 0.6 }),
      },
    },
    is_shared: true,
    created_by: null,
    created_at: "2026-01-01T00:00:00.000000Z",
    updated_at: "2026-01-01T00:00:00.000000Z",
    is_builtin: true,
  },
];

/** Extract template specification sections from active SpotlightSettings based on template kind */
export function extractTemplateSpec(kind: OrgTemplateKind, s: SpotlightSettings): OrgTemplateSpec {
  const spec: OrgTemplateSpec = {};
  if (kind === "SPOTLIGHT" || kind === "FULL") {
    spec.spotlight = {
      dim: s.dim,
      feather: s.feather,
      size: s.size,
      ring: s.ring,
      ring_color: s.ring_color,
      vignette: s.vignette,
      lock: s.lock,
      auto_track: s.auto_track,
      reframe_speed: s.reframe_speed,
    };
  }
  if (kind === "STYLE" || kind === "FULL") {
    spec.style = {
      lower_third: s.lower_third,
      name_caption: s.name_caption,
      event_tags: s.event_tags,
      score_bug: s.score_bug,
      match_card: s.match_card,
      end_screen: s.end_screen,
      watermark: s.watermark,
      look: s.look,
    };
  }
  if (kind === "BRANDING" || kind === "FULL") {
    spec.branding = {
      competition_logo_id: s.competition_logo_id,
      custom_logo_id: s.custom_logo_id,
      music_id: s.music_id,
      music_volume: s.music_volume,
      match_volume: s.match_volume,
      intro_id: s.intro_id,
      outro_id: s.outro_id,
      duck_music: s.duck_music,
      loudness_lufs: s.loudness_lufs,
    };
  }
  return spec;
}

/** Apply template specification sections to target settings */
export function applyTemplateSpec(
  target: SpotlightSettings,
  template: OrgTemplate,
  selectedKinds?: OrgTemplateKind[]
): { settings: SpotlightSettings; applied: OrgTemplateKind[] } {
  const res: SpotlightSettings = { ...target };
  const applied: OrgTemplateKind[] = [];

  const shouldApply = (k: "SPOTLIGHT" | "STYLE" | "BRANDING") => {
    if (selectedKinds && selectedKinds.length > 0) {
      return selectedKinds.includes("FULL") || selectedKinds.includes(k);
    }
    return template.kind === "FULL" || template.kind === k;
  };

  if (template.spec.spotlight && shouldApply("SPOTLIGHT")) {
    Object.assign(res, template.spec.spotlight);
    applied.push("SPOTLIGHT");
  }
  if (template.spec.style && shouldApply("STYLE")) {
    Object.assign(res, template.spec.style);
    applied.push("STYLE");
  }
  if (template.spec.branding && shouldApply("BRANDING")) {
    Object.assign(res, template.spec.branding);
    applied.push("BRANDING");
  }

  return { settings: res, applied };
}
