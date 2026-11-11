"use client";
/**
 * Page 05 Transitions Analysis Panel (v3 Phase E.4, ADR-119).
 * Displays turnover-to-action transitions (attacking regains, shots within 10s, counter-press within 5s).
 * Labelled strictly as Inferred because discrete events are linked across sequence windows.
 * Excludes events marked REJECT in event_decisions (E.1).
 */
import { useEffect, useState } from "react";
import type { TransitionsAnalysis } from "@otsi-vie/contracts";
import { B, T, u } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { Box, Head } from "./kit";
import { useLocale } from "@/lib/i18n";

export function TransitionsPanel({
  videoId,
  focus,
  onSeek,
}: {
  videoId: string | null;
  focus: boolean;
  onSeek?: (us: number) => void;
}) {
  const { t: dict } = useLocale();
  const [data, setData] = useState<TransitionsAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setData(null);
    if (!videoId) return;
    let live = true;
    setLoading(true);
    api<TransitionsAnalysis>(`/v1/videos/${videoId}/transitions`)
      .then((res) => {
        if (live) setData(res);
      })
      .catch(() => {
        if (live) setData(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [videoId]);

  const clock = (us: number) => {
    const s = Math.floor(us / 1e6);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const teams = data?.summary.teams ?? [];

  return (
    <section id="p05-s10" aria-label="Transitions analysis" data-section="p05-s10" style={{ position: "relative" }}>
      <Box x={1460} y={1162} w={1072} h={258} />
      {focus && <B x={1460} y={1162} w={1072} h={258} style={{ outline: `${u(3)} solid #33a8ff`, outlineOffset: u(2), borderRadius: u(10), pointerEvents: "none" }} />}
      <Head
        x={1460}
        y={1193}
        title={dict.body.tactics.transitionsInferred}
        info={dict.body.tactics.transitionsDesc}
      />

      {/* Inferred badge */}
      <span
        style={{
          position: "absolute",
          left: u(1720),
          top: u(1185 - 101),
          fontSize: u(13),
          fontWeight: 700,
          padding: `${u(2)} ${u(8)}`,
          borderRadius: u(4),
          background: "rgba(51, 168, 255, 0.15)",
          color: "#33a8ff",
          border: `${u(1)} solid rgba(51, 168, 255, 0.4)`,
        }}
      >{dict.body.tactics.inferredLabel}
      </span>

      {!videoId ? (
        <T x={1996} y={1290} size={19} color="#8ea3bf" align="center">{dict.body.tactics.noVideoSelected}
        </T>
      ) : loading ? (
        <T x={1996} y={1290} size={19} color="#8ea3bf" align="center">{dict.body.tactics.computingTransitions}
        </T>
      ) : !data || data.state === "NONE" || teams.length === 0 ? (
        <T x={1996} y={1290} size={19} color="#8ea3bf" align="center" style={{ maxWidth: u(600) }}>
          {dict.body.tactics.transitionsAppear}
        </T>
      ) : (
        <div style={{ position: "absolute", left: u(1480), top: u(1230 - 101), width: u(1032), height: u(175), display: "flex", gap: u(16) }}>
          {/* Team KPI comparison columns */}
          <div style={{ width: u(420), display: "flex", flexDirection: "column", gap: u(8), borderRight: `${u(1)} solid #142f55`, paddingRight: u(16) }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", fontSize: u(14), color: "#8ea3bf", fontWeight: 600 }}>
              <span>{dict.body.tactics.metricLabel}</span>
              <span style={{ textAlign: "right", color: "#7ab6ff" }}>{teams[0]?.name ?? dict.body.workspace.kitLabel.replace("{a}", String(teams[0]?.kit_group ?? 0))}</span>
              <span style={{ textAlign: "right", color: "#e8d9a0" }}>{teams[1]?.name ?? dict.body.workspace.kitLabel.replace("{a}", String(teams[1]?.kit_group ?? 1))}</span>
            </div>
            {[
              [dict.body.tactics.turnoversWon, teams[0]?.attacking_transitions ?? 0, teams[1]?.attacking_transitions ?? 0],
              [dict.body.tactics.shotsFromRegain, teams[0]?.shots_from_transitions ?? 0, teams[1]?.shots_from_transitions ?? 0],
              [dict.body.tactics.possessionRetained, teams[0]?.transitions_retained ?? 0, teams[1]?.transitions_retained ?? 0],
              [dict.body.tactics.turnoversLost5s, teams[0]?.transitions_lost ?? 0, teams[1]?.transitions_lost ?? 0],
              [dict.body.tactics.counterPress5s, teams[0]?.counter_press_regains ?? 0, teams[1]?.counter_press_regains ?? 0],
              [
                dict.body.tactics.avgTimeToAction,
                teams[0]?.avg_duration_to_action_s != null ? `${teams[0]?.avg_duration_to_action_s}s` : "—",
                teams[1]?.avg_duration_to_action_s != null ? `${teams[1]?.avg_duration_to_action_s}s` : "—",
              ],
            ].map(([label, val1, val2]) => (
              <div key={String(label)} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", fontSize: u(14), color: "#cfdcf0" }}>
                <span>{label}</span>
                <span style={{ textAlign: "right", fontWeight: 700 }}>{val1}</span>
                <span style={{ textAlign: "right", fontWeight: 700 }}>{val2}</span>
              </div>
            ))}
          </div>

          {/* Chronological transitions event stream */}
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: u(6) }}>
            <div style={{ fontSize: u(13), color: "#8ea3bf", fontWeight: 600, marginBottom: u(2) }}>
              {dict.body.tactics.recentTransitions.replace("{a}", String(data.items.length))}
            </div>
            {data.items.length === 0 ? (
              <div style={{ fontSize: u(14), color: "#8ea3bf", padding: u(12) }}>{dict.body.tactics.noTurnovers}</div>
            ) : (
              data.items.slice(0, 8).map((it) => (
                <div
                  key={it.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: `${u(4)} ${u(8)}`,
                    background: "rgba(18, 48, 90, 0.4)",
                    borderRadius: u(4),
                    fontSize: u(13),
                    cursor: onSeek ? "pointer" : "default",
                  }}
                  onClick={() => onSeek && onSeek(it.trigger_pts_us)}
                >
                  <span style={{ color: "#9fb3cc", width: u(50) }}>{clock(it.trigger_pts_us)}</span>
                  <span style={{ fontWeight: 600, color: it.kit_group === 0 ? "#7ab6ff" : "#e8d9a0" }}>
                    {it.trigger_kind.replace("_", " ")}
                  </span>
                  <span style={{ color: "#8ea3bf" }}>→</span>
                  <span
                    style={{
                      fontWeight: 600,
                      color:
                        it.next_action.outcome === "SHOT" || it.next_action.outcome === "GOAL"
                          ? "#19d3ff"
                          : it.next_action.outcome === "KEY_PASS"
                          ? "#19e6c0"
                          : it.next_action.outcome === "DISPOSSESSED"
                          ? "#f87171"
                          : "#dbe8ff",
                    }}
                  >
                    {it.next_action.outcome} ({it.next_action.duration_s}s)
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
}
