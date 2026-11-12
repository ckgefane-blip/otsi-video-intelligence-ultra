"use client";
/**
 * Page 05 Section 04 — synced tactical video preview (approved reference 05_TACTICAL_INTELLIGENCE, "video preview"), in flow (Desktop UI Drop 2).
 *
 * The chosen video's playback copy with the boxes of its latest finished run (useAnalysisWorkspace, the same boxes as page 04); the
 * sidebar's overlay switches choose people boxes, labels and the ball. One camera angle exists, so the angle selector has one option.
 * Transport comes from the shared VideoPlayer (play / pause, ±1s, scrubber, time, speed, fullscreen); this toolbar adds what it does
 * not: step one analysed frame, mute, labels, and picture-in-picture. Without a video: the player's honest empty state.
 */
import { useEffect, useState } from "react";
import type { AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { WorkspacePlayer } from "@/components/analysis/WorkspacePlayer";
import type { Layers } from "./TacticsHeader";
import { useLocale } from "@/lib/i18n";

/** `teamGroups`: the kit groups of the team chosen in the team filter (null = all players); the ball is always shown */
export function SyncedPreview({ ws, layers, setLayers, teamGroups }: { ws: AnalysisWorkspaceState | null; layers: Layers; setLayers: (l: Layers) => void; teamGroups: Set<number> | null }) {
  const { t: dict } = useLocale();
  const [muted, setMuted] = useState(false);
  const url = ws?.playback?.available ? ws.playback.url : null;
  const video = ws?.video ?? null;
  useEffect(() => { const el = ws?.videoRef.current; if (el) el.muted = muted; }, [muted, ws?.videoRef, url]);

  const t = ws?.timeUs ?? 0;
  const message = !ws ? dict.body.tactics.noVideoLoaded : !ws.playback ? dict.body.processing.loadingVideo : !url ? dict.body.tactics.noPlaybackYetReason.replace("{a}", ws.playback.reason ?? dict.body.workspace.beingPrepared) : null;

  return (
    <section id="p05-s04" aria-label={dict.body.tactics.syncedPreview} data-section="p05-s04" className="vie-panel">
      <div className="vie-ph">
        <h2 className="t-panel"><span aria-hidden className="mr-2 inline-block h-5 w-1.5 rounded bg-primary align-middle" />{dict.body.tactics.videoPreviewSynced}
          <span tabIndex={0} role="note" aria-label={dict.body.tactics.syncedVideoDesc} title={dict.body.tactics.syncedVideoDesc} className="ml-2 cursor-help rounded-full border border-line2 px-1.5 text-xs font-normal text-muted">i</span>
        </h2>
        <select aria-label={dict.body.tactics.cameraAngle} value="tactical" onChange={() => undefined}
          className="h-8 rounded-md border border-line bg-raised px-2 text-sm text-ink">
          <option value="tactical">{dict.body.tactics.tacticalAngle}</option>
          <option value="broadcast" disabled>{`${dict.body.tactics.broadcastAngle} — ${dict.body.tactics.oneAnglePerVideo}`}</option>
          <option value="close" disabled>{`${dict.body.tactics.closeUp} — ${dict.body.tactics.oneAnglePerVideo}`}</option>
        </select>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <WorkspacePlayer ws={ws} teamGroups={teamGroups}
          layers={{ boxes: layers.boxes, labels: layers.ids, ball: layers.ball, people: true, trails: false, shapes: false, heat: false, passes: false }}
          ballBoxes="always" />
        {(message || (url && !ws?.run)) && (
          <p className="text-center text-sm text-muted">{message ?? dict.body.workspace.noBoxes}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label={dict.body.processing.forwardFrame} disabled={!url} onClick={() => ws?.seek(t + (ws?.intervalUs ?? 0))}
            className="vie-btn" title={dict.body.processing.forwardFrame}>▶|</button>
          <button type="button" aria-label={muted ? "Unmute" : dict.body.studio.muteLabel} disabled={!url} onClick={() => setMuted((m) => !m)}
            className="vie-btn" aria-pressed={muted}>{muted ? "🔇" : "🔊"}</button>
          <button type="button" aria-label={layers.ids ? "Hide labels" : "Show labels"} disabled={!url} onClick={() => setLayers({ ...layers, ids: !layers.ids })}
            className="vie-btn" aria-pressed={layers.ids}>Labels</button>
          <button type="button" aria-label={dict.body.workspace.pictureInPicture} disabled={!url}
            onClick={() => void ws?.videoRef.current?.requestPictureInPicture?.()} className="vie-btn">{dict.body.workspace.pictureInPicture}</button>
          <span className="ml-auto t-tc text-muted">{url ? `${Math.floor(t / 6e7)}:${String(Math.floor(t / 1e6) % 60).padStart(2, "0")} / ${video?.duration_us ? `${Math.floor(video.duration_us / 6e7)}:${String(Math.floor(video.duration_us / 1e6) % 60).padStart(2, "0")}` : "—"}` : "— / —"}</span>
        </div>
      </div>
    </section>
  );
}
