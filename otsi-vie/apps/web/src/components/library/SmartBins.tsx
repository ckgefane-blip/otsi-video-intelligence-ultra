"use client";
/**
 * v3 Phase B.11 (ADR-087): Smart Bins, a person's saved Smart Searches that fill themselves (GET/POST/DELETE /v1/smart-bins).
 *   SmartBinsTree   the Library tree's "Smart Bins" section: each bin with what it holds now; + New; a bin opens its items
 *   NewBinDialog    name and search (words and type:/event:/is: filters); the server refuses a filter it does not understand
 *   BinDialog       what the bin holds now, grouped like the search palette; each item opens where the palette would open it
 * Clip Studio's Media Bin uses the same bins to narrow the reel player's suggested moments (MediaBin.tsx).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { hitHref, SMART_HINT, type SearchKind, type SmartBin, type SmartBinItems } from "@otsi-vie/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { u } from "@/components/stage/DesignStage";

const GROUP: Record<SearchKind, string> = { MATCH: "Matches", PLAYER: "Players", REEL: "Reels", PROJECT: "Projects", MOMENT: "Moments", MARKER: "Markers" };
export const binCount = (b: SmartBin) => `${b.count}${b.more ? "+" : ""}`;

/** the person's bins; null while loading, [] when none or unreachable */
export function useSmartBins(): { bins: SmartBin[] | null; reload: () => Promise<void> } {
  const [bins, setBins] = useState<SmartBin[] | null>(null);
  const reload = useCallback(() => api<SmartBin[]>("/v1/smart-bins").then(setBins, () => setBins([])), []);
  useEffect(() => { void reload(); }, [reload]);
  return { bins, reload };
}

const shell = "fixed left-1/2 top-24 z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 rounded-card border border-line bg-panel p-4 shadow-2xl";

export function NewBinDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: (b: SmartBin) => void }) {
  const { t: dict } = useLocale();
  const [name, setName] = useState(""), [q, setQ] = useState(""), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(""); setQ(""); setErr(null); } }, [open]);
  const save = async () => {
    setBusy(true); setErr(null);
    try { onSaved(await api<SmartBin>("/v1/smart-bins", { method: "POST", json: { name: name.trim(), q: q.trim() } })); onOpenChange(false); }
    catch (x) { setErr(x instanceof ApiProblem ? x.message : "The bin was not saved"); } finally { setBusy(false); }
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className={shell} data-new-bin>
          <Dialog.Title className="text-base font-semibold">{dict.body.library.newSmartBin}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">A saved search that fills itself: it always holds what the search finds now.</Dialog.Description>
          <label className="mt-3 block text-sm">Search
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. event:goal is:confirmed" aria-label="Bin search" maxLength={80}
              className="mt-1 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm" />
          </label>
          <p className="mt-1 text-xs text-muted">{SMART_HINT}. Words find matches, players, reels, projects, moments and markers.</p>
          <label className="mt-3 block text-sm">Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Confirmed goals" aria-label="Bin name" maxLength={80}
              className="mt-1 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm" />
          </label>
          {err && <p role="alert" className="mt-2 text-sm text-[#ff9aa8]">{err}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close className="rounded-ctl border border-line px-3 py-1.5 text-sm">Cancel</Dialog.Close>
            <button type="button" disabled={busy || !name.trim() || q.trim().length < 2} onClick={() => void save()}
              className="rounded-ctl bg-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Save bin</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function BinDialog({ bin, onOpenChange, onDeleted }: { bin: SmartBin | null; onOpenChange: (o: boolean) => void; onDeleted: () => void }) {
  const [items, setItems] = useState<SmartBinItems | null | "failed">(null);
  useEffect(() => {
    setItems(null);
    if (bin) void api<SmartBinItems>(`/v1/smart-bins/${bin.id}/items`).then(setItems, () => setItems("failed"));
  }, [bin]);
  const remove = async () => { if (!bin) return; await api(`/v1/smart-bins/${bin.id}`, { method: "DELETE" }).catch(() => undefined); onDeleted(); onOpenChange(false); };
  const hits = items && items !== "failed" ? items.hits : [];
  return (
    <Dialog.Root open={!!bin} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className={shell} data-bin-items>
          <Dialog.Title className="text-base font-semibold">{bin?.name}</Dialog.Title>
          <Dialog.Description className="mt-1 font-mono text-xs text-muted">{bin?.q}</Dialog.Description>
          <ul className="mt-3 max-h-[55vh] overflow-auto">
            {hits.map((h, i) => (
              <li key={`${h.kind}-${h.id}`}>
                {(i === 0 || hits[i - 1]!.kind !== h.kind) && <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{GROUP[h.kind]}</p>}
                <Link href={hitHref(h)} onClick={() => onOpenChange(false)} className="flex items-baseline justify-between gap-3 rounded-ctl px-2 py-1.5 hover:bg-primary/15">
                  <span className="min-w-0 truncate text-sm font-medium">{h.title}</span>
                  {h.detail && <span className="max-w-[55%] shrink-0 truncate text-xs text-muted">{h.detail}</span>}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted" data-bin-state>
            {items === null ? "Filling the bin…" : items === "failed" ? "The bin could not be filled; try again." : hits.length === 0 ? "Nothing recorded matches this bin now. It fills itself when something does."
              : `${hits.length}${items.bin.more ? "+" : ""} item${hits.length > 1 ? "s" : ""} now.`}
          </p>
          <div className="mt-3 flex justify-between">
            <button type="button" onClick={() => void remove()} className="rounded-ctl border border-line px-3 py-1.5 text-sm text-[#ff9aa8]">Delete bin</button>
            <Dialog.Close className="rounded-ctl border border-line px-3 py-1.5 text-sm">Close</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** the Library tree's Smart Bins section */
export function SmartBinsTree({ head, row, count }: { head: CSSProperties; row: (on: boolean) => CSSProperties; count: CSSProperties }) {
  const { t: dict } = useLocale();
  const { bins, reload } = useSmartBins();
  const [making, setMaking] = useState(false);
  const [open, setOpen] = useState<SmartBin | null>(null);
  return (
    <>
      <div style={head}>
        <span>{dict.body.library.smartBins}</span>
        <button type="button" data-tree="new-bin" onClick={() => setMaking(true)} aria-label={dict.body.library.newSmartBin} title="Save a search as a bin that fills itself"
          style={{ border: 0, background: "transparent", color: "#33a8ff", font: "inherit", fontSize: u(18), cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>+ New</button>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }} data-smart-bins>
        {bins === null ? <li style={{ fontSize: u(18), color: "#8ea3bf", padding: `${u(4)} ${u(12)}` }}>Loading…</li>
          : bins.length === 0 ? <li style={{ fontSize: u(18), color: "#8ea3bf", padding: `${u(4)} ${u(12)}`, whiteSpace: "normal" }}>No bins yet. + New saves a search (for example event:goal) as a bin that fills itself.</li>
          : bins.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => setOpen(b)} style={row(open?.id === b.id)} data-tree={`bin-${b.id}`} title={b.q}>
                <span aria-hidden style={{ width: u(22), textAlign: "center", flex: "none", color: "#a98bff" }}>✦</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
                <span style={count}>{binCount(b)}</span>
              </button>
            </li>
          ))}
      </ul>
      <NewBinDialog open={making} onOpenChange={setMaking} onSaved={() => void reload()} />
      <BinDialog bin={open} onOpenChange={(o) => { if (!o) setOpen(null); }} onDeleted={() => void reload()} />
    </>
  );
}
