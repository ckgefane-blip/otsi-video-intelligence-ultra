"use client";
/**
 * Page 06 Analysis — the tool bar (SOT, Analysis.dc.html).
 *
 * The five tools switch what the centre does: Select (the default — click a
 * box or a track to select it), Identify (say who the selected track is),
 * Mark ball (mark the ball where the engine cannot see it), Marker (add a
 * note at the playhead) and Calibrate pitch (mark the pitch so positions
 * can be measured). The shared VideoPlayer already gives play / pause,
 * ±1 s, scrubber, time, speed and fullscreen, so this bar keeps only the
 * identity tools. The video settings (zoom, mute, overlay opacity) stay at
 * their defaults; usePlayerToolState still provides them to the player.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { useOverlayOpacity, type OverlayOpacity } from "@/components/workspace/PlayerTools";
import { useLocale } from "@/lib/i18n";

export interface PlayerToolState {
  byTeam: boolean; setByTeam(v: boolean): void;
  mini: boolean; setMini(v: boolean): void;
  zoom: string; setZoom(v: string): void;
  muted: boolean; setMuted(v: boolean): void;
  op: OverlayOpacity; setOp(k: keyof OverlayOpacity, v: number): void;
}

export function usePlayerToolState(): PlayerToolState {
  const [byTeam, setByTeam] = useState(true);
  const [mini, setMini] = useState(true);
  const [zoom, setZoom] = useState("1");
  const [muted, setMuted] = useState(false);
  const { op, set } = useOverlayOpacity();
  return { byTeam, setByTeam, mini, setMini, zoom, setZoom, muted, setMuted, op, setOp: set };
}

export type AnalysisTool = "select" | "identify" | "ball" | "marker" | "pitch";

export function AnalysisToolBar({ tool, onTool, right }: {
  tool: AnalysisTool;
  onTool: (t: AnalysisTool) => void;
  right?: ReactNode;
}) {
  const { t: dict } = useLocale();
  const a = dict.body.analysis;
  const tools: [AnalysisTool, string][] = [
    ["select", a.anToolSelect],
    ["identify", a.anToolIdentify],
    ["ball", a.anToolMarkBall],
    ["marker", a.anToolMarker],
    ["pitch", a.anToolCalibrate],
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="seg" role="group" aria-label={dict.body.workspace.toolsForVideo}>
        {tools.map(([k, label]) => (
          <button key={k} type="button" className={tool === k ? "on" : ""} aria-pressed={tool === k} onClick={() => onTool(k)}>
            {label}
          </button>
        ))}
      </div>
      {right}
    </div>
  );
}
