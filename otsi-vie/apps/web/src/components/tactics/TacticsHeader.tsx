"use client";
/**
 * Page 05 Section 01 — tactical header and filter context (approved reference 05_TACTICAL_INTELLIGENCE: sidebar, title, selectors, tabs), in flow (Desktop UI Drop 2).
 *
 * The match card shows the chosen video's linked match as recorded (clubs, competition, kick-off, score only when recorded) and what
 * analysis exists. The overlay switches are the Drop 1 OverlayToggles (one shared preference for this browser): Boxes, IDs and Ball
 * drive the synced video preview; Tracks, Shapes, Heat and Passes write the same preference the Analysis pitch layers read, and
 * Offside has no layer yet, so it draws nothing. The team filter (and the Team selector above) offers the linked match's teams with
 * the run's tracks a person assigned to each (kit colour groups); choosing one filters the synced video's boxes. Match halves are not
 * recorded, so those time ranges are disabled. The tabs highlight the matching panel.
 */
import type { Match, TrackSummary, Video } from "@otsi-vie/contracts";
import Link from "next/link";
import { OverlayToggles } from "@/components/media/OverlayToggles";
import { NOT_YET } from "@/lib/devMode";
import { useLocale, type Dictionary } from "@/lib/i18n";
import type { Opt } from "./Panels";

/** phases of play: listed so the choice is visible; the engine does not detect phases yet */
export const PHASES = (d: Dictionary): Opt<string>[] => [["all", d.body.tactics.allPhases], ["in", d.body.tactics.inPossession, d.body.tactics.notDetectedYet], ["out", d.body.tactics.outOfPossession, d.body.tactics.notDetectedYet],
  ["tr", d.body.tactics.transitionsMenu], ["sp", d.body.tactics.setPiecesMenu, d.body.tactics.notDetectedYet]];

export interface Layers { boxes: boolean; ids: boolean; ball: boolean }
export const TABS = (d: Dictionary) => [[d.body.tactics.teamOverview, "p05-s02"], [d.body.workspace.passNetworkMode, "p05-s05"], [d.body.tactics.heatZones, "p05-s06"],
  [d.body.tactics.pressingDefense, "p05-s07"], [d.body.tactics.offBallRuns, "p05-s08"], [d.body.tactics.transitionsMenu, "p05-s10"], [d.body.workspace.playerComparisonMode, "p05-s09"]] as const;

function MatchCard({ video, match, tracks, finished, onPick }: { video: Video | null; match: Match | null; tracks: TrackSummary[] | null; finished: boolean; onPick: () => void }) {
  const { t: dict } = useLocale();
  const title = match ? dict.body.workspace.matchTitleVs.replace("{a}", match.home?.name ?? "—").replace("{b}", match.away?.name ?? "—") : video ? (video.title ?? video.original_filename ?? dict.body.upload.untitledVideo) : dict.body.workspace.noMatchSelected;
  const sub = match ? [match.competition, match.kickoff_at ? new Date(match.kickoff_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null].filter(Boolean).join(" · ") || "—"
    : video ? dict.body.workspace.notLinkedToMatch : "—";
  const score = (s: number | null | undefined) => (s === null || s === undefined ? "—" : String(s));
  const people = (tracks ?? []).filter((t) => t.class_name !== "BALL").length, balls = (tracks ?? []).filter((t) => t.class_name === "BALL").length;
  return (
    <section className="vie-panel" aria-label={dict.body.analysis.match}>
      <div className="vie-ph">
        <h2 className="t-panel">{dict.body.analysis.match}</h2>
        <button type="button" onClick={onPick} aria-label={dict.body.workspace.chooseMatchVideo} className="vie-btn">{dict.body.workspace.chooseMatchVideo}</button>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <p className="truncate t-panel" title={title}>{title}</p>
        <p className="t-small">{sub}</p>
        <div className="flex items-center gap-3">
          <span aria-hidden className="h-5 w-5 shrink-0 rounded-full bg-[#7ab6ff]" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{match?.home?.name ?? dict.body.workspace.homeTeam}</span>
          <span className="t-metric">{score(match?.home_score)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span aria-hidden className="h-5 w-5 shrink-0 rounded-full bg-[#e8d9a0]" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{match?.away?.name ?? dict.body.workspace.awayTeam}</span>
          <span className="t-metric">{score(match?.away_score)}</span>
        </div>
        <div className="flex items-start gap-2 rounded-md border border-[#1f8a5a] bg-[#0a2a2a] p-2">
          <span aria-hidden className="mt-0.5 h-8 w-8 shrink-0 rounded bg-[#2a4a78]" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#cfe0f5]">{finished ? dict.body.workspace.trackingAvailable : dict.body.workspace.noAnalysisAvailable}</p>
            <p className="t-small">{finished ? dict.body.analysis.peopleBallTracks.replace("{a}", String(people)).replace("{b}", String(balls)) : dict.body.workspace.trackingDataModels}</p>
            <p className="t-small">{finished ? dict.body.tactics.tacticalModelsNotYet.replace("{a}", NOT_YET) : dict.body.tactics.appearAfterProcessing}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Radio({ label, selected, count, reason, onSelect }: { label: string; selected: boolean; count?: string; reason?: string; onSelect?: () => void }) {
  const off = !selected && !onSelect;
  return (
    <div role="radio" aria-checked={selected} aria-disabled={off} title={off ? reason : undefined} aria-label={`${label}${count !== undefined ? `, ${count}` : ""}`}
      tabIndex={onSelect && !selected ? 0 : -1} onClick={onSelect && !selected ? onSelect : undefined}
      onKeyDown={(e) => { if (onSelect && !selected && (e.key === " " || e.key === "Enter")) { e.preventDefault(); onSelect(); } }}
      className={`flex h-11 items-center gap-3 rounded-md px-2 ${selected ? "border border-primary bg-[#0d3a78]" : "border border-transparent"} ${onSelect && !selected ? "cursor-pointer" : off ? "cursor-not-allowed" : ""}`}>
      <span aria-hidden className={`h-5 w-5 shrink-0 rounded-full border-2 ${selected ? "border-primary bg-primary" : "border-[#7fa4d4]"} ${off ? "opacity-60" : ""}`} />
      <span className={`min-w-0 flex-1 truncate text-sm ${off ? "text-muted" : "text-[#cfdcf0]"}`}>{label}</span>
      {count !== undefined && <span className="rounded border border-[#4a6a96] px-2 py-0.5 text-sm font-semibold">{count}</span>}
    </div>
  );
}

/** a team of the linked match with how many of the run's tracks a person assigned to it (via kit colour groups) */
export interface TeamCount { club_id: string; name: string; tracks: number }

export function TacticsHeader({ video, match, tracks, finished, side, setSide, onPick, teams, team, setTeam }: {
  video: Video | null; match: Match | null; tracks: TrackSummary[] | null; finished: boolean;
  side: number; setSide: (i: number) => void; onPick: () => void;
  /** [home, away] when the video is linked to a match; tracks = 0 until a person assigned that team on the Analysis page */
  teams: [TeamCount | null, TeamCount | null]; team: string; setTeam: (t: string) => void;
}) {
  const { t: dict } = useLocale();
  const rows: [string, TeamCount | null][] = [[dict.body.workspace.homeTeam, teams[0]], [dict.body.workspace.awayTeam, teams[1]]];
  const teamReason = !match ? dict.body.tactics.linkVideoFirst : dict.body.tactics.assignKitFirst;
  const people = finished ? String((tracks ?? []).filter((t) => t.class_name !== "BALL").length) : "—";
  const SIDE: string[] = [dict.body.workspace.viewLabel, dict.body.workspace.filters, dict.body.workspace.metricEvents, dict.body.tactics.allTools];

  return (
    <div className="flex flex-col gap-4">
      <MatchCard video={video} match={match} tracks={tracks} finished={finished} onPick={onPick} />

      <section className="vie-panel" aria-label="Tactical header and filter context" data-section="p05-s01">
        <div role="tablist" aria-label={dict.body.workspace.sidebar} className="flex flex-wrap gap-1 border-b border-line px-2 py-1">
          {SIDE.map((l, i) => (
            <button key={l} type="button" role="tab" aria-selected={side === i} onClick={() => setSide(i)}
              className={`border-b-2 px-2 py-2 text-sm ${side === i ? "border-primary font-semibold text-primary" : "border-transparent text-muted hover:text-ink"}`}>{l}</button>
          ))}
        </div>
        <div className="flex flex-col gap-3 p-3">
          {side === 0 && (
            <>
              <OverlayToggles />
              <h3 className="t-panel">{dict.body.analysis.teamFilter}</h3>
              <div role="radiogroup" aria-label={dict.body.tactics.teamFilterLower} className="flex flex-col gap-1">
                <Radio label={dict.body.workspace.allPlayers} selected={team === "all"} count={people} onSelect={() => setTeam("all")} />
                {rows.map(([fallback, t]) => (
                  <Radio key={fallback} label={t?.name ?? fallback} selected={!!t && team === t.club_id} count={t && finished ? String(t.tracks) : "—"} reason={teamReason}
                    {...(t && t.tracks > 0 ? { onSelect: () => setTeam(t.club_id) } : {})} />
                ))}
              </div>
              <h3 className="t-panel">{dict.body.analysis.timeRange}</h3>
              <div role="radiogroup" aria-label={dict.body.tactics.timeRangeLower} className="flex flex-col gap-1">
                <Radio label={dict.body.workspace.fullMatch} selected />
                {([dict.body.workspace.firstHalf, dict.body.workspace.secondHalf, dict.body.workspace.customRange] as const).map((l) => (
                  <Radio key={l} label={l} selected={false} reason={dict.body.tactics.matchPeriodsNotRecorded} />
                ))}
              </div>
            </>
          )}
          {side === 1 && (
            <>
              <h3 className="t-panel">{dict.body.analysis.teamFilter}</h3>
              <div role="radiogroup" aria-label={dict.body.tactics.teamFilterLower} className="flex flex-col gap-1">
                <Radio label={dict.body.workspace.allPlayers} selected={team === "all"} count={people} onSelect={() => setTeam("all")} />
                {rows.map(([fallback, t]) => (
                  <Radio key={fallback} label={t?.name ?? fallback} selected={!!t && team === t.club_id} count={t && finished ? String(t.tracks) : "—"} reason={teamReason}
                    {...(t && t.tracks > 0 ? { onSelect: () => setTeam(t.club_id) } : {})} />
                ))}
              </div>
              <h3 className="t-panel">{dict.body.analysis.timeRange}</h3>
              <div role="radiogroup" aria-label={dict.body.tactics.timeRangeLower} className="flex flex-col gap-1">
                <Radio label={dict.body.workspace.fullMatch} selected />
                {([dict.body.workspace.firstHalf, dict.body.workspace.secondHalf, dict.body.workspace.customRange] as const).map((l) => (
                  <Radio key={l} label={l} selected={false} reason={dict.body.tactics.matchPeriodsNotRecorded} />
                ))}
              </div>
            </>
          )}
          {side === 2 && <p className="text-sm text-muted">{dict.body.tactics.eventsFilteredAnalysis}</p>}
          {side === 3 && (
            <nav aria-label={dict.body.workspace.toolsForVideo} className="flex flex-col gap-3 text-sm">
              {video ? (
                <>
                  <Link href={`/videos/${video.id}/analyze`} className="text-primary">{dict.body.tactics.analysisWorkspaceArrow}</Link>
                  <Link href={`/processing?video=${video.id}`} className="text-primary">{dict.body.workspace.processingArrow}</Link>
                  <Link href="/reels" className="text-primary">{dict.body.tactics.reelBuilderArrow}</Link>
                </>
              ) : <span className="text-muted">{dict.body.analysis.chooseVideo}</span>}
            </nav>
          )}
        </div>
      </section>
    </div>
  );
}

/** the page title bar: title, subtitle, view mode, team and phase selectors, and the tabs that jump to each panel */
export function TacticsTitleBar({ match, teams, team, setTeam, tab, setTab }: {
  match: Match | null; teams: [TeamCount | null, TeamCount | null]; team: string; setTeam: (t: string) => void;
  tab: number; setTab: (i: number) => void;
}) {
  const { t: dict } = useLocale();
  const tabs = TABS(dict);
  const teamReason = !match ? dict.body.tactics.linkVideoFirst : dict.body.tactics.assignKitFirst;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">{dict.pages.tactical.title}</h1>
          <p className="mt-0.5 text-sm text-muted">{dict.body.tactics.tacticalSubtitle}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="t-label">{dict.body.tactics.viewMode}</span>
            <select aria-label={dict.body.tactics.viewMode} defaultValue="live" className="h-9 rounded-md border border-line bg-raised px-2 text-sm text-ink">
              <option value="live">{dict.body.tactics.liveMatchView}</option>
              <option value="review" disabled>{`${dict.body.tactics.postMatchReview} — ${NOT_YET}`}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="t-label">{dict.body.library.team}</span>
            <select aria-label={dict.body.library.team} value={team === "all" ? "none" : team} title={teamReason}
              onChange={(e) => setTeam(e.target.value === "none" ? "all" : e.target.value)}
              className="h-9 rounded-md border border-primary bg-[#0d3a78] px-2 text-sm text-ink">
              <option value="none">{dict.body.tactics.selectTeam}</option>
              {match ? teams.filter((t): t is TeamCount => !!t).map((t): Opt<string> => t.tracks > 0
                ? [t.club_id, t.name] : [t.club_id, t.name, dict.body.tactics.assignKitLower])
                : [["link", dict.body.tactics.homeAwayTeam, dict.body.tactics.linkVideoFirstLower] as Opt<string>]}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="t-label">{dict.body.tactics.phaseLabel}</span>
            <select aria-label={dict.body.tactics.phaseLabel} defaultValue="all" className="h-9 rounded-md border border-line bg-raised px-2 text-sm text-ink">
              {PHASES(dict).map(([v, l, why]) => <option key={v} value={v} disabled={!!why}>{why ? `${l.trim()} — ${why}` : l.trim()}</option>)}
          </select>
          </label>
        </div>
      </div>
      <div role="tablist" aria-label={dict.body.tactics.tacticalViews} className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([n, target], i) => (
          <button key={n} type="button" role="tab" aria-selected={tab === i} aria-controls={target} onClick={() => setTab(i)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === i ? "border-primary font-semibold text-primary" : "border-transparent text-muted hover:text-ink"}`}>{n}</button>
        ))}
      </div>
    </div>
  );
}
