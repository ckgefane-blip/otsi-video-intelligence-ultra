"use client";
/**
 * A heat map on the pitch (promise 2, heat zones): the time a player or team spent in each zone, from measured pitch positions only
 * (`HeatZones`). Zones with no measured time stay plain grass; the caption says how much of the time seen was measured, so a sparse map is
 * never mistaken for a full one. Teams change ends at half-time and both halves are drawn as filmed.
 */
import { type HeatZones, pitchLines } from "@otsi-vie/contracts";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { getDictionary, useLocale, type Dictionary } from "@/lib/i18n";

/** colour of a zone: transparent where nothing was measured, then yellow to red as the share of the busiest zone grows */
function shade(v: number, max: number): string {
  if (!(v > 0) || !(max > 0)) return "transparent";
  const t = Math.sqrt(v / max);                                           // square root: short stays still show
  const r = 255, g = Math.round(220 - 190 * t), b = Math.round(60 - 50 * t);
  return `rgba(${r},${g},${b},${(0.25 + 0.6 * t).toFixed(2)})`;
}

export function HeatPitch({ zones, label }: { zones: HeatZones; label: string }) {
  const { t: dict } = useLocale();
  const { length_m: L, width_m: W, cols, rows, seconds } = zones;
  const lines = useMemo(() => pitchLines(L, W, 1.5), [L, W]);
  const max = Math.max(0, ...seconds);
  const cw = L / cols, ch = W / rows;
  return (
    <svg viewBox={`${-L / 2 - 2} ${-W / 2 - 2} ${L + 4} ${W + 4}`} role="img" aria-label={label} data-heat={zones.subject.kind} style={{ width: "100%", height: "100%", display: "block" }}>
      <rect x={-L / 2 - 2} y={-W / 2 - 2} width={L + 4} height={W + 4} fill="#1d5a2e" />
      {seconds.map((v, i) => v > 0 && (
        <rect key={i} x={-L / 2 + (i % cols) * cw} y={-W / 2 + Math.floor(i / cols) * ch} width={cw} height={ch} fill={shade(v, max)}>
          <title>{dict.body.workspace.secondsHere.replace("{a}", String(Math.round(v)))}</title>
        </rect>
      ))}
      {Object.entries(lines).map(([k, pts]) => <polyline key={k} points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#d7efe0" strokeWidth={0.45} />)}
    </svg>
  );
}

/** The heat zones from `url` (null while loading or when unavailable), reloaded when the url or `key` changes. */
export function useHeatZones(url: string | null, key: unknown = 0): { zones: HeatZones | null; loading: boolean; error: string | null } {
  const { t: dict } = useLocale();
  const [zones, setZones] = useState<HeatZones | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setZones(null); setError(null);
    if (!url) return;
    let live = true;
    setLoading(true);
    api<HeatZones>(url).then((z) => { if (live) setZones(z); }, () => { if (live) setError(dict.body.workspace.heatLoadFailed); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [url, key]);
  return { zones, loading, error };
}

/** "Measured 12 min of 40 min seen" — how much of the time the map stands for. */
export function measuredText(z: HeatZones, d?: Dictionary): string {
  const dict = d ?? getDictionary("en");
  const m = (s: number) => (s >= 90 ? dict.body.processing.estimateMinutes.replace("{n}", String(Math.round(s / 60))) : dict.body.processing.estimateSeconds.replace("{n}", String(Math.round(s))));
  return z.measured_s > 0 ? dict.body.workspace.measuredOfSeen.replace("{a}", m(z.measured_s)).replace("{b}", m(z.seen_s)) : dict.body.workspace.seenNoPosition.replace("{a}", m(z.seen_s));
}
