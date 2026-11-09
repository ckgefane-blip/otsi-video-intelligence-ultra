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

const ROWS: [string, string, number, EvidenceLevel][] = [["spd", "Speed", 196, "INFERRED"], ["ball", "Distance", 239, "INFERRED"], ["pass", "Passes", 283, "DETECTED"],
  ["key", "Key Passes", 326, "DETECTED"], ["xa", "xA (Exp. Ast)", 370, "NOT_MEASURED"]];
const NM = "Not measured";

function value(label: string, m: PlayerMeasures | null): string {
  if (!m) return "—";
  if (!m.tracks) return NM;
  if (label === "Speed") return m.top_speed_kmh != null ? `${m.top_speed_kmh} km/h` : NM;
  if (label === "Distance") return m.distance_m == null ? NM : m.distance_m >= 1000 ? `${(m.distance_m / 1000).toFixed(2)} km` : `${m.distance_m} m`;
  if (label === "Passes") return m.events ? String(m.events.passes) : NM;
  if (label === "Key Passes") return m.events ? String(m.events.key_passes) : NM;
  return NM;
}

export function HeroMetrics({ playerId }: { playerId: string | null }) {
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
        const v = value(label, m), nm = v === NM;
        return (
        <div key={label} data-metric={label} title={label === "xA (Exp. Ast)" ? "Not measured by the engine" : nm ? "Not measured yet" : "The engine's measure over his confirmed tracks"}>
          <Ic x={1497} y={y} k={k} size={26} color="#33a8ff" />
          <T x={1524} y={y} size={19} color="#b9cbe2">{label}</T>
          {!nm && v !== "—" && <B x={1628} y={y - 10} w={19} h={19}><Evidence level={level} compact size={11} why={level === "INFERRED" ? "from his positions on a calibrated pitch" : "events found from the followed ball"} /></B>}
          <T x={1654} y={y} size={nm ? 16 : 22} color={nm ? "#8ea3bf" : undefined}>{v}</T>
          {i > 0 && <B x={1480} y={y - 22} w={278} h={1} style={{ background: "#17406f" }} />}
        </div>
        );
      })}
    </>
  );
}
