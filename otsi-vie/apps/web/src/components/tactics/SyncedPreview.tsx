"use client";
/**
 * Page 05 Section 04 — synced tactical video preview (approved reference 05_TACTICAL_INTELLIGENCE, "video preview").
 *
 * The chosen video's playback copy with the boxes of its latest finished run (useAnalysisWorkspace, the same boxes as page 04); the
 * sidebar's overlay switches choose people boxes, labels and the ball. One camera angle exists, so the angle selector has one option.
 * Transport: step one analysed frame, play / pause, seek, speed, mute, settings toggles labels, full screen; the square opens the video
 * picture-in-picture. Without a video: the reference's empty frame.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { B, T, u } from "@/components/stage/DesignStage";
import { FullscreenBar, fitFull, frameStyle, usePlayerFullscreen } from "@/components/media/Fullscreen";
import { kitOf, TrackOverlay } from "@/components/analysis/TrackOverlay";
import { Box, Head, Sel } from "./kit";
import type { Layers } from "./TacticsHeader";
import { useLocale } from "@/lib/i18n";

const F = { x: 1684, y: 351, w: 844, h: 369 };
const clock = (us: number | null) => (us === null ? "—" : `${Math.floor(us / 6e7)}:${String(Math.floor(us / 1e6) % 60).padStart(2, "0")}`);
const glyph = (x: number, size: number): CSSProperties => ({
  position: "absolute", left: u(x), top: u(760 - 101 - size * 0.55), height: u(size * 1.1), fontSize: u(size), lineHeight: 1.1, padding: 0, border: 0,
  background: "transparent", color: "#fff", cursor: "pointer", fontFamily: "inherit",
});

/** `teamGroups`: the kit groups of the team chosen in the team filter (null = all players); the ball is always shown */
export function SyncedPreview({ ws, layers, setLayers, teamGroups }: { ws: AnalysisWorkspaceState | null; layers: Layers; setLayers: (l: Layers) => void; teamGroups: Set<number> | null }) {
  const { t: dict } = useLocale();
  const [speed, setSpeed] = useState("1");
  const [muted, setMuted] = useState(false);
  const fs = usePlayerFullscreen();                                    // ADR-079: the shared full screen
  const url = ws?.playback?.available ? ws.playback.url : null;
  const video = ws?.video ?? null;
  const W = video?.width ?? 1920, H = video?.height ?? 1080;
  const tracks = useMemo(() => new Map((ws?.tracks ?? []).map((t) => [t.track_id, t])), [ws?.tracks]);
  useEffect(() => { const el = ws?.videoRef.current; if (el) el.playbackRate = Number(speed); }, [speed, ws?.videoRef, url]);
  useEffect(() => { const el = ws?.videoRef.current; if (el) el.muted = muted; }, [muted, ws?.videoRef, url]);

  const fit = W / H > F.w / F.h ? { w: F.w, h: F.w * H / W } : { w: F.h * W / H, h: F.h };
  const shown = (ws?.visible ?? []).filter(({ o }) => (o.class_name === "BALL" ? layers.ball
    : layers.boxes && (!teamGroups || teamGroups.has(kitOf(o, tracks) ?? -1))));
  const dur = video?.duration_us ?? null, t = ws?.timeUs ?? 0, p = dur ? Math.min(1, t / dur) : 0;
  const message = !ws ? dict.body.tactics.noVideoLoaded : !ws.playback ? dict.body.processing.loadingVideo : !url ? dict.body.tactics.noPlaybackYetReason.replace("{a}", ws.playback.reason ?? dict.body.workspace.beingPrepared) : null;

  return (
    <section id="p05-s04" aria-label={dict.body.tactics.syncedPreview} data-section="p05-s04" data-boxes={String(shown.length)}>
      <Box x={1676} y={292} w={856} h={505} />
      <Head x={1676} y={323} title={dict.body.tactics.videoPreviewSynced} info={dict.body.tactics.syncedVideoDesc} />
      <Sel x={2275} y={305} w={182} h={38} label={dict.body.tactics.cameraAngle} value="tactical" options={[["tactical", dict.body.tactics.tacticalAngle], ["broadcast", dict.body.tactics.broadcastAngle, dict.body.tactics.oneAnglePerVideo], ["close", dict.body.tactics.closeUp, dict.body.tactics.oneAnglePerVideo]]} />
      <button type="button" aria-label={dict.body.workspace.pictureInPicture} disabled={!url} onClick={() => void ws?.videoRef.current?.requestPictureInPicture?.()}
        className="absolute" style={{ left: u(2486), top: u(310 - 101), width: u(28), height: u(28), border: `${u(2)} solid #cfe3ff`, borderRadius: u(5),
          background: "transparent", padding: 0, cursor: url ? "pointer" : "default" }} />

      <dialog ref={fs.ref} open data-player-full={fs.on ? "on" : undefined} role="region" aria-label={dict.body.processing.matchVideoPlayer} className="absolute" style={frameStyle(fs.on, { left: u(F.x), top: u(F.y - 101), width: u(F.w), height: u(F.h), overflow: "hidden",
        background: url ? "#000" : "linear-gradient(180deg,#0a2a55 0,#143a70 22%,#1d5a2e 36%,#256b34 100%)" })}>
        {!url && (
          <>
            <div className="absolute" style={{ left: 0, top: 0, width: "100%", height: u(90), opacity: 0.75, background: `repeating-linear-gradient(90deg,#183a70,#10264a ${u(14)},#1d4380 ${u(28)})` }} />
            <B o={[F.x, F.y]} x={1695} y={360} w={350} h={37} style={{ background: "#0a1a38", borderRadius: u(4) }} />
            <B o={[F.x, F.y]} x={1695} y={360} w={40} h={37} style={{ background: "#fff", borderRadius: u(3) }} />
            <T o={[F.x, F.y]} x={1752} y={378} size={24} weight={700}>—</T>
            <B o={[F.x, F.y]} x={1826} y={360} w={76} h={37} style={{ background: "#1580ff", fontSize: u(22), fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>—</B>
            <T o={[F.x, F.y]} x={1912} y={378} size={22} weight={700}>—</T>
            <B o={[F.x, F.y]} x={1970} y={360} w={75} h={37} style={{ background: "#1580ff", fontSize: u(22), fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>—</B>
          </>
        )}
        {url && ws && (
          <div className="absolute" style={fs.on ? fitFull(W, H) : { left: `calc(50% - ${u(fit.w / 2)})`, top: `calc(50% - ${u(fit.h / 2)})`, width: u(fit.w), height: u(fit.h) }}>
            <video ref={ws.videoRef} src={url} preload="metadata" playsInline muted={muted} aria-label={dict.body.processing.matchVideo}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
            <TrackOverlay visible={shown} tracks={tracks} W={W} H={H} labels={layers.ids} selectedId={ws.selectedId} />
          </div>
        )}
        {(message || (url && !ws?.run)) && (
          <T o={[F.x, F.y]} x={2106} y={message ? 535 : 700} size={message ? 24 : 17} color="#dbe8f8" align="center">{message ?? dict.body.workspace.noBoxes}</T>
        )}
        {fs.on && ws && <FullscreenBar playing={!!ws.playing} onPlay={() => { const el = ws.videoRef.current; if (el) { if (el.paused) void el.play(); else el.pause(); } }}
          now={t} total={dur ?? 0} onSeek={(f) => ws.seek(f * (dur ?? 0))} muted={muted} onMute={() => setMuted((m) => !m)} onExit={fs.exit} />}
      </dialog>

      <button type="button" aria-label={dict.body.processing.forwardFrame} disabled={!url} onClick={() => ws?.seek(t + ws.intervalUs)} style={glyph(1702, 24)}>▶</button>
      <button type="button" aria-label={ws?.playing ? dict.body.upload.pause : dict.body.processing.playBtn} disabled={!url} style={glyph(1750, 44)}
        onClick={() => { const el = ws?.videoRef.current; if (el) { if (el.paused) void el.play(); else el.pause(); } }}>{ws?.playing ? "⏸" : "▶"}</button>
      <T x={1807} y={760} size={20}>{url ? `${clock(t)} / ${clock(dur)}` : "— / —"}</T>
      <div role="slider" aria-label={dict.body.players.position} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} tabIndex={url ? 0 : -1}
        onClick={(e) => { if (!ws || !dur) return; const r = e.currentTarget.getBoundingClientRect(); ws.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur); }}
        className="absolute" style={{ left: u(1945), top: u(744 - 101), width: u(321), height: u(33), cursor: url ? "pointer" : "default" }}>
        <B o={[1945, 744]} x={1945} y={757} w={321} h={7} style={{ background: "#17304f", borderRadius: u(4) }}>
          <i style={{ display: "block", height: "100%", width: `${p * 100}%`, borderRadius: u(4), background: "#1a8cff" }} />
        </B>
        <B o={[1945, 744]} x={1945 + p * (321 - 18)} y={751} w={18} h={18} style={{ borderRadius: "50%", background: "#fff" }} />
      </div>
      <Sel x={2292} y={741} w={73} h={38} label={dict.body.processing.playbackSpeed} value={speed} options={[["0.5", "0.5x"], ["1", "1x"], ["1.5", "1.5x"], ["2", "2x"]]}
        onChange={setSpeed} />
      <button type="button" aria-label={muted ? "Unmute" : dict.body.studio.muteLabel} disabled={!url} onClick={() => setMuted((m) => !m)} style={glyph(2388, 22)}>{muted ? "🔇" : "🔊"}</button>
      <button type="button" aria-label={layers.ids ? "Hide labels" : "Show labels"} disabled={!url} onClick={() => setLayers({ ...layers, ids: !layers.ids })} style={glyph(2436, 24)}>⚙</button>
      <button type="button" aria-label={dict.body.processing.fullScreen} disabled={!url} onClick={fs.toggle} style={glyph(2486, 24)}>⛶</button>
    </section>
  );
}
