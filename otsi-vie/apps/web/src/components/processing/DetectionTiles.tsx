"use client";
/**
 * Page 03 Section 05 — four detection tiles (approved reference 03_AI_PROCESSING, "four tiles").
 *
 * Evidence from the latest finished run, never a sample: Player Detection shows the people tracks the engine found (their own
 * thumbnails, longest first), Ball Detection the ball tracks, Team Identification the run's kit colour groups with their measured colour
 * and the team a PERSON assigned to each (GET /v1/analysis-runs/:id/kit-groups; colour alone proves nothing, ADR-031), Event Markers the
 * events the engine found from the followed ball (GET /v1/videos/:id/events), counted per kind; none until the ball is followed in Analysis.
 * The expand button opens the full Analysis workspace for the video.
 */
import type { AnalysisRun, MatchEvents, RunTeams, TrackSummary } from "@otsi-vie/contracts";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { B, T, u } from "@/components/stage/DesignStage";
import { api, apiBlob } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { DATE_TAG, isActive } from "./model";

/** every event the engine found from the ball: passes, ball won, shots, pressures, set pieces */
export const eventCount = (e: MatchEvents | null) => (e?.state === "READY" ? e.passes.length + e.changes.length + e.shots.length + e.pressures.length + e.set_pieces.length : null);
const PEOPLE = new Set(["PERSON", "PLAYER", "GOALKEEPER", "REFEREE"]);
const box = { border: `${u(1.5)} solid #142f55`, borderRadius: u(10), background: "linear-gradient(180deg,#081a35,#06122a)" };
const placeholder = "linear-gradient(135deg,#1b4d8f,#0b2a52 55%,#2a6a3a)";

function TrackThumb({ track, x, y, w, h }: { track: TrackSummary; x: number; y: number; w: number; h: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!track.has_thumbnail) return;
    let live = true, url: string | null = null;
    void apiBlob(`/v1/tracks/${track.track_id}/thumbnail`).then((b) => { url = URL.createObjectURL(b); if (live) setSrc(url); }, () => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [track.track_id, track.has_thumbnail]);
  return (
    <B x={x} y={y} w={w} h={h} style={{ borderRadius: u(4), border: `${u(1.5)} solid ${track.identity_state === "CONFIRMED" ? "#3ee6a8" : "#19d3ff"}`,
      background: src ? `center / cover no-repeat url(${src}), #0a1d38` : "#0a1d38" }} />
  );
}

function Tile({ x, y, w, h, title, sub, href, section, region, children }:
  { x: number; y: number; w: number; h: number; title: string; sub: string; href: string | null; section: string; region: string; children: ReactNode }) {
  const { t: dict } = useLocale();
  const d = dict.body.processing;
  return (
    <section aria-label={region} data-section={section} aria-description={`${title}: ${sub}`}>
      <B x={x} y={y} w={w} h={h} style={box} />
      <T x={x + 18} y={y + 27} size={24} weight={700} as="h3">{title}</T>
      <T x={x + 18} y={y + 58} size={19} color="#b3c4dc">{sub}</T>
      {href ? (
        <Link href={href} aria-label={d.openInWorkspace.replace("{title}", title)} className="absolute" style={{ left: u(x + w - 52), top: u(y + 22 - 101), width: u(34), height: u(34),
          border: `${u(1.5)} solid #2a4f80`, borderRadius: u(6), background: "#0a1d38", color: "#cfe3ff", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: u(16), textDecoration: "none", boxSizing: "border-box" }}>⤢</Link>
      ) : (
        <B x={x + w - 52} y={y + 22} w={34} h={34} style={{ border: `${u(1.5)} solid #2a4f80`, borderRadius: u(6), background: "#0a1d38", color: "#cfe3ff",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: u(16), opacity: 0.8 }}>⤢</B>
      )}
      {children}
    </section>
  );
}

/** a grid of track thumbnails filling the tile body, longest tracks first */
function Gallery({ tracks, x, y, w, h, cols, rows }: { tracks: TrackSummary[]; x: number; y: number; w: number; h: number; cols: number; rows: number }) {
  const gap = 6, cw = (w - gap * (cols + 1)) / cols, ch = (h - gap * (rows + 1)) / rows;
  return (
    <>
      <B x={x} y={y} w={w} h={h} style={{ borderRadius: u(4), background: "#071a33" }} />
      {tracks.slice(0, cols * rows).map((t, i) => (
        <TrackThumb key={t.track_id} track={t} x={x + gap + (i % cols) * (cw + gap)} y={y + gap + Math.floor(i / cols) * (ch + gap)} w={cw} h={ch} />
      ))}
    </>
  );
}

const Empty = ({ x, y, w, h, text, bg = placeholder }: { x: number; y: number; w: number; h: number; text: string; bg?: string }) => (
  <>
    <B x={x} y={y} w={w} h={h} style={{ borderRadius: u(4), background: bg }} />
    <T x={x + w / 2} y={y + h / 2} size={19} color="#cfdcf0" align="center">{text}</T>
  </>
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
    <div data-people={String(people.length)} data-ball={String(balls.length)}>
      <Tile x={1199} y={553} w={391} h={297} title={d.playerDetection} sub={pSub} href={href} section="p03-s04" region={d.playerDetection}>
        {finished && people.length ? <Gallery tracks={people} x={1204} y={635} w={379} h={206} cols={6} rows={3} />
          : <Empty x={1204} y={635} w={379} h={206} text={!finished ? d.noDetections : !tracks ? d.loadingTracks : d.noPeople} />}
      </Tile>
      <Tile x={1608} y={553} w={373} h={297} title={d.ballDetection} sub={bSub} href={href} section="p03-s05" region={d.ballDetection}>
        {finished && balls.length ? <Gallery tracks={balls} x={1613} y={635} w={359} h={206} cols={6} rows={3} />
          : <Empty x={1613} y={635} w={359} h={206} text={!finished ? d.noDetections : !tracks ? d.loadingTracks : d.noBall} bg="linear-gradient(135deg,#2a6a3a,#1d4a2a)" />}
      </Tile>
      <Tile x={1199} y={860} w={391} h={348} title={d.teamIdentification} sub={tSub} href={href} section="p03-s06" region={d.teamIdentification}>
        {finished && groups.length ? (
          <>
            <B x={1206} y={947} w={376} h={243} style={{ borderRadius: u(4), background: "#071a33" }} />
            {groups.slice(0, 5).map((g, i) => {
              const label = g.assignment ? (g.assignment.club_name ?? d.notATeam) : d.kitNotAssigned.replace("{n}", String(g.kit_group));
              return (
                <div key={g.kit_group} data-kit-group={g.kit_group} data-team={g.assignment?.club_id ?? (g.assignment ? "none" : "")}>
                  <B x={1222} y={962 + i * 44} w={34} h={34} style={{ borderRadius: u(6), background: g.kit_rgb ?? "#2a4f80", border: `${u(1.5)} solid #cfe3ff` }} />
                  <T x={1270} y={979 + i * 44} size={19} color={g.assignment?.club_id ? undefined : "#b3c4dc"} style={{ maxWidth: u(175), overflow: "hidden", textOverflow: "ellipsis" }}>{label}</T>
                  <T x={1566} y={979 + i * 44} size={19} color="#b3c4dc" align="right">{d.tracksCount.replace("{n}", g.tracks.toLocaleString(tag))}</T>
                </div>
              );
            })}
            <T x={1222} y={1176} size={15} color="#8ea3bf">{assigned < groups.length ? d.assignTeamsNote : d.teamsAssignedNote}</T>
          </>
        ) : <Empty x={1206} y={947} w={376} h={243} text={finished ? (teams ? d.noKitColours : dict.common.loading) : d.noTeamsYet} />}
      </Tile>
      <Tile x={1608} y={860} w={373} h={348} title={d.eventMarkers} href={events?.state === "READY" ? href : null} section="p03-s07" region={d.eventMarkers}
        sub={!events || events.state === "NONE" ? d.followBallEvents : events.state === "RUNNING" ? d.followingBall : d.eventsFound.replace("{n}", String(eventCount(events)))}>
        <div aria-label={events?.state === "READY" ? d.eventsFoundBall.replace("{n}", String(eventCount(events))) : d.noEventsYet} role="img">
          <B x={1620} y={947} w={352} h={196} style={{ background: "#1f7a36", border: `${u(3)} solid #d7efe0` }} />
          <B x={1795} y={947} w={2} h={196} style={{ background: "#d7efe0" }} />
          {/* the centre circle sits on the halfway line (pitch x 1620..1972, centre 1796; vertical centre 1045) */}
          <B x={1766} y={1015} w={60} h={60} style={{ border: `${u(2)} solid #d7efe0`, borderRadius: "50%" }} />
          {events?.state === "READY" && (
            <B x={1632} y={975} w={328} h={140} style={{ background: "rgba(4,16,34,.72)", borderRadius: u(8), display: "grid", gridTemplateColumns: "1fr 1fr", alignContent: "center",
              gap: `${u(6)} ${u(14)}`, padding: `0 ${u(16)}`, boxSizing: "border-box", fontSize: u(18), color: "#e3eefb" }}>
              {([["#1e90ff", d.eventPasses, events.passes.length], ["#ff2a2a", d.eventShots, events.shots.length], ["#ffc41a", d.eventBallWon, events.changes.length], ["#ff8a1a", d.eventPressures, events.pressures.length],
                ["#d63aff", d.eventSetPieces, events.set_pieces.length]] as const).map(([c, l, n]) => (
                <span key={l} data-event-count={l} style={{ display: "flex", alignItems: "center", gap: u(8), whiteSpace: "nowrap" }}>
                  <i style={{ width: u(12), height: u(12), borderRadius: "50%", background: c, flex: "none" }} /><b>{n}</b> {l}
                </span>
              ))}
            </B>
          )}
          {/* what the engine finds (v3 Phase 0): fouls and offsides are not detected, so they are not in the legend */}
          {([["#1e90ff", d.eventPass, events?.passes.length], ["#ff2a2a", d.eventShot, events?.shots.length], ["#ffc41a", d.eventWon, events?.changes.length], ["#ff8a1a", d.eventPress, events?.pressures.length],
            ["#d63aff", d.eventSet, events?.set_pieces.length]] as const).map(([c, l, n], i) => {
            const lx = [1625, 1693, 1761, 1838, 1902][i]!;
            return (
              <div key={l} title={`${l}: ${events?.state === "READY" ? n ?? 0 : "—"}`}>
                <B x={lx} y={1169} w={14} h={14} style={{ background: c, borderRadius: "50%" }} />
                <T x={lx + 20} y={1176} size={17} color="#cfe3ff">{l}</T>
              </div>
            );
          })}
        </div>
      </Tile>
    </div>
  );
}
