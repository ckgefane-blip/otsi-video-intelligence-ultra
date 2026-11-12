"use client";
/**
 * Page 05 Sections 02, 03, 05, 06, 07, 08 — team shape and formation, team shape metrics, pass network, possession and heat zones,
 * pressing map, off-ball runs, in flow (Desktop UI Drop 2).
 *
 * Heat zones are measured (promise 2): each side shows where its players were, from calibrated pitch positions only, with how much of the
 * time was measured. Team shape is measured (promise 3) at moments where at least 8 of a team stand on a measured pitch: width, length,
 * compactness (outline area) and how much it varies, and where players stand around the team's centre; formation, defensive-line height
 * and the in/out-of-possession shapes stay "—" with their reason. The rest is not measured yet (team shape, passes, pressing, off-ball runs, possession): every value is "—" and every
 * pitch says "Not measured"; the circled "i" says what each panel needs. Nothing is drawn that was not measured.
 */
import { type FormationsAnalysis, type FormationName, type HeatZones, type Match, type RunTeams, SHAPE_COLS, SHAPE_ROWS, SHAPE_SPAN_M, type TeamShape } from "@otsi-vie/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { HeatPitch, measuredText } from "@/components/workspace/HeatPitch";
import { PressingPanel } from "./PressingPanel";
import { getDictionary, useLocale, type Dictionary } from "@/lib/i18n";

/** one option of a selector: value, label, and — when it cannot be chosen yet — the reason (shown greyed in the list) */
export type Opt<V extends string> = [V, string] | [V, string, string];

/** a panel in flow: blue bar, bold title, and (when `info` is given) the circled "i" that explains what the panel shows */
function Panel({ id, title, info, focus, children }: { id?: string; title: string; info?: string; focus?: boolean; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} data-section={id} className={`vie-panel ${focus ? "outline outline-2 outline-offset-2 outline-primary" : ""}`}>
      <div className="vie-ph">
        <h2 className="t-panel"><span aria-hidden className="mr-2 inline-block h-5 w-1.5 rounded bg-primary align-middle" />{title}
          {info && <span tabIndex={0} role="note" aria-label={info} title={info} className="ml-2 cursor-help rounded-full border border-line2 px-1.5 text-xs font-normal text-muted">i</span>}
        </h2>
      </div>
      <div className="flex flex-col gap-3 p-3">{children}</div>
    </section>
  );
}

/** a pitch in flow: green, with the lines drawn in percent so it scales; children overlay it (measured data only) */
export function FlowPitch({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <div aria-hidden={children === undefined} className={`relative aspect-[105/68] w-full overflow-hidden rounded-md border-2 border-[#cfe3d8] bg-gradient-to-r from-[#1c6a30] via-[#26793a] to-[#1c6a30] ${className}`}>
      <div className="absolute inset-y-0 left-1/2 w-[2px] bg-[#cfe8d6aa]" />
      <div className="absolute left-1/2 top-1/2 h-[80px] w-[80px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#cfe8d6aa]" />
      <div className="absolute left-0 top-1/2 h-[100px] w-[10%] -translate-y-1/2 border-2 border-l-0 border-[#cfe8d6aa]" />
      <div className="absolute right-0 top-1/2 h-[100px] w-[10%] -translate-y-1/2 border-2 border-r-0 border-[#cfe8d6aa]" />
      {children}
    </div>
  );
}

/** "Not measured" on a pitch */
function NotMeasuredFlow({ children }: { children?: ReactNode }) {
  const { t: dict } = useLocale();
  return (
    <div className="absolute inset-0 grid place-items-center">
      <span className="rounded-md bg-[#07142acc] px-3 py-1 text-sm text-[#e6f3ea]">{children ?? dict.body.reports.notMeasured}</span>
    </div>
  );
}

/** a native select in flow: choosable options work, options without data are listed greyed with their reason */
function FlowSel<V extends string>({ label, value, options, onChange, className = "" }: {
  label: string; value: V; options: Opt<V>[]; onChange?: (v: V) => void; className?: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange?.(e.target.value as V)}
      className={`h-9 rounded-md border border-line bg-raised px-2 text-sm text-ink ${className}`}>
      {options.map(([v, l, why]) => <option key={v} value={v} disabled={!!why}>{why ? `${l.trim()} — ${why}` : l.trim()}</option>)}
    </select>
  );
}

/** the linked match's two teams (choosable: the panel shows the choice; its numbers stay "not measured"), or why there are none */
const teamOpts = (m: Match | null, d: Dictionary): Opt<string>[] => [["none", d.body.tactics.selectTeam],
  ...(m ? [m.home, m.away].filter((c): c is NonNullable<Match["home"]> => !!c).map((c): Opt<string> => [c.id, c.name])
    : [["link", d.body.tactics.homeAwayTeam, d.body.tactics.linkVideoFirstLower] as Opt<string>])];
const range = (d: Dictionary): Opt<string>[] => [["none", d.body.tactics.timeRangeLower], ["full", d.body.tactics.fullMatchLower], ["h1", d.body.workspace.firstHalfLower, d.body.tactics.matchPeriodsNotRecorded], ["h2", d.body.workspace.secondHalfLower, d.body.tactics.matchPeriodsNotRecorded]];

function useTeamShape(runId: string | null, groups: number[], key: unknown): TeamShape | null | "loading" {
  const [v, setV] = useState<TeamShape | null | "loading">(null);
  const g = groups.join(",");
  useEffect(() => {
    setV(null);
    if (!runId || !g) return;
    let live = true;
    setV("loading");
    api<TeamShape>(`/v1/analysis-runs/${runId}/team-shape?kit_groups=${g}`).then((x) => { if (live) setV(x); }, () => { if (live) setV(null); });
    return () => { live = false; };
  }, [runId, g, key]);
  return v;
}

/** where players stand around the team's centre, drawn over the pitch picture centred on the centre spot (the window is SHAPE_SPAN_M) */
function ShapePicture({ shape }: { shape: TeamShape }) {
  const max = Math.max(0, ...shape.density);
  const [sx, sy] = SHAPE_SPAN_M;
  return (
    <svg aria-label={`Team shape: where players stand around the team's centre, over ${shape.moments} moments`} role="img" data-team-shape
      viewBox={`${-105 / 2} ${-68 / 2} 105 68`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      {shape.density.map((v, i) => {
        if (!(v > 0) || !(max > 0)) return null;
        const t = Math.sqrt(v / max);
        return <rect key={i} x={-sx / 2 + (i % SHAPE_COLS) * (sx / SHAPE_COLS)} y={-sy / 2 + Math.floor(i / SHAPE_COLS) * (sy / SHAPE_ROWS)} width={sx / SHAPE_COLS} height={sy / SHAPE_ROWS}
          fill={`rgba(122,182,255,${(0.15 + 0.75 * t).toFixed(2)})`} />;
      })}
      <circle cx={0} cy={0} r={0.9} fill="#fff" />
    </svg>
  );
}

const ofStat = (st: { mean: number } | null, unit: string, digits = 0) => (st ? `${st.mean.toFixed(digits)} ${unit}` : "—");

function useFormations(videoId: string | null, period: string, key: unknown): FormationsAnalysis | null | "loading" {
  const [data, setData] = useState<FormationsAnalysis | null | "loading">(null);
  useEffect(() => {
    setData(null);
    if (!videoId) return;
    let live = true;
    setData("loading");
    api<FormationsAnalysis>(`/v1/videos/${videoId}/formations?period=${period}`).then(
      (res) => { if (live) setData(res); },
      () => { if (live) setData(null); }
    );
    return () => { live = false; };
  }, [videoId, period, key]);
  return data;
}

export function ShapePanels({ focus, runId = null, videoId = null, kits = null, match = null, calKey = 0 }: { focus: boolean; runId?: string | null; videoId?: string | null; kits?: RunTeams | null; match?: Match | null; calKey?: unknown }) {
  const { t: dict } = useLocale();
  const [pick, setPick] = useState("0");
  const [formPeriod, setFormPeriod] = useState<string>("FULL");
  const [formRefresh, setFormRefresh] = useState<number>(0);
  const sides = heatSides(kits, match, dict);
  const side = sides[Number(pick)] ?? sides[0];
  const shape = useTeamShape(runId, side?.groups ?? [], calKey);
  const sh = shape && shape !== "loading" && shape.moments > 0 ? shape : null;
  const NM = sh?.not_measured ?? {};

  const formationsData = useFormations(videoId, formPeriod, formRefresh);
  const currentFormation = formationsData && formationsData !== "loading"
    ? formationsData.teams.find((t) => side?.groups.includes(t.kit_group)) ?? null
    : null;

  const confirmFormation = async (name: FormationName) => {
    if (!videoId || !side?.groups.length) return;
    try {
      await api(`/v1/videos/${videoId}/formations/confirm`, {
        method: "POST",
        json: { kit_group: side.groups[0], period: formPeriod, formation: name },
      });
      setFormRefresh((k) => k + 1);
    } catch {
      // Ignored
    }
  };

  const defLineHeightStr = currentFormation?.defensive_line_height_m != null
    ? `${currentFormation.defensive_line_height_m} m`
    : "—";
  const defLineHeightFrac = currentFormation?.defensive_line_height_pct != null
    ? currentFormation.defensive_line_height_pct / 100
    : null;
  const defLineHeightWhy = currentFormation?.defensive_line_height_m != null
    ? dict.body.tactics.defLineHeightWhy.replace("{a}", String(currentFormation.defensive_line_height_m)).replace("{b}", String(currentFormation.defensive_line_height_pct))
    : NM.defensive_line_height ?? dict.body.tactics.needsPitchObs;

  const metric: [string, string, number | null, string | undefined][] = [
    [dict.body.tactics.averageWidth, ofStat(sh?.width_m ?? null, "m"), sh?.width_m ? sh.width_m.mean / 68 : null, sh?.width_m ? dict.body.tactics.statP10P90.replace("{a}", String(sh.width_m.p10)).replace("{b}", String(sh.width_m.p90)) : undefined],
    [dict.body.tactics.averageLength, ofStat(sh?.length_m ?? null, "m"), sh?.length_m ? sh.length_m.mean / 105 : null, sh?.length_m ? dict.body.tactics.statP10P90.replace("{a}", String(sh.length_m.p10)).replace("{b}", String(sh.length_m.p90)) : undefined],
    [dict.body.tactics.defLineHeight, defLineHeightStr, defLineHeightFrac, defLineHeightWhy],
    [dict.body.tactics.compactnessDef, sh?.compactness_m2 ? `${Math.round(sh.compactness_m2.mean)} m²` : "—", sh?.compactness_m2 ? sh.compactness_m2.mean / 2500 : null,
      sh ? dict.body.tactics.compactnessWhy : undefined],
    [dict.body.tactics.shapeVariability, sh?.variability != null ? `${Math.round(sh.variability * 100)} %` : "—", sh?.variability ?? null, sh ? dict.body.tactics.shapeVariabilityWhy : undefined],
  ];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Panel id="p05-s02" title="Team Shape & Formation" info={`${dict.body.tactics.formationShapePerTeam} ${dict.body.tactics.needsPitchTeamEvents}`} focus={focus}>
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden className="h-6 w-6 rounded-full" style={{ background: side?.colour ? `#${side.colour.replace(/^#/, "")}` : "#7ab6ff" }} />
          {sides.length ? (
            <FlowSel label={dict.body.tactics.teamForShape} value={String(sides.indexOf(side!))} onChange={setPick}
              options={sides.map((x, i) => [String(i), x.label] as Opt<string>)} />
          ) : <span className="text-sm font-semibold">{dict.body.tactics.noTeamSelected}</span>}
          {currentFormation && currentFormation.is_calibrated ? (
            <span className="flex items-center gap-2">
              <span className="t-section">{currentFormation.formation_display}</span>
              {currentFormation.state === "CONFIRMED" ? (
                <span className="rounded bg-[rgba(16,185,129,0.18)] px-1.5 py-0.5 text-xs font-semibold text-[#10b981]"
                  title={currentFormation.decided_by_name ? dict.body.tactics.confirmedByName.replace("{a}", currentFormation.decided_by_name) : dict.body.tactics.confirmedByAnalyst}>{dict.body.tactics.confirmedCheck}</span>
              ) : (
                <button type="button" onClick={() => void confirmFormation(currentFormation.formation)}
                  className="rounded bg-[rgba(168,85,247,0.18)] px-1.5 py-0.5 text-xs font-semibold text-[#a855f7]"
                  title={dict.body.tactics.clickConfirmFormation}>Inferred (Confirm?)</button>
              )}
            </span>
          ) : (
            <span title={currentFormation?.not_measured_reason ?? NM.formation ?? dict.body.tactics.formationNotMeasured} className="t-section">—</span>
          )}
          <FlowSel label={dict.body.tactics.formationPeriod} value={formPeriod.toLowerCase()}
            onChange={(v) => setFormPeriod(v === "h1" ? "H1" : v === "h2" ? "H2" : "FULL")}
            options={[["full", dict.body.tactics.fullMatchOption], ["h1", dict.body.workspace.firstHalfLower], ["h2", dict.body.workspace.secondHalfLower]]} />
        </div>
        <FlowPitch>
          {sh ? <ShapePicture shape={sh} /> : (
            <NotMeasuredFlow>{!runId ? dict.body.tactics.notMeasuredNoAnalysis : !side ? dict.body.tactics.notMeasuredNoColours : shape === "loading" ? dict.body.tactics.measuring
              : shape ? dict.body.tactics.notMeasuredNoMoment.replace("{a}", String(shape.min_players)) : dict.body.tactics.notMeasuredTracking}</NotMeasuredFlow>
          )}
        </FlowPitch>
        {sh && <p className="text-center text-sm text-[#e8f5ec]">{dict.body.tactics.wherePlayersStand.replace("{a}", String(sh.moments)).replace("{b}", String(sh.min_players)).replace("{c}", String(sh.players_per_moment))}</p>}
      </Panel>

      <Panel title={`${dict.body.tactics.teamMetrics} ${dict.body.tactics.currentPhase}`}>
        <dl className="m-0 flex flex-col gap-2">
          {metric.map(([l, v, frac, why]) => (
            <div key={l} title={why} data-metric={l} className="flex items-center gap-2 text-sm">
              <span className="w-[150px] shrink-0 text-[#cfdcf0]">{l}</span>
              <span className="h-2 flex-1 rounded bg-[#17304f]"><span className="block h-2 rounded bg-[#33a8ff]" style={{ width: frac != null ? `${Math.max(2, Math.min(100, frac * 100))}%` : 0 }} /></span>
              <span className="w-16 shrink-0 text-right font-semibold">{v}</span>
            </div>
          ))}
        </dl>
        <h3 className="t-panel mt-1">{dict.body.tactics.formationStability}</h3>
        <div className="flex items-center gap-2" title={currentFormation?.not_measured_reason ?? NM.formation ?? dict.body.tactics.needsFormation}>
          <div className="flex flex-1 gap-[2px]" aria-hidden>
            {Array.from({ length: 20 }, (_, k) => {
              const filled = currentFormation?.stability_pct != null && (k / 20) < (currentFormation.stability_pct / 100);
              return <span key={k} className="h-2 flex-1" style={{ background: filled ? "#33a8ff" : "#17304f" }} />;
            })}
          </div>
          <span className="t-metric text-primary">{currentFormation?.stability_pct != null ? `${currentFormation.stability_pct} %` : "—"}</span>
        </div>
        {([[dict.body.tactics.buildUpShape, currentFormation?.buildup_shape ?? "—", dict.body.tactics.inPossessionTitle], [dict.body.tactics.defensiveShape, currentFormation?.defensive_shape ?? "—", dict.body.tactics.outOfPossessionTitle]] as const).map(([l, shapeVal, phase]) => (
          <div key={l} className="flex items-center gap-2 text-sm">
            <span className="w-[150px] shrink-0 text-[#cfdcf0]">{l}</span>
            <span title={currentFormation?.not_measured_reason ?? NM.phases ?? dict.body.tactics.needsCalibratedPositions} className="font-semibold">{shapeVal}</span>
            <span aria-hidden className="inline-block h-3.5 w-3.5 rotate-45 bg-[#19e6a0]" />
            <span className="text-[#cfdcf0]">{phase}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}

/** The two sides of the heat-zone panel: the kit groups a person assigned to the match's home and away club, else the two largest colour
 * groups not marked "not a team" (labelled as colour groups, not teams). */
export function heatSides(kits: RunTeams | null, match: Match | null, d?: Dictionary): { label: string; groups: number[]; colour: string | null; assigned: boolean }[] {
  const dict = d ?? getDictionary("en");
  const groups = kits?.groups ?? [];
  const clubs = [match?.home, match?.away].filter((c): c is NonNullable<Match["home"]> => !!c);
  const byClub = clubs.map((c) => ({ label: c.name, groups: groups.filter((g) => g.assignment?.club_id === c.id).map((g) => g.kit_group),
    colour: groups.find((g) => g.assignment?.club_id === c.id)?.kit_rgb ?? null, assigned: true }));
  if (byClub.length === 2 && byClub.every((x) => x.groups.length)) return byClub;
  return groups.filter((g) => !(g.assignment && g.assignment.club_id === null)).sort((a, b) => b.tracks - a.tracks).slice(0, 2)      // not "not a team"
    .map((g, i) => ({ label: dict.body.tactics.colourGroupN.replace("{a}", String(i + 1)), groups: [g.kit_group], colour: g.kit_rgb, assigned: false }));
}

/** heat zones of several kit groups added together */
export function useTeamHeat(runId: string | null, groups: number[], key: unknown): HeatZones | null | "loading" {
  const [z, setZ] = useState<HeatZones | null | "loading">(null);
  const g = groups.join(",");
  useEffect(() => {
    setZ(null);
    if (!runId || !g) return;
    let live = true;
    setZ("loading");
    Promise.all(g.split(",").map((k) => api<HeatZones>(`/v1/analysis-runs/${runId}/heat-zones?kit_group=${k}`))).then((all) => {
      if (!live || !all.length) return;
      const first = all[0]!;
      setZ({ ...first, subject: { kind: "KIT_GROUP", id: g }, seconds: first.seconds.map((_, i) => all.reduce((t, a) => t + a.seconds[i]!, 0)),
        seen_s: all.reduce((t, a) => t + a.seen_s, 0), measured_s: all.reduce((t, a) => t + a.measured_s, 0) });
    }, () => { if (live) setZ(null); });
    return () => { live = false; };
  }, [runId, g, key]);
  return z;
}

export function TeamHeat({ runId, side, calKey }: { runId: string | null; side: { label: string; groups: number[] } | undefined; calKey: unknown; x?: number; y?: number; w?: number; h?: number }) {
  const { t: dict } = useLocale();
  const z = useTeamHeat(runId, side?.groups ?? [], calKey);
  if (z && z !== "loading" && z.measured_s > 0) {
    return (
      <div data-team-heat={side?.label}>
        <div className="aspect-[105/68] w-full"><HeatPitch zones={z} label={dict.body.workspace.heatZonesOf.replace("{a}", side?.label ?? "")} /></div>
        <div title={dict.body.workspace.halfNote} className="text-center text-xs text-[#e8f5ec]">{measuredText(z, dict)}</div>
      </div>
    );
  }
  const why = !runId ? dict.body.tactics.noFinishedAnalysis : !side ? dict.body.tactics.noTeamColours : z === "loading" ? dict.common.loading : z ? dict.body.tactics.noPitchPositionYet : dict.body.tactics.noData;
  return <p className="grid aspect-[105/68] w-full place-items-center rounded-md border border-line bg-[#1d5a2e] text-center text-sm text-[#cfe3d8]">{why}</p>;
}

export function AnalysisPanels({ focus, match, runId = null, kits = null, calKey = 0, videoId = null, onSeek }: { focus: string | null; match: Match | null; runId?: string | null; kits?: RunTeams | null; calKey?: unknown; videoId?: string | null; onSeek?: (us: number) => void }) {
  const { t: dict } = useLocale();
  const sides = heatSides(kits, match, dict);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel id="p05-s05" title={dict.body.workspace.passNetworkMode} info={`${dict.body.tactics.whoPassesToWhom} ${dict.body.tactics.needsPitchTeamEvents}`} focus={focus === "p05-s05"}>
          <div className="flex flex-wrap gap-2">
            <FlowSel label={dict.body.tactics.passNetworkTeam} value="none" options={teamOpts(match, dict)} />
            <FlowSel label={dict.body.tactics.passNetworkTimeRange} value="none" options={range(dict)} />
          </div>
          <FlowPitch><NotMeasuredFlow /></FlowPitch>
          <div data-spec-summary aria-label={dict.body.tactics.legendPassWidth} className="flex flex-col gap-1 text-sm text-[#cfdcf0]">
            <span className="font-semibold">{dict.body.processing.eventPasses}</span>
            {([["1-3", 2], ["4-6", 4], ["7-10", 6], ["10+", 9]] as const).map(([l, w]) => (
              <span key={l} className="flex items-center gap-2"><i className="inline-block w-10 rounded" style={{ height: w, background: l === "10+" ? "#dbe8ff" : "#1a8cff" }} />{l}</span>
            ))}
            <span className="flex items-center gap-2"><i className="inline-block h-[3px] w-10 bg-[#1a8cff]" />{dict.body.tactics.successful}</span>
            <span className="flex items-center gap-2"><i className="inline-block h-0 w-10 border-t-[3px] border-dashed border-[#ff3a3a]" />{dict.body.tactics.unsuccessful}</span>
          </div>
        </Panel>

        <Panel id="p05-s06" title={dict.body.tactics.possessionHeatZones} focus={focus === "p05-s06"}>
          <div className="grid grid-cols-2 gap-4">
            {([0, 1] as const).map((i) => (
              <div key={i} role="group" aria-label={dict.body.tactics.heatZonesPossession.replace("{a}", sides[i]?.label ?? (i ? dict.body.workspace.awayTeam : dict.body.workspace.homeTeam))}>
                <div className="mb-1 flex items-center gap-2">
                  <span aria-hidden className="h-5 w-5 rounded-full" style={{ background: sides[i]?.colour ? `#${sides[i]!.colour!.replace(/^#/, "")}` : i ? "#e8d9a0" : "#7ab6ff" }} />
                  <span className="truncate text-sm font-semibold">{sides[i]?.label ?? (i ? dict.body.workspace.awayTeam : dict.body.workspace.homeTeam)}</span>
                </div>
                <TeamHeat runId={runId} side={sides[i]} calKey={calKey} />
                <p className="mt-1 text-sm text-[#cfdcf0]">{dict.body.tactics.possessionLabel} <span className="t-metric text-primary">—</span></p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <PressingPanel videoId={videoId} focus={focus === "p05-s07"} match={match} onSeek={onSeek} />

      <Panel id="p05-s08" title={dict.body.tactics.offBallRuns} info={`${dict.body.tactics.runsWithoutBall} ${dict.body.tactics.needsPitchTeamEvents}`} focus={focus === "p05-s08"}>
        <div className="flex flex-wrap gap-2">
          <FlowSel label={dict.body.tactics.offBallPlayer} value="none"
            options={[["none", dict.body.tactics.selectPlayerOption], ...(match?.roster.length ? match.roster.map((r): Opt<string> => [r.player_id, `${r.jersey_number !== null ? `${r.jersey_number} · ` : ""}${r.display_name}`])
              : [["roster", dict.body.tactics.matchPlayersOption, match ? dict.body.tactics.addRosterAnalysis : dict.body.tactics.linkVideoFirstLower] as Opt<string>])]} />
          <FlowSel label={dict.body.tactics.offBallTimeRange} value="none" options={range(dict)} />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <FlowPitch><NotMeasuredFlow /></FlowPitch>
            <div className="flex flex-col gap-1 text-sm text-[#cfdcf0]">
              {([[dict.body.tactics.offBallRun, "#19d3ff", "- - -"], [dict.body.tactics.leadingRun, "#ffb21a", "- - →"], [dict.body.tactics.supportingRun, "#dbe8ff", "- - -"]] as const).map(([l, c, g]) => (
                <span key={l}><span style={{ color: c }}>{g}</span> {l}</span>
              ))}
              <span><span aria-hidden className="mr-1 inline-block h-3 w-3 rounded-full border-2 border-white" />{dict.body.tactics.runStart}</span>
              <span><span aria-hidden className="mr-1 inline-block h-3 w-3 rounded-full bg-white" />{dict.body.tactics.runEnd}</span>
            </div>
          </div>
          <dl className="m-0 flex flex-col gap-2 text-sm">
            {([
              [dict.body.tactics.totalOffBallRuns, dict.body.tactics.notMeasuredOffBallRuns],
              [dict.body.tactics.progressiveRuns, dict.body.tactics.notMeasuredProgressiveRuns],
              [dict.body.tactics.runsIntoBox, dict.body.tactics.notMeasuredRunsIntoBox],
              [dict.body.tactics.avgRunDistance, dict.body.tactics.notMeasuredAvgRunDistance],
            ] as const).map(([l, why]) => (
              <div key={l} title={why} data-offball-metric={l} className="flex items-center justify-between gap-2">
                <dt className="text-[#cfdcf0]">{l}</dt><dd className="font-semibold">—</dd>
              </div>
            ))}
          </dl>
        </div>
      </Panel>
    </>
  );
}
