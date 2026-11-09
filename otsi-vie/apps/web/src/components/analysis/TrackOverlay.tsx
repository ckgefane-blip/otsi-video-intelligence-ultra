"use client";
/**
 * The one drawing of the tracking boxes, used by every page that shows them over the video (03 Processing preview, 04 Analysis, 05 Tactical
 * synced preview, the analyse page). The data is the same everywhere: the latest finished run's observations at the playhead (useAnalysisWorkspace),
 * so the same moment shows the same boxes, colours and labels on every page.
 *
 * What is drawn: solid = measured, either detected in this very frame or estimated between two detections of the same track a fraction of a
 * second apart (ADR-025 INTERPOLATED; measured on the owner's match: 1.5 px from the per-frame truth on average). Drawing those dashed made every
 * box flip solid/dashed six times a second while playing (2026-10-31). Dashed = a held position that is not measured now (the nearest analysed
 * frame). The exact state stays on every box (data-box-state) and is named in the selected track's panel. Colour = the track's team from its shirt (kit group: team 1 green, team 2 red, officials
 * yellow; blue where no team was measured), amber for the ball, white for the selected track. The label is the temporary track number, or the
 * player's name only after a person confirmed the identity (ADR-016).
 */
import type { Observation, TrackSummary } from "@otsi-vie/contracts";

export const KIT_COLOUR: Record<number, string> = { 0: "#2ee86a", 1: "#ff4d4d", 2: "#ffd600" };
export const KIT_LEGEND: [number, string][] = [[0, "Team 1"], [1, "Team 2"], [2, "Officials"]];
const NO_TEAM = "#19a0ff", BALL = "#f5b82e", CHOSEN = "#ffffff";

/** a box's team (kit group): carried on the observation itself; the track list is only a fallback (it is capped, later tracks are not in it) */
export const kitOf = (o: Observation, tracks: Map<string, TrackSummary>): number | null => o.kit_group ?? tracks.get(o.track_id)?.kit_group ?? null;

export interface Visible { o: Observation; exact: boolean; glided: boolean; dtUs: number }

export function TrackOverlay({ visible, tracks, W, H, labels, byTeam = true, selectedId = null, onSelect }: {
  visible: Visible[]; tracks: Map<string, TrackSummary>; W: number; H: number; labels: boolean; byTeam?: boolean;
  selectedId?: string | null; onSelect?: (trackId: string) => void;
}) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Detected people and ball"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
      {visible.map(({ o, exact, glided }) => {
        const ball = o.class_name === "BALL", tr = tracks.get(o.track_id), named = tr?.identity_state === "CONFIRMED", chosen = o.track_id === selectedId;
        const kit = kitOf(o, tracks);
        const color = chosen ? CHOSEN : ball ? BALL : (byTeam && kit !== null ? KIT_COLOUR[kit] : undefined) ?? NO_TEAM;
        const name = ball ? "Ball" : named && tr ? (tr.label.split(" · ")[0] ?? "") : String(o.track_number);
        return (
          <g key={o.track_id} data-box-track={o.track_number} data-box-class={o.class_name} data-box-kit={kit ?? ""} data-box-exact={exact ? "1" : "0"}
            data-box-state={exact ? "detected" : glided ? "estimated" : "nearest"}
            onClick={onSelect ? () => onSelect(o.track_id) : undefined} style={onSelect ? { pointerEvents: "all", cursor: "pointer" } : undefined}>
            <rect x={o.x * W} y={o.y * H} width={o.w * W} height={o.h * H} fill="transparent" stroke={color} strokeWidth={chosen ? H * 0.0045 : H * 0.0025}
              {...(exact || glided ? {} : { strokeDasharray: `${H * 0.006} ${H * 0.004}` })} />
            {labels && (
              <>
                <rect x={o.x * W} y={o.y * H - H * 0.026} width={Math.max(H * 0.03, name.length * H * 0.0125)} height={H * 0.024} fill="#ffffff" />
                <text x={o.x * W + H * 0.004} y={o.y * H - H * 0.008} fontSize={H * 0.019} fontWeight={700} fill="#000">{name}</text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
