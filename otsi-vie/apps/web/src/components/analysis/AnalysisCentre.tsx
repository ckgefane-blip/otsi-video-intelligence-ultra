"use client";
/**
 * Page 06 Analysis — the centre (SOT, Analysis.dc.html).
 *
 * The tool bar (Select / Identify / Mark ball / Marker / Calibrate pitch),
 * the video on the shared player (WorkspacePlayer, max 860 px wide), and
 * the dialogs those tools open. The five mode tabs, the score HUD and the
 * old playback toolbar of the Drop 2 centre are not on this SOT page:
 * Tactical View / Heatmap / Pass Network live on the Tactical page, and
 * the shared player already gives play / pause, ±1 s, scrubber, time,
 * speed and fullscreen. M adds a marker at the playhead.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import type { VideoMarker } from "@otsi-vie/contracts";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { clock, type Shared } from "@/components/workspace/shared";
import { AnalysisToolBar, usePlayerToolState, type AnalysisTool } from "./AnalysisTools";
import { WorkspacePlayer } from "./WorkspacePlayer";
import { BallMarkDialog } from "@/components/workspace/BallMarks";
import { PitchCalibrationDialog } from "@/components/workspace/PitchCalibration";

export function MarkerDialog({ open, onOpenChange, videoId, atUs, onAdded }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  videoId: string | null;
  atUs: number;
  onAdded: () => void;
}) {
  const { t: dict } = useLocale();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setBody(""); setErr(null); } }, [open ]);
  if (!videoId) return null;
  const save = () => {
    if (!body.trim()) return;
    setBusy(true); setErr(null);
    void api<VideoMarker[]>(`/v1/videos/${videoId}/markers`, { method: "POST", json: { at_pts_us: atUs, body: body.trim() } })
      .then(() => { onAdded(); onOpenChange(false); }, (x) => setErr(x instanceof ApiProblem ? x.message : dict.body.analysis.thatDidNotWork))
      .finally(() => setBusy(false));
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(460px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 shadow-2xl">
          <Dialog.Title className="mb-1 t-panel">{dict.body.workspace.markersNotes}</Dialog.Title>
          <Dialog.Description className="t-small mb-3 text-muted">{dict.body.workspace.notePinned}</Dialog.Description>
          <label className="mb-1 block text-xs text-muted" htmlFor="analysis-marker-body">
            {dict.body.workspace.noteAtPlayhead.replace("{a}", clock(atUs))}
          </label>
          <textarea id="analysis-marker-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={2} autoFocus
            className="w-full rounded-ctl border border-line bg-canvas p-2 text-sm outline-none focus:border-primary" />
          {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="vie-btn">{dict.common.cancel}</button>
            <button type="button" disabled={busy || !body.trim()} onClick={save} className="vie-btn vie-btn-pri">
              {dict.body.workspace.pinAt.replace("{a}", clock(atUs))}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AnalysisCentre({ s, onMarker, onIdentify }: { s: Shared; onMarker: () => void; onIdentify: () => void }) {
  const { t: dict } = useLocale();
  const a = dict.body.analysis;
  const { ws, match, teamGroups } = s;
  const [tool, setTool] = useState<AnalysisTool>("select");
  const [ballOpen, setBallOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const tools = usePlayerToolState();
  const video = ws?.video ?? null;
  const ev = ws?.events.data ?? null;
  const totalEvents = ev ? ev.passes.length + ev.shots.length + ev.changes.length + ev.pressures.length + ev.set_pieces.length : 0;

  const pickTool = (t: AnalysisTool) => {
    // Select is the mode; the other four are actions that open a dialog.
    // The mode stays Select while a dialog is open.
    if (t === "select") setTool("select");
    else if (t === "identify") onIdentify();
    else if (t === "ball") setBallOpen(true);
    else if (t === "marker") onMarker();
    else if (t === "pitch") setCalOpen(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key.toLowerCase() === "m" && ws?.video) { e.preventDefault(); onMarker(); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [ws?.video, onMarker]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <AnalysisToolBar
        tool={tool}
        onTool={pickTool}
        right={
          video ? (
            <span className="t-small text-muted">
              {match ? `${match.home?.name ?? "—"} v ${match.away?.name ?? "—"}` : (video.title ?? video.original_filename ?? "")}
              {" · "}
              {totalEvents} {dict.body.workspace.metricEvents}
            </span>
          ) : null
        }
      />

      <div className="flex justify-center">
        <div className="w-full max-w-[860px]">
          <WorkspacePlayer ws={ws} teamGroups={teamGroups} layers={ws?.layers ?? null} byTeam={tools.byTeam} pitchLayers ballRing
            minimap={tools.mini} zoom={tools.zoom} op={tools.op} emptyTransport emptyWhenIdle />
          {ws && !ws.video && !ws.error && <p className="mt-2 text-sm text-muted" role="status">{dict.body.processing.loadingVideo}</p>}
          {ws?.error && <p className="mt-2 text-sm text-danger" role="alert">{ws.error}</p>}
          {ws?.playback && !ws.playback.available && (
            <p className="mt-2 text-sm text-muted" role="status">
              {a.noPlaybackYet?.replace("{a}", ws.playback.reason ?? dict.body.workspace.beingPrepared) ?? dict.body.workspace.beingPrepared}
            </p>
          )}
          {ws?.playback?.available && !ws?.run && <p className="mt-2 text-sm text-muted">{dict.body.workspace.noBoxes}</p>}
        </div>
      </div>

      {ws?.video && (
        <BallMarkDialog open={ballOpen} onOpenChange={setBallOpen}
          videoId={ws.video.id} videoRef={ws.videoRef} stepUs={ws.intervalUs} ball={ws.ball} />
      )}
      {ws?.video && (
        <PitchCalibrationDialog open={calOpen} onOpenChange={setCalOpen}
          videoId={ws.video.id} videoRef={ws.videoRef} onStarted={() => void ws.pitch.reload()} others={ws.pitch.list} />
      )}
    </div>
  );
}
