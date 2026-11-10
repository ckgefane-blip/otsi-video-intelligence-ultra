/**
 * v3 Phase C.3 (ADR-103): OpenTimelineIO (.otio) timeline and .otsi-reel manifest rules, plus evidence flag descriptions.
 */
import { describe, expect, it } from "vitest";
import {
  BUILTIN_PRESETS,
  NO_EFFECT,
  NO_FX,
  OTIO_RATE,
  SpotlightSettings,
  buildInterchangeExport,
  buildOtioTimeline,
  buildOtsiReelManifest,
  interchangeSlug,
  type ExportPreset,
  type PlayerEvent,
  type Reel,
  type VideoRights,
} from "@otsi-vie/contracts";
import { describeEvidenceFlags } from "@/components/exportstage/Interchange";

const REEL_ID = "00000000-0000-4000-8000-000000000010";
const VIDEO_ID = "00000000-0000-4000-8000-000000000011";
const RUN_ID = "00000000-0000-4000-8000-000000000012";
const PLAYER_ID = "00000000-0000-4000-8000-000000000013";
const TRACK_ID = "00000000-0000-4000-8000-000000000014";
const CLIP_1 = "00000000-0000-4000-8000-000000000021";
const CLIP_2 = "00000000-0000-4000-8000-000000000022";
const CLIP_3 = "00000000-0000-4000-8000-000000000023";

const baseReel: Reel = {
  id: REEL_ID,
  name: "Chinazom Godwin — Highlights #1!",
  status: "DRAFT",
  version: 3,
  source: "MATCH",
  video_id: VIDEO_ID,
  run_id: RUN_ID,
  player: {
    player_id: PLAYER_ID,
    display_name: "Chinazom Godwin",
    canonical_otsi_id: "OTSI-NGA-2026-000009",
  },
  player_club: "Sporting Lagos",
  player_roster: {
    match_id: "00000000-0000-4000-8000-000000000099",
    club_id: "00000000-0000-4000-8000-000000000098",
    team: "Sporting Lagos",
    jersey_number: 9,
    position: "FW",
    role: "STARTER",
    captain: false,
  },
  match: {
    home: "Sporting Lagos",
    away: "Enyimba FC",
    competition: "NPFL",
    clock: "CONFIRMED",
  },
  aspect: "16:9",
  settings: SpotlightSettings.parse({ loudness_lufs: -16 }),
  targets: [
    {
      track_id: TRACK_ID,
      track_number: 7,
      first_pts_us: 1_000_000,
      last_pts_us: 50_000_000,
      decision_current: true,
    },
  ],
  stale: false,
  clips: [
    {
      id: CLIP_1,
      source_video_id: VIDEO_ID,
      sequence_index: 0,
      in_pts_us: 2_000_000,
      out_pts_us: 6_000_000,
      origin: "SUGGESTED",
      label: "Key pass + shot",
      effect: NO_EFFECT,
      fx: NO_FX,
    },
    {
      id: CLIP_2,
      source_video_id: VIDEO_ID,
      sequence_index: 1,
      in_pts_us: 10_000_000,
      out_pts_us: 14_000_000,
      origin: "MANUAL",
      label: null,
      effect: { kind: "SLOW", at_us: null, speed: 0.5, hold_ms: 0 },
      fx: { zoom: [{ at_ms: 500, zoom: 1.4, ease: "EASE" }], drawings: [], gap_ms: 0, gain_db: -6 },
    },
    {
      id: CLIP_3,
      source_video_id: VIDEO_ID,
      sequence_index: 2,
      in_pts_us: 20_000_000,
      out_pts_us: 23_000_000,
      origin: "MANUAL",
      label: "Freeze moment",
      effect: { kind: "FREEZE", at_us: 21_000_000, speed: 1, hold_ms: 1500 },
      fx: { zoom: [], drawings: [], gap_ms: 500, gain_db: -60 },
    },
  ],
  transitions: [
    { clip_id: CLIP_2, kind: "DISSOLVE", duration_ms: 400 },
    { clip_id: CLIP_3, kind: "FADE", duration_ms: 300 },
  ],
  duration_us: 17_000_000,
  latest_render: null,
  last_good_render: null,
  formats: [],
  created_by: null,
  created_at: "2026-11-08T12:00:00.000Z",
  updated_at: "2026-11-08T12:05:00.000Z",
};

const events: PlayerEvent[] = [
  {
    id: "ev-1",
    video_id: VIDEO_ID,
    video_title: "Match Source",
    kind: "PASS",
    start_us: 3_000_000,
    end_us: 3_800_000,
    evidence: "ball rule",
    key: true,
    how: null,
    set_piece: null,
    regain: null,
    partner_player_id: null,
    partner_name: "Kalu",
    length_m: null,
    from_m: null,
    to_m: null,
  },
  {
    id: "ev-other-video",
    video_id: "00000000-0000-4000-8000-000000000099",
    video_title: "Other",
    kind: "SHOT",
    start_us: 3_200_000,
    end_us: 3_500_000,
    evidence: "ball rule",
    key: false,
    how: null,
    set_piece: null,
    regain: null,
    partner_player_id: null,
    partner_name: null,
    length_m: null,
    from_m: null,
    to_m: null,
  },
];

describe("interchangeSlug", () => {
  it("normalises punctuation and falls back to reel when empty", () => {
    expect(interchangeSlug("Chinazom Godwin — Highlights #1!")).toBe("Chinazom-Godwin-Highlights-1");
    expect(interchangeSlug("   ???   ")).toBe("reel");
  });
});

describe("buildOtsiReelManifest & buildOtioTimeline", () => {
  const now = new Date("2026-11-08T20:00:00.000Z");
  const scoutSocialPreset: ExportPreset = BUILTIN_PRESETS.find((p) => p.id === "builtin-scout-social")!;
  const shareRights: VideoRights = {
    video_id: VIDEO_ID,
    analysis_blocked: null,
    grant: {
      id: "00000000-0000-4000-8000-000000000050",
      rights_state: "EXPORT_ALLOWED",
      allowed_uses: ["VIEW", "SHARE", "DOWNLOAD"],
      valid_from: null,
      valid_until: "2026-12-01T00:00:00.000Z",
      guardian_consent_state: "NOT_APPLICABLE",
      created_at: "2026-11-01T00:00:00.000Z",
    },
  };

  it("carries faithful evidence flags, B.22 preset outputs, retimed clip slots, spacers, transitions, and event provenance", () => {
    const out = buildInterchangeExport({
      reel: baseReel,
      video: { title: "Match Source.mp4", duration_us: 90_000_000, source_sha256: "abc123sha" },
      preset: scoutSocialPreset,
      who: [{ track_id: TRACK_ID, state: "CONFIRMED", basis: "JERSEY_NUMBER", by: "Analyst Ada", at: "2026-11-08T11:00:00.000Z" }],
      events,
      rights: shareRights,
      exportedAt: now,
    });

    expect(out.filename_base).toBe("Chinazom-Godwin-Highlights-1");
    expect(out.manifest.schema).toBe("otsi-reel/v1");
    expect(out.manifest.evidence).toEqual({
      player_identity: "CONFIRMED",
      target_tracks_current: true,
      match_clock: "CONFIRMED",
      match_score: "NOT_MEASURED",
      events_evidence: "INFERRED",
      accuracy_gate: "UNVERIFIED",
      rights_state: "EXPORT_ALLOWED",
      sharing_allowed: true,
    });

    // B.22 preset outputs use the reel's loudness (-16 LUFS) when the preset leaves loudness_lufs null
    expect(out.manifest.preset.outputs).toEqual([
      { profile: "SCOUT", aspect: "16:9", loudness_lufs: -16 },
      { profile: "SOCIAL", aspect: "9:16", loudness_lufs: -16 },
    ]);

    // Clip 1: 4s at 1x -> 4s; SUGGESTED -> INFERRED origin; 1 event inside it
    expect(out.manifest.clips[0]).toMatchObject({
      id: CLIP_1,
      source_duration_us: 4_000_000,
      output_duration_us: 4_000_000,
      slot_duration_us: 4_000_000,
      timeline_start_us: 0,
      origin: "SUGGESTED",
      origin_evidence: "INFERRED",
      action_detected: true,
      transition_in: null,
    });
    expect(out.manifest.clips[0]!.events).toEqual([
      {
        id: "ev-1",
        kind: "PASS",
        start_us: 3_000_000,
        end_us: 3_800_000,
        key: true,
        detail: null,
        partner_name: "Kalu",
        evidence_class: "INFERRED",
        evidence_basis: "ball rule",
        accuracy_gate: "UNVERIFIED",
      },
    ]);

    // Clip 2: 4s at 0.5x -> 8s output; MANUAL -> CONFIRMED origin; DISSOLVE transition kept (no spacer)
    expect(out.manifest.clips[1]).toMatchObject({
      id: CLIP_2,
      source_duration_us: 4_000_000,
      output_duration_us: 8_000_000,
      slot_duration_us: 8_000_000,
      timeline_start_us: 4_000_000,
      origin: "MANUAL",
      origin_evidence: "CONFIRMED",
      action_detected: false,
      transition_in: { kind: "DISSOLVE", duration_ms: 400 },
    });

    // Clip 3: 3s + 1.5s freeze = 4.5s output + 0.5s spacer = 5s slot; transition dropped because it follows a spacer
    expect(out.manifest.clips[2]).toMatchObject({
      id: CLIP_3,
      source_duration_us: 3_000_000,
      output_duration_us: 4_500_000,
      slot_duration_us: 5_000_000,
      timeline_start_us: 12_500_000,
      transition_in: null,
    });
    expect(out.manifest.reel.duration_us).toBe(17_000_000);

    // OpenTimelineIO Timeline.1 structure
    const otio = buildOtioTimeline(out.manifest);
    expect(otio.OTIO_SCHEMA).toBe("Timeline.1");
    expect(otio.global_start_time).toEqual({ OTIO_SCHEMA: "RationalTime.1", value: 0, rate: OTIO_RATE });
    expect(otio.tracks.children).toHaveLength(2);
    const [videoTrack, audioTrack] = otio.tracks.children;
    expect(videoTrack!.kind).toBe("Video");
    expect(audioTrack!.kind).toBe("Audio");

    // Video track items: Clip 1 -> Transition (into Clip 2) -> Clip 2 (LinearTimeWarp) -> Gap (before Clip 3) -> Clip 3 (FreezeFrame)
    expect(videoTrack!.children.map((x) => [x.OTIO_SCHEMA, x.name])).toEqual([
      ["Clip.1", "Key pass + shot"],
      ["Transition.1", "DISSOLVE"],
      ["Clip.1", "Clip 2 (manual)"],
      ["Gap.1", "Spacer"],
      ["Clip.1", "Freeze moment"],
    ]);
    const c1 = videoTrack!.children[0]!;
    if (c1.OTIO_SCHEMA === "Clip.1") {
      expect(c1.media_reference.target_url).toBe(`otsi-vie://videos/${VIDEO_ID}/source`);
      expect(c1.markers).toHaveLength(1);
      expect(c1.markers[0]!.marked_range.start_time.value).toBe(1_000_000); // 3s - 2s clip in
    }
    const c3Audio = audioTrack!.children[4]!;
    if (c3Audio.OTIO_SCHEMA === "Clip.1") {
      expect(c3Audio.effects[0]).toMatchObject({ OTIO_SCHEMA: "Effect.1", name: "Mute", effect_name: "AudioGain" });
    }
  });

  it("marks stale identities, unrecorded rights, and missing events truthfully", () => {
    const staleManifest = buildOtsiReelManifest({
      reel: {
        ...baseReel,
        stale: true,
        match: { home: "A", away: "B", competition: null, clock: "PROPOSED" },
        targets: [{ ...baseReel.targets[0]!, decision_current: false }],
      },
      video: { title: "Raw.mp4", duration_us: null, source_sha256: null },
      who: [{ track_id: TRACK_ID, state: "REJECTED", basis: null, by: null, at: null }],
      events: [],
      rights: null,
      exportedAt: now,
    });
    expect(staleManifest.evidence).toEqual({
      player_identity: "STALE",
      target_tracks_current: false,
      match_clock: "PROPOSED",
      match_score: "NOT_MEASURED",
      events_evidence: "NONE",
      accuracy_gate: "UNVERIFIED",
      rights_state: "UNRECORDED",
      sharing_allowed: false,
    });
    const flags = describeEvidenceFlags(staleManifest.evidence);
    expect(flags.every((f) => f.tone === "warn")).toBe(true);
    expect(flags.find((f) => f.key === "player_identity")!.value).toContain("Stale");
    expect(flags.find((f) => f.key === "rights_state")!.value).toContain("Unrecorded");
  });
});
