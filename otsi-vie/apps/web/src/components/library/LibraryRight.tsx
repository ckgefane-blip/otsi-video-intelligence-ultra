"use client";
/**
 * SOT rebuild page 14 (alphabetical), Library: the right inspector —
 * Collections, Folders, Smart bins, Saved views and Access. The SOT's
 * Collections are the library's content kinds (All items, Videos,
 * Players, Reels, Reports & dossiers) with their real counts; picking
 * one narrows the centre table. Folders lists the Library folders
 * (GET /v1/library/folders) with a New folder button; "No folders yet."
 * when there are none. Smart bins are the person's saved Smart Searches
 * (GET /v1/smart-bins) — the SOT's two built-in bins, "Unconfirmed
 * players" and "Players without a report", are computed live from the
 * player list and the reports, and "+ New smart bin" opens the bin
 * dialog. Saved views are the person's saved searches
 * (GET /v1/saved-searches); "Save a search to reuse it." when there
 * are none. Access shows the selected item's access, or "Select an
 * item."; the Default for new items select is the project's access
 * default (Everyone in the organisation / Only me and the owner /
 * Chosen members).
 */
import type { LibraryFolder, PlayerListEntry, SavedSearch, SmartBin } from "@otsi-vie/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { NewBinDialog, useSmartBins } from "./SmartBins";
import type { LibraryItem, LibraryItemKind } from "./LibraryCentre";

export function LibraryRight({ counts, collection, setCollection, folders, onNewFolder, players, reportCount, selected, setQ, onNewBin }: {
  counts: { all: number; videos: number; players: number; reels: number; reports: number };
  collection: LibraryItemKind | "all"; setCollection: (c: LibraryItemKind | "all") => void;
  folders: LibraryFolder[]; onNewFolder: () => void;
  players: PlayerListEntry[] | null; reportCount: number;
  selected: LibraryItem | null; setQ: (q: string) => void; onNewBin: () => void;
}) {
  const { t: dict } = useLocale();
  const d = dict.body.library;
  const { bins, reload: reloadBins } = useSmartBins();
  const [saved, setSaved] = useState<SavedSearch[] | null>(null);
  useEffect(() => { void api<SavedSearch[]>("/v1/saved-searches").then(setSaved, () => setSaved([])); }, []);
  const [binOpen, setBinOpen] = useState(false);
  const unconfirmed = players?.filter((p) => !p.canonical_otsi_id).length ?? null;
  const withoutReport = players ? Math.max(0, players.length - reportCount) : null;
  const collRows: [LibraryItemKind | "all", string, number][] = [
    ["all", d.lbAllItems, counts.all],
    ["Match", d.kindVideos, counts.videos],
    ["Player", d.binGroupPlayers, counts.players],
    ["Reel", d.tabReels, counts.reels],
    ["Report", d.lbReportsDossiers, counts.reports],
  ];
  const accessDefault = selected?.asset?.project?.access ?? null;
  // SOT: three options — Everyone (ORGANIZATION), Only me and the owner (RESTRICTED, no collaborators),
  // Chosen members (RESTRICTED, collaborators chosen). The mode is what the select sets; the member list
  // itself is managed in the Access dialog.
  const accessValue = accessDefault === "RESTRICTED"
    ? ((selected?.asset?.project?.collaborators?.length ?? 0) > 0 ? "members" : "owner")
    : "everyone";
  const [accessBusy, setAccessBusy] = useState(false);
  const setDefaultAccess = async (v: string) => {
    const project = selected?.asset?.project;
    if (!project || accessBusy) return;
    setAccessBusy(true);
    // the API enum is ORGANIZATION | RESTRICTED — "OPEN" is not a value (zod rejects it), so send ORGANIZATION
    try { await api(`/v1/projects/${project.id}/access`, { method: "PUT", json: { access: v === "everyone" ? "ORGANIZATION" : "RESTRICTED" } }); }
    catch { /* the access dialog reports its own errors; this select stays on the old value */ }
    setAccessBusy(false);
  };

  return (
    <aside aria-label={d.lbCollections} className="flex min-w-0 flex-col overflow-auto" style={{ flex: "0 0 260px", maxWidth: 260 }}>
      <div className="vie-sect" style={{ gap: 2, padding: "12px 8px" }}>
        <span className="eb" style={{ padding: "0 8px 6px" }}>{d.lbCollections}</span>
        {collRows.map(([k, l, n]) => {
          const on = collection === k;
          return (
            <button key={k} type="button" onClick={() => setCollection(k)} aria-current={on || undefined}
              className="lr" style={{ border: 0, borderRadius: 6, minHeight: 32, color: on ? "var(--tx)" : "var(--tx2)", background: on ? "var(--p2)" : "transparent", fontWeight: on ? 500 : 400, padding: "0 8px" }}>
              <span style={{ flex: 1 }}>{l}</span>
              <span className="mono sm mu">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="vie-sect" style={{ gap: 2, padding: "12px 8px" }}>
        <div className="flex items-center justify-between" style={{ padding: "0 8px 4px" }}>
          <span className="eb">{d.treeFolders}</span>
          <button type="button" className="vie-ib" style={{ width: 26, height: 26 }} aria-label={d.newFolder} onClick={onNewFolder}>
            <Plus className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {folders.length === 0 ? (
          <p className="hint" style={{ padding: "0 8px" }}>{d.treeNoFolders}</p>
        ) : folders.map((f) => (
          <button key={f.id} type="button" onClick={() => setQ(f.name)} className="lr" style={{ border: 0, borderRadius: 6, minHeight: 32, color: "var(--tx2)", padding: "0 8px" }}>
            <span style={{ flex: 1 }}>{f.name}</span>
            <span className="mono sm mu">{f.item_count}</span>
          </button>
        ))}
        <span className="eb" style={{ padding: "12px 8px 4px" }}>{d.smartBins}</span>
        <button type="button" onClick={() => setQ("is:unconfirmed")} className="lr" style={{ border: 0, borderRadius: 6, minHeight: 32, color: "var(--tx2)", padding: "0 8px" }}>
          <span style={{ flex: 1 }}>{d.lbUnconfirmedPlayers}</span>
          <span className="mono sm mu">{unconfirmed ?? "—"}</span>
        </button>
        <button type="button" onClick={() => setQ("is:no-report")} className="lr" style={{ border: 0, borderRadius: 6, minHeight: 32, color: "var(--tx2)", padding: "0 8px" }}>
          <span style={{ flex: 1 }}>{d.lbPlayersWithoutReport}</span>
          <span className="mono sm mu">{withoutReport ?? "—"}</span>
        </button>
        {(bins ?? []).map((b: SmartBin) => (
          <Link key={b.id} href={`/library?q=${encodeURIComponent(b.q)}`} className="lr" style={{ border: 0, borderRadius: 6, minHeight: 32, color: "var(--tx2)", padding: "0 8px", textDecoration: "none" }}>
            <span style={{ flex: 1 }}>{b.name}</span>
            <span className="mono sm mu">{b.count}{b.more ? "+" : ""}</span>
          </Link>
        ))}
        <button type="button" className="btn sm gh" style={{ justifyContent: "flex-start" }} onClick={() => setBinOpen(true)}>{d.lbNewSmartBin}</button>
        <NewBinDialog open={binOpen} onOpenChange={setBinOpen} onSaved={async () => { await reloadBins(); onNewBin(); }} />
        <span className="eb" style={{ padding: "12px 8px 4px" }}>{d.lbSavedViews}</span>
        {saved && saved.length > 0 ? saved.map((s) => (
          <button key={s.id} type="button" onClick={() => setQ(String((s.query as { q?: unknown }).q ?? ""))} className="lr" style={{ border: 0, borderRadius: 6, minHeight: 32, color: "var(--tx2)", padding: "0 8px" }}>
            <span style={{ flex: 1 }}>{s.name}</span>
          </button>
        )) : <p className="hint" style={{ padding: "0 8px" }}>{d.lbSaveSearchHint}</p>}
      </div>

      <div className="vie-sect" style={{ borderBottom: 0 }}>
        <span className="eb">{d.lbAccess}</span>
        {selected ? (
          <p className="sm mu">{selected.title} · {selected.details}</p>
        ) : (
          <p className="sm mu">{d.lbSelectItem}</p>
        )}
        <div className="field">
          <label className="lab" htmlFor="lb-default-access">{d.lbDefaultNew}</label>
          <select id="lb-default-access" className="in" value={accessValue}
            disabled={!selected?.asset?.project || accessBusy}
            onChange={(e) => void setDefaultAccess(e.target.value)}>
            <option value="everyone">{d.accessEveryone}</option>
            <option value="owner">{d.accessOwnerOnly}</option>
            <option value="members">{d.accessChosenMembers}</option>
          </select>
        </div>
      </div>
    </aside>
  );
}
