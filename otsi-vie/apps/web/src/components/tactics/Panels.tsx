"use client";
/**
 * Page 05 Sections 02, 03, 05, 06, 07, 08 — team shape and formation, team shape metrics, pass network, possession and heat zones,
 * pressing map, off-ball runs (approved reference 05_TACTICAL_INTELLIGENCE, corrected clean state).
 *
 * Heat zones are measured (promise 2): each side shows where its players were, from calibrated pitch positions only, with how much of the
 * time was measured. Team shape is measured (promise 3) at moments where at least 8 of a team stand on a measured pitch: width, length,
 * compactness (outline area) and how much it varies, and where players stand around the team's centre; formation, defensive-line height
 * and the in/out-of-possession shapes stay "—" with their reason. The rest is not measured yet (team shape, passes, pressing, off-ball runs, possession): every value is "—" and every
 * pitch says "Not measured"; the circled "i" says what each panel needs. Nothing is drawn that was not measured.
 */
import { B, T, u } from "@/components/stage/DesignStage";
import { type FormationsAnalysis, type FormationName, type HeatZones, type Match, type RunTeams, SHAPE_COLS, SHAPE_ROWS, SHAPE_SPAN_M, type TeamFormation, type TeamShape } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { HeatPitch, measuredText } from "@/components/workspace/HeatPitch";
import { Box, Head, NotMeasured, Pitch, Sel, type Opt } from "./kit";
import { PressingPanel } from "./PressingPanel";
import { getDictionary, useLocale, type Dictionary } from "@/lib/i18n";

/** the linked match's two teams (choosable: the panel shows the choice; its numbers stay "not measured"), or why there are none */
const teamOpts = (m: Match | null, d: Dictionary): Opt<string>[] => [["none", d.body.tactics.selectTeam],
  ...(m ? [m.home, m.away].filter((c): c is NonNullable<Match["home"]> => !!c).map((c): Opt<string> => [c.id, c.name])
    : [["link", d.body.tactics.homeAwayTeam, d.body.tactics.linkVideoFirstLower] as Opt<string>])];
const range = (d: Dictionary): Opt<string>[] => [["none", d.body.tactics.timeRangeLower], ["full", d.body.tactics.fullMatchLower], ["h1", d.body.workspace.firstHalfLower, d.body.tactics.matchPeriodsNotRecorded], ["h2", d.body.workspace.secondHalfLower, d.body.tactics.matchPeriodsNotRecorded]];

const highlight = (on: boolean) => (on ? { outline: `${u(3)} solid #33a8ff`, outlineOffset: u(2), borderRadius: u(10) } : {});
const Frame = ({ x, y, w, h, on }: { x: number; y: number; w: number; h: number; on: boolean }) =>
  on ? <B x={x} y={y} w={w} h={h} style={{ ...highlight(true), pointerEvents: "none" }} /> : null;

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
function ShapePicture({ shape, x, y, w, h }: { shape: TeamShape; x: number; y: number; w: number; h: number }) {
  const max = Math.max(0, ...shape.density);
  const [sx, sy] = SHAPE_SPAN_M;
  return (
    <svg aria-label={`Team shape: where players stand around the team's centre, over ${shape.moments} moments`} role="img" data-team-shape
      viewBox={`${-105 / 2} ${-68 / 2} 105 68`} preserveAspectRatio="none" style={{ position: "absolute", left: u(x), top: u(y - 101), width: u(w), height: u(h) }}>
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

  const metric: [string, number, string, number | null, string | undefined][] = [
    [dict.body.tactics.averageWidth, 411, ofStat(sh?.width_m ?? null, "m"), sh?.width_m ? sh.width_m.mean / 68 : null, sh?.width_m ? dict.body.tactics.statP10P90.replace("{a}", String(sh.width_m.p10)).replace("{b}", String(sh.width_m.p90)) : undefined],
    [dict.body.tactics.averageLength, 451, ofStat(sh?.length_m ?? null, "m"), sh?.length_m ? sh.length_m.mean / 105 : null, sh?.length_m ? dict.body.tactics.statP10P90.replace("{a}", String(sh.length_m.p10)).replace("{b}", String(sh.length_m.p90)) : undefined],
    [dict.body.tactics.defLineHeight, 492, defLineHeightStr, defLineHeightFrac, defLineHeightWhy],
    [dict.body.tactics.compactnessDef, 532, sh?.compactness_m2 ? `${Math.round(sh.compactness_m2.mean)} m²` : "—", sh?.compactness_m2 ? sh.compactness_m2.mean / 2500 : null,
      sh ? dict.body.tactics.compactnessWhy : undefined],
    [dict.body.tactics.shapeVariability, 574, sh?.variability != null ? `${Math.round(sh.variability * 100)} %` : "—", sh?.variability ?? null, sh ? dict.body.tactics.shapeVariabilityWhy : undefined],
  ];
  return (
    <>
      <section id="p05-s02" aria-label="Team shape and formation pitch" data-section="p05-s02">
        <Box x={432} y={300} w={1228} h={497} />
        <Frame x={432} y={300} w={1228} h={497} on={focus} />
        <Head x={432} y={323} title="Team Shape & Formation" info={`${dict.body.tactics.formationShapePerTeam} ${dict.body.tactics.needsPitchTeamEvents}`} />
        <Box x={447} y={350} w={735} h={433} border="#142f55" />
        <B x={455} y={360} w={37} h={37} style={{ borderRadius: "50%", background: side?.colour ? `#${side.colour.replace(/^#/, "")}` : "#7ab6ff" }} />
        {sides.length ? (
          <Sel x={500} y={360} w={260} h={37} label={dict.body.tactics.teamForShape} value={String(sides.indexOf(side!))} onChange={setPick}
            options={sides.map((x, i) => [String(i), x.label] as Opt<string>)} />
        ) : <T x={505} y={378} size={23} weight={700}>{dict.body.tactics.noTeamSelected}</T>}
        {currentFormation && currentFormation.is_calibrated ? (
          <div style={{ position: "absolute", left: u(780), top: u(358), display: "flex", alignItems: "center", gap: u(8) }}>
            <T x={0} y={18} size={22} weight={700} style={{ position: "static" }}>{currentFormation.formation_display}</T>
            {currentFormation.state === "CONFIRMED" ? (
              <span style={{ fontSize: u(11), color: "#10b981", background: "rgba(16,185,129,0.18)", padding: `${u(2)} ${u(6)}`, borderRadius: u(4), fontWeight: 600 }}
                title={currentFormation.decided_by_name ? dict.body.tactics.confirmedByName.replace("{a}", currentFormation.decided_by_name) : dict.body.tactics.confirmedByAnalyst}>{dict.body.tactics.confirmedCheck}</span>
            ) : (
              <button type="button" onClick={() => void confirmFormation(currentFormation.formation)}
                style={{ fontSize: u(11), color: "#a855f7", background: "rgba(168,85,247,0.18)", padding: `${u(2)} ${u(6)}`, borderRadius: u(4), fontWeight: 600, border: 0, cursor: "pointer" }}
                title={dict.body.tactics.clickConfirmFormation}>Inferred (Confirm?)</button>
            )}
          </div>
        ) : (
          <span title={currentFormation?.not_measured_reason ?? NM.formation ?? dict.body.tactics.formationNotMeasured}><T x={849} y={378} size={21} weight={700} align="center">—</T></span>
        )}
        <Sel x={1049} y={360} w={118} h={37} label={dict.body.tactics.formationPeriod} value={formPeriod.toLowerCase()}
          onChange={(v) => setFormPeriod(v === "h1" ? "H1" : v === "h2" ? "H2" : "FULL")}
          options={[["full", dict.body.tactics.fullMatchOption], ["h1", dict.body.workspace.firstHalfLower], ["h2", dict.body.workspace.secondHalfLower]]} />
        <Pitch x={447} y={404} w={735} h={379} />
        {sh ? (
          <>
            <ShapePicture shape={sh} x={447} y={404} w={735} h={379} />
            <T x={814} y={772} size={15} color="#e8f5ec" align="center" style={{ textShadow: "0 0 3px #000" }}>
              {dict.body.tactics.wherePlayersStand.replace("{a}", String(sh.moments)).replace("{b}", String(sh.min_players)).replace("{c}", String(sh.players_per_moment))}</T>
          </>
        ) : (
          <NotMeasured x={814} y={470}>{!runId ? dict.body.tactics.notMeasuredNoAnalysis : !side ? dict.body.tactics.notMeasuredNoColours : shape === "loading" ? dict.body.tactics.measuring
            : shape ? dict.body.tactics.notMeasuredNoMoment.replace("{a}", String(shape.min_players)) : dict.body.tactics.notMeasuredTracking}</NotMeasured>
        )}
      </section>

      <section aria-label={dict.body.tactics.teamShapeMetrics} data-section="p05-s03">
        <Box x={1206} y={350} w={444} h={260} border="#142f55" />
        <T x={1226} y={374} size={20} weight={700} as="h3">{dict.body.tactics.teamMetrics}<span style={{ color: "#8ea3bf", fontWeight: 400 }}>{dict.body.tactics.currentPhase}</span></T>
        <dl style={{ margin: 0 }}>
          {metric.map(([l, y, v, frac, why]) => (
            <div key={l} title={why} data-metric={l}>
              <T x={1226} y={y} size={21} color="#cfdcf0" as="span">{l}</T>
              <B x={1410} y={y - 4} w={150} h={9} style={{ background: "#17304f", borderRadius: u(4) }} />
              {frac != null && <B x={1410} y={y - 4} w={150 * Math.max(0.02, Math.min(1, frac))} h={9} style={{ background: "#33a8ff", borderRadius: u(4) }} />}
              <T x={1583} y={y} size={19} weight={700} as="span">{v}</T>
            </div>
          ))}
        </dl>
        <Box x={1206} y={620} w={444} h={160} border="#142f55" />
        <T x={1226} y={645} size={22} color="#dbe8f8" as="h3">{dict.body.tactics.formationStability}</T>
        <span title={currentFormation?.not_measured_reason ?? NM.formation ?? dict.body.tactics.needsFormation}>
          <T x={1584} y={645} size={24} weight={700} color="#33a8ff">{currentFormation?.stability_pct != null ? `${currentFormation.stability_pct} %` : "—"}</T>
        </span>
        {Array.from({ length: 20 }, (_, k) => {
          const filled = currentFormation?.stability_pct != null && (k / 20) < (currentFormation.stability_pct / 100);
          return <B key={k} x={1226 + k * 20.1} y={666} w={18} h={9} style={{ background: filled ? "#33a8ff" : "#17304f" }} />;
        })}
        {([[dict.body.tactics.buildUpShape, 710, currentFormation?.buildup_shape ?? "—", dict.body.tactics.inPossessionTitle], [dict.body.tactics.defensiveShape, 756, currentFormation?.defensive_shape ?? "—", dict.body.tactics.outOfPossessionTitle]] as const).map(([l, y, shapeVal, phase]) => (
          <div key={l}>
            <T x={1226} y={y} size={20} color="#cfdcf0">{l}</T>
            <span title={currentFormation?.not_measured_reason ?? NM.phases ?? dict.body.tactics.needsCalibratedPositions}><T x={1385} y={y} size={21} weight={700}>{shapeVal}</T></span>
            <B x={1450} y={y - 7} w={14} h={14} style={{ background: "#19e6a0", transform: "rotate(45deg)" }} />
            <T x={1480} y={y} size={19} color="#cfdcf0">{phase}</T>
          </div>
        ))}
      </section>
    </>
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
function useTeamHeat(runId: string | null, groups: number[], key: unknown): HeatZones | null | "loading" {
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

export function TeamHeat({ runId, side, x, y, w, h, calKey }: { runId: string | null; side: { label: string; groups: number[] } | undefined; x: number; y: number; w: number; h: number; calKey: unknown }) {
  const { t: dict } = useLocale();
  const z = useTeamHeat(runId, side?.groups ?? [], calKey);
  if (z && z !== "loading" && z.measured_s > 0) {
    return (
      <div data-team-heat={side?.label} style={{ position: "absolute", left: u(x), top: u(y - 101), width: u(w), height: u(h) }}>
        <HeatPitch zones={z} label={dict.body.workspace.heatZonesOf.replace("{a}", side?.label ?? "")} />
        <div title={dict.body.workspace.halfNote} style={{ position: "absolute", left: 0, right: 0, bottom: u(2), fontSize: u(13), color: "#e8f5ec", textAlign: "center", textShadow: "0 0 3px #000" }}>{measuredText(z, dict)}</div>
      </div>
    );
  }
  const why = !runId ? dict.body.tactics.noFinishedAnalysis : !side ? dict.body.tactics.noTeamColours : z === "loading" ? dict.common.loading : z ? dict.body.tactics.noPitchPositionYet : dict.body.tactics.noData;
  return <T x={x + w / 2} y={y + h / 2} size={20} color="#cfe3d8" align="center">{why}</T>;
}

export function AnalysisPanels({ focus, match, runId = null, kits = null, calKey = 0, videoId = null, onSeek }: { focus: string | null; match: Match | null; runId?: string | null; kits?: RunTeams | null; calKey?: unknown; videoId?: string | null; onSeek?: (us: number) => void }) {
  const { t: dict } = useLocale();
  const sides = heatSides(kits, match, dict);
  return (
    <>
      <section id="p05-s05" aria-label={dict.body.tactics.passNetwork} data-section="p05-s05">
        <Box x={432} y={810} w={650} h={340} />
        <Frame x={432} y={810} w={650} h={340} on={focus === "p05-s05"} />
        <Head x={432} y={842} title={dict.body.workspace.passNetworkMode} info={`${dict.body.tactics.whoPassesToWhom} ${dict.body.tactics.needsPitchTeamEvents}`} />
        <Sel x={667} y={824} w={191} h={38} label={dict.body.tactics.passNetworkTeam} value="none" options={teamOpts(match, dict)} />
        <Sel x={881} y={824} w={185} h={38} label={dict.body.tactics.passNetworkTimeRange} value="none" options={range(dict)} />
        <Pitch x={445} y={879} w={447} h={256} />
        <NotMeasured x={668} y={915} />
        {/* legend of the approved design (line width = number of passes), not a measurement */}
        <div data-spec-summary aria-label={dict.body.tactics.legendPassWidth}>
          <T x={919} y={917} size={19} color="#cfdcf0">{dict.body.processing.eventPasses}</T>
          {([["1-3", 950, 2], ["4-6", 979, 4], ["7-10", 1008, 6], ["10+", 1037, 9]] as const).map(([l, y, w]) => (
            <div key={l}>
              <B x={919} y={y - w / 2} w={40} h={w} style={{ background: l === "10+" ? "#dbe8ff" : "#1a8cff", borderRadius: u(3) }} />
              <T x={974} y={y} size={18} color="#cfdcf0">{l}</T>
            </div>
          ))}
        </div>
        <B x={919} y={1075} w={40} h={3} style={{ background: "#1a8cff" }} />
        <T x={974} y={1076} size={18} color="#cfdcf0">{dict.body.tactics.successful}</T>
        <B x={919} y={1103} w={40} h={0} style={{ borderTop: `${u(3)} dashed #ff3a3a` }} />
        <T x={974} y={1104} size={18} color="#cfdcf0">{dict.body.tactics.unsuccessful}</T>
      </section>

      <section id="p05-s06" aria-label={dict.body.tactics.possessionHeatZonesLower} data-section="p05-s06">
        <Box x={1103} y={810} w={705} h={340} />
        <Frame x={1103} y={810} w={705} h={340} on={focus === "p05-s06"} />
        <Head x={1103} y={842} title={dict.body.tactics.possessionHeatZones} />
        <div role="tablist" aria-label={dict.body.tactics.zoneView}>
          <B x={1440} y={822} w={122} h={43} style={{ background: "#0d5ac0", borderRadius: u(6), fontSize: u(19), fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{dict.body.workspace.heatmapMode}</B>
          <B x={1562} y={822} w={240} h={43} style={{ border: `${u(1.5)} solid #17355f`, borderRadius: `0 ${u(6)} ${u(6)} 0`, background: "#0a1d38" }} />
          <T x={1592} y={844} size={18} color="#8ea3bf">{dict.body.tactics.territory}</T>
          <T x={1709} y={844} size={18} color="#8ea3bf">{dict.body.tactics.finalThirds}</T>
        </div>
        {([[1126, 1166, "#7ab6ff", dict.body.workspace.homeTeam, 1125, 310, 1280, 1122, 1213, "#1a8cff"], [1480, 1521, "#e8d9a0", dict.body.workspace.awayTeam, 1480, 307, 1633, 1477, 1568, "#fff"]] as const).map(
          ([cx, tx, c, team, px, pw, , lx, bx], i) => (
            <div key={team} role="group" aria-label={dict.body.tactics.heatZonesPossession.replace("{a}", sides[i]?.label ?? team)}>
              <B x={cx} y={878} w={28} h={28} style={{ borderRadius: "50%", background: sides[i]?.colour ? `#${sides[i]!.colour!.replace(/^#/, "")}` : c }} />
              <T x={tx} y={891} size={19} weight={700} style={{ maxWidth: u(260), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sides[i]?.label ?? team}</T>
              <B x={px} y={912} w={pw} h={160} style={{ background: "#1d5a2e", border: `${u(2)} solid #cfe3d8` }} />
              <TeamHeat runId={runId} side={sides[i]} x={px + 2} y={914} w={pw - 4} h={156} calKey={calKey} />
              <T x={lx} y={1096} size={19} color="#cfdcf0">{dict.body.tactics.possessionLabel}</T>
              <T x={lx} y={1121} size={25} weight={700} color={team === dict.body.workspace.homeTeam ? "#33a8ff" : undefined}>—</T>
              <B x={bx} y={1115} w={220} h={9} style={{ background: "#17304f", borderRadius: u(4) }} />
            </div>
          ))}
      </section>

      <PressingPanel videoId={videoId} focus={focus === "p05-s07"} match={match} onSeek={onSeek} />

      <section id="p05-s08" aria-label="Off-ball run analysis" data-section="p05-s08">
        <Box x={432} y={1162} w={1008} h={258} />
        <Frame x={432} y={1162} w={1008} h={258} on={focus === "p05-s08"} />
        <Head x={432} y={1193} title={dict.body.tactics.offBallRuns} info={`${dict.body.tactics.runsWithoutBall} ${dict.body.tactics.needsPitchTeamEvents}`} />
        <Sel x={658} y={1176} w={234} h={36} label={dict.body.tactics.offBallPlayer} value="none"
          options={[["none", dict.body.tactics.selectPlayerOption], ...(match?.roster.length ? match.roster.map((r): Opt<string> => [r.player_id, `${r.jersey_number !== null ? `${r.jersey_number} · ` : ""}${r.display_name}`])
            : [["roster", dict.body.tactics.matchPlayersOption, match ? dict.body.tactics.addRosterAnalysis : dict.body.tactics.linkVideoFirstLower] as Opt<string>])]} />
        <Sel x={917} y={1176} w={187} h={36} label={dict.body.tactics.offBallTimeRange} value="none" options={range(dict)} />
        <Pitch x={447} y={1230} w={460} h={177} />
        <NotMeasured x={677} y={1262} size={20} />
        {([[dict.body.tactics.offBallRun, 1265, "#19d3ff", "- - -"], [dict.body.tactics.leadingRun, 1294, "#ffb21a", "- - →"], [dict.body.tactics.supportingRun, 1324, "#dbe8ff", "- - -"]] as const).map(([l, y, c, g]) => (
          <div key={l}><T x={946} y={y} size={18} color={c}>{g}</T><T x={994} y={y} size={19} color="#cfdcf0">{l}</T></div>
        ))}
        <B x={956} y={1350} w={16} h={16} style={{ border: `${u(3)} solid #fff`, borderRadius: "50%" }} />
        <T x={994} y={1357} size={19} color="#cfdcf0">{dict.body.tactics.runStart}</T>
        <B x={956} y={1380} w={16} h={16} style={{ background: "#fff", borderRadius: "50%" }} />
        <T x={994} y={1388} size={19} color="#cfdcf0">{dict.body.tactics.runEnd}</T>
        <Box x={1145} y={1230} w={278} h={177} border="#142f55" />
        {([
          [dict.body.tactics.totalOffBallRuns, 1256, dict.body.tactics.notMeasuredOffBallRuns],
          [dict.body.tactics.progressiveRuns, 1296, dict.body.tactics.notMeasuredProgressiveRuns],
          [dict.body.tactics.runsIntoBox, 1337, dict.body.tactics.notMeasuredRunsIntoBox],
          [dict.body.tactics.avgRunDistance, 1377, dict.body.tactics.notMeasuredAvgRunDistance],
        ] as const).map(([l, y, why]) => (
          <div key={l} title={why} data-offball-metric={l}>
            <T x={1163} y={y} size={19} color="#cfdcf0">{l}</T>
            <T x={1398} y={y} size={19} weight={700}>—</T>
          </div>
        ))}
      </section>
    </>
  );
}
