/**
 * v3 Phase B.22 (ADR-097, migration 0058): Export preset library, batch fan-out, preflight.
 *   ExportOutput     one file of an edit: an export profile, and for the reel profile the frame it is made in (null = the reel's own)
 *   ExportPreset     a named recipe of outputs with format, quality and loudness: built in (code), the organization's, or a member's own
 *   BatchRender      several files of one edit started in one request; a file already rendering is skipped and says so
 *   preflight        what a person should know before exporting: what blocks it, and what will look different from what they expect
 */
import { z } from "zod";
import { EXPORT_PROFILES, ExportProfile, ReelAspect, RenderJob, type ReelAspectT } from "./reels";

export const ExportOutput = z.object({ profile: ExportProfile, aspect: ReelAspect.nullable().default(null) });
export type ExportOutput = z.infer<typeof ExportOutput>;
const Lufs = z.number().min(-31).max(-9);
export const ExportPresetSpec = z.object({
  outputs: z.array(ExportOutput).min(1).max(6),
  /** null = keep what is chosen on the page */
  codec: z.enum(["h264", "av1", "vp9"]).nullable().default(null),
  bitrate_mbps: z.number().min(2).max(20).nullable().default(null),
  /** null = the reel's own target, else each profile's level */
  loudness_lufs: Lufs.nullable().default(null),
});
export type ExportPresetSpec = z.infer<typeof ExportPresetSpec>;
export const PresetScope = z.enum(["BUILT_IN", "ORGANIZATION", "PERSONAL"]);
export const ExportPreset = z.object({
  id: z.string(), name: z.string(), scope: PresetScope, note: z.string(), spec: ExportPresetSpec,
  created_by: z.string().nullable(), created_at: z.string().nullable(),
  /** the caller may delete it */
  can_delete: z.boolean(),
});
export type ExportPreset = z.infer<typeof ExportPreset>;
export const CreateExportPresetRequest = z.object({
  name: z.string().trim().min(1).max(80), scope: z.enum(["ORGANIZATION", "PERSONAL"]), note: z.string().trim().max(200).default(""), spec: ExportPresetSpec,
});
export type CreateExportPresetRequest = z.infer<typeof CreateExportPresetRequest>;

const builtin = (id: string, name: string, note: string, outputs: ExportOutput[]): ExportPreset =>
  ({ id: `builtin-${id}`, name, scope: "BUILT_IN", note, spec: { outputs, codec: null, bitrate_mbps: null, loudness_lufs: null }, created_by: null, created_at: null, can_delete: false });
/** E3 (ADR-066) presets, kept as they were */
export const BUILTIN_PRESETS: ExportPreset[] = [
  builtin("reel", "Highlights Reel (Recommended)", "The reel as edited, in its own frame. Sound at −16 LUFS.", [{ profile: "REEL", aspect: null }]),
  builtin("scout-social", "Scout + Social cuts", "Two files from this edit: 16:9 for scouts (−16 LUFS) and 9:16 following the player for social (−14 LUFS).",
    [{ profile: "SCOUT", aspect: null }, { profile: "SOCIAL", aspect: null }]),
  builtin("archive", "Archive master", "16:9 at 20 Mbps, sound at −23 LUFS (broadcast level), for keeping.", [{ profile: "ARCHIVE", aspect: null }]),
  builtin("all-frames", "Every frame", "The reel in 16:9, 9:16, 1:1 and 4:5, each following the player.",
    (["16:9", "9:16", "1:1", "4:5"] as const).map((a) => ({ profile: "REEL" as const, aspect: a }))),
];

/** the frame a file is made in: the profile's own (scout, social, archive), else the chosen one, else the reel's */
export const outputAspect = (o: ExportOutput, reelAspect: ReelAspectT): ReelAspectT => EXPORT_PROFILES[o.profile].aspect ?? o.aspect ?? reelAspect;
const PROFILE_WORD: Record<ExportProfile, string> = { REEL: "Reel", SCOUT: "Scout cut", SOCIAL: "Social cut", ARCHIVE: "Archive master" };
export const outputLabel = (o: ExportOutput, reelAspect: ReelAspectT) => `${PROFILE_WORD[o.profile]} ${outputAspect(o, reelAspect)}`;
/** the files a list of outputs makes, each once (two outputs that make the same file count once) */
export function uniqueOutputs(outs: ExportOutput[], reelAspect: ReelAspectT): (ExportOutput & { aspect: ReelAspectT })[] {
  const seen = new Set<string>(), out: (ExportOutput & { aspect: ReelAspectT })[] = [];
  for (const o of outs) {
    const a = outputAspect(o, reelAspect), k = `${o.profile}|${a}`;
    if (!seen.has(k)) { seen.add(k); out.push({ profile: o.profile, aspect: a }); }
  }
  return out;
}
/** the loudness a file's sound is set to: the export's own choice, else the reel's target, else the profile's level */
export const outputLufs = (o: ExportOutput, exportLufs: number | null, reelLufs: number | null) => exportLufs ?? reelLufs ?? EXPORT_PROFILES[o.profile].lufs;

export const BatchRenderRequest = z.object({
  outputs: z.array(ExportOutput).min(1).max(6),
  codec: z.enum(["h264", "av1", "vp9"]).default("h264"),
  bitrate_mbps: z.number().min(2).max(20).default(8),
  loudness_lufs: Lufs.nullable().default(null),
});
export type BatchRenderRequest = z.infer<typeof BatchRenderRequest>;
export const BatchRenderResult = z.object({
  started: z.array(RenderJob),
  skipped: z.array(z.object({ profile: ExportProfile, aspect: ReelAspect, code: z.string(), message: z.string() })),
});
export type BatchRenderResult = z.infer<typeof BatchRenderResult>;

export const PreflightCheck = z.object({ key: z.string(), level: z.enum(["OK", "WARN", "BLOCK"]), text: z.string() });
export type PreflightCheck = z.infer<typeof PreflightCheck>;
export const Preflight = z.object({
  checks: z.array(PreflightCheck),
  /** the files of this reel rendering now (a batch skips them) */
  open: z.array(z.object({ profile: ExportProfile, aspect: ReelAspect })),
});
export type Preflight = z.infer<typeof Preflight>;
export interface PreflightFacts {
  clips: number; length_us: number; stale: boolean; player: boolean; rights_problem: string | null; music: boolean;
  lower_third: boolean; on_team_sheet: boolean; match_card: boolean; match_linked: boolean; score_bug: boolean; clock_confirmed: boolean;
  /** ADR-130: the Player Profile Intro opens the reel (absent = an older caller: no intro row); the photo's rights problem, if any */
  profile_intro?: boolean; photo_rights_problem?: string | null;
}
/** the checks, worst first: BLOCK stops the export (the API refuses it too), WARN is worth knowing, OK says what is fine */
export function preflightChecks(f: PreflightFacts): PreflightCheck[] {
  const out: PreflightCheck[] = [];
  const add = (key: string, level: PreflightCheck["level"], text: string) => out.push({ key, level, text });
  if (!f.clips) add("clips", "BLOCK", "The reel has no clips: add at least one.");
  else add("clips", "OK", `${f.clips} clip${f.clips === 1 ? "" : "s"}, ${Math.round(f.length_us / 1e6)} s.`);
  if (f.stale) add("identity", "BLOCK", "A player identity this reel follows has changed: refresh the targets in the Reel Builder first.");
  if (f.rights_problem) add("rights", "BLOCK", f.rights_problem);
  else add("rights", "OK", "Every logo, video and music chosen has its rights in force.");
  if (!f.player) add("player", "WARN", "No confirmed player: the spotlight follows no one.");
  else add("player", "OK", "The spotlight follows the confirmed player only; where he is not seen, it fades.");
  if (f.clips && f.length_us < 5_000_000) add("length", "WARN", "The reel is shorter than 5 seconds.");
  if (f.music) add("music", "WARN", "Music is in the reel: check its licence allows where you will publish.");
  if (f.lower_third && !f.on_team_sheet) add("strap", "WARN", "The strap will show no shirt number or position: the player is not on the match's team sheet.");
  if (f.match_card && !f.match_linked) add("card", "WARN", "No match card: the video is not linked to a match.");
  if (f.score_bug && !f.clock_confirmed) add("clock", "WARN", "The score bug will show no clock: the halves are not confirmed by a person.");
  if (f.profile_intro && f.photo_rights_problem) add("photo_rights", "BLOCK", f.photo_rights_problem);
  else if (f.profile_intro) add("profile_intro", "OK", "The reel opens with the player's profile intro.");
  const rank = { BLOCK: 0, WARN: 1, OK: 2 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
