"use client";
/**
 * v3 Phase A.14 (ADR-073): the Library's left tree, the left panel's "Browse" view (its "Match" view is the approved match context).
 *   All assets       the whole Library (the All Assets tab, no folder)
 *   Folders          each Library folder with its item count (what the person may see, from the API); opens it; + New folder (writers)
 *   Shared With Me   the items of restricted projects the person was added to (the Shared With Me tab)
 *   Trash            the deleted entries (GET /v1/library/trash); opens the Trash, where they are restored
 *   Smart Bins       the person's saved Smart Searches that fill themselves, with what each holds now (B.11, ADR-087; SmartBins.tsx)
 * Only what is recorded; counts come from the same list the table shows.
 */
import type { LibraryFolder, TrashEntry } from "@otsi-vie/contracts";
import { memo, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { TABS, type Asset } from "./useLibrary";
import { useLocale } from "@/lib/i18n";
import { SmartBinsTree } from "./SmartBins";
import { treeCount, treeHead, treeRow } from "./treeStyle";

export const SHARED_TAB = TABS.findIndex(([, l]) => l === "Shared With Me");

/** the counts the tree shows: whole Library, each folder, shared with me */
export function treeCounts(all: Asset[]): { all: number; shared: number; folders: LibraryFolder[] } {
  const items = all.filter((a) => a.kind !== "Folder");
  return {
    all: items.length,
    shared: items.filter((a) => !!a.project?.shared_with_me).length,
    folders: all.filter((a) => a.kind === "Folder").map((a) => a.raw as LibraryFolder).sort((x, y) => x.name.localeCompare(y.name)),
  };
}

function Item({ on, label, n, onClick, icon, data }: { on: boolean; label: string; n: number | null; onClick: () => void; icon: ReactNode; data: string }) {
  return (
    <li>
      <button type="button" aria-current={on ? "true" : undefined} onClick={onClick} className={treeRow(on)} data-tree={data} title={label}>
        <span aria-hidden style={{ width: 22, textAlign: "center", flex: "none" }}>{icon}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        {n !== null && <span className={treeCount}>{n}</span>}
      </button>
    </li>
  );
}

export const LibraryTree = memo(function LibraryTree({ all, folder, setFolder, tab, setTab, canWrite, openTrash, newFolder, say, version }: {
  all: Asset[] | null | undefined; folder: string | null; setFolder: (id: string | null) => void; tab: number; setTab: (i: number) => void;
  canWrite: boolean; openTrash: () => void; newFolder: () => void; say: (t: string) => void;
  /** changes when the Library is reloaded, so the Trash count is read again */
  version: unknown;
}) {
  const { t: dict } = useLocale();
  const [trash, setTrash] = useState<number | null>(null);
  useEffect(() => { void api<TrashEntry[]>("/v1/library/trash").then((r) => setTrash(r.length), () => setTrash(null)); }, [version]);
  if (all === undefined) return <p className="px-2 py-1 text-sm text-muted">{dict.body.library.loadingLibrary}</p>;
  if (all === null) return <p className="px-2 py-1 text-sm text-danger">{dict.body.library.libraryLoadFailed}</p>;
  const c = treeCounts(all);
  const go = (t: number, f: string | null) => { setFolder(f); setTab(t); };
  return (
    <nav aria-label={dict.body.library.treeNavAria} data-library-tree className="flex flex-col">
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        <Item data="all" on={folder === null && tab === 0} label={dict.body.library.treeAll} n={c.all} icon="▦" onClick={() => go(0, null)} />
      </ul>
      <div className={treeHead}>
        <span>{dict.body.library.treeFolders}</span>
        <button type="button" data-tree="new-folder" onClick={() => (canWrite ? newFolder() : say(dict.body.library.newFolderRoleSay))}
          aria-label={dict.body.library.newFolder} title={canWrite ? dict.body.library.treeMakeFolder : dict.body.library.treeRoleNoFolders}
          style={{ border: 0, background: "transparent", color: canWrite ? "#33a8ff" : "#5d7699", font: "inherit", fontSize: 12, cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>{dict.body.library.treeNew}</button>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {c.folders.length === 0 && <li className="px-3 py-1 text-sm text-muted">{dict.body.library.treeNoFolders}{canWrite ? dict.body.library.treeNoFoldersHint : ""}</li>}
        {c.folders.map((fo) => <Item key={fo.id} data={`folder-${fo.id}`} on={folder === fo.id} label={fo.name} n={fo.item_count} icon={<span style={{ color: "#f5b82e" }}>▰</span>} onClick={() => go(0, fo.id)} />)}
      </ul>
      <div className={treeHead}><span>{dict.body.library.treePeople}</span></div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        <Item data="shared" on={folder === null && tab === SHARED_TAB} label={dict.body.library.tabShared} n={c.shared} icon="👤" onClick={() => go(SHARED_TAB, null)} />
      </ul>
      <div className={treeHead}><span>{dict.body.library.treeDeleted}</span></div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        <Item data="trash" on={false} label={dict.body.library.trash} n={trash} icon="🗑" onClick={openTrash} />
      </ul>
      <SmartBinsTree />
    </nav>
  );
});
