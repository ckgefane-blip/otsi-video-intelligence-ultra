"use client";
/**
 * Reel Builder / Spotlight Composer (page 06) for one reel, connected to the real API (ADR-032). The user makes the reel by clicking:
 * add suggested moments, trim and order clips, set the look of the spotlight, render. The engine suggests (moments where the confirmed
 * player is visible) and renders (dense re-analysis of the clip windows, spotlight, MP4 on the Intel GPU, validation). Nothing here is
 * pre-filled: an empty reel stays empty until the user adds a clip.
 */
import { clipOutputUs, slotUs, type Playback, type Reel, type ReelHistory, type ReelMoment, type RenderJob, type SpotlightSettings } from "@otsi-vie/contracts";
import { ArrowDown, ArrowUp, CheckCircle2, CircleDashed, Download, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, ApiProblem } from "@/lib/api";

const WRITERS = ["OWNER", "ADMIN", "ANALYST", "EDITOR"];
const sec = (us: number) => `${(us / 1e6).toFixed(1)} s`;

interface Ctx {
  reel: Reel | null;
  moments: ReelMoment[] | null;
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
  const [reel, setReel] = useState<Reel | null>(null);
  const [moments, setMoments] = useState<ReelMoment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [history, setHistory] = useState<ReelHistory | null>(null);
  const load = useCallback(async (): Promise<[Reel, ReelMoment[]] | null> => {
    try {
      const [r, m, h] = await Promise.all([api<Reel>(`/v1/reels/${reelId}`), api<ReelMoment[]>(`/v1/reels/${reelId}/moments`),
        api<ReelHistory>(`/v1/reels/${reelId}/history`).catch(() => null)]);
      setReel(r); setMoments(m); setHistory(h); setError(null);
      return [r, m];
    } catch (x) {
      setError(x instanceof ApiProblem ? x.message : "The reel could not be loaded.");
      return null;
    }
  }, [reelId]);
  const reload = useCallback(async () => { await load(); }, [load]);
  useEffect(() => { void reload(); }, [reload]);
  const rendering = reel?.latest_render && ["QUEUED", "RUNNING"].includes(reel.latest_render.state);
  useEffect(() => {                                    // follow a render until it settles
    if (!rendering) return;
    const t = setInterval(() => void reload(), 2000);
    return () => clearInterval(t);
  }, [rendering, reload]);
  const run: Ctx["run"] = (f, ok) => {
    setBusy(true); setMsg(null);
    void f().then(async (r) => { if (r) setReel(r); const got = await load(); if (ok) setMsg({ ok: true, text: typeof ok === "string" ? ok : ok(got?.[0] ?? null, got?.[1] ?? null) }); },
      (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : "That did not work." })).finally(() => setBusy(false));
  };
  const value: Ctx = {
    reel, moments, error, canEdit: !!organization && WRITERS.includes(organization.role), busy, msg, reload, selectedClip, setSelectedClip, run, history,
    undo(toEditId) {
      const what = toEditId ? history?.entries.find((e) => e.id === toEditId)?.label : history?.undo_label;
      run(() => api<Reel>(`/v1/reels/${reelId}/history/undo`, { method: "POST", json: toEditId ? { to_edit_id: toEditId } : {} }),
        toEditId ? `Back to before: ${what ?? "that change"}` : `Undone: ${what ?? "the last change"}`);
    },
    redo() {
      const what = history?.redo_label;
      run(() => api<Reel>(`/v1/reels/${reelId}/history/redo`, { method: "POST" }), `Redone: ${what ?? "the change"}`);
    },
  };
  return <ReelCtx.Provider value={value}>{children}</ReelCtx.Provider>;
}

/* ------------------------------------------------------------------ section 1: the four steps */
export function ReelSteps() {
  const { reel, error } = useReel();
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!reel) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading the reel…</p>;
  const r = reel.latest_render;
  const steps: [string, boolean, string][] = [
    ["Player", !!reel.player && !reel.stale, reel.player ? `${reel.player.display_name}${reel.stale ? " — targets need refreshing" : ""}` : "none"],
    ["Clips", reel.clips.length > 0, reel.clips.length ? `${reel.clips.length} clip${reel.clips.length === 1 ? "" : "s"}, ${sec(reel.duration_us)}` : "add a suggested moment"],
    ["Spotlight", true, `dim ${Math.round(reel.settings.dim * 100)} %${reel.settings.ring ? ", ring" : ""}${reel.settings.name_caption ? ", name" : ""}`],
    ["Render", r?.state === "SUCCEEDED", r ? r.state.toLowerCase() : "not rendered yet"],
  ];
  return (
    <div className="space-y-2">
      <p className="text-sm"><span className="font-semibold" data-reel-name>{reel.name}</span> <span className="text-muted">· <Link className="text-primary underline" href={`/videos/${reel.video_id}/analyze`}>source video</Link></span></p>
      <ol aria-label="Reel steps" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:grid-cols-4 min-[1100px]:grid-cols-1">
        {steps.map(([n, done, note], i) => (
          <li key={n} data-reel-step={n} data-done={done ? "1" : "0"}
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

/* ------------------------------------------------------------------ section 2: aspect presets */
export function AspectPresets() {
  const { reel, canEdit, run, busy } = useReel();
  if (!reel) return null;
  return (
    <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Aspect ratio">
      {(["16:9", "9:16", "1:1", "4:5"] as const).map((a) => (
        <button key={a} type="button" role="radio" aria-checked={reel.aspect === a} disabled={!canEdit || busy}
          onClick={() => run(() => api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, aspect: a } }))}
          className={`min-w-0 rounded-ctl border px-1.5 py-2 text-center text-sm font-medium ${reel.aspect === a ? "border-primary bg-primary/10 text-primary" : "border-line hover:border-primary/50"}`}>
          {a} <span className="mt-0.5 block text-[10px] font-normal leading-tight text-muted">{a === "16:9" ? "broadcast" : a === "9:16" ? "stories" : a === "4:5" ? "feed" : "square"}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ section 3: name; music */
export function ReelMetadata() {
  const { reel, canEdit, run, busy } = useReel();
  const [name, setName] = useState("");
  useEffect(() => { if (reel) setName(reel.name); }, [reel?.name]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!reel) return null;
  return (
    <div className="space-y-2 text-sm">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, name } }), "Name saved."); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Reel name" disabled={!canEdit} className="min-w-0 flex-1 rounded-ctl border border-line bg-canvas px-2 py-1.5" />
        <button type="submit" disabled={!canEdit || busy || name.trim() === reel.name} className="rounded-ctl border border-line px-3 disabled:opacity-50">Save</button>
      </form>
      {reel.aspect !== "16:9" && <p className="text-xs text-muted">The {reel.aspect} frame follows the player.</p>}
      <p className="text-xs text-muted">Music: no royalty-free music library is connected yet; the reel keeps the match audio of each clip.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ section 4: preview */
export function ReelPreview() {
  const { reel, selectedClip } = useReel();
  const [src, setSrc] = useState<{ url: string; kind: "render" | "source" } | null>(null);
  const ref = useRef<HTMLVideoElement | null>(null);
  const clip = reel?.clips.find((c) => c.id === selectedClip) ?? reel?.clips[0] ?? null;
  const renderId = reel?.last_good_render?.has_output ? reel.last_good_render.id : null;
  useEffect(() => {
    if (!reel) return;
    if (renderId && !selectedClip) {
      void api<{ url: string }>(`/v1/renders/${renderId}/playback`).then((p) => setSrc({ url: p.url, kind: "render" }), () => setSrc(null));
    } else {
      void api<Playback>(`/v1/videos/${reel.video_id}/playback`).then((p) => setSrc(p.url ? { url: p.url, kind: "source" } : null), () => setSrc(null));
    }
  }, [reel?.id, renderId, selectedClip]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const v = ref.current;
    if (v && src?.kind === "source" && clip) { const go = () => { v.currentTime = clip.in_pts_us / 1e6; }; if (v.readyState >= 1) go(); else v.addEventListener("loadedmetadata", go, { once: true }); }
  }, [src, clip?.id, clip?.in_pts_us]);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!reel) return <div className="aspect-video animate-pulse rounded-ctl bg-raised/50" />;
  if (!src) return <p className="text-sm text-muted">No preview yet: the playback copy or the render is not available.</p>;
  const portrait = src.kind === "render" && (reel.aspect === "9:16" || reel.aspect === "4:5");
  return (
    <div className="space-y-1.5">
      <video ref={ref} key={src.url} src={src.url} controls playsInline
        className={`mx-auto block max-h-[min(52vh,480px)] rounded-ctl bg-black object-contain ${portrait ? "w-auto max-w-full" : "w-full"}`} aria-label={src.kind === "render" ? "Rendered reel" : "Source clip preview"} data-preview={src.kind} />
      <p className="text-xs text-muted">{src.kind === "render" ? "The rendered reel (with the spotlight)." : `Source footage at ${clip ? sec(clip.in_pts_us) : "the start"}; the spotlight appears in the rendered reel.`}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ section 5: targeting */
export function ReelTargets() {
  const { reel, canEdit, run, busy } = useReel();
  if (!reel) return null;
  return (
    <div className="space-y-2 text-sm">
      {reel.player ? (
        <p data-reel-player><span className="font-semibold">{reel.player.display_name}</span>{" "}
          <span className="text-muted">· {reel.player.canonical_otsi_id ?? "provisional, no OTSI Player ID yet"}</span></p>
      ) : <p className="text-muted">No player.</p>}
      <p className="text-xs text-muted">The spotlight follows only tracks a person confirmed as this player:</p>
      <ul className="space-y-0.5 text-xs" aria-label="Followed tracks">
        {reel.targets.map((t) => (
          <li key={t.track_id} className={t.decision_current ? "" : "text-danger"}>track {t.track_number} · {sec(t.first_pts_us)}–{sec(t.last_pts_us)}{t.decision_current ? "" : " · identity changed"}</li>
        ))}
      </ul>
      {reel.stale && (
        <div role="alert" className="rounded-ctl border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
          An identity this reel follows was corrected. Refresh the followed tracks before rendering.
          {canEdit && <button type="button" disabled={busy} onClick={() => run(() => api<Reel>(`/v1/reels/${reel.id}/refresh-targets`, { method: "POST" }), "Followed tracks refreshed.")}
            className="ml-2 inline-flex items-center gap-1 rounded border border-danger/50 px-2 py-0.5"><RefreshCw className="h-3 w-3" />Refresh</button>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ section 6: spotlight settings */
export function SpotlightControls() {
  const { reel, canEdit, run, busy } = useReel();
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
      {slider("dim", "Darken the rest", 0, 0.9, 0.05)}
      {slider("size", "Spotlight size", 0.8, 3, 0.1)}
      {slider("feather", "Soft edge", 0.05, 1.5, 0.05)}
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={s.ring} disabled={!canEdit} onChange={(e) => setS({ ...s, ring: e.target.checked })} /> Ring at the feet
        <input type="color" value={s.ring_color} disabled={!canEdit || !s.ring} aria-label="Ring colour" onChange={(e) => setS({ ...s, ring_color: e.target.value.toUpperCase() })} className="h-5 w-8" /></label>
      <button type="button" disabled={!canEdit || busy || !changed} onClick={() => run(() => api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, settings: s } }), "Spotlight settings saved.")}
        className="rounded-ctl border border-line px-3 py-1 text-xs disabled:opacity-50">Save spotlight settings</button>
    </div>
  );
}

/* ------------------------------------------------------------------ section 7: overlays */
export function ReelOverlays() {
  const { reel, canEdit, run, busy } = useReel();
  if (!reel) return null;
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={reel.settings.name_caption} disabled={!canEdit || busy}
        onChange={(e) => run(() => api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, settings: { name_caption: e.target.checked } } }))} />
        Player name caption{reel.player?.canonical_otsi_id ? " with OTSI Player ID" : ""}</label>
      <p className="text-xs text-muted">Logo and branding overlays need the owner&apos;s approved brand assets (not connected).</p>
    </div>
  );
}

/* ------------------------------------------------------------------ section 8: suggested moments */
export function MomentCarousel() {
  const { reel, moments, canEdit, run, busy } = useReel();
  if (!reel || !moments) return <p className="text-sm text-muted">Loading suggestions…</p>;
  if (moments.length === 0) return <p className="text-sm text-muted">No moments: the player is not visible on any confirmed track.</p>;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted">Where {reel.player?.display_name ?? "the player"} is visible on confirmed tracks. These are moments he is on camera, not events; his passes and shots are marked on each clip in Clip Studio.</p>
      <ul aria-label="Suggested moments" className="flex gap-2 overflow-x-auto pb-1">
        {moments.map((m) => (
          <li key={m.in_pts_us} data-moment={m.in_pts_us} className="flex w-48 shrink-0 flex-col rounded-ctl border border-line/70 bg-raised/40 p-2 text-xs">
            <p className="font-medium">{sec(m.in_pts_us)} – {sec(m.out_pts_us)}</p>
            <p className="mb-1.5 text-muted">{m.label} · track {m.track_numbers.join(", ")}</p>
            <button type="button" disabled={!canEdit || busy || m.in_reel}
              onClick={() => run(() => api<Reel>(`/v1/reels/${reel.id}/clips`, { method: "POST", json: { in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us, origin: "SUGGESTED", label: m.label } }), "Clip added.")}
              className="mt-auto inline-flex w-fit items-center gap-1 rounded border border-line px-2 py-0.5 pt-0.5 hover:border-primary/60 disabled:opacity-50">
              {m.in_reel ? "In the reel" : <><Plus className="h-3 w-3" />Add to reel</>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ section 9: clips timeline */
export function ClipTimeline() {
  const { reel, canEdit, run, busy, selectedClip, setSelectedClip } = useReel();
  const [edit, setEdit] = useState<Record<string, { a: string; b: string }>>({});
  if (!reel) return null;
  if (reel.clips.length === 0) return <p className="text-sm text-muted">No clips yet. Add a suggested moment above.</p>;
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
      <ol aria-label="Clips" className="space-y-1 text-xs">
        {reel.clips.map((c, i) => {
          const e = edit[c.id] ?? { a: (c.in_pts_us / 1e6).toFixed(1), b: (c.out_pts_us / 1e6).toFixed(1) };
          return (
            <li key={c.id} data-clip={i} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-ctl border px-2 py-1.5 ${selectedClip === c.id ? "border-primary bg-primary/5" : "border-line/60"}`}>
              <button type="button" onClick={() => setSelectedClip(selectedClip === c.id ? null : c.id)} className="w-16 text-left font-medium underline-offset-2 hover:underline">{i + 1}. {sec(clipOutputUs(c))}</button>
              <label className="flex items-center gap-1">in <input value={e.a} disabled={!canEdit} aria-label={`Clip ${i + 1} in (s)`} onChange={(x) => setEdit({ ...edit, [c.id]: { ...e, a: x.target.value } })} className="w-14 rounded border border-line bg-canvas px-1" /></label>
              <label className="flex items-center gap-1">out <input value={e.b} disabled={!canEdit} aria-label={`Clip ${i + 1} out (s)`} onChange={(x) => setEdit({ ...edit, [c.id]: { ...e, b: x.target.value } })} className="w-14 rounded border border-line bg-canvas px-1" /></label>
              {canEdit && (
                <span className="ml-auto flex items-center gap-1">
                  <button type="button" disabled={busy || !edit[c.id]} onClick={() => run(() => api<Reel>(`/v1/reels/${reel.id}/clips/${c.id}`, { method: "PATCH", json: { in_pts_us: Math.round(Number(e.a) * 1e6), out_pts_us: Math.round(Number(e.b) * 1e6) } }), "Clip trimmed.")}
                    className="rounded border border-line px-1.5 disabled:opacity-50">Trim</button>
                  <button type="button" aria-label="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)} className="rounded border border-line p-0.5 disabled:opacity-40"><ArrowUp className="h-3 w-3" /></button>
                  <button type="button" aria-label="Move down" disabled={busy || i === reel.clips.length - 1} onClick={() => move(i, 1)} className="rounded border border-line p-0.5 disabled:opacity-40"><ArrowDown className="h-3 w-3" /></button>
                  <button type="button" aria-label="Remove clip" disabled={busy} onClick={() => run(() => api<Reel>(`/v1/reels/${reel.id}/clips/${c.id}`, { method: "DELETE" }))} className="rounded border border-line p-0.5 hover:border-danger/60"><Trash2 className="h-3 w-3" /></button>
                </span>
              )}
              {c.origin === "SUGGESTED" && <span className="text-muted">suggested</span>}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted">Total {sec(reel.duration_us)} (at most 10 minutes; a clip at most 60 s).</p>
    </div>
  );
}

/* ------------------------------------------------------------------ section 10: render */
export function RenderPanel() {
  const { reel, canEdit, run, busy, msg } = useReel();
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
        <label className="flex flex-col text-xs text-muted">Video codec
          <select value={codec} onChange={(e) => setCodec(e.target.value as typeof codec)} aria-label="Video codec" className="rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm text-ink">
            <option value="h264">H.264 MP4 (plays everywhere)</option><option value="av1">AV1 MP4 (royalty-free)</option><option value="vp9">VP9 WebM (royalty-free)</option>
          </select></label>
        <button type="button" disabled={!canEdit || busy || !!active || reel.clips.length === 0 || reel.stale}
          onClick={() => run(async () => { await api(`/v1/reels/${reel.id}/renders`, { method: "POST", json: { codec, bitrate_mbps: 8 }, headers: { "idempotency-key": `render-${reel.id}-${reel.version}-${codec}-${Date.now()}` } }); }, "Rendering started.")}
          className="inline-flex items-center gap-2 rounded-ctl bg-primary px-3 py-2 font-semibold text-white disabled:opacity-50">
          {active ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Render reel
        </button>
      </div>
      {active && <p role="status" className="flex items-center gap-2 text-xs"><Loader2 className="h-3.5 w-3.5 animate-spin text-cyan" />{r.stage_message ?? "Waiting for the render worker…"} {r.progress !== null ? `(${Math.round(r.progress)} %)` : ""}</p>}
      {r?.state === "FAILED" && <p role="alert" className="rounded-ctl border border-danger/40 bg-danger/10 p-2 text-xs text-danger"><span className="font-semibold">{r.failure_code}</span>: {r.failure_detail}</p>}
      {r?.state === "SUCCEEDED" && res && (
        <div className="space-y-1 text-xs" data-render-result>
          <p>{res.width}×{res.height} · {res.duration_s} s · {res.frames} frames · {res.encoder} · rendered in {res.seconds} s</p>
          {res.spotlight_frames && <p className="text-muted">Spotlight: {res.spotlight_frames.DETECTED} frames on detections, {res.spotlight_frames.INTERPOLATED} interpolated between nearby detections, {res.spotlight_frames.MISSING} without the player (no spotlight drawn).</p>}
          {links && (
            <p className="flex flex-wrap items-center gap-3">
              <a href={links.download_url} className="inline-flex items-center gap-1 text-primary underline" data-download><Download className="h-3.5 w-3.5" />Download</a>
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
  const [reels, setReels] = useState<Reel[] | null>(null);
  useEffect(() => { void api<Reel[]>("/v1/reels").then(setReels, () => setReels([])); }, []);
  if (!reels) return <p className="text-sm text-muted">Loading reels…</p>;
  if (reels.length === 0) return <p className="text-sm text-muted">No reels yet. In the Analysis Workspace, confirm who a player is, then choose &quot;Create highlight reel&quot;.</p>;
  return (
    <ul aria-label="Reels" className="space-y-1 text-sm">
      {reels.map((r) => (
        <li key={r.id}><Link href={`/reels/${r.id}`} className="text-primary underline">{r.name}</Link> <span className="text-xs text-muted">· {r.clips.length} clips · {r.latest_render?.state.toLowerCase() ?? "not rendered"}</span></li>
      ))}
    </ul>
  );
}
