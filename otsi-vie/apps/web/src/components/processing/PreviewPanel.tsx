"use client";
/**
 * Page 03 Section 04 — Processing Preview, on the Desktop UI flow layout.
 *
 * The selected video's playback copy with the boxes of its latest finished analysis run drawn over it, from the Analysis workspace's
 * own data hook (useAnalysisWorkspace, ADR-035): the same boxes as page 04. View chooses what is drawn, Teams filters by the run's kit
 * colour groups, named by the team a person assigned to them (GET /v1/analysis-runs/:id/kit-groups; colour alone names nothing),
 * Overlays chooses boxes with or without track labels. A person's name appears only
 * after a person confirmed the identity. The transport steps one analysed frame, plays, seeks, sets the speed, mutes and goes full
 * screen. Without a video, or before a run has finished, the empty frame says so.
 *
 * The player here is the page's own <video>, not the shared VideoPlayer: the Analysis workspace drives this element directly
 * (ws.videoRef, frame stepping, time in microseconds) and the shared player does not expose that. Its source is the same signed
 * playback URL (GET /v1/videos/:id/playback, via the workspace).
 */
import { useEffect, useMemo, useState } from "react";
import type { RunTeams } from "@otsi-vie/contracts";
import { Maximize2, Pause, Play, SkipBack, SkipForward, Tags, Volume2, VolumeX } from "lucide-react";
import type { AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { FullscreenBar, fitFull, frameStyle, usePlayerFullscreen } from "@/components/media/Fullscreen";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { kitOf, TrackOverlay } from "@/components/analysis/TrackOverlay";

type View = "all" | "people" | "ball" | "none";
type Overlay = "ids" | "boxes";

const clock = (us: number | null) => {
  if (us === null) return "—";
  const t = Math.floor(us / 1e6);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** `onPick`: opens the video chooser (used by the transport while no video is chosen) */
export function PreviewPanel({ ws, onPick }: { ws: AnalysisWorkspaceState | null; onPick: () => void }) {
  const { t: dict } = useLocale();
  const d = dict.body.processing;
  const up = dict.body.upload;
  const [view, setView] = useState<View>("all");
  const [team, setTeam] = useState("all");
  const [overlay, setOverlay] = useState<Overlay>("ids");
  const [speed, setSpeed] = useState("1");
  const [muted, setMuted] = useState(false);
  const fs = usePlayerFullscreen();                                    // ADR-079: the shared full screen

  const playback = ws?.playback ?? null;
  const url = playback?.available ? playback.url : null;
  const video = ws?.video ?? null;
  const W = video?.width ?? 1920, H = video?.height ?? 1080;
  const tracks = useMemo(() => new Map((ws?.tracks ?? []).map((t) => [t.track_id, t])), [ws?.tracks]);
  const [kits, setKits] = useState<RunTeams | null>(null);
  const runId = ws?.run?.id ?? null;
  useEffect(() => {
    setKits(null); setTeam("all");
    if (runId) void api<RunTeams>(`/v1/analysis-runs/${runId}/kit-groups`).then(setKits, () => setKits(null));
  }, [runId]);
  /** team choices: each assigned club (all its colour groups), then each colour group nobody has assigned yet; value = kit groups */
  const teamOptions = useMemo((): [string, string][] => {
    const byClub = new Map<string, { name: string; groups: number[] }>();
    const open: [string, string][] = [];
    for (const g of kits?.groups ?? []) {
      if (g.assignment?.club_id) {
        const c = byClub.get(g.assignment.club_id) ?? { name: g.assignment.club_name ?? d.teamFallback, groups: [] };
        c.groups.push(g.kit_group); byClub.set(g.assignment.club_id, c);
      } else if (!g.assignment) open.push([String(g.kit_group), d.kitGroupNotAssigned.replace("{n}", String(g.kit_group))]);
    }
    return [...[...byClub.values()].map((c) => [c.groups.join(","), c.name] as [string, string]), ...open];
  }, [kits]);

  useEffect(() => { const el = ws?.videoRef.current; if (el) el.playbackRate = Number(speed); }, [speed, ws?.videoRef, url]);
  useEffect(() => { const el = ws?.videoRef.current; if (el) el.muted = muted; }, [muted, ws?.videoRef, url]);

  // the picture inside the 16:9 frame keeps the video's own proportions; boxes are drawn in that rectangle
  const CA = 16 / 9, VA = W / H;
  const fit = VA >= CA ? { w: 100, h: (CA / VA) * 100 } : { w: (VA / CA) * 100, h: 100 };
  const fitPct = { left: `${(100 - fit.w) / 2}%`, top: `${(100 - fit.h) / 2}%`, width: `${fit.w}%`, height: `${fit.h}%` };
  const shown = (ws?.visible ?? []).filter(({ o }) => {
    if (view === "none") return false;
    const ball = o.class_name === "BALL";
    if ((view === "people" && ball) || (view === "ball" && !ball)) return false;
    return team === "all" || ball || team.split(",").includes(String(kitOf(o, tracks) ?? ""));
  });

  const durationUs = video?.duration_us ?? null;
  const t = ws?.timeUs ?? 0;
  const progress = durationUs ? Math.min(1, t / durationUs) : 0;
  const step = (dir: 1 | -1) => ws && ws.seek(Math.max(0, t + dir * ws.intervalUs));
  const toggle = () => { const el = ws?.videoRef.current; if (el) { if (el.paused) void el.play(); else el.pause(); } };
  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ws || !durationUs) return;
    const r = e.currentTarget.getBoundingClientRect();
    ws.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * durationUs);
  };
  const message = !ws ? d.noVideoLoaded
    : !playback ? d.loadingVideo
    : !url ? d.noPlaybackYet.replace("{reason}", playback.reason ?? d.playbackCopyPreparing)
    : null;
  const note = ws && url && !ws.run ? d.noFinishedAnalysis : null;

  const selectCls = "h-9 rounded-ctl border border-line bg-canvas px-2 text-sm text-ink";
  return (
    <section aria-label={d.processingPreview} data-section="p03-s03" data-boxes={String(shown.length)} className="vie-panel">
      <div className="vie-ph flex-wrap gap-2 py-2">
        <div>
          <h2 className="t-panel">{d.processingPreview}</h2>
          <p className="text-xs text-primary">{d.liveAiOutput}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted">{d.viewLabel}
            <select aria-label={d.viewLabel} value={view} onChange={(e) => setView(e.target.value as View)} className={selectCls}>
              <option value="all">{d.viewAll}</option><option value="people">{d.viewPeople}</option>
              <option value="ball">{d.viewBall}</option><option value="none">{d.viewVideo}</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">{d.teamsLabel}
            <select aria-label={d.teamsLabel} value={team} onChange={(e) => setTeam(e.target.value)} className={selectCls}>
              <option value="all">{d.teamsAll}</option>
              {teamOptions.length ? teamOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)
                : <option value="none" disabled>{!ws ? d.teamsChooseVideo : !ws.run ? d.teamsNoAnalysis : d.teamsAssign}</option>}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted">{d.overlaysLabel}
            <select aria-label={d.overlaysLabel} value={overlay} onChange={(e) => setOverlay(e.target.value as Overlay)} className={selectCls}>
              <option value="ids">{d.overlaysIds}</option><option value="boxes">{d.overlaysBoxes}</option>
            </select>
          </label>
        </div>
      </div>

      <div className="p-3">
        <div className="relative aspect-video w-full overflow-hidden rounded-ctl bg-black">
          <dialog ref={fs.ref} open data-player-full={fs.on ? "on" : undefined} role="region" aria-label={d.matchVideoPlayer}
            style={frameStyle(fs.on, { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden", background: url ? "#000" : "#0a1a38" })}>
            {url && ws && (
              <div className="absolute" style={fs.on ? fitFull(W, H) : fitPct}>
                <video ref={ws.videoRef} src={url} preload="metadata" playsInline muted={muted} aria-label={d.matchVideo}
                  className="absolute inset-0 h-full w-full" />
                <TrackOverlay visible={shown} tracks={tracks} W={W} H={H} labels={overlay === "ids"} selectedId={ws.selectedId} />
              </div>
            )}
            {message && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <p className="text-sm text-ink2">{message}</p>
              </div>
            )}
            {fs.on && ws && <FullscreenBar playing={!!ws.playing} onPlay={toggle} now={t} total={durationUs ?? 0} onSeek={(f) => ws.seek(f * (durationUs ?? 0))}
              muted={muted} onMute={() => setMuted((m) => !m)} onExit={fs.exit} />}
          </dialog>
        </div>
        {note && <p className="mt-2 text-xs text-muted">{note}</p>}

        {/* transport */}
        <div className="mt-2 flex items-center gap-1 rounded-ctl bg-raised/60 px-2 py-1.5">
          <button type="button" aria-label={url ? d.backFrame : d.chooseVideoGeneric} onClick={url ? () => step(-1) : onPick} className="vie-ib !h-8 !w-8">
            <SkipBack className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" aria-label={!url ? d.chooseVideoPlay : ws?.playing ? up.pause : d.playBtn} onClick={url ? toggle : onPick} className="vie-ib !h-8 !w-8">
            {ws?.playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          </button>
          <button type="button" aria-label={url ? d.forwardFrame : d.chooseVideoGeneric} onClick={url ? () => step(1) : onPick} className="vie-ib !h-8 !w-8">
            <SkipForward className="h-4 w-4" aria-hidden />
          </button>
          <span className="t-tc w-[104px] shrink-0 text-center">{url ? `${clock(t)} / ${clock(durationUs)}` : "— / —"}</span>
          <div role="slider" aria-label={d.position} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} tabIndex={0}
            onClick={url ? scrub : onPick} title={url ? undefined : d.chooseVideoGeneric}
            onKeyDown={(e) => { if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); }}
            className="relative mx-1 h-8 min-w-0 flex-1 cursor-pointer">
            <span className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded bg-line"><i className="block h-full rounded bg-primary" style={{ width: `${progress * 100}%` }} /></span>
            <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ left: `${progress * 100}%` }} />
          </div>
          <select aria-label={d.playbackSpeed} value={speed} onChange={(e) => setSpeed(e.target.value)} className={`${selectCls} shrink-0`}>
            {["0.25", "0.5", "1", "1.5", "2"].map((s) => <option key={s} value={s}>{s}x</option>)}
          </select>
          <button type="button" aria-label={muted ? d.unmute : d.mute} aria-pressed={!muted} onClick={() => setMuted((m) => !m)} className="vie-ib !h-8 !w-8">
            {muted ? <VolumeX className="h-4 w-4" aria-hidden /> : <Volume2 className="h-4 w-4" aria-hidden />}
          </button>
          <button type="button" aria-label={overlay === "ids" ? d.hideLabels : d.showLabels} aria-pressed={overlay === "ids"}
            onClick={() => setOverlay((o) => (o === "ids" ? "boxes" : "ids"))} className="vie-ib !h-8 !w-8">
            <Tags className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" aria-label={d.fullScreen} onClick={url ? fs.toggle : onPick} className="vie-ib !h-8 !w-8">
            <Maximize2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
