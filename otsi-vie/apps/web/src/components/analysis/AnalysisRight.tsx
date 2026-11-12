"use client";
/**
 * Page 04 right column, in flow (Desktop UI Drop 2): the players list and the selected player card.
 *
 * The list is the people tracks of the latest finished run (a track is a temporary reference within one analysis, not a player ID):
 * thumbnail, label, the team a person assigned to its kit colour, mean detection confidence and identity state. Jersey numbers are not
 * read yet, so the "#" column says "—". Search, All / Home / Away and a row click (select + jump to where the track first appears) work
 * on real tracks. The card shows what is recorded about the selected track; distance, speed, passes and the heatmap need calibrated
 * pitch positions and event detection, so they say "Not measured" where nothing was measured. Identity decisions are made on the
 * identity review page. Events tab: every event the engine found, in time order, with Accept / Reject (ADR-118). Clips tab: the clips
 * of the reels made from this video; a row plays the clip's start, and each reel opens in Reel Builder.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ballWonBy, clipOutputUs, passesOf, pressuresBy, type Movement, type Reel, type TrackIdentity, type TrackSummary } from "@otsi-vie/contracts";
import { teamCode } from "@/lib/team";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { assignmentOf, clock, isPerson, Thumb, type Shared } from "@/components/workspace/shared";
import { HeatPitch, measuredText, useHeatZones } from "@/components/workspace/HeatPitch";
import { IdentifyDialog } from "@/components/workspace/IdentifyDialog";
import { PropertiesDialog } from "@/components/workspace/PropertiesCard";
import { allMarks, KIND, marksOf } from "@/components/workspace/TimelinePanel";
import { notBuilt } from "@/lib/devMode";

const PAGE = 40;
const code = (n: string | null | undefined) => teamCode(n);
const bars = (c: number | null) => (c === null ? 0 : c >= 0.85 ? 4 : c >= 0.7 ? 3 : c >= 0.5 ? 2 : 1);

/** the Events tab: every event found, a row to watch it and accept/reject it (ADR-118) */
function EventsTab({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const { ws } = s;
  const marks = useMemo(() => allMarks(marksOf(ws?.events.data ?? null, dict)), [ws?.events.data]);
  const names = useMemo(() => new Map((ws?.tracks ?? []).map((t) => [t.track_id, t.label])), [ws?.tracks]);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const decide = async (eventId: string, decision: "CONFIRM" | "REJECT") => {
    if (!ws?.video?.id) return;
    setDecidingId(eventId);
    try {
      await api(`/v1/videos/${ws.video.id}/events/${eventId}/decision`, { method: "POST", json: { decision } });
      await ws.events.reload();
      if (ws.bumpEvidence) ws.bumpEvidence();
    } catch { /* keep what is shown */ } finally { setDecidingId(null); }
  };
  if (!ws?.run) return <p className="p-3 text-sm text-muted">{dict.body.analysis.noFinishedAnalysis}</p>;
  if (!marks.length) return <p className="p-3 text-sm text-muted">{dict.body.workspace.noEventsYetBall}</p>;
  const rejectedCount = ws.events.data?.rejected_events_count ?? 0;
  return (
    <div role="list" aria-label={dict.body.workspace.metricEvents} data-events={String(marks.length)} className="flex flex-col">
      <div className="flex justify-between px-3 pb-1 text-xs text-muted">
        <span>{marks.length} events, in time order.</span>
        {rejectedCount > 0 && <span className="text-[#ef4444]">({rejectedCount} rejected hidden)</span>}
      </div>
      {marks.map((m) => {
        const k = KIND(dict)[m.kind], who = m.tracks.filter((x): x is string => !!x).map((x) => names.get(x) ?? "a player");
        const dec = m.decision;
        return (
          <div key={`${m.kind}-${m.id}`} className="flex flex-col gap-1 border-b border-line/60 px-3 py-2 text-sm">
            <div className="flex cursor-pointer items-start gap-2"
              onClick={() => { if (m.tracks[0]) ws.select(m.tracks[0]); ws.seek(Math.max(0, m.at - k.lead)); }}>
              <span aria-hidden className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ background: k.color }} />
              <span className="w-14 shrink-0 text-[#9fb3cc]">{clock(m.at)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-normal">{k.noun[0]!.toUpperCase() + k.noun.slice(1)}</span>
                {who.length > 0 && <span className="text-[#cfdcf0]"> · {who.join(" → ")}</span>}
                {m.detail && <span className="block text-xs text-muted">{m.detail}</span>}
              </span>
              {dec && (
                <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-normal"
                  style={{ background: dec === "CONFIRM" ? "rgba(34,197,94,0.2)" : dec === "EDIT" ? "rgba(59,130,246,0.2)" : "rgba(245,158,11,0.2)",
                    color: dec === "CONFIRM" ? "#22c55e" : dec === "EDIT" ? "#60a5fa" : "#fbbf24" }}>{dec}</span>
              )}
            </div>
            <div className="flex gap-2 pl-[74px]">
              <button type="button" disabled={decidingId === m.id || dec === "CONFIRM"}
                className="rounded border border-[rgba(34,197,94,0.3)] bg-[rgba(34,197,94,0.15)] px-2 py-0.5 text-xs text-[#4ade80] disabled:opacity-50"
                onClick={(e) => { e.stopPropagation(); void decide(m.id, "CONFIRM"); }}>
                {dec === "CONFIRM" ? dict.body.workspace.confirmedCheck : dict.body.players.confirm}
              </button>
              <button type="button" disabled={decidingId === m.id}
                className="rounded border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.15)] px-2 py-0.5 text-xs text-[#f87171] disabled:opacity-50"
                onClick={(e) => { e.stopPropagation(); void decide(m.id, "REJECT"); }}>
                Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** the Clips tab: the clips of the reels made from this video */
function ClipsTab({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const { ws } = s;
  const videoId = ws?.video?.id ?? null;
  const [reels, setReels] = useState<Reel[] | null | undefined>(undefined);
  useEffect(() => { setReels(undefined); if (videoId) void api<Reel[]>(`/v1/reels?video_id=${videoId}`).then(setReels, () => setReels(null)); }, [videoId]);
  const msg = !videoId ? dict.body.workspace.chooseVideoFirst : reels === undefined ? dict.body.workspace.loadingClips : reels === null ? dict.body.workspace.clipsLoadFailed : reels.every((r) => !r.clips.length) ? "No clips yet. Make a highlight reel of a player (Create Highlight Reel) and add moments to it." : null;
  if (msg) return <p className="p-3 text-sm text-muted">{msg}</p>;
  return (
    <div role="list" aria-label={dict.body.workspace.metricClips} data-clips={String(reels!.reduce((n, r) => n + r.clips.length, 0))} className="flex flex-col">
      {reels!.filter((r) => r.clips.length).map((r) => (
        <div key={r.id}>
          <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm font-normal">
            <span className="min-w-0 truncate">{r.name} · {r.clips.length} clips</span>
            <Link href={`/reels/${r.id}`} className="shrink-0 font-normal text-primary">{dict.body.analysis.openInReelBuilder}</Link>
          </div>
          {r.clips.map((c, i) => (
            <button key={c.id} type="button" role="listitem" data-clip={c.id}
              className="flex w-full items-center gap-2 border-b border-line/60 px-3 py-1.5 text-left text-sm hover:bg-white/5" onClick={() => ws?.seek(c.in_pts_us)}>
              <span className="w-8 shrink-0 font-normal text-primary">{i + 1}</span>
              <span className="w-[130px] shrink-0 text-[#9fb3cc]">{clock(c.in_pts_us)}–{clock(c.out_pts_us)}</span>
              <span className="min-w-0 truncate">{c.label ?? dict.body.workspace.metricClip} <span className="text-muted">· {Math.round(clipOutputUs(c) / 1e6)} s</span></span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function Players({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const { ws, kits, match, team, setTeam, teams } = s;
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const finished = !!ws?.run;
  const all = useMemo(() => (ws?.tracks ?? []).filter((t) => isPerson(t) && t.observation_count >= 3).sort((a, b) => b.observation_count - a.observation_count), [ws?.tracks]);
  const inTeam = (t: TrackSummary, club: string) => assignmentOf(kits, t)?.club_id === club;
  const list = all.filter((t) => (team === "all" || inTeam(t, team)) && (!q.trim() || t.label.toLowerCase().includes(q.trim().toLowerCase())));
  const reason = !match ? dict.body.workspace.linkVideoMatchFirst : dict.body.workspace.assignTeamKitFirst;
  const chips: [string, string | null, boolean][] = [[dict.body.processing.filterAll, "all", true],
    [dict.body.workspace.metricHome, teams[0]?.club_id ?? null, false], [dict.body.workspace.metricAway, teams[1]?.club_id ?? null, false]];
  return (
    <section aria-label={dict.body.analysis.players} data-section="p04-s09" data-players={String(list.length)} className="vie-panel">
      <div role="tablist" aria-label={dict.body.workspace.rightPanel} className="flex flex-wrap gap-1 border-b border-line px-2 pt-1">
        {[`${dict.body.analysis.players} (${finished ? (ws?.tracks ? all.length : "…") : "—"})`, dict.body.workspace.metricEvents, dict.body.workspace.metricClips].map((l, i) => (
          <button key={l} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)}
            className={`border-b-2 px-2 py-2 text-sm ${tab === i ? "border-primary font-normal text-primary" : "border-transparent text-muted hover:text-ink"}`}>{l}</button>
        ))}
      </div>
      {tab === 0 && (
        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-center gap-2 rounded-md border border-[#17355f] bg-[#0a1d38] px-2">
            <span aria-hidden>🔍</span>
            <input aria-label={dict.body.workspace.searchPlayers} placeholder={dict.body.workspace.searchPlayersDots} value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
              className="h-9 w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted" />
          </div>
          <div role="radiogroup" aria-label={dict.body.library.team} className="flex flex-wrap gap-1">
            {chips.map(([n, club, a0]) => {
              const on = a0 ? team === "all" : !!club && team === club;
              const c = a0 ? finished ? String(all.length) : "—" : club && finished ? String(all.filter((t) => inTeam(t, club)).length) : "—";
              const usable = a0 || (!!club && all.some((t) => inTeam(t, club)));
              return (
                <button key={n} type="button" role="radio" aria-checked={on} aria-disabled={!usable} title={usable ? undefined : reason} disabled={!usable}
                  onClick={() => setTeam(a0 ? "all" : club!)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm disabled:opacity-70 ${on ? "border-primary bg-primary/10 font-normal text-primary" : "border-line"}`}>
                  {!a0 && <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: n === dict.body.workspace.metricHome ? "#7ab6ff" : "#e8d9a0" }} />}
                  {n} <span className="rounded bg-[#12294a] px-1.5 text-xs">{c}</span>
                </button>
              );
            })}
          </div>
          {list.length === 0 && <p className="py-6 text-center text-sm text-muted">{!ws?.video ? "No players detected yet" : !finished ? "No players detected yet" : !ws.tracks ? dict.body.workspace.readingTracks : q ? "No player matches the search" : "No players for this team"}</p>}
          <div role="listbox" aria-label={dict.body.analysis.players} className="max-h-[420px] overflow-y-auto">
            {list.slice(0, shown).map((t) => {
              const on = t.track_id === ws?.selectedId, a = assignmentOf(kits, t);
              return (
                <div key={t.track_id} role="option" aria-selected={on} data-track={t.track_number} tabIndex={0}
                  onClick={() => { ws?.select(t.track_id); ws?.seek(t.first_pts_us); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ws?.select(t.track_id); ws?.seek(t.first_pts_us); } }}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border-2 px-2 py-1.5 ${on ? "border-primary bg-[#0d3066]" : "border-transparent hover:bg-white/5"}`}>
                  <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs text-white ${on ? "border-[#1a8cff] bg-[#1a8cff]" : "border-[#4a6a96]"}`}>{on ? "✓" : ""}</span>
                  <span className="w-4 shrink-0 text-sm">—</span>
                  <Thumb track={t} w={40} h={44} style={{ borderRadius: "50%" }} />
                  <span className="min-w-0 flex-1 truncate text-sm font-normal" title={t.label}>{t.label.split(" · ")[0]}</span>
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-xs font-normal" style={{ background: a?.club_id ? "#1580ff" : "#12294a" }}
                    title={a ? (a.club_name ?? dict.body.processing.notATeam) : dict.body.workspace.teamNotAssignedYet}>{a?.club_id ? code(a.club_name) : "—"}</span>
                  <span className="w-9 shrink-0 text-right text-sm tabular-nums">{t.mean_confidence?.toFixed(2) ?? "—"}</span>
                  <span aria-hidden className="relative hidden h-4 w-8 shrink-0 sm:block">
                    {[1, 2, 3, 4].map((k) => <i key={k} className="absolute bottom-0 w-[5px]" style={{ left: (k - 1) * 8, height: k * 5 + 2, background: k <= bars(t.mean_confidence) ? "#1a8cff" : "#1a2a44" }} />)}
                  </span>
                  <span className="w-[74px] shrink-0 truncate text-right text-xs text-muted">{t.identity_state === "UNRESOLVED" ? dict.body.workspace.unidentifiedLower : t.identity_state.toLowerCase()}</span>
                </div>
              );
            })}
            {list.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mx-auto mt-2 block rounded-md border border-line px-3 py-1.5 text-sm">
                {dict.body.workspace.showMoreLeft.replace("{a}", String(Math.min(PAGE, list.length - shown))).replace("{b}", String(list.length - shown))}
              </button>
            )}
          </div>
        </div>
      )}
      {tab === 1 && <EventsTab s={s} />}
      {tab === 2 && <ClipsTab s={s} />}
    </section>
  );
}

function Inspector({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const { ws, kits } = s;
  const t = ws?.tracks?.find((x) => x.track_id === ws.selectedId) ?? null;
  const a = t ? assignmentOf(kits, t) : null;
  const [season, setSeason] = useState(false);
  const router = useRouter();
  const [identity, setIdentity] = useState<TrackIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [props, setProps] = useState(false);
  const trackId = t?.track_id ?? null, isBall = t?.class_name === "BALL";
  useEffect(() => {
    setIdentity(null); setErr(null);
    if (trackId && !isBall) void api<TrackIdentity>(`/v1/tracks/${trackId}/identity`).then(setIdentity, () => setIdentity(null));
  }, [trackId, isBall, ws?.tracks]);
  const player = identity?.state === "CONFIRMED" ? identity.player : null;
  const calKey = ws?.pitch.list?.map((r) => `${r.id}:${r.status}`).join();
  const [move, setMove] = useState<Movement | null>(null);
  useEffect(() => {
    setMove(null);
    if (!ws?.run || !trackId || isBall) return;
    let live = true;
    void api<Movement>(`/v1/analysis-runs/${ws.run.id}/tracks/${trackId}/movement`).then((m) => { if (live) setMove(m); }, () => undefined);
    return () => { live = false; };
  }, [ws?.run, trackId, isBall, calKey]);
  const measuredFor = move && move.measured_s > 0 ? dict.body.workspace.measuredOver.replace("{a}", String(Math.round(move.measured_s))).replace("{b}", String(Math.round(move.seen_s))) : null;
  const ev = ws?.events.data ?? null;
  const pass = ev?.ball_track_id && trackId && !isBall ? passesOf(ev, { player_id: player?.player_id ?? null, track_ids: [trackId] }) : null;
  const won = pass ? ballWonBy(ev, { player_id: player?.player_id ?? null, track_ids: [trackId!] }) : null;
  const pressed = pass ? pressuresBy(ev, { player_id: player?.player_id ?? null, track_ids: [trackId!] }) : null;
  const kpiValue: Record<string, [string, string] | undefined> = {
    [dict.body.workspace.metricPasses]: pass ? [String(pass.made), dict.body.workspace.passesKpiIntro.replace("{a}", ev?.match_time ? dict.body.workspace.inMatchTime : dict.body.workspace.inVideo).replace("{b}", player ? dict.body.workspace.forPlayerName.replace("{a}", player.display_name) : dict.body.workspace.forThisTrack) + dict.body.workspace.passesCounts.replace("{a}", String(pass.made)).replace("{b}", String(pass.received)) + (pass.metres !== null ? dict.body.workspace.passesMetres.replace("{a}", String(pass.metres)) : "") + dict.body.workspace.passesNotCounted] : undefined,
    [dict.body.workspace.metricDistance]: move?.distance_m != null ? [`${move.distance_m} m`, dict.body.workspace.distanceKpiTitle.replace("{a}", measuredFor ?? "").replace("{b}", move.dropped_steps ? dict.body.workspace.droppedSteps.replace("{a}", String(move.dropped_steps)) : "")] : undefined,
    [dict.body.workspace.metricTopSpeed]: move?.top_speed_kmh != null ? [`${move.top_speed_kmh} km/h`, dict.body.workspace.topSpeedKpiTitle.replace("{a}", measuredFor ?? "").replace("{b}", (move.sprints === 1 ? dict.body.workspace.sprintsOne : dict.body.workspace.sprintsMany).replace("{a}", String(move.sprints)).replace("{b}", String(move.sprint_m ?? 0)).replace("{c}", String(move.high_speed_m ?? 0)))] : undefined,
  };
  const heat = useHeatZones(ws?.run && trackId && !isBall ? `/v1/analysis-runs/${ws.run.id}/tracks/${trackId}/heat-zones` : null, ws?.pitch.list?.map((r) => `${r.id}:${r.status}`).join());
  const createReel = () => {
    if (!ws?.video || !player) return;
    setBusy(true); setErr(null);
    void api<{ id: string }>("/v1/reels", { method: "POST", json: { video_id: ws.video.id, player_id: player.player_id } })
      .then((x) => router.push(`/reels/${x.id}`), (x) => setErr(x instanceof ApiProblem ? x.message : dict.body.workspace.reelNotCreated))
      .finally(() => setBusy(false));
  };
  const NM = dict.body.workspace.notMeasuredPitchEvents;
  return (
    <section aria-label={dict.body.workspace.selectedPlayer} data-section="p04-s10" data-selected-track={t?.track_number ?? ""} className="vie-panel">
      <div className="flex flex-col gap-3 p-3 text-sm">
        <div className="flex items-start gap-3">
          <button type="button" onClick={() => t && setProps(true)} disabled={!t} title={t ? dict.body.workspace.propertiesAboutTrack : dict.body.workspace.selectPlayerFirstShort}
            className="relative shrink-0 overflow-hidden rounded-md disabled:opacity-70" aria-label={dict.body.workspace.propertiesAboutTrack}>
            {t ? <Thumb track={t} w={110} h={128} style={{ borderRadius: 6 }} />
              : <span aria-hidden className="block h-[128px] w-[110px] rounded-md bg-gradient-to-br from-[#5a6f8c] to-[#2a4a78]" />}
            {t && <span data-props-open className="absolute inset-x-0 bottom-0 flex h-6 items-center justify-center bg-black/80 text-xs font-normal text-[#cfe3ff]">{dict.body.workspace.propertiesInfo}</span>}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span title={dict.body.workspace.jerseyNotRead} className="flex h-8 w-10 shrink-0 items-center justify-center rounded bg-primary t-section text-white">—</span>
              <h2 className="min-w-0 flex-1 truncate t-panel">{t ? t.label.split(" · ")[0] : dict.body.workspace.noPlayerSelected}</h2>
              {ws?.video && t && !isBall && (
                <button type="button" data-identify onClick={() => setIdentifying(true)} title={player ? dict.body.workspace.identityOfPlayer.replace("{a}", player.display_name) : dict.body.workspace.sayWhoPlayerIs}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-normal ${player ? "bg-[#0a2a55] text-[#8fc4ff]" : "bg-primary text-white"}`}>
                  {player ? dict.body.upload.identity : dict.body.workspace.identifyArrow}</button>
              )}
              <button type="button" aria-label={dict.body.workspace.clearSelection} disabled={!t} onClick={() => ws?.select(null)} className="vie-ib shrink-0 disabled:opacity-50">✕</button>
            </div>
            <p className="mt-1 truncate text-muted">{t ? dict.body.workspace.teamValue.replace("{a}", a ? (a.club_name ?? dict.body.workspace.noneWord) : "—") : dict.body.workspace.teamEmpty} · {dict.body.workspace.nationalityDash}</p>
            <div className="mt-2 flex gap-1.5">
              {[dict.body.workspace.positionDash, dict.body.workspace.footDash, dict.body.workspace.ageDash].map((l) => (
                <span key={l} className="rounded border border-line bg-[#0a1d38] px-2 py-1 text-xs">{l}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {([dict.body.workspace.metricDistance, dict.body.workspace.metricTopSpeed, dict.body.workspace.metricPasses, dict.body.workspace.metricKeyPasses] as const).map((l) => (
            <div key={l} title={kpiValue[l]?.[1] ?? (l === dict.body.workspace.metricDistance || l === dict.body.workspace.metricTopSpeed || (l === dict.body.workspace.metricPasses && ev?.ball_track_id) ? (t && !isBall ? (move ? dict.body.workspace.noPositionYet : dict.body.tactics.measuring) : dict.body.workspace.selectPlayerKpi) : NM)} data-kpi={l}
              className="rounded-md border border-line bg-[#071a33] p-2">
              <p className="text-xs text-muted">{l}</p>
              <p className="mt-1 t-metric">{kpiValue[l]?.[0] ?? "—"}</p>
            </div>
          ))}
        </div>
        {t ? (
          <p className="truncate text-xs text-muted" data-ball-won={won ?? ""} title={won !== null ? dict.body.workspace.ballWonTitle.replace("{a}", player ? player.display_name : dict.body.workspace.thisTrackName) : undefined}>
            {dict.body.workspace.seenDetail.replace("{a}", clock(t.first_pts_us)).replace("{b}", clock(t.last_pts_us)).replace("{c}", String(t.observation_count)).replace("{d}", t.mean_confidence?.toFixed(2) ?? "—").replace("{e}", won !== null ? dict.body.workspace.seenBallWon.replace("{a}", String(won)).replace("{b}", String(pressed)) : "")}
          </p>
        ) : <p className="text-xs text-muted">{dict.body.analysis.clickBox}</p>}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-line bg-[#1a4a2a] p-1">
            {heat.zones && heat.zones.measured_s > 0 ? (
              <div data-player-heat>
                <div className="h-[120px]"><HeatPitch zones={heat.zones} label={`Heat map of ${t?.label.split(" · ")[0] ?? "the player"}`} /></div>
                <div className="truncate text-center text-xs text-[#cfe3d8]" title={dict.body.workspace.halfNote}>{measuredText(heat.zones, dict)}</div>
              </div>
            ) : (
              <div className="flex h-[140px] flex-col items-center justify-center gap-1 text-center">
                <span className="text-sm text-[#cfe3d8]">{heat.loading ? dict.common.loading : dict.body.workspace.noHeatmap}</span>
                <span className="text-xs text-[#9fbfa8]">{!t || isBall ? "select a player" : heat.zones ? dict.body.workspace.noPitchPositionPlayer : "needs pitch positions"}</span>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex rounded border border-line bg-[#0a1d38] text-xs">
              <button type="button" disabled title={notBuilt("season statistics")} aria-label={dict.body.workspace.metricSeason}
                className="flex-1 rounded-l px-2 py-1.5 text-muted disabled:opacity-60">Season</button>
              <button type="button" aria-pressed={!season} onClick={() => setSeason(false)} className="flex-1 rounded-r bg-[#0d4aa0] px-2 py-1.5 font-normal">Match</button>
            </div>
            {([
              [dict.body.workspace.metricTouches, dict.body.workspace.notMeasuredTouches],
              [dict.body.workspace.metricPassAccuracy, dict.body.workspace.notMeasuredPasses],
              [dict.body.workspace.metricChancesCreated, dict.body.workspace.notMeasuredAssists],
              [dict.body.workspace.metricShotAssists, dict.body.workspace.notMeasuredAssists],
              [dict.body.workspace.metricProgressivePasses, "Not measured: requires calibrated pitch coordinates for pass start and reception (>= 30m in defensive 1/3, >= 15m in middle 1/3, >= 10m into box)."],
            ] as const).map(([l, reason]) => (
              <div key={l} title={reason} data-unconfirmed-metric={l} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted">{l}</span><span className="font-normal">—</span>
              </div>
            ))}
          </div>
        </div>
        <IdentifyDialog open={identifying} onOpenChange={setIdentifying} />
        <PropertiesDialog s={s} track={t} open={props} onOpenChange={setProps} />
        <div data-create-reel>
          <button type="button" disabled={busy || (!player && (!t || isBall))} onClick={player ? createReel : t && !isBall ? () => setIdentifying(true) : undefined}
            title={player ? dict.body.workspace.createHighlightReel : !t ? dict.body.workspace.selectPlayerFirst : isBall ? dict.body.workspace.selectPlayerNotBall : dict.body.workspace.createHighlightReel}
            className={`flex w-full items-center justify-center gap-2 rounded-md border px-3 py-3 text-sm font-normal ${player ? "border-[#1f8cff] bg-[#0a4aa8] text-white" : "border-[#1f5a9c] bg-[#0a2a55] text-[#33a8ff]"} disabled:opacity-80`}>
            {dict.body.analysis.createReel}
          </button>
          <p className={`mt-1 truncate text-center text-xs ${err ? "text-[#ff8a8a]" : "text-muted"}`}>
            {err ?? (player ? `for ${player.display_name}` : !t ? dict.body.workspace.selectPlayerFirstLower : isBall ? "select a player, not the ball" : "first say who this player is (click)")}
          </p>
        </div>
      </div>
    </section>
  );
}

export function AnalysisRight({ s }: { s: Shared }) {
  return (
    <div className="flex min-w-0 flex-col gap-4" style={{ "--u": "1px" } as CSSProperties}>
      <Players s={s} />
      <Inspector s={s} />
    </div>
  );
}
