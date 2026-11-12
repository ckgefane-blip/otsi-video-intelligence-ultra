"use client";
/**
 * Page 04 — the player tools beyond the shared player's own bar (v3 Phase B.4, ADR-083). The shared VideoPlayer already gives
 * play / pause, ±1 s, scrubber, time, speed and fullscreen; this toolbar keeps the rest of the old playback bar, in flow:
 * step one analysed frame back / forward, In / Out marks (I / O) with Loop between them, zoom (follows the selected player),
 * Snapshot (B.5), picture-in-picture, mute, the pitch minimap, and the settings menu (the overlay switches, box colours by team,
 * and each overlay's opacity). The overlay switches write the viewer's shared preference (lib/overlayPrefs); <OverlaySync />
 * applies it to the workspace, so the left rail's OverlayToggles and this menu never disagree.
 */
import { useEffect, useState } from "react";
import { useOverlayPrefs } from "@/lib/overlayPrefs";
import { useLocale } from "@/lib/i18n";
import { clock, type Shared } from "@/components/workspace/shared";
import { SnapshotDialog, useMarks, useOverlayOpacity, ZOOMS, type OverlayOpacity } from "@/components/workspace/PlayerTools";

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

const quality = (h: number | null | undefined) => (!h ? "—" : h >= 2160 ? "4K" : h >= 1440 ? "QHD" : h >= 1080 ? "FHD" : h >= 720 ? "HD" : "SD");

export function AnalysisTools({ s, tools }: { s: Shared; tools: PlayerToolState }) {
  const { t: dict } = useLocale();
  const ws = s.ws;
  const [menu, setMenu] = useState(false);
  const [snap, setSnap] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [prefs, save] = useOverlayPrefs();
  const mk = useMarks(ws);
  const { byTeam, setByTeam, mini, setMini, zoom, setZoom, muted, setMuted, op, setOp } = tools;
  const url = ws?.playback?.available ? ws.playback.url : null;
  const t = ws?.timeUs ?? 0;
  const sel = ws?.tracks?.find((x) => x.track_id === ws.selectedId) ?? null;
  useEffect(() => { if (!hint) return; const h = setTimeout(() => setHint(null), 3500); return () => clearTimeout(h); }, [hint]);
  useEffect(() => { if (!menu) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [menu]);
  useEffect(() => { const el = ws?.videoRef.current; if (el) el.muted = muted; }, [muted, ws?.videoRef, url]);
  const btn = "vie-btn vie-btn-sm";
  const row: [string, boolean, () => void, string?][] = [
    [dict.body.workspace.playerIds, prefs.ids, () => save({ ...prefs, ids: !prefs.ids })],
    [dict.body.workspace.playerBoxesLower, prefs.boxes, () => save({ ...prefs, boxes: !prefs.boxes })],
    [dict.body.workspace.ballTrackingExp, prefs.ball, () => save({ ...prefs, ball: !prefs.ball })],
    [dict.body.workspace.playerTracks3s, prefs.trails, () => save({ ...prefs, trails: !prefs.trails })],
    [dict.body.workspace.layerTeamShapes, prefs.shapes, () => save({ ...prefs, shapes: !prefs.shapes })],
    [dict.body.workspace.heatmapOnPitch, prefs.heat, () => save({ ...prefs, heat: !prefs.heat })],
    [dict.body.workspace.layerPassArrows, prefs.passes, () => save({ ...prefs, passes: !prefs.passes })],
    [dict.body.workspace.colourBoxesByTeam, byTeam, () => setByTeam(!byTeam)],
    [dict.body.workspace.pitchMinimap, mini, () => setMini(!mini)],
  ];
  return (
    <div className="flex flex-wrap items-center gap-2" data-player-tools>
      <button type="button" className={btn} disabled={!url} aria-label={dict.body.processing.backFrame}
        onClick={() => { ws?.videoRef.current?.pause(); ws?.seek(Math.max(0, t - (ws?.intervalUs ?? 500_000))); }}>⏮ {dict.body.processing.backFrame}</button>
      <button type="button" className={btn} disabled={!url} aria-label={dict.body.processing.forwardFrame}
        onClick={() => { ws?.videoRef.current?.pause(); ws?.seek(t + (ws?.intervalUs ?? 500_000)); }}>{dict.body.processing.forwardFrame} ⏭</button>
      <button type="button" className={btn} disabled={!url} aria-pressed={mk.marks.inUs !== null} title={mk.marks.inUs !== null ? dict.body.workspace.inAtSetHere.replace("{a}", clock(mk.marks.inUs)) : dict.body.workspace.markInHere}
        onClick={mk.markIn}>I</button>
      <button type="button" className={btn} disabled={!url} aria-pressed={mk.marks.outUs !== null} title={mk.marks.outUs !== null ? dict.body.workspace.outAtSetHere.replace("{a}", clock(mk.marks.outUs)) : dict.body.workspace.markOutHere}
        onClick={mk.markOut}>O</button>
      <button type="button" className={btn} disabled={mk.marks.inUs === null || mk.marks.outUs === null} aria-pressed={mk.marks.loop}
        title={mk.marks.loop ? dict.body.workspace.loopOn : dict.body.workspace.loopBetween} onClick={mk.toggleLoop}>⟲</button>
      {(mk.marks.inUs !== null || mk.marks.outUs !== null) && (
        <button type="button" className={btn} aria-label={dict.body.workspace.clearInOut} onClick={mk.clear}>✕</button>
      )}
      <label className="flex items-center gap-1 text-sm text-muted">{dict.body.workspace.zoomLabel}
        <select aria-label={dict.body.workspace.zoomLabel} value={zoom} onChange={(e) => setZoom(e.target.value)} className="h-8 rounded border border-line bg-raised px-1 text-sm text-ink">
          {ZOOMS.map((z) => <option key={z} value={z}>{z}×</option>)}
        </select>
      </label>
      <button type="button" className={btn} disabled={!url} aria-label={dict.body.workspace.snapshotCaption}
        onClick={() => { ws?.videoRef.current?.pause(); setSnap(true); }}>📷 {dict.body.workspace.snapshotCaption}</button>
      <button type="button" className={btn} disabled={!url} aria-label={dict.body.workspace.pictureInPicture}
        onClick={() => void ws?.videoRef.current?.requestPictureInPicture?.()}>▣</button>
      <button type="button" className={btn} disabled={!url} aria-label={muted ? dict.body.workspace.unmuteLabel : dict.body.studio.muteLabel}
        onClick={() => setMuted(!muted)}>{muted ? "🔇" : "🔊"}</button>
      <button type="button" className={btn} aria-label={dict.body.workspace.jumpToPlayer} aria-disabled={!sel} title={sel ? dict.body.workspace.jumpToPlayerFirst : dict.body.workspace.selectPlayerFirstTitle}
        onClick={() => { if (sel) ws?.seek(sel.first_pts_us); else setHint(dict.body.workspace.selectPlayerHint); }}>◎ {dict.body.workspace.jumpToPlayer}</button>
      <span className="rounded border-2 border-[#f5a623] bg-[#281900cc] px-1.5 py-0.5 text-xs font-semibold text-[#f5b82e]" title={dict.body.workspace.videoResolution}>{quality(ws?.video?.height)}</span>
      <select aria-label={dict.body.tactics.cameraAngle} value="b" disabled title={dict.body.tactics.oneAnglePerVideo}
        className="h-8 rounded border border-line bg-raised px-1 text-sm text-muted" onChange={() => undefined}>
        <option value="b">{dict.body.workspace.broadcastView}</option>
      </select>
      <div className="relative ml-auto">
        <button type="button" className={btn} aria-label={dict.body.workspace.videoSettings} aria-haspopup="menu" aria-expanded={menu} disabled={!ws} onClick={() => setMenu((m) => !m)}>⚙ {dict.body.workspace.videoSettings}</button>
        {menu && ws && (
          <>
            <div onClick={() => setMenu(false)} className="fixed inset-0 z-30" />
            <div role="menu" aria-label={dict.body.workspace.videoSettings} className="absolute right-0 z-40 mt-1 w-[320px] rounded-md border border-line bg-panel p-3 shadow-xl">
              <div className="flex flex-col gap-1">
                {row.map(([label, on, flip]) => (
                  <button key={label} type="button" role="menuitemcheckbox" aria-checked={on} onClick={flip}
                    className={`flex items-center gap-3 rounded px-2 py-1.5 text-left text-sm ${on ? "bg-primary/15" : ""}`}>
                    <span aria-hidden className={`inline-flex h-5 w-5 items-center justify-center rounded border ${on ? "border-primary bg-primary text-white" : "border-line2"}`}>{on ? "✓" : ""}</span>
                    {label}
                  </button>
                ))}
              </div>
              <div role="group" aria-label={dict.body.workspace.overlayOpacity} className="mt-2 flex flex-col gap-2 border-t border-line pt-2 text-sm text-muted">
                <span className="font-semibold text-ink">{dict.body.workspace.overlayOpacity}</span>
                {([["boxes", dict.body.workspace.boxesAndIds], ["pitch", dict.body.workspace.pitchLayersLabel], ["ball", dict.body.processing.ball]] as const).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2">
                    <span className="w-[130px] shrink-0">{l}</span>
                    <input type="range" min={10} max={100} step={5} value={Math.round(op[k] * 100)} data-opacity={k} aria-label={dict.body.workspace.opacityLabel.replace("{a}", l)}
                      onChange={(e) => setOp(k, Number(e.target.value) / 100)} className="flex-1" />
                    <span className="w-11 text-right tabular-nums">{Math.round(op[k] * 100)}%</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      {hint && <span role="status" className="w-full rounded border border-primary bg-panel px-2 py-1 text-sm">{hint}</span>}
      <SnapshotDialog ws={ws} open={snap} onOpenChange={setSnap} />
    </div>
  );
}
