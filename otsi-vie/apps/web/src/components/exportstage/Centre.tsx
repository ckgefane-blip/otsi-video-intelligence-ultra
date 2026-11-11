"use client";
/**
 * Page 10 Sections 02-05 — workflow, Project Summary, reel preview with transport, Highlight Chapters
 * (approved reference 10_EXPORT_DELIVERY, left and centre).
 *
 * The preview plays the chosen reel's finished render; without one it keeps the reference's empty scene with the truthful state.
 * Chapters are the reel's clips (a clip is a chapter): choosing one seeks the render to where that clip begins. Of the three metric
 * overlays, Key Passes is the reel player's count from the engine's events (GET /v1/players/:id/measures, owner 2026-11-02); progressive
 * passes and chance creation are not measured ("—"). Workflow step 3 starts the render with the settings on the right. The gear opens the
 * player's settings: loop and picture in picture (a viewing choice, nothing is saved).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { actionClips, clipOutputUs, gapUs, slotUs, type PlayerEvents, type PlayerMeasures } from "@otsi-vie/contracts";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { Sel } from "@/components/tactics/kit";
import { Switch } from "@/components/reelstage/shared";
import { Hit } from "@/components/workspace/shared";
import { FullscreenBar, frameStyle, usePlayerFullscreen } from "@/components/media/Fullscreen";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { sec, useExport } from "./state";
import { notBuilt } from "@/lib/devMode";

const WF: [string, string, number][] = [["Edit & Finalize", "Review highlights and settings", 318], ["Export Settings", "Choose format, branding and output", 400],
  ["Render & Process", "Generate high-quality video", 484], ["Deliver & Share", "Send to clients and collaborators", 569]];

export function Workflow() {
  const e = useExport();
  const r = e.reel?.latest_render ?? null;
  // v3 Phase 0: step 2 is done once a render used the settings, step 4 once the reel was delivered (handed to a mail app)
  const delivered = !!e.outbox.deliveries?.some((d) => d.state === "SUCCEEDED");
  const ready = r?.state === "SUCCEEDED" && !!e.links;
  const done = [!!e.reel && e.reel.clips.length > 0, !!r, r?.state === "SUCCEEDED", delivered];
  const cur = !e.reel ? 0 : r?.state === "SUCCEEDED" ? 3 : r && ["QUEUED", "RUNNING"].includes(r.state) ? 2 : e.reel.clips.length ? 1 : 0;
  const canRender = !!e.reel && e.canEdit && !e.busy && e.reel.clips.length > 0 && !e.reel.stale && !(r && ["QUEUED", "RUNNING"].includes(r.state));
  const act = [() => e.reel && (window.location.href = `/reels/${e.reel.id}`), () => e.jump(0), canRender ? () => e.render() : undefined,
    ready && e.canEdit ? () => e.outbox.setDialog(true) : undefined] as const;
  const why = ["Open a reel first", "", !e.reel ? "Open a reel first" : e.reel.clips.length === 0 ? "Add at least one clip in the Reel Builder first" : e.reel.stale ? "Refresh the followed tracks in the Reel Builder first" : r && ["QUEUED", "RUNNING"].includes(r.state) ? "A render is already running" : "You cannot edit this reel",
    !ready ? "Render the reel first" : "Your role can look, not deliver"];
  return (
    <section aria-label="Export workflow" data-section="p10-s02">
      <P x={30} y={120} w={396} h={507} />
      <T x={52} y={158} size={34} weight={700} as="h1">Export &amp; Delivery</T>
      <T x={52} y={202} size={21} color="#cfe0f5">Render, brand and deliver professional</T>
      <T x={52} y={230} size={21} color="#cfe0f5">video insights to your team and clients.</T>
      <B x={52} y={273} w={348} h={1} style={{ background: "#12335f" }} />
      <B x={39} y={282 + cur * 85} w={379} h={75} style={{ background: "linear-gradient(90deg,#0b2b57,#08213f)", border: `${u(1.5)} solid #1e5fa8`, borderRadius: u(8) }} />
      <ol aria-label="Export steps" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {WF.map(([t, s, y], i) => (
          <li key={t} data-step={t} data-done={done[i] ? "1" : "0"} aria-current={cur === i ? "step" : undefined}>
            <B x={51} y={y - 28} w={56} h={56} style={{ borderRadius: "50%", background: cur === i ? "#0a84ff" : "#122339", border: cur === i ? "none" : `${u(1.5)} solid #1b3350`, fontSize: u(26), fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{done[i] ? "" : i + 1}</B>
            {done[i] && <Ic x={79} y={y} k="chk" size={30} color="#3ee6a8" />}
            <T x={128} y={y - 13} size={22} weight={600}>{t}</T>
            <T x={128} y={y + 14} size={18} color="#9fb3cc">{s}</T>
            <Hit x={39} y={y - 38} w={379} h={76} label={`${t}: ${s}`} {...(act[i] ? { onClick: act[i]! } : { reason: why[i]! })} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Picker({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t: dict } = useLocale();
  const e = useExport();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[min(520px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl" data-dialog="choose-reel">
          <Dialog.Title className="text-base font-semibold">{dict.body.exports.openReelToExport}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">Reels of your organization. Make one from a confirmed player in the Analysis workspace.</Dialog.Description>
          {e.reels === null && !e.reelsFailed && <p className="text-muted">Loading…</p>}
          {e.reelsFailed && (<><p className="text-muted">{dict.body.reels.reelsNotLoaded}</p>
            <button type="button" onClick={() => void e.reload()} className="rounded-ctl border border-line px-3 py-1.5">Try again</button></>)}
          {e.reels?.length === 0 && !e.reelsFailed && <p className="text-muted">{dict.body.studio.noReelsYet}</p>}
          <ul aria-label="Reels" className="space-y-1">
            {e.reels?.map((r) => (
              <li key={r.id}>
                <Link href={`/exports?reel=${r.id}`} data-reel={r.id} onClick={() => onOpenChange(false)} className="flex items-center justify-between gap-3 rounded-ctl border border-line/70 px-3 py-2 hover:border-primary/60">
                  <span className="min-w-0 truncate font-medium">{r.name}</span>
                  <span className="shrink-0 text-xs text-muted">{r.clips.length} clips · {r.latest_render?.state.toLowerCase() ?? "not rendered"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Summary() {
  const { t: dict } = useLocale();
  const e = useExport();
  const [open, setOpen] = useState(false);
  const rows: [string, string, number, string][] = [["ball", "Source Match", 865, e.match?.title ?? "—"], ["ball", "Competition", 900, e.match?.competition ?? "—"],
    ["calendar", "Date", 936, e.match?.date ?? "—"], ["clock", "Duration", 974, e.reel ? sec(e.reel.duration_us) : "—"]];
  return (
    <section aria-label="Project summary" data-section="p10-s03" data-reel={e.reel?.id ?? ""}>
      <P x={30} y={644} w={396} h={651} />
      <T x={49} y={673} size={23} weight={600} as="h2">{dict.body.exports.projectSummary}</T>
      <B x={48} y={706} w={365} h={127} style={{ background: "#06142a", border: `${u(1.5)} solid #12335f`, borderRadius: u(8) }} />
      <B x={49} y={707} w={138} h={121} style={{ background: "radial-gradient(circle at 50% 38%,#e8b898 0,#c98c6a 13%,transparent 14%),linear-gradient(135deg,#1b4d8f,#0b2a52)", borderRadius: u(6) }} />
      <T x={204} y={735} size={24} weight={600} style={{ maxWidth: u(200), overflow: "hidden", textOverflow: "ellipsis" }}>{e.reel?.name ?? "No project open"}</T>
      <T x={204} y={764} size={22} color="#e3eefb">{e.reel ? (e.reel.player?.display_name ?? "No player") : dict.body.exports.openReelToExport}</T>
      <Hit x={48} y={706} w={365} h={127} label={dict.body.exports.openReelToExport} onClick={() => setOpen(true)} />
      {rows.map(([icon, l, y, v]) => (
        <div key={l}>
          <Ic x={60} y={y} k={icon} size={24} color="#8ea3bf" />
          <T x={88} y={y} size={18} color="#9fb3cc">{l}</T>
          <T x={232} y={y} size={19} color="#e3eefb" style={{ maxWidth: u(180), overflow: "hidden", textOverflow: "ellipsis" }}>{v}</T>
        </div>
      ))}
      <Ic x={60} y={1017} k="tag" size={24} color="#8ea3bf" /><T x={88} y={1017} size={18} color="#9fb3cc">Tags</T><T x={147} y={1017} size={16} color="#e3eefb">—</T>
      <Picker open={open} onOpenChange={setOpen} />
    </section>
  );
}

export function Preview() {
  const e = useExport();
  const playerId = e.reel?.player?.player_id ?? null;
  const [measures, setMeasures] = useState<PlayerMeasures | null>(null);
  useEffect(() => { setMeasures(null); if (playerId) void api<PlayerMeasures>(`/v1/players/${playerId}/measures`).then(setMeasures, () => setMeasures(null)); }, [playerId]);
  const keyPasses = measures?.events ? String(measures.events.key_passes) : null;
  const ref = useRef<HTMLVideoElement | null>(null);
  const fs = usePlayerFullscreen();                                    // ADR-079: the shared full screen
  const [t, setT] = useState(0), [dur, setDur] = useState(0), [playing, setPlaying] = useState(false), [muted, setMuted] = useState(false), [speed, setSpeed] = useState("1");
  const [loop, setLoop] = useState(false), [menu, setMenu] = useState(false);
  const r = e.reel?.latest_render ?? null;
  const url = e.links?.url ?? null;
  useEffect(() => { const v = ref.current; if (v) { v.playbackRate = Number(speed); v.muted = muted; v.loop = loop; } }, [speed, muted, loop, url]);
  const pip = () => { const v = ref.current; setMenu(false); if (!v) return; void (document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture?.())?.catch?.(() => undefined); };
  const p = dur ? Math.min(1, t / dur) : 0;
  const res = (r?.result ?? null) as { width?: number; height?: number } | null;
  const line1 = e.reel ? e.reel.name : "No reel loaded";
  const line2 = !e.reel ? "NOT RENDERED" : !r ? "NOT RENDERED" : r.state === "SUCCEEDED" ? "RENDERED" : r.state === "FAILED" ? "RENDER FAILED" : r.state === "QUEUED" ? "WAITING FOR THE WORKER" : `RENDERING ${r.progress != null ? Math.round(r.progress) + "%" : ""}`;
  const line3 = !e.reel ? "OPEN A REEL FROM THE LIBRARY" : r?.state === "SUCCEEDED" ? "" : "USE RENDER & PROCESS TO CREATE THE VIDEO";
  const toggle = () => { const v = ref.current; if (v) { if (v.paused) void v.play(); else v.pause(); } };
  // the chapter seek is stable so the memoised chapters box does not re-render on every video timeupdate
  const seek = useCallback((us: number) => { const v = ref.current; if (v) v.currentTime = us / 1e6; }, []);
  return (
    <section aria-label="Reel preview" data-section="p10-s04" data-preview={url ? "render" : "none"}>
      <P x={444} y={120} w={1365} h={845} />
      <dialog ref={fs.ref} open data-player-full={fs.on ? "on" : undefined} role="region" aria-label="Rendered reel player" className="absolute" style={frameStyle(fs.on, { left: u(464), top: u(141 - 101), width: u(1327), height: u(575), overflow: "hidden", borderRadius: u(10),
        background: url ? "#000" : "radial-gradient(ellipse at 60% 25%,#5fb8ff 0,#1d4a8a 32%,transparent 64%),linear-gradient(180deg,#0a1a38,#04101f 60%,#0a2a30)" })}>
        {url ? (
          <video ref={ref} key={url} src={url} preload="metadata" playsInline aria-label="Rendered reel" onTimeUpdate={() => setT((ref.current?.currentTime ?? 0) * 1e6)}
            onLoadedMetadata={() => setDur((ref.current?.duration ?? 0) * 1e6)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
        ) : (
          <>
            <B o={[464, 141]} x={1000} y={250} w={480} h={470} style={{ background: "radial-gradient(ellipse at 50% 25%,#4a9ee0,#2a6fb8 40%,transparent 70%)" }} />
            <B o={[464, 141]} x={1290} y={640} w={90} h={70} style={{ borderRadius: "50%", background: "radial-gradient(circle at 35% 30%,#dde7f5,#335)" }} />
            <T o={[464, 141]} x={534} y={441} size={62} weight={700} ls={-1} style={{ maxWidth: u(900), overflow: "hidden", textOverflow: "ellipsis" }}>{line1}</T>
            <T o={[464, 141]} x={534} y={496} size={44} weight={700} color="#1e9bff">{line2}</T>
            <T o={[464, 141]} x={536} y={540} size={24} weight={600} ls={3}>{line3}</T>
            <T o={[464, 141]} x={536} y={570} size={24} weight={600} ls={3}>—</T>
          </>
        )}
        {!fs.on && <><B o={[464, 141]} x={1676} y={170} w={84} h={62} style={{ background: "#0a0a05", border: `${u(3)} solid #f5b82e`, borderRadius: u(6) }} />
        <T o={[464, 141]} x={1718} y={191} size={res?.height ? 24 : 30} weight={700} color="#f5b82e" align="center">{res?.height ? `${res.height}p` : "—"}</T>
        <T o={[464, 141]} x={1718} y={217} size={12} weight={700} color="#f5b82e" align="center">{res?.width ? `${res.width}×${res.height}` : "NOT RENDERED"}</T></>}
        {!fs.on && [["Key Passes", "run", 397], ["Progressive Passes", "srch", 472], ["Chance Creation", "trf", 547]].map(([l, icon, y]) => (
          <div key={l as string} title={l === "Key Passes" && keyPasses !== null ? "Key passes the engine found for the reel's player (not a verified stat sheet)" : "Not measured yet"}>
            <B o={[464, 141]} x={1498} y={y as number} w={278} h={62} style={{ background: "rgba(5,16,36,.75)", border: `${u(1.5)} solid #17406f`, borderRadius: u(6) }} />
            <Ic o={[464, 141]} x={1526} y={(y as number) + 31} k={icon as string} size={34} color="#33a8ff" />
            <T o={[464, 141]} x={1566} y={(y as number) + 31} size={34} weight={700}>{l === "Key Passes" ? keyPasses ?? "—" : "—"}</T>
            <T o={[464, 141]} x={1611} y={(y as number) + 31} size={19} color="#e3eefb">{l as string}</T>
          </div>
        ))}
        {!playing && !fs.on && <B o={[464, 141]} x={1054} y={380} w={112} h={112} style={{ borderRadius: "50%", background: "rgba(5,16,36,.6)", border: `${u(2)} solid rgba(255,255,255,.5)` }} />}
        {!playing && !fs.on && <B o={[464, 141]} x={1098} y={412} w={40} h={50} style={{ background: "#fff", clipPath: "polygon(0 0,100% 50%,0 100%)", opacity: url ? 1 : 0.6 }} />}
        {fs.on && <FullscreenBar playing={playing} onPlay={toggle} now={t} total={dur} onSeek={(f) => { const v = ref.current; if (v && dur) v.currentTime = f * dur / 1e6; }}
          muted={muted} onMute={() => setMuted((m) => !m)} onExit={fs.exit} />}
      </dialog>
      <Hit x={1054} y={380} w={112} h={112} label="Play the reel" {...(url ? { onClick: toggle } : { reason: "No rendered reel yet" })} style={{ zIndex: 2 }} />
      <B x={481} y={652} w={1292} h={3} style={{ background: "#3a4a62" }} />
      <Hit x={487} y={665} w={44} h={40} label={playing ? "Pause" : "Play"} {...(url ? { onClick: toggle } : { reason: "No rendered reel yet" })} />
      {playing ? (<><B x={500} y={672} w={7} h={26} style={{ background: "#fff" }} /><B x={513} y={672} w={7} h={26} style={{ background: "#fff" }} /></>) : <Ic x={509} y={685} k="play" size={30} fill="#fff" />}
      <Hit x={546} y={665} w={44} h={40} label={muted ? "Unmute" : "Mute"} {...(url ? { onClick: () => setMuted((m) => !m) } : { reason: "No rendered reel yet" })} />
      <Ic x={568} y={685} k={muted ? "mute" : "vol"} size={30} />
      <B x={595} y={672} w={1} h={26} style={{ background: "#4a5a78" }} />
      <T x={622} y={686} size={20}>{`${sec(t)} / ${sec(dur)}`}</T>
      <div role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} tabIndex={url ? 0 : -1}
        onClick={(ev) => { const v = ref.current; if (!v || !dur) return; const b = ev.currentTarget.getBoundingClientRect(); v.currentTime = Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)) * (dur / 1e6); }}
        className="absolute" style={{ left: u(750), top: u(672 - 101), width: u(740), height: u(26), cursor: url ? "pointer" : "default" }} />
      <B x={750} y={683} w={740} h={5} style={{ background: "#3a4a62", borderRadius: u(3), pointerEvents: "none" }}><i style={{ display: "block", height: "100%", width: `${p * 100}%`, background: "#1e90ff", borderRadius: u(3) }} /></B>
      {url && <B x={750 + p * 740 - 8} y={678} w={16} h={16} style={{ borderRadius: "50%", background: "#cfe8ff", pointerEvents: "none" }} />}
      <Sel x={1527} y={668} w={69} h={35} label="Playback speed" value={speed} options={[["0.5", "0.5x"], ["1", "1x"], ["1.5", "1.5x"], ["2", "2x"]]} onChange={setSpeed} pad={10}
        style={{ background: "rgba(5,16,36,.75)", fontSize: u(18) }} />
      <Hit x={1613} y={665} w={44} h={40} label="Captions" reason={notBuilt("the reel has no captions")} /><Ic x={1635} y={685} k="cap" size={26} color="#8ea3bf" />
      <Hit x={1669} y={665} w={44} h={40} label="Player settings" pressed={menu} {...(url ? { onClick: () => setMenu((m) => !m) } : { reason: "No rendered reel yet" })} /><Ic x={1691} y={685} k="gear" size={28} color={url ? "#fff" : "#8ea3bf"} />
      {menu && url && (
        <div role="menu" aria-label="Player settings" data-player-settings className="absolute" style={{ left: u(1560), top: u(560 - 101), width: u(230), zIndex: 5, padding: u(6), borderRadius: u(8),
          background: "#071a33", border: `${u(1.5)} solid #1e90ff`, display: "flex", flexDirection: "column", gap: u(4), fontSize: u(18) }}>
          <button type="button" role="menuitemcheckbox" aria-checked={loop} onClick={() => { setLoop((l) => !l); setMenu(false); }}
            style={{ textAlign: "left", padding: `${u(6)} ${u(10)}`, border: 0, borderRadius: u(6), background: "transparent", color: "#e3eefb", cursor: "pointer", font: "inherit" }}>{loop ? "✓ " : ""}Loop the reel</button>
          <button type="button" role="menuitem" onClick={pip}
            style={{ textAlign: "left", padding: `${u(6)} ${u(10)}`, border: 0, borderRadius: u(6), background: "transparent", color: "#e3eefb", cursor: "pointer", font: "inherit" }}>Picture in picture</button>
        </div>
      )}
      <Hit x={1726} y={665} w={44} h={40} label="Full screen" {...(url ? { onClick: fs.toggle } : { reason: "No rendered reel yet" })} /><Ic x={1748} y={685} k="full" size={26} />
      <ChaptersBox seek={seek} canSeek={!!url} />
    </section>
  );
}

const ChaptersBox = memo(function ChaptersBox({ seek, canSeek }: { seek(us: number): void; canSeek: boolean }) {
  const e = useExport();
  const row = useRef<HTMLDivElement | null>(null);
  const all = e.autoChapters ? e.reel?.clips ?? [] : [];
  // the chapter offsets and the shown list are memoised: Preview re-renders on every video timeupdate, and this box must not rebuild them then
  const allOffs = useMemo(() => { let acc = 0; return all.map((c) => { const o = acc + gapUs(c); acc += slotUs(c); return o; }); }, [all]);   // B.19: a chapter starts after its clip's spacer     // E2: reel time, with speed effects
  // B.23 (ADR-098): "Hide no-action" leaves out the chapters with no event of the reel's player that the engine recorded. With none of his
  // events recorded in this video it is not known which have action, and the filter stays off (unknown beats wrong).
  const pid = e.reel?.player?.player_id ?? null;
  const [events, setEvents] = useState<PlayerEvents | null>(null);
  const [hide, setHide] = useState(false);
  useEffect(() => {
    setEvents(null);
    if (!pid) return;
    let live = true;
    api<PlayerEvents>(`/v1/players/${pid}/events`).then((x) => live && setEvents(x), () => live && setEvents(null));
    return () => { live = false; };
  }, [pid]);
  // ADR-131: a cross-match reel has no single video, so the single-video action filter cannot apply — the filter stays off
  // (unknown beats wrong), as it does when no event of his was recorded in the video.
  const acts = useMemo(() => (e.reel && events && e.reel.video_id ? actionClips(e.reel.video_id, all, events.items) : null), [e.reel, events, all]);
  const shown = useMemo(() => all.map((c, i) => ({ c, i, at: allOffs[i]! })).filter((x) => !(hide && acts) || acts.has(x.c.id)), [all, allOffs, acts, hide]);
  const clips = useMemo(() => shown.map((x) => x.c), [shown]), offs = useMemo(() => shown.map((x) => x.at), [shown]);
  const hidden = all.length - clips.length;
  return (
    <>
      <B x={463} y={733} w={1329} h={212} style={{ background: "rgba(5,16,34,.7)", border: `${u(1.5)} solid #12335f`, borderRadius: u(10) }} />
      <B x={470} y={747} w={3} h={30} style={{ background: "#1e90ff" }} />
      <T x={487} y={758} size={23} weight={600} as="h2">{`Highlight Chapters (${clips.length}${hidden ? ` of ${all.length}` : ""})`}</T>
      <T x={726} y={761} size={16} color="#cfe0f5">Auto Chapters</T>
      <Switch x={837} y={761} on={e.autoChapters} />
      <Hit x={832} y={745} w={62} h={32} label="Auto Chapters" pressed={e.autoChapters} onClick={() => e.setAutoChapters(!e.autoChapters)} />
      <T x={925} y={761} size={16} color={acts ? "#cfe0f5" : "#6f86a3"}>Hide no-action</T>
      <Switch x={1043} y={761} on={hide && !!acts} />
      <Hit x={920} y={745} w={180} h={32} label="Hide chapters with no event of the player" pressed={hide && !!acts}
        {...(acts ? { onClick: () => setHide(!hide) } : { reason: !pid ? "The reel has no confirmed player" : !events ? "Reading the player's events…" : "No event of the player is recorded in this video, so it is not known which chapters have action" })} />
      <B x={1613} y={741} w={161} h={38} style={{ background: "#041022", border: `${u(1.5)} solid #17406f`, borderRadius: u(8), opacity: e.reel ? 1 : 0.7 }} />
      <Ic x={1640} y={760} k="edit" size={22} /><T x={1665} y={760} size={17}>Edit Chapters</T>
      <Hit x={1613} y={741} w={161} h={38} label="Edit chapters in the Reel Builder" {...(e.reel ? { onClick: () => { window.location.href = `/reels/${e.reel!.id}`; } } : { reason: "Open a reel first" })} />
      <B x={453} y={828} w={36} h={56} style={{ background: "#041022", border: `${u(1.5)} solid #17406f`, borderRadius: u(8) }} /><Ic x={471} y={856} k="back" size={20} />
      <B x={1767} y={828} w={36} h={56} style={{ background: "#041022", border: `${u(1.5)} solid #17406f`, borderRadius: u(8) }} /><Ic x={1785} y={856} k="fwd" size={20} />
      <Hit x={453} y={828} w={36} h={56} label="Previous chapters" {...(clips.length > 4 ? { onClick: () => row.current?.scrollBy({ left: -600, behavior: "smooth" }) } : { reason: "No more chapters" })} />
      <Hit x={1767} y={828} w={36} h={56} label="Next chapters" {...(clips.length > 4 ? { onClick: () => row.current?.scrollBy({ left: 600, behavior: "smooth" }) } : { reason: "No more chapters" })} />
      {clips.length === 0 && <T x={1128} y={860} size={19} color="#8ea3bf" align="center">{hidden ? "No chapter holds an event of the player" : e.reel && !e.autoChapters ? "Auto chapters are off" : e.reel ? "No chapters yet — add clips in the Reel Builder" : "No chapters yet — chapters are created from the reel timeline"}</T>}
      <div ref={row} role="list" aria-label="Chapters" className="absolute" style={{ left: u(500), top: u(792 - 101), width: u(1255), height: u(140), overflowX: "auto", overflowY: "hidden", display: "flex", gap: u(14) }}>
        {clips.map((c, i) => (
          <button key={c.id} role="listitem" type="button" data-chapter={shown[i]!.i + 1} data-action={acts ? (acts.has(c.id) ? "1" : "0") : "unknown"} disabled={!canSeek} title={canSeek ? "Go to this chapter in the render" : "Render the reel to jump to a chapter"} onClick={() => seek(offs[i]!)}
            style={{ flex: "0 0 auto", width: u(236), height: u(135), position: "relative", border: `${u(1.5)} solid #12335f`, borderRadius: u(8), background: "#06182f", color: "#fff", textAlign: "left", cursor: canSeek ? "pointer" : "default" }}>
            <span style={{ position: "absolute", inset: `${u(3)} ${u(3)} auto ${u(3)}`, height: u(86), borderRadius: u(6), background: "radial-gradient(ellipse at 50% 30%,#2a6fb8,#0b2a52 70%)" }} />
            <span style={{ position: "absolute", left: u(10), top: u(10), width: u(32), height: u(32), borderRadius: u(6), background: "#1e90ff", fontWeight: 700, fontSize: u(18), display: "flex", alignItems: "center", justifyContent: "center" }}>{shown[i]!.i + 1}</span>
            <span style={{ position: "absolute", right: u(10), top: u(64), padding: `0 ${u(8)}`, background: "rgba(0,10,25,.8)", borderRadius: u(5), fontSize: u(16) }}>{Math.round(clipOutputUs(c) / 1e6)}s</span>
            <span style={{ position: "absolute", left: u(10), top: u(98), right: u(10), fontSize: u(17), fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label ?? `Clip ${shown[i]!.i + 1}`}</span>
          </button>
        ))}
      </div>
    </>
  );
});
