"use client";
/**
 * Page 02 Section 05 — primary drag-drop file panel (approved reference 02_UPLOAD_INGEST, "dropzone").
 *
 * Each source tab has its own surface (owner direction 2026-10-29): Upload File = drop zone + Browse Files, one video; Batch Upload = the same
 * with several files and a queue showing each file's own status; YouTube / URL = the link field and Add URL (section 06), no file picker.
 * Drop video files here or use Browse Files: each one is uploaded resumably into the chosen project (useUpload.addFiles: checksummed
 * parts, then verified, probed and test-decoded by the ingest worker). The size limit shown is the server's own (GET /v1/upload-limits).
 * Uploads go into a project: the line at the bottom names it and opens the project chooser (choose one or create one), a contextual
 * dialog (ADR-035). Without a project, Browse Files opens that chooser first.
 * A.11 (ADR-077): the line in the middle names this page's rights answers and opens the rights questions. With Send to Analysis on, they
 * are asked before the first upload starts (the dropped files upload as soon as they are answered).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { ACCEPTED_EXTENSIONS } from "@otsi-vie/contracts";
import { useEffect, useRef, useState } from "react";
import { B, Ic, T, u } from "@/components/stage/DesignStage";
import { ApiProblem } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useSourceMode } from "./UploadHeaderSection";
import { usePage02 } from "./page02";
import { profileLabel } from "./ProfileCard";
import { rightsSummary, UploadRightsDialog } from "./RightsDialog";
import { useUpload } from "./UploadWorkspace";

const ACCEPT = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",");
const STARS = Array.from({ length: 10 }, (_, i) => ({ x: 600 + i * 100, y: 380 + Math.abs(i - 4.5) * 18 }));
const gb = (b: number) => `${Math.round(b / 1024 ** 3)} GB`;

function ProjectDialog() {
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
          <Dialog.Title className="text-base font-semibold">Project for uploads</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">Videos belong to a project. {active.length ? "Choose one or create a new one." : "Create your first project to start."}</Dialog.Description>
          {active.length > 0 && (
            <label className="mb-3 block">
              <span className="text-xs text-muted">Project</span>
              <select value={projectId ?? ""} onChange={(e) => { setProjectId(e.target.value); say("Uploads now go to this project"); }} aria-label="Project"
                className="mt-1 w-full rounded-ctl border border-line bg-canvas px-2 py-2">
                {active.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.video_count} {p.video_count === 1 ? "video" : "videos"})</option>)}
              </select>
            </label>
          )}
          {canWrite ? (
            <form className="flex gap-2" onSubmit={(e) => {
              e.preventDefault(); setBusy(true); setErr(null);
              void createProject(name).then(() => { setName(""); say("Project created: uploads go into it"); }, (x) => setErr(x instanceof ApiProblem ? x.message : "Could not create the project."))
                .finally(() => setBusy(false));
            }}>
              <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={255} required placeholder="New project name" aria-label="New project name"
                className="min-w-0 flex-1 rounded-ctl border border-line bg-canvas px-2 py-2" />
              <button type="submit" disabled={busy} className="rounded-ctl border border-line px-3 hover:border-primary/60">Create Project</button>
            </form>
          ) : <p className="text-muted">Your role can view uploads but not create projects.</p>}
          {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
          <div className="mt-3 flex justify-end"><Dialog.Close className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white">Done</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Batch Upload: every file of this session with its own state (this page's resumable transfers; nothing is invented) */
function BatchQueue() {
  const { transfers } = useUpload();
  const rows = transfers.slice(0, 4);
  const done = transfers.filter((t) => t.state === "done").length;
  const pct = (t: (typeof transfers)[number]) => (t.progress ? Math.floor((100 * t.progress.sentBytes) / t.progress.totalBytes) : 0);
  const text = (t: (typeof transfers)[number]) => t.state === "done" ? "Uploaded · being verified" : t.state === "paused" ? `Paused at ${pct(t)}%` : t.state === "error" ? (t.error ?? "Stopped") : `Uploading ${pct(t)}%`;
  return (
    <ul aria-label="Batch queue" style={{ margin: 0, padding: 0, listStyle: "none" }}>
      <li><T x={631} y={736} size={17} color="#9fb3cc">{transfers.length ? `${done} of ${transfers.length} uploaded` : "No files queued yet: each file you add shows its own status here"}</T></li>
      {rows.map((t, i) => (
        <li key={t.id} data-transfer-state={t.state}>
          <T x={631} y={766 + i * 27} size={18} color="#e3eefb" style={{ maxWidth: u(640), overflow: "hidden", textOverflow: "ellipsis" }}>{t.file.name}</T>
          <T x={1290} y={766 + i * 27} size={17} color="#9fb3cc">{formatBytes(t.file.size)}</T>
          <T x={1400} y={766 + i * 27} size={17} color={t.state === "error" ? "#ff9aa8" : t.state === "done" ? "#3ee6a8" : "#7fd0ff"} style={{ maxWidth: u(300), overflow: "hidden", textOverflow: "ellipsis" }}>{text(t)}</T>
        </li>
      ))}
      {transfers.length > 4 && <li><T x={631} y={766 + 4 * 27} size={16} color="#9fb3cc">{`and ${transfers.length - 4} more`}</T></li>}
    </ul>
  );
}

export function DropZoneSection() {
  const { addFiles, projectId, projects, canWrite, rights, setRightsDialog } = useUpload();
  const { limits, setProjectDialog, say, prefs, setOptionsTab } = usePage02();
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

  const add = (files: FileList | File[]) => { if (!addFiles(files)) say("Answer the rights questions first: the upload starts right after"); };
  const browse = () => {
    if (!canWrite) return say("Your role can view uploads but not add videos");
    if (!projectId) { setPendingBrowse(true); setProjectDialog(true); return say("Choose or create a project first — the file picker opens right after"); }
    input.current?.click();
  };
  const drop = (files: FileList) => {
    if (link) return say("This tab imports from a link. To upload files, use Upload File or Batch Upload.");
    if (!canWrite) return say("Your role can view uploads but not add videos");
    if (!batch && files.length > 1) return say(`${files.length} files were dropped. Upload File takes one video: drop one, or use Batch Upload for several.`);
    if (!projectId) { setPendingFiles(files); setProjectDialog(true); return say("Choose or create a project first — this file uploads automatically once it's ready"); }
    add(files);
  };

  return (
    <section aria-label="Primary drag-drop file panel" data-section="p02-s05" data-project={projectId ?? ""}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) drop(e.dataTransfer.files); }}>
      <B x={438} y={329} w={1453} h={538} style={{ borderRadius: u(6), border: `${u(2.5)} dashed ${over ? "#7fd0ff" : "#1e90ff"}`,
        background: "radial-gradient(ellipse at 50% 0,#2a6fb8 0,#0d2a55 30%,transparent 55%),linear-gradient(180deg,#0a1a38 0,#06122a 55%,#103a1c 82%,#06122a)",
        boxShadow: over ? `inset 0 0 ${u(40)} #1e90ff` : undefined }} />
      {STARS.map((p) => <B key={p.x} x={p.x} y={p.y} w={10} h={10} style={{ background: "#cfe8ff", borderRadius: "50%", boxShadow: `0 0 ${u(12)} #fff` }} />)}
      <B x={1090} y={388} w={172} h={132} style={{ border: `${u(12)} solid #1e90ff`, borderRadius: u(60), boxShadow: `0 0 ${u(30)} #1e90ff` }} />
      <Ic x={1176} y={484} k={link ? "link" : "ups"} size={90} color="#fff" />
      <T x={1181} y={561} size={38} weight={700} align="center">{link ? "Paste a link to your match video" : batch ? "Drag and drop your video files here" : "Drag and drop your video file here"}</T>
      <T x={1181} y={610} size={24} color="#e3eefb" align="center">
        {link ? "A direct video file or a public archive link  •  YouTube pages cannot be imported (see Which links work?)"
          : batch ? `Several files at once, each uploaded and verified on its own  •  Max file size ${limits ? gb(limits.max_upload_bytes) : "—"}`
          : `Supports MP4, MOV, AVI, MKV and more  •  Max file size ${limits ? gb(limits.max_upload_bytes) : "—"}`}
      </T>
      {!link && (
        <button type="button" onClick={browse} aria-label="Browse Files" className="absolute"
          style={{ left: u(1017), top: u(649 - 101), width: u(330), height: u(68), padding: 0, border: 0, borderRadius: u(8), background: "#0a84ff", color: "#fff", font: "inherit",
            cursor: "pointer", opacity: projectId && canWrite ? 1 : 0.75 }}>
          <Ic o={[1017, 649]} x={1100} y={683} k="fold" size={40} color="#fff" fill="#fff" />
          <T o={[1017, 649]} x={1141} y={683} size={26} weight={600} as="span">{batch ? "Browse Files" : "Browse File"}</T>
        </button>
      )}
      <input ref={input} type="file" accept={ACCEPT} multiple={batch} hidden aria-label="Video files"
        onChange={(e) => { if (e.target.files?.length) drop(e.target.files); e.target.value = ""; }} />
      {batch && <BatchQueue />}
      <button type="button" onClick={() => setProjectDialog(true)} className="absolute" data-action="project"
        style={{ left: u(631), top: u(853 - 101 - 12), height: u(24), padding: 0, border: 0, background: "transparent", color: "#9fb3cc", fontSize: u(16), fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>
        {project ? <>Project: <span style={{ color: "#e3eefb" }}>{project.name}</span> ({project.video_count} {project.video_count === 1 ? "video" : "videos"}) · <span style={{ color: "#33a8ff" }}>Change</span></>
          : <span style={{ color: "#ffc66d" }}>No project yet · Create one to upload</span>}
      </button>
      <button type="button" onClick={() => setOptionsTab(2)} className="absolute" data-action="profile" title="Choose the analysis profile on the AI Tools tab (left)"
        style={{ left: u(1280), top: u(853 - 101 - 12), width: u(596), height: u(24), padding: 0, border: 0, background: "transparent", color: "#9fb3cc", fontSize: u(16), fontFamily: "inherit",
          cursor: "pointer", whiteSpace: "nowrap", textAlign: "right" }}>
        {prefs.sendToAnalysis ? <>Analysis: <span style={{ color: "#e3eefb" }}>{profileLabel(prefs.profile)}</span> · <span style={{ color: "#33a8ff" }}>Change</span></>
          : <>Analysis: <span style={{ color: "#ffc66d" }}>not started by itself</span> · <span style={{ color: "#33a8ff" }}>Change</span></>}
      </button>
      <button type="button" onClick={() => setRightsDialog(true)} className="absolute" data-action="rights" data-rights={rights ? "answered" : "unanswered"}
        title="Rights for your uploads: analyse, share, download, minors"
        style={{ left: u(1010), top: u(853 - 101 - 12), width: u(330), height: u(24), padding: 0, border: 0, background: "transparent", color: "#9fb3cc", fontSize: u(16), fontFamily: "inherit",
          cursor: "pointer", whiteSpace: "nowrap", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }}>
        {rights ? <>Rights: <span style={{ color: "#e3eefb" }}>{rightsSummary(rights)}</span> · <span style={{ color: "#33a8ff" }}>Change</span></>
          : <>Rights: <span style={{ color: prefs.sendToAnalysis ? "#ffc66d" : "#e3eefb" }}>{prefs.sendToAnalysis ? "needed before analysis" : "not answered"}</span> · <span style={{ color: "#33a8ff" }}>Set</span></>}
      </button>
      <ProjectDialog />
      <UploadRightsDialog />
    </section>
  );
}
