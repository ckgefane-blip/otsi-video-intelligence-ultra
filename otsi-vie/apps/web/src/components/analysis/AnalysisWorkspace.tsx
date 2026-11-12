"use client";
/**
 * Analysis Workspace (page 04), connected to the real API: the playback copy (section 3) with the run's boxes drawn over it (4),
 * overlay toggles (5), the run's tracks (6), the selected track and its identity review (7), transport (8) and the selected
 * track's presence on the timeline (10).
 *
 * What a box means: a DETECTED observation of the analysed frame nearest to the playhead. Frames are analysed every 1/sample_fps
 * seconds. A box drawn solid is this very frame's detection. A dashed box is not: either the nearest analysed frame (at most half a
 * sample interval away), or — between two detections of the same track with no gap — a position estimated on screen between them
 * (`glided`, INTERPOLATED in ADR-025 terms: never stored, never called detected). The selected track says which. Track numbers are temporary
 * references inside this run; a name and OTSI Player ID appear only after a person confirmed the identity (ADR-016).
 */
import type { AnalysisRun, ObservationWindow, Observation, PitchCalibration, PitchCamera, Playback, PlayerIdentity, TrackIdentity, TrackSummary, Video } from "@otsi-vie/contracts";
import { AlertTriangle, Link2, Loader2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, ApiProblem } from "@/lib/api";
import { rememberVideo } from "@/lib/currentVideo";
import { formatDuration, formatResolution } from "@/lib/format";
import { trackLabel } from "@/lib/identity";
import { KitSwatch, LookAlikePanel, SamePersonPanel, TrackThumb } from "./SamePerson";
import { usePitchCalibrations } from "@/components/workspace/PitchCalibration";
import { useBall, type BallState } from "@/components/workspace/BallMarks";
import { usePeriods, type PeriodsState } from "@/components/workspace/Periods";
import { useEvents, type EventsState } from "@/components/workspace/Events";
import { CandidatesPanel, ShirtNumberPanel } from "./IdentityEvidence";
import { KIT_COLOUR, kitLegend, TrackOverlay } from "./TrackOverlay";
import { MatchLinker, RosterPanel, TeamAssignment } from "@/components/matches/MatchPanels";
import { ImpactNote } from "./ImpactNote";
import { useLocale } from "@/lib/i18n";

const CHUNK_US = 10_000_000;
const REVIEWERS = ["OWNER", "ADMIN", "ANALYST"];
const WRITERS = ["OWNER", "ADMIN", "ANALYST", "EDITOR"];

/** what is drawn over the video; trails, shapes, heat and passes are placed on the pitch, so they need a calibration at that moment */
export interface Layers { boxes: boolean; labels: boolean; ball: boolean; people: boolean; trails?: boolean; shapes?: boolean; heat?: boolean; passes?: boolean }

/** a pitch calibration sample: `H` maps pitch metres to the normalised picture of [start_us, end_us) */
export interface Calibration { start_us: number; end_us: number; H: number[][]; length_m: number; width_m: number; quality: number }

interface Ctx {
  video: Video | null;
  run: AnalysisRun | null;
  tracks: TrackSummary[] | null;
  playback: Playback | null;
  error: string | null;
  timeUs: number;
  setTimeUs(t: number): void;
  playing: boolean;
  setPlaying(p: boolean): void;
  seek(t: number): void;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  visible: { o: Observation; exact: boolean; glided: boolean; dtUs: number }[];
  selectedId: string | null;
  select(id: string | null): void;
  layers: Layers;
  setLayers(l: Layers): void;
  intervalUs: number;
  canReview: boolean;
  canWrite: boolean;
  reloadTracks(): Promise<void>;
  reloadVideo(): Promise<void>;
  /** bumps when roster, teams or shirt numbers change, so identity suggestions reload */
  evidenceKey: number;
  bumpEvidence(): void;
  observationsOf(trackId: string): Promise<Observation[]>;
  /** the loaded observations of one track in [fromUs, toUs] (the seconds around the playhead), time order */
  observationsNear(trackId: string, fromUs: number, toUs: number): Observation[];
  /** the best pitch calibration sample covering `t` among the loaded seconds, or null (not calibrated there) */
  calibrationAt(t: number): Calibration | null;
  /** the video's pitch calibrations (null while loading), newest first, and a reload */
  pitch: { list: PitchCalibration[] | null; camera: PitchCamera | null; reload(): Promise<void> };
  /** the engine's ball (followed automatically) and a person's marks for the moments it cannot see */
  ball: BallState;
  /** match time: the halves (proposed or confirmed), a draft while dragging, and the Time Range choice */
  periods: PeriodsState;
  /** possession and passes found from the ball (ADR-040), in match time */
  events: EventsState;
}
const WorkspaceCtx = createContext<Ctx | null>(null);
/** The workspace's data and actions, for any presentation layer (the approved-design views consume this; ADR-035). */
export type AnalysisWorkspaceState = Ctx;
export const useAnalysisWorkspace = (): Ctx => useWs();
function useWs(): Ctx {
  const c = useContext(WorkspaceCtx);
  if (!c) throw new Error("outside AnalysisWorkspace");
  return c;
}

const seconds = (us: number) => `${(us / 1_000_000).toFixed(2)} s`;

/** `finishedRunId`: the newest finished run as another view sees it (Processing); when it changes the run and its tracks are read again */
export function AnalysisWorkspace({ videoId, finishedRunId, children }: { videoId: string; finishedRunId?: string | null; children: ReactNode }) {
  const { t: dict } = useLocale();
  const { organization } = useAuth();
  useEffect(() => { rememberVideo(organization?.organization_id, videoId); }, [organization?.organization_id, videoId]);   // carried to the other pages
  const [video, setVideo] = useState<Video | null>(null);
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [tracks, setTracks] = useState<TrackSummary[] | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeUs, setTimeUs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, select] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layers>({ boxes: true, labels: true, ball: true, people: true });
  const pitch = usePitchCalibrations(video?.id);
  const ball = useBall(video?.id);
  const periods = usePeriods(video?.id);
  const [version, bump] = useState(0);
  const [evidenceKey, setEvidenceKey] = useState(0);
  const pd = periods.data;
  const events = useEvents(video?.id, `${ball.path?.track?.id}:${ball.path?.track?.status}:${pd?.state}:${pd?.first?.start_us}:${pd?.first?.end_us}:${pd?.second?.start_us}:${pd?.second?.end_us}:${evidenceKey}`);
  const chunks = useRef(new Map<number, Observation[] | "loading">());
  const cals = useRef(new Map<number, Calibration[]>());
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [v, runs, pb] = await Promise.all([api<Video>(`/v1/videos/${videoId}`), api<AnalysisRun[]>(`/v1/videos/${videoId}/analysis-runs`),
          api<Playback>(`/v1/videos/${videoId}/playback`)]);
        setVideo(v); setPlayback(pb);
        const done = runs.find((r) => r.status === "SUCCEEDED") ?? null;
        setRun(done);
        if (done) setTracks(await api<TrackSummary[]>(`/v1/analysis-runs/${done.id}/tracks`));
      } catch (x) {
        setError(x instanceof ApiProblem ? x.message : dict.body.analysis.analysisLoadFailed);
      }
    })();
  }, [videoId, finishedRunId]);

  const reloadVideo = useCallback(async () => { setVideo(await api<Video>(`/v1/videos/${videoId}`)); }, [videoId]);

  const reloadTracks = useCallback(async () => {
    if (run) setTracks(await api<TrackSummary[]>(`/v1/analysis-runs/${run.id}/tracks`));
  }, [run]);

  const load = useCallback((k: number) => {
    if (!run || k < 0 || chunks.current.has(k)) return;
    chunks.current.set(k, "loading");
    void api<ObservationWindow>(`/v1/analysis-runs/${run.id}/observations?from_us=${k * CHUNK_US}&to_us=${(k + 1) * CHUNK_US}`).then(
      (w) => { chunks.current.set(k, w.observations); cals.current.set(k, w.calibrations ?? []); bump((n) => n + 1); },
      () => chunks.current.delete(k),
    );
  }, [run]);

  useEffect(() => {
    const k = Math.floor(timeUs / CHUNK_US);
    load(k); load(k + 1); if (timeUs % CHUNK_US < 1_000_000) load(k - 1);
  }, [timeUs, load]);

  // follow the video element. The boxes take the time of the frame ON SCREEN (requestVideoFrameCallback: called as each video frame is presented,
  // with that frame's own media time). `currentTime` read on animation frames ran ahead of / behind the picture: measured on the owner's match while
  // playing, 44 ms behind the shown frame on average, between -46 and +23 ms, so a box fell behind a running player and caught up again (2026-10-31).
  // Browsers without it fall back to animation frames.
  useEffect(() => {
    const el = videoRef.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number; cancelVideoFrameCallback?: (h: number) => void }) | null;
    if (!el) return;
    let raf = 0, vfc = 0;
    const exact = typeof el.requestVideoFrameCallback === "function";
    const onFrame = (_now: number, meta: { mediaTime: number }) => { setTimeUs(Math.round(meta.mediaTime * 1_000_000)); vfc = el.requestVideoFrameCallback!(onFrame); };
    if (exact) vfc = el.requestVideoFrameCallback!(onFrame);                       // every presented frame: playing, stepping and after a seek
    const tick = () => { setTimeUs(Math.round(el.currentTime * 1_000_000)); if (!exact && !el.paused) raf = requestAnimationFrame(tick); };
    const onPlay = () => { setPlaying(true); if (!exact) raf = requestAnimationFrame(tick); };
    const onPause = () => { setPlaying(false); cancelAnimationFrame(raf); if (!exact) tick(); };
    const onSeeked = () => { if (!exact) tick(); };
    el.addEventListener("play", onPlay); el.addEventListener("pause", onPause); el.addEventListener("seeked", onSeeked); el.addEventListener("loadedmetadata", tick);
    return () => {
      cancelAnimationFrame(raf); if (exact) el.cancelVideoFrameCallback?.(vfc);
      el.removeEventListener("play", onPlay); el.removeEventListener("pause", onPause); el.removeEventListener("seeked", onSeeked); el.removeEventListener("loadedmetadata", tick);
    };
  }, [playback?.url]);

  const intervalUs = run?.config.sample_fps ? 1_000_000 / run.config.sample_fps : 500_000;
  const frameUs = video?.frame_rate ? (1_000_000 * video.frame_rate.den) / video.frame_rate.num : 33_366;

  const visible = useMemo(() => {
    const k = Math.floor(timeUs / CHUNK_US);
    const near: Observation[] = [];
    for (const c of [k - 1, k, k + 1]) { const v = chunks.current.get(c); if (Array.isArray(v)) near.push(...v); }
    const best = new Map<string, { o: Observation; dtUs: number; glided?: boolean }>();
    for (const o of near) {
      const dt = Math.abs(o.pts_us - timeUs);
      if (dt > intervalUs / 2 + frameUs / 2) continue;                   // only the analysed frame nearest to the playhead
      const b = best.get(o.track_id);
      if (!b || dt < b.dtUs) best.set(o.track_id, { o, dtUs: dt });
    }
    // Between two analysed frames of the SAME track (no gap: neighbours at most 1.6 sample intervals apart) the box glides from one measurement to the next, so it
    // stays on the player at every video frame instead of waiting and jumping to catch up. Only between two real measurements: never beyond the last one, never across a gap.
    // It is an estimate, not a detection: marked glided (drawn dashed, named as estimated), and exact only when the playhead sits on a real detection.
    const before = new Map<string, Observation>(), after = new Map<string, Observation>();
    for (const o of near) {
      if (o.pts_us <= timeUs) { const p = before.get(o.track_id); if (!p || o.pts_us > p.pts_us) before.set(o.track_id, o); }
      else { const n = after.get(o.track_id); if (!n || o.pts_us < n.pts_us) after.set(o.track_id, o); }
    }
    for (const [id, p] of before) {
      const n = after.get(id);
      if (!n || n.pts_us - p.pts_us > intervalUs * 1.6 || n.pts_us === p.pts_us) continue;
      const dt = Math.min(timeUs - p.pts_us, n.pts_us - timeUs);
      if (dt <= frameUs / 2) continue;                                   // the playhead is on a real detection: show that one
      const a = (timeUs - p.pts_us) / (n.pts_us - p.pts_us);
      const lerp = (u: number, v: number) => u + (v - u) * a;
      best.set(id, { o: { ...p, pts_us: Math.round(timeUs), x: lerp(p.x, n.x), y: lerp(p.y, n.y), w: lerp(p.w, n.w), h: lerp(p.h, n.h),
        pitch_x: typeof p.pitch_x === "number" && typeof n.pitch_x === "number" ? lerp(p.pitch_x, n.pitch_x) : p.pitch_x ?? null, pitch_y: typeof p.pitch_y === "number" && typeof n.pitch_y === "number" ? lerp(p.pitch_y, n.pitch_y) : p.pitch_y ?? null }, dtUs: dt, glided: true });
    }
    return [...best.values()].map((b) => ({ o: b.o, dtUs: b.dtUs, glided: !!b.glided, exact: !b.glided && b.dtUs <= frameUs / 2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUs, intervalUs, frameUs, version]);

  const seek = useCallback((t: number) => {
    const el = videoRef.current;
    if (el) el.currentTime = Math.max(0, t / 1_000_000);
    setTimeUs(Math.max(0, Math.round(t)));
  }, []);

  // ?t=<seconds> (a Player Report event, a share of a moment): open the video there, once
  const deep = useRef(false);
  useEffect(() => {
    if (deep.current || !playback) return;
    const t = Number(new URLSearchParams(window.location.search).get("t"));
    if (!Number.isFinite(t) || t <= 0) return;
    deep.current = true;
    const el = videoRef.current;
    const go = () => seek(t * 1_000_000);
    if (!el || el.readyState >= 1) go(); else el.addEventListener("loadedmetadata", go, { once: true });
  }, [playback, seek]);

  const observationsNear = useCallback((trackId: string, fromUs: number, toUs: number) => {
    const out: Observation[] = [];
    for (let k = Math.floor(fromUs / CHUNK_US); k <= Math.floor(toUs / CHUNK_US); k++) {
      const v = chunks.current.get(k);
      if (Array.isArray(v)) for (const o of v) if (o.track_id === trackId && o.pts_us >= fromUs && o.pts_us <= toUs) out.push(o);
    }
    return out.sort((a, b) => a.pts_us - b.pts_us);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const calibrationAt = useCallback((t: number) => {
    let best: Calibration | null = null;
    for (const k of [Math.floor(t / CHUNK_US) - 1, Math.floor(t / CHUNK_US)]) {
      for (const c of cals.current.get(k) ?? []) if (c.start_us <= t && t < c.end_us && (!best || c.quality > best.quality)) best = c;
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const observationsOf = useCallback(async (trackId: string) => {
    const t = tracks?.find((x) => x.track_id === trackId);
    if (!run || !t) return [];
    const out: Observation[] = [];
    for (let from = t.first_pts_us; from <= t.last_pts_us; from += 20_000_000) {
      const w = await api<ObservationWindow>(`/v1/analysis-runs/${run.id}/observations?from_us=${from}&to_us=${Math.min(from + 20_000_000, t.last_pts_us + 1)}`);
      out.push(...w.observations.filter((o) => o.track_id === trackId));
    }
    return out;
  }, [run, tracks]);

  const value: Ctx = {
    video, run, tracks, playback, error, timeUs, setTimeUs, playing, setPlaying, seek, videoRef, visible, selectedId, select, layers, setLayers, observationsNear, calibrationAt,
    intervalUs, canReview: !!organization && REVIEWERS.includes(organization.role), canWrite: !!organization && WRITERS.includes(organization.role),
    reloadTracks, reloadVideo, observationsOf, evidenceKey, bumpEvidence: () => setEvidenceKey((n) => n + 1), pitch, ball, periods, events,
  };
  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

/* ------------------------------------------------------------------ section 1: which video and run */
export function MatchContext() {
  const { t: dict } = useLocale();
  const { video, run, error, tracks, canWrite, reloadVideo, bumpEvidence, evidenceKey } = useWs();
  // the two counts are derived from the track list, not re-filtered on every video frame (the provider re-renders per frame while playing)
  const counts = useMemo(() => tracks ? { people: tracks.filter((t) => t.class_name !== "BALL").length, ball: tracks.filter((t) => t.class_name === "BALL").length } : null, [tracks]);
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!video) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{dict.common.loading}</p>;
  return (
    <div className="space-y-2 text-sm" data-video={video.id}>
      <p className="font-normal">{video.title ?? video.original_filename}</p>
      <p className="text-xs text-muted">{formatDuration(video.duration_us)} · {formatResolution(video.width, video.height)}</p>
      {run ? (
        <p className="text-xs" data-run={run.id}>{dict.body.analysis.analysisOf.replace("{a}", run.finished_at?.slice(0, 16).replace("T", " ") ?? "—").replace("{b}", String(run.config.sample_fps))} ·{" "}
          {counts ? dict.body.analysis.peopleBallTracks.replace("{a}", String(counts.people)).replace("{b}", String(counts.ball)) : "…"}</p>
      ) : (
        <p className="text-xs text-muted">{dict.body.analysis.noFinishedYet}<Link className="text-primary underline" href={`/videos/${video.id}/processing`}>{dict.body.analysis.startOnProcessing}</Link>.</p>
      )}
      <div className="border-t border-line/60 pt-2">
        <MatchLinker videoId={video.id} matchId={video.match_id} canWrite={canWrite} refreshKey={evidenceKey} onLinked={() => { void reloadVideo(); bumpEvidence(); }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ sections 3 + 4: the video with the boxes */
export function VideoWithBoxes() {
  const { t: dict } = useLocale();
  const { video, playback, videoRef, visible, layers, selectedId, select, tracks } = useWs();
  const labelOf = useMemo(() => new Map((tracks ?? []).map((t) => [t.track_id, t])), [tracks]);
  // the boxes at the playhead, after the layer toggles — derived from the frame's observations and the toggles only, not re-filtered per render
  const shown = useMemo(() => visible.filter(({ o }) => (o.class_name === "BALL" ? layers.ball : layers.people) && layers.boxes), [visible, layers]);
  if (!playback) return <div role="status" aria-label={dict.body.analysis.loadingPlayback} className="aspect-video animate-pulse rounded-ctl bg-raised/50" />;
  if (!playback.available || !playback.url) return <p className="text-sm text-muted">{dict.body.analysis.noPlaybackYet.replace("{a}", playback.reason ?? "")}</p>;
  const W = video?.width ?? 1920, H = video?.height ?? 1080;           // boxes are normalised to the decoded frame: draw in its pixels
  return (
    <div className="relative w-full overflow-hidden rounded-ctl bg-black" style={{ aspectRatio: `${W} / ${H}` }}>
      <video ref={videoRef} src={playback.url} preload="metadata" playsInline className="absolute inset-0 h-full w-full" aria-label={dict.body.processing.matchVideo} />
      <TrackOverlay visible={shown} tracks={labelOf} W={W} H={H} labels={layers.labels} selectedId={selectedId} onSelect={select} />
    </div>
  );
}

export function BoxLegend() {
  const { t: dict } = useLocale();
  const { intervalUs, visible } = useWs();
  return (
    <div className="space-y-1 text-xs text-muted">
      <p>{kitLegend(dict).map(([g, l]) => <span key={g} className="mr-2"><span className="font-normal" style={{ color: KIT_COLOUR[g] }}>{l}</span></span>)}
        <span className="font-normal" style={{ color: "#19a0ff" }}>{dict.body.analysis.legendBlue}</span>: {dict.body.analysis.legendNoTeam} · <span className="font-normal text-amber">{dict.body.analysis.legendAmber}</span>: {dict.body.analysis.legendBall} · {dict.body.analysis.legendWhite}: {dict.body.analysis.legendSelected}.
        {dict.body.analysis.legendNameReplaces}</p>
      <p>{dict.body.analysis.legendFrames.replace("{a}", seconds(intervalUs))}</p>
      <p data-visible-boxes={visible.length}>{dict.body.analysis.legendBoxesAtPlayhead.replace("{a}", String(visible.length))}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ section 5: overlay toggles */
export function OverlayToggles() {
  const { t: dict } = useLocale();
  const { layers, setLayers } = useWs();
  const items: [keyof Layers, string][] = [["boxes", dict.body.analysis.overlayBoxes], ["labels", dict.body.analysis.overlayTrackNumbers], ["people", dict.body.analysis.overlayPeople], ["ball", dict.body.processing.ball]];
  return (
    <fieldset className="space-y-1.5 text-sm">
      <legend className="sr-only">{dict.body.processing.overlaysLabel}</legend>
      {items.map(([k, label]) => (
        <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} /> {label}</label>
      ))}
      <p className="pt-1 text-xs text-muted">{dict.body.analysis.overlaysNeed}</p>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ section 6: tracks of this run */
// one row of the track list: memoised, so the rows do not re-render on every video frame — only the selected row changes, and the list
// itself only when the tracks, the kind filter or the minimum-observation filter change (select and seek are stable callbacks)
const TrackRow = memo(function TrackRow({ t, selected, onSelect, onSeek }: { t: TrackSummary; selected: boolean; onSelect: (id: string) => void; onSeek: (t: number) => void }) {
  const { t: dict } = useLocale();
  const stateLabel: Record<string, string> = { CONFIRMED: dict.body.workspace.confirmedLabel, CANDIDATE: dict.body.workspace.suggestedLabel, UNRESOLVED: dict.body.workspace.notIdentified, REJECTED: dict.body.workspace.rejectedLabel, CONFLICT: dict.body.workspace.conflictLabel };
  return (
    <li>
      <button type="button" data-track={t.track_number} aria-pressed={selected}
        onClick={() => { onSelect(t.track_id); onSeek(t.first_pts_us); }}
        className={`flex w-full items-start gap-2 rounded-ctl border px-2 py-1.5 text-left ${selected ? "border-primary bg-primary/10" : "border-line/60 hover:border-primary/50"}`}>
        {t.class_name !== "BALL" && <TrackThumb trackId={t.track_id} has={t.has_thumbnail} size={22} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-normal">{t.label}</span>
          <span className="block text-xs text-muted">{seconds(t.first_pts_us)}–{seconds(t.last_pts_us)} · {t.observation_count} {dict.body.analysis.obsAbbr} · {dict.body.analysis.confAbbr} {t.mean_confidence?.toFixed(2) ?? "—"}
            {t.identity_state !== "UNRESOLVED" ? ` · ${stateLabel[t.identity_state] ?? t.identity_state.toLowerCase()}` : ""}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-2">
            <KitSwatch t={t} />
            {(t.links_proposed ?? 0) + (t.links_confirmed ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-cyan" title={dict.body.analysis.samePersonLinksTitle}>
                <Link2 className="h-3 w-3" />{t.links_confirmed ? dict.body.analysis.linksLinked.replace("{a}", String(t.links_confirmed)) : ""}{t.links_confirmed && t.links_proposed ? " · " : ""}{t.links_proposed ? dict.body.analysis.linksToReview.replace("{a}", String(t.links_proposed)) : ""}
              </span>
            )}
            {t.possible_identity_switch && <span className="inline-flex items-center gap-0.5 text-[11px] text-amber" title={dict.body.analysis.appearanceChangesTitle}><AlertTriangle className="h-3 w-3" />{dict.body.analysis.linksCheck}</span>}
          </span>
        </span>
      </button>
    </li>
  );
});

export function TrackList() {
  const { t: dict } = useLocale();
  const { tracks, select, selectedId, seek, run, video, canWrite, canReview, bumpEvidence } = useWs();
  const [tab, setTab] = useState<"tracks" | "roster" | "teams">("tracks");
  const [kind, setKind] = useState<"PERSON" | "BALL" | "ALL">("PERSON");
  const [minObs, setMinObs] = useState(3);
  // the filtered + sorted list is derived from the track list and the two filters only — not rebuilt on every video frame
  const list = useMemo(() => (tracks ?? []).filter((t) => (kind === "ALL" || (kind === "BALL" ? t.class_name === "BALL" : t.class_name !== "BALL")) && t.observation_count >= minObs)
    .sort((a, b) => a.first_pts_us - b.first_pts_us), [tracks, kind, minObs]);
  const tabs = (
    <div role="tablist" aria-label={dict.body.analysis.playersPanel} className="flex gap-1 text-xs">
      {([["tracks", dict.body.analysis.tabTracks], ["roster", dict.body.analysis.tabRoster], ["teams", dict.body.analysis.tabTeams]] as const).map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`rounded-ctl border px-2 py-1 ${tab === k ? "border-primary bg-primary/10 text-primary" : "border-line"}`}>{l}</button>
      ))}
    </div>
  );
  if (tab === "roster") return <div className="space-y-2">{tabs}{video?.match_id
    ? <RosterPanel matchId={video.match_id} canWrite={canWrite} canVerify={canReview} onChanged={bumpEvidence} />
    : <p className="text-sm text-muted">{dict.body.analysis.rosterLinkFirst}</p>}</div>;
  if (tab === "teams") return <div className="space-y-2">{tabs}{run
    ? <TeamAssignment runId={run.id} canReview={canReview} onChanged={bumpEvidence} />
    : <p className="text-sm text-muted">{dict.body.analysis.kitGroupsAppear}</p>}</div>;
  if (!run) return <div className="space-y-2">{tabs}<p className="text-sm text-muted">{dict.body.analysis.tracksAppear}</p></div>;
  if (!tracks) return <p role="status" className="text-sm text-muted">{dict.body.analysis.loadingTracks}</p>;
  return (
    <div className="flex min-h-0 flex-col gap-2 text-sm">
      {tabs}
      <div className="flex flex-wrap gap-2 text-xs">
        <select aria-label={dict.body.analysis.trackKind} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="rounded-ctl border border-line bg-canvas px-2 py-1">
          <option value="PERSON">{dict.body.analysis.overlayPeople}</option><option value="BALL">{dict.body.processing.ball}</option><option value="ALL">{dict.body.processing.filterAll}</option>
        </select>
        <label className="flex items-center gap-1">{dict.body.analysis.atLeast}
          <select aria-label={dict.body.analysis.minObs} value={minObs} onChange={(e) => setMinObs(Number(e.target.value))} className="rounded-ctl border border-line bg-canvas px-1 py-1">
            {[1, 3, 10, 30].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>{dict.body.analysis.observations}</label>
      </div>
      <p className="text-xs text-muted">{list.length} of {tracks.length} tracks. Track numbers are temporary references within this analysis, not player IDs.</p>
      {list.length === 0 && <p className="text-sm text-muted">{dict.body.analysis.noTracksMatch}</p>}
      <ul aria-label={dict.body.analysis.tabTracks} className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
        {list.map((t) => <TrackRow key={t.track_id} t={t} selected={t.track_id === selectedId} onSelect={select} onSeek={seek} />)}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ section 7: the selected track and its identity */
export function SelectedTrack() {
  const { t: dict } = useLocale();
  const { tracks, selectedId, visible, canReview, reloadTracks, seek, select, video, evidenceKey, bumpEvidence } = useWs();
  const router = useRouter();
  // the selected track, looked up once per selection / track-list change — not on every video frame
  const t = useMemo(() => tracks?.find((x) => x.track_id === selectedId) ?? null, [tracks, selectedId]);
  // the track's box at the playhead, if any — same lookup, same cadence
  const here = useMemo(() => (t ? visible.find((v) => v.o.track_id === t.track_id) : undefined), [visible, t]);
  const [identity, setIdentity] = useState<TrackIdentity | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlayerIdentity[] | null>(null);
  const [newName, setNewName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setIdentity(null); setMsg(null); setHits(null); setQ(""); setReason("");
    if (t && t.class_name !== "BALL") void api<TrackIdentity>(`/v1/tracks/${t.track_id}/identity`).then(setIdentity, () => setIdentity(null));
  }, [t?.track_id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    const h = setTimeout(() => void api<PlayerIdentity[]>(`/v1/players?q=${encodeURIComponent(q.trim())}`).then(setHits, () => setHits([])), 250);
    return () => clearTimeout(h);
  }, [q]);
  if (!t) return <p className="text-sm text-muted">{dict.body.analysis.clickBoxOrTrack}</p>;
  // changing an existing decision is a correction: the history needs a reason (enforced by the database too)
  const correcting = !!identity?.decision_id;
  const reasonOk = !correcting || reason.trim().length >= 3;
  const decide = (state: "CONFIRMED" | "REJECTED" | "UNRESOLVED", playerId: string | null, what: string) => {
    if (!identity || !reasonOk) return;
    setBusy(true); setMsg(null);
    void api<TrackIdentity>(`/v1/tracks/${t.track_id}/identity-decisions`, {
      method: "POST", json: { state, player_id: playerId, supersedes_id: identity.decision_id, reason: correcting ? reason.trim() : null },
    }).then(async (r) => { setIdentity(r); setMsg({ ok: true, text: what }); setHits(null); setQ(""); setReason(""); await reloadTracks(); },
      (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.analysis.decisionNotSaved })).finally(() => setBusy(false));
  };
  const createAndConfirm = (name: string = newName) => {
    if (!reasonOk || name.trim().length < 2) return;
    setBusy(true); setMsg(null);
    void api<PlayerIdentity>("/v1/players", { method: "POST", json: { display_name: name.trim() }, headers: { "idempotency-key": `ws-${t.track_id}-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}` } })
      .then((p) => { setBusy(false); setNewName(""); setQ(""); decide("CONFIRMED", p.player_id, dict.body.analysis.newProvisionalCreated.replace("{a}", p.display_name).replace("{b}", trackLabel(t.track_number))); },
        (x) => { setBusy(false); setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.analysis.playerNotCreated }); });
  };
  return (
    <div className="space-y-3 text-sm" data-selected-track={t.track_number}>
      <div>
        <p className="font-normal" data-track-label>{t.label}</p>
        <p className="text-xs text-muted">{dict.body.analysis.temporaryTrack.replace("{a}", trackLabel(t.track_number))}{t.shot_number ? ` · ${dict.body.analysis.shotLabel.replace("{a}", String(t.shot_number))}` : ""}</p>
      </div>
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">{dict.body.analysis.kindLabel}</dt><dd>{t.class_name === "BALL" ? dict.body.processing.ball : dict.body.analysis.kindPersonTeam}</dd>
        <dt className="text-muted">{dict.body.analysis.seenLabel}</dt><dd>{seconds(t.first_pts_us)} – {seconds(t.last_pts_us)}</dd>
        <dt className="text-muted">{dict.body.analysis.observationsLabel}</dt><dd>{dict.body.analysis.detectedBoxes.replace("{a}", String(t.observation_count)).replace("{b}", t.mean_confidence?.toFixed(2) ?? "—")}</dd>
        {t.evidence && t.class_name !== "BALL" && (
          <>
            <dt className="text-muted">{dict.body.aiAnalyst.evidence}</dt>
            <dd data-track-evidence>{dict.body.analysis.strongestDetection.replace("{a}", t.evidence.peak_confidence?.toFixed(2) ?? "—").replace("{b}", String(t.evidence.mean_height_px ?? "—"))}
              {t.evidence.low_confidence_share ? dict.body.analysis.weakDetections.replace("{a}", String(Math.round(t.evidence.low_confidence_share * 100))) : ""}</dd>
          </>
        )}
        <dt className="text-muted">{dict.body.analysis.atPlayhead}</dt>
        <dd data-at-playhead={here ? (here.exact ? "exact" : here.glided ? "estimated" : "nearest") : "none"}>{here ? (here.exact ? dict.body.analysis.detectedInFrame : here.glided ? dict.body.analysis.estimatedBetween.replace("{a}", seconds(here.dtUs)) : dict.body.analysis.nearestFrame.replace("{a}", seconds(here.dtUs))) : dict.body.analysis.notObservedHere}</dd>
      </dl>
      {t.class_name !== "BALL" && (
        <div className="space-y-2 rounded-ctl border border-line/70 p-2" aria-label={dict.body.analysis.identityReview}>
          <p className="text-xs font-normal uppercase tracking-wide text-muted">{dict.body.upload.identity}</p>
          {!identity ? <p className="text-xs text-muted">{dict.common.loading}</p> : (
            <>
              <p data-identity-state={identity.state}>{identity.display.label}
                {identity.player && !identity.player.canonical_otsi_id && <span className="block text-xs text-muted">{dict.body.analysis.provisionalPlayer}</span>}</p>
              {canReview ? (
                <>
                  {correcting && (
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dict.body.analysis.whyChange} aria-label={dict.body.analysis.reasonCorrection}
                      className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm" />
                  )}
                  {/* B.7 (ADR-084): what changing this confirmed identity would put out of date, before anything is saved */}
                  {identity.state === "CONFIRMED" && <ImpactNote trackIds={[t.track_id]} state="UNRESOLVED" playerId={null} />}
                  {/* no browser autofill: its list looks like results, but picking from it only fills the box and confirms nothing (owner, 2026-11-02) */}
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={dict.body.analysis.findPlayerPlaceholder} aria-label={dict.body.analysis.findPlayer} autoComplete="off"
                    className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm" />
                  {!hits && q.trim().length < 2 && <p className="text-[11px] text-muted">{dict.body.analysis.type2Letters}</p>}
                  {hits && (
                    <ul aria-label={dict.body.analysis.matchingPlayers} className="space-y-1">
                      {hits.length === 0 && (
                        <li className="flex items-center justify-between gap-2 text-xs" data-no-player>
                          <span className="text-muted">{dict.body.analysis.noPlayerCalled.replace("{a}", q.trim())}</span>
                          <button type="button" disabled={busy || !reasonOk} onClick={() => createAndConfirm(q)}
                            className="shrink-0 rounded border border-primary/60 px-2 py-0.5 text-primary">{dict.body.analysis.createAndConfirm.replace("{a}", q.trim())}</button>
                        </li>
                      )}
                      {/* one big button per match: the name itself is the confirmation (a small "This is them" beside it was missed) */}
                      {hits.map((p) => (
                        <li key={p.player_id}>
                          <button type="button" data-confirm-player={p.player_id} disabled={busy || !reasonOk} onClick={() => decide("CONFIRMED", p.player_id, dict.body.analysis.confirmedAs.replace("{a}", trackLabel(t.track_number)).replace("{b}", p.display_name))}
                            className="flex w-full items-center justify-between gap-2 rounded-ctl border border-ok/60 bg-ok/15 px-3 py-2 text-left text-sm font-normal hover:bg-ok/25 disabled:opacity-50">
                            <span className="truncate">{dict.body.analysis.confirmAs.replace("{a}", p.display_name)}</span>
                            <span className="shrink-0 text-xs font-normal text-muted">{p.canonical_otsi_id ?? dict.body.analysis.provisionalBadge}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newName.trim().length >= 2) createAndConfirm(); }}>
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={dict.body.analysis.orNewPlayer} aria-label={dict.body.analysis.newPlayerName} minLength={2}
                      className="min-w-0 flex-1 rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm" />
                    <button type="submit" disabled={busy || !reasonOk || newName.trim().length < 2} className="rounded-ctl border border-line px-2 text-xs disabled:opacity-50">{dict.body.analysis.createAndConfirmBtn}</button>
                  </form>
                  {identity.state === "CONFIRMED" && identity.player && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button type="button" disabled={busy || !reasonOk} onClick={() => decide("REJECTED", identity.player!.player_id, dict.body.analysis.markedNot.replace("{a}", trackLabel(t.track_number)).replace("{b}", identity.player!.display_name))}
                        className="rounded border border-line px-2 py-0.5 hover:border-danger/60">{dict.body.analysis.notThisPlayer}</button>
                      <button type="button" disabled={busy || !reasonOk} onClick={() => decide("UNRESOLVED", null, dict.body.analysis.unidentifiedAgain.replace("{a}", trackLabel(t.track_number)))}
                        className="rounded border border-line px-2 py-0.5">{dict.body.analysis.backToUnidentified}</button>
                    </div>
                  )}
                  <p className="text-[11px] text-muted">{dict.body.analysis.decisionsRecorded}</p>
                </>
              ) : <p className="text-xs text-muted">{dict.body.analysis.roleViewIdentities}</p>}
            </>
          )}
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
        </div>
      )}
      {identity?.state === "CONFIRMED" && identity.player && video && (
        <button type="button" disabled={busy} data-create-reel
          onClick={() => {
            setBusy(true); setMsg(null);
            void api<{ id: string }>("/v1/reels", { method: "POST", json: { video_id: video.id, player_id: identity.player!.player_id } })
              .then((r) => router.push(`/reels/${r.id}`), (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.analysis.reelNotCreated }))
              .finally(() => setBusy(false));
          }}
          className="w-full rounded-ctl bg-primary px-3 py-2 text-sm font-normal text-white disabled:opacity-50">
          Create highlight reel for {identity.player.display_name}
        </button>
      )}
      {t.class_name !== "BALL" && <ShirtNumberPanel track={t} canReview={canReview} seek={seek} onChanged={bumpEvidence} />}
      {t.class_name !== "BALL" && (
        <CandidatesPanel track={t} identity={identity} canReview={canReview} refreshKey={evidenceKey}
          onDecided={async () => { await reloadTracks(); setIdentity(await api<TrackIdentity>(`/v1/tracks/${t.track_id}/identity`)); }} />
      )}
      <SamePersonPanel track={t} identity={identity} canReview={canReview} seek={seek} select={select}
        onChanged={async () => { await reloadTracks(); setIdentity(await api<TrackIdentity>(`/v1/tracks/${t.track_id}/identity`)); }} />
      <LookAlikePanel track={t} identity={identity} canReview={canReview} seek={seek} select={select} onChanged={reloadTracks} />
    </div>
  );
}

/* ------------------------------------------------------------------ section 8: transport */
export function Transport() {
  const { t: dict } = useLocale();
  const { videoRef, timeUs, playing, seek, video, intervalUs, playback } = useWs();
  const [rate, setRate] = useState(1);
  const dur = video?.duration_us ?? 0;
  if (!playback?.available) return <p className="text-sm text-muted">{dict.body.analysis.playbackControlsAppear}</p>;
  const el = videoRef.current;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button type="button" aria-label={dict.body.analysis.previousFrame} onClick={() => seek(Math.max(0, Math.round((timeUs - intervalUs) / intervalUs) * intervalUs))} className="rounded-ctl border border-line p-1.5"><SkipBack className="h-4 w-4" /></button>
      <button type="button" aria-label={playing ? dict.body.upload.pause : dict.body.processing.playBtn} onClick={() => (el?.paused ? void el.play() : el?.pause())} className="rounded-ctl bg-primary p-1.5 text-white">
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <button type="button" aria-label={dict.body.analysis.nextFrame} onClick={() => seek(Math.round((timeUs + intervalUs) / intervalUs) * intervalUs)} className="rounded-ctl border border-line p-1.5"><SkipForward className="h-4 w-4" /></button>
      <input type="range" aria-label={dict.body.analysis.seekLabel} min={0} max={Math.max(1, dur)} step={10_000} value={Math.min(timeUs, dur)} onChange={(e) => seek(Number(e.target.value))} className="min-w-[160px] flex-1" />
      <span className="tabular-nums" data-playhead-us={timeUs}>{seconds(timeUs)} / {formatDuration(dur)}</span>
      <select aria-label={dict.body.processing.playbackSpeed} value={rate} onChange={(e) => { const r = Number(e.target.value); setRate(r); if (el) el.playbackRate = r; }} className="rounded-ctl border border-line bg-canvas px-2 py-1 text-xs">
        {[0.25, 0.5, 1, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
      </select>
    </div>
  );
}

/* ------------------------------------------------------------------ section 10: presence of the selected track */
export function PresenceTimeline() {
  const { t: dict } = useLocale();
  const { selectedId, observationsOf, video, timeUs, seek, run, intervalUs } = useWs();
  const [obs, setObs] = useState<Observation[] | null>(null);
  useEffect(() => {
    setObs(null);
    if (selectedId) void observationsOf(selectedId).then(setObs, () => setObs([]));
  }, [selectedId, observationsOf]);
  const dur = Math.max(1, video?.duration_us ?? 1);
  // spans: consecutive observations no further apart than 1.5 sample intervals; gaps are shown as gaps (not observed) — derived from the
  // loaded observations only, not rebuilt on every video frame
  const spans: [number, number][] = useMemo(() => {
    const out: [number, number][] = [];
    for (const o of obs ?? []) {
      const last = out[out.length - 1];
      if (last && o.pts_us - last[1] <= intervalUs * 1.5) last[1] = o.pts_us; else out.push([o.pts_us, o.pts_us]);
    }
    return out;
  }, [obs, intervalUs]);
  if (!run) return <p className="text-sm text-muted">{dict.body.analysis.presenceAppears}</p>;
  if (!selectedId) return <p className="text-sm text-muted">{dict.body.analysis.selectTrackSpans}</p>;
  if (!obs) return <p className="text-sm text-muted">{dict.common.loading}</p>;
  return (
    <div className="space-y-1">
      <div className="relative h-6 w-full cursor-pointer rounded bg-raised/60" aria-label={dict.body.analysis.observedSpans} role="img"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * dur); }}>
        {spans.map(([a, b]) => (
          <span key={a} data-span={`${a}-${b}`} className="absolute top-1 h-4 rounded-sm bg-cyan/70" style={{ left: `${(100 * a) / dur}%`, width: `max(2px, ${(100 * (b - a + intervalUs)) / dur}%)` }} />
        ))}
        <span className="absolute top-0 h-6 w-0.5 bg-primary" style={{ left: `${(100 * timeUs) / dur}%` }} />
      </div>
      <p className="text-xs text-muted">{obs.length === 0
        ? dict.body.analysis.noObsLoaded
        : dict.body.analysis.obsSpans.replace("{a}", String(obs.length)).replace("{b}", String(spans.length))}</p>
    </div>
  );
}
