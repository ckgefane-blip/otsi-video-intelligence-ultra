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
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "@/lib/api";
import { u } from "@/components/stage/DesignStage";
import { TABS, type Asset } from "./useLibrary";
import { SmartBinsTree } from "./SmartBins";

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

const row = (on: boolean): CSSProperties => ({
  display: "flex", alignItems: "center", gap: u(10), width: "100%", minHeight: u(44), padding: `0 ${u(12)}`, borderRadius: u(8), border: 0, textAlign: "left",
  background: on ? "#0a2b55" : "transparent", outline: on ? `${u(1.5)} solid #1e90ff` : "none", color: on ? "#fff" : "#d6e4f7", font: "inherit", fontSize: u(21), cursor: "pointer",
});
const count = { marginLeft: "auto", color: "#8ea3bf", fontSize: u(18) };
const head: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", margin: `${u(14)} ${u(4)} ${u(4)}`, fontSize: u(16), fontWeight: 600,
  letterSpacing: "0.06em", textTransform: "uppercase", color: "#8ea3bf" };

function Item({ on, label, n, onClick, icon, data }: { on: boolean; label: string; n: number | null; onClick: () => void; icon: ReactNode; data: string }) {
  return (
    <li>
      <button type="button" aria-current={on ? "true" : undefined} onClick={onClick} style={row(on)} data-tree={data} title={label}>
        <span aria-hidden style={{ width: u(22), textAlign: "center", flex: "none" }}>{icon}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        {n !== null && <span style={count}>{n}</span>}
      </button>
    </li>
  );
}

export function LibraryTree({ all, folder, setFolder, tab, setTab, canWrite, openTrash, newFolder, say, version }: {
  all: Asset[] | null | undefined; folder: string | null; setFolder: (id: string | null) => void; tab: number; setTab: (i: number) => void;
  canWrite: boolean; openTrash: () => void; newFolder: () => void; say: (t: string) => void;
  /** changes when the Library is reloaded, so the Trash count is read again */
  version: unknown;
}) {
  const [trash, setTrash] = useState<number | null>(null);
  useEffect(() => { void api<TrashEntry[]>("/v1/library/trash").then((r) => setTrash(r.length), () => setTrash(null)); }, [version]);
  if (all === undefined) return <p style={{ fontSize: u(20), color: "#8ea3bf", padding: u(8) }}>Loading the Library…</p>;
  if (all === null) return <p style={{ fontSize: u(20), color: "#ff9aa8", padding: u(8) }}>The Library could not be loaded.</p>;
  const c = treeCounts(all);
  const go = (t: number, f: string | null) => { setFolder(f); setTab(t); };
  return (
    <nav aria-label="Library tree" data-library-tree style={{ display: "flex", flexDirection: "column" }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        <Item data="all" on={folder === null && tab === 0} label="All assets" n={c.all} icon="▦" onClick={() => go(0, null)} />
      </ul>
      <div style={head}>
        <span>Folders</span>
        <button type="button" data-tree="new-folder" onClick={() => (canWrite ? newFolder() : say("Your role can view the Library but not make folders"))}
          aria-label="New folder" title={canWrite ? "Make a folder" : "Your role cannot make folders"}
          style={{ border: 0, background: "transparent", color: canWrite ? "#33a8ff" : "#5d7699", font: "inherit", fontSize: u(18), cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>+ New</button>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {c.folders.length === 0 && <li style={{ fontSize: u(18), color: "#8ea3bf", padding: `${u(4)} ${u(12)}` }}>No folders yet.{canWrite ? " + New makes one; items go in with their ⋯ menu › Move to folder." : ""}</li>}
        {c.folders.map((fo) => <Item key={fo.id} data={`folder-${fo.id}`} on={folder === fo.id} label={fo.name} n={fo.item_count} icon={<span style={{ color: "#f5b82e" }}>▰</span>} onClick={() => go(0, fo.id)} />)}
      </ul>
      <div style={head}><span>People</span></div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        <Item data="shared" on={folder === null && tab === SHARED_TAB} label="Shared With Me" n={c.shared} icon="👤" onClick={() => go(SHARED_TAB, null)} />
      </ul>
      <div style={head}><span>Deleted</span></div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        <Item data="trash" on={false} label="Trash" n={trash} icon="🗑" onClick={openTrash} />
      </ul>
      <SmartBinsTree head={head} row={row} count={count} />
    </nav>
  );
}
