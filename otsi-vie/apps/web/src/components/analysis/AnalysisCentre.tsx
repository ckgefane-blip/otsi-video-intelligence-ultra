"use client";
/**
 * Page 04 centre — the analysis modes, the video, and the playback tools, in flow (Desktop UI Drop 2).
 *
 * The five tabs switch the centre view on this page (they never open another page): Video Analysis (the video on the shared
 * VideoPlayer, via WorkspacePlayer), Tactical View (everyone placed on a top-down pitch at the playhead, from calibrated pitch
 * positions only), Heatmap (the selected player's heat zones, else both teams'), Pass Network (not measured yet, as on Page 05)
 * and Player Comparison (which lives on Tactical; this tab links there). The video stays loaded under the other tabs, so the
 * playhead the Tactical View follows keeps moving. The score bar above the player shows the linked match's recorded teams and
 * score — nothing when no match is linked. Keyboard (A.9, ADR-071): Space play/pause, J K L, one analysed frame (arrows) or one
 * second (Shift + arrows), I / O marks. Keys the shared player already handles (Space, J, K, L, arrows, F) are left to it while
 * it has focus, so nothing toggles twice.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { jkl, typing } from "@/lib/keymap";
import { teamCode } from "@/lib/team";
import { Evidence } from "@/components/evidence/Evidence";
import { KIT_COLOUR, kitLegend } from "@/components/analysis/TrackOverlay";
import { HeatPitch, measuredText, useHeatZones } from "@/components/workspace/HeatPitch";
import { PitchMinimap } from "@/components/workspace/PitchCalibration";
import { ANALYSIS_TO_TACTIC, tacticsHref } from "@/lib/tacticsLink";
import { clock, isPerson, type Shared } from "@/components/workspace/shared";
import { useLocale } from "@/lib/i18n";
import { AnalysisTools, usePlayerToolState } from "./AnalysisTools";
import { WorkspacePlayer } from "./WorkspacePlayer";
import { heatSides, TeamHeat } from "@/components/tactics/Panels";

const DOT = (g: number | null) => (g === 0 ? "#2ee86a" : g === 1 ? "#ff4d4d" : g === 2 ? "#ffd600" : "#19a0ff");

export function AnalysisCentre({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const { ws, match, teamGroups } = s;
  const MODES = [dict.body.workspace.videoAnalysis, dict.body.workspace.tacticalView, dict.body.workspace.heatmapMode, dict.body.workspace.passNetworkMode, dict.body.workspace.playerComparisonMode];
  const [mode, setMode] = useState(0);
  const tools = usePlayerToolState();
  const url = ws?.playback?.available ? ws.playback.url : null;
  const video = ws?.video ?? null;
  const dur = video?.duration_us ?? null, t = ws?.timeUs ?? 0;
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => { if (!hint) return; const h = setTimeout(() => setHint(null), 3500); return () => clearTimeout(h); }, [hint]);
  // A.9 (ADR-071): Space, J K L, one analysed frame (arrows) or one second (Shift + arrows) on the match video
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const v = ws?.videoRef.current, k = e.key.toLowerCase();
      if (!ws || !v || !url) return;
      // the shared player handles these while it has focus: do not toggle twice
      if ((e.target as HTMLElement).closest?.("[data-player]") && [" ", "k", "j", "l", "arrowleft", "arrowright", "f"].includes(k)) return;
      if (k === " ") { if ((e.target as HTMLElement).closest("button, a, [role=button]")) return; if (v.paused) void v.play(); else v.pause(); }
      else if (!e.shiftKey && (k === "j" || k === "k" || k === "l")) {
        const r = jkl(k, { playing: !v.paused, rate: v.playbackRate });
        if (!r.play) v.pause();
        v.playbackRate = r.rate;
        if (r.backUs) ws.seek(Math.max(0, t - r.backUs));
        if (r.play) { if (v.paused) void v.play(); setHint(dict.body.workspace.playingAt.replace("{a}", String(r.rate))); }
      } else if (k === "arrowleft" || k === "arrowright") {
        v.pause();
        const d = (k === "arrowleft" ? -1 : 1) * (e.shiftKey ? 1_000_000 : ws.intervalUs);
        ws.seek(Math.max(0, Math.min(dur ?? Number.MAX_SAFE_INTEGER, t + d)));
      } else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  const score = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n));
  const message = !ws ? dict.body.workspace.noVideoLoaded
    : !ws.playback ? dict.body.processing.loadingVideo : !url ? dict.body.analysis.noPlaybackYet.replace("{a}", ws.playback.reason ?? dict.body.workspace.beingPrepared) : null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <section aria-label={dict.body.workspace.analysisModes} data-section="p04-s04">
        <div role="tablist" aria-label={dict.body.workspace.analysisView} className="flex flex-wrap gap-1 border-b border-line">
          {MODES.map((l, i) => (
            <button key={l} type="button" role="tab" aria-selected={mode === i} onClick={() => setMode(i)}
              className={`border-b-2 px-3 py-2 text-sm ${mode === i ? "border-primary font-semibold text-primary" : "border-transparent text-muted hover:text-ink"}`}>{l}</button>
          ))}
        </div>
      </section>

      {match && (
        <div className="flex items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm" data-score-hud>
          <span className="font-semibold">{teamCode(match.home?.name, match.home?.short_name)}</span>
          <span className="rounded bg-primary px-2 py-0.5 font-semibold text-white">{score(match.home_score)} – {score(match.away_score)}</span>
          <span className="font-semibold">{teamCode(match.away?.name, match.away?.short_name)}</span>
          <span className="ml-auto text-xs text-muted">{match.competition ?? ""}</span>
        </div>
      )}

      {mode === 0 && (
        <section aria-label={dict.body.workspace.videoPlayer} data-section="p04-s05" className="flex min-w-0 flex-col gap-2">
          <WorkspacePlayer ws={ws} teamGroups={teamGroups} layers={ws?.layers ?? null} byTeam={tools.byTeam} pitchLayers ballRing
            minimap={tools.mini} zoom={tools.zoom} op={tools.op} />
          {message && <p className="text-sm text-muted" role="status">{message}</p>}
          {url && !ws?.run && <p className="text-sm text-muted">{dict.body.workspace.noBoxes}</p>}
          <AnalysisTools s={s} tools={tools} />
          {hint && <p role="status" className="rounded border border-primary bg-panel px-2 py-1 text-sm">{hint}</p>}
        </section>
      )}
      {mode > 0 && (
        <div role="tabpanel" aria-label={MODES[mode]} data-centre-view={MODES[mode]} className="vie-panel relative min-h-[320px] overflow-hidden">
          {mode === 1 && <TacticalView s={s} />}
          {mode === 2 && <HeatView s={s} />}
          {mode === 3 && <PassNetworkView s={s} />}
          {mode === 4 && <ComparisonView s={s} />}
          <OpenInTactical s={s} mode={mode} />
        </div>
      )}
    </div>
  );
}

/** B.8 (ADR-085): the same view on the Tactical page, with this video, playhead and selected player */
function OpenInTactical({ s, mode }: { s: Shared; mode: number }) {
  const { t: dict } = useLocale();
  const videoId = s.ws?.video?.id;
  const tab = ANALYSIS_TO_TACTIC[mode];
  if (!videoId || !tab) return null;
  const href = tacticsHref({ videoId, tab, timeUs: s.ws?.timeUs ?? null, trackId: s.ws?.selectedId ?? null });
  return (
    <Link href={href} data-open-tactical={tab} title={dict.body.workspace.openTacticalHint}
      className="absolute right-3 top-3 z-10 rounded-md border border-primary bg-panel px-3 py-1.5 text-sm font-semibold text-primary">
      {dict.body.workspace.openInTactical} →
    </Link>
  );
}

/** Player Comparison lives on the Tactical page (one place, not two) */
function ComparisonView({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const sel = s.ws?.selectedId ? s.ws.tracks?.find((t) => t.track_id === s.ws!.selectedId) ?? null : null;
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="t-section">{dict.body.workspace.playerComparisonTactical}</div>
      <div className="max-w-[560px] text-sm leading-relaxed text-muted">
        {sel ? dict.body.workspace.opensAtMoment.replace("{a}", String(sel.track_number)) : dict.body.workspace.opensAtMomentNoPlayer}
        {" "}{dict.body.workspace.headToHeadNotMeasured}
      </div>
    </div>
  );
}

/** everyone placed on the pitch at the playhead (calibrated pitch positions only) */
function TacticalView({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const ws = s.ws;
  const tracks = useMemo(() => new Map((ws?.tracks ?? []).map((t) => [t.track_id, t])), [ws?.tracks]);
  const placed = (ws?.visible ?? []).filter(({ o }) => o.class_name === "PERSON" && typeof o.pitch_x === "number" && typeof o.pitch_y === "number"
    && (!s.teamGroups || s.teamGroups.has((o.kit_group ?? tracks.get(o.track_id)?.kit_group ?? -1) as number)));
  const calibrated = (ws?.pitch.list ?? []).some((r) => r.status === "SUCCEEDED");
  const why = !ws?.run ? dict.body.workspace.noFinishedYet : !calibrated ? dict.body.workspace.pitchNotCalibratedVideo
    : placed.length ? null : dict.body.workspace.noPitchPositionMoment;
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <b>{dict.body.workspace.positionsAt.replace("{a}", clock(ws?.timeUs ?? 0))}</b>
        <span className="text-muted">{dict.body.workspace.placedCount.replace("{a}", String(placed.length))}</span>
        {placed.length > 0 && <Evidence level="INFERRED" size={14} why={dict.body.workspace.pitchPositionsCalibrated} />}
        <span className="ml-auto flex gap-3">
          {kitLegend(dict).map(([g, l]) => <span key={g} className="flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-full" style={{ background: DOT(g) }} />{l}</span>)}
        </span>
      </div>
      <div className="flex items-center justify-center px-4 pb-4">
        <div className="relative aspect-[111/74] w-full max-w-[720px] overflow-hidden rounded-md border-2 border-[#19a0ff]">
          <PitchMinimap calibrated={calibrated}
            dots={placed.map(({ o }) => ({ x: o.pitch_x as number, y: o.pitch_y as number, group: (o.kit_group ?? tracks.get(o.track_id)?.kit_group ?? null) as number | null, chosen: o.track_id === ws?.selectedId }))} />
          {why && <div className="absolute inset-x-0 top-[45%] px-4 text-center text-sm text-white [text-shadow:0_0_4px_#000]">{why}</div>}
        </div>
      </div>
    </div>
  );
}

/** the selected player's heat zones, else both teams' */
function HeatView({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const ws = s.ws;
  const sel = ws?.tracks?.find((x) => x.track_id === ws.selectedId && isPerson(x)) ?? null;
  const calKey = (ws?.pitch.list ?? []).filter((r) => r.status === "SUCCEEDED").length;
  const { zones, loading } = useHeatZones(ws?.run && sel ? `/v1/analysis-runs/${ws.run.id}/tracks/${sel.track_id}/heat-zones` : null, calKey);
  if (!ws?.run) return <p className="p-4 text-sm text-muted">{dict.body.workspace.noFinishedYet}</p>;
  if (sel) {
    return (
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <b>{sel.label.split(" · ")[0]}</b>
          <span className="text-muted">{zones ? measuredText(zones, dict) : loading ? dict.body.processing.reading : dict.body.workspace.noHeatZones}</span>
          {zones && zones.measured_s > 0 && <Evidence level="INFERRED" size={14} why={dict.body.workspace.timeInZones} />}
          <button type="button" onClick={() => ws.select(null)} className="ml-auto text-sm text-primary">{dict.body.workspace.showBothTeams}</button>
        </div>
        <div className="flex justify-center px-4 pb-4">
          <div className="aspect-[109/72] w-full max-w-[720px]">{zones && <HeatPitch zones={zones} label={dict.body.workspace.heatZonesOf.replace("{a}", sel.label)} />}</div>
        </div>
      </div>
    );
  }
  const sides = heatSides(s.kits, s.match, dict);
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-muted">{dict.body.workspace.bothTeamsHeat}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} role="group" aria-label={dict.body.tactics.heatZonesPossession.replace("{a}", sides[i]?.label ?? (i ? dict.body.workspace.awayTeam : dict.body.workspace.homeTeam))}>
            <div className="mb-1 text-sm font-semibold">{sides[i]?.label ?? (i ? dict.body.workspace.awayTeam : dict.body.workspace.homeTeam)}</div>
            <TeamHeat runId={ws.run!.id} side={sides[i]} calKey={calKey} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** not measured yet, as on Page 05 */
function PassNetworkView({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const n = s.ws?.events.data?.passes.length ?? null;
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <Evidence level="NOT_MEASURED" size={18} />
      <div className="t-section">{dict.body.workspace.passNetworkNotMeasured}</div>
      <div className="max-w-[560px] text-sm leading-relaxed text-muted">
        {dict.body.workspace.passNetworkNeeds}
        {n !== null && dict.body.workspace.passesFoundEventsTab.replace("{a}", String(n))}
      </div>
    </div>
  );
}
