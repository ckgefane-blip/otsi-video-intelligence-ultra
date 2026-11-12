"use client";
/**
 * Page 02 Section 05 — primary drag-drop file panel, on the Desktop UI flow layout.
 *
 * Each source tab has its own surface (owner direction 2026-10-29): Upload File = drop zone + Browse Files, one video; Batch Upload = the same
 * with several files and a queue showing each file's own status; YouTube / URL = the link field and Add URL (section 06), no file picker.
 * Drop video files here or use Browse Files: each one is uploaded resumably into the chosen project (useUpload.addFiles: checksummed
 * parts, then verified, probed and test-decoded by the ingest worker). The size limit shown is the tier limit
 * (Free 2 / Pro 24 / Enterprise 64 GB) capped by the server's own (GET /v1/upload-limits).
 * Uploads go into a project: the line at the bottom names it and opens the project chooser (choose one or create one), a contextual
 * dialog (ADR-035). Without a project, Browse Files opens that chooser first.
 * A.11 (ADR-077): the line in the middle names this page's rights answers and opens the rights questions. With Send to Analysis on, they
 * are asked before the first upload starts (the dropped files upload as soon as they are answered).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { ACCEPTED_EXTENSIONS } from "@otsi-vie/contracts";
import { UploadCloud } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiProblem } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { useSourceMode } from "./UploadHeaderSection";
import { usePage02 } from "./page02";
import { profileLabel } from "./ProfileCard";
import { rightsSummary, UploadRightsDialog } from "./RightsDialog";
import { useUpload } from "./UploadWorkspace";
import { useTierLimit } from "@/lib/uploadTier";

const ACCEPT = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",");
const gb = (b: number) => `${Math.round(b / 1024 ** 3)} GB`;
/** shown limit: the tier limit (Free 2 / Pro 24 / Enterprise 64 GB) capped by the server's own */
const shown = (tier: number | null | undefined, server: number | undefined) => (tier ? gb(tier) : server ? gb(server) : "—");

function ProjectDialog() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { projects, projectId, setProjectId, createProject, canWrite } = useUpload();
  const { projectDialog, setProjectDialog, say } = usePage02();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const active = (projects ?? []).filter((p) => p.status === "ACTIVE");
  return (
    <Dialog.Root open={projectDialog} onOpenChange={setProjectDialog}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(460px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl"
          data-dialog="project">
          <Dialog.Title className="text-base font-semibold">{d.projectForUploads}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{active.length ? `${d.videosBelong} ${d.chooseOrCreate}` : d.videosBelongProject}</Dialog.Description>
          {active.length > 0 && (
            <label className="mb-3 block">
              <span className="text-xs text-muted">{d.projectLabel}</span>
              <select value={projectId ?? ""} onChange={(e) => { setProjectId(e.target.value); say(d.uploadsGoToProject); }} aria-label={d.projectLabel}
                className="mt-1 w-full rounded-ctl border border-line bg-canvas px-2 py-2">
                {active.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.video_count} {p.video_count === 1 ? d.video : d.videos})</option>)}
              </select>
            </label>
          )}
          {canWrite ? (
            <form className="flex gap-2" onSubmit={(e) => {
              e.preventDefault(); setBusy(true); setErr(null);
              void createProject(name).then(() => { setName(""); say(d.projectCreated); }, (x) => setErr(x instanceof ApiProblem ? x.message : d.couldNotCreateProject))
                .finally(() => setBusy(false));
            }}>
              <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={255} required placeholder={d.newProjectName} aria-label={d.newProjectName}
                className="min-w-0 flex-1 rounded-ctl border border-line bg-canvas px-2 py-2" />
              <button type="submit" disabled={busy} className="rounded-ctl border border-line px-3 hover:border-primary/60">{d.createProject}</button>
            </form>
          ) : <p className="text-muted">{d.viewUploadsNoCreateProjects}</p>}
          {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
          <div className="mt-3 flex justify-end"><Dialog.Close className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white">{d.done}</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Batch Upload: every file of this session with its own state (this page's resumable transfers; nothing is invented) */
function BatchQueue() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { transfers } = useUpload();
  const rows = transfers.slice(0, 4);
  const done = transfers.filter((t) => t.state === "done").length;
  const pct = (t: (typeof transfers)[number]) => (t.progress ? Math.floor((100 * t.progress.sentBytes) / t.progress.totalBytes) : 0);
  const text = (t: (typeof transfers)[number]) => t.state === "done" ? d.uploadedVerifying : t.state === "paused" ? d.pausedAt.replace("{n}", String(pct(t))) : t.state === "error" ? (t.error ?? d.stopped) : d.uploadingPct.replace("{n}", String(pct(t)));
  return (
    <div className="mt-3">
      <p className="t-small">{transfers.length ? d.uploadedCount.replace("{done}", String(done)).replace("{total}", String(transfers.length)) : d.noFilesQueued}</p>
      <ul aria-label={d.batchQueue} className="mt-1 space-y-1">
        {rows.map((t) => (
          <li key={t.id} data-transfer-state={t.state} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{t.file.name}</span>
            <span className="shrink-0 text-xs text-muted">{formatBytes(t.file.size)}</span>
            <span className={`shrink-0 text-xs ${t.state === "error" ? "text-danger" : t.state === "done" ? "text-ok" : "text-cyan"}`}>{text(t)}</span>
          </li>
        ))}
        {transfers.length > 4 && <li className="t-small">{d.andMore.replace("{n}", String(transfers.length - 4))}</li>}
      </ul>
    </div>
  );
}

export function DropZoneSection() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { addFiles, projectId, projects, canWrite, rights, setRightsDialog } = useUpload();
  const { limits, setProjectDialog, say, prefs, setOptionsTab } = usePage02();
  const tierMax = useTierLimit()?.maxBytes;
  const [mode] = useSourceMode();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const project = (projects ?? []).find((p) => p.id === projectId) ?? null;
  const batch = mode === "batch";
  const link = mode === "url";

  // the project dialog is a step on the way to browsing/dropping, not a dead end: once a project exists, finish what was asked
  const [pendingBrowse, setPendingBrowse] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<FileList | File[] | null>(null);
  useEffect(() => {
    if (!projectId) return;
    if (pendingBrowse) { setPendingBrowse(false); input.current?.click(); }
    if (pendingFiles) { const f = pendingFiles; setPendingFiles(null); add(f); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const add = (files: FileList | File[]) => { if (!addFiles(files)) say(d.answerRightsFirst); };
  const browse = () => {
    if (!canWrite) return say(d.viewUploadsOnly);
    if (!projectId) { setPendingBrowse(true); setProjectDialog(true); return say(d.chooseProjectFirstPicker); }
    input.current?.click();
  };
  const drop = (files: FileList) => {
    if (link) return say(d.linkTabImports);
    if (!canWrite) return say(d.viewUploadsOnly);
    if (!batch && files.length > 1) return say(d.filesDroppedOne.replace("{n}", String(files.length)));
    if (!projectId) { setPendingFiles(files); setProjectDialog(true); return say(d.chooseProjectFirstUpload); }
    add(files);
  };

  return (
    <section aria-label={link ? d.pasteLinkHere : batch ? d.dragDropMany : d.dragDropOne} data-section="p02-s05" data-project={projectId ?? ""}
      className="vie-panel"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) drop(e.dataTransfer.files); }}>
      <div className={`flex flex-col items-center gap-2 rounded-t-md border-2 border-dashed px-4 py-8 text-center ${over ? "border-primary bg-primary/10" : "border-primary/50 bg-canvas/40"}`}>
        <UploadCloud className="h-10 w-10 text-primary" aria-hidden />
        <p className="t-section">{link ? d.pasteLinkHere : batch ? d.dragDropMany : d.dragDropOne}</p>
        <p className="t-small">
          {link ? d.dropSubtitleLink
            : batch ? d.dropSubtitleBatch.replace("{size}", shown(tierMax, limits?.max_upload_bytes))
            : d.dropSubtitleFile.replace("{size}", shown(tierMax, limits?.max_upload_bytes))}
        </p>
        {!link && (
          <button type="button" onClick={browse} aria-label={d.browseFiles}
            className="vie-btn vie-btn-pri mt-1">{batch ? d.browseFiles : d.browseFile}</button>
        )}
        {!projectId && <p className="text-xs text-amber">{d.chooseProjectFirst}</p>}
        <input ref={input} type="file" accept={ACCEPT} multiple={batch} hidden aria-label={d.videoFilesLabel}
          onChange={(e) => { if (e.target.files?.length) drop(e.target.files); e.target.value = ""; }} />
      </div>
      {batch && <div className="border-t border-line/60 px-3 py-2"><BatchQueue /></div>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 px-3 py-2 text-xs text-muted">
        <button type="button" onClick={() => setProjectDialog(true)} data-action="project" className="text-left hover:text-ink">
          {project ? <>{d.projectLabel} <span className="text-ink">{project.name}</span> ({project.video_count} {project.video_count === 1 ? d.video : d.videos}) · <span className="text-primary">{d.change}</span></>
            : <span className="text-amber">{d.noProjectYet}</span>}
        </button>
        <button type="button" onClick={() => setRightsDialog(true)} data-action="rights" data-rights={rights ? "answered" : "unanswered"} title={d.rightsTitle} className="text-left hover:text-ink">
          {rights ? <>{d.rightsLabel} <span className="text-ink">{rightsSummary(rights, d)}</span> · <span className="text-primary">{d.change}</span></>
            : <>{d.rightsLabel} <span className={prefs.sendToAnalysis ? "text-amber" : "text-ink"}>{prefs.sendToAnalysis ? d.rightsNeededBeforeAnalysis : d.rightsNotAnswered}</span> · <span className="text-primary">{d.set}</span></>}
        </button>
        <button type="button" onClick={() => setOptionsTab(2)} data-action="profile" title={d.analysisProfileTitle} className="ml-auto text-left hover:text-ink">
          {prefs.sendToAnalysis ? <>{d.analysisLabel} <span className="text-ink">{profileLabel(prefs.profile, d)}</span> · <span className="text-primary">{d.change}</span></>
            : <>{d.analysisLabel} <span className="text-amber">{d.notStartedByItself}</span> · <span className="text-primary">{d.change}</span></>}
        </button>
      </div>
      <ProjectDialog />
      <UploadRightsDialog />
    </section>
  );
}
