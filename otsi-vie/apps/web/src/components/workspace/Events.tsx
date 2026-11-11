"use client";
/**
 * Possession and passes (ADR-040) for Page 04: the engine's answer from its ball, in match time. Reloads when the ball is followed again,
 * when the halves change and when kits or identities are decided (the API names teams and players at read time).
 */
import { useCallback, useEffect, useState } from "react";
import type { MatchEvents, TeamPossession } from "@otsi-vie/contracts";
import { api } from "@/lib/api";
import { getDictionary, type Dictionary } from "@/lib/i18n";

export interface EventsState { data: MatchEvents | null; reload(): Promise<void> }

export function useEvents(videoId: string | undefined, key: string): EventsState {
  const [data, setData] = useState<MatchEvents | null>(null);
  const reload = useCallback(async () => {
    if (!videoId) { setData(null); return; }
    try { setData(await api<MatchEvents>(`/v1/videos/${videoId}/events`)); } catch { /* keep what is shown */ }
  }, [videoId]);
  useEffect(() => { void reload(); }, [reload, key]);
  useEffect(() => { setData(null); }, [videoId]);
  return { data, reload };
}

/** a team's name: its club, else its kit (nobody has said which club wears it yet) */
export const teamName = (t: TeamPossession, i: number, d?: Dictionary) => t.name ?? (d ?? getDictionary("en")).body.workspace.kitLabel.replace("{a}", String(i + 1));

/** one line for the timeline: passes, balls won, shots, possession and pressing, or why there is nothing */
export function eventsLine(ev: MatchEvents | null, d?: Dictionary): string {
  const dict = d ?? getDictionary("en");
  if (!ev) return "…";
  if (ev.state === "NONE") return dict.body.workspace.eventsAppearBall;
  if (ev.state === "RUNNING" && !ev.ball_track_id) return dict.body.workspace.followingBall;
  const where = ev.match_time ? dict.body.workspace.inMatchTime : dict.body.workspace.inWholeVideo;
  const seen = dict.body.workspace.seenMinutes.replace("{a}", String(Math.round(ev.possession_known_s / 60))).replace("{b}", String(Math.round(ev.counted_s / 60)));
  const share = ev.teams.some((t) => t.share !== null)
    ? dict.body.workspace.possessionLine.replace("{a}", ev.teams.map((t, i) => `${teamName(t, i, dict)} ${t.share ?? "—"}%`).join(" · ")).replace("{b}", seen)
    : dict.body.workspace.possessionNotMeasured.replace("{a}", seen);
  const unnamed = ev.teams.some((t) => !t.name) ? dict.body.workspace.nameKits : "";
  const press = ev.pressures.length
    ? dict.body.workspace.pressingLine.replace("{a}", ev.teams.map((t, i) => dict.body.workspace.pressingTeamLine.replace("{a}", teamName(t, i, dict)).replace("{b}", String(t.pressures)).replace("{c}", String(t.press_regains))).join(" · ")) : "";
  const found = ev.shots.length
    ? dict.body.workspace.eventsFoundShots.replace("{a}", String(ev.passes.length)).replace("{b}", String(ev.changes.length)).replace("{c}", String(ev.shots.length)).replace("{d}", where)
    : dict.body.workspace.eventsFoundNoShots.replace("{a}", String(ev.passes.length)).replace("{b}", String(ev.changes.length)).replace("{c}", where);
  return `${found} ${share}${press}${unnamed}`;
}
