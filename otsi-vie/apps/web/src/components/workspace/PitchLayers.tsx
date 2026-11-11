"use client";
/**
 * Pitch-placed overlays on the video (Page 09 View overlays, set as defaults in the Library; switched per page in the video settings menu).
 * Each is drawn only where a pitch calibration covers the moment, through its `H` (pitch metres -> this frame's picture), so a panning camera
 * keeps them on the grass; where the pitch is not calibrated nothing is drawn and the note says so (never guessed in picture space):
 *   Player Tracks  each shown person's last 3 seconds of measured pitch positions, as a line ending at his feet
 *   Team Shapes    each team's outline (convex hull) of the players on screen whose position is measured, with its area in m²:
 *                  the part of the team the camera shows, not the whole team
 *   Heatmaps       the selected player's track, or else each team, from GET /v1/analysis-runs/:id/(tracks/:t/)heat-zones (the whole video,
 *                  as filmed: teams change ends at half-time), laid on the pitch
 *   Pass Arrows    the engine's passes around the playhead (GET /v1/videos/:id/events) from where the ball left the passer to where it reached
 *                  the receiver; key passes gold. The ends are re-placed into this frame through the calibration of their own moment.
 */
import { convexHull, HEAT_COLS, HEAT_ROWS, type HeatZones, hullArea, project, type Pt, unproject } from "@otsi-vie/contracts";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { KIT_COLOUR, kitOf } from "@/components/analysis/TrackOverlay";
import { useLocale } from "@/lib/i18n";

const TRAIL_US = 3_000_000;
const NO_TEAM = "#19a0ff";
const colourOf = (k: number | null) => (k !== null ? KIT_COLOUR[k] : undefined) ?? NO_TEAM;

/** heat of the selected track, or of the two teams (fetched when the layer is on) */
function useHeat(ws: AnalysisWorkspaceState, on: boolean): { group: number | null; zones: HeatZones }[] {
  const [heat, setHeat] = useState<{ group: number | null; zones: HeatZones }[]>([]);
  const run = ws.run?.id, sel = ws.selectedId;
  const selKit = sel ? ws.tracks?.find((t) => t.track_id === sel)?.kit_group ?? null : null;
  useEffect(() => {
    setHeat([]);
    if (!on || !run) return;
    let live = true;
    const jobs = sel ? [api<HeatZones>(`/v1/analysis-runs/${run}/tracks/${sel}/heat-zones`).then((zones) => [{ group: selKit, zones }])]
      : [0, 1].map((g) => api<HeatZones>(`/v1/analysis-runs/${run}/heat-zones?kit_group=${g}`).then((zones) => [{ group: g, zones }]));
    void Promise.all(jobs.map((j) => j.catch(() => []))).then((x) => { if (live) setHeat(x.flat()); });
    return () => { live = false; };
  }, [on, run, sel, selKit]);
  return heat;
}

export function PitchLayers({ ws, W, H, teamGroups, onNote }: {
  ws: AnalysisWorkspaceState; W: number; H: number; teamGroups: Set<number> | null; onNote?: (note: string | null) => void;
}) {
  const { t: dict } = useLocale();
  const L = ws.layers, t = ws.timeUs;
  const any = !!(L.trails || L.shapes || L.heat || L.passes);
  const cal = any ? ws.calibrationAt(t) : null;
  const heat = useHeat(ws, !!L.heat);
  const tracks = useMemo(() => new Map((ws.tracks ?? []).map((x) => [x.track_id, x])), [ws.tracks]);
  const toPic = (p: Pt): Pt | null => (cal ? project(cal.H, p) : null);
  const pt = (q: Pt | null) => (q ? `${q[0] * W},${q[1] * H}` : "");
  const people = ws.visible.filter(({ o }) => o.class_name === "PERSON" && (!teamGroups || teamGroups.has(kitOf(o, tracks) ?? -1)));

  // Player Tracks: measured pitch positions of the last seconds, re-placed into this frame; a gap breaks the line
  const trails = L.trails && cal ? people.map(({ o }) => {
    const pts = ws.observationsNear(o.track_id, t - TRAIL_US, t);
    const lines: string[][] = [[]];
    let last = -Infinity;
    for (const q of pts) {
      if (typeof q.pitch_x !== "number" || typeof q.pitch_y !== "number" || q.pts_us - last > ws.intervalUs * 1.6) { if (lines.at(-1)!.length) lines.push([]); }
      last = q.pts_us;
      const p = typeof q.pitch_x === "number" && typeof q.pitch_y === "number" ? toPic([q.pitch_x, q.pitch_y]) : null;
      if (p) lines.at(-1)!.push(pt(p));
    }
    return { id: o.track_id, colour: o.track_id === ws.selectedId ? "#ffffff" : colourOf(kitOf(o, tracks)), lines: lines.filter((l) => l.length > 1) };
  }).filter((x) => x.lines.length) : [];

  // Team Shapes: the outline of each team's measured players in this frame
  const shapes = L.shapes && cal ? [0, 1].filter((g) => !teamGroups || teamGroups.has(g)).map((g) => {
    const m = people.filter(({ o }) => kitOf(o, tracks) === g && typeof o.pitch_x === "number" && typeof o.pitch_y === "number").map(({ o }) => [o.pitch_x, o.pitch_y] as Pt);
    if (m.length < 3) return null;
    const hull = convexHull(m).map(toPic);
    return hull.every(Boolean) ? { g, n: m.length, area: Math.round(hullArea(m)), pts: hull.map(pt).join(" "), at: hull[0]! } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x) : [];

  // Heatmaps: each zone (pitch metres) as a quad in this frame
  const quads = L.heat && cal ? heat.flatMap(({ group, zones }) => {
    const max = Math.max(...zones.seconds, 0);
    if (!max) return [];
    const cw = zones.length_m / HEAT_COLS, rh = zones.width_m / HEAT_ROWS, x0 = -zones.length_m / 2, y0 = -zones.width_m / 2;
    const out: { key: string; pts: string; colour: string; a: number }[] = [];
    zones.seconds.forEach((s, i) => {
      if (s < max * 0.1) return;                                                        // a zone barely visited is left clear, so the hot ones stand out
      const c = i % HEAT_COLS, r = Math.floor(i / HEAT_COLS);
      const corners = ([[c, r], [c + 1, r], [c + 1, r + 1], [c, r + 1]] as Pt[]).map(([a, b]) => toPic([x0 + a * cw, y0 + b * rh]));
      if (!corners.every((q) => q && q[1] > -0.5 && q[1] < 1.5)) return;           // a zone far behind the camera is not drawn
      out.push({ key: `${group}-${i}`, pts: corners.map(pt).join(" "), colour: group === null ? "#ff8a1e" : colourOf(group), a: 0.1 + 0.6 * Math.sqrt(s / max) });
    });
    return out;
  }) : [];

  // Pass Arrows: passes in progress or just made, each end placed through the calibration of its own moment
  const arrows = L.passes && cal ? (ws.events.data?.passes ?? []).filter((p) => p.from_xy && p.to_xy && t >= p.start_us - 300_000 && t <= p.end_us + 2_000_000).map((p) => {
    const a = ws.calibrationAt(p.start_us), b = ws.calibrationAt(p.end_us);
    const f = a && unproject(a.H, p.from_xy!), e = b && unproject(b.H, p.to_xy!);
    const from = f ? toPic(f) : null, to = e ? toPic(e) : null;
    return from && to ? { id: p.id, from, to, colour: p.key ? "#f5b82e" : colourOf(p.kit_group), key: p.key } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x) : [];

  const note = !any ? null : !ws.run ? dict.body.workspace.noAnalysisPlace : !cal ? dict.body.workspace.pitchNotCalMoment
    : L.heat && !heat.length ? dict.body.workspace.heatLoadingNone : null;
  useEffect(() => { onNote?.(note); }, [note, onNote]);
  if (!any || !cal) return null;
  const sw = H * 0.003;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={dict.body.workspace.pitchOverlays} data-pitch-layers
      data-trails={trails.length} data-shapes={shapes.length} data-heat={quads.length} data-passes={arrows.length}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden" }}>
      <defs>
        {["#f5b82e", ...Object.values(KIT_COLOUR), NO_TEAM].map((c) => (
          <marker key={c} id={`arr-${c.slice(1)}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={c} /></marker>
        ))}
      </defs>
      {quads.map((q) => <polygon key={q.key} points={q.pts} fill={q.colour} fillOpacity={q.a} stroke="none" />)}
      {shapes.map((s) => (
        <g key={s.g} data-shape={s.g}>
          <polygon points={s.pts} fill={colourOf(s.g)} fillOpacity={0.14} stroke={colourOf(s.g)} strokeWidth={sw} strokeDasharray={`${sw * 4} ${sw * 2}`} />
          <text x={s.at[0] * W} y={s.at[1] * H - H * 0.01} fontSize={H * 0.022} fontWeight={700} fill={colourOf(s.g)} stroke="#000" strokeWidth={H * 0.002} paintOrder="stroke">
            {dict.body.workspace.onScreenArea.replace("{a}", String(s.n)).replace("{b}", String(s.area))}</text>
        </g>
      ))}
      {trails.map((x) => x.lines.map((l, i) => <polyline key={`${x.id}-${i}`} points={l.join(" ")} fill="none" stroke={x.colour} strokeWidth={sw} strokeOpacity={0.85} strokeLinecap="round" strokeLinejoin="round" />))}
      {arrows.map((a) => (
        <line key={a.id} x1={a.from[0] * W} y1={a.from[1] * H} x2={a.to[0] * W} y2={a.to[1] * H} stroke={a.colour} strokeWidth={sw * 1.6} markerEnd={`url(#arr-${a.colour.slice(1)})`} />
      ))}
    </svg>
  );
}
