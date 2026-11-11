"use client";
/**
 * Reel Builder / Spotlight Composer (page 06) for one reel, connected to the real API (ADR-032). The user makes the reel by clicking:
 * add suggested moments, trim and order clips, set the look of the spotlight, render. The engine suggests (moments where the confirmed
 * player is visible) and renders (dense re-analysis of the clip windows, spotlight, MP4 on the Intel GPU, validation). Nothing here is
 * pre-filled: an empty reel stays empty until the user adds a clip.
 */
import { clipOutputUs, slotUs, type CrossMatchCandidate, type CrossMatchSelection, type Playback, type Reel, type ReelHistory, type ReelMoment, type RenderJob, type SpotlightSettings } from "@otsi-vie/contracts";
import { ArrowDown, ArrowUp, CheckCircle2, CircleDashed, Download, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, ApiProblem } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { PlayerProfileIntroPanel } from "./PlayerProfileIntro";

const WRITERS = ["OWNER", "ADMIN", "ANALYST", "EDITOR"];
const sec = (us: number, unit = "{a} s") => unit.replace("{a}", (us / 1e6).toFixed(1));
/** the render state as a word in the current language (API states are codes, never shown raw) */
const renderWord = (state: string | null | undefined, d: Dictionary["body"]["reels"]) =>
  state === "SUCCEEDED" ? d.renderStateSucceeded : state === "FAILED" ? d.renderStateFailed : state === "QUEUED" ? d.renderStateQueued : state === "RUNNING" ? d.renderStateRunning : d.renderStateNotRendered;

interface Ctx {
  reel: Reel | null;
  moments: ReelMoment[] | null;
  /** ADR-131: the best-moments selection (selected + not selected with reasons) for a cross-match reel; null for a single-match reel */
  crossMatch: CrossMatchSelection | null;
  error: string | null;
  canEdit: boolean;
  busy: boolean;
  msg: { ok: boolean; text: string } | null;
  /** `ok`: the message after it worked, or one made from the reloaded reel and moments */
  run(f: () => Promise<Reel | void>, ok?: string | ((r: Reel | null, m: ReelMoment[] | null) => string)): void;
  reload(): Promise<void>;
  selectedClip: string | null;
  setSelectedClip(id: string | null): void;
  /** B.1 (ADR-081): the reel's edit history on the server, shared by Reel Builder and Clip Studio (null while reading) */
  history: ReelHistory | null;
  /** put back the state before the latest change, or before `toEditId` (undoing every change after it too) */
  undo(toEditId?: string): void;
  redo(): void;
}
const ReelCtx = createContext<Ctx | null>(null);
/** Reel data and actions for any presentation layer (ADR-035). */
export type ReelState = Ctx;
export function useReel(): Ctx {
  const c = useContext(ReelCtx);
  if (!c) throw new Error("outside ReelBuilder");
  return c;
}

export function ReelBuilder({ reelId, children }: { reelId: string; children: ReactNode }) {
  const { organization } = useAuth();
  const { t: dict } = useLocale();
  const [reel, setReel] = useState<Reel | null>(null);
  const [moments, setMoments] = useState<ReelMoment[] | null>(null);
  const [crossMatch, setCrossMatch] = useState<CrossMatchSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [history, setHistory] = useState<ReelHistory | null>(null);
  const load = useCallback(async (): Promise<[Reel, ReelMoment[]] | null> => {
    try {
      // the reel first: which moments endpoint to read depends on its source (a cross-match reel's /moments is the selection,
      // not the ranked suggestions — reading it as ReelMoment[] would show the selection as nothing at all)
      const [r, h] = await Promise.all([api<Reel>(`/v1/reels/${reelId}`),
        api<ReelHistory>(`/v1/reels/${reelId}/history`).catch(() => null)]);
      setReel(r); setHistory(h);
      if (r.source === "ALL_MATCHES") {
        const sel = await api<CrossMatchSelection>(`/v1/reels/${reelId}/moments`);
        setCrossMatch(sel); setMoments(null); setError(null);
        return [r, []];
      }
      const m = await api<ReelMoment[]>(`/v1/reels/${reelId}/moments`);
      setMoments(m); setCrossMatch(null); setError(null);
      return [r, m];
    } catch (x) {
      setError(x instanceof ApiProblem ? x.message : dict.body.reels.loadFailed);
      return null;
    }
  }, [reelId, dict]);
  const reload = useCallback(async () => { await load(); }, [load]);
  useEffect(() => { void reload(); }, [reload]);
  const rendering = reel?.latest_render && ["QUEUED", "RUNNING"].includes(reel.latest_render.state);
  useEffect(() => {                                    // follow a render until it settles
    if (!rendering) return;
    const t = setInterval(() => void reload(), 2000);
    return () => clearInterval(t);
  }, [rendering, reload]);
  const run: Ctx["run"] = useCallback((f, ok) => {
    setBusy(true); setMsg(null);
    void f().then(async (r) => { if (r) setReel(r); const got = await load(); if (ok) setMsg({ ok: true, text: typeof ok === "string" ? ok : ok(got?.[0] ?? null, got?.[1] ?? null) }); },
      (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.analysis.thatDidNotWork })).finally(() => setBusy(false));
  }, [load, dict]);
  const undo = useCallback((toEditId?: string) => {
    const what = toEditId ? history?.entries.find((e) => e.id === toEditId)?.label : history?.undo_label;
    run(() => api<Reel>(`/v1/reels/${reelId}/history/undo`, { method: "POST", json: toEditId ? { to_edit_id: toEditId } : {} }),
      toEditId ? dict.body.reels.undoMsgBefore.replace("{a}", what ?? dict.body.reels.undoFallbackThat) : dict.body.reels.undoMsg.replace("{a}", what ?? dict.body.reels.undoFallbackLast));
  }, [history, reelId, run]);
  const redo = useCallback(() => {
    const what = history?.redo_label;
    run(() => api<Reel>(`/v1/reels/${reelId}/history/redo`, { method: "POST" }), dict.body.reels.redoMsg.replace("{a}", what ?? dict.body.reels.redoFallback));
  }, [history, reelId, run]);
  // the value is memoised so a state change that does not touch it (a message clearing, a selection) does not re-render every
  // consumer — the provider also feeds Clip Studio, and its sections re-render on every context change
  const value: Ctx = useMemo(() => ({
    reel, moments, crossMatch, error, canEdit: !!organization && WRITERS.includes(organization.role), busy, msg, reload, selectedClip, setSelectedClip, run, history,
    undo, redo,
  }), [reel, moments, crossMatch, error, organization, busy, msg, reload, selectedClip, run, history, undo, redo]);
  return <ReelCtx.Provider value={value}>{children}</ReelCtx.Provider>;
}

/* ------------------------------------------------------------------ section 1: the four steps */
export function ReelSteps() {
  const { reel, error } = useReel();
  const { t: dict } = useLocale();
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!reel) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> {dict.body.reels.loadingReel}</p>;
  const r = reel.latest_render;
  const steps: [string, string, boolean, string][] = [
    ["Profile Intro", dict.body.reels.stepProfileIntro, reel.settings.profile_intro && !!reel.player, reel.settings.profile_intro ? (reel.player ? dict.body.reels.stepIntroOpens.replace("{a}", reel.player.display_name) : dict.body.reels.stepIntroNoPlayer) : dict.body.reels.stepIntroOff],
    ["Player", dict.body.reels.stepPlayer, !!reel.player && !reel.stale, reel.player ? `${reel.player.display_name}${reel.stale ? dict.body.reels.stepPlayerStaleSuffix : ""}` : dict.body.reels.stepPlayerNone],
    ["Clips", dict.body.reels.stepClips, reel.clips.length > 0, reel.clips.length ? (reel.clips.length === 1 ? dict.body.reels.stepClipsOne : dict.body.reels.stepClipsMany).replace("{a}", String(reel.clips.length)).replace("{b}", sec(reel.duration_us, dict.body.reelstage.durationSec)) : dict.body.reels.stepClipsAdd],
    ["Spotlight", dict.body.reels.stepSpotlight, true, `${dict.body.reels.stepSpotlightBase.replace("{a}", String(Math.round(reel.settings.dim * 100)))}${reel.settings.ring ? dict.body.reels.stepSpotlightRing : ""}${reel.settings.name_caption ? dict.body.reels.stepSpotlightName : ""}`],
    ["Render", dict.body.reels.stepRender, r?.state === "SUCCEEDED", r ? renderWord(r.state, dict.body.reels) : dict.body.reels.stepRenderNotYet],
  ];
  return (
    <div className="space-y-2">
      <p className="text-sm"><span className="font-semibold" data-reel-name>{reel.name}</span> <span className="text-muted">· {reel.video_id
        ? <Link className="text-primary underline" href={`/videos/${reel.video_id}/analyze`}>{dict.body.reels.sourceVideoLink}</Link>
        : dict.body.reels.sourceAllMatches}</span></p>
      <ol aria-label={dict.body.reelstage.stepsAria} className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-5 min-[1100px]:grid-cols-1">
        {steps.map(([key, n, done, note], i) => (
          <li key={key} data-reel-step={key} data-done={done ? "1" : "0"}
            className={`flex min-w-0 items-start gap-2 rounded-ctl border px-2.5 py-2 text-sm ${done ? "border-ok/40 bg-ok/5" : "border-line/70 bg-raised/40"}`}>
            {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
            <span className="min-w-0">
              <span className="block font-medium leading-tight">{i + 1}. {n}</span>
              <span className="mt-0.5 block break-words text-xs leading-snug text-muted">{note}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ section 1b: the Player Profile Intro (ADR-130) */
/** The first step of the Reel Builder flow: the intro preview for the reel's player, "Continue to Reel" advancing to the reel steps.
 *  Nothing when there is no player, or when the intro is off for this reel (Overlays). */
export function ReelProfileIntro({ onContinue }: { onContinue?: () => void }) {
  const { reel } = useReel();
  if (!reel || !reel.player) return null;
  if (!reel.settings.profile_intro) return null;
  return <PlayerProfileIntroPanel playerId={reel.player.player_id} reelId={reel.id} onContinue={onContinue} />;
}

/* ------------------------------------------------------------------ section 2: aspect presets */
export function AspectPresets() {
  const { reel, canEdit, run, busy } = useReel();
  const { t: dict } = useLocale();
  if (!reel) return null;
  return (
    <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={dict.body.reels.aspectRatio}>
      {(["16:9", "9:16", "1:1", "4:5"] as const).map((a) => (
        <button key={a} type="button" role="radio" aria-checked={reel.aspect === a} disabled={!canEdit || busy}
          onClick={() => run(() => api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, aspect: a } }))}
          className={`min-w-0 rounded-ctl border px-1.5 py-2 text-center text-sm font-medium ${reel.aspect === a ? "border-primary bg-primary/10 text-primary" : "border-line hover:border-primary/50"}`}>
          {a} <span className="mt-0.5 block text-[10px] font-normal leading-tight text-muted">{a === "16:9" ? dict.body.reels.aspectBroadcast : a === "9:16" ? dict.body.reels.aspectStories : a === "4:5" ? dict.body.reels.aspectFeed : dict.body.reels.aspectSquare}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ section 3: name; music */
export function ReelMetadata() {
  const { reel, canEdit, run, busy } = useReel();
  const { t: dict } = useLocale();
  const [name, setName] = useState("");
  useEffect(() => { if (reel) setName(reel.name); }, [reel?.name]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!reel) return null;
  return (
    <div className="space-y-2 text-sm">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, name } }), dict.body.reels.nameSaved); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label={dict.body.reels.reelNameAria} disabled={!canEdit} className="min-w-0 flex-1 rounded-ctl border border-line bg-canvas px-2 py-1.5" />
        <button type="submit" disabled={!canEdit || busy || name.trim() === reel.name} className="rounded-ctl border border-line px-3 disabled:opacity-50">{dict.common.save}</button>
      </form>
      {reel.aspect !== "16:9" && <p className="text-xs text-muted">{dict.body.reels.aspectFollows.replace("{a}", reel.aspect)}</p>}
      <p className="text-xs text-muted">{dict.body.reels.musicNote}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ section 4: preview */
export function ReelPreview() {
  const { reel, selectedClip } = useReel();
  const { t: dict } = useLocale();
  const [src, setSrc] = useState<{ url: string; kind: "render" | "source" } | null>(null);
  const ref = useRef<HTMLVideoElement | null>(null);
  const clip = reel?.clips.find((c) => c.id === selectedClip) ?? reel?.clips[0] ?? null;
  // ADR-131: the clip's own video — a cross-match clip's source_video_id, else the reel's single video; null when there is no clip
  const clipVideoId = clip?.source_video_id ?? reel?.video_id ?? null;
  const renderId = reel?.last_good_render?.has_output ? reel.last_good_render.id : null;
  useEffect(() => {
    if (!reel) return;
    if (renderId && !selectedClip) {
      void api<{ url: string }>(`/v1/renders/${renderId}/playback`).then((p) => setSrc({ url: p.url, kind: "render" }), () => setSrc(null));
    } else if (clipVideoId) {
      void api<Playback>(`/v1/videos/${clipVideoId}/playback`).then((p) => setSrc(p.url ? { url: p.url, kind: "source" } : null), () => setSrc(null));
    } else {
      setSrc(null);
    }
  }, [reel?.id, renderId, selectedClip, clipVideoId]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = ref.current;
    if (v && src?.kind === "source" && clip) { const go = () => { v.currentTime = clip.in_pts_us / 1e6; }; if (v.readyState >= 1) go(); else v.addEventListener("loadedmetadata", go, { once: true }); }
  }, [src, clip?.id, clip?.in_pts_us]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!reel) return <div className="aspect-video animate-pulse rounded-ctl bg-raised/50" />;
  if (!src) return <p className="text-sm text-muted">{dict.body.reels.previewNoPreview}</p>;
  const portrait = src.kind === "render" && (reel.aspect === "9:16" || reel.aspect === "4:5");
  return (
    <div className="space-y-1.5">
      <video ref={ref} key={src.url} src={src.url} controls playsInline
        className={`mx-auto block max-h-[min(52vh,480px)] rounded-ctl bg-black object-contain ${portrait ? "w-auto max-w-full" : "w-full"}`} aria-label={src.kind === "render" ? dict.body.reels.previewRenderedAria : dict.body.reels.previewSourceAria} data-preview={src.kind} />
      <p className="text-xs text-muted">{src.kind === "render" ? dict.body.reels.previewRenderedNote : clip ? dict.body.reels.previewSourceNote.replace("{a}", sec(clip.in_pts_us, dict.body.reelstage.durationSec)) : dict.body.reels.previewSourceNoteStart}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ section 5: targeting */
export function ReelTargets() {
  const { reel, canEdit, run, busy } = useReel();
  const { t: dict } = useLocale();
  if (!reel) return null;
  return (
    <div className="space-y-2 text-sm">
      {reel.player ? (
        <p data-reel-player><span className="font-semibold">{reel.player.display_name}</span>{" "}
          <span className="text-muted">· {reel.player.canonical_otsi_id ?? dict.body.reels.targetProvisional}</span></p>
      ) : <p className="text-muted">{dict.body.reels.targetNoPlayer}</p>}
      <p className="text-xs text-muted">{dict.body.reels.targetSpotlightFollows}</p>
      <ul className="space-y-0.5 text-xs" aria-label={dict.body.reels.followedTracksAria}>
        {reel.targets.map((t) => (
          <li key={t.track_id} className={t.decision_current ? "" : "text-danger"}>{dict.body.reelstage.trackWord.replace("{a}", String(t.track_number))} · {sec(t.first_pts_us, dict.body.reelstage.durationSec)}–{sec(t.last_pts_us, dict.body.reelstage.durationSec)}{t.decision_current ? "" : dict.body.reels.identityChangedSuffix}</li>
        ))}
      </ul>
      {reel.stale && (
        <div role="alert" className="rounded-ctl border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
          {dict.body.reels.staleAlert}
          {canEdit && <button type="button" disabled={busy} onClick={() => run(() => api<Reel>(`/v1/reels/${reel.id}/refresh-targets`, { method: "POST" }), dict.body.reels.followedRefreshed)}
            className="ml-2 inline-flex items-center gap-1 rounded border border-danger/50 px-2 py-0.5"><RefreshCw className="h-3 w-3" />{dict.body.studio.refreshLabel}</button>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ section 6: spotlight settings */
export function SpotlightControls() {
  const { reel, canEdit, run, busy } = useReel();
  const { t: dict } = useLocale();
  const [s, setS] = useState<SpotlightSettings | null>(null);
  useEffect(() => { if (reel) setS(reel.settings); }, [reel?.version]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!reel || !s) return null;
  const changed = JSON.stringify(s) !== JSON.stringify(reel.settings);
  const slider = (k: "dim" | "size" | "feather", label: string, min: number, max: number, step: number) => (
    <label className="block text-xs">{label} <span className="tabular-nums text-muted">{s[k].toFixed(2)}</span>
      <input type="range" min={min} max={max} step={step} value={s[k]} disabled={!canEdit} aria-label={label} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} className="w-full" />
    </label>
  );
  return (
    <div className="space-y-2 text-sm">
      {slider("dim", dict.body.reels.sliderDim, 0, 0.9, 0.05)}
      {slider("size", dict.body.reels.sliderSize, 0.8, 3, 0.1)}
      {slider("feather", dict.body.reels.sliderFeather, 0.05, 1.5, 0.05)}
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={s.ring} disabled={!canEdit} onChange={(e) => setS({ ...s, ring: e.target.checked })} /> {dict.body.reels.ringAtFeet}
        <input type="color" value={s.ring_color} disabled={!canEdit || !s.ring} aria-label={dict.body.reels.ringColourAria} onChange={(e) => setS({ ...s, ring_color: e.target.value.toUpperCase() })} className="h-5 w-8" /></label>
      <button type="button" disabled={!canEdit || busy || !changed} onClick={() => run(() => api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, settings: s } }), dict.body.reels.spotlightSaved)}
        className="rounded-ctl border border-line px-3 py-1 text-xs disabled:opacity-50">{dict.body.reels.saveSpotlight}</button>
    </div>
  );
}

/* ------------------------------------------------------------------ section 7: overlays */
export function ReelOverlays() {
  const { reel, canEdit, run, busy } = useReel();
  const { t: dict } = useLocale();
  if (!reel) return null;
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={reel.settings.name_caption} disabled={!canEdit || busy}
        onChange={(e) => run(() => api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, settings: { name_caption: e.target.checked } } }))} />
        {dict.body.reels.nameCaption}{reel.player?.canonical_otsi_id ? dict.body.reels.nameCaptionWithId : ""}</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={reel.settings.profile_intro} disabled={!canEdit || busy}
        onChange={(e) => run(() => api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, settings: { profile_intro: e.target.checked } } }))} />
        {dict.body.reels.profileIntroLabel}</label>
      <p className="text-xs text-muted">{dict.body.reels.profileIntroNote}</p>
      <p className="text-xs text-muted">{dict.body.reels.brandingNote}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ section 8: suggested moments */
export function MomentCarousel() {
  const { reel, moments, canEdit, run, busy } = useReel();
  const { t: dict } = useLocale();
  // ADR-131: a cross-match reel's moments are the best-moments selection (selected + not selected with reasons), not the
  // single-match suggestions — the carousel below shows that selection instead
  if (reel?.source === "ALL_MATCHES") return <CrossMatchMomentCarousel />;
  if (!reel || !moments) return <p className="text-sm text-muted">{dict.body.reels.momentsLoading}</p>;
  if (moments.length === 0) return <p className="text-sm text-muted">{dict.body.reels.momentsNone}</p>;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted">{dict.body.reels.momentsIntro.replace("{a}", reel.player?.display_name ?? dict.body.reels.momentsIntroPlayer)}</p>
      <ul aria-label={dict.body.studio.suggestedMoments} className="flex gap-2 overflow-x-auto pb-1">
        {moments.map((m) => (
          <li key={m.in_pts_us} data-moment={m.in_pts_us} className="flex w-48 shrink-0 flex-col rounded-ctl border border-line/70 bg-raised/40 p-2 text-xs">
            <p className="font-medium">{sec(m.in_pts_us, dict.body.reelstage.durationSec)} – {sec(m.out_pts_us, dict.body.reelstage.durationSec)}</p>
            <p className="mb-1.5 text-muted">{m.label} · {dict.body.reelstage.trackWord.replace("{a}", m.track_numbers.join(", "))}</p>
            <button type="button" disabled={!canEdit || busy || m.in_reel}
              onClick={() => run(() => api<Reel>(`/v1/reels/${reel.id}/clips`, { method: "POST", json: { in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us, origin: "SUGGESTED", label: m.label } }), dict.body.reels.clipAdded)}
              className="mt-auto inline-flex w-fit items-center gap-1 rounded border border-line px-2 py-0.5 pt-0.5 hover:border-primary/60 disabled:opacity-50">
              {m.in_reel ? dict.body.studio.inReelBadge : <><Plus className="h-3 w-3" />{dict.body.reels.addToReel}</>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ section 8b: the cross-match selection (ADR-131) */
/** Media time as m:ss, for a moment whose match minute is not known (halves not CONFIRMED — never invented). */
const crossMmss = (us: number) => `${Math.floor(us / 6e7)}:${String(Math.floor(us / 1e6) % 60).padStart(2, "0")}`;
/** "Dynamo vs Ercakhu", or the video title when the teams are not known. */
const crossMatchOf = (m: CrossMatchCandidate) => [m.home, m.away].filter(Boolean).join(" vs ") || m.video_title;
const crossWhenOf = (m: CrossMatchCandidate) => (m.match_minute !== null ? `${m.match_minute}'` : crossMmss(m.key_at_us));
const TIER_COLOUR: Record<string, string> = { S: "#a066ff", A: "#19d3ff", B: "#19e6c0", C: "#ffb21a" };

/** The best-moments selection for a cross-match reel: the selected moments (tier badge, match, minute, reason — a chain shows its
 *  sequence label), each pinnable or removable by hand, and the moments left out with their reason, each swappable in by hand (pin =
 *  addClip, which the API guards for eligibility and the per-match cap; remove = clip delete; reject / restore per video).
 *  Nothing here invents a moment: fewer than 3 eligible moments builds with what's there, no filler. */
export function CrossMatchMomentCarousel() {
  const { reel, crossMatch, canEdit, run, busy } = useReel();
  const { t: dict } = useLocale();
  if (!reel || reel.source !== "ALL_MATCHES") return null;
  if (!crossMatch) return <p className="text-sm text-muted">{dict.body.reels.crossLoading}</p>;
  const lenLabel = crossMatch.length_s === 90 ? dict.body.reels.len90s : crossMatch.length_s === 300 ? dict.body.reels.len5min : dict.body.reels.len3min;
  const clipOf = (m: CrossMatchCandidate) => reel.clips.find((c) => c.source_video_id === m.video_id && c.in_pts_us < m.out_pts_us && c.out_pts_us > m.in_pts_us) ?? null;
  const add = (m: CrossMatchCandidate, label: string) => run(() => api<Reel>(`/v1/reels/${reel.id}/clips`, { method: "POST",
    json: { in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us, origin: "SUGGESTED", label, source_video_id: m.video_id } }), dict.body.reels.clipAdded);
  const remove = (m: CrossMatchCandidate) => { const c = clipOf(m); if (c) run(() => api<Reel>(`/v1/reels/${reel.id}/clips/${c.id}`, { method: "DELETE" }), dict.body.reels.crossClipRemoved); };
  const reject = (m: CrossMatchCandidate) => run(async () => { await api(`/v1/reels/${reel.id}/moments/reject`, { method: "POST",
    json: { in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us, video_id: m.video_id } }); }, dict.body.reels.crossLeftOutMsg);
  const restore = (m: CrossMatchCandidate) => run(async () => { await api(`/v1/reels/${reel.id}/moments/restore`, { method: "POST",
    json: { in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us, video_id: m.video_id } }); }, dict.body.reels.crossSuggestionRestored);
  const left = crossMatch.selected.filter((m) => !m.in_reel).length;
  const detail = (m: CrossMatchCandidate, reason: string) => `${crossMatchOf(m)}${m.competition ? ` · ${m.competition}` : ""} · ${crossWhenOf(m)} · ${reason}`;
  // `inReel` is passed in: a selected moment carries it, a left-out one is in the reel only if a clip of it was pinned by hand
  const item = (m: CrossMatchCandidate, tier: string | null, reason: string, key: string, notSelectedReason: string | null, inReel: boolean) => (
    <li key={key} data-cross-moment={m.in_pts_us} data-tier={tier ?? ""} data-not-selected={notSelectedReason ?? undefined}
      className="flex w-64 shrink-0 flex-col rounded-ctl border border-line/70 bg-raised/40 p-2 text-xs">
      <p className="flex items-center gap-1.5 font-medium">
        {tier && <span style={{ color: TIER_COLOUR[tier] ?? "#cfe0f5" }}>{dict.body.reels.crossTier.replace("{a}", tier)}</span>}
        {notSelectedReason && <span className="text-muted">{dict.body.reels.crossLeftOut.replace("{a}", notSelectedReason)}</span>}
      </p>
      <p className="font-medium">{m.label}</p>
      <p className="mb-1.5 text-muted">{detail(m, reason)}</p>
      <span className="mt-auto flex flex-wrap gap-1">
        {notSelectedReason === "rejected for this reel"
          ? <button type="button" disabled={!canEdit || busy} onClick={() => restore(m)}
            className="inline-flex w-fit items-center gap-1 rounded border border-line px-2 py-0.5 hover:border-primary/60 disabled:opacity-50">{dict.body.reels.crossRestore}</button>
          : inReel ? <>
            <span className="inline-flex items-center gap-1 rounded border border-ok/40 px-2 py-0.5 text-ok">{dict.body.studio.inReelBadge}</span>
            <button type="button" disabled={!canEdit || busy} onClick={() => remove(m)}
              className="inline-flex w-fit items-center gap-1 rounded border border-line px-2 py-0.5 hover:border-danger/60 disabled:opacity-50"><Trash2 className="h-3 w-3" />{dict.body.reels.removeClip}</button>
          </> : <>
            <button type="button" disabled={!canEdit || busy} onClick={() => add(m, m.label)}
              className="inline-flex w-fit items-center gap-1 rounded border border-line px-2 py-0.5 hover:border-primary/60 disabled:opacity-50"><Plus className="h-3 w-3" />{dict.body.reels.addToReel}</button>
            <button type="button" disabled={!canEdit || busy} onClick={() => reject(m)}
              className="inline-flex w-fit items-center gap-1 rounded border border-line px-2 py-0.5 hover:border-primary/60 disabled:opacity-50">{dict.body.reels.crossNotThisOne}</button>
          </>}
      </span>
    </li>
  );
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted" data-cross-match-summary>
        {dict.body.reels.crossSummary.replace("{a}", lenLabel).replace("{b}", String(crossMatch.rule_version)).replace("{c}", String(crossMatch.selected.length)).replace("{d}", crossMatch.not_selected.length ? dict.body.reels.crossSummaryLeftOut.replace("{a}", String(crossMatch.not_selected.length)) : "").replace("{e}", String(crossMatch.total_s))}
      </p>
      {crossMatch.selected.length === 0 && crossMatch.not_selected.length === 0 && (
        <p className="text-sm text-muted">{dict.body.reels.crossNoMoments}</p>
      )}
      {left > 0 && (
        <button type="button" disabled={!canEdit || busy} data-add-all-cross
          onClick={() => run(() => api<Reel>(`/v1/reels/${reel.id}/clips/add-moments`, { method: "POST" }), dict.body.reels.crossMomentsAdded)}
          className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs hover:border-primary/60 disabled:opacity-50">
          <Plus className="h-3 w-3" />{dict.body.reels.crossAddAll.replace("{a}", String(left))}
        </button>
      )}
      {crossMatch.selected.length > 0 && (
        <ul aria-label={dict.body.reels.crossSelectedAria} className="flex gap-2 overflow-x-auto pb-1">
          {crossMatch.selected.map((m) => item(m, m.tier, m.reason, `${m.video_id}:${m.in_pts_us}`, null, m.in_reel))}
        </ul>
      )}
      {crossMatch.not_selected.length > 0 && (
        <>
          <p className="pt-1 text-xs font-medium text-muted">{dict.body.reels.crossLeftOutHeading}</p>
          <ul aria-label={dict.body.reels.crossLeftOutAria} className="flex gap-2 overflow-x-auto pb-1">
            {crossMatch.not_selected.map(({ candidate: m, reason }) => item(m, null, m.sequence_label ?? m.label, `${m.video_id}:${m.in_pts_us}:out`, reason, clipOf(m) !== null))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ section 8c: which matches does this reel cover (ADR-131) */
/** "This match" (the reel as it is) vs "All matches" (a NEW cross-match reel for the same player — the original reel is untouched),
 *  with the length picker (90 s / 3 min / 5 min, default 3 min, fixed options only). For a cross-match reel this is a read-only
 *  summary: the length and the rule version were fixed when the reel was made. Nothing here changes the reel being looked at. */
export function ReelSourceChoice({ compact }: { compact?: boolean } = {}) {
  const { reel, canEdit, busy } = useReel();
  const { t: dict } = useLocale();
  const router = useRouter();
  const [mode, setMode] = useState<"MATCH" | "ALL_MATCHES">("MATCH");
  const [lengthS, setLengthS] = useState<90 | 180 | 300>(180);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!reel) return null;
  if (reel.source === "ALL_MATCHES") {
    const len = reel.cross_match_length_s === 90 ? dict.body.reels.len90s : reel.cross_match_length_s === 300 ? dict.body.reels.len5min : dict.body.reels.len3min;
    return <p className="text-sm" data-reel-source="ALL_MATCHES">{dict.body.reels.crossSourceSummary.replace("{a}", len).replace("{b}", reel.best_moments_rule_version ?? "2.1")}</p>;
  }
  if (!reel.player) return null;
  const player = reel.player;
  const create = async () => {
    setCreating(true); setErr(null);
    try {
      const created = await api<{ id: string }>("/v1/reels", { method: "POST",
        json: { source: "ALL_MATCHES", length_s: lengthS, player_id: player.player_id } });
      router.push(`/reels/${created.id}`);
    } catch (x) { setErr(x instanceof ApiProblem ? x.message : dict.body.analysis.thatDidNotWork); } finally { setCreating(false); }
  };
  // compact: one row for a fixed-pixel panel — a select (this match, or all matches at a fixed length) + Create. The read-only
  // summary for a cross-match reel is the same as the stacked version's (returned above).
  if (compact) {
    const chosen = mode === "ALL_MATCHES" ? String(lengthS) : "MATCH";
    return (
      <div className="flex items-center gap-2" data-reel-source="MATCH">
        <select aria-label={dict.body.reels.sourceWhichAria} value={chosen} disabled={busy || creating}
          onChange={(e) => { const v = e.target.value; if (v === "MATCH") setMode("MATCH"); else { setMode("ALL_MATCHES"); setLengthS(Number(v) as 90 | 180 | 300); } }}
          className="min-w-0 flex-1 rounded-ctl border border-line bg-raised/40 px-2 py-1.5 text-sm text-white">
          <option value="MATCH">{dict.body.reels.sourceThisMatch}</option>
          <option value="90">{dict.body.reels.sourceAll90}</option>
          <option value="180">{dict.body.reels.sourceAll180}</option>
          <option value="300">{dict.body.reels.sourceAll300}</option>
        </select>
        <button type="button" disabled={mode !== "ALL_MATCHES" || !canEdit || busy || creating} onClick={() => void create()}
          className="shrink-0 rounded-ctl bg-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{dict.body.reels.createBtn}</button>
        {err && <p role="alert" className="text-xs text-danger">{err}</p>}
      </div>
    );
  }
  const radio = (m: "MATCH" | "ALL_MATCHES", label: string) => (
    <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={busy || creating} onClick={() => setMode(m)}
      className={`rounded-ctl border px-2.5 py-1.5 text-sm font-medium ${mode === m ? "border-primary bg-primary/10 text-primary" : "border-line hover:border-primary/50"}`}>
      {label}
    </button>
  );
  return (
    <div className="space-y-2 text-sm" data-reel-source="MATCH">
      <p className="font-medium">{dict.body.reels.sourceWhich}</p>
      <div role="radiogroup" aria-label={dict.body.reels.sourceWhichAria} className="flex gap-1.5">
        {radio("MATCH", dict.body.reels.sourceThisMatch)}{radio("ALL_MATCHES", dict.body.reels.sourceAllMatches)}
      </div>
      {mode === "ALL_MATCHES" && (
        <>
          <div role="radiogroup" aria-label={dict.body.reels.sourceLengthAria} className="flex gap-1.5">
            {([90, 180, 300] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={lengthS === s} disabled={busy || creating} onClick={() => setLengthS(s)}
                className={`rounded-ctl border px-2.5 py-1.5 text-sm font-medium ${lengthS === s ? "border-primary bg-primary/10 text-primary" : "border-line hover:border-primary/50"}`}>
                {s === 90 ? dict.body.reels.len90s : s === 180 ? dict.body.reels.len3min : dict.body.reels.len5min}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">{dict.body.reels.sourceOneReel.replace("{a}", player.display_name).replace("{b}", lengthS === 90 ? dict.body.reels.sourceUpTo90 : lengthS === 180 ? dict.body.reels.sourceUpTo180 : dict.body.reels.sourceUpTo300)}</p>
          <button type="button" disabled={!canEdit || busy || creating} onClick={() => void create()}
            className="inline-flex items-center gap-1 rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white disabled:opacity-50">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{dict.body.reels.sourceCreate}
          </button>
          {err && <p role="alert" className="text-xs text-danger">{err}</p>}
        </>
      )}
      {mode === "MATCH" && <p className="text-xs text-muted">{dict.body.reels.sourceThisMatchNote}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ section 9: clips timeline */
export function ClipTimeline() {
  const { reel, canEdit, run, busy, selectedClip, setSelectedClip } = useReel();
  const { t: dict } = useLocale();
  const [edit, setEdit] = useState<Record<string, { a: string; b: string }>>({});
  if (!reel) return null;
  if (reel.clips.length === 0) return <p className="text-sm text-muted">{dict.body.reels.clipsEmpty}</p>;
  const move = (i: number, d: number) => {
    const ids = reel.clips.map((c) => c.id);
    [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
    run(() => api<Reel>(`/v1/reels/${reel.id}/clips/order`, { method: "POST", json: { clip_ids: ids } }));
  };
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded bg-raised/60" aria-hidden>
        {reel.clips.map((c, i) => <span key={c.id} className={i % 2 ? "bg-cyan/60" : "bg-primary/70"} style={{ width: `${(100 * slotUs(c)) / Math.max(1, reel.duration_us)}%` }} />)}
      </div>
      <ol aria-label={dict.body.reels.stepClips} className="space-y-1 text-xs">
        {reel.clips.map((c, i) => {
          const e = edit[c.id] ?? { a: (c.in_pts_us / 1e6).toFixed(1), b: (c.out_pts_us / 1e6).toFixed(1) };
          return (
            <li key={c.id} data-clip={i} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-ctl border px-2 py-1.5 ${selectedClip === c.id ? "border-primary bg-primary/5" : "border-line/60"}`}>
              <button type="button" onClick={() => setSelectedClip(selectedClip === c.id ? null : c.id)} className="w-16 text-left font-medium underline-offset-2 hover:underline">{i + 1}. {sec(clipOutputUs(c), dict.body.reelstage.durationSec)}</button>
              <label className="flex items-center gap-1">{dict.body.reels.clipInLabel} <input value={e.a} disabled={!canEdit} aria-label={dict.body.reels.clipInAria.replace("{a}", String(i + 1))} onChange={(x) => setEdit({ ...edit, [c.id]: { ...e, a: x.target.value } })} className="w-14 rounded border border-line bg-canvas px-1" /></label>
              <label className="flex items-center gap-1">{dict.body.reels.clipOutLabel} <input value={e.b} disabled={!canEdit} aria-label={dict.body.reels.clipOutAria.replace("{a}", String(i + 1))} onChange={(x) => setEdit({ ...edit, [c.id]: { ...e, b: x.target.value } })} className="w-14 rounded border border-line bg-canvas px-1" /></label>
              {canEdit && (
                <span className="ml-auto flex items-center gap-1">
                  <button type="button" disabled={busy || !edit[c.id]} onClick={() => run(() => api<Reel>(`/v1/reels/${reel.id}/clips/${c.id}`, { method: "PATCH", json: { in_pts_us: Math.round(Number(e.a) * 1e6), out_pts_us: Math.round(Number(e.b) * 1e6) } }), dict.body.reels.clipTrimmed)}
                    className="rounded border border-line px-1.5 disabled:opacity-50">{dict.body.reels.clipTrim}</button>
                  <button type="button" aria-label={dict.body.reels.moveUp} disabled={busy || i === 0} onClick={() => move(i, -1)} className="rounded border border-line p-0.5 disabled:opacity-40"><ArrowUp className="h-3 w-3" /></button>
                  <button type="button" aria-label={dict.body.reels.moveDown} disabled={busy || i === reel.clips.length - 1} onClick={() => move(i, 1)} className="rounded border border-line p-0.5 disabled:opacity-40"><ArrowDown className="h-3 w-3" /></button>
                  <button type="button" aria-label={dict.body.reels.removeClip} disabled={busy} onClick={() => run(() => api<Reel>(`/v1/reels/${reel.id}/clips/${c.id}`, { method: "DELETE" }))} className="rounded border border-line p-0.5 hover:border-danger/60"><Trash2 className="h-3 w-3" /></button>
                </span>
              )}
              {c.origin === "SUGGESTED" && <span className="text-muted">{dict.body.reels.clipSuggested}</span>}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted">{dict.body.reels.clipsTotal.replace("{a}", sec(reel.duration_us, dict.body.reelstage.durationSec))}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ section 10: render */
export function RenderPanel() {
  const { reel, canEdit, run, busy, msg } = useReel();
  const { t: dict } = useLocale();
  const [codec, setCodec] = useState<"h264" | "av1" | "vp9">("h264");
  const [links, setLinks] = useState<{ url: string; download_url: string; notice: string } | null>(null);
  const r: RenderJob | null = reel?.latest_render ?? null;
  useEffect(() => {
    setLinks(null);
    if (r?.state === "SUCCEEDED") void api<{ url: string; download_url: string; notice: string }>(`/v1/renders/${r.id}/playback`).then(setLinks, () => setLinks(null));
  }, [r?.id, r?.state]);
  if (!reel) return null;
  const res = r?.result as { frames?: number; duration_s?: number; width?: number; height?: number; encoder?: string; seconds?: number;
    spotlight_frames?: { DETECTED: number; INTERPOLATED: number; MISSING: number } } | null;
  const active = r && ["QUEUED", "RUNNING"].includes(r.state);
  return (
    <div className="space-y-2 text-sm" data-render-state={r?.state ?? "NONE"}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-muted">{dict.body.reels.codecLabel}
          <select value={codec} onChange={(e) => setCodec(e.target.value as typeof codec)} aria-label={dict.body.reels.codecLabel} className="rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm text-ink">
            <option value="h264">{dict.body.reels.codecH264}</option><option value="av1">{dict.body.reels.codecAv1}</option><option value="vp9">{dict.body.reels.codecVp9}</option>
          </select></label>
        <button type="button" disabled={!canEdit || busy || !!active || reel.clips.length === 0 || reel.stale}
          onClick={() => run(async () => { await api(`/v1/reels/${reel.id}/renders`, { method: "POST", json: { codec, bitrate_mbps: 8 }, headers: { "idempotency-key": `render-${reel.id}-${reel.version}-${codec}-${Date.now()}` } }); }, dict.body.reels.renderStarted)}
          className="inline-flex items-center gap-2 rounded-ctl bg-primary px-3 py-2 font-semibold text-white disabled:opacity-50">
          {active ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{dict.body.reels.renderReelBtn}
        </button>
      </div>
      {active && <p role="status" className="flex items-center gap-2 text-xs"><Loader2 className="h-3.5 w-3.5 animate-spin text-cyan" />{r.stage_message ?? dict.body.reels.renderWaiting} {r.progress !== null ? `(${Math.round(r.progress)} %)` : ""}</p>}
      {r?.state === "FAILED" && <p role="alert" className="rounded-ctl border border-danger/40 bg-danger/10 p-2 text-xs text-danger"><span className="font-semibold">{r.failure_code}</span>: {r.failure_detail}</p>}
      {r?.state === "SUCCEEDED" && res && (
        <div className="space-y-1 text-xs" data-render-result>
          <p>{dict.body.reels.renderResultLine.replace("{a}", String(res.width)).replace("{b}", String(res.height)).replace("{c}", dict.body.reelstage.durationSec.replace("{a}", String(res.duration_s))).replace("{d}", String(res.frames)).replace("{e}", res.encoder ?? "").replace("{f}", dict.body.reelstage.durationSec.replace("{a}", String(res.seconds)))}</p>
          {res.spotlight_frames && <p className="text-muted">{dict.body.reels.renderResultSpotlight.replace("{a}", String(res.spotlight_frames.DETECTED)).replace("{b}", String(res.spotlight_frames.INTERPOLATED)).replace("{c}", String(res.spotlight_frames.MISSING))}</p>}
          {links && (
            <p className="flex flex-wrap items-center gap-3">
              <a href={links.download_url} className="inline-flex items-center gap-1 text-primary underline" data-download><Download className="h-3.5 w-3.5" />{dict.body.library.download}</a>
              <span className="text-muted">{links.notice}</span>
            </p>
          )}
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ the reels index (no reel selected) */
export function ReelList() {
  const { t: dict } = useLocale();
  const [reels, setReels] = useState<Reel[] | null>(null);
  const [failed, setFailed] = useState(false);
  // a failed read is named as one: an empty list means "no reels yet", not "could not load them"
  const load = useCallback(() => { setFailed(false); void api<Reel[]>("/v1/reels").then((l) => setReels(l), () => setFailed(true)); }, []);
  useEffect(() => { void load(); }, [load]);
  if (failed && !reels) return <p className="text-sm text-muted">{dict.body.reels.reelsNotLoaded} <button type="button" onClick={() => void load()} className="text-primary underline">{dict.common.retry}</button></p>;
  if (!reels) return <p className="text-sm text-muted">{dict.body.reels.reelListLoading}</p>;
  if (reels.length === 0) return <p className="text-sm text-muted">{dict.body.reels.reelListEmpty.replace("{a}", dict.body.workspace.createHighlightReel)}</p>;
  return (
    <ul aria-label="Reels" className="space-y-1 text-sm">
      {reels.map((r) => (
        <li key={r.id}><Link href={`/reels/${r.id}`} className="text-primary underline">{r.name}</Link> <span className="text-xs text-muted">· {(r.clips.length === 1 ? dict.body.reels.reelListClipsOne : dict.body.reels.reelListClipsMany).replace("{a}", String(r.clips.length))} · {renderWord(r.latest_render?.state, dict.body.reels)}</span></li>
      ))}
    </ul>
  );
}
