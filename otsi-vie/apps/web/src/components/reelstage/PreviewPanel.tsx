"use client";
/**
 * Page 06 Section 05 — Cinematic Spotlight preview and player (upper centre).
 *
 * With a reel: the source footage of the chosen clip, or — after Preview Render — the latest render with its spotlight, played through
 * the shared VideoPlayer (its transport really controls the picture: play, pause, seek, speed, full screen). The player card shows the
 * reel's confirmed player as recorded: team, shirt number and position from the match team sheet, nationality, foot and age from the
 * Players list (position: this match's team sheet first, else his usual one; "—" where nothing is recorded; the pencil opens his row
 * there), on a dark backing so it reads over bright footage; the scoreboard shows the linked match's recorded teams and score.
 * Source footage starts at the clip's in point and plays only to its out point (the player's `range`); when it reaches the out
 * point the preview advances to the next clip (looping to the first) and keeps playing.
 * Without a reel: the honest empty state, and the organization's reels to open below it.
 */
import type { Match, Playback, Reel, TrackSummary, Video } from "@otsi-vie/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { Thumb } from "@/components/workspace/shared";
import { FOOT_NAMES, POSITION_NAMES } from "@/components/players/PlayersList";
import { teamCode } from "@/lib/team";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { CoverageBar, LiveSpotlight, spotlightNote, useReelPath } from "./LiveSpotlight";
import { DEFAULTS, useStage } from "./shared";

const shade = { textShadow: "0 1px 3px rgba(0,0,0,.95), 0 0 8px rgba(0,0,0,.6)" } as const;
const score = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n));
const ASPECT: Record<string, string> = { "16:9": "16 / 9", "9:16": "9 / 16", "1:1": "1 / 1", "4:5": "4 / 5" };

/** the player card (memoised: it does not change while the preview plays, so the per-timeupdate re-render does not rebuild it) */
const PlayerCard = memo(function PlayerCard({ name, jersey, team, nationality, pos, foot, age, playerId, targetTrackId }: {
  name: string; jersey: string | number; team: string; nationality: string; pos: string; foot: string; age: string | number;
  playerId: string | null; targetTrackId: string | null;
}) {
  const { t: dict } = useLocale();
  const d = dict.body.reelstage;
  return (
    <div aria-label={d.cardAria} className="pointer-events-none absolute left-2 top-2 flex max-w-[72%] items-start gap-2 rounded-md bg-black/55 p-2">
      <div className="h-16 w-14 shrink-0 overflow-hidden rounded border border-[#8ec4ef] bg-raised/60">
        {targetTrackId && <Thumb track={{ track_id: targetTrackId, has_thumbnail: true } as TrackSummary} w={56} h={64} />}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="t-section truncate" style={shade}>{name}</span>
          <span className="t-panel shrink-0 rounded bg-primary px-1.5 py-0.5 text-white">{jersey}</span>
          {playerId && <Link href={`/players?player=${playerId}`} aria-label={d.editProfileAria} title={d.editProfileTitle}
            className="pointer-events-auto flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[#33a8ff] text-[#33a8ff]">✎</Link>}
        </div>
        <p className="t-small truncate" style={shade}>{team} · {nationality}</p>
        <p className="t-small truncate" style={shade}>{pos} · {d.footAge.replace("{a}", foot).replace("{b}", String(age))}</p>
      </div>
    </div>
  );
});

/** a cross-match reel in render mode has no single match to score: the rendered reel carries a per-clip event tag instead */
const AllMatchesNote = memo(function AllMatchesNote() {
  const { t: dict } = useLocale();
  return (
    <div className="pointer-events-none absolute right-2 top-2 rounded-md bg-black/70 px-2 py-1 t-small">
      {dict.body.reels.allMatches}
    </div>
  );
});

/** the scoreboard (memoised: the linked match does not change while the preview plays) */
const Scoreboard = memo(function Scoreboard({ match }: { match: Match | null }) {
  return (
    <div className="pointer-events-none absolute right-2 top-2 flex items-stretch overflow-hidden rounded-md bg-black/70 t-panel">
      <span className="px-2 py-1">{teamCode(match?.home?.name, match?.home?.short_name)}</span>
      <span className="bg-[#0a2bd0] px-2 py-1 text-white">{score(match?.home_score)}</span>
      <span className="px-2 py-1">{teamCode(match?.away?.name, match?.away?.short_name)}</span>
      <span className="bg-[#1e5bff] px-2 py-1 text-white">{score(match?.away_score)}</span>
    </div>
  );
});


const renderWord = (state: string | null | undefined, d: Dictionary["body"]["reels"]) =>
  state === "SUCCEEDED" ? d.renderStateSucceeded : state === "FAILED" ? d.renderStateFailed
    : state === "QUEUED" ? d.renderStateQueued : state === "RUNNING" ? d.renderStateRunning : d.renderStateNotRendered;

export function PreviewPanel() {
  const { t: dict } = useLocale();
  const { r, mode, setMode, draft } = useStage();
  const reel = r?.reel ?? null;
  const router = useRouter();
  const [video, setVideo] = useState<Video | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [list, setList] = useState<Reel[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [src, setSrc] = useState<{ url: string; kind: "render" | "source" } | null>(null);
  const [srcLoading, setSrcLoading] = useState(false);
  // the preview advances to the next clip at the out point and keeps playing (autoPlay follows the advance only)
  const [autoPlay, setAutoPlay] = useState(false);
  const [replay, setReplay] = useState(0);
  const advanceRef = useRef(false);
  const advancingRef = useRef(false);
  // SOT: the shared player hands its <video> to the spotlight through this ref, and plays only the clip's in/out (range)
  const ref = useRef<HTMLVideoElement | null>(null);
  const clips = reel?.clips ?? [];
  const sel = r?.selectedClip ?? null;
  const clipIndex = Math.max(0, clips.findIndex((c) => c.id === sel));
  const clip = clips[clipIndex] ?? null;
  // ADR-131: the clip's own video — a cross-match clip's source_video_id, else the reel's single video. The preview (playback,
  // video, match, spotlight path) follows the selected clip, so stepping clips steps videos too
  const isCross = reel?.source === "ALL_MATCHES";
  const clipVideoId = clip?.source_video_id ?? reel?.video_id ?? null;
  const path = useReelPath(reel, isCross ? clipVideoId : undefined);  // B.14 (ADR-090): the live spotlight and coverage
  const renderId = reel?.last_good_render?.has_output ? reel.last_good_render.id : null;   // the last finished file, even while a new render runs
  const kind = mode === "render" && renderId ? "render" : "source";

  // without a reel id the page opens the reel worked on last (the list is newest first); the list stays as the way to pick another one
  // a failed read is named as one, with a retry: an empty list means "no reels yet", not "could not load them"
  const loadList = useCallback(() => { setListFailed(false); void api<Reel[]>("/v1/reels").then((l) => { setList(l); if (l[0] && !r) router.replace(`/reels/${l[0].id}`); }, () => setListFailed(true)); }, [r, router]);
  useEffect(() => { if (!reel) loadList(); }, [reel, loadList]);
  useEffect(() => {
    setVideo(null); setMatch(null);
    if (clipVideoId) void api<Video>(`/v1/videos/${clipVideoId}`).then(setVideo, () => undefined);
  }, [clipVideoId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setMatch(null);
    if (video?.match_id) void api<Match>(`/v1/matches/${video.match_id}`).then(setMatch, () => undefined);
  }, [video?.match_id]);
  useEffect(() => {
    setSrc(null);
    if (!reel) return;
    setSrcLoading(true);
    const done = () => setSrcLoading(false);
    if (kind === "render" && renderId) void api<{ url: string }>(`/v1/renders/${renderId}/playback`).then((p) => { setSrc({ url: p.url, kind: "render" }); done(); }, () => { setSrc(null); done(); });
    else if (clipVideoId) void api<Playback>(`/v1/videos/${clipVideoId}/playback`).then((p) => { setSrc(p.url ? { url: p.url, kind: "source" } : null); done(); }, () => { setSrc(null); done(); });
    else { setSrc(null); done(); }
  }, [reel?.id, clipVideoId, kind, renderId]);   // eslint-disable-line react-hooks/exhaustive-deps

  // source footage: start at the clip's in point and stop at its out point (the player remounts per clip, so startAt applies)
  const inUs = clip?.in_pts_us ?? 0, outUs = clip?.out_pts_us ?? 0;
  const hasClip = !!clip;
  // an advance resets the autoplay flag on the next selection change, so a hand-picked clip never starts by itself
  useEffect(() => {
    if (advanceRef.current) { advanceRef.current = false; advancingRef.current = false; }
    else setAutoPlay(false);
  }, [sel]);
  const advance = useCallback(() => {
    if (!clips.length || advancingRef.current) return;
    advancingRef.current = true;
    const next = clips[(clipIndex + 1) % clips.length]!;
    advanceRef.current = true;
    setAutoPlay(true);
    if (next.id === sel) setReplay((n) => n + 1);   // one clip: loop it from its in point
    r?.setSelectedClip(next.id);
  }, [clips, clipIndex, sel, r]);
  const onTime = (sec: number) => {
    if (src?.kind === "source" && clip && sec * 1e6 >= outUs) advance();
  };
  const step = (d: number) => {
    if (!clips.length) return;
    setAutoPlay(false);
    r?.setSelectedClip(clips[Math.max(0, Math.min(clips.length - 1, clipIndex + d))]!.id);
  };
  const ready = !!src;

  const player = reel?.player ?? null;
  const prof = player?.profile ?? null;
  const sheet = reel?.player_roster ?? prof?.latest_team ?? null;           // this match's team sheet first, else his latest one
  const code_ = sheet?.position ?? prof?.position ?? null;                  // his position in this match, else his usual one
  const pos = code_ ? POSITION_NAMES(dict)[code_] ?? code_ : "—";
  const target = reel?.targets[0] ?? null;
  const message = !reel ? null : !src && !srcLoading ? dict.body.reelstage.previewNoSrc : kind === "source" && !hasClip ? dict.body.reelstage.previewAddMoment : null;
  const look = draft ?? reel?.settings ?? DEFAULTS;
  // the coverage is recomputed from the path on every render; the preview re-renders on every video timeupdate, so derive it once per clip/path/look
  const spotNote = useMemo(() => (reel && src?.kind === "source" && !message ? spotlightNote(reel, path, clip, look.lock, dict.body.reelstage) : null),
    [reel, path, clip, look.lock, src?.kind, message, dict]);

  const emptyTitle = !reel
    ? (listFailed ? dict.body.reels.reelsNotLoaded : list === null ? dict.body.reelstage.previewLoadingReels : list.length === 0 ? dict.body.reelstage.noReelYet : dict.body.reels.openReel)
    : (message ?? dict.body.reelstage.previewNoSrc);

  return (
    <section aria-label={dict.body.reelstage.previewAria} data-section="p06-s05" data-preview={reel ? src?.kind ?? "none" : "none"} className="vie-panel p-3">
      {/* the clip/match overlays sit on the preview frame, not inside the player: the shared player hides its children while it has
          nothing to play, and the player card + scoreboard must still identify the clip when the footage URL is empty or fails */}
      <div className="relative">
        <VideoPlayer
          key={`${src?.url ?? "none"}:${clip?.id ?? "none"}:${kind}:${replay}`}
          src={reel ? (src?.url ?? (srcLoading ? undefined : null)) : null}
          label={src?.kind === "render" ? dict.body.reels.previewRenderedAria : dict.body.reels.previewSourceAria}
          aspect={ASPECT[reel?.aspect ?? "16:9"] ?? "16 / 9"}
          autoPlay={autoPlay}
          startAt={src?.kind === "source" && clip ? clip.in_pts_us / 1e6 : undefined}
          videoRef={ref}
          range={src?.kind === "source" && clip ? { inUs: clip.in_pts_us, outUs: clip.out_pts_us } : null}
          onTime={onTime}
          empty={{ title: emptyTitle, body: "" }}
        >
          {reel && src?.kind === "source" && <LiveSpotlight video={ref} path={path} reel={reel} clip={clip} settings={look} on={!message && !reel.stale} />}
          {message && src && <div className="pointer-events-none absolute inset-0 grid place-items-center"><p className="t-body bg-black/60 rounded-md px-3 py-1.5">{message}</p></div>}
        </VideoPlayer>
        {spotNote && <div data-spotlight-note className="pointer-events-none absolute bottom-12 left-2 rounded-md bg-black/60 px-2 py-1 t-small"
          style={{ color: spotNote.seen === 0 ? "#f5b82e" : "#dbe8f8" }}>{spotNote.text}</div>}
        {reel && (
          <PlayerCard name={player?.display_name ?? dict.body.workspace.noPlayerSelected} jersey={sheet?.jersey_number ?? "—"} team={sheet?.team ?? dict.body.reelstage.teamDash}
            nationality={prof?.nationality?.name ?? dict.body.reelstage.nationalityDash} pos={pos === "—" ? dict.body.reelstage.positionDash : pos}
            foot={prof?.preferred_foot ? FOOT_NAMES(dict)[prof.preferred_foot] ?? "—" : "—"} age={prof?.age ?? "—"}
            playerId={player?.player_id ?? null} targetTrackId={player && target ? target.track_id : null} />
        )}
        {reel && (isCross && kind === "render" ? <AllMatchesNote /> : <Scoreboard match={match} />)}
      </div>

      {reel && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {kind === "source" && (
            <>
              <button type="button" className="vie-btn vie-btn-sm" disabled={!ready} onClick={() => step(-1)} title={dict.body.reelstage.prevClip}>‹ {dict.body.reelstage.prevClip}</button>
              <button type="button" className="vie-btn vie-btn-sm" disabled={!ready} onClick={() => step(1)} title={dict.body.reelstage.nextClip}>{dict.body.reelstage.nextClip} ›</button>
            </>
          )}
          <div role="group" aria-label={dict.body.reelstage.previewAria} className="ml-auto inline-flex rounded-md border border-line2 bg-p0 p-0.5">
            {(["clip", "render"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={m === "render" && !renderId}
                title={m === "render" && !renderId ? dict.body.reelstage.previewNoRender : undefined}
                onClick={() => setMode(m)}
                className={`t-button rounded px-3 py-1 ${mode === m ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}>
                {m === "clip" ? dict.body.reels.previewSourceAria : dict.body.reels.previewRenderedAria}
              </button>
            ))}
          </div>
        </div>
      )}
      {reel && src?.kind === "source" && <div className="mt-2"><CoverageBar path={path} clip={clip} lock={look.lock} /></div>}

      {!reel && (
        <div className="mt-2">
          {listFailed ? (
            <p className="t-body">{dict.body.reels.reelsNotLoaded} <button type="button" onClick={() => loadList()} className="text-primary underline">{dict.common.retry}</button></p>
          ) : list === null ? (
            <p className="t-small">{dict.body.reelstage.previewLoadingReels}</p>
          ) : list.length === 0 ? (
            <p className="t-body">{dict.body.reelstage.noReelYet.replace("{a}", dict.body.workspace.createHighlightReel)}.</p>
          ) : (
            <>
              <p className="t-panel mb-1">{dict.body.reels.openReel}</p>
              <ul aria-label={dict.pages.reels.title} className="max-h-44 space-y-1 overflow-y-auto t-body">
                {list.map((x) => (
                  <li key={x.id}>
                    <Link href={`/reels/${x.id}`} className="text-primary underline">{x.name}</Link>
                    <span className="t-small"> · {(x.clips.length === 1 ? dict.body.reels.reelListClipsOne : dict.body.reels.reelListClipsMany).replace("{a}", String(x.clips.length))} · {renderWord(x.latest_render?.state, dict.body.reels)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
