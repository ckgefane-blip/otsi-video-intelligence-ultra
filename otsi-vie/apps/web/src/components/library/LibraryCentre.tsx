"use client";
/**
 * SOT rebuild page 14 (alphabetical), Library: the centre column — the
 * header (Library + Save view + Upload a match video), the selected
 * video in the shared VideoPlayer (with the SOT's "No playable
 * footage" empty state when there is nothing to play), the search row
 * (search + Type / Match / Access chips + List / Grid), and the items
 * table (Name | Type | Details) with the bulk bar.
 *
 * The table shows the library's content: matches, players, reels and
 * reports. Folders, projects, exports and templates are not rows here
 * (the SOT's Library is a content library); folders live in the right
 * inspector, exports in Export, projects in Upload. The Type / Match /
 * Access chips are filters: Type narrows the kind, Match the match,
 * Access the visibility. List is the table; Grid shows the same items
 * as cards with their real thumbnail.
 *
 * Bulk actions (Move / Tag / Access / Export / Delete) work on the
 * checked rows. Move files a row into a folder (POST
 * /v1/library/folder-items); Tag and Access open the existing dialogs;
 * Export downloads the checked rows as a CSV; Delete opens the
 * removal check and moves the item to the Trash. With nothing checked
 * they are disabled, as the SOT shows.
 */
import type { PlayerListEntry, RemovableKind } from "@otsi-vie/contracts";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { LayoutGrid, List } from "lucide-react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { AccessDialog } from "./AccessDialog";
import { AssetThumb } from "./AssetThumb";
import { rowsCsv } from "./LibraryTable";
import { ITEM_KIND, type Asset } from "./useLibrary";

/** the Library delete kinds (ADR-052, ADR-074): which API kind each asset deletes as, and its id */
const KIND: Partial<Record<Asset["kind"], [RemovableKind, (a: Asset) => string | null]>> = {
  Reel: ["reel", (a) => a.id], Export: ["render", (a) => a.renderId ?? null], Video: ["video", (a) => a.videoId ?? null],
  Match: ["match", (a) => a.id], Project: ["project", (a) => a.id], Folder: ["folder", (a) => a.id],
};

export type LibraryItemKind = "Match" | "Player" | "Reel" | "Report";
export interface LibraryItem {
  key: string; kind: LibraryItemKind; title: string; details: string;
  videoId: string | null; href: string | null; asset: Asset | null; player: PlayerListEntry | null;
}

export function LibraryCentre({ items, all, facts, selected, onSelect, videoId, q, setQ, typeFilter, setTypeFilter, matchFilter, setMatchFilter, accessFilter, setAccessFilter, matches, folders, checked, setChecked, reload, say }: {
  items: LibraryItem[]; all: Asset[]; facts: Map<string, import("@otsi-vie/contracts").VideoFacts> | null;
  selected: string | null; onSelect: (k: string | null) => void;
  videoId: string | null; q: string; setQ: (q: string) => void;
  typeFilter: LibraryItemKind | "all"; setTypeFilter: (t: LibraryItemKind | "all") => void;
  matchFilter: string; setMatchFilter: (id: string) => void;
  accessFilter: "all" | "ORGANIZATION" | "RESTRICTED"; setAccessFilter: (a: "all" | "ORGANIZATION" | "RESTRICTED") => void; matches: { id: string; title: string }[];
  folders: import("@otsi-vie/contracts").LibraryFolder[];
  checked: Set<string>; setChecked: (s: Set<string>) => void; reload: () => Promise<void>; say: (t: string) => void;
}) {
  const { t: dict } = useLocale();
  const d = dict.body.library;
  const [view, setView] = useState<"list" | "grid">("list");
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [moveOpen, setMoveOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  useEffect(() => {
    setUrl(undefined);
    if (!videoId) { setUrl(null); return; }
    let live = true;
    api<{ url: string }>(`/v1/videos/${videoId}/playback`).then((p) => { if (live) setUrl(p.url); }, () => { if (live) setUrl(null); });
    return () => { live = false; };
  }, [videoId]);
  const shown = useMemo(() => items.filter((i) =>
    (typeFilter === "all" || i.kind === typeFilter) && (matchFilter === "all" || (i.asset?.matchId ?? "") === matchFilter || i.videoId === matchFilter)
    && (accessFilter === "all" || (i.asset?.project?.access ?? "ORGANIZATION") === accessFilter)
    && (!q.trim() || `${i.title} ${i.details}`.toLowerCase().includes(q.trim().toLowerCase()))), [items, typeFilter, matchFilter, accessFilter, q]);
  const allOn = shown.length > 0 && shown.every((i) => checked.has(i.key));
  const toggle = (k: string) => { const n = new Set(checked); if (n.has(k)) n.delete(k); else n.add(k); setChecked(n); };
  const kindLabel = (k: LibraryItemKind) => ({ Match: d.kindLabelMatch, Player: d.binGroupPlayers, Reel: d.kindLabelReel, Report: d.kindLabelReport })[k];
  const checkedItems = shown.filter((i) => checked.has(i.key));
  const exportCsv = () => {
    const csv = rowsCsv(checkedItems.map((i) => i.asset).filter((a): a is Asset => !!a), all, facts, dict);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "library.csv"; a.click();
    URL.revokeObjectURL(a.href);
  };
  const [accessOpen, setAccessOpen] = useState(false);
  const accessItem = checkedItems.find((i) => i.asset?.project);
  const openAccess = () => {
    if (!accessItem) return say(d.accessNoProject);
    setAccessOpen(true);
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-2.5 overflow-auto" style={{ padding: "12px 16px" }}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h1 className="h1">{dict.pages.library.title}</h1>
        <div className="flex gap-2">
          <button type="button" className="btn sm" onClick={() => say(d.lbSaveViewHint)}>{d.lbSaveView}</button>
          <Link href="/upload" className="btn sm pri">{d.lbUploadMatch}</Link>
        </div>
      </div>

      <div className="flex justify-center">
        <div style={{ width: "100%", maxWidth: 720 }}>
          <VideoPlayer src={url ?? null} label={dict.pages.library.title} allowLocal
            empty={{ title: d.lbNoPlayable, body: d.lbOpenLocalHint }} />
        </div>
      </div>

      {/* one row as the SOT draws it: the search flexes, the filters cap at 200 px, List / Grid never wraps under */}
      <div className="flex flex-nowrap items-center gap-2">
        <label htmlFor="lb-search" className="sr-only">{d.lbSearchPh}</label>
        <input id="lb-search" className="in" style={{ flex: "1 1 0", minWidth: 120, height: 32 }} placeholder={d.lbSearchPh} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={d.type} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as LibraryItemKind | "all")} className="chip" style={{ height: 30, cursor: "pointer", flex: "0 1 auto", minWidth: 0, maxWidth: 200 }}>
          <option value="all">{d.type}</option>
          {(["Match", "Player", "Reel", "Report"] as const).map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
        </select>
        <select aria-label={dict.body.analysis.match} value={matchFilter} onChange={(e) => setMatchFilter(e.target.value)} className="chip" style={{ height: 30, cursor: "pointer", flex: "0 1 auto", minWidth: 0, maxWidth: 200 }}>
          <option value="all">{dict.body.analysis.match}</option>
          {matches.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
        <select aria-label={d.lbAccess} value={accessFilter} onChange={(e) => setAccessFilter(e.target.value as "all" | "ORGANIZATION" | "RESTRICTED")} className="chip" style={{ height: 30, cursor: "pointer", flex: "0 1 auto", minWidth: 0, maxWidth: 200 }}>
          <option value="all">{d.lbAccess}</option>
          <option value="ORGANIZATION">{d.accessEveryone}</option>
          <option value="RESTRICTED">{d.accessRestricted}</option>
        </select>
        <div className="seg" role="group" aria-label={d.lbViewAria} style={{ flex: "none" }}>
          <button type="button" className={view === "list" ? "on" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}><List className="h-3.5 w-3.5" aria-hidden />{d.lbList}</button>
          <button type="button" className={view === "grid" ? "on" : ""} aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid className="h-3.5 w-3.5" aria-hidden />{d.lbGrid}</button>
        </div>
      </div>

      <section className="flex min-h-0 flex-1 flex-col" style={{ background: "transparent", border: 0, borderRadius: 0 }} aria-label={dict.pages.library.title}>
        <div className="flex h-[38px] items-center gap-2.5 border-b border-line bg-p0 px-3">
          <input type="checkbox" aria-label={d.selectAllAria} checked={allOn} onChange={() => setChecked(allOn ? new Set() : new Set(shown.map((i) => i.key)))} />
          <span className="t-small flex-1 text-muted">{d.lbSelected.replace("{a}", String(checked.size))}</span>
          <button type="button" className="btn sm gh" disabled={checked.size === 0} onClick={() => setMoveOpen(true)}>{d.lbMove}</button>
          <button type="button" className="btn sm gh" disabled={checked.size === 0} onClick={() => say(d.lbTagNotYet)}>{d.lbTag}</button>
          <button type="button" className="btn sm gh" disabled={checked.size === 0} onClick={openAccess}>{d.lbAccess}</button>
          <button type="button" className="btn sm gh" disabled={checked.size === 0} onClick={exportCsv}>{d.lbExport}</button>
          <button type="button" className="btn sm gh dan" disabled={checked.size === 0} onClick={() => setDelOpen(true)}>{d.lbDelete}</button>
        </div>
        {view === "list" ? (
          <div className="overflow-auto">
            <div className="eb grid items-center gap-3 border-b border-line px-3" style={{ gridTemplateColumns: "24px minmax(200px, 2fr) 110px minmax(160px, 1.4fr)", height: 32, minWidth: 560 }}>
              <span />
              <span>{d.name}</span><span>{d.type}</span><span>{d.lbDetails}</span>
            </div>
            {shown.map((i) => (
              <div key={i.key} data-library-row={i.key} aria-selected={selected === i.key}
                className={`lr grid min-w-[560px] gap-3 px-3 ${selected === i.key ? "bg-[#04264a]" : ""}`}
                style={{ gridTemplateColumns: "24px minmax(200px, 2fr) 110px minmax(160px, 1.4fr)" }}>
                <input type="checkbox" aria-label={d.rowSelect.replace("{a}", i.title)} checked={checked.has(i.key)} onChange={() => toggle(i.key)} onClick={(e) => e.stopPropagation()} />
                <button type="button" onClick={() => onSelect(selected === i.key ? null : i.key)} className="min-w-0 text-left" aria-label={i.title}>
                  <span className="block truncate font-normal">{i.title}</span>
                </button>
                <span className="t-small text-muted">{kindLabel(i.kind)}</span>
                <span className="t-small text-muted">{i.details}</span>
              </div>
            ))}
            {shown.length === 0 && <p className="p-4 text-sm text-muted">{d.lbNoItems}</p>}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 overflow-auto p-3">
            {shown.map((i) => (
              <button key={i.key} type="button" onClick={() => onSelect(selected === i.key ? null : i.key)}
                className={`rounded-lg border p-2 text-left ${selected === i.key ? "border-primary bg-[#04264a]" : "border-line/60 bg-panel"}`}>
                {i.asset ? <AssetThumb a={i.asset} className="h-[96px] w-full" /> : <span className="grid h-[96px] w-full place-items-center rounded border border-line bg-raised text-2xl font-normal">{i.title.slice(0, 1).toUpperCase()}</span>}
                <span className="mt-1.5 block truncate text-sm font-normal">{i.title}</span>
                <span className="block truncate text-xs text-muted">{kindLabel(i.kind)} · {i.details}</span>
              </button>
            ))}
            {shown.length === 0 && <p className="p-4 text-sm text-muted">{d.lbNoItems}</p>}
          </div>
        )}
      </section>

      <MoveDialog open={moveOpen} close={() => setMoveOpen(false)} items={checkedItems} folders={folders}
        done={async (msg) => { setChecked(new Set()); await reload(); say(msg); }} />
      <DeleteDialog open={delOpen} close={() => setDelOpen(false)} items={checkedItems}
        done={async (msg) => { setChecked(new Set()); await reload(); say(msg); }} />
      {accessItem?.asset?.project && (
        <AccessDialog projectId={accessItem.asset.project.id} projectName={accessItem.asset.project.name} open={accessOpen} onOpenChange={setAccessOpen} onChanged={reload} />
      )}
    </main>
  );
}

/** Move the checked rows into a folder (POST /v1/library/folder-items); "No folder" takes them out. */
function MoveDialog({ open, close, items, folders, done }: {
  open: boolean; close: () => void; items: LibraryItem[]; folders: import("@otsi-vie/contracts").LibraryFolder[]; done: (msg: string) => Promise<void>;
}) {
  const { t: dict } = useLocale();
  const d = dict.body.library;
  const [folder, setFolder] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setFolder(""); setErr(null); } }, [open]);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const movable = items.filter((i) => i.asset && ITEM_KIND[i.asset.kind]);
      for (const i of movable) {
        const kind = ITEM_KIND[i.asset!.kind]!;
        const id = i.asset!.kind === "Export" ? i.asset!.renderId : i.asset!.id;
        if (!id) continue;
        if (folder) await api("/v1/library/folder-items", { method: "POST", json: { folder_id: folder, item_kind: kind, item_id: id } });
        else await api(`/v1/library/folder-items/${kind}/${id}`, { method: "DELETE" });
      }
      await done(d.lbMoved);
      close();
    } catch (e) { setErr(e instanceof ApiProblem ? e.message : d.lbMoveFailed); setBusy(false); }
  };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
          <Dialog.Title className="text-base font-normal">{d.lbMoveTitle}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{items.map((i) => i.title).join(", ")}</Dialog.Description>
          <select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label={d.lbMoveTitle} className="in h-10 w-full">
            <option value="">{d.lbMoveNoFolder}</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          {err && <p role="alert" className="mt-2 text-danger">{err}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{dict.common.cancel}</Dialog.Close>
            <button type="button" disabled={busy} onClick={() => void go()} className="rounded-ctl bg-primary px-3 py-1.5 font-normal text-white disabled:opacity-50">{d.lbMove}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Delete the checked rows: the server first says what goes with each item; confirm moves them to the Trash. */
function DeleteDialog({ open, close, items, done }: {
  open: boolean; close: () => void; items: LibraryItem[]; done: (msg: string) => Promise<void>;
}) {
  const { t: dict } = useLocale();
  const d = dict.body.library;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setErr(null); }, [open]);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      for (const i of items) {
        const k = i.asset ? KIND[i.asset.kind] : null;
        const id = k?.[1](i.asset!) ?? null;
        if (!k || !id) continue;
        await api(`/v1/library/${k[0]}/${id}`, { method: "DELETE" });
      }
      await done(d.lbDeleted);
      close();
    } catch (e) { setErr(e instanceof ApiProblem ? e.message : d.lbDeleteFailed); setBusy(false); }
  };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
          <Dialog.Title className="text-base font-normal">{d.lbDeleteTitle.replace("{a}", items.length === 1 ? items[0]!.title : `${items.length} items`)}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{d.deleteMovedToTrash.replace("{a}", items.length === 1 ? items[0]!.title : `${items.length} items`)}</Dialog.Description>
          {err && <p role="alert" className="mb-2 text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{dict.common.cancel}</Dialog.Close>
            <button type="button" disabled={busy} onClick={() => void go()} className="rounded-ctl bg-danger px-3 py-1.5 font-normal text-white disabled:opacity-50">{d.lbDeleteConfirm}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
