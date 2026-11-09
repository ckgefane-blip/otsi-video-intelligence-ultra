"use client";
/**
 * Possession and passes (ADR-040) for Page 04: the engine's answer from its ball, in match time. Reloads when the ball is followed again,
 * when the halves change and when kits or identities are decided (the API names teams and players at read time).
 */
import { useCallback, useEffect, useState } from "react";
import type { MatchEvents, TeamPossession } from "@otsi-vie/contracts";
import { api } from "@/lib/api";

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
export const teamName = (t: TeamPossession, i: number) => t.name ?? `Kit ${i + 1}`;

/** one line for the timeline: passes, balls won, shots, possession and pressing, or why there is nothing */
export function eventsLine(ev: MatchEvents | null): string {
  if (!ev) return "…";
  if (ev.state === "NONE") return "Possession and passes appear when the engine has followed the ball (AI Tools → Ball).";
  if (ev.state === "RUNNING" && !ev.ball_track_id) return "Following the ball: possession and passes come next.";
  const where = ev.match_time ? "in match time" : "in the whole video (match time not known)";
  const seen = `${Math.round(ev.possession_known_s / 60)} of ${Math.round(ev.counted_s / 60)} min`;
  const share = ev.teams.some((t) => t.share !== null)
    ? `Possession: ${ev.teams.map((t, i) => `${teamName(t, i)} ${t.share ?? "—"}%`).join(" · ")} (a team seen on the ball ${seen}).`
    : `Possession: not measured yet (a team seen on the ball only ${seen}).`;
  const unnamed = ev.teams.some((t) => !t.name) ? " Name the kits (Name players → Kits) to see clubs." : "";
  const shots = ev.shots.length ? `${ev.shots.length} shots` : "no shots yet";
  const press = ev.pressures.length
    ? ` Pressing: ${ev.teams.map((t, i) => `${teamName(t, i)} ${t.pressures} pressures, ${t.press_regains} won the ball back within 5 s`).join(" · ")}.` : "";
  return `${ev.passes.length} passes, ${ev.changes.length} balls won and ${shots} found ${where} (only where the ball and the players are seen). ${share}${press}${unnamed}`;
}
