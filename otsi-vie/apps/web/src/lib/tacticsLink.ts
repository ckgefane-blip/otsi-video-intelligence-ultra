/**
 * v3 Phase B.8 (ADR-085): one link between the Analysis centre tabs and the Tactical page that carries the same context: the video, the
 * playhead, the selected track and the matching Tactical tab. Tactical reads the same keys back, so either page can open the other.
 */
export const TACTIC_TABS = ["team-overview", "pass-network", "heat-zones", "pressing-defense", "off-ball-runs", "player-comparison"] as const;
export type TacticTab = (typeof TACTIC_TABS)[number];

/** the Analysis centre tabs (after the video) and the Tactical tab each one opens */
export const ANALYSIS_TO_TACTIC: Record<number, TacticTab> = { 1: "team-overview", 2: "heat-zones", 3: "pass-network", 4: "player-comparison" };

export interface TacticsContext { videoId: string; tab: TacticTab; timeUs?: number | null; trackId?: string | null }

export function tacticsHref({ videoId, tab, timeUs, trackId }: TacticsContext): string {
  const q = new URLSearchParams({ video: videoId, tab });
  if (timeUs !== null && timeUs !== undefined && Number.isFinite(timeUs) && timeUs > 0) q.set("t", (Math.round(timeUs / 100_000) / 10).toString());
  if (trackId) q.set("track", trackId);
  return `/tactics?${q}`;
}

export interface ReadContext { tabIndex: number | null; timeUs: number | null; trackId: string | null }

/** what a Tactical address asks for; anything malformed is ignored, never guessed */
export function readTacticsContext(p: { get(k: string): string | null }): ReadContext {
  const tab = p.get("tab");
  const i = tab ? TACTIC_TABS.indexOf(tab as TacticTab) : -1;
  const t = Number(p.get("t"));
  const track = p.get("track");
  return {
    tabIndex: i >= 0 ? i : null,
    timeUs: p.get("t") !== null && Number.isFinite(t) && t >= 0 ? Math.round(t * 1_000_000) : null,
    trackId: track && /^[0-9a-f-]{36}$/i.test(track) ? track : null,
  };
}
