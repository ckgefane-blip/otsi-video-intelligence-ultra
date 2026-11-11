"use client";
/**
 * Page 01 Section 02 — the hero's metrics card for the player in the hero picture (HeroLive, a random CONFIRMED player): his engine
 * measures over his confirmed tracks (GET /v1/players/:id/measures). Speed and distance come from measured pitch positions; passes and
 * key passes from the events found once the ball was followed. Each says "Not measured" when it was not measured ("—" only while reading);
 * xA is not measured by the engine. Each value carries its evidence badge (ADR-063): speed and distance are inferred from pitch
 * positions, passes are detected events.
 */
import type { PlayerMeasures } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { Evidence, type EvidenceLevel } from "@/components/evidence/Evidence";
import { B, Ic, T } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";

/** row key, English label (kept for data-metric and value matching), y, evidence level */
const ROWS: [string, string, number, EvidenceLevel][] = [["spd", "Speed", 196, "INFERRED"], ["ball", "Distance", 239, "INFERRED"], ["pass", "Passes", 283, "DETECTED"],
  ["key", "Key Passes", 326, "DETECTED"], ["xa", "xA (Exp. Ast)", 370, "NOT_MEASURED"]];

/** the row's label as the person reads it (ADR-139) */
const rowLabel = (t: Dictionary, k: string): string => ({
  spd: t.body.home.heroMetricSpeed, ball: t.body.home.heroMetricDistance, pass: t.body.home.heroMetricPasses,
  key: t.body.home.heroMetricKeyPasses, xa: t.body.home.heroMetricXa,
}[k] ?? k);

function value(k: string, nm: string, m: PlayerMeasures | null): string {
  if (!m) return "—";
  if (!m.tracks) return nm;
  if (k === "spd") return m.top_speed_kmh != null ? `${m.top_speed_kmh} km/h` : nm;
  if (k === "ball") return m.distance_m == null ? nm : m.distance_m >= 1000 ? `${(m.distance_m / 1000).toFixed(2)} km` : `${m.distance_m} m`;
  if (k === "pass") return m.events ? String(m.events.passes) : nm;
  if (k === "key") return m.events ? String(m.events.key_passes) : nm;
  return nm;
}

export function HeroMetrics({ playerId }: { playerId: string | null }) {
  const { t } = useLocale();
  const [m, setM] = useState<PlayerMeasures | null>(null);
  useEffect(() => {
    let live = true;
    if (!playerId) setM(null);
    else void api<PlayerMeasures>(`/v1/players/${playerId}/measures`).then((x) => { if (live) setM(x); }, () => { if (live) setM(null); });
    return () => { live = false; };
  }, [playerId]);
  return (
    <>
      {ROWS.map(([k, label, y, level], i) => {
        const v = value(k, t.body.reports.notMeasured, m), nm = v === t.body.reports.notMeasured;
        const shown = rowLabel(t, k);
        return (
        <div key={label} data-metric={label} title={label === "xA (Exp. Ast)" ? t.body.home.heroMetricXaTitle : nm ? t.body.home.heroMetricNotMeasuredTitle : t.body.home.heroMetricMeasuredTitle}>
          <Ic x={1497} y={y} k={k} size={26} color="#33a8ff" />
          <T x={1524} y={y} size={19} color="#b9cbe2">{shown}</T>
          {!nm && v !== "—" && <B x={1628} y={y - 10} w={19} h={19}><Evidence level={level} compact size={11} why={level === "INFERRED" ? t.body.home.heroWhyInferred : t.body.home.heroWhyDetected} /></B>}
          <T x={1654} y={y} size={nm ? 16 : 22} color={nm ? "#8ea3bf" : undefined}>{v}</T>
          {i > 0 && <B x={1480} y={y - 22} w={278} h={1} style={{ background: "#17406f" }} />}
        </div>
        );
      })}
    </>
  );
}
