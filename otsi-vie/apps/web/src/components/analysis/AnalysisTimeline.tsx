"use client";
/**
 * Page 06 Analysis — the event timeline panel (SOT, Analysis.dc.html).
 *
 * The time ruler, the event counts the engine found (passes, shots, ball
 * won, pressures, set pieces), the ball (measured only where the engine
 * followed it, else "Not measured"), and the markers (M adds one at the
 * playhead). This is the SOT's summary panel, not the old event-chip /
 * track-lane timeline: the full event list lives on the Player Report,
 * and the track lanes live on the Tactical page.
 */
import { useEffect, useMemo } from "react";
import { useLocale } from "@/lib/i18n";
import { useLanes } from "@/components/workspace/EngineLanes";
import type { Shared } from "@/components/workspace/shared";

export function AnalysisTimeline({ s, markersVersion }: { s: Shared; markersVersion: number }) {
  const { t: dict } = useLocale();
  const a = dict.body.analysis;
  const { ws } = s;
  const ev = ws?.events.data ?? null;
  const durMin = ws?.video?.duration_us ? Math.ceil(ws.video.duration_us / 60_000_000) : 0;
  const ruler = useMemo(() => {
    const marks: number[] = [];
    for (let m = 0; m <= Math.max(90, Math.ceil(durMin / 15) * 15); m += 15) marks.push(m);
    return marks;
  }, [durMin]);
  const counts = ev
    ? { passes: ev.passes.length, shots: ev.shots.length, won: ev.changes.length, pressures: ev.pressures.length, setPieces: ev.set_pieces.length }
    : { passes: 0, shots: 0, won: 0, pressures: 0, setPieces: 0 };
  const total = counts.passes + counts.shots + counts.won + counts.pressures + counts.setPieces;
  const ballTrack = (ws?.tracks ?? []).find((t) => t.class_name === "BALL") ?? null;

  const { lanes, load } = useLanes(ws?.video?.id ?? null, ws?.run?.id ?? null);
  useEffect(() => { void load(); }, [load, markersVersion]);
  const markerCount = lanes?.markers.length ?? 0;

  return (
    <section className="flex min-h-[150px] flex-1 flex-col overflow-hidden border-t border-line pt-3" aria-label={a.anTimeline}>
      <div className="grid h-[30px] grid-cols-[112px_minmax(0,1fr)] items-center border-b border-line">
        <span className="t-th pl-3">{a.anTimeline}</span>
        <div className="flex justify-between px-2.5">
          {ruler.map((m) => (
            <span key={m} className="t-small text-muted">{m}&prime;</span>
          ))}
        </div>
      </div>
      <div className="grid min-h-11 grid-cols-[112px_minmax(0,1fr)] items-center border-b border-raised">
        <span className="t-small pl-3 text-ink2">
          {dict.body.workspace.metricEvents} · {total}
        </span>
        <div className="px-2.5 py-1.5 t-small text-ink2">
          {([
            [a.anPasses, counts.passes],
            [a.anShots, counts.shots],
            [a.anBallWon, counts.won],
            [a.anPressures, counts.pressures],
            [a.anSetPieces, counts.setPieces],
          ] as const).map(([label, n], i) => (
            <span key={label}>{i > 0 && " · "}{label} {n}</span>
          ))}
        </div>
      </div>
      <div className="grid flex-1 grid-cols-[112px_minmax(0,1fr)] items-center border-b border-raised">
        <span className="t-small pl-3 text-ink2">{dict.body.processing.ball}</span>
        <span className="px-2.5 t-body text-muted">
          {!ev || !ev.ball_track_id || !ballTrack
            ? dict.body.reports.notMeasured
            : a.detectedBoxes.replace("{a}", String(ballTrack.observation_count)).replace("{b}", ballTrack.mean_confidence?.toFixed(2) ?? "—")}
        </span>
      </div>
      <div className="grid flex-1 grid-cols-[112px_minmax(0,1fr)] items-center">
        <span className="t-small pl-3 text-ink2">{a.anMarkers}</span>
        <span className="px-2.5 t-body text-muted">
          {markerCount === 0 ? (
            (() => {
              const parts = a.anPressM.split("{a}");
              return (
                <>
                  {parts[0]}
                  <kbd className="kbd">M</kbd>
                  {parts[1] ?? ""}
                </>
              );
            })()
          ) : (
            <span>{markerCount}</span>
          )}
        </span>
      </div>
    </section>
  );
}
