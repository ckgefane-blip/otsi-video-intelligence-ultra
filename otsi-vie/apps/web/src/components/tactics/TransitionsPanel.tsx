"use client";
/**
 * Page 05 Transitions Analysis Panel (v3 Phase E.4, ADR-119), in flow (Desktop UI Drop 2).
 * Displays turnover-to-action transitions (attacking regains, shots within 10s, counter-press within 5s).
 * Labelled strictly as Inferred because discrete events are linked across sequence windows.
 * Excludes events marked REJECT in event_decisions (E.1).
 */
import { useEffect, useState } from "react";
import type { TransitionsAnalysis } from "@otsi-vie/contracts";
import { api } from "@/lib/api";
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
    <section id="p05-s10" aria-label="Transitions analysis" data-section="p05-s10"
      className={`vie-panel ${focus ? "outline outline-2 outline-offset-2 outline-primary" : ""}`}>
      <div className="vie-ph">
        <h2 className="t-panel"><span aria-hidden className="mr-2 inline-block h-5 w-1.5 rounded bg-primary align-middle" />{dict.body.tactics.transitionsInferred}
          <span tabIndex={0} role="note" aria-label={dict.body.tactics.transitionsDesc} title={dict.body.tactics.transitionsDesc} className="ml-2 cursor-help rounded-full border border-line2 px-1.5 text-xs font-normal text-muted">i</span>
        </h2>
        <span className="rounded border border-primary/40 bg-primary/15 px-2 py-0.5 text-xs font-normal text-primary">{dict.body.tactics.inferredLabel}</span>
      </div>
      <div className="p-3">
        {!videoId ? (
          <p className="py-6 text-center text-sm text-muted">{dict.body.tactics.noVideoSelected}</p>
        ) : loading ? (
          <p className="py-6 text-center text-sm text-muted">{dict.body.tactics.computingTransitions}</p>
        ) : !data || data.state === "NONE" || teams.length === 0 ? (
          <p className="mx-auto max-w-xl py-6 text-center text-sm text-muted">{dict.body.tactics.transitionsAppear}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
            {/* Team KPI comparison columns */}
            <div className="flex flex-col gap-2 border-b border-line pb-3 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
              <div className="grid grid-cols-3 t-th">
                <span>{dict.body.tactics.metricLabel}</span>
                <span className="text-right text-[#7ab6ff]">{teams[0]?.name ?? dict.body.workspace.kitLabel.replace("{a}", String(teams[0]?.kit_group ?? 0))}</span>
                <span className="text-right text-[#e8d9a0]">{teams[1]?.name ?? dict.body.workspace.kitLabel.replace("{a}", String(teams[1]?.kit_group ?? 1))}</span>
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
                <div key={String(label)} className="grid grid-cols-3 text-sm text-[#cfdcf0]">
                  <span>{label}</span>
                  <span className="text-right font-normal tabular-nums">{val1}</span>
                  <span className="text-right font-normal tabular-nums">{val2}</span>
                </div>
              ))}
            </div>

            {/* Chronological transitions event stream */}
            <div className="flex max-h-44 flex-col gap-1.5 overflow-y-auto">
              <div className="mb-0.5 t-label">{dict.body.tactics.recentTransitions.replace("{a}", String(data.items.length))}</div>
              {data.items.length === 0 ? (
                <div className="p-3 text-sm text-muted">{dict.body.tactics.noTurnovers}</div>
              ) : (
                data.items.slice(0, 8).map((it) => (
                  <button key={it.id} type="button" onClick={() => onSeek && onSeek(it.trigger_pts_us)} disabled={!onSeek}
                    className="flex items-center justify-between gap-2 rounded bg-[#12305a66] px-2 py-1 text-left text-sm disabled:cursor-default">
                    <span className="w-12 shrink-0 text-[#9fb3cc] t-tc">{clock(it.trigger_pts_us)}</span>
                    <span className="font-normal" style={{ color: it.kit_group === 0 ? "#7ab6ff" : "#e8d9a0" }}>
                      {it.trigger_kind.replace("_", " ")}
                    </span>
                    <span className="text-muted">→</span>
                    <span className="font-normal"
                      style={{
                        color:
                          it.next_action.outcome === "SHOT" || it.next_action.outcome === "GOAL"
                            ? "#19d3ff"
                            : it.next_action.outcome === "KEY_PASS"
                              ? "#19e6c0"
                              : it.next_action.outcome === "DISPOSSESSED"
                                ? "#f87171"
                                : "#dbe8ff",
                      }}>
                      {it.next_action.outcome} ({it.next_action.duration_s}s)
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
