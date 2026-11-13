"use client";
/**
 * The Analysis / Tactical video on the Drop 1 shared player (Desktop UI).
 *
 * The shared VideoPlayer owns its <video> element and hands it straight to the workspace hook (ADR-035) through its `videoRef`
 * prop: the hook follows the frame on screen (requestVideoFrameCallback) so the tracking boxes sit on the players, and every seek
 * (track click, timeline, event, ?t=) drives it. Nothing here changes the data layer: the playback URL is still the signed
 * GET /v1/videos/:id/playback address, the boxes are still the run's observations at the playhead, and the pitch layers still draw
 * only where a calibration covers the moment. The B.4 zoom reaches the player as `pictureStyle`, so it scales the picture and its
 * overlays together and leaves the transport bar unzoomed.
 *
 * Overlays drawn over the picture (as the player's children): the tracking boxes (TrackOverlay), the engine ball ring (BallOverlay)
 * and the pitch layers (PitchLayers: tracks, team shapes, heat, pass arrows). Which of those appear is the caller's `layers`.
 * The viewer's overlay preference (lib/overlayPrefs, the Drop 1 OverlayToggles) is applied to the workspace by <OverlaySync />.
 */
import { useEffect, useRef, useState } from "react";
import type { AnalysisWorkspaceState, Layers } from "@/components/analysis/AnalysisWorkspace";
import { useAnalysisWorkspace } from "@/components/analysis/AnalysisWorkspace";
import { KIT_COLOUR, kitLegend, kitOf, TrackOverlay } from "@/components/analysis/TrackOverlay";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { BallOverlay } from "@/components/workspace/BallMarks";
import { PitchMinimap } from "@/components/workspace/PitchCalibration";
import { PitchLayers } from "@/components/workspace/PitchLayers";
import { zoomOrigin } from "@/components/workspace/PlayerTools";
import { useOverlayPrefs } from "@/lib/overlayPrefs";
import { useLocale } from "@/lib/i18n";

export type { Layers };

/** the viewer's overlay preference, applied to this workspace's layers whenever it changes (or the workspace mounts) */
export function useOverlaySync(ws: AnalysisWorkspaceState | null) {
  const [prefs] = useOverlayPrefs();
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const appliedRef = useRef("");
  useEffect(() => {
    const w = wsRef.current;
    if (!w) return;
    const next: Layers = { boxes: prefs.boxes, labels: prefs.ids, ball: prefs.ball, people: true, trails: prefs.trails, shapes: prefs.shapes, heat: prefs.heat, passes: prefs.passes };
    const key = JSON.stringify(next);
    if (appliedRef.current === key) return;
    appliedRef.current = key;
    w.setLayers(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs]);
}

/** <OverlaySync /> as a child of the workspace provider (for pages that render the provider's sections directly) */
export function OverlaySync({ ws }: { ws: AnalysisWorkspaceState | null }) {
  useOverlaySync(ws);
  return null;
}

export interface WorkspacePlayerProps {
  ws: AnalysisWorkspaceState | null;
  /** kit groups of the team chosen in the team filter (null = everyone) */
  teamGroups?: Set<number> | null;
  /** what to draw: Analysis passes ws.layers; Tactical passes its header layers mapped onto these keys */
  layers: Layers | null;
  byTeam?: boolean;
  /** pitch layers (tracks / shapes / heat / passes) over the picture — Analysis only; Tactical never drew them here */
  pitchLayers?: boolean;
  /** the engine ball ring — Analysis only */
  ballRing?: boolean;
  /** BALL observations as boxes: "engine" hides them once the engine ball exists (Analysis); "always" (Tactical) */
  ballBoxes?: "engine" | "always" | "never";
  minimap?: boolean;
  /** B.4 zoom: "1" | "1.5" | "2" | "3", following the selected player while he is on screen */
  zoom?: string;
  /** B.4 overlay opacity (boxes, pitch layers, ball), from the settings menu */
  op?: { boxes: number; pitch: number; ball: number } | undefined;
  className?: string;
  /** SOT empty state: the transport bar below the picture, in the empty state too */
  emptyTransport?: boolean;
  /** with no workspace / a failed playback read, show the empty state ("No playable footage" + "Open local footage")
   *  instead of "Loading the video…" forever; pages still fetching keep their loading state */
  emptyWhenIdle?: boolean;
}

export function WorkspacePlayer({ ws, teamGroups = null, layers, byTeam = true, pitchLayers = false, ballRing = false, ballBoxes = "engine", minimap = false, zoom = "1", op = { boxes: 1, pitch: 1, ball: 1 }, className = "", emptyTransport = false, emptyWhenIdle = false }: WorkspacePlayerProps) {
  const { t: dict } = useLocale();
  const [pitchNote, setPitchNote] = useState<string | null>(null);
  const rawUrl = ws?.playback?.available ? ws.playback.url : ws?.playback ? null : undefined;
  const url = emptyWhenIdle && rawUrl === undefined && (ws === null || !!ws.error) ? null : rawUrl;
  const video = ws?.video ?? null;
  const W = video?.width ?? 1920, H = video?.height ?? 1080;
  const tracks = new Map((ws?.tracks ?? []).map((t) => [t.track_id, t]));
  const engineBall = !!ws?.ball.path?.t.length;
  const shown = (ws?.visible ?? []).filter(({ o }) => {
    if (o.class_name === "BALL") {
      if (ballBoxes === "never") return false;
      if (ballBoxes === "always") return !!layers?.ball;
      return !!layers?.ball && !engineBall;
    }
    return !!layers?.boxes && !!layers?.people && (!teamGroups || teamGroups.has(kitOf(o, tracks) ?? -1));
  });
  const selBox = ws?.selectedId ? (ws.visible.find(({ o }) => o.track_id === ws.selectedId)?.o ?? null) : null;
  const placed = (ws?.visible ?? []).filter(({ o }) => o.class_name === "PERSON" && typeof o.pitch_x === "number" && typeof o.pitch_y === "number");
  const calibrated = (ws?.pitch.list ?? []).some((r) => r.status === "SUCCEEDED");
  const minimapNote = placed.length ? dict.body.workspace.placedCount.replace("{a}", String(placed.length))
    : calibrated ? dict.body.workspace.notMeasuredHere : dict.body.workspace.pitchNotCalibrated;

  return (
    <div className="min-w-0 overflow-hidden rounded-md">
        <VideoPlayer
          src={url}
          label={video ? (video.title ?? video.original_filename ?? dict.body.processing.matchVideo) : dict.body.processing.matchVideo}
          allowLocal
          emptyTransport={emptyTransport}
          empty={{ title: dict.desktop.noPlayableTitle, body: dict.desktop.noPlayableBody }}
          aspect={`${W} / ${H}`}
          className={className}
          // SOT: the shared player hands its <video> straight to the workspace (no DOM query) and the B.4 zoom applies to
          // the picture + overlays together, so the transport bar stays unzoomed
          videoRef={ws?.videoRef}
          pictureStyle={zoom !== "1" ? { transform: `scale(${zoom})`, transformOrigin: zoomOrigin(selBox), transition: "transform-origin .4s linear" } : undefined}
        >
          {ws && layers && (
            <>
              {pitchLayers && (
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: op.pitch }}>
                  <PitchLayers ws={ws} W={W} H={H} teamGroups={teamGroups} onNote={setPitchNote} />
                </div>
              )}
              <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: op.boxes }}>
                <TrackOverlay visible={shown} tracks={tracks} W={W} H={H} labels={!!layers.labels} byTeam={byTeam} selectedId={ws.selectedId} onSelect={ws.select} />
              </div>
              {ballRing && layers.ball && (
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: op.ball }}>
                  <BallOverlay ball={ws.ball} timeUs={ws.timeUs} stepUs={ws.intervalUs} />
                </div>
              )}
              {pitchNote && pitchLayers && (
                <div className="absolute right-3 top-3 max-w-[70%] rounded bg-black/60 px-2 py-1 text-right text-xs text-white" data-pitch-note>{pitchNote}</div>
              )}
              {url && ws.run && byTeam && (
                <div className="absolute bottom-12 left-3 flex gap-3 rounded bg-black/55 px-2 py-1 text-xs text-white" data-box-legend>
                  {kitLegend(dict).map(([g, l]) => (
                    <span key={g} className="flex items-center gap-1"><i className="inline-block h-3 w-3" style={{ background: KIT_COLOUR[g] }} />{l}</span>
                  ))}
                </div>
              )}
              {minimap && (
                <div className="absolute bottom-12 right-3 w-[240px] max-w-[32%] overflow-hidden rounded-md border-2 border-[#19a0ff] shadow-[0_0_12px_#19a0ff]" data-minimap>
                  <div className="aspect-[265/158]"><PitchMinimap calibrated={calibrated}
                    dots={placed.map(({ o }) => ({ x: o.pitch_x as number, y: o.pitch_y as number, group: (o.kit_group ?? tracks.get(o.track_id)?.kit_group ?? null) as number | null, chosen: o.track_id === ws.selectedId }))} /></div>
                  <div className="bg-black/60 px-1 py-0.5 text-center text-xs text-[#d7efe0]">{minimapNote}</div>
                </div>
              )}
            </>
          )}
        </VideoPlayer>
    </div>
  );
}

/** the workspace's video on the shared player, for pages that render inside the provider (the per-video analyse page) */
export function WorkspaceVideo({ teamGroups = null, minimap = false, op }: { teamGroups?: Set<number> | null; minimap?: boolean; op?: { boxes: number; pitch: number; ball: number } }) {
  const ws = useAnalysisWorkspace();
  return <WorkspacePlayer ws={ws} teamGroups={teamGroups} layers={ws.layers} pitchLayers ballRing minimap={minimap} op={op} />;
}
