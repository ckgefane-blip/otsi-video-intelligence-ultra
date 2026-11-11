"use client";
/**
 * Page 09 Sections 01–06 — header and New Project, asset tabs, search and filters, saved searches, the asset table, and its status and
 * collaboration columns (approved reference 09_LIBRARY_PROJECT_CENTER).
 *
 * New Project creates a real project (POST /v1/projects); its menu also offers Upload and Reel Builder. Tab counts, search, filters and
 * the Updated sort run on the real asset list. "Created by" is not recorded on these assets, so that filter has one option. Saved
 * searches are the person's own, kept by the server (GET/POST/DELETE /v1/saved-searches). Per-asset collaborators are not recorded: "—".
 */
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { B, Ic, T, stageStyles as s, u } from "@/components/stage/DesignStage";
import { MoreMenu, copyLink, type MoreItem } from "@/components/stage/MoreMenu";
import { reelActions, renderActions, videoActions } from "@/lib/actions";
import { typing } from "@/lib/keymap";
import { api, ApiProblem } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { ArchiveDialog } from "@/components/exportstage/ArchiveBundle";
import type { ArchiveSubjectKind, LibraryFolder, Match, Member, Reel, RemovableKind, RemovalPreview, SavedSearch, TrashEntry } from "@otsi-vie/contracts";
import { ITEM_KIND, NO_FILTERS, RANGES, TABS, kindLabel, statusLabel, type Asset, type Filters, type Kind } from "./useLibrary";
import { LibraryTable, rowsCsv, useLibraryFacts, useLibraryView } from "./LibraryTable";

const Y = [587, 678, 767, 857, 946, 1036, 1125, 1211, 1298, 1385];
const TAB_GEO: [number, number, number, number][] = [[454, 482, 590, 42], [687, 714, 770, 32], [852, 881, 960, 34], [1048, 1079, 1170, 36], [1247, 1278, 1364, 34],
  [1441, 1467, 1548, 34], [1617, 1645, 0, 0], [1821, 1847, 1948, 24]];
export const TY: Record<Kind, [string, string, string]> = {
  Reel: ["#0a2f5a", "#1d6fc0", "#cfe8ff"], Report: ["#2a0f70", "#6a3ff0", "#d6c8ff"], Folder: ["#4a3000", "#f5b82e", "#ffd36a"], Project: ["#3a1440", "#b04ac0", "#f2c8ff"],
  Match: ["#06402a", "#1fc27a", "#9ff0c8"], Export: ["#0a1d38", "#4a6a98", "#e3eefb"], Video: ["#0a2a3a", "#2a8ab0", "#bfefff"], Template: ["#2d1b4e", "#7b3fe4", "#e8d8ff"],
};
const ST: Record<Asset["status"], [string, string, string]> = {
  Published: ["#063a2a", "#1a8a5e", "#3ee6a8"], Ready: ["#063a2a", "#1a8a5e", "#3ee6a8"], Draft: ["#1a2840", "#4a5a78", "#dfe8f5"], Archived: ["#1a2840", "#4a5a78", "#dfe8f5"],
  Shared: ["#2a0f60", "#6a3ff0", "#e0d0ff"], Exported: ["#06305a", "#1e6fc0", "#cfe8ff"], Processing: ["#2a0f60", "#6a3ff0", "#e0d0ff"], Failed: ["#3a0f18", "#a83a4a", "#ff9aa8"],
};
const field = { border: `${u(1.5)} solid #17406f`, borderRadius: u(8), background: "#041022", boxSizing: "border-box" as const };
const clock = (us: number | null) => (us ? `${Math.floor(us / 6e7)}:${String(Math.round(us / 1e6) % 60).padStart(2, "0")}` : "—");
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/** who is on the item's project (ADR-057): up to three initials, a lock when only they (and Owners / Admins) can see it */
const people = (a: Asset, d: Dictionary) => !a.project ? d.body.library.noProject : a.project.access === "RESTRICTED"
  ? d.body.library.peopleRestricted.replace("{a}", String(a.project.collaborators.length)).replace("{b}", a.project.collaborators.length === 1 ? d.body.library.personOne : d.body.library.personMany)
  : a.project.collaborators.length ? d.body.library.peopleTeam.replace("{a}", a.project.collaborators.map((c) => c.display_name).join(", ")) : d.body.library.peopleEveryone;
function Collaborators({ a, y }: { a: Asset; y: number }) {
  const { t: dict } = useLocale();
  if (!a.project) return <T x={1372} y={y} size={19} color="#8ea3bf">—</T>;
  const c = a.project.collaborators, locked = a.project.access === "RESTRICTED";
  return (
    <div className="absolute" title={people(a, dict)} data-collaborators={String(c.length)} data-access={a.project.access}
      style={{ left: u(1352), top: u(y - 101 - 17), height: u(34), display: "flex", alignItems: "center", gap: u(4), pointerEvents: "auto" }}>
      {locked && <span aria-hidden style={{ fontSize: u(18), marginRight: u(2) }}>🔒</span>}
      {c.slice(0, 3).map((m) => (
        <span key={m.user_id} style={{ width: u(32), height: u(32), borderRadius: "50%", background: "#2b5ff0", display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: u(13), fontWeight: 700, border: `${u(2)} solid #051022`, marginLeft: u(-6) }}>{initials(m.display_name)}</span>
      ))}
      {c.length > 3 && <span style={{ fontSize: u(15), color: "#cfe0f5", marginLeft: u(2) }}>+{c.length - 3}</span>}
      {!c.length && <span style={{ fontSize: u(17), color: "#8ea3bf" }}>{locked ? dict.body.library.ownersAdmins : dict.body.library.everyone}</span>}
    </div>
  );
}

/** always opens; an option with a third entry (the reason) is listed greyed and cannot be chosen */
function FilterBox<V extends string>({ x, w, label, value, options, onChange, size = 20 }:
  { x: number; w: number; label: string; value: V; options: ([V, string] | [V, string, string])[]; onChange: (v: V) => void; size?: number }) {
  return (
    <div className="absolute" style={{ left: u(x), top: u(322 - 101), width: u(w), height: u(70), ...field }}>
      <T o={[x + 1.5, 323.5]} x={x + 20} y={344} size={17} color="#8ea3bf" as="span">{label}</T>
      <T o={[x + 1.5, 323.5]} x={x + 20} y={370} size={size} color="#e3eefb" as="span" style={{ maxWidth: u(w - 50), overflow: "hidden", textOverflow: "ellipsis" }}>{options.find((o) => o[0] === value)?.[1] ?? ""}</T>
      <Ic o={[x + 1.5, 323.5]} x={x + w - 22} y={357} k="chev" size={18} />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as V)}
        style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}>
        {options.map(([v, l, why]) => <option key={v} value={v} disabled={!!why}>{why ? `${l} — ${why}` : l}</option>)}
      </select>
    </div>
  );
}

/** the row's three-dots menu (owner 2026-11-02): the real actions for that kind of asset, plus its details on the right */
/** Library › Delete (ADR-052, ADR-074). Delete… opens a dialog that first asks the server what goes with the item (GET /v1/library/:kind/:id/removal).
 *  Only what the person chose goes: a reel with its own rendered files; a rendered file alone; a match, whose videos stay (unlinked); a
 *  folder, whose items stay. A video still used by reels, or a project still holding videos or reels, is refused with the list of what to
 *  delete first. Confirm moves it to the Trash as one entry (DELETE /v1/library/:kind/:id); the Trash restores it. */
const KIND = (d: Dictionary): Partial<Record<Kind, [RemovableKind, string, (a: Asset) => string | null]>> => ({
  Reel: ["reel", d.body.library.deleteNounReel, (a) => a.id], Export: ["render", d.body.library.deleteNounRender, (a) => a.renderId ?? null], Video: ["video", d.body.library.deleteNounVideo, (a) => a.videoId ?? null],
  Match: ["match", d.body.library.deleteNounMatch, (a) => a.id], Project: ["project", d.body.library.deleteNounProject, (a) => a.id], Folder: ["folder", d.body.library.deleteNounFolder, (a) => a.id],
});
interface DeleteTarget { kind: RemovableKind; noun: string; id: string; title: string }

function deleteItem(a: Asset, canWrite: boolean, open: (t: DeleteTarget) => void, dict: Dictionary): MoreItem {
  const d = KIND(dict)[a.kind], id = d?.[2](a) ?? null;
  if (!d || !id) return { label: dict.body.library.deleteItem, why: dict.body.library.deleteCannotHere };
  if (!canWrite) return { label: dict.body.library.deleteItem, why: dict.body.library.deleteRoleNoDelete };
  return { label: dict.body.library.deleteItemDots, run: () => open({ kind: d[0], noun: d[1], id, title: a.title }) };
}

const plural = (n: number, d: Dictionary, one: string, many: string) => n === 1 ? one : many.replace("{a}", String(n));

function DeleteDialog({ target, close, done }: { target: DeleteTarget | null; close: () => void; done: (msg: string) => Promise<void> }) {
  const { t: dict } = useLocale();
  const [pre, setPre] = useState<RemovalPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPre(null); setErr(null); setBusy(false);
    if (!target) return;
    let live = true;
    api<RemovalPreview>(`/v1/library/${target.kind}/${target.id}/removal`).then((r) => { if (live) setPre(r); },
      (e) => { if (live) setErr(e instanceof ApiProblem ? e.message : dict.body.library.deleteCheckFailed); });
    return () => { live = false; };
  }, [target]);
  const folder = target?.kind === "folder";
  const go = async () => {
    if (!target) return;
    setBusy(true); setErr(null);
    try {
      await api(`/v1/library/${target.kind}/${target.id}`, { method: "DELETE" });
      await done(folder ? dict.body.library.deleteFolderDone : dict.body.library.deleteMovedToTrash.replace("{a}", `${target.noun[0]!.toUpperCase()}${target.noun.slice(1)}`));
    } catch (e) { setErr(e instanceof ApiProblem ? e.message : dict.body.library.deleteFailed); setBusy(false); }
  };
  const lines: string[] = [];
  if (pre && !folder) {
    if (pre.renders) lines.push(dict.body.library.deleteRenderedLine.replace("{a}", plural(pre.renders, dict, dict.body.library.deleteRenderedOne, dict.body.library.deleteRenderedMany)));
    if (pre.share_links) lines.push(dict.body.library.deleteShareLine.replace("{a}", plural(pre.share_links, dict, dict.body.library.deleteShareOne, dict.body.library.deleteShareMany)));
    if (pre.running_analyses) lines.push(plural(pre.running_analyses, dict, dict.body.library.deleteAnalysisOne, dict.body.library.deleteAnalysisMany));
  }
  return (
    <Dialog.Root open={!!target} onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(500px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{dict.body.library.deleteTitle.replace("{a}", target?.noun ?? "").replace("{b}", target?.title ?? "")}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">
            {folder ? dict.body.library.deleteFolderDesc : dict.body.library.deleteDesc}
          </Dialog.Description>
          {!pre && !err && <p className="text-muted">{dict.body.library.deleteChecking}</p>}
          {pre && folder && <p className="mb-3">{pre.kept_items === 1 ? dict.body.library.deleteFolderKeptOne : pre.kept_items ? dict.body.library.deleteFolderKeptMany.replace("{a}", String(pre.kept_items)) : dict.body.library.deleteFolderEmpty}</p>}
          {pre && lines.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 font-semibold">{dict.body.library.deleteGoesWith}</p>
              <ul className="list-disc space-y-0.5 pl-5">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          )}
          {pre && !pre.blocked && (pre.unlinked?.length ?? 0) > 0 && (
            <p className="mb-3" data-unlinked>{pre.unlinked.length === 1 ? dict.body.library.deleteUnlinkedOne : dict.body.library.deleteUnlinkedMany.replace("{a}", String(pre.unlinked.length))}: {pre.unlinked.map((v) => v.title).join(", ")}. {pre.unlinked.length === 1 ? dict.body.library.deleteRelinkIt : dict.body.library.deleteRelinkThem}</p>
          )}
          {pre && !folder && lines.length === 0 && !pre.blocked && <p className="mb-3">{dict.body.library.deleteNothingElse}</p>}
          {pre?.blocked && <p role="alert" className="mb-3 text-danger">{pre.blocked}</p>}
          {err && <p role="alert" className="mb-3 text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <Dialog.Close disabled={busy} className="rounded-ctl border border-line px-3 py-1.5">{dict.common.cancel}</Dialog.Close>
            <button type="button" disabled={!pre || !!pre.blocked || busy} onClick={() => void go()}
              className="rounded-ctl px-3 py-1.5 font-semibold text-white disabled:opacity-40" style={{ background: "#c23a4e" }}>
              {busy ? dict.body.library.deleteDeleting : folder ? dict.body.library.deleteFolderBtn : pre?.renders ? dict.body.library.deleteMoveWithRenders : dict.body.library.deleteMoveToTrash}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Library › Move to folder (ADR-052): a folder only groups items, so this changes one row (PUT /v1/library/folder-items/:kind/:id) */
interface MoveTarget { kind: string; id: string; title: string; from: string | null; /** B.12 bulk move: the other items moved with it */ more?: { kind: string; id: string }[] }

function moveItem(a: Asset, canWrite: boolean, open: (t: MoveTarget) => void, dict: Dictionary): MoreItem | null {
  const kind = ITEM_KIND[a.kind], id = a.kind === "Export" ? a.renderId : a.id;
  if (!kind || !id) return null;
  if (!canWrite) return { label: dict.body.library.moveToFolder, why: dict.body.library.moveRoleNoMove };
  return { label: a.folderId ? dict.body.library.moveToAnotherFolder : dict.body.library.moveToFolderDots, run: () => open({ kind, id, title: a.title, from: a.folderId }) };
}

function MoveDialog({ target, folders, close, done }: { target: MoveTarget | null; folders: LibraryFolder[]; close: () => void; done: (msg: string) => Promise<void> }) {
  const { t: dict } = useLocale();
  const [to, setTo] = useState<string>("new");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setTo(folders.find((f) => f.id !== target?.from)?.id ?? "new"); setName(""); setErr(null); setBusy(false);
  }, [target]);  // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    if (!target) return;
    setBusy(true); setErr(null);
    try {
      let id: string | null = to === "none" ? null : to, label = folders.find((f) => f.id === to)?.name ?? "";
      if (to === "new") {
        if (!name.trim()) { setErr(dict.body.library.moveNameNeeded); setBusy(false); return; }
        id = (await api<LibraryFolder>("/v1/library/folders", { method: "POST", json: { name: name.trim() } })).id; label = name.trim();
      }
      for (const it of [{ kind: target.kind, id: target.id }, ...(target.more ?? [])]) await api(`/v1/library/folder-items/${it.kind}/${it.id}`, { method: "PUT", json: { folder_id: id } });
      const n = 1 + (target.more?.length ?? 0);
      await done(id ? (n > 1 ? dict.body.library.moveDoneManyToFolder.replace("{a}", String(n)).replace("{b}", label) : dict.body.library.moveDoneOneToFolder.replace("{a}", label)) : n > 1 ? dict.body.library.moveTakenOutMany.replace("{a}", String(n)) : dict.body.library.moveTakenOutOne);
    } catch (e) { setErr(e instanceof ApiProblem ? e.message : dict.body.library.moveFailed); setBusy(false); }
  };
  return (
    <Dialog.Root open={!!target} onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(480px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{target?.more?.length ? dict.body.library.moveTitleMany.replace("{a}", String(target.more.length + 1)) : <>{dict.body.library.moveTitleOne.replace("{a}", target?.title ?? "")}</>}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{dict.body.library.moveDesc}</Dialog.Description>
          <label className="mb-2 block">
            <span className="mb-1 block text-xs text-muted">{dict.body.library.moveFolderLabel}</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} aria-label={dict.body.library.moveFolderLabel} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-ink">
              {folders.filter((f) => f.id !== target?.from).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              <option value="new">{dict.body.library.moveNewFolder}</option>
              {target?.from && <option value="none">{dict.body.library.moveNotInFolder}</option>}
            </select>
          </label>
          {to === "new" && (
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} placeholder={dict.body.library.moveNewFolderName} aria-label={dict.body.library.moveNewFolderName} autoFocus
              className="mb-2 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-ink" />
          )}
          {err && <p role="alert" className="mb-2 text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <Dialog.Close disabled={busy} className="rounded-ctl border border-line px-3 py-1.5">{dict.common.cancel}</Dialog.Close>
            <button type="button" disabled={busy} onClick={() => void go()} className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white disabled:opacity-40">
              {busy ? dict.body.library.moveMoving : dict.body.library.moveMoveBtn}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Library › Trash (ADR-052): every delete is one entry; Restore brings back everything it removed (POST /v1/library/trash/:id/restore) */
const KIND_LABEL = (d: Dictionary): Record<RemovableKind, string> => ({ reel: d.body.library.kindLabelReel, render: d.body.library.kindLabelRender, video: d.body.library.kindLabelVideo, match: d.body.library.kindLabelMatch, project: d.body.library.kindLabelProject, folder: d.body.library.kindLabelFolder });

function TrashDialog({ open, close, canWrite, changed }: { open: boolean; close: () => void; canWrite: boolean; changed: (msg: string) => Promise<void> }) {
  const { t: dict } = useLocale();
  const [rows, setRows] = useState<TrashEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api<TrashEntry[]>("/v1/library/trash").then(setRows, () => setErr(dict.body.library.trashLoadFailed));
  useEffect(() => { setRows(null); setErr(null); if (open) void load(); }, [open]);  // eslint-disable-line react-hooks/exhaustive-deps
  const restore = async (t: TrashEntry) => {
    setBusy(t.id); setErr(null);
    try {
      const r = await api<{ restored: number; not_restorable: number }>(`/v1/library/trash/${t.id}/restore`, { method: "POST" });
      await load();
      await changed(dict.body.library.trashRestored.replace("{a}", t.title).replace("{b}", r.not_restorable ? dict.body.library.trashNotRestorable.replace("{a}", plural(r.not_restorable, dict, dict.body.library.trashUnfinishedOne, dict.body.library.trashUnfinishedMany)) : ""));
    } catch (e) { setErr(e instanceof ApiProblem ? e.message : dict.body.library.trashRestoreFailed); }
    setBusy(null);
  };
  const withText = (t: TrashEntry) => [t.with.videos && plural(t.with.videos, dict, dict.body.library.trashWithVideoOne, dict.body.library.trashWithVideoMany), t.with.reels && plural(t.with.reels, dict, dict.body.library.trashWithReelOne, dict.body.library.trashWithReelMany),
    t.with.renders && plural(t.with.renders, dict, dict.body.library.trashWithRenderOne, dict.body.library.trashWithRenderMany)].filter(Boolean).join(", ");
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[min(640px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{dict.body.library.trash}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{dict.body.library.trashDesc}</Dialog.Description>
          {err && <p role="alert" className="mb-2 text-danger">{err}</p>}
          {!rows && !err && <p className="text-muted">{dict.common.loading}</p>}
          {rows && rows.length === 0 && <p className="text-muted">{dict.body.library.trashEmpty}</p>}
          {rows && rows.length > 0 && (
            <ul aria-label={dict.body.library.deletedItems} className="-mx-1 flex-1 space-y-1 overflow-y-auto px-1">
              {rows.map((t) => (
                <li key={t.id} data-trash={t.kind} className="flex items-center gap-3 rounded-ctl border border-line px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{t.title} <span className="font-normal text-muted">· {KIND_LABEL(dict)[t.kind]}</span></p>
                    <p className="truncate text-xs text-muted">
                      {dict.body.library.trashDeleted.replace("{a}", new Date(t.deleted_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })).replace("{b}", t.deleted_by ? dict.body.library.trashDeletedBy.replace("{a}", t.deleted_by) : "")}
                      {withText(t) ? dict.body.library.trashWith.replace("{a}", withText(t)) : ""}
                      {t.days_remaining !== undefined && t.days_remaining !== null ? (
                        <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-mono ${t.days_remaining === 0 ? "bg-amber/20 text-amber font-semibold" : "bg-panel border border-line text-muted"}`}>
                          · {t.days_remaining === 0 ? dict.body.library.trashEligiblePurge : dict.body.library.trashDaysLeft.replace("{a}", String(t.days_remaining))}
                        </span>
                      ) : null}
                    </p>
                    {t.blocked && <p className="text-xs text-amber">{t.blocked}</p>}
                  </div>
                  <button type="button" disabled={!canWrite || !!t.blocked || busy !== null} onClick={() => void restore(t)}
                    title={!canWrite ? dict.body.library.trashRoleNoRestore : t.blocked ?? dict.body.library.trashRestore}
                    className="shrink-0 rounded-ctl border border-line px-3 py-1.5 font-semibold disabled:opacity-40">{busy === t.id ? dict.body.library.trashRestoring : dict.body.library.trashRestore}</button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center justify-between">
            <div>
              {canWrite && rows && rows.some((r) => r.can_purge) ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy("purge");
                    try {
                      const res = await api<{ purged_count: number }>("/v1/admin/retention/trash/purge", { method: "POST", json: {} });
                      await load();
                      await changed(dict.body.library.trashPurged.replace("{a}", plural(res.purged_count, dict, dict.body.library.trashPurgedOne, dict.body.library.trashPurgedMany)));
                    } catch (e) {
                      setErr(e instanceof ApiProblem ? e.message : dict.body.library.trashPurgeFailed);
                    }
                    setBusy(null);
                  }}
                  className="rounded-ctl border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/20 disabled:opacity-40"
                >
                  {busy === "purge" ? dict.body.library.trashPurging : dict.body.library.trashPurgeExpired}
                </button>
              ) : null}
            </div>
            <Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{dict.common.close}</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** a new Library folder (New Project ▾ › New folder) */
function NewFolderDialog({ open, close, done }: { open: boolean; close: () => void; done: (f: LibraryFolder) => Promise<void> }) {
  const { t: dict } = useLocale();
  const [name, setName] = useState(""); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setName(""); setErr(null); }, [open]);
  const go = async () => {
    try { await done(await api<LibraryFolder>("/v1/library/folders", { method: "POST", json: { name: name.trim() } })); }
    catch (e) { setErr(e instanceof ApiProblem ? e.message : dict.body.library.newFolderFailed); }
  };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{dict.body.library.newFolder}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{dict.body.library.newFolderDesc}</Dialog.Description>
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void go(); else setErr(dict.body.library.newFolderNameNeeded); }} className="space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} placeholder={dict.body.library.newFolderName} aria-label={dict.body.library.newFolderName} autoFocus
              className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-ink" />
            {err && <p role="alert" className="text-danger">{err}</p>}
            <div className="flex justify-end gap-2">
              <Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{dict.common.cancel}</Dialog.Close>
              <button type="submit" className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white">{dict.body.library.createFolder}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function archiveItem(a: Asset, open: (t: { kind: ArchiveSubjectKind; id: string; title: string }) => void, dict: Dictionary): MoreItem | null {
  if (a.kind === "Reel") return { label: dict.body.library.archiveReel, run: () => open({ kind: "REEL", id: a.id, title: a.title }) };
  if (a.kind === "Video" && a.videoId) return { label: dict.body.library.archiveVideo, run: () => open({ kind: "VIDEO", id: a.videoId!, title: a.title }) };
  if (a.kind === "Match") return { label: dict.body.library.archiveMatch, run: () => open({ kind: "MATCH", id: a.id, title: a.title }) };
  return null;
}

function assetActions(a: Asset, details: () => void, del: MoreItem, move: MoreItem | null, arch: MoreItem | null, openFolder: (id: string) => void, dict: Dictionary): MoreItem[] {
  const info: MoreItem = { label: dict.body.library.detailsRename, run: details };
  const tail = [info, ...(arch ? [arch] : []), ...(move ? [move] : []), del];
  if (a.kind === "Folder") return [{ label: dict.body.library.openFolder, run: () => openFolder(a.id) }, info, del];
  if (a.kind === "Reel") return [...reelActions(a.raw as Reel, dict), ...tail];
  if (a.kind === "Export" && a.renderId) return [...renderActions(a.renderId, (a.raw as Reel).id, dict), ...tail];
  if (a.kind === "Video" && a.videoId) return [...videoActions(a.videoId, dict), ...tail];
  if (a.kind === "Match") {
    const v = (a.raw as Match).video_ids[0];
    return [...(v ? videoActions(v, dict) : [{ label: dict.body.library.openInAnalysis, why: dict.body.library.matchNoVideo }]),
      { label: dict.body.library.setScoreDetails, href: v ? `/upload?video=${v}` : "/upload" }, ...tail];
  }
  if (a.kind === "Project") return [{ label: dict.body.library.uploadIntoProject, href: `/upload?project=${a.id}` }, ...tail];
  return [...(a.href ? [{ label: dict.body.library.openBtn, href: a.href }, { label: dict.body.library.menuCopyLink, run: () => copyLink(a.href!) }] : []), ...tail];
}

/** one card row (memoised: typing in search or opening a dialog re-renders LibraryMain, not every row) */
const AssetRow = memo(function AssetRow({ a, y, i, sel, on, canWrite, folder, folders, select, setFolder, toggleChecked, setDeleting, setMoving, setArchiving }: {
  a: Asset; y: number; i: number; sel: boolean; on: boolean; canWrite: boolean; folder: string | null; folders: LibraryFolder[];
  select: (k: string | null) => void; setFolder: (id: string | null) => void; toggleChecked: (key: string, wasOn: boolean) => void;
  setDeleting: (t: (DeleteTarget & { key: string }) | null) => void; setMoving: (t: MoveTarget | null) => void;
  setArchiving: (t: { kind: ArchiveSubjectKind; id: string; title: string } | null) => void;
}) {
  const { t: dict } = useLocale();
  const ty = TY[a.kind];
  const items = useMemo(() => assetActions(a, () => select(a.key),
    deleteItem(a, canWrite, (t) => setDeleting({ ...t, key: a.key }), dict), moveItem(a, canWrite, setMoving, dict), archiveItem(a, setArchiving, dict),
    (id) => { select(null); setFolder(id); }, dict),
    [a, canWrite, select, setFolder, setDeleting, setMoving, setArchiving, dict]);
  return (
    <div data-asset={a.kind} data-id={a.id}>
      {sel && <B x={425} y={y - 44} w={1558} h={91} style={{ background: "#04264a", border: `${u(2.5)} solid #1e90ff`, borderRadius: u(8) }} />}
      <button type="button" aria-label={a.kind === "Folder" ? dict.body.library.rowOpenFolder.replace("{a}", a.title) : dict.body.library.rowTitle.replace("{a}", a.title).replace("{b}", kindLabel(a.kind, dict)).replace("{c}", statusLabel(a.status, dict))} aria-pressed={sel}
        onClick={() => (a.kind === "Folder" ? (select(null), setFolder(a.id)) : select(sel ? null : a.key))} className="absolute"
        style={{ left: u(490), top: u(y - 44 - 101), width: u(1250), height: u(88), padding: 0, border: 0, background: "transparent", cursor: "pointer" }} />
      <button type="button" role="checkbox" aria-checked={on} aria-label={dict.body.library.rowSelect.replace("{a}", a.title)} onClick={() => toggleChecked(a.key, on)}
        className="absolute" style={{ left: u(448), top: u(y - 12 - 101), width: u(26), height: u(26), padding: 0, borderRadius: u(5), border: on ? 0 : `${u(2)} solid #cfe0f5`, background: on ? "#1e90ff" : "transparent", cursor: "pointer" }}>
        {on && <Ic o={[448, y - 12]} x={461} y={y + 1} k="chk" size={18} />}
      </button>
      {a.kind === "Folder" || a.kind === "Project" ? (
        <>
          <B x={504} y={y - 32} w={143} h={64} style={{ borderRadius: u(4), pointerEvents: "none", background: ty[0], border: `${u(1.5)} solid ${ty[1]}` }} />
          <Ic x={575} y={y} k={a.kind === "Folder" ? "fold" : "grid"} size={34} color={ty[2]} />
        </>
      ) : (
        <>
          <B x={504} y={y - 32} w={143} h={64} style={{ borderRadius: u(4), pointerEvents: "none",
            background: `radial-gradient(ellipse at 40% 70%,#6fb8ee 0,#2a6fb8 12%,transparent 13%),linear-gradient(180deg,#27487a,#2d7a3a ${30 + i * 6}%,#1d5a28)` }} />
          <B x={588} y={y + 10} w={56} h={22} style={{ background: "rgba(0,10,25,.8)", borderRadius: u(4), pointerEvents: "none" }} />
          <T x={612} y={y + 21} size={19} weight={600} align="center">{clock(a.durationUs)}</T>
        </>
      )}
      <T x={668} y={y - 14} size={22} weight={700} style={{ maxWidth: u(330), overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{a.title}</T>
      <T x={668} y={y + 19} size={19} color="#9fb3cc" style={{ maxWidth: u(330), overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{a.sub}{!folder && a.folderId ? dict.body.library.rowInFolder.replace("{a}", folders.find((x) => x.id === a.folderId)?.name ?? dict.body.library.aFolder) : ""}</T>
      <B x={1016} y={y - 20} w={a.kind === "Reel" ? 75 : a.kind === "Project" ? 100 : 91} h={40} style={{ background: ty[0], border: `${u(1.5)} solid ${ty[1]}`, borderRadius: u(6), pointerEvents: "none" }} />
      <T x={1016 + (a.kind === "Reel" ? 37 : a.kind === "Project" ? 50 : 45)} y={y} size={20} color={ty[2]} align="center">{kindLabel(a.kind, dict)}</T>
      {a.player ? (
        <>
          <B x={1150} y={y - 26} w={52} h={52} style={{ borderRadius: "50%", background: "#2b5ff0", border: `${u(2)} solid #6a7a98`, pointerEvents: "none" }} />
          <T x={1176} y={y} size={18} weight={700} align="center">{initials(a.player)}</T>
        </>
      ) : <T x={1176} y={y} size={19} color="#8ea3bf" align="center">—</T>}
      <T x={1575} y={y - 9} size={19} color="#b9cbe2">{a.updated ? new Date(a.updated).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</T>
      <T x={1575} y={y + 19} size={19} color="#b9cbe2">{a.updated ? new Date(a.updated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ""}</T>
      <MoreMenu x={1946} y={y} k="hdots" size={26} w={40} h={40} label={dict.body.library.moreFor.replace("{a}", a.title)} items={items} />
    </div>
  );
});

/** one row's status and collaboration (section p09-s06, memoised with its row) */
const AssetStatus = memo(function AssetStatus({ a, y }: { a: Asset; y: number }) {
  const { t: dict } = useLocale();
  const st = ST[a.status];
  return (
    <div role="group" aria-label={`${a.title}: ${statusLabel(a.status, dict)}, ${people(a, dict)}`}>
      <Collaborators a={a} y={y} />
      <B x={1756} y={y - 20} w={136} h={40} style={{ background: st[0], border: `${u(1.5)} solid ${st[1]}`, borderRadius: u(6), pointerEvents: "none" }} />
      <B x={1769} y={y - 9} w={20} h={20} style={{ background: st[2], borderRadius: "50%", pointerEvents: "none" }} />
      <Ic x={1779} y={y + 1} k="chk" size={12} color={st[0]} />
      <T x={1805} y={y} size={19} color={st[2]}>{statusLabel(a.status, dict)}</T>
    </div>
  );
});

export function LibraryMain({ all, shown, tab, setTab, f, setF, desc, setDesc, selected, select, competitions, teams, reload, canWrite, members, me, say, folder, setFolder, trash, setTrash, newFolder, setNewFolder }: {
  all: Asset[] | null | undefined; shown: Asset[]; tab: number; setTab: (i: number) => void; f: Filters; setF: (f: Filters) => void; desc: boolean; setDesc: (d: boolean) => void;
  selected: string | null; select: (k: string | null) => void; competitions: string[]; teams: string[]; reload: () => Promise<void>; canWrite: boolean;
  /** the organization's members (Created By names) and the signed-in user */
  members: Member[]; me: string | null; say: (t: string) => void;
  /** the Library folder that is open (null: the whole Library) */
  folder: string | null; setFolder: (id: string | null) => void;
  /** A.14: the Trash and New folder dialogs, opened here or from the left tree */
  trash: boolean; setTrash: (o: boolean) => void; newFolder: boolean; setNewFolder: (o: boolean) => void;
}) {
  const { t: dict } = useLocale();
  const creators = useMemo(() => members.filter((m) => (all ?? []).some((a) => a.createdBy === m.user_id)), [members, all]);
  const TAB_LABELS = [dict.body.library.tabAllAssets, dict.body.library.tabReels, dict.body.library.tabReports, dict.body.library.tabMatches, dict.body.library.tabFolders, dict.body.library.tabExports, dict.body.library.tabShared, dict.body.library.tabTemplates];
  const RANGE_LABEL: Record<string, string> = { "7d": dict.body.library.range7d, "30d": dict.body.library.range30d, "90d": dict.body.library.range90d, all: dict.body.library.rangeAll };
  const KIND_PLURAL: Record<Kind, string> = { Reel: dict.body.library.tabReels, Match: dict.body.library.tabMatches, Folder: dict.body.library.tabFolders, Project: dict.body.library.kindPluralProject, Export: dict.body.library.tabExports, Video: dict.body.library.kindPluralVideo, Report: dict.body.library.tabReports, Template: dict.body.library.tabTemplates };
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState(""); const [desc2, setDesc2] = useState(""); const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<(DeleteTarget & { key: string }) | null>(null);
  const [moving, setMoving] = useState<MoveTarget | null>(null);
  const [archiving, setArchiving] = useState<{ kind: ArchiveSubjectKind; id: string; title: string } | null>(null);
  // B.12 (ADR-088): card / table view, the table's facts, bulk actions on the checked rows
  const [view, setView] = useLibraryView();
  const facts = useLibraryFacts(all);
  const picked = useMemo(() => (all ?? []).filter((a) => checked.has(a.key)), [all, checked]);
  const movable = useMemo(() => picked.flatMap((a) => { const k = ITEM_KIND[a.kind], id = a.kind === "Export" ? a.renderId : a.id; return k && id ? [{ kind: k as string, id }] : []; }), [picked]);
  const toggleChecked = useCallback((key: string, wasOn: boolean) => setChecked((prev) => { const n = new Set(prev); if (wasOn) n.delete(key); else n.add(key); return n; }), []);
  const bulkMove = () => !canWrite ? say(dict.body.library.bulkRoleNoMove) : !movable.length ? say(dict.body.library.bulkNoneMovable)
    : setMoving({ ...movable[0]!, title: `${movable.length} items`, from: null, more: movable.slice(1) });
  const bulkCsv = () => {
    const url = URL.createObjectURL(new Blob([rowsCsv(picked, all ?? [], facts, dict)], { type: "text/csv;charset=utf-8" }));
    const el = document.createElement("a"); el.href = url; el.download = "library-selection.csv"; el.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const folders = useMemo(() => (all ?? []).filter((x) => x.kind === "Folder").map((x) => x.raw as LibraryFolder), [all]);
  const openFolder = useMemo(() => folders.find((x) => x.id === folder) ?? null, [folders, folder]);
  const loadSaved = () => api<SavedSearch[]>("/v1/saved-searches").then(setSaved, () => setSaved([]));
  useEffect(() => { void loadSaved(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(0); }, [tab, f, desc]);
  // [ / ] move between the asset tabs (lib/keymap.ts, Library scope): only here, never while typing or with a dialog open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || creating || menu || deleting || moving || archiving || trash || newFolder) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "]") setTab(Math.min(TABS.length - 1, tab + 1));
      else if (e.key === "[") setTab(Math.max(0, tab - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, setTab, creating, menu, deleting, moving, archiving, trash, newFolder]);
  const saveSearch = (name: string) => void api("/v1/saved-searches", { method: "POST", json: { name, query: { tab, f } } }).then(loadSaved, () => undefined);
  const dropSearch = (id: string) => void api(`/v1/saved-searches/${id}`, { method: "DELETE" }).then(loadSaved, () => undefined);
  const open = (sv: SavedSearch) => { const q = sv.query as { tab?: number; f?: Filters }; setTab(q.tab ?? 0); setF({ ...NO_FILTERS, ...(q.f ?? {}) }); };
  // the tab counts, once per list — not once per tab per render: the tabs re-render on every search keystroke
  const counts = useMemo(() => TABS.map(([, , k], i) => { const sh = TABS[i]![1] === "Shared With Me"; return (all ?? []).filter((a) => (folder === null || a.folderId === folder) && (k === null || k.includes(a.kind)) && (!sh || !!a.project?.shared_with_me)).length; }), [all, folder]);
  const rows = useMemo(() => shown.slice(page * 10, page * 10 + 10), [shown, page]);
  const pages = Math.max(1, Math.ceil(shown.length / 10));
  const filtered = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);
  const allChecked = rows.length > 0 && rows.every((a) => checked.has(a.key));
  const create = async () => {
    setErr(null);
    try { await api("/v1/projects", { method: "POST", json: { name, ...(desc2.trim() ? { description: desc2.trim() } : {}) } }); setCreating(false); setName(""); setDesc2(""); await reload(); }
    catch (x) { setErr(x instanceof ApiProblem ? x.message : dict.body.library.createProjectFailed); }
  };
  const onRow = useCallback((a: Asset) => (a.kind === "Folder" ? (select(null), setFolder(a.id)) : select(a.key === selected ? null : a.key)), [select, setFolder, selected]);
  const ai = TAB_GEO[tab]!, nextIcon = TAB_GEO[tab + 1]?.[0] ?? 1984;

  return (
    <>
      <section aria-label={dict.body.library.headerAria} data-section="p09-s01">
        <T x={448} y={149} size={46} weight={700} as="h1">{dict.body.library.headerTitle}</T>
        {openFolder ? (
          <div className="absolute" style={{ left: u(449), top: u(178 - 101), height: u(32), display: "flex", alignItems: "center", gap: u(10), fontSize: u(22) }}>
            <button type="button" onClick={() => setFolder(null)} style={{ background: "transparent", border: 0, padding: 0, color: "#33a8ff", font: "inherit", cursor: "pointer" }}>{dict.body.library.allAssets}</button>
            <span style={{ color: "#5d7699" }}>›</span>
            <span data-open-folder={openFolder.id} style={{ color: "#ffd36a", fontWeight: 600 }}>{dict.body.library.openFolderCrumb.replace("{a}", openFolder.name)}</span>
            <span style={{ color: "#9fb3cc" }}>· {openFolder.item_count === 1 ? dict.body.library.openFolderItemsOne : dict.body.library.openFolderItemsMany.replace("{a}", String(openFolder.item_count))}</span>
          </div>
        ) : (
          <T x={449} y={193} size={22} color="#9fb3cc">{dict.body.library.headerSubtitle}</T>
        )}
        <button type="button" aria-disabled={!canWrite || undefined} title={canWrite ? dict.body.library.createProjectTitle : dict.body.library.createProjectRoleTitle}
          onClick={() => (canWrite ? setCreating(true) : say(dict.body.library.createProjectRoleSay))} className="absolute"
          style={{ left: u(1714), top: u(132 - 101), width: u(206), height: u(63), border: 0, padding: 0, borderRadius: `${u(8)} 0 0 ${u(8)}`, background: "#0a84ff", color: "#fff", font: "inherit", cursor: "pointer" }}>
          <Ic o={[1714, 132]} x={1755} y={164} k="plus" size={26} />
          <T o={[1714, 132]} x={1786} y={164} size={24} weight={600} as="span">{dict.body.library.newProject}</T>
        </button>
        <button type="button" aria-label={dict.body.library.moreWaysToAdd} aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="absolute"
          style={{ left: u(1920), top: u(132 - 101), width: u(50), height: u(63), border: 0, padding: 0, borderRadius: `0 ${u(8)} ${u(8)} 0`, background: "#0a84ff", cursor: "pointer" }}>
          <Ic o={[1920, 132]} x={1941} y={164} k="chev" size={22} />
        </button>
        {menu && (
          <nav aria-label={dict.body.library.addNavAria} className="absolute" style={{ left: u(1714), top: u(200 - 101), width: u(256), zIndex: 6, background: "#081a35", border: `${u(1.5)} solid #1d4f8a`,
            borderRadius: u(8), padding: u(6), display: "flex", flexDirection: "column", fontSize: u(19) }}>
            <button type="button" onClick={() => { setMenu(false); if (canWrite) setNewFolder(true); else say(dict.body.library.newFolderRoleSay); }}
              style={{ padding: u(8), color: "#e3eefb", background: "transparent", border: 0, textAlign: "left", font: "inherit", cursor: "pointer" }}>{dict.body.library.newFolder}</button>
            <Link href="/upload" style={{ padding: u(8), color: "#e3eefb" }}>{dict.body.library.uploadVideo}</Link>
            <Link href="/reels" style={{ padding: u(8), color: "#e3eefb" }}>{dict.body.library.makeReel}</Link>
          </nav>
        )}
      </section>

      <section aria-label={dict.body.library.tabsAria} data-section="p09-s02">
        <B x={ai[0] - 29} y={240} w={nextIcon - ai[0] - 12} h={60} style={{ background: "#0a2b55", borderBottom: `${u(3)} solid #1e90ff`, borderRadius: `${u(8)} ${u(8)} 0 0` }} />
        <div role="tablist" aria-label={dict.body.library.assetTypesAria}>
          {TABS.map(([icon], i) => {
            const label = TAB_LABELS[i]!;
            const [ix, tx, cx, cw] = TAB_GEO[i]!, on = tab === i, n = counts[i]!, w = Math.max(cw, 14 + String(n).length * 11);
            return (
              <button key={label} type="button" role="tab" aria-selected={on} aria-label={dict.body.library.tabCountAria.replace("{a}", label).replace("{b}", String(n))} onClick={() => setTab(i)} className="absolute"
                style={{ left: u(ix - 20), top: u(244 - 101), width: u((cx ? cx + w : tx + label.length * 11) - ix + 24), height: u(50), border: 0, padding: 0, background: "transparent", cursor: "pointer", color: "inherit", font: "inherit" }}>
                <Ic o={[ix - 20, 244]} x={ix} y={268} k={icon} size={28} color={on ? "#33a8ff" : "#cfe0f5"} />
                <T o={[ix - 20, 244]} x={tx} y={268} size={22} weight={on ? 600 : 400} color={on ? "#33a8ff" : "#cfe0f5"} as="span">{label}</T>
                {cw > 0 && (
                  <>
                    <B o={[ix - 20, 244]} x={cx} y={253} w={w} h={30} style={{ background: "#0a2447", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(6) }} />
                    <T o={[ix - 20, 244]} x={cx + w / 2} y={268} size={19} weight={on ? 700 : 400} align="center" as="span">{n}</T>
                  </>
                )}
              </button>
            );
          })}
        </div>
        <B x={425} y={303} w={1547} h={1} style={{ background: "#12335f" }} />
      </section>

      <section aria-label={dict.body.library.searchFiltersAria} data-section="p09-s03">
        <label className="absolute" style={{ left: u(425), top: u(326 - 101), width: u(443), height: u(62), ...field }}>
          <Ic o={[426.5, 327.5]} x={458} y={356} k="srch" size={28} color="#cfe0f5" />
          <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={dict.body.library.searchLibrary} aria-label={dict.body.library.searchLibraryAria}
            style={{ position: "absolute", left: u(487 - 426.5), top: 0, width: u(370), height: "100%", background: "transparent", border: 0, outline: "none", color: "#e3eefb", fontSize: u(20), fontFamily: "inherit" }} />
        </label>
        <FilterBox x={883} w={142} label={dict.body.library.filterType} value={f.type} onChange={(v) => setF({ ...f, type: v })}
          options={[["all", dict.body.library.filterAllTypes], ...(["Reel", "Match", "Folder", "Project", "Export", "Video"] as Kind[]).map((k) => [k, KIND_PLURAL[k]] as [Kind, string])]} />
        <FilterBox x={1036} w={201} label={dict.body.library.competition} size={19} value={f.competition} onChange={(v) => setF({ ...f, competition: v })}
          options={[["all", dict.body.library.filterAllCompetitions], ...(competitions.length ? competitions.map((c) => [c, c] as [string, string]) : [["none", dict.body.library.filterCompetitionsNone, dict.body.library.filterCompetitionsNoneWhy] as [string, string, string]])]} />
        <FilterBox x={1249} w={202} label={dict.body.library.filterTeam} value={f.team} onChange={(v) => setF({ ...f, team: v })} options={[["all", dict.body.library.filterAllTeams], ...(teams.length ? teams.map((t) => [t, t] as [string, string]) : [["none", dict.body.library.filterTeamsNone, dict.body.library.filterTeamsNoneWhy] as [string, string, string]])]} />
        <FilterBox x={1462} w={176} label={dict.body.library.createdBy} value={f.creator} onChange={(v) => setF({ ...f, creator: v })}
          options={[["any", dict.body.library.filterAnyUser], ...(me && creators.some((m) => m.user_id === me) ? [[me, dict.body.library.filterMe] as [string, string]] : []),
            ...creators.filter((m) => m.user_id !== me).map((m) => [m.user_id, m.display_name] as [string, string]),
            ...(creators.length ? [] : [["none", dict.body.library.filterMembersNone, dict.body.library.filterMembersNoneWhy] as [string, string, string]])]} />
        <FilterBox x={1649} w={214} label={dict.body.library.filterDateRange} value={f.range} onChange={(v) => setF({ ...f, range: v })} options={RANGES.map(([v]) => [v, RANGE_LABEL[v]!] as [string, string])} />
        <button type="button" aria-disabled={!filtered || undefined} onClick={() => (filtered ? setF(NO_FILTERS) : say(dict.body.library.sayNoFilters))} className="absolute"
          style={{ left: u(1885), top: u(356 - 101 - 14), height: u(28), padding: 0, border: 0, background: "transparent", color: "#33a8ff", fontSize: u(20), fontFamily: "inherit", cursor: "pointer", opacity: filtered ? 1 : 0.6, whiteSpace: "nowrap" }}>{dict.body.library.clearFilters}</button>
      </section>

      <section aria-label={dict.body.library.savedSearchesAria} data-section="p09-s04">
        <T x={431} y={436} size={19} color="#cfe0f5" as="h2">{dict.body.library.savedSearchesHeading}</T>
        {saved.length === 0 ? <T x={578} y={438} size={19} color="#8ea3bf">{dict.body.library.noSavedSearches}</T> : (
          <ul aria-label={dict.body.library.savedSearchesAriaList} className="absolute" style={{ left: u(578), top: u(420 - 101), width: u(930), height: u(36), margin: 0, padding: 0, listStyle: "none", display: "flex", gap: u(8), overflow: "hidden" }}>
            {saved.map((sv) => (
              <li key={sv.id} style={{ display: "flex", alignItems: "center", gap: u(6), padding: `0 ${u(10)}`, borderRadius: u(6), background: "#0a2447", border: `${u(1.5)} solid #1d4f8a`, fontSize: u(17), whiteSpace: "nowrap" }}>
                <button type="button" onClick={() => open(sv)} style={{ background: "transparent", border: 0, color: "#e3eefb", cursor: "pointer", font: "inherit", padding: 0 }}>{sv.name}</button>
                <button type="button" aria-label={dict.body.library.deleteSavedSearch.replace("{a}", sv.name)} onClick={() => dropSearch(sv.id)} style={{ background: "transparent", border: 0, color: "#8ea3bf", cursor: "pointer", padding: 0, font: "inherit" }}>×</button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => setTrash(true)} title={dict.body.library.trashBtnTitle} className={`${s.a} ${s.framed}`}
          style={{ left: u(1522), top: u(417 - 101), width: u(124), height: u(42), background: "#08203f", borderRadius: u(8), ["--bc" as string]: "#17406f",
            border: 0, padding: 0, color: "inherit", font: "inherit", cursor: "pointer" }}>
          <Ic o={[1522, 417]} x={1546} y={438} k="trash" size={22} color="#cfe0f5" />
          <T o={[1522, 417]} x={1568} y={438} size={19} color="#cfe0f5" as="span">{dict.body.library.trash}</T>
        </button>
        <button type="button" aria-disabled={(!filtered && tab === 0) || undefined} title={dict.body.library.saveSearchTitle}
          onClick={() => (!filtered && tab === 0) ? say(dict.body.library.saveSearchNothing) : saveSearch((f.q.trim() || `${TAB_LABELS[tab]!}${filtered ? dict.body.library.saveSearchFiltered : ""}`).slice(0, 120))}
          className={`${s.a} ${s.framed}`} style={{ left: u(1658), top: u(417 - 101), width: u(228), height: u(42), background: "#08203f", borderRadius: u(8), ["--bc" as string]: "#17406f",
            border: 0, padding: 0, color: "inherit", font: "inherit", cursor: "pointer", opacity: !filtered && tab === 0 ? 0.6 : 1 }}>
          <Ic o={[1658, 417]} x={1684} y={438} k="plus" size={22} color="#33a8ff" />
          <T o={[1658, 417]} x={1708} y={438} size={19} color="#33a8ff" as="span">{dict.body.library.saveSearch}</T>
        </button>
      </section>

      <section aria-label={dict.body.library.mainTableAria} data-section="p09-s05" data-rows={String(shown.length)}>
        <B x={425} y={481} w={1558} h={946} style={{ background: "rgba(5,16,34,.7)", border: `${u(1.5)} solid #12335f`, borderRadius: u(12) }} />
        <div role="radiogroup" aria-label={dict.body.library.showAsAria} className="absolute" style={{ left: u(1896), top: u(417 - 101), display: "flex", gap: u(4) }}>
          {([["cards", "▤", dict.body.library.viewCardsTitle], ["table", "☷", dict.body.library.viewTableTitle]] as const).map(([v, ic, t]) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} aria-label={t} title={t} data-view={v} onClick={() => setView(v)}
              style={{ width: u(42), height: u(42), borderRadius: u(8), border: `${u(1.5)} solid ${view === v ? "#1e90ff" : "#17406f"}`, background: view === v ? "#0d3a78" : "#08203f",
                color: "#cfe0f5", fontSize: u(22), cursor: "pointer", padding: 0 }}>{ic}</button>
          ))}
        </div>
        {view === "table" && all ? (
          <LibraryTable rows={rows} all={all} facts={facts} checked={checked} setChecked={setChecked} selected={selected}
            onRow={onRow} />
        ) : (<>
        <button type="button" role="checkbox" aria-checked={allChecked} aria-label={dict.body.library.selectAllAria}
          onClick={() => !rows.length ? say(dict.body.library.sayNoRows) : setChecked(allChecked ? new Set() : new Set(rows.map((a) => a.key)))} className="absolute"
          style={{ left: u(447), top: u(500 - 101), width: u(26), height: u(26), padding: 0, borderRadius: u(5), border: allChecked ? 0 : `${u(2)} solid #cfe0f5`, background: allChecked ? "#1e90ff" : "transparent", cursor: "pointer" }}>
          {allChecked && <Ic o={[447, 500]} x={460} y={513} k="chk" size={18} />}
        </button>
        {([[dict.body.library.colThumbTitle, 503, 514], [dict.body.library.colType, 1023, 512], [dict.body.library.colPlayers, 1157, 513], [dict.body.library.colCollaborators, 1352, 513], [dict.body.library.colUpdated, 1573, 514], [dict.body.library.colStatus, 1758, 514]] as const).map(([l, x, y]) => (
          <T key={l} x={x} y={y} size={19} color="#cfe0f5">{l}</T>
        ))}
        <button type="button" aria-label={desc ? dict.body.library.sortOldest : dict.body.library.sortNewest} onClick={() => setDesc(!desc)} className="absolute"
          style={{ left: u(1650), top: u(502 - 101), width: u(24), height: u(24), padding: 0, border: 0, background: "transparent", cursor: "pointer", transform: desc ? undefined : "scaleY(-1)" }}>
          <Ic o={[1650, 502]} x={1662} y={514} k="sort" size={22} color="#33a8ff" />
        </button>
        {Y.slice(0, 9).map((y) => <B key={y} x={427} y={y + 45} w={1554} h={1} style={{ background: "#10294a" }} />)}
        {all === undefined && (
          <T x={1204} y={587} size={20} color="#8ea3bf" align="center"><span role="status">{dict.body.library.loadingLibrary}</span></T>
        )}
        {all === null && (
          <button type="button" onClick={() => void reload()} className="absolute" aria-label={dict.body.library.tryLoadAgainAria}
            style={{ left: u(1144), top: u(620 - 101), width: u(120), height: u(36), padding: 0, border: 0, background: "transparent", color: "#33a8ff", fontSize: u(20), fontFamily: "inherit", cursor: "pointer" }}>{dict.common.retry}</button>
        )}
        {all !== undefined && shown.length === 0 && (
          <T x={1204} y={587} size={20} color="#8ea3bf" align="center">{all === null ? dict.body.library.libraryLoadFailedMain : openFolder && !openFolder.item_count ? dict.body.library.folderEmpty : (all.length === 0 ? dict.body.library.noAssetsYet : dict.body.library.noAssetMatches)}</T>
        )}
        {rows.map((a, i) => (
          <AssetRow key={a.key} a={a} y={Y[i]!} i={i} sel={a.key === selected} on={checked.has(a.key)} canWrite={canWrite} folder={folder} folders={folders}
            select={select} setFolder={setFolder} toggleChecked={toggleChecked} setDeleting={setDeleting} setMoving={setMoving} setArchiving={setArchiving} />
        ))}
        </>)}
        {checked.size > 0 && (
          <div role="toolbar" aria-label={dict.body.library.selectedItemsAria} data-bulk-bar className="absolute" style={{ left: u(440), top: u(1384 - 101), height: u(36), display: "flex", alignItems: "center", gap: u(14),
            fontSize: u(18), color: "#cfe0f5" }}>
            <span>{dict.body.library.bulkSelected.replace("{a}", String(checked.size))}</span>
            <button type="button" onClick={bulkMove} style={{ background: "transparent", border: 0, color: "#33a8ff", cursor: "pointer", font: "inherit" }}>{dict.body.library.bulkMoveToFolder}</button>
            <button type="button" onClick={bulkCsv} style={{ background: "transparent", border: 0, color: "#33a8ff", cursor: "pointer", font: "inherit" }}>{dict.body.library.bulkDownloadCsv}</button>
            <button type="button" onClick={() => setChecked(new Set())} style={{ background: "transparent", border: 0, color: "#8ea3bf", cursor: "pointer", font: "inherit" }}>{dict.body.library.bulkClear}</button>
          </div>
        )}
        {pages > 1 && (
          <nav aria-label={dict.body.library.pagesAria} className="absolute" style={{ left: u(1700), top: u(1400 - 101), width: u(270), display: "flex", justifyContent: "flex-end", gap: u(12), alignItems: "center", fontSize: u(16), color: "#9fb3cc" }}>
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} style={{ background: "transparent", border: 0, color: "#33a8ff", cursor: "pointer", font: "inherit" }}>{dict.body.library.prevPage}</button>
            <span>{page + 1} / {pages}</span>
            <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} style={{ background: "transparent", border: 0, color: "#33a8ff", cursor: "pointer", font: "inherit" }}>{dict.body.library.nextPage}</button>
          </nav>
        )}
      </section>

      <section aria-label={dict.body.library.statusSectionAria} data-section="p09-s06">
        {view === "cards" && rows.map((a, i) => <AssetStatus key={a.key} a={a} y={Y[i]!} />)}
      </section>

      <Dialog.Root open={creating} onOpenChange={setCreating}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
            <Dialog.Title className="text-base font-semibold">{dict.body.library.newProjectTitle}</Dialog.Title>
            <Dialog.Description className="mb-3 text-xs text-muted">{dict.body.library.newProjectDesc}</Dialog.Description>
            <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="space-y-2">
              <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={255} placeholder={dict.body.library.newProjectName} aria-label={dict.body.library.newProjectName}
                className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-ink" />
              <textarea value={desc2} onChange={(e) => setDesc2(e.target.value)} maxLength={4000} placeholder={dict.body.library.newProjectDescPlaceholder} aria-label={dict.body.library.newProjectDescAria}
                className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-ink" rows={3} />
              {err && <p role="alert" className="text-danger">{err}</p>}
              <div className="flex justify-end gap-2">
                <Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{dict.common.cancel}</Dialog.Close>
                <button type="submit" className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white">{dict.body.library.newProjectCreate}</button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <DeleteDialog target={deleting} close={() => setDeleting(null)}
        done={async (msg) => { const k = deleting?.key, wasFolder = deleting?.kind === "folder" && deleting.id === folder; setDeleting(null); if (selected === k) select(null);
          if (wasFolder) setFolder(null); await reload(); say(msg); }} />
      <MoveDialog target={moving} folders={folders} close={() => setMoving(null)} done={async (msg) => { setMoving(null); await reload(); say(msg); }} />
      <TrashDialog open={trash} close={() => setTrash(false)} canWrite={canWrite} changed={async (msg) => { await reload(); say(msg); }} />
      <NewFolderDialog open={newFolder} close={() => setNewFolder(false)} done={async (fo) => { setNewFolder(false); await reload(); say(dict.body.library.folderMade.replace("{a}", fo.name)); }} />
      <ArchiveDialog target={archiving} canWrite={canWrite} onClose={() => setArchiving(null)} />
    </>
  );
}
