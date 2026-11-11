"use client";
/**
 * Home hero — the metrics panel for the player in the hero picture (HeroLive, a random CONFIRMED player): his engine measures over his
 * confirmed tracks (GET /v1/players/:id/measures). Speed and distance come from measured pitch positions; passes and key passes from the
 * events found once the ball was followed. Each says "Not measured" when it was not measured ("—" only while reading); xA is not measured
 * by the engine. Each value carries its evidence badge (ADR-063): speed and distance are inferred from pitch positions, passes are
 * detected events.
 */
import type { PlayerMeasures } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { Evidence, type EvidenceLevel } from "@/components/evidence/Evidence";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";

/** row key, English label (kept for data-metric), evidence level */
const ROWS: [string, string, EvidenceLevel][] = [["spd", "Speed", "INFERRED"], ["ball", "Distance", "INFERRED"], ["pass", "Passes", "DETECTED"],
  ["key", "Key Passes", "DETECTED"], ["xa", "xA (Exp. Ast)", "NOT_MEASURED"]];

const rowLabel = (t: Dictionary, k: string): string => ({
  spd: t.body.home.heroMetricSpeed, ball: t.body.home.heroMetricDistance, pass: t.body.home.heroMetricPasses,
  key: t.body.home.heroMetricKeyPasses, xa: t.body.home.heroMetricXa,
}[k] ?? k);

export function value(k: string, nm: string, m: PlayerMeasures | null): string {
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
  const nmText = t.body.reports.notMeasured;
  return (
    <dl className="rounded-md border border-line2 bg-p0/90 px-3 py-1.5 backdrop-blur" data-hero-metrics>
      {ROWS.map(([k, label, level]) => {
        const v = value(k, nmText, m), nm = v === nmText;
        return (
          <div key={label} data-metric={label} className="flex h-7 items-center justify-between gap-2 border-b border-line last:border-0"
            title={label === "xA (Exp. Ast)" ? t.body.home.heroMetricXaTitle : nm ? t.body.home.heroMetricNotMeasuredTitle : t.body.home.heroMetricMeasuredTitle}>
            <dt className="t-small text-muted">{rowLabel(t, k)}</dt>
            <dd className="flex items-center gap-1.5">
              {!nm && v !== "—" && <Evidence level={level} compact size={11} why={level === "INFERRED" ? t.body.home.heroWhyInferred : t.body.home.heroWhyDetected} />}
              <span className={nm ? "t-small text-muted" : "t-mono text-ink"}>{v}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
