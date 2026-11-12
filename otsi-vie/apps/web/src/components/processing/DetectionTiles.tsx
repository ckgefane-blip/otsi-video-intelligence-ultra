"use client";
/**
 * Page 03 Section 05 — four detection tiles, on the Desktop UI flow layout.
 *
 * Evidence from the latest finished run, never a sample: Player Detection shows the people tracks the engine found (their own
 * thumbnails, longest first), Ball Detection the ball tracks, Team Identification the run's kit colour groups with their measured colour
 * and the team a PERSON assigned to each (GET /v1/analysis-runs/:id/kit-groups; colour alone proves nothing, ADR-031), Event Markers the
 * events the engine found from the followed ball (GET /v1/videos/:id/events), counted per kind; none until the ball is followed in Analysis.
 * The expand button opens the full Analysis workspace for the video.
 */
import type { AnalysisRun, MatchEvents, RunTeams, TrackSummary } from "@otsi-vie/contracts";
import { Expand } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api, apiBlob } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { DATE_TAG, isActive } from "./model";

/** every event the engine found from the ball: passes, ball won, shots, pressures, set pieces */
export const eventCount = (e: MatchEvents | null) => (e?.state === "READY" ? e.passes.length + e.changes.length + e.shots.length + e.pressures.length + e.set_pieces.length : null);
const PEOPLE = new Set(["PERSON", "PLAYER", "GOALKEEPER", "REFEREE"]);

function TrackThumb({ track }: { track: TrackSummary }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!track.has_thumbnail) return;
    let live = true, url: string | null = null;
    void apiBlob(`/v1/tracks/${track.track_id}/thumbnail`).then((b) => { url = URL.createObjectURL(b); if (live) setSrc(url); }, () => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [track.track_id, track.has_thumbnail]);
  return (
    <div className="aspect-square overflow-hidden rounded border bg-raised" style={{ borderColor: track.identity_state === "CONFIRMED" ? "#3ee6a8" : "#19d3ff" }}>
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : null}
    </div>
  );
}

function Tile({ title, sub, href, section, region, children }: { title: string; sub: string; href: string | null; section: string; region: string; children: ReactNode }) {
  const { t: dict } = useLocale();
  const d = dict.body.processing;
  return (
    <section aria-label={region} data-section={section} aria-description={`${title}: ${sub}`} className="vie-panel">
      <div className="vie-ph">
        <div className="min-w-0">
          <h3 className="t-panel truncate">{title}</h3>
          <p className="truncate text-xs text-muted">{sub}</p>
        </div>
        {href ? (
          <Link href={href} aria-label={d.openInWorkspace.replace("{title}", title)} className="vie-ib !h-8 !w-8 shrink-0"><Expand className="h-4 w-4" aria-hidden /></Link>
        ) : (
          <span className="vie-ib !h-8 !w-8 shrink-0 opacity-50" aria-hidden><Expand className="h-4 w-4" /></span>
        )}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

const Empty = ({ text }: { text: string }) => (
  <div className="grid min-h-[140px] place-items-center rounded-ctl border border-line/70 bg-raised/40 p-4 text-center">
    <p className="text-sm text-muted">{text}</p>
  </div>
);

/** `totals`: the finished run's own counts (its result), the same numbers as Output Summary; `tracks` only gives the thumbnails (the first
 *  5 000 tracks of a run, read in a few seconds on a long match), so a tile never counts a partial list (v3 Phase 0, P1) */
export function DetectionTiles({ run, finishedRunId, tracks, videoId, events, totals }: { run: AnalysisRun | null; finishedRunId: string | null; tracks: TrackSummary[] | null; videoId: string | null;
  events: MatchEvents | null; totals: { people: number | null; ball: number | null } }) {
  const { t: dict, locale } = useLocale();
  const d = dict.body.processing;
  const up = dict.body.upload;
  const tag = DATE_TAG[locale];
  const finished = !!finishedRunId;
  const [teams, setTeams] = useState<RunTeams | null>(null);
  useEffect(() => {
    setTeams(null);
    if (finishedRunId) void api<RunTeams>(`/v1/analysis-runs/${finishedRunId}/kit-groups`).then(setTeams, () => setTeams(null));
  }, [finishedRunId]);
  const people = (tracks ?? []).filter((t) => PEOPLE.has(t.class_name)).sort((a, b) => b.observation_count - a.observation_count);
  const balls = (tracks ?? []).filter((t) => t.class_name === "BALL").sort((a, b) => b.observation_count - a.observation_count);
  const groups = [...(teams?.groups ?? [])].sort((a, b) => b.tracks - a.tracks);
  const assigned = groups.filter((g) => g.assignment?.club_id).length;
  const state = !run ? up.notStarted : isActive(run) ? (run.status === "QUEUED" ? d.waitingWorkerDots : d.runningDots) : run.status === "FAILED" ? d.runFailed : null;
  const href = finished && videoId ? `/videos/${videoId}/analyze` : null;

  // never "0" for a number not read yet: a finished run whose tracks are still loading says so
  const nPeople = totals.people ?? (tracks ? people.length : null), nBall = totals.ball ?? (tracks ? balls.length : null);
  const pSub = state && !finished ? state : nPeople === null ? dict.common.loading : d.peopleTracks.replace("{n}", nPeople.toLocaleString(tag));
  const bSub = state && !finished ? state : nBall === null ? dict.common.loading : (nBall === 1 ? d.ballTrackOne : d.ballTracksMany).replace("{n}", nBall.toLocaleString(tag));
  const tSub = state && !finished ? state : !teams ? dict.common.loading : groups.length === 0 ? d.noKitColours
    : (groups.length === 1 ? d.colourGroupOne : d.colourGroupsMany).replace("{a}", String(assigned)).replace("{g}", String(groups.length));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-people={String(people.length)} data-ball={String(balls.length)}>
      <Tile title={d.playerDetection} sub={pSub} href={href} section="p03-s04" region={d.playerDetection}>
        {finished && people.length ? (
          <div className="grid grid-cols-6 gap-1.5">
            {people.slice(0, 18).map((t) => <TrackThumb key={t.track_id} track={t} />)}
          </div>
        ) : <Empty text={!finished ? d.noDetections : !tracks ? d.loadingTracks : d.noPeople} />}
      </Tile>
      <Tile title={d.ballDetection} sub={bSub} href={href} section="p03-s05" region={d.ballDetection}>
        {finished && balls.length ? (
          <div className="grid grid-cols-6 gap-1.5">
            {balls.slice(0, 18).map((t) => <TrackThumb key={t.track_id} track={t} />)}
          </div>
        ) : <Empty text={!finished ? d.noDetections : !tracks ? d.loadingTracks : d.noBall} />}
      </Tile>
      <Tile title={d.teamIdentification} sub={tSub} href={href} section="p03-s06" region={d.teamIdentification}>
        {finished && groups.length ? (
          <>
            <ul className="space-y-2">
              {groups.slice(0, 5).map((g) => {
                const label = g.assignment ? (g.assignment.club_name ?? d.notATeam) : d.kitNotAssigned.replace("{n}", String(g.kit_group));
                return (
                  <li key={g.kit_group} data-kit-group={g.kit_group} data-team={g.assignment?.club_id ?? (g.assignment ? "none" : "")} className="flex items-center gap-2.5 text-sm">
                    <span className="h-6 w-6 shrink-0 rounded border border-line2" style={{ background: g.kit_rgb ?? "#2a4f80" }} aria-hidden />
                    <span className={`min-w-0 flex-1 truncate ${g.assignment?.club_id ? "" : "text-muted"}`}>{label}</span>
                    <span className="shrink-0 text-xs text-muted">{d.tracksCount.replace("{n}", g.tracks.toLocaleString(tag))}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted">{assigned < groups.length ? d.assignTeamsNote : d.teamsAssignedNote}</p>
          </>
        ) : <Empty text={finished ? (teams ? d.noKitColours : dict.common.loading) : d.noTeamsYet} />}
      </Tile>
      <Tile title={d.eventMarkers} href={events?.state === "READY" ? href : null} section="p03-s07" region={d.eventMarkers}
        sub={!events || events.state === "NONE" ? d.followBallEvents : events.state === "RUNNING" ? d.followingBall : d.eventsFound.replace("{n}", String(eventCount(events)))}>
        <div aria-label={events?.state === "READY" ? d.eventsFoundBall.replace("{n}", String(eventCount(events))) : d.noEventsYet} role="img">
          {/* a drawn pitch diagram (not footage): the counts over it are the engine's measured events */}
          <div className="relative h-[140px] overflow-hidden rounded border border-line/70 bg-[#1f7a36]">
            <span className="absolute left-1/2 top-0 h-full w-px bg-white/80" aria-hidden />
            <span className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/80" aria-hidden />
            {events?.state === "READY" && (
              <div className="absolute inset-x-3 top-1/2 grid -translate-y-1/2 grid-cols-2 gap-x-3 gap-y-1 rounded-ctl bg-black/70 p-2 text-xs text-white">
                {([["#1e90ff", d.eventPasses, events.passes.length], ["#ff2a2a", d.eventShots, events.shots.length], ["#ffc41a", d.eventBallWon, events.changes.length], ["#ff8a1a", d.eventPressures, events.pressures.length],
                  ["#d63aff", d.eventSetPieces, events.set_pieces.length]] as const).map(([c, l, n]) => (
                  <span key={l} data-event-count={l} className="flex items-center gap-1.5 whitespace-nowrap">
                    <i className="h-3 w-3 shrink-0 rounded-full" style={{ background: c }} aria-hidden /><b>{n}</b> {l}
                  </span>
                ))}
              </div>
            )}
          </div>
          {/* what the engine finds (v3 Phase 0): fouls and offsides are not detected, so they are not in the legend */}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            {([["#1e90ff", d.eventPass, events?.passes.length], ["#ff2a2a", d.eventShot, events?.shots.length], ["#ffc41a", d.eventWon, events?.changes.length], ["#ff8a1a", d.eventPress, events?.pressures.length],
              ["#d63aff", d.eventSet, events?.set_pieces.length]] as const).map(([c, l, n]) => (
              <span key={l} title={`${l}: ${events?.state === "READY" ? n ?? 0 : "—"}`} className="flex items-center gap-1.5">
                <i className="h-3 w-3 rounded-full" style={{ background: c }} aria-hidden />{l}
              </span>
            ))}
          </div>
        </div>
      </Tile>
    </div>
  );
}
