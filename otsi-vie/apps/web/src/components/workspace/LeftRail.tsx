"use client";
/**
 * Page 04 Sections 01-03 — match card, sidebar tabs, Visual Overlays, Team Filter, Time Range, Create Analysis Clip
 * (approved reference 04_ANALYSIS_WORKSPACE, left rail).
 *
 * The match card shows the chosen video's linked match as recorded and what analysis exists; clicking the score lets a person enter the
 * final score (owner 2026-11-02). Overlays the engine supports (boxes, IDs,
 * ball) are display choices applied to the video at once; the rest (tracks, team shapes, pass arrows, heatmaps, offside) are off and
 * disabled with their reason. The team filter offers the linked match's teams with the tracks a person assigned to each. Match halves
 * are not recorded, so those ranges are disabled. Create Analysis Clip needs Clip Studio, which is not built.
 */
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AnalysisRun } from "@otsi-vie/contracts";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { formatDuration } from "@/lib/format";
import { B, T, u } from "@/components/stage/DesignStage";
import { Box, OverlayIcon, Toggle } from "@/components/tactics/kit";
import type { TeamCount } from "@/components/tactics/TacticsHeader";
import { ScoreForm } from "@/components/matches/MatchPanels";
import { clock, Hit, isPerson, plain, type Shared } from "./shared";
import { PitchCalibrationBlock, PitchCalibrationDialog } from "./PitchCalibration";
import { BallBlock, BallMarkDialog } from "./BallMarks";
import { LineupsBlock, LineupsDialog, useLineups } from "./Lineups";
import { NamePlayersDialog } from "./NamePlayers";
import type { Range } from "./Periods";
import { useDw } from "./ResizableColumns";
import { NOT_YET, notBuilt } from "@/lib/devMode";

/** the card's text starts at x 107 and the card ends at x 380 (+ the panel's width change): whatever is longer is cut with an ellipsis, never drawn outside the card */
const fit = (dw: number) => ({ maxWidth: u(268 + dw), overflow: "hidden", textOverflow: "ellipsis" }) as const;

/** Tracks the video again from the saved detections of its finished analysis (no detector run): the current pitch filter, tracking and
 *  team colours are applied. It becomes a new run beside the old one; the old run is kept. */
function RetrackButton({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const ws = s.ws;
  const dw = useDw();
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [seedUs, setSeedUs] = useState<number | null>(null);              // the kickoff moment the person pointed at (null: keep the earlier run's)
  const live = run && (run.status === "QUEUED" || run.status === "RUNNING");
  const videoId = ws?.video?.id, shownRun = ws?.run?.id;
  useEffect(() => {                              // after a refresh: pick up the video's newest run, if it is still working or finished after the one shown
    if (!videoId) return;
    void api<AnalysisRun[]>(`/v1/videos/${videoId}/analysis-runs`).then((all) => {
      const newest = all[0];
      if (newest && (newest.status === "QUEUED" || newest.status === "RUNNING" || (newest.status === "SUCCEEDED" && newest.id !== shownRun))) setRun((cur) => cur ?? newest);
    }, () => undefined);
  }, [videoId, shownRun]);
  useEffect(() => {
    if (!run || !live) return;
    const t = setInterval(() => void api<AnalysisRun>(`/v1/analysis-runs/${run.id}`).then(setRun, () => undefined), 3000);
    return () => clearInterval(t);
  }, [run, live]);
  if (!ws?.video || !ws.run) return <span style={{ color: "#8ea3bf" }}>{dict.body.workspace.trackAgainNeeds}</span>;
  const start = () => {
    setBusy(true); setMsg(null);
    void api<AnalysisRun>(`/v1/videos/${ws.video!.id}/analysis-runs`, { method: "POST", json: { profile: ws.run!.config.profile ?? "STANDARD", retrack_from: ws.run!.id, ...(seedUs !== null ? { team_seed_pts_us: seedUs } : {}) } })
      .then(setRun, (x) => setMsg(x instanceof ApiProblem ? x.message : dict.body.workspace.couldNotStart))
      .finally(() => setBusy(false));
  };
  return (
    <div data-retrack style={{ display: "flex", flexDirection: "column", gap: u(10), maxWidth: u(330 + dw), marginTop: u(14) }}>
      <TeamsAtKickoff run={ws.run} seedUs={seedUs} onTeach={() => { ws.videoRef.current?.pause(); setSeedUs(Math.round((ws.videoRef.current?.currentTime ?? 0) * 1_000_000)); }} onClear={() => setSeedUs(null)} disabled={busy || !!live} />
      <button type="button" disabled={busy || !!live} onClick={start}
        style={{ ...plain, position: "static", minHeight: u(52), padding: `${u(8)} ${u(12)}`, lineHeight: 1.25, border: `${u(1.5)} solid #1f5a9c`, borderRadius: u(8), background: "#0a2a55", color: "#33a8ff", fontSize: u(20), fontWeight: 400, cursor: busy || live ? "default" : "pointer" }}>{dict.body.workspace.trackAgainCurrent}
      </button>
      <span style={{ color: "#8ea3bf", fontSize: u(16) }}>{dict.body.workspace.usesSavedDetections}</span>
      {live && (
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: u(6) }}>
          <div role="progressbar" aria-label={dict.body.workspace.trackingAgain} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(run!.job?.progress ?? 0)}
            style={{ height: u(14), borderRadius: u(7), border: `${u(1.5)} solid #1e90ff`, background: "#04182b", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(2, Math.min(100, run!.job?.progress ?? 0))}%`, height: "100%", background: "linear-gradient(90deg,#14c3ff,#1e90ff)", transition: "width .6s ease-out" }} />
          </div>
          <span style={{ color: "#cfe0f5", fontSize: u(17) }}>{Math.round(run!.job?.progress ?? 0)}% · {(run!.job?.stage_message ?? dict.body.workspace.workingLabel).replace(dict.body.workspace.detectingPeopleBall, dict.body.workspace.trackingSavedDetections)}</span>
        </div>
      )}
      {run?.status === "SUCCEEDED" && (
        <button type="button" data-retrack-done onClick={() => window.location.reload()}
          style={{ ...plain, position: "static", minHeight: u(52), padding: `${u(6)} ${u(10)}`, border: `${u(2)} solid #2ee86a`, borderRadius: u(8), background: "#0a3a1c", color: "#2ee86a", fontSize: u(20), fontWeight: 400, textAlign: "center" }}>{dict.body.workspace.finishedClickTracking}
        </button>
      )}
      {run && (run.status === "FAILED" || run.status === "CANCELLED") && <span role="alert" style={{ color: "#ff8a8a", fontSize: u(17) }}>{run.failure_detail ?? dict.body.workspace.didNotFinish}</span>}
      {msg && <span role="alert" style={{ color: "#ff8a8a", fontSize: u(17) }}>{msg}</span>}
    </div>
  );
}

/** Teaching the two teams from the kickoff: where both teams stand on their own halves, the engine reads the two shirt colours and from then on no box of one
 *  team is ever given to a track of the other. The result of the last run (what it read, or why it could not) is shown from what the engine recorded.
 *  When nobody pointed at a moment the engine looks for the kickoff itself (result.team_seed.auto); the button stays the way to correct it. */
function TeamsAtKickoff({ run, seedUs, onTeach, onClear, disabled }: { run: AnalysisRun | null; seedUs: number | null; onTeach: () => void; onClear: () => void; disabled: boolean }) {
  const { t: dict } = useLocale();
  const seen = (run?.result as { team_seed?: { ok?: boolean; reason?: string; players?: number[]; pts_us?: number; auto?: boolean } | null } | null)?.team_seed ?? null;
  const found = seedUs === null && run?.config.team_seed_pts_us == null && seen?.auto ? seen : null;   // the engine found the moment itself
  const taught = seedUs ?? run?.config.team_seed_pts_us ?? (found?.pts_us ?? null);
  const own = seedUs === null && seen && seen.pts_us === taught;                      // what the engine reported belongs to this moment
  return (
    <div data-teams-kickoff style={{ display: "flex", flexDirection: "column", gap: u(8) }}>
      <span style={{ color: "#cfe0f5", fontSize: u(18), fontWeight: 400 }}>{dict.body.workspace.teamsFromKickoff}</span>
      {taught === null && <span style={{ color: "#8ea3bf", fontSize: u(16) }}>{dict.body.workspace.kickoffPauseHint}</span>}
      {found && !found.ok && <span role="alert" style={{ color: "#ff8a8a", fontSize: u(16) }}>{found.reason ?? dict.body.workspace.kickoffNotFound}</span>}
      {taught !== null && <span style={{ color: seedUs !== null ? "#33a8ff" : "#2ee86a", fontSize: u(16) }}>{seedUs !== null ? dict.body.workspace.teachFromMoment.replace("{a}", formatDuration(seedUs)) : found ? dict.body.workspace.kickoffFoundAt.replace("{a}", formatDuration(taught)) : dict.body.workspace.taughtFrom.replace("{a}", formatDuration(taught))}</span>}
      {own && seen?.ok && <span style={{ color: "#8ea3bf", fontSize: u(16) }}>{dict.body.workspace.readPlayersTeams.replace("{a}", String(seen.players?.[0])).replace("{b}", String(seen.players?.[1]))}</span>}
      {own && seen && !seen.ok && <span role="alert" style={{ color: "#ff8a8a", fontSize: u(16) }}>{seen.reason ?? dict.body.workspace.teamsNotRead}</span>}
      <div style={{ display: "flex", gap: u(8) }}>
        <button type="button" onClick={onTeach} disabled={disabled}
          style={{ ...plain, position: "static", flex: 1, minHeight: u(44), padding: `${u(6)} ${u(10)}`, lineHeight: 1.25, border: `${u(1.5)} solid #1f5a9c`, borderRadius: u(8), background: "#0a2a55", color: "#33a8ff", fontSize: u(17), fontWeight: 400 }}>{dict.body.workspace.useMomentKickoff}
        </button>
        {seedUs !== null && <button type="button" onClick={onClear} style={{ ...plain, position: "static", color: "#8ea3bf", fontSize: u(16) }}>{dict.body.studio.undo}</button>}
      </div>
    </div>
  );
}

function MatchCard({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const { ws, match } = s;
  const video = ws?.video ?? null, tracks = ws?.tracks ?? null;
  const title = match ? dict.body.workspace.matchTitleVs.replace("{a}", match.home?.name ?? "—").replace("{b}", match.away?.name ?? "—") : video ? (video.title ?? video.original_filename ?? dict.body.upload.untitledVideo) : dict.body.workspace.noMatchSelected;
  const sub = match ? [match.competition, match.kickoff_at ? new Date(match.kickoff_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null].filter(Boolean).join(" · ") || "—"
    : video ? dict.body.workspace.notLinkedToMatch : "—";
  const score = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n));
  const finished = !!ws?.run, reading = finished && !tracks;   // the run is known before its track list arrives (several seconds on a long match)
  const people = (tracks ?? []).filter(isPerson).length, balls = (tracks ?? []).filter((t) => t.class_name === "BALL").length;
  const dw = useDw();
  const [scoring, setScoring] = useState(false);
  return (
    <section aria-label={dict.body.analysis.match} data-section="p04-s01">
      <Box x={22} y={118} w={370 + dw} h={382} />
      <T x={47} y={153} size={28} weight={700} as="h2">{dict.body.analysis.match}</T>
      <Hit x={300 + dw} y={133} w={85} h={42} label={dict.body.workspace.chooseMatchVideo} onClick={s.onPick}>
        <T o={[300, 133]} x={318} y={155} size={22} color="#8ea3bf" as="span">···</T>
        <T o={[300, 133]} x={358} y={155} size={24} as="span">⌄</T>
      </Hit>
      <T x={47} y={197} size={22} weight={700} style={{ maxWidth: u(320 + dw), overflow: "hidden", textOverflow: "ellipsis" }}>{title}</T>
      <T x={47} y={227} size={20} color="#cfdcf0" style={{ maxWidth: u(320 + dw), overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</T>
      <B x={47} y={262} w={48} h={46} style={{ borderRadius: "50%", background: "#7ab6ff" }} />
      <T x={112} y={285} size={23} weight={700} style={{ maxWidth: u(220 + dw), overflow: "hidden", textOverflow: "ellipsis" }}>{match?.home?.name ?? dict.body.workspace.homeTeam}</T>
      <T x={350 + dw} y={283} size={32} weight={700}>{score(match?.home_score)}</T>
      <B x={47} y={324} w={48} h={54} style={{ borderRadius: "50%", background: "#e8d9a0" }} />
      <T x={112} y={351} size={23} weight={700} style={{ maxWidth: u(220 + dw), overflow: "hidden", textOverflow: "ellipsis" }}>{match?.away?.name ?? dict.body.workspace.awayTeam}</T>
      <T x={350 + dw} y={350} size={32} weight={700}>{score(match?.away_score)}</T>
      <Hit x={325 + dw} y={258} w={62} h={124} label={match?.home_score === null ? dict.body.workspace.setFinalScore : dict.body.workspace.changeFinalScore}
        {...(match && ws?.canWrite ? { onClick: () => setScoring(true) } : { reason: match ? dict.body.workspace.cannotEditMatch : dict.body.workspace.linkVideoToMatchFirst })} />
      {match && (
        <Dialog.Root open={scoring} onOpenChange={setScoring}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(460px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 shadow-2xl">
              <Dialog.Title className="mb-2 text-base font-normal">{dict.body.workspace.finalScore}</Dialog.Title>
              <Dialog.Description className="sr-only">{dict.body.workspace.enterGoals}</Dialog.Description>
              <ScoreForm match={match} onSaved={(m) => { s.setMatch(m); setScoring(false); }} onCancel={() => setScoring(false)} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      <B x={37} y={396} w={343 + dw} h={98} style={{ border: `${u(1.5)} solid #1f8a5a`, borderRadius: u(8), background: "#0a2a2a" }} />
      <B x={55} y={412} w={36} h={38} style={{ background: "#2a4a78", borderRadius: u(8) }} />
      <T x={107} y={423} size={21} weight={700} color="#cfe0f5">{finished ? dict.body.workspace.trackingAvailable : dict.body.workspace.noAnalysisAvailable}</T>
      <T x={107} y={447} size={17} color="#8ea3bf" style={fit(dw)}>{reading ? dict.body.workspace.readingTracks : finished ? dict.body.workspace.peopleBallTracksCard.replace("{a}", String(people)).replace("{b}", String(balls)) : dict.body.workspace.trackingDataModels}</T>
      <T x={107} y={468} size={17} color="#8ea3bf" style={fit(dw)}>{finished ? (ws?.events.data?.ball_track_id ? dict.body.workspace.eventsFoundSummary.replace("{a}", String(ws.events.data.passes.length)).replace("{b}", String(ws.events.data.changes.length)).replace("{c}", String(ws.events.data.shots.length)).replace("{d}", String(ws.events.data.pressures.length)) : dict.body.workspace.eventsFoundBall) : dict.body.workspace.appearAfterProcessing}</T>
    </section>
  );
}

function Radio({ y, label, selected, count, reason, onSelect }: { y: number; label: string; selected: boolean; count: string; reason?: string; onSelect?: () => void }) {
  const off = !selected && !onSelect;
  const dw = useDw();
  return (
    <div role="radio" aria-checked={selected} aria-disabled={off} aria-label={`${label}, ${count}`} title={off ? reason : undefined} tabIndex={onSelect && !selected ? 0 : -1}
      onClick={onSelect && !selected ? onSelect : undefined}
      onKeyDown={(e) => { if (onSelect && !selected && (e.key === " " || e.key === "Enter")) { e.preventDefault(); onSelect(); } }}
      className="absolute" style={{ left: u(38), top: u(y - 20 - 101), width: u(338 + dw), height: u(40), cursor: off ? "not-allowed" : selected ? "default" : "pointer" }}>
      <B o={[38, y - 20]} x={50} y={y - 11} w={22} h={22} style={selected ? { borderRadius: "50%", background: "#1e90ff" } : { borderRadius: "50%", border: `${u(2)} solid #7fa4d4`, opacity: off ? 0.6 : 1 }} />
      <T o={[38, y - 20]} x={96} y={y} size={21} color={off ? "#8ea3bf" : undefined} style={{ maxWidth: u(210 + dw), overflow: "hidden", textOverflow: "ellipsis" }}>{label}</T>
      <B o={[38, y - 20]} x={326 + dw} y={y - 14} w={42} h={28} style={{ border: `${u(1.5)} solid #4a6a96`, borderRadius: u(5), fontSize: u(17), display: "flex", alignItems: "center", justifyContent: "center" }}>{count}</B>
    </div>
  );
}

function Filters({ s, dy }: { s: Shared; dy: number }) {
  const { t: dict } = useLocale();
  const { ws, match, team, setTeam, teams } = s;
  const dw = useDw();
  const finished = !!ws?.run;
  const people = finished && ws?.tracks ? String(ws.tracks.filter(isPerson).length) : finished ? "…" : "—";
  const rows: [number, string, TeamCount | null][] = [[1044 + dy, dict.body.workspace.homeTeam, teams[0]], [1084 + dy, dict.body.workspace.awayTeam, teams[1]]];
  const reason = !match ? dict.body.workspace.linkVideoFirstUpload : dict.body.workspace.assignTeamKitFirst;
  const selY = team === "all" ? 1000 + dy : rows.find((r) => r[2]?.club_id === team)?.[0] ?? 1000 + dy;
  return (
    <>
      <T x={48} y={957 + dy} size={22} weight={700} as="h3">{dict.body.analysis.teamFilter}</T>
      <B x={38} y={selY - 20} w={338 + dw} h={40} style={{ border: `${u(1.5)} solid #1e90ff`, borderRadius: u(6), background: "#0d3a78" }} />
      <div role="radiogroup" aria-label={dict.body.tactics.teamFilterLower}>
        <Radio y={1000 + dy} label={dict.body.workspace.allPlayers} selected={team === "all"} count={people} onSelect={() => setTeam("all")} />
        {rows.map(([y, fallback, t]) => (
          <Radio key={y} y={y} label={t?.name ?? fallback} selected={!!t && team === t.club_id} count={t && finished ? String(t.tracks) : "—"} reason={reason}
            {...(t && t.tracks > 0 ? { onSelect: () => setTeam(t.club_id) } : {})} />
        ))}
      </div>
      <T x={48} y={1134 + dy} size={22} weight={700} as="h3">{dict.body.analysis.timeRange}</T>
      <B x={38} y={1157 + dy} w={338 + dw} h={36} style={{ border: `${u(1.5)} solid #1e90ff`, borderRadius: u(6), background: "#0d3a78" }} />
      <TimeRange s={s} dy={dy} />
    </>
  );
}

export function LeftRail({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const [side, setSide] = useState(0);
  const NOT_BUILT = notBuilt(dict.body.workspace.needsPitchEvents);
  const OVERLAYS: [string, number, "boxes" | "labels" | "ball" | null, string][] = [[dict.body.workspace.playerBoxes, 643, "boxes", "box"], [dict.body.workspace.playerIds, 681, "labels", "ids"],
    [dict.body.workspace.playerTracks, 718, null, "trk"], [dict.body.workspace.teamShapes, 756, null, "shp"], [dict.body.workspace.ballTracking, 794, "ball", "ball"], [dict.body.workspace.passArrows, 832, null, "pass"],
    [dict.body.workspace.heatmapsLive, 870, null, "layers"], [dict.body.workspace.offsideLine, 907, null, "shp"]];
  const SIDE: [string, number, number][] = [[dict.body.workspace.viewLabel, 42, 73], [dict.body.workspace.metricEvents, 121, 80], [dict.body.workspace.filters, 212, 80], [dict.body.workspace.aiTools, 301, 90]];
  const [calOpen, setCalOpen] = useState(false);
  const [ballOpen, setBallOpen] = useState(false);
  const [lineupsOpen, setLineupsOpen] = useState(false);
  const [namingOpen, setNamingOpen] = useState(false);
  // ?find=<player>: the Reel Builder's "Find more of him" opens his look-alikes at once (ADR-045)
  const sp = useSearchParams();
  const find = sp.get("find");   // ?find=<player>: the Reel Builder's "Find more of him": "Is this him?" for that player (ADR-046)
  const { ws } = s;
  const lineups = useLineups(ws?.video?.id);
  useEffect(() => { if (find && ws?.video) setNamingOpen(true); }, [find, ws?.video?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const layers = ws?.layers;
  const dw = useDw();
  return (
    <>
      <MatchCard s={s} />
      <section aria-label={dict.body.workspace.overlaysFilters} data-section="p04-s02">
        <B x={22} y={510} w={370 + dw} h={52} style={{ borderBottom: "1px solid #17355f" }} />
        <div role="tablist" aria-label={dict.body.workspace.sidebar}>
          {SIDE.map(([l, x, w], i) => (
            <Hit key={l} x={x - 18} y={513} w={w} h={46} label={l} onClick={() => setSide(i)} style={{ cursor: "pointer" }}>
              <T o={[x - 18, 513]} x={x} y={535} size={i === 0 ? 22 : 21} weight={side === i ? 700 : 400} color={side === i ? "#33a8ff" : undefined} as="span">{l}</T>
            </Hit>
          ))}
        </div>
        <B x={SIDE[side]![1] - 18} y={558} w={SIDE[side]![2]} h={3} style={{ background: "#1e90ff" }} />

        {side === 0 && (
          <>
            <T x={48} y={599} size={22} weight={700} as="h3">{dict.body.analysis.visualOverlays}</T>
            {OVERLAYS.map(([n, y, key, icon]) => (
              <div key={n}>
                <OverlayIcon x={48} y={y - 12} k={icon} on={!!key && !!layers?.[key]} />
                <T x={96} y={y} size={21} color={key ? "#cfdcf0" : "#8ea3bf"}>{n}</T>
                <Toggle x={313 + dw} y={y - 13} label={n} on={key && layers ? layers[key] : false} reason={NOT_BUILT}
                  {...(key && ws ? { onChange: (on: boolean) => ws.setLayers({ ...ws.layers, [key]: on }) } : {})} />
              </div>
            ))}
          </>
        )}
        {side === 0 && <Filters s={s} dy={0} />}
        {side === 2 && <Filters s={s} dy={-358} />}
        {side === 1 && <T x={48} y={599} size={20} color="#8ea3bf">Event detection is {NOT_YET}; no events to filter.</T>}
        {side === 3 && (
          <nav aria-label={dict.body.workspace.toolsForVideo} className="absolute" style={{ left: u(40), top: u(588 - 101), width: u(350 + dw), maxHeight: u(740), overflowY: "auto", overflowX: "hidden", paddingLeft: u(8), paddingRight: u(10), display: "flex", flexDirection: "column", gap: u(14), fontSize: u(20), scrollbarWidth: "thin" }}>
            {ws?.video ? (
              <>
                <Link href={`/videos/${ws.video.id}/analyze`} style={{ color: "#33a8ff" }} data-pro>{dict.body.workspace.reviewIdentitiesTeams}</Link>
                <button type="button" onClick={() => setNamingOpen(true)} style={{ color: "#33a8ff", textAlign: "left" }}>{dict.body.workspace.isThisHimReel}</button>
                <Link href={`/processing?video=${ws.video.id}`} style={{ color: "#33a8ff" }}>{dict.body.workspace.processingArrow}</Link>
                <Link href={`/tactics?video=${ws.video.id}`} style={{ color: "#33a8ff" }}>{dict.body.workspace.tacticalArrow}</Link>
                <div data-pro style={{ display: "contents" }}>
                  <RetrackButton s={s} />
                  <PitchCalibrationBlock videoId={ws.video.id} list={ws.pitch.list} camera={ws.pitch.camera} reload={ws.pitch.reload} canWrite={ws.canWrite} onStart={() => setCalOpen(true)} />
                  <BallBlock ball={ws.ball} canWrite={ws.canWrite} onMark={() => setBallOpen(true)} />
                </div>
                <LineupsBlock videoId={ws.video.id} canWrite={ws.canWrite} onReview={() => setLineupsOpen(true)} onName={() => setNamingOpen(true)} lineups={lineups} />
              </>
            ) : <span style={{ color: "#8ea3bf" }}>{dict.body.analysis.chooseVideo}</span>}
          </nav>
        )}
      </section>
      {ws?.video && <NamePlayersDialog open={namingOpen} onOpenChange={setNamingOpen} player={find} />}
      {ws?.video && <LineupsDialog open={lineupsOpen} onOpenChange={setLineupsOpen} videoId={ws.video.id} lineups={lineups} onApplied={() => void ws.reloadVideo()} />}
      {ws?.video && <BallMarkDialog open={ballOpen} onOpenChange={setBallOpen} videoId={ws.video.id} videoRef={ws.videoRef} stepUs={ws.intervalUs} ball={ws.ball} />}
      {ws?.video && <PitchCalibrationDialog open={calOpen} onOpenChange={setCalOpen} videoId={ws.video.id} videoRef={ws.videoRef} onStarted={() => void ws.pitch.reload()} others={ws.pitch.list} />}
      <section aria-label={dict.body.workspace.createAnalysisClipLower} data-section="p04-s03">
        <button type="button" disabled title={notBuilt(dict.body.workspace.analysisClipFromView)} aria-label={dict.body.workspace.createAnalysisClip}
          style={{ ...plain, left: u(22), top: u(1349 - 101), width: u(370 + dw), height: u(69), border: `${u(1.5)} solid #1f5a9c`, borderRadius: u(8), background: "#0a2a55", cursor: "not-allowed", opacity: 0.75 }}>
          <T o={[22, 1349]} x={76} y={1383} size={26} color="#8fc4ff" as="span">✂</T>
          <T o={[22, 1349]} x={124} y={1383} size={22} weight={700} color="#33a8ff" as="span">{dict.body.workspace.createAnalysisClip}</T>
        </button>
      </section>
    </>
  );
}

/** Time Range (approved design): the halves of match time, proposed by the engine or confirmed by a person (migration 0030). */
function TimeRange({ s, dy }: { s: Shared; dy: number }) {
  const { t: dict } = useLocale();
  const ws = s.ws, per = ws?.periods;
  const [err, setErr] = useState<string | null>(null);
  const sh = per?.shown;
  const opts: [Range, string, number, boolean, string | undefined][] = [
    ["FULL", dict.body.workspace.fullMatch, 1176, true, undefined],
    ["FIRST", dict.body.workspace.firstHalf, 1213, !!sh?.first, sh?.first ? `${clock(sh.first.start_us)}–${clock(sh.first.end_us)}` : undefined],
    ["SECOND", dict.body.workspace.secondHalf, 1249, !!sh?.second, sh?.second ? `${clock(sh.second.start_us)}–${clock(sh.second.end_us)}` : undefined]];
  const pick = (r: Range) => { per?.setRange(r); const p = r === "FIRST" ? sh?.first : r === "SECOND" ? sh?.second : null; if (p && ws) ws.seek(p.start_us); };
  const state = !per?.data ? "" : per.data.state === "NONE" ? dict.body.workspace.matchTimeNeeds : per.dirty ? dict.body.workspace.matchTimeChanged
    : per.data.state === "CONFIRMED" ? dict.body.workspace.matchTimeConfirmed : dict.body.workspace.matchTimeFound;
  return (
    <div role="radiogroup" aria-label={dict.body.tactics.timeRangeLower} data-time-range={per?.range ?? "FULL"}>
      {opts.map(([r, l, y, ok, span]) => {
        const sel = (per?.range ?? "FULL") === r;
        return (
          <Hit key={r} x={40} y={y + dy - 16} w={334} h={32} label={l} pressed={sel} {...(ok ? { onClick: () => pick(r) } : { reason: dict.body.workspace.matchTimeNotKnown })}>
            <B o={[40, y + dy - 16]} x={51} y={y + dy - 11} w={22} h={22} style={sel ? { borderRadius: "50%", border: `${u(6)} solid #1e90ff`, background: "#fff" } : { borderRadius: "50%", border: `${u(2)} solid #7fa4d4`, opacity: ok ? 1 : 0.6 }} />
            <T o={[40, y + dy - 16]} x={97} y={y + dy} size={21} color={ok ? undefined : "#8ea3bf"} as="span">{l}</T>
            {span && <T o={[40, y + dy - 16]} x={230} y={y + dy} size={16} color="#8ea3bf" as="span">{span}</T>}
          </Hit>
        );
      })}
      <div title={notBuilt()} aria-disabled>
        <B x={51} y={1284 + dy - 11} w={22} h={22} style={{ borderRadius: "50%", border: `${u(2)} solid #7fa4d4`, opacity: 0.6 }} />
        <T x={97} y={1284 + dy} size={21} color="#8ea3bf">{dict.body.workspace.customRange}</T>
      </div>
      {state && <T x={48} y={1318 + dy} size={15} color={per?.data?.state === "CONFIRMED" && !per.dirty ? "#2ee86a" : "#ffd400"} data-periods-state>{state}</T>}
      {ws?.canWrite && per?.data && per.data.state !== "NONE" && (per.dirty || per.data.state === "PROPOSED") && (
        <Hit x={270} y={1305 + dy} w={100} h={28} label={dict.body.workspace.confirmMatchTime} onClick={() => void per.confirm().then(setErr)}
          style={{ border: `${u(1.5)} solid #1f8cff`, borderRadius: u(6), background: "#0a4aa8", color: "#fff", fontSize: u(16), fontWeight: 400 }}>{dict.body.players.confirm}</Hit>
      )}
      {err && <T x={48} y={1340 + dy} size={14} color="#ff8a8a">{err}</T>}
    </div>
  );
}
