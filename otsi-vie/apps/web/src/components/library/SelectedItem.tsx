"use client";
/**
 * Page 09 Sections 07–10 — selected-item preview, metadata, quick actions and collaborator access (approved reference
 * 09_LIBRARY_PROJECT_CENTER, "right panel"), laid out in the page's flow.
 *
 * The preview plays the asset's real file through the shared VideoPlayer: a rendered reel's MP4 (GET /v1/renders/:id/playback),
 * otherwise the source video's playback copy (GET /v1/videos/:id/playback). With nothing to play it says so and names the next
 * action, instead of a decorative frame. Details are what was recorded (competition, match, featured player, creator, dates,
 * length, file size, resolution); tags are not recorded, so "—". Download gives the rendered MP4 only; Share copies the in-app
 * link; Edit renames a reel or project; Open in Analysis opens the source video. Duplicate copies a reel (POST /v1/reels/:id/duplicate:
 * same player, pinned identities, settings and clips; renders, links and notes are not copied). Send to Client opens the reel's
 * Export & Delivery page (ADR-058). Nothing is a dead control: Send to Client and Duplicate on anything but a reel and anything
 * that needs a selection say why when clicked.
 * Collaborators (ADR-057) shows who can see the item: its project's people and whether only they (and Owners / Admins) may see it, or
 * everyone in the organization. Manage Access opens the project's access list (AccessDialog); the server enforces it on every route.
 * A.12 (ADR-078): Media Info, in the heading, opens everything recorded about the item's source video (MediaInfoDialog).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { type LibraryFolder, type Match, type Member, type Playback, type Project, type ProjectPermission, type Reel } from "@otsi-vie/contracts";
import Link from "next/link";
import { memo, useEffect, useRef, useState } from "react";
import { Download, Info, Link2, Pencil, Play, Send, X } from "lucide-react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { kindLabel, statusLabel, type Asset } from "./useLibrary";
import { MediaInfoDialog } from "@/components/media/MediaInfoDialog";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { AccessDialog } from "./AccessDialog";

const ROWS = (d: Dictionary): [string, string][] => [[d.body.library.selCompetition, "ball"], [d.body.library.selMatch, "calendar"], [d.body.library.selPlayers, "user"],
  [d.body.library.selCreatedBy, "cir"], [d.body.library.selCurated, "clock"], [d.body.library.selDuration, "clock"], [d.body.library.selFileSize, "img"],
  [d.body.library.selResolution, "img"], [d.body.library.selTags, "tagdot"]];
const permName = (p: ProjectPermission, d: Dictionary): string => ({ READ: d.body.library.permViewer, REVIEW: d.body.library.permReviewer, EDIT: d.body.library.permEditor, ADMIN: d.body.library.permManager })[p];
const mb = (b: number | null) => (b === null ? "—" : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
const dur = (us: number | null) => (us ? `${Math.floor(us / 6e7)}:${String(Math.round(us / 1e6) % 60).padStart(2, "0")}` : "—");

export const SelectedItem = memo(function SelectedItem({ a, match, onClose, reload, canWrite }: { a: Asset | null; match: Match | null; onClose: () => void; reload: () => Promise<void>; canWrite: boolean }) {
  const { t: dict } = useLocale();
  const [play, setPlay] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [access, setAccess] = useState(false);
  const [info, setInfo] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => { setPlay(null); setNote(null); }, [a?.key]);
  const [members, setMembers] = useState<Member[] | null>(null);
  useEffect(() => { void api<Member[]>("/v1/members").then(setMembers, () => setMembers(null)); }, []);
  // the note's timer is tracked and cleared on unmount, so it never fires into a removed panel
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  const flash = (t: string) => { setNote(t); if (flashTimer.current) clearTimeout(flashTimer.current); flashTimer.current = setTimeout(() => setNote(null), 2500); };
  const reel = a?.kind === "Reel" || a?.kind === "Export" ? (a.raw as Reel) : null;
  const renderId = a?.renderId ?? (reel?.last_good_render?.has_output ? reel.last_good_render.id : null);
  const videoId = a?.videoId ?? null;
  const canPlay = !!renderId || !!videoId;
  const start = async () => {
    try {
      if (renderId) setPlay((await api<{ url: string }>(`/v1/renders/${renderId}/playback`)).url);
      else if (videoId) { const p = await api<Playback>(`/v1/videos/${videoId}/playback`); if (p.available && p.url) setPlay(p.url); else flash(dict.body.library.selNoPlayback.replace("{a}", p.reason ?? dict.body.library.beingPrepared)); }
    } catch { flash(dict.body.library.selPlaybackUnavailable); }
  };
  const download = renderId ? async () => {
    try { location.href = (await api<{ download_url: string }>(`/v1/renders/${renderId}/playback`)).download_url; } catch { flash(dict.body.library.selDownloadUnavailable); }
  } : undefined;
  const renamable = !!a && canWrite && (a.kind === "Reel" || a.kind === "Folder" || a.kind === "Project" || a.kind === "Video");
  const whyNoRename = !a ? dict.body.library.selPickFirst : !canWrite ? dict.body.library.selRoleNoRename
    : a.kind === "Match" ? dict.body.library.selMatchRenameWhy : a.kind === "Export" ? dict.body.library.selExportRenameWhy : dict.body.library.selCannotRename;
  const pickFirst = dict.body.library.selPickFirst;
  const rename = async () => {
    try {
      if (a!.kind === "Reel") await api(`/v1/reels/${a!.id}`, { method: "PATCH", json: { version: (a!.raw as Reel).version, name } });
      else if (a!.kind === "Video") await api(`/v1/videos/${a!.id}`, { method: "PATCH", json: { title: name } });
      else if (a!.kind === "Folder") await api(`/v1/library/folders/${a!.id}`, { method: "PATCH", json: { version: (a!.raw as LibraryFolder).version, name } });
      else await api(`/v1/projects/${a!.id}`, { method: "PATCH", json: { version: (a!.raw as Project).version, name } });
      setNaming(false); await reload();
    } catch (x) { flash(x instanceof ApiProblem ? x.message : dict.body.library.selRenameFailed); }
  };
  const vals: string[] = a ? [
    a.competition ?? "—", match ? `${match.home?.name ?? "—"} vs ${match.away?.name ?? "—"}` : "—", a.player ?? "—",
    (a.createdBy && members?.find((m) => m.user_id === a.createdBy)?.display_name) ?? "—",
    a.created ? new Date(a.created).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—", dur(a.durationUs), mb(a.bytes),
    a.width && a.height ? `${a.width} × ${a.height}` : "—", "—",
  ] : ROWS(dict).map(() => "—");

  return (
    <aside aria-label={dict.body.library.selHeading} className="vie-panel flex min-w-0 flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="t-panel text-primary">{dict.body.library.selHeading}</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => (videoId ? setInfo(true) : flash(a ? dict.body.library.selNoSourceVideo : pickFirst))} data-action="media-info"
            title={a?.kind === "Video" ? dict.body.library.selMediaInfoFile : dict.body.library.selMediaInfoSource}
            className="flex items-center gap-1 px-1 py-1 text-sm text-primary hover:underline disabled:opacity-60">
            <Info className="h-4 w-4" aria-hidden />{dict.body.library.selMediaInfo}
          </button>
          <button type="button" aria-label={dict.body.library.selClearSelection} onClick={a ? onClose : () => flash(dict.body.library.selNothingSelected)} className="vie-ib h-7 w-7">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
      <MediaInfoDialog videoId={videoId} name={a?.kind === "Video" ? a.title : dict.body.library.selSourceOf.replace("{a}", a?.title ?? "")} open={info} onOpenChange={setInfo} />

      <section aria-label={dict.body.library.selPreviewSection} data-section="p09-s07">
        {play ? (
          <VideoPlayer src={play} label={dict.body.library.selPreviewAria.replace("{a}", a?.title ?? "")} autoPlay />
        ) : (
          <div className="relative grid aspect-video place-items-center overflow-hidden rounded-md border border-line bg-p0">
            <button type="button" aria-label={canPlay ? dict.body.library.selPlay.replace("{a}", a?.title ?? "") : dict.body.library.selNothingToPlay}
              onClick={() => (canPlay ? void start() : flash(a ? dict.body.library.selNoVideoToPlay : pickFirst))}
              className="grid h-[72px] w-[72px] place-items-center rounded-full border border-white/40 bg-black/60 text-white hover:bg-black/80">
              <Play className="ml-1 h-8 w-8 fill-current" aria-hidden />
            </button>
            {a?.durationUs ? <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-black/75 px-1.5 py-0.5 text-xs tabular-nums text-white">{dur(a.durationUs)}</span> : null}
            {!canPlay && <span className="absolute bottom-1.5 left-1.5 text-xs text-muted">{a ? dict.body.library.selNoVideoToPlay : pickFirst}</span>}
          </div>
        )}
      </section>

      <section aria-label={dict.body.library.selMetaSection} data-section="p09-s08" className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate t-panel">{a?.title ?? dict.body.library.selNoAssetSelected}</h3>
          <button type="button" aria-label="Edit the name" title={renamable ? dict.body.library.rename : whyNoRename} aria-disabled={!renamable || undefined}
            onClick={() => { if (!renamable) return flash(whyNoRename); setName(a!.title); setNaming(true); }}
            className="vie-btn vie-btn-sm shrink-0">
            <Pencil className="h-3.5 w-3.5" aria-hidden />{dict.body.library.selEdit}
          </button>
        </div>
        {a && (
          <p className="flex flex-wrap gap-1.5">
            <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-normal text-white">{kindLabel(a.kind, dict)}</span>
            <span className="rounded-md border border-line bg-raised px-2 py-0.5 text-xs">{statusLabel(a.status, dict)}</span>
          </p>
        )}
        <p className="truncate text-sm text-muted">{a ? a.sub : dict.body.library.selSelectToSee}</p>
        <dl className="m-0 flex flex-col">
          {ROWS(dict).map(([l], i) => (
            <div key={l} className="flex items-baseline gap-2 border-b border-line/40 py-1 text-sm last:border-0">
              <dt className="w-32 shrink-0 text-muted">{l}</dt>
              <dd className="m-0 min-w-0 flex-1 truncate">{vals[i]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label={dict.body.library.selActionsSection} data-section="p09-s09" className="flex flex-col gap-2">
        <button type="button" aria-label={dict.body.library.selDownloadMp4Aria} title={download ? dict.body.library.selDownload : dict.body.library.selOnlyRendered} aria-disabled={!download || undefined}
          onClick={download ?? (() => flash(a ? dict.body.library.selOnlyRenderedLong : pickFirst))}
          className="vie-btn vie-btn-pri w-full disabled:opacity-60">
          <Download className="h-4 w-4" aria-hidden />{dict.body.library.download}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" aria-label={dict.body.library.share} title={a?.href ? dict.body.library.share : pickFirst}
            onClick={a?.href ? () => { void navigator.clipboard?.writeText(`${location.origin}${a.href}`).then(() => flash(dict.body.library.selLinkCopied), () => flash(dict.body.library.selCopyFailed)); } : () => flash(pickFirst)}
            className="vie-btn">
            <Link2 className="h-4 w-4" aria-hidden />{dict.body.library.share}
          </button>
          <button type="button" aria-label={dict.body.library.selDuplicate}
            title={!a ? pickFirst : !reel ? dict.body.library.selOnlyReelDuplicate : dict.body.library.selRoleNoCopy}
            onClick={reel && canWrite ? () => {
              void api<Reel>(`/v1/reels/${reel.id}/duplicate`, { method: "POST" }).then(async (c) => { await reload(); flash(dict.body.library.selCopiedAs.replace("{a}", c.name)); },
                (x) => flash(x instanceof ApiProblem ? x.message : dict.body.library.selDuplicateFailed));
            } : () => flash(!a ? pickFirst : !reel ? dict.body.library.selOnlyReelDuplicate : dict.body.library.selRoleNoCopy)}
            className="vie-btn">
            {dict.body.library.selDuplicate}
          </button>
          <button type="button" aria-label={dict.body.library.sendToClient} title={reel ? dict.body.library.sendToClient : !a ? pickFirst : dict.body.library.selOnlyReelClient}
            onClick={reel ? () => { window.location.href = `/exports?reel=${reel.id}`; } : () => flash(!a ? pickFirst : dict.body.library.selOnlyReelClient)}
            className="vie-btn">
            <Send className="h-4 w-4" aria-hidden />{dict.body.library.sendToClient}
          </button>
          {videoId ? (
            <Link href={`/videos/${videoId}/analyze`} aria-label={dict.body.library.openInAnalysis} className="vie-btn">
              {dict.body.library.openInAnalysis}
            </Link>
          ) : (
            <button type="button" aria-label={dict.body.library.openInAnalysis} title={a ? dict.body.library.selNoSourceVideo : pickFirst}
              onClick={() => flash(a ? dict.body.library.selNoSourceVideo : pickFirst)} className="vie-btn">
              {dict.body.library.openInAnalysis}
            </button>
          )}
        </div>
        {note && <p role="status" className="text-center text-xs text-primary">{note}</p>}
      </section>

      <section aria-label={dict.body.library.selAccessSection} data-section="p09-s10" className="flex flex-col gap-2 border-t border-line pt-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-normal">{dict.body.library.selCollaborators} {a?.project ? <span className="ml-1 rounded-md border border-line bg-raised px-1.5 text-xs">{a.project.collaborators.length}</span> : null}</h2>
          <button type="button" data-manage-access onClick={() => (!a ? flash(pickFirst) : !a.project ? flash(a.kind === "Folder" ? dict.body.library.selFolderAccess : dict.body.library.selMatchAccess) : setAccess(true))}
            className="text-sm text-primary hover:underline disabled:opacity-60">{dict.body.library.manageAccess}</button>
        </div>
        {!a?.project ? <p className="text-sm text-muted">{a ? dict.body.library.selNotInProject : dict.body.library.selSelectAsset}</p> : (
          <ul aria-label={dict.body.library.selPeopleAria} className="flex flex-wrap items-center gap-1.5">
            {a.project.collaborators.slice(0, 6).map((m) => (
              <li key={m.user_id} title={`${m.display_name} · ${permName(m.permission, dict)}`} aria-label={`${m.display_name}, ${permName(m.permission, dict)}`}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-normal text-white">
                {m.display_name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </li>
            ))}
            {a.project.collaborators.length > 6 && <li className="text-xs text-ink">+{a.project.collaborators.length - 6}</li>}
            <li className="ml-1 text-xs text-muted">{a.project.access === "RESTRICTED" ? dict.body.library.selOnlyThesePeople : dict.body.library.peopleEveryone}</li>
          </ul>
        )}
      </section>

      <AccessDialog projectId={a?.project?.id ?? null} projectName={a?.project?.name ?? ""} open={access} onOpenChange={setAccess} onChanged={reload} />
      <Dialog.Root open={naming} onOpenChange={setNaming}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
            <Dialog.Title className="text-base font-normal">{dict.body.library.rename}</Dialog.Title>
            <Dialog.Description className="mb-3 text-xs text-muted">{a?.kind === "Folder" ? dict.body.library.selRenameFolder : a?.kind === "Project" ? dict.body.library.selRenameProject : a?.kind === "Video" ? dict.body.library.selRenameVideo : dict.body.library.selRenameReel}</Dialog.Description>
            <form onSubmit={(e) => { e.preventDefault(); void rename(); }}>
              <input value={name} onChange={(e) => setName(e.target.value)} required minLength={a?.kind === "Project" ? 2 : 1} maxLength={200} aria-label={dict.body.library.selNameAria}
                className="mb-3 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-ink" />
              <div className="flex justify-end gap-2">
                <Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{dict.common.cancel}</Dialog.Close>
                <button type="submit" className="rounded-ctl bg-primary px-3 py-1.5 font-normal text-white">{dict.common.save}</button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </aside>
  );
});
