"use client";
/**
 * Page 05 Section 07 — Pressing Map & Pressing Metrics (v3 Phase E.7, ADR-121), in flow (Desktop UI Drop 2).
 * Displays High Press Success, Final Third Regains, and Avg Press Height from detected pressures.
 * When pitch calibration exists, places pressing events on the calibrated pitch.
 * Excludes events marked REJECT in event_decisions (E.1).
 */
import { useEffect, useMemo, useState } from "react";
import type { Match, PressingAnalysis } from "@otsi-vie/contracts";
import { api } from "@/lib/api";
import { FlowPitch, type Opt } from "./Panels";
import { PHASES } from "./TacticsHeader";
import { useLocale, type Dictionary } from "@/lib/i18n";

const teamOpts = (m: Match | null, d: Dictionary): Opt<string>[] => [
  ["none", d.body.tactics.bothTeams],
  ...(m ? [m.home, m.away].filter((c): c is NonNullable<Match["home"]> => !!c).map((c): Opt<string> => [c.id, c.name])
    : [["0", d.body.workspace.homeTeam], ["1", d.body.workspace.awayTeam]] as Opt<string>[]),
];

export function PressingPanel({
  videoId,
  focus,
  match,
  onSeek,
}: {
  videoId: string | null;
  focus: boolean;
  match: Match | null;
  onSeek?: ((us: number) => void) | undefined;
}) {
  const { t: dict } = useLocale();
  const NEEDS = dict.body.tactics.needsPitchEvents;
  const [data, setData] = useState<PressingAnalysis | null>(null);
  const [teamVal, setTeamVal] = useState<string>("none");

  useEffect(() => {
    setData(null);
    if (!videoId) return;
    let live = true;
    api<PressingAnalysis>(`/v1/videos/${videoId}/pressing`)
      .then((res) => {
        if (live) setData(res);
      })
      .catch(() => {
        if (live) setData(null);
      });
    return () => {
      live = false;
    };
  }, [videoId]);

  // Selected team index (0 = Home/kit0, 1 = Away/kit1, null = all)
  const selectedKit = useMemo(() => {
    if (teamVal === "home" || teamVal === "0") return 0;
    if (teamVal === "away" || teamVal === "1") return 1;
    return null;
  }, [teamVal]);

  const activeStats = useMemo(() => {
    if (!data || !data.teams.length) return null;
    if (selectedKit !== null) {
      return data.teams.find((t) => t.kit_group === selectedKit) ?? null;
    }
    // Aggregate both teams
    const totalPressures = data.teams.reduce((s, t) => s + t.total_pressures, 0);
    const totalRegains = data.teams.reduce((s, t) => s + t.total_regains, 0);
    const highPressures = data.teams.reduce((s, t) => s + t.high_pressures, 0);
    const highRegains = data.teams.reduce((s, t) => s + t.high_press_regains, 0);
    const finalThirdPressures = data.teams.reduce((s, t) => s + t.final_third_pressures, 0);
    const finalThirdRegains = data.teams.reduce((s, t) => s + t.final_third_regains, 0);
    const measured = data.teams.reduce((s, t) => s + t.measured_pressures, 0);

    const sumHeightM = data.pressures
      .filter((p) => p.press_height_m !== null)
      .reduce((s, p) => s + p.press_height_m!, 0);
    const sumHeightPct = data.pressures
      .filter((p) => p.press_height_pct !== null)
      .reduce((s, p) => s + p.press_height_pct!, 0);

    const avgHeightM = measured > 0 ? Math.round((sumHeightM / measured) * 10) / 10 : null;
    const avgHeightPct = measured > 0 ? Math.round((sumHeightPct / measured) * 10) / 10 : null;
    const firstTeam = data.teams[0];

    return {
      total_pressures: totalPressures,
      total_regains: totalRegains,
      overall_success_pct: totalPressures > 0 ? Math.round((totalRegains / totalPressures) * 1000) / 10 : null,
      high_pressures: highPressures,
      high_press_regains: highRegains,
      high_press_success_pct: highPressures > 0 ? Math.round((highRegains / highPressures) * 1000) / 10 : null,
      final_third_pressures: finalThirdPressures,
      final_third_regains: finalThirdRegains,
      avg_press_height_m: avgHeightM,
      avg_press_height_pct: avgHeightPct,
      measured_pressures: measured,
      ppda: firstTeam?.ppda ?? null,
      ppda_status: firstTeam?.ppda_status ?? "NOT_MEASURED",
      ppda_reason: firstTeam?.ppda_reason ?? null,
    };
  }, [data, selectedKit]);

  const filteredPressures = useMemo(() => {
    if (!data) return [];
    if (selectedKit === null) return data.pressures;
    return data.pressures.filter((p) => p.kit_group === selectedKit);
  }, [data, selectedKit]);

  const pitchLength = data?.pitch_length_m ?? 105;
  const pitchWidth = data?.pitch_width_m ?? 68;

  const highPressText = activeStats?.high_press_success_pct !== null && activeStats?.high_press_success_pct !== undefined
    ? `${activeStats.high_press_success_pct}% (${activeStats.high_press_regains}/${activeStats.high_pressures})`
    : activeStats?.total_pressures
      ? "— (uncalibrated)"
      : "—";

  const finalThirdText = activeStats?.final_third_regains !== undefined
    ? String(activeStats.final_third_regains)
    : "—";

  const avgHeightText = activeStats?.avg_press_height_m !== null && activeStats?.avg_press_height_m !== undefined
    ? `${activeStats.avg_press_height_m}m (${activeStats.avg_press_height_pct}%)`
    : "—";

  const ppdaVal = (activeStats as { ppda?: number | null } | null)?.ppda;
  const ppdaText = ppdaVal != null ? String(ppdaVal) : "—";
  const ppdaReason = (activeStats as { ppda_reason?: string | null } | null)?.ppda_reason
    ?? (data?.is_calibrated
      ? dict.body.tactics.notMeasuredPpdaPasses
      : dict.body.tactics.notMeasuredPpdaCoords);

  return (
    <section id="p05-s07" aria-label={dict.body.tactics.pressingMapLower} data-section="p05-s07"
      className={`vie-panel ${focus ? "outline outline-2 outline-offset-2 outline-primary" : ""}`}>
      <div className="vie-ph">
        <h2 className="t-panel"><span aria-hidden className="mr-2 inline-block h-5 w-1.5 rounded bg-primary align-middle" />{dict.body.tactics.pressingMap}
          <span tabIndex={0} role="note" aria-label={`Where and how teams press. ${NEEDS}`} title={`Where and how teams press. ${NEEDS}`} className="ml-2 cursor-help rounded-full border border-line2 px-1.5 text-xs font-normal text-muted">i</span>
        </h2>
        <div className="flex gap-2">
          <select aria-label={dict.body.tactics.pressingTeam} value={teamVal} onChange={(e) => setTeamVal(e.target.value)}
            className="h-8 rounded-md border border-line bg-raised px-2 text-sm text-ink">
            {teamOpts(match, dict).map(([v, l, why]) => <option key={v} value={v} disabled={!!why}>{why ? `${l.trim()} — ${why}` : l.trim()}</option>)}
          </select>
          <select aria-label={dict.body.tactics.pressingPhase} value="all" onChange={() => undefined}
            className="h-8 rounded-md border border-line bg-raised px-2 text-sm text-ink">
            {PHASES(dict).map(([v, l, why]) => <option key={v} value={v} disabled={!!why}>{why ? `${l.trim()} — ${why}` : l.trim()}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 p-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <FlowPitch>
          {(!data || !data.is_calibrated) && (
            <div className="absolute inset-0 grid place-items-center">
              <span className="rounded-md bg-[#07142acc] px-3 py-1 text-sm text-[#e6f3ea]">{dict.body.reports.notMeasured}</span>
            </div>
          )}
          {data?.is_calibrated && filteredPressures.map((pt) => {
            if (pt.pitch_x === null || pt.pitch_y === null) return null;
            const isRegain = pt.regain;
            const color = isRegain ? "#19e6a0" : "#2b7bff";
            const shape = isRegain ? "◆" : "●";
            const who = pt.presser_name ?? dict.body.workspace.trackButton.replace("{a}", pt.presser_track_id?.slice(-4) ?? "");
            const target = pt.pressed_name ?? dict.body.workspace.trackButton.replace("{a}", pt.pressed_track_id?.slice(-4) ?? "");
            const tip = dict.body.tactics.pressedTip.replace("{a}", who).replace("{b}", target).replace("{c}", isRegain ? dict.body.tactics.regainedSuffix : "").replace("{d}", pt.press_height_m ? dict.body.tactics.heightSuffix.replace("{a}", String(pt.press_height_m)) : "");
            return (
              <button key={pt.id} type="button" onClick={() => onSeek?.(pt.start_us)} title={tip}
                className="absolute -translate-x-1/2 -translate-y-1/2 border-0 bg-transparent p-0 text-sm leading-none"
                style={{ left: `${(0.5 + pt.pitch_x / pitchLength) * 100}%`, top: `${(0.5 + pt.pitch_y / pitchWidth) * 100}%`, color, cursor: "pointer" }}>
                {shape}
              </button>
            );
          })}
        </FlowPitch>
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex flex-col gap-1 text-[#cfdcf0]">
            {([
              [dict.body.tactics.pressingEvent, "#2b7bff", "●"],
              [dict.body.tactics.recoveryLabel, "#19e6a0", "◆"],
              [dict.body.tactics.forcedTurnoverLabel, "#ff3a3a", "▲"],
            ] as const).map(([l, c, g]) => (
              <span key={l}><span style={{ color: c }}>{g}</span> {l}</span>
            ))}
            <span>- - → {dict.body.tactics.pressingDirection}</span>
          </div>
          <dl className="m-0 flex flex-col gap-2" data-testid="pressing-metrics">
            <div title={ppdaReason} data-metric="PPDA" className="flex items-center justify-between gap-2">
              <dt className="text-[#cfdcf0]">PPDA</dt><dd className="font-normal">{ppdaText}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#cfdcf0]">{dict.body.tactics.highPressSuccess}</dt><dd className="font-normal">{highPressText}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#cfdcf0]">{dict.body.tactics.finalThirdRegains}</dt><dd className="font-normal">{finalThirdText}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#cfdcf0]">{dict.body.tactics.avgPressHeight}</dt><dd className="font-normal">{avgHeightText}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
