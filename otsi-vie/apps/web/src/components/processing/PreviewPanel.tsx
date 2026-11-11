"use client";
/**
 * Page 03 Section 04 — Processing Preview (approved reference 03_AI_PROCESSING, "preview panel").
 *
 * The selected video's playback copy with the boxes of its latest finished analysis run drawn over it, from the Analysis workspace's
 * own data hook (useAnalysisWorkspace, ADR-035): the same boxes as page 04. View chooses what is drawn, Teams filters by the run's kit
 * colour groups, named by the team a person assigned to them (GET /v1/analysis-runs/:id/kit-groups; colour alone names nothing),
 * Overlays chooses boxes with or without track labels. A person's name appears only
 * after a person confirmed the identity. The transport steps one analysed frame, plays, seeks, sets the speed, mutes and goes full
 * screen. Without a video, or before a run has finished, the reference's empty frame says so.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { RunTeams } from "@otsi-vie/contracts";
import type { AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { B, T, u } from "@/components/stage/DesignStage";
import { FullscreenBar, fitFull, frameStyle, usePlayerFullscreen } from "@/components/media/Fullscreen";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { kitOf, TrackOverlay } from "@/components/analysis/TrackOverlay";

type View = "all" | "people" | "ball" | "none";
type Overlay = "ids" | "boxes";

const FRAME = { x: 45, y: 636, w: 1134, h: 509 };
const clock = (us: number | null) => {
  if (us === null) return "—";
  const t = Math.floor(us / 1e6);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** the reference's select box (.sel), a real native select underneath */
/** always opens; an option with a third entry (the reason) is listed greyed and cannot be chosen */
function Select<V extends string>({ x, w, label, value, options, onChange }:
  { x: number; w: number; label: string; value: V; options: ([V, string] | [V, string, string])[]; onChange: (v: V) => void }) {
  const id = `p03-${label.toLowerCase()}`;
  return (
    <>
      <label htmlFor={id} className="absolute" style={{ left: u(x), top: u(573 - 101 - 9.5), fontSize: u(17), lineHeight: 1.1, color: "#8ea3bf" }}>{label}</label>
      <div className="absolute" style={{ left: u(x), top: u(587 - 101), width: u(w), height: u(36), border: `${u(1.5)} solid #17355f`, borderRadius: u(6), background: "#0a1d38",
        color: "#dbe8f8", fontSize: u(18), display: "flex", alignItems: "center", padding: `0 ${u(12)}`, boxSizing: "border-box" }}>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{options.find((o) => o[0] === value)?.[1] ?? ""}</span>
        <span style={{ marginLeft: "auto" }}>⌄</span>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as V)}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}>
          {options.map(([v, l, why]) => <option key={v} value={v} disabled={!!why}>{why ? `${l} — ${why}` : l}</option>)}
        </select>
      </div>
    </>
  );
}

const glyph = (x: number, size: number, color = "#fff"): CSSProperties => ({
  position: "absolute", left: u(x), top: u(1177 - 101 - size * 0.55), height: u(size * 1.1), fontSize: u(size), lineHeight: 1.1, padding: 0, border: 0,
  background: "transparent", color, cursor: "pointer", fontFamily: "inherit",
});

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

  // the picture inside the frame keeps the video's own proportions; boxes are drawn in that rectangle
  const fit = W / H > FRAME.w / FRAME.h ? { w: FRAME.w, h: FRAME.w * H / W } : { w: FRAME.h * W / H, h: FRAME.h };
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

  return (
    <section aria-label={d.processingPreview} data-section="p03-s03" data-boxes={String(shown.length)}>
      <B x={43} y={545} w={1137} h={663} style={{ border: `${u(1.5)} solid #12335f`, borderRadius: u(10), background: "linear-gradient(180deg,#081a35,#06122a)" }} />
      <B x={58} y={565} w={7} h={50} style={{ background: "#1e90ff", borderRadius: u(3) }} />
      <T x={75} y={576} size={25} weight={700} as="h2">{d.processingPreview}</T>
      <T x={75} y={607} size={20} color="#4db3ff">{d.liveAiOutput}</T>
      <Select x={512} w={195} label={d.viewLabel} value={view} onChange={setView}
        options={[["all", d.viewAll], ["people", d.viewPeople], ["ball", d.viewBall], ["none", d.viewVideo]]} />
      <Select x={744} w={187} label={d.teamsLabel} value={team} onChange={setTeam}
        options={[["all", d.teamsAll], ...(teamOptions.length ? teamOptions
          : [["none", d.teamsLabel, !ws ? d.teamsChooseVideo : !ws.run ? d.teamsNoAnalysis : d.teamsAssign] as [string, string, string]])]} />
      <Select x={958} w={195} label={d.overlaysLabel} value={overlay} onChange={setOverlay}
        options={[["ids", d.overlaysIds], ["boxes", d.overlaysBoxes]]} />

      <dialog ref={fs.ref} open data-player-full={fs.on ? "on" : undefined} role="region" aria-label={d.matchVideoPlayer} className="absolute" style={frameStyle(fs.on, { left: u(FRAME.x), top: u(FRAME.y - 101), width: u(FRAME.w), height: u(FRAME.h), overflow: "hidden",
        background: url ? "#000" : "linear-gradient(180deg,#0a2a55 0,#10305c 22%,#1d5a2e 30%,#256b34 100%)" })}>
        {!url && (
          <>
            <div className="absolute" style={{ left: 0, top: 0, width: "100%", height: u(130), opacity: 0.8,
              background: `repeating-linear-gradient(90deg,#183a70,#10264a ${u(12)},#1d4380 ${u(24)})` }} />
            {/* the reference's empty scoreboard */}
            <B o={[FRAME.x, FRAME.y]} x={75} y={653} w={415} h={40} style={{ background: "#0a1a38", borderRadius: u(4) }} />
            <B o={[FRAME.x, FRAME.y]} x={75} y={653} w={49} h={40} style={{ background: "#fff", borderRadius: u(3) }} />
            <T o={[FRAME.x, FRAME.y]} x={145} y={675} size={26} weight={700}>—</T>
            <B o={[FRAME.x, FRAME.y]} x={233} y={653} w={100} h={40} style={{ background: "#1580ff", fontSize: u(24), fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>—</B>
            <T o={[FRAME.x, FRAME.y]} x={335} y={675} size={24} weight={700}>—</T>
            <B o={[FRAME.x, FRAME.y]} x={400} y={653} w={90} h={40} style={{ background: "#1580ff", fontSize: u(24), fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: `0 ${u(20)} ${u(20)} 0` }}>—</B>
          </>
        )}
        {url && ws && (
          <div className="absolute" style={fs.on ? fitFull(W, H) : { left: `calc(50% - ${u(fit.w / 2)})`, top: `calc(50% - ${u(fit.h / 2)})`, width: u(fit.w), height: u(fit.h) }}>
            <video ref={ws.videoRef} src={url} preload="metadata" playsInline muted={muted} aria-label={d.matchVideo}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
            <TrackOverlay visible={shown} tracks={tracks} W={W} H={H} labels={overlay === "ids"} selectedId={ws.selectedId} />
          </div>
        )}
        {(message || note) && (
          <T o={[FRAME.x, FRAME.y]} x={612} y={message ? 890 : 1120} size={message ? 24 : 18} color="#cfdcf0" align="center">{message ?? note}</T>
        )}
        {fs.on && ws && <FullscreenBar playing={!!ws.playing} onPlay={toggle} now={t} total={durationUs ?? 0} onSeek={(f) => ws.seek(f * (durationUs ?? 0))}
          muted={muted} onMute={() => setMuted((m) => !m)} onExit={fs.exit} />}
      </dialog>

      {/* transport */}
      <B x={45} y={1145} w={1134} h={63} style={{ background: "#07142a" }} />
      <button type="button" aria-label={url ? d.backFrame : d.chooseVideoGeneric} onClick={url ? () => step(-1) : onPick} style={glyph(78, 24)}>⏮</button>
      <button type="button" aria-label={!url ? d.chooseVideoPlay : ws?.playing ? up.pause : d.playBtn} onClick={url ? toggle : onPick} style={glyph(133, 28)}>{ws?.playing ? "⏸" : "▶"}</button>
      <button type="button" aria-label={url ? d.forwardFrame : d.chooseVideoGeneric} onClick={url ? () => step(1) : onPick} style={glyph(189, 22, "#8ea3bf")}>⏭</button>
      <T x={228} y={1177} size={19}>{url ? `${clock(t)} / ${clock(durationUs)}` : "— / —"}</T>
      <div role="slider" aria-label={d.position} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} tabIndex={0}
        onClick={url ? scrub : onPick} title={url ? undefined : d.chooseVideoGeneric} onKeyDown={(e) => { if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); }}
        className="absolute" style={{ left: u(358), top: u(1160 - 101), width: u(472), height: u(33), cursor: "pointer" }}>
        <B o={[358, 1160]} x={358} y={1173} w={472} h={7} style={{ background: "#17304f", borderRadius: u(4) }}>
          <i style={{ display: "block", height: "100%", width: `${progress * 100}%`, borderRadius: u(4), background: "#1a8cff" }} />
        </B>
        <B o={[358, 1160]} x={358 + progress * (472 - 18)} y={1167} w={18} h={18} style={{ borderRadius: "50%", background: "#fff" }} />
      </div>
      <div className="absolute" style={{ left: u(855), top: u(1158 - 101), width: u(102), height: u(38), border: `${u(1.5)} solid #17355f`, borderRadius: u(6),
        background: "#0a1d38", color: "#dbe8f8", fontSize: u(18), display: "flex", alignItems: "center", padding: `0 ${u(12)}`, boxSizing: "border-box" }}>
        <span>{speed}x</span><span style={{ marginLeft: "auto" }}>⌄</span>
        <select aria-label={d.playbackSpeed} value={speed} onChange={(e) => setSpeed(e.target.value)}
          style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}>
          {["0.25", "0.5", "1", "1.5", "2"].map((s) => <option key={s} value={s}>{s}x</option>)}
        </select>
      </div>
      <button type="button" aria-label={muted ? d.unmute : d.mute} aria-pressed={!muted} onClick={() => setMuted((m) => !m)} style={glyph(990, 24)}>{muted ? "🔇" : "🔊"}</button>
      <button type="button" aria-label={overlay === "ids" ? d.hideLabels : d.showLabels}
        onClick={() => setOverlay((o) => (o === "ids" ? "boxes" : "ids"))} style={glyph(1056, 26)}>⚙</button>
      <button type="button" aria-label={d.fullScreen} onClick={url ? fs.toggle : onPick} style={glyph(1124, 26)}>⛶</button>
    </section>
  );
}
