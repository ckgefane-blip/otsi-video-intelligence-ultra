"use client";
/**
 * Page 06 Section 05 — Cinematic Spotlight preview and player (approved reference 06_REEL_BUILDER, upper centre).
 *
 * With a reel: the source footage of the chosen clip (playback stops at the clip's end), or — after Preview Render — the latest render
 * with its spotlight. Without one: the reference's empty scene, and the organization's reels to open. The player card shows the reel's
 * confirmed player as recorded: team, shirt number and position from the match team sheet, nationality, foot and age from the Players list
 * (position: this match's team sheet first, else his usual one; "—" where nothing is recorded; the pencil opens his row there), on a dark backing so it reads over bright footage; the scoreboard shows the linked match's
 * recorded teams and score. Play, previous / next clip, seek (within the clip), volume, speed and full screen work on the real media.
 */
import type { Match, Playback, Reel, TrackSummary, Video } from "@otsi-vie/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { FullscreenBar, frameStyle, usePlayerFullscreen } from "@/components/media/Fullscreen";
import { Sel } from "@/components/tactics/kit";
import { api } from "@/lib/api";
import { Hit, Thumb } from "@/components/workspace/shared";
import { FOOT_NAMES, POSITION_NAMES } from "@/components/players/PlayersList";
import { teamCode } from "@/lib/team";
import { CoverageBar, LiveSpotlight, spotlightNote, useReelPath } from "./LiveSpotlight";
import { DEFAULTS, mmss, useStage } from "./shared";
import { notBuilt } from "@/lib/devMode";

const SCENE = { x: 447, y: 127, w: 1589, h: 653 };
const glyph = { fill: "none" } as const;
const shade = { textShadow: "0 1px 3px rgba(0,0,0,.95), 0 0 8px rgba(0,0,0,.6)" } as const;   // readable on bright grass without a dark box
const CARD_SCALE = 0.66;
const slot = { fontSize: u(24), fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", whiteSpace: "nowrap" } as const;
const score = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n));

/** the player card (memoised: it does not change while the preview plays, so the per-timeupdate re-render does not rebuild it) */
const PlayerCard = memo(function PlayerCard({ name, jersey, team, nationality, pos, foot, age, playerId, targetTrackId }: {
  name: string; jersey: string | number; team: string; nationality: string; pos: string; foot: string; age: string | number;
  playerId: string | null; targetTrackId: string | null;
}) {
  return (
    <div aria-label="Player card" className="absolute" style={{ inset: 0, transform: `scale(${CARD_SCALE})`, transformOrigin: `${u(452 - SCENE.x)} ${u(136 - SCENE.y)}`, pointerEvents: "none" }}>
      <B o={[SCENE.x, SCENE.y]} x={452} y={136} w={640} h={150} style={{ background: "rgba(3,10,24,.3)", borderRadius: u(10) }} />
      <B o={[SCENE.x, SCENE.y]} x={464} y={147} w={129} h={127} style={{ opacity: 0.85, borderRadius: u(8), border: `${u(1.5)} solid #8ec4ef`, background: "linear-gradient(135deg,#9fd0f5,#3a6fa8)", overflow: "hidden" }}>
        {targetTrackId && <Thumb track={{ track_id: targetTrackId, has_thumbnail: true } as TrackSummary} w={129} h={127} />}
      </B>
      <T o={[SCENE.x, SCENE.y]} x={618} y={170} size={36} weight={700} as="h2" style={{ ...shade, maxWidth: u(330), overflow: "hidden", textOverflow: "ellipsis" }}>{name}</T>
      <B o={[SCENE.x, SCENE.y]} x={966} y={147} w={56} h={42} style={{ background: "#1e90ff", borderRadius: u(6), fontSize: u(26), display: "flex", alignItems: "center", justifyContent: "center" }}>{jersey}</B>
      {playerId && <Link href={`/players?player=${playerId}`} aria-label="Edit the player's profile" title="Edit his profile on the Players list (nationality, foot, birth date)"
        className="absolute" style={{ pointerEvents: "auto", left: u(1034 - 447), top: u(147 - 127), width: u(44), height: u(42), borderRadius: u(6), border: `${u(1.5)} solid #33a8ff`, color: "#33a8ff",
          fontSize: u(22), display: "flex", alignItems: "center", justifyContent: "center" }}>✎</Link>}
      <B o={[SCENE.x, SCENE.y]} x={620} y={201} w={26} h={26} style={{ borderRadius: "50%", background: "#6cc4ff" }} />
      <T o={[SCENE.x, SCENE.y]} x={659} y={214} size={22} style={{ ...shade, maxWidth: u(160), overflow: "hidden", textOverflow: "ellipsis" }}>{team}</T>
      <T o={[SCENE.x, SCENE.y]} x={827} y={214} size={22} color="#8ea3bf">|</T>
      <B o={[SCENE.x, SCENE.y]} x={856} y={203} w={22} h={22} style={{ background: "#3a5a88" }} />
      <T o={[SCENE.x, SCENE.y]} x={891} y={214} size={22} style={{ ...shade, maxWidth: u(190), overflow: "hidden", textOverflow: "ellipsis" }}>{nationality}</T>
      <T o={[SCENE.x, SCENE.y]} x={618} y={256} size={20} color="#e3ecf8" style={{ ...shade, maxWidth: u(250), overflow: "hidden", textOverflow: "ellipsis" }}>{pos}</T>
      <T o={[SCENE.x, SCENE.y]} x={875} y={256} size={20} color="#e3ecf8" style={shade}>{`Foot ${foot}  |  Age ${age}`}</T>
    </div>
  );
});

/** the scoreboard (memoised: the linked match does not change while the preview plays) */
const Scoreboard = memo(function Scoreboard({ match }: { match: Match | null }) {
  return (
    <>
      <B o={[SCENE.x, SCENE.y]} x={1630} y={153} w={382} h={45} style={{ background: "rgba(5,16,36,.8)", borderRadius: u(6) }} />
      <Ic o={[SCENE.x, SCENE.y]} x={1660} y={176} k="ball" size={34} />
      {/* owner 2026-11-02 ("letters overlapping"): each code and score has its own fixed slot, so no name runs into a score box */}
      <B o={[SCENE.x, SCENE.y]} x={1684} y={153} w={90} h={45} style={slot}>{teamCode(match?.home?.name, match?.home?.short_name)}</B>
      <B o={[SCENE.x, SCENE.y]} x={1776} y={153} w={62} h={45} style={{ ...slot, background: "#0a2bd0", fontSize: u(26) }}>{score(match?.home_score)}</B>
      <B o={[SCENE.x, SCENE.y]} x={1842} y={153} w={98} h={45} style={slot}>{teamCode(match?.away?.name, match?.away?.short_name)}</B>
      <B o={[SCENE.x, SCENE.y]} x={1942} y={153} w={70} h={45} style={{ ...slot, background: "#1e5bff", fontSize: u(26), borderRadius: `0 ${u(6)} ${u(6)} 0` }}>{score(match?.away_score)}</B>
    </>
  );
});


export function PreviewPanel() {
  const { r, mode, setMode, draft } = useStage();
  const reel = r?.reel ?? null;
  const router = useRouter();
  const [video, setVideo] = useState<Video | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [list, setList] = useState<Reel[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [src, setSrc] = useState<{ url: string; kind: "render" | "source" } | null>(null);
  const [t, setT] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState("1");
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);
  const fs = usePlayerFullscreen();                                    // ADR-079: the shared full screen
  const path = useReelPath(reel);                                     // B.14 (ADR-090): the live spotlight and coverage

  const clips = reel?.clips ?? [];
  const sel = r?.selectedClip ?? null;
  const clipIndex = Math.max(0, clips.findIndex((c) => c.id === sel));
  const clip = clips[clipIndex] ?? null;
  const renderId = reel?.last_good_render?.has_output ? reel.last_good_render.id : null;   // the last finished file, even while a new render runs
  const kind = mode === "render" && renderId ? "render" : "source";

  // without a reel id the page opens the reel worked on last (the list is newest first); the list stays as the way to pick another one
  // a failed read is named as one, with a retry: an empty list means "no reels yet", not "could not load them"
  const loadList = useCallback(() => { setListFailed(false); void api<Reel[]>("/v1/reels").then((l) => { setList(l); if (l[0] && !r) router.replace(`/reels/${l[0].id}`); }, () => setListFailed(true)); }, [r, router]);
  useEffect(() => { if (!reel) loadList(); }, [reel, loadList]);
  useEffect(() => {
    setVideo(null); setMatch(null);
    if (reel) void api<Video>(`/v1/videos/${reel.video_id}`).then(setVideo, () => undefined);
  }, [reel?.video_id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setMatch(null);
    if (video?.match_id) void api<Match>(`/v1/matches/${video.match_id}`).then(setMatch, () => undefined);
  }, [video?.match_id]);
  useEffect(() => {
    setSrc(null);
    if (!reel) return;
    if (kind === "render" && renderId) void api<{ url: string }>(`/v1/renders/${renderId}/playback`).then((p) => setSrc({ url: p.url, kind: "render" }), () => setSrc(null));
    else void api<Playback>(`/v1/videos/${reel.video_id}/playback`).then((p) => setSrc(p.url ? { url: p.url, kind: "source" } : null), () => setSrc(null));
  }, [reel?.id, reel?.video_id, kind, renderId]);   // eslint-disable-line react-hooks/exhaustive-deps

  // source footage: start at the clip's in point and stop at its out point
  const inUs = clip?.in_pts_us ?? 0, outUs = clip?.out_pts_us ?? 0;
  useEffect(() => {
    const v = ref.current;
    if (!v || src?.kind !== "source" || !clip) return;
    const go = () => { v.currentTime = inUs / 1e6; };
    if (v.readyState >= 1) go(); else v.addEventListener("loadedmetadata", go, { once: true });
  }, [src, clip?.id, inUs]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const v = ref.current; if (v) { v.playbackRate = Number(speed); v.muted = muted; } }, [speed, muted, src]);

  const onTime = () => {
    const v = ref.current;
    if (!v) return;
    if (src?.kind === "source" && clip && v.currentTime * 1e6 >= outUs) { v.pause(); v.currentTime = outUs / 1e6; }
    setT(v.currentTime * 1e6);
  };
  const span = src?.kind === "source" && clip ? { a: inUs, b: outUs } : { a: 0, b: (ref.current?.duration ?? 0) * 1e6 };
  const len = Math.max(1, span.b - span.a), p = src ? Math.max(0, Math.min(1, (t - span.a) / len)) : 0;
  const seekTo = (frac: number) => { const v = ref.current; if (v) v.currentTime = (span.a + frac * len) / 1e6; };
  const step = (d: number) => {
    if (src?.kind === "source" && clips.length) r?.setSelectedClip(clips[Math.max(0, Math.min(clips.length - 1, clipIndex + d))]!.id);
    else { const v = ref.current; if (v) v.currentTime = Math.max(0, v.currentTime + d * 5); }
  };

  const player = reel?.player ?? null;
  const prof = player?.profile ?? null;
  const sheet = reel?.player_roster ?? prof?.latest_team ?? null;           // this match's team sheet first, else his latest one
  const code_ = sheet?.position ?? prof?.position ?? null;                  // his position in this match, else his usual one
  const pos = code_ ? POSITION_NAMES[code_] ?? code_ : "—";
  const target = reel?.targets[0] ?? null;
  const ready = !!src;
  const hasClip = !!clip;
  const playPause = () => { const v = ref.current; if (!v) return; if (v.paused) { if (src?.kind === "source" && v.currentTime * 1e6 >= outUs - 50_000) v.currentTime = inUs / 1e6; void v.play(); } else v.pause(); };
  const message = !reel ? null : !src ? "No preview yet: the playback copy is not available." : kind === "source" && !hasClip ? "Add a moment to start building the reel" : null;
  const look = draft ?? reel?.settings ?? DEFAULTS;
  // the coverage is recomputed from the path on every render; the preview re-renders on every video timeupdate, so derive it once per clip/path/look
  const spotNote = useMemo(() => (reel && src?.kind === "source" && !message ? spotlightNote(reel, path, clip, look.lock) : null),
    [reel, path, clip, look.lock, src?.kind, message]);

  return (
    <section aria-label="Cinematic spotlight preview" data-section="p06-s05" data-preview={reel ? src?.kind ?? "none" : "none"}>
      <P x={445} y={125} w={1593} h={732} />
      <dialog ref={fs.ref} open data-player-full={fs.on ? "on" : undefined} role="region" aria-label="Reel preview player" className="absolute" style={frameStyle(fs.on, { left: u(SCENE.x), top: u(SCENE.y - 101), width: u(SCENE.w), height: u(SCENE.h), overflow: "hidden", borderRadius: `${u(12)} ${u(12)} 0 0`,
        background: src ? "#000" : "radial-gradient(ellipse at 60% 25%,#5fb8ff 0,#1d5aa0 30%,transparent 62%),linear-gradient(180deg,#0a1a38,#04101f 60%,#0a2a30)" })}>
        {!src && (
          <>
            <B o={[SCENE.x, SCENE.y]} x={1120} y={300} w={400} h={480} style={{ background: "radial-gradient(ellipse at 50% 20%,#4a9ee0,#2a6fb8 40%,transparent 70%)" }} />
            <B o={[SCENE.x, SCENE.y]} x={1395} y={690} w={90} h={90} style={{ borderRadius: "50%", background: "radial-gradient(circle at 35% 30%,#dde7f5,#335)" }} />
          </>
        )}
        {src && (
          <video ref={ref} key={src.url} src={src.url} preload="metadata" playsInline aria-label={src.kind === "render" ? "Rendered reel" : "Source clip preview"}
            onTimeUpdate={onTime} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onLoadedMetadata={onTime}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
        )}
        {reel && src?.kind === "source" && <LiveSpotlight video={ref} path={path} reel={reel} clip={clip} settings={look} on={!message && !reel.stale} />}
        {spotNote && <div data-spotlight-note className="absolute" style={{ left: u(14), bottom: u(12), padding: `${u(4)} ${u(10)}`, borderRadius: u(6), background: "rgba(3,10,24,.6)",
          fontSize: u(17), color: spotNote.seen === 0 ? "#f5b82e" : "#dbe8f8", pointerEvents: "none" }}>{spotNote.text}</div>}
        {!reel && (
          <div className="absolute" style={{ left: u(1020 - SCENE.x), top: u(360 - SCENE.y), width: u(520), textAlign: "center", fontSize: u(22), color: "#dbe8f8" }}>
            {listFailed ? (<>Reels could not be loaded. <button type="button" onClick={() => loadList()} style={{ color: "#33a8ff", background: "transparent", border: 0, cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: u(22) }}>Try again</button></>) : list === null ? "Loading reels…" : list.length === 0 ? (
              <>No reel yet. In the Analysis workspace, confirm who a player is, then choose &quot;Create highlight reel&quot;.</>
            ) : (
              <>
                <div style={{ marginBottom: u(10), fontWeight: 600 }}>Open a reel</div>
                <ul aria-label="Reels" style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: u(190), overflowY: "auto" }}>
                  {list.map((x) => (
                    <li key={x.id} style={{ marginBottom: u(6) }}>
                      <Link href={`/reels/${x.id}`} style={{ color: "#33a8ff" }}>{x.name}</Link>
                      <span style={{ color: "#8ea3bf", fontSize: u(18) }}> · {x.clips.length} clips · {x.latest_render?.state.toLowerCase() ?? "not rendered"}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {message && <T o={[SCENE.x, SCENE.y]} x={1242} y={500} size={24} color="#dbe8f8" align="center">{message}</T>}

        <PlayerCard name={player?.display_name ?? "No player selected"} jersey={sheet?.jersey_number ?? "—"} team={sheet?.team ?? "Team —"}
          nationality={prof?.nationality?.name ?? "Nationality —"} pos={pos === "—" ? "Position —" : pos}
          foot={prof?.preferred_foot ? FOOT_NAMES[prof.preferred_foot] ?? "—" : "—"} age={prof?.age ?? "—"}
          playerId={player?.player_id ?? null} targetTrackId={player && target ? target.track_id : null} />

        <Scoreboard match={match} />
        {fs.on && <FullscreenBar playing={playing} onPlay={playPause} now={Math.max(0, t - span.a)} total={len > 1 ? len : 0} onSeek={seekTo}
          muted={muted} onMute={() => setMuted((m) => !m)} onExit={fs.exit} />}
      </dialog>

      {/* transport */}
      <Hit x={470} y={800} w={50} h={40} label="Previous clip" {...(ready ? { onClick: () => step(-1) } : { reason: "No video yet" })} />
      <Ic x={493} y={820} k="prev" size={26} color={ready ? "#fff" : "#8ea3bf"} {...glyph} />
      <Hit x={540} y={796} w={56} h={48} label={playing ? "Pause" : "Play"} {...(ready && (kind === "render" || hasClip) ? { onClick: playPause } : { reason: "Add a moment first" })} />
      {playing ? (
        <>
          <B x={558} y={806} w={8} h={28} style={{ background: "#fff", borderRadius: u(2) }} />
          <B x={572} y={806} w={8} h={28} style={{ background: "#fff", borderRadius: u(2) }} />
        </>
      ) : <Ic x={568} y={820} k="play" size={32} color={ready ? "#fff" : "#8ea3bf"} fill={ready ? "#fff" : "none"} />}
      <Hit x={612} y={800} w={50} h={40} label="Next clip" {...(ready ? { onClick: () => step(1) } : { reason: "No video yet" })} />
      <Ic x={637} y={820} k="next" size={26} color={ready ? "#fff" : "#8ea3bf"} />
      <T x={687} y={820} size={21}>{ready && (hasClip || kind === "render") ? `${mmss(Math.max(0, t - span.a))} / ${mmss(len > 1 ? len : null)}` : "— / —"}</T>
      <div role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} tabIndex={ready ? 0 : -1}
        onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); seekTo(Math.max(0, Math.min(1, (e.clientX - b.left) / b.width))); }}
        className="absolute" style={{ left: u(824), top: u(806 - 101), width: u(800), height: u(30), cursor: ready ? "pointer" : "default" }} />
      <B x={836} y={815} w={777} h={10} style={{ background: "#0b2a4d", borderRadius: u(5), pointerEvents: "none" }}>
        <i style={{ display: "block", height: "100%", width: `${p * 100}%`, borderRadius: u(5), background: "#1e90ff" }} />
      </B>
      {src?.kind === "source" && <CoverageBar path={path} clip={clip} lock={look.lock} />}
      <B x={824 + p * 777} y={809} w={24} h={24} style={{ borderRadius: "50%", background: "#cfe8ff", border: `${u(3)} solid #1e90ff`, boxSizing: "border-box", pointerEvents: "none" }} />
      <Hit x={1668} y={800} w={44} h={40} label={muted ? "Unmute" : "Mute"} {...(ready ? { onClick: () => setMuted((m) => !m) } : { reason: "No video yet" })} />
      <Ic x={1690} y={820} k={muted ? "mute" : "vol"} size={34} color={ready ? "#fff" : "#8ea3bf"} />
      <Sel x={1738} y={797} w={124} h={46} label="Playback speed" value={speed} options={[["0.5", "0.5x"], ["1", "1x"], ["1.5", "1.5x"], ["2", "2x"]]} onChange={setSpeed}
        style={{ background: "#041022", borderColor: "#17406f", borderRadius: u(8) }} />
      <Hit x={1895} y={798} w={44} h={44} label="Playback settings" reason={notBuilt("no playback settings")} />
      <Ic x={1917} y={820} k="gear" size={36} color="#8ea3bf" />
      <Hit x={1970} y={798} w={44} h={44} label="Full screen" {...(ready ? { onClick: fs.toggle } : { reason: "No video yet" })} />
      <Ic x={1992} y={820} k="full" size={34} color={ready ? "#fff" : "#8ea3bf"} />
    </section>
  );
}
