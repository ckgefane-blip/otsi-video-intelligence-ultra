/**
 * v3 Phase B.13 (ADR-089): the Reel Builder's confirmation before Generate Reel: what the render will hold, and how long it may take,
 * measured from this organization's own finished renders (time from start to finish ÷ seconds of reel made). No finished render: no
 * estimate ("unknown beats wrong"). Renders with the same Auto Track setting are used first (it re-finds the player 10 times a second,
 * the slowest part); the 10 most recent are used.
 */
import { z } from "zod";
import type { Reel, SpotlightSettings } from "./reels";

export const RenderEstimate = z.object({
  /** finished renders the estimate is measured from (0: none, no estimate) */
  basis: z.number().int().nonnegative(),
  /** the measured renders had the same Auto Track setting as this one */
  same_tracking: z.boolean(),
  /** seconds of work per second of reel: the median, the fastest and the slowest of the basis */
  per_second: z.number().nullable(),
  seconds: z.number().nullable(),
  low_seconds: z.number().nullable(),
  high_seconds: z.number().nullable(),
  /** renders queued or running in the organization now (this one waits behind them) */
  waiting: z.number().int().nonnegative(),
});
export type RenderEstimate = z.infer<typeof RenderEstimate>;

export interface RenderSample { elapsed_s: number; output_s: number; auto_track: boolean }
export const ESTIMATE_SAMPLES = 10;

/** the estimate for `outputUs` of reel from recent finished renders (most recent first) */
export function estimateFrom(samples: RenderSample[], outputUs: number, autoTrack: boolean, waiting = 0): RenderEstimate {
  const ok = samples.filter((s) => s.output_s > 0 && s.elapsed_s > 0);
  const same = ok.filter((s) => s.auto_track === autoTrack);
  const use = (same.length ? same : ok).slice(0, ESTIMATE_SAMPLES);
  if (!use.length || outputUs <= 0) return { basis: 0, same_tracking: false, per_second: null, seconds: null, low_seconds: null, high_seconds: null, waiting };
  const r = use.map((s) => s.elapsed_s / s.output_s).sort((a, b) => a - b);
  const mid = r.length % 2 ? r[(r.length - 1) / 2]! : (r[r.length / 2 - 1]! + r[r.length / 2]!) / 2;
  const out = outputUs / 1e6, round = (x: number) => Math.round(x * 10) / 10;
  return { basis: use.length, same_tracking: same.length > 0, per_second: round(mid), seconds: Math.round(mid * out), low_seconds: Math.round(r[0]! * out),
    high_seconds: Math.round(r[r.length - 1]! * out), waiting };
}

/** "about 4 min (3–6 min)" */
export function durationWords(s: number): string {
  if (s < 60) return `${Math.max(1, Math.round(s))} s`;
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}
export function estimateLine(e: RenderEstimate | null): string {
  if (!e) return "Estimating…";
  if (e.basis === 0 || e.seconds === null) return "No estimate yet: no reel has finished rendering in this organization. The first render sets it.";
  const range = e.low_seconds !== null && e.high_seconds !== null && e.high_seconds > e.low_seconds ? ` (${durationWords(e.low_seconds)}–${durationWords(e.high_seconds)})` : "";
  const from = `from ${e.basis} finished render${e.basis === 1 ? "" : "s"}${e.same_tracking ? "" : " with a different Auto Track setting"}`;
  return `About ${durationWords(e.seconds)}${range}, ${from}.${e.waiting ? ` ${e.waiting} render${e.waiting === 1 ? " is" : "s are"} ahead of it.` : ""}`;
}

/** the summary rows the confirmation shows: what the render holds, from the reel and the look about to be saved */
export function renderSummary(reel: Reel, s: SpotlightSettings, codec: string, musicName: string | null): [string, string][] {
  const overlays = [s.name_caption && "player card", s.score_bug && "score & time", s.lower_third && "lower third", s.competition_logo_id && "competition logo"].filter(Boolean) as string[];
  const brand = [s.watermark && "watermark", s.custom_logo_id && "custom logo", s.end_screen && "end screen", s.intro_id && "intro", s.outro_id && "outro"].filter(Boolean) as string[];
  const secs = Math.round(reel.duration_us / 1e6);
  return [
    ["Player", reel.player ? `${reel.player.display_name}${reel.player.canonical_otsi_id ? ` · ${reel.player.canonical_otsi_id}` : ""} (confirmed by a person)` : "None"],
    ["Clips", `${reel.clips.length} clip${reel.clips.length === 1 ? "" : "s"}, ${secs >= 60 ? `${Math.floor(secs / 60)} min ${secs % 60} s` : `${secs} s`}`],
    ["Frame", reel.aspect],
    ["Spotlight", `${s.auto_track ? "Auto Track on (re-found 10 times a second)" : "Analysis positions only"} · dim ${Math.round(s.dim * 100)}%`],
    ["Overlays", overlays.length ? overlays.join(", ") : "None"],
    ["Branding", brand.length ? brand.join(", ") : "None"],
    ["Music", musicName ?? "None (match sound)"],
    ["File", codec === "h264" ? "H.264 MP4" : codec === "av1" ? "AV1 MP4" : codec === "h265" ? "H.265 MP4" : codec === "prores" ? "ProRes 422 MOV" : "VP9 WebM"],
  ];
}

/** B.13: the step a person last worked on in a reel, remembered in this browser (0 Select Player … 3 Export) */
export const REEL_STEP_KEY = (reelId: string) => `otsi.reel.step.${reelId}`;
