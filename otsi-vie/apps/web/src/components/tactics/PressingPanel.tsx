"use client";
/**
 * Page 05 Section 07 — Pressing Map & Pressing Metrics (v3 Phase E.7, ADR-121).
 * Displays High Press Success, Final Third Regains, and Avg Press Height from detected pressures.
 * When pitch calibration exists, places pressing events on the calibrated pitch.
 * Excludes events marked REJECT in event_decisions (E.1).
 */
import { useEffect, useMemo, useState } from "react";
import type { Match, PressingAnalysis } from "@otsi-vie/contracts";
import { B, T, u } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { Box, Head, NotMeasured, Pitch, Sel, type Opt } from "./kit";
import { PHASES } from "./TacticsHeader";

const NEEDS = "Needs calibrated pitch positions and event detection.";

const highlight = (on: boolean) => (on ? { outline: `${u(3)} solid #33a8ff`, outlineOffset: u(2), borderRadius: u(10) } : {});
const Frame = ({ x, y, w, h, on }: { x: number; y: number; w: number; h: number; on: boolean }) =>
  on ? <B x={x} y={y} w={w} h={h} style={{ ...highlight(true), pointerEvents: "none" }} /> : null;

const teamOpts = (m: Match | null): Opt<string>[] => [
  ["none", "Both teams"],
  ...(m ? [m.home, m.away].filter((c): c is NonNullable<Match["home"]> => !!c).map((c): Opt<string> => [c.id, c.name])
    : [["0", "Home team"], ["1", "Away team"]] as Opt<string>[]),
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

  // Pitch canvas dimensions: w=441, h=256, at x=1846, y=879
  const pitchLength = data?.pitch_length_m ?? 105;
  const pitchWidth = data?.pitch_width_m ?? 68;
  const toPitchPixel = (px: number, py: number): [number, number] => {
    const cx = 1846 + 441 / 2 + (px / pitchLength) * 441;
    const cy = 879 + 256 / 2 + (py / pitchWidth) * 256;
    return [cx, cy];
  };

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
      ? "Not measured: requires minimum 10 opponent passes and 3 defensive actions in defensive 60%."
      : "Not measured: requires calibrated pitch coordinates to delineate defensive 60% zone.");

  return (
    <section id="p05-s07" aria-label="Pressing map" data-section="p05-s07">
      <Box x={1830} y={810} w={702} h={340} />
      <Frame x={1830} y={810} w={702} h={340} on={focus} />
      <Head x={1830} y={844} title="Pressing Map" info={`Where and how teams press. ${NEEDS}`} />
      <Sel
        x={2107}
        y={824}
        w={190}
        h={38}
        label="Pressing team"
        value={teamVal}
        options={teamOpts(match)}
        onChange={(v) => setTeamVal(v)}
      />
      <Sel x={2322} y={824} w={192} h={38} label="Pressing phase" value="all" options={PHASES} />
      <Pitch x={1846} y={879} w={441} h={256} />

      {/* When pitch not calibrated, show overlay notice */}
      {(!data || !data.is_calibrated) && <NotMeasured x={2066} y={915} />}

      {/* Render calibrated pressing points on pitch */}
      {data?.is_calibrated && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}>
          {filteredPressures.map((pt) => {
            if (pt.pitch_x === null || pt.pitch_y === null) return null;
            const [cx, cy] = toPitchPixel(pt.pitch_x, pt.pitch_y);
            const isRegain = pt.regain;
            const color = isRegain ? "#19e6a0" : "#2b7bff";
            const shape = isRegain ? "◆" : "●";
            const who = pt.presser_name ?? `Track ${pt.presser_track_id?.slice(-4) ?? ""}`;
            const target = pt.pressed_name ?? `Track ${pt.pressed_track_id?.slice(-4) ?? ""}`;
            const tip = `${who} pressed ${target}${isRegain ? " (Regained)" : ""}${pt.press_height_m ? ` · ${pt.press_height_m}m` : ""}`;

            return (
              <button
                key={pt.id}
                type="button"
                onClick={() => onSeek?.(pt.start_us)}
                title={tip}
                style={{
                  position: "absolute",
                  left: u(cx - 7),
                  top: u(cy - 10),
                  background: "transparent",
                  border: 0,
                  cursor: "pointer",
                  padding: 0,
                  fontSize: u(14),
                  color,
                  lineHeight: 1,
                }}
              >
                {shape}
              </button>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {([
        ["Pressing Event", 888, "#2b7bff", "●"],
        ["Recovery", 916, "#19e6a0", "◆"],
        ["Forced Turnover", 945, "#ff3a3a", "▲"],
      ] as const).map(([l, y, c, g]) => (
        <div key={l}>
          <T x={2325} y={y} size={18} color={c}>{g}</T>
          <T x={2359} y={y} size={19} color="#cfdcf0">{l}</T>
        </div>
      ))}

      <T x={2315} y={980} size={18}>- - →</T>
      <T x={2359} y={980} size={19} color="#cfdcf0">Pressing Direction</T>

      {/* Live Pressing Metrics */}
      <div data-testid="pressing-metrics">
        <div title={ppdaReason} data-metric="PPDA">
          <T x={2315} y={1025} size={18} color="#cfdcf0">PPDA</T>
          <T x={2504} y={1025} size={18} weight={700}>{ppdaText}</T>
        </div>

        <T x={2315} y={1056} size={18} color="#cfdcf0">High Press Success</T>
        <T x={2504} y={1056} size={18} weight={700}>{highPressText}</T>

        <T x={2315} y={1088} size={18} color="#cfdcf0">Final Third Regains</T>
        <T x={2504} y={1088} size={18} weight={700}>{finalThirdText}</T>

        <T x={2315} y={1119} size={18} color="#cfdcf0">Avg Press Height</T>
        <T x={2504} y={1119} size={18} weight={700}>{avgHeightText}</T>
      </div>
    </section>
  );
}
