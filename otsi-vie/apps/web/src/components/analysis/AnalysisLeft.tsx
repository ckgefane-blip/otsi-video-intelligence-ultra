"use client";
/**
 * Page 04 left rail, in flow (Desktop UI Drop 2): the match card, the sidebar tabs, the visual overlays, the team filter, the
 * time range, and the AI tools. The overlays are the Drop 1 OverlayToggles (the viewer's shared preference); the team filter
 * offers the linked match's teams with the tracks a person assigned to each; the time range is the halves of match time
 * (proposed by the engine or confirmed by a person). The AI tools keep every working control: track again (Retrack, from the
 * saved detections), pitch calibration marking (the dialog, with "Find the pitch automatically"), ball marking, lineups, and
 * naming players. "Create Analysis Clip" needs Clip Studio, which is not built, so it stays disabled and says so.
 *
 * The reused blocks (PitchCalibrationBlock, BallBlock, LineupsBlock) still size themselves in design pixels (u()); the rail
 * sets --u: 1px so those resolve to real pixels in this flow layout.
 */
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import type { AnalysisRun } from "@otsi-vie/contracts";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { formatDuration } from "@/lib/format";
import { OverlayToggles } from "@/components/media/OverlayToggles";
import { ScoreForm } from "@/components/matches/MatchPanels";
import { clock, isPerson, type Shared } from "@/components/workspace/shared";
import { PitchCalibrationBlock, PitchCalibrationDialog } from "@/components/workspace/PitchCalibration";
import { BallBlock, BallMarkDialog } from "@/components/workspace/BallMarks";
import { LineupsBlock, LineupsDialog, useLineups } from "@/components/workspace/Lineups";
import { NamePlayersDialog } from "@/components/workspace/NamePlayers";
import type { Range } from "@/components/workspace/Periods";
import { allMarks, marksOf } from "@/components/workspace/TimelinePanel";
import { eventsLine } from "@/components/workspace/Events";
import { notBuilt } from "@/lib/devMode";
import type { TeamCount } from "@/components/tactics/TacticsHeader";

/** Tracks the video again from the saved detections of its finished analysis (no detector run): the current pitch filter, tracking and
 *  team colours are applied. It becomes a new run beside the old one; the old run is kept. */
function RetrackButton({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const ws = s.ws;
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [seedUs, setSeedUs] = useState<number | null>(null);
  const live = run && (run.status === "QUEUED" || run.status === "RUNNING");
  const videoId = ws?.video?.id, shownRun = ws?.run?.id;
  useEffect(() => {
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
  if (!ws?.video || !ws.run) return <span className="text-sm text-muted">{dict.body.workspace.trackAgainNeeds}</span>;
  const start = () => {
    setBusy(true); setMsg(null);
    void api<AnalysisRun>(`/v1/videos/${ws.video!.id}/analysis-runs`, { method: "POST", json: { profile: ws.run!.config.profile ?? "STANDARD", retrack_from: ws.run!.id, ...(seedUs !== null ? { team_seed_pts_us: seedUs } : {}) } })
      .then(setRun, (x) => setMsg(x instanceof ApiProblem ? x.message : dict.body.workspace.couldNotStart))
      .finally(() => setBusy(false));
  };
  return (
    <div data-retrack className="flex flex-col gap-2">
      <TeamsAtKickoff run={ws.run} seedUs={seedUs} onTeach={() => { ws.videoRef.current?.pause(); setSeedUs(Math.round((ws.videoRef.current?.currentTime ?? 0) * 1_000_000)); }} onClear={() => setSeedUs(null)} disabled={busy || !!live} />
      <button type="button" disabled={busy || !!live} onClick={start}
        className="rounded-md border border-[#1f5a9c] bg-[#0a2a55] px-3 py-2 text-sm font-semibold text-[#33a8ff] disabled:opacity-50">{dict.body.workspace.trackAgainCurrent}</button>
      <span className="text-xs text-muted">{dict.body.workspace.usesSavedDetections}</span>
      {live && (
        <div role="status" className="flex flex-col gap-1">
          <div role="progressbar" aria-label={dict.body.workspace.trackingAgain} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(run!.job?.progress ?? 0)}
            className="h-3 overflow-hidden rounded-full border border-[#1e90ff] bg-[#04182b]">
            <div className="h-full bg-gradient-to-r from-[#14c3ff] to-[#1e90ff] transition-[width] duration-500" style={{ width: `${Math.max(2, Math.min(100, run!.job?.progress ?? 0))}%` }} />
          </div>
          <span className="text-xs text-[#cfe0f5]">{Math.round(run!.job?.progress ?? 0)}% · {(run!.job?.stage_message ?? dict.body.workspace.workingLabel).replace(dict.body.workspace.detectingPeopleBall, dict.body.workspace.trackingSavedDetections)}</span>
        </div>
      )}
      {run?.status === "SUCCEEDED" && (
        <button type="button" data-retrack-done onClick={() => window.location.reload()}
          className="rounded-md border-2 border-[#2ee86a] bg-[#0a3a1c] px-3 py-2 text-sm font-semibold text-[#2ee86a]">{dict.body.workspace.finishedClickTracking}</button>
      )}
      {run && (run.status === "FAILED" || run.status === "CANCELLED") && <span role="alert" className="text-xs text-[#ff8a8a]">{run.failure_detail ?? dict.body.workspace.didNotFinish}</span>}
      {msg && <span role="alert" className="text-xs text-[#ff8a8a]">{msg}</span>}
    </div>
  );
}

/** Teaching the two teams from the kickoff: where both teams stand on their own halves, the engine reads the two shirt colours and from then on no box of one
 *  team is ever given to a track of the other. */
function TeamsAtKickoff({ run, seedUs, onTeach, onClear, disabled }: { run: AnalysisRun | null; seedUs: number | null; onTeach: () => void; onClear: () => void; disabled: boolean }) {
  const { t: dict } = useLocale();
  const seen = (run?.result as { team_seed?: { ok?: boolean; reason?: string; players?: number[]; pts_us?: number; auto?: boolean } | null } | null)?.team_seed ?? null;
  const found = seedUs === null && run?.config.team_seed_pts_us == null && seen?.auto ? seen : null;
  const taught = seedUs ?? run?.config.team_seed_pts_us ?? (found?.pts_us ?? null);
  const own = seedUs === null && seen && seen.pts_us === taught;
  return (
    <div data-teams-kickoff className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-[#cfe0f5]">{dict.body.workspace.teamsFromKickoff}</span>
      {taught === null && <span className="text-xs text-muted">{dict.body.workspace.kickoffPauseHint}</span>}
      {found && !found.ok && <span role="alert" className="text-xs text-[#ff8a8a]">{found.reason ?? dict.body.workspace.kickoffNotFound}</span>}
      {taught !== null && <span className="text-xs" style={{ color: seedUs !== null ? "#33a8ff" : "#2ee86a" }}>{seedUs !== null ? dict.body.workspace.teachFromMoment.replace("{a}", formatDuration(seedUs)) : found ? dict.body.workspace.kickoffFoundAt.replace("{a}", formatDuration(taught)) : dict.body.workspace.taughtFrom.replace("{a}", formatDuration(taught))}</span>}
      {own && seen?.ok && <span className="text-xs text-muted">{dict.body.workspace.readPlayersTeams.replace("{a}", String(seen.players?.[0])).replace("{b}", String(seen.players?.[1]))}</span>}
      {own && seen && !seen.ok && <span role="alert" className="text-xs text-[#ff8a8a]">{seen.reason ?? dict.body.workspace.teamsNotRead}</span>}
      <div className="flex gap-2">
        <button type="button" onClick={onTeach} disabled={disabled}
          className="flex-1 rounded-md border border-[#1f5a9c] bg-[#0a2a55] px-3 py-2 text-sm font-semibold text-[#33a8ff] disabled:opacity-50">{dict.body.workspace.useMomentKickoff}</button>
        {seedUs !== null && <button type="button" onClick={onClear} className="text-sm text-muted">{dict.body.studio.undo}</button>}
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
  const finished = !!ws?.run, reading = finished && !tracks;
  const people = (tracks ?? []).filter(isPerson).length, balls = (tracks ?? []).filter((t) => t.class_name === "BALL").length;
  const [scoring, setScoring] = useState(false);
  return (
    <section aria-label={dict.body.analysis.match} data-section="p04-s01" className="vie-panel">
      <div className="vie-ph"><h2 className="t-panel">{dict.body.analysis.match}</h2>
        <button type="button" onClick={s.onPick} aria-label={dict.body.workspace.chooseMatchVideo} className="vie-ib" title={dict.body.workspace.chooseMatchVideo}>··· ⌄</button>
      </div>
      <div className="flex flex-col gap-2 p-3 text-sm">
        <p className="truncate font-semibold">{title}</p>
        <p className="truncate text-xs text-muted">{sub}</p>
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-10 w-10 shrink-0 rounded-full bg-[#7ab6ff]" />
          <span className="min-w-0 flex-1 truncate font-semibold">{match?.home?.name ?? dict.body.workspace.homeTeam}</span>
          <span className="t-metric">{score(match?.home_score)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-10 w-10 shrink-0 rounded-full bg-[#e8d9a0]" />
          <span className="min-w-0 flex-1 truncate font-semibold">{match?.away?.name ?? dict.body.workspace.awayTeam}</span>
          <span className="t-metric">{score(match?.away_score)}</span>
        </div>
        <button type="button" disabled={!match || !ws?.canWrite} title={match ? (match.home_score === null ? dict.body.workspace.setFinalScore : dict.body.workspace.changeFinalScore) : dict.body.workspace.linkVideoToMatchFirst}
          onClick={() => setScoring(true)} className="self-start rounded border border-line px-2 py-1 text-xs text-primary disabled:opacity-50">
          {dict.body.workspace.finalScore}
        </button>
        {match && (
          <Dialog.Root open={scoring} onOpenChange={setScoring}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(460px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 shadow-2xl">
                <Dialog.Title className="mb-2 t-panel">{dict.body.workspace.finalScore}</Dialog.Title>
                <Dialog.Description className="sr-only">{dict.body.workspace.enterGoals}</Dialog.Description>
                <ScoreForm match={match} onSaved={(m) => { s.setMatch(m); setScoring(false); }} onCancel={() => setScoring(false)} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
        <div className="rounded-md border border-[#1f8a5a] bg-[#0a2a2a] p-2 text-xs">
          <p className="font-semibold text-[#cfe0f5]">{finished ? dict.body.workspace.trackingAvailable : dict.body.workspace.noAnalysisAvailable}</p>
          <p className="text-muted">{reading ? dict.body.workspace.readingTracks : finished ? dict.body.workspace.peopleBallTracksCard.replace("{a}", String(people)).replace("{b}", String(balls)) : dict.body.workspace.trackingDataModels}</p>
          <p className="text-muted">{finished ? (ws?.events.data?.ball_track_id ? dict.body.workspace.eventsFoundSummary.replace("{a}", String(ws.events.data.passes.length)).replace("{b}", String(ws.events.data.changes.length)).replace("{c}", String(ws.events.data.shots.length)).replace("{d}", String(ws.events.data.pressures.length)) : dict.body.workspace.eventsFoundBall) : dict.body.workspace.appearAfterProcessing}</p>
        </div>
      </div>
    </section>
  );
}

function TeamFilter({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const { ws, match, team, setTeam, teams } = s;
  const finished = !!ws?.run;
  const people = finished && ws?.tracks ? String(ws.tracks.filter(isPerson).length) : finished ? "…" : "—";
  const rows: [string, TeamCount | null][] = [[dict.body.workspace.homeTeam, teams[0]], [dict.body.workspace.awayTeam, teams[1]]];
  const reason = !match ? dict.body.workspace.linkVideoFirstUpload : dict.body.workspace.assignTeamKitFirst;
  const radio = "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm";
  return (
    <div className="flex flex-col gap-2">
      <h3 className="t-panel">{dict.body.analysis.teamFilter}</h3>
      <div role="radiogroup" aria-label={dict.body.tactics.teamFilterLower} className="flex flex-col gap-1">
        <button type="button" role="radio" aria-checked={team === "all"} onClick={() => setTeam("all")}
          className={`${radio} ${team === "all" ? "border-primary bg-primary/10" : "border-line"}`}>
          <span aria-hidden className={`h-4 w-4 rounded-full border-2 ${team === "all" ? "border-primary bg-primary" : "border-line2"}`} />
          <span className="flex-1">{dict.body.workspace.allPlayers}</span><span className="rounded border border-line px-1.5 text-xs">{people}</span>
        </button>
        {rows.map(([fallback, t]) => {
          const usable = !!t && t.tracks > 0;
          const selected = !!t && team === t.club_id;
          return (
            <button key={fallback} type="button" role="radio" aria-checked={selected} aria-disabled={!usable} title={usable ? undefined : reason}
              disabled={!usable} onClick={() => usable && setTeam(t!.club_id)}
              className={`${radio} ${selected ? "border-primary bg-primary/10" : "border-line"} disabled:opacity-60`}>
              <span aria-hidden className={`h-4 w-4 rounded-full border-2 ${selected ? "border-primary bg-primary" : "border-line2"}`} />
              <span className="flex-1 truncate">{t?.name ?? fallback}</span>
              <span className="rounded border border-line px-1.5 text-xs">{t && finished ? String(t.tracks) : "—"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Time Range: the halves of match time, proposed by the engine or confirmed by a person (migration 0030). */
function TimeRange({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const ws = s.ws, per = ws?.periods;
  const [err, setErr] = useState<string | null>(null);
  const sh = per?.shown;
  const opts: [Range, string, boolean, string | undefined][] = [
    ["FULL", dict.body.workspace.fullMatch, true, undefined],
    ["FIRST", dict.body.workspace.firstHalf, !!sh?.first, sh?.first ? `${clock(sh.first.start_us)}–${clock(sh.first.end_us)}` : undefined],
    ["SECOND", dict.body.workspace.secondHalf, !!sh?.second, sh?.second ? `${clock(sh.second.start_us)}–${clock(sh.second.end_us)}` : undefined]];
  const pick = (r: Range) => { per?.setRange(r); const p = r === "FIRST" ? sh?.first : r === "SECOND" ? sh?.second : null; if (p && ws) ws.seek(p.start_us); };
  const state = !per?.data ? "" : per.data.state === "NONE" ? dict.body.workspace.matchTimeNeeds : per.dirty ? dict.body.workspace.matchTimeChanged
    : per.data.state === "CONFIRMED" ? dict.body.workspace.matchTimeConfirmed : dict.body.workspace.matchTimeFound;
  return (
    <div className="flex flex-col gap-2" data-time-range={per?.range ?? "FULL"}>
      <h3 className="t-panel">{dict.body.analysis.timeRange}</h3>
      <div role="radiogroup" aria-label={dict.body.tactics.timeRangeLower} className="flex flex-col gap-1">
        {opts.map(([r, l, ok, span]) => {
          const sel = (per?.range ?? "FULL") === r;
          return (
            <button key={r} type="button" role="radio" aria-checked={sel} aria-disabled={!ok} title={ok ? undefined : dict.body.workspace.matchTimeNotKnown}
              disabled={!ok} onClick={() => pick(r)}
              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm disabled:opacity-60 ${sel ? "border-primary bg-primary/10" : "border-line"}`}>
              <span aria-hidden className={`h-4 w-4 rounded-full border-2 ${sel ? "border-primary bg-primary" : "border-line2"}`} />
              <span className="flex-1">{l}</span>{span && <span className="text-xs text-muted">{span}</span>}
            </button>
          );
        })}
        <div title={notBuilt()} aria-disabled className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted">
          <span aria-hidden className="h-4 w-4 rounded-full border-2 border-line2 opacity-60" />
          {dict.body.workspace.customRange}
        </div>
      </div>
      {state && <p className={`text-xs ${per?.data?.state === "CONFIRMED" && !per.dirty ? "text-[#2ee86a]" : "text-[#ffd400]"}`} data-periods-state>{state}</p>}
      {ws?.canWrite && per?.data && per.data.state !== "NONE" && (per.dirty || per.data.state === "PROPOSED") && (
        <button type="button" onClick={() => void per.confirm().then(setErr)}
          className="self-start rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-semibold text-white">{dict.body.workspace.confirmMatchTime}</button>
      )}
      {err && <p className="text-xs text-[#ff8a8a]">{err}</p>}
    </div>
  );
}

function MetricsTab({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const ws = s.ws;
  const marks = marksOf(ws?.events.data ?? null, dict);
  const all = allMarks(marks);
  if (!ws?.run) return <p className="text-sm text-muted">{dict.body.workspace.noAnalysisAvailable}</p>;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted">{eventsLine(ws.events.data, dict)}</p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
        {(Object.keys(marks) as (keyof typeof marks)[]).map((k) => (
          <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="text-right font-semibold">{marks[k].length}</dd></div>
        ))}
        <div className="contents"><dt className="font-semibold">{dict.body.analysis.allEvents}</dt><dd className="text-right font-semibold">{all.length}</dd></div>
      </dl>
    </div>
  );
}

export function AnalysisLeft({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const [side, setSide] = useState(0);
  const SIDE = [dict.body.workspace.viewLabel, dict.body.workspace.metricEvents, dict.body.workspace.filters, dict.body.workspace.aiTools];
  const [calOpen, setCalOpen] = useState(false);
  const [ballOpen, setBallOpen] = useState(false);
  const [lineupsOpen, setLineupsOpen] = useState(false);
  const [namingOpen, setNamingOpen] = useState(false);
  // ?find=<player>: the Reel Builder's "Find more of him" opens his look-alikes at once (ADR-045/046)
  const sp = useSearchParams();
  const find = sp.get("find");
  const { ws } = s;
  const lineups = useLineups(ws?.video?.id);
  useEffect(() => { if (find && ws?.video) setNamingOpen(true); }, [find, ws?.video?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex min-w-0 flex-col gap-4" style={{ "--u": "1px" } as CSSProperties}>
      <MatchCard s={s} />
      <section aria-label={dict.body.workspace.overlaysFilters} data-section="p04-s02" className="vie-panel">
        <div role="tablist" aria-label={dict.body.workspace.sidebar} className="flex flex-wrap gap-1 border-b border-line px-2 pt-1">
          {SIDE.map((l, i) => (
            <button key={l} type="button" role="tab" aria-selected={side === i} onClick={() => setSide(i)}
              className={`border-b-2 px-2 py-2 text-sm ${side === i ? "border-primary font-semibold text-primary" : "border-transparent text-muted hover:text-ink"}`}>{l}</button>
          ))}
        </div>
        <div className="flex flex-col gap-4 p-3">
          {side === 0 && (
            <>
              <OverlayToggles />
              <TeamFilter s={s} />
              <TimeRange s={s} />
            </>
          )}
          {side === 1 && <MetricsTab s={s} />}
          {side === 2 && (
            <>
              <TeamFilter s={s} />
              <TimeRange s={s} />
            </>
          )}
          {side === 3 && (
            <nav aria-label={dict.body.workspace.toolsForVideo} className="flex flex-col gap-3 text-sm">
              {ws?.video ? (
                <>
                  <Link href={`/videos/${ws.video.id}/analyze`} className="text-primary">{dict.body.workspace.reviewIdentitiesTeams}</Link>
                  <button type="button" onClick={() => setNamingOpen(true)} className="text-left text-primary">{dict.body.workspace.isThisHimReel}</button>
                  <Link href={`/processing?video=${ws.video.id}`} className="text-primary">{dict.body.workspace.processingArrow}</Link>
                  <Link href={`/tactics?video=${ws.video.id}`} className="text-primary">{dict.body.workspace.tacticalArrow}</Link>
                  <div data-pro className="flex flex-col gap-4">
                    <RetrackButton s={s} />
                    <PitchCalibrationBlock videoId={ws.video.id} list={ws.pitch.list} camera={ws.pitch.camera} reload={ws.pitch.reload} canWrite={ws.canWrite} onStart={() => setCalOpen(true)} />
                    <BallBlock ball={ws.ball} canWrite={ws.canWrite} onMark={() => setBallOpen(true)} />
                  </div>
                  <LineupsBlock videoId={ws.video.id} canWrite={ws.canWrite} onReview={() => setLineupsOpen(true)} onName={() => setNamingOpen(true)} lineups={lineups} />
                </>
              ) : <span className="text-muted">{dict.body.analysis.chooseVideo}</span>}
            </nav>
          )}
        </div>
      </section>
      <section aria-label={dict.body.workspace.createAnalysisClipLower} data-section="p04-s03">
        <button type="button" disabled title={notBuilt(dict.body.workspace.analysisClipFromView)} aria-label={dict.body.workspace.createAnalysisClip}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-[#1f5a9c] bg-[#0a2a55] px-3 py-3 text-sm font-semibold text-[#33a8ff] disabled:opacity-75">
          ✂ {dict.body.workspace.createAnalysisClip}
        </button>
      </section>
      {ws?.video && <NamePlayersDialog open={namingOpen} onOpenChange={setNamingOpen} player={find} />}
      {ws?.video && <LineupsDialog open={lineupsOpen} onOpenChange={setLineupsOpen} videoId={ws.video.id} lineups={lineups} onApplied={() => void ws.reloadVideo()} />}
      {ws?.video && <BallMarkDialog open={ballOpen} onOpenChange={setBallOpen} videoId={ws.video.id} videoRef={ws.videoRef} stepUs={ws.intervalUs} ball={ws.ball} />}
      {ws?.video && <PitchCalibrationDialog open={calOpen} onOpenChange={setCalOpen} videoId={ws.video.id} videoRef={ws.videoRef} onStarted={() => void ws.pitch.reload()} others={ws.pitch.list} />}
    </div>
  );
}
