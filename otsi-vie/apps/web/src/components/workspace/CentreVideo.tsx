"use client";
/**
 * Page 04 Sections 04-06 — analysis mode tabs, video player with score HUD and viewer tools, playback bar
 * (approved reference 04_ANALYSIS_WORKSPACE, centre).
 *
 * The five tabs switch the centre view on this page (they never open another page): Video Analysis (the video), Tactical View (everyone
 * placed on a top-down pitch at the playhead, from calibrated pitch positions), Heatmap (the selected player's heat zones, else both
 * teams'), Pass Network (not measured yet, as on Page 05) and Player Comparison (the Page 05 comparison). The video stays loaded under
 * the other tabs, so the playback bar keeps moving the playhead the Tactical View follows.
 *
 * The chosen video's playback copy with the boxes of its latest finished run (the same boxes as Page 03/05). A box is clickable and
 * selects that track. The score HUD shows the linked match's recorded teams and score. One camera angle exists. The top-right square
 * opens picture-in-picture, the second shows or hides the pitch minimap (an empty pitch: positions are not calibrated). Pitch overlays
 * (player tracks, team shapes, heatmap, pass arrows: PitchLayers) are drawn where the pitch is calibrated. Transport: play,
 * pause, step one analysed frame, seek, speed, mute, settings (a menu: IDs, boxes, ball, team colours, minimap), the target jumps to the selected player (or says to select one), full screen (the video fills the screen).
 *
 * v3 B.8 (ADR-085): every tab other than the video has "Open in Tactical", which opens the matching Tactical tab with the same video,
 * playhead and selected player. Player Comparison is no longer drawn twice: it lives on Tactical, and this tab links there.
 *
 * v3 B.4 (ADR-083): one analysed frame back as well as forward; In / Out marks (I, O) shown on the position bar, Loop between them; zoom
 * (follows the selected player while he is on screen); each overlay's opacity in the settings menu; Snapshot (B.5), a full-resolution still.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { jkl, typing } from "@/lib/keymap";
import { teamCode } from "@/lib/team";
import { B, T, u } from "@/components/stage/DesignStage";
import { FullscreenBar, fitFull, frameStyle, usePlayerFullscreen } from "@/components/media/Fullscreen";
import { Sel } from "@/components/tactics/kit";
import { clock, Hit, type Shared } from "./shared";
import { PitchMinimap } from "./PitchCalibration";
import { KIT_COLOUR, kitLegend, kitOf, TrackOverlay } from "@/components/analysis/TrackOverlay";
import { BallOverlay } from "./BallMarks";
import { PitchLayers } from "./PitchLayers";
import { useDw } from "./ResizableColumns";
import { HeatPitch, measuredText, useHeatZones } from "./HeatPitch";
import { heatSides, TeamHeat } from "@/components/tactics/Panels";
import Link from "next/link";
import { ANALYSIS_TO_TACTIC, tacticsHref } from "@/lib/tacticsLink";
import { Evidence } from "@/components/evidence/Evidence";
import { isPerson } from "./shared";
import { SnapshotDialog, useMarks, useOverlayOpacity, zoomOrigin, ZOOMS } from "./PlayerTools";
import { useLocale } from "@/lib/i18n";

const F0 = { x: 414, y: 175, w: 1580, h: 675 };            // the video frame in the approved composition; its width follows the centre column
/** the centre tabs: label, text x, underline width (approved composition) */
const quality = (h: number | null | undefined) => (!h ? "—" : h >= 2160 ? "4K" : h >= 1440 ? "QHD" : h >= 1080 ? "FHD" : h >= 720 ? "HD" : "SD");
const code = teamCode;
const glyph = (x: number, size: number): CSSProperties => ({
  position: "absolute", left: u(x), top: u(885 - 101 - size * 0.55), height: u(size * 1.1), fontSize: u(size), lineHeight: 1.1, padding: 0, border: 0,
  background: "transparent", color: "#fff", fontFamily: "inherit",
});


export function CentreVideo({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const { ws, match, teamGroups } = s;
  const MODES: [string, number, number][] = [[dict.body.workspace.videoAnalysis, 439, 207], [dict.body.workspace.tacticalView, 661, 168], [dict.body.workspace.heatmapMode, 853, 122], [dict.body.workspace.passNetworkMode, 1006, 176], [dict.body.workspace.playerComparisonMode, 1202, 232]];
  const dw = useDw();                                         // the centre column's width change: the frame and the bars widen, the right-hand tools stay at the right edge
  const F = { ...F0, w: F0.w + dw };
  const [speed, setSpeed] = useState("1");
  const [muted, setMuted] = useState(false);
  const [mini, setMini] = useState(true);
  const full = usePlayerFullscreen();                      // ADR-079: the shared full screen
  const fs = full.on;                                      // the video frame is full screen
  const [menu, setMenu] = useState(false);                 // the settings menu
  const [byTeam, setByTeam] = useState(true);              // box colours by team (off: every box one colour)
  const [hint, setHint] = useState<string | null>(null);   // a short message under a tool that has nothing to do yet
  const [pitchNote, setPitchNote] = useState<string | null>(null);   // why a pitch overlay draws nothing here
  const [mode, setMode] = useState(0);                     // the centre tab (0 = the video)
  const [zoom, setZoom] = useState("1");                   // B.4: the picture's zoom
  const [snap, setSnap] = useState(false);                 // B.5: the Snapshot dialog
  const { op, set: setOp } = useOverlayOpacity();          // B.4: each overlay's opacity
  const mk = useMarks(ws);                                 // B.4: In / Out marks and Loop
  useEffect(() => { if (!hint) return; const t = setTimeout(() => setHint(null), 3500); return () => clearTimeout(t); }, [hint]);
  useEffect(() => { if (!menu) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [menu]);
  const url = ws?.playback?.available ? ws.playback.url : null;
  const video = ws?.video ?? null;
  const W = video?.width ?? 1920, H = video?.height ?? 1080;
  const tracks = useMemo(() => new Map((ws?.tracks ?? []).map((t) => [t.track_id, t])), [ws?.tracks]);
  useEffect(() => { const el = ws?.videoRef.current; if (el) el.playbackRate = Number(speed); }, [speed, ws?.videoRef, url]);
  useEffect(() => { const el = ws?.videoRef.current; if (el) el.muted = muted; }, [muted, ws?.videoRef, url]);

  const fit = W / H > F.w / F.h ? { w: F.w, h: (F.w * H) / W } : { w: (F.h * W) / H, h: F.h };
  const layers = ws?.layers;
  const engineBall = !!ws?.ball.path?.t.length;                // the engine's ball replaces the old per-frame ball boxes once it exists
  const shown = (ws?.visible ?? []).filter(({ o }) => (o.class_name === "BALL" ? layers?.ball && !engineBall : layers?.boxes && layers.people && (!teamGroups || teamGroups.has(kitOf(o, tracks) ?? -1))));
  const dur = video?.duration_us ?? null, t = ws?.timeUs ?? 0, p = dur ? Math.min(1, t / dur) : 0;
  // A.9 (ADR-071): Space, J K L, one analysed frame (arrows) or one second (Shift + arrows) on the match video
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const v = ws?.videoRef.current, k = e.key.toLowerCase();
      if (!ws || !v || !url) return;
      if (k === " ") { if ((e.target as HTMLElement).closest("button, a, [role=button]")) return; if (v.paused) void v.play(); else v.pause(); }
      else if (!e.shiftKey && (k === "j" || k === "k" || k === "l")) {
        const r = jkl(k, { playing: !v.paused, rate: Number(speed) });
        if (!r.play) v.pause();
        setSpeed(String(r.rate));
        if (r.backUs) ws.seek(Math.max(0, t - r.backUs));
        if (r.play) { if (v.paused) void v.play(); setHint(dict.body.workspace.playingAt.replace("{a}", String(r.rate))); }
      } else if (!e.shiftKey && k === "i") { mk.markIn(); setHint(dict.body.workspace.inAtClock.replace("{a}", clock(t))); }
      else if (!e.shiftKey && k === "o") { mk.markOut(); setHint(dict.body.workspace.outAtClock.replace("{a}", clock(t))); }
      else if (k === "arrowleft" || k === "arrowright") {
        v.pause();
        const d = (k === "arrowleft" ? -1 : 1) * (e.shiftKey ? 1_000_000 : ws.intervalUs);
        ws.seek(Math.max(0, Math.min(dur ?? Number.MAX_SAFE_INTEGER, t + d)));
      } else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  const message = !ws ? dict.body.workspace.noVideoLoaded
    : !ws.playback ? dict.body.processing.loadingVideo : !url ? dict.body.analysis.noPlaybackYet.replace("{a}", ws.playback.reason ?? dict.body.workspace.beingPrepared) : null;
  const sel = ws?.tracks?.find((x) => x.track_id === ws.selectedId) ?? null;
  const selBox = ws?.selectedId ? (ws.visible.find(({ o }) => o.track_id === ws.selectedId)?.o ?? null) : null;   // the zoom follows him while he is seen
  const SL = 1050, SW = 538 + dw;                                                  // the position bar (B.4: after the marks)
  const at = (us: number | null) => (us === null || !dur ? null : SL + 10 + Math.min(1, us / dur) * (SW - 20));
  const score = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n));

  return (
    <>
      <section aria-label={dict.body.workspace.analysisModes} data-section="p04-s04">
        <h1 className="sr-only">{dict.nav.analysis}</h1>
        <div role="tablist" aria-label={dict.body.workspace.analysisView}>
          {MODES.map(([l, x, w], i) => (
            <button key={l} type="button" role="tab" aria-selected={mode === i} onClick={() => setMode(i)} className="absolute"
              style={{ left: u(x - 12), top: u(144 - 101 - 22), width: u(w - 8), height: u(46), padding: 0, border: 0, background: "transparent", color: "inherit", cursor: "pointer", textAlign: "left" }}>
              <T o={[x - 12, 144 - 22]} x={x} y={144} size={i === 0 ? 27 : 23} weight={mode === i ? 700 : 400} color={mode === i ? "#33a8ff" : undefined} as="span">{l}</T>
            </button>
          ))}
          <B x={MODES[mode]![1] - 25} y={171} w={MODES[mode]![2]} h={3} style={{ background: "#1e90ff" }} />
        </div>
      </section>
      {mode > 0 && (
        <div role="tabpanel" aria-label={MODES[mode]![0]} data-centre-view={MODES[mode]![0]} className="absolute"
          style={{ left: u(F.x), top: u(F.y - 101), width: u(F.w), height: u(F.h), zIndex: 3, background: "#07142a", borderRadius: `${u(8)} ${u(8)} 0 0`, overflow: "hidden" }}>
          {mode === 1 && <TacticalView s={s} />}
          {mode === 2 && <HeatView s={s} w={F.w} h={F.h} />}
          {mode === 3 && <PassNetworkView s={s} />}
          {mode === 4 && <ComparisonView s={s} />}
          <OpenInTactical s={s} mode={mode} />
        </div>
      )}

      <section id="p04-s05" aria-label={dict.body.workspace.videoPlayer} data-section="p04-s05" data-boxes={String(shown.length)}>
        <dialog ref={full.ref} open data-player-full={fs ? "on" : undefined} role="region" aria-label={dict.body.processing.matchVideoPlayer} className="absolute" style={frameStyle(fs, { left: u(F.x), top: u(F.y - 101), width: u(F.w), height: u(F.h), overflow: "hidden", borderRadius: `${u(8)} ${u(8)} 0 0`,
          background: url ? "#000" : "linear-gradient(180deg,#0a2a55 0,#143a70 20%,#1d5a2e 38%,#256b34 100%)" })}>
          {!url && <div className="absolute" style={{ left: 0, top: 0, width: "100%", height: u(170), opacity: 0.75, background: `repeating-linear-gradient(90deg,#183a70,#10264a ${u(14)},#1d4380 ${u(28)})` }} />}
          {url && ws && (
            <div className="absolute" data-zoom={zoom} style={{ ...(fs ? fitFull(W, H)
              : { left: `calc(50% - ${u(fit.w / 2)})`, top: `calc(50% - ${u(fit.h / 2)})`, width: u(fit.w), height: u(fit.h) }),
              ...(zoom !== "1" ? { transform: `scale(${zoom})`, transformOrigin: zoomOrigin(selBox), transition: "transform-origin .4s linear" } : {}) }}>
              <video ref={ws.videoRef} src={url} preload="metadata" playsInline muted={muted} aria-label={dict.body.processing.matchVideo} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
              <div data-overlay-opacity="pitch" style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: op.pitch }}><PitchLayers ws={ws} W={W} H={H} teamGroups={teamGroups} onNote={setPitchNote} /></div>
              <div data-overlay-opacity="boxes" style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: op.boxes }}>
                <TrackOverlay visible={shown} tracks={tracks} W={W} H={H} labels={!!layers?.labels} byTeam={byTeam} selectedId={ws.selectedId} onSelect={ws.select} />
              </div>
              {layers?.ball && <div data-overlay-opacity="ball" style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: op.ball }}><BallOverlay ball={ws.ball} timeUs={ws.timeUs} stepUs={ws.intervalUs} /></div>}
            </div>
          )}
          {url && ws?.run && byTeam && !fs && (
            <div className="absolute flex" data-box-legend style={{ left: u(18), bottom: u(14), gap: u(16), fontSize: u(20), color: "#fff", background: "rgba(0,0,0,.55)", padding: `${u(6)} ${u(12)}`, borderRadius: u(6), pointerEvents: "none" }}>
              {kitLegend(dict).map(([g, l]) => <span key={g} className="flex items-center" style={{ gap: u(6) }}><i style={{ width: u(16), height: u(16), background: KIT_COLOUR[g], display: "inline-block" }} />{l}</span>)}
            </div>
          )}
          {url && pitchNote && !fs && (
            <div className="absolute" data-pitch-note style={{ right: u(18), top: u(60), maxWidth: u(520), fontSize: u(17), color: "#fff", background: "rgba(0,0,0,.6)", padding: `${u(4)} ${u(10)}`, borderRadius: u(6), pointerEvents: "none", textAlign: "right" }}>{pitchNote}</div>
          )}
          {message && <T o={[F.x, F.y]} x={1204 + dw / 2} y={512} size={26} color="#dbe8f8" align="center">{message}</T>}
          {url && !ws?.run && <T o={[F.x, F.y]} x={1204 + dw / 2} y={700} size={20} color="#dbe8f8" align="center">{dict.body.workspace.noBoxes}</T>}

          {/* score HUD: the linked match's recorded teams and score */}
          <B o={[F.x, F.y]} x={439} y={200} w={441} h={40} style={{ background: "#0a1a38", borderRadius: u(4) }} />
          <B o={[F.x, F.y]} x={439} y={200} w={50} h={40} style={{ background: "#fff", borderRadius: u(3) }} />
          <T o={[F.x, F.y]} x={509} y={220} size={26} weight={700}>{code(match?.home?.name, match?.home?.short_name)}</T>
          <B o={[F.x, F.y]} x={603} y={200} w={92} h={40} style={{ background: "#1580ff", fontSize: u(24), fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{score(match?.home_score)}</B>
          <T o={[F.x, F.y]} x={710} y={222} size={24} weight={700}>{code(match?.away?.name, match?.away?.short_name)}</T>
          <B o={[F.x, F.y]} x={789} y={200} w={91} h={40} style={{ background: "#1580ff", fontSize: u(24), fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: `0 ${u(20)} ${u(20)} 0` }}>{score(match?.away_score)}</B>

          {mini && (() => {
            const placed = (ws?.visible ?? []).filter(({ o }) => o.class_name === "PERSON" && typeof o.pitch_x === "number" && typeof o.pitch_y === "number");
            const calibrated = (ws?.pitch.list ?? []).some((r) => r.status === "SUCCEEDED");
            const note = placed.length ? dict.body.workspace.placedCount.replace("{a}", String(placed.length)) : calibrated ? dict.body.workspace.notMeasuredHere : dict.body.workspace.pitchNotCalibrated;
            return (
              <div className="absolute" data-minimap style={fs
                ? { right: 24, bottom: 96, width: "min(26vw, 380px)", aspectRatio: "265 / 158", boxSizing: "border-box", border: "2px solid #19a0ff", borderRadius: 8, overflow: "hidden", boxShadow: "0 0 12px #19a0ff", zIndex: 5 }     // full screen: a corner, above the player's own bar, sized for the screen
                : { left: u(1717 + dw - F.x), top: u(680 - F.y), width: u(265), height: u(158), boxSizing: "border-box", border: `${u(2)} solid #19a0ff`, borderRadius: u(6), overflow: "hidden", boxShadow: "0 0 12px #19a0ff" }}>
                <PitchMinimap calibrated={calibrated}
                  dots={placed.map(({ o }) => ({ x: o.pitch_x as number, y: o.pitch_y as number, group: (o.kit_group ?? tracks.get(o.track_id)?.kit_group ?? null) as number | null, chosen: o.track_id === ws?.selectedId }))} />
                {fs ? <span style={{ position: "absolute", left: 0, right: 0, bottom: 2, textAlign: "center", fontSize: 13, color: "#d7efe0", textShadow: "0 0 3px #000" }}>{note}</span>
                  : <T o={[1717, 680]} x={1850} y={826} size={14} color="#d7efe0" align="center" style={{ textShadow: "0 0 3px #000" }}>{note}</T>}
              </div>
            );
          })()}
          {fs && ws && <FullscreenBar playing={!!ws.playing} onPlay={() => { const el = ws.videoRef.current; if (el) { if (el.paused) void el.play(); else el.pause(); } }}
            now={t} total={dur ?? 0} onSeek={(f) => ws.seek(f * (dur ?? 0))} muted={muted} onMute={() => setMuted((m) => !m)} onExit={full.exit} />}
        </dialog>
        <Sel x={1428 + dw} y={190} w={100} h={45} label={dict.body.workspace.zoomLabel} value={zoom} options={ZOOMS.map((z): [string, string] => [z, `${z}×`])}
          onChange={setZoom} style={{ background: "rgba(8,20,40,.85)", borderColor: zoom !== "1" ? "#1e90ff" : "#2a4f80", zIndex: 2 }} />
        <Hit x={1540 + dw} y={190} w={45} h={45} label={dict.body.workspace.snapshotCaption} {...(url ? { onClick: () => { ws?.videoRef.current?.pause(); setSnap(true); } } : { reason: dict.body.workspace.noVideoYet })}
          style={{ border: `${u(1.5)} solid #2a4f80`, borderRadius: u(6), background: "rgba(8,20,40,.85)", zIndex: 2 }}>
          <T o={[1540, 190]} x={1562} y={213} size={20} align="center" as="span">📷</T>
        </Hit>
        <Sel x={1592 + dw} y={190} w={203} h={45} label={dict.body.tactics.cameraAngle} value="b" options={[["b", dict.body.workspace.broadcastView], ["t", dict.body.workspace.tacticalAngleView, dict.body.tactics.oneAnglePerVideo]]}
          style={{ background: "rgba(8,20,40,.85)", borderColor: "#2a4f80", zIndex: 2 }} />
        <Hit x={1808 + dw} y={190} w={45} h={45} label={dict.body.workspace.pictureInPicture} {...(url ? { onClick: () => void ws?.videoRef.current?.requestPictureInPicture?.() } : { reason: dict.body.workspace.noVideoYet })}
          style={{ border: `${u(1.5)} solid #2a4f80`, borderRadius: u(6), background: "rgba(8,20,40,.85)", zIndex: 2 }}>
          <T o={[1808, 190]} x={1830} y={213} size={20} align="center" as="span">▣</T>
        </Hit>
        <Hit x={1867 + dw} y={190} w={46} h={45} label={mini ? dict.body.workspace.hideMinimap : dict.body.workspace.showMinimap} pressed={mini} onClick={() => setMini((m) => !m)}
          style={{ border: `${u(1.5)} solid ${mini ? "#1e90ff" : "#2a4f80"}`, borderRadius: u(6), background: "rgba(8,20,40,.85)", zIndex: 2 }}>
          <T o={[1867, 190]} x={1890} y={213} size={20} align="center" as="span">▦</T>
        </Hit>
        <div title={dict.body.workspace.videoResolution}><B x={1927 + dw} y={192} w={50} h={38} style={{ border: `${u(2)} solid #f5a623`, borderRadius: u(5), background: "rgba(40,25,0,.8)", color: "#f5b82e", fontWeight: 700,
          fontSize: u(21), display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>{quality(video?.height)}</B></div>
      </section>

      <section aria-label={dict.body.workspace.playbackBar} data-section="p04-s06">
        <B x={414} y={850} w={1580 + dw} h={68} style={{ background: "#07142a", borderRadius: `0 0 ${u(8)} ${u(8)}` }} />
        <button type="button" aria-label={dict.body.processing.playBtn} disabled={!url} onClick={() => void ws?.videoRef.current?.play()} style={{ ...glyph(448, 30), cursor: url ? "pointer" : "default" }}>▶</button>
        <button type="button" aria-label={dict.body.upload.pause} disabled={!url} onClick={() => ws?.videoRef.current?.pause()} style={{ ...glyph(512, 28), cursor: url ? "pointer" : "default" }}>❚❚</button>
        <button type="button" aria-label={dict.body.processing.backFrame} disabled={!url} onClick={() => { ws?.videoRef.current?.pause(); ws?.seek(Math.max(0, t - ws.intervalUs)); }} style={{ ...glyph(572, 24), cursor: url ? "pointer" : "default" }}>⏮</button>
        <button type="button" aria-label={dict.body.processing.forwardFrame} disabled={!url} onClick={() => { ws?.videoRef.current?.pause(); ws?.seek(t + ws.intervalUs); }} style={{ ...glyph(618, 24), cursor: url ? "pointer" : "default" }}>⏭</button>
        <T x={668} y={885} size={20} style={{ whiteSpace: "nowrap" }}>{url ? `${clock(t)} / ${clock(dur)}` : "— / —"}</T>
        {/* B.4: In / Out marks and Loop */}
        <Hit x={884} y={866} w={36} h={36} label={mk.marks.inUs !== null ? dict.body.workspace.inAtSetHere.replace("{a}", clock(mk.marks.inUs)) : dict.body.workspace.markInHere} pressed={mk.marks.inUs !== null} {...(url ? { onClick: mk.markIn } : { reason: dict.body.workspace.noVideoYet })}
          style={{ border: `${u(1.5)} solid ${mk.marks.inUs !== null ? "#ffd400" : "#2a4f80"}`, borderRadius: u(5), color: "#ffe680", fontSize: u(18), fontWeight: 700, textAlign: "center", lineHeight: u(33) }}>I</Hit>
        <Hit x={926} y={866} w={36} h={36} label={mk.marks.outUs !== null ? dict.body.workspace.outAtSetHere.replace("{a}", clock(mk.marks.outUs)) : dict.body.workspace.markOutHere} pressed={mk.marks.outUs !== null} {...(url ? { onClick: mk.markOut } : { reason: dict.body.workspace.noVideoYet })}
          style={{ border: `${u(1.5)} solid ${mk.marks.outUs !== null ? "#ffd400" : "#2a4f80"}`, borderRadius: u(5), color: "#ffe680", fontSize: u(18), fontWeight: 700, textAlign: "center", lineHeight: u(33) }}>O</Hit>
        <Hit x={968} y={866} w={36} h={36} label={mk.marks.loop ? dict.body.workspace.loopOn : dict.body.workspace.loopBetween} pressed={mk.marks.loop}
          {...(mk.marks.inUs !== null && mk.marks.outUs !== null ? { onClick: mk.toggleLoop } : { reason: dict.body.workspace.markInOutFirst })}
          style={{ border: `${u(1.5)} solid ${mk.marks.loop ? "#1e90ff" : "#2a4f80"}`, borderRadius: u(5), background: mk.marks.loop ? "#0f4f9a" : "transparent", color: "#fff", fontSize: u(20), textAlign: "center", lineHeight: u(33) }}>⟲</Hit>
        {(mk.marks.inUs !== null || mk.marks.outUs !== null) && (
          <Hit x={1008} y={872} w={24} h={24} label={dict.body.workspace.clearInOut} onClick={mk.clear} style={{ color: "#9fb4d0", fontSize: u(16), textAlign: "center", lineHeight: u(22) }}>✕</Hit>
        )}
        <div role="slider" aria-label={dict.body.players.position} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} tabIndex={url ? 0 : -1}
          onClick={(e) => { if (!ws || !dur) return; const r = e.currentTarget.getBoundingClientRect(); ws.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur); }}
          className="absolute" style={{ left: u(SL), top: u(868 - 101), width: u(SW), height: u(34), cursor: url ? "pointer" : "default" }}>
          <B o={[SL, 868]} x={SL + 10} y={882} w={SW - 20} h={7} style={{ background: "#17304f", borderRadius: u(4) }}>
            <i style={{ display: "block", height: "100%", width: `${p * 100}%`, borderRadius: u(4), background: "#1a8cff" }} />
          </B>
          {at(mk.marks.inUs) !== null && at(mk.marks.outUs) !== null && (
            <B o={[SL, 868]} x={at(mk.marks.inUs)!} y={879} w={Math.max(2, at(mk.marks.outUs)! - at(mk.marks.inUs)!)} h={13} style={{ background: mk.marks.loop ? "rgba(30,144,255,.45)" : "rgba(255,212,0,.3)", pointerEvents: "none" }} />
          )}
          {([["in", mk.marks.inUs], ["out", mk.marks.outUs]] as const).map(([k, us]) => at(us) !== null && (
            <B key={k} o={[SL, 868]} x={at(us)! - 1.5} y={872} w={3} h={27} data-mark={k} style={{ background: "#ffd400", pointerEvents: "none" }} />
          ))}
          <B o={[SL, 868]} x={SL + p * (SW - 20)} y={874} w={20} h={20} style={{ borderRadius: "50%", background: "#fff" }} />
        </div>
        <Sel x={1610 + dw} y={866} w={107} h={40} label={dict.body.processing.playbackSpeed} value={speed} options={[["0.5", "0.5x"], ["1", "1x"], ["1.5", "1.5x"], ["2", "2x"]]} onChange={setSpeed} />
        <button type="button" aria-label={muted ? dict.body.workspace.unmuteLabel : dict.body.studio.muteLabel} disabled={!url} onClick={() => setMuted((m) => !m)} style={{ ...glyph(dw + 1748, 24), cursor: url ? "pointer" : "default" }}>{muted ? "🔇" : "🔊"}</button>
        <button type="button" aria-label={dict.body.workspace.videoSettings} aria-haspopup="menu" aria-expanded={menu} disabled={!ws} onClick={() => setMenu((m) => !m)} style={{ ...glyph(dw + 1812, 26), cursor: ws ? "pointer" : "default", color: menu ? "#33a8ff" : "#fff" }}>⚙</button>
        <button type="button" aria-label={dict.body.workspace.jumpToPlayer} aria-disabled={!sel} title={sel ? dict.body.workspace.jumpToPlayerFirst : dict.body.workspace.selectPlayerFirstTitle}
          onClick={() => { if (sel) ws?.seek(sel.first_pts_us); else setHint(dict.body.workspace.selectPlayerHint); }}
          style={{ ...glyph(dw + 1876, 26), cursor: "pointer", opacity: sel ? 1 : 0.55 }}>◎</button>
        <button type="button" aria-label={dict.body.processing.fullScreen} disabled={!url} onClick={full.toggle} style={{ ...glyph(dw + 1940, 26), cursor: url ? "pointer" : "default" }}>⛶</button>
        {hint && <B x={1380 + dw} y={792} w={600} h={48} style={{ zIndex: 4, background: "#0a2a55", border: `${u(1.5)} solid #33a8ff`, borderRadius: u(8), color: "#fff", fontSize: u(19), display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: `0 ${u(10)}` }}><span role="status">{hint}</span></B>}
        {menu && ws && (
          <>
            <div onClick={() => setMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 3 }} />
            <B x={1640 + dw} y={250} w={340} h={592} style={{ zIndex: 4, background: "#0a1a38", border: `${u(1.5)} solid #2a4f80`, borderRadius: u(10), padding: u(10), display: "flex", flexDirection: "column", gap: u(4) }}>
              <div role="menu" aria-label={dict.body.workspace.videoSettings} style={{ display: "flex", flexDirection: "column", gap: u(4) }}>
                {([[dict.body.workspace.playerIds, !!ws.layers.labels, () => ws.setLayers({ ...ws.layers, labels: !ws.layers.labels })],
                   [dict.body.workspace.playerBoxesLower, !!ws.layers.boxes, () => ws.setLayers({ ...ws.layers, boxes: !ws.layers.boxes })],
                   [dict.body.workspace.ballTrackingExp, !!ws.layers.ball, () => ws.setLayers({ ...ws.layers, ball: !ws.layers.ball })],
                   [dict.body.workspace.playerTracks3s, !!ws.layers.trails, () => ws.setLayers({ ...ws.layers, trails: !ws.layers.trails })],
                   [dict.body.workspace.layerTeamShapes, !!ws.layers.shapes, () => ws.setLayers({ ...ws.layers, shapes: !ws.layers.shapes })],
                   [dict.body.workspace.heatmapOnPitch, !!ws.layers.heat, () => ws.setLayers({ ...ws.layers, heat: !ws.layers.heat })],
                   [dict.body.workspace.layerPassArrows, !!ws.layers.passes, () => ws.setLayers({ ...ws.layers, passes: !ws.layers.passes })],
                   [dict.body.workspace.colourBoxesByTeam, byTeam, () => setByTeam((v) => !v)],
                   [dict.body.workspace.pitchMinimap, mini, () => setMini((v) => !v)]] as [string, boolean, () => void][]).map(([label, on, flip]) => (
                  <button key={label} type="button" role="menuitemcheckbox" aria-checked={on} onClick={flip}
                    style={{ display: "flex", alignItems: "center", gap: u(12), height: u(42), padding: `0 ${u(10)}`, border: 0, borderRadius: u(6), background: on ? "#10335f" : "transparent", color: "#fff", fontSize: u(21), textAlign: "left", cursor: "pointer" }}>
                    <span aria-hidden style={{ width: u(22), height: u(22), border: `${u(2)} solid ${on ? "#33a8ff" : "#7fa4d4"}`, borderRadius: u(4), background: on ? "#1e90ff" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: u(16) }}>{on ? "✓" : ""}</span>
                    {label}
                  </button>
                ))}
              </div>
              <div role="group" aria-label={dict.body.workspace.overlayOpacity} style={{ borderTop: `${u(1)} solid #1f4a7a`, marginTop: u(4), paddingTop: u(8), display: "flex", flexDirection: "column", gap: u(6), fontSize: u(18), color: "#cfdcf0" }}>
                <span style={{ fontWeight: 700 }}>{dict.body.workspace.overlayOpacity}</span>
                {([["boxes", dict.body.workspace.boxesAndIds], ["pitch", dict.body.workspace.pitchLayersLabel], ["ball", dict.body.processing.ball]] as const).map(([k, l]) => (
                  <label key={k} style={{ display: "flex", alignItems: "center", gap: u(8) }}>
                    <span style={{ width: u(130) }}>{l}</span>
                    <input type="range" min={10} max={100} step={5} value={Math.round(op[k] * 100)} data-opacity={k} aria-label={dict.body.workspace.opacityLabel.replace("{a}", l)}
                      onChange={(e) => setOp(k, Number(e.target.value) / 100)} style={{ flex: 1 }} />
                    <span style={{ width: u(46), textAlign: "right" }}>{Math.round(op[k] * 100)}%</span>
                  </label>
                ))}
              </div>
            </B>
          </>
        )}
        <SnapshotDialog ws={ws} open={snap} onOpenChange={setSnap} />
      </section>
    </>
  );
}


/* ------------------------------------------------------------------ the centre tabs other than the video */
/** B.8 (ADR-085): the same view on the Tactical page, with this video, playhead and selected player */
function OpenInTactical({ s, mode }: { s: Shared; mode: number }) {
  const { t: dict } = useLocale();
  const videoId = s.ws?.video?.id;
  const tab = ANALYSIS_TO_TACTIC[mode];
  if (!videoId || !tab) return null;
  const href = tacticsHref({ videoId, tab, timeUs: s.ws?.timeUs ?? null, trackId: s.ws?.selectedId ?? null });
  return (
    <Link href={href} data-open-tactical={tab} title={dict.body.workspace.openTacticalHint}
      style={{ position: "absolute", right: u(18), top: u(14), zIndex: 5, padding: `${u(6)} ${u(14)}`, borderRadius: u(6), border: `${u(1.5)} solid #33a8ff`,
        background: "#0b2347", color: "#cfe6ff", fontSize: u(18), fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
      {dict.body.workspace.openInTactical} →
    </Link>
  );
}

/** Player Comparison lives on the Tactical page (one place, not two) */
function ComparisonView({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const sel = s.ws?.selectedId ? s.ws.tracks?.find((t) => t.track_id === s.ws!.selectedId) ?? null : null;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: u(14), textAlign: "center", padding: u(40) }}>
      <div style={{ fontSize: u(26), fontWeight: 700, color: "#dbe8f8" }}>{dict.body.workspace.playerComparisonTactical}</div>
      <div style={{ fontSize: u(20), color: "#b9cbe2", maxWidth: u(900), lineHeight: 1.4 }}>
        {sel ? dict.body.workspace.opensAtMoment.replace("{a}", String(sel.track_number)) : dict.body.workspace.opensAtMomentNoPlayer}
        {" "}{dict.body.workspace.headToHeadNotMeasured}
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, padding: `${u(18)} ${u(26)}`, fontSize: u(20), color: "#b9cbe2", lineHeight: 1.35 }}>{children}</p>;
}

const DOT = (g: number | null) => (g === 0 ? "#2ee86a" : g === 1 ? "#ff4d4d" : g === 2 ? "#ffd600" : "#19a0ff");

/** everyone placed on the pitch at the playhead (calibrated pitch positions only) */
function TacticalView({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const ws = s.ws;
  const tracks = useMemo(() => new Map((ws?.tracks ?? []).map((t) => [t.track_id, t])), [ws?.tracks]);
  const placed = (ws?.visible ?? []).filter(({ o }) => o.class_name === "PERSON" && typeof o.pitch_x === "number" && typeof o.pitch_y === "number"
    && (!s.teamGroups || s.teamGroups.has((o.kit_group ?? tracks.get(o.track_id)?.kit_group ?? -1) as number)));
  const calibrated = (ws?.pitch.list ?? []).some((r) => r.status === "SUCCEEDED");
  const why = !ws?.run ? dict.body.workspace.noFinishedYet : !calibrated ? dict.body.workspace.pitchNotCalibratedVideo
    : placed.length ? null : dict.body.workspace.noPitchPositionMoment;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: u(12), padding: `${u(14)} ${u(26)}`, fontSize: u(20), color: "#dbe8f8" }}>
        <span className="font-normal">{dict.body.workspace.positionsAt.replace("{a}", clock(ws?.timeUs ?? 0))}</span>
        <span style={{ color: "#8ea3bf" }}>{dict.body.workspace.placedCount.replace("{a}", String(placed.length))}</span>
        {placed.length > 0 && <Evidence level="INFERRED" size={14} why={dict.body.workspace.pitchPositionsCalibrated} />}
        <span style={{ marginLeft: "auto", display: "flex", gap: u(16), color: "#cfdcf0" }}>
          {kitLegend(dict).map(([g, l]) => <span key={g} style={{ display: "flex", alignItems: "center", gap: u(6) }}><i style={{ width: u(14), height: u(14), borderRadius: "50%", background: DOT(g), display: "inline-block" }} />{l}</span>)}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: `0 ${u(26)} ${u(20)}` }}>
        <div style={{ height: "100%", aspectRatio: "111 / 74", maxWidth: "100%", border: `${u(2)} solid #19a0ff`, borderRadius: u(6), overflow: "hidden", position: "relative" }}>
          <PitchMinimap calibrated={calibrated}
            dots={placed.map(({ o }) => ({ x: o.pitch_x as number, y: o.pitch_y as number, group: (o.kit_group ?? tracks.get(o.track_id)?.kit_group ?? null) as number | null, chosen: o.track_id === ws?.selectedId }))} />
          {why && <div style={{ position: "absolute", left: 0, right: 0, top: "45%", textAlign: "center", fontSize: u(20), color: "#fff", textShadow: "0 0 4px #000", padding: `0 ${u(20)}` }}>{why}</div>}
        </div>
      </div>
    </div>
  );
}

/** the selected player's heat zones, else both teams' */
function HeatView({ s, w, h }: { s: Shared; w: number; h: number }) {
  const { t: dict } = useLocale();
  const ws = s.ws;
  const sel = ws?.tracks?.find((x) => x.track_id === ws.selectedId && isPerson(x)) ?? null;
  const calKey = (ws?.pitch.list ?? []).filter((r) => r.status === "SUCCEEDED").length;
  const { zones, loading } = useHeatZones(ws?.run && sel ? `/v1/analysis-runs/${ws.run.id}/tracks/${sel.track_id}/heat-zones` : null, calKey);
  if (!ws?.run) return <Note>{dict.body.workspace.noFinishedYet}</Note>;
  if (sel) {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: u(12), padding: `${u(14)} ${u(26)}`, fontSize: u(20), color: "#dbe8f8" }}>
          <span className="font-normal">{sel.label.split(" · ")[0]}</span><span style={{ color: "#8ea3bf" }}>{zones ? measuredText(zones, dict) : loading ? dict.body.processing.reading : dict.body.workspace.noHeatZones}</span>
          {zones && zones.measured_s > 0 && <Evidence level="INFERRED" size={14} why={dict.body.workspace.timeInZones} />}
          <button type="button" onClick={() => ws.select(null)} style={{ marginLeft: "auto", fontSize: u(18), color: "#33a8ff", background: "transparent", border: 0, cursor: "pointer" }}>{dict.body.workspace.showBothTeams}</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", justifyContent: "center", padding: `0 ${u(26)} ${u(20)}` }}>
          <div style={{ height: "100%", aspectRatio: "109 / 72", maxWidth: "100%" }}>{zones && <HeatPitch zones={zones} label={dict.body.workspace.heatZonesOf.replace("{a}", sel.label)} />}</div>
        </div>
      </div>
    );
  }
  const sides = heatSides(s.kits, s.match, dict);
  const pw = (w - 26 * 3) / 2, ph = Math.min(h - 140, pw * 0.66);
  return (
    <>
      <Note>{dict.body.workspace.bothTeamsHeat}</Note>
      {[0, 1].map((i) => (
        <div key={i}>
          <div style={{ position: "absolute", left: u(26 + i * (pw + 26)), top: u(78), fontSize: u(20), fontWeight: 700, color: "#dbe8f8" }}>{sides[i]?.label ?? (i ? dict.body.workspace.awayTeam : dict.body.workspace.homeTeam)}</div>
          <div style={{ position: "absolute", left: u(26 + i * (pw + 26)), top: u(110), width: u(pw), height: u(ph), background: "#1d5a2e", border: `${u(2)} solid #cfe3d8` }} />
          <TeamHeat runId={ws.run!.id} side={sides[i]} x={28 + i * (pw + 26)} y={112 + 101} w={pw - 4} h={ph - 4} calKey={calKey} />
        </div>
      ))}
    </>
  );
}

/** not measured yet, as on Page 05 */
function PassNetworkView({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const n = s.ws?.events.data?.passes.length ?? null;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: u(14), textAlign: "center", padding: u(40) }}>
      <Evidence level="NOT_MEASURED" size={18} />
      <div style={{ fontSize: u(26), fontWeight: 700, color: "#dbe8f8" }}>{dict.body.workspace.passNetworkNotMeasured}</div>
      <div style={{ fontSize: u(20), color: "#b9cbe2", maxWidth: u(900), lineHeight: 1.4 }}>
        {dict.body.workspace.passNetworkNeeds}
        {n !== null && dict.body.workspace.passesFoundEventsTab.replace("{a}", String(n))}
      </div>
    </div>
  );
}
