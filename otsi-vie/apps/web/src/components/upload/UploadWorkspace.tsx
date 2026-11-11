"use client";
/**
 * Upload & Ingest (page 02), connected to the real API: project choice (section 2), file drop and upload (5), recent uploads with their
 * real state (8), the selected video's measured facts (9) and its processing pipeline so far (10). One context feeds every section.
 * Nothing is shown that the server did not record.
 */
import type { Project, UploadRights, Video } from "@otsi-vie/contracts";
import { ACCEPTED_EXTENSIONS, IMPORT_PROVIDERS, importProviderFor, type ImportProvider } from "@otsi-vie/contracts";
import { AlertTriangle, CheckCircle2, CircleDashed, FolderPlus, Loader2, Pause, Play, ShieldAlert, UploadCloud, X } from "lucide-react";
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { MatchLinker } from "@/components/matches/MatchPanels";
import { api, apiBlob, ApiProblem } from "@/lib/api";
import { formatBytes, formatDuration, formatFps, formatResolution, formatWhen, NOT_MEASURED } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import type { UploadDict } from "./ProfileCard";
import { cancelUpload, sendFile, type Progress } from "@/lib/upload";
import { ingestOptions } from "@/lib/uploadPrefs";
import { fill } from "@/lib/fill";
import { checkUploadFile, formatGB, useTierLimit } from "@/lib/uploadTier";
import { DEV_MODE, NOT_YET } from "@/lib/devMode";

const WRITERS = ["OWNER", "ADMIN", "ANALYST", "EDITOR"];
const ACCEPT = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",");

interface Transfer { id: string; file: File; projectId: string; progress: Progress | null; state: "sending" | "paused" | "done" | "error"; error?: string | undefined; controller: AbortController; videoId?: string;
  /** A.11: the rights answered when this file was added (sent with it, also on resume) */
  rights: UploadRights | null }

interface Ctx {
  projects: Project[] | null;
  projectId: string | null;
  setProjectId(id: string): void;
  createProject(name: string): Promise<void>;
  videos: Video[] | null;
  selected: Video | null;
  select(id: string): void;
  transfers: Transfer[];
  /** false: the rights questions must be answered first (the dialog opens; the files upload once they are) */
  addFiles(files: FileList | File[]): boolean;
  pause(id: string): void;
  resume(id: string): void;
  cancel(t: Transfer): Promise<void>;
  importLink(url: string, accessToken?: string): Promise<void>;
  canWrite: boolean;
  error: string | null;
  reloadVideos(): Promise<void>;
  /** A.11 (ADR-077): this page's rights answers for the next uploads and imports (page state only) */
  rights: UploadRights | null;
  setRights(r: UploadRights): void;
  rightsDialog: boolean;
  setRightsDialog(o: boolean): void;
}

/** Localised twin of videoStatusLabel (lib/format.ts): same states and tones, labels from the upload dictionary. */
export function videoStatusText(v: { state: string; job: { state: string; progress: number; stage_message: string | null } | null; upload: { received_bytes: number; expected_bytes: number } | null }, d: UploadDict): { label: string; tone: "ok" | "busy" | "warn" | "bad" | "idle" } {
  switch (v.state) {
    case "INGESTED": return { label: d.statusReady, tone: "ok" };
    case "QUARANTINED": return { label: d.statusQuarantined, tone: "bad" };
    case "FAILED": return { label: d.statusRefused, tone: "bad" };
    case "VALIDATING":
      if (v.job?.state === "RUNNING") return { label: v.job.stage_message ?? d.statusCheckingPct.replace("{n}", String(Math.round(v.job.progress))), tone: "busy" };
      return { label: d.statusWaitingCheck, tone: "busy" };
    default:
      return v.upload ? { label: d.statusUploadingPct.replace("{n}", String(Math.floor((100 * v.upload.received_bytes) / v.upload.expected_bytes))), tone: "warn" } : { label: d.statusNotUploaded, tone: "idle" };
  }
}

const UploadCtx = createContext<Ctx | null>(null);
/** Upload data and actions for any presentation layer (ADR-035). */
export type UploadState = Ctx;
export function useUpload(): Ctx {
  const c = useContext(UploadCtx);
  if (!c) throw new Error("outside UploadWorkspace");
  return c;
}

export function UploadWorkspace({ children }: { children: ReactNode }) {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const tierLimit = useTierLimit();                                   // Free 2 GB / Pro 24 GB / Enterprise 64 GB, never above the server's own limit
  const { organization } = useAuth();
  const canWrite = !!organization && WRITERS.includes(organization.role);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectIdState] = useState<string | null>(null);
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const transfersRef = useRef(transfers);
  transfersRef.current = transfers;
  const [rights, setRightsState] = useState<UploadRights | null>(null);
  const [rightsDialog, setRightsDialog] = useState(false);
  const waiting = useRef<File[] | null>(null);                        // files dropped before the rights were answered

  const loadVideos = useCallback(async () => {
    try {
      const [vs, ps] = await Promise.all([api<Video[]>("/v1/videos"), api<Project[]>("/v1/projects")]);    // project video counts change too
      setVideos(vs);
      setProjects(ps);
    } catch (e) { setError(e instanceof ApiProblem ? e.message : d.couldNotLoadVideos); }
  }, [d]);

  useEffect(() => {
    void (async () => {
      try {
        const ps = await api<Project[]>("/v1/projects");
        setProjects(ps);
        const active = ps.find((p) => p.status === "ACTIVE");
        setProjectIdState((cur) => cur ?? active?.id ?? null);
      } catch (e) { setError(e instanceof ApiProblem ? e.message : d.couldNotLoadProjects); }
    })();
    void loadVideos();
  }, [organization?.organization_id, loadVideos]);

  // poll while anything is uploading or being checked; stop when everything has settled
  const moving = (v: Video) => v.state === "PENDING" || v.state === "VALIDATING" || (v.job && (v.job.state === "QUEUED" || v.job.state === "RUNNING")) || (v.analysis && (v.analysis.status === "QUEUED" || v.analysis.status === "RUNNING"));
  const busy = (videos ?? []).some((v) => !!moving(v)) || transfers.some((t) => t.state === "sending");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void loadVideos(), 2000);
    return () => clearInterval(t);
  }, [busy, loadVideos]);

  const patch = (id: string, p: Partial<Transfer>) => setTransfers((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));

  const run = useCallback((t: Transfer) => {
    patch(t.id, { state: "sending", error: undefined });
    sendFile(t.file, t.projectId, ingestOptions(), (progress) => patch(t.id, { progress }), t.controller.signal, t.rights).then(
      (v) => { patch(t.id, { state: "done", videoId: v.id }); setSelectedId(v.id); void loadVideos(); },
      (e: unknown) => {
        if ((e as Error).name === "AbortError") return patch(t.id, { state: "paused" });
        patch(t.id, { state: "error", error: e instanceof ApiProblem ? e.message : d.uploadStopped });
        void loadVideos();
      });
    void loadVideos();
  }, [loadVideos, d]);

  const start = useCallback((files: File[], r: UploadRights | null, pid: string) => {
    const fresh = files.map((file) => ({ id: crypto.randomUUID(), file, projectId: pid, progress: null, state: "sending" as const, controller: new AbortController(), rights: r }));
    setTransfers((ts) => [...fresh, ...ts]);
    fresh.forEach(run);
  }, [run]);
  // with Send to Analysis on, the rights are needed first: analysis runs only on video whose rights allow it
  const needsRights = () => ingestOptions().send_to_analysis && !rights;

  const value = useMemo<Ctx>(() => ({
    projects, projectId, videos, transfers, canWrite, error, reloadVideos: loadVideos, rights, rightsDialog, setRightsDialog,
    setRights(r) {
      setRightsState(r);
      const w = waiting.current;
      waiting.current = null;
      if (w && projectId) start(w, r, projectId);
    },
    selected: (videos ?? []).find((v) => v.id === selectedId) ?? null,
    setProjectId: setProjectIdState,
    select: setSelectedId,
    async createProject(name) {
      const p = await api<Project>("/v1/projects", { method: "POST", json: { name } });
      setProjects((ps) => [p, ...(ps ?? [])]);
      setProjectIdState(p.id);
    },
    addFiles(picked) {
      if (!projectId) { setError(d.chooseProjectFirst); return true; }
      // the tier limit and the MP4 / MOV rule are checked when the file is picked, before any byte is sent
      const dd = dict.desktop;
      const tierName = tierLimit?.tier === "Pro" ? dd.tierPro : tierLimit?.tier === "Enterprise" ? dd.tierEnterprise : tierLimit?.tier === "Free" ? dd.tierFree : tierLimit?.plan ?? "";
      const files: File[] = [];
      for (const f of Array.from(picked)) {
        const c = checkUploadFile(f, tierLimit);
        if (c.ok) { files.push(f); continue; }
        setError(c.reason === "type"
          ? `${dd.uploadWrongTypeTitle}. ${fill(dd.uploadWrongTypeBody, { f: f.name })}`
          : `${fill(dd.uploadTooLargeTitle, { a: tierName })}. ${fill(dd.uploadTooLargeBody, { f: f.name, s: formatGB(f.size), a: tierName, b: formatGB(c.limit ?? 0) })}`);
      }
      if (!files.length) return true;
      if (needsRights()) { waiting.current = Array.from(files); setRightsDialog(true); return false; }
      start(Array.from(files), rights, projectId);
      return true;
    },
    pause(id) { transfersRef.current.find((t) => t.id === id)?.controller.abort(); },
    resume(id) {
      const t = transfersRef.current.find((x) => x.id === id);
      if (!t) return;
      const next = { ...t, controller: new AbortController() };
      setTransfers((ts) => ts.map((x) => (x.id === id ? next : x)));
      run(next);
    },
    async importLink(url, accessToken) {
      if (!projectId) throw new ApiProblem(400, "PROJECT_REQUIRED", d.chooseProjectFirst);
      if (needsRights()) { setRightsDialog(true); throw new ApiProblem(409, "RIGHTS_REQUIRED", d.answerRightsFirstAddUrl); }
      const v = await api<Video>("/v1/imports", { method: "POST", headers: { "idempotency-key": `imp-${crypto.randomUUID()}` },
        json: { project_id: projectId, url, options: ingestOptions(), ...(rights ? { rights } : {}), ...(accessToken ? { access_token: accessToken } : {}) } });
      setSelectedId(v.id);
      await loadVideos();
    },
    async cancel(t) {
      t.controller.abort();
      const v = (videos ?? []).find((x) => x.upload && x.original_filename === t.file.name && x.byte_size === t.file.size);
      if (v?.upload) await cancelUpload(v.upload.upload_id).catch(() => undefined);
      setTransfers((ts) => ts.filter((x) => x.id !== t.id));
      void loadVideos();
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [projects, projectId, videos, transfers, canWrite, error, selectedId, run, loadVideos, rights, rightsDialog, start, d, dict, tierLimit]);

  return <UploadCtx.Provider value={value}>{children}</UploadCtx.Provider>;
}

/* ------------------------------------------------------------------ section 2: project (match context) */
export function ProjectContext() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { projects, projectId, setProjectId, createProject, canWrite, selected, reloadVideos } = useUpload();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (projects === null) return <p className="text-sm text-muted" role="status">{dict.common.loading}</p>;
  const active = projects.filter((p) => p.status === "ACTIVE");
  return (
    <div className="space-y-3 text-sm">
      {active.length > 0 && (
        <label className="block">
          <span className="text-xs text-muted">{d.projectLabel}</span>
          <select value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value)} aria-label={d.projectLabel}
            className="mt-1 w-full rounded-ctl border border-line bg-canvas px-2 py-2">
            {active.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.video_count} {p.video_count === 1 ? d.video : d.videos})</option>)}
          </select>
        </label>
      )}
      {active.length === 0 && <p className="text-muted">{d.videosBelongProject}</p>}
      {canWrite && (
        <form className="flex gap-2" onSubmit={(e) => {
          e.preventDefault();
          setBusy(true); setErr(null);
          void createProject(name).then(() => setName(""), (x) => setErr(x instanceof ApiProblem ? x.message : d.couldNotCreateProject)).finally(() => setBusy(false));
        }}>
          <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={255} required placeholder={d.newProjectName} aria-label={d.newProjectName}
            className="min-w-0 flex-1 rounded-ctl border border-line bg-canvas px-2 py-2" />
          <button type="submit" disabled={busy} className="flex items-center gap-1 rounded-ctl border border-line px-3 hover:border-primary/60 disabled:opacity-60">
            <FolderPlus className="h-4 w-4" /> {d.createProject}
          </button>
        </form>
      )}
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
      <div className="border-t border-line/60 pt-2">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{dict.body.analysis.match}</p>
        {selected
          ? <MatchLinker key={selected.id} videoId={selected.id} matchId={selected.match_id} canWrite={canWrite} onLinked={() => void reloadVideos()} />
          : <p className="text-xs text-muted">{d.selectUploadForMatch}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ section 5: drop zone */
export function DropZone() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { addFiles, projectId, canWrite, transfers, pause, resume, cancel, error } = useUpload();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  if (!canWrite) return <p className="text-sm text-muted">{d.viewVideosOnly}</p>;
  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
        className={`flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-4 py-8 text-center ${over ? "border-primary bg-primary/10" : "border-primary/50 bg-canvas/40"}`}
      >
        <UploadCloud className="h-12 w-12 text-primary" />
        <p className="text-lg font-semibold">{d.dragDropMatch}</p>
        <p className="text-xs text-muted">{ACCEPTED_EXTENSIONS.map((e) => e.toUpperCase()).join(", ")} · {d.dropSubtitlePlain}</p>
        <button type="button" disabled={!projectId} onClick={() => input.current?.click()}
          className="rounded-ctl bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-50">{d.browseFiles}</button>
        {!projectId && <p className="text-xs text-amber">{d.chooseProjectFirst}</p>}
        <input ref={input} type="file" accept={ACCEPT} multiple hidden aria-label={d.videoFilesLabel}
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }} />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {transfers.length > 0 && (
        <ul aria-label={d.uploadsInProgress} className="space-y-2">
          {transfers.map((t) => {
            const pct = t.progress ? Math.floor((100 * t.progress.sentBytes) / t.progress.totalBytes) : 0;
            return (
              <li key={t.id} className="rounded-ctl border border-line bg-raised/40 p-2 text-sm" data-transfer-state={t.state}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{t.file.name}</span>
                  <span className="text-xs text-muted">{formatBytes(t.file.size)}</span>
                  {t.state === "sending" && <button type="button" aria-label={d.pauseFile.replace("{name}", t.file.name)} onClick={() => pause(t.id)}><Pause className="h-4 w-4" /></button>}
                  {(t.state === "paused" || t.state === "error") && <button type="button" aria-label={d.resumeFile.replace("{name}", t.file.name)} onClick={() => resume(t.id)}><Play className="h-4 w-4" /></button>}
                  {t.state !== "done" && <button type="button" aria-label={d.cancelFile.replace("{name}", t.file.name)} onClick={() => void cancel(t)}><X className="h-4 w-4" /></button>}
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.file.name} ${dict.nav.upload}`}>
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {t.state === "done" ? d.uploadedVerifying : t.state === "paused" ? d.pausedAt.replace("{n}", String(pct)) : t.state === "error" ? t.error : d.uploadingPct.replace("{n}", String(pct))}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ section 6: import from a link */
function providerOf(url: string): ImportProvider | null {
  try {
    const u = new URL(url.trim());
    return importProviderFor(u.hostname, u.pathname);
  } catch {
    return null;
  }
}

export function UrlImport() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { importLink, canWrite, projectId } = useUpload();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [showList, setShowList] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const provider = providerOf(url);
  if (!canWrite) return <p className="text-sm text-muted">{d.viewVideosNoImport}</p>;
  return (
    <form className="space-y-2" onSubmit={(e) => {
      e.preventDefault();
      setBusy(true); setMsg(null);
      void importLink(url, provider?.status === "needs_authorization" ? token : undefined).then(
        () => { setUrl(""); setToken(""); setMsg({ ok: true, text: d.importStarted }); },
        (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : d.couldNotStartImport }),
      ).finally(() => setBusy(false));
    }}>
      <div className="flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} type="url" required placeholder={d.pasteLink} aria-label={d.videoUrl}
          className="min-w-0 flex-1 rounded-ctl border border-line bg-canvas px-3 py-2 text-sm" />
        <button type="submit" disabled={busy || !projectId || provider?.status === "unsupported"} className="rounded-ctl border border-line px-3 text-sm hover:border-primary/60 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : d.addUrl}
        </button>
      </div>
      {provider && url.length > 10 && (
        <div data-provider={provider.id} data-provider-status={provider.status}
          className={`rounded-ctl border p-2 text-xs ${provider.status === "unsupported" ? "border-danger/40 bg-danger/10" : "border-line bg-raised/40"}`}>
          <p className="font-semibold">{provider.name}: {provider.status === "supported" ? d.providerCanImport : provider.status === "needs_authorization" ? d.providerNeedsAuth : d.providerCannotImport}</p>
          <p className="mt-0.5 text-muted">{provider.status === "unsupported" ? `${provider.reason} ${provider.alternative}` : provider.method}</p>
          {provider.status === "needs_authorization" && (
            <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" required minLength={8}
              placeholder={d.yourAccessToken.replace("{name}", provider.name)} aria-label={d.accessToken}
              className="mt-2 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm" />
          )}
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      <button type="button" className="text-xs text-primary underline" onClick={() => setShowList((v) => !v)} aria-expanded={showList}>{d.whichLinksWork}</button>
      {showList && (
        <ul aria-label={d.linkSupport} className="grid gap-1 text-xs">
          {IMPORT_PROVIDERS.map((p) => (
            <li key={p.id} className="flex gap-2">
              <span className={`shrink-0 rounded px-1.5 ${p.status === "supported" ? "bg-ok/15 text-ok" : p.status === "needs_authorization" ? "bg-amber/15 text-amber" : "bg-danger/15 text-danger"}`}>
                {p.status === "supported" ? d.providerWorks : p.status === "needs_authorization" ? d.providerWithToken : d.providerNotPossibleShort}
              </span>
              <span><span className="font-medium">{p.name}</span> <span className="text-muted">{p.status === "unsupported" ? p.alternative : p.method}</span></span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">{d.onlyVideoRights}</p>
    </form>
  );
}

/* ------------------------------------------------------------------ section 8: recent uploads */
const TONES = { ok: "text-ok border-ok/40 bg-ok/10", busy: "text-cyan border-cyan/40 bg-cyan/10", warn: "text-amber border-amber/40 bg-amber/10", bad: "text-danger border-danger/40 bg-danger/10", idle: "text-muted border-line" };

export function RecentUploads() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { videos, select, selected } = useUpload();
  if (videos === null) return <p className="text-sm text-muted" role="status">{dict.common.loading}</p>;
  if (videos.length === 0) return <p className="text-sm text-muted">{d.noVideosYetUpload}</p>;
  return (
    <ul aria-label={d.recentUploadsPlain} className="divide-y divide-line/60">
      {videos.slice(0, 12).map((v) => {
        const s = videoStatusText(v, d);
        return (
          <li key={v.id}>
            <button type="button" onClick={() => select(v.id)} aria-pressed={selected?.id === v.id}
              className={`flex w-full items-center gap-3 px-1 py-2 text-left hover:bg-raised/50 ${selected?.id === v.id ? "bg-primary/10" : ""}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{v.title ?? v.original_filename}</span>
                <span className="block text-xs text-muted">{formatDuration(v.duration_us)} · {formatWhen(v.created_at)}</span>
              </span>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONES[s.tone]}`} data-video-state={v.state}>{s.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ section 9: the selected video, as measured */
export function SelectedVideo() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { selected } = useUpload();
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    setThumb(null);
    if (!selected?.has_thumbnail) return;
    let url: string | null = null;
    void apiBlob(`/v1/videos/${selected.id}/thumbnail`).then((b) => { url = URL.createObjectURL(b); setThumb(url); }, () => setThumb(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [selected?.id, selected?.has_thumbnail]);
  if (!selected) return <p className="text-sm text-muted">{d.selectVideoMeasured}</p>;
  const rows: [string, string][] = [
    [d.fileName, selected.original_filename ?? NOT_MEASURED],
    [d.fileSize, formatBytes(selected.byte_size)],
    [d.resolution, formatResolution(selected.width, selected.height)],
    [d.frameRate, formatFps(selected.frame_rate, selected.is_variable_frame_rate)],
    [d.duration, formatDuration(selected.duration_us)],
    [d.containerCodecs, selected.container_format ? `${selected.container_format} · ${selected.video_codec ?? NOT_MEASURED}${selected.audio_codec ? ` + ${selected.audio_codec}` : " (no audio)"}` : NOT_MEASURED],
    ["SHA-256", selected.sha256 ? `${selected.sha256.slice(0, 16)}…` : NOT_MEASURED],
  ];
  return (
    <div className="space-y-3 text-sm" data-selected-video={selected.id}>
      {thumb ? <img src={thumb} alt={d.frameFrom.replace("{name}", selected.title ?? d.theVideo)} className="w-full rounded-ctl border border-line" /> : null}
      <p className="font-semibold">{selected.title ?? selected.original_filename}</p>
      {(selected.state === "FAILED" || selected.state === "QUARANTINED") && (
        <p role="alert" className="flex gap-2 rounded-ctl border border-danger/40 bg-danger/10 p-2 text-danger">
          {selected.state === "QUARANTINED" ? <ShieldAlert className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          <span><span className="font-semibold">{selected.failure_code}</span>: {selected.failure_detail}</span>
        </p>
      )}
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v]) => (<Fragment key={k}><dt className="text-muted">{k}</dt><dd className="min-w-0 truncate">{v}</dd></Fragment>))}
      </dl>
      {selected.state === "INGESTED" && (
        <p className="flex flex-wrap gap-2">
          <Link href={`/videos/${selected.id}/processing`} className="rounded-ctl bg-primary px-3 py-1.5 text-sm font-semibold text-white">{d.analyseThisVideo}</Link>
          <Link href={`/videos/${selected.id}/analyze`} className="rounded-ctl border border-line px-3 py-1.5 text-sm hover:border-primary/60">{d.analysisWorkspace}</Link>
        </p>
      )}
      <p className="text-xs text-muted">{d.detectedTeamsNote}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ section 10: the pipeline so far */
export function PipelineStrip() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { selected } = useUpload();
  const stages: { key: string; name: string; state: "done" | "busy" | "bad" | "todo" | "unbuilt"; note: string }[] = [];
  if (!selected) {
    return <p className="text-sm text-muted">{d.selectVideoProcessing}</p>;
  }
  const uploaded = selected.state !== "PENDING";
  stages.push({ key: "Upload", name: dict.nav.upload, state: uploaded ? "done" : selected.upload ? "busy" : "todo", note: uploaded ? formatBytes(selected.byte_size) : d.waitingForFile });
  const ingest = selected.state === "INGESTED" ? "done" : selected.state === "VALIDATING" ? "busy" : selected.state === "PENDING" ? "todo" : "bad";
  stages.push({ key: "Verify & inspect", name: d.verifyInspect, state: ingest, note: ingest === "done" ? d.checksumVerified : ingest === "busy" ? (selected.job?.stage_message ?? d.queued) : ingest === "bad" ? (selected.failure_code ?? d.refused) : "" });
  if (selected.state === "INGESTED") stages.push({ key: "Detection & tracking", name: d.detectionTracking, state: "todo", note: d.startWithAnalyse });
  for (const [key, block] of [["Identity", 7], ["Indexing", 8]] as const) {
    stages.push({ key, name: key === "Identity" ? d.identity : d.indexing, state: "unbuilt", note: DEV_MODE ? `not built yet (Block ${String(block).padStart(2, "0")})` : NOT_YET });
  }
  const icon = { done: <CheckCircle2 className="h-4 w-4 text-ok" />, busy: <Loader2 className="h-4 w-4 animate-spin text-cyan" />, bad: <AlertTriangle className="h-4 w-4 text-danger" />, todo: <CircleDashed className="h-4 w-4 text-muted" />, unbuilt: <CircleDashed className="h-4 w-4 text-muted/60" /> };
  return (
    <ol aria-label={d.processingPipeline} className="grid grid-cols-2 gap-2 md:grid-cols-6">
      {stages.map((s) => (
        <li key={s.key} className="rounded-ctl border border-line/70 bg-raised/40 p-2" data-stage={s.key} data-stage-state={s.state}>
          <span className="flex items-center gap-1.5 text-sm font-medium">{icon[s.state]} {s.name}</span>
          <span className="mt-1 block text-xs text-muted">{s.note}</span>
        </li>
      ))}
    </ol>
  );
}
