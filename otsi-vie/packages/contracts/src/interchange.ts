/**
 * v3 Phase C.3 (ADR-103): OpenTimelineIO (.otio) export and .otsi-reel manifest carrying faithful evidence flags.
 *
 *   OtsiReelManifest   portable JSON manifest ("otsi-reel/v1") of a reel: its clips, speed/fx, transitions, B.22 preset outputs,
 *                      followed tracks with who confirmed them, engine-recorded events in each clip, and explicit evidence flags
 *                      (CONFIRMED vs STALE player identity, CONFIRMED vs PROPOSED vs NONE match clock, NOT_MEASURED match score,
 *                      INFERRED vs NONE events with UNVERIFIED Track G accuracy gate, and recorded vs unrecorded video rights).
 *   OtioTimeline       standards-compliant OpenTimelineIO ("Timeline.1") JSON at 1,000,000 Hz (integer microseconds) with Video and
 *                      Audio tracks ("Track.1"), spacers ("Gap.1"), transitions ("Transition.1"), clips ("Clip.1") referencing a
 *                      leak-free source URI ("otsi-vie://videos/<id>/source"), retiming ("LinearTimeWarp.1" / "FreezeFrame.1"),
 *                      audio gain ("Effect.1"), event markers ("Marker.1"), and VIE evidence metadata.
 */
import { z } from "zod";
import { BUILTIN_PRESETS, ExportPreset, PresetScope, outputLufs, uniqueOutputs } from "./export-presets";
import { rightsAllowShare } from "./export-review";
import type { PlayerEvent } from "./events";
import { ClipFx } from "./look";
import { ExportProfile, Reel, ReelAspect, SpotlightSettings, TransitionKind } from "./reels";
import { ClipEffect, clipOutputUs, gapUs, slotUs } from "./retime";
import { RIGHTS_STATES, type VideoRights } from "./sharing";

export const OTIO_RATE = 1_000_000 as const;

export const OtioRationalTime = z.object({
  OTIO_SCHEMA: z.literal("RationalTime.1"),
  value: z.number().int(),
  rate: z.literal(OTIO_RATE),
});
export type OtioRationalTime = z.infer<typeof OtioRationalTime>;

export const OtioTimeRange = z.object({
  OTIO_SCHEMA: z.literal("TimeRange.1"),
  start_time: OtioRationalTime,
  duration: OtioRationalTime,
});
export type OtioTimeRange = z.infer<typeof OtioTimeRange>;

export const OtioMarker = z.object({
  OTIO_SCHEMA: z.literal("Marker.1"),
  name: z.string(),
  marked_range: OtioTimeRange,
  color: z.enum(["RED", "ORANGE", "YELLOW", "GREEN", "CYAN", "BLUE", "MAGENTA", "WHITE"]),
  metadata: z.record(z.string(), z.unknown()),
});
export type OtioMarker = z.infer<typeof OtioMarker>;

export const OtioEffect = z.object({
  OTIO_SCHEMA: z.enum(["LinearTimeWarp.1", "FreezeFrame.1", "Effect.1"]),
  name: z.string(),
  effect_name: z.string(),
  time_scalar: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()),
});
export type OtioEffect = z.infer<typeof OtioEffect>;

export const OtioExternalReference = z.object({
  OTIO_SCHEMA: z.literal("ExternalReference.1"),
  name: z.string(),
  target_url: z.string(),
  available_range: OtioTimeRange.nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export type OtioExternalReference = z.infer<typeof OtioExternalReference>;

export const OtioClip = z.object({
  OTIO_SCHEMA: z.literal("Clip.1"),
  name: z.string(),
  source_range: OtioTimeRange,
  media_reference: OtioExternalReference,
  effects: z.array(OtioEffect),
  markers: z.array(OtioMarker),
  metadata: z.record(z.string(), z.unknown()),
});
export type OtioClip = z.infer<typeof OtioClip>;

export const OtioGap = z.object({
  OTIO_SCHEMA: z.literal("Gap.1"),
  name: z.string(),
  source_range: OtioTimeRange,
  effects: z.array(OtioEffect),
  markers: z.array(OtioMarker),
  metadata: z.record(z.string(), z.unknown()),
});
export type OtioGap = z.infer<typeof OtioGap>;

export const OtioTransition = z.object({
  OTIO_SCHEMA: z.literal("Transition.1"),
  name: z.string(),
  transition_type: z.literal("SMPTE_Dissolve"),
  in_offset: OtioRationalTime,
  out_offset: OtioRationalTime,
  metadata: z.record(z.string(), z.unknown()),
});
export type OtioTransition = z.infer<typeof OtioTransition>;

export const OtioTrackItem = z.union([OtioClip, OtioGap, OtioTransition]);
export type OtioTrackItem = z.infer<typeof OtioTrackItem>;

export const OtioTrack = z.object({
  OTIO_SCHEMA: z.literal("Track.1"),
  name: z.string(),
  kind: z.enum(["Video", "Audio"]),
  source_range: OtioTimeRange.nullable(),
  effects: z.array(OtioEffect),
  markers: z.array(OtioMarker),
  metadata: z.record(z.string(), z.unknown()),
  children: z.array(OtioTrackItem),
});
export type OtioTrack = z.infer<typeof OtioTrack>;

export const OtioTimeline = z.object({
  OTIO_SCHEMA: z.literal("Timeline.1"),
  name: z.string(),
  global_start_time: OtioRationalTime,
  metadata: z.record(z.string(), z.unknown()),
  tracks: z.object({
    OTIO_SCHEMA: z.literal("Stack.1"),
    name: z.literal("tracks"),
    source_range: OtioTimeRange.nullable(),
    effects: z.array(OtioEffect),
    markers: z.array(OtioMarker),
    metadata: z.record(z.string(), z.unknown()),
    children: z.array(OtioTrack),
  }),
});
export type OtioTimeline = z.infer<typeof OtioTimeline>;

export const OtsiReelEvidenceFlags = z.object({
  /** CONFIRMED only when a player is chosen and every pinned target decision is still current; STALE when any changed; NONE without a player */
  player_identity: z.enum(["CONFIRMED", "STALE", "NONE"]),
  target_tracks_current: z.boolean(),
  match_clock: z.enum(["CONFIRMED", "PROPOSED", "NONE"]),
  /** VIE never reads or invents a scoreboard score on reels (ADR-044) */
  match_score: z.literal("NOT_MEASURED"),
  /** INFERRED when at least one engine-recorded event falls inside the reel's clips; NONE when none does */
  events_evidence: z.enum(["INFERRED", "NONE"]),
  /** Track G gates G05-G08 are not yet scored across a multi-match benchmark */
  accuracy_gate: z.literal("UNVERIFIED"),
  rights_state: z.enum([...RIGHTS_STATES, "UNRECORDED"]),
  sharing_allowed: z.boolean(),
});
export type OtsiReelEvidenceFlags = z.infer<typeof OtsiReelEvidenceFlags>;

export const OtsiReelTargetEvidence = z.object({
  track_id: z.string().uuid(),
  track_number: z.number().int().nonnegative(),
  first_pts_us: z.number().int().nonnegative(),
  last_pts_us: z.number().int().nonnegative(),
  decision_current: z.boolean(),
  state: z.enum(["CONFIRMED", "REJECTED", "PROPOSED", "UNKNOWN"]),
  basis: z.string().nullable(),
  decided_by: z.string().nullable(),
  decided_at: z.string().nullable(),
});
export type OtsiReelTargetEvidence = z.infer<typeof OtsiReelTargetEvidence>;

export const OtsiReelEventEvidence = z.object({
  id: z.string(),
  kind: z.string(),
  start_us: z.number().int().nonnegative(),
  end_us: z.number().int().nonnegative(),
  key: z.boolean(),
  detail: z.string().nullable(),
  partner_name: z.string().nullable(),
  evidence_class: z.literal("INFERRED"),
  evidence_basis: z.string(),
  accuracy_gate: z.literal("UNVERIFIED"),
});
export type OtsiReelEventEvidence = z.infer<typeof OtsiReelEventEvidence>;

export const OtsiReelClipManifest = z.object({
  id: z.string().uuid(),
  sequence_index: z.number().int().nonnegative(),
  in_pts_us: z.number().int().nonnegative(),
  out_pts_us: z.number().int().nonnegative(),
  source_duration_us: z.number().int().positive(),
  output_duration_us: z.number().int().positive(),
  slot_duration_us: z.number().int().positive(),
  timeline_start_us: z.number().int().nonnegative(),
  origin: z.enum(["SUGGESTED", "MANUAL"]),
  /** SUGGESTED moments come from the engine's event/visibility rules (INFERRED); MANUAL clips were chosen by hand (CONFIRMED) */
  origin_evidence: z.enum(["INFERRED", "CONFIRMED"]),
  /** true when at least one engine-recorded event of the player starts inside this clip */
  action_detected: z.boolean(),
  label: z.string().nullable(),
  effect: ClipEffect,
  fx: ClipFx,
  transition_in: z.object({ kind: TransitionKind, duration_ms: z.number().int() }).nullable(),
  events: z.array(OtsiReelEventEvidence),
});
export type OtsiReelClipManifest = z.infer<typeof OtsiReelClipManifest>;

export const OtsiReelManifest = z.object({
  schema: z.literal("otsi-reel/v1"),
  exported_at: z.string(),
  reel: z.object({
    id: z.string().uuid(),
    name: z.string(),
    version: z.number().int().positive(),
    status: z.string(),
    aspect: ReelAspect,
    duration_us: z.number().int().nonnegative(),
    stale: z.boolean(),
    latest_render_id: z.string().uuid().nullable(),
    settings: SpotlightSettings,
  }),
  video: z.object({
    id: z.string().uuid(),
    title: z.string(),
    duration_us: z.number().int().nonnegative().nullable(),
    source_sha256: z.string().nullable(),
    run_id: z.string().uuid(),
  }),
  preset: z.object({
    id: z.string(),
    name: z.string(),
    scope: PresetScope,
    codec: z.enum(["h264", "av1", "vp9"]).nullable(),
    bitrate_mbps: z.number().nullable(),
    outputs: z.array(z.object({ profile: ExportProfile, aspect: ReelAspect, loudness_lufs: z.number() })),
  }),
  evidence: OtsiReelEvidenceFlags,
  player: z.object({
    player_id: z.string().uuid(),
    display_name: z.string(),
    canonical_otsi_id: z.string().nullable(),
    club: z.string().nullable(),
    roster: Reel.shape.player_roster,
  }).nullable(),
  match: Reel.shape.match,
  targets: z.array(OtsiReelTargetEvidence),
  clips: z.array(OtsiReelClipManifest),
});
export type OtsiReelManifest = z.infer<typeof OtsiReelManifest>;

export const InterchangeExport = z.object({
  filename_base: z.string(),
  manifest: OtsiReelManifest,
  otio: OtioTimeline,
});
export type InterchangeExport = z.infer<typeof InterchangeExport>;

export interface InterchangeTargetWho {
  track_id: string;
  state: string;
  basis: string | null;
  by: string | null;
  at: string | null;
}

export interface InterchangeInput {
  reel: Reel;
  video: { title: string; duration_us: number | null; source_sha256: string | null };
  preset?: ExportPreset | null;
  who: InterchangeTargetWho[];
  events: PlayerEvent[];
  rights: VideoRights | null;
  exportedAt?: Date;
}

const rt = (value: number): OtioRationalTime => ({ OTIO_SCHEMA: "RationalTime.1", value: Math.round(value), rate: OTIO_RATE });
const tr = (startUs: number, durationUs: number): OtioTimeRange => ({
  OTIO_SCHEMA: "TimeRange.1",
  start_time: rt(startUs),
  duration: rt(Math.max(0, durationUs)),
});

/** safe base filename for .otio and .otsi-reel downloads */
export function interchangeSlug(name: string): string {
  return name.trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "reel";
}

function normState(s: string | undefined): OtsiReelTargetEvidence["state"] {
  return s === "CONFIRMED" || s === "REJECTED" || s === "PROPOSED" ? s : "UNKNOWN";
}

function normRightsState(r: VideoRights | null, now: Date): OtsiReelEvidenceFlags["rights_state"] {
  const g = r?.grant;
  if (!g) return "UNRECORDED";
  if ((g.valid_until && new Date(g.valid_until) <= now) || g.rights_state === "EXPIRED") return "EXPIRED";
  return g.rights_state;
}

/** Build the .otsi-reel manifest carrying faithful evidence flags from what VIE actually recorded. */
export function buildOtsiReelManifest(input: InterchangeInput): OtsiReelManifest {
  const now = input.exportedAt ?? new Date();
  const { reel, video } = input;
  const preset = input.preset ?? BUILTIN_PRESETS[0]!;
  const whoByTrack = new Map(input.who.map((w) => [w.track_id, w]));
  const targets: OtsiReelTargetEvidence[] = reel.targets.map((t) => {
    const w = whoByTrack.get(t.track_id);
    return {
      track_id: t.track_id,
      track_number: t.track_number,
      first_pts_us: t.first_pts_us,
      last_pts_us: t.last_pts_us,
      decision_current: t.decision_current,
      state: normState(w?.state),
      basis: w?.basis ?? null,
      decided_by: w?.by ?? null,
      decided_at: w?.at ?? null,
    };
  });
  const current = targets.length > 0 && targets.every((t) => t.decision_current && t.state === "CONFIRMED");
  const playerIdentity: OtsiReelEvidenceFlags["player_identity"] = !reel.player ? "NONE" : (!reel.stale && current) ? "CONFIRMED" : "STALE";

  const transByClip = new Map(reel.transitions.map((t) => [t.clip_id, { kind: t.kind, duration_ms: t.duration_ms }]));
  const sortedClips = [...reel.clips].sort((a, b) => a.sequence_index - b.sequence_index);
  const videoEvents = input.events.filter((e) => e.video_id === reel.video_id).sort((a, b) => a.start_us - b.start_us);

  let cursorUs = 0;
  let totalClipEvents = 0;
  const clips: OtsiReelClipManifest[] = sortedClips.map((c, idx) => {
    const gUs = gapUs(c);
    const outDurUs = clipOutputUs(c);
    const slotDurUs = slotUs(c);
    const timelineStartUs = cursorUs + gUs;
    cursorUs += slotDurUs;
    const evs: OtsiReelEventEvidence[] = videoEvents
      .filter((e) => e.start_us >= c.in_pts_us && e.start_us <= c.out_pts_us)
      .map((e) => {
        const detail = [e.how, e.set_piece, e.regain === null ? null : e.regain ? "regain" : null].filter(Boolean).join(" ") || null;
        return {
          id: e.id,
          kind: e.kind,
          start_us: e.start_us,
          end_us: e.end_us,
          key: e.key,
          detail,
          partner_name: e.partner_name,
          evidence_class: "INFERRED" as const,
          evidence_basis: e.evidence,
          accuracy_gate: "UNVERIFIED" as const,
        };
      });
    totalClipEvents += evs.length;
    const trIn = idx > 0 && gUs === 0 ? (transByClip.get(c.id) ?? null) : null;
    return {
      id: c.id,
      sequence_index: c.sequence_index,
      in_pts_us: c.in_pts_us,
      out_pts_us: c.out_pts_us,
      source_duration_us: c.out_pts_us - c.in_pts_us,
      output_duration_us: outDurUs,
      slot_duration_us: slotDurUs,
      timeline_start_us: timelineStartUs,
      origin: c.origin,
      origin_evidence: c.origin === "SUGGESTED" ? "INFERRED" : "CONFIRMED",
      action_detected: evs.length > 0,
      label: c.label,
      effect: c.effect,
      fx: c.fx,
      transition_in: trIn,
      events: evs,
    };
  });

  const outputs = uniqueOutputs(preset.spec.outputs, reel.aspect).map((o) => ({
    profile: o.profile,
    aspect: o.aspect,
    loudness_lufs: outputLufs(o, preset.spec.loudness_lufs, reel.settings.loudness_lufs),
  }));

  return OtsiReelManifest.parse({
    schema: "otsi-reel/v1",
    exported_at: now.toISOString(),
    reel: {
      id: reel.id,
      name: reel.name,
      version: reel.version,
      status: reel.status,
      aspect: reel.aspect,
      duration_us: cursorUs,
      stale: reel.stale,
      latest_render_id: reel.last_good_render?.id ?? reel.latest_render?.id ?? null,
      settings: reel.settings,
    },
    video: {
      id: reel.video_id,
      title: video.title,
      duration_us: video.duration_us,
      source_sha256: video.source_sha256,
      run_id: reel.run_id,
    },
    preset: {
      id: preset.id,
      name: preset.name,
      scope: preset.scope,
      codec: preset.spec.codec,
      bitrate_mbps: preset.spec.bitrate_mbps,
      outputs,
    },
    evidence: {
      player_identity: playerIdentity,
      target_tracks_current: current,
      match_clock: reel.match?.clock ?? "NONE",
      match_score: "NOT_MEASURED",
      events_evidence: totalClipEvents > 0 ? "INFERRED" : "NONE",
      accuracy_gate: "UNVERIFIED",
      rights_state: normRightsState(input.rights, now),
      sharing_allowed: rightsAllowShare(input.rights, now),
    },
    player: reel.player ? {
      player_id: reel.player.player_id,
      display_name: reel.player.display_name,
      canonical_otsi_id: reel.player.canonical_otsi_id,
      club: reel.player_club,
      roster: reel.player_roster,
    } : null,
    match: reel.match,
    targets,
    clips,
  });
}

/** Build an OpenTimelineIO ("Timeline.1") JSON document from an .otsi-reel manifest. */
export function buildOtioTimeline(manifest: OtsiReelManifest): OtioTimeline {
  const mediaRef: OtioExternalReference = {
    OTIO_SCHEMA: "ExternalReference.1",
    name: manifest.video.title,
    target_url: `otsi-vie://videos/${manifest.video.id}/source`,
    available_range: manifest.video.duration_us && manifest.video.duration_us > 0 ? tr(0, manifest.video.duration_us) : null,
    metadata: {
      otsi_vie: {
        video_id: manifest.video.id,
        run_id: manifest.video.run_id,
        source_sha256: manifest.video.source_sha256,
      },
    },
  };

  const videoChildren: OtioTrackItem[] = [];
  const audioChildren: OtioTrackItem[] = [];
  const stackMarkers: OtioMarker[] = [];

  for (const [idx, c] of manifest.clips.entries()) {
    const gUs = Math.round(c.fx.gap_ms * 1000);
    if (gUs > 0) {
      const gap: OtioGap = {
        OTIO_SCHEMA: "Gap.1",
        name: "Spacer",
        source_range: tr(0, gUs),
        effects: [],
        markers: [],
        metadata: { otsi_vie: { clip_id: c.id, gap_ms: c.fx.gap_ms } },
      };
      videoChildren.push(gap);
      audioChildren.push(gap);
    }

    if (c.transition_in && idx > 0 && gUs === 0) {
      const transition: OtioTransition = {
        OTIO_SCHEMA: "Transition.1",
        name: c.transition_in.kind,
        transition_type: "SMPTE_Dissolve",
        in_offset: rt(0),
        out_offset: rt(c.transition_in.duration_ms * 1000),
        metadata: {
          otsi_vie: {
            clip_id: c.id,
            kind: c.transition_in.kind,
            duration_ms: c.transition_in.duration_ms,
          },
        },
      };
      videoChildren.push(transition);
      audioChildren.push(transition);
    }

    const clipName = c.label ?? `Clip ${idx + 1} (${c.origin === "SUGGESTED" ? "suggested" : "manual"})`;
    stackMarkers.push({
      OTIO_SCHEMA: "Marker.1",
      name: clipName,
      marked_range: tr(c.timeline_start_us, c.output_duration_us),
      color: c.action_detected ? "GREEN" : "BLUE",
      metadata: {
        otsi_vie: {
          clip_id: c.id,
          sequence_index: c.sequence_index,
          origin: c.origin,
          origin_evidence: c.origin_evidence,
          action_detected: c.action_detected,
        },
      },
    });

    const videoEffects: OtioEffect[] = [];
    if (c.effect.kind === "FREEZE") {
      videoEffects.push({
        OTIO_SCHEMA: "FreezeFrame.1",
        name: "FreezeFrame",
        effect_name: "FreezeFrame",
        time_scalar: 0,
        metadata: {
          otsi_vie: {
            kind: c.effect.kind,
            at_us: c.effect.at_us,
            hold_ms: c.effect.hold_ms,
            output_duration_us: c.output_duration_us,
          },
        },
      });
    } else if (c.effect.kind === "SLOW" || c.effect.kind === "RAMP") {
      videoEffects.push({
        OTIO_SCHEMA: "LinearTimeWarp.1",
        name: c.effect.kind,
        effect_name: "LinearTimeWarp",
        time_scalar: c.effect.speed,
        metadata: {
          otsi_vie: {
            kind: c.effect.kind,
            at_us: c.effect.at_us,
            speed: c.effect.speed,
            output_duration_us: c.output_duration_us,
          },
        },
      });
    }

    const clipMarkers: OtioMarker[] = c.events.map((e) => ({
      OTIO_SCHEMA: "Marker.1",
      name: `${e.kind}${e.key ? " (key)" : ""}`,
      marked_range: tr(Math.max(0, e.start_us - c.in_pts_us), Math.max(0, e.end_us - e.start_us)),
      color: e.key ? "YELLOW" : "CYAN",
      metadata: {
        otsi_vie: {
          event_id: e.id,
          kind: e.kind,
          key: e.key,
          detail: e.detail,
          partner_name: e.partner_name,
          evidence_class: e.evidence_class,
          evidence_basis: e.evidence_basis,
          accuracy_gate: e.accuracy_gate,
        },
      },
    }));

    const commonMeta = {
      otsi_vie: {
        clip_id: c.id,
        sequence_index: c.sequence_index,
        origin: c.origin,
        origin_evidence: c.origin_evidence,
        action_detected: c.action_detected,
        output_duration_us: c.output_duration_us,
        timeline_start_us: c.timeline_start_us,
        zoom_keyframes: c.fx.zoom.length,
        drawings: c.fx.drawings.length,
        gain_db: c.fx.gain_db,
      },
    };

    videoChildren.push({
      OTIO_SCHEMA: "Clip.1",
      name: clipName,
      source_range: tr(c.in_pts_us, c.source_duration_us),
      media_reference: mediaRef,
      effects: videoEffects,
      markers: clipMarkers,
      metadata: commonMeta,
    });

    const audioEffects: OtioEffect[] = [];
    if (c.fx.gain_db !== 0) {
      audioEffects.push({
        OTIO_SCHEMA: "Effect.1",
        name: c.fx.gain_db <= -60 ? "Mute" : "AudioGain",
        effect_name: "AudioGain",
        metadata: { otsi_vie: { gain_db: c.fx.gain_db, muted: c.fx.gain_db <= -60 } },
      });
    }

    audioChildren.push({
      OTIO_SCHEMA: "Clip.1",
      name: clipName,
      source_range: tr(c.in_pts_us, c.source_duration_us),
      media_reference: mediaRef,
      effects: audioEffects,
      markers: [],
      metadata: commonMeta,
    });
  }

  return OtioTimeline.parse({
    OTIO_SCHEMA: "Timeline.1",
    name: manifest.reel.name,
    global_start_time: rt(0),
    metadata: {
      otsi_vie: {
        schema: manifest.schema,
        exported_at: manifest.exported_at,
        reel_id: manifest.reel.id,
        reel_version: manifest.reel.version,
        aspect: manifest.reel.aspect,
        duration_us: manifest.reel.duration_us,
        preset: manifest.preset,
        evidence: manifest.evidence,
        player: manifest.player,
        match: manifest.match,
        targets: manifest.targets,
      },
    },
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      source_range: tr(0, manifest.reel.duration_us),
      effects: [],
      markers: stackMarkers,
      metadata: {},
      children: [
        {
          OTIO_SCHEMA: "Track.1",
          name: "Video 1",
          kind: "Video",
          source_range: null,
          effects: [],
          markers: [],
          metadata: { otsi_vie: { role: "primary_video", aspect: manifest.reel.aspect } },
          children: videoChildren,
        },
        {
          OTIO_SCHEMA: "Track.1",
          name: "Audio 1",
          kind: "Audio",
          source_range: null,
          effects: [],
          markers: [],
          metadata: { otsi_vie: { role: "source_audio", music_id: manifest.reel.settings.music_id } },
          children: audioChildren,
        },
      ],
    },
  });
}

export function buildInterchangeExport(input: InterchangeInput): InterchangeExport {
  const manifest = buildOtsiReelManifest(input);
  const otio = buildOtioTimeline(manifest);
  return InterchangeExport.parse({
    filename_base: interchangeSlug(manifest.reel.name),
    manifest,
    otio,
  });
}
